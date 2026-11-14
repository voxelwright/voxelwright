// The wheel of realms (#264): a key shows the realms this server keeps round a ring, home among them, each by
// its name and the last picture this browser had of it; the one the portal's key leads to is marked. Picking one
// selects it and opens a window to it at once; one entry hands over to making a new realm from words. Names and
// what a realm is about are text someone or their model wrote: shown as text, never as markup.
import type { Hud } from './hud.ts'
import type { Input } from './input.ts'
import type { Listed, Realms } from './realms.ts'

export interface Wheel {
  readonly open: boolean
  /** Shows the wheel, or puts it away. */
  toggle(): Promise<void>
  /** What is on it now, in order: realms by id, and `+` for a new one. */
  readonly entries: readonly string[]
  /** Picks an entry as a click on it would. */
  pick(id: string): void
  /** The last picture of a realm kept by this browser (a data address), or null. */
  shot(id: string): string | null
}

const STYLE = `
[data-panel="wheel"] { position: fixed; inset: 0; display: none; align-items: center; justify-content: center; background: rgba(8, 10, 14, .55); pointer-events: auto; font: 500 14px system-ui, sans-serif; color: #fff; z-index: 30 }
[data-panel="wheel"].on { display: flex }
[data-panel="wheel"] .ring { position: relative; width: min(84vmin, 560px); height: min(84vmin, 560px) }
[data-panel="wheel"] button { position: absolute; width: 22%; aspect-ratio: 1; margin: -11%; border-radius: 50%; border: 3px solid rgba(255, 255, 255, .25); background: #2a2f3a center / cover; color: #fff; font: inherit; cursor: pointer; padding: 0; overflow: visible; transition: transform .12s, border-color .12s }
[data-panel="wheel"] button.at, [data-panel="wheel"] button:hover { transform: scale(1.14); border-color: #fff }
[data-panel="wheel"] button.selected { border-color: #ffd98a; box-shadow: 0 0 0 3px rgba(255, 217, 138, .35) }
[data-panel="wheel"] button .name { position: absolute; left: 50%; top: 104%; transform: translateX(-50%); white-space: nowrap; max-width: 180%; overflow: hidden; text-overflow: ellipsis; text-shadow: 0 1px 3px #000; font-weight: 600 }
[data-panel="wheel"] button .key { position: absolute; left: -6px; top: -6px; width: 22px; height: 22px; line-height: 22px; border-radius: 50%; background: rgba(0, 0, 0, .7); font-size: 12px }
[data-panel="wheel"] button .here { position: absolute; right: -4px; top: -4px; padding: 1px 6px; border-radius: 9px; background: #ffd98a; color: #1b1b1b; font-size: 11px; font-weight: 700 }
[data-panel="wheel"] button.new { background: rgba(255, 255, 255, .12); font-size: 34px; line-height: 1 }
[data-panel="wheel"] button.new .name, [data-panel="wheel"] button.new .key { font-size: 14px; line-height: normal }
[data-panel="wheel"] button.new .key { font-size: 12px; line-height: 22px }
[data-panel="wheel"] .middle { position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); width: 46%; text-align: center; text-shadow: 0 1px 3px #000 }
[data-panel="wheel"] .middle b { display: block; font-size: 18px; margin-bottom: 6px }
[data-panel="wheel"] .middle span { display: block; opacity: .85; max-height: 5.2em; overflow: hidden }
[data-panel="wheel"] .middle i { display: block; margin-top: 8px; opacity: .6; font-style: normal; font-size: 12px }
`
/** The most realms round the ring: nine have a number key; the tenth place is the new one's. */
const MOST = 9

export function wheel(o: {
  hud: Hud
  input: Input
  realms: Realms
  canvas: HTMLCanvasElement
  /** Opens a window to a realm, in place of whatever window is open. */
  lead(id: string): void
  /** Hands over to making a new realm from words. */
  create(): void
}): Wheel {
  const panel = o.hud.panel('wheel'), style = document.createElement('style')
  style.textContent = STYLE
  document.head.append(style)
  const ring = document.createElement('div'), middle = document.createElement('div')
  ring.className = 'ring'; middle.className = 'middle'
  panel.append(ring)
  let open = false, entries: string[] = [], listed: Listed[] = [], at = 0, leave: (() => void) | null = null

  // The last picture of each realm: the page's own, made small every few seconds while it is there, kept by this browser.
  const small = document.createElement('canvas')
  small.width = 192; small.height = 108
  const shot = (id: string) => { try { return localStorage.getItem(`village.realm.shot.${id}`) } catch { return null } }
  const keep = () => {
    // Right after the page has drawn: the picture is then the canvas's own.
    requestAnimationFrame(() => {
      if (open || document.hidden) return
      try {
        const to = small.getContext('2d')!
        to.drawImage(o.canvas, 0, 0, small.width, small.height)
        // A picture that is all one dark colour is no picture (the page had not drawn yet).
        const d = to.getImageData(0, 0, small.width, small.height).data
        let lit = 0
        for (let i = 0; i < d.length; i += 64) if (d[i] + d[i + 1] + d[i + 2] > 60) lit++
        if (lit > 40) localStorage.setItem(`village.realm.shot.${o.realms.here}`, small.toDataURL('image/jpeg', 0.7))
      } catch { /* a browser that keeps nothing, or a canvas that cannot be read: there is then no picture */ }
    })
  }
  setInterval(keep, 5000)

  const say = (r: Listed | null) => {
    middle.replaceChildren()
    const name = document.createElement('b'), about = document.createElement('span'), how = document.createElement('i')
    name.textContent = r ? r.name || (r.home ? 'Home' : r.id) : 'A new realm'
    about.textContent = r ? r.about || (r.home ? 'Where you start.' : '') : 'Say what it is, and it is made.'
    how.textContent = r ? (r.id === o.realms.here ? 'You are here' : 'Enter or a click opens a portal to it') : 'Enter or a click starts it'
    middle.append(name, about, how)
  }
  const mark = () => { ring.querySelectorAll('button').forEach((b, i) => b.classList.toggle('at', i === at)); say(listed.find((r) => r.id === entries[at]) ?? null) }
  const pick = (id: string) => {
    hide()
    // A moment later: the key that picked it is still going down, and would be typed into the line that opens.
    if (id === '+') return void setTimeout(o.create, 40)
    if (id !== 'home') o.realms.selected = id
    if (id === o.realms.here) return o.hud.notice('You are there already', 3000)
    o.lead(id)
  }
  const show = async () => {
    try { listed = await o.realms.list() } catch { return o.hud.notice('The realms could not be listed', 4000) }
    // Home first, then the selected one, then the rest as the server lists them.
    const order = [...listed].sort((a, b) => Number(b.home) - Number(a.home) || Number(b.id === o.realms.selected) - Number(a.id === o.realms.selected)).slice(0, MOST)
    entries = [...order.map((r) => r.id), '+']
    ring.replaceChildren(middle)
    entries.forEach((id, i) => {
      const r = order[i], b = document.createElement('button'), turn = (i / entries.length) * Math.PI * 2 - Math.PI / 2
      b.type = 'button'
      b.style.left = `${50 + 40 * Math.cos(turn)}%`; b.style.top = `${50 + 40 * Math.sin(turn)}%`
      const name = document.createElement('span'), key = document.createElement('span')
      name.className = 'name'; key.className = 'key'
      name.textContent = r ? r.name || (r.home ? 'Home' : r.id) : 'New realm'
      key.textContent = r ? String(i + 1) : '0'
      if (r) {
        const picture = shot(r.id)
        if (picture) b.style.backgroundImage = `url("${picture}")`
        // Never seen: a colour of its own, from how it looks.
        else { const t = r.look?.tint ?? [1, 1, 1], night = r.look?.hour !== undefined && r.look.hour !== null && (r.look.hour < 6 || r.look.hour > 19); b.style.backgroundColor = `rgb(${t.map((v) => Math.round(Math.min(1, v) * (night ? 60 : 150))).join(',')})` }
        if (r.id === o.realms.selected) b.classList.add('selected')
        if (r.id === o.realms.here) { const here = document.createElement('span'); here.className = 'here'; here.textContent = 'here'; b.append(here) }
      } else { b.classList.add('new'); b.append('+') }
      b.append(name, key)
      b.onclick = () => pick(id)
      b.onmouseenter = () => { at = i; mark() }
      ring.append(b)
    })
    at = Math.max(0, entries.indexOf(o.realms.selected && o.realms.selected !== o.realms.here ? o.realms.selected : entries[0]))
    mark()
    open = true
    panel.classList.add('on')
    document.exitPointerLock?.()
    // Its keys: a number picks, the arrows go round, Enter picks what is marked, Escape or Tab puts it away.
    leave = o.input.push({ name: 'wheel', solid: true, every: true, key: (code) => {
      const digit = /^(?:Digit|Numpad)(\d)$/.exec(code)
      if (digit) { const i = digit[1] === '0' ? entries.length - 1 : Number(digit[1]) - 1; if (i < entries.length) pick(entries[i]) }
      else if (code === 'ArrowRight' || code === 'ArrowDown' || code === 'KeyD') { at = (at + 1) % entries.length; mark() }
      else if (code === 'ArrowLeft' || code === 'ArrowUp' || code === 'KeyA') { at = (at + entries.length - 1) % entries.length; mark() }
      else if (code === 'Enter' || code === 'Space') pick(entries[at])
      else if (code === 'Escape' || code === 'Tab') hide()
      return true
    } })
  }
  const hide = () => { open = false; panel.classList.remove('on'); leave?.(); leave = null }
  panel.onclick = (e) => { if (e.target === panel) hide() }
  return {
    get open() { return open },
    toggle: async () => { if (open) hide(); else await show() },
    get entries() { return entries },
    pick,
    shot,
  }
}
