// Paper (#42 regroup, November 7, 2026): the villagers' words as slips of torn paper, the look
// that won the regroup against cinematic staging and a caption strip (README, "Talk regroup").
import { canvas, rng } from '../paint'

const HAND = '"Bradley Hand", "Segoe Print", "Comic Sans MS", cursive'
/** Your ink and your pad's paper (input.ts): what you wrote looks the same wherever it goes. */
const INK = '#23395a'
const PAD = '#fbf3e1'
const BOOK = '"Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif'

/** Who a slip belongs to. */
export interface Speaker { colour: string; name: string }

interface Slip {
  c: HTMLCanvasElement
  g: CanvasRenderingContext2D
  key: string
  fade: number
  tilt: number
  seed: number
  /** Opening out of the note that landed (screen point and width), and how far: 0 to 1. */
  from: { x: number; y: number; w: number } | null
  open: number
}
/** Room around the paper for its tab, in CSS pixels. */
const TAB = 16
const SCALE = 2

/**
 * Each villager's card drawn as a slip of torn paper where the card is, a little crooked and
 * turned toward its speaker, with a paper tab toward them and the name on a strip of tape in
 * their colour. The card itself stays in the page, unseen under the slip: it lays the words out,
 * takes clicks ("go on", the page before) and is what screen readers and the checks read.
 * Painted in a canvas on the page, over the room: as a mesh in the room, bloom bleached it under
 * the lamp and temporal anti-aliasing ghosted its words (the #42 regroup's rounds 1 and 2).
 */
export function paperSlips(speaker: (person: string) => Speaker | null) {
  const slips = new Map<string, Slip>()
  const make = (person: string): Slip => {
    const [c, g] = canvas(64, 64)
    c.className = 'talk-paper'
    c.setAttribute('aria-hidden', 'true')
    // Your note lies over the reply it is clipped to.
    if (person === 'you') c.style.zIndex = '4'
    document.body.append(c)
    const seed = [...person].reduce((a, ch) => a * 31 + ch.charCodeAt(0), 7) % 997
    const slip: Slip = { c, g, key: '', fade: 0, tilt: (rng(seed)() - 0.5) * 0.06, seed, from: null, open: 1 }
    slips.set(person, slip)
    return slip
  }

  const wrap = (g: CanvasRenderingContext2D, s: string, width: number) => {
    const out: string[] = []
    let line = ''
    for (const word of s.split(/(\s+)/)) {
      if (g.measureText(line + word).width > width && line.trim()) {
        out.push(line.trimEnd())
        line = word.trimStart()
      } else line += word
    }
    if (line.trim()) out.push(line)
    return out
  }

  const paint = (slip: Slip, el: HTMLElement, who: Speaker, w: number, h: number) => {
    const mine = el.classList.contains('mine')
    const tail = el.dataset.tail ?? 'down'
    // A slip lifted clear of a face stretches its tab down to the speaker's head.
    const reach = tail === 'down' && !mine ? parseFloat(el.style.getPropertyValue('--reach')) || 0 : 0
    const W = (w + TAB * 2) * SCALE, H = (h + TAB * 2 + reach) * SCALE
    if (slip.c.width !== W || slip.c.height !== H) {
      slip.c.width = W
      slip.c.height = H
      slip.c.style.width = `${w + TAB * 2}px`
      slip.c.style.height = `${h + TAB * 2 + reach}px`
    }
    const g = slip.g
    g.setTransform(SCALE, 0, 0, SCALE, 0, 0)
    g.clearRect(0, 0, w + TAB * 2, h + TAB * 2 + reach)
    if (mine) return paintMine(slip, el, w, h)
    const said = el.classList.contains('said')
    const beat = el.classList.contains('beat')
    const at = parseFloat(el.style.getPropertyValue('--tail')) || (tail === 'down' ? w / 2 : 40)
    const r = rng(slip.seed)
    // The paper: a torn, slightly uneven sheet with a cut tab toward the speaker.
    const x0 = TAB, y0 = TAB, x1 = TAB + w, y1 = TAB + h
    const jag = () => (r() - 0.5) * 2.2
    g.beginPath()
    g.moveTo(x0 + 3, y0)
    for (let x = x0 + 14; x < x1 - 6; x += 14) g.lineTo(x, y0 + jag())
    g.lineTo(x1, y0 + 3)
    if (tail === 'right') {
      g.lineTo(x1 + jag(), y0 + at - 10)
      g.lineTo(x1 + TAB - 2, y0 + at + 2)
      g.lineTo(x1 + jag(), y0 + at + 8)
    }
    g.lineTo(x1 + jag(), y1 - 3)
    g.lineTo(x1 - 3, y1)
    if (tail === 'down') {
      // Wider at the root when it has further to reach.
      const root = Math.min(16, 9 + reach / 14)
      g.lineTo(x0 + at + root, y1 + jag())
      g.lineTo(x0 + at - 3, y1 + TAB - 2 + reach)
      g.lineTo(x0 + at - root - 1, y1 + jag())
    }
    for (let x = x1 - 14; x > x0 + 6; x -= 14) g.lineTo(x, y1 + jag())
    g.lineTo(x0 + 3, y1)
    if (tail === 'left') {
      g.lineTo(x0 + jag(), y0 + at + 8)
      g.lineTo(x0 - TAB + 2, y0 + at + 2)
      g.lineTo(x0 + jag(), y0 + at - 10)
    }
    g.lineTo(x0, y0 + 3)
    g.closePath()
    const fill = g.createLinearGradient(x0, y0, x1, y1)
    fill.addColorStop(0, said ? '#f6eedd' : '#fffaf0')
    fill.addColorStop(1, said ? '#eadcc0' : '#f3e5c8')
    g.fillStyle = fill
    g.fill()
    g.save()
    g.clip()
    for (let i = 0; i < (w * h) / 90; i++) {
      g.fillStyle = r() > 0.5 ? 'rgba(255,255,255,0.35)' : 'rgba(150,110,60,0.08)'
      g.fillRect(x0 + r() * w, y0 + r() * h, 1 + r() * 6, 0.6)
    }
    g.restore()
    g.strokeStyle = 'rgba(120, 85, 50, 0.35)'
    g.lineWidth = 0.8
    g.stroke()
    // The name on a strip of tape in the speaker's colour, stuck across the top left.
    g.save()
    g.translate(x0 + 12, y0 - 9)
    g.rotate(-0.035 + slip.tilt)
    const th = said ? 24 : 29
    g.font = `700 ${said ? 17 : 21}px ${HAND}`
    const nw = g.measureText(who.name).width + 26
    // Tape in the speaker's colour, a shade deeper so its light letters stand out.
    g.fillStyle = who.colour
    g.fillRect(0, 0, nw, th)
    g.fillStyle = 'rgba(30, 14, 4, 0.22)'
    g.fillRect(0, 0, nw, th)
    g.fillStyle = 'rgba(255, 248, 236, 0.16)'
    for (let x = 2; x < nw; x += 5) g.fillRect(x, 0, 1.2, th)
    // Torn tape ends.
    g.fillStyle = 'rgba(255, 248, 236, 0.0)'
    g.globalCompositeOperation = 'destination-out'
    for (let y = 0; y < th; y += 4) {
      g.fillRect(0, y, 1 + r() * 2, 2)
      g.fillRect(nw - 1 - r() * 2, y, 3, 2)
    }
    g.globalCompositeOperation = 'source-over'
    g.fillStyle = '#fffaf0'
    g.textBaseline = 'middle'
    g.fillText(who.name, 13, th / 2 + 1)
    g.restore()
    // The page before, if one has turned: one dimmed italic line over a pencilled rule (all of it once opened).
    const before = el.querySelector<HTMLElement>('.before')
    g.textBaseline = 'alphabetic'
    if (before && !before.hidden && !said) {
      g.font = `italic 16px ${BOOK}`
      g.fillStyle = 'rgba(107, 83, 64, 0.75)'
      let kept = wrap(g, before.textContent ?? '', w - 44)
      if (!before.classList.contains('open') && kept.length > 1) kept = [kept[0].replace(/\s*\S*$/, '') + ' …']
      kept.forEach((l, i) => g.fillText(l, x0 + 22, y0 + before.offsetTop + 16 + i * 21.6))
      const ruleY = y0 + before.offsetTop + before.offsetHeight - 2
      g.strokeStyle = 'rgba(150, 100, 60, 0.3)'
      g.setLineDash([5, 4])
      g.beginPath()
      g.moveTo(x0 + 22, ruleY)
      g.lineTo(x1 - 22, ruleY)
      g.stroke()
      g.setLineDash([])
    }
    // The words, in ink, where the card has them.
    const words = el.querySelector('.said')?.textContent ?? ''
    const top = el.querySelector<HTMLElement>('.words')?.offsetTop ?? 22
    const px = said ? 16 : 19
    g.font = `${beat ? 'italic ' : ''}${px}px ${BOOK}`
    // What was said steps back by its paper, size and place, not its ink: pale ink made it hard to read (#42 paper climb).
    g.fillStyle = said ? '#3f2d20' : '#24170f'
    let lines = wrap(g, words, w - 44)
    // What was said keeps three lines; one on a phone, where the round so far has to fit above the table.
    const keep = innerWidth < 600 ? 1 : 3
    if (said && lines.length > keep) lines = [...lines.slice(0, keep - 1), lines[keep - 1].replace(/\s*\S*$/, '') + ' …']
    const lead = px * 1.42
    lines.forEach((l, i) => g.fillText(l, x0 + 22, y0 + top + px + i * lead - 2))
    // "go on", where the card's button is (the invisible card under the slip takes the click).
    const more = el.querySelector<HTMLElement>('.more')
    if (more && !more.hidden && !said) {
      g.font = `italic 700 17px ${HAND}`
      g.fillStyle = who.colour
      g.textAlign = 'right'
      g.fillText('go on ▸', x0 + more.offsetLeft + more.offsetWidth - 4, y0 + more.offsetTop + 18)
      g.textAlign = 'left'
    }
    // Still talking: three ink dots after the last word.
    const cue = el.querySelector('.cue') as HTMLElement | null
    if (cue && !cue.hidden && !said) {
      const last = lines.at(-1) ?? ''
      const cx = x0 + 22 + g.measureText(last).width + 10, cy = y0 + top + px + (Math.max(1, lines.length) - 1) * lead - 7
      g.fillStyle = who.colour
      for (let i = 0; i < 3; i++) {
        g.beginPath()
        g.arc(cx + i * 9, cy, 2.6, 0, Math.PI * 2)
        g.fill()
      }
    }
  }

  /** Your line lying on the table: a page torn off your pad, ruled, in your hand, addressed at its head. */
  const paintMine = (slip: Slip, el: HTMLElement, w: number, h: number) => {
    const g = slip.g
    const r = rng(slip.seed)
    const x0 = TAB, y0 = TAB, x1 = TAB + w, y1 = TAB + h
    g.beginPath()
    // Torn along the top, where it came off the pad; cut clean on the other three sides.
    g.moveTo(x0, y0 + 2)
    for (let x = x0 + 6; x < x1; x += 6) g.lineTo(x, y0 + (r() - 0.5) * 3.2)
    g.lineTo(x1, y0 + 2)
    g.lineTo(x1, y1)
    g.lineTo(x0, y1)
    g.closePath()
    g.fillStyle = PAD
    g.fill()
    g.save()
    g.clip()
    g.strokeStyle = 'rgba(120, 150, 190, 0.45)'
    g.lineWidth = 1
    const words = el.querySelector<HTMLElement>('.words')
    const top = words?.offsetTop ?? 30
    for (let y = y0 + top + 22; y < y1; y += 26) {
      g.beginPath()
      g.moveTo(x0, y)
      g.lineTo(x1, y)
      g.stroke()
    }
    g.strokeStyle = 'rgba(200, 90, 80, 0.4)'
    g.beginPath()
    g.moveTo(x0 + 12, y0)
    g.lineTo(x0 + 12, y1)
    g.stroke()
    g.restore()
    g.strokeStyle = 'rgba(120, 85, 50, 0.3)'
    g.lineWidth = 0.8
    g.stroke()
    // Addressed at its head as on the pad: "to" in pencil, the name in its colour.
    const to = el.querySelector<HTMLElement>('.to-line')
    g.textBaseline = 'alphabetic'
    if (to) {
      const y = y0 + to.offsetTop + 15
      g.font = `italic 15px ${HAND}`
      g.fillStyle = 'rgba(70, 50, 36, 0.75)'
      g.fillText('to ', x0 + 20, y)
      const tw = g.measureText('to ').width
      g.font = `700 16px ${HAND}`
      g.fillStyle = el.style.getPropertyValue('--c') || '#8a6a48'
      g.fillText(el.dataset.to ?? '', x0 + 20 + tw, y)
    }
    g.font = `20px ${HAND}`
    g.fillStyle = INK
    let lines = wrap(g, el.querySelector('.said')?.textContent ?? '', w - 40)
    const keep = innerWidth < 600 ? 1 : 3
    if (lines.length > keep) lines = [...lines.slice(0, keep - 1), lines[keep - 1].replace(/\s*\S*$/, '') + ' …']
    lines.forEach((l, i) => g.fillText(l, x0 + 20, y0 + top + 19 + i * 26))
  }

  const frame = (dt: number) => {
    for (const el of document.querySelectorAll<HTMLElement>('.talk-card')) {
      const person = el.dataset.talkCard
      if (!person) continue
      const slip = slips.get(person) ?? make(person)
      const shown = el.classList.contains('shown')
      slip.fade += ((shown ? 1 : 0) - slip.fade) * (1 - Math.exp(-dt * 12))
      const who = speaker(person)
      const m = /(-?[\d.]+)px (-?[\d.]+)px/.exec(el.style.translate)
      if (slip.fade < 0.01 || !who || !m) {
        slip.c.style.opacity = '0'
        if (!shown) slip.from = null
        continue
      }
      const w = el.offsetWidth, h = el.offsetHeight
      const words = el.querySelector('.said')?.textContent ?? ''
      const cue = (el.querySelector('.cue') as HTMLElement | null)?.hidden
      const before = el.querySelector<HTMLElement>('.before')
      const more = (el.querySelector('.more') as HTMLElement | null)?.hidden
      const key = [w, h, words, cue, more, before?.hidden, before?.className, before?.textContent, el.dataset.to, el.className, el.dataset.tail, el.style.getPropertyValue('--tail'), el.style.getPropertyValue('--reach')].join('|')
      if (key !== slip.key) {
        slip.key = key
        paint(slip, el, who, w, h)
      }
      // Turned a little toward its speaker (square with no tail), a little crooked, and tipping up into place as it appears.
      const toward = el.dataset.tail === 'left' ? -1 : el.dataset.tail === 'right' ? 1 : 0
      slip.c.style.transformOrigin = toward < 0 ? '0 50%' : toward > 0 ? '100% 50%' : '50% 100%'
      // Whoever speaks now is full size on bright paper; what was said before steps back: a little
      // smaller, lower and on paler paper, but opaque (see-through, the lamp showed through its words; fully alike,
      // the round's order could not be read: the regroup's rounds 5 and 6).
      const said = el.classList.contains('said')
      // Your line lies on the table: tipped back, as paper on a table top is seen from a chair.
      // Clipped to a reply it stands with it, turned a little more than a slip is.
      const clipped = el.classList.contains('clipped')
      const lying = el.classList.contains('mine') && !clipped ? 32 : 0
      const x = parseFloat(m[1]) - TAB, y = parseFloat(m[2]) - TAB + (said ? 6 : 0)
      if (slip.from) {
        // Opening out of the landed note: from its size and place on screen, unfolding, to the slip's own.
        slip.open = Math.min(1, slip.open + dt / 0.5)
        const p = 1 - (1 - slip.open) ** 3
        const W = w + TAB * 2, H = h + TAB * 2
        const s0 = Math.min(0.6, Math.max(0.1, slip.from.w / W))
        const sc = s0 + (1 - s0) * p
        const fx = slip.from.x - (W * s0) / 2, fy = slip.from.y - (H * s0) / 2
        slip.c.style.transformOrigin = '0 0'
        slip.c.style.transform = `translate(${fx + (x - fx) * p}px, ${fy + (y - fy) * p}px) perspective(900px) rotateX(${(1 - p) * 70 + lying}deg) scale(${sc})`
        if (slip.open >= 1) slip.from = null
      } else slip.c.style.transform = `translate(${x}px, ${y}px) perspective(900px) rotateY(${toward * 9}deg) rotateZ(${slip.tilt + (clipped ? 0.05 : 0)}rad) rotateX(${(1 - slip.fade) * 28 + lying}deg) scale(${said ? 0.93 : 1})`
      slip.c.style.filter = said ? 'saturate(0.6) drop-shadow(0 3px 5px rgba(60, 30, 10, 0.16))' : ''
      slip.c.style.opacity = String(slip.from ? Math.min(1, slip.fade * 1.6) : slip.fade)
    }
  }
  /** A slip about to show opens out of the note that landed at `at` (screen point and width). */
  const from = (person: string, at: { x: number; y: number; w: number }) => {
    const slip = slips.get(person) ?? make(person)
    slip.from = { ...at }
    slip.open = 0
  }
  const dispose = () => {
    for (const s of slips.values()) s.c.remove()
  }
  return { frame, dispose, from }
}

/** The slips' styles: the card stays in the page unseen, and the name ribbons give way to the slips' tape. */
export function paperCss() {
  return `
  .talk-card { opacity: 0 !important; }
  .talk-paper { position: fixed; left: 0; top: 0; z-index: 3; pointer-events: none; opacity: 0;
    filter: drop-shadow(0 6px 10px rgba(60, 30, 10, 0.22)) drop-shadow(0 1px 1px rgba(60, 30, 10, 0.18)); }
  .talk-tag.shown:not(.hover) { opacity: 0; }
  `
}
