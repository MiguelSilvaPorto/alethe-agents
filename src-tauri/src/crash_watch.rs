// Gravador de crash / saída suja.
//
// Ideia: a cada poucos segundos o backend escreve um "heartbeat" (RAM, nº de
// processos, hora) em `logs/last_session.json` e marca a sessão como
// `clean_exit:false`. Quando o app sai NORMALMENTE (RunEvent::Exit no run loop),
// marca `clean_exit:true`. Se o processo foi morto/crashou (OOM, taskkill, freeze
// do webview), o Exit não dispara, o flag fica sujo e, no próximo boot, expomos o
// último heartbeat — que diz em que estado o app estava quando morreu (ex.: 6 GB,
// 102 processos). Roda numa thread Rust, então funciona mesmo se o webview travar
// (≠ do record_frontend_error, que depende da UI viva).

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::thread;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use tauri::AppHandle;

/// Intervalo do heartbeat. Usa o sampling cacheado (2s) do stats, então quase
/// sempre reaproveita a varredura que o polling de RAM do front já fez.
const HEARTBEAT_SECS: u64 = 6;

#[derive(Serialize, Deserialize, Clone, Default)]
pub struct SessionRecord {
    pub started_at_ms: u64,
    pub clean_exit: bool,
    pub app_version: String,
    /// Último heartbeat: hora + estado de memória quando o app ainda estava vivo.
    pub last_heartbeat_ms: u64,
    pub total_mb: f64,
    pub ptys_mb: f64,
    pub webview_mb: f64,
    pub process_count: usize,
}

static STATE: OnceLock<Mutex<SessionRecord>> = OnceLock::new();
static FILE: OnceLock<PathBuf> = OnceLock::new();
/// Registro da sessão anterior SE ela não saiu limpa (= provável crash). None se
/// saiu limpa ou se é o primeiro boot.
static LAST_CRASH: OnceLock<Option<SessionRecord>> = OnceLock::new();

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn unix_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

/// Escrita atômica (tmp → rename) — o arquivo é pequeno mas é reescrito a cada
/// heartbeat; não pode corromper se o processo morrer no meio da escrita.
fn write_record(rec: &SessionRecord) {
    let Some(path) = FILE.get() else {
        return;
    };
    let Ok(json) = serde_json::to_vec_pretty(rec) else {
        return;
    };
    let tmp = path.with_extension("json.tmp");
    if fs::write(&tmp, &json).is_ok() {
        let _ = fs::rename(&tmp, path);
    }
}

/// Deixa um log legível da saída suja anterior (além do JSON estruturado).
fn append_unclean_log(dir: &Path, prev: &SessionRecord) {
    let path = dir.join(format!("unclean-exit-{}.log", unix_secs()));
    if let Ok(mut file) = fs::OpenOptions::new().create(true).append(true).open(path) {
        let _ = writeln!(
            file,
            "previous session did NOT exit cleanly (likely crash/kill/OOM)\n\
             app_version={} started_at_ms={} last_heartbeat_ms={}\n\
             last memory: total={:.0} MB · ptys={:.0} MB · webview={:.0} MB · {} processes",
            prev.app_version,
            prev.started_at_ms,
            prev.last_heartbeat_ms,
            prev.total_mb,
            prev.ptys_mb,
            prev.webview_mb,
            prev.process_count,
        );
    }
}

/// Chamar no `.setup()`. Lê o registro anterior (detecta crash), grava um registro
/// novo `clean_exit:false` e sobe a thread de heartbeat.
pub fn start(app: AppHandle) {
    let Ok(dir) = crate::logging::logs_dir(&app) else {
        return;
    };
    let _ = fs::create_dir_all(&dir);
    let path = dir.join("last_session.json");

    // Sessão anterior suja? Vira o "relatório de crash" exposto pro front.
    let prev_crash = fs::read(&path)
        .ok()
        .and_then(|bytes| serde_json::from_slice::<SessionRecord>(&bytes).ok())
        .filter(|prev| !prev.clean_exit);
    if let Some(prev) = &prev_crash {
        append_unclean_log(&dir, prev);
    }
    let _ = LAST_CRASH.set(prev_crash);

    let fresh = SessionRecord {
        started_at_ms: now_ms(),
        clean_exit: false,
        app_version: env!("CARGO_PKG_VERSION").to_string(),
        ..Default::default()
    };
    let _ = FILE.set(path);
    let _ = STATE.set(Mutex::new(fresh.clone()));
    write_record(&fresh);

    thread::spawn(|| loop {
        thread::sleep(Duration::from_secs(HEARTBEAT_SECS));
        let stats = crate::stats::memory_stats_cached();
        if let Some(state) = STATE.get() {
            let mut rec = state.lock().unwrap_or_else(|p| p.into_inner());
            rec.last_heartbeat_ms = now_ms();
            rec.total_mb = stats.total_mb;
            rec.ptys_mb = stats.ptys_mb;
            rec.webview_mb = stats.webview_mb;
            rec.process_count = stats.process_count;
            write_record(&rec);
        }
    });
}

/// Chamar no RunEvent::Exit do run loop — marca a saída como limpa.
pub fn mark_clean_exit() {
    if let Some(state) = STATE.get() {
        let mut rec = state.lock().unwrap_or_else(|p| p.into_inner());
        rec.clean_exit = true;
        write_record(&rec);
    }
}

/// Relatório da sessão anterior se ela não saiu limpa (provável crash). O front
/// chama no boot pra avisar o usuário com o estado de memória de quando caiu.
#[tauri::command]
pub fn get_last_crash_report() -> Option<SessionRecord> {
    LAST_CRASH.get().cloned().flatten()
}
