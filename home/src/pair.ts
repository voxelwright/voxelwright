// Pairing from the home screen (#85). A home-screen app may keep its own cookies apart from
// the browser's, and it has no address bar to open a link in. So when the home runs as an
// installed app and this device is not paired, a small card asks for the pairing link to be
// pasted; the code is traded exactly as an opened link's would be (../villager.ts pairWith).
// In a browser tab the card never shows: opening the link there pairs the tab's browser.
import { codeIn, installed, paired, pairWith } from './villager'

export async function offerPairing() {
  if (!installed() || (await paired())) return
  const card = document.createElement('form')
  card.className = 'village-pair'
  // Our own message for a paste that is not a link, not the browser's.
  card.noValidate = true
  card.innerHTML = `
    <p>Paste the pairing link Village gave you for this phone, and your villager will know it's you.</p>
    <input name="link" type="url" inputmode="url" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="Pairing link" aria-label="Pairing link">
    <button type="submit">Pair</button>
    <p class="village-pair-note" role="status"></p>`
  const style = document.createElement('style')
  style.textContent = `
    .village-pair { position: fixed; left: 16px; right: 16px; bottom: calc(16px + env(safe-area-inset-bottom)); z-index: 20;
      max-width: 420px; margin: 0 auto; padding: 16px; border-radius: 14px; background: #f4ead8; color: #3a2a1e;
      font: 15px/1.4 system-ui, sans-serif; box-shadow: 0 8px 30px rgba(0,0,0,.35); display: grid; gap: 10px; }
    .village-pair p { margin: 0; }
    .village-pair input { font: inherit; padding: 10px 12px; border: 1px solid #b89b78; border-radius: 10px; background: #fffaf2; color: inherit; }
    .village-pair button { font: inherit; padding: 10px; border: 0; border-radius: 10px; background: #7a4b2a; color: #fffaf2; }
    .village-pair-note:empty { display: none; }`
  const note = card.querySelector<HTMLParagraphElement>('.village-pair-note')!
  card.addEventListener('submit', async (e) => {
    e.preventDefault()
    const code = codeIn(String(new FormData(card).get('link') ?? ''))
    if (!code) return void (note.textContent = 'That doesn’t look like a pairing link. Copy the whole link and try again.')
    note.textContent = 'Pairing…'
    const ok = await pairWith(code)
    if (ok) return void (card.remove(), style.remove())
    note.textContent = ok === false ? 'That link was already used or is too old. Ask for a new one.' : 'Village isn’t answering right now. Try again in a moment.'
  })
  document.head.append(style)
  document.body.append(card)
}
