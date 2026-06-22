import { ChevronDown, ChevronRight, File, Folder, FolderOpen, RefreshCw } from 'lucide-react'
import { useEffect, useState } from 'react'

import { getPtyCwd, listDirectory, type DirectoryEntry } from '../../lib/tauri'
import styles from './FileExplorer.module.css'

type FileExplorerProps = {
  cwd: string
  ptyId: string | null
  terminalName: string
}

export function FileExplorer({ cwd, ptyId, terminalName }: FileExplorerProps) {
  const [reloadKey, setReloadKey] = useState(0)
  const [liveCwd, setLiveCwd] = useState(cwd)

  useEffect(() => {
    setLiveCwd(cwd)
    if (cwd || !ptyId) return
    let cancelled = false
    getPtyCwd(ptyId).then((value) => {
      if (!cancelled && value) setLiveCwd(value)
    }).catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [cwd, ptyId])

  if (!liveCwd) {
    return <div className={styles.message}>Este terminal nao possui uma pasta ativa.</div>
  }

  return (
    <div className={styles.explorer}>
      <div className={styles.context} title={liveCwd}>
        <span className={styles.contextName}>{terminalName}</span>
        <span className={styles.contextPath}>{liveCwd}</span>
        <button
          type="button"
          className={styles.iconButton}
          onClick={() => setReloadKey((value) => value + 1)}
          title="Atualizar arquivos"
          aria-label="Atualizar arquivos"
        >
          <RefreshCw size={13} />
        </button>
      </div>
      <DirectoryNode path={liveCwd} name={rootName(liveCwd)} depth={0} initialOpen reloadKey={reloadKey} />
    </div>
  )
}

function DirectoryNode({
  path,
  name,
  depth,
  initialOpen = false,
  reloadKey,
}: {
  path: string
  name: string
  depth: number
  initialOpen?: boolean
  reloadKey: number
}) {
  const [open, setOpen] = useState(initialOpen)
  const [entries, setEntries] = useState<DirectoryEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(false)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setLoading(true)
    setError(false)
    listDirectory(path)
      .then((result) => {
        if (!cancelled) setEntries(result)
      })
      .catch(() => {
        if (!cancelled) setError(true)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [open, path, reloadKey])

  return (
    <div>
      <button
        type="button"
        className={`${styles.row} ${depth === 0 ? styles.rootRow : ''}`}
        style={{ paddingLeft: 8 + depth * 14 }}
        onClick={() => setOpen((value) => !value)}
        title={path}
      >
        {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        {open ? <FolderOpen size={14} /> : <Folder size={14} />}
        <span>{name}</span>
      </button>
      {open ? (
        <div>
          {loading ? <div className={styles.message}>Carregando...</div> : null}
          {error ? <div className={styles.message}>Nao foi possivel ler esta pasta.</div> : null}
          {!loading && !error
            ? entries.map((entry) =>
                entry.is_dir ? (
                  <DirectoryNode
                    key={entry.path}
                    path={entry.path}
                    name={entry.name}
                    depth={depth + 1}
                    reloadKey={reloadKey}
                  />
                ) : (
                  <div
                    key={entry.path}
                    className={styles.row}
                    style={{ paddingLeft: 22 + depth * 14 }}
                    title={entry.path}
                  >
                    <File size={13} />
                    <span>{entry.name}</span>
                  </div>
                ),
              )
            : null}
        </div>
      ) : null}
    </div>
  )
}

function rootName(path: string): string {
  const normalized = path.replace(/[\\/]+$/, '')
  return normalized.split(/[\\/]/).pop() || normalized
}
