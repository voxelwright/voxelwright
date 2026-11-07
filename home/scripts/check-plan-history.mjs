// Page-free proof for plan versions (#48): src/build/history.ts with the memory
// store, then with hostStore against a real villager host (stub agent, no model).
// Usage: node scripts/check-plan-history.mjs   (needs host/node_modules: cd ../host && npm ci)
// Vite loads the TypeScript in-process (no port, no browser). Synthetic data only.
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from 'vite'

const vite = await createServer({ root: new URL('..', import.meta.url).pathname, server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom', logLevel: 'error', optimizeDeps: { noDiscovery: true } })
const H = await vite.ssrLoadModule('/src/build/history.ts')
const P = await vite.ssrLoadModule('/src/build/plan.ts')
const { PlanHistory, memoryStore, hostStore, diff, canonical, StaleHead, StoreError, HistoryError } = H
const { KITCHEN, PlanError } = P

const checks = []
const check = (name, pass, detail) => {
  checks.push({ name, pass: Boolean(pass) })
  console.log(`${pass ? 'ok  ' : 'FAIL'} ${name}${pass || detail === undefined ? '' : ` ${JSON.stringify(detail)}`}`)
}
const same = (a, b) => canonical(a) === canonical(b)
const refusal = async (fn) => {
  try {
    await fn()
    return null
  } catch (error) {
    return error
  }
}
const snapshot = (h) => canonical({ head: h.head, versions: h.versions(), plan: h.plan })

const move = { op: 'moveWall', wallId: 'kitchen.right', by: 1 }
const bend = { op: 'bendWall', wallId: 'kitchen.right', sagitta: 0.5 }
const pantry = { op: 'addRoom', room: { id: 'pantry', label: 'Pantry' }, wallId: 'kitchen.left', from: 1, to: 5, depth: 3, door: { id: 'pantry.door', from: 2.25, to: 3.75, leaves: 2 } }

try {
  // ---- memory store: commit, undo, redo, branch, checkout, rename
  const store = memoryStore({ by: 'alex' })
  const h = await PlanHistory.open(store, KITCHEN)
  const root = h.head
  check('first open saves the base as the root', h.versions().length === 1 && h.versions()[0].parent === null && same(h.plan, KITCHEN))
  const heard = []
  h.onChange((plan, head) => heard.push({ head, plan }))

  const v1 = await h.commit([move], 'wider kitchen')
  check('a commit moves the head and records edits, note, by and at', h.head === v1.id && v1.parent === root && v1.note === 'wider kitchen' && v1.by === 'alex' && same(v1.edits, [move]) && !same(h.plan, KITCHEN))
  check('onChange hears the new plan and head', heard.length === 1 && heard[0].head === v1.id && heard[0].plan === h.plan)

  const before = snapshot(h)
  const bad = await refusal(() => h.commit([{ op: 'moveOpening', openingId: 'kitchen.window', from: 0.5, to: 1.9 }]))
  check('an invalid edit is refused with reasons and changes nothing', bad instanceof PlanError && bad.reasons.some((r) => /overlaps/.test(r)) && snapshot(h) === before, bad?.reasons)
  const missing = await refusal(() => h.commit([{ op: 'moveWall', wallId: 'kitchen.nope', by: 1 }]))
  check('an edit on a missing wall is refused with reasons', missing instanceof PlanError && /does not exist/.test(missing.reasons[0]) && snapshot(h) === before)
  const noop = await refusal(() => h.commit([{ op: 'bendWall', wallId: 'kitchen.right', sagitta: 0 }]))
  check('an edit that changes nothing is refused, not saved', noop instanceof PlanError && noop.reasons[0] === 'nothing changed' && snapshot(h) === before)

  check('undo moves the head to the parent', (await h.undo()) && h.head === root && same(h.plan, KITCHEN))
  check('undo at the root is false', !(await h.undo()) && h.head === root)
  check('redo walks forward again', (await h.redo()) && h.head === v1.id)
  check('redo with nothing to redo is false', !(await h.redo()))

  await h.undo()
  const v2 = await h.commit([bend], 'bay window')
  check('a commit after undo branches from the head and clears redo', v2.parent === root && !(await h.redo()) && h.versions().length === 3)
  await h.checkout(v1.id)
  check('checkout moves to any version', h.head === v1.id && same(h.plan, h.planAt(v1.id)))
  const v3 = await h.commit([pantry])
  check('the next commit branches from the checked-out version', v3.parent === v1.id)
  await h.rename(v2.id, '  Bay\nwindow  ')
  check('rename stores a clean name', h.name(v2.id) === 'Bay window' && h.name(v1.id) === undefined)
  check('a blank name is refused', (await refusal(() => h.rename(v1.id, '  '))) instanceof PlanError)
  const queued = await Promise.all([h.commit([{ op: 'moveWall', wallId: 'kitchen.right', by: 0.3 }]), h.commit([{ op: 'moveWall', wallId: 'kitchen.right', by: 0.3 }])])
  check('commits sent together are saved one after the other', queued[1].parent === queued[0].id && h.head === queued[1].id)

  // ---- replay equals the cached plans
  const again = await PlanHistory.open(store, KITCHEN)
  check('reopening replays every version to the same plans and head', again.head === h.head && h.versions().every((v) => same(again.planAt(v.id), h.planAt(v.id))) && again.name(v2.id) === 'Bay window')

  // ---- concurrent pages: compare-and-set, never merge
  const other = await PlanHistory.open(store, KITCHEN)
  await h.commit([{ op: 'moveWall', wallId: 'kitchen.right', by: -0.2 }])
  const otherBefore = snapshot(other)
  const stale = await refusal(() => other.commit([bend]))
  check('a page on a stale head is refused and keeps its history', stale instanceof StaleHead && stale.head === h.head && snapshot(other) === otherBefore)
  check('a stale undo is refused too', (await refusal(() => other.undo())) instanceof StaleHead && snapshot(other) === otherBefore)
  await other.refresh()
  check('refresh adopts the other page’s head', other.head === h.head && same(other.plan, h.plan))

  // ---- a failed save is never a version
  const flaky = memoryStore()
  const failing = { ...flaky, commit: async () => { throw new StoreError(0, 'the host could not be reached: disk full') }, setHead: flaky.setHead, load: flaky.load, rename: flaky.rename }
  const f = await PlanHistory.open(flaky, KITCHEN)
  const fv = await f.commit([move])
  const fStore = { ...failing }
  const f2 = await PlanHistory.open({ ...fStore, setHead: async () => { throw new StoreError(500, 'write failed') } }, KITCHEN)
  const fBefore = snapshot(f2)
  let heardFail = 0
  f2.onChange(() => heardFail++)
  const err = await refusal(() => f2.commit([bend]))
  check('a store that throws mid-commit: the error surfaces, no version, head unchanged', err instanceof StoreError && /disk full/.test(err.message) && snapshot(f2) === fBefore && f2.head === fv.id && heardFail === 0)
  const errUndo = await refusal(() => f2.undo())
  check('a failed undo leaves the head and redo path as they were', errUndo instanceof StoreError && snapshot(f2) === fBefore && !(await f2.redo().catch(() => false)))
  check('after a failure the history still works', (await f.commit([bend])).parent === fv.id)

  // The store accepts the version but the answer is lost: the page reports failure, then reconciles by reloading, never by resending.
  const lossy = memoryStore()
  const lost = { ...lossy, commit: async (v) => { await lossy.commit(v); throw new StoreError(0, 'the host could not be reached: connection reset') } }
  const l = await PlanHistory.open(lost, KITCHEN)
  check('a root saved with its answer lost is adopted on open', l.versions().length === 1)
  const lBefore = snapshot(l)
  const lostErr = await refusal(() => l.commit([move]))
  const nextErr = await refusal(() => l.commit([bend]))
  await l.refresh()
  check('a lost answer: the commit fails, the next one is stale, refresh adopts the saved version once', lostErr instanceof StoreError && nextErr instanceof StaleHead && l.versions().length === 2 && snapshot(l) !== lBefore && same(l.versions()[1].edits, [move]))

  // ---- a history whose replay no longer matches is refused, not shown
  const tampered = { ...flaky, load: async () => { const s = await flaky.load(); s.versions[1].hash = 'f'.repeat(64); return s } }
  const drift = await refusal(() => PlanHistory.open(tampered, KITCHEN))
  check('a version that replays to a different plan stops open with its id', drift instanceof HistoryError && drift.versionId === fv.id && drift.replayed)

  // ---- diff
  const K = KITCHEN
  const moved = diff(K, h.planAt(v1.id))
  check('diff: a moved wall is changed, with the walls it drags', moved.walls.changed.includes('kitchen.right') && moved.walls.changed.includes('kitchen.back') && !moved.walls.changed.includes('kitchen.left') && !moved.walls.added.length && !moved.walls.removed.length, moved.walls)
  check('diff: the moved corners and the room are changed', same(moved.corners.changed.sort(), ['kitchen.back-right', 'kitchen.front-right']) && same(moved.rooms.changed, ['kitchen']), moved)
  check('diff: openings on a wall whose far corner moved are unchanged', !moved.openings.changed.length, moved.openings)
  const added = diff(h.planAt(v1.id), h.planAt(v3.id))
  check('diff: an added room adds the room, its walls, corners and door', same(added.rooms.added, ['pantry']) && ['pantry.w1', 'pantry.w2', 'pantry.w3', 'pantry.shared', 'pantry.rest'].every((id) => added.walls.added.includes(id)) && added.corners.added.length === 4 && same(added.openings.added, ['pantry.door']), added)
  check('diff: the split host wall keeps its id and is changed, not removed', added.walls.changed.includes('kitchen.left') && !added.walls.removed.length && added.rooms.changed.includes('kitchen'), added.walls)
  const openingMoved = diff(K, P.apply(K, { op: 'moveOpening', openingId: 'kitchen.window', from: 2.05, to: 3.45 }))
  check('diff: a moved opening is changed and nothing else', same(openingMoved.openings.changed, ['kitchen.window']) && !openingMoved.walls.changed.length && !openingMoved.rooms.changed.length, openingMoved)
  check('diff of a plan with itself is empty', Object.values(diff(K, K)).every((d) => !d.added.length && !d.removed.length && !d.changed.length))

  // ---- hostStore against the real host (synthetic people, stub agent)
  // The host's own cordis, so its plugin and this Context are the same copy.
  const { Context } = await import('../../host/node_modules/cordis/lib/index.js')
  const villager = (await import('../../host/src/villager.ts')).default
  const { stubAgent } = await import('../../host/src/villager-agent.ts')
  const dataRoot = await mkdtemp(join(tmpdir(), 'plan-history-'))
  const startHost = async () => {
    const ctx = new Context()
    const fiber = ctx.plugin(villager, { root: dataRoot, agent: stubAgent(0), port: 0, people: { alex: 'Alex', sam: 'Sam' } })
    await fiber.await()
    const launch = JSON.parse(await readFile(ctx.villager.launchFile, 'utf8'))
    return { fiber, base: `http://127.0.0.1:${launch.port}`, token: launch.token }
  }
  try {
    let host = await startHost()
    const alex = await PlanHistory.open(hostStore({ base: host.base, person: 'alex', token: host.token }), KITCHEN)
    const sam = await PlanHistory.open(hostStore({ base: host.base, person: 'sam', token: host.token }), KITCHEN)
    check('host: two pages share one root', alex.head === sam.head && alex.versions().length === 1)
    const a1 = await alex.commit([move], 'wider')
    await alex.commit([bend])
    await alex.undo()
    await alex.rename(a1.id, 'Wider kitchen')
    const samStale = await refusal(() => sam.commit([pantry]))
    check('host: a stale page is refused with the current head', samStale instanceof StaleHead && samStale.head === alex.head)
    await sam.refresh()
    const s1 = await sam.commit([pantry])
    check('host: after refresh the other person commits, recorded as theirs', s1.by === 'sam' && s1.parent === a1.id)
    await alex.refresh()
    const expected = { head: alex.head, plans: alex.versions().map((v) => [v.id, canonical(alex.planAt(v.id))]), name: alex.name(a1.id) }
    await host.fiber.dispose()
    host = await startHost()
    const reopened = await PlanHistory.open(hostStore({ base: host.base, person: 'alex', token: host.token }), KITCHEN)
    check('host: a restarted host reopens to the same head, plans and names', reopened.head === expected.head && same(reopened.versions().map((v) => [v.id, canonical(reopened.planAt(v.id))]), expected.plans) && reopened.name(a1.id) === 'Wider kitchen')
    const noToken = await refusal(() => PlanHistory.open(hostStore({ base: host.base, person: 'alex', token: 'f'.repeat(64) }), KITCHEN))
    check('host: a wrong token is a StoreError 401', noToken instanceof StoreError && noToken.status === 401)
    await host.fiber.dispose()
  } finally {
    await rm(dataRoot, { recursive: true, force: true })
  }
} finally {
  await vite.close()
}

const failed = checks.filter((c) => !c.pass).length
console.log(`${checks.length - failed}/${checks.length} checks pass`)
process.exit(failed ? 1 : 0)
