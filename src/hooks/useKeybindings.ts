import { useEffect } from 'react'

import {
  MAX_RECENT_PROJECT_TABS,
  UI_ZOOM_LIMITS,
  getProjectDefaultCwd,
  selectActiveContainer,
  selectActiveProject,
  useProjectsStore,
} from '../stores/projectsStore'
import { useUiStore } from '../stores/uiStore'

/**
 * Atalhos globais. Ignora se o foco estiver num input/textarea editáveis —
 * exceto Esc, que sempre fecha o modal aberto.
 */
export function useKeybindings() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Esc fecha modal aberto
      if (e.key === 'Escape') {
        const ui = useUiStore.getState()
        if (ui.openModal) {
          e.preventDefault()
          ui.closeModal()
          return
        }
        const projects = useProjectsStore.getState()
        if (projects.preferences.fullscreenContainerId) {
          e.preventDefault()
          projects.setFullscreenContainer(null)
          return
        }
      }

      const target = e.target as HTMLElement | null
      const inEditable =
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable)

      const ctrl = e.ctrlKey || e.metaKey
      if (ctrl && !e.altKey && isZoomKey(e)) {
        e.preventDefault()
        const projects = useProjectsStore.getState()
        const current = projects.preferences.uiZoom
        if (isZoomResetKey(e)) {
          projects.setUiZoom(1)
        } else {
          const direction = isZoomInKey(e) ? 1 : -1
          projects.setUiZoom(current + direction * UI_ZOOM_LIMITS.step)
        }
        return
      }

      if (!ctrl && inEditable) return

      // Ctrl+T → cria shell rápido
      if (ctrl && !e.shiftKey && !e.altKey && (e.key === 't' || e.key === 'T')) {
        e.preventDefault()
        const projects = useProjectsStore.getState()
        const project = selectActiveProject(projects)
        if (!project) return
        const cwd = getProjectDefaultCwd(project)
        projects.createTerminal(project.id, {
          name: 'shell',
          cwd,
          firstTab: { type: 'shell', cwd },
        })
        return
      }

      // Ctrl+Shift+T → modal de novo terminal (escolhe tipo)
      if (ctrl && e.shiftKey && (e.key === 'T' || e.key === 't')) {
        e.preventDefault()
        const project = selectActiveProject(useProjectsStore.getState())
        if (!project) return
        useUiStore.getState().openModal_('newTerminal', { projectId: project.id })
        return
      }

      // Ctrl+W → fecha (oculta) o primeiro pane do container ativo
      if (ctrl && !e.shiftKey && (e.key === 'w' || e.key === 'W')) {
        e.preventDefault()
        const projects = useProjectsStore.getState()
        const container = selectActiveContainer(projects)
        if (!container || container.paneIds.length === 0) return
        projects.closePane(container.projectId, container.paneIds[0])
        return
      }

      // Ctrl+P → busca/jump (find)
      if (ctrl && !e.shiftKey && (e.key === 'p' || e.key === 'P')) {
        e.preventDefault()
        useUiStore.getState().openModal_('findJump')
        return
      }

      // Ctrl+Shift+P → modal novo projeto
      if (ctrl && e.shiftKey && (e.key === 'P' || e.key === 'p')) {
        e.preventDefault()
        useUiStore.getState().openModal_('newProject')
        return
      }

      // Ctrl+Shift+G → modal novo grupo
      if (ctrl && e.shiftKey && (e.key === 'G' || e.key === 'g')) {
        e.preventDefault()
        useUiStore.getState().openModal_('newGroup')
        return
      }

      // Ctrl+Shift+H → toggle Home ↔ workspace
      if (ctrl && e.shiftKey && (e.key === 'H' || e.key === 'h')) {
        e.preventDefault()
        useUiStore.getState().toggleHome()
        return
      }

      // Ctrl+1..9 → pula pra projeto N (na ordem da sidebar)
      if (ctrl && !e.shiftKey && /^[1-9]$/.test(e.key)) {
        e.preventDefault()
        const idx = Number(e.key) - 1
        const projects = useProjectsStore.getState()
        const target = projects.projects[idx]
        if (target) projects.openProjectWorkspace(target.id)
        return
      }

      // Alt+Left / Alt+Right → histórico persistente da workspace.
      if (e.altKey && !ctrl && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
        e.preventDefault()
        const projects = useProjectsStore.getState()
        projects.navigateWorkspaceHistory(e.key === 'ArrowLeft' ? -1 : 1)
        useUiStore.getState().setActiveView('workspace')
        return
      }

      // Ctrl+Tab → alterna tabs de projeto da topbar sem reordenar os slots.
      if (ctrl && e.key === 'Tab') {
        e.preventDefault()
        const projects = useProjectsStore.getState()
        const ui = useUiStore.getState()
        const topTabs = projects.workspace.tabs.slice(0, MAX_RECENT_PROJECT_TABS)
        if (topTabs.length < 2) return
        const currentIndex = topTabs.findIndex((tab) => tab.id === projects.workspace.activeTabId)
        const direction = e.shiftKey ? -1 : 1
        const nextIndex =
          currentIndex === -1
            ? 0
            : (currentIndex + direction + topTabs.length) % topTabs.length
        const nextTab = topTabs[nextIndex]
        projects.activateWorkspaceTab(nextTab.id)
        ui.setActiveView('workspace')
        return
      }
    }

    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [])
}

function isZoomKey(e: KeyboardEvent): boolean {
  return isZoomInKey(e) || isZoomOutKey(e) || isZoomResetKey(e)
}

function isZoomInKey(e: KeyboardEvent): boolean {
  return e.key === '+' || e.key === '=' || e.code === 'NumpadAdd'
}

function isZoomOutKey(e: KeyboardEvent): boolean {
  return e.key === '-' || e.key === '_' || e.code === 'NumpadSubtract'
}

function isZoomResetKey(e: KeyboardEvent): boolean {
  return e.key === '0' || e.code === 'Numpad0'
}
