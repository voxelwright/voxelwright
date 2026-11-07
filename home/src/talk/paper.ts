// Paper (#42 regroup, November 7, 2026): the villagers' words as slips of torn paper, the look
// that won the regroup against cinematic staging and a caption strip (README, "Talk regroup").
import { canvas, rng } from '../paint'

const HAND = '"Bradley Hand", "Segoe Print", "Comic Sans MS", cursive'
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
    document.body.append(c)
    const seed = [...person].reduce((a, ch) => a * 31 + ch.charCodeAt(0), 7) % 997
    const slip = { c, g, key: '', fade: 0, tilt: (rng(seed)() - 0.5) * 0.06, seed }
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
    const W = (w + TAB * 2) * SCALE, H = (h + TAB * 2) * SCALE
    if (slip.c.width !== W || slip.c.height !== H) {
      slip.c.width = W
      slip.c.height = H
      slip.c.style.width = `${w + TAB * 2}px`
      slip.c.style.height = `${h + TAB * 2}px`
    }
    const g = slip.g
    g.setTransform(SCALE, 0, 0, SCALE, 0, 0)
    g.clearRect(0, 0, w + TAB * 2, h + TAB * 2)
    const said = el.classList.contains('said')
    const beat = el.classList.contains('beat')
    const tail = el.dataset.tail ?? 'down'
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
      g.lineTo(x0 + at + 9, y1 + jag())
      g.lineTo(x0 + at - 3, y1 + TAB - 2)
      g.lineTo(x0 + at - 10, y1 + jag())
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
    g.fillStyle = said ? '#6e5642' : '#24170f'
    let lines = wrap(g, words, w - 44)
    if (said && lines.length > 3) lines = [...lines.slice(0, 2), lines[2].replace(/\s*\S*$/, '') + ' …']
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
        continue
      }
      const w = el.offsetWidth, h = el.offsetHeight
      const words = el.querySelector('.said')?.textContent ?? ''
      const cue = (el.querySelector('.cue') as HTMLElement | null)?.hidden
      const before = el.querySelector<HTMLElement>('.before')
      const more = (el.querySelector('.more') as HTMLElement | null)?.hidden
      const key = [w, h, words, cue, more, before?.hidden, before?.className, before?.textContent, el.className, el.dataset.tail, el.style.getPropertyValue('--tail')].join('|')
      if (key !== slip.key) {
        slip.key = key
        paint(slip, el, who, w, h)
      }
      // Turned a little toward its speaker, a little crooked, and tipping up into place as it appears.
      const toward = el.dataset.tail === 'left' ? -1 : el.dataset.tail === 'right' ? 1 : 0
      slip.c.style.transformOrigin = toward < 0 ? '0 50%' : toward > 0 ? '100% 50%' : '50% 100%'
      slip.c.style.transform = `translate(${parseFloat(m[1]) - TAB}px, ${parseFloat(m[2]) - TAB}px) perspective(900px) rotateY(${toward * 9}deg) rotateZ(${slip.tilt}rad) rotateX(${(1 - slip.fade) * 28}deg)`
      // Whoever speaks now is in dark ink; what was said before steps back in lighter ink, still opaque
      // (see-through, the lamp showed through its words).
      slip.c.style.opacity = String(slip.fade)
    }
  }
  const dispose = () => {
    for (const s of slips.values()) s.c.remove()
  }
  return { frame, dispose }
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
