// Problems on the street (#118): someone who wants something, and a test the world itself runs
// to tell when they have it. A problem is data: who has it and where they stand, what they
// say, and the test (their body past a line, their feet higher than a height, a made thing
// between their head and the sun). No model decides that a problem is solved.
// Whoever has the problem is a resident like any other, walked by the world: they try what is
// made for them with their own body, and what does not hold them, or cannot be climbed, fails
// in front of everyone. A model may write their lines when they are spoken to, try something
// or are helped; without one they say what is written here.
import type { Vec3 } from '../../home/src/engine/core.ts'
import { GRADE, TRENCH, onStreet, planeAt } from './ground.ts'
import { doorOf, houseAt } from './houses.ts'
import { NORMAL_UP, standing } from './walk.ts'
import type { Self } from './wire.ts'

const LEN = Math.hypot(1, GRADE)
/** The trench in the world's own z. */
const GAP = { from: TRENCH.from / LEN, to: TRENCH.to / LEN }
/** Towards the sun, as the sky has it (home/src/sky.ts): what stands on that line from someone's head shades them. */
const SUN: Vec3 = (([x, y, z]) => { const l = Math.hypot(x, y, z); return [x / l, y / l, z / l] as Vec3 })([-0.52, 0.78, -0.35])

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
  /** What the world checks: their own body past a line down the street; their feet this high over the road, standing; a made thing between their head and the sun. */
  test: { kind: 'across'; past: number } | { kind: 'up'; high: number } | { kind: 'shaded' }
}

/** The block's three: a way across, somewhere high, some shade. */
export const PROBLEMS: Problem[] = [
  {
    id: 'across', who: { name: 'Mabel', plush: 0, scarf: '#2f8f83', at: onStreet(-2.6, TRENCH.from - 1.7) },
    about: 'Mabel, who keeps the corner shop further down the hill, dry and quick. The road is dug up: a trench six metres wide and two deep lies between her and her shop. She cannot jump it or climb out of it. She wants something to walk across on, and will try anything that reaches both sides.',
    wants: 'They dug up the road and my shop is on the other side. Could you make me something to walk across on?',
    thanks: 'Across at last. Thank you!', done: 'got Mabel across the trench',
    test: { kind: 'across', past: GAP.to + 1.2 },
  },
  {
    id: 'up', who: { name: 'Otis', plush: 1, scarf: '#f08a3c', at: onStreet(3.6, -15) },
    about: 'Otis, eleven, hopeful, a little shy. He has heard you can see the whole bay and the red bridge from up high, but he is small and the houses are in the way. He wants something tall he can climb and stand on. He can go up steps and slopes, not up a sheer side.',
    wants: 'I want to see the bay over the rooftops. Could you make me something tall I can climb up on?',
    thanks: 'I can see the bridge from up here!', done: 'got Otis up high',
    test: { kind: 'up', high: 1.4 },
  },
  {
    id: 'shade', who: { name: 'Ines', plush: 2, scarf: '#d65a9a', at: doorOf(houseAt(6, 1)) },
    about: 'Ines, a potter who lives at No. 114, warm and busy. She is out on the pavement by her door, setting pots to dry, and the afternoon sun is right on her. She wants something to stand under for shade: anything big enough, she is not fussy.',
    wants: 'The sun is right on me out here. Could you make me a bit of shade to stand under?',
    thanks: 'Oh, that is better. You are a star!', done: 'made Ines some shade',
    test: { kind: 'shaded' },
  },
]

export interface Box { x0: number; x1: number; z0: number; z1: number }
/** A made thing as it stands now: its name, who made it, and the ground it is over. */
export interface MadeNow { id: string; label: string; by: string; box: Box }
/** A problem solved: who had it, who helped, and with what (a made thing's name, or nothing they made). */
export interface Solved { problem: string; who: string; solver: string; with: string; done: string; at: string }

/** What the problems ask of the world process. */
export interface Stage {
  /** A resident the world itself walks: sat down as this figure in this scarf, standing here. Returns its seat. */
  join(name: string, plush: number, scarf: string, at: Vec3): number
  stand(id: number, at: Vec3): void
  self(id: number): Self | null
  drive(id: number, to: { x: number; z: number; jump: boolean } | null): void
  say(id: number, words: string): void
  /** Everyone else on the street, and what has been made. */
  others(): { name: string; at: Vec3 }[]
  made(): MadeNow[]
  /** Takes made things off the street (what solved a problem is cleared before it opens again). */
  sweep(ids: string[]): void
  /** The first thing a line from a point meets (the toy it belongs to), or null: `along` is the way and how far. */
  meets(from: Vec3, along: Vec3, not: number): string | null
  /** What someone wants, over their head for everyone ('' when they want nothing now). */
  wants(by: number, who: string, text: string): void
  solved(by: number, entry: Solved): void
  /** A line in their own words, when a model speaks for them: null, or nothing in time, leaves the written one. */
  line?(about: string, moment: string, signal: AbortSignal): Promise<string | null>
}

/** Trying a made thing with their own body: walking over it, or climbing it from one side after another. */
type Attempt =
  | { kind: 'cross'; thing: MadeNow | null; x: number; lined: boolean; since: number }
  | { kind: 'climb'; thing: MadeNow; side: number; lined: boolean; since: number; best: number }

interface Running {
  problem: Problem
  seat: number
  /** Open until solved; then resting until `until`, when what solved it is cleared and it opens again. */
  open: boolean
  until: number
  /** Made things they have already tried, and fallen from or could not get up. */
  tried: Set<string>
  attempt?: Attempt
  /** Back on their feet at this time, after a fall. */
  up?: number
  /** The made thing that solved it, to be cleared before it is wanted again. */
  by?: string
  spoke: number
}

const HEARS = 9, TRY = /\b(try|go|cross|come|walk)\b/i
/** The four sides a climber comes at a thing from: west, uphill, east, downhill. */
const SIDES: [number, number][] = [[-1, 0], [0, -1], [1, 0], [0, 1]]

/** The street's problems, run by the world: who stands where, what each wants, whether each is solved. */
export class Problems {
  private running: Running[] = []
  private checked = 0

  constructor(private stage: Stage, private restMs = 180_000, problems: Problem[] = PROBLEMS) {
    for (const problem of problems) {
      const seat = stage.join(problem.who.name, problem.who.plush, problem.who.scarf, problem.who.at)
      stage.drive(seat, { x: 0, z: 0, jump: false })
      this.running.push({ problem, seat, open: true, until: 0, tried: new Set(), spoke: -Infinity })
    }
  }

  /** What is wanted now, for a page that has just sat down and for an agent's `look`: who, in their words, and where they stand. */
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
      if (r.open && r.problem.test.kind === 'across' && !r.attempt && TRY.test(text)) { r.attempt = { kind: 'cross', thing: null, x: me.p[0], lined: true, since: now }; this.speak(r, 'All right. Here I go.', `Someone said: "${text}". You agree to try walking across where you stand.`); continue }
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
      if (!r.open) { if (now >= r.until && this.clearOf(r)) this.reopen(r); continue }
      if (!r.attempt && r.up === undefined) this.lookForSomething(r, now)
      const how = this.passes(r)
      if (how) this.solve(r, how, now)
    }
  }

  /** How high their feet are over the road. */
  private feet(me: Self) {
    return me.p[1] - standing(NORMAL_UP) - planeAt(me.p[2])
  }

  /** The test itself. Returns who helped and with what, or null while it is not passed. */
  private passes(r: Running): { solver: string; with: string; id?: string } | null {
    const test = r.problem.test, me = this.stage.self(r.seat)
    if (!me) return null
    const tried = r.attempt?.thing ?? null
    if (test.kind === 'across') {
      if (me.p[2] < test.past || this.feet(me) < -0.5) return null
      const nearest = this.stage.others().map((o) => ({ ...o, d: Math.hypot(o.at[0] - me.p[0], o.at[2] - me.p[2]) })).sort((a, b) => a.d - b.d)[0]
      const thing = tried ?? this.stage.made().filter((m) => me.p[0] > m.box.x0 - 0.5 && me.p[0] < m.box.x1 + 0.5 && m.box.z0 < GAP.to && m.box.z1 > GAP.from).pop()
      return { solver: thing?.by ?? nearest?.name ?? 'Someone', with: thing?.label ?? '' }
    }
    if (test.kind === 'up') {
      // Up, and standing there: not on the way past the top of a jump or a fall.
      if (this.feet(me) < test.high || !me.grounded || Math.abs(me.v[1]) > 0.4) return null
      const thing = tried ?? this.stage.made().filter((m) => me.p[0] > m.box.x0 - 0.4 && me.p[0] < m.box.x1 + 0.4 && me.p[2] > m.box.z0 - 0.4 && me.p[2] < m.box.z1 + 0.4).pop()
      return thing ? { solver: thing.by, with: thing.label, id: thing.id } : null
    }
    // From the top of their head towards the sun: a made thing in the way is shade. (A tree or a house is not theirs to thank anyone for.)
    const over = this.stage.meets([me.p[0], me.p[1] + 0.8, me.p[2]], [SUN[0] * 14, SUN[1] * 14, SUN[2] * 14], r.seat)
    const thing = over && this.stage.made().find((m) => m.id === over)
    return thing ? { solver: thing.by, with: thing.label, id: thing.id } : null
  }

  private solve(r: Running, how: { solver: string; with: string; id?: string }, now: number) {
    r.open = false
    r.by = how.id
    r.until = now + this.restMs
    r.attempt = undefined
    const entry: Solved = { problem: r.problem.id, who: r.problem.who.name, solver: how.solver, with: how.with, done: r.problem.done, at: new Date().toISOString() }
    this.stage.wants(r.seat, r.problem.who.name, '')
    this.stage.solved(r.seat, entry)
    this.speak(r, r.problem.thanks, `It is done: ${how.solver} ${r.problem.done}${how.with ? ` with ${how.with}` : ''}. Thank them, and say one thing about how it was done.`)
  }

  /** Whether what solved it can be cleared now: nobody is on the way across or down in the trench. (A bridge is not swept from under anyone.) */
  private clearOf(r: Running) {
    return r.problem.test.kind !== 'across' || !this.stage.others().some((o) => o.at[2] > GAP.from - 1 && o.at[2] < GAP.to + 1)
  }

  /** After the rest: what solved it is cleared, they are back at their place, and it is wanted again. */
  private reopen(r: Running) {
    if (r.problem.test.kind === 'across') this.stage.sweep(this.stage.made().filter((m) => m.box.z0 < GAP.to && m.box.z1 > GAP.from).map((m) => m.id))
    else if (r.by) this.stage.sweep([r.by])
    r.by = undefined
    this.stage.stand(r.seat, r.problem.who.at)
    r.open = true
    r.tried.clear()
    this.stage.wants(r.seat, r.problem.who.name, r.problem.wants)
  }

  /** A made thing worth trying with their own body: one that reaches both sides of the trench, or one near enough to climb. */
  private lookForSomething(r: Running, now: number) {
    const test = r.problem.test, me = this.stage.self(r.seat)
    if (!me || test.kind === 'shaded') return
    const fresh = this.stage.made().filter((m) => !r.tried.has(m.id))
    if (test.kind === 'across') {
      const way = fresh.filter((m) => m.box.z0 < GAP.from + 0.4 && m.box.z1 > GAP.to - 0.4).pop()
      if (!way) return
      const mid = (way.box.x0 + way.box.x1) / 2, room = Math.max(0, (way.box.x1 - way.box.x0) / 2 - 0.5)
      // Across where it is nearest to them, short of its edges.
      r.attempt = { kind: 'cross', thing: way, x: Math.max(mid - room, Math.min(mid + room, me.p[0])), lined: false, since: now }
      this.speak(r, 'Oh! Let me try that.', `Someone has put ${way.label} across the trench. You are about to try walking over it.`)
      return
    }
    const home = r.problem.who.at
    const near = fresh.filter((m) => Math.hypot((m.box.x0 + m.box.x1) / 2 - home[0], (m.box.z0 + m.box.z1) / 2 - home[2]) < 9).pop()
    if (!near) return
    r.attempt = { kind: 'climb', thing: near, side: 0, lined: false, since: now, best: 0 }
    this.speak(r, 'Is that for me? Let me try to get up.', `Someone has made ${near.label} near you. You are about to try climbing it.`)
  }

  /** Where they put their feet this tick. */
  private walk(r: Running, now: number) {
    const me = this.stage.self(r.seat)
    if (!me) return
    const still = () => this.stage.drive(r.seat, { x: 0, z: 0, jump: false })
    const towards = (x: number, z: number, near = 0.25) => {
      const dx = x - me.p[0], dz = z - me.p[2], d = Math.hypot(dx, dz)
      if (d < near) still()
      else this.stage.drive(r.seat, { x: dx / d, z: dz / d, jump: false })
      return d < near
    }
    const home = r.problem.who.at
    if (r.up !== undefined) {
      if (now < r.up) return
      r.up = undefined
      this.stage.stand(r.seat, home)
    }
    // Helped, they stay where they got to until the problem opens again; wanting, they keep to their place.
    if (!r.open) return still()
    const a = r.attempt
    if (!a) return void towards(home[0], home[2], 0.4)
    const giveUp = (written: string, moment: string, fell = false) => {
      if (a.thing) r.tried.add(a.thing.id)
      r.attempt = undefined
      if (fell) { r.up = now + 2200; still() }
      this.speak(r, written, moment)
    }
    if (a.kind === 'cross') {
      // Into the trench: that was not a way across. Up again in a moment, and not onto that thing twice.
      if (this.feet(me) < -1.1) return giveUp(a.thing ? 'Oof! Not that one.' : 'Oof! There is nothing to walk on.', `You tried to walk across${a.thing ? ` on ${a.thing.label}` : ' with nothing there'} and fell into the trench. You are unhurt.`, true)
      if (now - a.since > 14_000) return giveUp('I cannot get onto that.', `You tried to get onto ${a.thing?.label ?? 'the way across'} and could not: something is in the way.`)
      if (!a.lined) a.lined = towards(a.x, GAP.from - 0.9)
      else towards(a.x, GAP.to + 3)
      return
    }
    // Climbing: at the thing from one side, walking in over its middle; a side that does not take them up is followed by the next.
    const box = a.thing.box, mid: [number, number] = [(box.x0 + box.x1) / 2, (box.z0 + box.z1) / 2], [sx, sz] = SIDES[a.side]
    a.best = Math.max(a.best, this.feet(me))
    if (now - a.since > 6000) {
      if (a.side === SIDES.length - 1) return giveUp(a.best > 0.5 ? 'I got a little way up, but not to the top.' : 'I cannot get up on that. It has no way up.', `You tried to climb ${a.thing.label} from every side and could not get up: it has no steps or slope you can manage.`)
      r.attempt = { ...a, side: a.side + 1, lined: false, since: now }
      return
    }
    if (!a.lined) a.lined = towards(sx ? (sx < 0 ? box.x0 - 0.9 : box.x1 + 0.9) : mid[0], sz ? (sz < 0 ? box.z0 - 0.9 : box.z1 + 0.9) : mid[1], 0.35)
    else if (this.feet(me) >= (r.problem.test as { high: number }).high) still()
    // Up and over its middle, on towards its far side: wherever its top is, they pass it.
    else towards(sx ? (sx < 0 ? box.x1 - 0.5 : box.x0 + 0.5) : mid[0], sz ? (sz < 0 ? box.z1 - 0.5 : box.z0 + 0.5) : mid[1], 0.2)
  }
}
