// A rule knows the ground (#264, the BUILD lane; asked for by a model that surveyed a slope with 325 looks before it
// could build on it: "a rule cannot ask how high the ground is", and by two that built a ring round a chimney they
// could not know was there). `world.ground(id, {at, within})` asks for the lie of the land over an area: how high
// it is, what it is made of, what stands on it and where the water is, as a grid. `world.ground(id, {find, near,
// room})` asks where the nearest ground of a kind is with room to build: a shore, sand, grass, open country, a
// street. The rule that asked hears `ground`.
//
// Every realm is the same planet (core/src/land.rs): a town, a dry plain to the east, grass country, mountains to
// the north, a coast and a sea to the west. This asks the core about it, a column at a time: what the land's rule
// says (`ground_at`, `feet_at`, `paving_at`) and what the cells are now (`world_kind`: what was built or broken
// shows). The sea is not cells: it lies wherever the ground is under the sea's level.
//
// `survey` and `find` are plain functions of a core's exports: whoever has a core may use them (the maker, to say
// where a realm should be before any rule runs).
const ID = /^[a-z0-9][a-z0-9-]{0,23}$/
const MATERIALS = ['air', 'earth', 'rock', 'grass', 'sand', 'water', 'asphalt', 'concrete', 'brick', 'plaster', 'wood', 'glass', 'steel', 'leaves', 'roofing', 'lamp']
/** One letter a column in a survey's grid: what the ground's top is made of; w is water, x anything else (something built). */
const LETTER = { earth: 'e', rock: 'r', grass: 'g', sand: 's', asphalt: 'a', concrete: 'c', water: 'w' }
const TOWN = [null, 'shore', 'park', 'homes', 'towers', 'yard']
const COMPASS = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west']
/** The sea's top cell (core/src/city.rs `SEA`): ground under it is under water. */
const SEA = -1
/** How far over the ground a column is looked at for what stands on it (cells): a car, a wall, a trunk, a low roof. */
const UP = 40, LOOKS_UP = [39, 28, 18, 11, 6, 3, 1, 0]
/** The kinds of ground a rule may ask to find. */
export const LANDS = ['open', 'grass', 'sand', 'rock', 'shore', 'street', 'high', 'water']
/** The most a survey may cover (cells from its middle) and its grid a side; the most room a find may ask (cells), how far it looks, and how many places it tries. */
export const WITHIN_MOST = 4000, GRID = [3, 17], ROOM = [20, 3000], FAR_MOST = 400_000, TRIES = 40_000, CLOSE_LOOKS = 120
/** The most a rule may ask a second: a survey reads a few hundred columns, a find up to tens of thousands. */
const SURVEYS_A_SECOND = 4, FINDS_A_SECOND = 1
/** How long the world's process works on these before it does its other work again (ms), and how many answers a rule may have waiting. */
const SLICE = 4, WAITING = 8
const num = (v, lo, hi) => typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi
const spot = (p) => Array.isArray(p) && (p.length === 2 || p.length === 3) && p.every((v) => num(v, -(2 ** 28), 2 ** 28))

/** One column of the ground: how high someone stands there (h; under the sea, the bed), what its top is made of, and how high what stands on it reaches over that (up: 0 is clear, 40 is that or more). */
export function column(c, x, z) {
  const g = c.ground_at(x, z)
  // Under the sea: the height of its bed (the water's surface is at 0, so this is how deep it is).
  if (g < SEA) return { h: g + 1, of: 'water', up: 0 }
  let feet = c.feet_at(x, z)
  // Where the ground was dug since (a trench, a crater), the top is where the cells now are.
  for (let down = 0; down < 60 && !c.world_kind(x, feet - 1, z); down++) feet--
  // What stands there: looked for at a few heights, highest first (every read of a cell makes its whole sector if it is not kept: 0.3 ms).
  let up = 0
  for (const over of LOOKS_UP) if (c.world_kind(x, feet + over, z)) { up = over + 1; break }
  // Its top, cell by cell from the highest place something was met.
  while (up && up < UP && c.world_kind(x, feet + up, z)) up++
  return { h: feet, of: MATERIALS[c.world_kind(x, feet - 1, z) & 15], up }
}
/** What the ground's top is made of at a column by the land's own rule (quick: no sector is made); with a core that cannot say, by its cells. */
const topOf = (c, x, z) => MATERIALS[(c.top_at ? c.top_at(x, z) : c.world_kind(x, c.feet_at(x, z) - 1, z)) & 15]

/** The lie of the land over a square round a place: a grid of `n` by `n` columns (north row first, each row west to east), and what it comes to. */
export function survey(c, at, within, n = 9) {
  const work = surveying(c, at, within, n)
  for (;;) { const step = work.next(); if (step.done) return step.value }
}
/** `survey`, a row at a time (a column costs up to a millisecond: what stands on it is read from the world's cells, a sector each). */
export function* surveying(c, [x, z], within, n = 9) {
  const h = [], of = [], up = [], made = {}, step = (within * 2) / (n - 1)
  let low = Infinity, high = -Infinity, water = 0, clear = 0
  for (let j = 0; j < n; j++) {
    const hs = [], ups = []
    let letters = ''
    for (let i = 0; i < n; i++) {
      const col = column(c, Math.round(x - within + i * step), Math.round(z - within + j * step))
      hs.push(col.h); ups.push(col.up); letters += LETTER[col.of] ?? 'x'
      if (col.of === 'water') { water++; continue }
      made[col.of] = (made[col.of] ?? 0) + 1
      if (col.h < low) low = col.h
      if (col.h > high) high = col.h
      if (!col.up) clear++
    }
    h.push(hs); of.push(letters); up.push(ups)
    yield
  }
  const land = n * n - water
  return { at: [Math.round(x), Math.max(SEA + 1, column(c, Math.round(x), Math.round(z)).h), Math.round(z)], within, step: Math.round(step), low: land ? low : SEA + 1, high: land ? high : SEA + 1, water: Number((water / (n * n)).toFixed(2)), clear: Number((clear / (n * n)).toFixed(2)), town: TOWN[c.paving_at(Math.round(x), Math.round(z)) % 8] ?? null, most: Object.entries(made).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'water', h, of, up }
}

/** Whether a place is the kind of ground asked for, by its own column alone (quick: asked of tens of thousands). For a shore, which way the water lies. */
function is(c, land, x, z) {
  const g = c.ground_at(x, z), wet = g < SEA
  if (land === 'water') return wet
  if (wet) return false
  if (land === 'high') return g > 3000
  if (land === 'shore') {
    // Low ground in open country with the sea within 60 m of it one way and land the other.
    if (g > 80 || c.paving_at(x, z) % 8 !== 0) return false
    // Open water, not a river: under the sea's level all the way out for 300 m one way, with land behind.
    const wet = (k, far) => { const a = k * Math.PI / 4; return c.ground_at(Math.round(x + Math.sin(a) * far), Math.round(z - Math.cos(a) * far)) < SEA - 10 }
    let best = false, most = 0
    for (let k = 0; k < 8; k++) for (const far of [200, 400, 600]) {
      if (!(wet(k, far) && wet(k, far + 800) && wet(k, far + 1800) && wet(k, far + 3000)) || wet(k + 4, 400)) continue
      // Of the ways the water lies, the one that looks most squarely out to sea: wet to both sides of it too.
      const score = 1 + (wet(k + 1, far + 800) ? 1 : 0) + (wet(k + 7, far + 800) ? 1 : 0) + (wet(k + 1, far + 3000) ? 1 : 0) + (wet(k + 7, far + 3000) ? 1 : 0)
      if (score > most) { most = score; best = { to: COMPASS[k], far } }
      break
    }
    return best
  }
  const town = c.paving_at(x, z) % 8
  if (land === 'open') return town === 0
  const top = topOf(c, x, z)
  if (land === 'street') return town > 0 && top === 'asphalt'
  return town === 0 && top === land
}

/**
 * The nearest place to `near` that is a kind of ground, with room: nothing standing and no water within `room`
 * cells of it (a shore has water on one side), and the ground rising no more than `flat` cells across it.
 * Looked for ring by ring outwards. Answers {at: [x, y, z], far, room, rise, of, town, water: {to, far}} or null.
 */
export function find(c, want) {
  const search = finding(c, want)
  for (;;) { const step = search.next(); if (step.done) return step.value }
}
/** `find`, a little at a time: it yields between places looked at closely, so whoever runs it may do other work between (the world's process does). */
export function* finding(c, { land, near, room = 300, flat, within = 200_000 }) {
  const base = Math.max(300, Math.min(1500, room)), most = flat ?? Math.max(10, Math.round(room / (land === 'high' || land === 'rock' ? 1 : land === 'shore' ? 3 : 6)))
  let tries = 0, looks = 0
  const close = function* (x, z, shore) {
    let low = Infinity, high = -Infinity
    const round = [[x, z]]
    for (const [r, n] of [[room / 2, 8], [room, 12]]) for (let k = 0; k < n; k++) { const a = (k / n) * Math.PI * 2; round.push([Math.round(x + Math.sin(a) * r), Math.round(z - Math.cos(a) * r)]) }
    // First what the land's own rule says, which is quick: where the water is and how much the ground rises.
    const dry = []
    for (const [px, pz] of round) {
      const wet = c.ground_at(px, pz) < SEA
      if (land === 'water') { if (!wet) return null; continue }
      // A shore's far side is the sea: water there is what was asked for.
      if (wet) { if (shore && (px !== x || pz !== z)) continue; return null }
      const h = c.feet_at(px, pz)
      if (h < low) low = h
      if (h > high) high = h
      dry.push([px, pz])
    }
    if (land !== 'water' && high - low > most) return null
    // Then what stands there, from the world's cells: a sector is made for each column asked about.
    for (const [px, pz] of dry) { if (column(c, px, pz).up) return null; yield }
    const centre = column(c, x, z)
    return { at: [x, Math.max(SEA + 1, centre.h), z], far: Math.round(Math.hypot(x - near[0], z - near[1])), room, rise: land === 'water' ? 0 : high - low, of: centre.of, town: TOWN[c.paving_at(x, z) % 8] ?? null, ...(shore ? { water: shore } : {}) }
  }
  // Ring by ring outwards, the rings further apart the further out: near, a place is not stepped over; far, the land changes by the kilometre.
  for (let r = 0, ring = 0; r <= within; ring++) {
    const step = Math.max(base, r / 20), n = r ? Math.ceil((2 * Math.PI * r) / step) : 1, turn = ring * 0.61
    for (let k = 0; k < n; k++) {
      if (++tries > TRIES) return null
      if (tries % 400 === 0) yield
      const a = (k / n) * Math.PI * 2 + turn, x = Math.round(near[0] + Math.sin(a) * r), z = Math.round(near[1] - Math.cos(a) * r), ok = is(c, land, x, z)
      if (!ok) continue
      if (++looks > CLOSE_LOOKS) return null
      yield
      const found = yield* close(x, z, ok === true ? null : ok)
      if (found) return found
    }
    r += step
  }
  return null
}

export default ({ core, hear }) => {
  /** By rule: when its second began and how many surveys and finds it has had in it. */
  const asked = new Map()
  /** What is being worked out, first asked first: each a little at a time between the world's other work, so a far search holds nobody up. */
  const jobs = []
  let clock = null
  const work = () => {
    clock = null
    const until = performance.now() + SLICE
    while (jobs.length && performance.now() < until) {
      const job = jobs[0]
      let step
      try { step = job.work.next() } catch (e) { step = { done: true, value: undefined, failed: String(e?.message ?? e).slice(0, 120) } }
      if (!step.done) continue
      jobs.shift()
      hear(job.rule, 'ground', job.told(step.value, step.failed))
    }
    if (jobs.length) clock = setTimeout(work, 1)
  }
  const queue = (rule, wrong, job) => {
    if (jobs.filter((j) => j.rule === rule.id).length >= WAITING) return wrong(`a rule has at most ${WAITING} questions about the ground waiting for their answers`)
    jobs.push({ rule: rule.id, ...job })
    if (!clock) clock = setTimeout(work, 0)
  }
  return {
    does: {
      ground(rule, w, now, wrong) {
        if (typeof w.id !== 'string' || !ID.test(w.id)) return wrong('a question about the ground has an id of the rule\'s own, to know its answer by: lower-case letters, digits and dashes, up to 24')
        let count = asked.get(rule.id)
        if (!count || now - count.since > 1000) asked.set(rule.id, count = { since: now, surveys: 0, finds: 0 })
        const c = core()
        if (w.find !== undefined) {
          if (!LANDS.includes(w.find)) return wrong(`ground "${w.id}": find is one of ${LANDS.join(', ')}`)
          if (!spot(w.near)) return wrong(`ground "${w.id}": near is [x, z], where to look from`)
          if (w.room !== undefined && !num(w.room, ROOM[0], ROOM[1])) return wrong(`room is how far the ground must be clear round the place: ${ROOM[0]} to ${ROOM[1]} cells`)
          if (w.flat !== undefined && !num(w.flat, 0, 2000)) return wrong('flat is the most the ground may rise across the room, in cells: 0 to 2000')
          if (w.within !== undefined && !num(w.within, 100, FAR_MOST)) return wrong(`within is how far to look: 100 to ${FAR_MOST} cells`)
          if (++count.finds > FINDS_A_SECOND) return wrong(`a rule looks for ground at most ${FINDS_A_SECOND === 1 ? 'once' : `${FINDS_A_SECOND} times`} a second: ask once and keep the answer in world.keep`)
          const near = [Math.round(w.near[0]), Math.round(w.near[w.near.length - 1])], room = Math.round(w.room ?? 300)
          return queue(rule, wrong, { work: finding(c, { land: w.find, near, room, flat: w.flat, within: w.within }), told: (found) => found ? { ground: w.id, find: w.find, found: true, ...found } : { ground: w.id, find: w.find, found: false, why: `no ${w.find} with ${room} cells of clear ground${w.flat !== undefined ? ` rising ${w.flat} or less` : ''} was found within ${Math.round(w.within ?? 200_000)} cells of ${near}: ask for less room, more rise (flat), or another kind of ground` } })
        }
        if (!spot(w.at)) return wrong(`ground "${w.id}": at is [x, z], the middle of the area to be told of (or find: a kind of ground, with near: [x, z])`)
        if (w.within !== undefined && !num(w.within, 10, WITHIN_MOST)) return wrong(`within is how far from at the area reaches: 10 to ${WITHIN_MOST} cells`)
        if (w.grid !== undefined && !(Number.isInteger(w.grid) && w.grid >= GRID[0] && w.grid <= GRID[1])) return wrong(`grid is how many columns a side are told: ${GRID[0]} to ${GRID[1]} (9 unless said)`)
        if (++count.surveys > SURVEYS_A_SECOND) return wrong(`a rule asks about the ground at most ${SURVEYS_A_SECOND} times a second: the land does not change, keep the answer`)
        queue(rule, wrong, { work: surveying(c, [w.at[0], w.at[w.at.length - 1]], Math.round(w.within ?? 300), w.grid ?? 9), told: (land, failed) => land ? { ground: w.id, ...land } : { ground: w.id, failed: failed ?? 'the ground could not be read' } })
      },
    },
    dropped: (ruleId) => { asked.delete(ruleId); for (let i = jobs.length - 1; i >= 0; i--) if (jobs[i].rule === ruleId) jobs.splice(i, 1) },
    close: () => { if (clock) clearTimeout(clock); jobs.length = 0 },
  }
}
