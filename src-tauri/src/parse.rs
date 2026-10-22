use std::collections::BTreeMap;
use chrono::{TimeZone, Utc};

use crate::models::{
    short_hash, BlameLine, Branch, CommitBase, ConflictBlock, DiffFile, FileStatus, Remote, Stash,
    Status, Tag,
};

pub const COMMIT_LOG_FORMAT: &str =
    "%H%x00%P%x00%an%x00%ae%x00%aI%x00%cn%x00%ce%x00%cI%x00%s%x00%b%x00%D%x1e";

pub const BRANCH_FORMAT: &str =
    "%(refname:short)%00%(refname)%00%(objectname)%00%(upstream:short)%00%(HEAD)%00%(committerdate:iso-strict)%00%(subject)";

pub const TAG_FORMAT: &str =
    "%(refname:short)%00%(refname)%00%(objectname)%00%(objecttype)%00%(taggername)%00%(creatordate:iso-strict)%00%(subject)";

fn split_refs(value: &str) -> Vec<String> {
    value
        .split(',')
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string())
        .collect()
}

fn kind_from_status(x: char, y: char) -> String {
    if x == '?' && y == '?' {
        return "untracked".to_string();
    }
    if x == 'U' || y == 'U' || (x == 'A' && y == 'A') || (x == 'D' && y == 'D') {
        return "conflicted".to_string();
    }
    let code = if x != '.' { x } else { y };
    match code {
        'A' => "added",
        'D' => "deleted",
        'R' => "renamed",
        'C' => "copied",
        'M' | 'T' => "modified",
        _ => "unknown",
    }
    .to_string()
}

pub fn parse_status_v2(output: &str) -> Status {
    let mut branch: Option<String> = None;
    let mut head: Option<String> = None;
    let mut upstream: Option<String> = None;
    let mut ahead: u32 = 0;
    let mut behind: u32 = 0;
    let mut files: Vec<FileStatus> = Vec::new();

    let tokens: Vec<&str> = output.split('\0').collect();
    let mut idx = 0;

    while idx < tokens.len() {
        let token = tokens[idx];
        if token.is_empty() {
            idx += 1;
            continue;
        }

        if let Some(header) = token.strip_prefix("# ") {
            if let Some(val) = header.strip_prefix("branch.oid ") {
                let v = val.trim();
                if !v.is_empty() && v != "(initial)" {
                    head = Some(v.to_string());
                }
            } else if let Some(val) = header.strip_prefix("branch.head ") {
                let v = val.trim();
                if !v.is_empty() && v != "(detached)" {
                    branch = Some(v.to_string());
                }
            } else if let Some(val) = header.strip_prefix("branch.upstream ") {
                let v = val.trim();
                if !v.is_empty() {
                    upstream = Some(v.to_string());
                }
            } else if let Some(val) = header.strip_prefix("branch.ab ") {
                for part in val.split_whitespace() {
                    if let Some(a) = part.strip_prefix('+') {
                        ahead = a.parse::<u32>().unwrap_or(0);
                    } else if let Some(b) = part.strip_prefix('-') {
                        behind = b.parse::<u32>().unwrap_or(0);
                    }
                }
            }
            idx += 1;
            continue;
        }

        let first = token.chars().next().unwrap_or(' ');
        if first == '1' {
            let parts: Vec<&str> = token.splitn(9, ' ').collect();
            let xy = parts.get(1).copied().unwrap_or("..");
            let path = parts.get(8).copied().unwrap_or("");
            if !path.is_empty() {
                let x = xy.chars().next().unwrap_or('.');
                let y = xy.chars().nth(1).unwrap_or('.');
                files.push(FileStatus {
                    path: path.to_string(),
                    orig_path: None,
                    index: x.to_string(),
                    worktree: y.to_string(),
                    staged: x != '.' && x != '?',
                    unstaged: y != '.' && y != '?',
                    untracked: false,
                    conflicted: false,
                    kind: kind_from_status(x, y),
                });
            }
        } else if first == '2' {
            let parts: Vec<&str> = token.splitn(10, ' ').collect();
            let xy = parts.get(1).copied().unwrap_or("..");
            let path = parts.get(9).copied().unwrap_or("");
            let orig_path = tokens.get(idx + 1).map(|s| s.to_string());
            if orig_path.is_some() {
                idx += 1;
            }
            if !path.is_empty() {
                let x = xy.chars().next().unwrap_or('.');
                let y = xy.chars().nth(1).unwrap_or('.');
                files.push(FileStatus {
                    path: path.to_string(),
                    orig_path,
                    index: x.to_string(),
                    worktree: y.to_string(),
                    staged: x != '.' && x != '?',
                    unstaged: y != '.' && y != '?',
                    untracked: false,
                    conflicted: false,
                    kind: kind_from_status(x, y),
                });
            }
        } else if first == 'u' {
            let parts: Vec<&str> = token.splitn(11, ' ').collect();
            let xy = parts.get(1).copied().unwrap_or("UU");
            let path = parts.get(10).copied().unwrap_or("");
            if !path.is_empty() {
                let x = xy.chars().next().unwrap_or('U');
                let y = xy.chars().nth(1).unwrap_or('U');
                files.push(FileStatus {
                    path: path.to_string(),
                    orig_path: None,
                    index: x.to_string(),
                    worktree: y.to_string(),
                    staged: false,
                    unstaged: true,
                    untracked: false,
                    conflicted: true,
                    kind: "conflicted".to_string(),
                });
            }
        } else if first == '?' || first == '!' {
            let path = if token.len() > 2 { &token[2..] } else { "" };
            if !path.is_empty() {
                files.push(FileStatus {
                    path: path.to_string(),
                    orig_path: None,
                    index: "?".to_string(),
                    worktree: "?".to_string(),
                    staged: false,
                    unstaged: false,
                    untracked: first == '?',
                    conflicted: false,
                    kind: if first == '?' { "untracked" } else { "unknown" }.to_string(),
                });
            }
        }

        idx += 1;
    }

    Status {
        branch,
        head,
        upstream,
        ahead,
        behind,
        operation: None,
        files,
    }
}

pub fn parse_commit_log(output: &str) -> Vec<CommitBase> {
    output
        .split('\x1e')
        .map(|rec| rec.trim_start_matches('\n'))
        .filter(|rec| !rec.is_empty())
        .filter_map(|rec| {
            let fields: Vec<&str> = rec.split('\0').collect();
            let hash = fields.first().copied().unwrap_or("").trim();
            if hash.is_empty() {
                return None;
            }
            let parents_raw = fields.get(1).copied().unwrap_or("");
            let parents: Vec<String> = parents_raw
                .split(' ')
                .filter(|s| !s.is_empty())
                .map(|s| s.to_string())
                .collect();
            Some(CommitBase {
                hash: hash.to_string(),
                short_hash: short_hash(hash),
                parents,
                author_name: fields.get(2).copied().unwrap_or("").to_string(),
                author_email: fields.get(3).copied().unwrap_or("").to_string(),
                author_date: fields.get(4).copied().unwrap_or("").to_string(),
                committer_name: fields.get(5).copied().unwrap_or("").to_string(),
                committer_email: fields.get(6).copied().unwrap_or("").to_string(),
                committer_date: fields.get(7).copied().unwrap_or("").to_string(),
                subject: fields.get(8).copied().unwrap_or("").to_string(),
                body: fields.get(9).copied().unwrap_or("").to_string(),
                refs: split_refs(fields.get(10).copied().unwrap_or("")),
            })
        })
        .collect()
}

pub fn parse_branches(output: &str) -> Vec<Branch> {
    output
        .lines()
        .filter(|line| !line.is_empty())
        .filter_map(|line| {
            let parts: Vec<&str> = line.split('\0').collect();
            let name = parts.first().copied().unwrap_or("");
            let r#ref = parts.get(1).copied().unwrap_or("");
            if name.is_empty() || r#ref.ends_with("/HEAD") || name.ends_with("/HEAD") {
                return None;
            }
            let hash = parts.get(2).copied().unwrap_or("");
            let upstream = parts.get(3).copied().unwrap_or("");
            let head = parts.get(4).copied().unwrap_or("");
            let date = parts.get(5).copied().unwrap_or("");
            let subject = parts.get(6).copied().unwrap_or("");
            Some(Branch {
                name: name.to_string(),
                r#ref: r#ref.to_string(),
                hash: hash.to_string(),
                upstream: if upstream.is_empty() {
                    None
                } else {
                    Some(upstream.to_string())
                },
                current: head == "*",
                remote: r#ref.starts_with("refs/remotes/"),
                date: if date.is_empty() {
                    None
                } else {
                    Some(date.to_string())
                },
                subject: subject.to_string(),
            })
        })
        .collect()
}

pub fn parse_tags(output: &str) -> Vec<Tag> {
    output
        .lines()
        .filter(|line| !line.is_empty())
        .map(|line| {
            let parts: Vec<&str> = line.split('\0').collect();
            let name = parts.first().copied().unwrap_or("");
            let r#ref = parts.get(1).copied().unwrap_or("");
            let hash = parts.get(2).copied().unwrap_or("");
            let r#type = parts.get(3).copied().unwrap_or("");
            let tagger = parts.get(4).copied().unwrap_or("");
            let date = parts.get(5).copied().unwrap_or("");
            let subject = parts.get(6).copied().unwrap_or("");
            Tag {
                name: name.to_string(),
                r#ref: r#ref.to_string(),
                hash: hash.to_string(),
                r#type: r#type.to_string(),
                tagger: if tagger.is_empty() {
                    None
                } else {
                    Some(tagger.to_string())
                },
                date: if date.is_empty() {
                    None
                } else {
                    Some(date.to_string())
                },
                subject: subject.to_string(),
            }
        })
        .collect()
}

pub fn parse_remotes(output: &str) -> Vec<Remote> {
    let mut map: BTreeMap<String, Remote> = BTreeMap::new();
    for line in output.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        let Some((name, rest)) = trimmed.split_once('\t') else {
            continue;
        };
        let (url, is_push) = if let Some(u) = rest.strip_suffix(" (fetch)") {
            (u, false)
        } else if let Some(u) = rest.strip_suffix(" (push)") {
            (u, true)
        } else {
            continue;
        };
        let entry = map.entry(name.to_string()).or_insert_with(|| Remote {
            name: name.to_string(),
            url: String::new(),
            push_url: String::new(),
        });
        if is_push {
            entry.push_url = url.to_string();
        } else {
            entry.url = url.to_string();
        }
    }
    map.into_values()
        .map(|mut r| {
            if r.push_url.is_empty() {
                r.push_url = r.url.clone();
            }
            r
        })
        .collect()
}

pub fn parse_stashes(output: &str) -> Vec<Stash> {
    output
        .lines()
        .filter(|line| !line.is_empty())
        .map(|line| {
            let parts: Vec<&str> = line.split('\0').collect();
            let r#ref = parts.first().copied().unwrap_or("");
            let hash = parts.get(1).copied().unwrap_or("");
            let message = parts.get(2).copied().unwrap_or("");
            let date = parts.get(3).copied().unwrap_or("");
            let index = r#ref
                .strip_prefix("stash@{")
                .and_then(|s| s.strip_suffix('}'))
                .and_then(|n| n.parse::<usize>().ok())
                .unwrap_or(0);
            Stash {
                index,
                r#ref: r#ref.to_string(),
                hash: hash.to_string(),
                message: message.to_string(),
                date: date.to_string(),
            }
        })
        .collect()
}

pub fn combine_diff_files(numstat_output: &str, name_status_output: &str) -> Vec<DiffFile> {
    #[derive(Clone)]
    struct StatItem {
        path: String,
        old_path: Option<String>,
        additions: usize,
        deletions: usize,
        binary: bool,
    }

    let mut stats: Vec<StatItem> = Vec::new();
    let tokens: Vec<&str> = numstat_output.split('\0').collect();
    let mut idx = 0;
    while idx < tokens.len() {
        let token = tokens[idx];
        if token.is_empty() {
            idx += 1;
            continue;
        }
        let parts: Vec<&str> = token.split('\t').collect();
        if parts.len() < 2 {
            idx += 1;
            continue;
        }
        let add_txt = parts.first().copied().unwrap_or("0");
        let del_txt = parts.get(1).copied().unwrap_or("0");
        let inline_path = parts.get(2).copied().unwrap_or("");
        let mut path = inline_path.to_string();
        let mut old_path: Option<String> = None;
        if path.is_empty() {
            old_path = tokens.get(idx + 1).map(|s| s.to_string());
            path = tokens.get(idx + 2).copied().unwrap_or("").to_string();
            idx += 2;
        }
        if !path.is_empty() {
            let binary = add_txt == "-" || del_txt == "-";
            stats.push(StatItem {
                path,
                old_path,
                additions: if binary {
                    0
                } else {
                    add_txt.parse::<usize>().unwrap_or(0)
                },
                deletions: if binary {
                    0
                } else {
                    del_txt.parse::<usize>().unwrap_or(0)
                },
                binary,
            });
        }
        idx += 1;
    }

    let mut map: BTreeMap<String, DiffFile> = BTreeMap::new();
    let ns_tokens: Vec<&str> = name_status_output.split('\0').collect();
    let mut nidx = 0;
    while nidx < ns_tokens.len() {
        let token = ns_tokens[nidx];
        if token.is_empty() {
            nidx += 1;
            continue;
        }
        let code = token.chars().next().unwrap_or('M');
        if code == 'R' || code == 'C' {
            let old_path = ns_tokens.get(nidx + 1).map(|s| s.to_string());
            let path = ns_tokens.get(nidx + 2).copied().unwrap_or("").to_string();
            nidx += 3;
            if !path.is_empty() {
                let st = stats.iter().find(|s| s.path == path || (s.old_path == old_path && old_path.is_some()));
                map.insert(
                    path.clone(),
                    DiffFile {
                        path,
                        old_path,
                        status: if code == 'R' { "renamed" } else { "copied" }.to_string(),
                        additions: st.map(|s| s.additions).unwrap_or(0),
                        deletions: st.map(|s| s.deletions).unwrap_or(0),
                        binary: st.map(|s| s.binary).unwrap_or(false),
                    },
                );
            }
            continue;
        }
        let path = ns_tokens.get(nidx + 1).copied().unwrap_or("").to_string();
        nidx += 2;
        if path.is_empty() {
            continue;
        }
        let status = match code {
            'A' => "added",
            'D' => "deleted",
            'U' => "conflicted",
            _ => "modified",
        }
        .to_string();
        let st = stats.iter().find(|s| s.path == path);
        map.insert(
            path.clone(),
            DiffFile {
                path,
                old_path: None,
                status,
                additions: st.map(|s| s.additions).unwrap_or(0),
                deletions: st.map(|s| s.deletions).unwrap_or(0),
                binary: st.map(|s| s.binary).unwrap_or(false),
            },
        );
    }

    for st in stats {
        map.entry(st.path.clone()).or_insert(DiffFile {
            path: st.path,
            old_path: st.old_path,
            status: "modified".to_string(),
            additions: st.additions,
            deletions: st.deletions,
            binary: st.binary,
        });
    }

    map.into_values().collect()
}

pub fn files_from_patch(patch: &str) -> Vec<DiffFile> {
    let mut files: Vec<DiffFile> = Vec::new();
    let mut current: Option<DiffFile> = None;

    for line in patch.lines() {
        if let Some(rest) = line.strip_prefix("diff --git ") {
            if let Some(prev) = current.take() {
                files.push(prev);
            }
            let (old_path, new_path) = if let Some(idx) = rest.rfind(" b/") {
                let old = rest.strip_prefix("a/").map(|s| &s[..idx.saturating_sub(2)]);
                let newp = &rest[idx + 3..];
                (old.map(|s| s.to_string()), newp.to_string())
            } else {
                (None, rest.to_string())
            };
            current = Some(DiffFile {
                path: new_path,
                old_path,
                status: "modified".to_string(),
                additions: 0,
                deletions: 0,
                binary: false,
            });
            continue;
        }
        let Some(ref mut cur) = current else {
            continue;
        };
        if line.starts_with("new file mode") {
            cur.status = "added".to_string();
        } else if line.starts_with("deleted file mode") {
            cur.status = "deleted".to_string();
        } else if line.starts_with("Binary files") {
            cur.binary = true;
        } else if line.starts_with('+') && !line.starts_with("+++") {
            cur.additions += 1;
        } else if line.starts_with('-') && !line.starts_with("---") {
            cur.deletions += 1;
        }
    }
    if let Some(last) = current {
        files.push(last);
    }
    files
}

pub fn parse_blame_porcelain(output: &str) -> Vec<BlameLine> {
    let mut result: Vec<BlameLine> = Vec::new();
    let mut cur_hash = String::new();
    let mut cur_line: usize = 0;
    let mut cur_author = String::new();
    let mut cur_email = String::new();
    let mut cur_date = String::new();
    let mut cur_summary = String::new();

    for line in output.lines() {
        let parts: Vec<&str> = line.split_whitespace().collect();
        if (parts.len() == 3 || parts.len() == 4)
            && parts[0].trim_start_matches('^').len() == 40
            && parts[0]
                .trim_start_matches('^')
                .chars()
                .all(|c| c.is_ascii_hexdigit())
        {
            if let Ok(line_no) = parts[2].parse::<usize>() {
                cur_hash = parts[0].trim_start_matches('^').to_string();
                cur_line = line_no;
                continue;
            }
        }

        if let Some(content) = line.strip_prefix('\t') {
            if !cur_hash.is_empty() && cur_line > 0 {
                result.push(BlameLine {
                    line: cur_line,
                    hash: cur_hash.clone(),
                    short_hash: short_hash(&cur_hash),
                    author: cur_author.clone(),
                    email: cur_email.clone(),
                    date: cur_date.clone(),
                    summary: cur_summary.clone(),
                    content: content.to_string(),
                });
            }
            continue;
        }

        if let Some(author) = line.strip_prefix("author ") {
            cur_author = author.to_string();
        } else if let Some(mail) = line.strip_prefix("author-mail ") {
            cur_email = mail.trim_matches(|c| c == '<' || c == '>').to_string();
        } else if let Some(ts) = line.strip_prefix("author-time ") {
            if let Ok(secs) = ts.trim().parse::<i64>() {
                if let Some(dt) = Utc.timestamp_opt(secs, 0).single() {
                    cur_date = dt.to_rfc3339();
                }
            }
        } else if let Some(summary) = line.strip_prefix("summary ") {
            cur_summary = summary.to_string();
        }
    }

    result
}

pub fn parse_conflict_markers(content: &str, path: &str) -> Vec<ConflictBlock> {
    let lines: Vec<&str> = content.split('\n').collect();
    let mut blocks: Vec<ConflictBlock> = Vec::new();
    let mut idx = 0;

    while idx < lines.len() {
        if !lines[idx].starts_with("<<<<<<<") {
            idx += 1;
            continue;
        }

        let start_line = idx + 1;
        let mut ours: Vec<&str> = Vec::new();
        let mut base: Vec<&str> = Vec::new();
        let mut theirs: Vec<&str> = Vec::new();
        let mut mode = "ours";
        idx += 1;

        while idx < lines.len() {
            let line = lines[idx];
            if line.starts_with("|||||||") {
                mode = "base";
            } else if line.starts_with("=======") {
                mode = "theirs";
            } else if line.starts_with(">>>>>>>") {
                break;
            } else if mode == "ours" {
                ours.push(line);
            } else if mode == "base" {
                base.push(line);
            } else {
                theirs.push(line);
            }
            idx += 1;
        }

        blocks.push(ConflictBlock {
            id: format!("{path}:{start_line}"),
            start_line,
            end_line: idx + 1,
            ours: ours.join("\n"),
            theirs: theirs.join("\n"),
            base: if base.is_empty() {
                None
            } else {
                Some(base.join("\n"))
            },
        });
        idx += 1;
    }

    blocks
}
