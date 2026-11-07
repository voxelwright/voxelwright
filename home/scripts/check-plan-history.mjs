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
const { PlanHistory, memoryStore, hostStore, diff, canonical, upgrade, StaleHead, StoreError, HistoryError, ReadOnly } = H
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
  const store = memoryStore()
  const h = await PlanHistory.open(store, KITCHEN)
  const root = h.head
  check('first open saves the base as the root', h.versions().length === 1 && h.versions()[0].parent === null && same(h.plan, KITCHEN))
  const heard = []
  h.onChange((plan, head) => heard.push({ head, plan }))

  const v1 = await h.commit([move], 'wider kitchen')
  check('a commit moves the head and records edits, note, at and the plan it made, and no one by name', h.head === v1.id && v1.parent === root && v1.note === 'wider kitchen' && !('by' in v1) && same(v1.edits, [move]) && same(v1.plan, h.plan) && !same(h.plan, KITCHEN))
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
  check('reopening reads every version to the same plans and head', again.head === h.head && h.versions().every((v) => same(again.planAt(v.id), h.planAt(v.id))) && again.name(v2.id) === 'Bay window')

  // ---- concurrent pages: compare-and-set, never merge
  const other = await PlanHistory.open(store, KITCHEN)
  await h.commit([{ op: 'moveWall', wallId: 'kitchen.right', by: -0.2 }])
  const otherCount = other.versions().length
  let otherHeard = null
  other.onChange((plan, head) => (otherHeard = head))
  const stale = await refusal(() => other.commit([bend]))
  check('F7: a page on a stale head is refused, saves nothing of its own, and has already taken the other head', stale instanceof StaleHead && stale.head === h.head && other.head === h.head && same(other.plan, h.plan) && other.versions().length === otherCount + 1 && otherHeard === h.head && other.versions().every((v) => h.versions().some((k) => k.id === v.id)))
  const retried = await other.commit([bend])
  check('F7: after a StaleHead the next try builds on the new head without a reload', retried.parent === h.versions().at(-1).id)
  await h.refresh()
  check('refresh adopts the other page’s head', h.head === other.head && same(other.plan, h.plan))
  await h.commit([{ op: 'moveWall', wallId: 'kitchen.right', by: -0.2 }])
  const staleUndo = await refusal(() => other.undo())
  check('a stale undo is refused too, and the page takes the new head', staleUndo instanceof StaleHead && other.head === h.head)

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

  // ---- F1: a version is the plan it saved; edits are never replayed
  const clamp = memoryStore()
  const ch = await PlanHistory.open(clamp, KITCHEN)
  const clamped = await ch.commit([{ op: 'moveWall', wallId: 'kitchen.right', by: -6 }])
  const rightX = (plan) => plan.corners.find((c) => c.id === 'kitchen.back-right').x
  const movedBy = rightX(clamped.plan) - rightX(KITCHEN)
  // Change what the edit says (as a change to snap or MIN_ROOM_SIDE would change what it does): the house stays the saved one.
  const rewritten = { ...clamp, load: async () => { const st = await clamp.load(); st.versions[1].edits = [{ op: 'moveWall', wallId: 'kitchen.nope', by: 99 }]; return st } }
  const reread = await PlanHistory.open(rewritten, KITCHEN)
  check('F1: moveWall by -6 stops at the room side, and the version stores the house it made', Math.abs(movedBy + 3.6) < 1e-6 && same(clamped.plan, ch.plan), movedBy)
  check('F1: open reads stored plans, so edits that would not replay change nothing', same(reread.plan, clamped.plan) && reread.head === clamped.id)
  check('F1: a stored version has no hash or base', !('hash' in clamped) && !('base' in reread.versions()[0]) && same(reread.versions()[0].plan, KITCHEN))

  // F1: the upgrade hook, keyed on plan.version (identity at v1; a fake v0 -> v1 step proves the path).
  const v0 = ({ furniture, ...rest }) => ({ ...rest, version: 0 })
  const toV1 = { 0: (p) => ({ ...p, version: 1, furniture: [] }) }
  check('F1: upgrade is identity for a v1 plan', upgrade(KITCHEN) === KITCHEN)
  check('F1: upgrade runs the v0 step', same(upgrade(v0(KITCHEN), toV1), KITCHEN))
  check('F1: a plan from a newer home is refused with why', /newer home/.test((await refusal(async () => upgrade({ ...KITCHEN, version: 2 })))?.message ?? ''))
  const old = memoryStore()
  const oh = await PlanHistory.open(old, KITCHEN)
  const ov1 = await oh.commit([move])
  await oh.commit([bend])
  const withOld = (headAt) => ({ ...old, load: async () => { const st = await old.load(); st.versions[1].plan = v0(st.versions[1].plan); if (headAt) st.head = st.versions[1].id; return st } })
  const noStep = await PlanHistory.open(withOld(false), KITCHEN)
  const unreadable = await refusal(async () => noStep.planAt(ov1.id))
  check('F1: an old version with no upgrade step is listed but unreadable, and the house still opens', noStep.versions().length === 3 && unreadable instanceof HistoryError && /no upgrade from plan version 0/.test(unreadable.message) && same(noStep.plan, oh.plan))
  check('F1: an unreadable version cannot be checked out', (await refusal(() => noStep.checkout(ov1.id))) instanceof HistoryError && noStep.head === oh.head)
  const stepped = await PlanHistory.open(withOld(false), KITCHEN, { upgrades: toV1 })
  check('F1: with the v0 step the old version reads as v1', same(stepped.planAt(ov1.id), { ...oh.planAt(ov1.id), furniture: [] }))
  const headOld = await refusal(() => PlanHistory.open(withOld(true), KITCHEN))
  check('F1: only an unreadable head stops open, with the version and why', headOld instanceof HistoryError && headOld.versionId === ov1.id)

  // ---- F8: what the history hands out is frozen
  const tryWrite = (fn) => { try { fn(); return false } catch (error) { return error instanceof TypeError } }
  const frozenBefore = snapshot(h)
  check('F8: plan, planAt and versions() cannot be changed through what they hand out',
    tryWrite(() => { h.plan.corners[0].x = 99 }) && tryWrite(() => { h.planAt(root).walls[0].openings.push({}) }) &&
    tryWrite(() => { h.versions()[1].edits[0].by = 99 }) && tryWrite(() => { h.versions()[0].plan.rooms[0].label = 'x' }) && snapshot(h) === frozenBefore)

  // ---- F7: the store answers a retried version (same id, parent and content) with the stored one
  const retryStore = memoryStore()
  await PlanHistory.open(retryStore, KITCHEN)
  const rs = await retryStore.load()
  const sentAgain = { id: '1234567890abcdef', parent: rs.head, edits: [move], plan: P.apply(KITCHEN, move) }
  const first = await retryStore.commit(sentAgain)
  const again2 = await retryStore.commit(sentAgain)
  const clash = await refusal(() => retryStore.commit({ ...sentAgain, note: 'other' }))
  check('F7: a retried version is answered with the stored one; a different one with its id is a 409, not stale', same(first, again2) && (await retryStore.load()).versions.length === 2 && clash instanceof StoreError && clash.status === 409 && !(clash instanceof StaleHead))

  // ---- F2: a host that is there but cannot be opened gives a read-only house that says why
  const ro = PlanHistory.readOnly(KITCHEN, 'the saved house is away', new Error('500'))
  const roCommit = await refusal(() => ro.commit([move]))
  check('F2: a read-only house shows the plan and refuses every change with its reason', same(ro.plan, KITCHEN) && ro.readOnly === 'the saved house is away' && ro.failure?.message === '500' && roCommit instanceof ReadOnly && roCommit.reasons[0] === 'the saved house is away' && (await refusal(() => ro.undo())) instanceof ReadOnly && ro.versions().length === 1)
  const realFetch = globalThis.fetch
  try {
    globalThis.fetch = async (url) => String(url) === '/villager/launch'
      ? new Response(JSON.stringify({ token: 't' }), { status: 200 })
      : new Response(JSON.stringify({ error: 'plan event 3 follows 1' }), { status: 500 })
    const { house, READ_ONLY_LINE } = await vite.ssrLoadModule('/src/build/house.ts')
    const hh = await house()
    check('F2: house() with a host token and a failing store is read-only, not a page-only copy', hh.readOnly === READ_ONLY_LINE && hh.failure instanceof StoreError && (await refusal(() => hh.commit([move]))) instanceof ReadOnly)
  } finally {
    globalThis.fetch = realFetch
  }

  // ---- stored plans are held to the house's rules, and the history's shape is checked
  {
    const good = memoryStore()
    await PlanHistory.open(good, KITCHEN)
    const loaded = await good.load()
    const broken = { ...loaded, versions: [{ ...loaded.versions[0], plan: { ...loaded.versions[0].plan, walls: loaded.versions[0].plan.walls.map((w, i) => (i === 1 ? { ...w, b: 'kitchen.nowhere' } : w)) } }] }
    const invalid = await refusal(() => PlanHistory.open({ ...memoryStore(), load: async () => structuredClone(broken) }, KITCHEN))
    check('a stored head that is not a valid house does not open as editable', invalid instanceof HistoryError && /not a valid house/.test(invalid.message), invalid?.message)
    const twisted = memoryStore()
    const tw = await PlanHistory.open({ ...twisted, commit: async (v) => { const st = await twisted.commit(v); return { ...st, plan: { ...st.plan, rooms: st.plan.rooms.map((r) => ({ ...r, label: r.label + '\uFFFD' })) } } } }, KITCHEN)
    const twErr = await refusal(() => tw.commit([move]))
    check('a store that returns a different plan is an error, not adopted', twErr instanceof StoreError && twErr.status === 500 && same(tw.plan, KITCHEN), twErr?.message)
    const shaped = (edit) => refusal(() => PlanHistory.open({ ...memoryStore(), load: async () => edit(structuredClone(loaded)) }, KITCHEN))
    const [twoRoots, childFirst, noHead] = await Promise.all([
      shaped((st) => ({ ...st, versions: [...st.versions, { ...st.versions[0], id: 'f'.repeat(16) }] })),
      shaped((st) => ({ ...st, versions: [{ ...st.versions[0], id: 'e'.repeat(16), parent: 'd'.repeat(16) }, ...st.versions] })),
      shaped((st) => ({ ...st, head: 'e'.repeat(16) })),
    ])
    check('two roots, a child before its parent, or an unstored head does not open', twoRoots instanceof HistoryError && childFirst instanceof HistoryError && noHead instanceof HistoryError, [twoRoots, childFirst, noHead].map((e) => e?.message))
    const turned = P.apply({ ...KITCHEN, furniture: [] }, { op: 'placeItem', furniture: { id: 'f.spin', item: { kind: 'box' }, at: { mount: 'floor', x: 0, z: 0.5, yaw: 17 * 2 * Math.PI + 0.25 } } })
    check('a turn is stored within one full turn (the host bounds angles)', Math.abs(turned.furniture[0].at.yaw - 0.25) < 1e-6, turned.furniture[0].at)
  }

  // ---- F3: things hung on walls move with them
  const W = P.wallOf
  const curve = (plan, id) => P.curveOf(plan, W(plan, id))
  const at = (plan, f) => P.pointAt(curve(plan, f.at.wallId), f.at.along).map((v) => Math.round(v * 1e4) / 1e4)
  const hang = (id, wallId, along) => ({ id, item: { kind: 'picture' }, at: { mount: 'wall', wallId, roomId: 'kitchen', along, height: 1.5, spin: 0 } })
  const hung = { ...KITCHEN, furniture: [hang('f.front', 'kitchen.front', 1), hang('f.back', 'kitchen.back', 6.5)] }
  const pic = (plan, id) => plan.furniture.find((f) => f.id === id)
  const wider = P.apply(hung, { op: 'moveWall', wallId: 'kitchen.right', by: 1 })
  check('F3: moving a wall shifts a picture on a wall whose corner a moved, so it stays put in the room', Math.abs(pic(wider, 'f.front').at.along - 2) < 1e-6 && same(at(wider, pic(wider, 'f.front')), at(hung, pic(hung, 'f.front'))), pic(wider, 'f.front'))
  const narrower = P.apply(hung, { op: 'moveWall', wallId: 'kitchen.right', by: -3 })
  const backLen = curve(narrower, 'kitchen.back').length
  check('F3: a wall move that would push a picture off its wall stops early', pic(narrower, 'f.back').at.along <= backLen && Math.abs(rightX(narrower) - rightX(hung) + 0.3) < 1e-6, { backLen, x: rightX(narrower) - rightX(hung) })
  check('F3: validate refuses a picture off its wall', P.validate({ ...KITCHEN, furniture: [hang('f.off', 'kitchen.back', 99)] }).some((r) => /f\.off is 99\.00 m along/.test(r)))
  const onLeft = { ...KITCHEN, furniture: [hang('f.a', 'kitchen.left', 0.5), hang('f.b', 'kitchen.left', 4.5), hang('f.c', 'kitchen.left', 5.5)] }
  const split = P.apply(onLeft, pantry)
  const homes = ['f.a', 'f.b', 'f.c'].map((id) => [pic(split, id).at.wallId, pic(split, id).at.along])
  check('F3: adding a room moves each picture to the piece it is on, measured from that piece', same(homes, [['kitchen.left', 0.5], ['pantry.shared', 3.5], ['pantry.rest', 0.5]]) && ['f.a', 'f.b', 'f.c'].every((id) => same(at(split, pic(split, id)), at(onLeft, pic(onLeft, id)))), homes)

  // ---- F5: a thing on a placed thing stands on it
  const [cx, cz] = [0, (KITCHEN.corners[0].z + KITCHEN.corners[2].z) / 2]
  const table = { id: 'f.table', item: { kind: 'table' }, at: { mount: 'floor', x: cx, z: cz, yaw: 0 } }
  const vase = { id: 'f.vase', item: { kind: 'vase' }, at: { mount: 'surface', x: cx + 0.3, y: 0.76, z: cz, yaw: 0, on: 'f.table' } }
  const cup = { id: 'f.cup', item: { kind: 'cup' }, at: { mount: 'surface', x: cx + 0.3, y: 0.9, z: cz, yaw: 0, on: 'f.vase' } }
  let set = [table, vase, cup].reduce((plan, f) => P.apply(plan, { op: 'placeItem', furniture: f }), KITCHEN)
  check('F5: a surface anchor keeps `on` when placed on placed furniture', pic(set, 'f.vase').at.on === 'f.table' && pic(set, 'f.cup').at.on === 'f.vase')
  const turned = P.apply(set, { op: 'moveItem', furnitureId: 'f.table', at: { mount: 'floor', x: cx + 1, z: cz, yaw: Math.PI / 2 } })
  const r4 = (a) => [a.x, a.y, a.z, a.yaw].map((v) => Math.round(v * 1e4) / 1e4)
  check('F5: moving the table carries what stands on it (and on that), turned with it', same(r4(pic(turned, 'f.vase').at), r4({ x: cx + 1, y: 0.76, z: cz - 0.3, yaw: Math.PI / 2 })) && same(r4(pic(turned, 'f.cup').at), r4({ x: cx + 1, y: 0.9, z: cz - 0.3, yaw: Math.PI / 2 })), [pic(turned, 'f.vase').at, pic(turned, 'f.cup').at])
  const lifted = P.apply(set, { op: 'moveItem', furnitureId: 'f.vase', at: { ...vase.at, y: 0.9, on: undefined } })
  check('F5: moving a surface support up carries what stands on it up too', Math.abs(pic(lifted, 'f.cup').at.y - 1.04) < 1e-6 && pic(lifted, 'f.vase').at.on === undefined, pic(lifted, 'f.cup').at)
  const refusedRemove = await refusal(async () => P.apply(set, { op: 'removeItem', furnitureId: 'f.table' }))
  check('F5: removing a thing something stands on is refused', refusedRemove instanceof PlanError && /f\.vase standing on it/.test(refusedRemove.message))
  const cycle = await refusal(async () => P.apply(set, { op: 'moveItem', furnitureId: 'f.vase', at: { ...vase.at, on: 'f.cup' } }))
  check('F5: standing on something that stands on you is refused', cycle instanceof PlanError && /stands on it/.test(cycle.message))
  check('F5: standing on a thing that is not in the house is refused', (await refusal(async () => P.apply(KITCHEN, { op: 'placeItem', furniture: vase }))) instanceof PlanError)

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
    const alex = await PlanHistory.open(hostStore({ base: host.base, token: host.token }), KITCHEN)
    const sam = await PlanHistory.open(hostStore({ base: host.base, token: host.token }), KITCHEN)
    check('host: two pages share one root', alex.head === sam.head && alex.versions().length === 1)
    const a1 = await alex.commit([move], 'wider')
    await alex.commit([bend])
    await alex.undo()
    await alex.rename(a1.id, 'Wider kitchen')
    const samStale = await refusal(() => sam.commit([pantry]))
    check('host: a stale page is refused with the current head, and has taken it', samStale instanceof StaleHead && samStale.head === alex.head && sam.head === alex.head)
    const s1 = await sam.commit([pantry])
    check('host: the other page commits on the new head; no one is named', !('by' in s1) && s1.parent === a1.id && same(s1.plan, sam.plan))
    await alex.refresh()
    const expected = { head: alex.head, plans: alex.versions().map((v) => [v.id, canonical(alex.planAt(v.id))]), name: alex.name(a1.id) }
    await host.fiber.dispose()
    host = await startHost()
    const reopened = await PlanHistory.open(hostStore({ base: host.base, token: host.token }), KITCHEN)
    check('host: a restarted host reopens to the same head, plans and names', reopened.head === expected.head && same(reopened.versions().map((v) => [v.id, canonical(reopened.planAt(v.id))]), expected.plans) && reopened.name(a1.id) === 'Wider kitchen')
    const noToken = await refusal(() => PlanHistory.open(hostStore({ base: host.base, token: 'f'.repeat(64) }), KITCHEN))
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
