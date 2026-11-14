// What a figure wears and carries (#218, for #264), as data. A look is what was chosen for a
// figure in place of what its own number gives: colours and build, things worn by name (a suit,
// a tie, dark glasses, a hat, a uniform, a helmet, gloves), something in the hand, and boxes of
// anyone's own on any part of the body, for what nobody foresaw. The things with names below are
// no more than boxes written down. Read by the page, and by the world's process, which checks
// what a rule sends.
import { chance } from './residents.ts'

/** The parts of a body a box can be on: it turns with that part. The hands' boxes are told from the hand, with -y along the forearm and out past the fingers. */
export const PARTS = ['head', 'chest', 'hip', 'handR', 'handL'] as const
/** And one only the engine gives (held.ts): the right hand gripping a thing picked up. Its boxes are told from the fist with -z up out of it, and a figure that has any bends that elbow so the forearm lies level. No rule's look may name it. */
export type Part = (typeof PARTS)[number] | 'gripR'
/** A box on a part: where its middle is from the part's own origin and how big it is (cells: 10 cm), and its colour: "#rrggbb", or one of the figure's own (coat, legs, skin, hair, shoes), or "own" for the colour given with the thing's name. */
export interface Extra { on: Part; at: [number, number, number]; size: [number, number, number]; colour: string; shiny?: boolean; /** Only on the things with names here, never from a rule: the box is a shape (people.ts `shape`): how round across, how narrow at the top and the bottom, how far each end is rounded off. */ form?: readonly [number, number, number, number, number] }
/** A thing with a name: its boxes, the colour "own" means unless one is given, and what it changes of the figure itself. */
interface Thing { boxes: Extra[]; own?: string; set?: { long?: boolean; legs?: 'coat'; hands?: 'own'; hair?: 'bald' | 'short' | 'long'; plain?: boolean; /** A jacket cut as a suit's is: lapels, a hem, buttons. */ lapels?: boolean } }

export interface Look {
  coat?: string; legs?: string; hair?: string; skin?: string; shoes?: string
  tall?: number; broad?: number
  /** Things worn, by name, each with a colour of its own if it is given one: "tie", "tie #7a1c1c". */
  wear?: string[]
  /** What is in the right hand: a name, or boxes of one's own (told from the hand). */
  carry?: string | Extra[]
  /** Boxes of one's own, anywhere on the body. */
  extra?: Extra[]
}

/** The colours a figure's own number picks from. What real people wear in a town in autumn: dark and muted, with now and then a colour. Skin is given darker than it is: in full sun a pale face came out as white paper. */
export const OWN = {
  coats: ['#2b2d33', '#1f2a3d', '#3b3f45', '#5a4632', '#8a6a44', '#4a5240', '#6b2f2c', '#56585c', '#23262b', '#3a4a5c', '#7a7468', '#2f4a44', '#b9b2a2', '#a8452f', '#c9a23a', '#8fa3b5', '#d8d4c8'],
  legs: ['#22242a', '#2c3444', '#1b1c20', '#4b4a44', '#3a3128', '#59605f', '#8a8272', '#3f5878'],
  skins: ['#c9a084', '#bd8f6e', '#a87552', '#8a5a3a', '#684228', '#4a2e1e'],
  hairs: ['#17130f', '#2e2016', '#4a3222', '#7a5a34', '#b0926a', '#8a8a88', '#c8c6c0', '#5c2a18'],
  bright: ['#b8862a', '#a03a2e', '#2a6f78', '#c2bfb4', '#44608c', '#7c8a3a'],
  shoes: ['#141416', '#2a1d14', '#3c3c3e', '#d8d6d0'],
}
const own = (from: readonly string[], seed: number, ask: number) => from[Math.floor(chance(seed, ask) * from.length)]

/**
 * What a figure looks like by its own number alone (people.ts `figure` picks the same): its colours, what it has on
 * by the names things have, and its build against the usual. For telling a rule what a resident looks like: a look
 * made of these, with something added, is the same person with that added.
 */
export function ownLook(seed: number): { look: Look; tall: number; broad: number } {
  const bright = own(OWN.bright, seed, 8), hair = Math.floor(chance(seed, 10) * 5), bag = Math.floor(chance(seed, 12) * 4)
  const wear = [chance(seed, 9) < 0.45 ? 'coat' : 'jacket', hair === 0 ? `beanie ${bright}` : hair >= 3 ? 'long-hair' : 'short-hair']
  if (chance(seed, 11) < 0.3) wear.push(`scarf ${bright}`)
  if (bag === 1) wear.push(`pack ${own(OWN.legs, seed, 13)}`)
  else if (bag === 2) wear.push(`satchel ${own(OWN.bright, seed, 14)}`)
  return { look: { coat: own(OWN.coats, seed, 3), legs: own(OWN.legs, seed, 4), skin: own(OWN.skins, seed, 5), hair: own(OWN.hairs, seed, 6), shoes: own(OWN.shoes, seed, 7), wear }, tall: Number((0.93 + 0.12 * chance(seed, 1)).toFixed(3)), broad: Number((0.9 + 0.22 * chance(seed, 2)).toFixed(3)) }
}

const box = (on: Part, at: [number, number, number], size: [number, number, number], colour = 'own', shiny = false, form?: Extra['form']): Extra => ({ on, at, size, colour, shiny, ...(form ? { form } : {}) })
/** Shapes: a dome, a round slab, a soft box. */
const DOME = [3, 1, 1, 0.8, 0] as const, DISC = [2.5, 1, 1, 0, 0] as const, SOFT = [4, 1, 1, 0, 0] as const
/** A head is 1.75 wide, its face at z -1.05, its crown at y 2.9, eyes at y 1.95. A chest's front is at z -1.13, shoulders at y 4.9. */
export const WORN: Record<string, Thing> = {
  glasses: { own: '#0b0b0d', boxes: [box('head', [0.48, 1.95, -1.12], [0.75, 0.45, 0.14], 'own', true), box('head', [-0.48, 1.95, -1.12], [0.75, 0.45, 0.14], 'own', true), box('head', [0, 2.05, -1.12], [0.3, 0.12, 0.12], 'own', true), box('head', [0.95, 2.02, -0.45], [0.1, 0.14, 1.3], 'own', true), box('head', [-0.95, 2.02, -0.45], [0.1, 0.14, 1.3], 'own', true)] },
  hat: { own: '#2a2622', boxes: [box('head', [0, 2.95, 0], [3.25, 0.25, 3.25], 'own', false, DISC), box('head', [0, 3.5, 0], [2.25, 1, 2.25], 'own', false, [3, 0.88, 1, 0.3, 0]), box('head', [0, 3.2, 0], [2.3, 0.3, 2.3], '#141416', false, [3, 1, 1, 0, 0])] },
  cap: { own: '#1f2a3d', boxes: [box('head', [0, 2.8, 0.05], [2, 0.75, 2.25], 'own', false, DOME), box('head', [0, 2.52, -1.5], [1.75, 0.16, 1], 'own', false, DISC)] },
  beanie: { own: '#a03a2e', boxes: [box('head', [0, 2.75, 0.02], [2, 1, 2.25], 'own', false, DOME), box('head', [0, 2.5, 0.02], [2.25, 0.5, 2.5], 'own', false, [3.2, 1, 1, 0, 0])] },
  helmet: { own: '#4a5240', boxes: [box('head', [0, 2.8, 0.08], [2.5, 1.25, 2.5], 'own', true, DOME), box('head', [0, 2.05, 0.5], [2.5, 0.75, 1.75], 'own', true, SOFT)] },
  mask: { own: '#d8dde0', boxes: [box('head', [0, 1.2, -1.08], [1.6, 0.95, 0.14])] },
  shirt: { own: '#e2dfd6', boxes: [box('chest', [0, 4.15, -1.17], [1.35, 1.5, 0.1])] },
  tie: { own: '#7a1c1c', boxes: [box('chest', [0, 4.55, -1.24], [0.6, 0.5, 0.14]), box('chest', [0, 3.2, -1.22], [0.5, 2.3, 0.1])] },
  suit: { own: '#e2dfd6', set: { long: false, legs: 'coat', plain: true, lapels: true }, boxes: [box('chest', [0, 4.15, -1.17], [1.35, 1.5, 0.1])] },
  uniform: { own: '#17191c', set: { long: false, legs: 'coat', plain: true }, boxes: [box('hip', [0, 1.3, 0], [3.9, 0.5, 2.3], 'own', true), box('chest', [1.95, 5.0, 0], [1.2, 0.16, 1.5]), box('chest', [-1.95, 5.0, 0], [1.2, 0.16, 1.5])] },
  coat: { set: { long: true }, boxes: [] },
  jacket: { set: { long: false }, boxes: [] },
  plain: { set: { plain: true }, boxes: [] },
  gloves: { own: '#141416', set: { hands: 'own' }, boxes: [] },
  scarf: { own: '#b8862a', boxes: [box('chest', [0, 5.1, -0.05], [2.5, 1, 2.5], 'own', false, [3, 1, 1, 0.4, 0.4]), box('chest', [0.6, 3.75, -1.3], [0.75, 2.4, 0.3])] },
  pack: { own: '#3a3128', boxes: [box('chest', [0, 2.6, 1.85], [2.75, 3.75, 1.5], 'own', false, [4, 0.9, 1, 0.25, 0.1]), box('chest', [1.15, 3.3, -1.2], [0.4, 3.2, 0.1]), box('chest', [-1.15, 3.3, -1.2], [0.4, 3.2, 0.1])] },
  satchel: { own: '#b8862a', boxes: [box('hip', [2.1, 0.2, 0.1], [0.9, 2.5, 3], 'own', true)] },
  apron: { own: '#e2dfd6', boxes: [box('chest', [0, 2.0, -1.2], [3.0, 3.7, 0.12]), box('hip', [0, -0.7, -1.12], [3.0, 2.7, 0.12])] },
  vest: { own: '#c8d42a', boxes: [box('chest', [0, 2.5, 0], [4, 3.75, 2.5], 'own', false, SOFT), box('chest', [0, 2.2, 0], [4.1, 0.4, 2.6], '#c8ccd0', false, SOFT)] },
  badge: { own: '#c9a23a', boxes: [box('chest', [1.0, 3.9, -1.18], [0.6, 0.7, 0.1], 'own', true)] },
  bald: { set: { hair: 'bald' }, boxes: [] },
  'short-hair': { set: { hair: 'short' }, boxes: [] },
  'long-hair': { set: { hair: 'long' }, boxes: [] },
}
/** Things for the right hand. A long thing lies along the forearm and out past the hand, so an arm that aims, aims it. */
export const CARRIED: Record<string, Thing> = {
  pistol: { own: '#141416', boxes: [box('handR', [0, -1.35, -0.35], [0.45, 2.1, 0.6], 'own', true), box('handR', [0, -0.3, 0.2], [0.45, 0.95, 0.55], 'own', true)] },
  rifle: { own: '#1c1a18', boxes: [box('handR', [0, -2.2, -0.4], [0.5, 7.2, 0.7], 'own', true), box('handR', [0, 2.3, -0.1], [0.55, 2.6, 1.1], '#4a3222')] },
  bat: { own: '#8a6a44', boxes: [box('handR', [0, -3.9, 0], [0.55, 7.5, 0.55])] },
  sword: { own: '#c8ccd0', boxes: [box('handR', [0, -4.6, 0], [0.16, 7.6, 0.65], 'own', true), box('handR', [0, -0.7, 0], [0.3, 0.3, 1.7], '#3a3128', true)] },
  cup: { own: '#e2dfd6', boxes: [box('handR', [0, -0.3, -0.65], [0.8, 1.1, 0.8])] },
  phone: { own: '#141416', boxes: [box('handR', [0, -0.4, -0.5], [0.75, 1.5, 0.2], 'own', true)] },
  book: { own: '#6b2f2c', boxes: [box('handR', [0, -0.5, -0.6], [1.3, 1.7, 0.35])] },
  case: { own: '#3a3128', boxes: [box('handR', [0, -2.3, 0], [0.8, 2.4, 3.2], 'own', true)] },
  bag: { own: '#b9b2a2', boxes: [box('handR', [0, -2.1, 0], [1.1, 2.3, 2.5])] },
  torch: { own: '#2a2622', boxes: [box('handR', [0, -1.0, -0.3], [0.5, 1.8, 0.5], 'own', true), box('handR', [0, -2.0, -0.3], [0.7, 0.3, 0.7], '#ffe2a8', true)] },
}

const COLOUR = /^#[0-9a-f]{6}$/, NAMED = /^([a-z-]{1,16})(?: (#[0-9a-f]{6}))?$/, ROLES = ['own', 'coat', 'legs', 'skin', 'hair', 'shoes']
/** The most things worn by name, and the most boxes of one's own. */
export const WEAR_MOST = 8, EXTRA_MOST = 12
const three = (a: unknown, lo: number, hi: number): [number, number, number] | null => (Array.isArray(a) && a.length === 3 && a.every((v) => typeof v === 'number' && Number.isFinite(v)) ? (a.map((v) => Math.max(lo, Math.min(hi, v))) as [number, number, number]) : null)
function boxes(from: unknown, most: number, hand: boolean): Extra[] {
  const out: Extra[] = []
  for (const b of Array.isArray(from) ? from.slice(0, most) : []) {
    if (!b || typeof b !== 'object') continue
    const e = b as Extra, on = hand ? 'handR' : (PARTS as readonly string[]).includes(e.on) ? e.on : null, at = three(e.at, -14, 14), size = three(e.size, 0.1, 14)
    const colour = typeof e.colour === 'string' && (COLOUR.test(e.colour.toLowerCase()) || ROLES.includes(e.colour)) ? e.colour.toLowerCase() : null
    if (on && at && size && colour) out.push({ on, at, size, colour, shiny: e.shiny === true })
  }
  return out
}

/** A look as a figure may be given it, from what someone sent; or nothing, if nothing of it holds. Read as from a stranger. */
export function lookOf(from: unknown): Look | undefined {
  if (!from || typeof from !== 'object') return undefined
  const f = from as Record<string, unknown>, look: Look = {}
  for (const k of ['coat', 'legs', 'hair', 'skin', 'shoes'] as const) { const v = f[k]; if (typeof v === 'string' && COLOUR.test(v.toLowerCase())) look[k] = v.toLowerCase() }
  for (const k of ['tall', 'broad'] as const) { const v = f[k]; if (typeof v === 'number' && Number.isFinite(v)) look[k] = Math.max(0.8, Math.min(1.2, v)) }
  if (Array.isArray(f.wear)) { const wear = f.wear.filter((w): w is string => typeof w === 'string' && !!NAMED.exec(w) && NAMED.exec(w)![1] in WORN).slice(0, WEAR_MOST); if (wear.length) look.wear = wear }
  if (typeof f.carry === 'string') { const m = NAMED.exec(f.carry); if (m && m[1] in CARRIED) look.carry = f.carry } else if (Array.isArray(f.carry)) { const held = boxes(f.carry, 8, true); if (held.length) look.carry = held }
  const extra = boxes(f.extra, EXTRA_MOST, false)
  if (extra.length) look.extra = extra
  return Object.keys(look).length ? look : undefined
}

/** A thing by its name as it was sent ("tie #7a1c1c"): the thing, and the colour "own" means for it. */
export function named(from: Record<string, Thing>, sent: string): { thing: Thing; own: string } | null {
  const m = NAMED.exec(sent), thing = m ? from[m[1]] : undefined
  return thing ? { thing, own: m![2] ?? thing.own ?? '#2a2622' } : null
}
