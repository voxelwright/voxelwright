// The marks of the networks the realm's logo signs show (#450, boards.ts `logo`): each as its owner draws it, a
// glyph on a 24 by 24 square in the brand's own colours, with what stands behind the glyph where it has holes.
// The glyph outlines are the ones Simple Icons publishes (CC0); the marks themselves are their owners' trademarks,
// shown here only as the sign of a link to the owner's own page on that network.
export interface Mark { /** What a person would call it. */ name: string; glyph: string; ink: string; /** What is behind the glyph: a shape of its own and its colour. */ under?: { shape: string; ink: string }; /** How much of the square the glyph takes, about its middle (1 where not said). */ fills?: number }

export const MARKS: Record<string, Mark> = {
  x: {
    name: 'X', ink: '#ffffff',
    glyph: 'M18.901 1.153h3.68l-8.04 9.19L24 22.846h-7.406l-5.8-7.584-6.638 7.584H.474l8.6-9.83L0 1.154h7.594l5.243 6.932ZM17.61 20.644h2.039L6.486 3.24H4.298Z',
    // (Its mark is white on black: a plate behind it with its corners taken off, and the glyph two thirds of it.)
    under: { shape: 'M2.4 0h19.2a2.4 2.4 0 0 1 2.4 2.4v19.2a2.4 2.4 0 0 1-2.4 2.4H2.4a2.4 2.4 0 0 1-2.4-2.4V2.4a2.4 2.4 0 0 1 2.4-2.4Z', ink: '#000000' }, fills: 0.64,
  },
  linkedin: {
    name: 'LinkedIn', ink: '#0a66c2',
    glyph: 'M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z',
    under: { shape: 'M1.5 1.5h21v21h-21z', ink: '#ffffff' },
  },
  twitch: {
    name: 'Twitch', ink: '#9146ff',
    glyph: 'M11.571 4.714h1.715v5.143H11.57zm4.715 0H18v5.143h-1.714zM6 0L1.714 4.286v15.428h5.143V24l4.286-4.286h3.428L22.286 12V0zm14.571 11.143l-3.428 3.428h-3.429l-3 3v-3H6.857V1.714h13.714Z',
    under: { shape: 'M6.857 1.714h13.714v9.429l-3.428 3.428h-3.429l-3 3v-3H6.857z', ink: '#ffffff' },
  },
}

/** How much of a logo sign's height is the frame it stands on. */
export const LEGS = 0.2

/**
 * A mark as a rooftop sign, on a picture `w` by `h` that is clear wherever the sign is not: the mark over the top of
 * it, and under the mark the dark steel it stands on (two legs and a rail), which is `LEGS` of the whole.
 */
export function sign(pen: OffscreenCanvasRenderingContext2D, mark: Mark, w: number, h: number): void {
  pen.clearRect(0, 0, w, h)
  const top = h * (1 - LEGS), side = Math.min(w, top), x0 = (w - side) / 2, y0 = 0
  pen.fillStyle = '#1b1e24'
  for (const at of [0.3, 0.7]) pen.fillRect(w * at - w * 0.02, y0 + side * 0.6, w * 0.04, h - y0 - side * 0.6)
  pen.fillRect(w * 0.2, h - h * 0.035, w * 0.6, h * 0.035)
  pen.save()
  pen.translate(x0, y0)
  pen.scale(side / 24, side / 24)
  if (mark.under) { pen.fillStyle = mark.under.ink; pen.fill(new Path2D(mark.under.shape)) }
  const f = mark.fills ?? 1
  pen.translate(12 - 12 * f, 12 - 12 * f)
  pen.scale(f, f)
  pen.fillStyle = mark.ink
  pen.fill(new Path2D(mark.glyph))
  pen.restore()
}
