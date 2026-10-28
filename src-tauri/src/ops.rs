use std::collections::HashSet;
use std::path::{Path, PathBuf};
use chrono::Utc;
use serde_json::json;
use sha2::{Digest, Sha256};
use tokio::fs;
use tokio::process::Command;
use uuid::Uuid;

use crate::error::{ApiError, ApiResult};
use crate::models::{
    Branch, CommitBase, CommitDetail, ConflictFile, ConflictsResponse, DiffFile, DiffResponse,
    DirectoryEntry, DirectoryListing, OnboardingCheck, OnboardingReport, Remote, RepoSummary,
    Stash, Status, Tag, Worktree, ReflogEntry, MIN_GIT_VERSION,
};
use crate::parse::{
    combine_diff_files, files_from_patch, parse_branches, parse_commit_log, parse_conflict_markers,
    parse_remotes, parse_stashes, parse_status_v2, parse_tags, BRANCH_FORMAT,
    COMMIT_LOG_FORMAT, TAG_FORMAT,
};
use crate::runner::{enriched_path, GitResult, GitRunner};

const MAX_PATCH_BYTES: usize = 2_000_000;

pub fn repo_id_for_path(repo_path: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(repo_path.as_bytes());
    let hex = format!("{:x}", hasher.finalize());
    hex.chars().take(12).collect()
}

pub fn resolve_user_path(input: &str, home: &str) -> PathBuf {
    if input == "~" {
        return PathBuf::from(home);
    }
    if let Some(rest) = input.strip_prefix("~/") {
        return Path::new(home).join(rest);
    }
    let p = PathBuf::from(input);
    if p.is_absolute() {
        p
    } else {
        std::env::current_dir()
            .unwrap_or_else(|_| PathBuf::from(home))
            .join(p)
    }
}

pub async fn realpath_loose(target: &Path) -> PathBuf {
    let mut current = target.to_path_buf();
    let mut suffix: Vec<String> = Vec::new();
    loop {
        if let Ok(real) = fs::canonicalize(&current).await {
            let mut out = real;
            for part in suffix.into_iter().rev() {
                out = out.join(part);
            }
            return out;
        }
        let Some(name) = current.file_name().map(|n| n.to_string_lossy().to_string()) else {
            return target.to_path_buf();
        };
        let Some(parent) = current.parent() else {
            return target.to_path_buf();
        };
        if parent == current {
            return target.to_path_buf();
        }
        suffix.push(name);
        current = parent.to_path_buf();
    }
}

pub async fn assert_repo_path(input: &str, home: &str) -> ApiResult<String> {
    let requested = resolve_user_path(input, home);
    let resolved = fs::canonicalize(&requested).await.map_err(|_| {
        ApiError::new(
            400,
            "PATH_NOT_FOUND",
            format!("Path does not exist: {}", requested.display()),
        )
    })?;
    let dot_git = resolved.join(".git");
    let meta = fs::metadata(&dot_git).await.map_err(|_| {
        ApiError::new(
            400,
            "NOT_A_REPO",
            format!("Not a Git repository: {}", resolved.display()),
        )
    })?;
    if !meta.is_dir() && !meta.is_file() {
        return Err(ApiError::new(
            400,
            "NOT_A_REPO",
            format!("Not a Git repository: {}", resolved.display()),
        ));
    }
    Ok(resolved.to_string_lossy().to_string())
}

pub async fn assert_repo_file(repo_path: &str, relative: &str) -> ApiResult<(PathBuf, String)> {
    let base = Path::new(repo_path);
    let joined = base.join(relative);
    let resolved = realpath_loose(&joined).await;
    let base_real = realpath_loose(base).await;
    if !resolved.starts_with(&base_real) {
        return Err(ApiError::new(
            400,
            "PATH_OUTSIDE_REPO",
            "Path must stay inside the repository.",
        ));
    }
    let rel = resolved
        .strip_prefix(&base_real)
        .map_err(|_| ApiError::new(400, "PATH_OUTSIDE_REPO", "Invalid repository path."))?;
    let rel_str = rel
        .components()
        .map(|c| c.as_os_str().to_string_lossy().to_string())
        .collect::<Vec<_>>()
        .join("/");
    if rel_str.is_empty() || rel_str == ".git" || rel_str.starts_with(".git/") {
        return Err(ApiError::new(
            400,
            "INVALID_REPO_FILE",
            "Invalid repository file path.",
        ));
    }
    Ok((resolved, rel_str))
}

pub async fn list_directories(input: Option<&str>, home: &str) -> ApiResult<DirectoryListing> {
    let target = resolve_user_path(input.unwrap_or(home), home);
    let current = realpath_loose(&target).await;
    let meta = fs::metadata(&current).await.map_err(|_| {
        ApiError::new(
            400,
            "NOT_A_DIRECTORY",
            format!("Not a directory: {}", current.display()),
        )
    })?;
    if !meta.is_dir() {
        return Err(ApiError::new(
            400,
            "NOT_A_DIRECTORY",
            format!("Not a directory: {}", current.display()),
        ));
    }

    let mut entries: Vec<DirectoryEntry> = Vec::new();
    if let Ok(mut rd) = fs::read_dir(&current).await {
        while let Ok(Some(entry)) = rd.next_entry().await {
            let name = entry.file_name().to_string_lossy().to_string();
            if name == "node_modules" {
                continue;
            }
            let Ok(ft) = entry.file_type().await else {
                continue;
            };
            if !ft.is_dir() {
                continue;
            }
            let entry_path = entry.path();
            let is_repo = fs::metadata(entry_path.join(".git"))
                .await
                .map(|m| m.is_dir() || m.is_file())
                .unwrap_or(false);
            entries.push(DirectoryEntry {
                name,
                path: entry_path.to_string_lossy().to_string(),
                is_repo,
                is_directory: true,
            });
        }
    }

    entries.sort_by(|a, b| b.is_repo.cmp(&a.is_repo).then_with(|| a.name.cmp(&b.name)));
    let parent = current
        .parent()
        .filter(|p| *p != current)
        .map(|p| p.to_string_lossy().to_string());

    Ok(DirectoryListing {
        path: current.to_string_lossy().to_string(),
        parent,
        entries,
    })
}

fn compare_versions(left: &str, right: &str) -> std::cmp::Ordering {
    let a: Vec<u32> = left
        .split('.')
        .map(|p| p.parse::<u32>().unwrap_or(0))
        .collect();
    let b: Vec<u32> = right
        .split('.')
        .map(|p| p.parse::<u32>().unwrap_or(0))
        .collect();
    let len = a.len().max(b.len());
    for i in 0..len {
        let av = a.get(i).copied().unwrap_or(0);
        let bv = b.get(i).copied().unwrap_or(0);
        if av != bv {
            return av.cmp(&bv);
        }
    }
    std::cmp::Ordering::Equal
}

async fn git_config_value(runner: &GitRunner, home: &str, key: &str) -> Option<String> {
    let res = runner.run(home, &["config", "--get", key], true).await.ok()?;
    let val = res.stdout.trim();
    if res.exit_code == 0 && !val.is_empty() {
        Some(val.to_string())
    } else {
        None
    }
}

pub async fn get_onboarding_report(runner: &GitRunner, home: &str) -> OnboardingReport {
    let mut checks: Vec<OnboardingCheck> = Vec::new();
    let git_version = runner.version().await;

    match &git_version {
        None => checks.push(OnboardingCheck {
            id: "git".to_string(),
            label: "Git".to_string(),
            status: "error".to_string(),
            detail: "Git was not found".to_string(),
            hint: Some("Install Git and make sure `git --version` works.".to_string()),
        }),
        Some(ver) if compare_versions(ver, MIN_GIT_VERSION).is_lt() => checks.push(OnboardingCheck {
            id: "git".to_string(),
            label: "Git".to_string(),
            status: "error".to_string(),
            detail: format!("Git {ver} is too old"),
            hint: Some(format!("Gitastic requires Git {MIN_GIT_VERSION} or newer.")),
        }),
        Some(ver) => checks.push(OnboardingCheck {
            id: "git".to_string(),
            label: "Git".to_string(),
            status: "ok".to_string(),
            detail: ver.clone(),
            hint: None,
        }),
    }

    let user_name = git_config_value(runner, home, "user.name").await;
    let user_email = git_config_value(runner, home, "user.email").await;
    let has_identity = user_name.is_some() && user_email.is_some();
    checks.push(OnboardingCheck {
        id: "identity".to_string(),
        label: "Commit identity".to_string(),
        status: if has_identity { "ok" } else { "error" }.to_string(),
        detail: match (&user_name, &user_email) {
            (Some(n), Some(e)) => format!("{n} <{e}>"),
            _ => "user.name or user.email is missing".to_string(),
        },
        hint: if has_identity {
            None
        } else {
            Some("Set `git config --global user.name` and `user.email`.".to_string())
        },
    });

    let cred = git_config_value(runner, home, "credential.helper").await;
    checks.push(OnboardingCheck {
        id: "credential".to_string(),
        label: "Git credential helper".to_string(),
        status: if cred.is_some() { "ok" } else { "warn" }.to_string(),
        detail: cred.clone().unwrap_or_else(|| "No credential helper configured".to_string()),
        hint: if cred.is_some() {
            None
        } else {
            Some("HTTPS remotes can be connected via the GitHub / GitLab Auth Assistant.".to_string())
        },
    });

    let lfs = runner.run(home, &["lfs", "version"], true).await.ok();
    let lfs_ok = lfs.as_ref().is_some_and(|r| r.exit_code == 0);
    checks.push(OnboardingCheck {
        id: "lfs".to_string(),
        label: "Git LFS".to_string(),
        status: if lfs_ok { "ok" } else { "warn" }.to_string(),
        detail: if lfs_ok {
            lfs.and_then(|r| r.stdout.lines().next().map(|s| s.to_string()))
                .unwrap_or_else(|| "installed".to_string())
        } else {
            "git-lfs is not installed".to_string()
        },
        hint: if lfs_ok {
            None
        } else {
            Some("LFS repositories need `git lfs` installed.".to_string())
        },
    });

    let ssh_out = Command::new("ssh-add")
        .arg("-l")
        .env("PATH", enriched_path())
        .output()
        .await
        .ok();
    let (ssh_ok, ssh_detail) = match ssh_out {
        Some(out) if out.status.success() => {
            let txt = String::from_utf8_lossy(&out.stdout);
            let count = txt.lines().filter(|l| !l.trim().is_empty()).count();
            if count > 0 {
                (
                    true,
                    format!("{count} key{} loaded in ssh-agent", if count == 1 { "" } else { "s" }),
                )
            } else {
                (false, "No keys loaded in ssh-agent".to_string())
            }
        }
        _ => (false, "No keys loaded in ssh-agent".to_string()),
    };
    checks.push(OnboardingCheck {
        id: "ssh".to_string(),
        label: "SSH agent".to_string(),
        status: if ssh_ok { "ok" } else { "warn" }.to_string(),
        detail: ssh_detail,
        hint: if ssh_ok {
            None
        } else {
            Some("Use the Auth & SSH Assistant to load or generate an SSH key.".to_string())
        },
    });

    OnboardingReport {
        home: home.to_string(),
        root: "/".to_string(),
        git_version,
        min_git_version: MIN_GIT_VERSION.to_string(),
        checks,
    }
}

async fn resolve_git_dir(repo_path: &str) -> PathBuf {
    let dot_git = Path::new(repo_path).join(".git");
    if let Ok(meta) = fs::metadata(&dot_git).await {
        if meta.is_dir() {
            return dot_git;
        }
        if let Ok(txt) = fs::read_to_string(&dot_git).await {
            for line in txt.lines() {
                if let Some(rest) = line.strip_prefix("gitdir:") {
                    return Path::new(repo_path).join(rest.trim());
                }
            }
        }
    }
    dot_git
}

pub async fn detect_operation(repo_path: &str) -> Option<String> {
    let git_dir = resolve_git_dir(repo_path).await;
    if fs::metadata(git_dir.join("MERGE_HEAD")).await.is_ok() {
        return Some("merge".to_string());
    }
    if fs::metadata(git_dir.join("rebase-merge")).await.is_ok()
        || fs::metadata(git_dir.join("rebase-apply")).await.is_ok()
    {
        return Some("rebase".to_string());
    }
    if fs::metadata(git_dir.join("CHERRY_PICK_HEAD")).await.is_ok() {
        return Some("cherry-pick".to_string());
    }
    if fs::metadata(git_dir.join("REVERT_HEAD")).await.is_ok() {
        return Some("revert".to_string());
    }
    None
}

pub async fn get_status(runner: &GitRunner, repo_path: &str) -> ApiResult<Status> {
    let res = runner
        .run(repo_path, &["status", "--porcelain=v2", "-z", "--branch"], true)
        .await?;
    let mut status = parse_status_v2(&res.stdout);
    status.operation = detect_operation(repo_path).await;
    Ok(status)
}

pub async fn get_repo_summary(
    runner: &GitRunner,
    repo_path: &str,
    id: &str,
) -> ApiResult<RepoSummary> {
    let status = get_status(runner, repo_path).await?;
    let head_res = runner
        .run(repo_path, &["rev-parse", "--verify", "HEAD"], true)
        .await?;
    let head = if head_res.exit_code == 0 && !head_res.stdout.trim().is_empty() {
        Some(head_res.stdout.trim().to_string())
    } else {
        status.head.clone()
    };
    let last_res = runner
        .run(repo_path, &["log", "-1", "--format=%h %s"], true)
        .await?;
    let last_commit = if last_res.exit_code == 0 && !last_res.stdout.trim().is_empty() {
        Some(last_res.stdout.trim().to_string())
    } else {
        None
    };

    let name = Path::new(repo_path)
        .file_name()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| repo_path.to_string());

    let dirty = status.files.len();
    let staged = status.files.iter().filter(|f| f.staged).count();
    let untracked = status.files.iter().filter(|f| f.untracked).count();
    let conflicts = status.files.iter().filter(|f| f.conflicted).count();

    Ok(RepoSummary {
        id: id.to_string(),
        name,
        path: repo_path.to_string(),
        root: repo_path.to_string(),
        head: head.clone(),
        branch: status.branch.clone(),
        detached: head.is_some() && status.branch.is_none(),
        upstream: status.upstream,
        ahead: status.ahead,
        behind: status.behind,
        operation: status.operation,
        dirty,
        staged,
        untracked,
        conflicts,
        last_commit,
    })
}

pub async fn list_branches(runner: &GitRunner, repo_path: &str) -> ApiResult<Vec<Branch>> {
    let fmt = format!("--format={BRANCH_FORMAT}");
    let out = runner
        .run(
            repo_path,
            &[
                "for-each-ref",
                "--sort=-committerdate",
                &fmt,
                "refs/heads",
                "refs/remotes",
            ],
            false,
        )
        .await?;
    Ok(parse_branches(&out.stdout))
}

pub async fn list_tags(runner: &GitRunner, repo_path: &str) -> ApiResult<Vec<Tag>> {
    let fmt = format!("--format={TAG_FORMAT}");
    let out = runner
        .run(
            repo_path,
            &["for-each-ref", "--sort=-creatordate", &fmt, "refs/tags"],
            false,
        )
        .await?;
    Ok(parse_tags(&out.stdout))
}

pub async fn list_remotes(runner: &GitRunner, repo_path: &str) -> ApiResult<Vec<Remote>> {
    let out = runner.run(repo_path, &["remote", "-v"], true).await?;
    Ok(parse_remotes(&out.stdout))
}

pub async fn list_stashes(runner: &GitRunner, repo_path: &str) -> ApiResult<Vec<Stash>> {
    let out = runner
        .run(
            repo_path,
            &["stash", "list", "--format=%gd%x00%H%x00%gs%x00%cI"],
            true,
        )
        .await?;
    Ok(parse_stashes(&out.stdout))
}

pub async fn list_reflog(runner: &GitRunner, repo_path: &str) -> ApiResult<Vec<ReflogEntry>> {
    let out = runner
        .run(
            repo_path,
            &["log", "-g", "--format=%H%x00%gd%x00%gs%x00%cI", "-n", "200"],
            true,
        )
        .await?;
    Ok(crate::parse::parse_reflog(&out.stdout))
}

pub async fn checkout_reflog(
    runner: &GitRunner,
    repo_path: &str,
    selector: &str,
) -> ApiResult<()> {
    runner.run(repo_path, &["checkout", selector], false).await?;
    Ok(())
}

pub async fn list_worktrees(runner: &GitRunner, repo_path: &str) -> ApiResult<Vec<Worktree>> {
    let out = runner
        .run(repo_path, &["worktree", "list", "--porcelain"], true)
        .await?;
    if out.exit_code != 0 {
        return Ok(Vec::new());
    }
    let mut worktrees = Vec::new();
    for (idx, block) in out.stdout.trim().split("\n\n").enumerate() {
        let mut wt_path = String::new();
        let mut head = String::new();
        let mut branch: Option<String> = None;
        let mut bare = false;
        let mut detached = false;
        let mut locked = false;
        let mut prunable = false;

        for line in block.lines().map(|l| l.trim()) {
            if let Some(p) = line.strip_prefix("worktree ") {
                wt_path = p.trim().to_string();
            } else if let Some(h) = line.strip_prefix("HEAD ") {
                head = h.trim().to_string();
            } else if let Some(b) = line.strip_prefix("branch ") {
                branch = Some(
                    b.trim()
                        .strip_prefix("refs/heads/")
                        .unwrap_or(b.trim())
                        .to_string(),
                );
            } else if line == "bare" {
                bare = true;
            } else if line == "detached" {
                detached = true;
            } else if line.starts_with("locked") {
                locked = true;
            } else if line.starts_with("prunable") {
                prunable = true;
            }
        }

        if !wt_path.is_empty() {
            worktrees.push(Worktree {
                path: wt_path,
                head,
                branch,
                bare,
                detached,
                locked,
                prunable,
                is_main: idx == 0,
            });
        }
    }
    Ok(worktrees)
}

pub async fn apply_patch(
    runner: &GitRunner,
    repo_path: &str,
    patch: &str,
    cached: bool,
    reverse: bool,
) -> ApiResult<GitResult> {
    let mut args = vec!["apply", "--unidiff-zero", "--recount", "--whitespace=nowarn"];
    if cached {
        args.push("--cached");
    }
    if reverse {
        args.push("--reverse");
    }
    let normalized = if patch.ends_with('\n') {
        patch.to_string()
    } else {
        format!("{patch}\n")
    };
    runner
        .run_with_input(repo_path, &args, Some(&normalized), false)
        .await
}

pub async fn get_commit_base(
    runner: &GitRunner,
    repo_path: &str,
    hash: &str,
) -> ApiResult<CommitBase> {
    let fmt = format!("--format={COMMIT_LOG_FORMAT}");
    let out = runner.run(repo_path, &["show", "-s", &fmt, hash], false).await?;
    let mut commits = parse_commit_log(&out.stdout);
    commits
        .pop()
        .ok_or_else(|| ApiError::new(404, "COMMIT_NOT_FOUND", format!("Commit not found: {hash}")))
}

fn cap_patch(patch: String) -> (String, bool) {
    if patch.len() <= MAX_PATCH_BYTES {
        (patch, false)
    } else {
        let mut end = MAX_PATCH_BYTES;
        while !patch.is_char_boundary(end) && end > 0 {
            end -= 1;
        }
        (
            format!("{}\n\n--- patch truncated by Gitastic ---\n", &patch[..end]),
            true,
        )
    }
}

fn with_diff_options(args: &[String], extra: &[&str]) -> Vec<String> {
    if let Some(pos) = args.iter().position(|x| x == "--") {
        let mut out = args[..pos].to_vec();
        out.extend(extra.iter().map(|s| s.to_string()));
        out.extend_from_slice(&args[pos..]);
        out
    } else {
        let mut out = args.to_vec();
        out.extend(extra.iter().map(|s| s.to_string()));
        out
    }
}

async fn diff_files(runner: &GitRunner, repo_path: &str, args: &[String]) -> ApiResult<Vec<DiffFile>> {
    let ns_args = with_diff_options(args, &["--numstat", "-z"]);
    let st_args = with_diff_options(args, &["--name-status", "-z"]);
    let numstat = runner.run_owned(repo_path, &ns_args, true).await?;
    let name_status = runner.run_owned(repo_path, &st_args, true).await?;
    Ok(combine_diff_files(&numstat.stdout, &name_status.stdout))
}

pub async fn get_commit_detail(
    runner: &GitRunner,
    repo_path: &str,
    hash: &str,
    context: u32,
) -> ApiResult<CommitDetail> {
    let commit = get_commit_base(runner, repo_path, hash).await?;
    let unified = format!("--unified={context}");
    let diff_args: Vec<String> = if commit.parents.len() > 1 {
        vec![
            "diff".to_string(),
            unified,
            commit.parents[0].clone(),
            hash.to_string(),
        ]
    } else {
        vec![
            "show".to_string(),
            "--format=".to_string(),
            unified,
            hash.to_string(),
        ]
    };

    let mut patch_args = diff_args.clone();
    patch_args.push("--no-color".to_string());
    patch_args.push("--no-ext-diff".to_string());

    let patch_res = runner.run_owned(repo_path, &patch_args, true).await?;
    let files = diff_files(runner, repo_path, &diff_args).await?;
    let (patch, too_large) = cap_patch(patch_res.stdout);
    let binary = files.iter().any(|f| f.binary) || patch.contains("Binary files");

    Ok(CommitDetail {
        commit,
        files,
        patch,
        binary,
        too_large,
    })
}

pub async fn get_diff(
    runner: &GitRunner,
    repo_path: &str,
    staged: bool,
    path: Option<String>,
    context: u32,
    untracked: bool,
) -> ApiResult<DiffResponse> {
    let mut base: Vec<String> = vec!["diff".to_string(), format!("--unified={context}")];
    if staged {
        base.push("--cached".to_string());
    }
    base.push("--no-color".to_string());
    base.push("--no-ext-diff".to_string());
    if let Some(ref p) = path {
        base.push("--".to_string());
        base.push(p.clone());
    }

    let (raw_patch, mut files) = if untracked {
        let p = path.clone().unwrap_or_default();
        let res = runner
            .run(
                repo_path,
                &["diff", "--no-index", "--no-color", "--no-ext-diff", "/dev/null", &p],
                true,
            )
            .await?;
        let parsed = files_from_patch(&res.stdout);
        (res.stdout, parsed)
    } else {
        let patch_res = runner.run_owned(repo_path, &base, true).await?;
        let df = diff_files(runner, repo_path, &base).await?;
        (patch_res.stdout, df)
    };

    if files.is_empty() && !raw_patch.is_empty() {
        files = files_from_patch(&raw_patch);
    }

    let (patch, too_large) = cap_patch(raw_patch);
    let binary = files.iter().any(|f| f.binary) || patch.contains("Binary files");

    Ok(DiffResponse {
        path,
        staged,
        patch,
        files,
        binary,
        too_large,
    })
}

pub async fn get_conflicts(runner: &GitRunner, repo_path: &str) -> ApiResult<ConflictsResponse> {
    let status = get_status(runner, repo_path).await?;
    let mut files: Vec<ConflictFile> = Vec::new();

    for file in status.files.iter().filter(|f| f.conflicted) {
        let (abs, _) = assert_repo_file(repo_path, &file.path).await?;
        let bytes = fs::read(&abs).await.unwrap_or_default();
        let binary = bytes.iter().take(8000).any(|&b| b == 0);
        let content = if binary {
            None
        } else {
            Some(String::from_utf8_lossy(&bytes).into_owned())
        };
        let blocks = content
            .as_deref()
            .map(|c| parse_conflict_markers(c, &file.path))
            .unwrap_or_default();
        files.push(ConflictFile {
            path: file.path.clone(),
            kind: file.kind.clone(),
            binary,
            content,
            blocks,
        });
    }

    Ok(ConflictsResponse {
        operation: status.operation,
        files,
    })
}

pub async fn resolve_conflict_file(
    runner: &GitRunner,
    repo_path: &str,
    file_path: &str,
    content: &str,
) -> ApiResult<()> {
    let (abs, rel) = assert_repo_file(repo_path, file_path).await?;
    fs::write(&abs, content.as_bytes()).await.map_err(|err| {
        ApiError::new(500, "WRITE_FAILED", format!("Failed to write file: {err}"))
    })?;
    runner.run(repo_path, &["add", "--", &rel], false).await?;
    Ok(())
}

pub async fn resolve_binary_conflict(
    runner: &GitRunner,
    repo_path: &str,
    file_path: &str,
    side: &str,
) -> ApiResult<()> {
    let (_, rel) = assert_repo_file(repo_path, file_path).await?;
    let flag = if side == "theirs" { "--theirs" } else { "--ours" };
    runner.run(repo_path, &["checkout", flag, "--", &rel], false).await?;
    runner.run(repo_path, &["add", "--", &rel], false).await?;
    Ok(())
}

fn sanitize_label(value: &str) -> String {
    let s: String = value
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '.' || c == '_' || c == '-' {
                c
            } else {
                '-'
            }
        })
        .take(40)
        .collect();
    if s.is_empty() {
        "backup".to_string()
    } else {
        s
    }
}

pub async fn create_backup_ref(
    runner: &GitRunner,
    repo_path: &str,
    label: &str,
) -> Option<String> {
    let r = format!(
        "refs/gitastic/backup/{}-{}",
        Utc::now().timestamp_millis(),
        sanitize_label(label)
    );
    let res = runner.run(repo_path, &["update-ref", &r, "HEAD"], true).await.ok()?;
    if res.exit_code == 0 {
        Some(r)
    } else {
        None
    }
}

pub async fn save_branch_to_trash(
    runner: &GitRunner,
    repo_path: &str,
    branch: &str,
) -> Option<String> {
    let target = format!("refs/heads/{branch}");
    let sha = runner
        .run(repo_path, &["rev-parse", "--verify", &target], true)
        .await
        .ok()?;
    if sha.exit_code != 0 {
        return None;
    }
    let r = format!(
        "refs/gitastic/trash/branches/{}-{}",
        Utc::now().timestamp_millis(),
        sanitize_label(branch)
    );
    let res = runner
        .run(repo_path, &["update-ref", &r, sha.stdout.trim()], true)
        .await
        .ok()?;
    if res.exit_code == 0 {
        Some(r)
    } else {
        None
    }
}

pub async fn trash_paths(
    repo_path: &str,
    data_dir: &Path,
    repo_id: &str,
    paths: &[String],
) -> ApiResult<String> {
    let trash_dir = data_dir.join("trash").join(repo_id).join(format!(
        "{}-{}",
        Utc::now().timestamp_millis(),
        &Uuid::new_v4().to_string()[..8]
    ));
    fs::create_dir_all(&trash_dir).await.map_err(|e| {
        ApiError::new(500, "TRASH_DIR_FAILED", format!("Could not create trash dir: {e}"))
    })?;

    for rel in paths {
        let Ok((src, clean_rel)) = assert_repo_file(repo_path, rel).await else {
            continue;
        };
        if fs::symlink_metadata(&src).await.is_err() {
            continue;
        }
        let dst = trash_dir.join(&clean_rel);
        if let Some(parent) = dst.parent() {
            let _ = fs::create_dir_all(parent).await;
        }
        let _ = fs::rename(&src, &dst).await;
    }

    Ok(trash_dir.to_string_lossy().to_string())
}

pub async fn restore_trash(trash_dir: &str, repo_path: &str) -> ApiResult<()> {
    let root = Path::new(trash_dir);
    if fs::metadata(root).await.is_err() {
        return Ok(());
    }
    let mut stack: Vec<PathBuf> = vec![root.to_path_buf()];
    while let Some(dir) = stack.pop() {
        let Ok(mut rd) = fs::read_dir(&dir).await else {
            continue;
        };
        while let Ok(Some(entry)) = rd.next_entry().await {
            let p = entry.path();
            if let Ok(ft) = entry.file_type().await {
                if ft.is_dir() {
                    stack.push(p);
                } else if let Ok(rel) = p.strip_prefix(root) {
                    let dst = Path::new(repo_path).join(rel);
                    if let Some(parent) = dst.parent() {
                        let _ = fs::create_dir_all(parent).await;
                    }
                    let _ = fs::remove_file(&dst).await;
                    let _ = fs::rename(&p, &dst).await;
                }
            }
        }
    }
    let _ = fs::remove_dir_all(root).await;
    Ok(())
}

pub async fn stage(runner: &GitRunner, repo_path: &str, paths: &[String]) -> ApiResult<GitResult> {
    if paths.is_empty() {
        return runner.run(repo_path, &["add", "-A"], false).await;
    }
    let mut args = vec!["add".to_string(), "-A".to_string(), "--".to_string()];
    args.extend_from_slice(paths);
    runner.run_owned(repo_path, &args, false).await
}

pub async fn unstage(runner: &GitRunner, repo_path: &str, paths: &[String]) -> ApiResult<GitResult> {
    if !paths.is_empty() {
        let mut args = vec![
            "restore".to_string(),
            "--staged".to_string(),
            "--".to_string(),
        ];
        args.extend_from_slice(paths);
        let res = runner.run_owned(repo_path, &args, true).await?;
        if res.exit_code == 0 {
            return Ok(res);
        }
        let mut rm_args = vec![
            "rm".to_string(),
            "--cached".to_string(),
            "-r".to_string(),
            "--ignore-unmatch".to_string(),
            "--".to_string(),
        ];
        rm_args.extend_from_slice(paths);
        return runner.run_owned(repo_path, &rm_args, false).await;
    }
    let res = runner.run(repo_path, &["reset"], true).await?;
    if res.exit_code == 0 {
        return Ok(res);
    }
    runner
        .run(
            repo_path,
            &["rm", "--cached", "-r", "--ignore-unmatch", "."],
            false,
        )
        .await
}

pub async fn commit(
    runner: &GitRunner,
    repo_path: &str,
    message: &str,
    amend: bool,
    signoff: bool,
) -> ApiResult<GitResult> {
    let mut args: Vec<&str> = vec!["commit", "-F", "-"];
    if amend {
        args.push("--amend");
    }
    if signoff {
        args.push("--signoff");
    }
    runner
        .run_with_input(repo_path, &args, Some(message), false)
        .await
}

pub async fn checkout(runner: &GitRunner, repo_path: &str, r#ref: &str) -> ApiResult<GitResult> {
    let res = runner.run(repo_path, &["switch", r#ref], true).await?;
    if res.exit_code == 0 {
        return Ok(res);
    }

    let remote_ref = if r#ref.starts_with("refs/remotes/") {
        r#ref.to_string()
    } else {
        format!("refs/remotes/{}", r#ref)
    };
    let rem = runner
        .run(
            repo_path,
            &["rev-parse", "--verify", "--quiet", &remote_ref],
            true,
        )
        .await?;
    if rem.exit_code == 0 {
        let short_ref = r#ref.strip_prefix("refs/remotes/").unwrap_or(r#ref);
        let local_name = short_ref
            .split_once('/')
            .map(|(_, b)| b)
            .unwrap_or(short_ref);
        let local_head = format!("refs/heads/{local_name}");
        let existing = runner
            .run(
                repo_path,
                &["rev-parse", "--verify", "--quiet", &local_head],
                true,
            )
            .await?;
        if existing.exit_code == 0 {
            return runner.run(repo_path, &["switch", local_name], false).await;
        }
        return runner
            .run(repo_path, &["switch", "--track", short_ref], false)
            .await;
    }

    if r#ref.len() >= 4
        && r#ref.len() <= 40
        && r#ref.chars().all(|c| c.is_ascii_hexdigit())
    {
        return runner
            .run(repo_path, &["switch", "--detach", r#ref], false)
            .await;
    }

    Err(ApiError::with_details(
        422,
        "CHECKOUT_FAILED",
        format!("Could not check out {}", r#ref),
        json!({ "stderr": res.stderr }),
    ))
}

pub async fn preview_clean(
    runner: &GitRunner,
    repo_path: &str,
    paths: Option<&[String]>,
) -> ApiResult<Vec<String>> {
    let mut args = vec!["clean".to_string(), "-nd".to_string(), "-d".to_string()];
    if let Some(p) = paths {
        if !p.is_empty() {
            args.push("--".to_string());
            args.extend_from_slice(p);
        }
    }
    let res = runner.run_owned(repo_path, &args, true).await?;
    Ok(res
        .stdout
        .lines()
        .map(|l| l.trim())
        .filter_map(|l| l.strip_prefix("Would remove "))
        .map(|l| l.trim_end_matches('/').to_string())
        .collect())
}

pub async fn restore_files(
    runner: &GitRunner,
    repo_path: &str,
    data_dir: &Path,
    repo_id: &str,
    paths: &[String],
) -> ApiResult<String> {
    let status = get_status(runner, repo_path).await?;
    let untracked: HashSet<String> = status
        .files
        .into_iter()
        .filter(|f| f.untracked)
        .map(|f| f.path)
        .collect();

    let trash_dir = trash_paths(repo_path, data_dir, repo_id, paths).await?;
    let tracked: Vec<String> = paths
        .iter()
        .filter(|p| !untracked.contains(*p))
        .cloned()
        .collect();
    if !tracked.is_empty() {
        let mut args = vec!["restore".to_string(), "--".to_string()];
        args.extend(tracked);
        let _ = runner.run_owned(repo_path, &args, true).await;
    }
    Ok(trash_dir)
}
