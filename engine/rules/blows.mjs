// Blows (#264, the BODIES lane): for the world's process.
//
// Figures are in no cell and no solver moved them, so nothing could hit anyone. Here everyone with a body (someone
// at a page, a seat, an actor) has a ghost in the world's core: a box put where they stand each time they are told
// of, which meets what is thrown, what falls and what drives, and goes nowhere itself (bodies/living.rs `ghost`).
// When something meets a ghost, rules hear `struck`: whom, by what, how fast, how hard, where. Someone at a page is
// also sent the speed the blow would have given them, and their own page, which moves their body, gives it that.
//
// And what a rule may do with it: throw something from a body or a place (`world.throw`), push someone
// (`world.push`), put someone on the ground (`world.down`). Health is no word here: a rule counts what it likes.

/** A ghost's box in cells (wide, tall, deep), feet at its foot; how high a chest is; how far ahead of a body a throw starts. */
const BOX = [4, 17, 3], CHEST = 12, AHEAD = 6
const MATERIALS = ['air', 'earth', 'rock', 'grass', 'sand', 'water', 'asphalt', 'concrete', 'brick', 'plaster', 'wood', 'glass', 'steel', 'leaves', 'roofing', 'lamp']
/** What may be thrown: how fast (cells a second), how big (the ball's half, cells), how many a second a rule, and how long a thrown thing is remembered (ms). */
const SPEED = [10, 700], SIZE = [1, 4], THROWS_A_SECOND = 20, REMEMBERED = 15_000
/** How fast a person throws what they hold themselves, cells a second. */
const OWN_THROW = 130
/** The fastest a push, the longest on the ground (seconds), and how soon the same two may be told of again (ms). */
const PUSH_MOST = 400, DOWN_MOST = 60, AGAIN = 400
/** What a rule may break and burn: the widest blast and fire (cells: as an ask from anyone), and how many of each a second. */
const BLAST_MOST = 40, FIRE_MOST = 8, BLASTS_A_SECOND = 4, FIRES_A_SECOND = 8
/** How long a ghost is carried on after its person was last told of, seconds. */
const CARRIED = 0.2
const three = (a) => Array.isArray(a) && a.length === 3 && a.every((v) => Number.isFinite(v) && Math.abs(v) < 2 ** 30)

/**
 * @param core    the world's core (its exports)
 * @param folk    everyone with a body, by the name the world knows them by: {by, name, at (feet), yaw, rule?, short?, seat, down, gone}
 * @param tell    says where a body is to pages (after a change to `down`)
 * @param post    says something to the server (a blow, for the page whose person it is)
 * @param told    says what the core's last call wrote (its words), as every call's words are said
 * @param happen  every rule that listens hears it: (event, e)
 * @param hear    one rule hears it: (rule id, event, e)
 * @param thing   which living thing a body of the core is, by its thing's id, or undefined
 * @param blast   breaks the world at a place, as an ask does: (at, radius, spark)
 * @param ignite  lights what burns at a place, as an ask does: (at, radius)
 * @param rested  a held thing that was thrown has come to rest as cells again: (thing id, who threw it, its rows) => it is a made thing where it lies, to be picked up again
 * @param lost    a held thing that was thrown broke, or never came to rest: (thing id, who threw it) => its record goes
 * @param letGo   what someone holds leaves their hand to be thrown (rules/holding.mjs): (by) => its cells as the core takes a living thing's ({cells, size}), or nothing
 */
export function blows({ core, folk, tell, post, told, happen, hear, thing, blast, ignite, letGo = () => null, rested = () => {}, lost = () => {} }) {
  /** How many blasts and fires each rule asked for this second. */
  const blasted = new Map(), lit = new Map()
  /** Ghosts by who they stand for, and who by ghost. */
  const ghosts = new Map(), whose = new Map()
  /** What was thrown, by its body: the rule, from whom, when. And how many each rule threw this second. */
  const thrown = new Map(), threw = new Map()
  /** When each pair was last told of. */
  const lately = new Map()
  const who = (p) => ({ id: p.rule ? p.short : p.by, name: p.name, kind: p.rule ? 'actor' : p.seat ? 'seat' : 'page' })
  /** What someone holds leaves their hand as a body of its own cells, going a way at a speed. `rule` is the rule that threw it, if one did. Says why not, or nothing. */
  const fling = (thrower, from, dir, speed, rule, tag, now) => {
    const g = letGo(thrower.by)
    if (!g) return 'there is nothing in that hand to throw'
    const low = from.map((v, a) => Math.round(v - g.size[a] / 2 + dir[a] * Math.max(...g.size) / 2))
    const room = core.edits_room(g.cells.length)
    new Int32Array(core.memory.buffer, room, g.cells.length).set(g.cells)
    const born = core.living_spawn(g.size[0], g.size[1], g.size[2], low[0], low[1], low[2], 0), body = core.living_last()
    if (!body) return 'there was no room to throw it'
    told(born)
    core.living_kick(body, dir[0] * speed, dir[1] * speed, dir[2] * speed)
    core.living_end(body)
    thrown.set(body, { rule, from: thrower.by, t: now, hit: new Set(), tag, thing: g.thing, called: g.called })
    return ''
  }
  /** A person as a rule names them: an actor of its own by the id it gave, anyone else by their name in the world. */
  const find = (rule, id) => (typeof id === 'string' ? folk.get(`${rule.id}/${id}`) ?? folk.get(id) : undefined)

  /** Where each was last told to be, when, and how fast they were going then (cells a second): a ghost is carried on between tellings. */
  const going = new Map()
  const put = (ghost, at, yaw) => {
    // Its front the way they face: a figure's yaw is 0 to the north (-z) and a quarter turn to the east.
    const turn = (Math.PI / 2 - yaw) / 2
    core.living_place(ghost, at[0], at[1] + BOX[1] / 2, at[2], 0, Math.sin(turn), 0, Math.cos(turn))
  }
  /**
   * Between tellings a ghost goes on as its person was going. Someone at a page says where they are ten times a
   * second: at a run that is 45 cm a telling, and a shot that would have hit them passed behind. Carried on for at
   * most a fifth of a second, and only those who were moving.
   */
  function track(now = Date.now()) {
    for (const [by, g] of going) {
      const ghost = ghosts.get(by), dt = (now - g.t) / 1000
      if (!ghost || !g.moving || dt <= 0 || dt > CARRIED) continue
      put(ghost, [g.at[0] + g.v[0] * dt, g.at[1] + g.v[1] * dt, g.at[2] + g.v[2] * dt], g.yaw)
    }
  }
  /** Someone was told of: their ghost is put where they stand, or goes with them. */
  function seen(p, now = Date.now()) {
    let ghost = ghosts.get(p.by)
    // One who rides has no ghost: it would stand inside what they ride and shove it about (a kart went sideways off the street).
    if (p.gone || p.riding) { if (ghost) { core.living_vanish(ghost); ghosts.delete(p.by); whose.delete(ghost); going.delete(p.by) } return }
    // How fast they are going, from the last telling to this: no faster than anything goes here, and nothing for a jump from place to place.
    const was = going.get(p.by), dt = was ? (now - was.t) / 1000 : 0
    const v = was && dt > 0.02 && dt < 0.5 ? p.at.map((c, a) => (c - was.at[a]) / dt) : [0, 0, 0], fast = Math.hypot(...v)
    going.set(p.by, dt > 0 && dt <= 0.02 ? { ...was, at: [...p.at], yaw: p.yaw } : { at: [...p.at], yaw: p.yaw, t: now, v: fast > 500 ? [0, 0, 0] : v, moving: fast > 2 && fast <= 500 })
    if (!ghost) {
      ghost = core.living_ghost(Math.round(p.at[0]) - 2, Math.round(p.at[1]), Math.round(p.at[2]) - 1, BOX[0], BOX[1], BOX[2])
      if (!ghost) return
      ghosts.set(p.by, ghost); whose.set(ghost, p.by)
    }
    put(ghost, p.at, p.yaw)
  }
  /** Ghosts of those who are no longer there go; what was thrown long ago is forgotten. */
  function sweep(now) {
    for (const [by, ghost] of ghosts) if (!folk.has(by)) { core.living_vanish(ghost); ghosts.delete(by); whose.delete(ghost); going.delete(by) }
    for (const [body, t] of thrown) if (now - t.t > REMEMBERED) { thrown.delete(body); if (t.thing && !t.broke) lost(t.thing, t.from) }
    for (const [pair, t] of lately) if (now - t > AGAIN) lately.delete(pair)
    threw.clear(); blasted.clear(); lit.clear()
  }
  /** What the core said: who was struck by what, and what a blow would have done to someone at a page. */
  function heed(words, now) {
    if (!ghosts.size && !thrown.size) return
    const f = new Float32Array(words.buffer, words.byteOffset, words.length)
    // What was thrown and broke: its pieces are the same throw, and strike nobody it has struck.
    let pieces = null
    // The rows of cells the core last put into the world, one after another: a body that came to rest is told as those, then as gone.
    let laid = []
    const i32 = new Int32Array(words.buffer, words.byteOffset, words.length)
    for (let i = 0; i < words.length;) {
      const tag = words[i], n = words[i + 1], at = i + 2
      if (tag === 1) { for (let k = at + 6; k + 5 <= at + n; k += 5) if (i32[k + 4]) laid.push(i32[k], i32[k + 1], i32[k + 2], i32[k + 3], i32[k + 4]) }
      // A held thing that was thrown and lies still is a made thing again where it lies; one that broke is no thing any more.
      else if (tag === 3) { const t = thrown.get(words[at]); if (t?.thing && !t.broke) { thrown.delete(words[at]); if (laid.length) rested(t.thing, t.from, laid); else lost(t.thing, t.from) } }
      if (tag !== 1) laid = []
      if (tag === 6) { pieces = thrown.get(words[at]) ?? null; if (pieces?.thing && !pieces.broke) { pieces.broke = true; lost(pieces.thing, pieces.from) } }
      else if (tag === 2 && pieces) thrown.set(words[at], { ...pieces, t: now })
      else if (tag === 10 && (words[at] === 0 || words[at + 1] === 0)) {
        // What was thrown met the world, and no body: its rule hears where, once for each thing thrown.
        const body = words[at] || words[at + 1], t = thrown.get(body)
        if (t && !t.landed && !pieces) {
          t.landed = true
          const kind = words[at + (words[at] ? 8 : 7)], thrower = t.from && folk.get(t.from)
          // The rule that threw it hears; thrown by a person themselves, with no rule asking, every rule does.
          const landed = { at: [f[at + 2], f[at + 3], f[at + 4]].map((v) => Math.round(v)), speed: Math.round(f[at + 5]), met: MATERIALS[kind & 15] ?? 'ground', ...(thrower ? { from: who(thrower) } : {}), ...(t.tag ? { tag: t.tag } : {}) }
          if (t.rule) hear(t.rule, 'landed', landed); else happen('landed', landed)
        }
      } else if (tag === 10) {
        const a = words[at], b = words[at + 1], hit = whose.has(a) ? a : whose.has(b) ? b : 0, other = hit === a ? b : a
        const p = hit && folk.get(whose.get(hit)), pair = `${hit}:${other}`
        // What was thrown strikes each person once: it bounces off them, falls at their feet and would be told again.
        if (p && other && !whose.has(other) && !lately.has(pair) && !thrown.get(other)?.hit.has(hit)) {
          lately.set(pair, now)
          thrown.get(other)?.hit.add(hit)
          const from = thrown.get(other), living = thing(other), kind = words[at + (hit === a ? 8 : 7)]
          const thrower = from?.from && folk.get(from.from)
          const by = from ? { kind: 'thrown', rule: from.rule, ...(thrower ? { from: who(thrower) } : {}), material: MATERIALS[kind & 15], ...(from.thing ? { thing: from.thing, called: from.called } : {}), ...(from.tag ? { tag: from.tag } : {}) } : living ? { kind: 'thing', id: living } : { kind: 'loose', material: MATERIALS[kind & 15] }
          const where = [f[at + 2], f[at + 3], f[at + 4]]
          const e = { whom: who(p), by, speed: Math.round(f[at + 5]), push: Math.round(f[at + 6]), at: where.map(Math.round), up: Math.max(0, Math.min(1, (where[1] - p.at[1]) / BOX[1])) }
          // An actor's own rule hears of it with the id it gave; everyone hears of a person or a seat.
          if (p.rule) hear(p.rule, 'struck', { ...e, whom: { ...e.whom, mine: true } }); else happen('struck', e)
        }
      } else if (tag === 13) {
        const p = folk.get(whose.get(words[at]))
        // Someone at a page: their own page moves their body, and is sent the speed the blow gives it.
        if (p && !p.rule && !p.seat) post({ blow: { by: p.by, push: [f[at + 1], f[at + 2], f[at + 3]].map((v) => Math.round(v * 10) / 10) } })
      }
      i = at + n
    }
  }
  return {
    seen, sweep, heed, track,
    /**
     * Someone throws what they hold themselves, with no rule asking (#246): the way their eyes look, a little up, at
     * a throw's pace. Every rule hears thrown, and landed (there is no rule that threw it). Says why not, or nothing.
     */
    toss(by, way, now = Date.now()) {
      const thrower = folk.get(by), long = Array.isArray(way) ? Math.hypot(...way) : 0
      if (!thrower || thrower.rule) return 'nobody of that name has a body here'
      if (!(long > 0)) return 'a throw goes somewhere'
      const lifted = [way[0] / long, way[1] / long + 0.18, way[2] / long], l = Math.hypot(...lifted), dir = lifted.map((v) => v / l)
      const from = [thrower.at[0] + dir[0] * AHEAD, thrower.at[1] + CHEST + 3, thrower.at[2] + dir[2] * AHEAD]
      return fling(thrower, from, dir, OWN_THROW, undefined, 'own', now)
    },
    /** `world.throw({from, at, to, speed, size, material})`: something thrown from a body or a place, at someone or a place, or along a way. */
    throw(rule, w, now, wrong) {
      const n = (threw.get(rule.id) ?? 0) + 1
      threw.set(rule.id, n)
      if (n > THROWS_A_SECOND) return wrong(`a rule throws at most ${THROWS_A_SECOND} things a second`)
      const thrower = find(rule, w.from)
      if (!thrower && !three(w.from)) return wrong('a throw is from someone (an id of world.people) or from a place: from: [x, y, z]')
      const target = find(rule, w.at)
      if (!target && !three(w.at) && !(three(w.to) && w.to.some((v) => v !== 0))) return wrong('a throw is at someone or a place (at), or along a way (to: [dx, dy, dz])')
      const speed = w.speed ?? 300, size = w.size ?? 1, material = MATERIALS.indexOf(w.material ?? 'steel')
      if (typeof speed !== 'number' || !(speed >= SPEED[0] && speed <= SPEED[1])) return wrong(`a throw's speed is ${SPEED[0]} to ${SPEED[1]} cells a second`)
      if (!Number.isInteger(size) || size < SIZE[0] || size > SIZE[1]) return wrong(`a thrown thing's size is ${SIZE[0]} to ${SIZE[1]}: the half of a ball, in cells`)
      if (material < 1 || material === 5) return wrong(`a thrown thing is made of one of: ${MATERIALS.filter((m, i) => i > 0 && i !== 5).join(', ')}`)
      if (w.stays !== undefined && typeof w.stays !== 'boolean') return wrong('whether a thrown thing stays where it stops is true or false')
      if (w.tag !== undefined && (typeof w.tag !== 'string' || w.tag.length > 24)) return wrong('a thrown thing\'s tag is a word of the rule\'s own, up to 24 letters: it comes back when the thing lands')
      const start = thrower ? [thrower.at[0], thrower.at[1] + CHEST, thrower.at[2]] : w.from
      let way = target ? [target.at[0] - start[0], target.at[1] + CHEST - start[1], target.at[2] - start[2]] : three(w.at) ? w.at.map((v, a) => v - start[a]) : w.to
      const far = Math.hypot(...way)
      if (!(far > 0)) return wrong('a throw goes somewhere')
      // Aimed at someone or a place it is lifted by as much as it will drop on the way there.
      if (target || three(w.at)) way = [way[0], way[1] + 0.5 * 98 * (far / speed) ** 2, way[2]]
      const long = Math.hypot(...way), dir = way.map((v) => v / long)
      // From a body it starts clear of it, the way it goes.
      const from = thrower ? start.map((v, a) => v + dir[a] * (AHEAD + size)) : start
      // What the thrower holds, if that is what is thrown (#246): the thing itself leaves the hand as a body of its own
      // cells, and lies as those cells where it stops. A living thing is made of them, pushed, and let go of at once.
      if (w.held !== undefined && typeof w.held !== 'boolean') return wrong('held is true to throw what the thrower holds')
      if (w.held === true) {
        const why = thrower ? fling(thrower, from, dir, speed, rule.id, w.tag, now) : 'held: true throws what someone holds: from is someone who holds a thing (world.people shows holds)'
        if (why) wrong(why)
        return
      }
      const words = core.bodies_throw(from[0], from[1], from[2], dir[0] * speed, dir[1] * speed, dir[2] * speed, size, material)
      const said = new Uint32Array(core.memory.buffer, core.bodies_words(), words)
      for (let i = 0; i < said.length; i += 2 + said[i + 1]) if (said[i] === 2) {
        thrown.set(said[i + 2], { rule: rule.id, from: thrower?.by, t: now, hit: new Set(), tag: w.tag })
        // Unless it is to stay, it passes: where it stops it is gone, and no street fills with shot.
        if (!w.stays) core.bodies_passing(said[i + 2])
      }
      told(words)
    },
    /** `world.blast({at, radius, spark})`: breaks what stands within so many cells of a place, as an ask from anyone does. */
    blast(rule, w, now, wrong) {
      if (!three(w.at)) return wrong('a blast is at a place: at: [x, y, z]')
      const radius = w.radius ?? 8
      if (!Number.isInteger(radius) || radius < 1 || radius > BLAST_MOST) return wrong(`a blast's radius is a whole number of cells from 1 to ${BLAST_MOST}`)
      const n = (blasted.get(rule.id) ?? 0) + 1
      blasted.set(rule.id, n)
      if (n > BLASTS_A_SECOND) return wrong(`a rule sets off at most ${BLASTS_A_SECOND} blasts a second`)
      blast(w.at.map(Math.round), radius, w.spark === true)
    },
    /** `world.ignite({at, radius})`: lights what burns within so many cells of a place. */
    ignite(rule, w, now, wrong) {
      if (!three(w.at)) return wrong('a fire is lit at a place: at: [x, y, z]')
      const radius = w.radius ?? 2
      if (!Number.isInteger(radius) || radius < 1 || radius > FIRE_MOST) return wrong(`a fire is lit within a whole number of cells from 1 to ${FIRE_MOST}`)
      const n = (lit.get(rule.id) ?? 0) + 1
      lit.set(rule.id, n)
      if (n > FIRES_A_SECOND) return wrong(`a rule lights at most ${FIRES_A_SECOND} fires a second`)
      ignite(w.at.map(Math.round), radius)
    },
    /** `world.push(id, {to, speed})`: someone is pushed along a way. */
    push(rule, w, now, wrong) {
      const p = find(rule, w.id)
      if (!p) return wrong('a push is on someone: an id of world.people')
      if (!three(w.to) || !w.to.some((v) => v !== 0) || typeof w.speed !== 'number' || !(w.speed > 0 && w.speed <= PUSH_MOST)) return wrong(`a push is along a way, to: [dx, dy, dz], at a speed up to ${PUSH_MOST} cells a second`)
      const long = Math.hypot(...w.to), v = w.to.map((d) => Math.round((d / long) * w.speed * 10) / 10)
      // Someone at a page is moved by their own page; a body the world walks is put on the ground by a hard push.
      if (!p.rule && !p.seat) return post({ blow: { by: p.by, push: v } })
      if (w.speed >= 30) { p.down = now + 2500; p.goal = null; tell(p) }
    },
    /** `world.down(id, {for})`: someone is on the ground for so many seconds; none gets them up. */
    down(rule, w, now, wrong) {
      const p = find(rule, w.id), seconds = w.for ?? 3
      if (!p) return wrong('who is put on the ground is someone: an id of world.people')
      if (typeof seconds !== 'number' || !(seconds >= 0 && seconds <= DOWN_MOST)) return wrong(`someone is on the ground for 0 to ${DOWN_MOST} seconds`)
      p.down = now + seconds * 1000
      if (seconds > 0) p.goal = null
      if (!p.rule && !p.seat) post({ blow: { by: p.by, down: seconds } })
      tell(p)
    },
  }
}
