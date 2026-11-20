// The Bay Area from data (#373): `?bay=1` makes the world the real place in place of the town, from the packs the
// page server holds (`/bay/<square>.bay`, baked by engine/bay/bake.py; the core's bay.rs reads them). Every core
// that makes or asks about the world (this page's, each maker of sectors, the mover) must hold the same packs
// before it is asked anything, so each opens its core through `open`.
import { LOCAL } from './local.ts'

/** The squares baked first, whole: what `?bay=551.7_4183.5,550.7_4183.5` names, as the first slice was measured. */
const query = new URLSearchParams(globalThis.location?.search ?? '')
// A shared world or a realm is kept by the world's process (world.mjs), which holds no packs yet: there the page
// stays with the town, or it would draw one world and walk in another. A realm this page runs alone (local.ts)
// says which world it is in itself, where the address does not.
const asked = query.has('shared') || query.has('realm') ? null : query.get('bay') ?? LOCAL?.world?.bay ?? null
/**
 * Where the packs are: beside the page's own folder (`/bay/` under the page server, `<site>/bay/` in a static
 * folder, #450), the same for the page and its workers, whose modules are all in page/.
 */
const BASE = new URL('../bay/', import.meta.url).href
/**
 * `?bay=1`: the world comes in tiles as the eye moves (bay/tiles.py), so that it has no edge the page must hold:
 * each core holds the few tiles round what it is asked about and lets the rest go.
 */
export const STREAM = asked === '1' || asked === 'earth'
/** The squares this page's world is made from where they are held whole (`?bay=a,b`). */
export const SQUARES: readonly string[] = !asked || asked === '0' || STREAM ? [] : asked.split(',').filter((name) => /^[0-9._]+$/.test(name))
/** Whether this page's world is the Bay's at all. */
export const ON = STREAM || SQUARES.length > 0
/** What a worker's address ends in, so that it opens its core as this page does. */
export const BAY = STREAM ? `?bay=${asked}${query.get('ll') ? `&ll=${query.get('ll')}` : ''}` : SQUARES.length ? `?bay=${SQUARES.join(',')}` : ''

/**
 * Where on Earth a latitude and longitude are, as the world's cells have it (bay/earth.py `frame_of`, which this
 * must agree with): the frame is a UTM zone and the northing (a multiple of 250 km) that z is counted south from,
 * so that cells stay small numbers near any place; x is east of the zone's middle. Cells are 10 cm.
 */
export function place(lat: number, lon: number): { frame: string; x: number; z: number } {
  const zone = Math.floor((lon + 180) / 6) + 1, a = 6378137, f = 1 / 298.257223563, n = f / (2 - f), rad = Math.PI / 180
  const A = (a / (1 + n)) * (1 + n ** 2 / 4 + n ** 4 / 64), alpha = [n / 2 - (2 * n ** 2) / 3 + (5 * n ** 3) / 16, (13 * n ** 2) / 48 - (3 * n ** 3) / 5, (61 * n ** 3) / 240]
  const phi = lat * rad, lam = (lon - (zone * 6 - 183)) * rad, e = (2 * Math.sqrt(n)) / (1 + n)
  const t = Math.sinh(Math.atanh(Math.sin(phi)) - e * Math.atanh(e * Math.sin(phi))), xi = Math.atan(t / Math.cos(lam)), eta = Math.atanh(Math.sin(lam) / Math.sqrt(1 + t * t))
  let east = eta, north = xi
  alpha.forEach((c, j) => { east += c * Math.cos(2 * (j + 1) * xi) * Math.sinh(2 * (j + 1) * eta); north += c * Math.sin(2 * (j + 1) * xi) * Math.cosh(2 * (j + 1) * eta) })
  const E = 0.9996 * A * east, N = 0.9996 * A * north + (lat < 0 ? 10_000_000 : 0), top = Math.ceil(N / 250_000) * 250
  return { frame: `${zone}${lat < 0 ? 's' : 'n'}${top}`, x: Math.round(E * 10), z: Math.round((top * 1000 - N) * 10) }
}
/** `&ll=latitude,longitude`: where on Earth the page starts; the Bay where it does not say. */
const asked_ll = query.get('ll')?.split(',').map(Number)
const there = STREAM && asked_ll?.length === 2 && asked_ll.every(Number.isFinite) ? place(asked_ll[0], asked_ll[1]) : null
/** The frame this page's cells are counted in, and where it starts in it (the Bay's own start where null). */
export const FRAME = there?.frame ?? '10n4250'
export const START: [number, number] | null = there ? [there.x, there.z] : null
/** `?bay=earth`: nothing baked from lidar is used, only what is made from the planet's data. */
const BAKED = asked === '1' && FRAME === '10n4250'

interface Core { memory: WebAssembly.Memory; bay_room(bytes: number): number; bay_load(): number; bay_begin(): void; bay_drop(x0: number, z0: number, gstep: number): number }

/** A level of the tiles: `size` cells a side, with a ground sample every `gstep`. */
export interface Level { size: number; gstep: number }
// Nothing baked on this machine: every tile is the planet's.
const LEVELS: Level[] = [{ size: 2500, gstep: 10 }, { size: 10000, gstep: 20 }, { size: 40000, gstep: 160 }]

// ── Where the tiles come from (#450) ───────────────────────────────────────
// One owner for it: the page. Workers never fetch a tile; they ask the page (`ask` below), which fetches each tile
// once and hands its bytes to every core that wants it. Before this each core fetched its own: 3.2 requests for
// every tile before the park was whole.
//
// Two places tiles come from:
//   - a release (sf/release.md): a realm run alone names its pointer (`release` in its record). The page reads the
//     pointer once, checks the manifest against the pointer's hash, and from then on asks only for what that one
//     manifest lists, until it is loaded again. A key in its `sea` list, or one it does not list, is open water and
//     takes no request. A listed tile that does not come is a load error, never water.
//   - the page server (`?bay=1` under serve.mjs): the baked tiles its index lists, else the planet's tile, made on
//     asking (bay/earth.py). A 404 there is a place nobody made, and sea.
/** A tile's record in a release manifest. */
interface Record { path: string; bytes: number; sha256: string }
interface Manifest { version: number; frame: string; levels: (Level & { level: number; tiles: { [key: string]: Record }; sea: string[] })[]; names: { [square: string]: Record }; credits: string[] }
/** What the page knows of where tiles are: their levels, how to find one, the squares' names and whose data it is. */
export interface Source {
  levels: Level[]
  /** A tile's address and what it must be, or null where it is water and nothing is asked. */
  find(level: number, key: string): { url: string; bytes?: number; sha256?: string; listed: boolean } | null
  names: { url: string; bytes?: number; sha256?: string }[]
  credits: string[] | null
  /** The release this page is pinned to, or null under the page server. */
  release: string | null
  /** Whether the manifest's hash was checked (crypto.subtle is only in secure contexts: https and localhost). */
  checked: boolean
}
const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((v) => v.toString(16).padStart(2, '0')).join('')
const digest = async (b: ArrayBuffer): Promise<string | null> => (globalThis.crypto?.subtle ? hex(await crypto.subtle.digest('SHA-256', b)) : null)

async function released(pointer: URL): Promise<Source> {
  // Asked once a page load, past any cache: the pointer is the one file that changes between releases.
  const p = await fetch(pointer, { cache: 'no-cache' })
  if (!p.ok) throw new Error(`${pointer.pathname}: ${p.status}`)
  const at = (await p.json()) as { version: number; release: string; manifest: string }
  if (at.version !== 1 || !/^[0-9a-f]{64}$/.test(at.release)) throw new Error(`${pointer.pathname} is not a release pointer this page reads`)
  const where = new URL(at.manifest, pointer), m = await fetch(where)
  if (!m.ok) throw new Error(`${where.pathname}: ${m.status}`)
  const bytes = await m.arrayBuffer(), sum = await digest(bytes)
  if (sum !== null && sum !== at.release) throw new Error(`the manifest is not release ${at.release.slice(0, 12)}`)
  const manifest = JSON.parse(new TextDecoder().decode(bytes)) as Manifest
  if (manifest.version !== 1) throw new Error(`manifest version ${manifest.version}: this page reads 1`)
  if (manifest.frame !== FRAME) throw new Error(`the release is in frame ${manifest.frame}, the page in ${FRAME}`)
  const levels = [...manifest.levels].sort((a, b) => a.level - b.level), sea = levels.map((l) => new Set(l.sea))
  return {
    levels: levels.map(({ size, gstep }) => ({ size, gstep })),
    // Water, in the sea list or past what the release holds: nothing is asked.
    find: (level, key) => { const r = levels[level]?.tiles[key]; if (r) return { url: new URL(r.path, where).href, bytes: r.bytes, sha256: r.sha256, listed: true }; if (sea[level]?.has(key)) seaKeys++; else unlisted++; return null },
    names: Object.values(manifest.names).map((r) => ({ url: new URL(r.path, where).href, bytes: r.bytes, sha256: r.sha256 })),
    credits: manifest.credits,
    release: at.release,
    checked: sum !== null,
  }
}
async function served(): Promise<Source> {
  const r = await fetch(`${BASE}tiles/index.json`)
  const i = (r.ok ? await r.json() : { levels: LEVELS, tiles: [[], [], []], squares: [] }) as { levels: Level[]; tiles: [number, number][][]; squares: string[] }
  const has = i.tiles.map((l) => new Set(BAKED ? l.map(([x, z]) => `${x}_${z}`) : []))
  return {
    levels: i.levels,
    find: (level, key) => ({ url: has[level].has(key) ? `${BASE}tiles/${level}/${key}.bay` : `${BASE}earth/${FRAME}/${level}/${key}.bay`, listed: false }),
    names: (BAKED ? i.squares : []).map((name) => ({ url: `${BASE}${name}.json` })),
    credits: null,
    release: null,
    checked: false,
  }
}
let source: Promise<Source> | null = null
/** Water keys asked for: in the release's sea list, and past what it lists. */
let seaKeys = 0, unlisted = 0
export const water = () => ({ sea: seaKeys, unlisted })
/** Where the tiles come from, read once: in the page only (a worker is told what it needs by the page). */
export const where = (): Promise<Source> => (source ??= LOCAL?.release ? released(new URL(LOCAL.release, location.href)) : served())

/** How much a device may hold (#450): a phone's tab is killed long before a laptop's. */
export const DEVICE: 'phone' | 'desktop' = typeof navigator !== 'undefined' && navigator.maxTouchPoints > 0 && Math.min(globalThis.screen?.width ?? 1e4, globalThis.screen?.height ?? 1e4) < 900 ? 'phone' : 'desktop'
/** What one device class may hold: tiles kept by each core, at each level, and tile bytes the page keeps for its workers. */
export const HOLD = DEVICE === 'phone' ? { keep: [12, 4, 4], bytes: 24 << 20 } : { keep: [24, 8, 8], bytes: 96 << 20 }

/** The tiles the page holds for its cores: each fetched once, the last wanted kept up to `HOLD.bytes`. */
const bytesHeld = new Map<string, { body: Promise<ArrayBuffer | null>; size: number; used: number }>()
let heldTotal = 0, heldClock = 0
/** What the page has done for its tiles, for the checks: requests, failures, retries, and how many asks were answered from what it held. */
export const tally = { fetched: 0, failed: 0, retried: 0, shared: 0, water: 0, held: 0, bytes: 0 }
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** A tile's bytes, fetched once however many cores want it. Null for water. Throws where a tile that should come does not. */
export async function tile(level: number, key: string): Promise<ArrayBuffer | null> {
  const name = `${level}/${key}`, had = bytesHeld.get(name)
  if (had) { had.used = ++heldClock; tally.shared++; return had.body }
  const found = (await where()).find(level, key)
  if (!found) { tally.water++; return null }
  const entry = { body: fetchTile(found), size: 0, used: ++heldClock }
  bytesHeld.set(name, entry)
  try {
    const body = await entry.body
    entry.size = body?.byteLength ?? 0; heldTotal += entry.size; tally.held = heldTotal
    // Let go of the longest unwanted, never the one just come.
    if (heldTotal > HOLD.bytes) for (const [k, e] of [...bytesHeld].sort((a, b) => a[1].used - b[1].used)) {
      if (heldTotal <= HOLD.bytes) break
      if (e === entry || !e.size) continue
      bytesHeld.delete(k); heldTotal -= e.size
    }
    tally.held = heldTotal
    return body
  } catch (e) {
    // Not kept: the next core to want it asks again.
    bytesHeld.delete(name)
    throw e
  }
}
async function fetchTile(found: NonNullable<ReturnType<Source['find']>>): Promise<ArrayBuffer | null> {
  for (let again = 0; ; again++) {
    tally.fetched++
    const answer = await fetch(found.url).catch(() => null)
    // Under the page server a 404 or 204 is a place nobody made: sea. In a release a listed tile is never water.
    if (answer && !found.listed && (answer.status === 404 || answer.status === 204)) return null
    if (answer?.ok) {
      const body = await answer.arrayBuffer()
      if (!found.listed && !body.byteLength) return null
      // What the manifest says it is: a host that sends Brotli without saying so, or a file cut short, is caught here.
      if (found.bytes === undefined || (body.byteLength === found.bytes && (!found.sha256 || ((await digest(body)) ?? found.sha256) === found.sha256))) { tally.bytes += body.byteLength; return body }
    }
    if (again >= 3) { tally.failed++; throw new Error(`${new URL(found.url).pathname}: ${answer ? answer.status : 'no answer'}`) }
    tally.retried++
    await pause(1000 * 2 ** again)
  }
}

// ── A worker's side: it asks the page for tiles over a port the page gives it (`share`) ──
type Said = { id: number; body?: ArrayBuffer | null; error?: string }
let port: MessagePort | null = null, portCame: (p: MessagePort) => void = () => {}
const portReady = new Promise<MessagePort>((r) => (portCame = r))
let toldLevels: Level[] = LEVELS, toldKeep = HOLD.keep
const waiting = new Map<number, (s: Said) => void>()
let asks = 0
/** The cores this context opened: what they hold is reported to the page (`memory`). */
const opened: Core[] = []
if (typeof document === 'undefined' && typeof self !== 'undefined') {
  // The page's first message to a worker that streams the Bay. It is this module's alone: the worker's own handler
  // (worker.ts, mover.ts) never sees it, since this listener was added first, when this module was evaluated.
  self.addEventListener('message', (e: MessageEvent) => {
    const told = e.data as { tiles?: MessagePort; levels?: Level[]; keep?: number[] } | null
    if (!told?.tiles) return
    e.stopImmediatePropagation()
    port = told.tiles; toldLevels = told.levels ?? LEVELS; toldKeep = told.keep ?? HOLD.keep
    port.onmessage = (m: MessageEvent<Said | { memory: true } | { ping: number }>) => {
      // Answered at once, whatever this worker is waiting on: the page knows it is there (`silent`).
      if ('ping' in m.data) return port!.postMessage({ pong: m.data.ping })
      if ('memory' in m.data) return port!.postMessage({ memory: opened.reduce((n, c) => n + c.memory.buffer.byteLength, 0) })
      const s = m.data as Said
      waiting.get(s.id)?.(s); waiting.delete(s.id)
    }
    portCame(port)
  })
}
/** A tile's bytes in a worker: asked of the page. */
async function fromPage(level: number, key: string): Promise<ArrayBuffer | null> {
  const p = await portReady, id = ++asks
  const s = await new Promise<Said>((r) => { waiting.set(id, r); p.postMessage({ id, level, key }) })
  if (s.error) throw new Error(s.error)
  return s.body ?? null
}
/**
 * The page's side: gives a worker a port to ask for tiles on (where it streams the Bay), answers it, and asks it
 * every second whether it is there: a worker ended without a word (a tab out of memory) is known by its silence.
 */
export function share(worker: Worker): Worker {
  const { port1, port2 } = new MessageChannel()
  const entry = { port: port1, memory: { bytes: 0 }, owed: 0 }
  port1.onmessage = async (m: MessageEvent<{ id: number; level: number; key: string } | { memory: number } | { pong: number }>) => {
    entry.owed = 0
    if ('pong' in m.data) return
    if ('memory' in m.data) { entry.memory.bytes = m.data.memory; return }
    const { id, level, key } = m.data
    try { const body = await tile(level, key); port1.postMessage({ id, body } satisfies Said) } catch (e) { port1.postMessage({ id, error: String((e as Error).message ?? e) } satisfies Said) }
  }
  const give = (levels: Level[]) => worker.postMessage({ tiles: port2, levels, keep: HOLD.keep }, [port2])
  if (STREAM) void where().then((s) => give(s.levels), () => give(LEVELS))
  else give(LEVELS)
  // Silence is counted from the oldest ping not answered: a page whose timers slept (a tab in the background) does
  // not take its workers for gone when it wakes.
  const ping = setInterval(() => { entry.owed ||= performance.now(); port1.postMessage({ ping: entry.owed }) }, 1000)
  sharing.set(worker, entry)
  // Let go of with the worker.
  const end = worker.terminate.bind(worker)
  worker.terminate = () => { clearInterval(ping); sharing.delete(worker); port1.close(); end() }
  return worker
}
const sharing = new Map<Worker, { port: MessagePort; memory: { bytes: number }; owed: number }>()
/** How long since a worker given a port (`share`) last said anything, ms. */
export const silent = (worker: Worker | null): number => { const e = worker && sharing.get(worker); return e?.owed ? performance.now() - e.owed : 0 }
/** What every core holds, in bytes of its memory (#450): the page's own and each worker's, as each last said. */
export async function memory(): Promise<{ page: number; workers: number[]; tiles: number }> {
  for (const s of sharing.values()) s.port.postMessage({ memory: true })
  await pause(150)
  return { page: opened.reduce((n, c) => n + c.memory.buffer.byteLength, 0), workers: [...sharing.values()].map((s) => s.memory.bytes), tiles: heldTotal }
}

/** A core from its address, holding the Bay's packs where the page asked for the Bay. */
export async function open<T>(url: string): Promise<T> {
  const core = (await WebAssembly.instantiateStreaming(fetch(url), {})).instance.exports as unknown as Core
  opened.push(core)
  if (STREAM) core.bay_begin()
  for (const name of SQUARES) await take(core, await whole(`${BASE}${name}.bay`))
  return core as unknown as T
}
/** A square held whole (`?bay=a,b`), from the page server. */
async function whole(url: string): Promise<ArrayBuffer | null> {
  let answer = await fetch(url)
  for (let again = 0; again < 3 && !answer.ok && answer.status !== 404; again++) { await pause(1500 * (again + 1)); answer = await fetch(url) }
  if (answer.status === 204 || answer.status === 404) return null
  if (!answer.ok) throw new Error(`${url}: ${answer.status}`)
  return answer.arrayBuffer()
}

/** Has a core take a pack. False where there is none to take: a tile that is all sea. */
function take(core: Core, body: ArrayBuffer | null): boolean {
  if (!body || !body.byteLength) return false
  const bytes = new Uint8Array(body)
  // The core's memory moves when it grows: ask for the room first, then look at the memory.
  const at = core.bay_room(bytes.length)
  new Uint8Array(core.memory.buffer, at, bytes.length).set(bytes)
  if (core.bay_load() < 0) throw new Error('a tile this core does not read')
  return true
}

/** What each core holds: a tile by level and place, when it was last wanted, and its coming. */
const held = new WeakMap<object, Map<string, { level: number; x0: number; z0: number; used: number; came: Promise<boolean> }>>()
let clock = 0

/**
 * Has a core hold the tiles that know the cells from (x0, z0) to (x1, z1), for making or asking in cells `cell`
 * wide (the core picks a pack by the same rule: bay.rs `least_step`), and lets go of those longest unwanted.
 * Until it resolves the core answers water there. A place no tile knows stays water. Resolves false where a tile
 * that should be there did not come: what was made from it is water there, and is to be made again later.
 */
export async function need(core: object, x0: number, z0: number, x1: number, z1: number, cell: number): Promise<boolean> {
  if (!STREAM) return true
  const levels = typeof document === 'undefined' ? toldLevels : (await where()).levels, keep = typeof document === 'undefined' ? toldKeep : HOLD.keep
  const level = cell <= 8 ? 0 : cell <= 64 ? 1 : 2, { size, gstep } = levels[level]
  // What stands just past a sector's edge shapes it: a crown's trunk, a bay window's wall.
  const reach = level ? 0 : 96
  let mine = held.get(core)
  if (!mine) held.set(core, (mine = new Map()))
  const coming: Promise<boolean>[] = [], stamp = ++clock
  let whole = true
  for (let tz = Math.floor((z0 - reach) / size); tz <= Math.floor((z1 - 1 + reach) / size); tz++) for (let tx = Math.floor((x0 - reach) / size); tx <= Math.floor((x1 - 1 + reach) / size); tx++) {
    const key = `${level}/${tx}_${tz}`
    let t = mine.get(key)
    if (!t) {
      const body = typeof document === 'undefined' ? fromPage(level, `${tx}_${tz}`) : tile(level, `${tx}_${tz}`)
      mine.set(key, (t = { level, x0: tx * size, z0: tz * size, used: stamp, came: body.then((b) => take(core as Core, b)).catch(() => { mine!.delete(key); whole = false; return false }) }))
    }
    t.used = stamp
    coming.push(t.came)
  }
  await Promise.all(coming)
  // Let go of the longest unwanted of this level, never one wanted since this ask began.
  const same = [...mine].filter(([, t]) => t.level === level && t.used < stamp).sort((a, b) => a[1].used - b[1].used)
  for (let over = [...mine.values()].filter((t) => t.level === level).length - keep[level]; over > 0 && same.length; over--) {
    const [key, t] = same.shift()!
    mine.delete(key)
    void t.came.then((taken) => taken && (core as Core).bay_drop(t.x0, t.z0, gstep))
  }
  return whole
}

/** Has a core that is asked about the world round someone hold it: every cell near, coarser the further out. */
export const near = (core: object, x: number, z: number): Promise<boolean> => Promise.all([need(core, x - 2000, z - 2000, x + 2000, z + 2000, 1), need(core, x - 12000, z - 12000, x + 12000, z + 12000, 16), need(core, x - 50000, z - 50000, x + 50000, z + 50000, 128)]).then((w) => w.every(Boolean))

/** What the page says of a square: its streets by name and its addresses, in cells. */
export interface Names { square: string; at: [number, number, number]; names: string[]; ways: { name: number; line: [number, number][] }[]; addresses: [number, number, number, string][]; credit: string }
export const names = async (): Promise<Names[]> => Promise.all((STREAM ? (await where()).names.map((n) => n.url) : SQUARES.map((name) => `${BASE}${name}.json`)).map(async (url) => (await fetch(url)).json() as Promise<Names>))

/**
 * Where one is, said as a map would: the street underfoot and the nearest address, bottom left, with whose data the
 * place is made from. `at` is the eye's place in cells. Nothing here says who lives anywhere: the data does not.
 */
export async function whereabouts(at: () => [number, number]): Promise<void> {
  const squares = await names()
  const label = document.createElement('div')
  label.id = 'where'
  label.style.cssText = 'position:fixed;left:16px;bottom:14px;font:600 15px system-ui,sans-serif;color:#fff;text-shadow:0 1px 3px #000c;pointer-events:none;z-index:5'
  const credit = document.createElement('div')
  credit.style.cssText = 'font:400 10px system-ui,sans-serif;opacity:.75;margin-top:2px'
  // Who the place is made from: the baked squares' sources, and for everything else the planet's (bay/earth.py).
  const credits = STREAM ? (await where()).credits : null
  credit.textContent = credits ? credits.join('; ') : [...new Set(squares.map((s) => s.credit)), ...(STREAM ? ['© OpenStreetMap contributors, Overture Maps Foundation; terrain: Mapterhorn'] : [])].join('; ')
  const line = document.createElement('div')
  label.append(line, credit)
  document.body.append(label)
  // Addresses by the patch of 25.6 m they are in.
  const near = new Map<string, Names['addresses']>()
  for (const s of squares) for (const a of s.addresses) { const key = `${a[0] >> 8},${a[1] >> 8}`; near.set(key, [...(near.get(key) ?? []), a]) }
  setInterval(() => {
    const [x, z] = at()
    let street = '', least = 400 ** 2
    for (const s of squares) for (const w of s.ways) for (let i = 1; i < w.line.length; i++) {
      const [ax, az] = w.line[i - 1], [bx, bz] = w.line[i], dx = bx - ax, dz = bz - az
      const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1))), far = (x - ax - dx * t) ** 2 + (z - az - dz * t) ** 2
      if (far < least) { least = far; street = s.names[w.name] }
    }
    let address: Names['addresses'][number] | null = null, best = 300 ** 2
    for (let pz = (z >> 8) - 1; pz <= (z >> 8) + 1; pz++) for (let px = (x >> 8) - 1; px <= (x >> 8) + 1; px++) for (const a of near.get(`${px},${pz}`) ?? []) {
      const far = (a[0] - x) ** 2 + (a[1] - z) ** 2
      if (far < best) { best = far; address = a }
    }
    line.textContent = [street, address ? `${address[2]} ${address[3]}` : ''].filter(Boolean).join(' · ')
  }, 500)
}
