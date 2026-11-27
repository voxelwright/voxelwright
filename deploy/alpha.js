// The early-alpha notice added by assemble.mjs to published pages (#450). assemble.mjs
// adds this script to each page it publishes, so the engine's and the site's own pages stay as they are. One origin,
// so one dismissal hides it on both. To retire it: delete this file and its tag in assemble.mjs.
//
// It is drawn with the Voxelmorphism kit both pages already load (the realm adds the sheet from its script, so the
// notice waits for the kit's tokens, up to a few seconds). Storage can be missing or refuse; then it simply shows.
;(() => {
  const KEY = 'zahynailo-alpha-notice', SEEN = 'dismissed-1'
  const dismissed = () => { try { return localStorage.getItem(KEY) === SEEN } catch { return false } }
  if (dismissed()) return

  const style = document.createElement('style')
  style.textContent = `
#alpha-notice { position: fixed; z-index: 50; inset-inline-end: max(16px, env(safe-area-inset-right)); inset-block-end: max(16px, env(safe-area-inset-bottom));
  box-sizing: border-box; inline-size: min(21rem, calc(100vw - 32px)); margin: 0; padding: calc(var(--vx, 4px) * 4) calc(var(--vx, 4px) * 2) calc(var(--vx, 4px) * 4) calc(var(--vx, 4px) * 5);
  display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: start; gap: calc(var(--vx, 4px) * 2);
  font: 400 0.875rem/1.45 var(--vx-font, system-ui, sans-serif); color: var(--vx-ink, #0a0f3d);
  background: var(--vx-reading-plate, var(--vx-chalk, #fbfcff)); border-inline-start: calc(var(--vx, 4px) * 2) solid var(--vx-signal, #fff600);
  box-shadow: calc(var(--vx, 4px) * 1) calc(var(--vx, 4px) * 1.25) 0 var(--vx-shadow, rgb(10 18 97 / 0.3));
  touch-action: manipulation; user-select: text; -webkit-user-select: text; }
#alpha-notice[hidden] { display: none; }
#alpha-notice h2 { margin: 0 0 calc(var(--vx, 4px) * 1); font: 600 0.75rem/1.4 var(--vx-mono, ui-monospace, monospace); letter-spacing: 0.06em; text-transform: uppercase; }
#alpha-notice p { margin: 0; color: var(--vx-ink-quiet, #474d7a); text-wrap: pretty; }
/* A plain cap: the blog's printed caps (data-caps) leave no room for the cross on a key this small. */
#alpha-notice .vx-button.vx-close { margin: calc(var(--vx, 4px) * -1) 0 0; background: var(--vx-key, var(--vx-chalk, #fbfcff)); font-size: calc(var(--vx, 4px) * 10); touch-action: manipulation; }
@media (prefers-reduced-motion: no-preference) { #alpha-notice { animation: alpha-in 320ms var(--vx-ease-out, ease-out) both; } }
@keyframes alpha-in { from { opacity: 0; translate: 0 8px; } }
`
  const box = document.createElement('aside')
  box.id = 'alpha-notice'
  box.setAttribute('aria-labelledby', 'alpha-notice-title')
  box.innerHTML = `<div><h2 id="alpha-notice-title">Early alpha</h2>
<p>This site is in active development. Content and posts are on the way. Things may break, memory may leak.</p></div>
<button class="vx-button vx-close" type="button" aria-label="Dismiss the notice">×</button>`
  const close = box.querySelector('button')
  // On a page that scrolls (the blog), room at its foot so the notice never covers its last lines.
  const body = document.body, scrolls = () => getComputedStyle(body).overflowY !== 'hidden'
  const room = (on) => { if (scrolls()) body.style.paddingBlockEnd = on ? `${box.offsetHeight + 32}px` : '' }
  const hide = () => { box.hidden = true; room(false) }
  close.addEventListener('click', () => {
    hide()
    try { localStorage.setItem(KEY, SEEN) } catch {}
  })
  // The realm reads keys from the whole window: a key pressed on the notice is the notice's.
  box.addEventListener('keydown', (e) => e.stopPropagation())
  // A page kept from before the dismissal (back and forward, or loaded ahead) hides it when it is shown again.
  const recheck = () => { if (dismissed() && !box.hidden) hide() }
  addEventListener('pageshow', recheck)
  document.addEventListener('visibilitychange', recheck)

  const started = performance.now()
  const show = () => {
    const ready = getComputedStyle(document.documentElement).getPropertyValue('--vx').trim() !== ''
    if (!ready && performance.now() - started < 4000) return void setTimeout(show, 100)
    if (dismissed()) return
    document.head.append(style)
    body.append(box)
    room(true)
  }
  show()
})()
