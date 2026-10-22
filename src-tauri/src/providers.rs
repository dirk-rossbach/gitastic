use std::os::unix::fs::PermissionsExt;
use std::path::Path;
use std::process::Stdio;
use std::time::Duration;
use serde::Deserialize;
use tokio::fs;
use tokio::io::AsyncWriteExt;
use tokio::process::Command;
use uuid::Uuid;

use crate::error::{ApiError, ApiResult};
use crate::models::{
    ProviderAccountStatus, ProviderRepo, ProvidersStatusResponse, PullRequestItem,
    PullRequestsResponse, Remote, RemoteProviderInfo, SshKeyEntry,
};
use crate::ops::{checkout, list_remotes};
use crate::runner::{enriched_path, GitRunner};

fn detect_provider_kind(host: &str, full_name: &str) -> String {
    let lower = host.to_lowercase();
    if lower.contains("github") {
        return "github".to_string();
    }
    if lower.contains("gitlab") || full_name.split('/').count() > 2 {
        return "gitlab".to_string();
    }
    "gitlab".to_string()
}

pub fn parse_remote_url(remote_name: &str, remote_url: &str) -> Option<RemoteProviderInfo> {
    let trimmed = remote_url.trim();
    if trimmed.is_empty() {
        return None;
    }

    let (host, raw_path) = if !trimmed.contains("://") {
        let after_at = trimmed.split_once('@').map(|(_, r)| r).unwrap_or(trimmed);
        let (h, p) = after_at.split_once(':')?;
        (h.to_string(), p.to_string())
    } else {
        let (_, rest) = trimmed.split_once("://")?;
        let without_user = rest.split_once('@').map(|(_, r)| r).unwrap_or(rest);
        let (host_port, p) = without_user.split_once('/')?;
        let h = host_port.split_once(':').map(|(h, _)| h).unwrap_or(host_port);
        (h.to_string(), p.to_string())
    };

    let cleaned = raw_path
        .trim_matches('/')
        .strip_suffix(".git")
        .unwrap_or(raw_path.trim_matches('/'))
        .trim_matches('/');
    let segments: Vec<&str> = cleaned.split('/').filter(|s| !s.is_empty()).collect();
    if host.is_empty() || segments.len() < 2 {
        return None;
    }

    let repo = segments[segments.len() - 1].to_string();
    let owner = segments[..segments.len() - 1].join("/");
    let full_name = format!("{owner}/{repo}");
    let provider = detect_provider_kind(&host, &full_name);
    let web_url = format!("https://{host}/{full_name}");

    if provider == "github" {
        Some(RemoteProviderInfo {
            remote_name: remote_name.to_string(),
            provider,
            host,
            owner,
            repo,
            full_name,
            pulls_url: format!("{web_url}/pulls"),
            issues_url: format!("{web_url}/issues"),
            branch_url_template: format!("{web_url}/tree/{{branch}}"),
            commit_url_template: format!("{web_url}/commit/{{hash}}"),
            create_pull_url_template: format!("{web_url}/compare/{{branch}}?expand=1"),
            web_url,
        })
    } else {
        Some(RemoteProviderInfo {
            remote_name: remote_name.to_string(),
            provider,
            host,
            owner,
            repo,
            full_name,
            pulls_url: format!("{web_url}/-/merge_requests"),
            issues_url: format!("{web_url}/-/issues"),
            branch_url_template: format!("{web_url}/-/tree/{{branch}}"),
            commit_url_template: format!("{web_url}/-/commit/{{hash}}"),
            create_pull_url_template: format!(
                "{web_url}/-/merge_requests/new?merge_request%5Bsource_branch%5D={{branch}}"
            ),
            web_url,
        })
    }
}

pub fn select_primary_remote_info(remotes: &[Remote]) -> Option<RemoteProviderInfo> {
    let mut sorted = remotes.to_vec();
    sorted.sort_by(|a, b| {
        if a.name == "origin" {
            std::cmp::Ordering::Less
        } else if b.name == "origin" {
            std::cmp::Ordering::Greater
        } else {
            a.name.cmp(&b.name)
        }
    });
    for remote in sorted {
        if let Some(info) = parse_remote_url(&remote.name, &remote.url) {
            return Some(info);
        }
    }
    None
}

async fn has_command(binary: &str) -> bool {
    Command::new(binary)
        .arg("--version")
        .env("PATH", enriched_path())
        .output()
        .await
        .map(|o| o.status.success())
        .unwrap_or(false)
}

async fn read_git_credential(
    runner: &GitRunner,
    home: &str,
    host: &str,
) -> Option<(String, String)> {
    let helper = runner
        .run(home, &["config", "--get", "credential.helper"], true)
        .await
        .ok()?;
    if helper.exit_code != 0 || helper.stdout.trim().is_empty() {
        return None;
    }

    let mut child = Command::new(&runner.git_path)
        .current_dir(home)
        .args(["credential", "fill"])
        .env("PATH", enriched_path())
        .env("GIT_TERMINAL_PROMPT", "0")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .ok()?;

    if let Some(mut stdin) = child.stdin.take() {
        let payload = format!("protocol=https\nhost={host}\n\n");
        let _ = stdin.write_all(payload.as_bytes()).await;
    }

    let output = tokio::time::timeout(Duration::from_millis(2500), child.wait_with_output())
        .await
        .ok()?
        .ok()?;
    if !output.status.success() {
        return None;
    }

    let text = String::from_utf8_lossy(&output.stdout);
    let mut username = String::new();
    let mut password = String::new();
    for line in text.lines() {
        if let Some(u) = line.strip_prefix("username=") {
            username = u.trim().to_string();
        } else if let Some(p) = line.strip_prefix("password=") {
            password = p.trim().to_string();
        }
    }
    if password.is_empty() {
        None
    } else {
        Some((username, password))
    }
}

async fn store_git_credential(runner: &GitRunner, home: &str, host: &str, username: &str, token: &str) {
    let payload = format!("protocol=https\nhost={host}\nusername={username}\npassword={token}\n\n");
    let _ = runner
        .run_with_input(home, &["credential", "approve"], Some(&payload), true)
        .await;
}

async fn erase_git_credential(runner: &GitRunner, home: &str, host: &str) {
    let payload = format!("protocol=https\nhost={host}\n\n");
    let _ = runner
        .run_with_input(home, &["credential", "reject"], Some(&payload), true)
        .await;
}

async fn get_github_token(
    runner: &GitRunner,
    home: &str,
    host: &str,
) -> Option<(String, String, Option<String>)> {
    if has_command("gh").await {
        if let Ok(out) = Command::new("gh")
            .args(["auth", "token", "--hostname", host])
            .env("PATH", enriched_path())
            .output()
            .await
        {
            let token = String::from_utf8_lossy(&out.stdout).trim().to_string();
            if out.status.success() && !token.is_empty() {
                let user_out = Command::new("gh")
                    .args(["api", "--hostname", host, "user", "--jq", ".login"])
                    .env("PATH", enriched_path())
                    .output()
                    .await
                    .ok();
                let username = user_out.and_then(|u| {
                    if u.status.success() {
                        let s = String::from_utf8_lossy(&u.stdout).trim().to_string();
                        if s.is_empty() {
                            None
                        } else {
                            Some(s)
                        }
                    } else {
                        None
                    }
                });
                return Some((token, "gh-cli".to_string(), username));
            }
        }
    }

    if let Some((user, pass)) = read_git_credential(runner, home, host).await {
        return Some((
            pass,
            "git-credential".to_string(),
            if user.is_empty() { None } else { Some(user) },
        ));
    }

    None
}

async fn get_gitlab_token(
    runner: &GitRunner,
    home: &str,
    host: &str,
) -> Option<(String, String, Option<String>)> {
    if let Some((user, pass)) = read_git_credential(runner, home, host).await {
        return Some((
            pass,
            "git-credential".to_string(),
            if user.is_empty() { None } else { Some(user) },
        ));
    }
    None
}

fn http_client() -> Result<reqwest::Client, ApiError> {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(8))
        .user_agent("Gitastic-Native-Client")
        .build()
        .map_err(|e| ApiError::new(500, "HTTP_CLIENT_ERROR", e.to_string()))
}

fn github_api_base(host: &str) -> String {
    if host.eq_ignore_ascii_case("github.com") {
        "https://api.github.com".to_string()
    } else {
        format!("https://{host}/api/v3")
    }
}

fn gitlab_api_base(host: &str) -> String {
    format!("https://{host}/api/v4")
}

async fn fetch_github_json<T: for<'de> Deserialize<'de>>(
    host: &str,
    endpoint: &str,
    token: Option<&str>,
) -> ApiResult<T> {
    let client = http_client()?;
    let url = format!("{}{endpoint}", github_api_base(host));
    let mut req = client
        .get(&url)
        .header("Accept", "application/vnd.github+json");
    if let Some(t) = token {
        if !t.is_empty() {
            req = req.header("Authorization", format!("Bearer {t}"));
        }
    }
    let res = req
        .send()
        .await
        .map_err(|e| ApiError::new(422, "PROVIDER_API_FAILED", e.to_string()))?;
    if !res.status().is_success() {
        let code = res.status().as_u16();
        return Err(ApiError::new(
            if code == 401 || code == 403 { 401 } else { 422 },
            "PROVIDER_API_FAILED",
            format!("GitHub API request failed ({code})"),
        ));
    }
    res.json::<T>()
        .await
        .map_err(|e| ApiError::new(422, "PROVIDER_PARSE_FAILED", e.to_string()))
}

async fn fetch_gitlab_json<T: for<'de> Deserialize<'de>>(
    host: &str,
    endpoint: &str,
    token: Option<&str>,
) -> ApiResult<T> {
    let client = http_client()?;
    let url = format!("{}{endpoint}", gitlab_api_base(host));
    let mut req = client.get(&url).header("Accept", "application/json");
    if let Some(t) = token {
        if !t.is_empty() {
            req = req.header("PRIVATE-TOKEN", t);
        }
    }
    let res = req
        .send()
        .await
        .map_err(|e| ApiError::new(422, "PROVIDER_API_FAILED", e.to_string()))?;
    if !res.status().is_success() {
        let code = res.status().as_u16();
        return Err(ApiError::new(
            if code == 401 || code == 403 { 401 } else { 422 },
            "PROVIDER_API_FAILED",
            format!("GitLab API request failed ({code})"),
        ));
    }
    res.json::<T>()
        .await
        .map_err(|e| ApiError::new(422, "PROVIDER_PARSE_FAILED", e.to_string()))
}

pub async fn list_ssh_keys(home: &str) -> Vec<SshKeyEntry> {
    let ssh_dir = Path::new(home).join(".ssh");
    let Ok(mut rd) = fs::read_dir(&ssh_dir).await else {
        return Vec::new();
    };

    let loaded_output = Command::new("ssh-add")
        .arg("-L")
        .env("PATH", enriched_path())
        .output()
        .await
        .ok()
        .filter(|o| o.status.success())
        .map(|o| String::from_utf8_lossy(&o.stdout).into_owned())
        .unwrap_or_default();

    let mut pub_names: Vec<String> = Vec::new();
    while let Ok(Some(entry)) = rd.next_entry().await {
        let name = entry.file_name().to_string_lossy().to_string();
        if name.ends_with(".pub") {
            pub_names.push(name);
        }
    }
    pub_names.sort();

    let mut keys: Vec<SshKeyEntry> = Vec::new();
    for pub_name in pub_names {
        let base_name = pub_name.trim_end_matches(".pub").to_string();
        let priv_path = ssh_dir.join(&base_name);
        let pub_path = ssh_dir.join(&pub_name);
        let public_key = fs::read_to_string(&pub_path)
            .await
            .ok()
            .map(|s| s.trim().to_string());
        let key_body = public_key
            .as_deref()
            .and_then(|s| s.split_whitespace().nth(1))
            .unwrap_or("");
        let loaded = !key_body.is_empty() && loaded_output.contains(key_body);
        keys.push(SshKeyEntry {
            name: base_name,
            path: priv_path.to_string_lossy().to_string(),
            public_path: Some(pub_path.to_string_lossy().to_string()),
            public_key,
            loaded,
        });
    }
    keys
}

pub async fn add_ssh_key_to_agent(
    home: &str,
    key_path: &str,
    passphrase: Option<&str>,
) -> ApiResult<(bool, String)> {
    let ssh_dir = Path::new(home).join(".ssh");
    let resolved = Path::new(key_path);
    if !resolved.starts_with(&ssh_dir) {
        return Err(ApiError::new(
            400,
            "INVALID_SSH_KEY_PATH",
            "SSH key must be inside ~/.ssh",
        ));
    }

    let pass_clean = passphrase.map(|s| s.trim()).filter(|s| !s.is_empty());
    if pass_clean.is_none() {
        let from_keychain = Command::new("ssh-add")
            .args(["--apple-load-keychain", key_path])
            .env("PATH", enriched_path())
            .env("SSH_ASKPASS", "/usr/bin/false")
            .env("SSH_ASKPASS_REQUIRE", "force")
            .env("DISPLAY", ":0")
            .output()
            .await
            .ok();
        if from_keychain.as_ref().is_some_and(|o| o.status.success()) {
            return Ok((true, "Loaded SSH key from macOS Keychain".to_string()));
        }

        let unencrypted = Command::new("ssh-add")
            .args(["--apple-use-keychain", key_path])
            .env("PATH", enriched_path())
            .env("SSH_ASKPASS", "/usr/bin/false")
            .env("SSH_ASKPASS_REQUIRE", "force")
            .env("DISPLAY", ":0")
            .output()
            .await
            .ok();
        if unencrypted.as_ref().is_some_and(|o| o.status.success()) {
            return Ok((true, "Added SSH key to ssh-agent".to_string()));
        }

        return Err(ApiError::new(
            422,
            "SSH_PASSPHRASE_REQUIRED",
            "Passphrase required to unlock this SSH key.",
        ));
    }

    let pass = pass_clean.unwrap();
    let askpass_path = std::env::temp_dir().join(format!("gitastic-askpass-{}.sh", Uuid::new_v4()));
    fs::write(
        &askpass_path,
        "#!/bin/sh\nprintf \"%s\\n\" \"$GITASTIC_SSH_PASS\"\n",
    )
    .await
    .map_err(|e| ApiError::new(500, "SSH_ASKPASS_ERROR", e.to_string()))?;
    let _ = fs::set_permissions(&askpass_path, std::fs::Permissions::from_mode(0o700)).await;
    let askpass_str = askpass_path.to_string_lossy().to_string();

    let apple = Command::new("ssh-add")
        .args(["--apple-use-keychain", key_path])
        .env("PATH", enriched_path())
        .env("SSH_ASKPASS", &askpass_str)
        .env("SSH_ASKPASS_REQUIRE", "force")
        .env("DISPLAY", ":0")
        .env("GITASTIC_SSH_PASS", pass)
        .output()
        .await
        .ok();

    if apple.as_ref().is_some_and(|o| o.status.success()) {
        let _ = fs::remove_file(&askpass_path).await;
        return Ok((true, "Unlocked SSH key and saved to Keychain".to_string()));
    }

    let fallback = Command::new("ssh-add")
        .arg(key_path)
        .env("PATH", enriched_path())
        .env("SSH_ASKPASS", &askpass_str)
        .env("SSH_ASKPASS_REQUIRE", "force")
        .env("DISPLAY", ":0")
        .env("GITASTIC_SSH_PASS", pass)
        .output()
        .await;
    let _ = fs::remove_file(&askpass_path).await;

    if let Ok(out) = fallback {
        if out.status.success() {
            return Ok((true, "Unlocked SSH key in ssh-agent".to_string()));
        }
    }

    Err(ApiError::new(
        422,
        "SSH_ADD_FAILED",
        "Invalid passphrase or could not unlock SSH key.",
    ))
}

pub async fn generate_ssh_key(home: &str, label: Option<&str>) -> ApiResult<SshKeyEntry> {
    let ssh_dir = Path::new(home).join(".ssh");
    let _ = fs::create_dir_all(&ssh_dir).await;
    let default_path = ssh_dir.join("id_ed25519");
    let target_path = if fs::metadata(&default_path).await.is_ok() {
        ssh_dir.join("id_ed25519_gitastic")
    } else {
        default_path
    };

    if fs::metadata(&target_path).await.is_err() {
        let comment = label.unwrap_or("gitastic@local");
        let target_str = target_path.to_string_lossy().to_string();
        let out = Command::new("ssh-keygen")
            .args(["-t", "ed25519", "-C", comment, "-f", &target_str, "-N", ""])
            .env("PATH", enriched_path())
            .output()
            .await
            .map_err(|e| ApiError::new(422, "SSH_KEYGEN_FAILED", e.to_string()))?;
        if !out.status.success() {
            return Err(ApiError::new(
                422,
                "SSH_KEYGEN_FAILED",
                String::from_utf8_lossy(&out.stderr).trim().to_string(),
            ));
        }
    }

    let target_str = target_path.to_string_lossy().to_string();
    let _ = add_ssh_key_to_agent(home, &target_str, None).await;
    let keys = list_ssh_keys(home).await;
    keys.into_iter()
        .find(|k| k.path == target_str)
        .ok_or_else(|| ApiError::new(500, "SSH_KEY_NOT_FOUND", "Generated SSH key not found"))
}

pub async fn remove_ssh_key(
    home: &str,
    key_path: &str,
    delete_files: bool,
) -> ApiResult<(bool, String)> {
    let ssh_dir = Path::new(home).join(".ssh");
    let resolved = Path::new(key_path);
    let base = resolved
        .file_name()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_default();
    if !resolved.starts_with(&ssh_dir)
        || base.is_empty()
        || ["config", "known_hosts", "authorized_keys"].contains(&base.as_str())
    {
        return Err(ApiError::new(
            400,
            "INVALID_SSH_KEY_PATH",
            "Invalid SSH key path",
        ));
    }

    let pub_path = format!("{key_path}.pub");
    let _ = Command::new("ssh-add")
        .args(["-d", &pub_path])
        .env("PATH", enriched_path())
        .output()
        .await;
    let _ = Command::new("ssh-add")
        .args(["-d", key_path])
        .env("PATH", enriched_path())
        .output()
        .await;

    if delete_files {
        let _ = fs::remove_file(resolved).await;
        let _ = fs::remove_file(&pub_path).await;
        return Ok((true, format!("Deleted {base} and unloaded from ssh-agent")));
    }

    Ok((true, format!("Unloaded {base} from ssh-agent")))
}

pub async fn get_git_identity(runner: &GitRunner, home: &str) -> (String, String) {
    let name = runner
        .run(home, &["config", "--get", "user.name"], true)
        .await
        .ok()
        .filter(|r| r.exit_code == 0)
        .map(|r| r.stdout.trim().to_string())
        .unwrap_or_default();
    let email = runner
        .run(home, &["config", "--get", "user.email"], true)
        .await
        .ok()
        .filter(|r| r.exit_code == 0)
        .map(|r| r.stdout.trim().to_string())
        .unwrap_or_default();
    (name, email)
}

pub async fn set_git_identity(
    runner: &GitRunner,
    home: &str,
    name: &str,
    email: &str,
) -> ApiResult<(String, String)> {
    let clean_name = name.trim();
    let clean_email = email.trim();
    if clean_name.is_empty() || clean_email.is_empty() {
        return Err(ApiError::new(
            400,
            "INVALID_IDENTITY",
            "Both user.name and user.email are required.",
        ));
    }
    runner
        .run(home, &["config", "--global", "user.name", clean_name], false)
        .await?;
    runner
        .run(home, &["config", "--global", "user.email", clean_email], false)
        .await?;
    Ok((clean_name.to_string(), clean_email.to_string()))
}

pub async fn get_providers_status(
    runner: &GitRunner,
    home: &str,
    extra_hosts: Vec<(String, String)>,
) -> ProvidersStatusResponse {
    let gh_installed = has_command("gh").await;
    let glab_installed = has_command("glab").await;
    let ssh_keys = list_ssh_keys(home).await;
    let cred_res = runner
        .run(home, &["config", "--get", "credential.helper"], true)
        .await
        .ok();
    let credential_helper = cred_res
        .filter(|r| r.exit_code == 0 && !r.stdout.trim().is_empty())
        .map(|r| r.stdout.trim().to_string());

    let mut targets = vec![
        ("github".to_string(), "github.com".to_string()),
        ("gitlab".to_string(), "gitlab.com".to_string()),
    ];
    for (p, h) in extra_hosts {
        if !targets
            .iter()
            .any(|(ep, eh)| ep == &p && eh.eq_ignore_ascii_case(&h))
        {
            targets.push((p, h));
        }
    }

    #[derive(Deserialize)]
    struct GhUser {
        login: String,
    }
    #[derive(Deserialize)]
    struct GlUser {
        username: String,
    }

    let mut accounts: Vec<ProviderAccountStatus> = Vec::new();
    for (provider, host) in targets {
        if provider == "github" {
            if let Some((token, method, mut username)) = get_github_token(runner, home, &host).await
            {
                if username.is_none() {
                    username = fetch_github_json::<GhUser>(&host, "/user", Some(&token))
                        .await
                        .ok()
                        .map(|u| u.login);
                }
                let detail = match &username {
                    Some(u) => format!("Connected as @{u} ({method})"),
                    None => format!("Connected via {method}"),
                };
                accounts.push(ProviderAccountStatus {
                    provider,
                    host,
                    connected: true,
                    username,
                    method,
                    cli_installed: gh_installed,
                    detail,
                });
            } else {
                accounts.push(ProviderAccountStatus {
                    provider,
                    host,
                    connected: false,
                    username: None,
                    method: "none".to_string(),
                    cli_installed: gh_installed,
                    detail: "Not signed in. Connect with a Personal Access Token.".to_string(),
                });
            }
        } else if let Some((token, method, mut username)) =
            get_gitlab_token(runner, home, &host).await
        {
            if username.is_none() && !token.is_empty() {
                username = fetch_gitlab_json::<GlUser>(&host, "/user", Some(&token))
                    .await
                    .ok()
                    .map(|u| u.username);
            }
            let detail = match &username {
                Some(u) => format!("Connected as @{u} ({method})"),
                None => format!("Connected via {method}"),
            };
            accounts.push(ProviderAccountStatus {
                provider,
                host,
                connected: true,
                username,
                method,
                cli_installed: glab_installed,
                detail,
            });
        } else {
            accounts.push(ProviderAccountStatus {
                provider,
                host,
                connected: false,
                username: None,
                method: "none".to_string(),
                cli_installed: glab_installed,
                detail: "Connect with a Personal Access Token (`read_api`, `read_repository`, `write_repository`).".to_string(),
            });
        }
    }

    ProvidersStatusResponse {
        accounts,
        ssh_keys,
        credential_helper,
    }
}

pub async fn connect_provider_account(
    runner: &GitRunner,
    home: &str,
    provider: &str,
    host_opt: Option<&str>,
    username_opt: Option<&str>,
    token: &str,
) -> ApiResult<ProviderAccountStatus> {
    let default_host = if provider == "github" {
        "github.com"
    } else {
        "gitlab.com"
    };
    let host = host_opt
        .unwrap_or(default_host)
        .trim()
        .trim_start_matches("https://")
        .trim_start_matches("http://")
        .trim_end_matches('/')
        .to_string();
    let clean_token = token.trim();

    #[derive(Deserialize)]
    struct GhUser {
        login: String,
    }
    #[derive(Deserialize)]
    struct GlUser {
        username: String,
    }

    if provider == "github" {
        let user = fetch_github_json::<GhUser>(&host, "/user", Some(clean_token)).await?;
        let uname = username_opt
            .filter(|s| !s.trim().is_empty())
            .unwrap_or(&user.login);
        store_git_credential(runner, home, &host, uname, clean_token).await;
        let gh_ok = has_command("gh").await;
        Ok(ProviderAccountStatus {
            provider: "github".to_string(),
            host,
            connected: true,
            username: Some(user.login.clone()),
            method: if gh_ok { "gh-cli" } else { "git-credential" }.to_string(),
            cli_installed: gh_ok,
            detail: format!("Connected as @{}", user.login),
        })
    } else {
        let user = fetch_gitlab_json::<GlUser>(&host, "/user", Some(clean_token)).await?;
        let uname = username_opt
            .filter(|s| !s.trim().is_empty())
            .unwrap_or(&user.username);
        store_git_credential(runner, home, &host, uname, clean_token).await;
        Ok(ProviderAccountStatus {
            provider: "gitlab".to_string(),
            host,
            connected: true,
            username: Some(user.username.clone()),
            method: "git-credential".to_string(),
            cli_installed: has_command("glab").await,
            detail: format!("Connected as @{}", user.username),
        })
    }
}

pub async fn disconnect_provider_account(runner: &GitRunner, home: &str, host: &str) {
    erase_git_credential(runner, home, host.trim()).await;
}

pub async fn list_provider_repos(
    runner: &GitRunner,
    home: &str,
    provider: &str,
    host_opt: Option<&str>,
    query_opt: Option<&str>,
) -> ApiResult<Vec<ProviderRepo>> {
    let default_host = if provider == "github" {
        "github.com"
    } else {
        "gitlab.com"
    };
    let host = host_opt
        .filter(|s| !s.trim().is_empty())
        .unwrap_or(default_host)
        .trim()
        .trim_start_matches("https://")
        .trim_start_matches("http://")
        .trim_end_matches('/')
        .to_string();
    let query = query_opt.unwrap_or("").trim().to_lowercase();

    if provider == "github" {
        let Some((token, _, _)) = get_github_token(runner, home, &host).await else {
            return Err(ApiError::new(
                401,
                "GITHUB_NOT_CONNECTED",
                format!("Not connected to {host}. Sign in via the Auth Assistant first."),
            ));
        };

        #[derive(Deserialize)]
        struct GhRepoRaw {
            id: serde_json::Value,
            name: String,
            full_name: String,
            description: Option<String>,
            r#private: bool,
            default_branch: Option<String>,
            updated_at: Option<String>,
            html_url: String,
            clone_url: String,
            ssh_url: String,
        }

        let raw: Vec<GhRepoRaw> = fetch_github_json(
            &host,
            "/user/repos?per_page=80&sort=updated&affiliation=owner,collaborator,organization_member",
            Some(&token),
        )
        .await?;

        let filtered = raw
            .into_iter()
            .filter(|r| {
                if query.is_empty() {
                    true
                } else {
                    r.full_name.to_lowercase().contains(&query)
                        || r.description
                            .as_deref()
                            .unwrap_or("")
                            .to_lowercase()
                            .contains(&query)
                }
            })
            .take(50)
            .map(|r| ProviderRepo {
                id: r.id.to_string(),
                provider: "github".to_string(),
                host: host.clone(),
                name: r.name,
                full_name: r.full_name,
                description: r.description,
                r#private: r.r#private,
                default_branch: r.default_branch,
                updated_at: r.updated_at,
                web_url: r.html_url,
                clone_url: r.clone_url,
                ssh_url: r.ssh_url,
            })
            .collect();

        return Ok(filtered);
    }

    let Some((token, _, _)) = get_gitlab_token(runner, home, &host).await else {
        return Err(ApiError::new(
            401,
            "GITLAB_NOT_CONNECTED",
            format!("Not connected to {host}. Connect with a GitLab Personal Access Token first."),
        ));
    };

    #[derive(Deserialize)]
    struct GlProjectRaw {
        id: serde_json::Value,
        name: String,
        path_with_namespace: String,
        description: Option<String>,
        visibility: Option<String>,
        default_branch: Option<String>,
        last_activity_at: Option<String>,
        web_url: String,
        http_url_to_repo: String,
        ssh_url_to_repo: String,
    }

    let search_param = if query.is_empty() {
        String::new()
    } else {
        format!("&search={}", urlencoding::encode(&query))
    };
    let endpoint = format!(
        "/projects?membership=true&order_by=last_activity_at&per_page=50{search_param}"
    );
    let raw: Vec<GlProjectRaw> = fetch_gitlab_json(&host, &endpoint, Some(&token)).await?;

    Ok(raw
        .into_iter()
        .map(|p| ProviderRepo {
            id: p.id.to_string(),
            provider: "gitlab".to_string(),
            host: host.clone(),
            name: p.name,
            full_name: p.path_with_namespace,
            description: p.description,
            r#private: p.visibility.as_deref() != Some("public"),
            default_branch: p.default_branch,
            updated_at: p.last_activity_at,
            web_url: p.web_url,
            clone_url: p.http_url_to_repo,
            ssh_url: p.ssh_url_to_repo,
        })
        .collect())
}

pub async fn list_repo_pull_requests(
    runner: &GitRunner,
    home: &str,
    repo_path: &str,
) -> ApiResult<PullRequestsResponse> {
    let remotes = list_remotes(runner, repo_path).await?;
    let Some(remote) = select_primary_remote_info(&remotes) else {
        return Ok(PullRequestsResponse {
            remote: None,
            items: Vec::new(),
            auth_hint: None,
        });
    };

    if remote.provider == "github" {
        let token = get_github_token(runner, home, &remote.host)
            .await
            .map(|(t, _, _)| t);

        #[derive(Deserialize)]
        struct GhUser {
            login: Option<String>,
        }
        #[derive(Deserialize)]
        struct GhRef {
            r#ref: Option<String>,
        }
        #[derive(Deserialize)]
        struct GhPull {
            id: serde_json::Value,
            number: i64,
            title: String,
            draft: Option<bool>,
            user: Option<GhUser>,
            head: Option<GhRef>,
            base: Option<GhRef>,
            updated_at: String,
            html_url: String,
        }

        let endpoint = format!(
            "/repos/{}/{}/pulls?state=open&per_page=40",
            remote.owner, remote.repo
        );
        match fetch_github_json::<Vec<GhPull>>(&remote.host, &endpoint, token.as_deref()).await {
            Ok(pulls) => {
                let items = pulls
                    .into_iter()
                    .map(|pr| PullRequestItem {
                        id: pr.id.to_string(),
                        number: pr.number,
                        provider: "github".to_string(),
                        title: pr.title,
                        state: "open".to_string(),
                        draft: pr.draft.unwrap_or(false),
                        author: pr
                            .user
                            .and_then(|u| u.login)
                            .unwrap_or_else(|| "unknown".to_string()),
                        source_branch: pr
                            .head
                            .and_then(|h| h.r#ref)
                            .unwrap_or_else(|| format!("pr-{}", pr.number)),
                        target_branch: pr
                            .base
                            .and_then(|b| b.r#ref)
                            .unwrap_or_else(|| "main".to_string()),
                        updated_at: pr.updated_at,
                        web_url: pr.html_url,
                    })
                    .collect();
                return Ok(PullRequestsResponse {
                    remote: Some(remote),
                    items,
                    auth_hint: None,
                });
            }
            Err(err) => {
                return Ok(PullRequestsResponse {
                    auth_hint: Some(if err.status == 401 {
                        format!(
                            "Connect {} in the Auth Assistant to load private Pull Requests.",
                            remote.host
                        )
                    } else {
                        err.message
                    }),
                    remote: Some(remote),
                    items: Vec::new(),
                });
            }
        }
    }

    let token = get_gitlab_token(runner, home, &remote.host)
        .await
        .map(|(t, _, _)| t);

    #[derive(Deserialize)]
    struct GlAuthor {
        username: Option<String>,
    }
    #[derive(Deserialize)]
    struct GlMr {
        id: serde_json::Value,
        iid: i64,
        title: String,
        draft: Option<bool>,
        work_in_progress: Option<bool>,
        author: Option<GlAuthor>,
        source_branch: String,
        target_branch: String,
        updated_at: String,
        web_url: String,
    }

    let encoded_project = urlencoding::encode(&remote.full_name);
    let endpoint = format!("/projects/{encoded_project}/merge_requests?state=opened&per_page=40");
    match fetch_gitlab_json::<Vec<GlMr>>(&remote.host, &endpoint, token.as_deref()).await {
        Ok(mrs) => {
            let items = mrs
                .into_iter()
                .map(|mr| PullRequestItem {
                    id: mr.id.to_string(),
                    number: mr.iid,
                    provider: "gitlab".to_string(),
                    title: mr.title,
                    state: "open".to_string(),
                    draft: mr.draft.unwrap_or(false) || mr.work_in_progress.unwrap_or(false),
                    author: mr
                        .author
                        .and_then(|a| a.username)
                        .unwrap_or_else(|| "unknown".to_string()),
                    source_branch: mr.source_branch,
                    target_branch: mr.target_branch,
                    updated_at: mr.updated_at,
                    web_url: mr.web_url,
                })
                .collect();
            Ok(PullRequestsResponse {
                remote: Some(remote),
                items,
                auth_hint: None,
            })
        }
        Err(err) => Ok(PullRequestsResponse {
            auth_hint: Some(if err.status == 401 {
                format!(
                    "Connect {} in the Auth Assistant to load Merge Requests.",
                    remote.host
                )
            } else {
                err.message
            }),
            remote: Some(remote),
            items: Vec::new(),
        }),
    }
}

pub async fn checkout_pull_request(
    runner: &GitRunner,
    repo_path: &str,
    number: i64,
    source_branch: &str,
    remote_opt: Option<&str>,
) -> ApiResult<()> {
    let remotes = list_remotes(runner, repo_path).await?;
    let remote_info = select_primary_remote_info(&remotes);
    let remote_name = remote_opt
        .filter(|s| !s.is_empty())
        .or_else(|| remote_info.as_ref().map(|r| r.remote_name.as_str()))
        .unwrap_or("origin");

    let fetch_branch = runner
        .run(repo_path, &["fetch", remote_name, source_branch], true)
        .await?;
    if fetch_branch.exit_code == 0 {
        checkout(runner, repo_path, &format!("{remote_name}/{source_branch}")).await?;
        return Ok(());
    }

    let is_gitlab = remote_info
        .as_ref()
        .is_some_and(|r| r.provider == "gitlab");
    let ref_spec = if is_gitlab {
        format!("merge-requests/{number}/head:mr-{number}")
    } else {
        format!("pull/{number}/head:pr-{number}")
    };
    let local_branch = if is_gitlab {
        format!("mr-{number}")
    } else {
        format!("pr-{number}")
    };

    runner
        .run(repo_path, &["fetch", remote_name, &ref_spec], false)
        .await?;
    checkout(runner, repo_path, &local_branch).await?;
    Ok(())
}
