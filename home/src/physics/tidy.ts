// Putting the house back (#107): once loose things lie about, a small paper tag by the sound
// button offers to tidy up. One press puts every loose thing back where it was made, at rest.
// What was knocked over is play, not a change to the house plan, so nothing is saved either way.
import type { Context } from 'cordis'
import type { World } from '../engine/world'

const CSS = `
.village-tidy { position: fixed; left: 118px; bottom: 20px; z-index: 30; padding: 7px 16px; border: 0; border-radius: 999px; cursor: pointer;
  font: 600 16px "Bradley Hand", "Segoe Print", "Comic Sans MS", cursive; color: #5a4030; background: rgba(251, 243, 226, 0.94);
  box-shadow: 0 2px 6px rgba(60, 40, 20, .25); opacity: 0; transform: translateY(6px); pointer-events: none; transition: opacity .25s ease, transform .25s ease; }
.village-tidy.on { opacity: 1; transform: none; pointer-events: auto; }
.village-tidy:focus-visible { outline: 2px solid #6b4a2b; outline-offset: 2px; }
@media (prefers-reduced-motion: reduce) { .village-tidy { transition: none; } }
`

export function tidy(ctx: Context, world: World, holding: () => string | null) {
  const style = document.createElement('style')
  style.textContent = CSS
  const button = document.createElement('button')
  button.type = 'button'
  button.className = 'village-tidy'
  button.textContent = 'Tidy up'
  button.setAttribute('aria-label', 'Put everything back where it was')
  const show = () => {
    const on = !holding() && Object.keys(world.astray(0.05)).length > 0
    button.classList.toggle('on', on)
    button.tabIndex = on ? 0 : -1
  }
  button.addEventListener('click', () => {
    world.tidy()
    show()
  })
  ctx.effect(() => {
    document.head.append(style)
    document.body.append(button)
    const id = setInterval(show, 1000)
    return () => {
      clearInterval(id)
      button.remove()
      style.remove()
    }
  }, 'physics tidy')
}
