// Headless checks of the house plan store (#48) through the villager API: no model is called.
// npm run check-plans
import { link, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
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
  return { fiber, base: `http://127.0.0.1:${launch.port}`, token: launch.token as string }
}

// Synthetic plan: a 4 x 4 m square room.
const base = {
  version: 1,
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
  const post = async (path: string, body: unknown, person = 'alex') => {
    const res = await api(`/people/${person}/plans${path}`, body)
    return { status: res.status, json: await res.json() }
  }
  const dir = join(root, 'house', 'plans')

  // Token and person.
  check('reading plans needs the token', (await api('/people/alex/plans', undefined, null)).status === 401)
  check('a wrong token is refused', (await api('/people/alex/plans/versions', { version: {} }, 'f'.repeat(64))).status === 401)
  check('an unlisted person is refused', (await api('/people/mia/plans')).status === 404)
  const empty = await (await api('/people/alex/plans')).json()
  check('an empty house has no versions and no head', empty.versions.length === 0 && empty.head === null, empty)

  // Create the root.
  const created = await post('/versions', { version: { id: ROOT, parent: null, edits: [], base, hash: hex('1', 64) } })
  check('the root is created with by and at from the host', created.status === 200 && created.json.version.by === 'alex' && !Number.isNaN(Date.parse(created.json.version.at)), created)
  check('a second root is refused as stale', (await post('/versions', { version: { id: hex('d', 16), parent: null, edits: [], base, hash: hex('1', 64) } })).status === 409)

  // Append, by another person; `by` is taken from the path, never the body.
  const move = { op: 'moveWall', wallId: 'r.w2', by: 0.5 }
  const v2 = await post('/versions', { version: { id: V2, parent: ROOT, edits: [move], note: 'wider', hash: hex('2', 64) } }, 'sam')
  check('a version appends on the head', v2.status === 200 && v2.json.version.by === 'sam' && v2.json.version.parent === ROOT, v2)
  check('a body cannot set by', (await post('/versions', { version: { id: V3, parent: V2, edits: [move], hash: hex('3', 64), by: 'alex' } })).status === 400)

  // Stale head: a page that still thinks the root is the head.
  const stale = await post('/versions', { version: { id: V3, parent: ROOT, edits: [move], hash: hex('3', 64) } })
  check('a version on a stale head is refused with the current head', stale.status === 409 && stale.json.head === V2, stale)
  const staleHead = await post('/head', { head: ROOT, expect: ROOT })
  check('a head move on a stale head is refused', staleHead.status === 409 && staleHead.json.head === V2, staleHead)
  check('undo moves the head when it expects the right one', (await post('/head', { head: ROOT, expect: V2 })).status === 200)
  const branch = await post('/versions', { version: { id: V3, parent: ROOT, edits: [{ op: 'bendWall', wallId: 'r.w2', sagitta: 0.5 }], hash: hex('3', 64) } })
  check('a commit after checkout branches from it', branch.status === 200 && branch.json.version.parent === ROOT)
  const plain = { op: 'addRoom', room: { id: 'p', label: 'Pantry' }, wallId: 'r.w3', from: 1, to: 3, depth: 2, door: { id: 'p.d', from: 1.2, to: 2 } }
  const v4 = await post('/versions', { version: { id: V4, parent: V3, edits: [plain], hash: hex('5', 64) } })
  check('addRoom with a plain opening (no leaves) is stored as sent', v4.status === 200 && JSON.stringify(v4.json.version.edits[0]) === JSON.stringify(plain), v4)
  check('a name is stored', (await post('/names', { id: V2, name: 'Wider room' })).status === 200)
  check('a name for a missing version is refused', (await post('/names', { id: hex('e', 16), name: 'x' })).status === 404)

  // Bad input: nothing is stored.
  const before = (await readdir(join(dir, 'events'))).length
  const bad: [string, unknown][] = [
    ['an unknown op', { version: { id: hex('f', 16), parent: V4, edits: [{ op: 'deleteHouse' }], hash: hex('4', 64) } }],
    ['an unknown edit field', { version: { id: hex('f', 16), parent: V4, edits: [{ ...move, run: 'rm -rf' }], hash: hex('4', 64) } }],
    ['a number out of range', { version: { id: hex('f', 16), parent: V4, edits: [{ ...move, by: 1e9 }], hash: hex('4', 64) } }],
    ['a non-number', { version: { id: hex('f', 16), parent: V4, edits: [{ ...move, by: '1' }], hash: hex('4', 64) } }],
    ['a path in an id', { version: { id: hex('f', 16), parent: V4, edits: [{ ...move, wallId: '../x' }], hash: hex('4', 64) } }],
    ['a bad version id', { version: { id: '../../etc', parent: V4, edits: [move], hash: hex('4', 64) } }],
    ['a bad hash', { version: { id: hex('f', 16), parent: V4, edits: [move], hash: 'nope' } }],
    ['no edits', { version: { id: hex('f', 16), parent: V4, edits: [], hash: hex('4', 64) } }],
    ['too many edits', { version: { id: hex('f', 16), parent: V4, edits: Array(51).fill(move), hash: hex('4', 64) } }],
    ['a base on a non-root', { version: { id: hex('f', 16), parent: V4, edits: [move], base, hash: hex('4', 64) } }],
    ['a control character in a note', { version: { id: hex('f', 16), parent: V4, edits: [move], note: 'a\u0000b', hash: hex('4', 64) } }],
    ['a door with three leaves', { version: { id: hex('f', 16), parent: V4, edits: [{ op: 'addRoom', room: { id: 'p', label: 'P' }, wallId: 'r.w3', from: 1, to: 3, depth: 2, door: { id: 'p.d', from: 1.2, to: 2, leaves: 3 } }], hash: hex('4', 64) } }],
    ['a duplicate id', { version: { id: V2, parent: V4, edits: [move], hash: hex('4', 64) } }],
  ]
  for (const [what, body] of bad) {
    const r = await post('/versions', body)
    check(`${what} is refused`, r.status === (what === 'a duplicate id' ? 409 : 400), r)
  }
  check('a name with a newline is refused', (await post('/names', { id: V2, name: 'a\nb' })).status === 400)
  check('a body over 256 KB is refused', (await api('/people/alex/plans/versions', undefined, host.token, JSON.stringify({ pad: 'x'.repeat(300_000) }))).status === 413)
  check('malformed JSON is refused', (await api('/people/alex/plans/versions', undefined, host.token, '{')).status === 400)
  check('GET on versions is not allowed', (await api('/people/alex/plans/versions')).status === 405)
  check('refused requests store nothing', (await readdir(join(dir, 'events'))).length === before)

  // An interrupted write leaves only a scratch file; another writer's event at the next number wins.
  await writeFile(join(dir, 'tmp', 'torn.json'), '{"seq": 99, "kind": "vers', { mode: 0o600 })
  const next = String(before + 1).padStart(8, '0')
  await writeFile(join(dir, 'tmp', 'other.json'), JSON.stringify({ seq: before + 1, kind: 'name', id: V3, name: 'From another host', by: 'sam', at: new Date().toISOString() }), { mode: 0o600 })
  const head = (await (await api('/people/alex/plans')).json()).head
  await link(join(dir, 'tmp', 'other.json'), join(dir, 'events', `${next}.json`))
  await rm(join(dir, 'tmp', 'other.json'))
  const after = await (await api('/people/alex/plans')).json()
  check('a torn scratch file is never an event', after.versions.length === 4 && after.head === head && after.names[V3] === 'From another host', after)

  // Modes.
  const mode = async (p: string) => (await stat(p)).mode & 0o777
  const files = (await readdir(join(dir, 'events'))).map((f) => join(dir, 'events', f))
  const modes = { house: await mode(join(root, 'house')), plans: await mode(dir), events: await mode(join(dir, 'events')), files: [...new Set(await Promise.all(files.map(mode)))] }
  check('dirs are 0700 and event files 0600', modes.plans === 0o700 && modes.events === 0o700 && modes.files.length === 1 && modes.files[0] === 0o600, Object.fromEntries(Object.entries(modes).map(([k, v]) => [k, Array.isArray(v) ? v.map((m) => m.toString(8)) : v.toString(8)])))

  // Reload: a new host process folds the same log to the same state.
  const snapshot = JSON.stringify(after)
  await host.fiber.dispose()
  host = await start()
  const reloaded = await (await api('/people/alex/plans')).json()
  check('a restarted host reads back the same versions, head and names', JSON.stringify(reloaded) === snapshot && reloaded.head === V4)

  // A damaged log fails loudly instead of folding around a gap.
  await rm(join(dir, 'events', '00000002.json'))
  check('a gap in the log is an error, not a shorter history', (await api('/people/alex/plans')).status === 500)
  await host.fiber.dispose()
} finally {
  await rm(root, { recursive: true, force: true })
}

for (const c of checks) console.log(`${c.pass ? 'ok  ' : 'FAIL'} ${c.name}${c.pass || c.detail === undefined ? '' : ` ${JSON.stringify(c.detail)}`}`)
const failed = checks.filter((c) => !c.pass).length
console.log(`${checks.length - failed}/${checks.length} checks pass`)
process.exit(failed ? 1 : 0)
