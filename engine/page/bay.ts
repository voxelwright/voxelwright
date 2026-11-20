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

/** Which tiles there are: a level's tiles are `size` cells a side with a ground sample every `gstep`; `squares` are the baked squares they were cut from (their names and addresses). */
interface Index { levels: { size: number; gstep: number }[]; tiles: [number, number][][]; squares: string[] }
let index: Promise<{ levels: Index['levels']; has: Set<string>[]; squares: string[] }> | null = null
// Nothing baked on this machine: every tile is the planet's.
const LEVELS = [{ size: 2500, gstep: 10 }, { size: 10000, gstep: 20 }, { size: 40000, gstep: 160 }]
const tiles = () => (index ??= fetch(`${BASE}tiles/index.json`).then(async (r) => { const i = (r.ok ? await r.json() : { levels: LEVELS, tiles: [[], [], []], squares: [] }) as Index; return { levels: i.levels, has: i.tiles.map((l) => new Set(BAKED ? l.map(([x, z]) => `${x}_${z}`) : [])), squares: BAKED ? i.squares : [] } }))

/** A core from its address, holding the Bay's packs where the page asked for the Bay. */
export async function open<T>(url: string): Promise<T> {
  const core = (await WebAssembly.instantiateStreaming(fetch(url), {})).instance.exports as unknown as Core
  if (STREAM) core.bay_begin()
  for (const name of SQUARES) await take(core, `${BASE}${name}.bay`)
  return core as unknown as T
}

/** Has a core take the pack at an address. False where there is none to take: a tile that is all sea. */
async function take(core: Core, url: string): Promise<boolean> {
  // A tile being made can fail (the map's host did not answer): asked again a few times before giving up.
  // None at all (404): a static folder holds only the tiles it was given, and a place it lacks is sea, asked once.
  let answer = await fetch(url)
  for (let again = 0; again < 3 && !answer.ok && answer.status !== 404; again++) { await new Promise((r) => setTimeout(r, 1500 * (again + 1))); answer = await fetch(url) }
  if (answer.status === 204 || answer.status === 404) return false
  if (!answer.ok) throw new Error(`${url}: ${answer.status}`)
  const bytes = new Uint8Array(await answer.arrayBuffer())
  // An empty file is a tile that is all sea, as the page server's 204 is.
  if (!bytes.length) return false
  // The core's memory moves when it grows: ask for the room first, then look at the memory.
  const at = core.bay_room(bytes.length)
  new Uint8Array(core.memory.buffer, at, bytes.length).set(bytes)
  if (core.bay_load() < 0) throw new Error(`${url} is not a pack this core reads`)
  return true
}

/** What each core holds: a tile by level and place, when it was last wanted, and its coming. */
const held = new WeakMap<object, Map<string, { level: number; x0: number; z0: number; used: number; came: Promise<boolean> }>>()
/** How many tiles of each level a core keeps: a few more than one ask can want. */
const KEEP = [24, 8, 8]
let clock = 0

/**
 * Has a core hold the tiles that know the cells from (x0, z0) to (x1, z1), for making or asking in cells `cell`
 * wide (the core picks a pack by the same rule: bay.rs `least_step`), and lets go of those longest unwanted.
 * Until it resolves the core answers water there. A place no tile knows stays water.
 */
export async function need(core: object, x0: number, z0: number, x1: number, z1: number, cell: number): Promise<void> {
  if (!STREAM) return
  const { levels, has } = await tiles(), level = cell <= 8 ? 0 : cell <= 64 ? 1 : 2, { size, gstep } = levels[level]
  // What stands just past a sector's edge shapes it: a crown's trunk, a bay window's wall.
  const reach = level ? 0 : 96
  let mine = held.get(core)
  if (!mine) held.set(core, (mine = new Map()))
  const coming: Promise<boolean>[] = [], stamp = ++clock
  for (let tz = Math.floor((z0 - reach) / size); tz <= Math.floor((z1 - 1 + reach) / size); tz++) for (let tx = Math.floor((x0 - reach) / size); tx <= Math.floor((x1 - 1 + reach) / size); tx++) {
    // What is baked from lidar where there is any; else the tile made from the planet's data, the first time on asking.
    const key = `${level}/${tx}_${tz}`, url = has[level].has(`${tx}_${tz}`) ? `${BASE}tiles/${key}.bay` : `${BASE}earth/${FRAME}/${key}.bay`
    let tile = mine.get(key)
    if (!tile) mine.set(key, (tile = { level, x0: tx * size, z0: tz * size, used: stamp, came: take(core as Core, url).catch(() => { mine!.delete(key); return false }) }))
    tile.used = stamp
    coming.push(tile.came)
  }
  await Promise.all(coming)
  // Let go of the longest unwanted of this level, never one wanted since this ask began.
  const same = [...mine].filter(([, t]) => t.level === level && t.used < stamp).sort((a, b) => a[1].used - b[1].used)
  for (let over = [...mine.values()].filter((t) => t.level === level).length - KEEP[level]; over > 0 && same.length; over--) {
    const [key, t] = same.shift()!
    mine.delete(key)
    void t.came.then((taken) => taken && (core as Core).bay_drop(t.x0, t.z0, gstep))
  }
}

/** Has a core that is asked about the world round someone hold it: every cell near, coarser the further out. */
export const near = (core: object, x: number, z: number): Promise<void> => Promise.all([need(core, x - 2000, z - 2000, x + 2000, z + 2000, 1), need(core, x - 12000, z - 12000, x + 12000, z + 12000, 16), need(core, x - 50000, z - 50000, x + 50000, z + 50000, 128)]).then(() => {})

/** What the page says of a square: its streets by name and its addresses, in cells. */
export interface Names { square: string; at: [number, number, number]; names: string[]; ways: { name: number; line: [number, number][] }[]; addresses: [number, number, number, string][]; credit: string }
export const names = async (): Promise<Names[]> => Promise.all((STREAM ? (await tiles()).squares : SQUARES).map(async (name) => (await fetch(`${BASE}${name}.json`)).json() as Promise<Names>))

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
  credit.textContent = [...new Set(squares.map((s) => s.credit)), ...(STREAM ? ['© OpenStreetMap contributors, Overture Maps Foundation; terrain: Mapterhorn'] : [])].join('; ')
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
