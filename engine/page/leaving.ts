// Before another site (#450): a board that leads off the realm's own site (a logo's network) is flown to, and a card
// under it asks whether to open it in a new tab, or flies back to the view. Fetched the first time it is wanted
// (boards.ts `open`), so none of this is in the bytes before the park is shown.
//
// The open key is a link the visitor presses, not a window the page opens: an open after the flight is not the
// visitor's gesture, and a browser blocks it. Nothing goes on its own: the card stays while they look at the other
// tab, so that the way back is there when they come back. Esc is Back to the view too.
const STYLE = /* css */ `
#leaving { position: fixed; left: 50%; bottom: max(24px, calc(env(safe-area-inset-bottom) + 16px)); z-index: 40; inline-size: max-content; max-inline-size: calc(100vw - 32px); box-sizing: border-box; font: 400 15px/1.4 var(--vx-font, system-ui, sans-serif); color: var(--vx-ink, #111); opacity: 0; transition: opacity 0.2s ease-out, translate 0.24s cubic-bezier(0.2, 0.8, 0.2, 1); translate: -50% 8px; }
#leaving.on { opacity: 1; translate: -50% 0; }
#leaving[hidden] { display: none; }
#leaving.vx-card { padding: 20px 24px 22px; }
#leaving p { margin: 0 0 14px; }
#leaving .keys { display: flex; flex-wrap: wrap; gap: 12px; }
@media (prefers-reduced-motion: reduce) { #leaving { transition: none; } }`

export interface Leaving {
  /** Shows the card for a board's address on another site. */
  ask(name: string, id: string, to: URL): void
  /** Puts it away, if it is up. */
  close(): void
}

/** The card. `back` flies the eye back to the view; the card is put away first. */
export function leaving(back: () => void): Leaving {
  const style = document.createElement('style')
  style.textContent = STYLE
  document.head.append(style)
  const card = document.createElement('aside')
  card.id = 'leaving'; card.className = 'vx-card'; card.hidden = true
  card.setAttribute('aria-live', 'polite')
  card.innerHTML = '<p></p><div class="keys"><a class="vx-button go" target="_blank" rel="noopener noreferrer"></a><button class="vx-button back" type="button" title="Back to the view (Esc)" aria-keyshortcuts="Escape">Back to the view</button></div>'
  const said = card.querySelector('p')!, go = card.querySelector<HTMLAnchorElement>('.go')!, home = card.querySelector<HTMLButtonElement>('.back')!
  document.body.append(card)
  // The kit's voxels, where the page has asked for them (first.ts and realm-ui.ts bring its stylesheet): taken on
  // once the card is first shown, as the kit measures what it builds and a hidden card has no size.
  const kit = new URLSearchParams(location.search).get('kit') !== 'plain' ? import(/* @vite-ignore */ new URL('../kit/src/index.js', import.meta.url).href) as Promise<{ adopt(root?: Element): void }> : null
  let open = false, adopted = false
  const close = () => { if (!open) return; open = false; card.classList.remove('on'); card.hidden = true }
  const leave = () => { close(); back() }
  home.addEventListener('click', leave)
  addEventListener('keydown', (e) => { if (!open || e.key !== 'Escape' || e.repeat) return; e.preventDefault(); e.stopPropagation(); leave() }, true)
  return {
    ask(name, id, to) {
      said.textContent = `Open ${name} in a new tab?`
      go.href = to.href; go.textContent = `Open ${name}`; go.setAttribute('aria-label', `Open ${name} in a new tab`)
      card.dataset.board = id
      open = true; card.hidden = false
      if (!adopted && kit) { adopted = true; void kit.then((k) => k.adopt(card)).catch(() => {}) }
      requestAnimationFrame(() => requestAnimationFrame(() => card.classList.add('on')))
    },
    close,
  }
}
