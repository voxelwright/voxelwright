// A theme written from a sentence (#50): `village.theme.ask("make it cozier")`. The host
// asks a model for theme JSON; the answer is data, checked here field by field before
// setTheme. A failed call or a refused theme leaves the current theme on screen.
import { checkTheme, setTheme, theme } from './index'
import { askTheme } from '../villager'

export type Asked =
  | { ok: true; note: string; id: string; label: string; clamped: string[]; hints: { props: string; costumes: string }; ms: number; hostMs: number; models: string[]; costUsd: number | null; outputTokens: number | null }
  | { ok: false; why: 'away' | 'busy' | 'failed' | 'refused'; reason?: string; ms: number }

const asked: ({ text: string } & Asked)[] = []

/** Restyles the home from one sentence. `person` is whose host session is billed (the default household member). */
export async function ask(text: string, person = 'alex'): Promise<Asked> {
  const t0 = performance.now()
  const r = await askTheme(person, text, theme())
  let out: Asked
  if (!r.ok) out = { ok: false, why: r.why, ms: Math.round(performance.now() - t0) }
  else {
    const checked = checkTheme(r.theme)
    if ('reason' in checked) out = { ok: false, why: 'refused', reason: checked.reason, ms: Math.round(performance.now() - t0) }
    else {
      setTheme(checked.theme)
      out = {
        ok: true,
        // Shown as text only, never as markup.
        note: typeof r.note === 'string' ? r.note.slice(0, 160) : '',
        id: checked.theme.id,
        label: checked.theme.label,
        clamped: checked.clamped,
        hints: { props: checked.theme.props.hint, costumes: checked.theme.costumes.hint },
        ms: Math.round(performance.now() - t0),
        hostMs: Math.round(r.ms),
        models: r.models,
        costUsd: r.costUsd,
        outputTokens: r.outputTokens,
      }
    }
  }
  asked.push({ text, ...out })
  return out
}

/** Adds `ask` (and `asked`, for the checks) to `window.village.theme`, creating it if no one else has. */
export function attachAsk() {
  const w = window as unknown as { village?: Record<string, unknown> }
  const village = (w.village ??= {})
  const current = village.theme
  const api = (current && typeof current === 'object' ? current : (village.theme = {})) as Record<string, unknown>
  Object.assign(api, { ask, asked: () => asked.slice() })
}
