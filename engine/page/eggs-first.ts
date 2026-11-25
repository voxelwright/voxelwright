// The eggs from the first view (#450, eggs.ts): started and stopped with one tap on things that belong to the picture,
// before anyone has gone in. Two kinds of thing, one way of tapping them:
//
//   the banner     after the site's name has been up a while its plane says something else for a while, a line for an
//                  egg ("Wake up, Neo…", "Never gonna…", …, then a meme's title, another each time round), and the site's name again between them. A line is no longer
//                  than the name: a longer one is set smaller on the same cloth, and could not be read on a phone. A tap
//                  on the cloth starts what it says; on the site's name, a barrel roll; while an egg runs, it ends it.
//   the lamps      the red aircraft warning lamps a tall tower carries, blinking on the Pyramid's spire and the
//                  Salesforce Tower's crown (steady where motion is not wanted). Each starts its egg, and ends it again.
//
// Under those, the city's windows that hold an egg (eggs-lockers.ts): the pointer over one lights it up and says what
// it holds, and a tap or a click on one opens it; a board, the banner or a lamp under the same point has it first.
//
// (Not the moon: it stands where the night's light comes from, high in the north-east, out of both framings of the
// first view, so nothing here asks it up.)
//
// A tap is heard where a board's is (boards.ts `under`), in the capture phase on the window, after the boards: a board
// under the same point has it first. Nothing here engages, takes the pointer or moves the eye but the egg itself, and a
// tap on one of these puts an EXPLORE asked once back as it was, as a click anywhere else of the picture does.
//
// The lamps are lights laid over the picture where the towers' tips are (the landmarks' own lamps, march.ts
// LANDMARK_LIGHT, are lit by night only, and a point of light 2 km off is a pixel by day): only while the first view is
// up, the eye where it arrived. Fetched with eggs.ts, once the park is shown.
import type { Beacon, View } from './march.ts'
import type { Boards } from './boards.ts'
import type { Signs } from './signs.ts'

type Plane = NonNullable<Boards['plane']>
export type Spot = 'banner' | 'pyramid' | 'crown'

export interface FirstNeeds {
  hasMedia: boolean
  canvas: HTMLCanvasElement
  view(): View
  /** Whether the first view is up as it opened: nobody on the way in, the eye where it arrived. */
  still(): boolean
  /** An EXPLORE asked once is put back as it was (explore.ts `disarm`). */
  calm(): void
  plane(): Plane | null
  beacons(): readonly Beacon[]
  signs: Signs
  /** Whether the banner is free to say a line of its own: no egg on it or running, no line open. */
  quiet(): boolean
  /** Whether fog lies over the city now, 0 to 1. */
  fog(): number
  /** After the lines above, one more each time round: a meme's, a different one each time (eggs.ts), or none. */
  more?(): { text: string; egg: string } | null
  /** A tap on a spot: on the banner, the egg its line is for (null: the site's name). */
  tap(spot: Spot, line: string | null): void
  /** The windows that hold an egg (eggs-lockers.ts): which is under a point of the page, the one the pointer is over, one opened. */
  lockers?: { at(x: number, y: number): number | null; hover(i: number | null): void; open(i: number): void }
}

/** The banner's lines, one an egg, and what each starts (eggs.ts `act`). */
export const LINES: readonly { text: string; egg: string }[] = [
  { text: 'Wake up, Neo…', egg: 'matrix' },
  { text: 'Never gonna…', egg: 'rickroll' },
  { text: 'Barrel roll!', egg: 'roll' },
  { text: 'Bad Apple!!', egg: 'apple' },
]
/** How long the site's name is up before the first line (s, from the park shown), between lines, and how long a line stays in sight. */
const FIRST = 14, NAME = 10, LINE = 9
/** A cloth shorter than this on the picture (px) has its plane called in while it says a line: its letters would be unreadable on its own round. */
const SMALL = 34
/** A tap target is this big at least by touch (px), and a lamp's light this big across. */
const THUMB = 44, LAMP = { fine: 12, coarse: 15 }

const STYLE = /* css */ `
#egg-lamps { position: fixed; inset: 0; z-index: 5; pointer-events: none; overflow: hidden; }
#egg-lamps i { position: absolute; left: 0; top: 0; inline-size: var(--d); block-size: var(--d); margin: calc(var(--d) / -2) 0 0 calc(var(--d) / -2); border-radius: 50%;
  background: radial-gradient(circle, #fff3ec 0 14%, #ff4a36 30%, rgb(255 46 28 / 0.42) 50%, rgb(255 46 28 / 0) 72%); mix-blend-mode: screen;
  animation: egg-lamp 1.6s steps(1, end) infinite; transition: scale 0.16s cubic-bezier(0.23, 1, 0.32, 1); }
#egg-lamps i.crown { animation-delay: -0.8s; }
#egg-lamps i.hot { scale: 1.45; animation: none; opacity: 1; }
/* A real obstruction lamp: on for half its beat, a faint glow left between. */
@keyframes egg-lamp { 0% { opacity: 1; } 55% { opacity: 0.18; } }
/* A video's player in the first view (eggs.ts laidOn): on a wide picture its top left is the Pyramid's lamp and the banner's round, so it stands at the bottom right, over the city. Gone in, it is where the realm lays it, clear of the thumbs. */
@media (min-aspect-ratio: 1/1) { html.first #first > .egg-player { inset: auto max(16px, env(safe-area-inset-right)) max(16px, env(safe-area-inset-bottom)) auto !important; } }
@media (prefers-reduced-motion: reduce) { #egg-lamps i { animation: none; opacity: 0.9; transition: none; } }
`

export function firstTaps(o: FirstNeeds) {
  const lines = o.hasMedia ? LINES : LINES.filter((l) => l.egg === 'matrix' || l.egg === 'roll')
  const touch = matchMedia('(pointer: coarse)')
  const style = document.createElement('style')
  style.textContent = STYLE
  const holder = document.createElement('div')
  holder.id = 'egg-lamps'
  holder.setAttribute('aria-hidden', 'true')
  const lamps = { pyramid: document.createElement('i'), crown: document.createElement('i') }
  lamps.crown.className = 'crown'
  holder.append(lamps.pyramid, lamps.crown)
  document.head.append(style)
  document.body.append(holder)

  // ── Where things are on the page (client px) ──
  const rect = () => o.canvas.getBoundingClientRect()
  /** A point of the world (cells) on the page, or null behind the eye. */
  const onPage = (p: readonly number[]) => {
    const v = o.view(), r = rect(), d = [p[0] - v.eye[0], p[1] - v.eye[1], p[2] - v.eye[2]], far = d[0] * v.forward[0] + d[1] * v.forward[1] + d[2] * v.forward[2]
    if (far <= 1) return null
    const x = (d[0] * v.right[0] + d[1] * v.right[1] + d[2] * v.right[2]) / (v.tanHalf * (r.width / r.height) * far), y = (d[0] * v.up[0] + d[1] * v.up[1] + d[2] * v.up[2]) / (v.tanHalf * far)
    return { x: r.left + ((x + 1) / 2) * r.width, y: r.top + ((1 - y) / 2) * r.height, far }
  }
  /** The Pyramid (the landmark with a lamp at its point) and the Salesforce Tower (the one whose lit part has rings: a screen of lamps). */
  const tower = (which: 'pyramid' | 'crown') => o.beacons().find((b) => (which === 'pyramid' ? b.night[9] > 0 : b.night[8] > 0)) ?? null
  /** Where a lamp is on the page, and the box a tap on it is heard in. */
  const lampAt = (which: 'pyramid' | 'crown') => {
    if (which === 'pyramid' && !o.hasMedia) return null
    const b = tower(which)
    if (!b) return null
    const top = onPage([b.at[0], b.at[1] + b.night[1] * 10, b.at[2]])
    if (!top) return null
    const r = rect(), inside = top.x > r.left && top.x < r.right && top.y > r.top && top.y < r.bottom
    if (!inside) return null
    // The Pyramid's: round its point. The crown's: the lit crown down to its foot, as wide as it is there.
    const half = Math.max(touch.matches ? THUMB / 2 : 14, 0)
    if (which === 'pyramid') return { x: top.x, y: top.y, box: { x0: top.x - half, y0: top.y - half, x1: top.x + half, y1: top.y + half } }
    const foot = onPage([b.at[0], b.at[1] + b.night[0] * 10, b.at[2]])
    const wide = foot ? Math.max(half, ((b.night[2] * 10) / foot.far / o.view().tanHalf / 2) * r.height * 1.2) : half
    const y1 = Math.max(top.y + half, foot?.y ?? top.y)
    return { x: top.x, y: top.y, box: { x0: top.x - wide, y0: top.y - half, x1: top.x + wide, y1 } }
  }
  /** The banner's cloth on the page, grown to a thumb's size by touch. */
  const clothAt = () => {
    const box = o.plane()?.box
    if (!box) return null
    const w = box.x1 - box.x0, h = box.y1 - box.y0, least = touch.matches ? THUMB : 24
    const gx = Math.max(6, (least - w) / 2), gy = Math.max(6, (least - h) / 2)
    return { x0: box.x0 - gx, y0: box.y0 - gy, x1: box.x1 + gx, y1: box.y1 + gy }
  }
  /** The spot under a point of the page, the nearest of those whose box holds it; null for none. */
  const spotAt = (x: number, y: number): Spot | null => {
    if (!o.still()) return null
    const boxes: [Spot, { x0: number; y0: number; x1: number; y1: number } | null | undefined][] = [['banner', clothAt()], ['pyramid', lampAt('pyramid')?.box], ['crown', lampAt('crown')?.box]]
    let best: Spot | null = null, nearest = Infinity
    for (const [spot, b] of boxes) {
      if (!b || x < b.x0 || x > b.x1 || y < b.y0 || y > b.y1) continue
      const d = Math.hypot(x - (b.x0 + b.x1) / 2, y - (b.y0 + b.y1) / 2)
      if (d < nearest) { nearest = d; best = spot }
    }
    return best
  }

  // ── The banner's lines ──
  /** The line on the banner now (null: the site's name or whatever else is on it), which is next, how long the name has been up, how long the line has been seen. */
  let line: (typeof LINES)[number] | null = null, next = 0, waited = -FIRST + NAME, seen = 0, calledIn = false
  /** Whether the banner says what the lines left on it: its line while one is up, else its own words. */
  const ours = () => { const b = o.signs.list().find((s) => s.id === 'banner'); return !!b && (line ? !b.own && !!b.content && 'text' in b.content && b.content.text === line.text : b.own) }
  const quietLine = () => {
    if (!line) return
    const was = line
    line = null
    // (Only what is ours is taken off: an egg, the line or the host may have put something else there since.)
    const b = o.signs.list().find((s) => s.id === 'banner')
    if (b && !b.own && !!b.content && 'text' in b.content && b.content.text === was.text) o.signs.set('banner', null)
    const p = o.plane()
    if (calledIn && p) p.loud = false
    calledIn = false
  }
  const say = (l: (typeof LINES)[number]) => {
    line = l
    seen = 0
    o.signs.set('banner', { text: l.text })
  }
  const frame = (dt: number) => {
    const up = o.still()
    holder.hidden = !up
    const p = o.plane()
    if (!up || !p) { quietLine(); return }
    // Something else on the banner, or nobody free to hear it: the line goes (or was taken), and the name's wait starts again.
    // (Taken by an egg or its line, the banner and its plane are theirs. Taken by the host page, its plane goes back out if it was called in for the line.)
    if (!ours()) { if (calledIn && o.quiet()) p.loud = false; line = null; calledIn = false; waited = 0; return }
    if (!o.quiet() || p.hold !== null) { quietLine(); waited = 0; return }
    if (line) {
      // On a picture where the cloth on its own round is too small to be read, its plane comes in to say it, and the
      // line is seen once it has (as an egg's is, main.ts `planeSeen`).
      const box = p.box
      if (!p.loud && box && box.y1 - box.y0 < SMALL) { p.loud = true; calledIn = true }
      if (p.readable && (!p.loud || p.come >= 1)) seen += dt
      if (seen > LINE) { quietLine(); waited = 0 }
    } else if ((waited += dt) > NAME) {
      // (The lines, then a meme's if there is one, then the lines again.)
      const l = next < lines.length ? lines[next] : o.more?.() ?? lines[0]
      next = next < lines.length ? next + 1 : l === lines[0] ? 1 : 0
      say(l)
    }
  }
  const lampsFrame = () => {
    if (holder.hidden) return
    // (Dimmed by fog, as far as a lamp's red still comes through it.)
    const d = touch.matches ? LAMP.coarse : LAMP.fine, dim = 1 - Math.min(0.45, o.fog() * 1.4)
    for (const which of ['pyramid', 'crown'] as const) {
      const at = lampAt(which), el = lamps[which]
      el.hidden = !at
      if (!at) continue
      el.style.setProperty('--d', `${d}px`)
      el.style.translate = `${Math.round(at.x * 2) / 2}px ${Math.round(at.y * 2) / 2}px`
      el.style.filter = dim < 1 ? `opacity(${dim.toFixed(2)})` : ''
    }
  }

  // ── Taps and the pointer over them ──
  addEventListener('click', (e) => {
    if (e.target !== o.canvas) return
    const spot = spotAt(e.clientX, e.clientY)
    const locker = spot ? null : o.lockers?.at(e.clientX, e.clientY) ?? null
    if (!spot && locker === null) return
    e.stopImmediatePropagation(); e.preventDefault()
    o.calm()
    if (!spot) return o.lockers!.open(locker!)
    const said = spot === 'banner' ? line?.egg ?? null : null
    // A line tapped has been heard: the name is put back, and what it started says what it says over it.
    if (said) { quietLine(); waited = 0 }
    o.tap(spot, said)
  }, true)
  let hot: Spot | null = null, hotLocker: number | null = null
  // (Only a mouse is over a window: the mousemove a browser sends after a tap (or a pen's, which may not hover) is not,
  // and the words it left up stayed for good, the window lit over a playing video. A tap opens one all the same.)
  let mouse = !touch.matches
  for (const type of ['pointerdown', 'pointermove']) addEventListener(type, (e) => { mouse = (e as PointerEvent).pointerType === 'mouse' }, true)
  addEventListener('mousemove', (e) => {
    // (The boards' own listener ran first and set the cursor for this move: a board under the pointer has it. Where
    // there are no boards, the cursor is this listener's alone, and put back here.)
    const boards = !!o.plane(), free = e.target === o.canvas && !(boards && o.canvas.style.cursor === 'pointer')
    const spot = free ? spotAt(e.clientX, e.clientY) : null
    // (A window under it only where nothing else is.)
    const locker = free && !spot && mouse ? o.lockers?.at(e.clientX, e.clientY) ?? null : null
    if (spot || locker !== null) o.canvas.style.cursor = 'pointer'
    else if ((hot || hotLocker !== null) && !boards) o.canvas.style.cursor = ''
    if (locker !== hotLocker) { hotLocker = locker; o.lockers?.hover(locker) }
    if (spot === hot) return
    hot = spot
    lamps.pyramid.classList.toggle('hot', spot === 'pyramid')
    lamps.crown.classList.toggle('hot', spot === 'crown')
    // The banner under the pointer waves harder, as a cloth caught by a gust.
    const p = o.plane()
    if (p) p.cloth.wave = spot === 'banner' ? 11 : 5
  })

  o.canvas.addEventListener('pointerleave', () => {
    if (hotLocker === null) return
    hotLocker = null
    o.lockers?.hover(null)
    // (Where there are no boards the cursor is this file's to put back: the next move over the picture would not.)
    if (!o.plane() && !hot) o.canvas.style.cursor = ''
  })

  return {
    /** Every frame: the banner's lines, and the lamps where the towers' tips are. */
    frame(dt: number) { frame(dt); lampsFrame() },
    /** For the checks: where each spot is on the page now, and the line on the banner. */
    get spots() {
      const box = (b: { x0: number; y0: number; x1: number; y1: number } | null | undefined) => b && { x: Math.round((b.x0 + b.x1) / 2), y: Math.round((b.y0 + b.y1) / 2), w: Math.round(b.x1 - b.x0), h: Math.round(b.y1 - b.y0) }
      return { banner: box(clothAt()), pyramid: box(lampAt('pyramid')?.box), crown: box(lampAt('crown')?.box), line: line?.text ?? null, still: o.still(), lamps: !holder.hidden }
    },
    spotAt,
  }
}
