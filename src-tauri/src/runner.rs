use std::path::PathBuf;
use std::process::Stdio;
use serde_json::json;
use tokio::io::AsyncWriteExt;
use tokio::process::Command;

use crate::error::{ApiError, ApiResult};

pub fn enriched_path() -> String {
    let existing = std::env::var_os("PATH").unwrap_or_default();
    let mut paths: Vec<PathBuf> = Vec::new();

    #[cfg(windows)]
    {
        for path in [
            r"C:\Program Files\Git\cmd",
            r"C:\Program Files\Git\bin",
            r"C:\Program Files\OpenSSH",
            r"C:\Windows\System32\OpenSSH",
        ] {
            paths.push(PathBuf::from(path));
        }
        if let Ok(local_app_data) = std::env::var("LOCALAPPDATA") {
            paths.push(PathBuf::from(local_app_data).join("Programs").join("Git").join("cmd"));
        }
    }

    #[cfg(not(windows))]
    {
        for path in [
            "/opt/homebrew/bin",
            "/usr/local/bin",
            "/usr/bin",
            "/bin",
            "/usr/sbin",
            "/sbin",
        ] {
            paths.push(PathBuf::from(path));
        }
    }

    paths.extend(std::env::split_paths(&existing));
    std::env::join_paths(paths)
        .map(|joined| joined.to_string_lossy().into_owned())
        .unwrap_or_else(|_| existing.to_string_lossy().into_owned())
}

#[derive(Debug, Clone)]
pub struct GitResult {
    pub stdout: String,
    pub stderr: String,
    pub exit_code: i32,
}

#[derive(Debug, Clone)]
pub struct GitRunner {
    pub git_path: String,
}

impl GitRunner {
    pub fn new(git_path: impl Into<String>) -> Self {
        Self {
            git_path: git_path.into(),
        }
    }

    pub async fn run(&self, cwd: &str, args: &[&str], allow_fail: bool) -> ApiResult<GitResult> {
        self.run_with_input(cwd, args, None, allow_fail).await
    }

    pub async fn run_owned(
        &self,
        cwd: &str,
        args: &[String],
        allow_fail: bool,
    ) -> ApiResult<GitResult> {
        let refs: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
        self.run_with_input(cwd, &refs, None, allow_fail).await
    }

    pub async fn run_with_input(
        &self,
        cwd: &str,
        args: &[&str],
        input: Option<&str>,
        allow_fail: bool,
    ) -> ApiResult<GitResult> {
        self.run_full(cwd, args, input, &[], allow_fail).await
    }

    pub async fn run_with_env(
        &self,
        cwd: &str,
        args: &[&str],
        envs: &[(&str, String)],
        allow_fail: bool,
    ) -> ApiResult<GitResult> {
        self.run_full(cwd, args, None, envs, allow_fail).await
    }

    async fn run_full(
        &self,
        cwd: &str,
        args: &[&str],
        input: Option<&str>,
        envs: &[(&str, String)],
        allow_fail: bool,
    ) -> ApiResult<GitResult> {
        let mut cmd = Command::new(&self.git_path);
        cmd.current_dir(cwd)
            .arg("--no-pager")
            .arg("-c")
            .arg("core.quotepath=false")
            .arg("-c")
            .arg("color.ui=false")
            .arg("-c")
            .arg("advice.detachedHead=false")
            .args(args)
            .env("PATH", enriched_path())
            .env("LC_ALL", "C")
            .env("LANG", "C")
            .env("GIT_TERMINAL_PROMPT", "0")
            .env("GIT_OPTIONAL_LOCKS", "0")
            .env("GIT_EDITOR", "true")
            .env("GIT_SEQUENCE_EDITOR", "true")
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());

        for (key, value) in envs {
            cmd.env(key, value);
        }

        if input.is_some() {
            cmd.stdin(Stdio::piped());
        } else {
            cmd.stdin(Stdio::null());
        }

        let mut child = cmd.spawn().map_err(|err| {
            ApiError::new(
                500,
                "GIT_SPAWN_FAILED",
                format!("Failed to start git: {err}"),
            )
        })?;

        if let Some(text) = input {
            if let Some(mut stdin) = child.stdin.take() {
                let _ = stdin.write_all(text.as_bytes()).await;
            }
        }

        let output = child.wait_with_output().await.map_err(|err| {
            ApiError::new(500, "GIT_WAIT_FAILED", format!("Git wait failed: {err}"))
        })?;

        let exit_code = output.status.code().unwrap_or(1);
        let stdout = String::from_utf8_lossy(&output.stdout).into_owned();
        let stderr = String::from_utf8_lossy(&output.stderr).into_owned();

        if exit_code != 0 && !allow_fail {
            return Err(ApiError::with_details(
                422,
                "GIT_FAILED",
                if stderr.trim().is_empty() {
                    format!("git {} failed", args.join(" "))
                } else {
                    stderr.trim().to_string()
                },
                json!({
                    "args": args,
                    "exitCode": exit_code,
                    "stderr": stderr,
                    "stdout": stdout,
                }),
            ));
        }

        Ok(GitResult {
            stdout,
            stderr,
            exit_code,
        })
    }

    pub async fn version(&self) -> Option<String> {
        let output = Command::new(&self.git_path)
            .arg("--version")
            .env("PATH", enriched_path())
            .output()
            .await
            .ok()?;
        if !output.status.success() {
            return None;
        }
        let text = String::from_utf8_lossy(&output.stdout);
        text.split_whitespace().nth(2).map(|s| s.to_string())
    }
}
