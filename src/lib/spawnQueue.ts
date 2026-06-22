/**
 * Fila global pra serializar spawns de PTY. Sem isso, abrir um grupo com N
 * projetos × M terminais dispara N*M `spawn_pty` em paralelo, sobrecarregando
 * o ConPTY do Windows e causando freeze do app no nível do SO.
 *
 * Uso:
 *   await acquireSpawnSlot()
 *   try { await spawnPty(...) } finally { releaseSpawnSlot() }
 */

let maxConcurrentSpawns = 3

let active = 0
const waiters: Array<() => void> = []

/**
 * Ajusta o limite de spawns simultâneos (preferência do usuário). Ao aumentar,
 * libera waiters presos até o novo teto; ao diminuir, só vale pros próximos.
 */
export function setMaxConcurrentSpawns(n: number): void {
  const next = Math.max(1, Math.round(n))
  if (next === maxConcurrentSpawns) return
  maxConcurrentSpawns = next
  while (active < maxConcurrentSpawns && waiters.length > 0) {
    const resume = waiters.shift()
    if (resume) resume()
  }
  notify()
}

type Listener = (snapshot: { active: number; queued: number }) => void
const listeners = new Set<Listener>()

function notify(): void {
  const snapshot = { active, queued: waiters.length }
  for (const l of listeners) l(snapshot)
}

export function subscribeSpawnQueue(l: Listener): () => void {
  listeners.add(l)
  l({ active, queued: waiters.length })
  return () => listeners.delete(l)
}

export function getSpawnQueueSnapshot(): { active: number; queued: number } {
  return { active, queued: waiters.length }
}

export function acquireSpawnSlot(): Promise<void> {
  if (active < maxConcurrentSpawns) {
    active++
    notify()
    return Promise.resolve()
  }
  return new Promise<void>((resolve) => {
    waiters.push(() => {
      active++
      notify()
      resolve()
    })
    notify()
  })
}

export function releaseSpawnSlot(): void {
  active = Math.max(0, active - 1)
  // Só admite o próximo se ainda houver folga (o cap pode ter sido reduzido).
  const next = active < maxConcurrentSpawns ? waiters.shift() : undefined
  if (next) next()
  else notify()
}
