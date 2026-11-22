// The first view of a realm the page runs alone (#450): the picture, and who the place is made from behind a small
// key. The line of numbers, the aim, the hour and weather, the tools and the street's name (and whatever else the page
// lays over the picture) are the page's still, and hidden until the visitor engages. Nothing done by chance engages:
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
  /** Runs once when the visitor engages (at once if they have). */
  onEngage(run: () => void): void
  /** Whose data the place is made from, each said once: what the credits key opens. */
  credits(list: readonly string[]): void
}

const STYLE = /* css */ `
/* Until the visitor engages, nothing of the page's own is over the picture. */
html.first :is(#hud, #aim, #realm, #where, #over) { visibility: hidden; opacity: 0; }
html.plain #hud { display: none; }
/* A tap on the picture is a tap on a board (boards.ts), not on a link: no flash of the browser's own over the whole of it. */
canvas { -webkit-tap-highlight-color: transparent; }
html.first #realm .sky { translate: 0 -10px; }
html.first #realm .tools, html.first #realm .thumbs { translate: 0 10px; }
/* They come as one: the picture's own marks first, the hardware a moment after, settling into place. */
:is(#hud, #aim, #where, #over) { transition: opacity 0.5s ease-out 0.12s; }
#realm { transition: opacity 0.36s ease-out; }
#realm :is(.sky, .tools, .thumbs) { transition: translate 0.5s cubic-bezier(0.2, 0.8, 0.2, 1); }
#first { position: fixed; inset: 0; z-index: 6; pointer-events: none; font: 400 14px/1.4 var(--vx-font, system-ui, sans-serif); }
#first > * { pointer-events: auto; }
#first .credits { position: absolute; left: max(12px, env(safe-area-inset-left)); bottom: max(12px, env(safe-area-inset-bottom)); --vx: 3px; --vx-key-size: var(--vx-key-small); opacity: 0.86; }
#first .credits:is(:hover, :focus-visible, [aria-expanded="true"]) { opacity: 1; }
/* By touch the bottom corners are the thumbs': the credits key is at the top, where a phone shows no line of numbers. */
/* (Its voxel body stands out past its box to the left and up: further in from the corner than 12 px, or the screen's edge cuts it.) */
@media (pointer: coarse) { #first .credits { bottom: auto; left: max(22px, calc(env(safe-area-inset-left) + 10px)); top: max(20px, calc(env(safe-area-inset-top) + 8px)); } }
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
    <button class="vx-button credits" type="button" popovertarget="first-credits" aria-label="Credits: whose data this place is made from">Credits</button>
    <div class="vx-popover" id="first-credits" popover aria-label="Credits"><h3>This place is made from</h3><ul></ul></div>`
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

  const waiting: (() => void)[] = []
  const engage = () => {
    if (engaged) return
    engaged = true
    for (const run of waiting.splice(0)) run()
    html.classList.remove('first')
    // The hardware builds itself as it comes (the kit's own assembling; still, where motion is not wanted).
    for (const el of document.querySelectorAll('#realm [data-vx-live]')) void kit?.live(el)?.play('assemble')
    tell('engaged')
  }
  // In a host's frame the keys are the host's until the frame has the focus: the realm is the page's picture, and takes it.
  if (on && embedded) window.focus()
  return {
    get engaged() { return engaged },
    engage,
    onEngage(run) { if (engaged) run(); else waiting.push(run) },
    // (Said once each, however it was written: two releases name the same terrain with a capital and without.)
    credits(said) { list.replaceChildren(...said.filter((c, i) => said.findIndex((d) => d.toLowerCase() === c.toLowerCase()) === i).map((c) => Object.assign(document.createElement('li'), { textContent: c }))) },
  }
}
