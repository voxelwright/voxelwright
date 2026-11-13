// What is seen at the place while a thing is being made (#244). A model takes a quarter of a minute to a minute,
// and until it has answered nobody knows the thing's shape: only where it will stand. So the wait is the world's
// own stuff coming together there: loose cells lift off the ground round the place, are drawn in and circle it;
// when the model has answered and the thing's size is known (a second or two before it is placed and sent) they
// close into a box of that size; when it arrives they fall inwards onto it in
// a puff of dust, and it stands there whole. If nothing can be made they lose their hold, drop, and lie a moment.
// Nothing half-made is ever shown, because nothing of the thing is shown until it is all there.
//
// It is only for the eye, and only on the page that asked: the cubes are drawn with the crumbs a blast throws
// (crumbs.ts `carried`), they are not cells of the world, and nothing collides with them. Cells put at the place
// for the wait would be in the way of the thing itself (the maker asks that its place is clear).
import type { Ask, Stage } from './ask.ts'
import type { Crumbs } from './crumbs.ts'
import type { Making } from './making.ts'
import type { Puffs } from './puffs.ts'
import type { Things } from './things.ts'

/** How many cubes gather for one thing. */
const CUBES = 220
/** What they are the colour of: the town's own plaster, brick, wood, stone and steel, and a few that glow a little. */
const TONES: readonly (readonly [number, number, number])[] = [[0.3, 0.28, 0.24], [0.24, 0.1, 0.07], [0.26, 0.18, 0.1], [0.17, 0.18, 0.2], [0.09, 0.1, 0.12], [0.36, 0.35, 0.33], [0.9, 0.6, 0.2]]

interface Cube { at: [number, number, number]; speed: [number, number, number]; turn: number; far: number; high: number; fast: number; edge: number; tone: readonly [number, number, number]; from: number; on: [number, number, number]; size: number }
interface Site {
  /** gather: circling the place. falter: a reply could not be used, they sink and rise again. close: into the box the thing will fill. land: onto the thing. fall: nothing was made. */
  phase: 'gather' | 'falter' | 'close' | 'land' | 'fall'
  /** Seconds since it began, and since its phase did. */
  t: number; since: number
  centre: [number, number, number]; half: [number, number, number]; floor: number
  cubes: Cube[]; id?: string
}

export interface Gather {
  /** Moves the cubes on `dt` seconds. */
  step(dt: number): void
  /** How many places things are being made at, as this page shows it. */
  readonly sites: number
  /** How many cubes are in the air. */
  readonly cubes: number
}

export function gather(debris: Crumbs, smoke: Puffs, wish: Making, things: Things): Gather {
  const sites = new Map<Ask, Site>()
  const phase = (s: Site, to: Site['phase']) => { s.phase = to; s.since = 0 }
  wish.on((stage: Stage, ask: Ask) => {
    let s = sites.get(ask)
    if (stage.stage === 'place' && s) {
      // A held thing being put somewhere else: the same cubes go there.
      s.centre = [stage.at[0] + 0.5, stage.at[1] + 1, stage.at[2] + 0.5]; s.floor = s.centre[1]
      phase(s, 'gather')
    } else if (stage.stage === 'place') {
      // The looked-at place: its top is where the thing will stand.
      const centre: [number, number, number] = [stage.at[0] + 0.5, stage.at[1] + 1, stage.at[2] + 0.5]
      s = { phase: 'gather', t: 0, since: 0, centre, half: [8, 11, 8], floor: centre[1], cubes: [] }
      for (let i = 0; i < CUBES; i++) {
        const turn = Math.random() * Math.PI * 2, out = 26 + Math.random() * 34
        s.cubes.push({
          // They start on the ground round the place, a few metres off, and come in over the first seconds.
          at: [centre[0] + Math.cos(turn) * out, centre[1] + 0.5, centre[2] + Math.sin(turn) * out], speed: [0, 0, 0],
          turn, far: 0.35 + 0.65 * Math.sqrt(Math.random()), high: Math.random(), fast: (0.7 + Math.random() * 0.9) * (Math.random() < 0.12 ? -1 : 1),
          edge: 0.6 + Math.random() * 1.1, tone: TONES[Math.random() < 0.06 ? 6 : Math.floor(Math.random() * 6)], from: Math.random() * 3.5,
          on: [Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1], size: 0,
        })
      }
      sites.set(ask, s)
    } else if (!s) return
    else if (stage.stage === 'asking' && stage.try > 1) phase(s, 'falter')
    else if (stage.stage === 'shaped') {
      // Now its size is known: the cubes close into the box it will fill, each to a place on that box's faces. It
      // will stand behind the place looked at, its front there (the maker's rule), so that is where the box is.
      const [w, h, d] = stage.size, across = stage.facing === 'east' || stage.facing === 'west'
      const back = { south: [0, -1], north: [0, 1], east: [-1, 0], west: [1, 0] }[stage.facing] ?? [0, 0]
      s.half = [(across ? d : w) / 2 + 1.5, h / 2 + 1.5, (across ? w : d) / 2 + 1.5]
      s.centre = [s.centre[0] + back[0] * d / 2, s.floor + h / 2, s.centre[2] + back[1] * d / 2]
      if (s.phase !== 'close') for (const c of s.cubes) { const face = Math.floor(Math.random() * 3); c.on[face] = c.on[face] < 0 && face !== 1 ? -1 : 1 }
      phase(s, 'close')
    } else if (stage.stage === 'refused') {
      // That shape could not be used: the box comes apart again.
      if (s.phase === 'close') phase(s, 'gather')
    } else if (stage.stage === 'sending') {
      // Where it will stand, exactly.
      s.centre = [stage.at[0] + 0.5, stage.at[1] + stage.size[1] / 2, stage.at[2] + 0.5]
      s.floor = stage.at[1]
      s.id = stage.id
    } else if (stage.stage === 'done') {
      if (stage.state === 'there') { if (s.phase !== 'land') land(s) }
      // Held: it is made and waits for the asker to say where. The cubes keep circling.
      else if (stage.state === 'held') phase(s, 'gather')
      else {
        // Nothing was made: they are let go where they are, and fall.
        for (const c of s.cubes) c.speed = [(Math.random() - 0.5) * 14, Math.random() * 10, (Math.random() - 0.5) * 14]
        phase(s, 'fall')
      }
    }
  })
  const land = (s: Site) => {
    phase(s, 'land')
    // Dust where it comes down, pale, round its foot.
    smoke.dust([s.centre[0], s.floor + 1, s.centre[2]], Math.max(s.half[0], s.half[2]) + 2, 7, [0.8, 0.78, 0.74])
  }
  // The thing's cells come in the world's stream a second or two before the helper says it is done: they land then.
  things.on((what, thing, live) => { if (what !== 'made' || !live) return; for (const s of sites.values()) if (s.id === thing.id && s.phase !== 'land') land(s) })
  debris.carried.add((put) => { for (const s of sites.values()) for (const c of s.cubes) if (c.size > 0.02) put(c.at[0], c.at[1], c.at[2], c.edge * c.size, c.tone[0], c.tone[1], c.tone[2]) })

  return {
    get sites() { return sites.size },
    get cubes() { let n = 0; for (const s of sites.values()) n += s.cubes.length; return n },
    step(dt) {
      for (const [ask, s] of sites) {
        s.t += dt; s.since += dt
        if (s.phase === 'falter' && s.since > 1.6) phase(s, 'gather')
        if ((s.phase === 'land' && s.since > 0.7) || (s.phase === 'fall' && s.since > 4.5)) { sites.delete(ask); continue }
        // The ring breathes, and is tighter and quicker the longer it has been going: something is coming of it.
        const going = Math.min(1, s.t / 20), ring = (9 + 5 * Math.sin(s.t * 0.7)) * (1.15 - 0.3 * going)
        for (const c of s.cubes) {
          if (s.phase === 'fall') {
            c.speed[1] -= 98 * dt
            for (let a = 0; a < 3; a++) c.at[a] += c.speed[a] * dt
            const floor = s.floor + c.edge / 2
            if (c.at[1] < floor) { c.at[1] = floor; c.speed[1] = Math.abs(c.speed[1]) * 0.3; c.speed[0] *= 0.6; c.speed[2] *= 0.6 }
            // They lie a moment and are gone, one after another.
            c.size = Math.max(0, Math.min(1, (3 + c.high * 1.2 - s.since) / 0.4))
            continue
          }
          if (s.t < c.from) continue
          c.turn += c.fast * (1.1 + going) * dt * (s.phase === 'close' ? 0.25 : 1)
          let to: [number, number, number], pull = 3.2
          if (s.phase === 'gather') to = [s.centre[0] + Math.cos(c.turn) * ring * c.far, s.centre[1] + 2 + c.high * 24 + Math.sin(s.t * 1.3 + c.turn * 3) * 1.6, s.centre[2] + Math.sin(c.turn) * ring * c.far]
          else if (s.phase === 'falter') to = [s.centre[0] + Math.cos(c.turn) * ring * 1.7 * c.far, s.centre[1] + 0.5 + c.high * 3, s.centre[2] + Math.sin(c.turn) * ring * 1.7 * c.far]
          else if (s.phase === 'close') { to = [s.centre[0] + c.on[0] * s.half[0], s.centre[1] + c.on[1] * s.half[1], s.centre[2] + c.on[2] * s.half[2]]; pull = 4.5 }
          else { to = [s.centre[0] + c.on[0] * s.half[0] * 0.3, s.centre[1] + c.on[1] * s.half[1] * 0.5, s.centre[2] + c.on[2] * s.half[2] * 0.3]; pull = 9 }
          const ease = 1 - Math.exp(-dt * pull)
          for (let a = 0; a < 3; a++) c.at[a] += (to[a] - c.at[a]) * ease
          // Each grows as it lifts off, and is gone into the thing as it lands.
          c.size = s.phase === 'land' ? Math.max(0, 1 - s.since / 0.45) : Math.min(1, c.size + dt * 2.5)
        }
      }
    },
  }
}
