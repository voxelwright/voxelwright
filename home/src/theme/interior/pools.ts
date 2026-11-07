// I1, a motivated light hierarchy (#50, regroup 3, on by default; `&pools=0` turns it off).
// A theme lights the house's own fixtures (the pendant, the light under the kitchen cabinets,
// the lounge's floor lamp behind the sofa, the reading lamp by the armchair) with real point
// lights that fall off tightly around each one, and lays a faint painted pool on the floor
// under each. The room's own lights are re-balanced around them, so the room reads as one warm
// refuge in a cool house instead of an even wash.
//
// Switching cost: the lights stand for as long as the theme plugin is loaded, dark in a look
// that leaves them out. Adding or removing a light changes the light list every lit material is
// compiled against, and a switch to a look with pools then recompiled the whole house in one
// frame (8 s from Golden hour to Neon night). The painted pools share one small pipeline.
import * as THREE from 'three/webgpu'
import { glowTexture } from '../world/build'
import type { Hex } from '../tokens'

/** The house's fixtures, measured from the plugins' groups: each light hangs just under its shade. */
const FIXTURES = {
  // Under the kitchen's wall cabinets, over the counter.
  counter: [2.65, 1.45, -1.35],
  // The lounge's floor lamp, behind the sofa's end (its shade at 3.88, 1.5, -0.45).
  lounge: [3.88, 1.3, -0.45],
  // The reading lamp by the armchair (its shade at 2.26, 1.46, 1.5).
  reading: [2.26, 1.28, 1.5],
} as const
type Fixture = keyof typeof FIXTURES
/** Where the painted pools lie: on the floor, under the pendant and each fixture. */
const SPOTS = {
  dining: [0.3, 0.3],
  counter: [2.6, -1.05],
  lounge: [4.05, -0.05],
  reading: [2.15, 1.55],
} as const
type Spot = keyof typeof SPOTS
const FLOOR = 0.012

/** A painted pool of light on the floor: radius, stretch along x and z, colour times strength. */
export interface Pool { r: number; strength: number; color: Hex; stretch?: [number, number] }
/** A fixture's light: decay 2 is physical, so the light gathers around the fixture. */
export interface Lamp { color: Hex; intensity: number; distance: number; decay?: number }
/** A plugin's light, found by its name or its parent's, pulled further after the theme has shifted it. */
export interface Retint { light: string; color?: Hex; tint?: number; gain?: number; distance?: number; decay?: number }
/** A glowing material (a bulb, a lamp shade) under a named group, its emissive pulled to match its pool. */
export interface Glow { under: string; color: Hex; tint: number }
export interface Pools { pools: Partial<Record<Spot, Pool>>; lamps: Partial<Record<Fixture, Lamp>>; retint: Retint[]; glows?: Glow[] }

export const POOLS: Record<string, Pools> = {
  // Neon night: the kitchen must not fall to near-black and the lounge must not glow hot pink.
  // The pendant turns amber over the table; the counter, the sofa and the armchair each get
  // their own lamp's light; the lounge's glow goes cool and low; the magenta rim is halved.
  'neon-night': {
    pools: {
      dining: { r: 1.45, strength: 0.34, color: '#ff9a52', stretch: [1.2, 1] },
      counter: { r: 0.85, strength: 0.22, color: '#ff9a52', stretch: [1.3, 0.8] },
      lounge: { r: 1.0, strength: 0.26, color: '#ff9a52', stretch: [1, 1.2] },
      reading: { r: 0.8, strength: 0.26, color: '#ff9a52' },
    },
    lamps: {
      counter: { color: '#ffa860', intensity: 1.6, distance: 2.4 },
      lounge: { color: '#ffae68', intensity: 4, distance: 3 },
      reading: { color: '#ffb066', intensity: 2.2, distance: 2.4 },
    },
    retint: [
      { light: 'lamp', color: '#ffae62', tint: 0.85, gain: 2.6, distance: 3.6, decay: 1.6 },
      { light: 'lounge glow', color: '#4a50ff', tint: 0.8, gain: 0.28 },
      { light: 'rim light', gain: 0.5 },
    ],
    // The bulbs and shades glow amber over their pools, not magenta.
    glows: [
      { under: 'lamp', color: '#ffb066', tint: 0.85 },
      { under: 'reading lamp shade', color: '#ffb066', tint: 0.85 },
      { under: 'lounge lamp shade', color: '#ffb066', tint: 0.85 },
    ],
  },
  // Blue hour: the dusk stays blue. Small warm pools gather at the table, the counter, the sofa
  // and the armchair; between them the cool window light carries the room.
  'blue-hour': {
    pools: {
      dining: { r: 1.2, strength: 0.16, color: '#ffae60', stretch: [1.2, 1] },
      counter: { r: 0.8, strength: 0.14, color: '#ffae60', stretch: [1.3, 0.8] },
      lounge: { r: 0.9, strength: 0.18, color: '#ffae60', stretch: [1, 1.2] },
      reading: { r: 0.75, strength: 0.18, color: '#ffae60' },
    },
    lamps: {
      counter: { color: '#ffb070', intensity: 1.0, distance: 2.2 },
      lounge: { color: '#ffb070', intensity: 2.6, distance: 2.8 },
      reading: { color: '#ffb070', intensity: 1.3, distance: 2.2 },
    },
    retint: [
      { light: 'lamp', color: '#ff9c48', tint: 0.4, gain: 1.3, distance: 3.0, decay: 1.8 },
      { light: 'lounge glow', color: '#7088e0', tint: 0.6, gain: 0.55 },
      { light: 'sun', gain: 1.35 },
    ],
  },
}

const named = (l: THREE.Object3D, name: string) => l.name === name || l.parent?.name === name

/** Stands the fixtures' lights and pools once, lights them per theme, re-balances the room's lights after each theme walk. */
export function pools(scene: THREE.Scene) {
  const group = new THREE.Group()
  group.name = 'theme interior pools'
  group.userData.themeOwned = true
  const map = glowTexture()
  const disc = new THREE.CircleGeometry(1, 40).rotateX(-Math.PI / 2)
  const owned: Array<{ dispose(): void }> = [map, disc]
  const decals = {} as Record<Spot, THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>>
  for (const spot of Object.keys(SPOTS) as Spot[]) {
    const material = new THREE.MeshBasicMaterial({
      map, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
    })
    const mesh = new THREE.Mesh(disc, material)
    mesh.position.set(SPOTS[spot][0], FLOOR, SPOTS[spot][1])
    mesh.renderOrder = 2
    mesh.raycast = () => {}
    mesh.name = 'light pool'
    mesh.visible = false
    group.add(mesh)
    owned.push(material)
    decals[spot] = mesh
  }
  const lamps = {} as Record<Fixture, THREE.PointLight>
  for (const fixture of Object.keys(FIXTURES) as Fixture[]) {
    const light = new THREE.PointLight(0xffffff, 0, 1, 2)
    light.position.fromArray(FIXTURES[fixture])
    light.name = 'pool lamp'
    group.add(light)
    owned.push(light)
    lamps[fixture] = light
  }
  scene.add(group)
  let lit: string | null = null

  const light = (id: string | null, spec: Pools | null) => {
    if (lit === id) return
    lit = id
    for (const spot of Object.keys(decals) as Spot[]) {
      const p = spec?.pools[spot], mesh = decals[spot]
      // Hidden in a look without it: additive blending reaches every target of the scene pass,
      // so even a black pool would add to the floor's normal under it.
      mesh.visible = Boolean(p)
      if (!p) continue
      mesh.material.color.set(p.color).multiplyScalar(p.strength)
      mesh.scale.set(p.r * (p.stretch?.[0] ?? 1), 1, p.r * (p.stretch?.[1] ?? 1))
    }
    for (const fixture of Object.keys(lamps) as Fixture[]) {
      const l = spec?.lamps[fixture], lamp = lamps[fixture]
      lamp.intensity = l?.intensity ?? 0
      if (!l) continue
      lamp.color.set(l.color)
      lamp.distance = l.distance
      lamp.decay = l.decay ?? 2
    }
  }

  // The colour this module last wrote into a light, and the light's own distance and decay: a
  // light whose colour differs has been re-shifted by the theme plugin and is pulled again.
  const written = new Map<THREE.Light, { color: THREE.Color; distance?: number; decay?: number }>()
  const target = new THREE.Color()
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
        // Not ours (any more): give back its distance and decay; the theme plugin owns its colour.
        if (last) {
          if (last.distance !== undefined) l.distance = last.distance
          if (last.decay !== undefined) l.decay = last.decay
          written.delete(l)
        }
        return
      }
      if (last && l.color.equals(last.color)) return
      if (rule.color && rule.tint) l.color.lerp(target.set(rule.color), rule.tint)
      if (rule.gain !== undefined) l.color.multiplyScalar(rule.gain)
      const distance = last?.distance ?? (l.distance as number | undefined)
      const decay = last?.decay ?? (l.decay as number | undefined)
      if (distance !== undefined) l.distance = rule.distance ?? distance
      if (decay !== undefined) l.decay = rule.decay ?? decay
      written.set(l, { color: l.color.clone(), distance, decay })
    })
  }

  return {
    place(id: string | null) {
      const spec = id && Object.hasOwn(POOLS, id) ? POOLS[id] : null
      light(spec ? id : null, spec)
      retint(spec)
    },
    drop() {
      retint(null)
      group.removeFromParent()
      owned.forEach((o) => o.dispose())
    },
  }
}
