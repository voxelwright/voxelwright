// The seam between the page and the street (#421). The page is the document and is read at once; the street is a
// frame laid under it (../index.html, the engine's landing world), asked for only where it can be shown, and only
// after the page can be read.
//
// Which is shown, the first answer that is one:
//   1. what the visitor chose last time (kept in this browser)
//   2. ?view=2d or ?view=3d in the address
//   3. the visitor asks for less motion: the page
//   4. no WebGPU adapter: the page
//   5. the street's own first two seconds of frames: too slow, the page
// Nothing here reads the browser's name.
//
// The street never says where to go. It says which sign was chosen, by name; this page follows its own link of that
// name. A message is listened to only from the frame this page made.
const root = document.documentElement, page = document.querySelector('#page'), menu = document.querySelector('#menu')
const plain = document.querySelector('#plain'), street = document.querySelector('#street'), note = document.querySelector('#note')
const hint = document.querySelector('#hint'), skip = document.querySelector('#skip'), corner = document.querySelector('#corner')
const links = [...menu.querySelectorAll('a[data-sign]')]
const query = new URLSearchParams(location.search)
const calm = matchMedia('(prefers-reduced-motion: reduce)')
const kept = { get: () => { try { return localStorage.getItem('view') } catch { return null } }, set: (v) => { try { localStorage.setItem('view', v) } catch { /* a browser that keeps nothing: the choice lasts this visit */ } } }

/** The street's frame, once asked for; what it last said of itself; where its eye is. */
let frame = null, world = 'none', at = 'sky', flying = false
/** Whether the street is to be shown as soon as it can be, and whether the visitor asked for it themselves. */
let wanted = false, chosen = false
/** Whether the visitor has done anything with the page since it came: a page someone is reading is not taken away. */
let touched = false
/** For whoever measures: when each thing happened, ms since the page was asked for. */
const times = {}
const mark = (what) => { times[what] ??= Math.round(performance.now()) }
Object.assign(globalThis, { home: { times, get world() { return world }, get at() { return at }, get flying() { return flying }, get view() { return root.dataset.view }, heard: [] } })

const tell = (type, more = {}) => frame?.contentWindow?.postMessage({ village: 'host', type, ...more }, '*')
const say = (words) => { note.textContent = words; note.hidden = !words }

/** The page and the street change places. The menu is the same links in both: it is seen to move from one to the other. */
function show(view) {
  if (root.dataset.view === view) return
  const before = menu.getBoundingClientRect()
  root.dataset.view = view
  page.inert = view === '3d'
  plain.setAttribute('aria-pressed', String(view === '2d'))
  street.setAttribute('aria-pressed', String(view === '3d'))
  const after = menu.getBoundingClientRect()
  if (!calm.matches) menu.animate([{ translate: `${before.left - after.left}px ${before.top - after.top}px` }, { translate: '0 0' }], { duration: 480, easing: 'cubic-bezier(0.77, 0, 0.175, 1)' })
  if (view === '3d') { mark('street'); tell('go'); tell('enter'); if (at !== 'sky') tell('look', { id: 'home' }) }
  else { tell('rest'); for (const a of links) a.removeAttribute('aria-current') }
  mirror()
}

/** What the street's controls say, from where its eye is. */
function mirror() {
  // The flight in is the first one only: once the eye has landed, coming home is an ordinary flight.
  const arriving = !times.menu && (at === 'sky' || (at === 'home' && flying))
  skip.hidden = !arriving
  corner.hidden = arriving || at === 'home'
  for (const a of links) { if (a.dataset.sign === at && root.dataset.view === '3d') a.setAttribute('aria-current', 'true'); else a.removeAttribute('aria-current') }
  const sign = root.dataset.view === '3d' ? links.find((a) => a.dataset.sign === at) : null
  if (hint.dataset.said === 'broke') hint.textContent = 'It mends itself in a moment.'
  else if (at === 'face') hint.textContent = 'A stand-in face. Take hold and pull.'
  else if (sign && !flying) hint.textContent = `${sign.querySelector('span').textContent}. Tap the sign to go in.`
  else hint.textContent = arriving || flying ? '' : hint.dataset.first ?? 'Tap throws a ball. Hold throws it hard. Drag looks around.'
}

/** Asks for the street: the frame is made, and what it says is listened to. */
function load() {
  if (frame) return
  world = 'loading'
  mark('asked')
  street.dataset.busy = ''
  frame = document.createElement('iframe')
  frame.title = 'The street: the same links as signs on buildings'
  frame.tabIndex = -1
  frame.allow = 'fullscreen'
  frame.src = new URL(`../index.html${query.has('scene') ? `?scene=${encodeURIComponent(query.get('scene'))}` : ''}`, location.href).href
  document.querySelector('#world').append(frame)
  // Out of sight is not drawn: under the page (said in `show`), or off the window.
  new IntersectionObserver(([e]) => tell(e.isIntersecting && root.dataset.view === '3d' ? 'go' : 'rest')).observe(frame)
  // A frame that has said nothing in five seconds never loaded (the player's own promise is a word within one).
  setTimeout(() => { if (world === 'loading' && !times.loading) fail('The street did not load. This page is the whole site.') }, 5000)
}
function fail(words) {
  world = 'failed'
  delete street.dataset.busy
  show('2d')
  if (chosen) say(words)
}

addEventListener('message', (e) => {
  if (!frame || e.source !== frame.contentWindow || e.data?.village !== 'landing') return
  const { type } = e.data
  globalThis.home.heard.push(type)
  mark(type)
  if (type === 'unsupported') fail('This browser has no WebGPU, so there is no street here. This page is the whole site.')
  else if (type === 'error') fail('The street broke while starting. This page is the whole site.')
  else if (type === 'ready') {
    world = 'ready'
    delete street.dataset.busy
    // Shown at once to whoever asked for it, or to whoever has not yet touched the page.
    if (wanted && (chosen || !touched)) show('3d')
    else tell('rest')
  } else if (type === 'slow') {
    // Too slow to be a pleasure, and nobody insisted: the page, with a word of why.
    if (!chosen && root.dataset.view === '3d') { show('2d'); say('The street runs slowly on this device, so here is the page. Street, top right, shows it anyway.') }
  } else if (type === 'at') { at = String(e.data.id); flying = !!e.data.flying; if (at === 'home' && !flying) mark('menu'); mirror() }
  else if (type === 'navigate') go(String(e.data.id))
  else if (type === 'broke') { hint.dataset.said = 'broke'; mirror() }
  else if (type === 'mended') { delete hint.dataset.said; hint.dataset.first = ''; mirror() }
})

/** Follows this page's own link for a sign: the picture goes blue, then the page comes. */
function go(id) {
  const a = links.find((l) => l.dataset.sign === id)
  if (!a) return
  mark('navigate')
  root.dataset.leaving = ''
  setTimeout(() => location.assign(a.href), calm.matches ? 0 : 240)
}
// Come back to with the Back button, the page is as it was left: the street's eye is sent home.
addEventListener('pageshow', (e) => { if (e.persisted) { delete root.dataset.leaving; tell('look', { id: 'home' }) } })

// ── The switch ────────────────────────────────────────────────────────────
// The address stays as it is and the button pressed keeps the focus: only what is shown changes.
plain.addEventListener('click', () => { kept.set('2d'); wanted = false; say(''); show('2d') })
street.addEventListener('click', () => {
  kept.set('3d'); wanted = chosen = true; say('')
  if (world === 'ready') show('3d')
  else if (world === 'failed' || !navigator.gpu) { world = 'failed'; show('2d'); say('This browser cannot draw the street: it needs WebGPU. This page is the whole site.') }
  else load()
})

// ── The links, while the street is shown ──────────────────────────────────
// A link that takes the focus turns the street's eye to its sign; choosing it flies there, and the street then says
// to go. Without the street a link is a link.
const live = () => root.dataset.view === '3d' && world === 'ready'
for (const a of links) {
  a.addEventListener('focus', () => { if (live() && a.matches(':focus-visible')) tell('look', { id: a.dataset.sign }) })
  a.addEventListener('click', (e) => {
    if (!live() || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return
    e.preventDefault()
    tell('choose', { id: a.dataset.sign })
  })
}
skip.addEventListener('click', () => tell('skip'))
corner.addEventListener('click', () => tell('look', { id: 'home' }))
addEventListener('keydown', (e) => {
  if (root.dataset.view !== '3d' || e.metaKey || e.ctrlKey || e.altKey) return
  // Any key but Tab cuts the flight in short. Up and down go from link to link; Escape comes back to the corner; F finds the face.
  if (!skip.hidden && e.key !== 'Tab' && e.key !== 'Shift') { tell('skip'); if (e.key !== 'Enter' && e.key !== ' ') e.preventDefault(); return }
  const on = links.indexOf(document.activeElement)
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); links[Math.max(0, Math.min(links.length - 1, on < 0 ? 0 : on + (e.key === 'ArrowDown' ? 1 : -1)))].focus({ focusVisible: true }) }
  else if (e.key === 'Escape') tell('look', { id: 'home' })
  else if ((e.key === 'f' || e.key === 'F') && on < 0) tell('look', { id: 'face' })
})
for (const type of ['pointerdown', 'keydown', 'wheel', 'touchstart']) page.addEventListener(type, () => { touched = true }, { passive: true })
addEventListener('scroll', () => { if (scrollY > 8) touched = true }, { passive: true })

// ── Which is shown ────────────────────────────────────────────────────────
async function decide() {
  const saved = kept.get(), asked = query.get('view')
  if (saved === '2d') return ['2d', 'kept']
  if (saved !== '3d' && asked === '2d') return ['2d', 'asked']
  const insists = saved === '3d' || asked === '3d'
  if (!insists && calm.matches) return ['2d', 'less motion']
  if (!navigator.gpu) return ['2d', 'no WebGPU']
  // An adapter that has not answered in 800 ms is taken for none.
  const adapter = await Promise.race([navigator.gpu.requestAdapter({ powerPreference: 'high-performance' }).catch(() => null), new Promise((r) => setTimeout(() => r(null), 800))])
  if (!adapter) return ['2d', 'no adapter']
  return ['3d', insists ? (saved === '3d' ? 'kept' : 'asked') : 'able']
}
const [view, why] = await decide()
root.dataset.why = why
globalThis.home.decided = [view, why]
mark('decided')
if (view === '3d') {
  wanted = true
  chosen = why !== 'able'
  // After the page can be read: once it has been drawn.
  requestAnimationFrame(() => requestAnimationFrame(load))
}
