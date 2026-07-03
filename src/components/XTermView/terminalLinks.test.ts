import { describe, expect, it } from 'vitest'

import { detectTerminalLinks, getLogicalTerminalLine, terminalLinkRange } from './terminalLinks'

describe('terminal links', () => {
  it('preserves spaces inside URLs and paths', () => {
    expect(detectTerminalLinks('https://example.com/a folder/read me.md')).toEqual([
      expect.objectContaining({ text: 'https://example.com/a folder/read me.md', displayLength: 39 }),
    ])
    expect(detectTerminalLinks('D:\\public launch\\src\\file.ts')).toEqual([
      expect.objectContaining({ text: 'D:\\public launch\\src\\file.ts', kind: 'path' }),
    ])
  })

  it('reconstructs viewport-wrapped lines and creates a multiline range', () => {
    const values = [
      { value: 'go https:/', isWrapped: false },
      { value: '/example.c', isWrapped: true },
      { value: 'om/docs', isWrapped: true },
    ]
    const buffer = {
      length: values.length,
      getLine: (index: number) => {
        const line = values[index]
        return line
          ? { isWrapped: line.isWrapped, translateToString: () => line.value }
          : undefined
      },
    }

    const logicalLine = getLogicalTerminalLine(buffer, 2)
    expect(logicalLine).toEqual({ text: 'go https://example.com/docs', startLine: 1 })
    const [link] = detectTerminalLinks(logicalLine!.text)
    expect(terminalLinkRange(logicalLine!.startLine, 10, link)).toEqual({
      start: { x: 4, y: 1 },
      end: { x: 7, y: 3 },
    })
  })

  it('keeps escaped spaces in the visual range and unescapes the opened path', () => {
    const [link] = detectTerminalLinks('/tmp/my\\ file/readme.md')
    expect(link.text).toBe('/tmp/my file/readme.md')
    expect(link.displayLength).toBe('/tmp/my\\ file/readme.md'.length)
    expect(link.isMarkdown).toBe(true)
  })
})
