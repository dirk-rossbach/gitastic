use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tokio::fs;

use crate::error::{ApiError, ApiResult};

const BUILTIN_IDS: &[&str] = &[
    "gorgeous",
    "focus",
    "synthwave",
    "transilvania",
    "ubernerd",
    "daybreak",
    "vellum",
    "blueprint",
    "lemon-baby",
    "cats-cradle",
    "ink",
    "8bit",
    "smelly-socks",
    "nightmare-main-branch",
    "domino",
];

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ThemeManifest {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub tagline: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub keywords: String,
    #[serde(default)]
    pub badge: Option<String>,
    #[serde(default)]
    pub author: Option<String>,
    pub modes: Vec<String>,
    #[serde(default)]
    pub swatches: Vec<String>,
    #[serde(default)]
    pub lane_colors: Vec<String>,
}

pub fn themes_dir(data_dir: &Path) -> PathBuf {
    data_dir.join("themes")
}

fn valid_id(id: &str) -> bool {
    let mut chars = id.chars();
    match chars.next() {
        Some(c) if c.is_ascii_lowercase() || c.is_ascii_digit() => {}
        _ => return false,
    }
    id.len() >= 2 && id.len() <= 41 && id.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
}

fn assert_valid_id(id: &str) -> ApiResult<()> {
    if !valid_id(id) {
        return Err(ApiError::new(
            400,
            "INVALID_THEME_ID",
            "Theme ids may only use lowercase letters, numbers and dashes.",
        ));
    }
    if BUILTIN_IDS.contains(&id) {
        return Err(ApiError::new(
            400,
            "RESERVED_THEME_ID",
            format!("\"{id}\" is a built-in theme id."),
        ));
    }
    Ok(())
}

fn theme_file(data_dir: &Path, id: &str) -> ApiResult<PathBuf> {
    assert_valid_id(id)?;
    Ok(themes_dir(data_dir).join(format!("{id}.css")))
}

fn parse_metadata(css: &str) -> ApiResult<ThemeManifest> {
    let start = css
        .find("/* @gitastic-theme")
        .ok_or_else(|| {
            ApiError::new(
                400,
                "MISSING_THEME_METADATA",
                "The theme file needs a /* @gitastic-theme { ... } */ metadata block.",
            )
        })?;
    let after = &css[start..];
    let comment_end = after.find("*/").ok_or_else(|| {
        ApiError::new(
            400,
            "MISSING_THEME_METADATA",
            "The theme metadata block is not closed with */.",
        )
    })?;
    let comment = &after[..comment_end];
    let json_start = comment.find('{').ok_or_else(|| {
        ApiError::new(400, "INVALID_THEME_METADATA", "Theme metadata is missing a JSON object.")
    })?;
    let json_end = comment.rfind('}').ok_or_else(|| {
        ApiError::new(400, "INVALID_THEME_METADATA", "Theme metadata is missing a JSON object.")
    })?;
    let raw: Value = serde_json::from_str(&comment[json_start..=json_end]).map_err(|_| {
        ApiError::new(400, "INVALID_THEME_METADATA", "Theme metadata is not valid JSON.")
    })?;
    let manifest: ThemeManifest = serde_json::from_value(raw).map_err(|error| {
        ApiError::with_details(
            400,
            "INVALID_THEME_METADATA",
            "Theme metadata is invalid.",
            serde_json::json!({ "message": error.to_string() }),
        )
    })?;

    if !valid_id(&manifest.id) {
        return Err(ApiError::new(
            400,
            "INVALID_THEME_ID",
            "Theme ids may only use lowercase letters, numbers and dashes.",
        ));
    }
    if manifest.name.trim().is_empty() {
        return Err(ApiError::new(400, "INVALID_THEME_METADATA", "Theme name is required."));
    }
    if manifest.modes.is_empty()
        || manifest
            .modes
            .iter()
            .any(|mode| mode != "dark" && mode != "light")
    {
        return Err(ApiError::new(
            400,
            "INVALID_THEME_METADATA",
            "Theme modes must be \"dark\" and/or \"light\".",
        ));
    }
    if manifest.swatches.len() > 8 || manifest.lane_colors.len() > 16 {
        return Err(ApiError::new(
            400,
            "INVALID_THEME_METADATA",
            "Theme palettes exceed the supported size.",
        ));
    }
    Ok(manifest)
}

pub async fn ensure_themes_dir(data_dir: &Path) -> ApiResult<()> {
    fs::create_dir_all(themes_dir(data_dir))
        .await
        .map_err(|_| ApiError::new(500, "THEMES_DIR_FAILED", "Could not create the themes folder."))
}

pub async fn list_themes(data_dir: &Path) -> ApiResult<Vec<ThemeManifest>> {
    ensure_themes_dir(data_dir).await?;
    let mut entries = fs::read_dir(themes_dir(data_dir)).await.map_err(|_| {
        ApiError::new(500, "THEMES_DIR_FAILED", "Could not read the themes folder.")
    })?;
    let mut themes = Vec::new();
    while let Ok(Some(entry)) = entries.next_entry().await {
        let name = entry.file_name().to_string_lossy().to_string();
        let Some(id) = name.strip_suffix(".css") else {
            continue;
        };
        if assert_valid_id(id).is_err() {
            continue;
        }
        if let Ok(css) = fs::read_to_string(entry.path()).await {
            if let Ok(manifest) = parse_metadata(&css) {
                themes.push(manifest);
            }
        }
    }
    themes.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    Ok(themes)
}

pub async fn read_theme_css(data_dir: &Path, id: &str) -> ApiResult<Option<String>> {
    let file = theme_file(data_dir, id)?;
    Ok(fs::read_to_string(file).await.ok())
}

pub async fn import_theme(data_dir: &Path, css: &str) -> ApiResult<ThemeManifest> {
    ensure_themes_dir(data_dir).await?;
    let manifest = parse_metadata(css)?;
    assert_valid_id(&manifest.id)?;
    fs::write(theme_file(data_dir, &manifest.id)?, css)
        .await
        .map_err(|_| ApiError::new(500, "THEME_WRITE_FAILED", "Could not save the theme file."))?;
    Ok(manifest)
}

pub async fn delete_theme(data_dir: &Path, id: &str) -> ApiResult<bool> {
    let file = theme_file(data_dir, id)?;
    Ok(fs::remove_file(file).await.is_ok())
}

const COMMUNITY_REPO: &str = "dirk-rossbach/gitastic";
const COMMUNITY_BRANCH: &str = "main";
const COMMUNITY_DIR: &str = "community-themes";
const COMMUNITY_RAW: &str =
    "https://raw.githubusercontent.com/dirk-rossbach/gitastic/main/community-themes";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommunityTheme {
    #[serde(flatten)]
    pub manifest: ThemeManifest,
    pub path: String,
    pub installed: bool,
}

#[derive(Debug, Deserialize)]
struct CommunityIndex {
    themes: Vec<CommunityIndexEntry>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CommunityIndexEntry {
    id: String,
    name: String,
    mode: String,
    #[serde(default)]
    tagline: Option<String>,
    #[serde(default)]
    description: Option<String>,
    #[serde(default)]
    keywords: Option<String>,
    #[serde(default)]
    badge: Option<String>,
    #[serde(default)]
    author: Option<String>,
    #[serde(default)]
    swatches: Option<Vec<String>>,
    #[serde(default)]
    lane_colors: Option<Vec<String>>,
    path: String,
}

async fn fetch_community_text(url: &str) -> Option<String> {
    let client = reqwest::Client::new();
    let response = client
        .get(url)
        .header("User-Agent", "gitastic")
        .header("Accept", "text/plain, application/json")
        .send()
        .await
        .ok()?;
    if !response.status().is_success() {
        return None;
    }
    response.text().await.ok()
}

fn data_style_values(css: &str) -> Vec<String> {
    let mut values = Vec::new();
    let mut search = 0usize;
    while let Some(relative) = css[search..].find("data-style") {
        let index = search + relative;
        let after = css[index + "data-style".len()..].trim_start();
        if let Some(rest) = after.strip_prefix('=') {
            let rest = rest.trim_start();
            if let Some(quote) = rest.chars().next() {
                if quote == '"' || quote == '\'' {
                    let body = &rest[quote.len_utf8()..];
                    if let Some(end) = body.find(quote) {
                        values.push(body[..end].to_string());
                        let absolute = body.as_ptr() as usize - css.as_ptr() as usize;
                        search = absolute + end + quote.len_utf8();
                        continue;
                    }
                }
            }
        }
        search = index + "data-style".len();
    }
    values
}

fn selectors_in(css: &str) -> Vec<String> {
    let mut selectors = Vec::new();
    let mut buffer = String::new();
    let mut chars = css.chars().peekable();
    while let Some(ch) = chars.next() {
        if ch == '/' && chars.peek() == Some(&'*') {
            chars.next();
            while let Some(next) = chars.next() {
                if next == '*' && chars.peek() == Some(&'/') {
                    chars.next();
                    break;
                }
            }
            continue;
        }
        if ch == '"' || ch == '\'' {
            let quote = ch;
            buffer.push(ch);
            while let Some(next) = chars.next() {
                buffer.push(next);
                if next == '\\' {
                    if let Some(escaped) = chars.next() {
                        buffer.push(escaped);
                    }
                    continue;
                }
                if next == quote {
                    break;
                }
            }
            continue;
        }
        if ch == '{' {
            selectors.push(buffer.trim().to_string());
            buffer.clear();
            continue;
        }
        if ch == '}' {
            buffer.clear();
            continue;
        }
        buffer.push(ch);
    }
    selectors.retain(|selector| !selector.is_empty());
    selectors
}

pub fn assert_safe_community_css(css: &str, id: &str) -> ApiResult<()> {
    let lower = css.to_lowercase();
    for pattern in [
        "@import",
        "@font-face",
        "@charset",
        "@namespace",
        "@keyframes",
        "-moz-binding",
        "behavior:",
        "expression(",
        "javascript:",
        "url(",
    ] {
        if lower.contains(pattern) {
            return Err(ApiError::new(
                400,
                "UNSAFE_THEME_CSS",
                "The theme contains CSS features that are not allowed for community themes.",
            ));
        }
    }
    let values = data_style_values(css);
    if values.is_empty() || values.iter().any(|value| value != id) {
        return Err(ApiError::new(
            400,
            "UNSAFE_THEME_CSS",
            "Every selector in a community theme must be scoped to its own data-style id.",
        ));
    }
    for selector in selectors_in(css) {
        if selector.starts_with('@') {
            continue;
        }
        if !selector.contains("data-style") {
            return Err(ApiError::new(
                400,
                "UNSAFE_THEME_CSS",
                "Every rule in a community theme must be scoped to its data-style id.",
            ));
        }
    }
    Ok(())
}

fn entry_to_community(entry: &CommunityIndexEntry, installed: &[String]) -> CommunityTheme {
    CommunityTheme {
        manifest: ThemeManifest {
            id: entry.id.clone(),
            name: entry.name.clone(),
            tagline: entry.tagline.clone().unwrap_or_default(),
            description: entry.description.clone().unwrap_or_default(),
            keywords: entry.keywords.clone().unwrap_or_default(),
            badge: entry.badge.clone(),
            author: entry.author.clone(),
            modes: vec![if entry.mode == "light" {
                "light".to_string()
            } else {
                "dark".to_string()
            }],
            swatches: entry.swatches.clone().unwrap_or_default(),
            lane_colors: entry.lane_colors.clone().unwrap_or_default(),
        },
        path: entry.path.clone(),
        installed: installed.iter().any(|id| id == &entry.id),
    }
}

async fn load_community_index() -> Option<Vec<CommunityIndexEntry>> {
    let raw = fetch_community_text(&format!("{COMMUNITY_RAW}/index.json")).await?;
    let parsed: CommunityIndex = serde_json::from_str(&raw).ok()?;
    Some(parsed.themes)
}

async fn scan_community_directory() -> ApiResult<Vec<CommunityIndexEntry>> {
    let url = format!(
        "https://api.github.com/repos/{COMMUNITY_REPO}/contents/{COMMUNITY_DIR}?ref={COMMUNITY_BRANCH}"
    );
    let client = reqwest::Client::new();
    let response = client
        .get(&url)
        .header("User-Agent", "gitastic")
        .header("Accept", "application/vnd.github+json")
        .send()
        .await
        .map_err(|_| {
            ApiError::new(502, "COMMUNITY_LIST_FAILED", "Could not reach the community themes folder.")
        })?;
    if !response.status().is_success() {
        return Err(ApiError::new(
            502,
            "COMMUNITY_LIST_FAILED",
            "Could not read the community themes folder.",
        ));
    }
    let entries: Vec<Value> = response.json().await.unwrap_or_default();
    let mut themes = Vec::new();
    for entry in entries {
        let name = entry.get("name").and_then(Value::as_str).unwrap_or("");
        let download_url = entry.get("download_url").and_then(Value::as_str);
        let Some(download_url) = download_url else {
            continue;
        };
        if !name.ends_with(".css") {
            continue;
        }
        let id = name.trim_end_matches(".css");
        let Some(css) = fetch_community_text(download_url).await else {
            continue;
        };
        if let Ok(manifest) = parse_metadata(&css).map(|mut m| {
            m.id = id.to_string();
            m
        }) {
            themes.push(CommunityIndexEntry {
                id: manifest.id,
                name: manifest.name,
                mode: if manifest.modes.iter().any(|mode| mode == "dark") {
                    "dark".to_string()
                } else {
                    "light".to_string()
                },
                tagline: Some(manifest.tagline),
                description: Some(manifest.description),
                keywords: Some(manifest.keywords),
                badge: manifest.badge,
                author: manifest.author,
                swatches: Some(manifest.swatches),
                lane_colors: Some(manifest.lane_colors),
                path: name.to_string(),
            });
        }
    }
    Ok(themes)
}

pub async fn list_community_themes(data_dir: &Path) -> ApiResult<Vec<CommunityTheme>> {
    let installed: Vec<String> = list_themes(data_dir)
        .await?
        .into_iter()
        .map(|theme| theme.id)
        .collect();
    let entries = match load_community_index().await {
        Some(entries) => entries,
        None => scan_community_directory().await?,
    };
    let mut themes: Vec<CommunityTheme> = entries
        .iter()
        .map(|entry| entry_to_community(entry, &installed))
        .collect();
    themes.sort_by(|a, b| a.manifest.name.to_lowercase().cmp(&b.manifest.name.to_lowercase()));
    Ok(themes)
}

pub async fn install_community_theme(data_dir: &Path, id: &str) -> ApiResult<CommunityTheme> {
    assert_valid_id(id)?;
    let index = load_community_index().await;
    let path = index
        .as_ref()
        .and_then(|entries| entries.iter().find(|entry| entry.id == id))
        .map(|entry| entry.path.clone())
        .unwrap_or_else(|| format!("{id}.css"));
    let css = fetch_community_text(&format!("{COMMUNITY_RAW}/{path}"))
        .await
        .ok_or_else(|| ApiError::new(404, "THEME_NOT_FOUND", format!("Could not download theme: {id}")))?;
    assert_safe_community_css(&css, id)?;
    let manifest = import_theme(data_dir, &css).await?;
    Ok(CommunityTheme {
        manifest,
        path,
        installed: true,
    })
}
