#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod error;
mod history;
mod models;
mod ops;
mod parse;
mod providers;
mod runner;
mod themes;

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::{Command as ProcessCommand, Stdio};
use std::sync::Arc;
use chrono::Utc;
use serde_json::{json, Value};
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::fs;
use tokio::sync::Mutex;
use uuid::Uuid;

use crate::error::{ApiError, ApiResult};
use crate::history::{get_blame, get_file_history, get_history_page, HistoryCache};
use crate::models::{
    AppConfig, Job, RecentRepo, RepoSummary, Session, UndoEntry, MIN_GIT_VERSION,
};
use crate::ops::{
    apply_patch, assert_repo_file, assert_repo_path, checkout, commit, create_backup_ref,
    get_commit_detail, get_conflicts, get_diff, get_onboarding_report, get_repo_summary,
    get_status, list_branches, list_directories, list_remotes, list_stashes, list_tags,
    list_worktrees, preview_clean, realpath_loose, repo_id_for_path, resolve_binary_conflict,
    resolve_conflict_file, resolve_user_path, restore_files, restore_trash, save_branch_to_trash,
    stage, trash_paths, unstage,
};
use crate::providers::{
    add_ssh_key_to_agent, approve_pull_request, checkout_pull_request, connect_provider_account,
    create_pull_request, create_pull_request_comment, disconnect_provider_account, generate_ssh_key,
    get_git_identity, get_providers_status, get_pull_request_detail, list_provider_repos,
    list_repo_pull_requests, remove_ssh_key, select_primary_remote_info, set_git_identity,
};
use crate::runner::{GitResult, GitRunner};

fn home_directory() -> PathBuf {
    for key in ["GITASTIC_HOME", "HOME", "USERPROFILE"] {
        if let Ok(value) = std::env::var(key) {
            let trimmed = value.trim();
            if !trimmed.is_empty() {
                return PathBuf::from(trimmed);
            }
        }
    }
    std::env::temp_dir()
}

fn config_directory(home: &Path) -> PathBuf {
    #[cfg(windows)]
    {
        if let Some(app_data) = std::env::var_os("APPDATA") {
            return PathBuf::from(app_data).join("gitastic");
        }
        return home.join("AppData").join("Roaming").join("gitastic");
    }
    #[cfg(not(windows))]
    {
        home.join(".config").join("gitastic")
    }
}

fn data_directory(home: &Path) -> PathBuf {
    #[cfg(windows)]
    {
        if let Some(local_app_data) = std::env::var_os("LOCALAPPDATA") {
            return PathBuf::from(local_app_data).join("gitastic");
        }
        return home.join("AppData").join("Local").join("gitastic");
    }
    #[cfg(not(windows))]
    {
        home.join(".local").join("share").join("gitastic")
    }
}

fn spawn_detached(program: &str, args: &[&str]) -> bool {
    ProcessCommand::new(program)
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .is_ok()
}

#[cfg(target_os = "macos")]
fn open_external(target: &str) -> bool {
    spawn_detached("open", &[target])
}

#[cfg(target_os = "windows")]
fn open_external(target: &str) -> bool {
    spawn_detached("rundll32", &["url.dll,FileProtocolHandler", target])
}

#[cfg(all(unix, not(target_os = "macos")))]
fn open_external(target: &str) -> bool {
    spawn_detached("xdg-open", &[target])
}

#[cfg(target_os = "macos")]
fn reveal_path(target: &str) -> bool {
    spawn_detached("open", &["-R", target])
}

#[cfg(target_os = "windows")]
fn reveal_path(target: &str) -> bool {
    let select = format!("/select,{target}");
    spawn_detached("explorer", &[&select])
}

#[cfg(all(unix, not(target_os = "macos")))]
fn reveal_path(target: &str) -> bool {
    match Path::new(target).parent() {
        Some(parent) => spawn_detached("xdg-open", &[&parent.to_string_lossy()]),
        None => false,
    }
}

#[cfg(target_os = "macos")]
fn open_terminal(repo: &str) -> bool {
    spawn_detached("open", &["-a", "Terminal", repo])
}

#[cfg(target_os = "windows")]
fn open_terminal(repo: &str) -> bool {
    ProcessCommand::new("cmd")
        .current_dir(repo)
        .args(["/C", "start", "cmd"])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .is_ok()
}

#[cfg(all(unix, not(target_os = "macos")))]
fn open_terminal(repo: &str) -> bool {
    ProcessCommand::new("x-terminal-emulator")
        .current_dir(repo)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .is_ok()
}

#[cfg(target_os = "macos")]
fn open_in_editor(target: &str) -> bool {
    for bin in [
        "/opt/homebrew/bin/cursor",
        "/usr/local/bin/cursor",
        "/opt/homebrew/bin/zed",
        "/usr/local/bin/zed",
        "/opt/homebrew/bin/code",
        "/usr/local/bin/code",
    ] {
        if Path::new(bin).exists() && spawn_detached(bin, &[target]) {
            return true;
        }
    }
    open_external(target)
}

#[cfg(target_os = "windows")]
fn open_in_editor(target: &str) -> bool {
    for bin in ["cursor", "code", "zed"] {
        let output = ProcessCommand::new("where")
            .arg(bin)
            .stdin(Stdio::null())
            .stderr(Stdio::null())
            .output()
            .ok();
        let Some(output) = output.filter(|out| out.status.success()) else {
            continue;
        };
        let stdout = String::from_utf8_lossy(&output.stdout);
        let Some(bin_path) = stdout
            .lines()
            .map(str::trim)
            .find(|line| !line.is_empty())
        else {
            continue;
        };
        let command = format!("start \"\" \"{bin_path}\" \"{target}\"");
        if spawn_detached("cmd", &["/C", &command]) {
            return true;
        }
    }
    open_external(target)
}

#[cfg(all(unix, not(target_os = "macos")))]
fn open_in_editor(target: &str) -> bool {
    for bin in ["cursor", "zed", "code"] {
        if spawn_detached(bin, &[target]) {
            return true;
        }
    }
    open_external(target)
}

pub struct InnerState {
    pub config: AppConfig,
    pub runner: GitRunner,
    pub current_repo_id: Option<String>,
    pub repos: HashMap<String, String>,
    pub history_caches: HashMap<String, HistoryCache>,
    pub undo_entries: HashMap<String, Vec<UndoEntry>>,
    pub jobs: HashMap<String, Job>,
}

pub struct AppState {
    pub home_dir: String,
    pub config_path: PathBuf,
    pub data_dir: PathBuf,
    pub inner: Mutex<InnerState>,
}

impl AppState {
    pub async fn init() -> Self {
        let home_path = home_directory();
        let home_dir = home_path.to_string_lossy().to_string();
        let config_dir = std::env::var("GITASTIC_CONFIG_DIR")
            .map(PathBuf::from)
            .unwrap_or_else(|_| config_directory(&home_path));
        let data_dir = std::env::var("GITASTIC_DATA_DIR")
            .map(PathBuf::from)
            .unwrap_or_else(|_| data_directory(&home_path));

        let _ = fs::create_dir_all(&config_dir).await;
        let _ = fs::create_dir_all(data_dir.join("trash")).await;
        let _ = fs::create_dir_all(data_dir.join("themes")).await;
        let config_path = config_dir.join("config.json");

        let default_config = AppConfig {
            theme: "dark".to_string(),
            ui_style: "gorgeous".to_string(),
            git_path: "git".to_string(),
            editor: String::new(),
            pull_strategy: "ff-only".to_string(),
            diff_context: 3,
            confirm_destructive: true,
            #[cfg(windows)]
            repo_roots: vec![home_dir.clone()],
            #[cfg(not(windows))]
            repo_roots: vec!["/".to_string()],
            recent_repos: Vec::new(),
        };

        let config = if let Ok(raw) = fs::read_to_string(&config_path).await {
            serde_json::from_str::<AppConfig>(&raw).unwrap_or(default_config)
        } else {
            default_config
        };

        let mut repos = HashMap::new();
        for recent in &config.recent_repos {
            repos.insert(recent.id.clone(), recent.path.clone());
        }
        let current_repo_id = None;

        let runner = GitRunner::new(&config.git_path);
        Self {
            home_dir,
            config_path,
            data_dir,
            inner: Mutex::new(InnerState {
                config,
                runner,
                current_repo_id,
                repos,
                history_caches: HashMap::new(),
                undo_entries: HashMap::new(),
                jobs: HashMap::new(),
            }),
        }
    }

    pub async fn save_config(&self, config: &AppConfig) {
        if let Ok(json_str) = serde_json::to_string_pretty(config) {
            let _ = fs::write(&self.config_path, format!("{json_str}\n")).await;
        }
    }

    pub async fn current_repo(&self) -> ApiResult<(String, String, GitRunner, u32, bool)> {
        let guard = self.inner.lock().await;
        let id = guard
            .current_repo_id
            .clone()
            .ok_or_else(|| ApiError::new(400, "NO_REPO", "No repository is open."))?;
        let path = guard
            .repos
            .get(&id)
            .cloned()
            .ok_or_else(|| ApiError::new(404, "REPO_NOT_OPEN", "Repository is not open."))?;
        Ok((
            id,
            path,
            guard.runner.clone(),
            guard.config.diff_context,
            guard.config.confirm_destructive,
        ))
    }

    pub async fn invalidate(&self, repo_id: &str) {
        let mut guard = self.inner.lock().await;
        guard.history_caches.remove(repo_id);
        let _ = fs::remove_file(self.data_dir.join("cache").join(format!("{repo_id}.json"))).await;
    }

    pub async fn clear_cache(&self) {
        let mut guard = self.inner.lock().await;
        guard.history_caches.clear();
        let _ = fs::remove_dir_all(self.data_dir.join("cache")).await;
    }

    pub async fn push_undo(
        &self,
        repo_id: &str,
        kind: &str,
        label: &str,
        payload: Value,
    ) -> UndoEntry {
        let entry = UndoEntry {
            id: Uuid::new_v4().to_string(),
            repo_id: repo_id.to_string(),
            kind: kind.to_string(),
            label: label.to_string(),
            created_at: Utc::now().to_rfc3339(),
            payload,
        };
        let mut guard = self.inner.lock().await;
        let list = guard.undo_entries.entry(repo_id.to_string()).or_default();
        list.push(entry.clone());
        if list.len() > 20 {
            list.remove(0);
        }
        entry
    }

    pub async fn open_repo_internal(&self, input: &str) -> ApiResult<RepoSummary> {
        let repo_path = assert_repo_path(input, &self.home_dir).await?;
        let id = repo_id_for_path(&repo_path);
        let name = std::path::Path::new(&repo_path)
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_else(|| repo_path.clone());

        let (runner, cfg) = {
            let mut guard = self.inner.lock().await;
            guard.repos.insert(id.clone(), repo_path.clone());
            guard.current_repo_id = Some(id.clone());

            let recent = RecentRepo {
                id: id.clone(),
                name,
                path: repo_path.clone(),
                last_opened: Utc::now().to_rfc3339(),
            };
            guard.config.recent_repos.retain(|r| r.path != repo_path);
            guard.config.recent_repos.insert(0, recent);
            guard.config.recent_repos.truncate(20);
            (guard.runner.clone(), guard.config.clone())
        };

        self.save_config(&cfg).await;
        get_repo_summary(&runner, &repo_path, &id).await
    }
}

fn q_str(query: &Option<Value>, key: &str) -> Option<String> {
    query
        .as_ref()
        .and_then(|q| q.get(key))
        .and_then(|v| match v {
            Value::String(s) if !s.is_empty() => Some(s.clone()),
            Value::Number(n) => Some(n.to_string()),
            Value::Bool(b) => Some(b.to_string()),
            _ => None,
        })
}

fn q_usize(query: &Option<Value>, key: &str, fallback: usize) -> usize {
    q_str(query, key)
        .and_then(|s| s.parse::<usize>().ok())
        .unwrap_or(fallback)
}

fn b_str(body: &Option<Value>, key: &str) -> Option<String> {
    body.as_ref()
        .and_then(|b| b.get(key))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
}

fn b_bool(body: &Option<Value>, key: &str) -> bool {
    body.as_ref()
        .and_then(|b| b.get(key))
        .and_then(|v| v.as_bool())
        .unwrap_or(false)
}

fn b_str_vec(body: &Option<Value>, key: &str) -> Vec<String> {
    body.as_ref()
        .and_then(|b| b.get(key))
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|x| x.as_str().map(|s| s.to_string()))
                .collect()
        })
        .unwrap_or_default()
}

async fn start_background_job<F, Fut>(
    app: AppHandle,
    state: Arc<AppState>,
    job_type: &str,
    repo_id: Option<String>,
    task: F,
) -> Job
where
    F: FnOnce(Arc<AppState>) -> Fut + Send + 'static,
    Fut: std::future::Future<Output = ApiResult<(String, Value)>> + Send + 'static,
{
    let id = Uuid::new_v4().to_string();
    let job = Job {
        id: id.clone(),
        r#type: job_type.to_string(),
        repo_id,
        status: "running".to_string(),
        progress: Some(0.25),
        message: format!("Running {job_type}..."),
        output: Vec::new(),
        error: None,
        created_at: Utc::now().to_rfc3339(),
        finished_at: None,
        result: None,
    };

    {
        let mut guard = state.inner.lock().await;
        guard.jobs.insert(id.clone(), job.clone());
    }
    let _ = app.emit("gitastic-job", &job);

    let state_clone = state.clone();
    let id_clone = id.clone();
    let job_type_owned = job_type.to_string();
    tokio::spawn(async move {
        let outcome = task(state_clone.clone()).await;
        let final_job = {
            let mut guard = state_clone.inner.lock().await;
            let entry = guard.jobs.entry(id_clone.clone()).or_insert(job);
            entry.finished_at = Some(Utc::now().to_rfc3339());
            entry.progress = Some(1.0);
            match outcome {
                Ok((out_txt, res_val)) => {
                    entry.status = "done".to_string();
                    entry.message = format!("{job_type_owned} completed");
                    if !out_txt.trim().is_empty() {
                        entry.output = out_txt.lines().map(|s| s.to_string()).collect();
                    }
                    entry.result = Some(res_val);
                }
                Err(err) => {
                    entry.status = "error".to_string();
                    entry.message = err.message.clone();
                    entry.error = Some(err.message);
                }
            }
            entry.clone()
        };
        let _ = app.emit("gitastic-job", &final_job);
    });

    let guard = state.inner.lock().await;
    guard.jobs.get(&id).cloned().unwrap()
}

async fn dispatch(
    app: AppHandle,
    state: Arc<AppState>,
    method: &str,
    path: &str,
    query: Option<Value>,
    body: Option<Value>,
) -> ApiResult<Value> {
    match (method, path) {
        ("GET", "/health") => {
            let runner = state.inner.lock().await.runner.clone();
            Ok(json!({
                "ok": true,
                "version": "1.0.0",
                "gitVersion": runner.version().await,
                "minGitVersion": MIN_GIT_VERSION,
            }))
        }

        ("GET", "/session") => {
            let (runner, cfg, current) = {
                let guard = state.inner.lock().await;
                let cur = guard
                    .current_repo_id
                    .as_ref()
                    .and_then(|id| guard.repos.get(id).map(|p| (id.clone(), p.clone())));
                (guard.runner.clone(), guard.config.clone(), cur)
            };
            let repo = match current {
                Some((id, rp)) => get_repo_summary(&runner, &rp, &id).await.ok(),
                None => None,
            };
            let onboarding = get_onboarding_report(&runner, &state.home_dir).await;
            Ok(serde_json::to_value(Session {
                repo,
                config: cfg,
                onboarding,
            })
            .unwrap())
        }

        ("GET", "/onboarding") => {
            let runner = state.inner.lock().await.runner.clone();
            let report = get_onboarding_report(&runner, &state.home_dir).await;
            Ok(serde_json::to_value(report).unwrap())
        }

        ("GET", "/settings") => {
            let cfg = state.inner.lock().await.config.clone();
            Ok(serde_json::to_value(cfg).unwrap())
        }

        ("PUT", "/settings") => {
            let cfg = {
                let mut guard = state.inner.lock().await;
                if let Some(t) = b_str(&body, "theme") {
                    guard.config.theme = t;
                }
                if let Some(us) = b_str(&body, "uiStyle") {
                    guard.config.ui_style = us;
                }
                if let Some(gp) = b_str(&body, "gitPath") {
                    guard.config.git_path = gp.clone();
                    guard.runner.git_path = gp;
                }
                if let Some(ed) = b_str(&body, "editor") {
                    guard.config.editor = ed;
                }
                if let Some(ps) = b_str(&body, "pullStrategy") {
                    guard.config.pull_strategy = ps;
                }
                if let Some(dc) = body
                    .as_ref()
                    .and_then(|b| b.get("diffContext"))
                    .and_then(|v| v.as_u64())
                {
                    guard.config.diff_context = dc as u32;
                }
                if let Some(cd) = body
                    .as_ref()
                    .and_then(|b| b.get("confirmDestructive"))
                    .and_then(|v| v.as_bool())
                {
                    guard.config.confirm_destructive = cd;
                }
                guard.config.clone()
            };
            state.save_config(&cfg).await;
            Ok(serde_json::to_value(cfg).unwrap())
        }

        ("POST", "/cache/clear") => {
            state.clear_cache().await;
            Ok(json!({ "ok": true }))
        }

        ("GET", "/themes") => {
            let themes = themes::list_themes(&state.data_dir).await?;
            Ok(json!({ "themes": themes }))
        }

        ("GET", "/themes/community") => {
            let themes = themes::list_community_themes(&state.data_dir).await?;
            Ok(json!({ "themes": themes }))
        }

        ("POST", path) if path.starts_with("/themes/community/") && path.ends_with("/install") => {
            let id = path
                .trim_start_matches("/themes/community/")
                .trim_end_matches("/install")
                .trim_end_matches('/');
            let theme = themes::install_community_theme(&state.data_dir, id).await?;
            Ok(serde_json::to_value(theme).unwrap())
        }

        ("POST", "/themes") => {
            let css = b_str(&body, "css").ok_or_else(|| {
                ApiError::new(400, "MISSING_THEME_CSS", "Theme CSS is required.")
            })?;
            let manifest = themes::import_theme(&state.data_dir, &css).await?;
            Ok(serde_json::to_value(manifest).unwrap())
        }

        ("GET", path) if path.starts_with("/themes/") && path.ends_with("/css") => {
            let id = path
                .trim_start_matches("/themes/")
                .trim_end_matches("/css")
                .trim_end_matches('/');
            let css = themes::read_theme_css(&state.data_dir, id)
                .await?
                .ok_or_else(|| ApiError::new(404, "THEME_NOT_FOUND", format!("Unknown theme: {id}")))?;
            Ok(Value::String(css))
        }

        ("DELETE", path) if path.starts_with("/themes/") => {
            let id = path.trim_start_matches("/themes/");
            if id.contains('/') {
                return Err(ApiError::new(400, "INVALID_THEME_ID", "Invalid theme id."));
            }
            if !themes::delete_theme(&state.data_dir, id).await? {
                return Err(ApiError::new(
                    404,
                    "THEME_NOT_FOUND",
                    format!("Unknown theme: {id}"),
                ));
            }
            Ok(json!({ "ok": true }))
        }

        ("POST", "/system/open-url") => {
            let url = b_str(&body, "url")
                .ok_or_else(|| ApiError::new(400, "MISSING_URL", "URL is required"))?;
            if !url.starts_with("https://") && !url.starts_with("http://") {
                return Err(ApiError::new(400, "INVALID_URL", "Only http/https URLs are allowed"));
            }
            let _ = open_external(&url);
            Ok(json!({ "ok": true }))
        }

        ("GET", "/fs/list") => {
            let target = q_str(&query, "path");
            let listing = list_directories(target.as_deref(), &state.home_dir).await?;
            Ok(serde_json::to_value(listing).unwrap())
        }

        ("GET", "/repos/recent") => {
            let recents = state.inner.lock().await.config.recent_repos.clone();
            Ok(serde_json::to_value(recents).unwrap())
        }

        ("POST", "/repos/open") => {
            let target = b_str(&body, "path")
                .ok_or_else(|| ApiError::new(400, "MISSING_PATH", "Path is required"))?;
            let summary = state.open_repo_internal(&target).await?;
            Ok(serde_json::to_value(summary).unwrap())
        }

        ("POST", "/repos/close") => {
            state.inner.lock().await.current_repo_id = None;
            Ok(json!({ "ok": true }))
        }

        ("POST", "/repos/clone") => {
            let url = b_str(&body, "url")
                .ok_or_else(|| ApiError::new(400, "MISSING_URL", "Clone URL is required"))?;
            let raw_target = b_str(&body, "path")
                .ok_or_else(|| ApiError::new(400, "MISSING_PATH", "Target path is required"))?;
            let target = realpath_loose(&resolve_user_path(&raw_target, &state.home_dir)).await;
            if fs::metadata(&target).await.is_ok() {
                return Err(ApiError::new(
                    400,
                    "TARGET_EXISTS",
                    format!("Target already exists: {}", target.display()),
                ));
            }
            let target_str = target.to_string_lossy().to_string();
            let parent_dir = target
                .parent()
                .map(|p| p.to_string_lossy().to_string())
                .unwrap_or_else(|| state.home_dir.clone());

            let job = start_background_job(app, state, "clone", None, move |st| async move {
                let runner = st.inner.lock().await.runner.clone();
                let res = runner
                    .run(&parent_dir, &["clone", "--progress", &url, &target_str], false)
                    .await?;
                let summary = st.open_repo_internal(&target_str).await?;
                Ok((
                    format!("{}\n{}", res.stdout, res.stderr),
                    serde_json::to_value(summary).unwrap_or(Value::Null),
                ))
            })
            .await;
            Ok(json!({ "job": job }))
        }

        ("GET", "/providers/status") => {
            let (runner, current_path) = {
                let guard = state.inner.lock().await;
                let cp = guard
                    .current_repo_id
                    .as_ref()
                    .and_then(|id| guard.repos.get(id).cloned());
                (guard.runner.clone(), cp)
            };
            let mut extra = Vec::new();
            if let Some(rp) = current_path {
                if let Ok(remotes) = list_remotes(&runner, &rp).await {
                    if let Some(info) = select_primary_remote_info(&remotes) {
                        extra.push((info.provider, info.host));
                    }
                }
            }
            let status = get_providers_status(&runner, &state.home_dir, extra).await;
            Ok(serde_json::to_value(status).unwrap())
        }

        ("POST", "/providers/connect") => {
            let provider = b_str(&body, "provider").unwrap_or_else(|| "github".to_string());
            let host = b_str(&body, "host");
            let username = b_str(&body, "username");
            let token = b_str(&body, "token")
                .ok_or_else(|| ApiError::new(400, "MISSING_TOKEN", "Token is required"))?;
            let runner = state.inner.lock().await.runner.clone();
            let acc = connect_provider_account(
                &runner,
                &state.home_dir,
                &provider,
                host.as_deref(),
                username.as_deref(),
                &token,
            )
            .await?;
            Ok(serde_json::to_value(acc).unwrap())
        }

        ("POST", "/providers/disconnect") => {
            let host = b_str(&body, "host").unwrap_or_else(|| "github.com".to_string());
            let runner = state.inner.lock().await.runner.clone();
            disconnect_provider_account(&runner, &state.home_dir, &host).await;
            Ok(json!({ "ok": true }))
        }

        ("GET", "/providers/repos") => {
            let provider = q_str(&query, "provider").unwrap_or_else(|| "github".to_string());
            let host = q_str(&query, "host");
            let q = q_str(&query, "q");
            let runner = state.inner.lock().await.runner.clone();
            let repos = list_provider_repos(
                &runner,
                &state.home_dir,
                &provider,
                host.as_deref(),
                q.as_deref(),
            )
            .await?;
            Ok(serde_json::to_value(repos).unwrap())
        }

        ("POST", "/providers/ssh/add") => {
            let key_path = b_str(&body, "path")
                .ok_or_else(|| ApiError::new(400, "MISSING_PATH", "Key path is required"))?;
            let passphrase = b_str(&body, "passphrase");
            let (ok, detail) =
                add_ssh_key_to_agent(&state.home_dir, &key_path, passphrase.as_deref()).await?;
            Ok(json!({ "ok": ok, "detail": detail }))
        }

        ("POST", "/providers/ssh/generate") => {
            let label = b_str(&body, "label");
            let key = generate_ssh_key(&state.home_dir, label.as_deref()).await?;
            Ok(serde_json::to_value(key).unwrap())
        }

        ("POST", "/providers/ssh/remove") => {
            let key_path = b_str(&body, "path")
                .ok_or_else(|| ApiError::new(400, "MISSING_PATH", "Key path is required"))?;
            let delete_files = b_bool(&body, "deleteFiles");
            let (ok, detail) = remove_ssh_key(&state.home_dir, &key_path, delete_files).await?;
            Ok(json!({ "ok": ok, "detail": detail }))
        }

        ("GET", "/git-identity") => {
            let runner = state.inner.lock().await.runner.clone();
            let (name, email) = get_git_identity(&runner, &state.home_dir).await;
            Ok(json!({ "name": name, "email": email }))
        }

        ("PUT", "/git-identity") => {
            let name = b_str(&body, "name").unwrap_or_default();
            let email = b_str(&body, "email").unwrap_or_default();
            let runner = state.inner.lock().await.runner.clone();
            let (saved_name, saved_email) =
                set_git_identity(&runner, &state.home_dir, &name, &email).await?;
            Ok(json!({ "name": saved_name, "email": saved_email }))
        }

        ("GET", "/repo") => {
            let (id, rp, runner, _, _) = state.current_repo().await?;
            let summary = get_repo_summary(&runner, &rp, &id).await?;
            Ok(serde_json::to_value(summary).unwrap())
        }

        ("GET", "/repo/status") => {
            let (_, rp, runner, _, _) = state.current_repo().await?;
            let status = get_status(&runner, &rp).await?;
            Ok(serde_json::to_value(status).unwrap())
        }

        ("GET", "/repo/history") => {
            let (id, rp, runner, _, _) = state.current_repo().await?;
            let offset = q_usize(&query, "offset", 0);
            let limit = q_usize(&query, "limit", 100).clamp(1, 500);
            let ref_filter = q_str(&query, "ref");
            let q = q_str(&query, "q");

            let mut cache = {
                let guard = state.inner.lock().await;
                guard.history_caches.get(&id).cloned().unwrap_or_default()
            };
            let page = get_history_page(
                &runner,
                &rp,
                &state.data_dir,
                &mut cache,
                offset,
                limit,
                ref_filter,
                q,
            )
            .await?;
            {
                let mut guard = state.inner.lock().await;
                guard.history_caches.insert(id, cache);
            }
            Ok(serde_json::to_value(page).unwrap())
        }

        ("GET", "/repo/diff") => {
            let (_, rp, runner, default_ctx, _) = state.current_repo().await?;
            let staged = q_str(&query, "staged").as_deref() == Some("true");
            let file_path = q_str(&query, "path");
            let ctx = q_str(&query, "context")
                .and_then(|s| s.parse::<u32>().ok())
                .unwrap_or(default_ctx);
            let status = get_status(&runner, &rp).await?;
            let untracked = file_path
                .as_ref()
                .and_then(|p| status.files.iter().find(|f| &f.path == p))
                .is_some_and(|f| f.untracked);
            let diff = get_diff(&runner, &rp, staged, file_path, ctx, untracked).await?;
            Ok(serde_json::to_value(diff).unwrap())
        }

        ("GET", "/repo/branches") => {
            let (_, rp, runner, _, _) = state.current_repo().await?;
            let branches = list_branches(&runner, &rp).await?;
            Ok(serde_json::to_value(branches).unwrap())
        }

        ("GET", "/repo/tags") => {
            let (_, rp, runner, _, _) = state.current_repo().await?;
            let tags = list_tags(&runner, &rp).await?;
            Ok(serde_json::to_value(tags).unwrap())
        }

        ("GET", "/repo/remotes") => {
            let (_, rp, runner, _, _) = state.current_repo().await?;
            let remotes = list_remotes(&runner, &rp).await?;
            Ok(serde_json::to_value(remotes).unwrap())
        }

        ("GET", "/repo/provider") => {
            let (_, rp, runner, _, _) = state.current_repo().await?;
            let remotes = list_remotes(&runner, &rp).await?;
            let remote = select_primary_remote_info(&remotes);
            Ok(json!({ "remote": remote }))
        }

        ("GET", "/repo/pulls") => {
            let (_, rp, runner, _, _) = state.current_repo().await?;
            let pulls = list_repo_pull_requests(&runner, &state.home_dir, &rp).await?;
            Ok(serde_json::to_value(pulls).unwrap())
        }

        ("POST", "/repo/pulls/checkout") => {
            let (id, rp, runner, _, _) = state.current_repo().await?;
            let number = body
                .as_ref()
                .and_then(|b| b.get("number"))
                .and_then(|v| v.as_i64())
                .ok_or_else(|| ApiError::new(400, "INVALID_NUMBER", "PR number is required"))?;
            let source_branch = b_str(&body, "sourceBranch")
                .ok_or_else(|| ApiError::new(400, "MISSING_BRANCH", "sourceBranch is required"))?;
            let remote = b_str(&body, "remote");
            checkout_pull_request(&runner, &rp, number, &source_branch, remote.as_deref()).await?;
            state.invalidate(&id).await;
            let summary = get_repo_summary(&runner, &rp, &id).await?;
            Ok(serde_json::to_value(summary).unwrap())
        }

        ("GET", "/repo/stashes") => {
            let (_, rp, runner, _, _) = state.current_repo().await?;
            let stashes = list_stashes(&runner, &rp).await?;
            Ok(serde_json::to_value(stashes).unwrap())
        }

        ("GET", "/repo/reflog") => {
            let (_, rp, runner, _, _) = state.current_repo().await?;
            let entries = crate::ops::list_reflog(&runner, &rp).await?;
            Ok(serde_json::to_value(entries).unwrap())
        }

        ("POST", "/repo/reflog/checkout") => {
            let (id, rp, runner, _, _) = state.current_repo().await?;
            let selector = b_str(&body, "selector")
                .ok_or_else(|| ApiError::new(400, "MISSING_SELECTOR", "selector is required"))?;
            crate::ops::checkout_reflog(&runner, &rp, &selector).await?;
            state.invalidate(&id).await;
            let summary = get_repo_summary(&runner, &rp, &id).await?;
            Ok(serde_json::to_value(summary).unwrap())
        }

        ("GET", "/repo/worktrees") => {
            let (_, rp, runner, _, _) = state.current_repo().await?;
            let wts = list_worktrees(&runner, &rp).await?;
            Ok(serde_json::to_value(wts).unwrap())
        }

        ("POST", "/repo/worktrees/add") => {
            let (id, rp, runner, _, _) = state.current_repo().await?;
            let raw_path = b_str(&body, "path")
                .ok_or_else(|| ApiError::new(400, "MISSING_PATH", "Worktree path required"))?;
            let branch = b_str(&body, "branch")
                .ok_or_else(|| ApiError::new(400, "MISSING_BRANCH", "Branch required"))?;
            let create_branch = b_bool(&body, "createBranch");
            let start_point = b_str(&body, "startPoint");
            let target = realpath_loose(&resolve_user_path(&raw_path, &state.home_dir)).await;
            let target_str = target.to_string_lossy().to_string();

            let mut args = vec!["worktree".to_string(), "add".to_string()];
            if create_branch {
                args.push("-b".to_string());
                args.push(branch);
                args.push(target_str);
                if let Some(sp) = start_point.filter(|s| !s.is_empty()) {
                    args.push(sp);
                }
            } else {
                args.push(target_str);
                args.push(branch);
            }
            runner.run_owned(&rp, &args, false).await?;
            state.invalidate(&id).await;
            Ok(json!({ "ok": true }))
        }

        ("POST", "/repo/worktrees/remove") => {
            let (id, rp, runner, _, _) = state.current_repo().await?;
            let target_path = b_str(&body, "path")
                .ok_or_else(|| ApiError::new(400, "MISSING_PATH", "Worktree path required"))?;
            let force = b_bool(&body, "force");
            let mut args = vec!["worktree".to_string(), "remove".to_string()];
            if force {
                args.push("--force".to_string());
            }
            args.push(target_path);
            runner.run_owned(&rp, &args, false).await?;
            state.invalidate(&id).await;
            Ok(json!({ "ok": true }))
        }

        ("POST", "/repo/apply-patch") => {
            let (id, rp, runner, _, _) = state.current_repo().await?;
            let patch = b_str(&body, "patch")
                .ok_or_else(|| ApiError::new(400, "MISSING_PATCH", "Patch is required"))?;
            let cached = b_bool(&body, "cached");
            let reverse = b_bool(&body, "reverse");
            let res = apply_patch(&runner, &rp, &patch, cached, reverse).await?;
            state.invalidate(&id).await;
            Ok(json!({ "ok": true, "output": format!("{}{}", res.stdout, res.stderr).trim() }))
        }

        ("POST", "/system/reveal") => {
            let (_, rp, _, _, _) = state.current_repo().await?;
            let target = if let Some(rel) = b_str(&body, "path").filter(|s| !s.is_empty()) {
                let (abs, _) = assert_repo_file(&rp, &rel).await?;
                abs.to_string_lossy().to_string()
            } else {
                rp
            };
            let _ = reveal_path(&target);
            Ok(json!({ "ok": true }))
        }

        ("POST", "/system/terminal") => {
            let (_, rp, _, _, _) = state.current_repo().await?;
            let _ = open_terminal(&rp);
            Ok(json!({ "ok": true }))
        }

        ("POST", "/system/editor") => {
            let (_, rp, _, _, _) = state.current_repo().await?;
            let target = if let Some(rel) = b_str(&body, "path").filter(|s| !s.is_empty()) {
                let (abs, _) = assert_repo_file(&rp, &rel).await?;
                abs.to_string_lossy().to_string()
            } else {
                rp
            };
            let _ = open_in_editor(&target);
            Ok(json!({ "ok": true }))
        }

        ("GET", "/repo/blame") => {
            let (_, rp, runner, _, _) = state.current_repo().await?;
            let raw_path = q_str(&query, "path")
                .ok_or_else(|| ApiError::new(400, "MISSING_PATH", "File path is required"))?;
            let (_, rel) = assert_repo_file(&rp, &raw_path).await?;
            let offset = q_usize(&query, "offset", 0);
            let limit = q_usize(&query, "limit", 1000).clamp(1, 5000);
            let blame = get_blame(&runner, &rp, &rel, offset, limit).await?;
            Ok(serde_json::to_value(blame).unwrap())
        }

        ("GET", "/repo/file-history") => {
            let (_, rp, runner, _, _) = state.current_repo().await?;
            let raw_path = q_str(&query, "path")
                .ok_or_else(|| ApiError::new(400, "MISSING_PATH", "File path is required"))?;
            let (_, rel) = assert_repo_file(&rp, &raw_path).await?;
            let offset = q_usize(&query, "offset", 0);
            let limit = q_usize(&query, "limit", 100).clamp(1, 500);
            let fh = get_file_history(&runner, &rp, &rel, offset, limit).await?;
            Ok(serde_json::to_value(fh).unwrap())
        }

        ("GET", "/repo/conflicts") => {
            let (_, rp, runner, _, _) = state.current_repo().await?;
            let conflicts = get_conflicts(&runner, &rp).await?;
            Ok(serde_json::to_value(conflicts).unwrap())
        }

        ("POST", "/repo/conflicts/resolve") => {
            let (id, rp, runner, _, _) = state.current_repo().await?;
            let file_path = b_str(&body, "path")
                .ok_or_else(|| ApiError::new(400, "MISSING_PATH", "File path is required"))?;
            let content = b_str(&body, "content").unwrap_or_default();
            resolve_conflict_file(&runner, &rp, &file_path, &content).await?;
            state.invalidate(&id).await;
            Ok(json!({ "ok": true }))
        }

        ("POST", "/repo/conflicts/binary") => {
            let (id, rp, runner, _, _) = state.current_repo().await?;
            let file_path = b_str(&body, "path")
                .ok_or_else(|| ApiError::new(400, "MISSING_PATH", "File path is required"))?;
            let side = b_str(&body, "side").unwrap_or_else(|| "ours".to_string());
            resolve_binary_conflict(&runner, &rp, &file_path, &side).await?;
            state.invalidate(&id).await;
            Ok(json!({ "ok": true }))
        }

        ("POST", "/repo/stage") => {
            let (id, rp, runner, _, _) = state.current_repo().await?;
            let raw_paths = b_str_vec(&body, "paths");
            let mut rels = Vec::new();
            for p in raw_paths {
                let (_, rel) = assert_repo_file(&rp, &p).await?;
                rels.push(rel);
            }
            let res = stage(&runner, &rp, &rels).await?;
            state.invalidate(&id).await;
            Ok(json!({ "ok": true, "output": format!("{}{}", res.stdout, res.stderr).trim() }))
        }

        ("POST", "/repo/unstage") => {
            let (id, rp, runner, _, _) = state.current_repo().await?;
            let raw_paths = b_str_vec(&body, "paths");
            let mut rels = Vec::new();
            for p in raw_paths {
                let (_, rel) = assert_repo_file(&rp, &p).await?;
                rels.push(rel);
            }
            let res = unstage(&runner, &rp, &rels).await?;
            state.invalidate(&id).await;
            Ok(json!({ "ok": true, "output": format!("{}{}", res.stdout, res.stderr).trim() }))
        }

        ("POST", "/repo/commit") => {
            let (id, rp, runner, _, _) = state.current_repo().await?;
            let message = b_str(&body, "message")
                .ok_or_else(|| ApiError::new(400, "MISSING_MESSAGE", "Commit message required"))?;
            let amend = b_bool(&body, "amend");
            let signoff = b_bool(&body, "signoff");
            let res = commit(&runner, &rp, &message, amend, signoff).await?;
            state.invalidate(&id).await;
            Ok(json!({ "ok": true, "output": format!("{}{}", res.stdout, res.stderr).trim() }))
        }

        ("POST", "/repo/branch") => {
            let (id, rp, runner, _, _) = state.current_repo().await?;
            let name = b_str(&body, "name")
                .ok_or_else(|| ApiError::new(400, "MISSING_NAME", "Branch name required"))?;
            if let Some(sp) = b_str(&body, "startPoint").filter(|s| !s.is_empty()) {
                runner.run(&rp, &["branch", &name, &sp], false).await?;
            } else {
                runner.run(&rp, &["branch", &name], false).await?;
            }
            state.invalidate(&id).await;
            let summary = get_repo_summary(&runner, &rp, &id).await?;
            Ok(serde_json::to_value(summary).unwrap())
        }

        ("POST", "/repo/branch/delete") => {
            let (id, rp, runner, _, _) = state.current_repo().await?;
            let name = b_str(&body, "name")
                .ok_or_else(|| ApiError::new(400, "MISSING_NAME", "Branch name required"))?;
            let force = b_bool(&body, "force");
            let trash_ref = save_branch_to_trash(&runner, &rp, &name).await;
            let flag = if force { "-D" } else { "-d" };
            runner.run(&rp, &["branch", flag, &name], false).await?;
            let undo = if let Some(tr) = trash_ref {
                Some(
                    state
                        .push_undo(
                            &id,
                            "branch-delete",
                            &format!("Delete branch {name}"),
                            json!({ "type": "branch-delete", "name": name, "trashRef": tr }),
                        )
                        .await,
                )
            } else {
                None
            };
            state.invalidate(&id).await;
            Ok(json!({ "ok": true, "undo": undo }))
        }

        ("POST", "/repo/branch/rename") => {
            let (id, rp, runner, _, _) = state.current_repo().await?;
            let from = b_str(&body, "from")
                .ok_or_else(|| ApiError::new(400, "MISSING_FROM", "From branch required"))?;
            let to = b_str(&body, "to")
                .ok_or_else(|| ApiError::new(400, "MISSING_TO", "To branch required"))?;
            runner.run(&rp, &["branch", "-m", &from, &to], false).await?;
            state.invalidate(&id).await;
            Ok(json!({ "ok": true }))
        }

        ("POST", "/repo/checkout") => {
            let (id, rp, runner, _, _) = state.current_repo().await?;
            let r#ref = b_str(&body, "ref")
                .ok_or_else(|| ApiError::new(400, "MISSING_REF", "Ref is required"))?;
            checkout(&runner, &rp, &r#ref).await?;
            state.invalidate(&id).await;
            let summary = get_repo_summary(&runner, &rp, &id).await?;
            Ok(serde_json::to_value(summary).unwrap())
        }

        ("POST", "/repo/upstream") => {
            let (id, rp, runner, _, _) = state.current_repo().await?;
            let branch = b_str(&body, "branch").unwrap_or_default();
            let upstream = b_str(&body, "upstream").unwrap_or_default();
            let flag = format!("--set-upstream-to={upstream}");
            runner.run(&rp, &["branch", &flag, &branch], false).await?;
            state.invalidate(&id).await;
            Ok(json!({ "ok": true }))
        }

        ("POST", "/repo/fetch") => {
            let (id, rp, runner, _, _) = state.current_repo().await?;
            let remote = b_str(&body, "remote");
            let job = start_background_job(app, state, "fetch", Some(id.clone()), move |st| async move {
                let mut args = vec!["fetch".to_string()];
                if let Some(r) = remote.filter(|s| !s.is_empty()) {
                    args.push(r);
                } else {
                    args.push("--all".to_string());
                }
                args.push("--prune".to_string());
                args.push("--progress".to_string());
                let res = runner.run_owned(&rp, &args, false).await?;
                st.invalidate(&id).await;
                let out = format!("{}\n{}", res.stdout, res.stderr);
                Ok((out.clone(), json!({ "output": out.trim() })))
            })
            .await;
            Ok(json!({ "job": job }))
        }

        ("POST", "/repo/pull") => {
            let (id, rp, runner, _, _) = state.current_repo().await?;
            let strategy = b_str(&body, "strategy").unwrap_or_else(|| "ff-only".to_string());
            let job = start_background_job(app, state, "pull", Some(id.clone()), move |st| async move {
                let backup_ref = create_backup_ref(&runner, &rp, "pull").await;
                let flag = match strategy.as_str() {
                    "merge" => "--no-rebase",
                    "rebase" => "--rebase",
                    _ => "--ff-only",
                };
                let res = runner.run(&rp, &["pull", flag, "--progress"], false).await?;
                if let Some(br) = backup_ref {
                    st.push_undo(&id, "reset", "Pull", json!({ "type": "reset", "backupRef": br }))
                        .await;
                }
                st.invalidate(&id).await;
                let out = format!("{}\n{}", res.stdout, res.stderr);
                Ok((out.clone(), json!({ "output": out.trim() })))
            })
            .await;
            Ok(json!({ "job": job }))
        }

        ("POST", "/repo/push") => {
            let (id, rp, runner, _, confirm_destructive) = state.current_repo().await?;
            let force = b_bool(&body, "force");
            let confirm = b_bool(&body, "confirm");
            if force && confirm_destructive && !confirm {
                return Err(ApiError::new(
                    400,
                    "CONFIRM_REQUIRED",
                    "Force-push requires explicit confirmation.",
                ));
            }
            let remote = b_str(&body, "remote");
            let branch = b_str(&body, "branch");
            let set_upstream = b_bool(&body, "setUpstream");
            let job = start_background_job(app, state, "push", Some(id.clone()), move |st| async move {
                let mut args = vec!["push".to_string()];
                if set_upstream {
                    args.push("--set-upstream".to_string());
                }
                if force {
                    args.push("--force-with-lease".to_string());
                }
                if let Some(r) = remote.filter(|s| !s.is_empty()) {
                    args.push(r);
                }
                if let Some(b) = branch.filter(|s| !s.is_empty()) {
                    args.push(b);
                }
                let res = runner.run_owned(&rp, &args, false).await?;
                st.invalidate(&id).await;
                let out = format!("{}\n{}", res.stdout, res.stderr);
                Ok((out.clone(), json!({ "output": out.trim() })))
            })
            .await;
            Ok(json!({ "job": job }))
        }

        ("POST", "/repo/merge") => {
            let (id, rp, runner, _, _) = state.current_repo().await?;
            let r#ref = b_str(&body, "ref")
                .ok_or_else(|| ApiError::new(400, "MISSING_REF", "Ref required"))?;
            let no_ff = b_bool(&body, "noFf");
            let backup_ref = create_backup_ref(&runner, &rp, "merge").await;
            let res = if no_ff {
                runner.run(&rp, &["merge", "--no-ff", &r#ref], true).await?
            } else {
                runner.run(&rp, &["merge", &r#ref], true).await?
            };
            let status = get_status(&runner, &rp).await?;
            state.invalidate(&id).await;
            if res.exit_code == 0 {
                let undo = if let Some(br) = backup_ref {
                    Some(
                        state
                            .push_undo(&id, "reset", "Merge", json!({ "type": "reset", "backupRef": br }))
                            .await,
                    )
                } else {
                    None
                };
                return Ok(json!({
                    "ok": true,
                    "conflicted": false,
                    "operation": status.operation,
                    "output": format!("{}{}", res.stdout, res.stderr).trim(),
                    "undo": undo,
                }));
            }
            if status.operation.is_some() || status.files.iter().any(|f| f.conflicted) {
                return Ok(json!({
                    "ok": false,
                    "conflicted": true,
                    "operation": status.operation,
                    "output": format!("{}{}", res.stdout, res.stderr).trim(),
                }));
            }
            Err(ApiError::new(422, "GIT_FAILED", res.stderr.trim()))
        }

        ("POST", "/repo/rebase") => {
            let (id, rp, runner, _, _) = state.current_repo().await?;
            let onto = b_str(&body, "onto")
                .ok_or_else(|| ApiError::new(400, "MISSING_ONTO", "Onto ref required"))?;
            let backup_ref = create_backup_ref(&runner, &rp, "rebase").await;
            let res = runner.run(&rp, &["rebase", &onto], true).await?;
            let status = get_status(&runner, &rp).await?;
            state.invalidate(&id).await;
            if res.exit_code == 0 {
                let undo = if let Some(br) = backup_ref {
                    Some(
                        state
                            .push_undo(&id, "reset", "Rebase", json!({ "type": "reset", "backupRef": br }))
                            .await,
                    )
                } else {
                    None
                };
                return Ok(json!({
                    "ok": true,
                    "conflicted": false,
                    "operation": status.operation,
                    "output": format!("{}{}", res.stdout, res.stderr).trim(),
                    "undo": undo,
                }));
            }
            if status.operation.is_some() || status.files.iter().any(|f| f.conflicted) {
                return Ok(json!({
                    "ok": false,
                    "conflicted": true,
                    "operation": status.operation,
                    "output": format!("{}{}", res.stdout, res.stderr).trim(),
                }));
            }
            Err(ApiError::new(422, "GIT_FAILED", res.stderr.trim()))
        }

        ("GET", "/repo/rebase/plan") => {
            let (_, rp, runner, _, _) = state.current_repo().await?;
            let upstream = q_str(&query, "upstream")
                .ok_or_else(|| ApiError::new(400, "MISSING_UPSTREAM", "upstream is required"))?;
            rebase_plan(&runner, &rp, &upstream).await
        }

        ("POST", "/repo/rebase/interactive") => {
            let (id, rp, runner, _, _) = state.current_repo().await?;
            let upstream = b_str(&body, "upstream")
                .ok_or_else(|| ApiError::new(400, "MISSING_UPSTREAM", "upstream is required"))?;
            let plan = body
                .as_ref()
                .and_then(|value| value.get("plan"))
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default();
            if plan.is_empty() {
                return Err(ApiError::new(400, "EMPTY_PLAN", "Rebase plan is empty."));
            }
            let backup_ref = create_backup_ref(&runner, &rp, "rebase").await;
            let res = interactive_rebase(&runner, &rp, &upstream, &plan).await?;
            let status = get_status(&runner, &rp).await?;
            state.invalidate(&id).await;
            if res.exit_code == 0 {
                let undo = if let Some(br) = backup_ref {
                    Some(
                        state
                            .push_undo(&id, "reset", "Rebase", json!({ "type": "reset", "backupRef": br }))
                            .await,
                    )
                } else {
                    None
                };
                return Ok(json!({
                    "ok": true,
                    "conflicted": false,
                    "operation": status.operation,
                    "output": format!("{}{}", res.stdout, res.stderr).trim(),
                    "undo": undo,
                }));
            }
            if status.operation.is_some() || status.files.iter().any(|f| f.conflicted) {
                return Ok(json!({
                    "ok": false,
                    "conflicted": true,
                    "operation": status.operation,
                    "output": format!("{}{}", res.stdout, res.stderr).trim(),
                }));
            }
            Err(ApiError::new(422, "GIT_FAILED", res.stderr.trim()))
        }

        ("POST", "/repo/pulls") => {
            let (_, rp, runner, _, _) = state.current_repo().await?;
            let title = b_str(&body, "title")
                .ok_or_else(|| ApiError::new(400, "MISSING_TITLE", "Title is required"))?;
            let base = b_str(&body, "base")
                .ok_or_else(|| ApiError::new(400, "MISSING_BASE", "Base branch is required"))?;
            let description = b_str(&body, "body").unwrap_or_default();
            let head = b_str(&body, "head");
            let draft = body
                .as_ref()
                .and_then(|value| value.get("draft"))
                .and_then(Value::as_bool)
                .unwrap_or(false);
            create_pull_request(
                &runner,
                &state.home_dir,
                &rp,
                &title,
                &description,
                &base,
                head.as_deref(),
                draft,
            )
            .await
        }

        ("POST", "/repo/cherry-pick") => {
            let (id, rp, runner, _, _) = state.current_repo().await?;
            let hashes = b_str_vec(&body, "hashes");
            let backup_ref = create_backup_ref(&runner, &rp, "cherry-pick").await;
            let mut args = vec!["cherry-pick".to_string()];
            args.extend(hashes);
            let res = runner.run_owned(&rp, &args, true).await?;
            let status = get_status(&runner, &rp).await?;
            state.invalidate(&id).await;
            if res.exit_code == 0 {
                let undo = if let Some(br) = backup_ref {
                    Some(
                        state
                            .push_undo(
                                &id,
                                "reset",
                                "Cherry-pick",
                                json!({ "type": "reset", "backupRef": br }),
                            )
                            .await,
                    )
                } else {
                    None
                };
                return Ok(json!({
                    "ok": true,
                    "conflicted": false,
                    "operation": status.operation,
                    "output": format!("{}{}", res.stdout, res.stderr).trim(),
                    "undo": undo,
                }));
            }
            if status.operation.is_some() || status.files.iter().any(|f| f.conflicted) {
                return Ok(json!({
                    "ok": false,
                    "conflicted": true,
                    "operation": status.operation,
                    "output": format!("{}{}", res.stdout, res.stderr).trim(),
                }));
            }
            Err(ApiError::new(422, "GIT_FAILED", res.stderr.trim()))
        }

        ("POST", "/repo/stash") => {
            let (id, rp, runner, _, _) = state.current_repo().await?;
            let include_untracked = b_bool(&body, "includeUntracked");
            let message = b_str(&body, "message");
            let mut rels = Vec::new();
            for p in b_str_vec(&body, "paths") {
                let (_, rel) = assert_repo_file(&rp, &p).await?;
                rels.push(rel);
            }
            let mut args = vec!["stash".to_string(), "push".to_string()];
            if include_untracked {
                args.push("-u".to_string());
            }
            if let Some(m) = message.filter(|s| !s.is_empty()) {
                args.push("-m".to_string());
                args.push(m);
            }
            if !rels.is_empty() {
                args.push("--".to_string());
                args.extend(rels);
            }
            let res = runner.run_owned(&rp, &args, false).await?;
            state.invalidate(&id).await;
            Ok(json!({ "ok": true, "output": format!("{}{}", res.stdout, res.stderr).trim() }))
        }

        ("POST", "/repo/stash/apply") => {
            let (id, rp, runner, _, _) = state.current_repo().await?;
            let r#ref = b_str(&body, "ref").unwrap_or_else(|| "stash@{0}".to_string());
            let res = runner.run(&rp, &["stash", "apply", &r#ref], false).await?;
            state.invalidate(&id).await;
            Ok(json!({ "ok": true, "output": format!("{}{}", res.stdout, res.stderr).trim() }))
        }

        ("POST", "/repo/stash/pop") => {
            let (id, rp, runner, _, _) = state.current_repo().await?;
            let r#ref = b_str(&body, "ref").unwrap_or_else(|| "stash@{0}".to_string());
            let res = runner.run(&rp, &["stash", "pop", &r#ref], false).await?;
            state.invalidate(&id).await;
            Ok(json!({ "ok": true, "output": format!("{}{}", res.stdout, res.stderr).trim() }))
        }

        ("POST", "/repo/stash/drop") => {
            let (id, rp, runner, _, _) = state.current_repo().await?;
            let r#ref = b_str(&body, "ref").unwrap_or_else(|| "stash@{0}".to_string());
            let res = runner.run(&rp, &["stash", "drop", &r#ref], false).await?;
            state.invalidate(&id).await;
            Ok(json!({ "ok": true, "output": format!("{}{}", res.stdout, res.stderr).trim() }))
        }

        ("POST", "/repo/tag") => {
            let (id, rp, runner, _, _) = state.current_repo().await?;
            let name = b_str(&body, "name")
                .ok_or_else(|| ApiError::new(400, "MISSING_NAME", "Tag name required"))?;
            let message = b_str(&body, "message");
            let r#ref = b_str(&body, "ref");
            let mut args = vec!["tag".to_string()];
            if let Some(m) = message.filter(|s| !s.is_empty()) {
                args.push("-a".to_string());
                args.push("-m".to_string());
                args.push(m);
            }
            args.push(name);
            if let Some(rf) = r#ref.filter(|s| !s.is_empty()) {
                args.push(rf);
            }
            runner.run_owned(&rp, &args, false).await?;
            state.invalidate(&id).await;
            Ok(json!({ "ok": true }))
        }

        ("POST", "/repo/tag/delete") => {
            let (id, rp, runner, _, _) = state.current_repo().await?;
            let name = b_str(&body, "name")
                .ok_or_else(|| ApiError::new(400, "MISSING_NAME", "Tag name required"))?;
            runner.run(&rp, &["tag", "-d", &name], false).await?;
            state.invalidate(&id).await;
            Ok(json!({ "ok": true }))
        }

        ("POST", "/repo/tag/push") => {
            let (id, rp, runner, _, _) = state.current_repo().await?;
            let name = b_str(&body, "name")
                .ok_or_else(|| ApiError::new(400, "MISSING_NAME", "Tag name required"))?;
            let remote = b_str(&body, "remote").unwrap_or_else(|| "origin".to_string());
            let job =
                start_background_job(app, state, "push-tag", Some(id.clone()), move |st| async move {
                    let res = runner.run(&rp, &["push", &remote, &name], false).await?;
                    st.invalidate(&id).await;
                    let out = format!("{}\n{}", res.stdout, res.stderr);
                    Ok((out.clone(), json!({ "output": out.trim() })))
                })
                .await;
            Ok(json!({ "job": job }))
        }

        ("POST", "/repo/remote") => {
            let (_, rp, runner, _, _) = state.current_repo().await?;
            let name = b_str(&body, "name").unwrap_or_default();
            let url = b_str(&body, "url").unwrap_or_default();
            runner.run(&rp, &["remote", "add", &name, &url], false).await?;
            Ok(json!({ "ok": true }))
        }

        ("POST", "/repo/remote/remove") => {
            let (_, rp, runner, _, _) = state.current_repo().await?;
            let name = b_str(&body, "name").unwrap_or_default();
            runner.run(&rp, &["remote", "remove", &name], false).await?;
            Ok(json!({ "ok": true }))
        }

        ("POST", "/repo/remote/url") => {
            let (_, rp, runner, _, _) = state.current_repo().await?;
            let name = b_str(&body, "name").unwrap_or_default();
            let url = b_str(&body, "url").unwrap_or_default();
            runner.run(&rp, &["remote", "set-url", &name, &url], false).await?;
            Ok(json!({ "ok": true }))
        }

        ("POST", "/repo/reset") => {
            let (id, rp, runner, _, confirm_destructive) = state.current_repo().await?;
            let mode = b_str(&body, "mode").unwrap_or_else(|| "mixed".to_string());
            let r#ref = b_str(&body, "ref").unwrap_or_else(|| "HEAD".to_string());
            let confirm = b_bool(&body, "confirm");
            if mode == "hard" && confirm_destructive && !confirm {
                return Err(ApiError::new(
                    400,
                    "CONFIRM_REQUIRED",
                    "Hard reset requires explicit confirmation.",
                ));
            }
            let backup_ref = create_backup_ref(&runner, &rp, "reset").await;
            let flag = format!("--{mode}");
            runner.run(&rp, &["reset", &flag, &r#ref], false).await?;
            let undo = if let Some(br) = backup_ref {
                Some(
                    state
                        .push_undo(
                            &id,
                            "reset",
                            &format!("Reset --{mode} {}", r#ref),
                            json!({ "type": "reset", "backupRef": br }),
                        )
                        .await,
                )
            } else {
                None
            };
            state.invalidate(&id).await;
            Ok(json!({ "ok": true, "undo": undo }))
        }

        ("POST", "/repo/clean") => {
            let (id, rp, runner, _, _) = state.current_repo().await?;
            let confirm = b_bool(&body, "confirm");
            let raw_paths = b_str_vec(&body, "paths");
            let preview = preview_clean(
                &runner,
                &rp,
                if raw_paths.is_empty() {
                    None
                } else {
                    Some(&raw_paths)
                },
            )
            .await?;
            if !confirm {
                return Ok(json!({ "ok": false, "preview": preview }));
            }
            let trash_dir = trash_paths(&rp, &state.data_dir, &id, &preview).await?;
            let undo = state
                .push_undo(
                    &id,
                    "clean",
                    "Clean untracked files",
                    json!({ "type": "clean", "trashDir": trash_dir }),
                )
                .await;
            state.invalidate(&id).await;
            Ok(json!({ "ok": true, "preview": preview, "undo": undo }))
        }

        ("POST", "/repo/restore") => {
            let (id, rp, runner, _, confirm_destructive) = state.current_repo().await?;
            let confirm = b_bool(&body, "confirm");
            if confirm_destructive && !confirm {
                return Err(ApiError::new(
                    400,
                    "CONFIRM_REQUIRED",
                    "Restoring files requires explicit confirmation.",
                ));
            }
            let raw_paths = b_str_vec(&body, "paths");
            let mut rels = Vec::new();
            for p in raw_paths {
                let (_, rel) = assert_repo_file(&rp, &p).await?;
                rels.push(rel);
            }
            let trash_dir = restore_files(&runner, &rp, &state.data_dir, &id, &rels).await?;
            let undo = state
                .push_undo(
                    &id,
                    "restore",
                    "Discard changes",
                    json!({ "type": "restore", "trashDir": trash_dir }),
                )
                .await;
            state.invalidate(&id).await;
            Ok(json!({ "ok": true, "undo": undo }))
        }

        ("GET", "/undo") => {
            let (id, _, _, _, _) = state.current_repo().await?;
            let guard = state.inner.lock().await;
            let mut list = guard.undo_entries.get(&id).cloned().unwrap_or_default();
            list.reverse();
            Ok(serde_json::to_value(list).unwrap())
        }

        _ => {
            if let Some(rest) = path.strip_prefix("/repo/pulls/") {
                let (number_part, action) = rest
                    .split_once('/')
                    .map(|(number, action)| (number, Some(action)))
                    .unwrap_or((rest, None));
                let number = number_part.parse::<i64>().map_err(|_| {
                    ApiError::new(
                        400,
                        "INVALID_PULL_REQUEST",
                        "Pull request number is invalid.",
                    )
                })?;
                if number <= 0 {
                    return Err(ApiError::new(
                        400,
                        "INVALID_PULL_REQUEST",
                        "Pull request number is invalid.",
                    ));
                }
                match (method, action) {
                    ("GET", None) => {
                        let (_, rp, runner, _, _) = state.current_repo().await?;
                        let detail = get_pull_request_detail(
                            &runner,
                            &state.home_dir,
                            &rp,
                            number,
                        )
                        .await?;
                        return Ok(serde_json::to_value(detail).unwrap());
                    }
                    ("POST", Some("comments")) => {
                        let (_, rp, runner, _, _) = state.current_repo().await?;
                        let comment_body = body
                            .as_ref()
                            .and_then(|value| value.get("body"))
                            .and_then(|value| value.as_str())
                            .map(str::trim)
                            .filter(|value| !value.is_empty())
                            .ok_or_else(|| {
                                ApiError::new(
                                    400,
                                    "INVALID_COMMENT",
                                    "Comment body is required.",
                                )
                            })?;
                        let path = b_str(&body, "path");
                        let line = body
                            .as_ref()
                            .and_then(|value| value.get("line"))
                            .and_then(|value| value.as_i64());
                        if line.is_some_and(|line| line <= 0) {
                            return Err(ApiError::new(
                                400,
                                "INVALID_COMMENT",
                                "Comment line must be positive.",
                            ));
                        }
                        let side = b_str(&body, "side");
                        let commit_id = b_str(&body, "commitId");
                        create_pull_request_comment(
                            &runner,
                            &state.home_dir,
                            &rp,
                            number,
                            comment_body,
                            path.as_deref(),
                            line,
                            side.as_deref(),
                            commit_id.as_deref(),
                        )
                        .await?;
                        return Ok(json!({ "ok": true }));
                    }
                    ("POST", Some("approve")) => {
                        let (_, rp, runner, _, _) = state.current_repo().await?;
                        let review_body = b_str(&body, "body");
                        approve_pull_request(
                            &runner,
                            &state.home_dir,
                            &rp,
                            number,
                            review_body.as_deref(),
                        )
                        .await?;
                        return Ok(json!({ "ok": true }));
                    }
                    _ => {}
                }
            }

            if let Some(hash_enc) = path.strip_prefix("/repo/commit/") {
                let hash = urlencoding::decode(hash_enc)
                    .map(|s| s.into_owned())
                    .unwrap_or_else(|_| hash_enc.to_string());
                let (_, rp, runner, ctx, _) = state.current_repo().await?;
                let detail = get_commit_detail(&runner, &rp, &hash, ctx).await?;
                return Ok(serde_json::to_value(detail).unwrap());
            }

            if let Some(kind) = path.strip_prefix("/repo/operation/") {
                let (id, rp, runner, _, _) = state.current_repo().await?;
                let action = b_str(&body, "action").unwrap_or_else(|| "continue".to_string());
                let cmd = match kind {
                    "merge" => "merge",
                    "rebase" => "rebase",
                    "cherry-pick" => "cherry-pick",
                    "revert" => "revert",
                    _ => return Err(ApiError::new(400, "INVALID_OPERATION", "Unknown operation")),
                };
                let flag = format!("--{action}");
                let res = runner.run(&rp, &[cmd, &flag], false).await?;
                state.invalidate(&id).await;
                return Ok(json!({
                    "ok": true,
                    "output": format!("{}{}", res.stdout, res.stderr).trim()
                }));
            }

            if let Some(undo_id_enc) = path.strip_prefix("/undo/") {
                let undo_id = urlencoding::decode(undo_id_enc)
                    .map(|s| s.into_owned())
                    .unwrap_or_else(|_| undo_id_enc.to_string());
                let (id, rp, runner, _, _) = state.current_repo().await?;
                let entry = {
                    let mut guard = state.inner.lock().await;
                    let list = guard.undo_entries.entry(id.clone()).or_default();
                    let pos = list.iter().position(|e| e.id == undo_id);
                    pos.map(|idx| list.remove(idx))
                }
                .ok_or_else(|| ApiError::new(404, "UNDO_NOT_FOUND", "Undo entry not found"))?;

                let utype = entry
                    .payload
                    .get("type")
                    .and_then(|v| v.as_str())
                    .unwrap_or("");
                if utype == "reset" {
                    if let Some(br) = entry.payload.get("backupRef").and_then(|v| v.as_str()) {
                        runner.run(&rp, &["reset", "--hard", br], false).await?;
                    }
                    if let Some(td) = entry.payload.get("trashDir").and_then(|v| v.as_str()) {
                        restore_trash(td, &rp).await?;
                    }
                } else if utype == "branch-delete" {
                    let bname = entry.payload.get("name").and_then(|v| v.as_str()).unwrap_or("");
                    let tref = entry
                        .payload
                        .get("trashRef")
                        .and_then(|v| v.as_str())
                        .unwrap_or("");
                    if !bname.is_empty() && !tref.is_empty() {
                        runner
                            .run(&rp, &["update-ref", &format!("refs/heads/{bname}"), tref], false)
                            .await?;
                    }
                } else if utype == "clean" || utype == "restore" {
                    if let Some(td) = entry.payload.get("trashDir").and_then(|v| v.as_str()) {
                        restore_trash(td, &rp).await?;
                    }
                }
                state.invalidate(&id).await;
                return Ok(json!({ "ok": true }));
            }

            if let Some(rest) = path.strip_prefix("/jobs/") {
                if let Some(job_id) = rest.strip_suffix("/cancel") {
                    let mut guard = state.inner.lock().await;
                    if let Some(job) = guard.jobs.get_mut(job_id) {
                        job.status = "cancelled".to_string();
                        return Ok(json!({ "ok": true }));
                    }
                    return Err(ApiError::new(404, "JOB_NOT_FOUND", "Job not found"));
                }
                let guard = state.inner.lock().await;
                let job = guard
                    .jobs
                    .get(rest)
                    .cloned()
                    .ok_or_else(|| ApiError::new(404, "JOB_NOT_FOUND", "Job not found"))?;
                return Ok(serde_json::to_value(job).unwrap());
            }

            Err(ApiError::new(
                404,
                "NOT_FOUND",
                format!("Endpoint not found: {method} {path}"),
            ))
        }
    }
}

#[tauri::command]
async fn gitastic_api(
    app: AppHandle,
    state: State<'_, Arc<AppState>>,
    method: String,
    path: String,
    query: Option<Value>,
    body: Option<Value>,
) -> Result<Value, Value> {
    dispatch(app, state.inner().clone(), &method, &path, query, body)
        .await
        .map_err(|err| err.to_json())
}

async fn rebase_plan(runner: &GitRunner, repo_path: &str, upstream: &str) -> ApiResult<Value> {
    let range = format!("{upstream}..HEAD");
    let result = runner
        .run(
            repo_path,
            &["log", "--reverse", "--format=%H%x00%s%x00%an%x00%aI", &range],
            true,
        )
        .await?;
    if result.exit_code != 0 {
        return Err(ApiError::new(
            400,
            "REBASE_PLAN_FAILED",
            result.stderr.trim().to_string(),
        ));
    }
    let commits: Vec<Value> = result
        .stdout
        .lines()
        .filter(|line| !line.is_empty())
        .map(|line| {
            let mut parts = line.split('\u{0}');
            json!({
                "hash": parts.next().unwrap_or(""),
                "subject": parts.next().unwrap_or(""),
                "author": parts.next().unwrap_or(""),
                "date": parts.next().unwrap_or(""),
            })
        })
        .collect();
    Ok(json!({ "commits": commits }))
}

fn quote_commit_message(message: &str) -> String {
    format!("\"{}\"", message.replace('\\', "\\\\").replace('"', "\\\""))
}

async fn interactive_rebase(
    runner: &GitRunner,
    repo_path: &str,
    upstream: &str,
    plan: &[Value],
) -> ApiResult<GitResult> {
    let dir = std::env::temp_dir().join(format!("gitastic-rebase-{}", random_uuid()));
    fs::create_dir_all(&dir).await.map_err(|error| {
        ApiError::new(500, "REBASE_TMP_FAILED", format!("Could not prepare rebase: {error}"))
    })?;
    let plan_file = dir.join("todo");
    let mut lines: Vec<String> = Vec::new();
    for entry in plan {
        let hash = entry.get("hash").and_then(Value::as_str).unwrap_or("");
        let action = entry.get("action").and_then(Value::as_str).unwrap_or("pick");
        match action {
            "drop" => lines.push(format!("drop {hash}")),
            "squash" => lines.push(format!("squash {hash}")),
            "fixup" => lines.push(format!("fixup {hash}")),
            "reword" => {
                lines.push(format!("pick {hash}"));
                let message = entry.get("message").and_then(Value::as_str).unwrap_or("");
                lines.push(format!("exec git commit --amend -m {}", quote_commit_message(message)));
            }
            _ => lines.push(format!("pick {hash}")),
        }
    }
    fs::write(&plan_file, format!("{}\n", lines.join("\n")))
        .await
        .map_err(|error| {
            ApiError::new(500, "REBASE_TMP_FAILED", format!("Could not write rebase plan: {error}"))
        })?;

    let exe = std::env::current_exe().unwrap_or_default();
    let editor = format!(
        "\"{}\" --git-editor-copy \"{}\"",
        exe.display(),
        plan_file.display()
    );
    let envs = vec![
        ("GIT_SEQUENCE_EDITOR", editor),
        ("GIT_EDITOR", "true".to_string()),
    ];
    let result = runner
        .run_with_env(repo_path, &["rebase", "-i", upstream], &envs, true)
        .await;
    let _ = fs::remove_dir_all(&dir).await;
    result
}

fn random_uuid() -> String {
    Uuid::new_v4().to_string()
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    if args.len() >= 4 && args[1] == "--git-editor-copy" {
        if let Ok(content) = std::fs::read_to_string(&args[2]) {
            let _ = std::fs::write(&args[3], content);
        }
        std::process::exit(0);
    }
    let app_state = tauri::async_runtime::block_on(AppState::init());
    tauri::Builder::default()
        .manage(Arc::new(app_state))
        .menu(|handle| {
            let settings_item = MenuItem::with_id(
                handle,
                "open_settings",
                "Settings…",
                true,
                Some("CmdOrCtrl+,"),
            )?;
            let palette_item = MenuItem::with_id(
                handle,
                "command_palette",
                "Command Palette…",
                true,
                Some("CmdOrCtrl+P"),
            )?;
            let sponsor_item = MenuItem::with_id(
                handle,
                "sponsor_gitastic",
                "Sponsor Gitastic…",
                true,
                None::<&str>,
            )?;
            let app_menu = Submenu::with_items(
                handle,
                "Gitastic",
                true,
                &[
                    &PredefinedMenuItem::about(handle, None, None)?,
                    &PredefinedMenuItem::separator(handle)?,
                    &settings_item,
                    &palette_item,
                    &sponsor_item,
                    &PredefinedMenuItem::separator(handle)?,
                    &PredefinedMenuItem::services(handle, None)?,
                    &PredefinedMenuItem::separator(handle)?,
                    &PredefinedMenuItem::hide(handle, None)?,
                    &PredefinedMenuItem::hide_others(handle, None)?,
                    &PredefinedMenuItem::show_all(handle, None)?,
                    &PredefinedMenuItem::separator(handle)?,
                    &PredefinedMenuItem::quit(handle, None)?,
                ],
            )?;
            let edit_menu = Submenu::with_items(
                handle,
                "Edit",
                true,
                &[
                    &PredefinedMenuItem::undo(handle, None)?,
                    &PredefinedMenuItem::redo(handle, None)?,
                    &PredefinedMenuItem::separator(handle)?,
                    &PredefinedMenuItem::cut(handle, None)?,
                    &PredefinedMenuItem::copy(handle, None)?,
                    &PredefinedMenuItem::paste(handle, None)?,
                    &PredefinedMenuItem::select_all(handle, None)?,
                ],
            )?;
            let window_menu = Submenu::with_items(
                handle,
                "Window",
                true,
                &[
                    &PredefinedMenuItem::minimize(handle, None)?,
                    &PredefinedMenuItem::maximize(handle, None)?,
                    &PredefinedMenuItem::separator(handle)?,
                    &PredefinedMenuItem::close_window(handle, None)?,
                ],
            )?;
            Menu::with_items(handle, &[&app_menu, &edit_menu, &window_menu])
        })
        .on_menu_event(|app, event| {
            if event.id() == "open_settings" {
                let _ = app.emit("open-settings", ());
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.eval(
                        "window.dispatchEvent(new CustomEvent('gitastic:open-settings'))",
                    );
                }
            } else if event.id() == "command_palette" {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.eval(
                        "window.dispatchEvent(new CustomEvent('gitastic:command-palette'))",
                    );
                }
            } else if event.id() == "sponsor_gitastic" {
                let _ = open_external("https://github.com/sponsors/dirk-rossbach");
            }
        })
        .invoke_handler(tauri::generate_handler![gitastic_api])
        .run(tauri::generate_context!())
        .expect("error while running Gitastic Tauri application");
}
