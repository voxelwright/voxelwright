// The realm's type (#450): the one place that picks which of the kit's faces (engine/kit) its words are set in.
// A face is a pair, both drawn on the same grid of cells:
//   lettering   a glyph set the lettering boards are built from, a cell of it a square of the world's cells (boards.ts)
//   legend      the key set laid flat as a web font, for what is written on a key (the kit's --vx-key-font)
//
//   ?face=zakon   Vox Zakon and Vox Zakon Text (the default)
//   ?face=block   Vox Block and Vox Text
//
// Only the chosen face is fetched: its glyph set by address (as realm-ui.ts asks for the kit), its web font by the
// kit's stylesheet when a key is first drawn in it.

/** A glyph of a kit glyph set (kit/src/core/fonts/index.js): its rows of cells, '#' for ink, from row `y` (0 the cap line). */
export interface Glyph { ch: string; y: number; w: number; rows: string[] }
/** A kit glyph set, as much of it as the realm reads. */
export interface GlyphSet { id: string; name: string; cap: number; descent: number; upper: boolean; glyphs: Record<string, Glyph> }
export interface Lettering {
  set: GlyphSet
  /** Which of the face's two sets it is. */
  size: Size
  /** A line laid out: each glyph and where it starts, in cells; top and bottom from the cap line. */
  layout(text: string): { glyphs: { g: Glyph; x: number }[]; width: number; top: number; bottom: number }
  /** A glyph's cells at `scale` world cells a cell, diagonals redrawn as stairs: [x, y] from its left edge and the cap line, y down. */
  voxels(g: Glyph, scale: number): [number, number][]
}

export const FACES = {
  zakon: { name: 'Vox Zakon', display: { at: '../kit/src/core/fonts/zakon.js', set: 'zakon' }, compact: { at: '../kit/src/core/fonts/zakon-text.js', set: 'zakoncaps' }, legend: '"Vox Zakon Text"' },
  block: { name: 'Vox Block', display: { at: '../kit/src/core/fonts/block.js', set: 'block' }, compact: { at: '../kit/src/core/fonts/sign.js', set: 'sign' }, legend: '"Vox Text"' },
} as const
export type FaceName = keyof typeof FACES
export const DEFAULT_FACE: FaceName = 'zakon'
/** A face's two sizes of lettering: its display set (capitals 11 cells tall), and its compact set (7) for where the display set's cells would be finer than the world draws them. */
export type Size = 'display' | 'compact'
/** How many cells tall a capital of each face's display set is (Vox Zakon's and Vox Block's alike), for choosing a size before either is fetched. */
export const DISPLAY_CAP = 11

const query = new URLSearchParams(location.search), asked = query.get('face')
const known = asked !== null && Object.hasOwn(FACES, asked)
if (asked !== null && !known) console.error(`?face=${asked} is no face of the realm's: ${Object.keys(FACES).join(' or ')}. Set in ${FACES[DEFAULT_FACE].name}.`)
/** The face the realm is set in. */
export const face: FaceName = known ? (asked as FaceName) : DEFAULT_FACE
/** A size of lettering asked for by the page's address (`?letters=display|compact`), for looking at one where the other would be chosen. */
export const lettersAsked: Size | null = ((v) => (v === 'display' || v === 'compact' ? v : null))(query.get('letters'))

const loading = new Map<Size, Promise<Lettering>>()
/** The chosen face's lettering in one of its sizes, fetched once. */
export function lettering(size: Size = 'display'): Promise<Lettering> {
  let got = loading.get(size)
  if (!got) loading.set(size, (got = (async () => {
    const chosen = FACES[face][size]
    const [fonts, module] = await Promise.all([import(new URL('../kit/src/core/fonts/index.js', import.meta.url).href), import(new URL(chosen.at, import.meta.url).href)])
    const set = module[chosen.set] as GlyphSet
    if (!set?.glyphs) throw new Error(`${chosen.at} has no glyph set "${chosen.set}"`)
    return { set, size, layout: (text: string) => fonts.layout(set, text), voxels: (g: Glyph, scale: number) => fonts.voxels(g, scale, true) }
  })()))
  // (One that did not come is asked for again the next time, not kept as failed.)
  got.catch(() => loading.delete(size))
  return got
}

/**
 * Both key fonts are cells, ten to the em, and read cleanly where a cell is whole pixels of the screen. The kit's own
 * size (five voxels, 20 px: a cell is 2 px) is that on screens of one, two and three pixels to one. A smaller key's
 * words take `--vx-key-small`, a size whose cell is whole pixels on those: 15 px (3 pixels a cell) on a screen of two
 * pixels to one, 13.3 px (4) on one of three, and 10 px (1) on one of one, where 15 px would blur. (Between them, at
 * 1.5 or 2.625, a cell is a fraction of a pixel whatever the size.)
 */
const SIZES = /* css */ `
:root { --vx-key-small: 10px; }
@media (min-resolution: 2dppx) { :root { --vx-key-small: 15px; } }
@media (min-resolution: 3dppx) { :root { --vx-key-small: calc(40px / 3); } }
`
/** Sets the words on the kit's keys in the chosen face, on the whole page: the realm's keys and the first view's. */
export function legends(): void {
  const html = document.documentElement
  if (html.dataset.face) return
  html.style.setProperty('--vx-key-font', `${FACES[face].legend}, var(--vx-font)`)
  html.dataset.face = face
  const style = document.createElement('style')
  style.textContent = SIZES
  document.head.append(style)
}
