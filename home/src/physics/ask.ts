// World rules written from a sentence (#74), the src/theme/ask.ts pattern: the host asks a
// model for rules JSON; the answer is data, checked here field by field and clamped
// (rules.ts checkRules), then applied all at once. A failed call or a refused answer leaves
// the rules as they were.
import { askRules, ME } from '../villager'
import { checkRules, sameRules, type Rules } from '../engine/rules'
import type { World } from '../engine/world'

export type Asked =
  | { ok: true; note: string; rules: Rules; clamped: string[]; ms: number; hostMs: number; models: string[]; costUsd: number | null; outputTokens: number | null }
  /** `link`: no token, or one from an earlier launch: open the latest link. `gone`: the world stopped (physics unloaded) while the model answered. */
  | { ok: false; why: 'away' | 'busy' | 'failed' | 'refused' | 'link' | 'gone'; reason?: string; ms: number }

const asked: ({ text: string } & Asked)[] = []

/** Changes the world's rules from one sentence. `person` is whose host session is billed. */
export async function ask(world: World, text: string, person = ME): Promise<Asked> {
  const t0 = performance.now()
  const r = await askRules(person, text, world.rules)
  const ms = () => Math.round(performance.now() - t0)
  let out: Asked
  if (!r.ok) out = { ok: false, why: r.why, ms: ms() }
  // The model call takes up to a minute; the physics plugin may have unloaded and freed the world meanwhile.
  else if (world.disposed) out = { ok: false, why: 'gone', ms: ms() }
  else {
    // An answer that changes nothing (every field invalid or unknown, or the same as now) is not a change.
    const checked = checkRules(r.rules, world.rules)
    const applied = 'reason' in checked ? { ok: false as const, reason: checked.reason } : sameRules(checked.rules, world.rules) ? { ok: false as const, reason: 'nothing valid to change' } : world.setRules(r.rules, 'talk')
    if (!applied.ok) out = { ok: false, why: 'refused', reason: applied.reason, ms: ms() }
    else out = {
      ok: true,
      // Shown as text only, never as markup.
      note: typeof r.note === 'string' ? r.note.slice(0, 160) : '',
      rules: applied.rules,
      clamped: applied.clamped,
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
