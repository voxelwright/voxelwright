// The current theme. ?theme=<id> picks a preset; without it the home looks as it
// always has. Plugins and postfx read `theme()`; the theme plugin shifts lights,
// materials and fog by role (./plugin.ts).
import type { Theme } from './tokens'
import { HOME } from './presets/home'

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

export function setTheme(next: Theme) {
  current = next
}

export { HOME }
