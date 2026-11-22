// The signs of the networks the realm's logos show (#450, boards.ts `logo`): each as a company wears its own on its
// head office, the mark or the wordmark alone, cut out, with no plate behind it. (A mark in its rounded square is an
// app's icon, and on a tower it read as one pasted there.) The glyph outlines are the ones Simple Icons publishes
// (CC0); the marks themselves are their owners' trademarks, shown here only as the sign of a link to the owner's own
// page on that network.
type Pen = OffscreenCanvasRenderingContext2D
export interface Mark {
  /** What a person would call it. */
  name: string
  /** How wide the sign is for its height. */
  wide: number
  /** Draws it over the whole of a picture `w` by `h`, clear wherever the sign is not. */
  draw(pen: Pen, w: number, h: number): void
  /**
   * It as pixel art, for a picture too few pixels big for `draw` (`art`): its glyph on Simple Icons' square of 24,
   * where that square lies in a picture `w` by `h` (as `draw` lays it), the edges of its stems across and up (each
   * is put on a pixel's edge, and none of the spans between them is under a pixel), and the glyph in flat colours
   * (with what is too fine for a small square, from `finer` px).
   */
  pixels: { square(w: number, h: number): [number, number, number]; across: number[]; up: number[]; paint(pen: Pen, fine: boolean): void; /** From how many px its square is drawn finer (`paint`'s `fine`). */ finer?: number; halo?: string }
}

/** A glyph drawn on Simple Icons' square of 24, into a box of the picture. */
const glyph = (pen: Pen, path: string, ink: string, x: number, y: number, side: number) => {
  pen.save()
  pen.translate(x, y)
  pen.scale(side / 24, side / 24)
  pen.fillStyle = ink
  pen.fill(new Path2D(path))
  pen.restore()
}
const X = 'M18.901 1.153h3.68l-8.04 9.19L24 22.846h-7.406l-5.8-7.584-6.638 7.584H.474l8.6-9.83L0 1.154h7.594l5.243 6.932ZM17.61 20.644h2.039L6.486 3.24H4.298Z'
const X_SOLID = X.slice(0, X.indexOf('Z') + 1), X_HAIRLINE = X.slice(X.indexOf('Z') + 1)
const IN = 'M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z'
const GLITCH = 'M11.571 4.714h1.715v5.143H11.57zm4.715 0H18v5.143h-1.714zM6 0L1.714 4.286v15.428h5.143V24l4.286-4.286h3.428L22.286 12V0zm14.571 11.143l-3.428 3.428h-3.429l-3 3v-3H6.857V1.714h13.714Z'
const GLITCH_FACE = 'M6.857 1.714h13.714v9.429l-3.428 3.428h-3.429l-3 3v-3H6.857z'
const GLITCH_OUTER = 'M6 0L1.714 4.286v15.428h5.143V24l4.286-4.286h3.428L22.286 12V0z'

export const MARKS: Record<string, Mark> = {
  // Its mark alone, as halo-lit letters are made: a near-black face with light round its edge, so that it reads on a
  // pale tower by day and by its edge at night. (All white, it was lost on the grey of the tower it is on.)
  x: {
    name: 'X', wide: 1,
    draw: (pen, w, h) => {
      const side = h * 0.9
      pen.save()
      pen.translate((w - side) / 2, (h - side) / 2)
      pen.scale(side / 24, side / 24)
      const path = new Path2D(X)
      pen.lineJoin = 'round'; pen.lineWidth = 2.4; pen.strokeStyle = '#ffffff'
      pen.stroke(path)
      pen.fillStyle = '#0d0d0d'
      pen.fill(path)
      pen.restore()
    },
    // (The hairline of light inside its broad stroke, as its halo lights it; under 28 px that is under a pixel, and
    // the stroke is solid. Its halo is a pixel round it.)
    pixels: { square: (w, h) => [(w - h * 0.9) / 2, (h - h * 0.9) / 2, h * 0.9], across: [0, 24], up: [1.153, 22.846], finer: 22, halo: '#ffffff', paint: (pen, fine) => { pen.fillStyle = '#0d0d0d'; pen.fill(new Path2D(X_SOLID)); if (fine) { pen.fillStyle = '#ffffff'; pen.fill(new Path2D(X_HAIRLINE)) } } },
  },
  // Its mark: the white "in" in its blue square, as the top of its offices carries it. (Its wordmark was tried, #450:
  // "Linked" beside the square is 3.7 times as wide as it is tall, so tall enough to be read from the park it was
  // 96 m wide on a tower 63 m wide and hung over both sides; cut to the roof its letters were 15 px.) A keyline of
  // the blue's own navy runs round the square: on the night sky the blue alone had no edge.
  linkedin: {
    name: 'LinkedIn', wide: 1,
    draw: (pen, w, h) => {
      const line = h * 0.04, edge = line / 2, box = Math.min(w, h) - 2 * edge, x = (w - box) / 2
      pen.lineJoin = 'round'; pen.lineWidth = line; pen.strokeStyle = '#04294f'
      pen.beginPath(); pen.roundRect(x, edge, box, box, box * 0.09); pen.stroke()
      pen.fillStyle = '#ffffff'
      pen.fillRect(x + box * 0.07, edge + box * 0.07, box * 0.86, box * 0.86)
      glyph(pen, IN, '#0a66c2', x, edge, box)
    },
    // (Its stems: the i's, the n's two, its dot apart from its stem.)
    pixels: {
      square: (w, h) => { const edge = h * 0.02, box = Math.min(w, h) - 2 * edge; return [(w - box) / 2, edge, box] },
      across: [0, 3.555, 7.119, 9.351, 12.765, 16.893, 20.447, 24], up: [0, 3.304, 7.432, 9, 20.452, 24],
      paint: (pen) => { pen.fillStyle = '#ffffff'; pen.fillRect(1.68, 1.68, 20.64, 20.64); pen.fillStyle = '#0a66c2'; pen.fill(new Path2D(IN)) },
    },
  },
  // Its mark alone: the purple outline with its white face, and a keyline of its own deep purple round it (the
  // outline is thin, and on a pale tower or the sky the white face had no edge).
  twitch: {
    name: 'Twitch', wide: 0.94,
    draw: (pen, w, h) => {
      const side = h * 0.93, x = (w - side) / 2, y = (h - side) / 2
      pen.save(); pen.translate(x, y); pen.scale(side / 24, side / 24)
      pen.lineJoin = 'round'; pen.lineWidth = 1.5; pen.strokeStyle = '#2b0a66'
      pen.stroke(new Path2D(GLITCH_OUTER))
      pen.restore()
      glyph(pen, GLITCH_FACE, '#ffffff', x, y, side); glyph(pen, GLITCH, '#9146ff', x, y, side)
    },
    // (Its stems: its outline's, its face's, each eye's.)
    pixels: {
      square: (w, h) => [(w - h * 0.93) / 2, (h - h * 0.93) / 2, h * 0.93],
      across: [1.714, 6.857, 11.571, 13.286, 16.286, 18, 20.571, 22.286], up: [0, 1.714, 4.714, 9.857, 14.571, 19.714, 24],
      paint: (pen) => { pen.fillStyle = '#9146ff'; pen.fill(new Path2D(GLITCH_OUTER)); pen.fillStyle = '#ffffff'; pen.fill(new Path2D(GLITCH_FACE)); pen.fillStyle = '#9146ff'; pen.fillRect(11.571, 4.714, 1.715, 5.143); pen.fillRect(16.286, 4.714, 1.714, 5.143) },
    },
  },
}

/** How finely a glyph is drawn to be read as pixel art: pixels a unit of its square of 24. */
const FINE = 20
const glyphs = new Map<string, Uint8ClampedArray>()
/** Its glyph in flat colours as its pixel art at `side` px draws it, FINE pixels a unit (drawn once). */
const glyphOf = (mark: Mark, side: number) => {
  const fine = side >= (mark.pixels.finer ?? 0), key = `${mark.name}${fine ? ' fine' : ''}`
  let got = glyphs.get(key)
  if (!got) {
    const paper = new OffscreenCanvas(24 * FINE, 24 * FINE), pen = paper.getContext('2d')!
    pen.scale(FINE, FINE); mark.pixels.paint(pen, fine)
    glyphs.set(key, (got = pen.getImageData(0, 0, 24 * FINE, 24 * FINE).data))
  }
  return got
}

/**
 * A mark as pixel art on a picture `w` by `h`, as a font is hinted for a small size: the edges of its stems on pixels'
 * edges, no stem and no gap under a pixel, each pixel one colour of its glyph (the one at its middle) and none a blur
 * of two. Twitch keeps its eyes, the X its two strokes and the "in" its three at 9 px. (The keylines are left out:
 * at the sizes it is drawn for they are under a pixel.) `w` by `h` may be narrower or wider than its mark: seen from
 * one side, or from under.
 */
export function art(pen: Pen, mark: Mark, w: number, h: number): void {
  // Seen from one side or from under it is narrower or wider for its height than its mark (`squeeze`): its square
  // narrowed or widened so, and not after.
  // A mark with a halo keeps a pixel clear all round for it.
  const squeeze = w / (h * mark.wide), clear = mark.pixels.halo ? 1 : 0
  const [sx, sy, side] = mark.pixels.square((w - 2 * clear) / squeeze, h - 2 * clear), x0 = clear + sx * squeeze, y0 = clear + sy, unit = side / 24
  // Each edge on a pixel's edge: as far past the one before as the span between them is wide, rounded, while that
  // keeps it within 0.75 px of where it is (a stem 1.8 px wide is 2, not 1 as rounding each edge alone may make it),
  // else the nearest; at least a pixel past the one before it, and none past the picture's own edge (`most`): a mark
  // too small for a pixel each (Twitch under 7 px, LinkedIn under 9) runs out of room at its far side.
  const snap = (keys: number[], at: number, unit: number, most: number) => {
    const to: number[] = []
    keys.forEach((k, i) => {
      const where = at + k * unit, kept = i ? to[i - 1] + Math.round((k - keys[i - 1]) * unit) : Math.round(where)
      to.push(Math.max(Math.abs(kept - where) <= 0.75 ? kept : Math.round(where), i ? to[i - 1] + 1 : -Infinity))
    })
    for (let i = to.length - 1; i >= 0; i--) to[i] = Math.min(to[i], i === to.length - 1 ? most : to[i + 1] - 1)
    return to
  }
  // Between the edges, and past them, in proportion.
  const back = (p: number, keys: number[], to: number[], unit: number) => {
    if (p < to[0] || to.length < 2) return keys[0] + (p - to[0]) / unit
    for (let i = 1; i < to.length; i++) if (p < to[i]) return keys[i - 1] + ((p - to[i - 1]) / Math.max(1, to[i] - to[i - 1])) * (keys[i] - keys[i - 1])
    return keys[keys.length - 1] + (p - to[to.length - 1]) / unit
  }
  const { across, up } = mark.pixels, ax = snap(across, x0, unit * squeeze, w - clear), ay = snap(up, y0, unit, h - clear)
  const flat = glyphOf(mark, side)
  const picture = pen.createImageData(w, h), d = picture.data, us = Array.from({ length: w }, (_, i) => Math.floor(back(i + 0.5, across, ax, unit * squeeze) * FINE))
  for (let j = 0; j < h; j++) {
    const v = Math.floor(back(j + 0.5, up, ay, unit) * FINE)
    if (v < 0 || v >= 24 * FINE) continue
    for (let i = 0; i < w; i++) { const u = us[i]; if (u < 0 || u >= 24 * FINE) continue; const k = (v * 24 * FINE + u) * 4; if (flat[k + 3] >= 128) d.set([flat[k], flat[k + 1], flat[k + 2], 255], (j * w + i) * 4) }
  }
  if (mark.pixels.halo) {
    const c = [1, 3, 5].map((n) => parseInt(mark.pixels.halo!.slice(n, n + 2), 16)), ink = (i: number, j: number) => i >= 0 && j >= 0 && i < w && j < h && d[(j * w + i) * 4 + 3] === 255 && d[(j * w + i) * 4] !== c[0]
    const ring: number[] = []
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) if (d[(j * w + i) * 4 + 3] === 0 && (ink(i - 1, j) || ink(i + 1, j) || ink(i, j - 1) || ink(i, j + 1))) ring.push(j * w + i)
    for (const k of ring) d.set([...c, 255], k * 4)
  }
  pen.putImageData(picture, 0, 0)
}

/**
 * A mark as the sign a tower carries, on a picture that is clear wherever the sign is not. `legs` more rows under it
 * are a roof sign's frame (boards.ts `mount: 'roof'`): a steel beam under the sign and legs braced to one another, as
 * a roof carries letters taller than a storey. The legs stand under its middle (no wider than twice its height: a
 * wordmark is wider than its tower, and its ends are carried by the beam). Dark, so that it is no part of the mark and is not lit by night.
 */
export function sign(pen: Pen, mark: Mark, w: number, h: number, legs = 0, seen?: readonly [number, number]): void {
  pen.clearRect(0, 0, w, h + legs)
  if (legs > 0) {
    const steel = '#23272e', beam = Math.max(4, h * 0.035), post = Math.max(4, h * 0.03), span = Math.min(w * 0.84, h * 1.9), bays = Math.max(1, Math.round(span / h / 0.9)), inset = (w - span) / 2
    pen.fillStyle = steel; pen.strokeStyle = steel; pen.lineWidth = post * 0.6
    pen.fillRect(inset - post, h - beam * 0.5, w - 2 * (inset - post), beam)
    for (let i = 0; i <= bays; i++) {
      const x = inset + ((w - 2 * inset) * i) / bays
      pen.fillRect(x - post / 2, h, post, legs)
      if (i < bays) { const next = inset + ((w - 2 * inset) * (i + 1)) / bays, foot = h + Math.min(legs, h * 0.16); pen.beginPath(); pen.moveTo(x, h + beam * 0.5); pen.lineTo(next, foot); pen.moveTo(next, h + beam * 0.5); pen.lineTo(x, foot); pen.stroke() }
    }
  }
  if (!seen || (seen[0] >= w && seen[1] >= h)) return mark.draw(pen, w, h)
  // Seen smaller than it is drawn either way (`seen`: how many pixels of the picture on screen it covers, across and up): drawn
  // at that many, whole pixels down, and each of its pixels laid over its share of this picture whole (no smoothing),
  // so that the picture is sampled about once a pixel of it and every pixel shown is a pixel of the mark at that size.
  // Drawn at its own size and sampled 10 to 25 times over, a pixel shown was one point of it, and Twitch's eyes, the
  // X's strokes and the "in" fell between the points (#450, ~/.village/engine/sf/logos). Under ART pixels tall, as
  // pixel art (`art`); over, its own lines, smoothed.
  const up = Math.max(1, Math.min(h, Math.floor(seen[1]))), across = Math.max(1, Math.min(w, Math.floor(seen[0]))), small = new OffscreenCanvas(across, up), drawn = small.getContext('2d')!
  if (up < ART) art(drawn, mark, across, up)
  else { drawn.scale(across / w, up / h); mark.draw(drawn, w, h) }
  pen.save(); pen.imageSmoothingEnabled = false; pen.drawImage(small, 0, 0, w, h); pen.restore()
}
/** How many pixels tall a mark is seen at, at most, to be drawn as pixel art (`art`). */
const ART = 64
