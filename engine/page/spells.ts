// Spells (#246): the kept library of spells that are known, and what casts them. A known spell is done at once by
// what the engine already has, with no model. A spell is data: the words that call it, how it may be aimed, and
// deeds from the short list below. The library here is written in the same form a model's answer would take, and
// nothing in a spell is ever run: a deed names one of the things this file knows how to do, with numbers.
//
// What each deed honestly is:
//   fireball  a ball of fire seen to fly from the caster to the place, then a blast there that lights what burns.
//             The blast, the fire and what falls are the world's (everyone sees them); the flight is this page's.
//   colour    the cells keep their material and take a colour of the palette: an edit of rows. Real: it is the
//             kind of each cell that changes, for everyone, and it stays.
//   material  the cells become another material, keeping their colour: an edit of rows. Real: steel does not burn
//             and barely breaks, glass shatters, wood burns, and what they weigh and bear changes with them.
//   polish    bit 7 of the kind (kinds.rs POLISHED). A look only: the cells mirror and glint, and weigh, break
//             and burn as before.
//   size      the thing's cells are made again larger or smaller from where it stands: an edit of rows. Real
//             cells; what is in the way is left, and what then has nothing under it falls by the world's rule.
import { rows, type Edit } from './edits.ts'
import type { View } from './march.ts'
import type { Mode, Target } from './wand.ts'

export type Deed =
  | { do: 'fireball'; radius: number }
  | { do: 'colour'; colour: number }
  | { do: 'material'; material: number }
  | { do: 'polish' }
  | { do: 'size'; by: number }
export interface Spell { name: string; /** What calls it: any of these, as whole words. */ words: string[]; /** How it may be aimed. */ aim: Mode[]; deeds: Deed[] }

/** A colour of the palette (kinds.rs `colour`): 24 hues, ten tones each. */
const hue = (h: number, tone: number) => 16 + (h % 24) * 10 + (tone % 10)
const COLOURS: [string, number][] = [
  ['pink', hue(22, 2)], ['hot pink', hue(22, 4)], ['red', hue(0, 4)], ['orange', hue(2, 4)], ['yellow', hue(4, 4)], ['gold', hue(3, 4)], ['lime', hue(6, 4)],
  ['green', hue(8, 4)], ['teal', hue(10, 5)], ['cyan', hue(12, 4)], ['sky blue', hue(14, 2)], ['blue', hue(16, 4)], ['navy', hue(16, 6)], ['purple', hue(18, 4)],
  ['violet', hue(18, 3)], ['magenta', hue(20, 4)], ['brown', hue(2, 6)], ['white', 1], ['grey', 8], ['gray', 8], ['black', 15],
]
const MATERIALS: [string[], number][] = [
  [['steel', 'metal', 'iron'], 12], [['glass'], 11], [['wood', 'wooden'], 10], [['brick'], 8], [['stone', 'rock'], 2], [['concrete'], 7], [['plaster'], 9], [['leaves', 'leafy'], 13], [['grass', 'grassy'], 3], [['sand', 'sandy'], 4], [['earth', 'dirt', 'mud'], 1],
]
const CHANGE: Mode[] = ['thing', 'area', 'point']

/** The kept library. */
export const LIBRARY: Spell[] = [
  { name: 'Fireball', words: ['fireball', 'fire ball', 'ball of fire'], aim: ['point', 'thing', 'area'], deeds: [{ do: 'fireball', radius: 10 }] },
  { name: 'Great fireball', words: ['great fireball', 'big fireball', 'huge fireball'], aim: ['point', 'thing', 'area'], deeds: [{ do: 'fireball', radius: 22 }] },
  ...COLOURS.map(([name, colour]): Spell => ({ name: `Make it ${name}`, words: [name], aim: CHANGE, deeds: [{ do: 'colour', colour }] })),
  ...MATERIALS.map(([names, material]): Spell => ({ name: `Turn it to ${names[0]}`, words: names, aim: CHANGE, deeds: [{ do: 'material', material }] })),
  { name: 'Make it shiny', words: ['shiny', 'shine', 'polished', 'glossy', 'mirror'], aim: CHANGE, deeds: [{ do: 'polish' }] },
  { name: 'Twice as large', words: ['twice as large', 'twice as big', 'twice the size', 'double', 'two times'], aim: ['thing'], deeds: [{ do: 'size', by: 2 }] },
  { name: 'Three times as large', words: ['three times', 'triple'], aim: ['thing'], deeds: [{ do: 'size', by: 3 }] },
  { name: 'Half as large', words: ['half as large', 'half as big', 'half the size', 'half', 'smaller', 'shrink'], aim: ['thing'], deeds: [{ do: 'size', by: 0.5 }] },
]

/** The spell the words call, if the library knows one: the one whose calling words are longest among those said. */
export function known(text: string, library: readonly Spell[] = LIBRARY): Spell | null {
  const said = ` ${text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()} `
  let best: Spell | null = null, length = 0
  for (const spell of library) for (const w of spell.words) if (w.length > length && said.includes(` ${w} `)) { best = spell; length = w.length }
  return best
}

/** The most rows one edit may hold (serve.mjs EDIT_MOST: 16,384 numbers, five a row and two to say how many). */
export const ROWS_MOST = 3276
/** Bit 7 of a kind: polished (kinds.rs). Bit 6 is the mark of finer cells, which the core takes off every edit. */
export const POLISHED = 128

/**
 * Cells as edits of rows: runs along x of one kind, sorted as the core reads them. One edit when they fit one (and so
 * whole or not at all); more than an edit holds is several, one after another, level by level from the bottom up.
 */
export function rowsOf(cells: { x: number; y: number; z: number; kind: number }[]): { edits: Edit[]; rows: number } {
  if (!cells.length) return { edits: [], rows: 0 }
  cells.sort((a, b) => a.y - b.y || a.z - b.z || a.x - b.x)
  const runs: number[] = []
  for (let i = 0; i < cells.length;) {
    const c = cells[i]
    let j = i + 1
    while (j < cells.length && cells[j].y === c.y && cells[j].z === c.z && cells[j].x === cells[j - 1].x + 1 && cells[j].kind === c.kind) j++
    runs.push(c.x, cells[j - 1].x + 1, c.y, c.z, c.kind)
    i = j
  }
  const edits: Edit[] = []
  for (let at = 0; at < runs.length; at += ROWS_MOST * 5) {
    const part = runs.slice(at, at + ROWS_MOST * 5), box = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity]
    for (let i = 0; i < part.length; i += 5) {
      box[0] = Math.min(box[0], part[i]); box[1] = Math.min(box[1], part[i + 2]); box[2] = Math.min(box[2], part[i + 3])
      box[3] = Math.max(box[3], part[i + 1]); box[4] = Math.max(box[4], part[i + 2] + 1); box[5] = Math.max(box[5], part[i + 3] + 1)
    }
    edits.push(rows(Int32Array.from(part), box as unknown as Edit['box']))
  }
  return { edits, rows: runs.length / 5 }
}

export interface Does {
  /** What a cell is, edits and all. */
  kind(x: number, y: number, z: number): number
  /** Where someone on foot would stand at a column. */
  feet(x: number, z: number): number
  /** An edit, and where to ask what it left unheld. */
  make(edit: Edit, release: [number, number, number]): void
  /** A blast. */
  strike(at: readonly [number, number, number], radius: number, spark: boolean): void
  /** Sets alight what burns round a place. */
  light(at: [number, number, number], radius: number): void
  /** One frame of a ball of fire in flight. */
  ball(at: readonly [number, number, number], radius: number, dt: number): void
  /** A flash where a spell lands that is not a blast. */
  flash(at: readonly [number, number, number], radius: number): void
}

export interface Caster {
  /** Casts a spell at a target. Says in a few words why not, if not; null when it was cast. */
  cast(spell: Spell, target: Target | null, view: View): string | null
  /** Once a frame: what is in flight. */
  step(dt: number): void
  /** How many spells are on their way. */
  readonly flying: number
  /** What was cast, for the checks: the spell, how many cells it changed and in how many rows. */
  readonly last: { spell: string; cells: number; rows: number; edits: number } | null
}

export function caster(does: Does): Caster {
  const flights: { from: number[]; to: [number, number, number]; t: number; span: number; radius: number }[] = []
  let last: Caster['last'] = null
  /** The cells a change is done to, with their kinds. */
  const cellsOf = (target: Target) => {
    const out: { x: number; y: number; z: number; kind: number }[] = []
    if (target.how === 'thing') for (let i = 0; i < target.kinds.length; i++) out.push({ x: target.cells[i * 3], y: target.cells[i * 3 + 1], z: target.cells[i * 3 + 2], kind: target.kinds[i] })
    else {
      // An area: what stands in it and the top of the ground under it. A point: what is within three cells of it.
      const b = target.how === 'area' ? [target.box[0], target.box[1] - 1, target.box[2], target.box[3], target.box[4], target.box[5]] : [...target.at.map((v) => Math.floor(v) - 3), ...target.at.map((v) => Math.floor(v) + 4)]
      const mid = target.how === 'point' ? target.at : null
      for (let y = b[1]; y < b[4]; y++) for (let z = b[2]; z < b[5]; z++) for (let x = b[0]; x < b[3]; x++) {
        if (mid && Math.hypot(x + 0.5 - mid[0], y + 0.5 - mid[1], z + 0.5 - mid[2]) > 3.5) continue
        const kind = does.kind(x, y, z)
        if (kind) out.push({ x, y, z, kind })
      }
    }
    return out
  }
  const boxOf = (target: Target): readonly number[] => (target.how === 'point' ? [...target.at.map(Math.floor), ...target.at.map((v) => Math.floor(v) + 1)] : target.box)
  /** A cell of air beside what was changed: asked at one of its own cells, the world lets go of a thing of steel or glass whole. */
  const beside = (box: readonly number[]): [number, number, number] => {
    const x = (box[0] + box[3]) >> 1, z = (box[2] + box[5]) >> 1
    let y = box[4] + 1
    for (let i = 0; i < 40 && does.kind(x, y, z); i++) y++
    return [x, y, z]
  }
  const send = (name: string, changed: { x: number; y: number; z: number; kind: number }[], box: readonly number[]): string | null => {
    if (!changed.length) return 'Nothing there would change'
    // More than one edit holds goes as several, at once and in order: it is done, a level at a time, not refused.
    const made = rowsOf(changed), over = [(box[0] + box[3]) >> 1, 0, (box[2] + box[5]) >> 1]
    for (const edit of made.edits) does.make(edit, beside([over[0], 0, over[2], over[0], Math.max(box[4], edit.box[4]), over[2]]))
    does.flash([(box[0] + box[3]) / 2, (box[1] + box[4]) / 2, (box[2] + box[5]) / 2], Math.min(12, Math.max(2, (box[3] - box[0] + box[5] - box[2]) / 8)))
    last = { spell: name, cells: changed.length, rows: made.rows, edits: made.edits.length }
    return null
  }
  return {
    get flying() { return flights.length },
    get last() { return last },
    cast(spell, target, view) {
      if (!target) return 'Aim at something first'
      if (!spell.aim.includes(target.how)) return `${spell.name} is cast at ${spell.aim.map((a) => (a === 'thing' ? 'a thing' : a === 'area' ? 'an area' : 'a point')).join(' or ')}`
      for (const deed of spell.deeds) {
        if (deed.do === 'fireball') {
          const b = boxOf(target)
          const to: [number, number, number] = target.how === 'point' ? [target.at[0], target.at[1], target.at[2]] : target.how === 'thing' ? [target.cell[0] + 0.5, target.cell[1] + 0.5, target.cell[2] + 0.5] : [(b[0] + b[3]) / 2, b[1] + 1, (b[2] + b[5]) / 2]
          // From the caster's hand: a little ahead of the eye, low and to the right.
          const from = view.eye.map((e, a) => e + view.forward[a] * 16 + view.right[a] * 5 - view.up[a] * 4)
          const far = Math.hypot(to[0] - from[0], to[1] - from[1], to[2] - from[2])
          flights.push({ from, to, t: 0, span: Math.max(0.16, far / 420), radius: deed.radius })
          last = { spell: spell.name, cells: 0, rows: 0, edits: 0 }
          continue
        }
        const cells = cellsOf(target), box = boxOf(target)
        if (deed.do === 'colour' || deed.do === 'material' || deed.do === 'polish') {
          const to = deed.do === 'colour' ? (k: number) => (k & 0xff) | (deed.colour << 8) : deed.do === 'material' ? (k: number) => (k & 0xfff0) | deed.material : (k: number) => k | POLISHED
          const why = send(spell.name, cells.filter((c) => to(c.kind) !== c.kind).map((c) => ({ ...c, kind: to(c.kind) })), box)
          if (why) return why
        } else if (deed.do === 'size') {
          if (target.how !== 'thing') return 'Only a thing can be made larger or smaller'
          // From the middle of its foot: it stands where it stood. Each cell of the new thing is the old thing's cell
          // at that place, scaled back. What is in the way (not air, not the thing itself) is left as it is.
          const by = deed.by, mid = [(box[0] + box[3]) / 2, box[1], (box[2] + box[5]) / 2]
          const key = (x: number, y: number, z: number) => x + (y + 2048) * 1048576 + z * 4294967296
          const was = new Map<number, number>()
          for (const c of cells) was.set(key(c.x, c.y, c.z), c.kind)
          const lo = [Math.floor(mid[0] + (box[0] - mid[0]) * by), box[1], Math.floor(mid[2] + (box[2] - mid[2]) * by)]
          const hi = [Math.ceil(mid[0] + (box[3] - mid[0]) * by), box[1] + Math.ceil((box[4] - box[1]) * by), Math.ceil(mid[2] + (box[5] - mid[2]) * by)]
          const changed: { x: number; y: number; z: number; kind: number }[] = []
          for (let y = Math.min(lo[1], box[1]); y < Math.max(hi[1], box[4]); y++) for (let z = Math.min(lo[2], box[2]); z < Math.max(hi[2], box[5]); z++) for (let x = Math.min(lo[0], box[0]); x < Math.max(hi[0], box[3]); x++) {
            const own = was.get(key(x, y, z))
            const next = was.get(key(Math.floor(mid[0] + (x + 0.5 - mid[0]) / by), box[1] + Math.floor((y - box[1] + 0.5) / by), Math.floor(mid[2] + (z + 0.5 - mid[2]) / by))) ?? 0
            const now = own ?? does.kind(x, y, z)
            if (next === now || (own === undefined && now !== 0)) continue
            changed.push({ x, y, z, kind: next })
          }
          const why = send(spell.name, changed, [...lo, ...hi])
          if (why) return why
        }
      }
      return null
    },
    step(dt) {
      for (let i = flights.length - 1; i >= 0; i--) {
        const f = flights[i]
        f.t += dt
        const k = Math.min(1, f.t / f.span)
        // Three places a frame along its way, so that fast it is still a streak and not dots.
        for (let s = 0; s < 3; s++) {
          const q = Math.max(0, k - (s * dt) / (3 * f.span)), lift = Math.sin(q * Math.PI) * Math.min(12, f.span * 30)
          does.ball([f.from[0] + (f.to[0] - f.from[0]) * q, f.from[1] + (f.to[1] - f.from[1]) * q + lift, f.from[2] + (f.to[2] - f.from[2]) * q], Math.max(2.2, f.radius * 0.28), dt / 3)
        }
        if (k < 1) continue
        flights.splice(i, 1)
        const at = f.to.map(Math.round) as [number, number, number]
        does.strike(at, f.radius, true)
        does.light(at, Math.min(8, Math.round(f.radius * 0.6)))
      }
    },
  }
}
