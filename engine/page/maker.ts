// The maker in the page (#526): a visitor exploring a realm the page runs alone (local.ts `making`) has a thing made
// with no helper and no world's server. The maker is the engine's own (make/maker.mjs, as make.mjs and the helper run
// it); what it asks of a world is answered here from this page's own, and what it sends is laid as the page lays its
// own edits (main.ts `lay`: the picture, the sectors and the mover all told). Fetched only once the visitor is in the
// realm and first uses the bar (ask.ts `later`); the shelf beside the page (sf/build.mjs `shelf/`) only then too.
//
// What is answered here, and how:
//   at, look, tops   this page's own core (main.ts `core`): every edit the page has made is in it. `tops` counts a
//                    living thing as standing over the ground under its body, as a world's process does.
//   stands           a fresh core that holds the city's tiles round the thing (bay.ts `need`) and nobody's edits: the
//                    world as its rules make it, as a world's server asks it of a core of the maker's own
//   send             laid at once; there if the page's core then has its cells, `fell` if they come loose within the
//                    settling time (what an edit leaves unheld is let fall by the mover, which takes it out of the
//                    world as the page's own cuts and blasts are). A living thing is brought to life by this page's
//                    own solver (living.ts `spawn`), its cells never laid.
//   things           this page's own records (things.ts), told as a world's echo would tell them
//
// Only what is kept is made in this step; a model is another lane's to connect.
import type { Ask, Asker, Done, Guess, Stage, Target } from './ask.ts'
import type { Edit } from './edits.ts'
import type { Hud } from './hud.ts'
import type { Living, Making as Spawned, Thing as Alive } from './living.ts'
import type { Things } from './things.ts'
import { STREAM, heroes, need, place } from './bay.ts'
import * as maker from '../make/maker.mjs'
import * as words from '../make/meant.mjs'
import * as seen from '../make/shown.mjs'
import * as cores from '../make/core.mjs'
import * as places from '../make/place.mjs'

type V3 = [number, number, number]
type Row = [number, number, number, number, number]
// The maker's modules are JavaScript, shared with Node: here they are given the types this file holds them to.
type Made = Record<string, unknown> & { state: Done['state'] | 'undone' | 'gone' | 'kept' | 'dry'; id?: string; name?: string; why?: string }
type Looks = { grain: number; low: V3; size: V3; faces: Uint32Array<ArrayBuffer> }
const make = maker.make as unknown as (o: object) => Promise<Made>, putHeld = maker.put as unknown as (o: object) => Promise<Made>, undoMade = maker.undo as unknown as (o: object) => Promise<Made>
const placing = maker.placing as unknown as (o: object) => Promise<{ origin?: V3; facing?: string; why?: string }>, keptThing = maker.kept as unknown as (entry: unknown) => Promise<unknown>
const meant = words.meant as unknown as (text: string, shelf: Entry[]) => { entry: Entry; sure: number } | null, recalled = words.recalled as unknown as (entry: unknown) => object
const shown = seen.shown as unknown as (thing: unknown, facing: string) => Looks, compiled = cores.compiled as unknown as (core: string) => Promise<WebAssembly.Module>
const beside = places.beside as unknown as (rows: Row[]) => V3, bounds = places.bounds as unknown as (rows: Row[]) => [V3, V3], editOf = places.edit as unknown as (rows: Row[], kind?: number, grain?: number) => number[], samples = places.samples as unknown as (rows: Row[]) => number[][]
/** What the page lends the maker (main.ts, in the bar's wiring). */
export interface Seam {
  /** This page's own core: told of every edit it lays. */
  core: { world_kind(x: number, y: number, z: number): number; ground_at(x: number, z: number): number }
  /** Lays an edit as the page lays its own, asking the mover what it left unheld at `release`. False: the page would not take it (finer cells a box of the world will not hold). */
  lay(edit: Edit, release: V3): boolean
  made: Things
  alive: Living
  eye(): { eye: V3; toward: V3 }
  by(): string
  hud: Hud
  /** The shelf's folder beside the page (sf/build.mjs writes it). */
  shelf: string
  /** The page's core, for the fresh one `stands` asks. */
  core_url: string
  /** Has the page's core hold the finest tiles round a place (bay.ts `underfoot`): what is asked of it there is the city, not water. */
  hold(x: number, z: number): Promise<unknown>
}
/** What the shelf's index says of each kept thing: what the word rule reads (make/meant.mjs `meant`). */
interface Entry { id: string; wish: string; words: string[]; name: string; apart: string; fields: string[] }
/** Words that take the last made thing out again. */
const UNDO = /^\s*(please\s+)?(undo|unmake|take (that|it) (back|out|away))\s*[.!]?\s*$/i
/** How long a thing laid must keep its cells before it is said to stand (ms): as a world's server waits (make/served.mjs `send`). */
const SETTLE = 1500

export interface PageMaker extends Asker {
  /** Takes the last thing made in this page out again. */
  unmake(): Promise<Done>
}

export function pageMaker(seam: Seam): PageMaker {
  const { core, made, alive } = seam
  // ── The shelf ──
  let shelf: Promise<Entry[]> | null = null
  const index = () => (shelf ??= fetch(`${seam.shelf}index.json`).then((r) => { if (!r.ok) throw new Error(`the shelf said ${r.status}`); return r.json() as Promise<Entry[]> }).then((all) => {
    // The bar offers what is kept to start from: words nothing kept answers would make nothing here.
    seam.hud.line.starters = all.filter((e) => e.apart === '').map((e) => e.wish).slice(0, 4)
    return all
  }).catch((e) => { shelf = null; throw e }))
  const records = new Map<string, Promise<Record<string, unknown>>>()
  const record = (id: string) => { if (!records.has(id)) records.set(id, fetch(`${seam.shelf}${id}.json`).then((r) => { if (!r.ok) throw new Error(`the shelf said ${r.status}`); return r.json() }).catch((e) => { records.delete(id); throw e })); return records.get(id)! }
  const things = new Map<string, Promise<unknown>>()
  const thingOf = (id: string) => { if (!things.has(id)) things.set(id, record(id).then((r) => keptThing(r)).catch((e) => { things.delete(id); throw e })); return things.get(id)! }

  // ── The world, as the maker asks it (make/maker.mjs `World`) ──
  const kind = (x: number, y: number, z: number) => core.world_kind(x, y, z)
  /** Living things made here, by their record's id; and the looks the maker kept for them, by the name `keepLook` gave. */
  const bodies = new Map<string, Alive>(), looks = new Map<string, Uint16Array>()
  let looked = 0
  const tell = (thing: Record<string, unknown>, rows: Row[], grain: number, by: string) => {
    const e = editOf(rows, undefined, grain)
    made.heard({ by, thing: { ...(thing as { id: string }), by, ...(grain > 1 ? { grain: grain as 4 | 8 } : {}) }, edit: e, box: boxOf(rows, grain) }, true)
  }
  const takeOut = (id: string) => {
    const t = made.all.get(id)
    if (!t) return false
    const body = bodies.get(id)
    if (body) { alive.vanish(body); bodies.delete(id) } else {
      const g = t.grain ?? 1, rows: Row[] = []
      for (let i = 0; i + 4 < t.cells.length; i += 5) rows.push([t.cells[i], t.cells[i + 1], t.cells[i + 2], t.cells[i + 3], 0])
      const coarse = g === 1 ? rows : rows.map((r) => [Math.floor(r[0] / g), Math.floor((r[1] - 1) / g) + 1, Math.floor(r[2] / g), Math.floor(r[3] / g), 0] as Row)
      seam.lay({ words: Int32Array.from(editOf(rows, 0, g)), box: boxOf(rows, g) }, beside(coarse))
    }
    made.heard({ by: '', gone: id }, true)
    return true
  }
  const pause = (ms: number) => new Promise((r) => setTimeout(r, ms))
  const world = {
    address: 'this page',
    async at([x, y, z]: V3) { const k = kind(x, y, z); return { kind: k, material: k & 15, ground: core.ground_at(x, z) } },
    /** The first cell along a line that is not air, within 800 cells (as a world's process looks: world.mjs `look`). */
    async look(from: V3, to: V3) {
      const long = Math.hypot(...to) || 1
      let last: number[] = []
      for (let far = 0; far <= 800; far += 0.5) {
        const c = from.map((v, a) => Math.floor(v + (to[a] / long) * far)) as V3
        if (c.every((v, a) => v === last[a])) continue
        last = c
        const k = kind(c[0], c[1], c[2])
        if (k) return { at: c, kind: k, material: k & 15, far: Math.round(far) }
      }
      return { at: null, kind: 0, material: 0, far: 800 }
    },
    async tops([x0, z0, x1, z1]: [number, number, number, number], from: number) {
      const high: (number | null)[] = [], material: number[] = []
      // A living thing's cells are not in the world while it lives: where its body is now stands in for them.
      const near = alive.things.flatMap((t) => { const w = alive.where(t); if (!w) return []; const reach = Math.hypot(t.size[0], t.size[2]) / 2 + 1; return w.at[0] + reach >= x0 && w.at[0] - reach <= x1 && w.at[2] + reach >= z0 && w.at[2] - reach <= z1 ? [{ at: w.at, reach, top: w.at[1] + t.size[1] / 2 }] : [] })
      for (let z = z0; z < z1; z++) for (let x = x0; x < x1; x++) {
        let y = from, k = 0
        for (; y > from - 400 && !(k = kind(x, y, z)); y--);
        for (const b of near) if (Math.hypot(x + 0.5 - b.at[0], z + 0.5 - b.at[2]) <= b.reach && b.top > (k ? y : -Infinity)) { y = Math.min(Math.floor(b.top), from); k = 1 }
        high.push(k ? y : null); material.push(k & 15)
      }
      return { high, material }
    },
    async things() { return [...made.all.values()].map(({ cells, ...rest }) => rest) },
    async thing(id: string) { const t = made.all.get(id); return t ? { ...t, cells: [...t.cells], ridden: !!bodies.get(id) && alive.riding === bodies.get(id) } : null },
    /** A look is not sent anywhere: it is kept here, under a name of this page's, for the living thing it is on. */
    async keepLook(parts: { size: V3; per: number; low: V3; kinds: Uint16Array }[]) { return parts.map((p) => { const kept = `look-${++looked}`; looks.set(kept, p.kinds); return { size: p.size, per: p.per, low: p.low, kept } }) },
    async empty(edits: Row[][]) { for (const rows of edits) seam.lay({ words: Int32Array.from(editOf(rows)), box: boxOf(rows, 1) }, beside(rows)) },
    async send(rows: Row[], by: string, { kind: as, thing, gone, replaces, fine, settle = SETTLE }: { kind?: number; thing?: Record<string, unknown> & { id: string; name: string; controls?: Record<string, unknown> }; gone?: string; replaces?: string; fine?: { grain: number; rows: Row[] }; settle?: number } = {}) {
      if (gone) return takeOut(gone) ? { state: 'there' } : { state: 'not there', why: 'nothing of that id is made here (409)' }
      if (replaces) takeOut(replaces)
      // A living thing: brought to life by this page's own solver, from its body's cells where they would be laid.
      const controls = thing?.controls as { scheme?: string; motor?: unknown; seats?: V3[]; eye?: V3; fine?: { size: V3; per: number; low: V3; kept: string }[] } | undefined
      if (thing && controls?.motor) {
        const g = grid(rows)
        if (!g) return { state: 'not there', why: 'a living body is at most 96 cells along a side' }
        const making = { name: thing.name, cells: g.cells, size: g.size, low: g.low, motor: controls.motor, controls: controls.scheme ?? 'drive', ...(controls.seats ? { seats: controls.seats } : {}), ...(controls.eye ? { eye: controls.eye } : {}), fine: (controls.fine ?? []).flatMap((f) => { const cells = looks.get(f.kept); return cells ? [{ size: f.size, per: f.per, low: f.low, cells }] : [] }) } as unknown as Spawned
        // (A throw is answered as not there, so the journal says so and `undo` never takes it for the last thing made.)
        const body = await alive.spawn(making).catch(() => null)
        if (!body?.id) return { state: 'not there', why: 'this page could not bring it to life' }
        body.ref = thing.id
        bodies.set(thing.id, body)
        tell(thing, rows, 1, by)
        return { state: 'there' }
      }
      const laid = fine ? fine.rows : rows, grain = fine?.grain ?? 1
      let took = false
      // (A throw part way may have laid some of it: as a world that stopped answering, `unknown`, which undo still takes out.)
      try { took = seam.lay({ words: Int32Array.from(editOf(laid, as, grain)), box: boxOf(laid, grain) }, beside(rows)) } catch (e) { return { state: 'unknown', why: `this page could not finish laying it (${(e as Error).message})` } }
      if (!took) return { state: 'not there', why: 'this page refused it: a box of the world 6.4 m a side would hold too many finer cells' }
      if (thing) tell(thing, laid, grain, by)
      // As a world's server tells: its cells are there, and still there once whatever was going to come loose has.
      const cells = samples(rows).map((c) => (fine ? [c[0], c[1], c[2], as === 0 ? 0 : -1] : c))
      const seen = () => cells.filter(([x, y, z, want]: number[]) => { const k = kind(x, y, z); const w = as ?? want; return w === -1 ? k !== 0 : k === w }).length
      if (seen() < cells.length) return { state: 'not there', why: `only ${seen()} of ${cells.length} cells asked after are there` }
      await pause(settle)
      const stayed = seen()
      return stayed === cells.length ? { state: 'there' } : { state: 'fell', why: `${cells.length - stayed} of ${cells.length} cells asked after came loose` }
    },
  }

  // ── Would it stand: a fresh core with the city's tiles round it, and nobody's edits ──
  const fresh = async (rows: Row[]) => {
    const c = new WebAssembly.Instance(await compiled(seam.core_url), {}).exports as unknown as { bay_begin(): void; bay_hero(sort: number, x: number, z: number, foot: number, turn: number): number }
    if (STREAM) c.bay_begin()
    for (const h of await heroes()) { if (h.only === 'night') continue; const at = place(h.at[0], h.at[1]), toward = place(h.toward[0], h.toward[1]); c.bay_hero(h.sort, Math.round(at.x), Math.round(at.z), Math.round(h.foot * 10), Math.round(Math.atan2(toward.z - at.z, toward.x - at.x) * 1e6)) }
    const [lo, hi] = bounds(rows)
    // Tiles that did not come would be judged as water: nothing would stand, and the model would be asked again for nothing.
    // As a place that will not take it (`place`): a thing made is held for the asker to put somewhere, not thrown away.
    if (!(await need(c, lo[0] - 64, lo[2] - 64, hi[0] + 65, hi[2] + 65, 1))) throw Object.assign(new Error('the city round it could not be loaded'), { place: true })
    return c
  }

  // ── Writing down: in this page, for as long as it is open ──
  const lines: Record<string, unknown>[] = []
  const journal = { note: async (line: Record<string, unknown>) => { lines.push({ at: new Date().toISOString(), ...line }) }, lines: async () => lines }

  /** Where an ask goes: what it aims at, from where the eye was when it was asked. */
  const where = (target: Target | undefined, from: { eye: V3; toward: V3 }) => {
    const point = target && 'point' in target ? target.point : target && 'box' in target ? [(target.box[0] + target.box[3]) / 2, target.box[1], (target.box[2] + target.box[5]) / 2] : null
    const toward = point ? point.map((v, a) => v - from.eye[a]) as V3 : from.toward
    return { from: from.eye, toward: Math.hypot(...toward) > 0 ? toward : from.toward }
  }
  /** Things made that no place would take, kept a while for the asker to say where. */
  const holds = new Map<string, unknown>(), asked = new WeakMap<Done, { eye: V3; toward: V3 }>()
  let tokens = 0
  const ended = (r: Made): Done => {
    let held: string | undefined
    if (r.state === 'held') { held = `held-${++tokens}`; holds.set(held, r.hold); if (holds.size > 8) holds.delete(holds.keys().next().value!) }
    return { stage: 'done', state: r.state === 'there' || r.state === 'fell' || r.state === 'not there' || r.state === 'unknown' || r.state === 'held' ? r.state : 'refused', why: r.why as string | undefined, id: r.id as string | undefined, name: r.name as string | undefined, at: r.origin as V3 | undefined, size: r.size as V3 | undefined, ms: r.ms as number | undefined, tries: r.tries as number | undefined, moved: r.moved as number | undefined, left: r.left as number | undefined, held }
  }
  const refused = (why: string): Done => ({ stage: 'done', state: 'refused', why })
  /** One thing at a time, in the order asked. */
  let last: Promise<unknown> = Promise.resolve(), busy = 0
  const turn = async (work: () => Promise<Done>, each: (stage: Stage) => void): Promise<Done> => {
    if (busy++) each({ stage: 'waiting', ahead: busy - 1 })
    const before = last
    let free!: () => void
    last = new Promise<void>((r) => { free = r })
    await before
    let done: Done
    try { done = await work() } catch (e) { console.info(`not made: ${(e as Error).message}`); done = refused('this page could not make it') } finally { free(); busy-- }
    each(done)
    return done
  }
  const said = (each: (stage: Stage) => void) => (_words: string, stage?: Stage) => { if (stage) each(stage) }
  const places = new Map<string, Promise<{ origin?: V3; facing?: string; why?: string }>>()
  const facesOf = new Map<string, Promise<Looks>>()
  const look = (id: string, facing: string) => { const key = `${id} ${facing}`; if (!facesOf.has(key)) facesOf.set(key, thingOf(id).then((t) => shown(t, facing))); return facesOf.get(key)! }

  const unmake = async (): Promise<Done> => {
    const r = await undoMade({ world, by: seam.by(), journal })
    if (r.state === 'undone') { seam.hud.notice(`${r.name}: taken out again`, 4000); return { stage: 'done', state: 'there', id: r.id, name: r.name } }
    return refused(r.state === 'refused' ? 'nothing made here is left to take out' : r.why ?? 'it could not be taken out')
  }

  const self: PageMaker = {
    aim: null,
    kept: null,
    known: true,
    get busy() { return busy },
    hello: async () => true,
    async guess(words) {
      const g = meant(words, (await index()).filter((e) => e.apart === ''))
      if (!g) return null
      const e = g.entry, thing = await thingOf(e.id), from = seam.eye()
      await seam.hold(from.eye[0], from.eye[2])
      const key = `${e.id} ${from.eye.join()} ${from.toward.map((v) => v.toFixed(2)).join()}`
      if (!places.has(key)) { places.set(key, placing({ world, where: where(undefined, from), thing }).catch((err: Error) => ({ why: err.message }))); if (places.size > 64) places.delete(places.keys().next().value!) }
      const at = await places.get(key)!
      if (at.why || !at.origin || !at.facing) return { id: e.id, name: e.name, sure: g.sure }
      const s = await look(e.id, at.facing), origin = at.origin
      return { id: e.id, name: e.name, sure: g.sure, placed: { facing: at.facing, at: origin.map((v, a) => v + s.low[a] / s.grain) as V3, grain: s.grain, size: s.size } } satisfies Guess
    },
    async faces(id, facing) { try { return (await look(id, facing)).faces } catch { return null } },
    ask(ask: Ask, each = () => {}) {
      // Where the eye is and what is aimed at are as they were when it was asked, not when its turn comes.
      const from = seam.eye(), target = ask.target ?? self.aim?.(), chose = ask.kept ?? (ask.wish && !ask.picture && !ask.link && !ask.fresh && !ask.hand ? self.kept?.(ask.wish) : undefined)
      return turn(async () => {
        if (ask.wish && UNDO.test(ask.wish)) return unmake()
        if (ask.picture || ask.link || !ask.wish) return refused('a picture or a link needs an AI connected to make it')
        const shelf = (await index()).filter((e) => e.apart === (ask.hand ? 'hand' : ''))
        // The ghost's thing, if the words as they were sent still mean it; else what they mean now.
        // (The ghost's own thing is what the words as they were sent still mean, or the words are made as they say: one rule.)
        void chose
        const entry = meant(ask.wish, shelf)?.entry
        if (!entry) return refused('nothing kept is called that, and making new things needs an AI connected')
        each({ stage: 'known', name: entry.name })
        const [kept] = await Promise.all([record(entry.id), seam.hold(from.eye[0], from.eye[2])])
        const r = await make({ wish: ask.wish, world, where: where(target, from), by: seam.by(), journal, core: fresh, ...recalled(kept), say: said(each) })
        const done = ended(r)
        if (done.state === 'held') asked.set(done, from)
        return done
      }, each)
    },
    put(held, how, each = () => {}) {
      const from = how.clear ? asked.get(held) ?? seam.eye() : seam.eye(), target = how.clear ? undefined : self.aim?.()
      return turn(async () => {
        const hold = held.held ? holds.get(held.held) : undefined
        if (!hold) return refused('that is not held any more: ask for it again')
        holds.delete(held.held!)
        await seam.hold(from.eye[0], from.eye[2])
        const done = ended(await putHeld({ hold, world, where: where(target, from), clear: how.clear, by: seam.by(), journal, core: fresh, say: said(each) }))
        if (done.state === 'held') asked.set(done, from)
        return done
      }, each)
    },
    // The last thing taken out in its turn, after whatever is being made: not while one is still settling.
    rule: async (_wish, how, each = () => {}) => { if (how?.undo) return turn(unmake, each); const done = refused('rules need an AI connected'); each(done); return done },
    realm: async (_spec, each = () => {}) => { const done = refused('a realm is not made here'); each(done); return done },
    imagine: async () => null,
    drivable: async () => false,
    call: async () => null,
    unmake: () => turn(unmake, () => {}),
  }
  return self
}

/** The box of the world's cells that rows of cells `grain` to one of the world's lie in (the high corner not included). */
function boxOf(rows: Row[], grain: number): [number, number, number, number, number, number] {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity]
  for (const [x0, x1, y, z] of rows) {
    lo[0] = Math.min(lo[0], Math.floor(x0 / grain)); hi[0] = Math.max(hi[0], Math.floor((x1 - 1) / grain) + 1)
    lo[1] = Math.min(lo[1], Math.floor(y / grain)); hi[1] = Math.max(hi[1], Math.floor(y / grain) + 1)
    lo[2] = Math.min(lo[2], Math.floor(z / grain)); hi[2] = Math.max(hi[2], Math.floor(z / grain) + 1)
  }
  return [lo[0], lo[1], lo[2], hi[0], hi[1], hi[2]]
}

/** A living body's cells from the rows it would be laid as, from their low corner (as a world's process reads them: world.mjs `grid`). */
function grid(rows: Row[]): { cells: Int32Array; size: V3; low: V3 } | null {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity]
  for (const [x0, x1, y, z] of rows) { lo[0] = Math.min(lo[0], x0); hi[0] = Math.max(hi[0], x1); lo[1] = Math.min(lo[1], y); hi[1] = Math.max(hi[1], y + 1); lo[2] = Math.min(lo[2], z); hi[2] = Math.max(hi[2], z + 1) }
  const size = hi.map((h, a) => h - lo[a]) as V3
  if (!size.every((s) => s >= 1 && s <= 96)) return null
  const cells = new Int32Array(size[0] * size[1] * size[2])
  for (const [x0, x1, y, z, k] of rows) for (let x = x0; x < x1; x++) cells[x - lo[0] + size[0] * (z - lo[2] + size[2] * (y - lo[1]))] = k
  return { cells, size, low: lo as V3 }
}

