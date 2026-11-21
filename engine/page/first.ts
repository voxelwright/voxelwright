// The first view of a realm the page runs alone (#450): the picture, one key that says Explore, and who the place is
// made from behind a small key. The line of numbers, the aim, the hour and weather, the tools and the street's name
// (and whatever else the page lays over the picture) are the page's still, and hidden until the visitor engages: a key pressed, a drag on the picture, the pointer taken
// by a click on it, the Explore key, or the host's `explore`. Then they come, once, and stay.
//
// The two keys here are the Voxelmorphism kit's (engine/kit): plain HTML first, voxels when the kit comes. Nothing of
// the page's own is made or owned here: it is hidden by one class on <html> (`first`), which this file takes away.
//
//   ?first=0   no first view: the controls are there from the start (the boards' editor asks for the same)
import { embedded, hear, tell } from './host.ts'

export interface First {
  /** Whether the visitor has engaged: the controls are shown. */
  readonly engaged: boolean
  /** Shows the controls, as the visitor's own first move does. */
  engage(): void
  /** Whose data the place is made from, each said once: what the credits key opens. */
  credits(list: readonly string[]): void
}

const STYLE = /* css */ `
/* Until the visitor engages, nothing of the page's own is over the picture. */
html.first :is(#hud, #aim, #realm, #where, #over) { visibility: hidden; opacity: 0; }
html.first #realm .sky { translate: 0 -10px; }
html.first #realm .tools, html.first #realm .thumbs { translate: 0 10px; }
/* They come as one: the picture's own marks first, the hardware a moment after, settling into place. */
:is(#hud, #aim, #where, #over) { transition: opacity 0.5s ease-out 0.12s; }
#realm { transition: opacity 0.36s ease-out; }
#realm :is(.sky, .tools, .thumbs) { transition: translate 0.5s cubic-bezier(0.2, 0.8, 0.2, 1); }
#first { position: fixed; inset: 0; z-index: 6; pointer-events: none; font: 400 14px/1.4 var(--vx-font, system-ui, sans-serif); }
#first > * { pointer-events: auto; }
#first .explore { position: absolute; left: 50%; bottom: max(20px, calc(env(safe-area-inset-bottom) + 14px)); translate: -50% 0; min-inline-size: calc(var(--vx) * 28); justify-content: center; transition: opacity 0.28s ease-in, translate 0.4s ease-in; }
html:not(.first) #first .explore { opacity: 0; translate: -50% 14px; pointer-events: none; }
#first .credits { position: absolute; left: max(12px, env(safe-area-inset-left)); bottom: max(12px, env(safe-area-inset-bottom)); --vx: 3px; font-size: 12px; opacity: 0.86; }
#first .credits:is(:hover, :focus-visible, [aria-expanded="true"]) { opacity: 1; }
/* By touch the bottom corners are the thumbs': the credits key is at the top, where a phone shows no line of numbers. */
@media (pointer: coarse) { #first .credits { bottom: auto; top: max(12px, env(safe-area-inset-top)); } }
#first-credits { max-block-size: min(60vh, 420px); overflow: auto; }
#first-credits ul { margin: 0; padding: 0; list-style: none; display: grid; gap: calc(var(--vx) * 2); font-size: 0.8125rem; line-height: 1.4; color: var(--vx-ink-quiet); }
/* The street's name stands over the credits key. */
#where { bottom: 58px !important; }
@media (prefers-reduced-motion: reduce) { :is(#hud, #aim, #where, #over, #realm, #realm *, #first .explore) { transition: none !important; } }
`

export function firstView(canvas: HTMLCanvasElement, on: boolean): First {
  const html = document.documentElement
  let engaged = !on
  const style = document.createElement('style')
  style.textContent = STYLE
  const root = document.createElement('div')
  root.id = 'first'
  root.innerHTML = /* html */ `
    <button class="vx-button explore" type="button" data-vx-kind="main">Explore</button>
    <button class="vx-button credits" type="button" popovertarget="first-credits" aria-label="Credits: whose data this place is made from">Credits</button>
    <div class="vx-popover" id="first-credits" popover aria-label="Credits"><h3>This place is made from</h3><ul></ul></div>`
  const explore = root.querySelector<HTMLButtonElement>('.explore')!, list = root.querySelector<HTMLUListElement>('ul')!
  if (on) html.classList.add('first'); else explore.hidden = true
  // The kit's stylesheet and look, as the realm's controls ask for them too (realm-ui.ts): these keys are there first.
  const sheet = document.createElement('link')
  sheet.rel = 'stylesheet'
  sheet.href = new URL('../kit/voxelmorphism.css', import.meta.url).href
  html.dataset.vxLook = 'lit'
  document.head.append(sheet, style)
  document.body.append(root)

  const kitAt = new URL('../kit/src/index.js', import.meta.url).href
  type Kit = { adopt(root?: Element): void; live(el: Element): { play(effect: 'assemble' | 'crumble'): Promise<unknown> } | null }
  let kit: Kit | null = null
  if (new URLSearchParams(location.search).get('kit') !== 'plain') void import(kitAt).then((k: Kit) => { kit = k; k.adopt(root) }).catch(() => {})

  const engage = () => {
    if (engaged) return
    engaged = true
    html.classList.remove('first')
    // The hardware builds itself as it comes (the kit's own assembling; still, where motion is not wanted), and the Explore key, its work done, goes.
    for (const el of document.querySelectorAll('#realm [data-vx-live]')) void kit?.live(el)?.play('assemble')
    void kit?.live(explore)?.play('crumble')
    setTimeout(() => { explore.hidden = true }, 450)
    if (document.activeElement === explore) explore.blur()
    tell('engaged')
  }
  if (on) {
    explore.addEventListener('click', engage)
    // A key that is not only held with another: Shift alone says nothing yet.
    addEventListener('keydown', (e) => { if (!['Shift', 'Control', 'Alt', 'Meta'].includes(e.key)) engage() }, true)
    document.addEventListener('pointerlockchange', () => { if (document.pointerLockElement === canvas) engage() })
    // A drag on the picture (a thumb steering, or looking round): a tap is a board's, and not this.
    let from: { id: number; x: number; y: number } | null = null
    canvas.addEventListener('pointerdown', (e) => { from = { id: e.pointerId, x: e.clientX, y: e.clientY } })
    canvas.addEventListener('pointermove', (e) => { if (from?.id === e.pointerId && e.buttons && Math.hypot(e.clientX - from.x, e.clientY - from.y) > 12) engage() })
    for (const t of ['pointerup', 'pointercancel']) canvas.addEventListener(t, () => { from = null })
    if (embedded) hear((m) => { if (m.type === 'explore') engage() })
  }
  return {
    get engaged() { return engaged },
    engage,
    credits(said) { list.replaceChildren(...said.map((c) => Object.assign(document.createElement('li'), { textContent: c }))) },
  }
}
