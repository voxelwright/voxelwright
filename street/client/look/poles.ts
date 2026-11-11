// The poles and the wires over the street (#136). Where the world has a lamp post, the page
// draws what stands on such a street: a tall pole of weathered wood, a crossarm of power lines
// at its top, a transformer on some, a thicker cable lower down, and a street light on an arm
// out over the road. Wires hang from pole to pole down each side and on past the block's ends,
// cross the street once, and drop to the house fronts.
import * as THREE from 'three/webgpu'
import { float, mix, positionWorld, sin, vertexColor } from 'three/tsl'
import { Mesher, rgb, type P3 } from './mesher.ts'
import { made } from './surfaces.ts'

export interface Pole { at: P3; /** Which side of the street it stands on: its light reaches the other way. */ side: number; light: boolean; can?: boolean }
/** A wire from one point to another, and how far it hangs below the straight line at its middle. */
export interface Wire { from: P3; to: P3; sag: number; thick?: number }

const TALL = 10.4, ARM = 9.7, LOW = 8.6, CABLE = 6.7, LIGHT = 7.5
const WOOD = rgb('#77695a'), DARK = rgb('#22272b'), GREY = rgb('#8f9498'), GLASS = rgb('#6b7f8a')

/** Where on a pole each of its wires is tied: four on the top arm, two on the lower, the cable on the pole itself. */
export const ties = (p: Pole): P3[] => [...[-1.05, -0.45, 0.45, 1.05].map((x): P3 => [p.at[0] + x, p.at[1] + ARM + 0.12, p.at[2]]), ...[-0.6, 0.6].map((x): P3 => [p.at[0] + x, p.at[1] + LOW + 0.12, p.at[2]]), [p.at[0] - p.side * 0.16, p.at[1] + CABLE, p.at[2]]]

/** `thick` is how many times its own thickness each wire is drawn: on the light tier, with no smoothing of edges to speak of, a wire thinner than a pixel breaks into dots, so there it is drawn three times as thick. */
export function poles(list: Pole[], wires: Wire[], thick = 1): THREE.Group {
  const wood = new Mesher(), metal = new Mesher(), lamp = new Mesher(), line = new Mesher()
  for (const p of list) {
    const [x, y, z] = p.at
    wood.post([x, y - 0.3, z], 0.17, TALL + 0.3, WOOD, 10, 0.11)
    wood.box([x, y + ARM, z], [1.2, 0.055, 0.06], WOOD)
    wood.box([x, y + LOW, z], [0.75, 0.05, 0.055], WOOD)
    // A brace under each arm, and a glass insulator under each wire.
    for (const [high, wide] of [[ARM, 0.7], [LOW, 0.45]]) for (const way of [-1, 1]) metal.bar([x, y + high - 0.55, z + 0.07], [x + way * wide, y + high - 0.04, z + 0.07], 0.012, DARK, 4)
    for (const tie of ties(p).slice(0, 6)) metal.post([tie[0], tie[1] - 0.12, tie[2]], 0.035, 0.11, GLASS, 6, 0.02)
    if (p.can) {
      metal.post([x + 0.34, y + LOW - 1.35, z], 0.24, 0.85, GREY, 12)
      metal.box([x + 0.15, y + LOW - 0.9, z], [0.12, 0.03, 0.03], DARK)
    }
    // Steps for whoever climbs it, a band, and a paper stapled at head height.
    for (let i = 0; i < 6; i++) metal.box([x + (i % 2 ? 0.16 : -0.16), y + 3.2 + i * 0.45, z], [0.06, 0.008, 0.008], DARK)
    wood.box([x - p.side * 0.165, y + 1.55, z], [0.004, 0.14, 0.1], rgb('#e9e4d6'))
    if (p.light) {
      // The light: an arm that rises out over the road and a flat head, its lens underneath.
      const reach = -p.side * 2.1
      metal.bar([x, y + LIGHT - 0.5, z], [x + reach * 0.5, y + LIGHT + 0.12, z], 0.035, GREY, 6)
      metal.bar([x + reach * 0.5, y + LIGHT + 0.12, z], [x + reach, y + LIGHT + 0.12, z], 0.035, GREY, 6)
      metal.box([x + reach * 1.12, y + LIGHT + 0.1, z], [0.36, 0.07, 0.15], GREY)
      lamp.box([x + reach * 1.15, y + LIGHT + 0.02, z], [0.22, 0.02, 0.1], [1, 0.93, 0.74])
    }
  }
  // Each wire hangs in a curve, laid as short straight lengths.
  for (const w of wires) {
    const steps = Math.max(4, Math.ceil(Math.hypot(w.to[0] - w.from[0], w.to[2] - w.from[2]) / 3))
    const at = (t: number): P3 => [w.from[0] + (w.to[0] - w.from[0]) * t, w.from[1] + (w.to[1] - w.from[1]) * t - 4 * w.sag * t * (1 - t), w.from[2] + (w.to[2] - w.from[2]) * t]
    for (let i = 0; i < steps; i++) line.bar(at(i / steps), at((i + 1) / steps), (w.thick ?? 0.011) * thick, DARK, 4)
  }
  // Old wood: grey, split along its grain.
  const p = positionWorld, grain = sin(p.x.add(p.z).mul(70).add(sin(p.y.mul(3.1)).mul(2))).mul(0.5).add(0.5)
  const timber = made({ color: mix(vertexColor().rgb.mul(0.7), vertexColor().rgb.mul(1.1), grain), roughness: float(0.9), height: grain.mul(0.004) })
  const iron = new THREE.MeshStandardNodeMaterial({ roughness: 0.55, metalness: 0.5 })
  iron.colorNode = vertexColor().rgb
  const glow = new THREE.MeshStandardNodeMaterial({ roughness: 0.3 })
  glow.colorNode = vertexColor().rgb
  glow.emissiveNode = vertexColor().rgb.mul(0.6)
  const wire = new THREE.MeshStandardNodeMaterial({ roughness: 0.7, metalness: 0 })
  wire.colorNode = vertexColor().rgb.mul(0.5)
  const group = new THREE.Group()
  group.name = 'the poles'
  for (const [name, mesher, material] of [['wood', wood, timber], ['metal', metal, iron], ['lamps', lamp, glow], ['wires', line, wire]] as const) {
    if (!mesher.triangles) continue
    const mesh = new THREE.Mesh(mesher.geometry(), material)
    mesh.name = `poles ${name}`
    // A wire's shadow is thinner than the shadow map can hold: drawn, it lies across the street as a broad stripe.
    mesh.castShadow = name !== 'lamps' && name !== 'wires'
    mesh.receiveShadow = name !== 'wires'
    group.add(mesh)
  }
  return group
}
