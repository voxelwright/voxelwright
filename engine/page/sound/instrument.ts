// An instrument's own way of being played (#247): a surface, written as data beside the patch that is its voice. It
// is drawn here from numbers and names (never from markup anyone wrote) and played by touch, by the mouse and by
// keys. Nothing about it is fixed to a kind of instrument: a part of the surface is a shape anywhere on it that
// sounds a note, is a string, sets a chord, strums, or slides between two pitches, so a guitar, an ocarina, a piano,
// a kalimba and a theremin are all the one form. A part that does none of those is drawing: the thing's look.
//
//   "surface": { "size": [12, 5],                  its own units, 2 to 64 each way
//     "release": "rings",                          or "stops": letting go damps the note (a piano key). Blown and bowed always stop.
//     "parts": [                                   up to 80
//       { "shape": "rect", "at": [x, y, w, h],     or "round" (the oval the box holds), or "poly" with "points": [[x, y], ...] (3 to 16)
//         "colour": "wood",                        one of COLOURS
//         "label": "D",  "key": "KeyA",            up to 6 plain characters; a key of the keyboard (KeyA to KeyZ, Digit0 to Digit9, Space)
//         "note": 62,                              sounds this note (MIDI, 12 to 120, fractions allowed)
//         "slide": { "to": 74, "along": "x" },     with note: the pitch runs from note to this across the part, and follows the finger
//         "level": "y",                            how loud follows the finger along that way
//         "string": 0,                             this part is a string (with note: its open note); a chord changes what it sounds
//         "chord": [40, 47, 52, 55, 59, 64],       sets what each string sounds, in order
//         "strum": 18 } ] }                        sounds every string, low to high, this many ms apart
//
// What makes it feel played: the note is asked for inside the event that the touch or key is (no frame is waited
// for, nothing is looked up on the GPU), and it leaves the synthesiser 3 ms later.
import { BUS, SET, type Sound } from './sound.ts'
import type { Patch } from './patch.ts'
import { COLOURS, type Part, type Surface } from './surface.ts'

export { surface, COLOURS, type Part, type Surface } from './surface.ts'

const hz = (note: number) => 440 * 2 ** ((note - 69) / 12)
const SVG = 'http://www.w3.org/2000/svg'

/**
 * Draws a surface in an element and plays it with a patch. Returns `key(code, down)` for whoever owns the keyboard
 * (true if the key is one of the instrument's), what is sounding, and `close()`. While it is open the place's music
 * steps back so that what is played can be heard.
 */
export function playable(into: HTMLElement, voice: Sound, patch: Patch, ui: Surface) {
  const [w, h] = ui.size, svg = document.createElementNS(SVG, 'svg')
  svg.setAttribute('viewBox', `0 0 ${w} ${h}`)
  svg.setAttribute('preserveAspectRatio', 'xMidYMid meet')
  svg.style.cssText = 'width:100%;height:100%;display:block;touch-action:none;user-select:none;-webkit-user-select:none'
  const stops = patch.how === 'blown' || patch.how === 'rubbed' || ui.release === 'stops'
  const strings = ui.parts.filter((p) => p.string !== undefined).sort((a, b) => a.string! - b.string!), tuned = strings.map((p) => p.note!)
  const shapes = new Map<Element, Part>(), marks = new Map<Part, SVGElement>()
  for (const p of ui.parts) {
    let shape: SVGElement, cx = 0, cy = 0
    if (p.shape === 'poly') { shape = document.createElementNS(SVG, 'polygon'); shape.setAttribute('points', p.points!.map((q) => q.join(',')).join(' ')); cx = p.points!.reduce((s, q) => s + q[0], 0) / p.points!.length; cy = p.points!.reduce((s, q) => s + q[1], 0) / p.points!.length }
    else {
      const [x, y, pw, ph] = p.at!
      cx = x + pw / 2; cy = y + ph / 2
      if (p.shape === 'round') { shape = document.createElementNS(SVG, 'ellipse'); shape.setAttribute('cx', String(cx)); shape.setAttribute('cy', String(cy)); shape.setAttribute('rx', String(pw / 2)); shape.setAttribute('ry', String(ph / 2)) }
      else { shape = document.createElementNS(SVG, 'rect'); shape.setAttribute('x', String(x)); shape.setAttribute('y', String(y)); shape.setAttribute('width', String(pw)); shape.setAttribute('height', String(ph)); shape.setAttribute('rx', String(Math.min(pw, ph) * 0.12)) }
    }
    shape.setAttribute('fill', COLOURS[p.colour ?? 'grey'])
    shape.setAttribute('stroke', 'rgba(0,0,0,0.35)'); shape.setAttribute('stroke-width', '0.04')
    const sounds = p.note !== undefined || p.strum !== undefined || p.chord !== undefined
    if (!sounds) shape.style.pointerEvents = 'none'
    svg.append(shape)
    shapes.set(shape, p); marks.set(p, shape)
    // Its name in its middle and its key at its foot, both sized to the part.
    const box = p.at ?? [cx - 0.5, cy - 0.5, 1, 1], small = Math.min(box[2], box[3])
    const write = (words: string, y: number, size: number, faint: boolean) => {
      const t = document.createElementNS(SVG, 'text')
      t.textContent = words
      t.setAttribute('x', String(cx)); t.setAttribute('y', String(y))
      t.setAttribute('text-anchor', 'middle'); t.setAttribute('font-size', String(size)); t.setAttribute('font-family', '-apple-system, system-ui, sans-serif'); t.setAttribute('font-weight', '600')
      t.setAttribute('fill', ['ivory', 'white', 'pale', 'steel', 'sky', 'gold', 'brass'].includes(p.colour ?? '') ? '#222' : '#eee'); t.setAttribute('opacity', faint ? '0.55' : '0.95')
      t.style.pointerEvents = 'none'
      svg.append(t)
    }
    const hint = p.key ? p.key.replace(/^Key|^Digit/, '') : '', hintSize = Math.min(0.3, small * 0.45), labelSize = Math.min(0.46, small * 0.5, (box[2] * 1.5) / Math.max(1, p.label?.length ?? 1))
    if (p.label) write(p.label, cy + labelSize * 0.35 - (hint && box[3] < 1.6 ? hintSize * 0.45 : 0), labelSize, false)
    if (hint) write(hint, box[3] > box[2] * 1.5 || p.label ? box[1] + box[3] - hintSize * 0.5 : cy + hintSize * 0.35, hintSize * (hint.length > 2 ? 0.8 : 1), true)
  }
  into.append(svg)
  voice.set(SET.music, 0.2); voice.flush()

  /** What a finger or a key has sounding: the part, and the held note's name if it is one that is let go. */
  const down = new Map<number | string, { part: Part; id: number }>()
  let played = 0
  /** Where along a part a point of the surface is, 0 to 1 each way. */
  const along = (p: Part, x: number, y: number): [number, number] => {
    const box = p.at ?? [Math.min(...p.points!.map((q) => q[0])), Math.min(...p.points!.map((q) => q[1])), Math.max(...p.points!.map((q) => q[0])) - Math.min(...p.points!.map((q) => q[0])), Math.max(...p.points!.map((q) => q[1])) - Math.min(...p.points!.map((q) => q[1]))]
    return [Math.max(0, Math.min(1, (x - box[0]) / (box[2] || 1))), Math.max(0, Math.min(1, 1 - (y - box[1]) / (box[3] || 1)))]
  }
  const pitch = (p: Part, u: number, v: number) => (p.slide ? p.note! + (p.slide.to - p.note!) * (p.slide.along === 'x' ? u : v) : p.string !== undefined ? tuned[p.string] : p.note!)
  const lit = (p: Part, on: boolean) => { marks.get(p)!.style.filter = on ? 'brightness(1.45)' : '' }
  const start = (who: number | string, p: Part, u = 0.5, v = 0.5, force = 0.75) => {
    played++
    if (p.chord) { p.chord.forEach((n, i) => { tuned[i] = n }); for (const q of ui.parts) if (q.chord) lit(q, q === p); return }
    lit(p, true)
    if (p.strum !== undefined) { tuned.forEach((n, i) => voice.play(patch, { bus: BUS.play, pitch: hz(n), force: force * (0.85 + 0.3 * Math.random()), after: (i * p.strum!) / 1000, pan: -0.2 + 0.4 * (i / Math.max(1, tuned.length - 1)), room: 0.15 })); down.set(who, { part: p, id: 0 }); return }
    const level = p.level ? (p.level === 'x' ? u : v) : 1, how = { pitch: hz(pitch(p, u, v)), force, gain: p.level ? Math.max(0.05, level) : 1, room: 0.15 }
    down.set(who, { part: p, id: stops ? voice.hold(patch, how) : (voice.play(patch, { ...how, bus: BUS.play }), 0) })
  }
  const move = (who: number | string, u: number, v: number) => { const d = down.get(who); if (d?.id && (d.part.slide || d.part.level)) voice.glide(d.id, d.part.slide ? hz(pitch(d.part, u, v)) : 0, d.part.level ? Math.max(0.02, d.part.level === 'x' ? u : v) * 0.5 * patch.gain : -1) }
  const stop = (who: number | string) => { const d = down.get(who); if (!d) return; down.delete(who); if (![...down.values()].some((o) => o.part === d.part) && !d.part.chord) lit(d.part, false); voice.release(d.id) }

  const point = (e: PointerEvent): [number, number] => { const r = svg.getBoundingClientRect(), scale = Math.min(r.width / w, r.height / h); return [(e.clientX - r.left - (r.width - w * scale) / 2) / scale, (e.clientY - r.top - (r.height - h * scale) / 2) / scale] }
  const under = (e: PointerEvent) => shapes.get(document.elementFromPoint(e.clientX, e.clientY) as Element)
  const force = (e: PointerEvent) => (e.pointerType === 'touch' && e.pressure > 0 && e.pressure !== 0.5 ? 0.4 + 0.6 * e.pressure : 0.75)
  svg.addEventListener('pointerdown', (e) => { const p = shapes.get(e.target as Element); if (!p) return; e.preventDefault(); const [x, y] = point(e); start(e.pointerId, p, ...along(p, x, y), force(e)) })
  svg.addEventListener('pointermove', (e) => {
    const d = down.get(e.pointerId)
    if (!d && !(e.buttons || e.pointerType === 'touch')) return
    const [x, y] = point(e), p = under(e)
    // A finger drawn from one part to the next lets go of the one and sounds the other: across strings, that is a strum.
    if (p && p !== d?.part && !p.chord && (d || e.buttons || e.pointerType === 'touch')) { stop(e.pointerId); start(e.pointerId, p, ...along(p, x, y), force(e)) }
    else if (d) move(e.pointerId, ...along(d.part, x, y))
  })
  const up = (e: PointerEvent) => stop(e.pointerId)
  svg.addEventListener('pointerup', up); svg.addEventListener('pointercancel', up); svg.addEventListener('pointerleave', up)
  const byKey = new Map(ui.parts.filter((p) => p.key).map((p) => [p.key!, p]))

  return {
    /** A key went down or came up. True if it is one of the instrument's. */
    key(code: string, pressed: boolean) {
      const p = byKey.get(code)
      if (!p) return false
      if (pressed) { if (!down.has(code)) start(code, p) } else stop(code)
      return true
    },
    /** The keys it uses, for whoever must watch them come up. */
    keys: [...byKey.keys()],
    get sounding() { return down.size },
    get played() { return played },
    close() { for (const who of [...down.keys()]) stop(who); svg.remove(); voice.hush(BUS.play); voice.set(SET.music, 1); voice.flush() },
  }
}
