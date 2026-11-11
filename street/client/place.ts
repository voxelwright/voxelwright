// The land the block stands on (#118), which only the page draws: a hill that runs on past the
// block's ends, down to the bay and up to a crest, laid out in streets like the block's own, and
// rows of houses along them. None of it is in the world process: nothing can go there yet. The
// houses are the block's own kind (src/houses.ts), drawn plainer and all as one mesh.
import * as THREE from 'three/webgpu'
import { abs, float, mod, positionWorld, vec2, vertexColor } from 'three/tsl'
import { GRADE, HALF_L, HALF_W, ROAD } from '../src/ground.ts'
import { DEPTH, LOTS, houseAt, houseFrame, housePieces } from '../src/houses.ts'
import { facade, kit, type Kit } from './look/facade.ts'
import { Mesher, rgb, type P3 } from './look/mesher.ts'
import { distant, fronts, guttered, hillside, made, onGround, paving, tarmac, towers, water, yard } from './look/surfaces.ts'

const LEN = Math.hypot(1, GRADE)
/** Where the block's own ground stops (world z), and how wide the street across each end is. */
const END = HALF_L / LEN, CROSS = 12
/** From one street to the next beside it (two rows of houses and their yards between), and from one block to the next down the hill. */
const BESIDE = 2 * HALF_W + 2 * DEPTH + 14
/** From one block's middle to the next down the hill, in the world's z. */
export const DOWN = 2 * END + CROSS
/** The bay's level, under the block's lowest corner. */
export const SEA = -17
/** How far the land is drawn. */
const FAR_X = 230, UP = -230, FOOT = 190

/** The land's height: the block's own slope carried on, a crest far up the hill, and shoulders that fall to the bay either side. */
export function land(x: number, z: number): number {
  const over = Math.max(0, -z - 100), out = Math.max(0, Math.abs(x) - 125)
  return -GRADE * z - (GRADE * over * over) / 80 - ((out / 50) ** 2) * 14
}

/** The hill as one mesh, open where the block's own ground lies. Its streets are painted by where a point is. */
function hill(): THREE.Mesh {
  const xs: number[] = [], zs: number[] = []
  for (let x = -FAR_X; x <= FAR_X; x += 4) xs.push(x)
  for (let z = UP; z <= FOOT; z += 4) zs.push(z)
  zs.push(-END, END)
  zs.sort((a, b) => a - b)
  const at: number[] = [], index: number[] = []
  for (const z of zs) for (const x of xs) at.push(x, land(x, z) - 0.02, z)
  for (let j = 0; j < zs.length - 1; j++) for (let i = 0; i < xs.length - 1; i++) {
    const x = (xs[i] + xs[i + 1]) / 2, z = (zs[j] + zs[j + 1]) / 2
    if (Math.abs(x) < HALF_W && Math.abs(z) < END) continue
    const a = j * xs.length + i, b = a + 1, c = a + xs.length, d = c + 1
    index.push(a, c, b, b, c, d)
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(at, 3))
  geometry.setIndex(index)
  geometry.computeVertexNormals()
  // Streets down the hill every BESIDE metres, streets across it every DOWN: a roadway between two pavements, yards between the rows.
  // They are the block's own road and pavement carried on (look/surfaces.ts), without its kerb's height.
  const p = onGround, LEN_ = Math.hypot(1, GRADE), across = CROSS / 2 - 2.4
  const fromStreet = mod(positionWorld.x.add(BESIDE / 2), BESIDE).sub(BESIDE / 2)
  const fromCross = mod(positionWorld.z.sub(END + CROSS / 2).add(DOWN / 2), DOWN).sub(DOWN / 2).mul(LEN_)
  const inLane = abs(fromStreet).lessThan(ROAD), inCross = abs(fromCross).lessThan(across)
  const street = abs(fromStreet).lessThan(HALF_W).or(abs(fromCross).lessThan(CROSS / 2))
  let road = guttered(tarmac(p), p, fromStreet, ROAD, inCross.select(float(0), float(1)))
  road = guttered(road, vec2(p.y, p.x), fromCross, across, inLane.select(float(0), float(1)))
  const walk = paving(p, 0), green = yard(p), isRoad = inLane.or(inCross)
  const material = made({
    color: isRoad.select(road.color, street.select(walk.color, green.color)),
    roughness: isRoad.select(road.roughness, street.select(walk.roughness, green.roughness)),
    height: isRoad.select(road.height, street.select(walk.height, green.height)),
  })
  const mesh = new THREE.Mesh(geometry, material)
  mesh.name = 'the hill'
  mesh.receiveShadow = true
  return mesh
}


/** Which blocks of the block's own street are near enough to be built as the block's own houses are, plainly: the two down the hill and the one up it. */
const NEAR = [-1, 1, 2]

/** Every house round the block: the nearest in the block's own kind, the rest as painted boxes written straight into one mesh's arrays, a colour a corner. */
function rows(): THREE.Object3D[] {
  const at: number[] = [], normal: number[] = [], color: number[] = [], plain: number[] = [], index: number[] = []
  const m = new THREE.Matrix4(), frame = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(), n = new THREE.Vector3(), c = new THREE.Color()
  const one = new THREE.Vector3(1, 1, 1), up = new THREE.Vector3(0, 1, 0), turn = new THREE.Euler()
  const SIDES: [number, number, number][] = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]
  const near: Kit = kit()
  for (let street = -4; street <= 4; street++) for (let block = -3; block <= 2; block++) {
    if (!street && !block) continue
    for (let lot = 0; lot < LOTS; lot++) for (const side of [-1, 1] as const) {
      const house = houseAt(lot, side, street, block), f = houseFrame(house, street * BESIDE)
      const z = f.at[2] + block * DOWN, floor = land(f.at[0], house.z0 + block * DOWN)
      if (floor < SEA + 1.5) continue
      if (!street && NEAR.includes(block)) { facade(near, house, false, { at: [f.at[0], floor, z], yaw: f.yaw, tilt: 0 }); continue }
      frame.compose(v.set(f.at[0], floor, z), q.setFromAxisAngle(up, f.yaw), one)
      for (const [which, piece] of housePieces(house, false).entries()) {
        if (piece.shape.kind !== 'box') continue
        const [hx, hy, hz] = piece.shape.half
        m.compose(v.set(...piece.at), q.setFromEuler(turn.set(...(piece.turn ?? [0, 0, 0]))), one).premultiply(frame)
        c.set(piece.paint ?? house.wall)
        for (const [sx, sy, sz] of SIDES) {
          // The four corners of the face that looks along (sx, sy, sz), wound so it faces out.
          const first = at.length / 3
          const u: [number, number, number] = sx ? [0, 1, 0] : sy ? [0, 0, 1] : [1, 0, 0], w: [number, number, number] = [sy * u[2] - sz * u[1], sz * u[0] - sx * u[2], sx * u[1] - sy * u[0]]
          for (const [a, b] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
            v.set((sx + a * u[0] + b * w[0]) * hx, (sy + a * u[1] + b * w[1]) * hy, (sz + a * u[2] + b * w[2]) * hz).applyMatrix4(m)
            at.push(v.x, v.y, v.z)
            n.set(sx, sy, sz).transformDirection(m)
            normal.push(n.x, n.y, n.z)
            color.push(c.r, c.g, c.b)
            // The house's own block, on its back and its sides: bare wall, which the material paints windows on.
            plain.push(which === 0 && sx <= 0 && !sy ? 1 : 0)
          }
          index.push(first, first + 1, first + 2, first, first + 2, first + 3)
        }
      }
    }
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(at, 3))
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normal, 3))
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(color, 3))
  geometry.setAttribute('plain', new THREE.Float32BufferAttribute(plain, 1))
  geometry.setIndex(index)
  const mesh = new THREE.Mesh(geometry, distant())
  mesh.name = 'the rows'
  const looks = fronts()
  const built = (Object.entries(near) as [keyof Kit, Mesher][]).filter(([, mesher]) => mesher.triangles).map(([name, mesher]) => {
    const part = new THREE.Mesh(mesher.geometry(), looks[name])
    part.name = `the next blocks ${name}`
    part.castShadow = name === 'boards' || name === 'plaster' || name === 'trim'
    part.receiveShadow = true
    return part
  })
  return [mesh, ...built]
}

/** A box of the far scenery, laid into `into` to be drawn as one mesh. */
const beam = (into: THREE.BufferGeometry[], size: [number, number, number], at: [number, number, number], turn = 0) => {
  into.push(new THREE.BoxGeometry(...size).rotateZ(turn).translate(...at))
}

/**
 * A red suspension bridge across the mouth of the bay, one tower standing where the street points: the far end
 * of the view down the hill. Towers, a deck, two cables hung between them and the rods that carry the deck.
 */
function bridge(): THREE.Mesh {
  const parts: THREE.BufferGeometry[] = []
  const Z = 400, DECK = SEA + 24, TOP = SEA + 82, TOWERS = [-178, 22], SHORE = [-470, 314]
  for (const x of TOWERS) {
    for (const z of [-7, 7]) beam(parts, [6, TOP - SEA, 5], [x, (TOP + SEA) / 2, Z + z])
    for (const y of [DECK - 5, DECK + 20, DECK + 38, TOP - 3]) beam(parts, [5, 4, 14], [x, y, Z])
  }
  beam(parts, [SHORE[1] - SHORE[0], 2.6, 15], [(SHORE[0] + SHORE[1]) / 2, DECK, Z])
  // The cable hangs in three sags: shore to tower, tower to tower, tower to shore. Each is laid as short straight lengths.
  const spans: [number, number, number, number, number][] = [[SHORE[0], DECK + 1, TOWERS[0], TOP, 0.35], [TOWERS[0], TOP, TOWERS[1], TOP, 1], [TOWERS[1], TOP, SHORE[1], DECK + 1, 0.35]]
  for (const [x0, y0, x1, y1, sag] of spans) {
    const steps = Math.ceil((x1 - x0) / 8), drop = sag * (TOP - DECK - 4)
    const hang = (t: number) => y0 + (y1 - y0) * t - 4 * drop * t * (1 - t)
    for (let i = 0; i < steps; i++) {
      const ta = i / steps, tb = (i + 1) / steps, xa = x0 + (x1 - x0) * ta, xb = x0 + (x1 - x0) * tb, ya = hang(ta), yb = hang(tb)
      for (const z of [-7, 7]) beam(parts, [Math.hypot(xb - xa, yb - ya) + 0.3, 1.1, 1.1], [(xa + xb) / 2, (ya + yb) / 2, Z + z], Math.atan2(yb - ya, xb - xa))
      if (i % 2 === 0 && ya - DECK > 3) for (const z of [-7, 7]) beam(parts, [0.45, ya - DECK, 0.45], [xa, (ya + DECK) / 2, Z + z])
    }
  }
  const geometry = merged(parts)
  const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardNodeMaterial({ color: '#b02a12', roughness: 0.6, metalness: 0 }))
  mesh.name = 'the bridge'
  return mesh
}

/** The hills across the bay: one long ridge, a height at each step from a few slow waves. */
function headlands(): THREE.Mesh {
  const at: number[] = [], index: number[] = []
  const Z = 560, STEP = 20, FROM = -900, TO = 900, DEEP = 260
  const high = (x: number) => 34 + 30 * Math.sin(x * 0.0061 + 1.3) + 16 * Math.sin(x * 0.017 + 0.4) + 7 * Math.sin(x * 0.043)
  for (let x = FROM, i = 0; x <= TO; x += STEP, i++) {
    // A foot at the water, a brow, and the far side, falling away.
    const h = Math.max(6, high(x)) * smoothstep01((x - FROM) / 300) * smoothstep01((TO - x) / 300)
    at.push(x, SEA - 1, Z, x, SEA + h * 0.7, Z + DEEP * 0.3, x, SEA + h, Z + DEEP * 0.6, x, SEA - 1, Z + DEEP)
    if (x + STEP <= TO) for (let k = 0; k < 3; k++) { const a = i * 4 + k, b = a + 4; index.push(a, a + 1, b, b, a + 1, b + 1) }
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(at, 3))
  geometry.setIndex(index)
  geometry.computeVertexNormals()
  const mesh = new THREE.Mesh(geometry, made(hillside(positionWorld.y.sub(SEA)), 0))
  mesh.name = 'the headlands'
  return mesh
}
const smoothstep01 = (t: number) => { const k = Math.max(0, Math.min(1, t)); return k * k * (3 - 2 * k) }

/** Several geometries as one, with only where their corners are and which way they face. */
function merged(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const at: number[] = [], normal: number[] = [], index: number[] = []
  for (const part of parts) {
    const first = at.length / 3
    at.push(...(part.getAttribute('position').array as Float32Array))
    normal.push(...(part.getAttribute('normal').array as Float32Array))
    for (const i of part.getIndex()!.array) index.push(first + i)
    part.dispose()
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(at, 3))
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normal, 3))
  geometry.setIndex(index)
  return geometry
}

/**
 * The city over the top of the hill: towers that stand beyond its crest, seen up the street between the rows. Tall in the
 * middle and lower to either side, each stepped back once or twice as it rises; among them a slim pyramid and one tower
 * taller than the rest with rounded shoulders.
 */
function skyline(): THREE.Mesh {
  const m = new Mesher(), FOOT_Y = -12
  let seed = 20261111
  const some = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296 }
  const PAINTS = ['#c9c4b8', '#aeb6bd', '#8f9aa6', '#d8d2c4', '#7f8b96', '#b8a999', '#9aa7ad'].map(rgb)
  const block = (x: number, z: number, wide: number, deep: number, from: number, to: number, paint: P3) => m.box([x, FOOT_Y + (from + to) / 2, z], [wide / 2, (to - from) / 2, deep / 2], paint, '-y')
  for (let i = 0; i < 54; i++) {
    const x = (some() - 0.5) * 700, z = -640 - some() * 280, middle = Math.max(0, 1 - Math.abs(x) / 360)
    const wide = 20 + some() * 26, deep = 20 + some() * 26, tall = 30 + some() * 40 + some() * some() * 120 * middle, paint = PAINTS[Math.floor(some() * PAINTS.length)]
    const steps = tall > 150 ? 3 : tall > 90 ? 2 : 1
    for (let k = 0; k < steps; k++) block(x, z, wide * (1 - k * 0.18), deep * (1 - k * 0.18), k ? tall * (0.55 + 0.2 * k) : 0, k === steps - 1 ? tall : tall * (0.55 + 0.2 * (k + 1)), paint)
    if (some() > 0.6) block(x + (some() - 0.5) * wide * 0.3, z, 3, 3, tall, tall + 8 + some() * 14, rgb('#6f757b'))
  }
  // The pyramid: four faces to a point, a spire on it.
  const px = 90, pz = -690, half = 20, tall = 165, pale = rgb('#d9d6cc')
  const corners: P3[] = [[px - half, FOOT_Y, pz + half], [px + half, FOOT_Y, pz + half], [px + half, FOOT_Y, pz - half], [px - half, FOOT_Y, pz - half]], tip: P3 = [px, FOOT_Y + tall, pz]
  for (let i = 0; i < 4; i++) m.tri(corners[i], corners[(i + 1) % 4], tip, pale)
  m.box([px, FOOT_Y + tall + 12, pz], [0.8, 14, 0.8], pale)
  // The tallest: a shaft that draws in towards a rounded crown.
  const tx = -70, tz = -740, glass = rgb('#8fa3b3')
  for (const [from, to, size] of [[0, 130, 28], [130, 162, 25], [162, 184, 21], [184, 198, 15], [198, 206, 9]]) block(tx, tz, size, size, from, to, glass)
  const mesh = new THREE.Mesh(m.geometry(), towers())
  mesh.name = 'the city'
  return mesh
}

/**
 * The waterfront at the foot of the hill, where the streets end: a quay along the shore, piers out into the bay with long
 * sheds on them, and a hall with a clock tower.
 */
function waterfront(): THREE.Mesh {
  const m = new Mesher(), shore = -(SEA + 1.3) / GRADE, top = SEA + 1.3
  const STONE = rgb('#b9b4a8'), DECK = rgb('#8f8577'), SHED = rgb('#e9e2cf'), ROOF = rgb('#7b6f66'), CLOCK = rgb('#f3efe2'), CAP = rgb('#6f8f7a')
  m.box([0, top - 2.2, shore + 7], [132, 2.2, 9], STONE, '-y')
  // Bollards along its edge, a pace thick, every eight metres.
  for (let x = -128; x <= 128; x += 8) m.box([x, top + 0.45, shore + 15.4], [0.3, 0.45, 0.3], rgb('#4a4d50'), '-y')
  for (const x of [-98, -52, 52, 98]) {
    m.box([x, top - 2.3, shore + 52], [9, 2.2, 36], DECK, '-y')
    m.box([x, top + 3.2, shore + 50], [7, 3.3, 31], SHED, '-y')
    // Its roof: two slopes to a ridge along the pier, and a gable at each end.
    for (const side of [-1, 1]) m.quad([x + side * 7.4, top + 6.3, shore + (side > 0 ? 81.5 : 18.5)], [x + side * 7.4, top + 6.3, shore + (side > 0 ? 18.5 : 81.5)], [x, top + 9.2, shore + (side > 0 ? 18.5 : 81.5)], [x, top + 9.2, shore + (side > 0 ? 81.5 : 18.5)], ROOF)
    m.tri([x - 7, top + 6.5, shore + 19], [x, top + 9.2, shore + 19], [x + 7, top + 6.5, shore + 19], SHED)
    m.tri([x + 7, top + 6.5, shore + 81], [x, top + 9.2, shore + 81], [x - 7, top + 6.5, shore + 81], SHED)
  }
  // A hall and its clock tower between two of the piers, to one side of the street's own line: from the street the view down
  // the hill stays the water and the bridge, and from a roof the tower stands over the sheds.
  const hx = 74, hz = shore + 9
  m.box([hx, top + 3.5, hz], [15, 3.5, 5], SHED, '-y')
  m.box([hx, top + 7.3, hz], [15.8, 0.3, 5.6], ROOF)
  m.box([hx, top + 11, hz], [2.4, 11, 2.4], SHED, '-y')
  m.box([hx, top + 18.5, hz], [2.7, 2, 2.7], CLOCK)
  m.box([hx, top + 18.5, hz], [1.2, 1.2, 2.76], rgb('#3a4046'))
  m.box([hx, top + 18.5, hz], [2.76, 1.2, 1.2], rgb('#3a4046'))
  const peak: P3 = [hx, top + 28, hz], eave = top + 22
  const round: P3[] = [[hx - 2.6, eave, hz + 2.6], [hx + 2.6, eave, hz + 2.6], [hx + 2.6, eave, hz - 2.6], [hx - 2.6, eave, hz - 2.6]]
  for (let i = 0; i < 4; i++) m.tri(round[i], round[(i + 1) % 4], peak, CAP)
  const look = new THREE.MeshStandardNodeMaterial({ roughness: 0.85, metalness: 0 })
  look.colorNode = vertexColor().rgb
  const mesh = new THREE.Mesh(m.geometry(), look)
  mesh.name = 'the waterfront'
  return mesh
}

/** The bay: a flat sheet of water at its level, which shows the sky. */
function bay(): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2400, 2400).rotateX(-Math.PI / 2), water())
  mesh.position.y = SEA
  mesh.name = 'the bay'
  return mesh
}

/** Stands the land in the scene, and lowers the home's sea of cloud to be the bay. Returns what it added, with how much it is. */
export function place(scene: THREE.Scene): { triangles: number } {
  const all = [hill(), ...rows(), bridge(), headlands(), bay(), skyline(), waterfront()] as THREE.Mesh[]
  scene.add(...all)
  return { triangles: all.reduce((n, mesh) => n + (mesh.geometry.index?.count ?? mesh.geometry.getAttribute('position').count) / 3, 0) }
}
