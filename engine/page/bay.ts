// The Bay Area from data (#373): `?bay=1` makes the world the real place in place of the town, from the packs the
// page server holds (`/bay/<square>.bay`, baked by engine/bay/bake.py; the core's bay.rs reads them). Every core
// that makes or asks about the world (this page's, each maker of sectors, the mover) must hold the same packs
// before it is asked anything, so each opens its core through `open`.

/** The squares baked so far: what `?bay=1` means. `?bay=a,b` names others. */
const FIRST = ['551.7_4183.5', '550.7_4183.5']
const query = new URLSearchParams(globalThis.location?.search ?? '')
// A shared world or a realm is kept by the world's process (world.mjs), which holds no packs yet: there the page
// stays with the town, or it would draw one world and walk in another.
const asked = query.has('shared') || query.has('realm') ? null : query.get('bay')
/** The squares this page's world is made from; none when the world is the town's. */
export const SQUARES: readonly string[] = !asked || asked === '0' ? [] : asked === '1' ? FIRST : asked.split(',').filter((name) => /^[0-9._]+$/.test(name))
/** What a worker's address ends in, so that it opens its core as this page does. */
export const BAY = SQUARES.length ? `?bay=${SQUARES.join(',')}` : ''

interface Core { memory: WebAssembly.Memory; bay_room(bytes: number): number; bay_load(): number }

/** A core from its address, holding the Bay's packs where the page asked for the Bay. */
export async function open<T>(url: string): Promise<T> {
  const core = (await WebAssembly.instantiateStreaming(fetch(url), {})).instance.exports as unknown as Core
  for (const name of SQUARES) {
    const bytes = new Uint8Array(await (await fetch(`/bay/${name}.bay`)).arrayBuffer())
    // The core's memory moves when it grows: ask for the room first, then look at the memory.
    const at = core.bay_room(bytes.length)
    new Uint8Array(core.memory.buffer, at, bytes.length).set(bytes)
    if (core.bay_load() < 0) throw new Error(`the Bay's square ${name} is not a pack this core reads`)
  }
  return core as unknown as T
}

/** What the page says of a square: its streets by name and its addresses, in cells. */
export interface Names { square: string; at: [number, number, number]; names: string[]; ways: { name: number; line: [number, number][] }[]; addresses: [number, number, number, string][]; credit: string }
export const names = async (): Promise<Names[]> => Promise.all(SQUARES.map(async (name) => (await fetch(`/bay/${name}.json`)).json() as Promise<Names>))

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
  credit.textContent = [...new Set(squares.map((s) => s.credit))].join('; ')
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
