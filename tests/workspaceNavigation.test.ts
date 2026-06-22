import assert from 'node:assert/strict'
import test from 'node:test'

import type { Preferences, Project, WorkspaceViewSnapshot } from '../src/lib/types.ts'
import {
  MAX_WORKSPACE_HISTORY,
  captureWorkspaceSnapshot,
  cloneWorkspaceSnapshot,
  compositionLabel,
  pushWorkspaceHistory,
  sanitizeWorkspaceSnapshot,
} from '../src/lib/workspaceNavigation.ts'

const preferences: Preferences = {
  language: 'en',
  uiTheme: 'dark',
  uiZoom: 1,
  terminalTheme: null,
  enabledAgents: { shell: true, claude: true, codex: true, opencode: true },
  onboardingDone: true,
  workspaceFlat: false,
  fullscreenContainerId: null,
  firstLaunchAt: null,
  displayName: '',
  profileImageUrl: '',
  accountCreated: true,
  alwaysStartOnHome: false,
  spotifyClientId: '',
  spotifyClientSecret: '',
  discordRichPresenceEnabled: false,
}

const projects: Project[] = [
  {
    id: 'project-a',
    name: 'Project A',
    groupId: null,
    terminals: [
      {
        id: 'terminal-a',
        name: 'Terminal A',
        cwd: 'C:\\a',
        tabs: [],
        activeTabId: '',
        disabled: false,
        laneVisible: null,
      },
    ],
    layoutMode: 'auto',
    collapsed: false,
    createdAt: 1,
  },
]

function snapshot(projectId = 'project-a', terminalId = 'terminal-a'): WorkspaceViewSnapshot {
  return captureWorkspaceSnapshot({
    containers: [
      {
        projectId,
        paneIds: [terminalId],
        size: 1,
        internalLayout: 'auto',
        collapsed: false,
      },
    ],
    activeProjectId: projectId,
    activeGroupId: null,
    focusedTerminalId: terminalId,
    preferences,
  })
}

test('pushWorkspaceHistory truncates the forward branch', () => {
  const a = snapshot()
  const first = pushWorkspaceHistory([], -1, {
    id: 'h1', tabId: 'tab-a', label: 'A', snapshot: a, visitedAt: 1,
  })
  const second = pushWorkspaceHistory(first.history, first.historyIndex, {
    id: 'h2', tabId: 'tab-b', label: 'B', snapshot: a, visitedAt: 2,
  })
  const branched = pushWorkspaceHistory(second.history, 0, {
    id: 'h3', tabId: 'tab-c', label: 'C', snapshot: a, visitedAt: 3,
  })

  assert.deepEqual(branched.history.map((entry) => entry.id), ['h1', 'h3'])
  assert.equal(branched.historyIndex, 1)
})

test('history keeps only the latest configured entries', () => {
  let history: ReturnType<typeof pushWorkspaceHistory> = { history: [], historyIndex: -1 }
  for (let index = 0; index < MAX_WORKSPACE_HISTORY + 5; index += 1) {
    history = pushWorkspaceHistory(history.history, history.historyIndex, {
      id: `h${index}`,
      tabId: 'tab-a',
      label: 'A',
      snapshot: snapshot(),
      visitedAt: index,
    })
  }
  assert.equal(history.history.length, MAX_WORKSPACE_HISTORY)
  assert.equal(history.history[0].id, 'h5')
})

test('sanitizeWorkspaceSnapshot removes missing projects and terminals', () => {
  const dirty = snapshot('project-a', 'missing-terminal')
  dirty.containers.push({
    projectId: 'missing-project',
    paneIds: ['anything'],
    size: 1,
    internalLayout: 'auto',
    collapsed: false,
  })

  const clean = sanitizeWorkspaceSnapshot(dirty, projects)
  assert.deepEqual(clean.containers, [])
  assert.equal(clean.activeProjectId, null)
  assert.equal(clean.focusedTerminalId, null)
})

test('snapshots are deep-cloned and composition labels include item count', () => {
  const original = snapshot()
  const cloned = cloneWorkspaceSnapshot(original)
  cloned.containers[0].paneIds.push('terminal-b')

  assert.deepEqual(original.containers[0].paneIds, ['terminal-a'])
  assert.equal(compositionLabel(cloned, projects), 'Project A + 1')
})
