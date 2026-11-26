// The controls of a realm the page runs alone (#450): the hour, the weather, the tools and reset, and on a phone a
// stick, keys to fly up and down and the key that uses the tool. Each is a control of the Voxelmorphism kit
// (engine/kit), chosen by what the hand does (DESIGN.md): a fader for the hour, which is set by where it stands and
// moved finely; banks of latching keys for the weather and the tools, one of each latched down; a danger key to
// put the world back. The stick is a well the thumb's cap moves in.
//
// It is plain HTML and CSS first, working with no script of the kit's; the kit's own renderer then makes it
// voxels (`?kit=plain` keeps it plain). Nothing here owns state: the page's keys ([ ] R 1 to 7 Backspace) and its
// checks set the same things, and every frame what is shown is read back from the page.
import { OWN_HOUR, skies, UNSET, WEATHERS, type Weather } from './weather.ts'
import { modes, MODES, type Mode, type ModesPage } from './modes.ts'
import type { Input } from './input.ts'
import type { Marcher } from './march.ts'
import { legends } from './typeface.ts'

export interface RealmPage {
  march: Marcher
  controls: Input
  /** The hour the page is lit for, or null for its unset light. */
  hour(): number | null
  setHour(h: number): void
  /** Where the eye is, east, in the finest cells. */
  east(): number
  tools: readonly string[]
  tool(): number
  pickTool(i: number): void
  reset(): Promise<unknown> | unknown
  /** Called every frame with the gap since the last, ms. */
  watch(each: (gap: number) => void): void
  /** How the picture is drawn (main.ts `graphics`): the presets, and the one chosen. Without it the panel has no such row. */
  graphics?: {
    presets: readonly string[]; get(): string; set(preset: string): void
    /** The resolution (main.ts `resolve`): a scale of the screen's pixels, pinned or steered for a frame rate (0: the screen's own). */
    resolution?: { rates: readonly number[]; get(): { scale: number; auto: boolean; target: number; fixed: boolean }; set(to: { scale?: number; auto?: boolean; target?: number }): void }
  }
  /** Opens the line to say something to the city on (eggs.ts), where the page has one: by touch there is no Enter or slash. */
  say?(): void
  /** Opens the panel where a visitor connects their own AI (connect.ts), where the page makes things itself (#526). */
  ai?(): void
  /** Opens the servers (lobbies.ts, #526): other players' servers to join, or how to host one. Where lobbies may be joined and this page is in none (in one, its tag stands where this key does). */
  servers?(): void
  /** Light, Dark or San Francisco now (#524, modes.ts), where the realm has a real sky to follow. Without it the panel has no such row. */
  modes?: Omit<ModesPage, 'sky' | 'hour' | 'setHour'>
}

const MODE_NAMES: Record<Mode, string> = { light: 'Light', dark: 'Dark', sf: 'SF now' }
const MODE_TITLES: Record<Mode, string> = { light: 'The city at a quarter past five, the sun low and the towers warm', dark: 'The city at half past nine at night, every window lit', sf: "San Francisco's own time, sun and moon, and its weather as the National Weather Service last saw it at SFO" }

const GRAPHICS: Record<string, string> = { low: 'Low', medium: 'Medium', high: 'High' }

const NAMES: Record<Weather, string> = { clear: 'Clear', overcast: 'Overcast', fog: 'Fog', rain: 'Rain' }
const clock = (h: number) => { const m = Math.round(h * 60) % 1440; return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}` }

const STYLE = /* css */ `
#realm { position: fixed; inset: 0; pointer-events: none; z-index: 5; font: 400 14px/1.4 var(--vx-font); color: var(--vx-ink); }
#realm > * { pointer-events: auto; }
#realm [hidden] { display: none !important; }
/* The sky: one panel at the top right. */
#realm .sky { position: absolute; right: max(16px, env(safe-area-inset-right)); top: max(16px, env(safe-area-inset-top)); inline-size: calc(var(--vx) * 76); box-sizing: border-box; padding: calc(var(--vx) * 4) calc(var(--vx) * 5) calc(var(--vx) * 5); display: grid; gap: calc(var(--vx) * 3); }
#realm .sky header { display: flex; align-items: baseline; justify-content: space-between; }
#realm .sky h2 { margin: 0; font: 600 13px/1 var(--vx-font); letter-spacing: 0.06em; text-transform: uppercase; color: var(--vx-ink-quiet); }
#realm .sky output { font: 600 20px/1 var(--vx-mono); font-variant-numeric: tabular-nums; color: var(--vx-ink); }
#realm .sky .ticks { display: flex; justify-content: space-between; margin: calc(var(--vx) * -2) 2px 0; font: 400 11px/1 var(--vx-mono); color: var(--vx-ink-quiet); }
#realm .sky .vx-toggle-group { inline-size: 100%; }
/* The sky's keys (Light, Dark, SF now) under the Time header, over the fader they set: Light and Dark side by side, SF
   now under them the whole row wide (three across at a desk's key size their words are not clear of their walls; at the
   smaller size they read too small beside the others). A phone's panel is the smaller size: three across there. */
#realm .sky .modes { grid-auto-flow: row; grid-template-columns: 1fr 1fr; }
#realm .sky .modes > label:last-child { grid-column: 1 / -1; }
/* (On a screen under 830 px tall the realm's own panel, with its foot and the resolution, has no room for them: they are
   the first view's there, first.ts, where a choice is made.) */
@media (pointer: fine) and (max-height: 829px) { html:not(.first) #realm .sky .modes { display: none; } }
/* The weather: four seats two by two. A raised cap's left wall stands over the first two voxels of its face, so the words
   keep that far in, and Overcast (84 px in Vox Zakon Text at the key size, 78 in Vox Text) has no room for that four across. */
#realm .sky .weather { grid-auto-flow: row; grid-template-columns: 1fr 1fr; }
#realm .sky .vx-toggle-group > label { padding-inline: calc(var(--vx) * 2.5); white-space: nowrap; }
/* (Its two parts, the sky's and the rest, are one column of the panel; side by side on a phone on its side.) */
#realm .sky .part { display: contents; }
#realm .sky .foot { display: flex; justify-content: flex-end; gap: calc(var(--vx) * 3); }
/* The graphics: three quality tiers across one row, with Medium given extra room so its words stay clear of its walls. */
#realm .sky .graphics { grid-auto-flow: column; grid-template-columns: 1fr 1.4fr 1fr; }
#realm .sky .foot .say { margin-inline-end: auto; }
/* Dynamic resolution: a slide switch on its header row; when on, a bank of Target FPS keys; when off, a resolution fader. */
#realm .sky .res-auto { display: flex; align-items: center; justify-content: space-between; inline-size: 100%; min-block-size: calc(var(--vx) * 9); gap: calc(var(--vx) * 2); }
#realm .sky .res-auto .r-title { font: 600 13px/1.2 var(--vx-font); letter-spacing: 0.06em; text-transform: uppercase; color: var(--vx-ink-quiet); }
#realm .sky :is(.res-fps, .res-manual) { display: grid; gap: calc(var(--vx) * 2); }
#realm .sky h3 { margin: 0; font: 600 12px/1 var(--vx-font); letter-spacing: 0.06em; text-transform: uppercase; color: var(--vx-ink-quiet); }
#realm .sky .sub output { font-size: 16px; }
#realm .sky .rates { grid-auto-flow: row; grid-template-columns: 1fr 1fr; }
#realm .sky .rates > label:last-child { grid-column: 1 / -1; }
/* (The resolution is a part of its own, a third column on a phone on its side; in one column it comes before the keys at the foot.) */
#realm .sky .part.res > * { order: 1; }
#realm .sky .vx-groove, #realm .sky .foot { order: 2; }
/* The tools: a bank along the bottom, in the smaller size of the key font (typeface.ts), so that the bank stands clear of
   the place's name in the corner. The kit draws a key's side walls over its padding, the left one the wider: five and a
   half cells before its words and four after, so a word's first figure stands clear of the wall (3 Big charge, #450). */
#realm .tools { position: absolute; left: 50%; bottom: max(30px, env(safe-area-inset-bottom)); transform: translateX(-50%); --vx-key-size: var(--vx-key-small); }
#realm .tools > label { padding-inline: calc(var(--vx) * 5.5) calc(var(--vx) * 4); white-space: nowrap; }
#realm .tools .n { margin-inline-end: 6px; color: var(--vx-ink-quiet); }
/* The servers (#526, lobbies.ts): a key of its own in the top left corner, where nothing else is on a desk, the size of
   the settings key across from it; while the picture holds the pointer it steps away as the other corner keys do
   (play-hud.ts), and in the first view it is not there. In a lobby the lobby's tag stands here instead. */
#realm .lobbies { position: absolute; left: max(24px, env(safe-area-inset-left)); top: max(24px, env(safe-area-inset-top)); min-block-size: 44px; }
html.first #realm .lobbies { display: none; }
html:is([data-hud="quiet"], [data-hud="wheel"]).away #realm .lobbies { opacity: 0 !important; pointer-events: none !important; transition: opacity 0.4s ease-out; }
/* What a thumb has: only where the pointer is coarse. */
#realm .thumbs { display: none; }
#realm .fold { display: none; }
/* Folded behind its key where something else has the corner (explore.ts: what a roof is for), as on a phone. */
/* The settings key is its gear alone, in cells of 3 px, 44 px a side as the key it replaced was tall (kit: data-vx-icon-only). */
#realm .fold { --vx: 3px; min-inline-size: 44px; min-block-size: 44px; }
#realm.folds .fold { display: block; position: absolute; right: max(16px, env(safe-area-inset-right)); top: max(16px, env(safe-area-inset-top)); }
#realm.folds .sky { top: calc(max(16px, env(safe-area-inset-top)) + 60px); }
@media (pointer: coarse) {
  /* By touch the credits key has the top left corner (first.ts): the servers key stands beside it, at its height. */
  #realm .lobbies { top: calc(env(safe-area-inset-top, 0px) + 20px); left: calc(max(22px, calc(env(safe-area-inset-left) + 16px)) + 98px); --vx: 3px; --vx-key-size: var(--vx-key-small); min-inline-size: 64px; }
  html[data-hud="wheel"].away #realm .lobbies { opacity: 1 !important; pointer-events: auto !important; }
  #realm .fold { display: block; position: absolute; right: max(12px, env(safe-area-inset-right)); top: max(12px, env(safe-area-inset-top)); }
  /* (On a phone the panel is words a column wide: the smaller size of the key font, as the tools have, its cells still whole pixels, typeface.ts.) */
  #realm .sky { top: calc(max(12px, env(safe-area-inset-top)) + 56px); right: max(12px, env(safe-area-inset-right)); inline-size: min(calc(100vw - 24px), calc(var(--vx) * 76)); --vx-key-size: var(--vx-key-small); }
  #realm .sky .res-auto { min-block-size: calc(var(--vx) * 11); }
  /* The line to say something on (eggs.ts) stands at the top by touch: the phone's keyboard comes up over the bottom. Its
     words are 16 px, under which Safari zooms the page to the field. */
  #realm .egg-line { bottom: auto !important; top: calc(env(safe-area-inset-top, 0px) + 140px) !important; z-index: 2; }
  /* Upright, the panel is one column a key's height from BLOG: with the sky's keys, the fader's figures are left out (the
     clock over it says the hour). */
  #realm .sky .modes { grid-template-columns: repeat(3, 1fr); }
  #realm .sky .modes > label:last-child { grid-column: auto; }
  @media (orientation: portrait) { #realm .sky:has(.modes) .ticks { display: none; } }
  /* On its side the phone is low: the panel is two columns, the sky's on the left and the graphics and keys on the right. */
  @media (orientation: landscape) {
    #realm .sky { inline-size: min(calc(100vw - 2 * max(12px, env(safe-area-inset-left)) - 24px), calc(var(--vx) * 150)); grid-template-columns: 1fr 1fr; column-gap: calc(var(--vx) * 6); align-items: start; }
    /* (With the resolution a third column: the panel as wide as the phone allows.) */
    #realm .sky:has(.part.res) { left: max(12px, env(safe-area-inset-left)); right: auto; inline-size: min(calc(100vw - max(12px, env(safe-area-inset-left)) - max(12px, env(safe-area-inset-right)) - 68px), calc(var(--vx) * 228)); grid-template-columns: 1fr 1fr 1fr; }
    #realm .sky .part { display: grid; gap: calc(var(--vx) * 3); }
    /* (The sky's keys are the first view's here, first.ts: in the realm's own panel a row more runs off the screen.) */
    #realm .sky .modes { display: none; }
  }
  #realm .egg-line input { font-size: 16px !important; }
  /* Down the right edge. Held upright, standing on the thumb's key: under the skyline's signs, which are the upper third of an upright
     phone's picture (at 390 x 844 the column is from 340 px down and the skyline's lowest sign ends at 296). Set at
     the middle of the picture's height, it was over the LinkedIn sign. */
  #realm .tools { left: auto; right: max(12px, env(safe-area-inset-right)); bottom: auto; top: 50%; transform: translateY(-62%); }
  @media (orientation: portrait) { #realm .tools { top: auto; bottom: calc(max(84px, env(safe-area-inset-bottom) + 84px) + 112px); transform: none; } }
  #realm .tools > label { min-inline-size: calc(var(--vx) * 20); }
  /* Open, the sky's panel is over where the tools stand: they step aside until it is folded. */
  #realm.open .tools { display: none; }
  #realm .thumbs { display: block; pointer-events: none; }
  #realm .thumbs > * { pointer-events: auto; }
  #realm .stick { position: absolute; left: 0; top: 0; inline-size: 132px; block-size: 132px; margin: -66px 0 0 -66px; pointer-events: none !important; transition: opacity 0.2s; opacity: 0.55; }
  #realm .stick.on { opacity: 1; transition: none; }
  #realm .stick .cap { position: absolute; left: 50%; top: 50%; inline-size: 52px; block-size: 52px; margin: -26px 0 0 -26px; min-inline-size: 0; padding: 0; pointer-events: none; }
  #realm .act { position: absolute; right: max(16px, env(safe-area-inset-right)); bottom: calc(max(20px, env(safe-area-inset-bottom)) + 64px); display: grid; grid-template-columns: auto auto; align-items: end; gap: 14px; }
  #realm .fly { display: grid; gap: 10px; }
  #realm .fly .vx-button { min-inline-size: 60px; justify-content: center; }
  #realm .use { --vx: 6px; min-inline-size: 96px; min-block-size: 96px; justify-content: center; }
  /* Held upright, the keys to fly lie in a row under the key that uses the tool: beside it they were over the BLOG board. */
  @media (orientation: portrait) {
    #realm .act { grid-template-columns: auto; justify-items: end; gap: 10px; bottom: max(20px, env(safe-area-inset-bottom)); }
    #realm .fly { grid-auto-flow: column; order: 2; }
  }
}
`

/** Puts the realm's controls on the page. Returns what the checks reach through `engine.realmControls`. */
export function realmControls(page: RealmPage) {
  const sky = skies(page.march, page.hour, page.setHour, page.east)
  const mode = page.modes ? modes({ ...page.modes, sky, hour: page.hour, setHour: page.setHour }) : null
  const style = document.createElement('style')
  style.textContent = STYLE
  const sheet = document.createElement('link')
  sheet.rel = 'stylesheet'
  sheet.href = new URL('../kit/voxelmorphism.css', import.meta.url).href
  document.head.append(sheet, style)
  legends()
  const html = document.documentElement
  html.dataset.vxLook = 'lit'
  const plainOnly = new URLSearchParams(location.search).get('kit') === 'plain'
  if (plainOnly) html.setAttribute('data-vx-plain', '')

  const root = document.createElement('div')
  root.id = 'realm'
  root.innerHTML = /* html */ `
    ${page.servers ? '<button class="vx-button lobbies" type="button" aria-haspopup="dialog" title="Other players’ servers: join one, or host your own">Servers</button>' : ''}
    <button class="vx-button fold" type="button" aria-expanded="false" aria-controls="realm-sky" aria-label="Weather, time of day and graphics" title="Weather, time of day and graphics" data-vx-icon="gear" data-vx-icon-only></button>
    <section class="vx-card sky" id="realm-sky" aria-label="Sky">
      <div class="part">
      <header><h2>Time</h2><output aria-live="off"></output></header>
      ${page.modes ? `<div class="vx-toggle-group modes" role="radiogroup" aria-label="Sky">
        ${MODES.map((m) => `<label title="${MODE_TITLES[m]}"><input type="radio" name="realm-mode" value="${m}">${MODE_NAMES[m]}</label>`).join('')}
      </div>` : ''}
      <span class="vx-slider"><input type="range" min="0" max="24" step="0.25" aria-label="Time of day"></span>
      <div class="ticks" aria-hidden="true"><span>0</span><span>6</span><span>12</span><span>18</span><span>24</span></div>
      <div class="vx-toggle-group weather" role="radiogroup" aria-label="Weather">
        ${WEATHERS.map((w) => `<label><input type="radio" name="realm-weather" value="${w}">${NAMES[w]}</label>`).join('')}
      </div>
      </div>
      <div class="part">
      ${page.graphics ? `<header class="g"><h2>Graphics</h2></header>
      <div class="vx-toggle-group graphics" role="radiogroup" aria-label="Graphics">
        ${page.graphics.presets.map((g) => `<label><input type="radio" name="realm-graphics" value="${g}">${GRAPHICS[g] ?? g}</label>`).join('')}
      </div>` : ''}
      <div class="vx-groove" role="separator"></div>
      <div class="foot">${page.say ? '<button class="vx-button say" type="button" aria-keyshortcuts="Enter" title="Say something to the city (Enter)">Say…</button>' : ''}${page.ai ? '<button class="vx-button ai" type="button" aria-haspopup="dialog" title="Connect your own AI to make new things">Your AI…</button>' : ''}<button class="vx-button reset" type="button" data-vx-kind="danger" title="Put the world back as it was (Backspace)">Reset world</button></div>
      </div>
      ${page.graphics?.resolution ? `<div class="part res">
      <label class="vx-toggle res-auto" title="Dynamic resolution: adjust resolution automatically to hold the target FPS">
        <span class="r-title">Dynamic resolution</span>
        <input type="checkbox" role="switch" class="res-auto">
        <span class="vx-switch"></span>
      </label>
      <div class="res-fps">
        <header class="sub"><h3>Target FPS</h3></header>
        <div class="vx-toggle-group rates" role="radiogroup" aria-label="Target FPS">
          ${page.graphics.resolution.rates.map((r) => `<label title="${r ? `Target ${r} FPS` : 'Target the screen’s max refresh rate'}"><input type="radio" name="realm-rate" value="${r}">${r ? `${r} FPS` : 'Max FPS'}</label>`).join('')}
        </div>
      </div>
      <div class="res-manual" hidden>
        <header class="sub"><h3>Resolution</h3><output class="res" aria-live="off"></output></header>
        <span class="vx-slider"><input class="res" type="range" min="30" max="100" step="5" aria-label="Resolution, percent of the screen's pixels"></span>
      </div>
      </div>` : ''}
    </section>
    <div class="vx-toggle-group tools" role="radiogroup" aria-label="Tool">
      ${page.tools.map((t, i) => `<label><input type="radio" name="realm-tool" value="${i}"><span class="n">${i + 1}</span>${t}</label>`).join('')}
    </div>
    <div class="thumbs">
      <div class="vx-recess stick" aria-hidden="true"><span class="vx-button cap" tabindex="-1"></span></div>
      <div class="act">
        <div class="fly">
          <button class="vx-button up" type="button" aria-label="Fly up">Up</button>
          <button class="vx-button down" type="button" aria-label="Fly down">Down</button>
        </div>
        <button class="vx-button use" type="button" data-vx-kind="main" aria-label="Use the tool">Use</button>
      </div>
    </div>`
  document.body.append(root)
  // The page's own bar of tools, its round button and its plain reset are this one's now.
  for (const id of ['tools', 'boom']) { const old = document.getElementById(id); if (old) old.style.display = 'none' }

  const $ = <T extends Element>(s: string) => root.querySelector<T>(s)!
  const hourIn = $<HTMLInputElement>('.sky input[type=range]'), hourOut = $<HTMLOutputElement>('.sky output')
  const weathers = [...root.querySelectorAll<HTMLInputElement>('input[name=realm-weather]')]
  const modeKeys = [...root.querySelectorAll<HTMLInputElement>('input[name=realm-mode]')]
  const tools = [...root.querySelectorAll<HTMLInputElement>('input[name=realm-tool]')]
  const graphics = [...root.querySelectorAll<HTMLInputElement>('input[name=realm-graphics]')]
  const res = page.graphics?.resolution, resAuto = root.querySelector<HTMLInputElement>('input.res-auto'), resFps = root.querySelector<HTMLElement>('.res-fps'), resManual = root.querySelector<HTMLElement>('.res-manual'), resIn = root.querySelector<HTMLInputElement>('input.res'), resOut = root.querySelector<HTMLOutputElement>('output.res')
  const rates = [...root.querySelectorAll<HTMLInputElement>('input[name=realm-rate]')]
  const panel = $<HTMLElement>('.sky'), fold = $<HTMLButtonElement>('.fold')
  const stick = $<HTMLElement>('.stick'), cap = $<HTMLElement>('.stick .cap')
  const coarse = matchMedia('(pointer: coarse)')

  // A control used by the hand gives the keys back to the world as it is let go: a focused radio or fader would
  // take the letters (input.ts leaves keys typed into a field alone), and W would not walk. By the keyboard (Tab)
  // it keeps them, as a control should.
  // (Not a line of text: a key that opens one gives the focus to it, for the keys to be typed there.)
  // (Heard on the window: the hour's fader let go over the picture is let go too, #506.)
  addEventListener('pointerup', () => setTimeout(() => { const a = document.activeElement; if (a instanceof HTMLElement && root.contains(a) && !a.matches('input[type=text], textarea')) a.blur() }))
  let dragging = false
  hourIn.addEventListener('pointerdown', () => { dragging = true })
  addEventListener('pointerup', () => { dragging = false })
  // (The hour or the weather set by hand lets go of the mode: modes.ts.)
  hourIn.addEventListener('input', () => { mode?.release(); sky.glide(Number(hourIn.value)) })
  for (const w of weathers) w.addEventListener('change', () => { if (w.checked) { mode?.release(); sky.set(w.value as Weather) } })
  for (const m of modeKeys) m.addEventListener('change', () => { if (m.checked) mode?.choose(m.value as Mode) })
  for (const t of tools) t.addEventListener('change', () => { if (t.checked) page.pickTool(Number(t.value)) })
  $<HTMLButtonElement>('.reset').addEventListener('click', () => void page.reset())
  // (Folded first where the panel is a drawer, as Say… does: the dialog is to be read.)
  root.querySelector('button.lobbies')?.addEventListener('click', () => { if (coarse.matches) folded(true); page.servers?.() })
  root.querySelector('button.ai')?.addEventListener('click', () => { if (coarse.matches || root.classList.contains('folds')) folded(true); page.ai?.() })
  for (const g of graphics) g.addEventListener('change', () => { if (g.checked) page.graphics?.set(g.value) })
  // Dynamic resolution On/Off: On steers resolution to hold Target FPS; Off pins it where the slider stands.
  let sizing = false
  resIn?.addEventListener('pointerdown', () => { sizing = true })
  addEventListener('pointerup', () => { sizing = false })
  resAuto?.addEventListener('change', () => res?.set({ auto: resAuto.checked }))
  resIn?.addEventListener('input', () => res?.set({ scale: Number(resIn.value) / 100 }))
  for (const r of rates) r.addEventListener('change', () => { if (r.checked) res?.set({ target: Number(r.value), auto: true }) })
  // The kit's voxels, once the world is drawing: the page is plain until they come, and stays so with ?kit=plain.
  let kit: { adopt(root?: Element): void; refresh?(el: Element): void } | null = null
  // The line opens in the same press, so that a phone brings its keyboard up (Safari does only for a focus the hand made).
  // Where the panel is a drawer behind its key, it is folded first: the line is to be read.
  // (The line was hidden when the kit took up the controls, and is drawn as a card of it once it is shown.)
  root.querySelector('.say')?.addEventListener('click', () => { if (coarse.matches || root.classList.contains('folds')) folded(true); page.say?.(); const line = root.querySelector('.egg-line:not([hidden])'); if (line && !line.hasAttribute('data-vx-live')) kit?.adopt(line) })
  // On a phone the panel folds away behind its key.
  const folded = (on: boolean) => {
    panel.hidden = on; fold.setAttribute('aria-expanded', String(!on)); root.classList.toggle('open', !on)
    if (!on && kit) {
      for (const el of panel.querySelectorAll('.vx-slider, .vx-toggle-group, .vx-switch')) if (!el.closest('[hidden]')) kit.refresh?.(el)
      kit.refresh?.(panel)
    }
  }
  fold.addEventListener('click', () => folded(!panel.hidden))
  folded(coarse.matches)
  // The bank of tools stands down the right edge on a phone and lies along the bottom elsewhere.
  const lay = () => { $<HTMLElement>('.tools').dataset.vxWay = coarse.matches ? 'down' : ''; if (!coarse.matches) delete $<HTMLElement>('.tools').dataset.vxWay }
  lay()
  coarse.addEventListener('change', () => { lay(); folded(coarse.matches || root.classList.contains('folds')); kit?.refresh?.($<HTMLElement>('.tools')) })
  // Up and down are held, as Space and C are; Use does what a tap of the old round key did.
  const holding = (el: HTMLElement, code: string) => {
    const on = (e: PointerEvent) => { e.preventDefault(); el.setPointerCapture(e.pointerId); page.controls.hold(code, true) }
    const off = () => page.controls.hold(code, false)
    el.addEventListener('pointerdown', on)
    for (const t of ['pointerup', 'pointercancel', 'lostpointercapture']) el.addEventListener(t, off)
  }
  holding($('.up'), 'Space')
  holding($('.down'), 'KeyC')
  $<HTMLButtonElement>('.use').addEventListener('click', () => page.controls.use())

  // Every frame: the sky goes on towards what was asked, and the controls show what the page has.
  let shownHour = NaN, shownTool = -1, shownWeather = '', shownGraphics = '', shownRes = '', shownMode: Mode | null | undefined, night: boolean | null = null, stickAt = ''
  page.watch((gap) => {
    sky.step(gap / 1000)
    mode?.step(gap / 1000)
    if (mode && mode.showing !== shownMode) { shownMode = mode.showing; for (const m of modeKeys) m.checked = m.value === shownMode }
    // (No hour: a realm's own light where it has one, as the Sky keys are offered only there; else the sun's own.)
    const h = sky.hour ?? (mode ? OWN_HOUR : UNSET)
    // (24 is midnight as 0 is: a fader left at its right end stays there.)
    if (!dragging && h !== shownHour && !(h === 0 && hourIn.value === '24')) { hourIn.value = String(h); shownHour = h }
    const said = clock(Number(hourIn.value))
    if (hourOut.value !== said) hourOut.value = said
    if (sky.weather !== shownWeather) { shownWeather = sky.weather; for (const w of weathers) w.checked = w.value === sky.weather }
    const t = page.tool()
    if (t !== shownTool) { shownTool = t; tools.forEach((el, i) => { el.checked = i === t }) }
    const g = page.graphics?.get() ?? ''
    if (g !== shownGraphics) { shownGraphics = g; for (const el of graphics) el.checked = el.value === g }
    // Dynamic resolution: On shows the Target FPS bank; Off shows the manual resolution fader.
    if (res && resAuto && resFps && resManual && resIn && resOut) {
      const r = res.get(), at = String(Math.round(r.scale * 100)), key = `${at},${r.auto},${r.target},${r.fixed}`
      if (key !== shownRes) {
        const toggled = resFps.hidden !== !r.auto
        shownRes = key
        resAuto.checked = r.auto
        resFps.hidden = !r.auto
        resManual.hidden = r.auto
        if (!sizing) resIn.value = at
        resOut.value = `${at}%`
        for (const el of rates) el.checked = el.value === String(r.target)
        for (const el of [resAuto, resIn, ...rates]) el.disabled = r.fixed
        if (toggled && !panel.hidden && kit) {
          const shown = r.auto ? resFps.querySelector('.rates') : resManual.querySelector('.vx-slider')
          if (shown) kit.refresh?.(shown)
          kit.refresh?.(panel)
        }
      }
    }
    // The kit's day and night follow the hour (SPEC: a world with a time of day sets data-theme from its clock).
    // (Following San Francisco, by its sun, which sets near five in winter and half past eight in summer.)
    const dark = mode?.showing === 'sf' ? page.march.day < 0.5 : h < 6.5 || h >= 18.5
    if (dark !== night) { night = dark; html.dataset.theme = dark ? 'dark' : 'light' }
    // The stick: at rest bottom left, where a thumb goes; with a thumb down, under it, its cap where the thumb is.
    if (coarse.matches) {
      const th = page.controls.thumb
      // (Held upright it rests higher: at 170 px up it was over the BLOG board's left end.)
      const from = th ? th.from : innerHeight > innerWidth ? [72, innerHeight - 252] : [88, innerHeight - 170]
      let dx = th ? th.at[0] - th.from[0] : 0, dy = th ? th.at[1] - th.from[1] : 0
      const far = Math.hypot(dx, dy)
      if (far > 38) { dx *= 38 / far; dy *= 38 / far }
      const key = `${from[0]},${from[1]},${Math.round(dx)},${Math.round(dy)},${!!th}`
      if (key !== stickAt) {
        stickAt = key
        stick.style.transform = `translate(${from[0]}px, ${from[1]}px)`
        cap.style.transform = `translate(${Math.round(dx)}px, ${Math.round(dy)}px)`
        stick.classList.toggle('on', !!th)
      }
    }
  })

  if (!plainOnly) {
    const at = new URL('../kit/src/index.js', import.meta.url).href
    void import(at).then((k) => { kit = k; k.adopt(root) }).catch(() => {})
  }
  return {
    sky, root, get kit() { return kit },
    /** Light, Dark or San Francisco now (modes.ts), where the realm has them. */
    modes: mode,
    /** Folds the hour's panel behind its key, on a wide page too, or opens it. */
    fold(on: boolean) { root.classList.add('folds'); folded(on) },
    /** The panel as it is unasked: behind its key on a phone, open in its corner elsewhere (after the first view folded it, #506). */
    rest() { root.classList.remove('folds'); folded(coarse.matches) },
  }
}
