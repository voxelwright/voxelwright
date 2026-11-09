// Where a furnished thing first stands (#42). Pure and trusted: the router proposes
// "where" (the person's words) and "mount" as data, and this decides the pose from
// the room's own measurements. Build mode will move things afterwards; this only
// has to get the first placement right.
import { LIVING_X, TABLE_TOP, WALL_Z, WINDOW } from '../layout'

export const MOUNTS = ['floor', 'surface', 'wall', 'ceiling'] as const
export type Mount = (typeof MOUNTS)[number]

/** Where one piece stands: x, z and y of its base (its back on a wall), facing ry. */
export interface Pose { x: number; y: number; z: number; ry: number; mount: Mount; anchor: string; wall?: boolean }

/** The kitchen table, as table.ts places it. */
export const TABLE = { x: -0.25, z: 0.15 }
/** Free places around the table for a chair, nearest the table's open sides first. */
const AROUND_TABLE: [number, number][] = [[-1.4, 0.2], [-0.75, 1.0], [0.85, 0.85], [-1.25, -0.55]]
/** The ceiling line (room.ts) and the inner face of the left wall. */
export const CEILING = 3.0
const SIDE_X = -3.4 + 0.09
/** The living room (lounge.ts, loungefurnish.ts): its back wall, and the shared wall's living-room face behind the sofa. */
const LX = LIVING_X, LIVING_LEFT = LIVING_X - 3.2

interface Anchor { mount: Mount; x: number; y: number; z: number; ry: number; /** How far along the anchor a piece may slide to stay clear of others. */ span: number; wall?: boolean }
/** Named places, resolved here. The model only ever names them in its words. */
export const ANCHORS: Record<string, Anchor> = {
  floor: { mount: 'floor', x: -1.55, y: 0, z: 1.85, ry: 0.4, span: 0.9 },
  window: { mount: 'floor', x: -0.85, y: 0, z: -1.72, ry: 0, span: 0.6 },
  corner: { mount: 'floor', x: 1.75, y: 0, z: 2.15, ry: -0.6, span: 0.6 },
  table: { mount: 'surface', x: TABLE.x, y: TABLE_TOP, z: TABLE.z, ry: 0, span: 0.42 },
  counter: { mount: 'surface', x: 2.9, y: 0.92, z: WALL_Z + 0.32, ry: 0, span: 0.4 },
  sill: { mount: 'surface', x: (WINDOW.x0 + WINDOW.x1) / 2, y: WINDOW.y0 - 0.005, z: WALL_Z + 0.1, ry: 0, span: 0.55 },
  // The back wall between the window and the cabinets, and the left wall.
  wall: { mount: 'wall', x: 0.9, y: 0, z: WALL_Z + 0.006, ry: 0, span: 0.85, wall: true },
  sideWall: { mount: 'wall', x: SIDE_X, y: 0, z: -0.3, ry: Math.PI / 2, span: 1.4, wall: true },
  ceiling: { mount: 'ceiling', x: 1.3, y: CEILING, z: 0.35, ry: 0, span: 0.8 },
  // The living room, next door through the shared wall.
  livingFloor: { mount: 'floor', x: LX + 0.1, y: 0, z: 0.75, ry: -0.5, span: 0.5 },
  byPlants: { mount: 'floor', x: LX + 0.55, y: 0, z: -0.85, ry: -0.4, span: 0.35 },
  // The sideboard's right end, clear of its lamp and photos.
  livingSurface: { mount: 'surface', x: LX - 0.3, y: 0.8, z: WALL_Z + 0.3, ry: 0, span: 0.12 },
  // The back wall between the bookcase's corner and the sideboard, and the shared wall above the sofa.
  livingWall: { mount: 'wall', x: LX - 2.2, y: 0, z: WALL_Z + 0.006, ry: 0, span: 0.3, wall: true },
  sofaWall: { mount: 'wall', x: LIVING_LEFT + 0.006, y: 0, z: 0.92, ry: Math.PI / 2, span: 0.6, wall: true },
  livingCeiling: { mount: 'ceiling', x: LX - 1.2, y: CEILING, z: 0.9, ry: 0, span: 0.8 },
}

/** Rough sizes by kind (width, height, depth in metres), for the ghost when the router gave none. */
const SIZES: [RegExp, [number, number, number]][] = [
  [/\b(tv|television|telly)\b/, [1.2, 0.7, 0.06]], [/\b(picture|painting|poster|print|frame|mirror)\b/, [0.6, 0.45, 0.03]], [/\bclock\b/, [0.32, 0.32, 0.05]],
  [/\b(lantern|chandelier|mobile|pendant)\b/, [0.35, 0.4, 0.35]], [/\b(cow|toy|figurine|vase|mug|teapot|candle)s?\b/, [0.25, 0.2, 0.12]],
  [/\btables?\b/, [1.1, 0.76, 1.1]], [/\barm ?chairs?|sofa|couch/, [0.85, 0.9, 0.8]], [/\bchairs?|stools?\b/, [0.46, 0.92, 0.48]],
  [/\blamps?\b/, [0.4, 1.5, 0.4]], [/\bplants?|fern|tree\b/, [0.5, 1.1, 0.5]], [/\brugs?|carpet\b/, [1.6, 0.03, 1.1]],
  [/\bshel(f|ves)\b/, [0.8, 0.25, 0.22]], [/\bbookcase\b/, [0.9, 1.6, 0.35]], [/\bwallpaper\b/, [1.2, 2.4, 0.02]], [/\bpinball\b/, [0.75, 1.3, 1.35]],
]
export const sizeOf = (what: string, given?: number[]): [number, number, number] =>
  (given?.length === 3 ? given : SIZES.find(([re]) => re.test(what.toLowerCase()))?.[1] ?? [0.6, 0.6, 0.6]) as [number, number, number]

/** Things that belong on a wall whatever the model said. Only whole kinds: "print" or "frame" also describe tables and beds. */
const WALL_KIND = /\b(tv|television|telly|picture|painting|poster|mirror|clock|wallpaper|calendar)s?\b/
const CEILING_KIND = /\b(lantern|chandelier|mobile|pendant|bunting|hanging)\b/

/**
 * The mount, checked: the model's proposal when it is one of MOUNTS and the
 * words do not say otherwise. The person's words win over the model's mount,
 * and a TV or a picture never lies on the floor.
 */
export function mountFor(what: string, where: string, proposed?: unknown): Mount {
  const w = where.toLowerCase(), kind = what.toLowerCase()
  if (/\b(ceiling|hang\w* from)\b/.test(w)) return 'ceiling'
  if (/\bwall\b|\babove\b/.test(w)) return 'wall'
  if (/\bon (the |a |our |that )?(table|counter|worktop|sill|windowsill|shelf)\b/.test(w)) return 'surface'
  const given = (MOUNTS as readonly string[]).includes(proposed as string) ? (proposed as Mount) : undefined
  if (WALL_KIND.test(kind) && given !== 'surface') return 'wall'
  if (given) return given
  return CEILING_KIND.test(kind) ? 'ceiling' : 'floor'
}

/** A thin thing on a wall faces out of it: its smallest side is its depth. */
export function wallSize([w, h, d]: [number, number, number]): [number, number, number] {
  return h < d && h < w ? [w, d, h] : [w, h, d]
}

/** Centre heights on a wall by kind; wallpaper covers the wall from the floor. */
const wallCentre = (kind: string, h: number) =>
  /wallpaper/.test(kind) ? h / 2 : /\b(tv|television|telly)\b/.test(kind) ? 1.3 : /clock/.test(kind) ? 1.9 : /shel/.test(kind) ? 1.45 : 1.55

export interface PlaceOptions {
  count?: number
  size?: number[]
  /** The last surface pointed at, if the person said "here". */
  here?: { point: { x: number; y: number; z: number }; normal: { x: number; y: number; z: number } } | null
  /** Where pieces already stand (base points), so a new one does not land on them. */
  taken?: { x: number; y: number; z: number }[]
  /** Towards the camera, for things set down on the floor. */
  face?: (x: number, z: number) => number
  /** Things placed in the house, oldest first, so "on the bed" can name one: its label, the middle of its top, its turn and half its footprint. */
  things?: Thing[]
}

export interface Thing { label: string; top: { x: number; y: number; z: number }; ry: number; half: number }

const singular = (w: string) => (w.length > 3 && w.endsWith('s') ? w.slice(0, -1) : w)
/** Surfaces the house names itself ("on the table" is the kitchen table): a placed thing takes them only by a fuller name ("on the side table"). */
const BUILT_IN_SURFACE = /^(table|counter|worktop|sill|windowsill|shelf)$/
/**
 * The placed thing the words set something on ("on the bed", "on top of the pink bed"), newest
 * first: its label ends in the phrase's noun ("table lamp" is a lamp, not a table) and has the
 * phrase's other words. A wall, floor or ceiling is never a thing.
 */
export function thingNamed(where: string, things: Thing[] = []): Thing | null {
  const phrases = where.toLowerCase().matchAll(/\bon (?:top of )?(?:the |a |an |my |our |that |this )?([a-z' ]+?)(?=\s*(?:\||$|[,.!?]|\b(?:in|by|near|next|please|for|and)\b))/g)
  for (const [, phrase] of phrases) {
    const words = phrase.trim().split(/\s+/).map(singular)
    const noun = words.at(-1) ?? ''
    if (!noun || /^(wall|ceiling|floor)$/.test(noun) || (words.length === 1 && BUILT_IN_SURFACE.test(noun))) continue
    const found = [...things].reverse().find((t) => {
      const label = t.label.toLowerCase().split(/[^a-z]+/).filter(Boolean).map(singular)
      // The thing's own noun is the last word before "with", "of" or "and" ("sofa with cushions" is a sofa, "table lamp" a lamp).
      const cut = label.findIndex((w) => w === 'with' || w === 'of' || w === 'and')
      const head = (cut > 0 ? label.slice(0, cut) : label).at(-1)
      return head === noun && words.every((w) => label.includes(w))
    })
    if (found) return found
  }
  return null
}

/** The anchor a line's words name for a mount, and a note when it went to the other room. */
function anchorFor(mount: Mount, w: string): { name: string; note?: string } {
  if (/living ?room|lounge|sofa|couch|plants\b|plant (corner|shelves)|sideboard/.test(w)) {
    const note = "That's for the living room, so it's going next door."
    if (mount === 'ceiling') return { name: 'livingCeiling', note }
    if (mount === 'wall') return { name: /sofa|couch/.test(w) ? 'sofaWall' : 'livingWall', note }
    if (mount === 'surface') return { name: 'livingSurface', note }
    return { name: /plant/.test(w) ? 'byPlants' : 'livingFloor', note }
  }
  if (mount === 'ceiling') return { name: 'ceiling' }
  if (mount === 'wall') return { name: /\b(left|side)\b/.test(w) ? 'sideWall' : 'wall' }
  if (mount === 'surface') return { name: /counter|worktop/.test(w) ? 'counter' : /sill|window/.test(w) ? 'sill' : 'table' }
  return { name: /window/.test(w) ? 'window' : /corner/.test(w) ? 'corner' : 'floor' }
}

/**
 * The first pose of each piece for "what", said to go "where", mounted as
 * `proposed` suggests. Different anchors give different poses, and a piece
 * slides along its anchor to keep clear of what already stands there.
 */
export function placeFor(what: string, where: string, proposed?: unknown, opts: PlaceOptions = {}): { poses: Pose[]; mount: Mount; size: [number, number, number]; note?: string } {
  const w = where.toLowerCase(), kind = what.toLowerCase()
  // "On the bed": a placed thing's top is the surface, whatever the model proposed (#79).
  const on = thingNamed(where, opts.things)
  const mount = on && !/\b(ceiling|hang\w* from|wall|above)\b/.test(w) && !WALL_KIND.test(kind) && !CEILING_KIND.test(kind) ? 'surface' : mountFor(what, where, proposed)
  const raw = sizeOf(what, opts.size)
  const size = mount === 'wall' ? wallSize(raw) : raw
  const [sw, sh] = size
  const n = Math.max(1, Math.min(6, Math.round(opts.count ?? 1)))
  const taken = [...(opts.taken ?? [])]
  // Chairs and the like around the table take its free sides.
  if (mount === 'floor' && /around|at the table|by the table/.test(w)) {
    const free = AROUND_TABLE.filter(([x, z]) => !taken.some((p) => Math.hypot(p.x - x, p.z - z) < 0.3))
    const poses = free.slice(0, n).map(([x, z]): Pose => ({ x, y: 0, z, ry: Math.atan2(TABLE.x - x, TABLE.z - z), mount, anchor: 'aroundTable' }))
    return { poses, mount, size }
  }
  let { name, note } = anchorFor(mount, w)
  let a: Anchor = ANCHORS[name]
  if (on && mount === 'surface') {
    a = { mount, x: on.top.x, y: on.top.y, z: on.top.z, ry: on.ry, span: Math.max(0, on.half - 0.1) }
    name = `on ${on.label}`
    note = undefined
  }
  // "Here": the surface pointed at. A floor or top takes it as it is; a wall takes wall pieces, and stands others in front.
  const here = /\b(here|there|that spot)\b/.test(w) ? opts.here : null
  if (here) {
    const { point: p, normal: nm } = here
    if (nm.y > 0.7 && mount !== 'wall' && mount !== 'ceiling') a = { mount, x: p.x, y: Math.max(0, p.y), z: p.z, ry: opts.face?.(p.x, p.z) ?? 0, span: 0.4 }
    else if (nm.y <= 0.7 && mount === 'wall') a = { mount, x: p.x, y: 0, z: p.z, ry: Math.atan2(nm.x, nm.z), span: 0.6, wall: true }
    else if (nm.y <= 0.7 && mount === 'floor') {
      const len = Math.hypot(nm.x, nm.z) || 1, off = Math.max(size[0], size[2]) / 2 + 0.05
      const x = p.x + (nm.x / len) * off, z = p.z + (nm.z / len) * off
      a = { mount, x, y: 0, z, ry: opts.face?.(x, z) ?? 0, span: 0.4 }
    }
    if (a !== ANCHORS[name]) name = 'here'
  }
  // The height of the base on this mount.
  const y = mount === 'wall' ? Math.max(0, Math.min(CEILING - 0.1 - sh, wallCentre(kind, sh) - sh / 2))
    : mount === 'ceiling' ? Math.max(1.6, Math.min(2.4, CEILING - 0.75 - sh))
      : a.y
  const tx = Math.cos(a.ry), tz = -Math.sin(a.ry)
  const clear = (x: number, z: number) => !taken.some((p) => Math.hypot(p.x - x, p.z - z) < Math.max(0.3, sw * 0.6) && Math.abs(p.y - y) < Math.max(0.3, sh))
  const poses: Pose[] = []
  for (let i = 0; i < n; i++) {
    // Slide along the anchor (0, +1, -1, +2, ...) to the first clear spot, within its span.
    const step = sw + (mount === 'surface' ? 0.08 : 0.12)
    let best: Pose | null = null
    for (let k = 0; k < 12 && !best; k++) {
      const off = (k % 2 ? 1 : -1) * Math.ceil(k / 2) * step
      if (Math.abs(off) > a.span + 1e-6 && k > 0) continue
      const x = a.x + tx * off, z = a.z + tz * off
      if (clear(x, z)) best = { x, y, z, ry: a.ry, mount, anchor: name, ...(a.wall ? { wall: true } : {}) }
    }
    // Nothing clear within the anchor: stand it at the anchor anyway; build mode can move it.
    best ??= { x: a.x, y, z: a.z, ry: a.ry, mount, anchor: name, ...(a.wall ? { wall: true } : {}) }
    poses.push(best)
    taken.push(best)
  }
  return { poses, mount, size, note }
}
