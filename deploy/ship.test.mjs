import assert from 'node:assert/strict'
import test from 'node:test'
import { buildPlan, parseShipArgs, resolveEggMedia } from './ship.mjs'

test('parseShipArgs handles defaults, targets and rejects conflicting or unknown flags', () => {
  assert.deepEqual(parseShipArgs([]), {
    help: false, world: true, site: true, publicOnly: false,
    skipBuild: false, skipLive: false, allowDirty: false, dryRun: false,
  })
  const worldOnly = parseShipArgs(['--world-only', '--public', '--skip-live', '--dry-run'])
  assert.equal(worldOnly.world, true)
  assert.equal(worldOnly.site, false)
  assert.equal(worldOnly.publicOnly, true)
  assert.equal(worldOnly.skipLive, true)
  assert.equal(worldOnly.dryRun, true)
  assert.throws(() => parseShipArgs(['--world-only', '--site-only']), /at most one/)
  assert.throws(() => parseShipArgs(['--bogus']), /unknown argument/)
})

test('resolveEggMedia picks up local media by default, respects env override and --public opt-out', () => {
  assert.equal(resolveEggMedia({ publicOnly: false, env: {}, defaultDir: '/d', exists: () => true }), '/d')
  assert.equal(resolveEggMedia({ publicOnly: false, env: {}, defaultDir: '/d', exists: () => false }), null)
  assert.equal(resolveEggMedia({ publicOnly: false, env: { VOXELWRIGHT_EGG_MEDIA: '/x' }, defaultDir: '/d', exists: () => false }), '/x')
  assert.equal(resolveEggMedia({ publicOnly: true, env: { VOXELWRIGHT_EGG_MEDIA: '/x' }, defaultDir: '/d', exists: () => true }), null)
})

test('buildPlan builds once and deploys chosen targets with commit SHA message', () => {
  const full = buildPlan(parseShipArgs([]), 'abcdef1234')
  assert.deepEqual(full.map((s) => s.label), [
    'build core wasm', 'build SF realm', 'build personal site & blog', 'assemble deploy folders',
    'deploy voxelwright.world', 'deploy zahynailo.dev',
  ])
  assert.deepEqual(full[4].args, ['cf', 'deploy', '--mode', 'world', '--message', 'abcdef1234'])
  assert.deepEqual(full[5].args, ['cf', 'deploy', '--message', 'abcdef1234'])

  const fast = buildPlan(parseShipArgs(['--world-only', '--skip-build']), 'deadbeef')
  assert.deepEqual(fast.map((s) => s.label), ['deploy voxelwright.world'])
})
