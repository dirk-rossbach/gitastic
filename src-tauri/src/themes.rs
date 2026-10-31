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
