import { useDraggable, useDroppable } from '@dnd-kit/core'
import {
  FileText,
  FolderOpen,
  GripVertical,
  Maximize2,
  Minimize2,
  RefreshCw,
  Trash2,
} from 'lucide-react'
import { memo, useCallback, useEffect, useRef, useState } from 'react'

import { useGridResize } from '../../hooks/useGridResize'
import { useT } from '../../lib/i18n'
import {
  listenFileChanged,
  openInFileExplorer,
  readTextFile,
  unwatchFile,
  watchFile,
} from '../../lib/tauri'
import { useProjectsStore } from '../../stores/projectsStore'
import { useUiStore } from '../../stores/uiStore'
import type { Terminal as TerminalEntry } from '../../lib/types'
import { MarkdownRenderer } from './MarkdownRenderer'
import styles from './MarkdownPane.module.css'

/** Temas claros conhecidos — o resto é tratado como escuro (mermaid). */
const LIGHT_THEMES = new Set(['light', 'min-light'])

export type MarkdownPaneProps = {
  projectId: string
  terminal: TerminalEntry
  inFocusOverlay?: boolean
  preview?: boolean
}

export const MarkdownPane = memo(function MarkdownPane({
  projectId,
  terminal,
  inFocusOverlay = false,
  preview = false,
}: MarkdownPaneProps) {
  const t = useT()
  const filePath = terminal.filePath ?? ''
  const [content, setContent] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const focusedTerminalId = useUiStore((s) => s.focusedTerminalId)
  const isFocusMode = inFocusOverlay || focusedTerminalId === terminal.id
  const dark = useProjectsStore((s) => !LIGHT_THEMES.has(s.preferences.uiTheme))

  const deleteTerminal = useProjectsStore((s) => s.deleteTerminal)
  const setProjectGridLayout = useProjectsStore((s) => s.setProjectGridLayout)
  const setFocusedTerminal = useUiStore((s) => s.setFocusedTerminal)
  const setActiveTerminal = useUiStore((s) => s.setActiveTerminal)

  const draggable = useDraggable({ id: `pane:${terminal.id}`, disabled: isFocusMode || preview })
  const droppable = useDroppable({ id: `pane:${terminal.id}`, disabled: isFocusMode || preview })
  const paneRef = useRef<HTMLDivElement | null>(null)
  const setRefs = (node: HTMLDivElement | null) => {
    paneRef.current = node
    draggable.setNodeRef(node)
    droppable.setNodeRef(node)
  }

  const reload = useCallback(async () => {
    if (!filePath) {
      setError('no file')
      return
    }
    try {
      const text = await readTextFile(filePath)
      setContent(text)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [filePath])

  // Carrega + observa o arquivo. Recarrega sozinho quando muda no disco.
  useEffect(() => {
    if (!filePath) return
    void reload()
    void watchFile(filePath).catch(() => {})
    const unlisten = listenFileChanged((changed) => {
      if (changed === filePath) void reload()
    })
    return () => {
      void unwatchFile(filePath).catch(() => {})
      void unlisten.then((fn) => fn()).catch(() => {})
    }
  }, [filePath, reload])

  // Foco vindo da sidebar — scroll into view.
  const focusReq = useUiStore((s) => s.focusRequest)
  useEffect(() => {
    if (!focusReq || focusReq.terminalId !== terminal.id) return
    paneRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' })
  }, [focusReq, terminal.id])

  // Resize de span no grid do PROJETO (quando project.layoutMode === 'grid').
  const projectGrid = useProjectsStore((s) => {
    const p = s.projects.find((p) => p.id === projectId)
    if (!p || p.layoutMode !== 'grid' || !p.gridLayout) return null
    return p.gridLayout
  })
  const showGridResize = Boolean(projectGrid) && !isFocusMode && !preview
  const startGridResize = useGridResize(terminal.id, projectGrid, (layout) =>
    setProjectGridLayout(projectId, layout),
  )

  const onDelete = () => {
    if (window.confirm(t('ui.markdown.confirmClose', { name: terminal.name }))) {
      deleteTerminal(projectId, terminal.id)
      if (isFocusMode) setFocusedTerminal(null)
    }
  }

  const dropTarget = droppable.isOver && !isFocusMode
  const dragging = draggable.isDragging

  return (
    <div
      ref={setRefs}
      data-pane-box="1"
      onPointerDown={() => setActiveTerminal(projectId, terminal.id)}
      className={`${styles.pane} ${isFocusMode ? styles.paneFocus : ''} ${dragging ? styles.dragging : ''} ${dropTarget ? styles.dropTarget : ''}`}
    >
      <header className={styles.header}>
        <div className={styles.headLeft}>
          {!isFocusMode && !preview ? (
            <button
              type="button"
              className={`${styles.action} ${styles.gripBtn}`}
              {...draggable.attributes}
              {...draggable.listeners}
              title={t('ui.terminal.dragToReorder')}
              aria-label={t('ui.terminal.dragToReorder')}
            >
              <GripVertical size={12} />
            </button>
          ) : null}
          <span className={styles.iconWrap}>
            <FileText size={16} />
          </span>
          <div className={styles.identity}>
            <span className={styles.name} title={terminal.name}>
              {terminal.name}
            </span>
            {filePath ? (
              <span className={styles.cwdPill} title={filePath}>
                {shortPath(filePath)}
              </span>
            ) : null}
          </div>
        </div>

        {!preview ? (
          <div className={styles.headRight}>
            <div className={styles.actions}>
              <button
                type="button"
                className={styles.action}
                onClick={() => void reload()}
                title={t('ui.markdown.refresh')}
                aria-label={t('ui.markdown.refresh')}
              >
                <RefreshCw size={12} />
              </button>
              <button
                type="button"
                className={styles.action}
                onClick={() => void openInFileExplorer(parentDir(filePath))}
                disabled={!filePath}
                title={t('ui.terminal.openInExplorer')}
                aria-label={t('ui.terminal.openInExplorer')}
              >
                <FolderOpen size={12} />
              </button>
              {isFocusMode ? (
                <button
                  type="button"
                  className={styles.action}
                  onClick={() => setFocusedTerminal(null)}
                  title={t('ui.terminal.exitFocusModeEsc')}
                  aria-label={t('ui.terminal.exitFocusMode')}
                >
                  <Minimize2 size={12} />
                </button>
              ) : (
                <button
                  type="button"
                  className={styles.action}
                  onClick={() => setFocusedTerminal(terminal.id)}
                  title={t('ui.terminal.focusModeFullscreen')}
                  aria-label={t('ui.terminal.focusMode')}
                >
                  <Maximize2 size={12} />
                </button>
              )}
              <button
                type="button"
                className={`${styles.action} ${styles.danger}`}
                onClick={onDelete}
                title={t('ui.markdown.close')}
                aria-label={t('ui.markdown.close')}
              >
                <Trash2 size={12} />
              </button>
            </div>
          </div>
        ) : null}
      </header>

      <div className={styles.body}>
        {error ? (
          <div className={styles.empty}>
            <FileText size={20} />
            <span>{t('ui.markdown.loadError', { path: filePath })}</span>
            <button type="button" className={styles.retryBtn} onClick={() => void reload()}>
              {t('ui.markdown.refresh')}
            </button>
          </div>
        ) : content === null ? (
          <div className={styles.empty}>
            <span>{t('ui.markdown.loading')}</span>
          </div>
        ) : (
          <div className={styles.scroll}>
            <MarkdownRenderer content={content} dark={dark} />
          </div>
        )}
      </div>

      {showGridResize ? (
        <div
          className={styles.gridResize}
          onPointerDown={startGridResize}
          title={t('ui.terminal.dragToResizeSpan')}
        />
      ) : null}
    </div>
  )
})

function shortPath(path: string): string {
  const cleaned = path.replace(/[\\/]+$/, '')
  const parts = cleaned.split(/[\\/]/).filter(Boolean)
  if (parts.length <= 2) return cleaned
  return `…/${parts[parts.length - 2]}/${parts[parts.length - 1]}`
}

function parentDir(path: string): string {
  const cleaned = path.replace(/[\\/]+$/, '')
  const idx = Math.max(cleaned.lastIndexOf('/'), cleaned.lastIndexOf('\\'))
  return idx > 0 ? cleaned.slice(0, idx) : cleaned
}
