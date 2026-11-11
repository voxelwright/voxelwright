// Problems on the street (#118): someone who wants something, and a test the world itself runs
// to tell when they have it. A problem is data: who has it and where they stand, what they
// say, what it brings with it (a ball on a post, a parcel), and the test (a body past a line,
// a thing below a height, a thing near a place). No model decides that a problem is solved.
// Whoever has the problem is a resident like any other, walked by the world. A model may
// write their lines when they are spoken to or helped; without one they say what is written
// here.
import type { Vec3 } from '../../home/src/engine/core.ts'
import { piecesShape, type PartSpec, type Piece, type ToySpec } from '../../home/src/engine/toy.ts'
import { GRADE, TRENCH, onStreet, planeAt } from './ground.ts'
import { doorOf, houseAt } from './houses.ts'
import { STANDING } from './scene.ts'
import type { Self } from './wire.ts'

const LEN = Math.hypot(1, GRADE)
/** The trench in the world's own z. */
const GAP = { from: TRENCH.from / LEN, to: TRENCH.to / LEN }

export interface Problem {
  id: string
  /** Who has it, which felt figure they are and the colour of their scarf, and where they stand (a point on the ground, in the world). */
  who: { name: string; plush: number; scarf: string; at: Vec3 }
  /** What they are like and what is the matter, for a model that speaks for them. */
  about: string
  /** What they say they want, and what they say when they have it: as written, when no model speaks for them. */
  wants: string
  thanks: string
  /** In a few words, for the notice everyone sees: "Pavlo got Mabel across". */
  done: string
  /** What the world checks: their own body past a line down the street; a thing of theirs lower than a height over the road; a thing of theirs near them. */
  test: { kind: 'across'; past: number } | { kind: 'down'; thing: string; below: number } | { kind: 'near'; thing: string; within: number }
  /** What the problem brings with it: built when it opens, and put back when it opens again. */
  props?: ToySpec
}

const POST: Vec3 = onStreet(6.3, -15.5), PARCEL: Vec3 = onStreet(1.8, -3.5)
/** One body of several shapes. */
const pieced = (id: string, material: string, at: Vec3, pieces: Piece[], more: Partial<PartSpec> = {}): PartSpec => ({ id, material, at, shape: piecesShape(pieces), pieces, ...more })
const IRON = '#2c3438', TAPE = '#c0392b'

/** The block's three: a way across, a ball down, a parcel home. */
export const PROBLEMS: Problem[] = [
  {
    id: 'across', who: { name: 'Mabel', plush: 0, scarf: '#2f8f83', at: onStreet(-2.6, TRENCH.from - 1.7) },
    about: 'Mabel, who keeps the corner shop further down the hill, dry and quick. The road is dug up: a trench six metres wide and two deep lies between her and her shop. She cannot jump it or climb out of it. She wants something to walk across on, and will try anything that reaches both sides.',
    wants: 'They dug up the road and my shop is on the other side. Could you make me something to walk across on?',
    thanks: 'Across at last. Thank you!', done: 'got Mabel across the trench',
    test: { kind: 'across', past: GAP.to + 1.2 },
  },
  {
    id: 'ball', who: { name: 'Otis', plush: 1, scarf: '#f08a3c', at: onStreet(4.2, -14.2) },
    about: 'Otis, eleven, hopeful, a little embarrassed. He kicked his blue ball and it landed on top of a tall post by the pavement, two and a half metres up, in a little tray. He cannot reach it. He wants it back down on the street.',
    wants: 'My ball is stuck up on that post. Can you get it down?',
    thanks: 'My ball! Thanks!', done: 'got Otis his ball back',
    test: { kind: 'down', thing: 'ball', below: 0.9 },
    props: {
      id: 'post', label: "Otis's ball on a post", frame: { at: POST, yaw: 0, tilt: 0 }, gadgets: [], wires: [], inputs: {},
      parts: [
        // A post with a little tray on top, a low rim round it: the ball sits there until something knocks it out.
        pieced('post', 'steel', [0, 0, 0], [
          { shape: { kind: 'cylinder', radius: 0.07, halfHeight: 1.36 }, at: [0, 1.36, 0], paint: IRON },
          { shape: { kind: 'box', half: [0.34, 0.025, 0.34] }, at: [0, 2.725, 0], paint: IRON },
          ...([[0.34, 0], [-0.34, 0], [0, 0.34], [0, -0.34]] as const).map(([x, z]): Piece => ({ shape: { kind: 'box', half: x ? [0.02, 0.03, 0.36] : [0.36, 0.03, 0.02] }, at: [x, 2.78, z], paint: IRON })),
        ]),
        { id: 'ball', material: 'rubber', motion: 'dynamic', mass: 0.5, paint: '#3d7de0', at: [0, 2.99, 0], shape: { kind: 'sphere', radius: 0.23 } },
      ],
    },
  },
  {
    id: 'parcel', who: { name: 'Ines', plush: 2, scarf: '#d65a9a', at: doorOf(houseAt(6, 1)) },
    about: 'Ines, a potter who lives at No. 114, warm and busy. A parcel for her was left up the street, above the trench, and it is too heavy for her to fetch. She wants it brought to her door.',
    wants: 'There is a parcel for me up the street, the one with the red tape. Could you bring it to my door?',
    thanks: 'That is the one. You are a star!', done: 'brought Ines her parcel',
    test: { kind: 'near', thing: 'box', within: 2.4 },
    props: {
      id: 'parcel', label: "Ines's parcel", frame: { at: PARCEL, yaw: 0, tilt: Math.atan(GRADE) }, gadgets: [], wires: [], inputs: {},
      parts: [pieced('box', 'paper', [0, 0.33, 0], [
        { shape: { kind: 'box', half: [0.36, 0.3, 0.3] }, at: [0, 0, 0], paint: '#c9a070' },
        { shape: { kind: 'box', half: [0.365, 0.305, 0.05] }, at: [0, 0, 0], paint: TAPE },
        { shape: { kind: 'box', half: [0.05, 0.305, 0.305] }, at: [0, 0, 0], paint: TAPE },
      ], { motion: 'dynamic', mass: 16 })],
    },
  },
]

export interface Box { x0: number; x1: number; z0: number; z1: number }
/** A made thing as it stands now: its name, who made it, and the ground it is over. */
export interface MadeNow { id: string; label: string; by: string; box: Box }
/** A problem solved: who had it, who helped, and with what (a made thing's name, or nothing they made). */
export interface Solved { problem: string; who: string; solver: string; with: string; done: string; at: string }

/** What the problems ask of the world process. */
export interface Stage {
  /** A resident the world itself walks: sat down as this figure, standing here. Returns its seat. */
  join(name: string, plush: number, scarf: string, at: Vec3): number
  stand(id: number, at: Vec3): void
  self(id: number): Self | null
  drive(id: number, to: { x: number; z: number; jump: boolean } | null): void
  say(id: number, words: string): void
  /** Everyone else on the street, and what has been made. */
  others(): { name: string; at: Vec3 }[]
  made(): MadeNow[]
  /** Takes made things off the street (the way is cleared before a problem opens again). */
  sweep(ids: string[]): void
  /** A problem's own things: built, and built again as they began. */
  prop(toy: ToySpec): void
  where(key: string): Vec3 | null
  /** What someone wants, over their head for everyone ('' when they want nothing now). */
  wants(by: number, who: string, text: string): void
  solved(by: number, entry: Solved): void
  /** A line in their own words, when a model speaks for them: null, or nothing in time, leaves the written one. */
  line?(about: string, moment: string, signal: AbortSignal): Promise<string | null>
}

interface Running {
  problem: Problem
  seat: number
  /** Open until solved; then resting until `until`, when the way is cleared and it opens again. */
  open: boolean
  until: number
  /** Made things they have already tried and fallen from. */
  tried: Set<string>
  /** Walking across now: over which thing (or none: someone said to try), along which line, since when. */
  crossing?: { thing: MadeNow | null; x: number; lined: boolean; since: number }
  /** Back on their feet at this time, after a fall. */
  up?: number
  spoke: number
}

const HEARS = 9, TRY = /\b(try|go|cross|come|walk)\b/i

/** The street's problems, run by the world: who stands where, what each wants, whether each is solved. */
export class Problems {
  private running: Running[] = []
  private checked = 0

  constructor(private stage: Stage, private restMs = 180_000, problems: Problem[] = PROBLEMS) {
    for (const problem of problems) {
      const seat = stage.join(problem.who.name, problem.who.plush, problem.who.scarf, problem.who.at)
      stage.drive(seat, { x: 0, z: 0, jump: false })
      if (problem.props) {
        stage.prop(problem.props)
        // What it brings that stands still is in a made thing's way like a lamp is: things are stood clear of it.
        for (const part of problem.props.parts) if ((part.motion ?? 'static') === 'static') STANDING.push({ x: problem.props.frame.at[0] + part.at[0], z: problem.props.frame.at[2] + part.at[2], r: 0.45, from: 0 })
      }
      this.running.push({ problem, seat, open: true, until: 0, tried: new Set(), spoke: -Infinity })
    }
  }

  /** What is wanted now, for a page that has just sat down and for an agent's `look`. */
  wanted(): { by: number; who: string; wants: string; at: Vec3 }[] {
    return this.running.filter((r) => r.open).map((r) => ({ by: r.seat, who: r.problem.who.name, wants: r.problem.wants, at: this.stage.self(r.seat)?.p ?? r.problem.who.at }))
  }

  /** Whether a seat is one of theirs (the world walks it; no page or agent does). */
  cast(id: number) {
    return this.running.some((r) => r.seat === id)
  }

  /** Someone spoke: whoever is in earshot answers, and may take "go on, try" as a reason to. */
  heard(by: number, at: Vec3, text: string, now = performance.now()) {
    for (const r of this.running) {
      const me = this.stage.self(r.seat)
      if (r.seat === by || !me || Math.hypot(me.p[0] - at[0], me.p[2] - at[2]) > HEARS || now - r.spoke < 4000) continue
      r.spoke = now
      if (r.open && r.problem.test.kind === 'across' && !r.crossing && TRY.test(text)) { r.crossing = { thing: null, x: me.p[0], lined: true, since: now }; this.speak(r, 'All right. Here I go.', `Someone said: "${text}". You agree to try walking across where you stand.`); continue }
      this.speak(r, r.open ? r.problem.wants : 'All sorted for now, thank you.', `Someone said to you: "${text}". ${r.open ? 'You still need what you need.' : 'Your trouble is over for now.'}`)
    }
  }

  /** Says a line: the written one at once when no model speaks for them, else the model's own when it comes in time. */
  private speak(r: Running, written: string, moment: string) {
    if (!this.stage.line) return this.stage.say(r.seat, written)
    this.stage.line(r.problem.about, moment, AbortSignal.timeout(9000)).then((line) => this.stage.say(r.seat, line || written), () => this.stage.say(r.seat, written))
  }

  /** Every world tick: they stand, walk and get up; ten times a second their tests are run. */
  tick(now = performance.now()) {
    for (const r of this.running) this.walk(r, now)
    if (now - this.checked < 100) return
    this.checked = now
    for (const r of this.running) {
      if (!r.open) { if (now >= r.until) this.reopen(r); continue }
      if (r.problem.test.kind === 'across' && !r.crossing && r.up === undefined) this.lookForAWay(r, now)
      const how = this.passes(r)
      if (how) this.solve(r, how, now)
    }
  }

  /** The test itself. Returns who helped and with what, or null while it is not passed. */
  private passes(r: Running): { solver: string; with: string } | null {
    const test = r.problem.test, me = this.stage.self(r.seat)
    if (!me) return null
    const nearest = (at: Vec3) => this.stage.others().map((o) => ({ ...o, d: Math.hypot(o.at[0] - at[0], o.at[2] - at[2]) })).sort((a, b) => a.d - b.d)[0]
    const madeBy = (at: Vec3, reach: number) => this.stage.made().filter((m) => at[0] > m.box.x0 - reach && at[0] < m.box.x1 + reach && at[2] > m.box.z0 - reach && at[2] < m.box.z1 + reach).pop()
    if (test.kind === 'across') {
      if (me.p[2] < test.past || me.p[1] < planeAt(me.p[2]) - 0.5) return null
      const thing = r.crossing?.thing ?? madeBy([me.p[0], 0, (GAP.from + GAP.to) / 2], 0.5)
      return { solver: thing?.by ?? nearest(me.p)?.name ?? 'Someone', with: thing?.label ?? '' }
    }
    const at = this.stage.where(`${r.problem.props!.id}/${test.thing}`)
    if (!at) return null
    if (test.kind === 'down' ? at[1] - planeAt(at[2]) > test.below : Math.hypot(at[0] - me.p[0], at[2] - me.p[2]) > test.within) return null
    const thing = madeBy(at, 2.5), helper = nearest(at)
    return { solver: (helper && helper.d < 14 ? helper.name : thing?.by) ?? 'Someone', with: thing?.label ?? '' }
  }

  private solve(r: Running, how: { solver: string; with: string }, now: number) {
    r.open = false
    r.until = now + this.restMs
    r.crossing = undefined
    const entry: Solved = { problem: r.problem.id, who: r.problem.who.name, solver: how.solver, with: how.with, done: r.problem.done, at: new Date().toISOString() }
    this.stage.wants(r.seat, r.problem.who.name, '')
    this.stage.solved(r.seat, entry)
    this.speak(r, r.problem.thanks, `It is done: ${how.solver} ${r.problem.done}${how.with ? ` with ${how.with}` : ''}. Thank them, and say one thing about how it was done.`)
  }

  /** After the rest: the way that solved it is cleared, what the problem brought is put back, and it is wanted again. */
  private reopen(r: Running) {
    const test = r.problem.test
    if (test.kind === 'across') this.stage.sweep(this.stage.made().filter((m) => m.box.z0 < GAP.to && m.box.z1 > GAP.from).map((m) => m.id))
    if (r.problem.props) this.stage.prop(r.problem.props)
    this.stage.stand(r.seat, r.problem.who.at)
    r.open = true
    r.tried.clear()
    this.stage.wants(r.seat, r.problem.who.name, r.problem.wants)
  }

  /** A made thing that reaches both sides of the trench, not yet tried: worth walking onto. */
  private lookForAWay(r: Running, now: number) {
    const way = this.stage.made().filter((m) => !r.tried.has(m.id) && m.box.z0 < GAP.from + 0.4 && m.box.z1 > GAP.to - 0.4).pop()
    if (!way) return
    const mid = (way.box.x0 + way.box.x1) / 2, room = Math.max(0, (way.box.x1 - way.box.x0) / 2 - 0.5), me = this.stage.self(r.seat)
    // Across where it is nearest to them, short of its edges.
    r.crossing = { thing: way, x: Math.max(mid - room, Math.min(mid + room, me?.p[0] ?? mid)), lined: false, since: now }
    this.speak(r, 'Oh! Let me try that.', `Someone has put ${way.label} across the trench. You are about to try walking over it.`)
  }

  /** Where they put their feet this tick. */
  private walk(r: Running, now: number) {
    const me = this.stage.self(r.seat)
    if (!me) return
    const towards = (x: number, z: number, near = 0.25) => {
      const dx = x - me.p[0], dz = z - me.p[2], d = Math.hypot(dx, dz)
      this.stage.drive(r.seat, d < near ? { x: 0, z: 0, jump: false } : { x: dx / d, z: dz / d, jump: false })
      return d < near
    }
    const home = r.problem.who.at
    if (r.up !== undefined) {
      if (now < r.up) return
      r.up = undefined
      this.stage.stand(r.seat, home)
    }
    // Helped, they stay where they got to until the problem opens again; wanting, they keep to their place.
    if (!r.open) { this.stage.drive(r.seat, { x: 0, z: 0, jump: false }); return }
    const c = r.crossing
    if (!c) { towards(home[0], home[2], 0.4); return }
    // Into the trench: that was not a way across. Up again in a moment, and not onto that thing twice.
    if (me.p[1] < planeAt(me.p[2]) - 1.1) {
      if (c.thing) r.tried.add(c.thing.id)
      r.crossing = undefined
      r.up = now + 2200
      this.stage.drive(r.seat, { x: 0, z: 0, jump: false })
      this.speak(r, c.thing ? 'Oof! Not that one.' : 'Oof! There is nothing to walk on.', `You tried to walk across${c.thing ? ` on ${c.thing.label}` : ' with nothing there'} and fell into the trench. You are unhurt.`)
      return
    }
    if (now - c.since > 14_000) {
      if (c.thing) r.tried.add(c.thing.id)
      r.crossing = undefined
      this.speak(r, 'I cannot get onto that.', `You tried to get onto ${c.thing?.label ?? 'the way across'} and could not: something is in the way.`)
      return
    }
    if (!c.lined) c.lined = towards(c.x, GAP.from - 0.9)
    else towards(c.x, GAP.to + 3)
  }
}
