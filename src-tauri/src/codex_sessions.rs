use serde::Serialize;
use std::env;
use std::fs;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::time::SystemTime;

#[derive(Serialize)]
pub struct CodexSessionSnapshot {
    pub id: String,
    pub cwd: String,
    pub modified_at_ms: u128,
    pub size_bytes: u64,
}

pub(crate) fn codex_sessions_dir() -> Option<PathBuf> {
    let home = env::var_os("USERPROFILE")
        .or_else(|| env::var_os("HOME"))
        .map(PathBuf::from)?;
    Some(home.join(".codex").join("sessions"))
}

fn modified_ms(metadata: &fs::Metadata) -> u128 {
    metadata
        .modified()
        .ok()
        .and_then(|m| m.duration_since(SystemTime::UNIX_EPOCH).ok())
        .map(|d| d.as_millis())
        .unwrap_or(0)
}

fn normalize_cwd(cwd: &str) -> String {
    let trimmed = cwd.trim().trim_end_matches(|c: char| c == '\\' || c == '/');
    if cfg!(windows) {
        trimmed.replace('/', "\\").to_ascii_lowercase()
    } else {
        trimmed.to_string()
    }
}

pub(crate) fn collect_jsonl_files(dir: &Path, out: &mut Vec<PathBuf>) {
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    for entry in entries.filter_map(|entry| entry.ok()) {
        let path = entry.path();
        if path.is_dir() {
            collect_jsonl_files(&path, out);
        } else if path.extension().and_then(|s| s.to_str()) == Some("jsonl") {
            out.push(path);
        }
    }
}

fn parse_codex_session(path: &Path, metadata: &fs::Metadata) -> Option<CodexSessionSnapshot> {
    let file = fs::File::open(path).ok()?;
    let mut reader = BufReader::new(file);
    let mut first_line = String::new();
    reader.read_line(&mut first_line).ok()?;
    if first_line.trim().is_empty() {
        return None;
    }

    let value = serde_json::from_str::<serde_json::Value>(&first_line).ok()?;
    if value.get("type").and_then(|v| v.as_str()) != Some("session_meta") {
        return None;
    }
    let payload = value.get("payload")?;
    let id = payload.get("id").and_then(|v| v.as_str())?.to_string();
    let cwd = payload.get("cwd").and_then(|v| v.as_str())?.to_string();

    Some(CodexSessionSnapshot {
        id,
        cwd,
        modified_at_ms: modified_ms(metadata),
        size_bytes: metadata.len(),
    })
}

/// Lê só o session_meta.id da primeira linha do rollout (sem custo de parsear o
/// arquivo inteiro). Usado pra mapear session_id -> path no agent_cost.
pub(crate) fn session_meta_id(path: &Path) -> Option<String> {
    let file = fs::File::open(path).ok()?;
    let mut reader = BufReader::new(file);
    let mut first_line = String::new();
    reader.read_line(&mut first_line).ok()?;
    let value = serde_json::from_str::<serde_json::Value>(&first_line).ok()?;
    if value.get("type").and_then(|v| v.as_str()) != Some("session_meta") {
        return None;
    }
    value
        .get("payload")?
        .get("id")?
        .as_str()
        .map(|s| s.to_string())
}

#[tauri::command]
pub fn snapshot_codex_sessions(cwd: String) -> Result<Vec<CodexSessionSnapshot>, String> {
    let target_cwd = normalize_cwd(&cwd);
    if target_cwd.is_empty() {
        return Ok(Vec::new());
    }

    let Some(root) = codex_sessions_dir() else {
        return Err("USERPROFILE/HOME nao definido".to_string());
    };
    if !root.is_dir() {
        return Ok(Vec::new());
    }

    let mut files = Vec::new();
    collect_jsonl_files(&root, &mut files);

    let mut sessions = Vec::new();
    let mut seen_ids = std::collections::HashSet::new();
    for path in files {
        let Ok(metadata) = fs::metadata(&path) else {
            continue;
        };
        let Some(session) = parse_codex_session(&path, &metadata) else {
            continue;
        };
        if normalize_cwd(&session.cwd) != target_cwd || !seen_ids.insert(session.id.clone()) {
            continue;
        }
        sessions.push(session);
    }

    sessions.sort_by(|a, b| b.modified_at_ms.cmp(&a.modified_at_ms));
    Ok(sessions)
}
