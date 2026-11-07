// I1, a motivated light hierarchy (#50, regroup 3, `&pools=1`). A theme names warm practical
// pools at the house's focal points (the dining table, the kitchen counter, the sofa, the
// reading chair): each is a soft painted light decal on the floor or the table, plus at most
// one real point light per room. The room's own lights are re-balanced around them, so the
// room reads as one warm refuge in a cool house instead of an even wash.
import * as THREE from 'three/webgpu'
import { glowTexture } from '../world/build'
import type { Hex } from '../tokens'

/** A painted pool of light lying on a surface at height y. `stretch` makes it oval along x and z. */
export interface Pool { x: number; y: number; z: number; r: number; strength: number; color: Hex; stretch?: [number, number] }
/** A real light the theme adds for a focal point. */
export interface Lamp { x: number; y: number; z: number; color: Hex; intensity: number; distance: number }
/** A plugin's light, found by its name or its parent's, pulled further after the theme has shifted it. */
export interface Retint { light: string; color?: Hex; tint?: number; gain?: number; distance?: number }
/** A glowing material (a bulb, a lamp shade) under a named group, its emissive pulled to match its pool. */
export interface Glow { under: string; color: Hex; tint: number }
export interface Pools { pools: Pool[]; lamps: Lamp[]; retint: Retint[]; glows?: Glow[] }

/** Where the focal points stand in the connected house (measured from the plugins' groups). */
const TABLE_TOP = 0.765
const FLOOR = 0.012

const warmPools = (color: Hex, k: number): Pool[] => [
  // The dining table under the pendant, and the floor around it.
  { x: 0.3, y: TABLE_TOP + 0.003, z: 0.3, r: 0.95, strength: 0.55 * k, color, stretch: [1.25, 1] },
  { x: 0.05, y: FLOOR, z: 0.3, r: 2.0, strength: 0.32 * k, color, stretch: [1.25, 1] },
  // The kitchen counter's floor, lit from under the cabinets.
  { x: 2.65, y: FLOOR, z: -1.1, r: 1.1, strength: 0.3 * k, color, stretch: [1.4, 0.8] },
  // The reading chair by the kitchen's standing lamp.
  { x: 2.0, y: FLOOR, z: 1.75, r: 1.0, strength: 0.26 * k, color },
  // The sofa's end, under the lounge lamp.
  { x: 4.35, y: FLOOR, z: 0.1, r: 1.35, strength: 0.32 * k, color, stretch: [1, 1.3] },
]

export const POOLS: Record<string, Pools> = {
  // Neon night: the kitchen must not fall to near-black and the lounge must not glow hot pink.
  // The pendant turns amber and reaches the whole table; the lounge's glow goes cool and low;
  // the magenta rim is halved. Warm pools are the refuge; the city outside stays neon.
  'neon-night': {
    pools: warmPools('#ff9a52', 1),
    lamps: [
      { x: 2.65, y: 1.45, z: -1.35, color: '#ffa860', intensity: 1.5, distance: 2.8 },
      { x: 3.95, y: 1.35, z: -0.35, color: '#ffae68', intensity: 1.4, distance: 3 },
    ],
    retint: [
      { light: 'lamp', color: '#ffae62', tint: 0.85, gain: 1.35, distance: 4.6 },
      { light: 'lounge glow', color: '#4a50ff', tint: 0.8, gain: 0.28 },
      { light: 'rim light', gain: 0.5 },
    ],
    // The pendant's bulb and the reading lamp's shade glow amber over their pools, not magenta.
    glows: [{ under: 'lamp', color: '#ffb066', tint: 0.85 }, { under: 'reading lamp shade', color: '#ffb066', tint: 0.85 }],
  },
  // Blue hour: the warm pendant pool against cool window fill. The lounge's warm glow cools,
  // so the warmth gathers at the table, the counter and the sofa's lamp.
  'blue-hour': {
    pools: warmPools('#ffae60', 0.9),
    lamps: [
      { x: 2.65, y: 1.45, z: -1.35, color: '#ffb070', intensity: 1.1, distance: 2.6 },
      { x: 3.95, y: 1.35, z: -0.35, color: '#ffb070', intensity: 1.2, distance: 3 },
    ],
    retint: [
      { light: 'lamp', color: '#ff9c48', tint: 0.35, gain: 1.15, distance: 4.4 },
      { light: 'lounge glow', color: '#7088e0', tint: 0.6, gain: 0.55 },
      { light: 'sun', gain: 1.35 },
    ],
  },
}

const named = (l: THREE.Object3D, name: string) => l.name === name || l.parent?.name === name

/** Stands a theme's pools and lamps (`stand`), re-balances the room's lights after each theme walk. */
export function pools(scene: THREE.Scene) {
  let stood: { id: string; group: THREE.Group; dispose(): void } | null = null
  // The colour this module last wrote into a light, and the light's own distance: a light whose
  // colour differs has been re-shifted by the theme plugin and is pulled again.
  const written = new Map<THREE.Light, { color: THREE.Color; distance?: number }>()
  const target = new THREE.Color()

  const unstand = () => {
    if (!stood) return
    stood.group.removeFromParent()
    stood.dispose()
    stood = null
  }
  const stand = (id: string, spec: Pools) => {
    if (stood?.id === id) return
    unstand()
    const group = new THREE.Group()
    group.name = 'theme interior pools'
    group.userData.themeOwned = true
    const owned: Array<{ dispose(): void }> = []
    const map = glowTexture()
    owned.push(map)
    for (const p of spec.pools) {
      const geo = new THREE.CircleGeometry(p.r, 40).rotateX(-Math.PI / 2).scale(...(p.stretch ? [p.stretch[0], 1, p.stretch[1]] as const : [1, 1, 1] as const))
      const mat = new THREE.MeshBasicMaterial({
        map, color: new THREE.Color(p.color).multiplyScalar(p.strength), transparent: true, blending: THREE.AdditiveBlending,
        depthWrite: false, fog: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
      })
      const mesh = new THREE.Mesh(geo, mat)
      mesh.position.set(p.x, p.y, p.z)
      mesh.renderOrder = 2
      mesh.raycast = () => {}
      mesh.name = 'light pool'
      group.add(mesh)
      owned.push(geo, mat)
    }
    for (const l of spec.lamps) {
      const light = new THREE.PointLight(l.color, l.intensity, l.distance, 1.5)
      light.position.set(l.x, l.y, l.z)
      light.name = 'pool lamp'
      group.add(light)
      owned.push(light)
    }
    scene.add(group)
    stood = { id, group, dispose: () => owned.forEach((o) => o.dispose()) }
  }

  // Emissives likewise: the colour last written, so a re-shift by the theme plugin is pulled again.
  const glowed = new Map<THREE.MeshStandardMaterial, THREE.Color>()
  const glow = (spec: Pools | null) => {
    const rules = spec?.glows ?? []
    if (!rules.length && !glowed.size) return
    const seen = new Set<THREE.MeshStandardMaterial>()
    scene.traverse((o) => {
      const rule = rules.find((r) => o.name === r.under)
      if (!rule) return
      o.traverse((n) => {
        const m = (n as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined
        if (!m?.emissive || m.emissive.getHex() === 0) return
        seen.add(m)
        const last = glowed.get(m)
        if (last && m.emissive.equals(last)) return
        m.emissive.lerp(target.set(rule.color), rule.tint)
        glowed.set(m, m.emissive.clone())
      })
    })
    // A material no rule holds any more keeps what the theme plugin writes next.
    for (const m of [...glowed.keys()]) if (!seen.has(m)) glowed.delete(m)
  }

  const retint = (spec: Pools | null) => {
    glow(spec)
    const rules = spec?.retint ?? []
    scene.traverse((o) => {
      const l = o as THREE.PointLight
      if (!l.isLight || o.userData.themeOwned || o.parent?.userData.themeOwned) return
      const rule = rules.find((r) => named(l, r.light))
      const last = written.get(l)
      if (!rule) {
        // Not ours (any more): give back its distance; the theme plugin owns its colour.
        if (last) {
          if (last.distance !== undefined) l.distance = last.distance
          written.delete(l)
        }
        return
      }
      if (last && l.color.equals(last.color)) return
      if (rule.color && rule.tint) l.color.lerp(target.set(rule.color), rule.tint)
      if (rule.gain !== undefined) l.color.multiplyScalar(rule.gain)
      const distance = last?.distance ?? (l.distance as number | undefined)
      if (rule.distance !== undefined && distance !== undefined) l.distance = rule.distance
      written.set(l, { color: l.color.clone(), distance })
    })
  }

  return {
    place(id: string | null) {
      const spec = id && Object.hasOwn(POOLS, id) ? POOLS[id] : null
      if (spec && id) stand(id, spec)
      else unstand()
      retint(spec)
    },
    drop() {
      unstand()
      retint(null)
    },
  }
}
