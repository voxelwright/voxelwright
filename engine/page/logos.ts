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
const IN = 'M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z'
const GLITCH = 'M11.571 4.714h1.715v5.143H11.57zm4.715 0H18v5.143h-1.714zM6 0L1.714 4.286v15.428h5.143V24l4.286-4.286h3.428L22.286 12V0zm14.571 11.143l-3.428 3.428h-3.429l-3 3v-3H6.857V1.714h13.714Z'
const GLITCH_FACE = 'M6.857 1.714h13.714v9.429l-3.428 3.428h-3.429l-3 3v-3H6.857z'

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
  },
  // Its mark alone: the purple outline with its white face, and a keyline of its own deep purple round it (the
  // outline is thin, and on a pale tower or the sky the white face had no edge).
  twitch: {
    name: 'Twitch', wide: 0.94,
    draw: (pen, w, h) => {
      const side = h * 0.93, x = (w - side) / 2, y = (h - side) / 2
      pen.save(); pen.translate(x, y); pen.scale(side / 24, side / 24)
      pen.lineJoin = 'round'; pen.lineWidth = 1.5; pen.strokeStyle = '#2b0a66'
      pen.stroke(new Path2D('M6 0L1.714 4.286v15.428h5.143V24l4.286-4.286h3.428L22.286 12V0z'))
      pen.restore()
      glyph(pen, GLITCH_FACE, '#ffffff', x, y, side); glyph(pen, GLITCH, '#9146ff', x, y, side)
    },
  },
}

/**
 * A mark as the sign a tower carries, on a picture that is clear wherever the sign is not. `legs` more rows under it
 * are a roof sign's frame (boards.ts `mount: 'roof'`): a steel beam under the sign and legs braced to one another, as
 * a roof carries letters taller than a storey. The legs stand under its middle (no wider than twice its height: a
 * wordmark is wider than its tower, and its ends are carried by the beam). Dark, so that it is no part of the mark and is not lit by night.
 */
export function sign(pen: Pen, mark: Mark, w: number, h: number, legs = 0): void {
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
  mark.draw(pen, w, h)
}
