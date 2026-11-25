// The Bay Area from data (#373): `?bay=1` makes the world the real place in place of the town, from the packs the
// page server holds (`/bay/<square>.bay`, baked by engine/bay/bake.py; the core's bay.rs reads them). Every core
// that makes or asks about the world (this page's, each maker of sectors, the mover) must hold the same packs
// before it is asked anything, so each opens its core through `open`.
import { LOCAL } from './local.ts'

/** The squares baked first, whole: what `?bay=551.7_4183.5,550.7_4183.5` names, as the first slice was measured. */
const query = new URLSearchParams(globalThis.location?.search ?? '')

/**
 * What a world the page server keeps says of its ground (#526, serve.mjs `--release`): the release it holds (its
 * digest, sf/release.md), where the page reads its pointer, and where one arrives; or `release: null`, the generated
 * town. Its process (world.mjs) holds the same tiles as every core of a page in it, from the same pin.
 */
export interface Ground { release: string | null; pointer: string | null; arrive: { at: [number, number, number]; yaw: number; pitch: number } | null }
/**
 * The ground of the world this page is a view of (`?shared=1`, `?realm=`): written into the page by the server that
 * keeps it, read before anything is made, so that the page draws the world its process walks in. Null where the
 * page is in no such world. A server that says nothing of its ground keeps the town.
 */
export const WORLD: Ground | null = typeof document === 'undefined' || !(query.has('shared') || query.has('realm')) ? null : (() => {
  const said = document.getElementById('ground')?.textContent
  return said ? (JSON.parse(said) as Ground) : { release: null, pointer: null, arrive: null }
})()
/** The release this page is pinned to itself (`?release=<digest>`), where it is one; else it takes the world's. */
const pinned = query.get('release')
/**
 * Why this page does not join the world (#526): its own pin is not the world's ground, and it would draw one city
 * and walk in another. In plain words, or null where it may join. The stream says the world's ground again first of
 * all (link.ts `GROUND`), in case it changed since the page was served.
 */
export const refusal = (world: Ground, mine: string | null): string | null => !mine || mine === world.release ? null
  : world.release ? `This page is pinned to San Francisco release ${mine.slice(0, 12)}, and this world holds release ${world.release.slice(0, 12)}. It has not joined: it would draw one city and walk in another. Open it without ?release= to take the world's.`
    : `This page is pinned to San Francisco release ${mine.slice(0, 12)}, and this world is the generated town, not a release. It has not joined: it would draw one place and walk in another.`
if (WORLD) {
  const why = refusal(WORLD, pinned && /^[0-9a-f]{64}$/.test(pinned) ? pinned : null)
  if (why) {
    const say = document.createElement('div')
    say.id = 'refused'
    say.style.cssText = 'position:fixed;inset:0;display:grid;place-items:center;padding:24px;font:500 17px/1.5 system-ui,sans-serif;color:#e8ecf1;background:#10141a;text-align:center;z-index:99'
    say.textContent = why
    document.body.append(say)
    throw new Error(why)
  }
}
// A world the page server keeps is the town, or the release its process holds: the world says which, never the
// address. A realm this page runs alone (local.ts) says which world it is in itself, where the address does not.
let asked = WORLD ? (WORLD.release ? '1' : null) : query.get('bay') ?? LOCAL?.world?.bay ?? null
/**
 * Where the packs are: beside the page's own folder (`/bay/` under the page server, `<site>/bay/` in a static
 * folder, #450), the same for the page and its workers, whose modules are all in page/.
 */
const BASE = new URL('../bay/', import.meta.url).href
/**
 * How this context reads what a release names (sf/release.md): `fetch` in a page. The world's process (world.mjs,
 * `hold`) reads files on disk and an address's copies kept on disk with the same calls, through this.
 */
let get: (url: string | URL, init?: RequestInit) => Promise<Response> = (url, init) => fetch(url, init)
/** Told of each object of a release that came and passed its checks (the world's process keeps an address's on disk). */
let passed: (url: string, body: ArrayBuffer) => void = () => {}
/** Whether this context fetches its own tiles (a page, the world's process) or asks the page for them (a worker). */
let owns = typeof document !== 'undefined'
/** How often a tile that does not come is asked for again, and how long is waited before the first time again (doubled each time). */
let tries = 3, wait = 1000
/** Told that a core has taken a tile, by where it starts and how wide it is (the world's process has its solver make again what it kept of the cells there). */
let taken: (core: object, x0: number, z0: number, size: number) => void = () => {}
/** Where tiles that did not come are not asked for again until a while has passed (the world's process, `hold`): by `level/key`, until when (Infinity: still on its way after it was given up on). */
const resting = new Map<string, number>()
/** How long each tile that did not come rests next time: doubled each time it fails again, up to a minute. */
const restFor = new Map<string, number>()
let rest = 0
/** The most tiles a core may hold at once (the world's process, `hold`): past it the least lately wanted that nothing waits on is let go, or what is asked is refused. */
let most = Infinity
/** Why the ground was not had: on its way too long, resting after it failed, failed now, or more than a core may hold. */
export type Unheld = 'slow' | 'resting' | 'failed' | 'full'
/**
 * `?bay=1`: the world comes in tiles as the eye moves (bay/tiles.py), so that it has no edge the page must hold:
 * each core holds the few tiles round what it is asked about and lets the rest go.
 */
export let STREAM = asked === '1' || asked === 'earth'
/** The squares this page's world is made from where they are held whole (`?bay=a,b`). */
export const SQUARES: readonly string[] = !asked || asked === '0' || STREAM ? [] : asked.split(',').filter((name) => /^[0-9._]+$/.test(name))
/** Whether this page's world is the Bay's at all. */
export let ON = STREAM || SQUARES.length > 0
/** Where on Earth the address says the page starts (`&ll=`): never in a world the server keeps, whose frame is its release's. */
const ll = WORLD ? null : query.get('ll')
/** What a worker's address ends in, so that it opens its core as this page does. */
export const BAY = (STREAM ? `?bay=${asked}${ll ? `&ll=${ll}` : ''}` : SQUARES.length ? `?bay=${SQUARES.join(',')}` : '') + (ON && query.get('heroes') === '0' ? '&heroes=0' : '')

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
const asked_ll = ll?.split(',').map(Number)
const there = STREAM && asked_ll?.length === 2 && asked_ll.every(Number.isFinite) ? place(asked_ll[0], asked_ll[1]) : null
/** The frame this page's cells are counted in, and where it starts in it (the Bay's own start where null). */
export const FRAME = there?.frame ?? '10n4250'
export const START: [number, number] | null = there ? [there.x, there.z] : WORLD?.release && WORLD.arrive ? [WORLD.arrive.at[0], WORLD.arrive.at[2]] : null
/** `?bay=earth`: nothing baked from lidar is used, only what is made from the planet's data. */
const BAKED = asked === '1' && FRAME === '10n4250'

interface Core { memory: WebAssembly.Memory; bay_room(bytes: number): number; bay_load(): number; bay_marks(): number; bay_begin(): void; bay_drop(x0: number, z0: number, gstep: number): number; bay_hero(sort: number, x: number, z: number, foot: number, turn: number): number; bay_landmarks(on: number): void }

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
interface Manifest { version: number; frame: string; far?: object; levels: (Level & { level: number; tiles: { [key: string]: Record }; sea: string[] })[]; names: { [square: string]: Record }; credits: string[] }
/** What the page knows of where tiles are: their levels, how to find one, the squares' names and whose data it is. */
export interface Source {
  levels: Level[]
  /** A tile's address and what it must be, or null where it is water and nothing is asked. */
  find(level: number, key: string): { url: string; bytes?: number; sha256?: string; listed: boolean } | null
  names: { url: string; bytes?: number; sha256?: string }[]
  credits: string[] | null
  /** The release this page is pinned to, and its manifest's address (far.ts reads its `far` from it), or null under the page server. */
  release: string | null
  manifest: string | null
  /** Whether the release holds a far model (its manifest's `far`). */
  far: boolean
  /** Whether the manifest's hash was checked (crypto.subtle is only in secure contexts: https and localhost). */
  checked: boolean
  /** An object the release lists anywhere in its manifest (a tile, names, the far model's, street life's), by its path there: where it is and what it must be. Null for anything it does not list. */
  record(path: string): { url: string; bytes: number; sha256: string; listed: true } | null
}
const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((v) => v.toString(16).padStart(2, '0')).join('')
const digest = async (b: ArrayBuffer): Promise<string | null> => (globalThis.crypto?.subtle ? hex(await crypto.subtle.digest('SHA-256', b)) : null)

async function released(pointer: URL): Promise<Source> {
  // Asked once a page load, past any cache: the pointer is the one file that changes between releases.
  const p = await get(pointer, { cache: 'no-cache' })
  if (!p.ok) throw new Error(`${pointer.pathname}: ${p.status}`)
  const at = (await p.json()) as { version: number; release: string; manifest: string }
  if (at.version !== 1 || !/^[0-9a-f]{64}$/.test(at.release)) throw new Error(`${pointer.pathname} is not a release pointer this page reads`)
  const where = new URL(at.manifest, pointer), m = await get(where)
  if (!m.ok) throw new Error(`${where.pathname}: ${m.status}`)
  const bytes = await m.arrayBuffer(), sum = await digest(bytes)
  if (sum !== null && sum !== at.release) throw new Error(`the manifest is not release ${at.release.slice(0, 12)}`)
  if (sum !== null) passed(where.href, bytes)
  const manifest = JSON.parse(new TextDecoder().decode(bytes)) as Manifest
  if (manifest.version !== 1) throw new Error(`manifest version ${manifest.version}: this page reads 1`)
  if (manifest.frame !== FRAME) throw new Error(`the release is in frame ${manifest.frame}, the page in ${FRAME}`)
  const levels = [...manifest.levels].sort((a, b) => a.level - b.level), sea = levels.map((l) => new Set(l.sea)), listed = records(manifest)
  return {
    levels: levels.map(({ size, gstep }) => ({ size, gstep })),
    // Water, in the sea list or past what the release holds: nothing is asked.
    find: (level, key) => { const r = levels[level]?.tiles[key]; if (r) return { url: new URL(r.path, where).href, bytes: r.bytes, sha256: r.sha256, listed: true }; if (sea[level]?.has(key)) seaKeys++; else unlisted++; return null },
    names: Object.values(manifest.names).map((r) => ({ url: new URL(r.path, where).href, bytes: r.bytes, sha256: r.sha256 })),
    credits: manifest.credits,
    release: at.release,
    manifest: where.href,
    far: !!manifest.far,
    checked: sum !== null,
    record: (path) => { const r = listed.get(path); return r ? { url: new URL(r.path, where).href, bytes: r.bytes, sha256: r.sha256, listed: true } : null },
  }
}
/** Every object record in a manifest, wherever it is (sf/release.md: each has a relative `path`, its `bytes` and `sha256`), by path. */
function records(of: unknown, into = new Map<string, Record>()): Map<string, Record> {
  if (Array.isArray(of)) for (const v of of) records(v, into)
  else if (of && typeof of === 'object') {
    const r = of as Partial<Record>
    if (typeof r.path === 'string' && typeof r.bytes === 'number' && typeof r.sha256 === 'string') into.set(r.path, r as Record)
    else for (const v of Object.values(of)) records(v, into)
  }
  return into
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
    manifest: null,
    far: false,
    checked: false,
    record: () => null,
  }
}
let source: Promise<Source> | null = null
/** Water keys asked for: in the release's sea list, and past what it lists. */
let seaKeys = 0, unlisted = 0
export const water = () => ({ sea: seaKeys, unlisted })
/** Where the tiles come from, read once: in the page only (a worker is told what it needs by the page). */
export const where = (): Promise<Source> => (source ??= WORLD?.pointer ? released(new URL(WORLD.pointer, location.href)) : LOCAL?.release ? released(new URL(LOCAL.release, location.href)) : served())

/** How much a device may hold (#450): a phone's tab is killed long before a laptop's. */
export const DEVICE: 'phone' | 'desktop' = typeof navigator !== 'undefined' && navigator.maxTouchPoints > 0 && Math.min(globalThis.screen?.width ?? 1e4, globalThis.screen?.height ?? 1e4) < 600 ? 'phone' : 'desktop'
/** What one device class may hold: tiles kept by each core, at each level, and tile bytes the page keeps for its workers. */
export const HOLD = DEVICE === 'phone' ? { keep: [12, 4, 4], bytes: 24 << 20 } : { keep: [24, 8, 8], bytes: 96 << 20 }

/** The tiles the page holds for its cores: each fetched once, the last wanted kept up to `HOLD.bytes`. */
const bytesHeld = new Map<string, { body: Promise<ArrayBuffer | null>; size: number; used: number }>()
let heldTotal = 0, heldClock = 0
/** What the page has done for its tiles, for the checks: requests, failures, retries, and how many asks were answered from what it held. */
export const tally = { fetched: 0, failed: 0, retried: 0, shared: 0, water: 0, held: 0, bytes: 0 }
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms))

/**
 * An object the pinned release lists, by its path in the manifest, checked as a tile is (its length and SHA-256) and so
 * kept on disk by whoever reads an address's release (`hold`): null for anything the release does not list.
 */
export async function listed(path: string): Promise<ArrayBuffer | null> {
  const found = (await where()).record(path)
  return found ? fetchTile(found) : null
}

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
    const answer = await get(found.url).catch(() => null)
    // Under the page server a 404 or 204 is a place nobody made: sea. In a release a listed tile is never water.
    if (answer && !found.listed && (answer.status === 404 || answer.status === 204)) return null
    if (answer?.ok) {
      const body = await answer.arrayBuffer()
      if (!found.listed && !body.byteLength) return null
      // What the manifest says it is: a host that sends Brotli without saying so, or a file cut short, is caught here.
      if (found.bytes === undefined) { tally.bytes += body.byteLength; return body }
      const sum = found.sha256 ? await digest(body) : null
      if (body.byteLength === found.bytes && (!found.sha256 || (sum ?? found.sha256) === found.sha256)) { tally.bytes += body.byteLength; if (sum) passed(found.url, body); return body }
    }
    if (again >= tries) { tally.failed++; throw new Error(`${new URL(found.url).pathname}: ${answer ? answer.status : 'no answer'}`) }
    tally.retried++
    await pause(wait * 2 ** again)
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
  const entry = { port: port1, memory: { bytes: 0 }, owed: false, missed: 0 }
  port1.onmessage = async (m: MessageEvent<{ id: number; level: number; key: string } | { memory: number } | { pong: number }>) => {
    entry.owed = false; entry.missed = 0
    if ('pong' in m.data) return
    if ('memory' in m.data) { entry.memory.bytes = m.data.memory; return }
    const { id, level, key } = m.data
    try { const body = await tile(level, key); port1.postMessage({ id, body } satisfies Said) } catch (e) { port1.postMessage({ id, error: String((e as Error).message ?? e) } satisfies Said) }
  }
  const give = (levels: Level[]) => worker.postMessage({ tiles: port2, levels, keep: HOLD.keep }, [port2])
  if (STREAM) void where().then((s) => give(s.levels), () => give(LEVELS))
  else give(LEVELS)
  // Silence is counted in pings gone unanswered, a second apart, not in time: a page whose timers slept (a tab in the
  // background) or whose own thread stalled sends none meanwhile, so it does not take its workers for gone.
  const ping = setInterval(() => { if (entry.owed) entry.missed++; entry.owed = true; port1.postMessage({ ping: 1 }) }, 1000)
  sharing.set(worker, entry)
  // Let go of with the worker.
  const end = worker.terminate.bind(worker)
  ending.set(worker, end)
  worker.terminate = () => { clearInterval(ping); sharing.delete(worker); port1.close(); end() }
  return worker
}
const ending = new WeakMap<Worker, () => void>()
/** For the checks: ends a worker as a tab out of memory would, without a word and still watched, so the page must find it gone. */
export const end = (worker: Worker | null | undefined) => { if (worker) ending.get(worker)?.() }
const sharing = new Map<Worker, { port: MessagePort; memory: { bytes: number }; owed: boolean; missed: number }>()
/** How long a worker given a port (`share`) has said nothing, ms: a second for each ping it has let pass. */
export const silent = (worker: Worker | null): number => { const e = worker && sharing.get(worker); return e ? e.missed * 1000 : 0 }
/** What every core holds, in bytes of its memory (#450): the page's own and each worker's, as each last said. */
export async function memory(): Promise<{ page: number; workers: number[]; tiles: number }> {
  for (const s of sharing.values()) s.port.postMessage({ memory: true })
  await pause(150)
  return { page: opened.reduce((n, c) => n + c.memory.buffer.byteLength, 0), workers: [...sharing.values()].map((s) => s.memory.bytes), tiles: heldTotal }
}

/** A core from its address, holding the Bay's packs where the page asked for the Bay. */
export async function open<T>(url: string): Promise<T> {
  const core = (await WebAssembly.instantiateStreaming(fetch(url), {})).instance.exports as unknown as Core
  return prepare<T>(core)
}
/** Has a core just made hold what every core of this world holds before it is asked anything: the Bay begun, its landmarks, the squares its road's marks cover, any squares held whole. */
export async function prepare<T>(instance: object): Promise<T> {
  const core = instance as Core
  opened.push(core)
  if (STREAM) core.bay_begin()
  // Landmarks by rule (#450, core/src/heroes.rs): every core is told where each stands before it makes a sector.
  // `?heroes=0` leaves them out (as the tiles have the place), for what they cost.
  if (query.get('heroes') === '0') core.bay_landmarks(0)
  for (const h of await heroes()) { if (h.only === 'night') continue; const at = place(h.at[0], h.at[1]), toward = place(h.toward[0], h.toward[1]); core.bay_hero(h.sort, Math.round(at.x), Math.round(at.z), Math.round(h.foot * 10), Math.round(Math.atan2(toward.z - at.z, toward.x - at.x) * 1e6)) }
  // Which squares the road's marks cover (#450, sf/marks.mjs): there the bake's own paint is not drawn. The marks
  // themselves come later, for the march alone (`marks`).
  const lines = await markedSquares()
  if (lines) { const at = core.bay_room(lines.byteLength); new Uint8Array(core.memory.buffer, at, lines.byteLength).set(new Uint8Array(lines)); if (core.bay_marks() < 0) throw new Error('marks this core does not read') }
  for (const name of SQUARES) await take(core, await whole(`${BASE}${name}.bay`))
  return core as unknown as T
}

/** The landmarks a Bay world has (sf/heroes.json, copied beside the tiles as heroes.json): where each stands. */
export interface Landmark { name: string; sort: number; at: [number, number]; toward: [number, number]; foot: number; /** `night`: only its light by night is by rule (heroes.rs `night`); its shape is the map's building. */ only?: 'night' }
let landmarks: Promise<Landmark[]> | null = null
export const heroes = () => (landmarks ??= (ON ? fetch(`${BASE}heroes.json`).then((r) => (r.ok ? (r.json() as Promise<Landmark[]>) : [])).catch(() => []) : Promise.resolve([])))

/**
 * A file of the road's marks a Bay world has beside its tiles (sf/marks.mjs), or null: San Francisco's alone (its cells
 * are counted in frame 10n4250), so a world in another frame asks for none. Where it is missing or cannot be had, what
 * the roads look like for it is said, not left to be noticed.
 */
const markFile = (name: string, without: string) => (ON && FRAME === '10n4250' ? fetch(`${BASE}${name}`).then((r) => {
  if (r.ok) return r.arrayBuffer()
  console.error(`no road marks (${BASE}${name}: ${r.status}): ${without}`)
  return null
}).catch((e: Error) => { console.error(`no road marks (${BASE}${name}: ${e.message}): ${without}`); return null }) : Promise.resolve(null))
/** The squares the marks cover, and no segments (marks-squares.bin, 2.5 KB): what every core needs before it makes a sector. */
let squaring: Promise<ArrayBuffer | null> | null = null
// Asked three times, a second apart, before a core goes on without them: a core that missed them keeps the bake's paint
// under the page's lines in its own sectors.
const markedSquares = () => (squaring ??= (async () => {
  for (let tries = 3; ; tries--) {
    const bytes = await markFile('marks-squares.bin', tries > 1 ? 'asking again' : "this core keeps the bake's 50 cm paint")
    if (bytes || tries <= 1 || !(ON && FRAME === '10n4250')) return bytes
    await new Promise((r) => setTimeout(r, 1000))
  }
})())
/**
 * The marks themselves (marks.bin, 1.5 MB, 0.4 MB as Brotli), for the march (marks.ts): asked for once the place is
 * shown round the eye (main.ts), not before, so they cost the first picture nothing. The cores have stopped drawing
 * the bake's paint by then, so until they come the roads are bare; one that failed is asked for again on the next call.
 */
export const marks = () => markFile('marks.bin', 'the roads are bare asphalt until they come')

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
interface Held { level: number; x0: number; z0: number; used: number; /** When it was last wanted, ms since 1970. */ seen: number; came: Promise<boolean>; failed?: boolean; /** Whether it has come (as a pack or as water). */ ready?: boolean; /** How many asks wait on it now: such a tile is never let go. */ waiters?: number }
const held = new WeakMap<object, Map<string, Held>>()
let clock = 0

/**
 * Has a core hold the tiles that know the cells from (x0, z0) to (x1, z1), for making or asking in cells `cell`
 * wide (the core picks a pack by the same rule: bay.rs `least_step`), and lets go of those longest unwanted.
 * Until it resolves the core answers water there. A place no tile knows stays water. Resolves false where a tile
 * that should be there did not come: what was made from it is water there, and is to be made again later.
 */
export async function need(core: object, x0: number, z0: number, x1: number, z1: number, cell: number): Promise<boolean> {
  return (await ground(core, x0, z0, x1, z1, cell)) === null
}
/** The tiles a box of cells `cell` wide needs, by key, and where each starts. */
const keysOf = (x0: number, z0: number, x1: number, z1: number, level: number, size: number) => {
  // What stands just past a sector's edge shapes it: a crown's trunk, a bay window's wall.
  const reach = level ? 0 : 96, out: { key: string; tx: number; tz: number }[] = []
  for (let tz = Math.floor((z0 - reach) / size); tz <= Math.floor((z1 - 1 + reach) / size); tz++) for (let tx = Math.floor((x0 - reach) / size); tx <= Math.floor((x1 - 1 + reach) / size); tx++) out.push({ key: `${level}/${tx}_${tz}`, tx, tz })
  return out
}
/**
 * `need`, saying why not (`Unheld`) or null where the ground is had. `within` (ms) is the longest it waits: past it,
 * what is still on its way is given up on for now (it rests until it comes or fails), and it says `slow`.
 */
export async function ground(core: object, x0: number, z0: number, x1: number, z1: number, cell: number, within?: number): Promise<Unheld | null> {
  if (!STREAM) return null
  const levels = owns ? (await where()).levels : toldLevels, keep = owns ? HOLD.keep : toldKeep
  const level = cell <= 8 ? 0 : cell <= 64 ? 1 : 2, { size, gstep } = levels[level]
  let mine = held.get(core)
  if (!mine) held.set(core, (mine = new Map()))
  const coming: Promise<boolean>[] = [], wanted: Held[] = [], stamp = ++clock
  let why: Unheld | null = null
  for (const { key, tx, tz } of keysOf(x0, z0, x1, z1, level, size)) {
    let t = mine.get(key)
    // A tile that did not come a moment ago is not asked for again yet: whoever asks there hears so at once.
    if (!t && rest && (resting.get(key) ?? 0) > Date.now()) { why ??= 'resting'; continue }
    // One given up on while still on its way: nobody waits on it again until it has come.
    if (t && !t.ready && resting.get(key) === Infinity) { why ??= 'slow'; continue }
    // No more than a core may hold: the least lately wanted that nothing waits on makes room, or nothing is asked for.
    if (!t && mine.size >= most && !roomIn(core, mine, stamp)) { why ??= 'full'; continue }
    if (!t) {
      const body = owns ? tile(level, `${tx}_${tz}`) : fromPage(level, `${tx}_${tz}`)
      const entry: Held = { level, x0: tx * size, z0: tz * size, used: stamp, seen: 0, came: Promise.resolve(false), waiters: 0 }
      // Failed, it is let go of (the next ask tries again), and every ask that waited on it hears so: each column made
      // meanwhile is made again (world.ts `lacking`), not only the one that first asked.
      entry.came = body.then((b) => {
        const took = take(core as Core, b)
        entry.ready = true; resting.delete(key); restFor.delete(key)
        if (took) taken(core, entry.x0, entry.z0, size)
        return took
      }).catch(() => {
        if (mine!.get(key) === entry) mine!.delete(key)
        entry.failed = true
        if (rest) { const r = Math.min(60_000, restFor.get(key) ?? rest); restFor.set(key, r * 2); resting.set(key, Date.now() + r) }
        return false
      })
      mine.set(key, (t = entry))
    }
    t.used = stamp; t.seen = Date.now(); t.waiters = (t.waiters ?? 0) + 1
    coming.push(t.came)
    wanted.push(t)
  }
  let late = false
  try {
    if (within === undefined) await Promise.all(coming)
    else await Promise.race([Promise.all(coming), new Promise((r) => setTimeout(() => { late = true; r(null) }, within))])
  } finally { for (const t of wanted) t.waiters = (t.waiters ?? 1) - 1 }
  if (late) for (const { key } of keysOf(x0, z0, x1, z1, level, size)) { const t = mine.get(key); if (t && !t.ready && rest) resting.set(key, Infinity) }
  why ??= wanted.some((t) => t.failed) ? 'failed' : late && wanted.some((t) => !t.ready) ? 'slow' : null
  // Let go of the longest unwanted of this level, never one wanted since this ask began.
  const same = [...mine].filter(([, t]) => t.level === level && t.used < stamp).sort((a, b) => a[1].used - b[1].used)
  for (let over = [...mine.values()].filter((t) => t.level === level).length - keep[level]; over > 0 && same.length; over--) {
    const [key, t] = same.shift()!
    mine.delete(key)
    void t.came.then((taken) => taken && (core as Core).bay_drop(t.x0, t.z0, gstep))
  }
  return why
}
/** Makes room for one more tile in a core that holds `most`: lets go of the least lately wanted that has come, nothing waits on, and nobody wanted in the last two seconds. */
function roomIn(core: object, mine: Map<string, Held>, stamp: number): boolean {
  const now = Date.now()
  let oldest: [string, Held] | null = null
  for (const e of mine) if (e[1].ready && !e[1].waiters && e[1].used < stamp && now - e[1].seen > 2000 && (!oldest || e[1].seen < oldest[1].seen)) oldest = e
  if (!oldest) return false
  const [key, t] = oldest
  mine.delete(key)
  void t.came.then((took) => took && (core as Core).bay_drop(t.x0, t.z0, (toldLevels[t.level] ?? LEVELS[t.level]).gstep))
  return true
}
/** Whether a core holds, now, every tile a box needs (has come, as a pack or as water): what is answered there is the place's. Counts as wanting them. */
export function holds(core: object, x0: number, z0: number, x1: number, z1: number, cell: number): boolean {
  if (!STREAM) return true
  const mine = held.get(core), level = cell <= 8 ? 0 : cell <= 64 ? 1 : 2, size = (toldLevels[level] ?? LEVELS[level]).size, now = Date.now()
  for (const { key } of keysOf(x0, z0, x1, z1, level, size)) { const t = mine?.get(key); if (!t?.ready || t.failed) return false; t.seen = now }
  return true
}

/**
 * Has the page fetch the finest tiles within `reach` cells of a place, for whichever core asks for them next (`tile`
 * keeps them): what the makers of sectors will want once the world's boxes are round it (#450: the roof a flight is
 * on its way to). No core is made to hold them. Resolves when they have come, whether or not each did.
 */
export async function warm(x: number, z: number, reach: number): Promise<void> {
  if (!STREAM) return
  const { size } = (await where()).levels[0], coming: Promise<unknown>[] = []
  for (let tz = Math.floor((z - reach) / size); tz <= Math.floor((z + reach) / size); tz++) for (let tx = Math.floor((x - reach) / size); tx <= Math.floor((x + reach) / size); tx++) coming.push(tile(0, `${tx}_${tz}`).catch(() => null))
  await Promise.all(coming)
}
/** Has a core hold the finest tiles round someone, for what is asked of the ground underfoot: what the page needs before its first picture. */
export const underfoot = (core: object, x: number, z: number): Promise<boolean> => need(core, x - 2000, z - 2000, x + 2000, z + 2000, 1)
/**
 * Lets go of every tile a core has not been made to hold (`need`) within the last `ms`: what the world's process
 * does in place of a count, since it holds what is round everyone in it at once (#526). Says how many it let go.
 */
export function forget(core: object, ms: number): number {
  const mine = held.get(core), before = Date.now() - ms
  let n = 0
  if (mine) for (const [key, t] of [...mine]) {
    // Never one that is on its way or that something waits on.
    if (t.seen >= before || !t.ready || t.waiters) continue
    mine.delete(key); n++
    void t.came.then((taken) => taken && (core as Core).bay_drop(t.x0, t.z0, (toldLevels[t.level] ?? LEVELS[t.level]).gstep))
  }
  return n
}
/** How many tiles a core holds (or is waiting for) at each level. */
export const holding = (core: object): number[] => { const n = [0, 0, 0]; for (const t of held.get(core)?.values() ?? []) n[t.level]++; return n }
/** A core that is no more (one swapped for another build): what it held is not counted again. */
export const dropped = (core: object) => { const at = opened.indexOf(core as Core); if (at >= 0) opened.splice(at, 1) }

/**
 * The world's process holds San Francisco (#526): from here on this context reads the release at `pointer` itself,
 * through `read` (files on disk, or an address's copies kept on disk), as a page does, with every check a page makes;
 * holds no tile bytes beside its core's; and lets go by time (`forget`), not by count. `heroes` and `squares` are the
 * landmarks and the squares the road's marks cover, the same the server gives its pages.
 */
export async function hold(o: { pointer: string; read: typeof get; passed?: (url: string, body: ArrayBuffer) => void; heroes: Landmark[]; squares: ArrayBuffer | null; taken?: (core: object, x0: number, z0: number, size: number) => void; most?: number }): Promise<Source> {
  get = o.read; passed = o.passed ?? passed; owns = true; taken = o.taken ?? taken; most = o.most ?? most
  asked = '1'; STREAM = true; ON = true
  Object.assign(HOLD, { keep: [Infinity, Infinity, Infinity], bytes: 0 })
  // A tile is asked for once, and one that does not come rests before it is asked for again (longer each time): the
  // world answers nothing about that place meanwhile, and nobody waits on it (world.mjs).
  tries = 0; wait = 250; rest = 5000
  landmarks = Promise.resolve(o.heroes)
  squaring = Promise.resolve(o.squares)
  source = released(new URL(o.pointer))
  const s = await source
  toldLevels = s.levels
  return s
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
export async function whereabouts(at: () => [number, number], /** Whose else the place is made from (the far model's, far.ts). */ more: readonly string[] = [], /** Who shows the credits instead of the line under the street's name (first.ts): given each, said once. */ said?: (credits: string[]) => void): Promise<void> {
  const squares = await names()
  const label = document.createElement('div')
  label.id = 'where'
  label.style.cssText = 'position:fixed;left:16px;bottom:14px;font:600 15px system-ui,sans-serif;color:#fff;text-shadow:0 1px 3px #000c;pointer-events:none;z-index:5'
  const credit = document.createElement('div')
  credit.style.cssText = 'font:400 10px system-ui,sans-serif;opacity:.75;margin-top:2px'
  // Who the place is made from: the baked squares' sources, and for everything else the planet's (bay/earth.py).
  // The release's credits where there is one (they name every source in it), else the squares' and the planet's;
  // with whose else the place is made from (`more`), each said once.
  const credits = STREAM ? (await where()).credits : null
  const each = [...new Set([...(credits ?? [...squares.map((s) => s.credit), ...(STREAM ? ['© OpenStreetMap contributors, Overture Maps Foundation; terrain: Mapterhorn'] : [])]), ...more].flatMap((c) => c.split('; ')))]
  if (said) said(each); else credit.textContent = each.join('; ')
  const line = document.createElement('div')
  label.append(line, ...(said ? [] : [credit]))
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
