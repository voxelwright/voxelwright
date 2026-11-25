// Light, Dark or San Francisco now (#524): the sky a visitor chooses for the city, kept for their next visit.
//
// Light and Dark move the clock on to an hour the city looks its best at, by day or by night, under a clear sky.
// San Francisco now follows the real city: the hour its clocks say, its weather (the Worker's /weather: what the
// National Weather Service saw at the airport last), and its sun and moon where they stand, the moon lit as it is
// (almanac.ts).
//
// Who has the sky: the sync writes the hour and the weather only while they are still what it wrote last. The fader,
// a weather key, the [ and ] keys or an egg change them, and the sync stands aside; an egg gives back what was before
// and the sync takes up again. The address's hour or rain (`?hour=`, `?rain=`, a realm's look) wins over a kept choice.
//
// The choice is kept beside the blog's own (site/static/site.js): `vx-sky` holds it, and Light and Dark are also told
// to `vx-theme`, the blog's night, so the blog follows. With nothing kept, the blog's night says; with none, a dark
// system has Dark, and a light one the realm's own light (no key pressed) until a choice is made.
import { fresh, heavens, sfHour, weatherOf } from './almanac.ts'
import type { Heavens, Observed } from './almanac.ts'
import { OWN_HOUR } from './weather.ts'
import type { Skies, Weather } from './weather.ts'

export type Mode = 'light' | 'dark' | 'sf'
export const MODES: readonly Mode[] = ['light', 'dark', 'sf']
/**
 * The hours Light and Dark go to, chosen from pictures of the first view at desk and phone sizes at nine hours
 * (#524, ~/.village/engine/sf/modes/hours): a quarter past five, the sun low in the west and the towers warm, the sky
 * still blue and BLOG still read (half an hour later the board is black and the sky pale); and half past nine at
 * night, every window and both crowns lit (at seven and eight the towers are still half dark).
 */
export const HOURS: Record<Exclude<Mode, 'sf'>, number> = { light: 17.25, dark: 21.5 }
/** How often the weather is asked again, and how often a settled sky is moved on with the real one (s): each move spoils the sun's maps. */
const WEATHER_EVERY = 600, SKY_EVERY = 60

export interface ModesPage {
  sky: Skies
  hour(): number | null
  setHour(h: number | null): void
  /** Lights the page as a real sky is, `ease` of the way from where it is; says whether it is there (main.ts). */
  setSky(h: number, sky: Heavens, ease?: number): boolean
  /** Whether the address or the realm set the hour or the rain: a kept choice waits until one is made. */
  pinned: boolean
  /** Where the weather is asked (the Worker's /weather); a failure keeps the weather as it is. */
  weather: string
  now?: () => number
  /** The sky is the mode's now: whoever kept a sky to give back (an egg, eggs.ts) forgets it. */
  claim?: () => void
}

const store = {
  get: (k: string) => { try { return localStorage.getItem(k) } catch { return null } },
  set: (k: string, v: string | null) => { try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v) } catch { /* not kept */ } },
}

/**
 * The choice a visitor made, on this page or the blog's; else Dark for a system that is dark. Else none: the realm's
 * own light (the landing's photograph, the picture the loader shows) until a choice is made.
 */
export function keptMode(): Mode | null {
  const kept = store.get('vx-sky'), theme = store.get('vx-theme')
  if (kept === 'light' || kept === 'dark' || kept === 'sf') return kept
  if (theme === 'light' || theme === 'dark') return theme
  return typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : null
}

export function modes(page: ModesPage) {
  const now = page.now ?? Date.now
  let mode: Mode | null = keptMode()
  /** Whether the mode's sky is the one shown: false until it is applied, and once something else has taken the sky. */
  let held = false
  /** Whether the visitor has set the sky by hand already (before the first view was shown, too): a kept choice then waits. */
  let touched = false
  let pending: number | null = null
  // The sync: what it wrote last, whether the light has come round to the real sky, and when it last moved it on.
  let wrote: { hour: number | null; weather: Weather } | null = null, settled = false, movedAt = 0, away = false
  let real: Weather | null = null, askedAt = -Infinity, asking: Promise<void> | null = null

  const askWeather = () => {
    if (asking) return
    askedAt = now()
    asking = fetch(page.weather)
      .then((r) => { if (!r.ok) throw Error(`${r.status}`); return r.json() as Promise<{ observed?: Observed }> })
      .then((body) => { if (!body.observed || !fresh(body.observed, now())) throw Error('no recent report'); real = weatherOf(body.observed) })
      .catch((e) => { real = null; console.info('San Francisco\'s weather did not come; the sky keeps its own:', String(e)) })
      .finally(() => { asking = null })
  }
  /** Goes to an hour the short way (from the realm's own light, from the hour nearest it: set now, glided from on the next frame). */
  const glideTo = (h: number) => { if (page.hour() === null) { page.setHour(OWN_HOUR); pending = h } else page.sky.glide(h) }
  const apply = () => {
    held = true
    wrote = null
    away = false
    pending = null
    if (!mode) return void (held = false)
    page.claim?.()
    if (mode === 'sf') { settled = false; if (now() - askedAt > WEATHER_EVERY * 1000) askWeather(); return }
    page.sky.set('clear')
    glideTo(HOURS[mode])
    // Where it is going is its own from now (the sky's glide says so while it moves): a change on the way is someone else's.
    wrote = { hour: HOURS[mode], weather: 'clear' }
  }

  const self = {
    get mode() { return mode },
    /** Whether the chosen mode's sky is the one on the page (not the address's, a fader's or an egg's). */
    get held() { return held },
    /** For the checks: whether the light has come round to the real sky (SF mode). */
    get settled() { return settled },
    /** The weather San Francisco has now, once asked (SF mode). */
    get real() { return real },
    /** Starts the kept choice (once the first view is shown): a pinned page, or one with none, waits for a choice. */
    start() { if (!page.pinned && !touched && mode) apply() },
    /** Chooses a mode, keeps it, and goes to it. */
    choose(m: Mode) {
      mode = m
      store.set('vx-sky', m)
      store.set('vx-theme', m === 'sf' ? null : m)
      apply()
    },
    /** The visitor set the hour or the weather by hand: the mode lets go of the sky until it is chosen again. */
    release() { held = false; touched = true; pending = null },
    /** A frame: `dt` seconds since the last. */
    step(dt: number) {
      if (pending !== null) { page.sky.glide(pending); pending = null; return }
      // Taken by someone else; an egg that ends gives back exactly what it found, and the mode takes up again, from
      // the light the egg left (its hour's, not the real sky's).
      if (!held) return
      if (taken()) { away = true; return }
      if (away) { away = false; settled = false }
      if (mode !== 'sf') return
      const t = now()
      if (t - askedAt > WEATHER_EVERY * 1000) askWeather()
      if (real && real !== page.sky.weather) page.sky.set(real)
      // Moved on with the real sky once a minute (each move turns the sun's maps): a minute's move at once, a long way
      // (the start, the light taken over by the rising moon or given back to the night) eased there (main.ts `setSky`).
      if (t - movedAt > SKY_EVERY * 1000) { settled = false; movedAt = t }
      if (!settled) settled = page.setSky(sfHour(t), heavens(t), Math.min(1, dt * 2.5))
      wrote = { hour: page.hour(), weather: page.sky.weather }
    },
    /** The mode whose sky is on the page (on its way there too), or null: the address's, a fader's, a key's or an egg's. */
    get showing(): Mode | null { return held && !taken() ? mode : null },
  }
  // (The sky's hour is where it is going while it glides: an egg's glide away is seen at once, and one home as soon as it starts.)
  const taken = () => !!wrote && (page.sky.hour !== wrote.hour || page.sky.weather !== wrote.weather)
  return self
}
