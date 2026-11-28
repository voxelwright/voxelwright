// A pie menu over the middle of the picture (owner, November 24: "like this", a game's buy wheel): a dark disc cut
// into wedges, each with a white picture and its name, a ring round the middle, an arc on the rim that follows the
// hand, and the marked entry's name in the middle. It draws and resolves; who opens it and what a choice does is the
// caller's (play-hud.ts). A direction picks: from the middle, past the ring, anywhere on the screen.
const SVG = 'http://www.w3.org/2000/svg'

/** The Cleave (#226): a stroke of light drawn across the picture, sharp at both ends, a second edge under it, and the glint of the point that drew it. */
const CLEAVE = '<path d="M3 29C22 27 45 17 61 2C50 21 27 31 3 29z"/><path d="M12 31.2C27 30.6 43 25 55 15.5C44.5 26.5 28 32 12 31.2z" fill-opacity=".45"/><path d="M14 3l1.9 5.1L21 10l-5.1 1.9L14 17l-1.9-5.1L7 10l5.1-1.9z"/>'

/** White pictures, 64 by 32, for the realm's tools by name. An entry with none shows its first letter. */
export const TOOL_ICONS: Record<string, string> = {
  Hammer: '<rect x="15" y="13.5" width="45" height="5" rx="2.5"/><path d="M6 4h10v24H6z"/><rect x="2" y="9" width="5" height="14" rx="1"/>',
  Charge: '<path fill-rule="evenodd" d="M10 10h34a3 3 0 0 1 3 3v6a3 3 0 0 1-3 3H10a3 3 0 0 1-3-3v-6a3 3 0 0 1 3-3zm6 0v12h3V10zm16 0v12h3V10z"/><path d="M47 16c5 0 7-3 8-7" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round"/><path d="M56 2l1.4 3.6L61 7l-3.6 1.4L56 12l-1.4-3.6L51 7l3.6-1.4z"/>',
  'Big charge': '<rect x="6" y="3" width="38" height="8" rx="2.5"/><rect x="6" y="12" width="38" height="8" rx="2.5"/><rect x="6" y="21" width="38" height="8" rx="2.5"/><rect x="21" y="1" width="6" height="30" rx="1" fill-opacity=".55"/><path d="M44 16c5 0 8-3 9-8" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round"/><path d="M55 1l1.4 3.6L60 6l-3.6 1.4L55 11l-1.4-3.6L50 6l3.6-1.4z"/>',
  Cannon: '<path d="M6 9.5L50 6h6v12h-6L6 20.5a5.5 5.5 0 0 1 0-11z"/><path fill-rule="evenodd" d="M24 14a9 9 0 1 1 0 18a9 9 0 0 1 0-18zm0 6a3 3 0 1 0 0 6a3 3 0 0 0 0-6z"/><path d="M33 26h18v4H31z"/>',
  Torch: '<rect x="4" y="9" width="17" height="21" rx="5"/><rect x="9" y="5" width="7" height="5" rx="1"/><path d="M21 13h15l3 2v3l-3 2H21z"/><path d="M40 16.5C46 9 56 8 62 16.5C56 25 46 24 40 16.5z"/><path d="M44 16.5c3-3 7-3.5 10 0c-3 3.5-7 3-10 0z" fill-opacity=".45"/>',
  Cleave: CLEAVE,
  // The cutter the Cleave replaces: the same picture, for whoever still names tool 6 so.
  Cutter: CLEAVE,
  Brick: '<rect x="4" y="5" width="26" height="10" rx="1.5"/><rect x="33" y="5" width="27" height="10" rx="1.5"/><rect x="4" y="18" width="12" height="10" rx="1.5"/><rect x="19" y="18" width="26" height="10" rx="1.5"/><rect x="48" y="18" width="12" height="10" rx="1.5"/>',
  Wand: '<path d="M8 28L40 10" stroke="#fff" stroke-width="4.5" stroke-linecap="round"/><path d="M47 1l2.2 5.8L55 9l-5.8 2.2L47 17l-2.2-5.8L39 9l5.8-2.2z"/><path d="M58 17l1 2.6 2.6 1-2.6 1-1 2.6-1-2.6-2.6-1 2.6-1z"/><path d="M34 2l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z"/>',
}
const ICONS = TOOL_ICONS

const STYLE = /* css */ `
.radial { position: absolute; inset: env(safe-area-inset-top, 0px) env(safe-area-inset-right, 0px) env(safe-area-inset-bottom, 0px) env(safe-area-inset-left, 0px); display: grid; place-items: center; pointer-events: none; visibility: hidden; }
.radial.on { visibility: visible; }
.radial .pie { --d: min(520px, max(300px, 66vmin)); position: relative; inline-size: var(--d); block-size: var(--d); container-type: size; border-radius: 50%; pointer-events: none; opacity: 0; scale: 0.94; transition: opacity 90ms ease-in, scale 90ms ease-in; touch-action: none; user-select: none; -webkit-user-select: none; -webkit-touch-callout: none; }
.radial.on .pie { opacity: 1; scale: 1; pointer-events: auto; transition: opacity 140ms cubic-bezier(0.23, 1, 0.32, 1), scale 160ms cubic-bezier(0.23, 1, 0.32, 1); }
@media (pointer: coarse) { .radial .pie { --d: min(440px, 94vw, calc(100dvh - env(safe-area-inset-top, 0px) - env(safe-area-inset-bottom, 0px) - 16px)); } }
.radial svg.disc { position: absolute; inset: 0; inline-size: 100%; block-size: 100%; overflow: visible; }
.radial .wedge { fill: rgb(12 14 20 / 0.62); transition: fill 70ms linear; }
.radial .wedge.at { fill: rgb(46 52 66 / 0.78); }
.radial .seam { stroke: rgb(255 255 255 / 0.2); stroke-width: 0.35; vector-effect: non-scaling-stroke; }
.radial .hole { fill: rgb(6 8 12 / 0.42); }
.radial .ring { fill: none; stroke: rgb(255 255 255 / 0.82); stroke-width: 1.4; }
.radial .rim { fill: none; stroke: var(--vx-enamel-top, #5f6dff); stroke-width: 1.6; stroke-linecap: round; opacity: 0; transition: opacity 90ms linear; filter: drop-shadow(0 0 1.5px rgb(95 109 255 / 0.9)); }
.radial .rim.on { opacity: 1; }
.radial .slot { position: absolute; left: 0; top: 0; inline-size: max-content; max-inline-size: 30cqi; translate: -50% -50%; display: grid; justify-items: center; gap: 0.6cqi; padding: 0; margin: 0; border: 0; background: none; color: #fff; font: 600 clamp(11px, 3.2cqi, 16px)/1.15 var(--vx-key-font, system-ui), system-ui, sans-serif; letter-spacing: 0.01em; text-shadow: 0 1px 2px rgb(0 0 0 / 0.6); cursor: pointer; pointer-events: none; opacity: 0.74; transition: opacity 70ms linear, scale 110ms cubic-bezier(0.23, 1, 0.32, 1); -webkit-tap-highlight-color: transparent; }
.radial .slot svg { inline-size: 17cqi; block-size: 8.5cqi; fill: #fff; filter: drop-shadow(0 1px 1.5px rgb(0 0 0 / 0.55)); }
.radial .slot .glyph { display: grid; place-items: center; inline-size: 7.5cqi; block-size: 7.5cqi; border: 2px solid #fff; border-radius: 50%; font-size: 3.6cqi; }
.radial .slot .label { display: flex; align-items: baseline; gap: 0.35em; white-space: nowrap; }
.radial .slot .n { font-size: 0.82em; font-weight: 500; color: rgb(255 255 255 / 0.55); }
.radial .slot.at { opacity: 1; scale: 1.08; }
.radial .slot.mine .label .name::after { content: ''; display: inline-block; inline-size: 0.42em; block-size: 0.42em; margin-inline-start: 0.4em; border-radius: 50%; background: var(--vx-enamel-top, #5f6dff); box-shadow: 0 0 4px var(--vx-enamel-top, #5f6dff); vertical-align: 0.12em; }
.radial .slot:focus-visible { outline: 2px solid var(--vx-enamel-top, #5f6dff); outline-offset: 4px; border-radius: 8px; }
.radial .middle { position: absolute; left: 50%; top: 50%; translate: -50% -50%; inline-size: 30cqi; display: grid; justify-items: center; gap: 0.8cqi; text-align: center; pointer-events: none; color: #fff; font: 600 clamp(13px, 4cqi, 19px)/1.15 var(--vx-key-font, system-ui), system-ui, sans-serif; text-shadow: 0 1px 2px rgb(0 0 0 / 0.6); }
.radial .middle small { font-size: clamp(10px, 2.5cqi, 12px); font-weight: 500; color: rgb(255 255 255 / 0.6); letter-spacing: 0.04em; text-transform: uppercase; }
.radial .dot { position: absolute; left: 50%; top: 50%; inline-size: 8px; block-size: 8px; margin: -4px 0 0 -4px; border-radius: 50%; background: #fff; box-shadow: 0 0 0 2px rgb(0 0 0 / 0.35); pointer-events: none; opacity: 0; }
.radial .dot.on { opacity: 0.9; }
@media (prefers-reduced-motion: reduce) { .radial .pie, .radial.on .pie { scale: 1; transition: opacity 90ms linear; } .radial .slot { transition: opacity 70ms linear; } .radial .slot.at { scale: 1; } }
`

export interface Radial {
  /** The layer: centred in the safe area, put in place by the caller. */
  readonly el: HTMLElement
  /** One button per entry, in order (focus, keys, a reader's names): placed over its wedge's picture. */
  readonly slots: readonly HTMLButtonElement[]
  /** Shows the pie, or puts it away. */
  show(on: boolean): void
  /** Marks an entry (-1: none): its wedge lit, its name in the middle, the rim's arc over it. */
  mark(i: number): void
  /** Which entry is the one in hand (shown with a dot, and in the middle while none is marked). */
  held(i: number): void
  /** The entry a direction points at (screen px: x right, y down), or -1 inside `dead` px of the middle. */
  towards(dx: number, dy: number, dead?: number): number
  /** The entry under a point on the screen, by direction from the pie's middle: -1 inside its ring, or past its rim when `inside`. */
  at(x: number, y: number, inside?: boolean): number
  /** Where the pie's middle is, and its radius (CSS px). */
  readonly geometry: { x: number; y: number; r: number }
  /** A dot that shows where a hand with no pointer of its own points (x right, y down, 0 to 1 of the radius), or null to hide it. */
  dot(at: [number, number] | null): void
}

let styled = false
/** The ring's radius as a fraction of the pie's: inside it nothing is marked. */
const HOLE = 0.34

export function radial(names: readonly string[], label = 'Choose'): Radial {
  if (!styled) { styled = true; const s = document.createElement('style'); s.textContent = STYLE; document.head.append(s) }
  const n = names.length, step = (Math.PI * 2) / n
  /** The middle angle of entry i: the first at the top, then clockwise (screen, y down). */
  const mid = (i: number) => -Math.PI / 2 + i * step
  const el = document.createElement('div')
  el.className = 'radial'
  el.setAttribute('role', 'dialog')
  el.setAttribute('aria-label', label)
  const pie = document.createElement('div')
  pie.className = 'pie'
  el.append(pie)

  // The disc in a box of 200 (radius 100, the middle at 0 0).
  const disc = document.createElementNS(SVG, 'svg')
  disc.setAttribute('class', 'disc')
  disc.setAttribute('viewBox', '-100 -100 200 200')
  disc.setAttribute('aria-hidden', 'true')
  const R = 99, r0 = R * HOLE
  const pt = (a: number, r: number) => `${(Math.cos(a) * r).toFixed(3)} ${(Math.sin(a) * r).toFixed(3)}`
  const wedges = names.map((_, i) => {
    const a0 = mid(i) - step / 2, a1 = mid(i) + step / 2, big = step > Math.PI ? 1 : 0
    const p = document.createElementNS(SVG, 'path')
    p.setAttribute('class', 'wedge')
    p.setAttribute('d', n === 1 ? `M ${pt(0, R)} A ${R} ${R} 0 1 1 ${pt(Math.PI, R)} A ${R} ${R} 0 1 1 ${pt(0, R)} M ${pt(0, r0)} A ${r0} ${r0} 0 1 0 ${pt(Math.PI, r0)} A ${r0} ${r0} 0 1 0 ${pt(0, r0)} Z` : `M ${pt(a0, r0)} L ${pt(a0, R)} A ${R} ${R} 0 ${big} 1 ${pt(a1, R)} L ${pt(a1, r0)} A ${r0} ${r0} 0 ${big} 0 ${pt(a0, r0)} Z`)
    disc.append(p)
    return p
  })
  if (n > 1) names.forEach((_, i) => { const a = mid(i) - step / 2, s = document.createElementNS(SVG, 'line'); s.setAttribute('class', 'seam'); const [x1, y1] = pt(a, r0 + 1).split(' '), [x2, y2] = pt(a, R).split(' '); s.setAttribute('x1', x1); s.setAttribute('y1', y1); s.setAttribute('x2', x2); s.setAttribute('y2', y2); disc.append(s) })
  const hole = document.createElementNS(SVG, 'circle'), ring = document.createElementNS(SVG, 'circle'), rim = document.createElementNS(SVG, 'path')
  hole.setAttribute('class', 'hole'); hole.setAttribute('r', String(r0))
  ring.setAttribute('class', 'ring'); ring.setAttribute('r', String(r0))
  rim.setAttribute('class', 'rim')
  disc.append(hole, ring, rim)
  pie.append(disc)

  // The middle: the marked entry's name, or the one in hand.
  const middle = document.createElement('div'), word = document.createElement('span'), hint = document.createElement('small')
  middle.className = 'middle'
  middle.setAttribute('aria-hidden', 'true')
  middle.append(word, hint)
  pie.append(middle)
  const dotEl = document.createElement('div')
  dotEl.className = 'dot'
  pie.append(dotEl)

  // Each entry's picture and name, over the middle of its wedge's band.
  const band = (HOLE + 1) / 2 + 0.02
  const slots = names.map((name, i) => {
    const b = document.createElement('button')
    b.type = 'button'
    b.className = 'slot'
    b.dataset.i = String(i)
    b.setAttribute('aria-keyshortcuts', i < 9 ? String(i + 1) : '')
    const icon = ICONS[name]
    const pic = icon ? `<svg viewBox="0 0 64 32" aria-hidden="true">${icon}</svg>` : `<span class="glyph" aria-hidden="true"></span>`
    b.innerHTML = `${pic}<span class="label"><span class="n">${i + 1}</span><span class="name"></span></span>`
    b.querySelector('.name')!.textContent = name
    if (!icon) b.querySelector('.glyph')!.textContent = name.slice(0, 1).toUpperCase()
    b.style.left = `${50 + Math.cos(mid(i)) * band * 50}%`
    b.style.top = `${50 + Math.sin(mid(i)) * band * 50}%`
    pie.append(b)
    return b
  })

  let marked = -1, inHand = -1
  const tell = () => {
    const i = marked >= 0 ? marked : inHand
    word.textContent = names[i] ?? ''
    hint.textContent = marked >= 0 && marked !== inHand ? `Take · ${marked + 1}` : 'In hand'
  }
  const mark = (i: number) => {
    if (i === marked) return
    if (marked >= 0) { wedges[marked].classList.remove('at'); slots[marked].classList.remove('at') }
    marked = i
    if (i >= 0) {
      wedges[i].classList.add('at'); slots[i].classList.add('at')
      // The rim's arc: most of the wedge's outer edge, a little in from its seams.
      const a0 = mid(i) - step / 2 + 0.05, a1 = mid(i) + step / 2 - 0.05, rr = R + 1.6
      rim.setAttribute('d', n === 1 ? '' : `M ${pt(a0, rr)} A ${rr} ${rr} 0 ${step > Math.PI ? 1 : 0} 1 ${pt(a1, rr)}`)
    }
    rim.classList.toggle('on', i >= 0 && n > 1)
    tell()
  }
  const held = (i: number) => { inHand = i; slots.forEach((s, j) => { s.classList.toggle('mine', j === i); s.setAttribute('aria-pressed', String(j === i)) }); tell() }
  const towards = (dx: number, dy: number, dead = 0) => {
    if (Math.hypot(dx, dy) <= dead || n === 0) return -1
    const a = Math.atan2(dy, dx) + Math.PI / 2 + step / 2
    return ((Math.floor(a / step) % n) + n) % n
  }
  const geometry = () => { const b = pie.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2, r: b.width / 2 } }
  return {
    el,
    slots,
    show(on) { el.classList.toggle('on', on); if (!on) { mark(-1); dotEl.classList.remove('on') } },
    mark,
    held,
    towards,
    at(x, y, inside = false) { const g = geometry(), d = Math.hypot(x - g.x, y - g.y); if (inside && d > g.r * 1.04) return -1; return towards(x - g.x, y - g.y, g.r * HOLE) },
    get geometry() { return geometry() },
    dot(at) {
      dotEl.classList.toggle('on', !!at)
      if (at) dotEl.style.translate = `${(at[0] * 50).toFixed(2)}cqi ${(at[1] * 50).toFixed(2)}cqi`
    },
  }
}
