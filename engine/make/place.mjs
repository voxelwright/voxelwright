// Where a made thing goes and how it gets there (#220). The maker is a client of a shared world like any other:
// it asks what is where (`/world/look`, `/world/at`) and sends the thing as one edit (`POST /world/ask`), which
// the world takes whole or refuses whole. Nothing here is on the server.
import { readFile } from 'node:fs/promises'
import { FACINGS, ROWS_MOST, footprint, rows } from './form.mjs'

const json = async (res) => { if (!res.ok) throw new Error(`the world said ${res.status}: ${(await res.text()).slice(0, 120)}`); return res.json() }
export const at = (world, [x, y, z]) => fetch(`${world}/world/at?x=${x}&y=${y}&z=${z}`).then(json)
/** The first thing down every column of a rectangle, looked for from height `y`: { high, material }, a row of x for each z. */
export async function tops(world, [x0, z0, x1, z1], y) {
  // The world gives so many columns a second to everyone together: told to wait, this waits and asks again.
  for (let tries = 0; ; tries++) {
    const res = await fetch(`${world}/world/tops?x0=${x0}&z0=${z0}&x1=${x1}&z1=${z1}&y=${y}`)
    if (res.status !== 429 || tries === 40) return json(res)
    await new Promise((r) => setTimeout(r, 300))
  }
}
export const look = (world, [x, y, z], [dx, dy, dz]) => fetch(`${world}/world/look?x=${x}&y=${y}&z=${z}&dx=${dx}&dy=${dy}&dz=${dz}`).then(json)

/** Many questions, a few at a time. */
async function all(items, ask, together = 24) {
  const out = new Array(items.length)
  let next = 0
  await Promise.all(Array.from({ length: together }, async () => { while (next < items.length) { const i = next++; out[i] = await ask(items[i]) } }))
  return out
}

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
    const under = await tops(world, [x0, z0, x0 + wide, Math.max(...zs) + 1], top)
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
const bounds = (made) => { const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity]; for (const r of made) [[r[0], r[1] - 1], [r[2], r[2]], [r[3], r[3]]].forEach(([a, b], k) => { lo[k] = Math.min(lo[k], a); hi[k] = Math.max(hi[k], b) }); return [lo, hi] }
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
 * in it: a thing stood on something another person built is judged as if it stood on air there.)
 */
export async function stands(core, made) {
  const { instance } = await WebAssembly.instantiate(await readFile(core), {})
  const c = instance.exports, words = edit(made), mid = beside(made)
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

/** How many of the sampled cells are what they should be. */
export async function counted(world, cells, kind) {
  const found = await all(cells, (c) => at(world, c))
  // A cell asked after as -1 is one that only has to hold something (a cell of finer cells has no one kind).
  return found.filter((f, i) => { const want = kind ?? cells[i][3]; return want === -1 ? f.material !== 0 : f.kind === want }).length
}

/**
 * Sends the thing: one ask. Resolves to 'there' once the world's own cells are the thing's and stay so, 'fell'
 * if they were and then were not, 'not there' if they never were, and 'unknown' if the world could not be asked.
 * `gone`: the id of a made thing to take out, cells and record on one ask: the world empties the cells it keeps for it (`made` only says where to ask after them).
 * `replaces`: the id of a made thing this one is sent in place of: it is taken out on the same ask, which the world does whole or refuses whole.
 * It never sends twice: after a send whose answer was lost it asks the world what is there, and says.
 */
export async function send(world, made, by, { kind, thing, gone, replaces, fine, wait = 5000, settle = 1500, pause = (ms) => new Promise((r) => setTimeout(r, ms)), post = fetch } = {}) {
  // A thing of finer cells (`fine`: { grain, rows }) is sent as those rows; `made` is then its stand-in in the
  // world's cells, which says where to ask after it: a cell of the world that holds any of it is no longer air.
  const cells = samples(made).map((c) => (fine ? [c[0], c[1], c[2], kind === 0 ? 0 : -1] : c))
  let sent = 'lost', laid = null
  try {
    // Cells are sent with `wait`: the world answers once it has laid them, with how many pieces they left unheld.
    const res = await post(`${world}/world/ask`, { method: 'POST', body: JSON.stringify(gone ? { by, gone, release: beside(made), wait: true } : { by, edit: fine ? edit(fine.rows, kind, fine.grain) : edit(made, kind), release: beside(made), thing, ...(replaces ? { gone: replaces } : {}), wait: true }) })
    if (res.status !== 202) return { state: 'not there', why: `the world refused it (${res.status}): ${(await res.text()).slice(0, 160)}` }
    sent = 'taken'
    try { const said = await res.json(); if (said.laid) laid = said } catch { /* said nothing more */ }
  } catch { /* the answer was lost: whether the ask arrived is not known, so the world is asked */ }
  try {
    // Taken out: the world emptied the very rows it kept for the thing, and says it has (a cell of it that lay in the
    // land is the land again, so its cells are not looked at).
    if (gone && laid) return { state: 'there' }
    // A living thing (make/alive.mjs): its cells leave the world as it is brought to life, so they are not looked
    // for. The world says whether it lives.
    if (thing?.controls) return laid ? (laid.alive ? { state: 'there' } : { state: 'not there', why: 'the world could not bring it to life' }) : { state: 'unknown', why: sent === 'lost' ? 'the world could not be reached when it was sent' : 'the world did not say whether it lives' }
    // Pieces came loose somewhere round it (they may be its own or not): it is watched as before, until it settles.
    // Laid, and nothing came loose: it stands as it was put, and one look at its cells says the world took all of it
    // (a sector that holds too many finer cells takes none of them). Nothing is waited for.
    if (laid?.loose === 0) {
      const seen = await counted(world, cells, kind)
      if (seen === cells.length) return { state: 'there' }
    }
    let seen = 0
    for (const began = Date.now(); Date.now() - began < wait;) {
      seen = await counted(world, cells, kind)
      if (seen === cells.length) break
      await pause(250)
    }
    if (seen < cells.length) return { state: 'not there', why: sent === 'lost' ? 'the world could not be reached when it was sent, and it is not there' : `only ${seen} of ${cells.length} cells asked after are there` }
    // Whatever was going to come loose has by now.
    await pause(settle)
    const stayed = await counted(world, cells, kind)
    return stayed === cells.length ? { state: 'there' } : { state: 'fell', why: `${cells.length - stayed} of ${cells.length} cells asked after came loose` }
  } catch (e) {
    return { state: 'unknown', why: `the world stopped answering after it was sent (${e.message}): look before making it again` }
  }
}

/**
 * Who is in the world now and where: every page there says where its eye is a few times a second (`/world/here`),
 * and the world's stream carries it. Listens for `ms` and returns the last word from each who is still there:
 * { by, name, at (their feet), yaw, seat (true for an agent's body, which is not a page) }.
 */
export async function people(world, ms = 1500) {
  const stop = new AbortController(), seen = new Map()
  const timer = setTimeout(() => stop.abort(), ms)
  try {
    // From past the end of what is kept: only what happens from now.
    const res = await fetch(`${world}/world/stream?from=2147483647`, { signal: stop.signal })
    let bytes = Buffer.alloc(0)
    for await (const chunk of res.body) {
      bytes = Buffer.concat([bytes, chunk])
      let i = 0
      for (; i + 12 <= bytes.length && i + 12 + bytes.readUInt32LE(i + 8) <= bytes.length; i += 12 + bytes.readUInt32LE(i + 8)) {
        if (bytes.readUInt32LE(i) !== 5) continue
        try { const who = JSON.parse(bytes.subarray(i + 12, i + 12 + bytes.readUInt32LE(i + 8)).toString('utf8')); if (who.gone) seen.delete(who.by); else seen.set(who.by, who) } catch { /* not for us */ }
      }
      bytes = bytes.subarray(i)
    }
  } catch { /* the listening was ended */ }
  clearTimeout(timer)
  return [...seen.values()]
}
/** How high over their feet someone's eyes are, in cells (the page's own figure: page/main.ts). */
const EYES = 17
/** The look of someone in the world: from their eyes, the way they face, a little down. The world says where their feet are and which way they face, not how high they look. */
export const gaze = (who) => ({ from: [Math.round(who.at[0]), Math.round(who.at[1]) + EYES, Math.round(who.at[2])], toward: [Math.sin(who.yaw) * 0.97, -0.24, -Math.cos(who.yaw) * 0.97] })
