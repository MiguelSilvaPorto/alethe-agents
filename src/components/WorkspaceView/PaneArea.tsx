import { Group, Panel, Separator } from 'react-resizable-panels'

import { useProjectsStore } from '../../stores/projectsStore'
import { cellStyle, gridContainerStyle, reconcileGridLayout } from '../../lib/gridLayout'
import type { GridLayout, LayoutMode, Terminal } from '../../lib/types'
import { MarkdownPane } from '../MarkdownPane'
import { TerminalPane } from '../TerminalPane'
import styles from './WorkspaceView.module.css'

/** Renderiza o pane certo conforme o tipo (terminal ou markdown viewer). */
function Pane({ projectId, terminal }: { projectId: string; terminal: Terminal }) {
  if (terminal.kind === 'markdown') {
    return <MarkdownPane projectId={projectId} terminal={terminal} />
  }
  return <TerminalPane projectId={projectId} terminal={terminal} />
}

export type PaneAreaProps = {
  projectId: string
  /** Prefixo único pros Panel ids — vital quando vários containers coexistem. */
  idPrefix: string
  terminals: Terminal[]
  layoutMode: LayoutMode
}

export function PaneArea({ projectId, idPrefix, terminals, layoutMode }: PaneAreaProps) {
  if (terminals.length === 0) return null
  if (terminals.length === 1) {
    return (
      <div className={styles.singlePane}>
        <Pane projectId={projectId} terminal={terminals[0]} />
      </div>
    )
  }
  if (layoutMode === 'grid')
    return <GridLayoutComponent projectId={projectId} terminals={terminals} />
  if (layoutMode === 'spotlight')
    return <SpotlightLayout projectId={projectId} idPrefix={idPrefix} terminals={terminals} />
  if (layoutMode === 'sidebar')
    return <SidebarLayout projectId={projectId} idPrefix={idPrefix} terminals={terminals} />
  return <AutoLayout projectId={projectId} idPrefix={idPrefix} terminals={terminals} />
}

function GridLayoutComponent({
  projectId,
  terminals,
}: {
  projectId: string
  terminals: Terminal[]
}) {
  const project = useProjectsStore((s) => s.projects.find((p) => p.id === projectId))
  const layout: GridLayout | undefined = project?.gridLayout
  const ids = terminals.map((t) => t.id)
  const reconciled = layout
    ? reconcileGridLayout(layout, ids)
    : { cols: 2, rows: Math.ceil(ids.length / 2), cells: {} as GridLayout['cells'] }
  // se sem layout salvo, faz auto-fill posicional
  if (!layout) {
    ids.forEach((id, i) => {
      reconciled.cells[id] = {
        col: (i % reconciled.cols) + 1,
        row: Math.floor(i / reconciled.cols) + 1,
        colSpan: 1,
        rowSpan: 1,
      }
    })
  }
  return (
    <div style={gridContainerStyle(reconciled)}>
      {terminals.map((t) => {
        const cell = reconciled.cells[t.id]
        if (!cell) return null
        return (
          <div key={t.id} style={cellStyle(cell)}>
            <Pane projectId={projectId} terminal={t} />
          </div>
        )
      })}
    </div>
  )
}

type LayoutProps = {
  projectId: string
  idPrefix: string
  terminals: Terminal[]
}

function AutoLayout({ projectId, idPrefix, terminals }: LayoutProps) {
  if (terminals.length === 2) {
    return (
      <Group orientation="horizontal" className={styles.fullSize}>
        <Panel id={`${idPrefix}-p-${terminals[0].id}`} minSize="15%">
          <Pane projectId={projectId} terminal={terminals[0]} />
        </Panel>
        <Separator className={styles.sepH} />
        <Panel id={`${idPrefix}-p-${terminals[1].id}`} minSize="15%">
          <Pane projectId={projectId} terminal={terminals[1]} />
        </Panel>
      </Group>
    )
  }
  const rows = chunkInto(terminals, 2)
  return (
    <Group orientation="vertical" className={styles.fullSize}>
      {rows.map((row, ri) => (
        <RowFragment
          key={ri}
          projectId={projectId}
          idPrefix={`${idPrefix}-r${ri}`}
          rowId={`${idPrefix}-row-${ri}`}
          terminals={row}
          isLast={ri === rows.length - 1}
        />
      ))}
    </Group>
  )
}

function RowFragment({
  projectId,
  idPrefix,
  rowId,
  terminals,
  isLast,
}: {
  projectId: string
  idPrefix: string
  rowId: string
  terminals: Terminal[]
  isLast: boolean
}) {
  return (
    <>
      <Panel id={rowId} minSize="10%">
        {terminals.length === 1 ? (
          <Pane projectId={projectId} terminal={terminals[0]} />
        ) : (
          <Group orientation="horizontal" className={styles.fullSize}>
            {terminals.map((t, i) => (
              <FragmentCol
                key={t.id}
                projectId={projectId}
                idPrefix={idPrefix}
                terminal={t}
                isLast={i === terminals.length - 1}
              />
            ))}
          </Group>
        )}
      </Panel>
      {isLast ? null : <Separator className={styles.sepV} />}
    </>
  )
}

function FragmentCol({
  projectId,
  idPrefix,
  terminal,
  isLast,
}: {
  projectId: string
  idPrefix: string
  terminal: Terminal
  isLast: boolean
}) {
  return (
    <>
      <Panel id={`${idPrefix}-p-${terminal.id}`} minSize="10%">
        <Pane projectId={projectId} terminal={terminal} />
      </Panel>
      {isLast ? null : <Separator className={styles.sepH} />}
    </>
  )
}

function FragmentRow({
  projectId,
  idPrefix,
  terminal,
  isLast,
}: {
  projectId: string
  idPrefix: string
  terminal: Terminal
  isLast: boolean
}) {
  return (
    <>
      <Panel id={`${idPrefix}-p-${terminal.id}`} minSize="10%">
        <Pane projectId={projectId} terminal={terminal} />
      </Panel>
      {isLast ? null : <Separator className={styles.sepV} />}
    </>
  )
}

function SpotlightLayout({ projectId, idPrefix, terminals }: LayoutProps) {
  const [main, ...rest] = terminals
  return (
    <Group orientation="horizontal" className={styles.fullSize}>
      <Panel id={`${idPrefix}-spot-main-${main.id}`} defaultSize="65%" minSize="25%">
        <Pane projectId={projectId} terminal={main} />
      </Panel>
      <Separator className={styles.sepH} />
      <Panel id={`${idPrefix}-spot-stack`} defaultSize="35%" minSize="15%">
        <Group orientation="vertical" className={styles.fullSize}>
          {rest.map((t, i) => (
            <FragmentRow
              key={t.id}
              projectId={projectId}
              idPrefix={idPrefix}
              terminal={t}
              isLast={i === rest.length - 1}
            />
          ))}
        </Group>
      </Panel>
    </Group>
  )
}

function SidebarLayout({ projectId, idPrefix, terminals }: LayoutProps) {
  const [main, ...rest] = terminals
  return (
    <Group orientation="horizontal" className={styles.fullSize}>
      <Panel id={`${idPrefix}-side-list`} defaultSize="22%" minSize="15%">
        <Group orientation="vertical" className={styles.fullSize}>
          {rest.map((t, i) => (
            <FragmentRow
              key={t.id}
              projectId={projectId}
              idPrefix={idPrefix}
              terminal={t}
              isLast={i === rest.length - 1}
            />
          ))}
        </Group>
      </Panel>
      <Separator className={styles.sepH} />
      <Panel id={`${idPrefix}-side-main-${main.id}`} defaultSize="78%" minSize="40%">
        <Pane projectId={projectId} terminal={main} />
      </Panel>
    </Group>
  )
}

function chunkInto<T>(arr: T[], size: number): T[][] {
  const result: T[][] = []
  for (let i = 0; i < arr.length; i += size) {
    result.push(arr.slice(i, i + size))
  }
  return result
}
