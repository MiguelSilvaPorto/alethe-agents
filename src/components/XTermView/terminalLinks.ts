export type DetectedTerminalLink = {
  text: string
  index: number
  displayLength: number
  kind: 'url' | 'path'
  isMarkdown?: boolean
}

type TerminalBufferLine = {
  readonly isWrapped: boolean
  translateToString(trimRight?: boolean): string
}

type TerminalBuffer = {
  readonly length: number
  getLine(y: number): TerminalBufferLine | undefined
}

export type LogicalTerminalLine = {
  text: string
  startLine: number
}

const LINK_START_PATTERN = /https?:\/\/|(?:[A-Za-z]:\\|\\\\)|(?:~|\/)(?=[^/])/g
const MARKDOWN_PATH_PATTERN = /\.(md|markdown)(?::\d+(?::\d+)?)?$/i
const LINK_TRAILING_PUNCTUATION = /[\s),.;:]+$/
const HARD_LINK_DELIMITERS = new Set(['\t', '\r', '\n', '<', '>', '"', "'", '`', '|'])

function findLinkEnd(line: string, start: number): number {
  const opener = line[start - 1]
  const closer = opener === '(' ? ')' : opener === '[' ? ']' : undefined
  if (closer) {
    const boundedEnd = line.indexOf(closer, start)
    if (boundedEnd !== -1) return boundedEnd
  }

  let end = start
  while (end < line.length) {
    const char = line[end]
    if (HARD_LINK_DELIMITERS.has(char)) break
    if (char === ' ' && line[end + 1] === ' ') break

    // A second link after whitespace belongs to a separate match.
    if (char === ' ') {
      const remainder = line.slice(end + 1)
      if (/^(?:https?:\/\/|[A-Za-z]:\\|\\\\|~\/|\/)/.test(remainder)) break
    }
    end += 1
  }
  return end
}

/** Detecta URLs e paths, preservando espaços que fazem parte do alvo. */
export function detectTerminalLinks(line: string): DetectedTerminalLink[] {
  const links: DetectedTerminalLink[] = []
  LINK_START_PATTERN.lastIndex = 0

  for (const match of line.matchAll(LINK_START_PATTERN)) {
    const index = match.index ?? 0
    if (links.some((link) => index < link.index + link.displayLength)) continue

    const raw = line.slice(index, findLinkEnd(line, index))
    const displayText = raw.replace(LINK_TRAILING_PUNCTUATION, '')
    if (!displayText) continue

    const kind = displayText.startsWith('http://') || displayText.startsWith('https://') ? 'url' : 'path'
    const text = kind === 'url' ? displayText : displayText.replace(/\\ /g, ' ')
    links.push({
      text,
      index,
      displayLength: displayText.length,
      kind,
      isMarkdown: kind === 'path' && MARKDOWN_PATH_PATTERN.test(text),
    })
  }
  return links
}

/**
 * Reconstrói a linha lógica do xterm. Linhas quebradas apenas pelo viewport têm
 * `isWrapped`; as intermediárias precisam manter o padding até `cols` para que
 * os offsets continuem correspondendo às coordenadas das células.
 */
export function getLogicalTerminalLine(
  buffer: TerminalBuffer,
  bufferLineNumber: number,
): LogicalTerminalLine | null {
  let startIndex = bufferLineNumber - 1
  if (startIndex < 0 || startIndex >= buffer.length || !buffer.getLine(startIndex)) return null

  while (startIndex > 0 && buffer.getLine(startIndex)?.isWrapped) startIndex -= 1

  let endIndex = startIndex
  while (endIndex + 1 < buffer.length && buffer.getLine(endIndex + 1)?.isWrapped) endIndex += 1

  let text = ''
  for (let index = startIndex; index <= endIndex; index += 1) {
    text += buffer.getLine(index)?.translateToString(index === endIndex) ?? ''
  }

  return { text, startLine: startIndex + 1 }
}

export function terminalLinkRange(
  startLine: number,
  columns: number,
  link: Pick<DetectedTerminalLink, 'index' | 'displayLength'>,
) {
  const startOffset = link.index
  const endOffset = link.index + link.displayLength - 1
  return {
    start: { x: (startOffset % columns) + 1, y: startLine + Math.floor(startOffset / columns) },
    end: { x: (endOffset % columns) + 1, y: startLine + Math.floor(endOffset / columns) },
  }
}
