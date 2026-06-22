export type SessionSnapshot = {
  id: string
  modified_at_ms: number
}

const claimedIds = new Map<string, Set<string>>()

function claimKey(agent: string, cwd: string): string {
  return `${agent}\0${cwd.toLowerCase()}`
}

export function registerSessionClaim(agent: string, cwd: string, sessionId?: string): void {
  if (!sessionId) return
  const key = claimKey(agent, cwd)
  const claimed = claimedIds.get(key) ?? new Set<string>()
  claimed.add(sessionId)
  claimedIds.set(key, claimed)
}

/**
 * Reserva atomicamente um ID novo para um único pane. A ordenação ascendente
 * acompanha a ordem de spawn quando mais de um arquivo aparece entre polls.
 */
export function claimDiscoveredSession(
  agent: string,
  cwd: string,
  beforeIds: ReadonlySet<string>,
  sessions: readonly SessionSnapshot[],
): SessionSnapshot | undefined {
  const key = claimKey(agent, cwd)
  const claimed = claimedIds.get(key) ?? new Set<string>()
  const candidate = sessions
    .filter((session) => !beforeIds.has(session.id) && !claimed.has(session.id))
    .sort((a, b) => a.modified_at_ms - b.modified_at_ms)[0]
  if (!candidate) return undefined
  claimed.add(candidate.id)
  claimedIds.set(key, claimed)
  return candidate
}

export function resetSessionClaimsForTests(): void {
  claimedIds.clear()
}
