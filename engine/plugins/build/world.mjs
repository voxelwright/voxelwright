// A rule builds (#264, the BUILD lane; asked for by a boxing match, a beach landing, a race day and a kart race: "a
// rule could not change the world's cells: a ring, a beach, stands, item boxes that can be seen"). `world.build(id,
// {at, parts})`: shapes as data, in the engine's materials and colours, put into the world's cells where the rule
// says; `world.build(id, {clear: true})` takes them out again and puts back what they replaced, and so does taking
// the rule out. What is built is the world's like any edit: everyone sees it, it breaks, burns and falls, and it is
// kept with the world. The memory of what each build replaced is the world's own (rules/built.mjs), not this
// file's: this is the shapes and the checks, and may be changed while a game runs.
//
// A part is a list, as a made thing's parts are (make/form.mjs, whose materials and colours these are):
//   ["box",   material, colour, x0, y0, z0, x1, y1, z1]                 level; the high corner is not filled
//   ["wedge", material, colour, x0, y0, z0, x1, y1, z1, falls, thick?]  a slope down towards "+x" "-x" "+z" "-z"
//   ["steps", material, colour, x0, y0, z0, x1, y1, z1, falls, rise, thick?]   the same in steps `rise` cells high
//   ["line",  material, colour, [[x, z], ...], wide, high, lift?]       along points, on the ground under each column
//   ["loop",  ...as line]                                               the same, closed
//   ["ring",  material, colour, x, z, radius, wide, high, lift?]        a round band on the ground
//   ["disc",  material, colour, x, z, radius, high, lift?]              a round patch on the ground
//   ["posts", material, colour, [[x, z], ...], wide, high, lift?]       square posts, each on its own ground, level on top
// x is east and z south of `at`, in cells of 10 cm. For box, wedge and steps y is over the ground at `at`; for the
// rest heights are over the ground under each column, so a road lies on rolling land. Later parts replace earlier
// ones; "air" cuts, into the ground too. No number of a kind is taken from a rule: a kind is a named material and
// a named colour.
//
// Every field is a stranger's. A build is whole or not at all: what is wrong is said to the rule (and heard as
// `built` with `failed`), and nothing is changed.
import { MATERIALS, colour } from '../../make/form.mjs'

const ID = /^[a-z0-9][a-z0-9-]{0,23}$/
const FIELDS = ['do', 'id', 'at', 'parts', 'clear']
/** The most builds a rule may have, and a world; the most parts in one. */
export const BUILDS_A_RULE = 16, BUILDS_A_WORLD = 64, PARTS_MOST = 200
/** How far from `at` a part may reach (cells, each way), how far under and over the ground there, and the most points in a line. */
export const REACH = 3000, DEEP = 200, HIGH = 600, POINTS_MOST = 64
/** The most a build may be: cells changed (each is read and remembered), rows of cells (each is kept with the world and sent to every page), and rows worked while laying it. */
export const CELLS_MOST = 600_000, ROWS_MOST = 45_000, WORK_MOST = 1_200_000
/** The most builds that change something a rule may ask for in a minute, and the most cells. */
export const BUILDS_A_MINUTE = 12, CELLS_A_MINUTE = 1_500_000
/** How far down a level part that starts on the ground is carried to meet ground that falls away under it. */
const FOOT = 60
const FALLS = { '+x': [1, 0], '-x': [-1, 0], '+z': [0, 1], '-z': [0, -1] }
const whole = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi
const num = (v, lo, hi) => typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi

class Refused extends Error {}
const no = (why) => { throw new Refused(why) }
/** A sum of a build as asked for: asked again the same, nothing is done. */
const sumOf = (text) => { let h = 2166136261; for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619); return (h >>> 0).toString(36) + text.length.toString(36) }

/**
 * The cells of a build, as rows (x0, x1, y, z, kind, flat) in the world's own places.
 * @param feet  (x, z) => the first cell over the ground's own top at a column (the land's rule: not what stands on it)
 * Throws `Refused` with the reason in words for the rule.
 */
export function rowsOf(parts, [ox, base, oz], feet) {
  /** By row (y and z): its runs of x, flat: x0, x1, kind. A later run replaces what it covers. */
  const rows = new Map()
  let work = 0
  const worked = () => { if (++work > WORK_MOST) no(`this is too much to lay at once: build less, lower or narrower, or in two builds`) }
  const paint = (x0, x1, y, z, kind) => {
    worked()
    const k = (y + 1048576) * 16384 + (z - oz + 8192), list = rows.get(k)
    if (!list) { rows.set(k, [x0, x1, kind]); return }
    for (let i = list.length - 3; i >= 0; i -= 3) {
      const a = list[i], b = list[i + 1]
      if (a >= x1 || b <= x0) continue
      const old = list[i + 2]
      list.splice(i, 3)
      if (a < x0) list.push(a, x0, old)
      if (b > x1) list.push(x1, b, old)
    }
    list.push(x0, x1, kind)
  }
  const ground = new Map(), feetAt = (x, z) => { const k = (x - ox + 8192) * 16384 + (z - oz + 8192); let g = ground.get(k); if (g === undefined) ground.set(k, g = feet(x, z)); return g }
  /** Columns x0 to x1 of a row of the ground, each from `lift` over its own ground: `high` cells, or up to `top` when one is given. Columns side by side on the same ground are laid as one run. */
  const onGround = (x0, x1, z, lift, high, kind, top) => {
    for (let x = x0; x < x1;) {
      worked()
      const g = feetAt(x, z)
      let end = x + 1
      while (end < x1 && feetAt(end, z) === g) end++
      // What hangs over the ground (a rail, a rope) must still be one piece where the ground steps: cells join by their faces, so a column reaches up to where the next one begins.
      const step = lift > 0 && top === undefined ? Math.max(feetAt(x - 1, z), feetAt(end, z), feetAt(x, z - 1), feetAt(x, z + 1)) : g
      const upTo = top === undefined ? Math.max(g + lift + high, Math.min(step, g + 4) + lift + 1) : top
      for (let y = g + lift; y < upTo; y++) paint(x, end, y, z, kind)
      x = end
    }
  }
  /** The run of x that a row z cuts from a shape with corners (convex), or null. */
  const across = (corners, z) => {
    let lo = Infinity, hi = -Infinity
    for (let i = 0; i < corners.length; i++) {
      const [ax, az] = corners[i], [bx, bz] = corners[(i + 1) % corners.length]
      if ((az < z && bz < z) || (az > z && bz > z)) continue
      if (az === bz) { lo = Math.min(lo, ax, bx); hi = Math.max(hi, ax, bx); continue }
      const x = ax + (bx - ax) * (z - az) / (bz - az)
      lo = Math.min(lo, x); hi = Math.max(hi, x)
    }
    return lo <= hi ? [lo, hi] : null
  }
  const round = (cx, cz, r, z) => { const d = z - cz; return Math.abs(d) <= r ? [cx - Math.sqrt(r * r - d * d), cx + Math.sqrt(r * r - d * d)] : null }
  /** A band `wide` across along points, row by row: the runs of x of each row, joined where they meet. */
  const along = (points, wide, closed, each) => {
    // One cell wide (a rail, a rope, a painted line): a cell at a time, each sharing a face with the last, so it is one piece however it slants.
    if (wide === 1) {
      for (let i = 0; i < (closed ? points.length : points.length - 1); i++) {
        let [x, z] = points[i]
        const [bx, bz] = points[(i + 1) % points.length], dx = Math.abs(bx - x), dz = Math.abs(bz - z), sx = bx > x ? 1 : -1, sz = bz > z ? 1 : -1
        for (let err = dx - dz; ;) { each(x, x + 1, z); if (x === bx && z === bz) break; if (2 * err > -dz) { err -= dz; x += sx } else { err += dx; z += sz } }
      }
      return
    }
    const r = wide / 2, spans = new Map()
    const add = (z, run) => { if (run) { const list = spans.get(z); if (list) list.push(run); else spans.set(z, [run]) } }
    const n = closed ? points.length : points.length - 1
    for (let i = 0; i < n; i++) {
      const [ax, az] = points[i], [bx, bz] = points[(i + 1) % points.length], long = Math.hypot(bx - ax, bz - az)
      if (!long) continue
      const nx = -(bz - az) / long * r, nz = (bx - ax) / long * r, corners = [[ax + nx, az + nz], [bx + nx, bz + nz], [bx - nx, bz - nz], [ax - nx, az - nz]]
      for (let z = Math.ceil(Math.min(az, bz) - r); z <= Math.floor(Math.max(az, bz) + r); z++) add(z, across(corners, z))
    }
    // Round where two lengths meet and at the ends, so a bend has no notch (a band one cell wide needs none).
    for (const [px, pz] of points) for (let z = Math.ceil(pz - r); z <= Math.floor(pz + r); z++) add(z, round(px, pz, r, z))
    for (const [z, list] of spans) {
      list.sort((a, b) => a[0] - b[0])
      let [lo, hi] = list[0]
      for (const [a, b] of list.slice(1)) { if (a <= hi + 1) hi = Math.max(hi, b); else { each(Math.round(lo), Math.max(Math.round(lo) + 1, Math.round(hi)), z); lo = a; hi = b } }
      each(Math.round(lo), Math.max(Math.round(lo) + 1, Math.round(hi)), z)
    }
  }
  const pointsOf = (list, bad) => {
    if (!Array.isArray(list) || !list.length || list.length > POINTS_MOST || !list.every((p) => Array.isArray(p) && p.length === 2 && p.every((v) => num(v, -REACH, REACH)))) bad(`its points are a list of 1 to ${POINTS_MOST} of [x, z], each within ${REACH} cells of at`)
    return list.map(([x, z]) => [ox + Math.round(x), oz + Math.round(z)])
  }
  parts.forEach((part, n) => {
    const bad = (why) => no(`part ${n + 1} (${JSON.stringify(part).slice(0, 60)}): ${why}`)
    if (!Array.isArray(part) || part.length < 6 || part.length > 12) bad('a part is a list: shape, material, colour, then its numbers')
    const [shape, material, tint] = part
    if (typeof material !== 'string' || !Object.hasOwn(MATERIALS, material)) bad(`"${String(material).slice(0, 20)}" is not a material: ${Object.keys(MATERIALS).join(', ')}`)
    const c = material === 'air' ? 0 : colour(tint)
    if (c < 0) bad(`"${String(tint).slice(0, 20)}" is not a colour: "own", "white", "black", "grey:0" to "grey:14", or "hue:tone" with hue 0 to 23 and tone 0 to 9`)
    const kind = MATERIALS[material] | (c << 8)
    if (shape === 'box' || shape === 'wedge' || shape === 'steps') {
      const [x0, y0, z0, x1, y1, z1] = part.slice(3, 9), more = part.slice(9)
      if (![x0, z0, x1, z1].every((v) => whole(v, -REACH, REACH)) || !whole(y0, -DEEP, HIGH) || !whole(y1, -DEEP, HIGH) || !(x0 < x1 && y0 < y1 && z0 < z1)) bad(`its box is x0, y0, z0, x1, y1, z1: whole numbers from a low corner to a higher one, x and z within ${REACH} of at, y from ${-DEEP} to ${HIGH} over the ground at at`)
      // What starts on the ground is carried down to it where the ground falls away, so nothing stands on air.
      const foot = (keep) => { if (y0 !== 0 || !kind) return; for (let z = z0; z < z1; z++) for (let x = x0; x < x1; x++) { worked(); const g = feetAt(ox + x, oz + z); if (g < base && base - g <= FOOT && keep(x, z)) for (let y = g; y < base; y++) paint(ox + x, ox + x + 1, y, oz + z, kind) } }
      if (shape === 'box') {
        if (more.length) bad('a box has nothing after its numbers')
        foot(() => true)
        for (let y = y0; y < y1; y++) for (let z = z0; z < z1; z++) paint(ox + x0, ox + x1, base + y, oz + z, kind)
        return
      }
      const [falls, a, b] = more, rise = shape === 'steps' ? a : 1, thick = shape === 'steps' ? b : a
      if (!Object.hasOwn(FALLS, falls) || (shape === 'steps' && !whole(rise, 1, 100)) || (thick !== undefined && !whole(thick, 1, 400)) || more.length > (shape === 'steps' ? 3 : 2)) bad(shape === 'steps' ? 'steps end with the way they go down ("+x", "-x", "+z" or "-z"), how high a step is in cells, and if you like how thick they are underneath' : 'a wedge ends with the way it slopes down ("+x", "-x", "+z" or "-z"), and if you like how thick the sheet is')
      const [fx, fz] = FALLS[falls], long = fx ? x1 - x0 : z1 - z0, tall = y1 - y0
      /** How high the top is at a column: all of it at the high end, none at the low. */
      const top = (x, z) => { const far = fx > 0 ? x1 - 1 - x : fx < 0 ? x - x0 : fz > 0 ? z1 - 1 - z : z - z0, h = (far + 1) * tall / long; return shape === 'steps' ? Math.min(tall, Math.ceil(h / rise) * rise) : Math.max(1, Math.round(h)) }
      foot((x, z) => thick === undefined || top(x, z) <= thick)
      for (let z = z0; z < z1; z++) for (let x = x0; x < x1;) {
        const h = top(x, z)
        let end = x + 1
        while (end < x1 && top(end, z) === h) end++
        for (let y = thick === undefined ? 0 : Math.max(0, h - thick); y < h; y++) paint(ox + x, ox + end, base + y0 + y, oz + z, kind)
        x = end
      }
      return
    }
    if (shape === 'line' || shape === 'loop' || shape === 'posts') {
      const [list, wide, high, lift = 0] = part.slice(3)
      if (part.length > 7 || !whole(wide, 1, 400) || !whole(high, 1, HIGH) || !whole(lift, -DEEP, HIGH)) bad(`a ${shape} is its points, then how wide (1 to 400 cells), how high (1 to ${HIGH}), and if you like how far over the ground it starts (lift: ${-DEEP} to ${HIGH}; -1 is the ground's own top cell)`)
      const points = pointsOf(list, bad)
      if (shape === 'posts') {
        for (const [px, pz] of points) { const x0 = px - Math.floor(wide / 2), z0 = pz - Math.floor(wide / 2), top = feetAt(px, pz) + lift + high; for (let z = z0; z < z0 + wide; z++) onGround(x0, x0 + wide, z, lift, high, kind, top) }
        return
      }
      if (points.length < 2) bad(`a ${shape} goes through two points or more`)
      along(points, wide, shape === 'loop', (x0, x1, z) => onGround(x0, x1, z, lift, high, kind))
      return
    }
    if (shape === 'ring' || shape === 'disc') {
      const ring = shape === 'ring', [x, z, radius] = part.slice(3, 6), [wide, high, lift = 0] = ring ? part.slice(6) : [0, ...part.slice(6)]
      if (part.length > (ring ? 10 : 9) || !num(x, -REACH, REACH) || !num(z, -REACH, REACH) || !num(radius, 1, REACH) || (ring && !whole(wide, 1, 400)) || !whole(high, 1, HIGH) || !whole(lift, -DEEP, HIGH)) bad(ring ? `a ring is x, z (its middle), radius (to the middle of the band), how wide the band is, how high, and if you like lift` : 'a disc is x, z (its middle), radius, how high, and if you like lift')
      const cx = ox + Math.round(x), cz = oz + Math.round(z), outer = ring ? radius + wide / 2 : radius, inner = ring ? radius - wide / 2 : 0
      for (let rz = Math.ceil(cz - outer); rz <= Math.floor(cz + outer); rz++) {
        const out = round(cx, cz, outer, rz), hole = inner > 0 ? round(cx, cz, inner, rz) : null
        const x0 = Math.round(out[0]), x1 = Math.max(x0 + 1, Math.round(out[1]))
        if (!hole) { onGround(x0, x1, rz, lift, high, kind); continue }
        const h0 = Math.round(hole[0]), h1 = Math.round(hole[1])
        if (h0 > x0) onGround(x0, h0, rz, lift, high, kind)
        if (x1 > h1) onGround(Math.max(h1, x0), x1, rz, lift, high, kind)
      }
      return
    }
    bad(`"${String(shape).slice(0, 20)}" is not a shape: box, wedge, steps, line, loop, ring, disc, posts`)
  })
  const out = []
  let cells = 0
  for (const [k, list] of rows) {
    const y = Math.floor(k / 16384) - 1048576, z = k % 16384 - 8192 + oz
    // Runs side by side of one kind are one row.
    const runs = []
    for (let i = 0; i < list.length; i += 3) runs.push([list[i], list[i + 1], list[i + 2]])
    runs.sort((a, b) => a[0] - b[0])
    for (let i = 0; i < runs.length; i++) {
      let [x0, x1, kind] = runs[i]
      while (i + 1 < runs.length && runs[i + 1][0] === x1 && runs[i + 1][2] === kind) x1 = runs[++i][1]
      out.push(x0, x1, y, z, kind)
      cells += x1 - x0
    }
  }
  if (out.length / 5 > ROWS_MOST) no(`this build is ${out.length / 5} rows of cells and may be ${ROWS_MOST}: a row runs east to west, so what is tall and runs north to south costs most. Build it lower, shorter or in two builds`)
  if (cells > CELLS_MOST) no(`this build is ${cells} cells and may be ${CELLS_MOST} (a cell is 10 cm: ${CELLS_MOST / 1000} cubic metres): make what is big hollow (thick), thinner or lower, or build it in two`)
  return out
}

export default ({ builds, core, hear }) => {
  /** By rule: when its minute began, and how many builds and cells it has changed in it. */
  const spent = new Map()
  const told = (rule, e) => hear(rule.id, 'built', e)
  return {
    does: {
      build(rule, w, now, wrong) {
        const fail = (why) => { wrong(why); if (typeof w.id === 'string' && ID.test(w.id)) told(rule, { build: w.id, failed: why.slice(0, 300) }) }
        const odd = Object.keys(w).find((k) => !FIELDS.includes(k))
        if (odd) return fail(`build has no "${String(odd).slice(0, 24)}": ${FIELDS.slice(2).join(', ')}`)
        if (typeof w.id !== 'string' || !ID.test(w.id)) return wrong('a build has an id of the rule\'s own: lower-case letters, digits and dashes, up to 24')
        if (!builds) return fail('this world cannot be built in yet: its server is older than its plugins and must be started again')
        const mine = builds.of(rule.id), old = mine.find((b) => b.id === w.id)
        if (w.clear === true) { const gone = builds.clear(rule.id, w.id); if (gone) told(rule, { build: w.id, cleared: true, back: gone.put, left: gone.left }); return }
        if (w.clear !== undefined) return fail('clear is true, to take the build away, or left out')
        const at = w.at
        if (!Array.isArray(at) || (at.length !== 2 && at.length !== 3) || !at.every((v) => Number.isFinite(v) && Math.abs(v) < 2 ** 28)) return fail(`build "${w.id}" needs at: [x, z], the place its parts are measured from (or [x, y, z] to say the height too)`)
        if (!Array.isArray(w.parts) || !w.parts.length || w.parts.length > PARTS_MOST) return fail(`parts is a list of 1 to ${PARTS_MOST}`)
        const sum = sumOf(JSON.stringify([at, w.parts]))
        // Asked again as it is (every start, every tick): nothing to do.
        if (old?.sum === sum) return
        if (!old && mine.length >= BUILDS_A_RULE) return fail(`a rule has at most ${BUILDS_A_RULE} builds: clear one first`)
        if (!old && builds.count() >= BUILDS_A_WORLD) return fail(`a world has at most ${BUILDS_A_WORLD} builds, of all its rules`)
        let use = spent.get(rule.id)
        if (!use || now - use.since > 60_000) spent.set(rule.id, use = { since: now, builds: 0, cells: 0 })
        if (use.builds >= BUILDS_A_MINUTE || use.cells >= CELLS_A_MINUTE) return fail(`a rule builds at most ${BUILDS_A_MINUTE} times a minute and ${CELLS_A_MINUTE} cells: build when something changes, not on every tick`)
        const c = core(), ox = Math.round(at[0]), oz = Math.round(at[at.length - 1]), base = at.length === 3 ? Math.round(at[1]) : c.feet_at(ox, oz)
        let rows
        try { rows = rowsOf(w.parts, [ox, base, oz], (x, z) => c.feet_at(x, z)) } catch (e) { if (e instanceof Refused) return fail(`build "${w.id}": ${e.message}`); throw e }
        if (!rows.length) return fail(`build "${w.id}" came to no cells`)
        const done = builds.put(rule.id, w.id, sum, rows)
        if (done.error) return fail(`build "${w.id}": ${done.error}`)
        use.builds++; use.cells += done.cells
        told(rule, { build: w.id, cells: done.cells, at: [ox, base, oz], low: done.box.slice(0, 3), high: done.box.slice(3) })
      },
    },
    dropped: (ruleId) => { spent.delete(ruleId) },
  }
}
