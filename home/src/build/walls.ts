// Walls, floor and dollhouse shell generated from a plan (#48).
//
// Every wall piece is a box built along a world axis, as room.ts and diorama.ts
// build them, then bent onto the wall's arc when the wall is curved. A straight
// wall is left as the plain box, so the untouched kitchen renders as today.
// The UV mappings and corner joinery copy today's per wall on purpose (the seated
// back wall's plaster stretched across it, the side wall's plain box UVs, the
// shell's 8 m world scale, back and front walls running past their corners):
// unifying them is a visible change and waits for the owner's eye.
import * as THREE from 'three/webgpu'
import { CUT, FLOOR_ROUGHNESS, YARD_TOP } from '../diorama'
import { canvas, floorPlanks, paintPlaster, toTexture } from '../paint'
import { KITCHEN, curveOf, normalAt, outline, pointAt, roomWalls, segmentsOf, type Curve, type Opening, type P, type Plan, type Room, type Wall } from './plan'

const STUB = 0.42
const BASE = 0.3

/** Materials and textures made once and shared by every rebuild. */
export interface Kit {
  seatWall: THREE.MeshStandardMaterial
  shellWall: THREE.MeshStandardMaterial
  /** The draggable wall's own copy of the plaster, so it can glow on hover. */
  handleWall: THREE.MeshStandardMaterial
  trim: THREE.MeshStandardMaterial
  /** Timber casing round the doors build edits open. */
  timber: THREE.MeshStandardMaterial
  cut: THREE.MeshStandardMaterial
  seatFloor: THREE.MeshStandardMaterial
  isoFloor: THREE.MeshStandardMaterial
  shadow: THREE.MeshBasicMaterial
  shadowSize: string
}

export function makeKit(): Kit {
  // Two plaster materials, as room.ts and diorama.ts each make one: draw order among
  // coplanar faces (the back-left post against the back wall) follows material ids.
  const plaster = paintPlaster(5, [244, 239, 230], 1536, 768, 0.45)
  const seatWall = new THREE.MeshStandardMaterial({ map: plaster, roughness: 0.95 })
  const shellWall = new THREE.MeshStandardMaterial({ map: plaster, roughness: 0.95 })
  const seatPlanks = floorPlanks()
  seatPlanks.repeat.set(8.1, 6.3)
  const isoPlanks = floorPlanks()
  isoPlanks.repeat.set(5.4, 4.2)
  return {
    seatWall, shellWall,
    handleWall: shellWall.clone(),
    trim: new THREE.MeshStandardMaterial({ color: '#f1ebe0', roughness: 0.6 }),
    timber: new THREE.MeshStandardMaterial({ color: '#c8956a', roughness: 0.62 }),
    cut: new THREE.MeshStandardMaterial({ color: CUT, roughness: 0.8 }),
    seatFloor: new THREE.MeshStandardMaterial({ map: seatPlanks, roughness: FLOOR_ROUGHNESS }),
    isoFloor: new THREE.MeshStandardMaterial({ map: isoPlanks, roughness: FLOOR_ROUGHNESS }),
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

/** Openings the kitchen has always had (room.ts and its plugins dress those); any other was opened by a build edit. */
const KITCHEN_OPENINGS = new Set(KITCHEN.walls.flatMap((w) => w.openings.map((o) => o.id)))
const CASING = 0.075
/**
 * Timber round each door a build edit opened in this wall: a jamb each side and a head on both
 * faces, and boards lining the reveal and the underside of the lintel, so the cut wall reads as a doorway.
 */
function doorTrim(f: Frame, kit: Kit): THREE.Mesh[] {
  const out: THREE.Mesh[] = []
  const T = f.wall.thickness
  for (const o of f.wall.openings) {
    if (o.kind !== 'door' || o.sill > 0.01 || KITCHEN_OPENINGS.has(o.id)) continue
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

/** The walls the seated view has always had at full height; the shell adds caps and stubs only for these. */
const SEATED = ['back', 'left']

// Board density of the dollhouse floor: diorama.ts laid 5.4 × 4.2 repeats over the 6 × 6.71 m kitchen.
const KITCHEN_FLOOR = (() => {
  const ring = outline(KITCHEN, KITCHEN.rooms[0], KITCHEN.walls[0].thickness / 2)
  const xs = ring.map((p) => p[0]), zs = ring.map((p) => p[1])
  return { w: Math.max(...xs) - Math.min(...xs), d: Math.max(...zs) - Math.min(...zs) }
})()

export interface Built {
  /** What room.ts builds: the seated room's full walls, skirting and its 9 m floor. */
  seat: THREE.Group
  /** What diorama.ts's shell() and floor() build, for ?cam=iso. */
  shell: THREE.Group | null
  floor: THREE.Mesh | null
  /** Every other room in the plan: its floor, base and the walls the first room does not own. Null with one room. */
  rooms: THREE.Group | null
}

/**
 * Build a room. `handle` gives that wall the hover material. `final` repaints the
 * contact shadow when the footprint changed; while dragging the old one stretches.
 */
export function build(plan: Plan, room: Room, kit: Kit, options: { iso: boolean; handle?: string; final?: boolean }): Built {
  const frames = framesOf(plan, room)
  const seat = new THREE.Group()
  seat.name = 'build seat'

  const floor9 = new THREE.Mesh(new THREE.PlaneGeometry(9, 9), kit.seatFloor)
  floor9.rotation.x = -Math.PI / 2
  floor9.receiveShadow = true
  floor9.userData.seatOnly = true
  seat.add(floor9)

  for (const f of frames.filter((k) => SEATED.includes(sideOf(k)))) {
    const T = f.wall.thickness, H = f.wall.height, L = f.c.length
    if (sideOf(f) === 'back') {
      // room.ts: from the left wall's centre to the right wall's inner face, one plaster map stretched over it.
      const W0 = 0, W1 = L - T / 2
      const stretch: UvMap = (uv, len, uMin, y0, y1) => {
        const axis0 = f.alongX ? f.c.a[0] : f.c.a[1]
        const u0 = axis0 + f.sign * (f.sign > 0 ? W0 : W1), u1 = axis0 + f.sign * (f.sign > 0 ? W1 : W0)
        for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) * len + uMin - u0) / (u1 - u0), (uv.getY(i) * (y1 - y0) + y0) / H)
      }
      for (const [a, b, y0, y1] of around(f.wall.openings, W0, W1, H)) {
        const m = piece(f, a, b, y0, y1, T, 0, kit.seatWall, stretch)
        m.castShadow = m.receiveShadow = true
        seat.add(m)
      }
    } else {
      // room.ts: the side wall between the back and front inner faces, plain box UVs.
      for (const [a, b, y0, y1] of around(f.wall.openings, f.turnA ? T / 2 : 0, f.turnB ? L - T / 2 : L, H)) {
        const m = piece(f, a, b, y0, y1, T, 0, kit.seatWall)
        m.castShadow = m.receiveShadow = true
        seat.add(m)
      }
    }
  }
  for (const f of frames.filter((k) => SEATED.includes(sideOf(k)))) seat.add(...doorTrim(f, kit))
  // Skirting along the back wall, broken by doors.
  for (const f of frames.filter((k) => sideOf(k) === 'back')) {
    const T = f.wall.thickness
    for (const [a, b] of spans(f.wall.openings, 0, f.c.length - T / 2, 0.1)) {
      const m = piece(f, a, b, 0.01, 0.11, 0.02, -f.out * (T / 2 + 0.015), kit.trim)
      delete m.userData.inward
      seat.add(m)
    }
  }
  const rooms = otherRooms(plan, room, kit)
  if (!options.iso) return { seat, shell: null, floor: null, rooms }

  // The shell, as diorama.ts's shell() builds it, for any outline.
  const shell = new THREE.Group()
  shell.name = 'build shell'
  const outer = outline(plan, room, -frames[0].wall.thickness / 2)
  const xs = outer.map((p) => p[0]), zs = outer.map((p) => p[1])
  const ox0 = Math.min(...xs), ox1 = Math.max(...xs), oz0 = Math.min(...zs), oz1 = Math.max(...zs)
  const sides = ['back', 'front', 'left', 'right']
  for (const f of [...frames].sort((p, q) => sides.indexOf(sideOf(p)) - sides.indexOf(sideOf(q)))) {
    const T = f.wall.thickness, H = f.wall.height, L = f.c.length
    const world8: UvMap = (uv, len, uMin, y0, y1) => {
      for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) * len + uMin - ox0) / 8, (uv.getY(i) * (y1 - y0) + y0) / H)
    }
    // Back and front run the full outer width; the side walls fit between them.
    const [t0, t1] = f.alongX ? [-T / 2, L + T / 2] : [f.turnA ? T / 2 : 0, f.turnB ? L - T / 2 : L]
    const wallMat = options.handle === f.wall.id ? kit.handleWall : kit.shellWall
    const run = (a: number, b: number, y0: number, y1: number) => {
      const m = piece(f, a, b, y0, y1, T, 0, wallMat, world8)
      m.castShadow = true
      m.receiveShadow = true
      const cap = piece(f, a, b, y1, y1 + 0.02, T + 0.004, 0, kit.cut)
      cap.position.y = y1 + 0.01
      cap.castShadow = true
      return [m, cap]
    }
    const doors = f.wall.openings.filter((o) => o.sill < STUB)
    if (SEATED.includes(sideOf(f))) {
      const [m, cap] = run(t0, t1, 0, H)
      m.geometry.dispose()
      shell.add(cap)
    } else for (const [a, b, y0, y1] of around(f.wall.openings, t0, t1, H)) {
      const [m, cap] = run(a, b, y0, y1)
      // Only the tops of full walls and lintels carry a cap, as in shell().
      shell.add(m, ...(y1 >= H ? [cap] : []))
      if (y1 < H) cap.geometry.dispose()
    }
    if (!SEATED.includes(sideOf(f))) shell.add(...doorTrim(f, kit))
    for (const [a, b] of spans(doors, t0, t1, STUB)) {
      for (const m of run(a, b, 0, STUB)) {
        m.userData.cutaway = true
        m.visible = false
        shell.add(m)
      }
    }
  }
  // Corners the seated back wall leaves open, filled to full height.
  for (const f of frames.filter((k) => sideOf(k) === 'back')) {
    const T = f.wall.thickness
    for (const t of [0, f.c.length]) {
      const post = piece(f, t - T / 2, t + T / 2, 0, f.wall.height, T, 0, kit.shellWall)
      post.castShadow = true
      shell.add(post)
    }
  }
  const base = new THREE.Mesh(new THREE.BoxGeometry(ox1 - ox0 + 0.08, BASE, oz1 - oz0 + 0.08), kit.cut)
  base.position.set((ox0 + ox1) / 2, -BASE / 2 - 0.002, (oz0 + oz1) / 2)
  base.receiveShadow = true
  shell.add(base)
  shell.add(contactShadow(kit, ox1 - ox0, oz1 - oz0, (ox0 + ox1) / 2, (oz0 + oz1) / 2, YARD_TOP + 0.003, 0.5, options.final ?? true))

  return { seat, shell, floor: floorMesh(plan, room, kit), rooms }
}

/**
 * The plan's other rooms, built as the shell builds walls: full height around
 * their openings, a cap on top, a low stub that stands in when the camera is
 * outside, and a base under the floor. A wall shared with the first room is that
 * room's to draw; a wall two other rooms share is drawn once.
 */
function otherRooms(plan: Plan, first: Room, kit: Kit): THREE.Group | null {
  const others = plan.rooms.filter((r) => r !== first)
  if (!others.length) return null
  const group = new THREE.Group()
  group.name = 'build rooms'
  const drawn = new Set(roomWalls(plan, first).map(({ wall }) => wall.id))
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
      group.add(...doorTrim(f, kit))
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
    const floor = floorMesh(plan, room, kit)
    floor.name = 'build room floor'
    floor.userData.room = room.id
    group.add(floor)
  }
  return group
}

/** The plank floor inside the walls, curved walls and all; boards keep their size and stay put as walls move. */
function floorMesh(plan: Plan, room: Room, kit: Kit): THREE.Mesh {
  const ring = outline(plan, room, plan.walls[0].thickness / 2)
  const x0 = Math.min(...ring.map((p) => p[0])), z1 = Math.max(...ring.map((p) => p[1]))
  const tris = THREE.ShapeUtils.triangulateShape(ring.map(([x, z]) => new THREE.Vector2(x, z)), [])
  const position: number[] = [], uv: number[] = [], normal: number[] = []
  for (const [x, z] of ring) {
    position.push(x, 0, z)
    normal.push(0, 1, 0)
    uv.push((x - x0) / KITCHEN_FLOOR.w, (z1 - z) / KITCHEN_FLOOR.d)
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
  const m = new THREE.Mesh(geo, kit.isoFloor)
  m.receiveShadow = true
  m.name = 'build floor'
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

/** Inside-floor polygon of a room, for the size label and checks. */
export function innerOutline(plan: Plan, room: Room): P[] {
  return outline(plan, room, plan.walls[0].thickness / 2)
}
