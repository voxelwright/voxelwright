// Where a furnished thing first stands (#42). Pure and trusted: the router proposes
// "where" (the person's words) and "mount" as data, and this decides the pose from
// the room's own measurements. Build mode will move things afterwards; this only
// has to get the first placement right.
import { DOORWAY, TABLE_TOP, WALL_Z, WINDOW } from '../layout'

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
  // The living room is another room; until it can be furnished from here, its door stands in for it.
  livingDoor: { mount: 'floor', x: (DOORWAY.x0 + DOORWAY.x1) / 2 + 0.35, y: 0, z: WALL_Z + 0.75, ry: 0.55, span: 0.5 },
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

const WALL_KIND = /\b(tv|television|telly|picture|painting|poster|print|frame|mirror|clock|shel(f|ves)|wallpaper|hooks?|calendar)\b/
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
}

/** The anchor a line's words name for a mount, and a note when it cannot be where they said. */
function anchorFor(mount: Mount, w: string): { name: string; note?: string } {
  const living = /living ?room|lounge|sofa|couch/.test(w)
  const note = living ? "The living room isn't open from here yet, so it's here in the kitchen for now." : undefined
  if (mount === 'ceiling') return { name: 'ceiling', note }
  if (mount === 'wall') return { name: /\b(left|side)\b/.test(w) ? 'sideWall' : 'wall', note }
  if (mount === 'surface') return { name: /counter|worktop/.test(w) ? 'counter' : /sill|window/.test(w) ? 'sill' : 'table', note }
  return { name: /window/.test(w) ? 'window' : /corner/.test(w) ? 'corner' : 'floor', note }
}

/**
 * The first pose of each piece for "what", said to go "where", mounted as
 * `proposed` suggests. Different anchors give different poses, and a piece
 * slides along its anchor to keep clear of what already stands there.
 */
export function placeFor(what: string, where: string, proposed?: unknown, opts: PlaceOptions = {}): { poses: Pose[]; mount: Mount; size: [number, number, number]; note?: string } {
  const w = where.toLowerCase(), kind = what.toLowerCase()
  const mount = mountFor(what, where, proposed)
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
