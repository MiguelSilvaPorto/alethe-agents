// Custo real por sessão, parseado dos JSONL (modelo ccusage). Claude e Codex
// já gravam tokens por mensagem nos arquivos de sessão; aqui somamos e
// multiplicamos por uma tabela de preço por modelo. Diferente de
// claude_usage.rs/codex_usage.rs, que só expõem utilização (%) da conta.
//
// Fluxo: o front resolve ptyId -> session_id (via snapshot_* pós-spawn) e chama
// get_session_cost(agent, cwd, session_id) periodicamente pro Token HUD.

use serde::Serialize;
use std::fs;
use std::io::{BufRead, BufReader};
use std::path::PathBuf;

/// Preço por 1M de tokens (USD). Cache write 5m = 1.25× input, 1h = 2× input,
/// cache read = 0.1× input — multiplicadores padrão do prompt caching da
/// Anthropic. Validado via skill claude-api (tabela de modelos atual).
struct Pricing {
    input: f64,
    output: f64,
    cache_write_5m: f64,
    cache_write_1h: f64,
    cache_read: f64,
}

/// Resolve o preço por prefixo do model id (ex.: "claude-opus-4-8",
/// "claude-sonnet-4-6", "claude-haiku-4-5"). Codex usa modelos GPT, sem preço
/// público estável aqui — retorna None (tokens ainda somam, custo fica null).
fn pricing_for(model: &str) -> Option<Pricing> {
    let m = model.to_ascii_lowercase();
    // input, output → derivados: 5m=1.25x, 1h=2x, read=0.1x
    let base = if m.contains("opus") {
        (5.0, 25.0)
    } else if m.contains("sonnet") {
        (3.0, 15.0)
    } else if m.contains("haiku") {
        (1.0, 5.0)
    } else {
        return None;
    };
    let (input, output) = base;
    Some(Pricing {
        input,
        output,
        cache_write_5m: input * 1.25,
        cache_write_1h: input * 2.0,
        cache_read: input * 0.1,
    })
}

#[derive(Serialize, Default, Clone)]
pub struct ModelCost {
    pub model: String,
    pub input: u64,
    pub output: u64,
    pub cache_read: u64,
    pub cache_write_5m: u64,
    pub cache_write_1h: u64,
    /// Custo em USD desse modelo, ou None se o modelo não está na tabela.
    pub cost_usd: Option<f64>,
}

#[derive(Serialize, Default)]
pub struct SessionCost {
    pub session_id: String,
    pub agent: String,
    pub input: u64,
    pub output: u64,
    pub cache_read: u64,
    pub cache_write_5m: u64,
    pub cache_write_1h: u64,
    pub total_tokens: u64,
    /// Soma dos custos por modelo conhecidos. None se nenhum modelo tinha preço.
    pub cost_usd: Option<f64>,
    /// Modelo dominante (mais output) — pro HUD mostrar um label.
    pub model: Option<String>,
    pub by_model: Vec<ModelCost>,
}

impl ModelCost {
    fn compute_cost(&mut self) {
        if let Some(p) = pricing_for(&self.model) {
            let cost = self.input as f64 / 1_000_000.0 * p.input
                + self.output as f64 / 1_000_000.0 * p.output
                + self.cache_read as f64 / 1_000_000.0 * p.cache_read
                + self.cache_write_5m as f64 / 1_000_000.0 * p.cache_write_5m
                + self.cache_write_1h as f64 / 1_000_000.0 * p.cache_write_1h;
            self.cost_usd = Some(cost);
        }
    }
}

/// Parser do JSONL do Claude: soma message.usage por linha assistant,
/// agrupando por message.model.
fn parse_claude_cost(path: &PathBuf) -> std::collections::HashMap<String, ModelCost> {
    let mut by_model: std::collections::HashMap<String, ModelCost> = std::collections::HashMap::new();
    let Ok(file) = fs::File::open(path) else {
        return by_model;
    };
    for line in BufReader::new(file).lines().map_while(Result::ok) {
        if line.is_empty() {
            continue;
        }
        let Ok(value) = serde_json::from_str::<serde_json::Value>(&line) else {
            continue;
        };
        let Some(message) = value.get("message") else {
            continue;
        };
        let Some(usage) = message.get("usage") else {
            continue;
        };
        let model = message
            .get("model")
            .and_then(|v| v.as_str())
            .unwrap_or("unknown")
            .to_string();
        let entry = by_model.entry(model.clone()).or_insert_with(|| ModelCost {
            model,
            ..Default::default()
        });
        let u = |k: &str| usage.get(k).and_then(|v| v.as_u64()).unwrap_or(0);
        entry.input += u("input_tokens");
        entry.output += u("output_tokens");
        entry.cache_read += u("cache_read_input_tokens");
        // Breakdown 5m/1h vem em cache_creation; fallback p/ cache_creation_input_tokens como 5m.
        let cc = usage.get("cache_creation");
        let cc5 = cc
            .and_then(|c| c.get("ephemeral_5m_input_tokens"))
            .and_then(|v| v.as_u64());
        let cc1 = cc
            .and_then(|c| c.get("ephemeral_1h_input_tokens"))
            .and_then(|v| v.as_u64());
        match (cc5, cc1) {
            (Some(a), Some(b)) => {
                entry.cache_write_5m += a;
                entry.cache_write_1h += b;
            }
            _ => {
                entry.cache_write_5m += u("cache_creation_input_tokens");
            }
        }
    }
    by_model
}

/// Parser do rollout JSONL do Codex: pega o ÚLTIMO event_msg token_count
/// (info.total_token_usage é cumulativo).
fn parse_codex_cost(path: &PathBuf) -> ModelCost {
    let mut cost = ModelCost {
        model: "codex".to_string(),
        ..Default::default()
    };
    let Ok(file) = fs::File::open(path) else {
        return cost;
    };
    for line in BufReader::new(file).lines().map_while(Result::ok) {
        if line.is_empty() {
            continue;
        }
        let Ok(value) = serde_json::from_str::<serde_json::Value>(&line) else {
            continue;
        };
        let payload = value.get("payload");
        let is_token_count = payload
            .and_then(|p| p.get("type"))
            .and_then(|v| v.as_str())
            == Some("token_count");
        if !is_token_count {
            continue;
        }
        let Some(total) = payload
            .and_then(|p| p.get("info"))
            .and_then(|i| i.get("total_token_usage"))
        else {
            continue;
        };
        let u = |k: &str| total.get(k).and_then(|v| v.as_u64()).unwrap_or(0);
        // total_* é cumulativo → sobrescreve (último vence).
        cost.input = u("input_tokens");
        cost.output = u("output_tokens");
        cost.cache_read = u("cached_input_tokens");
    }
    cost
}

/// Acha o arquivo de rollout do Codex cujo session_meta.id == session_id.
fn find_codex_session_path(session_id: &str) -> Option<PathBuf> {
    let root = crate::codex_sessions::codex_sessions_dir()?;
    if !root.is_dir() {
        return None;
    }
    let mut files = Vec::new();
    crate::codex_sessions::collect_jsonl_files(&root, &mut files);
    for path in files {
        if let Some(id) = crate::codex_sessions::session_meta_id(&path) {
            if id == session_id {
                return Some(path);
            }
        }
    }
    None
}

#[tauri::command]
pub async fn get_session_cost(
    agent: String,
    cwd: String,
    session_id: String,
) -> Result<SessionCost, String> {
    // Parse de JSONL é IO/CPU pesado e é pollado a cada 4s no canvas → spawn_blocking
    // pra não bloquear a thread principal do Tauri (UI travaria).
    tokio::task::spawn_blocking(move || get_session_cost_inner(agent, cwd, session_id))
        .await
        .map_err(|e| e.to_string())?
}

fn get_session_cost_inner(
    agent: String,
    cwd: String,
    session_id: String,
) -> Result<SessionCost, String> {
    let by_model: Vec<ModelCost> = match agent.as_str() {
        "codex" => {
            let Some(path) = find_codex_session_path(&session_id) else {
                return Err(format!("sessão codex {session_id} não encontrada"));
            };
            vec![parse_codex_cost(&path)]
        }
        "claude" => {
            let dirs = crate::claude_sessions::project_dirs_for_cwd(&cwd)?;
            let mut path: Option<PathBuf> = None;
            for dir in dirs {
                let candidate = dir.join(format!("{session_id}.jsonl"));
                if candidate.is_file() {
                    path = Some(candidate);
                    break;
                }
            }
            let Some(path) = path else {
                return Err(format!("sessão claude {session_id} não encontrada"));
            };
            parse_claude_cost(&path).into_values().collect()
        }
        other => return Err(format!("agente sem custo suportado: {other}")),
    };

    Ok(aggregate(agent, session_id, by_model))
}

/// Custo direto de um transcript JSONL do Claude por path absoluto — usado pelos
/// nós do agent canvas (cada subagent/teammate tem `agent_transcript_path`).
/// Mesmo formato/parses do Claude; só não precisa resolver cwd+session_id.
#[tauri::command]
pub async fn get_transcript_cost(path: String) -> Result<SessionCost, String> {
    tokio::task::spawn_blocking(move || get_transcript_cost_inner(path))
        .await
        .map_err(|e| e.to_string())?
}

fn get_transcript_cost_inner(path: String) -> Result<SessionCost, String> {
    let pb = PathBuf::from(&path);
    if !pb.is_file() {
        return Err(format!("transcript não encontrado: {path}"));
    }
    let by_model: Vec<ModelCost> = parse_claude_cost(&pb).into_values().collect();
    Ok(aggregate("claude".to_string(), path, by_model))
}

/// Soma o breakdown por modelo num total de sessão (computa custo, escolhe o
/// modelo dominante por output). Compartilhado por get_session_cost e
/// get_transcript_cost — fonte única da agregação e da tabela de preço.
fn aggregate(agent: String, session_id: String, mut by_model: Vec<ModelCost>) -> SessionCost {
    for mc in &mut by_model {
        mc.compute_cost();
    }

    let mut total = SessionCost {
        session_id,
        agent,
        ..Default::default()
    };
    let mut any_cost = false;
    let mut dominant: Option<(u64, String)> = None;
    for mc in &by_model {
        total.input += mc.input;
        total.output += mc.output;
        total.cache_read += mc.cache_read;
        total.cache_write_5m += mc.cache_write_5m;
        total.cache_write_1h += mc.cache_write_1h;
        if let Some(c) = mc.cost_usd {
            any_cost = true;
            total.cost_usd = Some(total.cost_usd.unwrap_or(0.0) + c);
        }
        let by_output = dominant.as_ref().map(|(o, _)| mc.output > *o).unwrap_or(true);
        if by_output {
            dominant = Some((mc.output, mc.model.clone()));
        }
    }
    if !any_cost {
        total.cost_usd = None;
    }
    total.total_tokens =
        total.input + total.output + total.cache_read + total.cache_write_5m + total.cache_write_1h;
    total.model = dominant.map(|(_, m)| m);
    total.by_model = by_model;
    total
}

/// Preço por 1M de tokens, por família de modelo — exposto pro front estimar a
/// "economia por roteamento" (custo hipotético no modelo do lead vs. real). Mesma
/// tabela de `pricing_for`, sem duplicar números.
#[derive(Serialize)]
pub struct ModelRate {
    pub family: String,
    pub input: f64,
    pub output: f64,
    pub cache_write_5m: f64,
    pub cache_write_1h: f64,
    pub cache_read: f64,
}

#[tauri::command]
pub fn get_model_pricing() -> Vec<ModelRate> {
    ["opus", "sonnet", "haiku"]
        .iter()
        .filter_map(|family| {
            pricing_for(family).map(|p| ModelRate {
                family: (*family).to_string(),
                input: p.input,
                output: p.output,
                cache_write_5m: p.cache_write_5m,
                cache_write_1h: p.cache_write_1h,
                cache_read: p.cache_read,
            })
        })
        .collect()
}
