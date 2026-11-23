// The controls of a realm the page runs alone (#450): the hour, the weather, the tools and reset, and on a phone a
// stick, keys to fly up and down and the key that uses the tool. Each is a control of the Voxelmorphism kit
// (engine/kit), chosen by what the hand does (DESIGN.md): a fader for the hour, which is set by where it stands and
// moved finely; banks of latching keys for the weather and the tools, one of each latched down; a danger key to
// put the world back. The stick is a well the thumb's cap moves in.
//
// It is plain HTML and CSS first, working with no script of the kit's; the kit's own renderer then makes it
// voxels (`?kit=plain` keeps it plain). Nothing here owns state: the page's keys ([ ] R 1 to 7 Backspace) and its
// checks set the same things, and every frame what is shown is read back from the page.
import { skies, UNSET, WEATHERS, type Weather } from './weather.ts'
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
  graphics?: { presets: readonly string[]; get(): string; set(preset: string): void }
  /** Opens the line to say something to the city on (eggs.ts), where the page has one: by touch there is no Enter or slash. */
  say?(): void
}

const GRAPHICS: Record<string, string> = { auto: 'Auto', low: 'Low', medium: 'Medium', high: 'High' }

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
/* The weather: four seats two by two. A raised cap's left wall stands over the first two voxels of its face, so the words
   keep that far in, and Overcast (84 px in Vox Zakon Text at the key size, 78 in Vox Text) has no room for that four across. */
#realm .sky .weather { grid-auto-flow: row; grid-template-columns: 1fr 1fr; }
#realm .sky .vx-toggle-group > label { padding-inline: calc(var(--vx) * 2.5); white-space: nowrap; }
/* (Its two parts, the sky's and the rest, are one column of the panel; side by side on a phone on its side.) */
#realm .sky .part { display: contents; }
#realm .sky .foot { display: flex; justify-content: flex-end; gap: calc(var(--vx) * 3); }
/* The graphics, two by two as the weather (Medium is as wide as Overcast). */
#realm .sky .graphics { grid-auto-flow: row; grid-template-columns: 1fr 1fr; }
#realm .sky .foot .say { margin-inline-end: auto; }
/* The tools: a bank along the bottom, in the smaller size of the key font (typeface.ts), so that the bank stands clear of
   the place's name in the corner. The kit draws a key's side walls over its padding, the left one the wider: five and a
   half cells before its words and four after, so a word's first figure stands clear of the wall (3 Big charge, #450). */
#realm .tools { position: absolute; left: 50%; bottom: max(30px, env(safe-area-inset-bottom)); transform: translateX(-50%); --vx-key-size: var(--vx-key-small); }
#realm .tools > label { padding-inline: calc(var(--vx) * 5.5) calc(var(--vx) * 4); white-space: nowrap; }
#realm .tools .n { margin-inline-end: 6px; color: var(--vx-ink-quiet); }
/* What a thumb has: only where the pointer is coarse. */
#realm .thumbs { display: none; }
#realm .fold { display: none; }
/* Folded behind its key where something else has the corner (explore.ts: what a roof is for), as on a phone. */
/* The settings key is its gear alone, in cells of 3 px, 44 px a side as the key it replaced was tall (kit: data-vx-icon-only). */
#realm .fold { --vx: 3px; min-inline-size: 44px; min-block-size: 44px; }
#realm.folds .fold { display: block; position: absolute; right: max(16px, env(safe-area-inset-right)); top: max(16px, env(safe-area-inset-top)); }
#realm.folds .sky { top: calc(max(16px, env(safe-area-inset-top)) + 60px); }
@media (pointer: coarse) {
  #realm .fold { display: block; position: absolute; right: max(12px, env(safe-area-inset-right)); top: max(12px, env(safe-area-inset-top)); }
  /* (On a phone the panel is words a column wide: the smaller size of the key font, as the tools have, its cells still whole pixels, typeface.ts.) */
  #realm .sky { top: calc(max(12px, env(safe-area-inset-top)) + 56px); right: max(12px, env(safe-area-inset-right)); inline-size: min(calc(100vw - 24px), calc(var(--vx) * 76)); --vx-key-size: var(--vx-key-small); }
  /* The line to say something on (eggs.ts) stands at the top by touch: the phone's keyboard comes up over the bottom. Its
     words are 16 px, under which Safari zooms the page to the field. */
  #realm .egg-line { bottom: auto !important; top: calc(env(safe-area-inset-top, 0px) + 140px) !important; z-index: 2; }
  /* On its side the phone is low: the panel is two columns, the sky's on the left and the graphics and keys on the right. */
  @media (orientation: landscape) {
    #realm .sky { inline-size: min(calc(100vw - 2 * max(12px, env(safe-area-inset-left)) - 24px), calc(var(--vx) * 150)); grid-template-columns: 1fr 1fr; column-gap: calc(var(--vx) * 6); align-items: start; }
    #realm .sky .part { display: grid; gap: calc(var(--vx) * 3); }
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
    <button class="vx-button fold" type="button" aria-expanded="false" aria-controls="realm-sky" aria-label="Weather, time of day and graphics" title="Weather, time of day and graphics" data-vx-icon="gear" data-vx-icon-only></button>
    <section class="vx-card sky" id="realm-sky" aria-label="Sky">
      <div class="part">
      <header><h2>Time</h2><output aria-live="off"></output></header>
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
      <div class="foot">${page.say ? '<button class="vx-button say" type="button" aria-keyshortcuts="Enter" title="Say something to the city (Enter)">Say…</button>' : ''}<button class="vx-button reset" type="button" data-vx-kind="danger" title="Put the world back as it was (Backspace)">Reset world</button></div>
      </div>
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
  const tools = [...root.querySelectorAll<HTMLInputElement>('input[name=realm-tool]')]
  const graphics = [...root.querySelectorAll<HTMLInputElement>('input[name=realm-graphics]')]
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
  hourIn.addEventListener('input', () => sky.glide(Number(hourIn.value)))
  for (const w of weathers) w.addEventListener('change', () => { if (w.checked) sky.set(w.value as Weather) })
  for (const t of tools) t.addEventListener('change', () => { if (t.checked) page.pickTool(Number(t.value)) })
  $<HTMLButtonElement>('.reset').addEventListener('click', () => void page.reset())
  for (const g of graphics) g.addEventListener('change', () => { if (g.checked) page.graphics?.set(g.value) })
  // The line opens in the same press, so that a phone brings its keyboard up (Safari does only for a focus the hand made).
  // Where the panel is a drawer behind its key, it is folded first: the line is to be read.
  // (The line was hidden when the kit took up the controls, and is drawn as a card of it once it is shown.)
  root.querySelector('.say')?.addEventListener('click', () => { if (coarse.matches || root.classList.contains('folds')) folded(true); page.say?.(); const line = root.querySelector('.egg-line:not([hidden])'); if (line && !line.hasAttribute('data-vx-live')) kit?.adopt(line) })
  // On a phone the panel folds away behind its key.
  const folded = (on: boolean) => { panel.hidden = on; fold.setAttribute('aria-expanded', String(!on)); root.classList.toggle('open', !on) }
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
  let shownHour = NaN, shownTool = -1, shownWeather = '', shownGraphics = '', night: boolean | null = null, stickAt = ''
  page.watch((gap) => {
    sky.step(gap / 1000)
    const h = sky.hour ?? UNSET
    // (24 is midnight as 0 is: a fader left at its right end stays there.)
    if (!dragging && h !== shownHour && !(h === 0 && hourIn.value === '24')) { hourIn.value = String(h); shownHour = h }
    const said = clock(Number(hourIn.value))
    if (hourOut.value !== said) hourOut.value = said
    if (sky.weather !== shownWeather) { shownWeather = sky.weather; for (const w of weathers) w.checked = w.value === sky.weather }
    const t = page.tool()
    if (t !== shownTool) { shownTool = t; tools.forEach((el, i) => { el.checked = i === t }) }
    const g = page.graphics?.get() ?? ''
    if (g !== shownGraphics) { shownGraphics = g; for (const el of graphics) el.checked = el.value === g }
    // The kit's day and night follow the hour (SPEC: a world with a time of day sets data-theme from its clock).
    const dark = h < 6.5 || h >= 18.5
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

  // The kit's voxels, once the world is drawing: the page is plain until they come, and stays so with ?kit=plain.
  let kit: { adopt(root?: Element): void; refresh?(el: Element): void } | null = null
  if (!plainOnly) {
    const at = new URL('../kit/src/index.js', import.meta.url).href
    void import(at).then((k) => { kit = k; k.adopt(root) }).catch(() => {})
  }
  return {
    sky, root, get kit() { return kit },
    /** Folds the hour's panel behind its key, on a wide page too, or opens it. */
    fold(on: boolean) { root.classList.add('folds'); folded(on) },
    /** The panel as it is unasked: behind its key on a phone, open in its corner elsewhere (after the first view folded it, #506). */
    rest() { root.classList.remove('folds'); folded(coarse.matches) },
  }
}
