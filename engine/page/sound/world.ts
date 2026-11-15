// The world heard (#247): what the page already knows happens (a tool used, a blast, bodies moving and coming to
// rest, fire, rain, where the sea is, how high and how fast the eye is) turned into patches played at places and the
// levels of the beds. The page tells it; it never asks the page to do anything, and the picture goes on without it.
//
// The core does not yet say when a body strikes something (that is the living lane's, #245). Until it does, a strike
// is read here from how a body's speed changes between two tellings: a body that was moving and is suddenly not, or
// not that way, has hit. It is late by one telling and misses a glancing blow.
import { SET, type Sound } from './sound.ts'
import { BREAK, HIT, MATERIALS, WORLD } from './kinds.ts'
import { LIKES } from './likes.ts'
import { toned, patch as readPatch, type Patch } from './patch.ts'
import type { Told } from '../told.ts'
import { conductor } from './music/conductor.ts'
import { MODES, MOODS, PACE, moodKey, resolve } from './music/compose.ts'
import { played } from './things.ts'
import { speak, type Way } from './voice.ts'
import type { Things } from '../things.ts'
import type { Hud } from '../hud.ts'
import type { Input } from '../input.ts'

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
  /** The hour of the day, 0 to 24. */
  hour(): number
  /** Where someone or a living thing is shown now, by the name the world knows them by (cells): 'here' for whoever is at this page, null if they are not shown. For sounds that stay on them. */
  who?(id: string): readonly [number, number, number] | 'here' | null
  /** Whether something is being made for whoever is at this page. */
  making(): boolean
  /** What a cell is (the core's `world_kind`). */
  kind(x: number, y: number, z: number): number
  /** The made things, the layer over the picture and the keys, once the page has them: for things that sound and are played. */
  seam?(): { things: Things; hud: Hud; input: Input }
}
/** A body as the page keeps it: how many cells, and a face of it (whose kind says what it is made of). */
interface Body { born: { cells: number; faces: Uint32Array } }

/** Cells a second a body's speed must change by, between two tellings, to count as a blow: 3 m/s. */
const BLOW = 30
/** The most blows played as themselves in one telling; the rest go into the rubble's bed. */
const BLOWS = 5
const M = 10, G = 98

export function hearing(voice: Sound, scene: Scene, { music: withMusic = true } = {}) {
  const music = withMusic ? conductor(voice) : null
  /** How much is going wrong near by, 0 to 1: blasts, things coming down, fire. It dies away over some seconds. */
  let threat = 0, snow = false, snowLooked = -9, place = ''
  /** Made things that sound and are played: there once the page's own parts are (asked each frame until they are). */
  let things: ReturnType<typeof played> | null = null
  const seen = new Map<number, { x: number; y: number; z: number; vx: number; vy: number; vz: number; t: number; quiet: number }>()
  const eye = [0, 0, 0] as [number, number, number]
  let yaw = 0, last = [0, 0, 0], walked = 0, foot = 0, shore = { level: 0, pan: 0 }, looked = 0, grind = 0, grindPan = 0, loose = 0, clock = 0
  /** What it has played: blows heard as themselves, blows folded into the heap's grinding. */
  const count = { blows: 0, folded: 0, tellings: 0, moved: 0, rules: 0, spoken: 0, followed: 0 }
  const stuff = (kind: number) => MATERIALS[kind & 15] ?? 'brick'
  /** How big a piece of so many cells is against a patch's own size (30 cm). */
  const sized = (cells: number) => Math.min(8, Math.max(0.4, (Math.cbrt(cells) / M) / 0.3))

  /** A blast: its crack, for those near, and its boom, which carries. Heard as late as it is far. */
  const blast = (at: readonly [number, number, number], radius: number) => {
    // The hammer is a small blast to the engine and a blow to the ear: what it struck answers (`used`), nothing explodes.
    if (radius < 8) return
    const reach = 6 * radius
    voice.play(WORLD.crack, { at, force: 1, size: 0.6 + radius / 20, reach: reach * 0.35 })
    voice.play(WORLD.boom, { at, force: 1, size: 0.7 + radius / 16, reach })
    grind = Math.max(grind, Math.min(0.5, radius / 50)); grindPan = voice.hear(at).pan
    // A charge near by is danger; a hammer blow is not, nor a blast a long way off.
    if (radius >= 10) threat = Math.max(threat, Math.min(1, voice.hear(at, reach).gain * 3))
  }

  /** Patches rules wrote, by their JSON: the last 96 that were played. A rule can write without end; these places cannot grow. */
  const written = new Map<string, Patch>()
  const num = (v: unknown, lo: number, hi: number, or: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : or)
  /**
   * A sound a rule made (plugins/sound), as the world told it: {at, like | patch, force, size, hz, gap, for, reach}.
   * The world's process checked it; it is read again here as a stranger's, because this is where it is played.
   */
  const sounded = (v: unknown) => {
    if (!v || typeof v !== 'object') return
    const s = v as Record<string, unknown>, at = s.at
    if (!Array.isArray(at) || at.length !== 3 || !at.every((n) => typeof n === 'number' && Number.isFinite(n))) return
    let patches: Patch[], held = false
    if (typeof s.like === 'string' && Object.hasOwn(LIKES, s.like)) { patches = LIKES[s.like].patches; held = !!LIKES[s.like].held }
    else {
      const p = own(s.patch)
      if (!p) return
      patches = [p]; held = p.how === 'blown' || p.how === 'rubbed'
    }
    const hz = Array.isArray(s.hz) ? s.hz.slice(0, 8).map((n) => num(n, 16, 12000, 0)).filter((n) => n > 0) : []
    const force = num(s.force, 0.02, 1, 0.7), size = num(s.size, 0.25, 4, 1), gap = num(s.gap, 0, 1000, 0) / 1000, reach = num(s.reach, 2, 300, 10), dur = num(s.for, 0.05, 4, held ? 0.4 : 0)
    count.rules++
    const where = at as [number, number, number]
    for (let i = 0; i < Math.max(1, hz.length); i++) for (const p of patches) voice.play(p, { at: where, force: force * (0.94 + 0.12 * Math.random()), size, pitch: hz[i] ?? 0, dur, after: i * gap, reach })
  }
  /** A patch a rule wrote, read as a stranger's and kept by its JSON; null if it is not one. */
  const own = (data: unknown): Patch | null => {
    let key: string
    try { key = JSON.stringify(data) } catch { return null }
    if (!key || key.length > 1500) return null
    let p = written.get(key)
    if (!p) {
      const read = readPatch(data)
      if ('refused' in read) return null
      p = read.patch
      if (written.size >= 96) { const [oldest, gone] = written.entries().next().value!; written.delete(oldest); voice.forget(gone) }
    } else written.delete(key)
    written.set(key, p)
    return p
  }
  /**
   * Sounds that stay on someone (plugins/sound, `as`): what is so, said whenever it changes, every one of them each
   * time. Each is placed every frame where its maker is shown. One that is held is one note, moved and bent while
   * it sounds; one that is struck is made again as often as it says. Only the nearest few are sounded.
   */
  interface Follow { on: string; what: string; patches: Patch[]; held: boolean; hz: number; force: number; size: number; reach: number; every: number; ids: number[]; hzNow: number; forceNow: number; began: number; sent: number; put: string; next: number; gain: number; lost: number }
  const following = new Map<string, Follow>()
  const NEAREST = 6
  const quiet = (f: Follow) => { for (const id of f.ids) voice.release(id); f.ids = [] }
  const follows = (v: unknown) => {
    const list = v && typeof v === 'object' && Array.isArray((v as { follows?: unknown }).follows) ? (v as { follows: unknown[] }).follows.slice(0, 32) : []
    const seen = new Set<string>()
    for (const one of list) {
      if (!one || typeof one !== 'object') continue
      const s = one as Record<string, unknown>
      if (typeof s.key !== 'string' || s.key.length > 100 || typeof s.on !== 'string' || s.on.length > 100) continue
      let patches: Patch[], held: boolean, what: string
      if (typeof s.like === 'string' && Object.hasOwn(LIKES, s.like)) { patches = LIKES[s.like].patches; held = !!LIKES[s.like].held; what = s.like }
      else { const p = own(s.patch); if (!p) continue; patches = [p]; held = p.how === 'blown' || p.how === 'rubbed'; what = JSON.stringify(s.patch) }
      const every = held ? 0 : num(s.every, 80, 2000, 0) / 1000
      if (!held && !every) continue
      seen.add(s.key)
      const hz = num(s.hz, 16, 12000, 0), force = num(s.force, 0.02, 1, 0.7), size = num(s.size, 0.25, 4, 1), reach = num(s.reach, 2, 300, 10)
      const had = following.get(s.key)
      // The same sound, changed: its pitch and loudness move in the note that is sounding. Another sound, or another size, starts again.
      if (had && had.what === what && had.size === size) { had.on = s.on; had.hz = hz; had.force = force; had.reach = reach; had.every = every; continue }
      if (had) quiet(had)
      following.set(s.key, { on: s.on, what, patches, held, hz, force, size, reach, every, ids: [], hzNow: hz, forceNow: force, began: force, sent: 1, put: '', next: 0, gain: 0, lost: 0 })
    }
    for (const [key, f] of following) if (!seen.has(key)) { quiet(f); following.delete(key) }
  }
  /** Each frame: every sound that follows is put where its maker is shown, the nearest few sounded. */
  const followed = (eye: readonly [number, number, number], dt: number) => {
    if (!following.size) return
    const now = voice.context.currentTime, placed: { f: Follow; at: readonly [number, number, number] }[] = []
    for (const f of following.values()) {
      const w = scene.who?.(f.on) ?? null
      const at = w === 'here' ? eye : w
      f.gain = at ? voice.hear(at, f.reach).gain : 0
      if (at && f.gain >= 0.004) placed.push({ f, at }); else quiet(f)
    }
    placed.sort((a, b) => b.f.gain - a.f.gain)
    const named = voice.told?.named
    for (let i = 0; i < placed.length; i++) {
      const { f, at } = placed[i]
      if (i >= NEAREST) { quiet(f); continue }
      // Pitch and loudness go to what the rule last said over a third of a second: a rule speaks twice a second, and a motor does not step.
      const k = 1 - Math.exp(-dt / 0.3)
      if (f.hz > 0 && f.hzNow > 0) f.hzNow *= (f.hz / f.hzNow) ** k; else f.hzNow = f.hz
      f.forceNow += (f.force - f.forceNow) * k
      if (!f.held) {
        // Struck again as often as it says, a little unevenly, where its maker is then.
        if (now >= f.next) { f.next = Math.max(now, f.next) + f.every * (0.92 + 0.16 * Math.random()); count.followed++; for (const p of f.patches) voice.play(p, { at, force: f.force * (0.9 + 0.2 * Math.random()), size: f.size, pitch: f.hz, reach: f.reach, travels: false }) }
        continue
      }
      // A held note that is no longer among those sounding (taken, or never begun) is begun again.
      if (f.ids.length && named && now - f.lost > 2 && !f.ids.every((id) => named.includes(id))) { quiet(f); f.lost = now }
      if (!f.ids.length) {
        if (now - f.lost < 0.3 && f.lost) continue
        f.began = f.forceNow; f.lost = now; f.sent = f.hzNow || 1; f.put = ''
        for (const p of f.patches) { const id = voice.hold(p, { at, force: f.began, size: f.size, pitch: f.hzNow, reach: f.reach, travels: false, bus: 0 }); if (id) f.ids.push(id) }
        if (f.ids.length) count.followed++
        continue
      }
      const bend = f.hzNow > 0 && Math.abs(f.hzNow / f.sent - 1) > 0.0005
      // The audio thread is told only when where it is heard from, or how loud it is, has changed.
      const h = voice.hear(at, f.reach), level = Math.min(2, (f.forceNow / f.began) ** 1.2), put = `${h.gain.toFixed(3)} ${h.pan.toFixed(3)} ${Math.round(h.lp / 50)} ${level.toFixed(3)}`
      for (const id of f.ids) { if (put !== f.put) voice.place(id, at, f.reach, level); if (bend) voice.glide(id, f.hzNow) }
      f.put = put
      if (bend) f.sent = f.hzNow
    }
  }
  /** What the realm's music is like, if a rule has said: the mood's name and how much of it is in. */
  let realm: { key: string; pace: number; drive: number | null; now: boolean } | null = null
  /** How far rules lean on the music, -1 to 1 (plugins/music `lean`), and where it has got to: it is eased over a few seconds, up and back. */
  let lean = 0, leaning = 0
  /** What a rule said the realm's music is like (plugins/music), or null for the place's own: read again as a stranger's. */
  const tuned = (v: unknown) => {
    const m = v as Record<string, unknown> | null
    lean = m && typeof m === 'object' ? num(m.lean, -1, 1, 0) : 0
    if (!m || typeof m !== 'object' || typeof m.like !== 'string' || !Object.hasOwn(MOODS, m.like)) { realm = null; return }
    realm = { key: moodKey(m.like, 0, typeof m.mode === 'string' && Object.hasOwn(MODES, m.mode) ? m.mode : ''), pace: num(m.pace, PACE[0], PACE[1], 0), drive: typeof m.drive === 'number' ? num(m.drive, 0, 1, 0) : null, now: m.now === true }
  }
  return {
    voice, blast, count, music, sounded, tuned, follows,
    /** How far the music is leant on now, eased (-1 to 1). */
    get lean() { return leaning },
    /** The sounds that follow someone now, for checks: which is on whom, whether it sounds, its pitch as it is. */
    get following() { return [...following].map(([key, f]) => ({ key, on: f.on, sounding: f.held ? f.ids.length > 0 : f.gain >= 0.004, hz: f.hzNow, gain: f.gain })) },
    /** Someone said something (text, where): given a voice one of two ways, if the page asked for one (`?voices=babble` or `speech`). A direction being tried. */
    spoke(said: { name: string; text: string; at?: readonly [number, number, number] }, way: string | null) { if (way === 'babble' || way === 'speech') count.spoken += speak(voice, way as Way, said) },
    get things() { return things },
    /** Which place's music is wanted now. */
    get place() { return place },
    /** A tool was used and this is what it met (what the page's tools return): the stuff struck answers. */
    used(tool: string, hit: { at: readonly [number, number, number]; material: number } | null | undefined) {
      if (tool === 'Cannon') { voice.play(WORLD.shot, { force: 0.9, reach: 20 }); return }
      if (!hit) return
      const own = things?.hit(hit.at), ownBreak = things?.breaks(hit.at)
      const name = MATERIALS[hit.material] ?? 'brick', vary = { size: 0.9 + 0.2 * Math.random(), force: 0.75 + 0.2 * Math.random() }
      if (tool === 'Hammer') { voice.play(own ?? HIT[name] ?? HIT.brick, { at: hit.at, ...vary, reach: 5, travels: false }); voice.play(ownBreak ?? BREAK[name] ?? BREAK.brick, { at: hit.at, force: 0.55, size: vary.size, reach: 6, travels: false }) }
      else if (tool === 'Charge' || tool === 'Big charge') voice.play(ownBreak ?? BREAK[name] ?? BREAK.brick, { at: hit.at, force: 0.9, size: tool === 'Charge' ? 2 : 3.5, reach: tool === 'Charge' ? 20 : 45 })
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
      if (!things && scene.seam) try { const s = scene.seam(); things = played(voice, s.things, s.hud, s.input) } catch { /* the page has not made them yet */ }
      things?.frame(eye)
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
      // The music follows the place. Danger first and at once; then making; then where the ears are.
      if (music) {
        threat = Math.max(threat * Math.exp(-dt / 7), Math.min(1, scene.bodies() / 150), fire > 6 ? 0.6 : 0)
        if (clock - snowLooked > 2) {
          snowLooked = clock
          // Snow is white sand lying high up (the core paints surf the same, at the sea's edge).
          const k = ground > 300 ? scene.kind(Math.round(eye[0]), ground, Math.round(eye[2])) : 0
          snow = (k & 15) === 4 && k >> 8 === 1
        }
        const hour = scene.hour(), sort = scene.paving(Math.round(eye[0]), Math.round(eye[2])) & 7
        place = threat > 0.4 ? 'danger' : scene.making() ? 'making' : under || high > 2500 ? 'sea' : snow ? 'snow' : hour < 5.5 || hour > 20.5 ? 'night' : shore.level > 0.3 || sort < 2 ? 'coast' : 'town'
        // A realm whose rule has said what its music is has that, whatever the place; one that has not keeps the place's.
        // A lean lies on top of either: more or less of the music in, and its pace up or down by as much as an eighth.
        leaning = Math.abs(lean - leaning) < 0.01 ? lean : leaning + (lean - leaning) * (1 - Math.exp(-dt / 2))
        const own = realm?.pace || resolve(realm ? realm.key : place).bpm, beats = leaning ? Math.round(Math.min(PACE[1], Math.max(PACE[0], own * (1 + 0.125 * leaning)))) : realm ? realm.pace : 0
        if (realm) { place = realm.key; music.want(realm.key, realm.now, beats); realm.now = false }
        else music.want(place, place === 'danger', beats)
        const drive = realm ? realm.drive : null
        music.drive = leaning ? Math.min(1, Math.max(0, (drive ?? 0.5) + 0.5 * leaning)) : drive
        music.steady = !!realm
        music.tick()
      }
      followed(eye, dt)
      voice.listen(eye, yaw)
    },
  }
}
