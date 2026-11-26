// The first view of a realm the page runs alone (#450): the picture, and who the place is made from behind a small
// key, and the realm's settings key (a gear) in the other corner: the weather, the hour and the graphics (#506). The line of numbers,
// the aim, the tools and the street's name (and whatever else the page lays over the picture) are the page's still,
// and hidden until the visitor engages. Nothing done by chance engages:
// the picture is a still one, no key moves the eye and no click takes the pointer (main.ts keeps a mode over the
// page's own until then). The way in is the EXPLORE board, asked twice (explore.ts), or the host's `explore`; either
// ends in `engage`. Then the controls come, once, and stay.
//
// The key here is the Voxelmorphism kit's (engine/kit): plain HTML first, voxels when the kit comes. Nothing of
// the page's own is made or owned here: it is hidden by one class on <html> (`first`), which this file takes away.
//
//   ?first=0   no first view: the controls are there from the start (the boards' editor asks for the same)
//   ?debug=1   the line of numbers (frames, the march's time, memory, where the eye is) is shown with the controls;
//              without it a realm the page runs alone never shows it (main.ts sets `plain` on <html>)
import { embedded, tell } from './host.ts'
import { legends } from './typeface.ts'

export interface First {
  /** Whether the visitor has engaged: the controls are shown. */
  readonly engaged: boolean
  /** Shows the controls, as the visitor's own first move does. */
  engage(): void
  /** The first view again, from the realm, as the eye starts back to it: the controls hidden, what holds while it is up started again, the host told `back`. */
  back(): void
  /** What holds while the first view is up: started now (unless the visitor is in) and each time it comes back; what it returns is run as the visitor engages. */
  during(start: () => () => void): void
  /** Whose data the place is made from, each said once: what the credits key opens. */
  credits(list: readonly string[]): void
}

const STYLE = /* css */ `
/* Until the visitor engages, nothing of the page's own is over the picture but the realm's settings key and the panel it
   opens (realm-ui.ts), with the weather, the hour and the graphics (#506): what is for playing, saying and putting the
   world back (its foot) is the realm's. */
html.first :is(#hud, #aim, #where, #over, #realm > :not(.fold, .sky)) { visibility: hidden; opacity: 0; }
html.first #realm .sky :is(.foot, .vx-groove) { display: none; }
/* Open in the first view, the panel leaves the EXPLORE board, its tower and BLOG in sight (#506, measured by
   test/sf-sky.mjs). On a desk it hangs in the top right corner as in the realm, right of the tower. Held upright, a
   phone has EXPLORE and its tower down the last eighth of its picture and BLOG low in the middle: the panel hangs
   from the top on the left, short of the tower. On its side the tower is at about three fifths across and BLOG low
   in the middle: the panel lies beside the corner's keys (the credits key, the lockers' count under it: where they
   end is --first-corner-right, measured), left of the tower, the hour across its top and the weather
   and the graphics side by side under it, over BLOG's top (its ticks left out for the height, and its fader where the
   realm has the sky's keys: the realm's own panel has it). */
@media (pointer: coarse) and (orientation: portrait) {
  html.first #realm.folds .sky { left: max(12px, env(safe-area-inset-left)); right: auto; inline-size: min(calc(100vw - 2 * max(12px, env(safe-area-inset-left)) - 64px), calc(var(--vx) * 76)); }
  /* (With the sky's keys, #524, its foot a cell less, so that its solid stands clear of BLOG's top.) */
  html.first #realm.folds .sky:has(.modes) { padding-block-end: calc(var(--vx) * 4); }
}
@media (pointer: coarse) and (orientation: landscape) {
  html.first #realm.folds .sky { top: max(20px, env(safe-area-inset-top)); left: calc(var(--first-corner-right, calc(max(22px, calc(env(safe-area-inset-left) + 16px)) + 78px)) + 14px); right: 39vw; inline-size: auto; padding-inline: calc(var(--vx) * 3); column-gap: calc(var(--vx) * 3); grid-template-columns: 1.15fr 1fr; align-items: start; }
  html.first #realm.folds .sky .part { display: contents; }
  html.first #realm.folds .sky :is(header:not(.g), .vx-slider) { grid-column: 1 / -1; }
  html.first #realm.folds .sky .ticks { display: none; }
  /* (The sky's keys, Light, Dark and SF now, three across under the hour where its fader is in the realm's own panel:
     a row more would take the panel down over BLOG, #524.) */
  html.first #realm.folds .sky .modes { display: grid; grid-column: 1 / -1; grid-row: 2; }
  html.first #realm.folds .sky:has(.modes) .vx-slider { display: none; }
  html.first #realm.folds .sky .weather { grid-column: 1; grid-row: 3 / span 2; }
  html.first #realm.folds .sky header.g { grid-column: 2; grid-row: 3; }
  html.first #realm.folds .sky .graphics { grid-column: 2; grid-row: 4; grid-auto-flow: row; grid-template-columns: 0.85fr 1.15fr; }
  html.first #realm.folds .sky .graphics > label:last-child { grid-column: 1 / -1; }
  /* (The resolution's rows would take the panel down over BLOG: in the first view they wait for the realm's own panel.) */
  html.first #realm.folds .sky .part.res > * { display: none; }
}
/* A short screen at a desk (under 800 px: 1280 x 720, a laptop window of 1366 x 650): with the sky's keys the panel runs
   off its foot. As on a phone on its side, the resolution's rows wait for the realm's own panel (#524). */
@media (pointer: fine) and (max-height: 799px) {
  html.first #realm .sky:has(.modes) .part.res > * { display: none; }
}
/* A smaller phone on its side (under 760 px, 667 x 375): beside the credits key the weather's words did not fit. The
   panel lies under the corner's keys instead (--first-corner-bottom), as wide as it may be left of the tower, with the
   weather and the graphics alone (the hour is the realm's, once in) so that it ends over BLOG. */
@media (pointer: coarse) and (orientation: landscape) and (max-width: 759px) {
  html.first #realm.folds .sky { top: calc(var(--first-corner-bottom, calc(max(20px, env(safe-area-inset-top)) + 44px)) + 12px); left: max(12px, env(safe-area-inset-left)); right: 36vw; }
  html.first #realm.folds .sky :is(header:not(.g), .vx-slider, .modes) { display: none; }
  html.first #realm.folds .sky .weather { grid-row: 1 / span 2; }
  html.first #realm.folds .sky header.g { grid-row: 1; }
  html.first #realm.folds .sky .graphics { grid-row: 2; }
}
html.plain #hud { display: none; }
/* A tap on the picture is a tap on a board (boards.ts), not on a link: no flash of the browser's own over the whole of it. */
canvas { -webkit-tap-highlight-color: transparent; }
html.first #realm .tools, html.first #realm .thumbs { translate: 0 10px; }
/* They come as one: the picture's own marks first, the hardware a moment after, settling into place. */
:is(#hud, #aim, #where, #over) { transition: opacity 0.5s ease-out 0.12s; }
#realm { transition: opacity 0.36s ease-out; }
#realm :is(.tools, .thumbs) { transition: translate 0.5s cubic-bezier(0.2, 0.8, 0.2, 1); }
#first { position: fixed; inset: 0; z-index: 6; pointer-events: none; font: 400 14px/1.4 var(--vx-font, system-ui, sans-serif); }
#first > * { pointer-events: auto; }
/* The corner the credits key stands in, and beside it the count of the windows opened (eggs-lockers.ts). */
#first .corner { position: absolute; left: max(12px, env(safe-area-inset-left)); bottom: max(12px, env(safe-area-inset-bottom)); display: flex; align-items: center; gap: 12px; pointer-events: none; }
#first .corner > * { pointer-events: auto; }
#first .credits { --vx: 3px; --vx-key-size: var(--vx-key-small); opacity: 0.86; }
#first .credits:is(:hover, :focus-visible, [aria-expanded="true"]) { opacity: 1; }
/* By touch the bottom corners are the thumbs': the credits key is at the top, where a phone shows no line of numbers. */
/* (Its voxel body stands out past its box to the left and up: further in from the corner than 12 px, or the screen's edge cuts it.) */
@media (pointer: coarse) { #first .corner { bottom: auto; left: max(22px, calc(env(safe-area-inset-left) + 10px)); top: max(20px, calc(env(safe-area-inset-top) + 8px)); } }
/* On its side (760 px wide and more) a phone's settings panel lies beside the credits key: what else is in the corner
   stands under it. (On a smaller one the panel lies under the corner, which stays a row.) */
@media (pointer: coarse) and (orientation: landscape) and (min-width: 760px) { #first .corner { flex-direction: column; align-items: flex-start; gap: 10px; } }
#first-credits { max-block-size: min(60vh, 420px); overflow: auto; }
#first-credits ul { margin: 0; padding: 0; list-style: none; display: grid; gap: calc(var(--vx) * 2); font-size: 0.8125rem; line-height: 1.4; color: var(--vx-ink-quiet); }
/* The street's name stands over the credits key. */
#where { bottom: 58px !important; }
@media (prefers-reduced-motion: reduce) { :is(#hud, #aim, #where, #over, #realm, #realm *) { transition: none !important; } }
`

export function firstView(on: boolean): First {
  const html = document.documentElement
  let engaged = !on
  const style = document.createElement('style')
  style.textContent = STYLE
  const root = document.createElement('div')
  root.id = 'first'
  root.innerHTML = /* html */ `
    <div class="corner"><button class="vx-button credits" type="button" popovertarget="first-credits" aria-label="Credits: whose data this place is made from">Credits</button></div>
    <div class="vx-popover" id="first-credits" popover aria-label="Credits"><h3>This place is made from</h3><ul></ul><a href="./CREDITS.txt">Full source credits</a></div>`
  const mapillary = document.createElement('a')
  mapillary.href = 'https://www.mapillary.com/'
  mapillary.target = '_blank'
  mapillary.rel = 'noopener noreferrer'
  mapillary.setAttribute('aria-label', 'Mapillary street imagery')
  // Mapillary's attribution mark from its API demo, kept inline for offline realms.
  mapillary.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" fill="none" viewBox="0 0 35 35"><path fill="#05cb63" fill-rule="evenodd" d="M16.468 25.735c.624.327 15.734 8.542 16.21 8.807.954.528 1.963-.494 1.444-1.45-.261-.48-8.446-15.977-8.722-16.451-.276-.475-.956-.714-1.467-.396-.5.312-1.077.663-1.4.832-.651.34-.731.851-.439 1.42.643 1.248 2.664 5.038 2.896 5.435.484.831-.596 1.78-1.329 1.366-.31-.176-5.107-2.768-5.446-2.971-.339-.203-.94-.201-1.351.484a53.63 53.63 0 00-.837 1.425c-.334.61-.182 1.172.441 1.499zM.517 17.069c-.805-.448-.658-1.613.357-1.91.86-.252 7.844-2.657 9.957-3.386.382-.131.679-.434.807-.82L15.032.724c.317-.957 1.466-.96 1.935-.034.166.33 6.49 12.106 6.71 12.606.22.5.078 1.053-.42 1.372-.5.319-1.312.796-1.596.977-.513.328-1.004.1-1.238-.408-.234-.507-2.038-3.78-2.774-5.169-.368-.694-1.476-.96-1.848.162l-1.224 3.689a1.343 1.343 0 01-.812.827l-3.683 1.254c-.727.247-1.08 1.392-.099 1.874.205.1 4.626 2.538 5.082 2.76.457.224.71.867.443 1.323-.364.622-.83 1.411-1 1.668-.293.444-.87.591-1.353.33C12.671 23.69.804 17.228.517 17.068z" clip-rule="evenodd"></path></svg>'
  mapillary.hidden = true
  root.querySelector('.corner')!.append(mapillary)
  const list = root.querySelector<HTMLUListElement>('ul')!
  if (on) html.classList.add('first')
  // The kit's stylesheet and look, as the realm's controls ask for them too (realm-ui.ts): these keys are there first.
  const sheet = document.createElement('link')
  sheet.rel = 'stylesheet'
  sheet.href = new URL('../kit/voxelmorphism.css', import.meta.url).href
  html.dataset.vxLook = 'lit'
  document.head.append(sheet, style)
  legends()
  document.body.append(root)

  const kitAt = new URL('../kit/src/index.js', import.meta.url).href
  type Kit = { adopt(root?: Element): void; live(el: Element): { play(effect: 'assemble' | 'crumble'): Promise<unknown> } | null }
  let kit: Kit | null = null
  if (new URLSearchParams(location.search).get('kit') !== 'plain') void import(kitAt).then((k: Kit) => { kit = k; k.adopt(root) }).catch(() => {})

  const starts: (() => () => void)[] = [], stops: (() => void)[] = []
  const engage = () => {
    if (engaged) return
    engaged = true
    for (const stop of stops.splice(0)) stop()
    html.classList.remove('first')
    // The hardware builds itself as it comes (the kit's own assembling; still, where motion is not wanted).
    // (Not the settings key and its panel: they were there in the first view.)
    for (const el of document.querySelectorAll('#realm [data-vx-live]')) if (!el.closest('.fold, .sky')) void kit?.live(el)?.play('assemble')
    tell('engaged')
  }
  const back = () => {
    if (!engaged || !on) return
    engaged = false
    html.classList.add('first')
    // (What the realm's controls put away while the picture held the pointer, play-hud.ts `away`, is not away here: in
    // the first view nothing of theirs runs to bring it back, and the credits key would stay hidden.)
    html.classList.remove('away')
    for (const start of starts) stops.push(start())
    tell('back')
  }
  // In a host's frame the keys are the host's until the frame has the focus: the realm is the page's picture, and takes it.
  // Where the corner's keys end (px from the left and the top), for the settings panel to lie clear of them on a phone on its side.
  const corner = root.querySelector<HTMLElement>('.corner')!
  const cornered = () => { const r = corner.getBoundingClientRect(); html.style.setProperty('--first-corner-right', `${Math.round(r.right)}px`); html.style.setProperty('--first-corner-bottom', `${Math.round(r.bottom)}px`) }
  new ResizeObserver(cornered).observe(corner)
  addEventListener('resize', cornered)
  if (on && embedded) window.focus()
  return {
    get engaged() { return engaged },
    engage,
    back,
    during(start) { starts.push(start); if (!engaged) stops.push(start()) },
    // (Said once each, however it was written: two releases name the same terrain with a capital and without.)
    credits(said) {
      const hasMly = said.some(c => c.includes('Mapillary'))
      mapillary.hidden = !hasMly
      html.classList.toggle('has-mapillary', hasMly)
      list.replaceChildren(...said.filter((c, i) => said.findIndex((d) => d.toLowerCase() === c.toLowerCase()) === i).map((c) => Object.assign(document.createElement('li'), { textContent: c })))
    },
  }
}
