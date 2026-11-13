// The world heard (#247): what the page already knows happens (a tool used, a blast, bodies moving and coming to
// rest, fire, rain, where the sea is, how high and how fast the eye is) turned into patches played at places and the
// levels of the beds. The page tells it; it never asks the page to do anything, and the picture goes on without it.
//
// The core does not yet say when a body strikes something (that is the living lane's, #245). Until it does, a strike
// is read here from how a body's speed changes between two tellings: a body that was moving and is suddenly not, or
// not that way, has hit. It is late by one telling and misses a glancing blow.
import { SET, type Sound } from './sound.ts'
import { BREAK, HIT, MATERIALS, WORLD } from './kinds.ts'
import type { Told } from '../told.ts'

/** What the page gives once: how to ask the land, and what is so now. */
export interface Scene {
  /** The land's own top at a column, in cells (the core's `ground_at`): under -1 is sea. */
  ground(x: number, z: number): number
  /** What sort of ground is under someone on foot there (the core's `paving_at`: 8 and over is paved). */
  paving(x: number, z: number): number
  rain(): number
  under(): boolean
  /** Some of the cells that burn: x, y, z each. */
  flames(): Float32Array
  /** Bodies still moving. */
  bodies(): number
}
/** A body as the page keeps it: how many cells, and a face of it (whose kind says what it is made of). */
interface Body { born: { cells: number; faces: Uint32Array } }

/** Cells a second a body's speed must change by, between two tellings, to count as a blow: 3 m/s. */
const BLOW = 30
/** The most blows played as themselves in one telling; the rest go into the rubble's bed. */
const BLOWS = 5
const M = 10, G = 98

export function hearing(voice: Sound, scene: Scene) {
  const seen = new Map<number, { x: number; y: number; z: number; vx: number; vy: number; vz: number; t: number; quiet: number }>()
  const eye = [0, 0, 0] as [number, number, number]
  let yaw = 0, last = [0, 0, 0], walked = 0, foot = 0, shore = { level: 0, pan: 0 }, looked = 0, grind = 0, grindPan = 0, loose = 0, clock = 0
  /** What it has played: blows heard as themselves, blows folded into the heap's grinding. */
  const count = { blows: 0, folded: 0, tellings: 0, moved: 0 }
  const stuff = (kind: number) => MATERIALS[kind & 15] ?? 'brick'
  /** How big a piece of so many cells is against a patch's own size (30 cm). */
  const sized = (cells: number) => Math.min(8, Math.max(0.4, (Math.cbrt(cells) / M) / 0.3))

  /** A blast: its crack, for those near, and its boom, which carries. Heard as late as it is far. */
  const blast = (at: readonly [number, number, number], radius: number) => {
    const reach = 6 * radius
    voice.play(WORLD.crack, { at, force: 1, size: 0.6 + radius / 20, reach: reach * 0.35 })
    voice.play(WORLD.boom, { at, force: 1, size: 0.7 + radius / 16, reach })
    grind = Math.max(grind, Math.min(0.5, radius / 50)); grindPan = voice.hear(at).pan
  }

  return {
    voice, blast, count,
    /** A tool was used and this is what it met (what the page's tools return): the stuff struck answers. */
    used(tool: string, hit: { at: readonly [number, number, number]; material: number } | null | undefined) {
      if (tool === 'Cannon') { voice.play(WORLD.shot, { force: 0.9, reach: 20 }); return }
      if (!hit) return
      const name = MATERIALS[hit.material] ?? 'brick', vary = { size: 0.9 + 0.2 * Math.random(), force: 0.75 + 0.2 * Math.random() }
      if (tool === 'Hammer') { voice.play(HIT[name] ?? HIT.brick, { at: hit.at, ...vary, reach: 5, travels: false }); voice.play(BREAK[name] ?? BREAK.brick, { at: hit.at, force: 0.55, size: vary.size, reach: 6, travels: false }) }
      else if (tool === 'Charge' || tool === 'Big charge') voice.play(BREAK[name] ?? BREAK.brick, { at: hit.at, force: 0.9, size: tool === 'Charge' ? 2 : 3.5, reach: tool === 'Charge' ? 20 : 45 })
      else if (tool === 'Torch') voice.play(WORLD.catch, { at: hit.at, force: 0.7, reach: 4 })
      else if (tool === 'Cutter') voice.play(WORLD.cut, { at: hit.at, force: 0.8, dur: 0.6, reach: 8 })
      else if (tool === 'Brick') voice.play(WORLD.place, { at: hit.at, force: 0.6, reach: 4 })
    },
    /** What the solver said, as it happens (never what a shared world kept from before): bodies loose, moving, struck, at rest; glass gone to dust; something gone up. */
    told(told: Told, moving: ReadonlyMap<number, Body>) {
      const now = performance.now() / 1000
      count.tellings++; count.moved += told.moves.length
      for (const b of told.bursts) blast(b.at, b.radius)
      for (const d of told.dust) if ((d.kind & 15) === 11 && d.amount > 2) voice.play(BREAK.glass, { at: d.at, force: Math.min(1, 0.4 + d.amount / 40), reach: 8 })
      const blows: { at: [number, number, number]; hard: number; cells: number; kind: number }[] = []
      for (const m of told.moves) {
        const was = seen.get(m.id)
        if (!was) { seen.set(m.id, { x: m.pos[0], y: m.pos[1], z: m.pos[2], vx: 0, vy: 0, vz: 0, t: now, quiet: now + 0.15 }); continue }
        const dt = now - was.t
        if (dt < 0.004) continue
        const vx = (m.pos[0] - was.x) / dt, vy = (m.pos[1] - was.y) / dt, vz = (m.pos[2] - was.z) / dt
        // What its speed changed by, beyond what falling alone would have done.
        const change = Math.hypot(vx - was.vx, vy - (was.vy - G * dt), vz - was.vz), fast = Math.hypot(was.vx, was.vy, was.vz)
        if (change > BLOW && fast > BLOW && now > was.quiet) {
          const body = moving.get(m.id)
          if (body) blows.push({ at: m.pos, hard: Math.min(change, fast), cells: body.born.cells, kind: body.born.faces[1] >> 16 })
          was.quiet = now + 0.12
        }
        was.x = m.pos[0]; was.y = m.pos[1]; was.z = m.pos[2]; was.vx = vx; was.vy = vy; was.vz = vz; was.t = now
      }
      for (const g of told.gone) seen.delete(g.id)
      for (const id of told.broke) seen.delete(id)
      if (seen.size > 4096) seen.clear()
      // The heaviest blows are heard as themselves; the rest are the grinding of the heap.
      blows.sort((a, b) => b.hard * b.cells - a.hard * a.cells)
      for (let i = 0; i < blows.length; i++) {
        const b = blows[i], force = Math.min(1, (b.hard / 160) ** 0.8) * (0.9 + 0.2 * Math.random())
        if (i < BLOWS) count.blows++; else count.folded++
        if (i < BLOWS) voice.play(HIT[stuff(b.kind)] ?? HIT.brick, { at: b.at, force, size: sized(b.cells) * (0.9 + 0.2 * Math.random()), reach: 3 + Math.cbrt(b.cells) / 2, travels: false })
        else loose += force
      }
      if (blows.length > BLOWS) grindPan = voice.hear(blows[BLOWS].at).pan
    },
    /** Once a frame: where the ears are, and the beds brought to what is so there. */
    frame(at: readonly [number, number, number], facing: number, dt: number) {
      eye[0] = at[0]; eye[1] = at[1]; eye[2] = at[2]; yaw = facing
      clock += dt
      const under = scene.under(), ground = scene.ground(Math.round(eye[0]), Math.round(eye[2])), high = Math.max(0, (eye[1] - Math.max(ground, 0)) / M)
      const speed = Math.hypot(eye[0] - last[0], eye[1] - last[1], eye[2] - last[2]) / M / Math.max(dt, 1e-3)
      voice.set(SET.under, under ? 1 : 0)
      voice.set(SET.muffle, under ? 650 : 20000)
      voice.set(SET.cover, under ? 1 : 0)
      voice.set(SET.rain, scene.rain())
      // Wind: a little always, more the higher the ears are over the land and the faster they go through the air.
      voice.set(SET.wind, Math.min(1, 0.06 + high / 400 + speed / 90 + 0.2 * scene.rain()))
      // Fire: the nearer and the more of it, the louder; it comes from where most of it is.
      const flames = scene.flames()
      let fire = 0, fx = 0, fz = 0, near = Infinity
      for (let i = 0; i < flames.length; i += 3) {
        const dx = flames[i] - eye[0], dy = flames[i + 1] - eye[1], dz = flames[i + 2] - eye[2], d = Math.hypot(dx, dy, dz) / M, w = 1 / (1 + (d / 6) ** 2)
        fire += w; fx += dx * w; fz += dz * w; near = Math.min(near, d)
      }
      const where = fire > 0 ? voice.hear([eye[0] + fx / fire, eye[1], eye[2] + fz / fire]) : null
      voice.set(SET.fire, Math.min(1, Math.sqrt(fire / 12)))
      if (where) { voice.set(SET.firePan, where.pan); voice.set(SET.fireLp, 600 + 19400 * Math.exp(-near / 60)) }
      // The sea: looked for a few times a second, eight ways round and three distances out.
      if (clock - looked > 0.4) {
        looked = clock
        let level = 0, sx = 0, sz = 0
        if (high < 300) for (const far of [15, 45, 130]) for (let a = 0; a < 8; a++) {
          const dx = Math.sin((a * Math.PI) / 4), dz = -Math.cos((a * Math.PI) / 4)
          if (scene.ground(Math.round(eye[0] + dx * far * M), Math.round(eye[2] + dz * far * M)) >= -1) continue
          const w = 1 / (1 + far / 25)
          level += w; sx += dx * w; sz += dz * w
        }
        const pan = level ? voice.hear([eye[0] + (sx / level) * 300, eye[1], eye[2] + (sz / level) * 300]).pan * Math.min(1, Math.hypot(sx, sz) / level * 1.5) : 0
        shore = { level: Math.min(1, level / 4) * Math.max(0, 1 - high / 300), pan }
      }
      voice.set(SET.surf, under ? 0 : shore.level)
      voice.set(SET.surfPan, shore.pan)
      // The heap grinding: what blows were too many to play, dying away.
      grind = Math.max(grind * Math.exp(-dt * 1.2), Math.min(0.5, loose / 10))
      loose *= Math.exp(-dt * 8)
      voice.set(SET.rumble, scene.bodies() > 0 || grind > 0.02 ? Math.min(0.55, grind + Math.min(0.15, scene.bodies() / 3000)) : 0)
      voice.set(SET.rumblePan, grindPan)
      // Steps: with the eye at head height over the ground and going at a walk or a run, a foot falls every 75 cm.
      const along = Math.hypot(eye[0] - last[0], eye[2] - last[2]) / M
      if (!under && high < 2.6 && speed > 0.4 && speed < 9) {
        walked += along
        if (walked > 0.75) {
          walked = 0; foot ^= 1
          const sort = scene.paving(Math.round(eye[0]), Math.round(eye[2]))
          voice.play(sort >= 8 || sort >= 3 ? WORLD.step : sort === 1 ? WORLD.stepLoose : WORLD.stepSoft, { force: Math.min(0.8, 0.35 + speed / 14) * (0.85 + 0.3 * Math.random()), size: 0.92 + 0.16 * Math.random(), pan: foot ? 0.12 : -0.12 })
        }
      } else walked = 0
      last = [eye[0], eye[1], eye[2]]
      voice.listen(eye, yaw)
    },
  }
}
