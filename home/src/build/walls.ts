// Walls, floors and dollhouse shell generated from a plan (#48, #53).
//
// Every wall piece is a box built along a world axis, as the house's plugins build
// them, then bent onto the wall's arc when the wall is curved. A straight wall is
// left as the plain box, so the untouched house renders as its plugins draw it:
// room.ts (the kitchen's back and left walls and seated floor), kitchendoor.ts (the
// wall the kitchen shares with the living room), lounge.ts (the living room's back
// and right walls, skirting and floor) and diorama.ts (the dollhouse's front walls,
// caps, stubs, base and the kitchen's floor). The UV mappings, materials and corner
// joinery copy theirs per wall: one mapping for every wall would change how the
// house looks. Rooms a build edit adds are drawn as the shell draws walls.
import * as THREE from 'three/webgpu'
import { CUT, FLOOR_ROUGHNESS, YARD_TOP } from '../diorama'
import { canvas, floorPlanks, paintPlaster, paintWood, toTexture } from '../paint'
import { HOUSE_PLAN, curveOf, floorOf, normalAt, outline, pointAt, roomWalls, roomsOf, segmentsOf, type Curve, type Opening, type Plan, type Room, type Wall } from './plan'

const STUB = 0.42
const BASE = 0.3

/** Materials and textures made once and shared by every rebuild. */
export interface Kit {
  /** room.ts's and kitchendoor.ts's plaster. */
  seatWall: THREE.MeshStandardMaterial
  /** diorama.ts's shell plaster. */
  shellWall: THREE.MeshStandardMaterial
  /** lounge.ts's plaster. */
  loungeWall: THREE.MeshStandardMaterial
  /** The draggable wall's own copy of its plaster (the living room's right wall), so it can glow on hover. */
  handleWall: THREE.MeshStandardMaterial
  trim: THREE.MeshStandardMaterial
  loungeTrim: THREE.MeshStandardMaterial
  /** Timber casing round the doors build edits open. */
  timber: THREE.MeshStandardMaterial
  cut: THREE.MeshStandardMaterial
  seatFloor: THREE.MeshStandardMaterial
  isoFloor: THREE.MeshStandardMaterial
  loungeFloor: THREE.MeshStandardMaterial
  shadow: THREE.MeshBasicMaterial
  shadowSize: string
}

export function makeKit(): Kit {
  // One plaster material per plugin, as each makes its own: draw order among
  // coplanar faces follows material ids.
  const plaster = paintPlaster(5, [244, 239, 230], 1536, 768, 0.45)
  const seatWall = new THREE.MeshStandardMaterial({ map: plaster, roughness: 0.95 })
  const shellWall = new THREE.MeshStandardMaterial({ map: plaster, roughness: 0.95 })
  const loungeWall = new THREE.MeshStandardMaterial({ map: paintPlaster(41, [240, 236, 229], 1536, 768, 0.3), roughness: 0.95 })
  const seatPlanks = floorPlanks()
  seatPlanks.repeat.set(6.2, 4.9)
  const isoPlanks = floorPlanks()
  isoPlanks.repeat.set(5.4, 4.2)
  const oak = paintWood({ seed: 17, planks: 7, light: [214, 190, 160], dark: [178, 152, 122], knots: 1 })
  oak.wrapS = oak.wrapT = THREE.RepeatWrapping
  oak.repeat.set(4, 5)
  oak.rotation = Math.PI / 2
  return {
    seatWall, shellWall, loungeWall,
    handleWall: loungeWall.clone(),
    trim: new THREE.MeshStandardMaterial({ color: '#f1ebe0', roughness: 0.6 }),
    loungeTrim: new THREE.MeshStandardMaterial({ color: '#f3efe8', roughness: 0.6 }),
    timber: new THREE.MeshStandardMaterial({ color: '#c8956a', roughness: 0.62 }),
    cut: new THREE.MeshStandardMaterial({ color: CUT, roughness: 0.8 }),
    seatFloor: new THREE.MeshStandardMaterial({ map: seatPlanks, roughness: FLOOR_ROUGHNESS }),
    isoFloor: new THREE.MeshStandardMaterial({ map: isoPlanks, roughness: FLOOR_ROUGHNESS }),
    loungeFloor: new THREE.MeshStandardMaterial({ map: oak, roughness: 0.6 }),
    shadow: new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, fog: false }),
    shadowSize: '',
  }
}

/** One wall's frame: its curve, the world axis its boxes are built along, and the room's inward side. */
interface Frame {
  wall: Wall
  c: Curve
  /** Whether the room's outline turns at the wall's start and end (in t order); a wall split in a straight run does not. */
  turnA: boolean
  turnB: boolean
  alongX: boolean
  /** +1 when t grows with the world axis. */
  sign: number
  /** Normal component on the box's across axis, so a box offset maps onto the normal. */
  across: number
  /** +1 when the room's loop runs the wall a→b (its outward side is the normal). */
  out: number
}

const frameOf = (plan: Plan, wall: Wall, forward: boolean): Frame => {
  const c = curveOf(plan, wall)
  const alongX = Math.abs(c.dir[0]) >= Math.abs(c.dir[1])
  return { wall, c, turnA: true, turnB: true, alongX, sign: Math.sign(alongX ? c.dir[0] : c.dir[1]), across: Math.sign(alongX ? c.normal[1] : c.normal[0]), out: forward ? 1 : -1 }
}

/** A room's frames in loop order, each knowing whether the outline turns at its ends. */
function framesOf(plan: Plan, room: Room): Frame[] {
  const frames = roomWalls(plan, room).map(({ wall, forward }) => frameOf(plan, wall, forward))
  const straight = (f: Frame) => f.c.radius === Infinity
  frames.forEach((f, i) => {
    const prev = frames[(i + frames.length - 1) % frames.length], next = frames[(i + 1) % frames.length]
    // Two straight walls in one line meet without a corner.
    const inLine = (g: Frame) => straight(f) && straight(g) && Math.abs(f.c.dir[0] * g.c.dir[1] - f.c.dir[1] * g.c.dir[0]) < 1e-6
    const [atA, atB] = f.out > 0 ? [prev, next] : [next, prev]
    f.turnA = !inLine(atA)
    f.turnB = !inLine(atB)
  })
  return frames
}

type UvMap = (uv: THREE.BufferAttribute, len: number, uMin: number, y0: number, y1: number) => void

/**
 * A box from t0 to t1 along the wall and y0 to y1 up, `depth` thick, its middle `offset`
 * metres along the wall's normal. Positioned at its own centre (the cutaway reads it).
 */
function piece(f: Frame, t0: number, t1: number, y0: number, y1: number, depth: number, offset: number, material: THREE.Material, uvMap?: UvMap): THREE.Mesh {
  const { c, alongX, sign } = f
  const len = t1 - t0
  const segs = segmentsOf(c) === 1 ? 1 : Math.max(2, Math.ceil(len / 0.1))
  const geo = alongX ? new THREE.BoxGeometry(len, y1 - y0, depth, segs) : new THREE.BoxGeometry(depth, y1 - y0, len, 1, 1, segs)
  const axis0 = alongX ? c.a[0] : c.a[1]
  const uMin = axis0 + sign * (sign > 0 ? t0 : t1)
  if (uvMap) uvMap(geo.attributes.uv as THREE.BufferAttribute, len, uMin, y0, y1)
  const tm = (t0 + t1) / 2
  const [mx, mz] = pointAt(c, tm)
  const [nx, nz] = normalAt(c, tm)
  const m = new THREE.Mesh(geo, material)
  m.position.set(mx + nx * offset, (y0 + y1) / 2, mz + nz * offset)
  if (c.radius !== Infinity) {
    // Bend: the box's along coordinate becomes arc length, its across coordinate a distance along the normal.
    const pos = geo.attributes.position as THREE.BufferAttribute
    for (let i = 0; i < pos.count; i++) {
      const l = alongX ? pos.getX(i) : pos.getZ(i)
      const d = (alongX ? pos.getZ(i) : pos.getX(i)) * f.across
      const t = tm + sign * l
      const [px, pz] = pointAt(c, t)
      const [qx, qz] = normalAt(c, t)
      pos.setXYZ(i, px + qx * (offset + d) - m.position.x, pos.getY(i), pz + qz * (offset + d) - m.position.z)
    }
    geo.computeVertexNormals()
  }
  // The cutaway hides a wall when the camera stands on its outer side.
  m.userData.inward = new THREE.Vector3(-nx * f.out, 0, -nz * f.out)
  m.userData.wall = f.wall.id
  return m
}

/** Full-height pieces of a wall from t0 to t1 around its openings: columns, then what is under and over each opening. */
function around(openings: Opening[], t0: number, t1: number, height: number): Array<[number, number, number, number]> {
  const out: Array<[number, number, number, number]> = []
  let at = t0
  const sorted = [...openings].sort((p, q) => p.from - q.from)
  for (const o of sorted) {
    out.push([at, o.from, 0, height])
    at = o.to
  }
  out.push([at, t1, 0, height])
  for (const o of sorted) {
    if (o.sill > 0) out.push([o.from, o.to, 0, o.sill])
    if (o.head < height) out.push([o.from, o.to, o.head, height])
  }
  return out
}

/** The base house's openings (HOUSE_PLAN), which its plugins dress; any other was opened by a build edit. */
const BASE_OPENINGS = new Set(HOUSE_PLAN.walls.flatMap((w) => w.openings.map((o) => o.id)))
/**
 * Doors the house shows closed (loungedoors.ts hangs a shut door on the wall's face):
 * the wall stays whole behind the leaf, as lounge.ts builds it, until the room beyond is built.
 */
const CLOSED = new Set(['living.door-workshop'])
/** The house's own rooms, which their plugins furnish; any other was added by a build edit. */
export const BASE_ROOMS: ReadonlySet<string> = new Set(HOUSE_PLAN.rooms.map((r) => r.id))
const CASING = 0.075
/**
 * Timber round each door a build edit opened in this wall: a jamb each side and a head on both
 * faces, and boards lining the reveal and the underside of the lintel, so the cut wall reads as a doorway.
 */
function doorTrim(f: Frame, kit: Kit): THREE.Mesh[] {
  const out: THREE.Mesh[] = []
  const T = f.wall.thickness
  for (const o of f.wall.openings) {
    if (o.kind !== 'door' || o.sill > 0.01 || BASE_OPENINGS.has(o.id)) continue
    for (const side of [1, -1]) {
      const off = side * (T / 2 + 0.012)
      out.push(
        piece(f, o.from - CASING, o.from + 0.004, 0, o.head + CASING, 0.024, off, kit.timber),
        piece(f, o.to - 0.004, o.to + CASING, 0, o.head + CASING, 0.024, off, kit.timber),
        piece(f, o.from - CASING - 0.012, o.to + CASING + 0.012, o.head - 0.004, o.head + CASING + 0.012, 0.03, side * (T / 2 + 0.015), kit.timber),
      )
    }
    out.push(
      piece(f, o.from, o.from + 0.018, 0, o.head, T + 0.02, 0, kit.timber),
      piece(f, o.to - 0.018, o.to, 0, o.head, T + 0.02, 0, kit.timber),
      piece(f, o.from, o.to, o.head - 0.018, o.head, T + 0.02, 0, kit.timber),
      // A threshold board across the floor, so the base never shows between the rooms.
      piece(f, o.from, o.to, 0, 0.014, T + 0.06, 0, kit.timber),
    )
  }
  for (const m of out) m.castShadow = m.receiveShadow = true
  return out
}

/** Stretches between openings that come down to the floor below `below`. */
function spans(openings: Opening[], t0: number, t1: number, below: number): Array<[number, number]> {
  const out: Array<[number, number]> = []
  let at = t0
  for (const o of [...openings].sort((p, q) => p.from - q.from)) {
    if (o.sill >= below) continue
    out.push([at, o.from])
    at = o.to
  }
  out.push([at, t1])
  return out
}

/** Which side of the room a wall is on, by its outward normal at the middle. */
const sideOf = (f: Frame): 'back' | 'front' | 'left' | 'right' => {
  const [nx, nz] = normalAt(f.c, f.c.length / 2).map((v) => v * f.out)
  return Math.abs(nx) > Math.abs(nz) ? (nx < 0 ? 'left' : 'right') : nz < 0 ? 'back' : 'front'
}

/** The base floors' sizes, so boards keep their size when a wall moves (each plugin's repeat is over its own floor). */
const baseSize = (id: string) => {
  const ring = floorOf(HOUSE_PLAN, HOUSE_PLAN.rooms.find((r) => r.id === id)!)
  const xs = ring.map((p) => p[0]), zs = ring.map((p) => p[1])
  return { w: Math.max(...xs) - Math.min(...xs), d: Math.max(...zs) - Math.min(...zs) }
}
const KITCHEN_FLOOR = baseSize('kitchen')
const LIVING_FLOOR = baseSize('living')
/** room.ts's seated floor runs this far past the kitchen's back wall, under the open front. */
const SEAT_DEPTH = 7

export interface Built {
  /** What the house's plugins build at full height in both views: walls, skirting, and the floors they own. */
  seat: THREE.Group
  /** What diorama.ts's shell() builds, and kitchendoor.ts's caps and stubs, for ?cam=iso. */
  shell: THREE.Group | null
  /** diorama.ts's kitchen floor, for ?cam=iso. */
  floor: THREE.Mesh | null
  /** Every room a build edit added: its floor, base and the walls the house does not own. Null when there is none. */
  rooms: THREE.Group | null
}

/** Which plugin's way a base room's wall is drawn in. */
type Style = 'kitchen-back' | 'kitchen-side' | 'shared' | 'living-back' | 'living-side' | 'front'

/**
 * Build the house. `handle` gives that wall the hover material. `final` repaints the
 * contact shadow when the footprint changed; while dragging the old one stretches.
 */
export function build(plan: Plan, kit: Kit, options: { iso: boolean; handle?: string; final?: boolean }): Built {
  const seat = new THREE.Group()
  seat.name = 'build seat'
  const shell = new THREE.Group()
  shell.name = 'build shell'
  const base = plan.rooms.filter((r) => BASE_ROOMS.has(r.id))
  const isBase = (w: Wall) => roomsOf(plan, w.id).every((r) => BASE_ROOMS.has(r.id))

  // The house's outer extent: the shell's plaster is mapped from its left edge, and its base and shadow span it.
  const outers = base.map((r) => outline(plan, r, -Math.max(...roomWalls(plan, r).map(({ wall }) => wall.thickness)) / 2))
  const xs = outers.flat().map((p) => p[0]), zs = outers.flat().map((p) => p[1])
  const ox0 = Math.min(...xs), ox1 = Math.max(...xs), oz0 = Math.min(...zs), oz1 = Math.max(...zs)
  const world8 = (H: number): UvMap => (uv, len, uMin, y0, y1) => {
    for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) * len + uMin - ox0) / 8, (uv.getY(i) * (y1 - y0) + y0) / H)
  }

  // Each base wall once, from the room it belongs to (a shared wall from the first room that has it).
  const drawn = new Set<string>()
  const frames: Array<{ f: Frame; room: Room; style: Style }> = []
  for (const room of base) {
    for (const f of framesOf(plan, room)) {
      if (drawn.has(f.wall.id)) continue
      drawn.add(f.wall.id)
      const side = sideOf(f)
      const shared = roomsOf(plan, f.wall.id).length === 2 && isBase(f.wall)
      const style: Style = shared ? 'shared' : side === 'front' ? 'front' : room.id === 'living' ? (side === 'back' ? 'living-back' : 'living-side') : side === 'back' ? 'kitchen-back' : 'kitchen-side'
      frames.push({ f, room, style })
    }
  }
  // Where a wall meets another room's wall in one straight line (the back and front run on from room to room),
  // the joint sits half a wall short of the corner, so the wall that ends there stops at the shared wall's near face.
  const inLineAt = (f: Frame, room: Room, corner: string) => frames.some(({ f: g, room: r }) => r !== room && (g.wall.a === corner || g.wall.b === corner) &&
    f.c.radius === Infinity && g.c.radius === Infinity && Math.abs(f.c.dir[0] * g.c.dir[1] - f.c.dir[1] * g.c.dir[0]) < 1e-6)
  /** The stretch of t a wall's full-height pieces cover. */
  const extent = (f: Frame, room: Room, style: Style): [number, number] => {
    const T = f.wall.thickness, L = f.c.length
    // In t order: the corner at t = 0 is a, at t = L is b.
    const [tA, tB] = [f.turnA, f.turnB]
    if (!f.alongX || style === 'shared' || style === 'kitchen-side' || style === 'living-side') return [tA ? T / 2 : 0, tB ? L - T / 2 : L]
    const joinA = inLineAt(f, room, f.wall.a), joinB = inLineAt(f, room, f.wall.b)
    return [joinA || tA ? -T / 2 : 0, joinB ? L - T / 2 : tB ? L + T / 2 : L]
  }
  const shadowed = (m: THREE.Mesh) => {
    m.castShadow = m.receiveShadow = true
    return m
  }
  /** A cap on a piece's top, as the shell and kitchendoor.ts lay them; side caps stop 2 mm short of the back and front ones. */
  const capOf = (f: Frame, a: number, b: number, y1: number, short: boolean) => {
    const T = f.wall.thickness
    const cap = piece(f, short ? a + 0.002 : a, short ? b - 0.002 : b, y1, y1 + 0.02, T + 0.004, 0, kit.cut)
    cap.position.y = y1 + 0.01
    cap.castShadow = true
    return cap
  }

  for (const { f, room, style } of frames) {
    const T = f.wall.thickness, H = f.wall.height
    const [t0, t1] = extent(f, room, style)
    const openings = f.wall.openings.filter((o) => !CLOSED.has(o.id))
    const handle = options.handle === f.wall.id
    if (style === 'front') {
      // diorama.ts's shell: full walls round the openings, a cap on full walls and lintels, a low stub for the cutaway.
      const wallMat = handle ? kit.handleWall : kit.shellWall
      for (const [a, b, y0, y1] of around(openings, t0, t1, H)) {
        const m = piece(f, a, b, y0, y1, T, 0, wallMat, world8(H))
        m.castShadow = m.receiveShadow = true
        shell.add(m, ...(y1 >= H ? [capOf(f, a, b, y1, false)] : []))
      }
      for (const m of doorTrim(f, kit)) shell.add(m)
    } else if (style === 'shared') {
      // kitchendoor.ts: pieces round the doorway, its plaster mapped from the back wall's face, standing full
      // height only when you look into a room it backs (camera.ts reads `interior`).
      const interior = { x: (f.c.a[0] + f.c.b[0]) / 2 }
      const fromFace: UvMap = (uv, len, uMin, y0, y1) => {
        const axis0 = f.alongX ? f.c.a[0] : f.c.a[1]
        const face = axis0 + f.sign * (f.sign > 0 ? t0 : t1)
        for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) * len + uMin - face) / 6, (uv.getY(i) * (y1 - y0) + y0) / H)
      }
      for (const [a, b, y0, y1] of around(openings, t0, t1, H)) {
        const m = shadowed(piece(f, a, b, y0, y1, T, 0, handle ? kit.handleWall : kit.seatWall, fromFace))
        delete m.userData.inward
        m.userData.interior = interior
        seat.add(m)
        if (!options.iso) continue
        // Two mm short of the back and front walls' caps, so no two caps share a top face.
        const cap = capOf(f, a <= t0 + 1e-9 ? a + 0.002 : a, b >= t1 - 1e-9 ? b - 0.002 : b, y1, false)
        delete cap.userData.inward
        cap.userData.interior = interior
        shell.add(cap)
      }
      if (options.iso) {
        for (const [a, b] of spans(openings.filter((o) => o.sill < STUB), t0, t1, STUB)) {
          const m = piece(f, a, b, 0, STUB, T, 0, kit.seatWall, fromFace)
          m.castShadow = m.receiveShadow = true
          const ca = a <= t0 + 1e-9 ? a + 0.002 : a, cb = b >= t1 - 1e-9 ? b - 0.002 : b
          const cap = capOf(f, ca, cb, STUB, false)
          for (const o of [m, cap]) {
            delete o.userData.inward
            o.userData.interior = interior
            o.userData.cutaway = true
            o.visible = false
            shell.add(o)
          }
        }
      }
      for (const m of doorTrim(f, kit)) seat.add(m)
      continue
    } else {
      // room.ts and lounge.ts: full-height walls in both views; the shell adds their caps.
      const lounge = style === 'living-back' || style === 'living-side'
      const wallMat = handle ? kit.handleWall : lounge ? kit.loungeWall : kit.seatWall
      let uvMap: UvMap | undefined
      if (style === 'kitchen-back') {
        // One plaster map stretched over the whole wall, never repeated.
        const axis0 = f.alongX ? f.c.a[0] : f.c.a[1]
        const u0 = axis0 + f.sign * (f.sign > 0 ? t0 : t1), u1 = axis0 + f.sign * (f.sign > 0 ? t1 : t0)
        uvMap = (uv, len, uMin, y0, y1) => {
          for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) * len + uMin - u0) / (u1 - u0), (uv.getY(i) * (y1 - y0) + y0) / H)
        }
      } else if (lounge) {
        // lounge.ts: the box's own UVs, the plaster repeating every 6 m along it.
        uvMap = (uv, len) => {
          const scale = Math.max(len, T) / 6
          for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * scale, uv.getY(i))
        }
      }
      for (const [a, b, y0, y1] of around(openings, t0, t1, H)) seat.add(shadowed(piece(f, a, b, y0, y1, T, 0, wallMat, uvMap)))
      for (const m of doorTrim(f, kit)) seat.add(m)
      // Skirting along the room's face, broken by doors: room.ts's on the kitchen's back wall, lounge.ts's on the living room's walls.
      if (style !== 'kitchen-side') {
        const [h, gap, mat] = lounge ? [0.09, 0.01, kit.loungeTrim] : [0.1, 0.015, kit.trim]
        const y0 = lounge ? 0 : 0.01
        for (const [a, b] of spans(openings, f.turnA ? T / 2 : 0, f.turnB ? f.c.length - T / 2 : f.c.length, 0.1)) {
          const m = piece(f, a, b, y0, y0 + h, 0.02, -f.out * (T / 2 + gap), mat)
          delete m.userData.inward
          seat.add(m)
        }
      }
    }
    if (!options.iso) continue
    // The shell's caps over the house's own walls (side caps 2 mm short), and every outer wall's cut stub.
    if (style !== 'front') shell.add(capOf(f, t0, t1, H, !f.alongX))
    for (const [a, b] of spans(openings.filter((o) => o.sill < STUB), t0, t1, STUB)) {
      const m = piece(f, a, b, 0, STUB, T, 0, kit.shellWall, world8(H))
      m.castShadow = m.receiveShadow = true
      for (const o of [m, capOf(f, a, b, STUB, !f.alongX)]) {
        o.userData.cutaway = true
        o.visible = false
        shell.add(o)
      }
    }
  }

  // Floors: room.ts's seated kitchen floor (its plaster-free open front runs on under the camera), lounge.ts's
  // oak in the living room in both views, and diorama.ts's kitchen floor in the dollhouse.
  let isoFloor: THREE.Mesh | null = null
  for (const room of base) {
    if (room.id === 'living') {
      const m = floorMesh(plan, room, kit.loungeFloor, LIVING_FLOOR, 'build floor')
      m.userData.room = room.id
      seat.add(m)
      continue
    }
    const seated = floorMesh(plan, room, kit.seatFloor, { w: KITCHEN_FLOOR.w, d: SEAT_DEPTH }, 'build seat floor', SEAT_DEPTH)
    seated.userData.seatOnly = true // iso stands on the dollhouse's own floor
    seat.add(seated)
    if (options.iso) isoFloor = floorMesh(plan, room, kit.isoFloor, KITCHEN_FLOOR, 'build floor')
  }
  const rooms = otherRooms(plan, base, kit)
  if (!options.iso) return { seat, shell: null, floor: null, rooms }

  const slab = new THREE.Mesh(new THREE.BoxGeometry(ox1 - ox0 + 0.08, BASE, oz1 - oz0 + 0.08), kit.cut)
  slab.position.set((ox0 + ox1) / 2, -BASE / 2 - 0.002, (oz0 + oz1) / 2)
  slab.receiveShadow = true
  shell.add(slab)
  shell.add(contactShadow(kit, ox1 - ox0, oz1 - oz0, (ox0 + ox1) / 2, (oz0 + oz1) / 2, YARD_TOP + 0.003, 0.5, options.final ?? true))
  return { seat, shell, floor: isoFloor, rooms }
}

/**
 * The plan's other rooms, built as the shell builds walls: full height around
 * their openings, a cap on top, a low stub that stands in when the camera is
 * outside, and a base under the floor. A wall shared with the first room is that
 * room's to draw; a wall two other rooms share is drawn once.
 */
function otherRooms(plan: Plan, house: Room[], kit: Kit): THREE.Group | null {
  const others = plan.rooms.filter((r) => !house.includes(r))
  if (!others.length) return null
  const group = new THREE.Group()
  group.name = 'build rooms'
  const drawn = new Set(house.flatMap((r) => roomWalls(plan, r).map(({ wall }) => wall.id)))
  for (const room of others) {
    const frames = framesOf(plan, room)
    const outer = outline(plan, room, -frames[0].wall.thickness / 2)
    const xs = outer.map((p) => p[0]), zs = outer.map((p) => p[1])
    const ox0 = Math.min(...xs), ox1 = Math.max(...xs), oz0 = Math.min(...zs), oz1 = Math.max(...zs)
    for (const f of frames) {
      if (drawn.has(f.wall.id)) continue
      drawn.add(f.wall.id)
      const T = f.wall.thickness, H = f.wall.height, L = f.c.length
      const world8: UvMap = (uv, len, uMin, y0, y1) => {
        for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) * len + uMin - ox0) / 8, (uv.getY(i) * (y1 - y0) + y0) / H)
      }
      const [t0, t1] = f.alongX ? [f.turnA ? -T / 2 : 0, f.turnB ? L + T / 2 : L] : [f.turnA ? T / 2 : 0, f.turnB ? L - T / 2 : L]
      const run = (a: number, b: number, y0: number, y1: number, capped: boolean) => {
        const m = piece(f, a, b, y0, y1, T, 0, kit.shellWall, world8)
        m.castShadow = m.receiveShadow = true
        const parts: THREE.Mesh[] = [m]
        if (capped) {
          const cap = piece(f, a, b, y1, y1 + 0.02, T + 0.004, 0, kit.cut)
          cap.position.y = y1 + 0.01
          cap.castShadow = true
          parts.push(cap)
        }
        return parts
      }
      for (const [a, b, y0, y1] of around(f.wall.openings, t0, t1, H)) group.add(...run(a, b, y0, y1, y1 >= H))
      for (const m of doorTrim(f, kit)) group.add(m)
      for (const [a, b] of spans(f.wall.openings.filter((o) => o.sill < STUB), t0, t1, STUB)) {
        for (const m of run(a, b, 0, STUB, true)) {
          m.userData.cutaway = true
          m.visible = false
          group.add(m)
        }
      }
    }
    const base = new THREE.Mesh(new THREE.BoxGeometry(ox1 - ox0 + 0.08, BASE, oz1 - oz0 + 0.08), kit.cut)
    base.position.set((ox0 + ox1) / 2, -BASE / 2 - 0.004, (oz0 + oz1) / 2)
    base.receiveShadow = true
    base.userData.room = room.id
    group.add(base)
    const floor = floorMesh(plan, room, kit.isoFloor, KITCHEN_FLOOR, 'build room floor')
    floor.userData.room = room.id
    group.add(floor)
  }
  return group
}

/**
 * The floor inside the walls, curved walls and all; boards keep their size and stay put as walls move.
 * A rectangular floor is a plane, as its plugin lays it, with `size` the floor its texture's repeat was
 * set for; `depth` lays it that far from the back wall instead of to the front one.
 */
function floorMesh(plan: Plan, room: Room, material: THREE.Material, size: { w: number; d: number }, name: string, depth?: number): THREE.Mesh {
  const ring = floorOf(plan, room)
  const x0 = Math.min(...ring.map((p) => p[0])), x1 = Math.max(...ring.map((p) => p[0]))
  const z0 = Math.min(...ring.map((p) => p[1])), z1 = Math.max(...ring.map((p) => p[1]))
  const rect = ring.length === 4 && ring.every(([x, z]) => (Math.abs(x - x0) < 1e-9 || Math.abs(x - x1) < 1e-9) && (Math.abs(z - z0) < 1e-9 || Math.abs(z - z1) < 1e-9))
  if (rect || depth !== undefined) {
    const d = depth ?? z1 - z0
    const geo = new THREE.PlaneGeometry(x1 - x0, d)
    const uv = geo.attributes.uv as THREE.BufferAttribute
    const su = (x1 - x0) / size.w, sv = d / size.d
    if (su !== 1 || sv !== 1) for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * su, uv.getY(i) * sv)
    const m = new THREE.Mesh(geo, material)
    m.rotation.x = -Math.PI / 2
    m.position.set((x0 + x1) / 2, 0, z0 + d / 2)
    m.receiveShadow = true
    m.name = name
    return m
  }
  const tris = THREE.ShapeUtils.triangulateShape(ring.map(([x, z]) => new THREE.Vector2(x, z)), [])
  const position: number[] = [], uv: number[] = [], normal: number[] = []
  for (const [x, z] of ring) {
    position.push(x, 0, z)
    normal.push(0, 1, 0)
    uv.push((x - x0) / size.w, (z1 - z) / size.d)
  }
  const index: number[] = []
  for (const [a, b, c] of tris) {
    const [ax, az] = ring[a], [bx, bz] = ring[b], [cx, cz] = ring[c]
    // Face up: counter-clockwise seen from above.
    const up = (bz - az) * (cx - ax) - (bx - ax) * (cz - az) > 0
    index.push(...(up ? [a, b, c] : [a, c, b]))
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(position, 3))
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normal, 3))
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
  geo.setIndex(index)
  const m = new THREE.Mesh(geo, material)
  m.receiveShadow = true
  m.name = name
  return m
}

/** diorama.ts's soft foundation shadow (not exported there). Repainted only when `paint` and the size changed. */
function contactShadow(kit: Kit, w: number, d: number, x: number, z: number, y: number, pad: number, paint: boolean): THREE.Mesh {
  const size = `${w.toFixed(3)}x${d.toFixed(3)}`
  if (!kit.shadow.map || (paint && kit.shadowSize !== size)) {
    const [c, g] = canvas(256, 256)
    const sx = 256 / (w + pad * 2), sz = 256 / (d + pad * 2)
    g.filter = 'blur(18px)'
    g.fillStyle = 'rgba(70, 38, 20, 0.8)'
    g.fillRect(pad * sx * 0.7, pad * sz * 0.7, (w + pad * 0.6) * sx, (d + pad * 0.6) * sz)
    kit.shadow.map?.dispose()
    kit.shadow.map = toTexture(c)
    kit.shadow.needsUpdate = true
    kit.shadowSize = size
  }
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w + pad * 2, d + pad * 2), kit.shadow)
  m.rotation.x = -Math.PI / 2
  m.position.set(x, y, z)
  m.name = 'build contact shadow'
  return m
}
