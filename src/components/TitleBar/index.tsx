import { getCurrentWindow } from '@tauri-apps/api/window'
import { ArrowLeft, ArrowRight, Maximize2, Menu, Minus, PanelLeftClose, PanelLeftOpen, Pencil, Pin, RefreshCw, Users, Workflow, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { ContextMenu, type MenuItem } from '../ProjectSidebar/ContextMenu'
import { ClaudeIcon, CodexIcon } from '../icons/AgentIcons'

import { getCachedClaudeUsage } from '../../lib/claudeUsageCache'
import { getCachedCodexUsage } from '../../lib/codexUsageCache'
import { useT } from '../../lib/i18n'
import { getMemoryStats, killPty } from '../../lib/tauri'
import type { ClaudeUsage } from '../../lib/tauri'
import { useProjectsStore } from '../../stores/projectsStore'
import { useUiStore } from '../../stores/uiStore'
import styles from './TitleBar.module.css'

const RAM_POLL_INTERVAL_MS = 5000
const CLAUDE_POLL_INTERVAL_MS = 5 * 60_000
const APP_TITLE = import.meta.env.DEV ? '(DEV) Alethe' : 'Alethe'

function usagePillColor(utilization: number): string {
  if (utilization >= 80) return 'var(--status-offline)'
  if (utilization >= 50) return 'var(--status-waiting)'
  return 'var(--status-working)'
}

function formatResetTime(resetsAt: string): string {
  try {
    const diff = new Date(resetsAt).getTime() - Date.now()
    if (diff <= 0) return 'resetting...'
    const h = Math.floor(diff / 3_600_000)
    const m = Math.floor((diff % 3_600_000) / 60_000)
    return h > 0 ? `${h}h ${m}m` : `${m}m`
  } catch {
    return resetsAt
  }
}

function buildClaudeTooltip(usage: ClaudeUsage): string {
  const pct = (v: number) => `${v.toFixed(0)}%`
  return [
    `5h session: ${pct(usage.five_hour.utilization)} (resets in ${formatResetTime(usage.five_hour.resets_at)})`,
    `7d total: ${pct(usage.seven_day.utilization)} (resets in ${formatResetTime(usage.seven_day.resets_at)})`,
    `7d opus: ${pct(usage.seven_day_opus.utilization)} (resets in ${formatResetTime(usage.seven_day_opus.resets_at)})`,
  ].join('\n')
}

export function TitleBar() {
  const t = useT()
  const toggleMainMenu = useUiStore((s) => s.toggleMainMenu)
  const sidebarVisible = useUiStore((s) => s.sidebarVisible)
  const toggleSidebar = useUiStore((s) => s.toggleSidebar)
  const activeView = useUiStore((s) => s.activeView)
  const agentCanvasSession = useUiStore((s) => s.agentCanvasSession)
  const setAgentCanvasSession = useUiStore((s) => s.setAgentCanvasSession)
  const setActiveView = useUiStore((s) => s.setActiveView)
  const ramMb = useUiStore((s) => s.ramMb)
  const addMemorySample = useUiStore((s) => s.addMemorySample)
  const claudeUsage = useUiStore((s) => s.claudeUsage)
  const codexUsage = useUiStore((s) => s.codexUsage)
  const setClaudeUsage = useUiStore((s) => s.setClaudeUsage)
  const setCodexUsage = useUiStore((s) => s.setCodexUsage)
  const openModal = useUiStore((s) => s.openModal_)
  const workspaceTabs = useProjectsStore((s) => s.workspace.tabs)
  const activeWorkspaceTabId = useProjectsStore((s) => s.workspace.activeTabId)
  const historyIndex = useProjectsStore((s) => s.workspace.historyIndex)
  const historyLength = useProjectsStore((s) => s.workspace.history.length)
  const profiles = useProjectsStore((s) => s.profiles)
  const activeProfileId = useProjectsStore((s) => s.activeProfileId)
  const preferences = useProjectsStore((s) => s.preferences)
  const activateWorkspaceTab = useProjectsStore((s) => s.activateWorkspaceTab)
  const toggleWorkspaceTabPinned = useProjectsStore((s) => s.toggleWorkspaceTabPinned)
  const closeSavedWorkspaceTab = useProjectsStore((s) => s.closeSavedWorkspaceTab)
  const addWorkspaceTabToCurrent = useProjectsStore((s) => s.addWorkspaceTabToCurrent)
  const [tabMenu, setTabMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null)
  const navigateWorkspaceHistory = useProjectsStore((s) => s.navigateWorkspaceHistory)
  const activeProfile = profiles.find((profile) => profile.id === activeProfileId) ?? null

  const closeAgentPlanning = () => {
    if (!agentCanvasSession) return
    if (activeView === 'agentCanvas') {
      window.dispatchEvent(new CustomEvent('alethe:agent-canvas-exit'))
      return
    }
    void killPty(agentCanvasSession.ptyId).catch(() => {
      /* PTY pode já ter morrido */
    })
    setAgentCanvasSession(null)
  }

  // Pausa o polling (RAM + usage) quando a janela não está focada/visível —
  // telemetria não precisa rodar em background. Reativa no próximo tick.
  const activeRef = useRef(true)

  // RAM polling — adiado pra não competir com boot/render inicial.
  useEffect(() => {
    let cancelled = false
    let interval: number | null = null
    const tick = async () => {
      if (!activeRef.current) return
      try {
        const stats = await getMemoryStats()
        if (!cancelled) addMemorySample(stats)
      } catch {
        /* ignora — backend ainda subindo */
      }
    }
    const startupDelay = window.setTimeout(() => {
      void tick()
      interval = window.setInterval(tick, RAM_POLL_INTERVAL_MS)
    }, 3000)
    return () => {
      cancelled = true
      window.clearTimeout(startupDelay)
      if (interval !== null) window.clearInterval(interval)
    }
  }, [addMemorySample])

  // Claude usage polling — adiado 1.5s (HTTP call externa, não trava boot).
  useEffect(() => {
    let cancelled = false
    let interval: number | null = null
    let consecutiveFailures = 0
    const tick = async () => {
      if (!activeRef.current) return
      try {
        const usage = await getCachedClaudeUsage()
        if (!cancelled) {
          setClaudeUsage(usage)
          consecutiveFailures = 0
        }
      } catch {
        // Só limpa após 3 falhas consecutivas — evita "sem token" intermitente
        // quando o credentials.json está sendo escrito pelo Claude ou rede flaky.
        consecutiveFailures += 1
        if (consecutiveFailures >= 3 && !cancelled) {
          setClaudeUsage(null)
        }
      }
    }
    const startupDelay = window.setTimeout(() => {
      void tick()
      interval = window.setInterval(tick, CLAUDE_POLL_INTERVAL_MS)
    }, 1500)
    return () => {
      cancelled = true
      window.clearTimeout(startupDelay)
      if (interval !== null) window.clearInterval(interval)
    }
  }, [setClaudeUsage])

  // Codex usage polling — sobe o `codex app-server` (subprocesso pesado), então
  // arranca depois do Claude (2.5s) e reusa o mesmo intervalo de 5min.
  useEffect(() => {
    let cancelled = false
    let interval: number | null = null
    let consecutiveFailures = 0
    const tick = async () => {
      if (!activeRef.current) return
      try {
        const usage = await getCachedCodexUsage()
        if (!cancelled) {
          setCodexUsage(usage)
          consecutiveFailures = 0
        }
      } catch {
        consecutiveFailures += 1
        if (consecutiveFailures >= 3 && !cancelled) {
          setCodexUsage(null)
        }
      }
    }
    const startupDelay = window.setTimeout(() => {
      void tick()
      interval = window.setInterval(tick, CLAUDE_POLL_INTERVAL_MS)
    }, 2500)
    return () => {
      cancelled = true
      window.clearTimeout(startupDelay)
      if (interval !== null) window.clearInterval(interval)
    }
  }, [setCodexUsage])

  const win = getCurrentWindow()

  // Rastreia foco/visibilidade da janela pra pausar o polling em background.
  useEffect(() => {
    const update = (focused: boolean) => {
      activeRef.current = focused && document.visibilityState === 'visible'
    }
    update(document.hasFocus())
    const onVisibility = () => update(document.hasFocus())
    document.addEventListener('visibilitychange', onVisibility)
    let unlisten: (() => void) | undefined
    void win.onFocusChanged(({ payload }) => update(payload)).then((fn) => {
      unlisten = fn
    })
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      unlisten?.()
    }
  }, [win])

  useEffect(() => {
    document.title = APP_TITLE
    void win.setTitle(APP_TITLE)
  }, [win])

  return (
    <div className={styles.bar} data-tauri-drag-region>
      <button
        type="button"
        className={styles.iconBtn}
        onClick={toggleMainMenu}
        title={t('ui.titlebar.menu')}
        aria-label={t('ui.titlebar.menu')}
      >
        <Menu size={14} />
      </button>
      <button
        type="button"
        className={`${styles.iconBtn} ${sidebarVisible ? styles.iconBtnActive : ''}`}
        onClick={toggleSidebar}
        title={sidebarVisible ? t('ui.titlebar.closeSidebar') : t('ui.titlebar.openSidebar')}
        aria-label={sidebarVisible ? t('ui.titlebar.closeSidebar') : t('ui.titlebar.openSidebar')}
        aria-pressed={sidebarVisible}
      >
        {sidebarVisible ? <PanelLeftClose size={14} /> : <PanelLeftOpen size={14} />}
      </button>
      <span className={styles.title} data-tauri-drag-region>
        {APP_TITLE}
      </span>
      {workspaceTabs.length > 0 || agentCanvasSession ? (
        <div
          className={styles.groupTabs}
          role="tablist"
          aria-label={t('ui.titlebar.recentTabs')}
          data-tauri-drag-region
        >
          <div className={styles.historyControls}>
            <button
              type="button"
              className={styles.historyBtn}
              disabled={historyIndex <= 0}
              onClick={() => { navigateWorkspaceHistory(-1); setActiveView('workspace') }}
              title={t('ui.titlebar.back')}
              aria-label={t('ui.titlebar.back')}
            >
              <ArrowLeft size={13} />
            </button>
            <button
              type="button"
              className={styles.historyBtn}
              disabled={historyIndex < 0 || historyIndex >= historyLength - 1}
              onClick={() => { navigateWorkspaceHistory(1); setActiveView('workspace') }}
              title={t('ui.titlebar.forward')}
              aria-label={t('ui.titlebar.forward')}
            >
              <ArrowRight size={13} />
            </button>
          </div>
          {workspaceTabs.map((tab) => {
            const active = activeWorkspaceTabId === tab.id
            const count = tab.snapshot.containers.reduce(
              (total, container) => total + container.paneIds.length,
              0,
            )
            return (
              <div
                key={tab.id}
                className={`${styles.groupTab} ${active ? styles.groupTabActive : ''} ${tab.pinned ? styles.groupTabPinned : ''}`}
                onContextMenu={(event) => {
                  event.preventDefault()
                  setTabMenu({
                    x: event.clientX,
                    y: event.clientY,
                    items: [
                      {
                        kind: 'item',
                        label: t('ui.workspace.openIndividually'),
                        onClick: () => { activateWorkspaceTab(tab.id); setActiveView('workspace') },
                      },
                      {
                        kind: 'item',
                        label: t('ui.workspace.addToCurrent'),
                        onClick: () => { addWorkspaceTabToCurrent(tab.id); setActiveView('workspace') },
                      },
                      { kind: 'separator' },
                      {
                        kind: 'item',
                        label: tab.pinned ? t('ui.titlebar.unpinTab') : t('ui.titlebar.pinTab'),
                        onClick: () => toggleWorkspaceTabPinned(tab.id),
                      },
                      { kind: 'separator' },
                      {
                        kind: 'item',
                        label: t('ui.titlebar.removeFromTopbar'),
                        danger: true,
                        onClick: () => closeSavedWorkspaceTab(tab.id),
                      },
                    ],
                  })
                }}
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={active}
                  className={styles.groupTabMain}
                  onClick={() => { activateWorkspaceTab(tab.id); setActiveView('workspace') }}
                  title={tab.label}
                >
                  {tab.pinned ? (
                    <Pin size={11} className={styles.groupTabPinIcon} />
                  ) : null}
                  {tab.iconUrl ? (
                    <img src={tab.iconUrl} alt="" className={styles.groupTabIcon} />
                  ) : tab.kind === 'composition' ? (
                    <Workflow size={14} className={styles.groupTabIconSvg} />
                  ) : (
                    <span className={styles.groupTabDot} style={{ background: tab.color ?? '#6ea8ff' }} />
                  )}
                  <span className={styles.groupTabName}>{tab.label}</span>
                  <span className={styles.groupTabCount}>{count}</span>
                </button>
                <button
                  type="button"
                  className={styles.groupTabClose}
                  onClick={(event) => { event.stopPropagation(); closeSavedWorkspaceTab(tab.id) }}
                  title={t('ui.titlebar.removeFromTopbar')}
                  aria-label={t('ui.titlebar.removeNameFromTopbar', { name: tab.label })}
                >
                  <X size={11} />
                </button>
              </div>
            )
          })}
          {agentCanvasSession ? (
            <div
              className={`${styles.groupTab} ${activeView === 'agentCanvas' ? styles.groupTabActive : ''}`}
              title={agentCanvasSession.folder}
            >
              <button
                type="button"
                role="tab"
                aria-selected={activeView === 'agentCanvas'}
                className={styles.groupTabMain}
                onClick={() => setActiveView('agentCanvas')}
                title={agentCanvasSession.folder}
              >
                <Workflow size={14} className={styles.groupTabIconSvg} />
                <span className={styles.groupTabName}>Agent Planning</span>
              </button>
              <button
                type="button"
                className={styles.groupTabClose}
                onClick={(event) => {
                  event.stopPropagation()
                  closeAgentPlanning()
                }}
                title={t('ui.titlebar.closeAgentPlanning')}
                aria-label={t('ui.titlebar.closeAgentPlanning')}
              >
                <X size={11} />
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
      <div className={styles.spacer} data-tauri-drag-region />
      <div className={styles.widgets}>
        {preferences.topbarShowSync ? (
          <button type="button" className={styles.syncPill} title={t('sync.title')} aria-label={t('sync.title')} onClick={() => openModal('sync')}>
            <RefreshCw size={12} />
          </button>
        ) : null}
        {preferences.topbarShowProfile ? (
          <button type="button" className={styles.profilePill} title={t('profile.manageAccounts')} onClick={() => openModal('profiles')}>
            <Users size={12} />
            <span className={styles.profilePillLabel}>{activeProfile?.name ?? t('profile.localAccount')}</span>
          </button>
        ) : null}
        {preferences.topbarShowClaudeUsage && claudeUsage !== null ? (
          <span className={`${styles.usagePill} ${styles.claudeUsage}`} style={{ '--pill-color': usagePillColor(claudeUsage.five_hour.utilization) } as React.CSSProperties} title={buildClaudeTooltip(claudeUsage)}>
            <ClaudeIcon size={13} />
            <span>{claudeUsage.five_hour.utilization.toFixed(0)}%</span>
          </span>
        ) : null}
        {preferences.topbarShowCodexUsage && codexUsage !== null ? (
          <span className={`${styles.usagePill} ${styles.codexUsage}`} style={{ '--pill-color': usagePillColor(codexUsage.primary.used_percent) } as React.CSSProperties} title={t('ui.titlebar.codexUsageTooltip', { primary: codexUsage.primary.used_percent.toFixed(0), secondary: codexUsage.secondary.used_percent.toFixed(0) })}>
            <CodexIcon size={13} />
            <span>{codexUsage.primary.used_percent.toFixed(0)}%</span>
          </span>
        ) : null}
        {preferences.topbarShowMemory && ramMb !== null ? (
          <button type="button" className={styles.ramPill} title={t('ui.titlebar.openMemoryAnalytics')} onClick={() => openModal('memoryAnalytics')}>
            {ramMb.toFixed(0)} MB
          </button>
        ) : null}
        <button type="button" className={styles.editWidgets} title={t('ui.titlebar.customize')} aria-label={t('ui.titlebar.customize')} onClick={() => openModal('topbarSettings')}>
          <Pencil size={12} />
        </button>
      </div>
      <button
        type="button"
        className={styles.windowBtn}
        onClick={() => void win.minimize()}
        title={t('ui.titlebar.minimize')}
        aria-label={t('ui.titlebar.minimize')}
      >
        <Minus size={14} />
      </button>
      <button
        type="button"
        className={styles.windowBtn}
        onClick={() => void win.toggleMaximize()}
        title={t('ui.titlebar.maximize')}
        aria-label={t('ui.titlebar.maximize')}
      >
        <Maximize2 size={12} />
      </button>
      <button
        type="button"
        className={`${styles.windowBtn} ${styles.close}`}
        onClick={() => void win.close()}
        title={t('ui.titlebar.close')}
        aria-label={t('ui.titlebar.close')}
      >
        <X size={14} />
      </button>
      {tabMenu ? (
        <ContextMenu
          x={tabMenu.x}
          y={tabMenu.y}
          items={tabMenu.items}
          onClose={() => setTabMenu(null)}
        />
      ) : null}
    </div>
  )
}
