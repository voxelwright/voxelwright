// The Bay Area from data (#373): `?bay=1` makes the world the real place in place of the town, from the packs the
// page server holds (`/bay/<square>.bay`, baked by engine/bay/bake.py; the core's bay.rs reads them). Every core
// that makes or asks about the world (this page's, each maker of sectors, the mover) must hold the same packs
// before it is asked anything, so each opens its core through `open`.
import { releaseCredits } from './release-credits.ts'
import { LOCAL } from './local.ts'
import { PACKS_ENABLED, readPackedJson, squarePackName } from './pack.ts'

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
/** How often a tile that does not come is asked for again, how long is waited before the first time again (doubled each time), and how long one attempt may hang before aborting (ms). */
let tries = 3, wait = 1000, fetchTimeout = 12_000
/** Sets the per-attempt tile fetch timeout (ms), for checks. */
export const setFetchTimeout = (ms: number) => { fetchTimeout = ms }
/** Told that a core has taken a tile, by where it starts and how wide it is (the world's process has its solver make again what it kept of the cells there). */
let taken: (core: object, x0: number, z0: number, size: number) => void = () => {}
/** Where tiles that did not come are not asked for again until a while has passed (the world's process, `hold`): by `level/key`, until when (Infinity: still on its way after it was given up on). */
const resting = new Map<string, number>()
/** How long each tile that did not come rests next time: doubled each time it fails again, up to a minute. */
const restFor = new Map<string, number>()
let rest = 0
/**
 * The most tiles a core may hold beyond its own ground (`owning`; the world's process, `hold`): past it the least
 * lately wanted that nothing waits on and that is nobody's own is let go, or what is asked is refused.
 */
let most = Infinity
/** The finest tiles each core holds as someone's own ground (the world's process: where people are, and the arrival): never counted against `most`, never let go. */
const own = new WeakMap<object, Set<string>>()
/** Says which finest tiles are a core's own ground from now on: the tiles boxes of cells ([x0, z0, x1, z1]) need. */
export function owning(core: object, boxes: number[][]): void {
  const size = (toldLevels[0] ?? LEVELS[0]).size, keys = new Set<string>()
  for (const b of boxes) for (const { key } of keysOf(b[0], b[1], b[2], b[3], 0, size)) keys.add(key)
  own.set(core, keys)
}
/** Whether every finest tile a box needs is a core's own ground. */
export function owned(core: object, x0: number, z0: number, x1: number, z1: number): boolean {
  const keys = own.get(core), size = (toldLevels[0] ?? LEVELS[0]).size
  return !!keys && keysOf(x0, z0, x1, z1, 0, size).every(({ key }) => keys.has(key))
}
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
/** `&ll=latitude,longitude` as two finite numbers on Earth, or null (#81: nothing else of the address reaches a worker's). */
export const llAsked = (said: string | null): [number, number] | null => {
  const v = said?.split(',').map((p) => (p.trim() === '' ? NaN : Number(p)))
  return v?.length === 2 && v.every(Number.isFinite) && Math.abs(v[0]) <= 90 && Math.abs(v[1]) <= 180 ? [v[0], v[1]] : null
}
const asked_ll = llAsked(ll)
/** What a worker's address ends in, so that it opens its core as this page does. */
export const BAY = (STREAM ? `?bay=${encodeURIComponent(asked!)}${asked_ll ? `&ll=${encodeURIComponent(asked_ll.join(','))}` : ''}` : SQUARES.length ? `?bay=${SQUARES.map(encodeURIComponent).join(',')}` : '') + (ON && query.get('heroes') === '0' ? '&heroes=0' : '')

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
/** Inverse of `place`: world cell coordinates (x, z) in `frame` (default `FRAME`) back to WGS84 latitude & longitude. */
export function latLon(x: number, z: number, frame = FRAME): { lat: number; lon: number } | null {
  const m = /^(\d{1,2})([ns])(\d+)$/.exec(frame)
  if (!m) return null
  const zone = Number(m[1]), south = m[2] === 's', top = Number(m[3])
  const E = x / 10, N = top * 1000 - z / 10 - (south ? 10_000_000 : 0)
  const a = 6378137, f = 1 / 298.257223563, n = f / (2 - f), k0 = 0.9996
  const A = (a / (1 + n)) * (1 + n ** 2 / 4 + n ** 4 / 64)
  const beta = [n / 2 - (2 * n ** 2) / 3 + (37 * n ** 3) / 96, n ** 2 / 48 + n ** 3 / 15, (17 * n ** 3) / 480]
  const delta = [2 * n - (2 * n ** 2) / 3 - 2 * n ** 3, (7 * n ** 2) / 3 - (8 * n ** 3) / 5, (56 * n ** 3) / 15]
  const xi = N / (k0 * A), eta = E / (k0 * A)
  let xiP = xi, etaP = eta
  beta.forEach((b, j) => { const k = 2 * (j + 1); xiP -= b * Math.sin(k * xi) * Math.cosh(k * eta); etaP -= b * Math.cos(k * xi) * Math.sinh(k * eta) })
  const chi = Math.asin(Math.max(-1, Math.min(1, Math.sin(xiP) / Math.cosh(etaP))))
  let phi = chi
  delta.forEach((d, j) => { phi += d * Math.sin(2 * (j + 1) * chi) })
  const lam = Math.atan2(Math.sinh(etaP), Math.cos(xiP))
  return { lat: Math.round((phi * 180 / Math.PI) * 1e6) / 1e6, lon: Math.round(((zone * 6 - 183) + lam * 180 / Math.PI) * 1e6) / 1e6 }
}
/** Level-0 tile key (`tx_tz`) and SF 1 km square name (`E_N`) for a cell coordinate in the Bay frame. */
export function tileOf(x: number, z: number, tileSize = 2500): { tile: string; square: string } {
  const tx = Math.floor(x / tileSize), tz = Math.floor(z / tileSize)
  const eKm = Math.floor((500000 + x / 10) / 1000 * 10) / 10
  const nKm = Math.floor((4250000 - z / 10) / 1000 * 10) / 10
  return { tile: `0/${tx}_${tz}`, square: `${eKm.toFixed(1)}_${nKm.toFixed(1)}` }
}
/** `&ll=latitude,longitude`: where on Earth the page starts; the Bay where it does not say. */
const there = STREAM && asked_ll ? place(asked_ll[0], asked_ll[1]) : null
/** The frame this page's cells are counted in, and where it starts in it (the Bay's own start where null). */
export const FRAME = LOCAL?.release ? '10n4250' : (there?.frame ?? '10n4250')
export const START: [number, number] | null = there ? [there.x, there.z] : WORLD?.release && WORLD.arrive ? [WORLD.arrive.at[0], WORLD.arrive.at[2]] : null
/** `?bay=earth`: nothing baked from lidar is used, only what is made from the planet's data. */
const BAKED = asked === '1' && FRAME === '10n4250'

interface Core { memory: WebAssembly.Memory; bay_room(bytes: number): number; bay_load(): number; bay_marks(): number; bay_kerbs?(): number; bay_begin(): void; bay_drop(x0: number, z0: number, gstep: number): number; bay_hero(sort: number, x: number, z: number, foot: number, turn: number): number; bay_landmarks(on: number): void }

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
  names: { square: string; url: string; bytes?: number; sha256?: string }[]
  credits: string[] | null
  /** The release this page is pinned to, and its manifest's address (far.ts reads its `far` from it), or null under the page server. */
  release: string | null
  manifest: string | null
  /** Whether the release holds a far model (its manifest's `far`). */
  far: boolean
  /** Whether the manifest's hash was checked (crypto.subtle is only in secure contexts: https and localhost). */
  checked: boolean
  /** Whether the release lists a tile (its level, `tx_tz`): land it holds, not sea and not past its edge. Under the page server, never. */
  lists(level: number, key: string): boolean
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
    lists: (level, key) => !!levels[level]?.tiles[key],
    find: (level, key) => { const r = levels[level]?.tiles[key]; if (r) return { url: new URL(r.path, where).href, bytes: r.bytes, sha256: r.sha256, listed: true }; if (sea[level]?.has(key)) seaKeys++; else unlisted++; return null },
    names: Object.entries(manifest.names).map(([square, r]) => ({ square, url: new URL(r.path, where).href, bytes: r.bytes, sha256: r.sha256 })),
    credits: releaseCredits(at.release, manifest.credits),
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
    lists: () => false,
    find: (level, key) => ({ url: has[level].has(key) ? `${BASE}tiles/${level}/${key}.bay` : `${BASE}earth/${FRAME}/${level}/${key}.bay`, listed: false }),
    names: (BAKED ? i.squares : []).map((square) => ({ square, url: `${BASE}${square}.json` })),
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

/**
 * How much a device may hold (#450, #81): a phone's tab is killed long before a laptop's, and a tablet's (a touch
 * screen under 900 points on its short side, or a touch device that says it has 4 GB or less) in between. Read from
 * what the browser says: a worker, which has no screen, says desktop, and is told what to hold by its page.
 */
export function tierOf(d: { touch: number; short: number; memory?: number }): 'phone' | 'tablet' | 'desktop' {
  if (!(d.touch > 0)) return 'desktop'
  if (d.short < 600) return 'phone'
  return d.short < 900 || (d.memory !== undefined && d.memory <= 4) ? 'tablet' : 'desktop'
}
export const TIER = typeof navigator === 'undefined' ? 'desktop' : tierOf({ touch: navigator.maxTouchPoints ?? 0, short: Math.min(globalThis.screen?.width ?? 1e4, globalThis.screen?.height ?? 1e4), memory: (navigator as Navigator & { deviceMemory?: number }).deviceMemory })
/** The device class most of the page asks about: a tablet draws as a desktop does, and holds less (`HOLD`, `BUDGET`). */
export const DEVICE: 'phone' | 'desktop' = TIER === 'phone' ? 'phone' : 'desktop'
/**
 * What one device class may hold: tiles kept by each core, at each level, and tile bytes the page keeps for its
 * workers; the pool of the world's cells on the GPU (MiB), how many makers of sectors, and the far model's faces.
 */
export const BUDGETS = {
  phone: { keep: [12, 4, 4], bytes: 24 << 20, pool: 80, workers: 2, faces: 3_000_000 },
  tablet: { keep: [20, 8, 6], bytes: 48 << 20, pool: 192, workers: 3, faces: 6_000_000 },
  desktop: { keep: [28, 12, 8], bytes: 96 << 20, pool: 256, workers: 6, faces: 12_000_000 },
} as const
export const BUDGET = BUDGETS[TIER]
export const HOLD: { keep: number[]; bytes: number } = { keep: [...BUDGET.keep], bytes: BUDGET.bytes }

/** The tiles the page holds for its cores: each fetched once, the last wanted kept up to `HOLD.bytes`. */
const bytesHeld = new Map<string, { body: Promise<ArrayBuffer | null>; size: number; used: number; hits: number }>()
let heldTotal = 0, heldClock = 0
/** Street-lamp head positions `[x, y, z, ...]` (world cells) bucketed into 125 m spatial cells for O(9) lookup. */
const LAMP_CELL = 1250
const lampTiles = new Map<string, string[]>()
const lampBuckets = new Map<string, Map<string, Float32Array>>()
const LAMP_KIND = 15 | (46 << 8)
function evictLamps(name: string) {
  const keys = lampTiles.get(name)
  if (!keys) return
  lampTiles.delete(name)
  for (let i = 0; i < keys.length; i++) {
    const b = lampBuckets.get(keys[i])
    if (b) { b.delete(name); if (b.size === 0) lampBuckets.delete(keys[i]) }
  }
}
function extractLamps(name: string, body: ArrayBuffer | null) {
  if (!body || body.byteLength < 72 || lampTiles.has(name)) return
  const view = new DataView(body)
  if (view.getInt32(0, true) !== 0x31594142) return
  const gw = view.getInt32(20, true), tstep = view.getInt32(32, true), tw = tstep > 0 ? view.getInt32(36, true) : 0
  const nb = view.getInt32(48, true), nv = view.getInt32(52, true), nt = view.getInt32(56, true)
  const flags = view.getInt32(60, true)
  if (gw <= 1 || gw > 8192 || tw < 0 || tw > 8192 || nb < 0 || nv < 0 || nt < 0) return
  const samples = tw * tw, topBytes = samples * 2
  let from = 64 + gw * gw * 2 + topBytes + samples + samples + ((flags & 1) === 1 ? topBytes : 0) + nb * 24 + nv * 12 + nt * 16
  if (from + 8 > body.byteLength) return
  const b = new Uint8Array(body)
  if (b[from] !== 0x53 || b[from + 1] !== 0x46 || b[from + 2] !== 0x53 || b[from + 3] !== 0x54) return
  const n = view.getUint32(from + 4, true)
  if (from + 8 + n * 32 > body.byteLength) return
  const perCell = new Map<string, number[]>()
  for (let i = 0, o = from + 8; i < n; i++, o += 32) {
    if (view.getInt32(o + 28, true) !== LAMP_KIND) continue
    const x = (view.getInt32(o, true) + view.getInt32(o + 12, true)) * 0.5
    const y = (view.getInt32(o + 4, true) + view.getInt32(o + 16, true)) * 0.5
    const z = (view.getInt32(o + 8, true) + view.getInt32(o + 20, true)) * 0.5
    const ck = `${Math.floor(x / LAMP_CELL)}_${Math.floor(z / LAMP_CELL)}`
    let list = perCell.get(ck)
    if (!list) { list = []; perCell.set(ck, list) }
    list.push(x, y, z)
  }
  if (!perCell.size) return
  const touched: string[] = []
  for (const [ck, pts] of perCell) {
    touched.push(ck)
    let bucket = lampBuckets.get(ck)
    if (!bucket) { bucket = new Map(); lampBuckets.set(ck, bucket) }
    bucket.set(name, new Float32Array(pts))
  }
  lampTiles.set(name, touched)
}
const lampScratch: number[] = []
/** Nearby San Francisco street-lamp head positions `[x, y, z, ...]` (world cells) within `radius` of `(x, z)`. */
export function streetLamps(x: number, z: number, radius: number): readonly number[] {
  lampScratch.length = 0
  if (!lampBuckets.size) return lampScratch
  const r2 = radius * radius
  const gx0 = Math.floor((x - radius) / LAMP_CELL), gx1 = Math.floor((x + radius) / LAMP_CELL)
  const gz0 = Math.floor((z - radius) / LAMP_CELL), gz1 = Math.floor((z + radius) / LAMP_CELL)
  for (let gz = gz0; gz <= gz1; gz++) {
    for (let gx = gx0; gx <= gx1; gx++) {
      const bucket = lampBuckets.get(`${gx}_${gz}`)
      if (!bucket) continue
      for (const a of bucket.values()) {
        for (let i = 0; i < a.length; i += 3) {
          const lx = a[i], lz = a[i + 2]
          const dx = lx - x, dz = lz - z
          if (dx * dx + dz * dz > r2) continue
          let dup = false
          for (let j = 0; j < lampScratch.length; j += 3) {
            const ux = lampScratch[j] - lx, uz = lampScratch[j + 2] - lz
            if (ux * ux + uz * uz < 400) { dup = true; break }
          }
          if (!dup) lampScratch.push(lx, a[i + 1], lz)
        }
      }
    }
  }
  return lampScratch
}
/** What the page has done for its tiles, for the checks: requests, failures, retries, timeouts, and how many asks were answered from what it held. */
export const tally = { fetched: 0, failed: 0, retried: 0, timedOut: 0, shared: 0, water: 0, held: 0, bytes: 0 }
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
  const source = await where()
  // Publish the in-flight request in the same turn as the lookup, even when several workers arrive together.
  const name = `${level}/${key}`, had = bytesHeld.get(name)
  if (had) { had.used = ++heldClock; had.hits++; tally.shared++; return had.body }
  const found = source.find(level, key)
  if (!found) { tally.water++; return null }
  const entry = { body: fetchTile(found), size: 0, used: ++heldClock, hits: 1 }
  bytesHeld.set(name, entry)
  try {
    const body = await entry.body
    if (level === 0 && body) extractLamps(name, body)
    entry.size = body?.byteLength ?? 0; heldTotal += entry.size; tally.held = heldTotal
    // Let go of cold outer coarse tiles before hot neighborhood tiles while keeping actively shared inner coarse tiles.
    if (heldTotal > HOLD.bytes) {
      const score = (k: string, e: { used: number; hits: number }) => e.used + (k.startsWith('2/') ? Math.min(e.hits, 12) * 32 - 600 : Math.min(e.hits, 8) * 20)
      for (const [k, e] of [...bytesHeld].sort((a, b) => score(a[0], a[1]) - score(b[0], b[1]))) {
        if (heldTotal <= HOLD.bytes) break
        if (e === entry || !e.size) continue
        bytesHeld.delete(k); evictLamps(k); heldTotal -= e.size
      }
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
    const ac = typeof AbortController === 'function' ? new AbortController() : null
    let timedOut = false
    let onAbort: (() => void) | null = null
    const timer = ac && fetchTimeout > 0 && Number.isFinite(fetchTimeout)
      ? setTimeout(() => { timedOut = true; ac.abort(new Error('tile fetch timeout')) }, fetchTimeout)
      : null
    let answer: Response | null = null
    try {
      const req = get(found.url, ac ? { signal: ac.signal } : undefined)
      answer = await (ac
        ? Promise.race([req, new Promise<never>((_, rej) => { onAbort = () => rej(new Error('tile fetch timeout')); ac.signal.addEventListener('abort', onAbort, { once: true }) })])
        : req)
      // Under the page server a 404 or 204 is a place nobody made: sea. In a release a listed tile is never water.
      if (answer && !found.listed && (answer.status === 404 || answer.status === 204)) return null
      if (answer?.ok) {
        const read = answer.arrayBuffer()
        const body = await (ac
          ? Promise.race([read, new Promise<never>((_, rej) => { if (ac.signal.aborted) rej(new Error('tile fetch timeout')); else ac.signal.addEventListener('abort', () => rej(new Error('tile fetch timeout')), { once: true }) })])
          : read)
        if (!found.listed && !body.byteLength) return null
        // What the manifest says it is: a host that sends Brotli without saying so, or a file cut short, is caught here.
        if (found.bytes === undefined) { tally.bytes += body.byteLength; return body }
        const sum = found.sha256 ? await digest(body) : null
        if (body.byteLength === found.bytes && (!found.sha256 || (sum ?? found.sha256) === found.sha256)) { tally.bytes += body.byteLength; if (sum) passed(found.url, body); return body }
      }
    } catch {
      if (timedOut) tally.timedOut++
    } finally {
      if (timer !== null) clearTimeout(timer)
      if (ac && onAbort) ac.signal.removeEventListener('abort', onAbort)
    }
    if (again >= tries) { tally.failed++; throw new Error(`${new URL(found.url).pathname}: ${timedOut ? 'timeout' : answer ? answer.status : 'no answer'}`) }
    tally.retried++
    await pause(wait * 2 ** again)
  }
}

// ── A worker's side: it asks the page for tiles over a port the page gives it (`share`) ──
type Said = { id: number; body?: ArrayBuffer | null; error?: string }
let port: MessagePort | null = null, portCame: (p: MessagePort) => void = () => {}
const portReady = new Promise<MessagePort>((r) => (portCame = r))
let toldLevels: Level[] = LEVELS, toldKeep = HOLD.keep
let toldHeroes: Landmark[] | undefined, toldSquares: ArrayBuffer | null | undefined, toldKerbs: ArrayBuffer | null | undefined
const waiting = new Map<number, (s: Said) => void>()
let asks = 0
/** The cores this context opened: what they hold is reported to the page (`memory`). */
const opened: Core[] = []
if (typeof document === 'undefined' && typeof self !== 'undefined') {
  // The page's first message to a worker that streams the Bay. It is this module's alone: the worker's own handler
  // (worker.ts, mover.ts) never sees it, since this listener was added first, when this module was evaluated.
  self.addEventListener('message', (e: MessageEvent) => {
    const told = e.data as { tiles?: MessagePort; levels?: Level[]; keep?: number[]; heroes?: Landmark[]; squares?: ArrayBuffer | null; kerbs?: ArrayBuffer | null } | null
    if (!told?.tiles) return
    e.stopImmediatePropagation()
    port = told.tiles; toldLevels = told.levels ?? LEVELS; toldKeep = told.keep ?? HOLD.keep
    toldHeroes = told.heroes; toldSquares = told.squares; toldKerbs = told.kerbs
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
  const give = (levels: Level[], h: Landmark[], sq: ArrayBuffer | null, kb: ArrayBuffer | null) =>
    worker.postMessage({ tiles: port2, levels, keep: HOLD.keep, heroes: h, squares: sq, kerbs: kb }, [port2])
  // Hand levels, landmarks, marked squares and surveyed kerbs once from the page so workers never duplicate /bay/ fetches (#82).
  void Promise.all([
    STREAM ? where().then((s) => s.levels, () => LEVELS) : Promise.resolve(LEVELS),
    ON ? heroes() : Promise.resolve([]),
    ON && FRAME === '10n4250' ? markedSquares() : Promise.resolve(null),
    ON && FRAME === '10n4250' ? surveyedKerbs() : Promise.resolve(null),
  ]).then(([levels, h, sq, kb]) => give(levels, h, sq, kb))
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
  const [lines, kerbs] = await Promise.all([markedSquares(), surveyedKerbs()])
  if (lines) { const at = core.bay_room(lines.byteLength); new Uint8Array(core.memory.buffer, at, lines.byteLength).set(new Uint8Array(lines)); if (core.bay_marks() < 0) throw new Error('marks this core does not read') }
  if (kerbs && core.bay_kerbs) { const at = core.bay_room(kerbs.byteLength); new Uint8Array(core.memory.buffer, at, kerbs.byteLength).set(new Uint8Array(kerbs)); if (core.bay_kerbs() < 0) throw new Error('kerbs this core does not read') }
  for (const name of SQUARES) await take(core, await whole(`${BASE}${name}.bay`))
  return core as unknown as T
}

const fromBase64 = (b64: string): ArrayBuffer => {
  const bin = atob(b64), out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out.buffer
}
/** The landmarks a Bay world has (sf/heroes.json, embedded in LOCAL.bay or copied beside the tiles as heroes.json): where each stands. */
export interface Landmark { name: string; sort: number; at: [number, number]; toward: [number, number]; foot: number; /** `night`: only its light by night is by rule (heroes.rs `night`); its shape is the map's building. */ only?: 'night' }
let landmarks: Promise<Landmark[]> | null = null
export const heroes = () => (landmarks ??= (
  !ON ? Promise.resolve([])
    : Array.isArray(LOCAL?.bay?.heroes) ? Promise.resolve(LOCAL.bay.heroes as Landmark[])
      : !owns ? portReady.then(() => toldHeroes ?? fetch(`${BASE}heroes.json`).then((r) => (r.ok ? (r.json() as Promise<Landmark[]>) : [])).catch(() => []))
        : fetch(`${BASE}heroes.json`).then((r) => (r.ok ? (r.json() as Promise<Landmark[]>) : [])).catch(() => [])
))

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
const markedSquares = () => (squaring ??= (
  !(ON && FRAME === '10n4250') ? Promise.resolve(null)
    : typeof LOCAL?.bay?.marksSquares === 'string' ? Promise.resolve(fromBase64(LOCAL.bay.marksSquares))
      : !owns ? portReady.then(() => (toldSquares !== undefined ? toldSquares : markFile('marks-squares.bin', "this core keeps the bake's 50 cm paint")))
        : (async () => {
          for (let tries = 3; ; tries--) {
            const bytes = await markFile('marks-squares.bin', tries > 1 ? 'asking again' : "this core keeps the bake's 50 cm paint")
            if (bytes || tries <= 1 || !(ON && FRAME === '10n4250')) return bytes
            await new Promise((r) => setTimeout(r, 1000))
          }
        })()
))
/** Surveyed kerb polylines (kerbs.bin, sf/kerbs.mjs): loaded once on the page and shared with every core before it makes sectors (#150). */
let kerbing: Promise<ArrayBuffer | null> | null = null
const surveyedKerbs = () => (kerbing ??= (
  !(ON && FRAME === '10n4250') ? Promise.resolve(null)
    : !owns ? portReady.then(() => (toldKerbs !== undefined ? toldKerbs : markFile('kerbs.bin', "sidewalks keep the bake's 50 cm raster")))
      : (async () => {
        for (let tries = 3; ; tries--) {
          const bytes = await markFile('kerbs.bin', tries > 1 ? 'asking again' : "sidewalks keep the bake's 50 cm raster")
          if (bytes || tries <= 1 || !(ON && FRAME === '10n4250')) return bytes
          await new Promise((r) => setTimeout(r, 1000))
        }
      })()
))
/**
 * The marks themselves (marks.bin, 1.5 MB, 0.4 MB as Brotli), for the march (marks.ts): asked for once the place is
 * shown round the eye (main.ts), not before, so they cost the first picture nothing. The cores have stopped drawing
 * the bake's paint by then, so until they come the roads are bare; one that failed is asked for again on the next call.
 */
export const marks = () => markFile('marks.bin', 'the roads are bare asphalt until they come')
/** The 3D minimap and road navigation graph (map.bin, sf/map.mjs): fetched lazily once the visitor engages so cold load stays lean. */
export const mapData = () => markFile('map.bin', 'the 3D minimap and GPS map are unavailable until loaded')
/** Neighborhood storefronts, GTA-style parody brands, and civic plazas (places.json, sf/places.mjs): fetched lazily once after first view. */
let placesCache: Promise<ArrayBuffer | null> | null = null
export const placesData = () => (placesCache ??= markFile('places.json', 'neighborhood storefronts and plazas are unavailable until loaded').then((buf) => {
  if (!buf) placesCache = null
  return buf
}))

/** A square held whole (`?bay=a,b`), from the page server. */
async function whole(url: string): Promise<ArrayBuffer | null> {
  let answer = await fetch(url)
  for (let again = 0; again < 3 && !answer.ok && answer.status !== 404; again++) { await pause(1500 * (again + 1)); answer = await fetch(url) }
  if (answer.status === 204 || answer.status === 404) return null
  if (!answer.ok) throw new Error(`${url}: ${answer.status}`)
  const body = await answer.arrayBuffer()
  extractLamps(url, body)
  return body
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
export async function need(core: object, x0: number, z0: number, x1: number, z1: number, cell: number, within?: number): Promise<boolean> {
  return (await ground(core, x0, z0, x1, z1, cell, within)) === null
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
 * what is still on its way is given up on for now (it rests until it comes or fails), and it says `slow`. With `pins`,
 * every tile it waited on stays waited on (never let go) after it resolves, until `unpin`: what was asked is done on
 * the ground it waited for, however long it then waits its turn.
 */
export async function ground(core: object, x0: number, z0: number, x1: number, z1: number, cell: number, within?: number, pins?: object[]): Promise<Unheld | null> {
  if (!STREAM) return null
  const levels = owns ? (await where()).levels : toldLevels, keep = owns ? HOLD.keep : toldKeep
  const level = cell <= 8 ? 0 : cell <= 16 ? 1 : 2, { size, gstep } = levels[level]
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
    // No more than a core may hold beyond its own ground: the least lately wanted that nothing waits on and that is
    // nobody's own makes room, or nothing is asked for.
    if (!t && !own.get(core)?.has(key) && spare(core, mine) >= most && !roomIn(core, mine, stamp)) { why ??= 'full'; continue }
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
  } finally { if (pins) pins.push(...wanted); else unpin(wanted) }
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
/** Tiles `ground` was given `pins` for are waited on no longer. */
export const unpin = (pins: object[]) => { for (const t of pins as Held[]) t.waiters = (t.waiters ?? 1) - 1 }
/** How many tiles a core holds (or is waiting for) that are not its own ground. */
const spare = (core: object, mine: Map<string, Held>) => { const keys = own.get(core); let n = 0; for (const key of mine.keys()) if (!keys?.has(key)) n++; return n }
/**
 * Whether a tile may be let go: nothing waits on it and it is nobody's own ground. One still on its way that nothing
 * waits on was given up on (`within`), so it rests (`resting`, Infinity) and is not asked for again until it has come:
 * let go, it is dropped from the core as it comes, and no newer ask of the same tile can have taken it meanwhile.
 */
const free = (core: object, key: string, t: Held) => !t.waiters && !own.get(core)?.has(key)
/** Lets go of a tile: from the core once it has come. */
const letGo = (core: object, mine: Map<string, Held>, key: string, t: Held) => { mine.delete(key); void t.came.then((took) => took && (core as Core).bay_drop(t.x0, t.z0, (toldLevels[t.level] ?? LEVELS[t.level]).gstep)) }
/** Makes room for one more tile in a core that holds `most` beyond its own: lets go of the least lately wanted that has come, may be let go, and nobody wanted in the last two seconds. */
function roomIn(core: object, mine: Map<string, Held>, stamp: number): boolean {
  const now = Date.now()
  let oldest: [string, Held] | null = null
  for (const e of mine) if (free(core, e[0], e[1]) && e[1].used < stamp && now - e[1].seen > 2000 && (!oldest || e[1].seen < oldest[1].seen)) oldest = e
  if (!oldest) return false
  letGo(core, mine, ...oldest)
  return true
}
/** Whether a core holds, now, every tile a box needs (has come, as a pack or as water): what is answered there is the place's. Counts as wanting them. */
export function holds(core: object, x0: number, z0: number, x1: number, z1: number, cell: number): boolean {
  if (!STREAM) return true
  const mine = held.get(core), level = cell <= 8 ? 0 : cell <= 16 ? 1 : 2, size = (toldLevels[level] ?? LEVELS[level]).size, now = Date.now()
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
  if (mine) for (const [key, t] of [...mine]) if (t.seen < before && free(core, key, t)) { letGo(core, mine, key, t); n++ }
  return n
}
/** How many finest tiles are a core's own ground (`owning`), and how many it holds beyond them. */
export const shares = (core: object): { own: number; spare: number } => ({ own: own.get(core)?.size ?? 0, spare: spare(core, held.get(core) ?? new Map()) })
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
export async function hold(o: { pointer: string; read: typeof get; passed?: (url: string, body: ArrayBuffer) => void; heroes: Landmark[]; squares: ArrayBuffer | null; kerbs?: ArrayBuffer | null; taken?: (core: object, x0: number, z0: number, size: number) => void; most?: number }): Promise<Source> {
  get = o.read; passed = o.passed ?? passed; owns = true; taken = o.taken ?? taken; most = o.most ?? most
  asked = '1'; STREAM = true; ON = true
  Object.assign(HOLD, { keep: [Infinity, Infinity, Infinity], bytes: 0 })
  // A tile is asked for once, and one that does not come rests before it is asked for again (longer each time): the
  // world answers nothing about that place meanwhile, and nobody waits on it (world.mjs).
  tries = 0; wait = 250; rest = 5000
  landmarks = Promise.resolve(o.heroes)
  squaring = Promise.resolve(o.squares)
  kerbing = Promise.resolve(o.kerbs ?? null)
  source = released(new URL(o.pointer))
  const s = await source
  toldLevels = s.levels
  return s
}

/** Whether the release lists the finest tile at a column (cells), for a place a stranger names (#526, arrival.ts): read once the release is. */
export async function lists(): Promise<(x: number, z: number) => boolean> {
  const s = await where(), size = s.levels[0].size
  return (x, z) => s.lists(0, `${Math.floor(x / size)}_${Math.floor(z / size)}`)
}

/** Has a core that is asked about the world round someone hold it: every cell near, coarser the further out. */
export const near = (core: object, x: number, z: number, within?: number): Promise<boolean> => Promise.all([need(core, x - 2000, z - 2000, x + 2000, z + 2000, 1, within), need(core, x - 4000, z - 4000, x + 4000, z + 4000, 16, within), need(core, x - 8000, z - 8000, x + 8000, z + 8000, 32, within)]).then((w) => w.every(Boolean))

/** What the page says of a square: its streets by name and its addresses, in cells. */
export interface Names { square: string; at: [number, number, number]; names: string[]; ways: { name: number; line: [number, number][] }[]; addresses: [number, number, number, string][]; credit: string }
const squareBox = (square: string): [number, number, number, number] | null => {
  const [e, n] = square.split('_').map(Number)
  if (!Number.isFinite(e) || !Number.isFinite(n)) return null
  const x0 = Math.round((e * 1000 - 500000) * 10), z1 = Math.round((4250000 - n * 1000) * 10)
  return [x0, z1 - 10000, x0 + 10000, z1]
}
const nearBox = (box: readonly [number, number, number, number] | null, x: number, z: number, margin: number): boolean =>
  !box || (x >= box[0] - margin && x <= box[2] + margin && z >= box[1] - margin && z <= box[3] + margin)
const namedCache = new Map<string, Promise<Names | null>>()
const loadNames = (url: string, square?: string, manifestUrl?: string | null): Promise<Names | null> => {
  let p = namedCache.get(url)
  if (!p) {
    const packKm = PACKS_ENABLED && manifestUrl ? LOCAL?.packs?.names : undefined
    const packName = packKm && square ? squarePackName('names', square, packKm) : null
    const packUrl = packName && manifestUrl ? new URL(`${LOCAL!.packs!.dir ?? 'packs/'}${packName}`, manifestUrl).href : null
    p = (packUrl ? readPackedJson<Names>(packUrl, `names/${square}.json`) : Promise.resolve(null))
      .then((packed) => packed ?? fetch(url).then((r) => (r.ok ? (r.json() as Promise<Names>) : null), () => null))
    namedCache.set(url, p)
  }
  return p
}
export const names = async (nearAt?: readonly [number, number], margin = 1200): Promise<Names[]> => {
  const src = STREAM ? await where() : null
  const entries = src ? src.names : SQUARES.map((square) => ({ square, url: `${BASE}${square}.json` }))
  const wanted = nearAt ? entries.filter((e) => nearBox(squareBox(e.square), nearAt[0], nearAt[1], margin)) : entries
  return (await Promise.all(wanted.map((e) => loadNames(e.url, e.square, src?.manifest)))).filter((n): n is Names => !!n)
}

/** How many squares' names `whereabouts` keeps (#81): the nearest; a drive across the city does not hold all 155. */
export const NAMES_KEPT = 32
/**
 * Lets the squares furthest from (x, z) go once more than `NAMES_KEPT` are held, never one the eye is near (the
 * margin `whereabouts` fetches by): `gone` is told each one's square and address, to forget it was asked.
 */
export function forgetFar<T extends { box: readonly [number, number, number, number] | null }>(held: Map<string, T>, x: number, z: number, gone: (square: string, url: string) => void, entries: readonly { square: string; url: string }[], most = NAMES_KEPT): void {
  if (held.size <= most) return
  const far = (b: T['box']) => (b ? Math.hypot(Math.max(b[0] - x, 0, x - b[2]), Math.max(b[1] - z, 0, z - b[3])) : 0)
  const order = [...held].filter(([, v]) => !nearBox(v.box, x, z, 600)).sort((a, b) => far(b[1].box) - far(a[1].box))
  for (const [square] of order) {
    if (held.size <= most) break
    held.delete(square)
    gone(square, entries.find((e) => e.square === square)?.url ?? '')
  }
}

/**
 * Where one is, said as a map would: the street underfoot and the nearest address, bottom left, with whose data the
 * place is made from. `at` is the eye's place in cells. Nothing here says who lives anywhere: the data does not.
 */
export async function whereabouts(at: () => [number, number], /** Whose else the place is made from (the far model's, far.ts). */ more: readonly string[] = [], /** Who shows the credits instead of the line under the street's name (first.ts): given each, said once. */ said?: (credits: string[]) => void): Promise<void> {
  const src = STREAM ? await where() : null
  const entries = (src ? src.names : SQUARES.map((square) => ({ square, url: `${BASE}${square}.json` }))).map((e) => ({ ...e, box: squareBox(e.square) }))
  const label = document.createElement('div')
  label.id = 'where'
  label.style.cssText = 'position:fixed;left:16px;bottom:14px;font:600 15px system-ui,sans-serif;color:#fff;text-shadow:0 1px 3px #000c;pointer-events:none;z-index:5'
  const credit = document.createElement('div')
  credit.style.cssText = 'font:400 10px system-ui,sans-serif;opacity:.75;margin-top:2px'
  const line = document.createElement('div')
  label.append(line, ...(said ? [] : [credit]))
  document.body.append(label)
  // Loaded lazily per square round the eye (155 squares citywide: never fetch them all at start).
  const loaded = new Map<string, { data: Names; box: [number, number, number, number] | null; near: Map<string, Names['addresses']> }>()
  const asked = new Set<string>()
  const ensure = (x: number, z: number): Promise<unknown>[] => {
    const coming: Promise<unknown>[] = []
    for (const e of entries) {
      if (asked.has(e.square) || !nearBox(e.box, x, z, 600)) continue
      asked.add(e.square)
      coming.push(loadNames(e.url, e.square, src?.manifest).then((data) => {
        if (!data) { asked.delete(e.square); return }
        const near = new Map<string, Names['addresses']>()
        for (const a of data.addresses) { const key = `${a[0] >> 8},${a[1] >> 8}`; const list = near.get(key); if (list) list.push(a); else near.set(key, [a]) }
        loaded.set(e.square, { data, box: e.box, near })
      }))
    }
    return coming
  }
  const initial = at()
  const firstBatch = ensure(initial[0], initial[1])
  // Who the place is made from: the release's credits where there is one (they name every source in it), else the
  // initial square's and the planet's; with whose else the place is made from (`more`), each said once.
  const credits = src?.credits ?? null
  if (!credits && firstBatch.length) await Promise.all(firstBatch)
  const fallbackCredits = credits ?? [...[...loaded.values()].map((s) => s.data.credit), ...(STREAM ? ['© OpenStreetMap contributors, Overture Maps Foundation; terrain: Mapterhorn'] : [])]
  const each = [...new Set([...fallbackCredits, ...more].flatMap((c) => c.split('; ')))].filter(Boolean)
  if (said) said(each); else credit.textContent = each.join('; ')
  const update = () => {
    const [x, z] = at()
    ensure(x, z)
    forgetFar(loaded, x, z, (square, url) => { asked.delete(square); namedCache.delete(url) }, entries)
    let street = '', least = 400 ** 2
    let address: Names['addresses'][number] | null = null, best = 300 ** 2
    for (const s of loaded.values()) {
      if (!nearBox(s.box, x, z, 600)) continue
      for (const w of s.data.ways) for (let i = 1; i < w.line.length; i++) {
        const [ax, az] = w.line[i - 1], [bx, bz] = w.line[i], dx = bx - ax, dz = bz - az
        const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1))), far = (x - ax - dx * t) ** 2 + (z - az - dz * t) ** 2
        if (far < least) { least = far; street = s.data.names[w.name] }
      }
      for (let pz = (z >> 8) - 1; pz <= (z >> 8) + 1; pz++) for (let px = (x >> 8) - 1; px <= (x >> 8) + 1; px++) for (const a of s.near.get(`${px},${pz}`) ?? []) {
        const far = (a[0] - x) ** 2 + (a[1] - z) ** 2
        if (far < best) { best = far; address = a }
      }
    }
    const neat = (s: string) => s.replace(/\b0?(\d+)(St|Nd|Rd|Th)\b/g, (_, n: string, suf: string) => n + suf.toLowerCase())
    line.textContent = [street, address ? `${address[2]} ${address[3]}` : ''].filter(Boolean).map(neat).join(' · ')
  }
  void Promise.all(firstBatch).then(update)
  setInterval(update, 500)
}
