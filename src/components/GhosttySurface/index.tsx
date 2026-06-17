import { useEffect, useRef } from 'react'

import {
  ghosttyKill,
  ghosttySetHidden,
  ghosttySpawn,
  ghosttySyncFrame,
  type WebRect,
} from '../../lib/tauri'
import { webRectsEqual } from '../../lib/webRect'

// Kills pendentes (deferidos) por surfaceId. O StrictMode (dev) desmonta e
// remonta o componente imediatamente; se matássemos a surface no unmount, o
// shell reiniciaria a cada render. Em vez disso, adiamos o kill — se o mesmo
// surfaceId remontar logo, cancelamos. Só mata de verdade num unmount real.
const pendingKills = new Map<string, ReturnType<typeof setTimeout>>()

export type GhosttySurfaceProps = {
  /** ID estável da surface — usamos o id da sub-tab (mesmo papel do ptyId). */
  surfaceId: string
  /** Diretório inicial. undefined = padrão do shell. */
  cwd?: string
  /** Linha de comando a executar (agente). undefined = shell de login. */
  command?: string
  onSpawned?: (id: string) => void
}

/**
 * Renderiza um placeholder no DOM e mantém uma NSView nativa do Ghostty alinhada
 * a ele. A NSView vive FORA da WebView (irmã dela, por cima), então toda a
 * posição/tamanho é empurrada pro backend via `ghostty_sync_frame`.
 *
 * macOS-only: o componente só é montado quando `platform === 'macos'` e a flag
 * `nativeTerminalMacos` está ligada (decisão no TerminalPane). Em outras
 * plataformas os comandos retornariam erro, então nem chegamos aqui.
 *
 * O `command`/`cwd` são lidos na criação da surface (o backend Ghostty spawna o
 * processo no nascimento da surface). Trocar de sub-tab usa um `surfaceId`/key
 * diferente, então remonta — não precisamos reagir a mudanças deles em runtime.
 */
export function GhosttySurface({ surfaceId, cwd, command, onSpawned }: GhosttySurfaceProps) {
  const placeholderRef = useRef<HTMLDivElement | null>(null)
  const lastRectRef = useRef<WebRect | null>(null)
  const rafRef = useRef<number | null>(null)
  const spawnedRef = useRef(false)

  // cwd/command capturados na 1ª montagem (a surface spawna o processo uma vez).
  const spawnArgsRef = useRef({ cwd, command })

  // onSpawned é recriado a cada render do pai; guardamos num ref para o efeito
  // de ciclo de vida NÃO depender dele — senão a cada re-render do TerminalPane
  // a surface seria morta e recriada (e o terminal piscaria/reiniciaria).
  const onSpawnedRef = useRef(onSpawned)
  useEffect(() => {
    onSpawnedRef.current = onSpawned
  })

  useEffect(() => {
    const node = placeholderRef.current
    if (!node) return

    let disposed = false

    // Empurra o rect atual do placeholder pro backend, coalescido em rAF pra
    // não disparar um IPC por pixel durante um drag de separador.
    const pushFrame = () => {
      rafRef.current = null
      if (disposed) return
      const r = node.getBoundingClientRect()
      const rect: WebRect = { x: r.left, y: r.top, width: r.width, height: r.height }
      if (webRectsEqual(lastRectRef.current, rect)) return
      lastRectRef.current = rect
      void ghosttySyncFrame(surfaceId, rect, window.devicePixelRatio || 1)
    }

    const scheduleFrame = () => {
      if (rafRef.current !== null) return
      rafRef.current = window.requestAnimationFrame(pushFrame)
    }

    // Se havia um kill deferido pra este surfaceId (remontagem do StrictMode),
    // cancela — a surface ainda está viva e vamos reusá-la.
    const pending = pendingKills.get(surfaceId)
    if (pending !== undefined) {
      clearTimeout(pending)
      pendingKills.delete(surfaceId)
    }

    const start = async () => {
      try {
        const { cwd, command } = spawnArgsRef.current
        const res = await ghosttySpawn({ id: surfaceId, cwd, command })
        if (disposed) return
        spawnedRef.current = true
        onSpawnedRef.current?.(res.id)
        scheduleFrame()
      } catch (err) {
        console.error('ghostty_spawn falhou', err)
      }
    }
    void start()

    // Reposiciona a surface em qualquer mudança de layout: resize do
    // placeholder (separadores, troca de layout) e resize da janela.
    const ro = new ResizeObserver(scheduleFrame)
    ro.observe(node)
    window.addEventListener('resize', scheduleFrame)
    // Scroll de qualquer ancestral também move o rect na tela.
    window.addEventListener('scroll', scheduleFrame, true)

    return () => {
      disposed = true
      ro.disconnect()
      window.removeEventListener('resize', scheduleFrame)
      window.removeEventListener('scroll', scheduleFrame, true)
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
      // Kill DEFERIDO: se for só um ciclo do StrictMode, o próximo mount cancela
      // isto antes de disparar. Num unmount real, o timeout mata a surface.
      const timer = setTimeout(() => {
        pendingKills.delete(surfaceId)
        void ghosttyKill(surfaceId)
      }, 250)
      pendingKills.set(surfaceId, timer)
    }
  }, [surfaceId])

  // Esconde a NSView nativa enquanto o placeholder estiver oculto (ex.: sob um
  // modal). NSView nativa fica sempre acima do HTML, então precisamos ocultá-la
  // explicitamente — senão ela "vaza" por cima de diálogos.
  useEffect(() => {
    const node = placeholderRef.current
    if (!node) return
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          void ghosttySetHidden(surfaceId, !entry.isIntersecting)
        }
      },
      { threshold: 0 },
    )
    io.observe(node)
    return () => io.disconnect()
  }, [surfaceId])

  // O placeholder ocupa todo o espaço do terminalArea; a NSView é alinhada a ele.
  return <div ref={placeholderRef} style={{ width: '100%', height: '100%' }} data-ghostty-surface={surfaceId} />
}
