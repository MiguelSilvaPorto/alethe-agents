/**
 * Hint de "nova sessão" vindo do watcher do backend (`session://new`). Acelera a
 * detecção pós-spawn no XTermView: em vez de esperar o intervalo fixo do poll, a
 * detecção acorda na hora que um .jsonl novo do agente aparece. É só um
 * acelerador — o polling continua como fallback, então se o hint não vier (dir
 * inexistente, watcher falhou), nada quebra.
 */

import { listen } from '@tauri-apps/api/event'

type WatchAgent = 'claude' | 'codex'

const waiters: Record<WatchAgent, Array<() => void>> = { claude: [], codex: [] }
let started = false

function ensureStarted(): void {
  if (started) return
  started = true
  void listen<{ agent?: string }>('session://new', (event) => {
    const agent = event.payload?.agent
    if (agent !== 'claude' && agent !== 'codex') return
    const pending = waiters[agent]
    waiters[agent] = []
    for (const resolve of pending) resolve()
  })
}

/** Resolve quando o próximo hint do agente chegar. Use em `Promise.race` com um sleep. */
export function waitForSessionHint(agent: WatchAgent): Promise<void> {
  ensureStarted()
  return new Promise((resolve) => {
    waiters[agent].push(resolve)
  })
}
