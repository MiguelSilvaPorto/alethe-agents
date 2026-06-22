import { getCodexUsage, type CodexUsage } from './tauri'

const TTL_MS = 60_000

let cached: { value: CodexUsage; at: number } | null = null
let inFlight: Promise<CodexUsage> | null = null

export function getCachedCodexUsage(force = false): Promise<CodexUsage> {
  const now = Date.now()
  if (!force && cached && now - cached.at < TTL_MS) {
    return Promise.resolve(cached.value)
  }
  if (!force && inFlight) return inFlight

  inFlight = getCodexUsage()
    .then((value) => {
      cached = { value, at: Date.now() }
      return value
    })
    .finally(() => {
      inFlight = null
    })

  return inFlight
}
