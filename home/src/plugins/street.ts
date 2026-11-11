// The way back out to the street (#118). The home's door stands on the Block (street/): whoever
// comes in through it arrives with the street's address in the page's own (?street=...), and a
// round door button beside the sound buttons goes back there. The address is remembered for
// the tab, and believed only when it is on this machine's own name: a link somebody else made
// cannot send you anywhere else.
import type { Context } from 'cordis'

const KEY = 'village:street'
const DOOR = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6.5 20.5V5.2c0-.9.7-1.7 1.7-1.7h7.6c1 0 1.7.8 1.7 1.7v15.3"/><path d="M4.5 20.5h15"/><circle class="knob" cx="14.4" cy="12.6" r="1"/></svg>`
const CSS = `
.street-door { position: fixed; left: 112px; bottom: 16px; z-index: 30; width: 40px; height: 40px; border-radius: 50%;
  border: 0; padding: 0; cursor: pointer; display: grid; place-items: center;
  background: radial-gradient(circle at 35% 30%, #f3e4c8, #e2c9a0 70%, #cfb085);
  box-shadow: 0 2px 6px rgba(60, 40, 20, .25), inset 0 0 0 3px rgba(255, 250, 240, .35);
  outline: 1.5px dashed rgba(110, 80, 50, .45); outline-offset: -6px; transition: transform .15s ease; }
.street-door:hover { transform: scale(1.06); }
.street-door:focus-visible { outline: 2px solid #6b4a2b; outline-offset: 2px; }
.street-door svg { width: 22px; height: 22px; fill: none; stroke: #6b4a2b; stroke-width: 1.7; stroke-linecap: round; stroke-linejoin: round; }
.street-door .knob { fill: #6b4a2b; stroke: none; }
@media (prefers-reduced-motion: reduce) { .street-door { transition: none; } }
`

/** The street's address when this visit came in from it: an http(s) address on this page's own host name, or null. */
export function streetFrom(search: string, remembered: string | null, hostname: string): string | null {
  const raw = new URLSearchParams(search).get('street') ?? remembered
  if (!raw) return null
  try {
    const url = new URL(raw)
    return (url.protocol === 'https:' || url.protocol === 'http:') && url.hostname === hostname ? url.href : null
  } catch {
    return null
  }
}

export default {
  name: 'street',
  apply(ctx: Context) {
    let remembered: string | null = null
    try { remembered = sessionStorage.getItem(KEY) } catch { /* a tab with no storage still gets the way back for this page */ }
    const street = streetFrom(location.search, remembered, location.hostname)
    if (!street) return
    try { sessionStorage.setItem(KEY, street) } catch { /* as above */ }
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'street-door'
    button.innerHTML = DOOR
    button.title = 'Out to the street'
    button.setAttribute('aria-label', 'Out to the street')
    button.addEventListener('click', () => {
      const to = new URL(street)
      to.searchParams.set('from', 'home')
      location.href = to.href
    })
    const style = document.createElement('style')
    style.textContent = CSS
    ctx.effect(() => {
      document.head.append(style)
      document.body.append(button)
      // It sits beside the sound buttons: one place in when the music's button is not there (the quiet kitchen).
      const settle = setTimeout(() => { if (!document.querySelector('.music-note')) button.style.left = '64px' }, 300)
      return () => {
        clearTimeout(settle)
        button.remove()
        style.remove()
      }
    }, 'street door')
  },
}
