/**
 * Formatação de custo/tokens compartilhada — TokenHud e o agent canvas usam os
 * mesmos formatos pra não divergir. Puro: sem dependência de tema/CSS (cada
 * componente mapeia o nível pra sua própria classe).
 */

/** USD legível: 4 casas abaixo de $1, 2 acima. */
export function fmtUsd(v: number): string {
  if (v < 1) return `$${v.toFixed(4)}`
  return `$${v.toFixed(2)}`
}

/** Tokens com k/M. */
export function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return String(n)
}

export type CostLevel = 'low' | 'mid' | 'high'

/** Faixa de gasto (USD) → nível, pro componente escolher a cor do token. */
export function costLevel(v: number): CostLevel {
  if (v >= 5) return 'high'
  if (v >= 1) return 'mid'
  return 'low'
}

/** Família curta do model id (opus/sonnet/haiku/…), pros badges. */
export function shortModel(model: string | null): string | null {
  if (!model) return null
  const m = model.toLowerCase()
  if (m.includes('opus')) return 'opus'
  if (m.includes('sonnet')) return 'sonnet'
  if (m.includes('haiku')) return 'haiku'
  return model
}
