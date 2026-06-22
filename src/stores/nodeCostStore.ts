import { create } from 'zustand'

import { getTranscriptCost, type SessionCost } from '../lib/tauri'

/**
 * Custo por NÓ do agent canvas (subagent/teammate), parseado do transcript
 * JSONL de cada um. Diferente do agentCostStore (que é por sessão/PTY viva): os
 * nós aqui são subagents in-process do Claude, que não têm PTY próprio — o que
 * temos deles é o `agent_transcript_path` (chega no SubagentStop). Por isso o
 * custo de um nó fica disponível quando ele termina/pausa; teammates que voltam
 * a rodar têm o transcript crescido, então o re-poll mantém atualizado.
 *
 * Não recria o parser — só chama get_transcript_cost (agent_cost.rs) por path.
 */

type NodeLike = { id: string; transcriptPath: string | null }

type NodeCostState = {
  byNodeId: Record<string, SessionCost>
  /** Relê o custo de cada nó que já tem transcriptPath. */
  refresh: (nodes: NodeLike[]) => Promise<void>
  clear: () => void
}

export const useNodeCostStore = create<NodeCostState>((set) => ({
  byNodeId: {},

  refresh: async (nodes) => {
    const targets = nodes.filter((n): n is { id: string; transcriptPath: string } =>
      Boolean(n.transcriptPath),
    )
    if (targets.length === 0) return

    const results = await Promise.all(
      targets.map(async (n) => {
        try {
          const cost = await getTranscriptCost(n.transcriptPath)
          return [n.id, cost] as const
        } catch {
          // Transcript ainda não escrito / não encontrado: mantém o que havia.
          return null
        }
      }),
    )

    set((state) => {
      const next = { ...state.byNodeId }
      for (const r of results) if (r) next[r[0]] = r[1]
      return { byNodeId: next }
    })
  },

  clear: () => set({ byNodeId: {} }),
}))

/** Total agregado de USD e tokens entre os nós com custo conhecido. */
export function selectNodeCostTotals(byNodeId: Record<string, SessionCost>): {
  costUsd: number
  totalTokens: number
} {
  let costUsd = 0
  let totalTokens = 0
  for (const cost of Object.values(byNodeId)) {
    totalTokens += cost.total_tokens
    if (cost.cost_usd != null) costUsd += cost.cost_usd
  }
  return { costUsd, totalTokens }
}
