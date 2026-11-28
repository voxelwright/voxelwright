// Where a made thing goes (#220): where it can stand near a place, and its rows there. The world is handed in (a
// world's server by its address, make/served.mjs; or a page's own world, page/maker.ts): what is under a footprint is
// asked of it (`world.tops`). Nothing here talks to anything.
import { FACINGS, ROWS_MOST, footprint, rows } from './form.mjs'
import { bounds } from './qa-probes.mjs'
export { bounds, probeMadeRows as probePlacement } from './qa-probes.mjs'
import { compiled } from './core.mjs'

/** How uneven the ground under a thing's feet may be, and how far above or below the middle of its place anything may stand in its footprint, in cells. */
const STEEP = 8, CLEAR = 6

/**
 * Finds where a thing can stand near a place, or says why it cannot. `spot` is the cell looked at ([x, y, z], its
 * top is where the thing stands) and `back` a step ([dx, dz]) towards whoever asked: if the place is taken, places
 * near it are tried, that way first, out to eight metres. Returns { origin: [x, base, z], rows, moved } with the thing's rows there, feet carried down to the ground.
 * `clear`: it stands at the place itself whatever is there.
 */
export async function site(world, thing, spot, facing, back = [0, 0], { clear = false, most = ROWS_MOST, level = false } = {}) {
  // Asked to clear the place: it stands where it was put, level, whatever is there now (the caller empties its box first).
  if (clear) {
    const made = rows(thing, [spot[0], spot[1] + 1, spot[2]], facing)
    if (made.length > most) throw Object.assign(new Error(`it comes to ${made.length} runs and the most is ${most}: fewer separate pieces, wider bands, or smaller`), { form: true })
    return { origin: [spot[0], spot[1] + 1, spot[2]], rows: made, moved: 0 }
  }
  // A big thing takes more of a slope under it: its feet are carried down to the ground wherever they are.
  const steep = Math.max(STEEP, Math.ceil(Math.max(thing.size[0], thing.size[2]) / 6))
  let why = ''
  // The place itself, then a little nearer whoever asked, then to either side and behind: first within two metres,
  // then on out to eight. A thing asked for is put as near as it can stand, not given up.
  const [bx, bz] = back[0] || back[1] ? back : [0, 1], near = [[0, 0]]
  for (let n = 1; n <= 20; n++) { near.push([bx * n, bz * n], [bz * n, -bx * n], [-bz * n, bx * n]); if (n > 5) near.push([-bx * n, -bz * n], [bx * n + bz * n, bz * n - bx * n], [bx * n - bz * n, bz * n + bx * n]) }
  for (const [ox, oz] of near) {
    const x = spot[0] + ox * 4, z = spot[2] + oz * 4
    const columns = footprint(thing, [x, z], facing), top = spot[1] + thing.size[1] + CLEAR + 2
    // What is under it: one question for the rectangle its footprint lies in.
    const xs = columns.map((c) => c.x), zs = columns.map((c) => c.z), x0 = Math.min(...xs), z0 = Math.min(...zs), wide = Math.max(...xs) - x0 + 1
    const under = await world.tops([x0, z0, x0 + wide, Math.max(...zs) + 1], top)
    const met = columns.map((c) => { const i = (c.z - z0) * wide + (c.x - x0); return { at: under.high[i] === null ? null : [c.x, under.high[i], c.z], material: under.material[i] } })
    const high = met.map((m) => (m.at ? m.at[1] : -Infinity))
    const taken = columns.filter((c, i) => high[i] > spot[1] + CLEAR + steep - STEEP).length, gone = columns.filter((c, i) => high[i] < spot[1] - steep - CLEAR).length
    const wet = met.some((m) => m.material === 5)
    if (taken) { why = `something already stands there (${taken} of its ${columns.length} columns are taken)`; continue }
    if (gone || wet) { why = wet ? 'that is water' : 'the ground falls away there'; continue }
    const feet = new Map(columns.map((c, i) => [`${c.x},${c.z}`, high[i]]))
    const stood = columns.map((c, i) => (c.foot ? high[i] : null)).filter((v) => v !== null)
    // `level` (a thing of cells finer than the world's, whose feet cannot be carried down in cells of 10 cm): it stands at the height most
    // of the ground under its feet is, nothing carried down, and not where something under a foot stands higher.
    const base = (level ? [...stood].sort((p, q) => p - q)[stood.length >> 1] : Math.max(...stood)) + 1
    if (level && Math.max(...stood) > base + 1) { why = 'something already stands there'; continue }
    if (base - 1 - Math.min(...stood) > steep * 2) { why = 'the ground is too steep there'; continue }
    const made = rows(thing, [x, base, z], facing, level ? undefined : (cx, cz) => feet.get(`${cx},${cz}`) ?? base - 1)
    if (made.length > most) throw Object.assign(new Error(`it comes to ${made.length} runs and the most is ${most}: fewer separate pieces, wider bands, or smaller`), { form: true })
    // `moved`: how far from the place asked for it stands, in cells. `flat`: every foot is on ground one cell under it, nothing carried down, nothing over a hollow.
    return { origin: [x, base, z], rows: made, moved: Math.round(Math.hypot(ox, oz) * 4), flat: stood.every((v) => v === base - 1) }
  }
  throw Object.assign(new Error(why), { place: true })
}

/** The cells of a thing's box at its place, emptied: edits of rows of air, each small enough to be one ask. What stood there is gone; what stood on it falls by the world's own rule. */
export function emptied(made) {
  const [lo, hi] = bounds(made), out = []
  let now = []
  for (let y = lo[1]; y <= hi[1]; y++) for (let z = lo[2]; z <= hi[2]; z++) { now.push([lo[0], hi[0] + 1, y, z, 0]); if (now.length === 3000) { out.push(now); now = [] } }
  if (now.length) out.push(now)
  return out
}

/** Which way a thing at a place faces to face an eye. */
export function towards([x, , z], eye) {
  const dx = eye[0] - x, dz = eye[2] - z
  return Math.abs(dx) > Math.abs(dz) ? (dx > 0 ? 'east' : 'west') : dz > 0 ? 'south' : 'north'
}
/** One cell's step from a thing out of its front. */
export const outOf = (facing) => { const [, xz, , zz] = FACINGS[facing]; return [-xz, -zz] }

/** The rows as an edit (page/edits.ts), and with every row emptied: the same edit undone. */
export const edit = (made, kind, grain = 1) => { const out = [grain === 4 ? 3 : grain === 8 ? 4 : 1, made.length]; for (const r of made) out.push(r[0], r[1], r[2], r[3], kind === undefined ? r[4] : kind); return out }
export const middle = (made) => { const [lo, hi] = bounds(made); return lo.map((v, k) => Math.round((v + hi[k]) / 2)) }
/**
 * Where the world is asked what an edit left unheld: a cell of air beside the thing, never one of its own. The
 * core's box round that place is 16 m across and reaches 4.8 m below it, so it holds the thing. A place inside a
 * thing of steel, glass or lamp is, to the core, a blast in it: such a thing comes adrift whole (support.rs `adrift`).
 */
export const beside = (made) => { const [lo, hi] = bounds(made); return [hi[0] + 1, Math.min(Math.round((lo[1] + hi[1]) / 2), lo[1] + 40), Math.round((lo[2] + hi[2]) / 2)] }

/**
 * Would it stand? Which of its rows would not: none if it would. The core's own rule, asked of a core of the maker's own before anything is sent: the edit is
 * put into a world as the rules make it and what it leaves unheld is counted. (That world has nobody's changes
 * in it: a thing stood on something another person built is judged as if it stood on air there.) `core` is the core
 * (core.mjs `compiled` takes it), or a function that gives a fresh core ready for the rows (a page's own,
 * page/maker.ts: one holding the city's tiles round them, as the page's world is made from them).
 */
export async function stands(core, made) {
  const c = typeof core === 'function' ? await core(made) : new WebAssembly.Instance(await compiled(core), {}).exports, words = edit(made), mid = beside(made)
  const room = c.edits_room(words.length)
  new Int32Array(c.memory.buffer, room, words.length).set(words)
  c.world_edit(-1)
  c.bodies_release(mid[0], mid[1], mid[2], 0)
  if (c.bodies_count() === 0) return []
  // Which rows are no longer where they were put.
  return made.map((r, i) => (c.world_kind(r[0], r[2], r[3]) === r[4] ? -1 : i)).filter((i) => i >= 0)
}

/** Up to `most` of a thing's cells, spread through it, as [x, y, z, kind]. */
export const samples = (made, most = 24) => made.filter((_, i) => i % Math.ceil(made.length / most) === 0).map((r) => [r[0], r[2], r[3], r[4]])
