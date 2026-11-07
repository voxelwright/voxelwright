// The current theme. ?theme=<id> picks a preset; without it the home looks as it
// always has. Plugins and postfx read `theme()`; the theme plugin shifts lights,
// materials and fog by role (./plugin.ts).
import type { Theme } from './tokens'
import { HOME } from './presets/home'
import { root } from '../kernel'

/** Preset modules: any file in presets/ that exports a Theme joins the list. */
const found = import.meta.glob<Record<string, unknown>>('./presets/*.ts', { eager: true })
export const PRESETS: Record<string, Theme> = Object.fromEntries(
  Object.values(found).flatMap((m) => Object.values(m)).filter(isTheme).map((t) => [t.id, t]),
)

function isTheme(v: unknown): v is Theme {
  return Boolean(v && typeof v === 'object' && 'id' in v && 'post' in v && 'light' in v)
}

const asked = new URLSearchParams(location.search).get('theme')
/** True when the page asked for a theme by name; without it the theme plugin is not loaded at all. */
export const THEMED = asked !== null && Object.hasOwn(PRESETS, asked)
let current: Theme = THEMED ? PRESETS[asked!] : HOME

export function theme(): Theme {
  return current
}

/**
 * Switch the home to another theme, live. The one way in: presets, the swatch book and
 * a theme written from a sentence all come through here, and each has passed `check()`.
 * Emits `village/theme` (previous, next); main.ts loads the theme plugin if it isn't
 * loaded and rebuilds postfx. How the change is eased (token blending, or a held
 * snapshot when the post chain changes shape) belongs to the theme plugin.
 */
export function setTheme(next: Theme) {
  const previous = current
  if (next === previous) return
  current = next
  root.emit('village/theme', previous, next)
}

/**
 * Untrusted data to a Theme, or the reason it was refused. Everything that did not come
 * from a preset module (local storage, a model, an edit) goes through here: known keys
 * only, numbers clamped, colours #rrggbb, stage kinds from the list in tokens.ts.
 * Placeholder until #50's theme-from-a-sentence unit: accepts nothing.
 */
export function check(_data: unknown): Theme | string {
  return 'theme checking is not built yet'
}

export { HOME }
