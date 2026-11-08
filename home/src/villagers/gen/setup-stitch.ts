// #47 setup, dev only: the made villager comes together on the mat, part by part
// (body, head, ears, eyes, hands, feet, accessories, prop), and then stands on
// the table as a puppet that breathes, blinks, hops and looks at you. The walk
// rig plants feet on the floor, so on the table this file animates the Figure
// itself; the rig takes over once the villager hops down.
import * as THREE from 'three/webgpu'
import { hue, materialColor, uniform } from 'three/tsl'
import type { Figure } from '../rig'

export interface Piece { name: string; objects: THREE.Object3D[] }

const size = (o: THREE.Object3D) => {
  const s = new THREE.Box3().setFromObject(o).getSize(new THREE.Vector3())
  return s.x * s.y * s.z
}

/** The average colour of a felt material's painted map (its colour lives there; `color` is white). */
export function feltColour(m: THREE.Material): THREE.Color | null {
  const map = (m as THREE.MeshStandardMaterial).map
  const img = map?.image as CanvasImageSource | undefined
  if (!img) return (m as THREE.MeshStandardMaterial).color?.clone() ?? null
  const c = document.createElement('canvas')
  c.width = c.height = 8
  const g = c.getContext('2d', { willReadFrequently: true })!
  g.drawImage(img, 0, 0, 8, 8)
  const d = g.getImageData(0, 0, 8, 8).data
  let r = 0, gg = 0, b = 0
  for (let i = 0; i < d.length; i += 4) {
    r += d[i]
    gg += d[i + 1]
    b += d[i + 2]
  }
  const n = d.length / 4
  return new THREE.Color().setRGB(r / n / 255, gg / n / 255, b / n / 255, THREE.SRGBColorSpace)
}

/** Same felt colour: the painted map is the base under a little fuzz (about 0.92 of it), so compare hue and saturation closely and lightness loosely. */
const near = (a: THREE.Color, b: THREE.Color) => {
  const x = a.getHSL({ h: 0, s: 0, l: 0 }), y = b.getHSL({ h: 0, s: 0, l: 0 })
  const dh = Math.abs(x.h - y.h)
  return Math.min(dh, 1 - dh) < 0.03 && Math.abs(x.s - y.s) < 0.18 && Math.abs(x.l - y.l) < 0.14
}

/** Felt materials that wear the owner's accent (the scarf): never hue-turned, stitched last as accessories. */
export function accentMeshes(fig: Figure, accent: string): Set<THREE.Mesh> {
  const want = new THREE.Color(accent)
  const out = new Set<THREE.Mesh>()
  const cache = new Map<THREE.Material, boolean>()
  fig.root.traverse((o) => {
    const m = o as THREE.Mesh
    if (!m.isMesh || Array.isArray(m.material)) return
    // assemble.ts marks the accent's parts itself; sampling the painted map covers figures made without it.
    if (m.userData.accent === true) return void out.add(m)
    if (typeof m.userData.colour === 'string') return
    if (!cache.has(m.material)) {
      const c = (m.material as THREE.MeshStandardMaterial).map ? feltColour(m.material) : null
      cache.set(m.material, Boolean(c && near(c, want)))
    }
    if (cache.get(m.material)) out.add(m)
  })
  return out
}

/** The made villager's parts in sewing order. Every mesh belongs to exactly one piece. */
export function pieces(fig: Figure, accent: Set<THREE.Mesh>): Piece[] {
  const meshes = (parent: THREE.Object3D) => parent.children.filter((c): c is THREE.Mesh => (c as THREE.Mesh).isMesh && !accent.has(c as THREE.Mesh))
  const body = meshes(fig.pose).sort((a, b) => size(b) - size(a))
  const headParts = meshes(fig.head).sort((a, b) => size(b) - size(a))
  const skull = headParts[0]
  const skullBox = skull ? new THREE.Box3().setFromObject(skull) : null
  const ears: THREE.Object3D[] = []
  const face: THREE.Object3D[] = []
  for (const m of headParts.slice(1)) {
    const c = new THREE.Box3().setFromObject(m).getCenter(new THREE.Vector3())
    // Above or out to the sides of the head: ears, antlers, tufts, a hat.
    if (skullBox && (c.y > skullBox.max.y - (skullBox.max.y - skullBox.min.y) * 0.25 || c.x > skullBox.max.x - 0.01 || c.x < skullBox.min.x + 0.01)) ears.push(m)
    else face.push(m)
  }
  const held = fig.hands.flatMap((h) => h.children.filter((c) => c.name === 'held'))
  const list: Piece[] = [
    { name: 'body', objects: body },
    { name: 'head', objects: [...(skull ? [skull] : []), ...face] },
    { name: 'ears', objects: ears },
    { name: 'eyes', objects: fig.eyes },
    { name: 'hands', objects: fig.hands },
    { name: 'feet', objects: fig.feet },
    { name: 'accessories', objects: [...accent] },
    { name: 'prop', objects: held },
  ]
  return list.filter((p) => p.objects.length)
}

/** One shared hue turn for every felt material but the accent's. Returns the uniform the colour slider drives. */
export function hueTurn(fig: Figure, accent: Set<THREE.Mesh>) {
  const shift = uniform(0)
  const keep = new Set([...accent].map((m) => m.material as THREE.Material))
  const done = new Set<THREE.Material>()
  let main: THREE.Color | null = null
  let biggest = 0
  fig.root.traverse((o) => {
    const m = o as THREE.Mesh
    if (!m.isMesh || Array.isArray(m.material)) return
    const mat = m.material as THREE.MeshStandardNodeMaterial
    if (keep.has(mat) || !mat.map || done.has(mat)) return
    done.add(mat)
    mat.colorNode = hue(materialColor, shift)
    mat.needsUpdate = true
    const s = size(m)
    if (s > biggest) {
      biggest = s
      main = typeof m.userData.colour === 'string' ? new THREE.Color(m.userData.colour) : feltColour(mat)
    }
  })
  return { shift, main: (main as THREE.Color | null) ?? new THREE.Color('#d9a35f'), count: done.size }
}

const smooth = (u: number) => u * u * (3 - 2 * u)
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a))

/** The villager standing on the table: breathing, blinking, a hop, a turn to look at you, a nod while it speaks. */
export class Puppet {
  /** Where it stands, world space. */
  readonly at = new THREE.Vector3()
  yaw = 0
  /** 0.6 to 1.6: idle sway, bob and glances. */
  energy = 1
  speaking = false
  looking = false
  private hopU = 1
  private blinkAt = 1.5
  private tick = -1
  private glance = 0
  private glanceGoal = 0
  private nextGlance = 1.2
  private jump: { from: THREE.Vector3; to: THREE.Vector3; u: number; seconds: number; height: number; scale0: number; scale1: number; done: () => void } | null = null

  constructor(readonly fig: Figure, at: THREE.Vector3, yaw: number) {
    this.at.copy(at)
    this.yaw = yaw
    this.place()
  }

  hop() {
    this.hopU = 0
  }

  /** Square on to you, a hand up and waggling: goodbye. Resolved when the hand is down again. */
  wave(seconds = 1.4): Promise<void> {
    this.looking = true
    return new Promise((done) => (this.waving = { u: 0, seconds, done }))
  }
  private waving: { u: number; seconds: number; done: () => void } | null = null

  /** A long hop to somewhere else (off the table), growing to `scale` on the way, resolved on landing. */
  leap(to: THREE.Vector3, seconds: number, height: number, scale = this.fig.root.scale.x): Promise<void> {
    return new Promise((done) => (this.jump = { from: this.at.clone(), to: to.clone(), u: 0, seconds, height, scale0: this.fig.root.scale.x, scale1: scale, done }))
  }

  private place() {
    const { root } = this.fig
    root.position.copy(this.at)
    root.rotation.y = this.yaw
  }

  update(dt: number, t: number, camera: THREE.Vector3) {
    const fig = this.fig
    let lift = 0
    let squash = 0
    if (this.jump) {
      const j = this.jump
      j.u = Math.min(1, j.u + dt / j.seconds)
      const fly = smooth(Math.max(0, (j.u - 0.15) / 0.85))
      this.at.lerpVectors(j.from, j.to, fly)
      lift = Math.sin(fly * Math.PI) * j.height
      // It grows to its own size only on the way down, once it is past the stool: shown smaller there (a phone's bench
      // size), growing at the start of the flight would swell it out of the mirror over the rails' controls.
      fig.root.scale.setScalar(j.scale0 + (j.scale1 - j.scale0) * smooth(Math.max(0, (fly - 0.6) / 0.4)))
      squash = j.u < 0.15 ? Math.sin((j.u / 0.15) * Math.PI) * 0.14 : 0
      // It turns toward where it lands once it is in the air past the stool, not while still in front of the mirror
      // (side on, a long villager would reach past the glass).
      const heading = Math.atan2(j.to.x - j.from.x, j.to.z - j.from.z)
      if (fly > 0.4) this.yaw += wrap(heading - this.yaw) * (1 - Math.exp(-dt * 10))
      if (j.u >= 1) {
        this.jump = null
        j.done()
      }
    } else if (this.looking) {
      const toCam = Math.atan2(camera.x - this.at.x, camera.z - this.at.z)
      this.yaw += wrap(toCam - this.yaw) * (1 - Math.exp(-dt * (this.waving ? 7 : 4)))
    }
    let wave = 0
    if (this.waving) {
      const w = this.waving
      w.u = Math.min(1, w.u + dt / w.seconds)
      // Up, three waggles, down.
      wave = Math.sin(Math.PI * Math.min(1, w.u * 1.15)) ** 0.6
      if (w.u >= 1) {
        this.waving = null
        w.done()
      }
    }
    this.hopU = Math.min(1, this.hopU + dt / 0.6)
    if (this.hopU < 1) {
      const u = this.hopU
      lift += Math.sin(Math.min(1, Math.max(0, (u - 0.15) / 0.7)) * Math.PI) * 0.07
      squash += u < 0.15 ? Math.sin((u / 0.15) * Math.PI) * 0.12 : u > 0.85 ? Math.sin(((u - 0.85) / 0.15) * Math.PI) * 0.1 : -0.05
    }
    this.place()
    fig.root.position.y += lift
    // Pose on twos, like the walk rig: twelve poses a second.
    const k = Math.floor(t * 12)
    if (fig.stepped && k === this.tick) return
    this.tick = k
    if (fig.stepped) t = k / 12
    const e = this.energy
    const sy = 1 + Math.sin(t * 2.1 * e) * 0.014 - squash
    const sxz = 1 + (1 - sy) * 0.5
    fig.pose.scale.set(sxz, sy, sxz)
    fig.pose.rotation.set(0.04 * this.speakNod(t), 0, Math.sin(t * 0.9 * e) * 0.03 * e)
    fig.pose.position.y = Math.abs(Math.sin(t * 3 * e)) * 0.006 * (e - 0.6)
    // Glances, then straight at you when looking or speaking.
    this.nextGlance -= 1 / 12
    if (this.nextGlance <= 0) {
      this.glanceGoal = (Math.random() - 0.5) * 0.9
      this.nextGlance = (2.2 + Math.random() * 2.5) / e
    }
    const goal = this.looking && (wave > 0 || this.speaking || Math.sin(t * 0.37) > -0.3) ? 0 : this.glanceGoal
    this.glance += (goal - this.glance) * 0.35
    fig.head.rotation.y = this.glance
    fig.head.rotation.x = -0.12 + (this.speaking ? 0.06 * Math.sin(t * 6) : 0)
    fig.head.rotation.z = Math.sin(t * 1.3 * e) * 0.04 * e
    fig.hands.forEach((h, i) => {
      const rest = h.userData.rest as THREE.Vector3 | undefined
      if (!rest) return
      h.position.copy(rest)
      h.position.y += Math.sin(t * 2.4 * e + i * Math.PI) * 0.006 * e + (this.speaking && i === 1 ? 0.03 * Math.max(0, Math.sin(t * 2.3)) : 0)
      if (i === 0 && wave > 0) {
        // The near hand up beside the head, waggling side to side.
        h.position.y += fig.height * 0.34 * wave
        h.position.x += Math.sin(t * 13) * fig.height * 0.06 * wave
        h.position.z += fig.height * 0.06 * wave
      }
    })
    this.blinkAt -= 1 / 12
    const closed = this.blinkAt < 0.12
    if (this.blinkAt <= 0) this.blinkAt = 2.2 + Math.random() * 3
    for (const eye of fig.eyes) eye.scale.y = closed ? 0.12 : 1
  }

  private speakNod(t: number) {
    return this.speaking ? 1 + 0.5 * Math.sin(t * 3.1) : 0
  }
}
