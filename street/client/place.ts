// The land the block stands on (#118), which only the page draws: a hill that runs on past the
// block's ends, down to the bay and up to a crest, laid out in streets like the block's own, and
// rows of houses along them. None of it is in the world process: nothing can go there yet. The
// houses are the block's own kind (src/houses.ts), drawn plainer and all as one mesh.
import * as THREE from 'three/webgpu'
import { abs, cameraPosition, mix, mod, positionWorld, smoothstep, vec3, vertexColor } from 'three/tsl'
import { SKY } from '../../home/src/sky'
import { GRADE, HALF_L, HALF_W, ROAD } from '../src/ground.ts'
import { DEPTH, LOTS, houseAt, houseFrame, housePieces } from '../src/houses.ts'

const LEN = Math.hypot(1, GRADE)
/** Where the block's own ground stops (world z), and how wide the street across each end is. */
const END = HALF_L / LEN, CROSS = 12
/** From one street to the next beside it (two rows of houses and their yards between), and from one block to the next down the hill. */
const BESIDE = 2 * HALF_W + 2 * DEPTH + 14, DOWN = 2 * END + CROSS
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
  const p = positionWorld
  const fromStreet = abs(mod(p.x.add(BESIDE / 2), BESIDE).sub(BESIDE / 2))
  const fromCross = abs(mod(p.z.sub(END + CROSS / 2).add(DOWN / 2), DOWN).sub(DOWN / 2))
  const road = fromStreet.lessThan(ROAD).or(fromCross.lessThan(CROSS / 2 - 2.4))
  const street = fromStreet.lessThan(HALF_W).or(fromCross.lessThan(CROSS / 2))
  const yard = mix(vec3(...new THREE.Color('#86ad6b').toArray()), vec3(...new THREE.Color('#b3b87c').toArray()), smoothstep(-1, 1, p.x.mul(0.21).sin().add(p.z.mul(0.17).sin())))
  const ground = road.select(vec3(...new THREE.Color('#6d6e72').toArray()), street.select(vec3(...new THREE.Color('#c9c3b6').toArray()), yard))
  const material = new THREE.MeshStandardNodeMaterial({ roughness: 1, metalness: 0 })
  material.colorNode = hazed(ground)
  const mesh = new THREE.Mesh(geometry, material)
  mesh.name = 'the hill'
  mesh.receiveShadow = true
  return mesh
}

/** A colour as the air leaves it: what is far goes towards the sky's own pale blue (`most` is how far towards it, at the farthest). */
function hazed(color: THREE.Node<'vec3'>, most = 0.72): THREE.Node<'vec3'> {
  const far = smoothstep(60, 330, positionWorld.sub(cameraPosition).length())
  return mix(color, vec3(...new THREE.Color(SKY.horizon).toArray()), far.mul(most))
}

/** Every house round the block, as one mesh: boxes written straight into its arrays, a colour a corner. */
function rows(): THREE.Mesh {
  const at: number[] = [], normal: number[] = [], color: number[] = [], index: number[] = []
  const m = new THREE.Matrix4(), frame = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(), n = new THREE.Vector3(), c = new THREE.Color()
  const one = new THREE.Vector3(1, 1, 1), up = new THREE.Vector3(0, 1, 0), turn = new THREE.Euler()
  const SIDES: [number, number, number][] = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]
  for (let street = -4; street <= 4; street++) for (let block = -3; block <= 2; block++) {
    if (!street && !block) continue
    for (let lot = 0; lot < LOTS; lot++) for (const side of [-1, 1] as const) {
      const house = houseAt(lot, side, street, block), f = houseFrame(house, street * BESIDE)
      const z = f.at[2] + block * DOWN, floor = land(f.at[0], house.z0 + block * DOWN)
      if (floor < SEA + 1.5) continue
      frame.compose(v.set(f.at[0], floor, z), q.setFromAxisAngle(up, f.yaw), one)
      for (const piece of housePieces(house, false)) {
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
  geometry.setIndex(index)
  const material = new THREE.MeshStandardNodeMaterial({ roughness: 0.9, metalness: 0 })
  material.colorNode = hazed(vertexColor().rgb)
  const mesh = new THREE.Mesh(geometry, material)
  mesh.name = 'the rows'
  return mesh
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
  const material = new THREE.MeshStandardNodeMaterial({ roughness: 0.8, metalness: 0 })
  material.colorNode = hazed(vec3(...new THREE.Color('#c9432a').toArray()), 0.5)
  const mesh = new THREE.Mesh(geometry, material)
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
  const material = new THREE.MeshStandardNodeMaterial({ roughness: 1, metalness: 0 })
  material.colorNode = hazed(vec3(...new THREE.Color('#7f9a6a').toArray()), 0.62)
  const mesh = new THREE.Mesh(geometry, material)
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

/** Stands the land in the scene, and lowers the home's sea of cloud to be the bay. Returns what it added, with how much it is. */
export function place(scene: THREE.Scene): { triangles: number } {
  const all = [hill(), rows(), bridge(), headlands()]
  scene.add(...all)
  const sea = scene.getObjectByName('cloud sea')
  if (sea) { sea.position.y = SEA; sea.scale.setScalar(5) }
  return { triangles: all.reduce((n, mesh) => n + mesh.geometry.index!.count / 3, 0) }
}
