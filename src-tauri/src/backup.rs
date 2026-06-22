use std::fs;
use std::io::{self, Read, Write};
use std::path::{Path, PathBuf};
use tauri::AppHandle;
use zip::write::FileOptions;
use zip::{CompressionMethod, ZipArchive, ZipWriter};

use crate::paths::{activity_stats_file_path, app_data_dir, projects_file_path};

/// Empacota `projects.json` + `scrollback/` num zip salvo em `target_path`.
/// Não inclui `spawn.log` (debug-only) nem `tmp` (artefatos do save atômico).
#[tauri::command]
pub fn export_backup(app: AppHandle, target_path: String) -> Result<(), String> {
    let dir = app_data_dir(&app)?;
    let target = PathBuf::from(target_path);
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let file = fs::File::create(&target).map_err(|e| e.to_string())?;
    let mut zip = ZipWriter::new(file);
    let opts = FileOptions::default().compression_method(CompressionMethod::Deflated);

    // projects.json (se existir)
    let projects = projects_file_path(&app)?;
    if projects.is_file() {
        zip.start_file("projects.json", opts)
            .map_err(|e| e.to_string())?;
        let bytes = fs::read(&projects).map_err(|e| e.to_string())?;
        zip.write_all(&bytes).map_err(|e| e.to_string())?;
    }

    // Métricas de tempo pertencem ao perfil e acompanham seu backup.
    let activity_stats = activity_stats_file_path(&app)?;
    if activity_stats.is_file() {
        zip.start_file("activity-stats.json", opts)
            .map_err(|e| e.to_string())?;
        let bytes = fs::read(&activity_stats).map_err(|e| e.to_string())?;
        zip.write_all(&bytes).map_err(|e| e.to_string())?;
    }

    // scrollback/*.bin
    let scrollback = dir.join("scrollback");
    if scrollback.is_dir() {
        for entry in fs::read_dir(&scrollback).map_err(|e| e.to_string())? {
            let entry = entry.map_err(|e| e.to_string())?;
            let path = entry.path();
            if !path.is_file() {
                continue;
            }
            let name = path
                .file_name()
                .ok_or_else(|| "scrollback entry sem nome".to_string())?
                .to_string_lossy()
                .to_string();
            zip.start_file(format!("scrollback/{name}"), opts)
                .map_err(|e| e.to_string())?;
            let bytes = fs::read(&path).map_err(|e| e.to_string())?;
            zip.write_all(&bytes).map_err(|e| e.to_string())?;
        }
    }

    zip.finish().map_err(|e| e.to_string())?;
    Ok(())
}

/// Substitui o estado local pelo conteúdo de `source_path`. Apaga
/// scrollback/ existente antes (pra não ficar lixo de PTYs deletados),
/// preserva apenas o projects.json novo.
#[tauri::command]
pub fn import_backup(app: AppHandle, source_path: String) -> Result<(), String> {
    let dir = app_data_dir(&app)?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;

    // Limpa scrollback prévio
    let scrollback = dir.join("scrollback");
    if scrollback.exists() {
        let _ = fs::remove_dir_all(&scrollback);
    }
    let activity_stats = activity_stats_file_path(&app)?;
    if activity_stats.exists() {
        fs::remove_file(activity_stats).map_err(|e| e.to_string())?;
    }

    let file = fs::File::open(&source_path).map_err(|e| e.to_string())?;
    let mut archive = ZipArchive::new(file).map_err(|e| e.to_string())?;

    for i in 0..archive.len() {
        let mut entry = archive.by_index(i).map_err(|e| e.to_string())?;
        let entry_name = entry.name().to_string();

        // Sanitização: rejeita absolute paths e ".." pra evitar zip-slip
        if Path::new(&entry_name).is_absolute() || entry_name.contains("..") {
            continue;
        }

        let dest = dir.join(&entry_name);
        if entry.is_dir() {
            fs::create_dir_all(&dest).map_err(|e| e.to_string())?;
            continue;
        }
        if let Some(parent) = dest.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        let mut out = fs::File::create(&dest).map_err(|e| e.to_string())?;
        io::copy(&mut entry, &mut out).map_err(|e| e.to_string())?;
        let _ = read_remaining(&mut entry); // garante consumir o resto do entry
    }

    Ok(())
}

fn read_remaining<R: Read>(r: &mut R) -> io::Result<u64> {
    io::copy(r, &mut io::sink())
}
