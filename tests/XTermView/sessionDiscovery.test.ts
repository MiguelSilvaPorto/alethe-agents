import assert from 'node:assert/strict'
import test from 'node:test'

import {
  claimDiscoveredSession,
  registerSessionClaim,
  resetSessionClaimsForTests,
} from '../../src/lib/sessionDiscovery.ts'

test('concurrent panes cannot claim the same discovered session', () => {
  resetSessionClaimsForTests()
  const before = new Set(['old'])
  const sessions = [
    { id: 'second', modified_at_ms: 200 },
    { id: 'first', modified_at_ms: 100 },
    { id: 'old', modified_at_ms: 50 },
  ]

  assert.equal(claimDiscoveredSession('codex', 'C:\\repo', before, sessions)?.id, 'first')
  assert.equal(claimDiscoveredSession('codex', 'C:\\repo', before, sessions)?.id, 'second')
  assert.equal(claimDiscoveredSession('codex', 'C:\\repo', before, sessions), undefined)
})

test('known pane ids are excluded from later discovery', () => {
  resetSessionClaimsForTests()
  registerSessionClaim('codex', 'C:\\repo', 'assigned')
  const result = claimDiscoveredSession('codex', 'c:\\REPO', new Set(), [
    { id: 'assigned', modified_at_ms: 1 },
    { id: 'free', modified_at_ms: 2 },
  ])
  assert.equal(result?.id, 'free')
})
