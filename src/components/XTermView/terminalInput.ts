type WheelLike = {
  deltaMode: number
  deltaY: number
}

const DOM_DELTA_PIXEL = 0
const DOM_DELTA_LINE = 1
const PAGE_SCROLL_LINES = 10
const TERMINAL_SCROLLBACK_ROWS = 10_000

export function getTerminalScrollbackRows(): number {
  return TERMINAL_SCROLLBACK_ROWS
}

export function normalizePastedText(text: string): string {
  return text.replace(/\r\n?/g, '\n').replace(/\n/g, '\r')
}

/**
 * Formata caminhos arrastados do SO pro terminal: aspas só quando o path tem
 * espaço, múltiplos separados por espaço, e um espaço no fim pra continuar
 * digitando. Strings vazias são descartadas; sem paths válidos retorna ''.
 */
export function formatDroppedPaths(paths: string[]): string {
  const formatted = paths
    .filter(Boolean)
    .map((p) => (/\s/.test(p) ? `"${p}"` : p))
    .join(' ')
  return formatted ? `${formatted} ` : ''
}

export function getWheelScrollLines(event: WheelLike, lineHeight: number): number {
  if (event.deltaY === 0) return 0

  if (event.deltaMode === DOM_DELTA_LINE) {
    return Math.trunc(event.deltaY)
  }

  if (event.deltaMode !== DOM_DELTA_PIXEL) {
    return Math.sign(event.deltaY) * PAGE_SCROLL_LINES
  }

  const safeLineHeight = Number.isFinite(lineHeight) && lineHeight > 0 ? lineHeight : 18
  const lines = Math.ceil(Math.abs(event.deltaY) / safeLineHeight)
  return Math.sign(event.deltaY) * Math.max(1, lines)
}
