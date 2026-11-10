// World rules and acts written from a sentence (#74), the src/theme/ask.ts pattern: the host asks
// a model for JSON; the answer is data, checked here. Rules are checked field by field and
// clamped (rules.ts checkRules), then applied all at once. Acts (set a thing alight, pour water on
// it, rain, lightning) must name a thing from the list sent with the question, and each goes
// through the world's own calls, which say why not when they refuse (steel does not burn). A
// failed call or an answer with nothing usable leaves the world as it was. A toy (#88) must stand
// on one of the surfaces offered with the question and pass every check (engine/made.ts); it is
// built first, all at once, after a snapshot, and goes on trial (./made.ts). A refused toy says
// why and changes nothing, not even the rules that came with it. A mechanic (#106) is a toy with
// one new kind of gadget whose behaviour is code: ./invent.ts puts the code in a sandbox, and the
// toy then takes the same path, on trial like any other.
import { askRules, ME } from '../villager'
import { checkRules, sameRules, type Rules } from '../engine/rules'
import { checkMadeToy, plain, type Surface } from '../engine/made'
import type { World } from '../engine/world'
import type { Vec3 } from '../engine/core'
import { prepare } from './invent'
import type { MadeToys, Spirit } from './made'
import { offered } from './surfaces'

/** What one act did: its target as asked, and null or why it did nothing. */
export interface Done { act: string; target?: string; refused: string | null }

/** A toy that was built: its id in the world, what it is called, its parts, and fields that were clamped. */
export interface MadeDone { id: string; label: string; on: string; parts: number; clamped: string[]; /** It carries an invented mechanic (#106): its kind, the functions its code defined, and ms to start its sandbox. */ mechanic?: { kind: string; hooks: string[]; loadMs: number } }

export type Asked =
  | { ok: true; note: string; rules: Rules; clamped: string[]; acts: Done[]; toy?: MadeDone; ms: number; hostMs: number; models: string[]; costUsd: number | null; outputTokens: number | null }
  /** `link`: this device is not paired: open a pairing link. `gone`: the world stopped (physics unloaded) while the model answered. */
  | { ok: false; why: 'away' | 'busy' | 'failed' | 'refused' | 'link' | 'gone'; reason?: string; acts?: Done[]; /** The answer's toy was refused: `reason` says why, in plain words. */ toy?: true; ms: number }

const asked: ({ text: string; as: AskAs } & Asked)[] = []
const MAX_ACTS = 4
/** Names offered to the model at most (the host takes 256). */
const MAX_TARGETS = 200

/**
 * The things heat and water act on, by the name a person would use: a part's own name ('sofa',
 * 'candle'), else the thing's ('crate', 'fridge'). The first of a name wins. 'fire' is kept for
 * "everything burning".
 */
export function targets(world: World) {
  const out = new Map<string, { thing: string; part: string; at: Vec3 }>()
  for (const b of world.burnables()) {
    const raw = b.part || b.thing.slice(b.thing.indexOf('/') + 1)
    const name = raw.toLowerCase().replace(/#\d+$/, '').replace(/[-_/#]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60)
    // The part is always named, '' for a thing's unnamed rest, so an act on "lounge furnish" is not an act on its sofa too.
    if (name && name !== 'fire' && !out.has(name) && out.size < MAX_TARGETS) out.set(name, { thing: b.thing, part: b.part, at: b.center })
  }
  return out
}

/** The home's things by the names the model was given, each a point now: what a mechanic's code may steer by (`w.places`). */
export function places(world: World): Record<string, Vec3> {
  const out: Record<string, Vec3> = {}
  for (const [name, t] of targets(world)) out[name] = t.at.map((v) => Math.round(v * 1e3) / 1e3) as Vec3
  return out
}

function act(world: World, named: Map<string, { thing: string; part: string }>, raw: unknown): Done {
  const a = (raw && typeof raw === 'object' ? raw : {}) as { act?: unknown; target?: unknown; seconds?: unknown }
  const kind = typeof a.act === 'string' ? a.act : ''
  const target = typeof a.target === 'string' ? a.target.toLowerCase().trim() : undefined
  const done = (refused: string | null): Done => ({ act: kind, ...(target ? { target } : {}), refused })
  if (kind === 'rain') return done(world.rain(typeof a.seconds === 'number' && Number.isFinite(a.seconds) ? Math.min(60, Math.max(5, a.seconds)) : 10))
  if (kind === 'douse' && target === 'fire') {
    const burning = world.burnables().filter((b) => world.burning(b.thing))
    if (!burning.length) return done('nothing is burning')
    for (const b of burning) world.douse(b.thing, b.part, 'ask')
    return done(null)
  }
  if (!['ignite', 'douse', 'lightning'].includes(kind)) return done('not something the world can do')
  const t = target ? named.get(target) : undefined
  if (!t) return done(`there is no ${target ?? 'thing'} here`)
  return done(kind === 'ignite' ? world.ignite(t.thing, t.part, 'ask') : kind === 'douse' ? world.douse(t.thing, t.part, 'ask') : world.strike(t.thing, t.part))
}

/** Where toys go and how they are kept: the surfaces offered for a person, and the toys on trial. */
export interface Making { surfaces: (person: string) => Surface[]; made: MadeToys }

/**
 * How a line is asked. `toy`: the router said it asks to build a toy, so the host asks with the
 * kit (quality only: everything is checked here either way). A toy ask, and `retry` (Try
 * another), builds a toy or does nothing at all: rules and acts in its answer are not applied.
 */
export interface AskAs { make?: 'toy' | 'mechanic'; retry?: boolean }

/** Changes the world's rules, acts on its things, or builds a toy, from one sentence. `person` is whose host session is billed. */
export async function ask(world: World, text: string, person = ME, making?: Making, as: AskAs = {}): Promise<Asked> {
  const t0 = performance.now()
  const named = targets(world)
  const surfaces = making?.surfaces(person) ?? []
  const r = await askRules(person, text, world.rules, [...named.keys(), 'fire'], surfaces.map(offered), as.make ?? (as.retry ? 'toy' : undefined))
  const ms = () => Math.round(performance.now() - t0)
  let out: Asked
  // The toy first: when it is refused, nothing else in the answer is applied either.
  const made = r.ok && !world.disposed && r.mechanic != null ? await makeMechanic(world, r.mechanic, surfaces, text, person, r.note, making)
    : r.ok && !world.disposed && r.toy != null && as.make !== 'mechanic' ? makeToy(r.toy, surfaces, text, person, r.note, making)
    : as.make === 'mechanic' ? 'no mechanic came back, so nothing was made' : as.retry ? 'another one did not come with a toy' : as.make === 'toy' ? 'no toy came back, so nothing was built' : undefined
  const toy = typeof made === 'string' ? undefined : made
  if (!r.ok) out = { ok: false, why: r.why, ms: ms() }
  // The model call takes up to a minute; the physics plugin may have unloaded and freed the world meanwhile.
  else if (world.disposed) out = { ok: false, why: 'gone', ms: ms() }
  else if (typeof made === 'string') out = { ok: false, why: 'refused', reason: made, toy: true, ms: ms() }
  // A toy answer builds the toy and nothing else: Undo takes it all back. Rules and acts are not applied.
  else if (as.retry || as.make === 'mechanic' || toy) out = { ok: true, note: typeof r.note === 'string' ? r.note.slice(0, 160) : '', rules: world.rules, clamped: [], acts: [], toy, ms: ms(), hostMs: Math.round(r.ms), models: r.models, costUsd: r.costUsd, outputTokens: r.outputTokens }
  else {
    // An answer that changes nothing (every field invalid or unknown, or the same as now) is not a change.
    const before = world.rules
    let applied: { ok: true; rules: Rules; clamped: string[] } | { ok: false; reason: string } | null = null
    if (r.rules !== undefined) {
      const checked = checkRules(r.rules, before)
      applied = 'reason' in checked ? { ok: false as const, reason: checked.reason } : sameRules(checked.rules, before) ? { ok: false as const, reason: 'nothing valid to change' } : world.setRules(r.rules, 'talk')
    }
    // The rules first, then the acts in order (the named things are the ones offered with the question).
    const acts = (Array.isArray(r.acts) ? r.acts : []).slice(0, MAX_ACTS).map((a) => act(world, named, a))
    const did = acts.filter((a) => !a.refused)
    if (!applied?.ok && !did.length && !toy) out = { ok: false, why: 'refused', reason: applied && !applied.ok ? applied.reason : acts[0]?.refused ?? 'nothing to do', acts, ms: ms() }
    else out = {
      ok: true,
      // Shown as text only, never as markup. When an act did nothing, say why instead of the model's hopeful note.
      note: acts.some((a) => a.refused) ? acts.map((a) => (a.refused ? `${a.target ?? a.act}: ${a.refused}.` : '')).filter(Boolean).join(' ').slice(0, 160) : typeof r.note === 'string' ? r.note.slice(0, 160) : '',
      rules: world.rules,
      clamped: applied?.ok ? applied.clamped : [],
      acts,
      ...(toy ? { toy } : {}),
      ms: ms(),
      hostMs: Math.round(r.ms),
      models: r.models,
      costUsd: r.costUsd,
      outputTokens: r.outputTokens,
    }
  }
  asked.push({ text, as, ...out })
  return out
}

export const askedSoFar = () => asked.slice()

/**
 * The toy in an answer checked and built, or why not (said to the person as it is). On the surface
 * it names; when a kept toy stands there, on another offered surface that is free and holds it.
 */
function makeToy(raw: unknown, surfaces: Surface[], text: string, person: string, note: unknown, making?: Making, mechanic?: { kind: string; spirit: (id: string, made: MadeToys) => Spirit }): MadeDone | string {
  if (!making) return "toys can't be made here"
  const on = raw && typeof raw === 'object' ? (raw as { on?: unknown }).on : undefined
  const named = surfaces.find((s) => s.id === on)
  if (!named) return `there is no ${plain(on, 40) || 'place'} here to build on`
  const id = making.made.nextId()
  const blocked = making.made.blocked(named.label)
  let surface = named
  const also = mechanic ? [mechanic.kind] : []
  let checked = checkMadeToy(raw, named, id, also)
  if (blocked) {
    const free = surfaces.filter((s) => s !== named && !making.made.blocked(s.label))
    const other = free.map((s) => ({ s, c: checkMadeToy(raw, s, id, also) })).find((o) => !('reason' in o.c))
    if (!other) return free.length ? `${blocked}, and it doesn't fit on ${free.map((s) => s.label).join(' or ')}` : blocked
    surface = other.s
    checked = other.c
  }
  if ('reason' in checked) return checked.reason
  const label = checked.toy.label
  const built = making.made.build(checked.toy, { text, person, note: typeof note === 'string' && note ? note.slice(0, 160) : `A ${label.toLowerCase()} on ${surface.label}.`, on: surface.label, height: surface.height, ...(mechanic ? { spirit: mechanic.spirit(id, making.made) } : {}) })
  if (!built.ok) return built.reason
  return { id: built.id, label, on: surface.id, parts: checked.toy.parts.length, clamped: checked.clamped }
}

/** The mechanic in an answer: its code into a sandbox, its kind into the registry, its toy checked and built; or why not, with nothing left behind. */
async function makeMechanic(world: World, raw: unknown, surfaces: Surface[], text: string, person: string, note: unknown, making?: Making): Promise<MadeDone | string> {
  if (!making) return "mechanics can't be made here"
  const ready = await prepare(world, raw, () => places(world))
  if (typeof ready === 'string') return ready
  const done = makeToy(ready.toy, surfaces, text, person, note, making, ready)
  if (typeof done === 'string') {
    ready.end(false)
    return done
  }
  return { ...done, mechanic: { kind: ready.kind, hooks: ready.hooks, loadMs: ready.loadMs } }
}
