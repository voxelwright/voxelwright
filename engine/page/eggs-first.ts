// The eggs from the first view (#450, eggs.ts): started and stopped with one tap on things that belong to the picture,
// before anyone has gone in:
//
//   the banner     after the site's name has been up a while its plane says something else for a while, a line for an
//                  egg ("Wake up, Neo…", "Never gonna…", …, then a meme's title, another each time round), and the site's name again between them. A line is no longer
//                  than the name: a longer one is set smaller on the same cloth, and could not be read on a phone. A tap
//                  on the cloth starts what it says; on the site's name, a barrel roll; while an egg runs, it ends it.
//
// Under it, the city's windows that hold an egg (eggs-lockers.ts): the pointer over one lights it up and says what
// it holds, and a tap or a click on one opens it; a board or the banner under the same point has it first.
//
// (Not the moon: it stands where the night's light comes from, high in the north-east, out of both framings of the
// first view, so nothing here asks it up.)
//
// A tap is heard where a board's is (boards.ts `under`), in the capture phase on the window, after the boards: a board
// under the same point has it first. Nothing here engages, takes the pointer or moves the eye but the egg itself, and a
// tap on one of these puts an EXPLORE asked once back as it was, as a click anywhere else of the picture does.
import type { Boards } from './boards.ts'
import type { Signs } from './signs.ts'

type Plane = NonNullable<Boards['plane']>
export type Spot = 'banner'

export interface FirstNeeds {
  hasMedia: boolean
  canvas: HTMLCanvasElement
  /** Whether the first view is up as it opened: nobody on the way in, the eye where it arrived. */
  still(): boolean
  /** An EXPLORE asked once is put back as it was (explore.ts `disarm`). */
  calm(): void
  plane(): Plane | null
  signs: Signs
  /** Whether the banner is free to say a line of its own: no egg on it or running, no line open. */
  quiet(): boolean
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
/** A tap target is this big at least by touch (px). */
const THUMB = 44

const STYLE = /* css */ `
/* A video's player in the first view (eggs.ts laidOn): on a wide picture its top left is the banner's round, so it stands at the bottom right, over the city. Gone in, it is where the realm lays it, clear of the thumbs. */
@media (min-aspect-ratio: 1/1) { html.first #first > .egg-player { inset: auto max(16px, env(safe-area-inset-right)) max(16px, env(safe-area-inset-bottom)) auto !important; } }
`

export function firstTaps(o: FirstNeeds) {
  const lines = o.hasMedia ? LINES : LINES.filter((l) => l.egg === 'matrix' || l.egg === 'roll')
  const touch = matchMedia('(pointer: coarse)')
  const style = document.createElement('style')
  style.textContent = STYLE
  document.head.append(style)

  // ── Where the banner is on the page (client px) ──
  /** The banner's cloth on the page, grown to a thumb's size by touch. */
  const clothAt = () => {
    const box = o.plane()?.box
    if (!box) return null
    const w = box.x1 - box.x0, h = box.y1 - box.y0, least = touch.matches ? THUMB : 24
    const gx = Math.max(6, (least - w) / 2), gy = Math.max(6, (least - h) / 2)
    return { x0: box.x0 - gx, y0: box.y0 - gy, x1: box.x1 + gx, y1: box.y1 + gy }
  }
  /** The spot under a point of the page; null for none. */
  const spotAt = (x: number, y: number): Spot | null => {
    if (!o.still()) return null
    const b = clothAt()
    return b && x >= b.x0 && x <= b.x1 && y >= b.y0 && y <= b.y1 ? 'banner' : null
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
    /** Every frame: the banner's lines. */
    frame(dt: number) { frame(dt) },
    /** For the checks: where the banner is on the page now, and the line on it. */
    get spots() {
      const box = (b: { x0: number; y0: number; x1: number; y1: number } | null | undefined) => b && { x: Math.round((b.x0 + b.x1) / 2), y: Math.round((b.y0 + b.y1) / 2), w: Math.round(b.x1 - b.x0), h: Math.round(b.y1 - b.y0) }
      return { banner: box(clothAt()), line: line?.text ?? null, still: o.still() }
    },
    spotAt,
  }
}
