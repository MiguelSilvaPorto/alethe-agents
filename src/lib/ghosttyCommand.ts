import type { AgentType } from './types'

/**
 * Monta a linha de comando que o Ghostty executa no shell de login da surface
 * (backend EXEC). Espelha o que o caminho xterm.js faz, mas como uma string
 * única (o Ghostty resolve o launcher via PATH no shell de login).
 *
 * - shell  → undefined (Ghostty abre só o shell de login, sem comando).
 * - agente → "<agentType> <extraArgs...>", ex.: "claude --dangerously-skip-permissions".
 *
 * Args são citados com aspas simples (escapando aspas internas) para sobreviver
 * ao parsing do shell.
 */
export function buildGhosttyCommand(
  type: AgentType,
  extraArgs?: string[],
): string | undefined {
  if (type === 'shell') return undefined
  const parts = [type, ...(extraArgs ?? []).map(shellQuote)]
  return parts.join(' ')
}

function shellQuote(arg: string): string {
  // Sem caracteres perigosos: deixa cru (mais legível). Senão, aspas simples.
  if (/^[A-Za-z0-9_\-./=:@]+$/.test(arg)) return arg
  return `'${arg.replace(/'/g, "'\\''")}'`
}
