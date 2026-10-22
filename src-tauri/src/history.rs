use std::collections::{HashMap, HashSet};
use std::path::Path;
use serde::{Deserialize, Serialize};
use tokio::fs;

use crate::error::ApiResult;
use crate::models::{
    BlameResponse, CommitBase, CommitSummary, FileHistoryResponse, HistoryPage, LaneBranchEntry,
};
use crate::ops::repo_id_for_path;
use crate::parse::{parse_blame_porcelain, parse_commit_log, COMMIT_LOG_FORMAT};
use crate::runner::GitRunner;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LayoutRow {
    pub lane: usize,
    pub active_lanes: Vec<usize>,
    pub next_active_lanes: Vec<usize>,
    pub parent_lanes: Vec<usize>,
    pub lane_branches: Vec<LaneBranchEntry>,
}

#[derive(Debug, Clone, Default)]
pub struct HistoryCache {
    pub loaded: bool,
    pub fingerprint: String,
    pub commits: Vec<CommitBase>,
    pub layout: Vec<LayoutRow>,
    pub max_lanes: usize,
    pub reachable: HashMap<String, HashSet<String>>,
}

fn branch_labels(refs: &[String]) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for r in refs {
        if r.starts_with("tag: ") {
            continue;
        }
        let cleaned = if let Some(idx) = r.rfind(" -> ") {
            &r[idx + 4..]
        } else {
            r.as_str()
        };
        if !cleaned.is_empty() && cleaned != "HEAD" && !cleaned.ends_with("/HEAD") {
            if !out.iter().any(|x| x == cleaned) {
                out.push(cleaned.to_string());
            }
        }
    }
    out
}

fn merge_labels(current: &[String], incoming: &[String]) -> Vec<String> {
    let mut out = current.to_vec();
    for item in incoming {
        if !out.contains(item) {
            out.push(item.clone());
        }
    }
    out
}

pub fn compute_layout(commits: &[CommitBase]) -> (Vec<LayoutRow>, usize) {
    let mut lanes: Vec<Option<String>> = Vec::new();
    let mut labels: Vec<Vec<String>> = Vec::new();
    let mut rows: Vec<LayoutRow> = Vec::with_capacity(commits.len());
    let mut max_lanes: usize = 1;

    for commit in commits {
        let lane = if let Some(pos) = lanes.iter().position(|x| x.as_deref() == Some(&commit.hash))
        {
            pos
        } else if let Some(free) = lanes.iter().position(|x| x.is_none()) {
            lanes[free] = Some(commit.hash.clone());
            labels[free] = Vec::new();
            free
        } else {
            let idx = lanes.len();
            lanes.push(Some(commit.hash.clone()));
            labels.push(Vec::new());
            idx
        };

        let new_labels = branch_labels(&commit.refs);
        labels[lane] = merge_labels(&labels[lane], &new_labels);

        let active_lanes: Vec<usize> = lanes
            .iter()
            .enumerate()
            .filter_map(|(i, v)| v.as_ref().map(|_| i))
            .collect();

        let lane_branches: Vec<LaneBranchEntry> = active_lanes
            .iter()
            .filter_map(|&al| {
                let lbls = labels.get(al).cloned().unwrap_or_default();
                if lbls.is_empty() {
                    None
                } else {
                    Some(LaneBranchEntry {
                        lane: al,
                        labels: lbls,
                    })
                }
            })
            .collect();

        lanes[lane] = None;
        let current_labels = std::mem::take(&mut labels[lane]);
        let mut parent_lanes: Vec<usize> = Vec::new();

        for (p_idx, parent) in commit.parents.iter().enumerate() {
            let parent_lane =
                if let Some(pos) = lanes.iter().position(|x| x.as_deref() == Some(parent)) {
                    pos
                } else {
                    let target = if p_idx == 0 && lanes[lane].is_none() {
                        Some(lane)
                    } else {
                        lanes.iter().position(|x| x.is_none())
                    };
                    match target {
                        Some(t) => {
                            lanes[t] = Some(parent.clone());
                            t
                        }
                        None => {
                            let t = lanes.len();
                            lanes.push(Some(parent.clone()));
                            labels.push(Vec::new());
                            t
                        }
                    }
                };

            if p_idx == 0 {
                labels[parent_lane] = merge_labels(&labels[parent_lane], &current_labels);
            }
            parent_lanes.push(parent_lane);
        }

        while lanes.last().is_some_and(|x| x.is_none()) {
            lanes.pop();
            labels.pop();
        }

        let next_active_lanes: Vec<usize> = lanes
            .iter()
            .enumerate()
            .filter_map(|(i, v)| v.as_ref().map(|_| i))
            .collect();

        max_lanes = max_lanes
            .max(lane + 1)
            .max(active_lanes.iter().map(|v| v + 1).max().unwrap_or(1))
            .max(next_active_lanes.iter().map(|v| v + 1).max().unwrap_or(1))
            .max(parent_lanes.iter().map(|v| v + 1).max().unwrap_or(1));

        rows.push(LayoutRow {
            lane,
            active_lanes,
            next_active_lanes,
            parent_lanes,
            lane_branches,
        });
    }

    (rows, max_lanes)
}

async fn history_fingerprint(runner: &GitRunner, repo_path: &str) -> String {
    runner
        .run(repo_path, &["show-ref", "--head"], true)
        .await
        .map(|r| r.stdout.trim().to_string())
        .unwrap_or_default()
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DiskHistoryCache {
    fingerprint: String,
    commits: Vec<CommitBase>,
    layout: Vec<LayoutRow>,
    max_lanes: usize,
}

pub async fn ensure_history(
    runner: &GitRunner,
    repo_path: &str,
    data_dir: &Path,
    cache: &mut HistoryCache,
) -> ApiResult<()> {
    let fp = history_fingerprint(runner, repo_path).await;
    if cache.loaded && cache.fingerprint == fp {
        return Ok(());
    }

    let cache_file = data_dir
        .join("cache")
        .join(format!("{}.json", repo_id_for_path(repo_path)));
    if let Ok(raw_str) = fs::read_to_string(&cache_file).await {
        if let Ok(disk) = serde_json::from_str::<DiskHistoryCache>(&raw_str) {
            if disk.fingerprint == fp {
                cache.commits = disk.commits;
                cache.layout = disk.layout;
                cache.max_lanes = disk.max_lanes.max(1);
                cache.reachable.clear();
                cache.fingerprint = fp;
                cache.loaded = true;
                return Ok(());
            }
        }
    }

    let format_arg = format!("--format={COMMIT_LOG_FORMAT}");
    let res = runner
        .run(
            repo_path,
            &[
                "log",
                "--branches",
                "--remotes",
                "--tags",
                "HEAD",
                &format_arg,
                "--topo-order",
            ],
            true,
        )
        .await?;

    cache.commits = if res.exit_code == 0 {
        parse_commit_log(&res.stdout)
    } else {
        Vec::new()
    };
    let (rows, max_lanes) = compute_layout(&cache.commits);
    cache.layout = rows;
    cache.max_lanes = max_lanes;
    cache.reachable.clear();
    cache.fingerprint = fp.clone();
    cache.loaded = true;

    if let Some(parent) = cache_file.parent() {
        let _ = fs::create_dir_all(parent).await;
    }
    if let Ok(json_str) = serde_json::to_string(&DiskHistoryCache {
        fingerprint: fp,
        commits: cache.commits.clone(),
        layout: cache.layout.clone(),
        max_lanes: cache.max_lanes,
    }) {
        let _ = fs::write(&cache_file, json_str).await;
    }

    Ok(())
}

pub async fn get_history_page(
    runner: &GitRunner,
    repo_path: &str,
    data_dir: &Path,
    cache: &mut HistoryCache,
    offset: usize,
    limit: usize,
    ref_filter: Option<String>,
    query: Option<String>,
) -> ApiResult<HistoryPage> {
    ensure_history(runner, repo_path, data_dir, cache).await?;

    let mut filtered_commits: Option<Vec<CommitBase>> = None;

    if let Some(ref rf) = ref_filter {
        if !rf.is_empty() {
            if !cache.reachable.contains_key(rf) {
                let res = runner.run(repo_path, &["rev-list", rf], true).await?;
                let set: HashSet<String> = res
                    .stdout
                    .lines()
                    .filter(|s| !s.is_empty())
                    .map(|s| s.to_string())
                    .collect();
                cache.reachable.insert(rf.clone(), set);
            }
            let set = cache.reachable.get(rf);
            let list: Vec<CommitBase> = cache
                .commits
                .iter()
                .filter(|c| set.is_some_and(|s| s.contains(&c.hash)))
                .cloned()
                .collect();
            filtered_commits = Some(list);
        }
    }

    if let Some(ref q) = query {
        let q_lower = q.trim().to_lowercase();
        if !q_lower.is_empty() {
            let source = filtered_commits.as_ref().unwrap_or(&cache.commits);
            let list: Vec<CommitBase> = source
                .iter()
                .filter(|c| {
                    c.hash.starts_with(&q_lower)
                        || c.subject.to_lowercase().contains(&q_lower)
                        || c.author_name.to_lowercase().contains(&q_lower)
                        || c.author_email.to_lowercase().contains(&q_lower)
                        || c.refs.iter().any(|r| r.to_lowercase().contains(&q_lower))
                })
                .cloned()
                .collect();
            filtered_commits = Some(list);
        }
    }

    let (commits_ref, layout_rows, max_lanes) = if let Some(ref custom) = filtered_commits {
        let (rows, ml) = compute_layout(custom);
        (custom.as_slice(), rows, ml)
    } else {
        (cache.commits.as_slice(), cache.layout.clone(), cache.max_lanes)
    };

    let total = commits_ref.len();
    let end = (offset + limit).min(total);
    let slice_commits = if offset < total {
        &commits_ref[offset..end]
    } else {
        &[]
    };
    let slice_rows = if offset < layout_rows.len() {
        &layout_rows[offset..end.min(layout_rows.len())]
    } else {
        &[]
    };

    let mut summaries: Vec<CommitSummary> = Vec::with_capacity(slice_commits.len());
    for (idx, commit) in slice_commits.iter().enumerate() {
        let row = slice_rows.get(idx).cloned().unwrap_or(LayoutRow {
            lane: 0,
            active_lanes: vec![0],
            next_active_lanes: Vec::new(),
            parent_lanes: Vec::new(),
            lane_branches: Vec::new(),
        });
        summaries.push(CommitSummary {
            base: commit.clone(),
            lane: row.lane,
            active_lanes: row.active_lanes,
            next_active_lanes: row.next_active_lanes,
            parent_lanes: row.parent_lanes,
            lane_branches: row.lane_branches,
            max_lanes,
        });
    }

    Ok(HistoryPage {
        commits: summaries,
        offset,
        limit,
        total,
        max_lanes,
        r#ref: ref_filter,
        query,
    })
}

pub async fn get_blame(
    runner: &GitRunner,
    repo_path: &str,
    file_path: &str,
    offset: usize,
    limit: usize,
) -> ApiResult<BlameResponse> {
    let res = runner
        .run(
            repo_path,
            &["blame", "--line-porcelain", "--", file_path],
            true,
        )
        .await?;
    let all = if res.exit_code == 0 {
        parse_blame_porcelain(&res.stdout)
    } else {
        Vec::new()
    };
    let total = all.len();
    let lines = if offset < total {
        all.into_iter().skip(offset).take(limit).collect()
    } else {
        Vec::new()
    };
    Ok(BlameResponse {
        path: file_path.to_string(),
        lines,
        offset,
        limit,
        total,
    })
}

pub async fn get_file_history(
    runner: &GitRunner,
    repo_path: &str,
    file_path: &str,
    offset: usize,
    limit: usize,
) -> ApiResult<FileHistoryResponse> {
    let format_arg = format!("--format={COMMIT_LOG_FORMAT}");
    let mut res = runner
        .run(
            repo_path,
            &["log", "--all", "--follow", &format_arg, "--", file_path],
            true,
        )
        .await?;
    if res.exit_code != 0 {
        res = runner
            .run(
                repo_path,
                &["log", "--follow", &format_arg, "--", file_path],
                true,
            )
            .await?;
    }
    let all = if res.exit_code == 0 {
        parse_commit_log(&res.stdout)
    } else {
        Vec::new()
    };
    let total = all.len();
    let commits = if offset < total {
        all.into_iter().skip(offset).take(limit).collect()
    } else {
        Vec::new()
    };
    Ok(FileHistoryResponse {
        path: file_path.to_string(),
        commits,
        offset,
        limit,
        total,
    })
}
