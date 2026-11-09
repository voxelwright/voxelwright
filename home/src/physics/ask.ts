// World rules and acts written from a sentence (#74), the src/theme/ask.ts pattern: the host asks
// a model for JSON; the answer is data, checked here. Rules are checked field by field and
// clamped (rules.ts checkRules), then applied all at once. Acts (set a thing alight, pour water on
// it, rain, lightning) must name a thing from the list sent with the question, and each goes
// through the world's own calls, which say why not when they refuse (steel does not burn). A
// failed call or an answer with nothing usable leaves the world as it was.
import { askRules, ME } from '../villager'
import { checkRules, sameRules, type Rules } from '../engine/rules'
import type { World } from '../engine/world'

/** What one act did: its target as asked, and null or why it did nothing. */
export interface Done { act: string; target?: string; refused: string | null }

export type Asked =
  | { ok: true; note: string; rules: Rules; clamped: string[]; acts: Done[]; ms: number; hostMs: number; models: string[]; costUsd: number | null; outputTokens: number | null }
  /** `link`: no token, or one from an earlier launch: open the latest link. `gone`: the world stopped (physics unloaded) while the model answered. */
  | { ok: false; why: 'away' | 'busy' | 'failed' | 'refused' | 'link' | 'gone'; reason?: string; acts?: Done[]; ms: number }

const asked: ({ text: string } & Asked)[] = []
const MAX_ACTS = 4
/** Names offered to the model at most (the host takes 256). */
const MAX_TARGETS = 200

/**
 * The things heat and water act on, by the name a person would use: a part's own name ('sofa',
 * 'candle'), else the thing's ('crate', 'fridge'). The first of a name wins. 'fire' is kept for
 * "everything burning".
 */
export function targets(world: World) {
  const out = new Map<string, { thing: string; part: string }>()
  for (const b of world.burnables()) {
    const raw = b.part || b.thing.slice(b.thing.indexOf('/') + 1)
    const name = raw.toLowerCase().replace(/#\d+$/, '').replace(/[-_/#]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60)
    // The part is always named, '' for a thing's unnamed rest, so an act on "lounge furnish" is not an act on its sofa too.
    if (name && name !== 'fire' && !out.has(name) && out.size < MAX_TARGETS) out.set(name, { thing: b.thing, part: b.part })
  }
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

/** Changes the world's rules, or acts on its things, from one sentence. `person` is whose host session is billed. */
export async function ask(world: World, text: string, person = ME): Promise<Asked> {
  const t0 = performance.now()
  const named = targets(world)
  const r = await askRules(person, text, world.rules, [...named.keys(), 'fire'])
  const ms = () => Math.round(performance.now() - t0)
  let out: Asked
  if (!r.ok) out = { ok: false, why: r.why, ms: ms() }
  // The model call takes up to a minute; the physics plugin may have unloaded and freed the world meanwhile.
  else if (world.disposed) out = { ok: false, why: 'gone', ms: ms() }
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
    if (!applied?.ok && !did.length) out = { ok: false, why: 'refused', reason: applied && !applied.ok ? applied.reason : acts[0]?.refused ?? 'nothing to do', acts, ms: ms() }
    else out = {
      ok: true,
      // Shown as text only, never as markup. When an act did nothing, say why instead of the model's hopeful note.
      note: acts.some((a) => a.refused) ? acts.map((a) => (a.refused ? `${a.target ?? a.act}: ${a.refused}.` : '')).filter(Boolean).join(' ').slice(0, 160) : typeof r.note === 'string' ? r.note.slice(0, 160) : '',
      rules: world.rules,
      clamped: applied?.ok ? applied.clamped : [],
      acts,
      ms: ms(),
      hostMs: Math.round(r.ms),
      models: r.models,
      costUsd: r.costUsd,
      outputTokens: r.outputTokens,
    }
  }
  asked.push({ text, ...out })
  return out
}

export const askedSoFar = () => asked.slice()
