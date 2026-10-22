use serde::{Deserialize, Serialize};
use serde_json::Value;

pub const MIN_GIT_VERSION: &str = "2.38.0";

pub fn short_hash(hash: &str) -> String {
    hash.chars().take(7).collect()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecentRepo {
    pub id: String,
    pub name: String,
    pub path: String,
    pub last_opened: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RepoSummary {
    pub id: String,
    pub name: String,
    pub path: String,
    pub root: String,
    pub head: Option<String>,
    pub branch: Option<String>,
    pub detached: bool,
    pub upstream: Option<String>,
    pub ahead: u32,
    pub behind: u32,
    pub operation: Option<String>,
    pub dirty: usize,
    pub staged: usize,
    pub untracked: usize,
    pub conflicts: usize,
    pub last_commit: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileStatus {
    pub path: String,
    pub orig_path: Option<String>,
    pub index: String,
    pub worktree: String,
    pub staged: bool,
    pub unstaged: bool,
    pub untracked: bool,
    pub conflicted: bool,
    pub kind: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    pub branch: Option<String>,
    pub head: Option<String>,
    pub upstream: Option<String>,
    pub ahead: u32,
    pub behind: u32,
    pub operation: Option<String>,
    pub files: Vec<FileStatus>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitBase {
    pub hash: String,
    pub short_hash: String,
    pub parents: Vec<String>,
    pub author_name: String,
    pub author_email: String,
    pub author_date: String,
    pub committer_name: String,
    pub committer_email: String,
    pub committer_date: String,
    pub subject: String,
    pub body: String,
    pub refs: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LaneBranchEntry {
    pub lane: usize,
    pub labels: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitSummary {
    #[serde(flatten)]
    pub base: CommitBase,
    pub lane: usize,
    pub active_lanes: Vec<usize>,
    pub next_active_lanes: Vec<usize>,
    pub parent_lanes: Vec<usize>,
    pub lane_branches: Vec<LaneBranchEntry>,
    pub max_lanes: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryPage {
    pub commits: Vec<CommitSummary>,
    pub offset: usize,
    pub limit: usize,
    pub total: usize,
    pub max_lanes: usize,
    pub r#ref: Option<String>,
    pub query: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiffFile {
    pub path: String,
    pub old_path: Option<String>,
    pub status: String,
    pub additions: usize,
    pub deletions: usize,
    pub binary: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiffResponse {
    pub path: Option<String>,
    pub staged: bool,
    pub patch: String,
    pub files: Vec<DiffFile>,
    pub binary: bool,
    pub too_large: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitDetail {
    pub commit: CommitBase,
    pub files: Vec<DiffFile>,
    pub patch: String,
    pub binary: bool,
    pub too_large: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Branch {
    pub name: String,
    pub r#ref: String,
    pub hash: String,
    pub upstream: Option<String>,
    pub current: bool,
    pub remote: bool,
    pub date: Option<String>,
    pub subject: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Tag {
    pub name: String,
    pub r#ref: String,
    pub hash: String,
    pub r#type: String,
    pub tagger: Option<String>,
    pub date: Option<String>,
    pub subject: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Remote {
    pub name: String,
    pub url: String,
    pub push_url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Stash {
    pub index: usize,
    pub r#ref: String,
    pub hash: String,
    pub message: String,
    pub date: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BlameLine {
    pub line: usize,
    pub hash: String,
    pub short_hash: String,
    pub author: String,
    pub email: String,
    pub date: String,
    pub summary: String,
    pub content: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BlameResponse {
    pub path: String,
    pub lines: Vec<BlameLine>,
    pub offset: usize,
    pub limit: usize,
    pub total: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileHistoryResponse {
    pub path: String,
    pub commits: Vec<CommitBase>,
    pub offset: usize,
    pub limit: usize,
    pub total: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConflictBlock {
    pub id: String,
    pub start_line: usize,
    pub end_line: usize,
    pub ours: String,
    pub theirs: String,
    pub base: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConflictFile {
    pub path: String,
    pub kind: String,
    pub binary: bool,
    pub content: Option<String>,
    pub blocks: Vec<ConflictBlock>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConflictsResponse {
    pub operation: Option<String>,
    pub files: Vec<ConflictFile>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UndoEntry {
    pub id: String,
    pub repo_id: String,
    pub kind: String,
    pub label: String,
    pub created_at: String,
    pub payload: Value,
}

fn default_ui_style() -> String {
    "gorgeous".to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppConfig {
    pub theme: String,
    #[serde(default = "default_ui_style")]
    pub ui_style: String,
    pub git_path: String,
    pub editor: String,
    pub pull_strategy: String,
    pub diff_context: u32,
    pub confirm_destructive: bool,
    pub repo_roots: Vec<String>,
    pub recent_repos: Vec<RecentRepo>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OnboardingCheck {
    pub id: String,
    pub label: String,
    pub status: String,
    pub detail: String,
    pub hint: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OnboardingReport {
    pub home: String,
    pub root: String,
    pub git_version: Option<String>,
    pub min_git_version: String,
    pub checks: Vec<OnboardingCheck>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Job {
    pub id: String,
    pub r#type: String,
    pub repo_id: Option<String>,
    pub status: String,
    pub progress: Option<f64>,
    pub message: String,
    pub output: Vec<String>,
    pub error: Option<String>,
    pub created_at: String,
    pub finished_at: Option<String>,
    pub result: Option<Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Session {
    pub repo: Option<RepoSummary>,
    pub config: AppConfig,
    pub onboarding: OnboardingReport,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DirectoryEntry {
    pub name: String,
    pub path: String,
    pub is_repo: bool,
    pub is_directory: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DirectoryListing {
    pub path: String,
    pub parent: Option<String>,
    pub entries: Vec<DirectoryEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderAccountStatus {
    pub provider: String,
    pub host: String,
    pub connected: bool,
    pub username: Option<String>,
    pub method: String,
    pub cli_installed: bool,
    pub detail: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SshKeyEntry {
    pub name: String,
    pub path: String,
    pub public_path: Option<String>,
    pub public_key: Option<String>,
    pub loaded: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProvidersStatusResponse {
    pub accounts: Vec<ProviderAccountStatus>,
    pub ssh_keys: Vec<SshKeyEntry>,
    pub credential_helper: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderRepo {
    pub id: String,
    pub provider: String,
    pub host: String,
    pub name: String,
    pub full_name: String,
    pub description: Option<String>,
    pub r#private: bool,
    pub default_branch: Option<String>,
    pub updated_at: Option<String>,
    pub web_url: String,
    pub clone_url: String,
    pub ssh_url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteProviderInfo {
    pub remote_name: String,
    pub provider: String,
    pub host: String,
    pub owner: String,
    pub repo: String,
    pub full_name: String,
    pub web_url: String,
    pub pulls_url: String,
    pub issues_url: String,
    pub branch_url_template: String,
    pub commit_url_template: String,
    pub create_pull_url_template: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PullRequestItem {
    pub id: String,
    pub number: i64,
    pub provider: String,
    pub title: String,
    pub state: String,
    pub draft: bool,
    pub author: String,
    pub source_branch: String,
    pub target_branch: String,
    pub updated_at: String,
    pub web_url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PullRequestsResponse {
    pub remote: Option<RemoteProviderInfo>,
    pub items: Vec<PullRequestItem>,
    pub auth_hint: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Worktree {
    pub path: String,
    pub head: String,
    pub branch: Option<String>,
    pub bare: bool,
    pub detached: bool,
    pub locked: bool,
    pub prunable: bool,
    pub is_main: bool,
}
