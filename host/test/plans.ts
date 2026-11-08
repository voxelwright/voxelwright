// Headless checks of the house plan store (#48) through the villager API: no model is called.
// npm run check-plans
import { chmod, link, mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { request } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from 'cordis'
import villager from '../src/villager.ts'
import { stubAgent } from '../src/villager-agent.ts'

const root = await mkdtemp(join(tmpdir(), 'plans-check-'))
const checks: { name: string; pass: boolean; detail?: unknown }[] = []
const check = (name: string, pass: unknown, detail?: unknown) => checks.push({ name, pass: Boolean(pass), detail })

async function start() {
  const ctx = new Context()
  const fiber = ctx.plugin(villager, { root, agent: stubAgent(0), port: 0, people: { alex: 'Alex', sam: 'Sam' } })
  await fiber.await()
  const launch = JSON.parse(await readFile(ctx.villager.launchFile, 'utf8'))
  // Each person has their own token (#40); the house is shared, so either opens it.
  return { fiber, base: `http://127.0.0.1:${launch.port}`, token: launch.tokens.alex as string, samToken: launch.tokens.sam as string }
}

// Synthetic plan: a 4 x 4 m square room.
const base = {
  schema: 1,
  corners: [{ id: 'r.a', x: 0, z: 0 }, { id: 'r.b', x: 4, z: 0 }, { id: 'r.c', x: 4, z: 4 }, { id: 'r.d', x: 0, z: 4 }],
  walls: [
    { id: 'r.w1', a: 'r.a', b: 'r.b', thickness: 0.18, height: 3, sagitta: 0, openings: [{ id: 'r.door', kind: 'door', from: 1, to: 2, sill: 0, head: 2.1, leaves: 1 }] },
    { id: 'r.w2', a: 'r.b', b: 'r.c', thickness: 0.18, height: 3, sagitta: 0, openings: [] },
    { id: 'r.w3', a: 'r.c', b: 'r.d', thickness: 0.18, height: 3, sagitta: 0, openings: [] },
    { id: 'r.w4', a: 'r.d', b: 'r.a', thickness: 0.18, height: 3, sagitta: 0, openings: [] },
  ],
  rooms: [{ id: 'r', label: 'Room', loop: ['r.a', 'r.b', 'r.c', 'r.d'] }],
  furniture: [],
}
const hex = (c: string, n: number) => c.repeat(n)
const ROOT = hex('a', 16), V2 = hex('b', 16), V3 = hex('c', 16), V4 = hex('9', 16)

try {
  let host = await start()
  const api = (path: string, body?: unknown, token: string | null = host.token, raw?: string) =>
    fetch(`${host.base}${path}`, {
      method: body === undefined && raw === undefined ? 'GET' : 'POST',
      headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: raw ?? (body === undefined ? undefined : JSON.stringify(body)),
    })
  const post = async (path: string, body: unknown) => {
    const res = await api(`/house/plans${path}`, body)
    return { status: res.status, json: await res.json() }
  }
  const library = async (person: string, item: string, kept: boolean) => {
    await mkdir(join(root, 'people', person, 'library'), { recursive: true })
    await writeFile(join(root, 'people', person, 'library', `${item}.json`), JSON.stringify({ id: item, name: 'Lamp', module: '', models: [], costUsd: null, ms: 0, at: new Date().toISOString(), kept }))
  }
  const dir = join(root, 'house', 'plans')

  // Token; the store is the house's, at /house/plans, not under a person.
  check('reading plans needs the token', (await api('/house/plans', undefined, null)).status === 401)
  check('a wrong token is refused', (await api('/house/plans/versions', { version: {} }, 'f'.repeat(64))).status === 401)
  check('plans live at /house/plans, not under a person', (await api('/people/alex/plans')).status === 404)
  const empty = await (await api('/house/plans')).json()
  check('an empty house has no versions and no head', empty.versions.length === 0 && empty.head === null, empty)

  // Create the root.
  const created = await post('/versions', { version: { id: ROOT, parent: null, plan: base } })
  check('the root is created with at and by from the host', created.status === 200 && created.json.version.by === 'alex' && !Number.isNaN(Date.parse(created.json.version.at)) && JSON.stringify(created.json.version.plan) === JSON.stringify(base), created)
  const second = await post('/versions', { version: { id: hex('d', 16), parent: null, plan: base } })
  check('a second root is refused as stale, with the head', second.status === 409 && second.json.head === ROOT, second)

  // Append. Every version carries the plan it is (the host checks its shape, not whether it is a valid house).
  const move = { op: 'moveWall', wallId: 'r.w2', by: 0.5 }
  const wider = { ...base, corners: base.corners.map((c) => (c.x === 4 ? { ...c, x: 4.5 } : c)) }
  const v2 = await post('/versions', { version: { id: V2, parent: ROOT, note: 'wider', plan: wider } })
  check('a version appends on the head', v2.status === 200 && v2.json.version.parent === ROOT && JSON.stringify(v2.json.version.plan) === JSON.stringify(wider), v2)
  check('a body cannot set by', (await post('/versions', { version: { id: V3, parent: V2, plan: base, by: 'alex' } })).status === 400)

  // a retry of a saved version gets the same answer; another version with its id is a 409 without a head.
  const retry = await post('/versions', { version: { id: V2, parent: ROOT, note: 'wider', plan: wider } })
  check('a retried version (same id, parent and content) answers 200 with the stored one', retry.status === 200 && JSON.stringify(retry.json.version) === JSON.stringify(v2.json.version), retry)
  const clash = await post('/versions', { version: { id: V2, parent: ROOT, note: 'other', plan: wider } })
  check('a different version with a taken id is 409 without a head (not stale)', clash.status === 409 && !('head' in clash.json), clash)

  // Stale head: a page that still thinks the root is the head.
  const stale = await post('/versions', { version: { id: V3, parent: ROOT, plan: base } })
  check('a version on a stale head is refused with the current head', stale.status === 409 && stale.json.head === V2, stale)
  const staleHead = await post('/head', { head: ROOT, expect: ROOT })
  check('a head move on a stale head is refused', staleHead.status === 409 && staleHead.json.head === V2, staleHead)
  check('undo moves the head when it expects the right one', (await post('/head', { head: ROOT, expect: V2 })).status === 200)
  const branch = await post('/versions', { version: { id: V3, parent: ROOT, plan: base } })
  check('a commit after checkout branches from it', branch.status === 200 && branch.json.version.parent === ROOT)
  const plainOpening = { ...base, walls: base.walls.map((w, i) => (i === 2 ? { ...w, openings: [{ id: 'r.arch', kind: 'door', from: 1.2, to: 2, sill: 0, head: 2.3 }] } : w)) }
  const v4 = await post('/versions', { version: { id: V4, parent: V3, plan: plainOpening } })
  check('a plain opening (a door with no leaves) is stored as sent', v4.status === 200 && JSON.stringify(v4.json.version.plan) === JSON.stringify(plainOpening), v4)
  check('a name is stored', (await post('/names', { id: V2, name: 'Wider room' })).status === 200)
  check('a name for a missing version is refused', (await post('/names', { id: hex('e', 16), name: 'x' })).status === 404)

  // Bad input: nothing is stored.
  const before = (await readdir(join(dir, 'events'))).length
  const bad: [string, unknown][] = [
    ['edits (a version stores its plan only)', { version: { id: hex('f', 16), parent: V4, edits: [move], plan: base } }],
    ['a number out of range', { version: { id: hex('f', 16), parent: V4, plan: { ...base, corners: base.corners.map((c, i) => (i ? c : { ...c, x: 1e9 })) } } }],
    ['a non-number', { version: { id: hex('f', 16), parent: V4, plan: { ...base, corners: base.corners.map((c, i) => (i ? c : { ...c, x: '1' })) } } }],
    ['a path in an id', { version: { id: hex('f', 16), parent: V4, plan: { ...base, corners: base.corners.map((c, i) => (i ? c : { ...c, id: '../x' })) } } }],
    ['a bad version id', { version: { id: '../../etc', parent: V4, plan: base } }],
    ['a version with no plan', { version: { id: hex('f', 16), parent: V4 } }],
    ['a plan with an unknown field', { version: { id: hex('f', 16), parent: V4, plan: { ...base, rooms: [{ ...base.rooms[0], owner: 'alex' }] } } }],
    ['a hash (no longer part of a version)', { version: { id: hex('f', 16), parent: V4, plan: base, hash: hex('4', 64) } }],
    ['a base (no longer part of a version)', { version: { id: hex('f', 16), parent: V4, base, plan: base } }],
    ['a control character in a note', { version: { id: hex('f', 16), parent: V4, note: 'a\u0000b', plan: base } }],
    ['a door with three leaves', { version: { id: hex('f', 16), parent: V4, plan: { ...base, walls: base.walls.map((w, i) => (i ? w : { ...w, openings: [{ ...w.openings[0], leaves: 3 }] })) } } }],
    ['a duplicate id', { version: { id: V2, parent: V4, plan: base } }],
    ['a library item whose person is a path', { version: { id: hex('f', 16), parent: V4, plan: { ...base, furniture: [{ id: 'f.x', item: { library: 'a1b2c3d4e5f6', person: '../alex' }, at: { mount: 'floor', x: 1, z: 1, yaw: 0 } }] } } }],
  ]
  for (const [what, body] of bad) {
    const r = await post('/versions', body)
    check(`${what} is refused`, r.status === (what === 'a duplicate id' ? 409 : 400) && !('head' in r.json), r)
  }
  check('a name with a newline is refused', (await post('/names', { id: V2, name: 'a\nb' })).status === 400)
  check('a body over 256 KB is refused', (await api('/house/plans/versions', undefined, host.token, JSON.stringify({ pad: 'x'.repeat(300_000) }))).status === 413)
  check('a body over 256 KB of three-byte text is refused (bytes, not characters)', (await api('/house/plans/versions', undefined, host.token, JSON.stringify({ pad: '€'.repeat(100_000) }))).status === 413)
  check('a root carrying edits is refused', (await post('/versions', { version: { id: hex('3', 16), parent: null, edits: [move], plan: base } })).status === 400)
  check('malformed JSON is refused', (await api('/house/plans/versions', undefined, host.token, '{')).status === 400)
  check('GET on versions is not allowed', (await api('/house/plans/versions')).status === 405)
  check('refused requests store nothing', (await readdir(join(dir, 'events'))).length === before)

  // An event is written whole in tmp/ first: with tmp/ unwritable the write fails and nothing reaches events/.
  await chmod(join(dir, 'tmp'), 0o500)
  const blocked = await post('/versions', { version: { id: hex('8', 16), parent: (await (await api('/house/plans')).json()).head, plan: base } })
  await chmod(join(dir, 'tmp'), 0o700)
  check('a write that fails before its link leaves no event', blocked.status === 500 && (await readdir(join(dir, 'events'))).length === before, blocked)
  // Another writer's event at the next number wins.
  const next = String(before + 1).padStart(8, '0')
  await writeFile(join(dir, 'tmp', 'other.json'), JSON.stringify({ seq: before + 1, kind: 'name', id: V3, name: 'From another host', at: new Date().toISOString(), by: 'alex' }), { mode: 0o600 })
  const head = (await (await api('/house/plans')).json()).head
  await link(join(dir, 'tmp', 'other.json'), join(dir, 'events', `${next}.json`))
  await rm(join(dir, 'tmp', 'other.json'))
  const after = await (await api('/house/plans')).json()
  check('an event another writer linked is folded in', after.versions.length === 4 && after.head === head && after.names[V3] === 'From another host', after)

  // Placed things in the plan: stored as sent, every field checked.
  const V5 = hex('5', 16), V6 = hex('6', 16), V7 = hex('7', 16)
  const lamp = { id: 'f.lamp', item: { library: 'a1b2c3d4e5f6', person: 'alex' }, at: { mount: 'floor', x: 1, z: 2, yaw: 0.5 } }
  const picture = { id: 'f.picture', item: { kind: 'picture' }, at: { mount: 'wall', wallId: 'r.w3', roomId: 'r', along: 2, height: 1.5, spin: 0 } }
  const placing = { id: V5, parent: V4, note: 'Placed the lamp', plan: { ...base, furniture: [lamp, picture] } }
  // The host refuses a placed library item that is missing or not kept.
  const eventsNow = (await readdir(join(dir, 'events'))).length
  const missingItem = await post('/versions', { version: placing })
  await library('alex', 'a1b2c3d4e5f6', false)
  const draftItem = await post('/versions', { version: placing })
  check('placing a library item that is missing or not kept is refused 409, and nothing is stored', missingItem.status === 409 && draftItem.status === 409 && /not one alex has kept/.test(draftItem.json.error) && !('head' in draftItem.json) && (await readdir(join(dir, 'events'))).length === eventsNow, { missingItem, draftItem })
  await library('alex', 'a1b2c3d4e5f6', true)
  const placed = await post('/versions', { version: placing })
  check('once kept, a library item on the floor and a kind on a wall are stored as sent', placed.status === 200 && JSON.stringify(placed.json.version.plan.furniture) === JSON.stringify([lamp, picture]), placed)
  const onTable = { ...lamp, at: { mount: 'surface', x: 1, y: 0.76, z: 2, yaw: 0, on: 'f.table' } }
  const moved = await post('/versions', { version: { id: V6, parent: V5, plan: { ...base, furniture: [onTable, picture] } } })
  check('a thing on placed furniture (surface `on`) is stored as sent', moved.status === 200 && moved.json.version.plan.furniture[0].at.on === 'f.table', moved)
  const removed = await post('/versions', { version: { id: V7, parent: V6, plan: { ...base, furniture: [onTable] } } })
  check('a version without a thing is stored', removed.status === 200, removed)
  const itemsBefore = (await readdir(join(dir, 'events'))).length
  const badItems: [string, unknown][] = [
    ['an unknown mount', { ...lamp, at: { ...lamp.at, mount: 'roof' } }],
    ['an extra anchor field', { ...lamp, at: { ...lamp.at, y: 3 } }],
    ['a wall anchor without a room', { ...picture, at: { mount: 'wall', wallId: 'r.w3', along: 2, height: 1.5, spin: 0 } }],
    ['a library item that is not 12 hex', { ...lamp, item: { library: '../secrets', person: 'alex' } }],
    ['a library item with no person', { ...lamp, item: { library: 'a1b2c3d4e5f6' } }],
    ['an item with both a kind and a library', { ...lamp, item: { library: 'a1b2c3d4e5f6', person: 'alex', kind: 'box' } }],
    ['a kind that is not a word', { ...picture, item: { kind: 'Big Box!' } }],
    ['a furniture id with a path', { ...lamp, id: '../x' }],
    ['a height out of range', { ...lamp, at: { mount: 'surface', x: 1, y: 900, z: 2, yaw: 0 } }],
    ['a non-number yaw', { ...lamp, at: { mount: 'floor', x: 1, z: 2, yaw: 'left' } }],
    ['a thing with no anchor', { id: 'f.lamp', item: lamp.item }],
    ['a thing with an extra field', { ...lamp, all: true }],
  ]
  for (const [what, f] of badItems) {
    const r = await post('/versions', { version: { id: hex('f', 16), parent: V7, plan: { ...base, furniture: [f] } } })
    check(`${what} is refused`, r.status === 400, r)
  }
  check('refused things store nothing', (await readdir(join(dir, 'events'))).length === itemsBefore)

  // The house is the household's, but a person's library is their own (#40): another person's token reads and
  // changes the house, keeps what others placed, and may not newly place someone else's library item.
  check("another person's own token reads the shared house", (await api('/house/plans', undefined, host.samToken)).status === 200)
  await library('alex', 'b1b2c3d4e5f6', true)
  const asSam = async (path: string, body: unknown) => {
    const res = await api(`/house/plans${path}`, body, host.samToken)
    return { status: res.status, json: await res.json() }
  }
  const V8 = hex('8', 16)
  const eventsBeforeSam = (await readdir(join(dir, 'events'))).length
  const samPlacesAlex = await asSam('/versions', { version: { id: V8, parent: V7, plan: { ...base, furniture: [onTable, { ...lamp, id: 'f.other', item: { library: 'b1b2c3d4e5f6', person: 'alex' } }] } } })
  check("placing someone else's library item is refused 403, and nothing is stored", samPlacesAlex.status === 403 && /alex's, not yours/.test(samPlacesAlex.json.error) && (await readdir(join(dir, 'events'))).length === eventsBeforeSam, samPlacesAlex)
  const samKeeps = await asSam('/versions', { version: { id: V8, parent: V7, note: 'Sam added a picture', plan: { ...base, furniture: [onTable, picture] } } })
  check("a version by another person keeps what was already placed, whoever's it is", samKeeps.status === 200 && samKeeps.json.version.plan.furniture[0].item.person === 'alex', samKeeps)
  const back = await post('/head', { head: V7, expect: V8 })
  check('and the head moves back for the checks below', back.status === 200, back)

  // Every event records whose token wrote it (S1).
  const samHead = await asSam('/head', { head: V8, expect: V7 })
  const samName = await asSam('/names', { id: V8, name: 'Sam\'s picture' })
  await post('/head', { head: V7, expect: V8 })
  const authored = await Promise.all((await readdir(join(dir, 'events'))).sort().map(async (f) => JSON.parse(await readFile(join(dir, 'events', f), 'utf8'))))
  const byOf = (e: { by?: string; version?: { by: string } }) => e.version?.by ?? e.by
  const kindBy = (kind: string, by: string) => authored.some((e) => e.kind === kind && byOf(e) === by)
  check('every plan event records its author: versions, head moves and names, by the token that wrote them', samHead.status === 200 && samName.status === 200 && samKeeps.json.version.by === 'sam' && authored.every((e) => typeof byOf(e) === 'string') && kindBy('version', 'alex') && kindBy('version', 'sam') && kindBy('head', 'alex') && kindBy('head', 'sam') && kindBy('name', 'alex') && kindBy('name', 'sam'), authored.map((e) => ({ seq: e.seq, kind: e.kind, by: byOf(e) })))
  check('a retry of a stored version by someone else still answers with the stored one', (await asSam('/versions', { version: { id: V8, parent: V7, note: 'Sam added a picture', plan: { ...base, furniture: [onTable, picture] } } })).status === 200)

  // Two hosts on one root racing one parent: the link() claim lets one in and refuses the other.
  const twin = await start()
  const asTwin = (path: string, body: unknown) => fetch(`${twin.base}/house/plans${path}`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${twin.token}` }, body: JSON.stringify(body) }).then(async (r) => ({ status: r.status, json: await r.json() }))
  const headNow = (await (await api('/house/plans')).json()).head
  const [ra, rb] = await Promise.all([
    post('/versions', { version: { id: hex('1', 16), parent: headNow, plan: base } }),
    asTwin('/versions', { version: { id: hex('2', 16), parent: headNow, plan: base } }),
  ])
  const raced = await (await api('/house/plans')).json()
  check('two hosts racing one parent: one saved, one stale, none lost', [ra.status, rb.status].sort().join() === '200,409' && raced.versions.filter((v: { id: string }) => v.id === hex('1', 16) || v.id === hex('2', 16)).length === 1, { ra: ra.status, rb: rb.status })
  await twin.fiber.dispose()
  const raceWinner = raced.head as string

  // A multi-byte character split across two chunks of a body is stored whole.
  const kueche = { ...base, rooms: [{ ...base.rooms[0], label: 'Küche' }] }
  const bytes = Buffer.from(JSON.stringify({ version: { id: hex('4', 16), parent: raceWinner, plan: kueche } }))
  const cut = bytes.indexOf(Buffer.from('ü')) + 1
  const split = await new Promise<{ status: number; body: string }>((done, fail) => {
    const url = new URL(`${host.base}/house/plans/versions`)
    const req = request({ hostname: url.hostname, port: url.port, path: url.pathname, method: 'POST', headers: { 'content-type': 'application/json', 'content-length': bytes.length, authorization: `Bearer ${host.token}` } }, (res) => {
      let body = ''
      res.setEncoding('utf8').on('data', (c) => (body += c)).on('end', () => done({ status: res.statusCode ?? 0, body }))
    })
    req.on('error', fail)
    req.write(bytes.subarray(0, cut))
    setTimeout(() => req.end(bytes.subarray(cut)), 100)
  })
  check('a character split across body chunks is stored whole', split.status === 200 && JSON.parse(split.body).version.plan.rooms[0].label === 'Küche', split)

  // Modes.
  const mode = async (p: string) => (await stat(p)).mode & 0o777
  const files = (await readdir(join(dir, 'events'))).map((f) => join(dir, 'events', f))
  const modes = { house: await mode(join(root, 'house')), plans: await mode(dir), events: await mode(join(dir, 'events')), files: [...new Set(await Promise.all(files.map(mode)))] }
  check('dirs are 0700 and event files 0600', modes.house === 0o700 && modes.plans === 0o700 && modes.events === 0o700 && modes.files.length === 1 && modes.files[0] === 0o600, Object.fromEntries(Object.entries(modes).map(([k, v]) => [k, Array.isArray(v) ? v.map((m) => m.toString(8)) : v.toString(8)])))

  // The log is bounded (S2): at the cap a change is refused 507 and nothing is written; reading still works.
  {
    const files = await readdir(join(dir, 'events'))
    const headNow = (await (await api('/house/plans')).json()).head as string
    // Fill the log to one short of the cap with head moves that change nothing (the head stays where it is).
    await Promise.all(Array.from({ length: 4999 - files.length }, (_, i) => writeFile(join(dir, 'events', `${String(files.length + 1 + i).padStart(8, '0')}.json`), JSON.stringify({ seq: files.length + 1 + i, kind: 'head', head: headNow, at: new Date().toISOString(), by: 'alex' }), { mode: 0o600 })))
    const last = await post('/head', { head: headNow, expect: headNow })
    const over = await post('/head', { head: headNow, expect: headNow })
    const overVersion = await post('/versions', { version: { id: '0123456789abcdef', parent: headNow, plan: base } })
    check('the 5000th change is stored and the next is refused 507, with nothing written', last.status === 200 && over.status === 507 && /at most 5000 changes/.test(over.json.error) && overVersion.status === 507 && (await readdir(join(dir, 'events'))).length === 5000, { last: last.status, over, overVersion: overVersion.status })
    check('a full log can still be read', (await api('/house/plans')).status === 200)
  }

  // Reload: a new host process folds the same log to the same state.
  const snapshot = JSON.stringify(await (await api('/house/plans')).json())
  await host.fiber.dispose()
  host = await start()
  const reloaded = await (await api('/house/plans')).json()
  check('a restarted host reads back the same versions, head and names', JSON.stringify(reloaded) === snapshot && reloaded.head === hex('4', 16))
  // The host has folded every event now; one that goes missing afterwards is a damaged store too.
  const foldedEvent = join(dir, 'events', '00000002.json')
  const foldedBytes = await readFile(foldedEvent)
  await rm(foldedEvent)
  check('an event already folded that goes missing is an error', (await api('/house/plans')).status === 500)
  await writeFile(foldedEvent, foldedBytes)

  // An event filed under the wrong number is an error (a fresh host, so nothing is folded yet).
  await host.fiber.dispose()
  const event2 = join(dir, 'events', '00000002.json')
  const kept = await readFile(event2)
  await writeFile(event2, await readFile(join(dir, 'events', '00000003.json')))
  host = await start()
  check('an event filed under the wrong number is an error', (await api('/house/plans')).status === 500)
  await writeFile(event2, kept)

  // A damaged log fails loudly instead of folding around a gap.
  await rm(join(dir, 'events', '00000002.json'))
  check('a gap in the log is an error, not a shorter history', (await api('/house/plans')).status === 500)
  await host.fiber.dispose()
} finally {
  await rm(root, { recursive: true, force: true })
}

for (const c of checks) console.log(`${c.pass ? 'ok  ' : 'FAIL'} ${c.name}${c.pass || c.detail === undefined ? '' : ` ${JSON.stringify(c.detail)}`}`)
const failed = checks.filter((c) => !c.pass).length
console.log(`${checks.length - failed}/${checks.length} checks pass`)
process.exit(failed ? 1 : 0)
