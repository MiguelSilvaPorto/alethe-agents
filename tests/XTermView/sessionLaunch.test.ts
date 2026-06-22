import assert from 'node:assert/strict'
import test from 'node:test'

import { buildAgentLaunch } from '../../src/lib/sessionLaunch.ts'

test('new Claude panes receive distinct deterministic session ids', () => {
  const ids = ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222']
  const first = buildAgentLaunch('claude', ['--dangerously-skip-permissions'], undefined, () => ids[0])
  const second = buildAgentLaunch('claude', ['--dangerously-skip-permissions'], undefined, () => ids[1])

  assert.notEqual(first.sessionId, second.sessionId)
  assert.deepEqual(first.args, ['--session-id', ids[0], '--dangerously-skip-permissions'])
  assert.deepEqual(second.args, ['--session-id', ids[1], '--dangerously-skip-permissions'])
})

test('Claude resumes only the session assigned to its pane', () => {
  const launch = buildAgentLaunch(
    'claude',
    ['--continue', '--resume', 'stale', '--session-id', 'stale-too', '--model', 'sonnet'],
    'pane-session',
  )

  assert.deepEqual(launch.args, ['--resume', 'pane-session', '--model', 'sonnet'])
  assert.equal(launch.createdSession, false)
})

test('Codex without a known id starts a new chat instead of resuming last', () => {
  const launch = buildAgentLaunch('codex', ['resume', '--last', '--search'])
  assert.deepEqual(launch.args, ['--search'])
})

test('Codex and OpenCode use their pane-specific resume syntax', () => {
  assert.deepEqual(
    buildAgentLaunch('codex', ['resume', 'old', '--search'], 'codex-pane').args,
    ['resume', 'codex-pane', '--search'],
  )
  assert.deepEqual(
    buildAgentLaunch('opencode', ['--continue', '--session', 'old', '--model', 'x'], 'open-pane').args,
    ['--session', 'open-pane', '--model', 'x'],
  )
})
