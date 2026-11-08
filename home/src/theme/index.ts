// The current theme. ?theme=<id> picks a look at load; without it the last look chosen
// in this browser comes back; without either the home looks as it always has. Plugins
// and postfx read `theme()`; the theme plugin shifts lights, materials and fog by role
// (./plugin.ts) and ./switch.ts eases each change.
import { check, checkTheme } from './check'
import type * as THREE from 'three/webgpu'
import type { Theme } from './tokens'
import { HOME } from './presets/home'
import { root } from '../kernel'
import { blend, sameShape } from './blend'
import { readCostumes, readLast, readSaved, revive, writeCostumes, writeLast, writeSaved, type Saved } from './saved'

/** Preset modules: any file in presets/ that exports a Theme joins the list. Read-only. */
const found = import.meta.glob<Record<string, unknown>>('./presets/*.ts', { eager: true })
export const PRESETS: Record<string, Theme> = Object.fromEntries(
  Object.values(found).flatMap((m) => Object.values(m)).filter(isTheme).map((t) => [t.id, t]),
)
/** The swatch book's order for the built-ins; any others follow. */
const ORDER = ['home', 'blue-hour', 'sixteen-bit', 'neon-night']
const BUILT_IN = [...ORDER.filter((id) => PRESETS[id]), ...Object.keys(PRESETS).filter((id) => !ORDER.includes(id))]

function isTheme(v: unknown): v is Theme {
  return Boolean(v && typeof v === 'object' && 'id' in v && 'post' in v && 'light' in v)
}

/** Which built-in each look was made from: itself for a built-in, the target's for a blend. */
const origin = new WeakMap<Theme, string>(Object.values(PRESETS).map((t) => [t, t.id]))

/** The person's own looks, in saved order. Each record went through check(), or the narrow revive for looks saved here. */
let records: Saved[] = readSaved()
let mine: Theme[] = []
function reload() {
  mine = records.flatMap((r) => {
    const checked = check(r.theme)
    const base = PRESETS[r.from]
    const t = typeof checked !== 'string' ? { ...checked, id: r.id, label: r.label } : base ? revive(r, base) : null
    if (!t) return []
    origin.set(t, base ? r.from : 'home')
    return [t]
  })
}
reload()
const find = (id: string): Theme | undefined => (Object.hasOwn(PRESETS, id) ? PRESETS[id] : mine.find((t) => t.id === id))

const asked = new URLSearchParams(location.search).get('theme')
const first = (asked !== null ? find(asked) : undefined) ?? find(readLast() ?? '') ?? HOME
/** True when the page starts in a look other than the home's; without it the theme plugin is not loaded until a switch. */
export const THEMED = first !== HOME
/** The look chosen: where a blend is heading. */
let target: Theme = first
/** The look on screen: the target, or a blend on its way there. */
let shown: Theme = first
/** A blend under way: from, to, and when it started (performance.now() ms). */
let blending: { from: Theme; to: Theme; start: number } | null = null
/** A switch that changes the post chain's shape waits for ./switch.ts to hold the last frame first. */
let held = false
export const BLEND_MS = 1500
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)')

export function theme(): Theme {
  return shown
}

/** The look chosen, even while the screen is still blending towards it. */
export function chosen(): Theme {
  return target
}

/**
 * Switch the home to another theme, live. The one way in: presets, the swatch book and
 * a theme written from a sentence all come through here, and each has passed `check()`.
 * A look with the same post chain shape blends over BLEND_MS (instantly with reduced
 * motion); any other waits for ./switch.ts, which holds the last frame over the rebuild.
 * Emits `village/theme` (previous, next); main.ts loads the theme plugin and eases it.
 */
export function setTheme(next: Theme) {
  if (next === target) return
  const previous = shown
  target = next
  if (Object.hasOwn(PRESETS, next.id) || mine.includes(next)) writeLast(next.id)
  if (!sameShape(previous, next)) {
    blending = null
    held = true
  } else if (reducedMotion.matches) {
    blending = null
    shown = next
  } else {
    blending = { from: previous, to: next, start: performance.now() }
    requestAnimationFrame(run)
  }
  root.emit('village/theme', previous, next)
}

/** ./switch.ts: the last frame is held on screen, so the chosen look can replace what is shown. */
export function release() {
  held = false
  shown = target
}

/** True while a blend or a held switch is under way. */
export const switching = () => Boolean(blending) || held

/**
 * Bring a blend up to the clock. It runs on its own animation frames, so it finishes with
 * or without the theme plugin; the plugin also calls this before it applies a frame's look,
 * and a second call in the same frame changes nothing.
 */
export function tick() {
  if (!blending) return
  const b = blending
  const t = Math.min(1, (performance.now() - b.start) / BLEND_MS)
  if (t >= 1) {
    shown = b.to
    blending = null
    return
  }
  const k = t * t * (3 - 2 * t)
  shown = blend(b.from, b.to, k)
  origin.set(shown, origin.get(b.to) ?? 'home')
}
function run() {
  tick()
  if (blending) requestAnimationFrame(run)
}

// Keeping a costume: a villager's figure root carries userData.villagerId and, when the
// person asked, userData.keepCostume; the theme plugin leaves that whole subtree alone.
let costumes = readCostumes()
let costumeChanges = 0
export const costumeVersion = () => costumeChanges

/** Villager plugins call this on each figure root they build. */
export function tagVillager(figure: THREE.Object3D, id: string) {
  figure.userData.villagerId = id
  figure.userData.keepCostume = costumes[id] === true
}

export function keepCostume(id: string, on: boolean) {
  costumes = { ...costumes }
  if (on) costumes[id] = true
  else delete costumes[id]
  writeCostumes(costumes)
  root.get('stage')?.scene.traverse((o) => {
    if (o.userData.villagerId === id) o.userData.keepCostume = on
  })
  costumeChanges++
}

/** Untrusted data to a Theme, or the reason it was refused (./check.ts). */
export { check, checkTheme }

/** How the last switch went, measured by ./switch.ts. */
export interface SwitchReport {
  from: string
  to: string
  path: 'blend' | 'rebuild' | 'instant'
  /** Longest frame interval from the switch until it settled, ms. */
  worstMs: number
  /** From the switch to the first ordinary frame after it finished, ms. */
  settledMs: number
  /** Rebuild only: from the switch until the next chain was compiled, while the old one drew, ms. */
  compiledMs?: number
  /** Rebuild only: from the switch until the new chain had drawn a frame, ms. */
  firstFrameMs?: number
  frames: number
  done: boolean
}
let report: SwitchReport | null = null
export const noteSwitch = (r: SwitchReport) => (report = r)
/** Each post chain swapped in by a rebuild, with when (performance.now() ms), for the checks. */
const swaps: { look: string; at: number }[] = []
export const noteSwap = (look: string) => swaps.push({ look, at: performance.now() }) > 200 && swaps.splice(0, 100)

const slug = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'look'

/** Card data for the swatch book and the checks. */
export interface LookInfo { id: string; label: string; about: string; mine: boolean; current: boolean }

/** window.village.theme: the swatch book's verbs, for checks and for the theme-from-a-sentence unit. */
export const themes = {
  list: (): LookInfo[] => [...BUILT_IN.map((id) => PRESETS[id]), ...mine].map((t) => ({
    id: t.id, label: t.label, about: t.about, mine: !Object.hasOwn(PRESETS, t.id), current: t.id === target.id,
  })),
  current: () => target.id,
  get: (id: string) => find(id),
  /** Load the theme plugin ahead of a switch, as opening the swatch book does. */
  prepare: () => prepare(),
  set(id: string): boolean {
    const t = find(id)
    if (t) setTheme(t)
    return Boolean(t)
  },
  /** Keep the look on screen (a blend included) under a name; the same name replaces that look. Returns its id. */
  save(name: string): string | null {
    const label = name.trim().slice(0, 40)
    if (!label) return null
    const look = shown
    const from = origin.get(look) ?? BUILT_IN.find((id) => sameShape(PRESETS[id], look)) ?? 'home'
    const same = records.find((r) => r.label.toLowerCase() === label.toLowerCase())
    let id = same?.id ?? `mine-${slug(label)}`
    for (let n = 2; !same && records.some((r) => r.id === id); n++) id = `mine-${slug(label)}-${n}`
    const record: Saved = { id, label, from, theme: { ...look, id, label } }
    records = same ? records.map((r) => (r === same ? record : r)) : [...records, record]
    if (!writeSaved(records)) return null
    reload()
    const saved = find(id)
    // The look on screen becomes the saved one, so the swatch book marks it current.
    if (saved) {
      target = shown = saved
      blending = null
      writeLast(id)
    }
    return id
  },
  rename(id: string, name: string): boolean {
    const label = name.trim().slice(0, 40)
    const at = records.findIndex((r) => r.id === id)
    if (!label || at < 0) return false
    records = records.map((r, i) => (i === at ? { ...r, label } : r))
    if (!writeSaved(records)) return false
    const was = find(id)
    reload()
    if (was && (target === was || shown === was)) target = shown = find(id) ?? target
    return true
  },
  /**
   * Delete one of the person's looks; a built-in cannot be. Deleting the look on screen
   * switches to the look it was made from (or the home's), so a card is always marked.
   */
  remove(id: string): boolean {
    const record = records.find((r) => r.id === id)
    if (!record) return false
    records = records.filter((r) => r !== record)
    if (!writeSaved(records)) return false
    reload()
    if (readLast() === id) writeLast(record.from)
    if (target.id === id) setTheme(find(record.from) ?? HOME)
    return true
  },
  keepCostume,
  keepsCostume: (id: string) => costumes[id] === true,
  switching,
  lastSwitch: () => report,
  swaps: () => swaps.slice(),
}

export { HOME }

/**
 * Someone is about to change the look: the swatch book opened, or a theme was asked for.
 * The theme plugin loads now, so its one-time room rebuild (its fixture lights join every lit
 * shader, about 190 ms) lands while the book opens or the model writes, not in the switch.
 * The home without a theme never loads it, so it pays nothing for themes.
 */
export function prepare() {
  root.emit('village/theme-prepare')
}
