use serde::Serialize;
use std::process::Command;

#[derive(Serialize)]
pub struct OpenCodeSessionSnapshot {
    pub id: String,
    pub modified_at_ms: u128,
}

/// Executa `opencode session list --format json` e parseia a saída.
/// Retorna as sessões ordenadas por data de modificação (mais recente primeiro).
#[tauri::command]
pub fn snapshot_opencode_sessions(_cwd: String) -> Result<Vec<OpenCodeSessionSnapshot>, String> {
    let output = Command::new("opencode")
        .args(["session", "list", "--format", "json", "--max-count", "50"])
        .output()
        .map_err(|e| format!("falha ao executar opencode: {e}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("opencode session list falhou: {stderr}"));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let entries: Vec<serde_json::Value> =
        serde_json::from_str(&stdout).map_err(|e| format!("falha ao parsear JSON: {e}"))?;

    let mut sessions: Vec<OpenCodeSessionSnapshot> = entries
        .into_iter()
        .filter_map(|entry| {
            let id = entry.get("id")?.as_str()?.to_string();
            let updated = entry.get("updated")?.as_f64()? as u128;
            Some(OpenCodeSessionSnapshot {
                id,
                modified_at_ms: updated,
            })
        })
        .collect();

    sessions.sort_by(|a, b| b.modified_at_ms.cmp(&a.modified_at_ms));
    Ok(sessions)
}
