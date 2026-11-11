// What a hit looks like (#107): bits thrown from where two things met, by what they are made of
// (the same facts the sound is made from, src/sound/palette/impact.ts). Wood and plaster throw
// splinters and chips of their own colour, glazed pottery and glass bright chips, metal on
// something hard throws sparks, and anything landing on a soft or dusty thing raises a puff.
// A set-down raises nothing; a throw does. Sizes are a dollhouse's: a few centimetres, to be
// seen from across the house.
//
// Three instanced meshes (bits, sparks, puffs), drawn only while something flies: at rest
// they are hidden and cost nothing.
import * as THREE from 'three/webgpu'
import type { Context } from 'cordis'
import { own } from '../kernel'
import { material } from '../engine/materials'
import type { PhysicsEvent } from '../engine/events'
import { loudness, reach, voiceOf } from '../sound/palette/impact'

type Impact = Extract<PhysicsEvent, { kind: 'impact' }>
interface Bit { p: THREE.Vector3; v: THREE.Vector3; axis: THREE.Vector3; turn: number; size: THREE.Vector3; colour: THREE.Color; life: number; span: number; floor: number }

/** Below this loudness (0 to 1, sound's own measure) a hit throws nothing. */
const QUIET = 0.34
/** Hits that may throw bits in one frame: a pile collapsing is not a hundred bursts. */
const PER_FRAME = 3
const GRAVITY = 6
const DUST = new THREE.Color('#efe3cc')
const HOT = new THREE.Color(6, 3.2, 0.9)

class Pool {
  readonly mesh: THREE.InstancedMesh
  readonly live: Bit[] = []
  private drawn = 0
  constructor(geometry: THREE.BufferGeometry, mat: THREE.Material, readonly max: number, name: string, private kind: 'bit' | 'spark' | 'puff') {
    this.mesh = new THREE.InstancedMesh(geometry, mat, max)
    this.mesh.name = name
    // Drawn once at no size, so its buffers are made with the house and not in the middle of a first hit.
    this.mesh.setMatrixAt(0, matrix.makeScale(0, 0, 0))
    this.mesh.count = 1
    this.mesh.frustumCulled = false
    this.mesh.castShadow = kind === 'bit'
    this.mesh.setColorAt(0, DUST)
  }
  add(b: Bit) {
    if (this.live.length >= this.max) this.live.shift()
    this.live.push(b)
  }
  step(dt: number) {
    if (!this.live.length) {
      if (this.mesh.visible && this.drawn++ > 2) this.mesh.visible = false
      return
    }
    let n = 0
    for (const b of this.live) {
      b.life -= dt
      if (b.life <= 0) continue
      const u = b.life / b.span
      if (this.kind === 'puff') {
        // Dust drifts up, slows and spreads.
        b.v.multiplyScalar(Math.exp(-dt * 4))
        b.p.addScaledVector(b.v, dt)
        scale.copy(b.size).multiplyScalar((1.9 - u) * Math.min(1, u * 2.2))
        quat.identity()
      } else {
        b.v.y -= GRAVITY * dt
        b.p.addScaledVector(b.v, dt)
        if (b.p.y < b.floor && b.v.y < 0) {
          b.p.y = b.floor
          b.v.set(b.v.x * 0.5, -b.v.y * 0.3, b.v.z * 0.5)
          b.turn *= 0.4
        }
        if (this.kind === 'spark') {
          // A streak along its flight, burning out.
          quat.setFromUnitVectors(UP, dir.copy(b.v).normalize())
          scale.copy(b.size).multiplyScalar(Math.min(1, u * 3))
          scale.y *= 1 + b.v.length() * 0.6
        } else {
          quat.setFromAxisAngle(b.axis, b.turn * (b.span - b.life))
          scale.copy(b.size).multiplyScalar(Math.min(1, u * 4))
        }
      }
      this.mesh.setMatrixAt(n, matrix.compose(b.p, quat, scale))
      this.mesh.setColorAt(n, b.colour)
      this.live[n++] = b
    }
    this.live.length = n
    this.mesh.count = n
    this.mesh.visible = n > 0
    this.mesh.instanceMatrix.needsUpdate = true
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true
  }
}

const matrix = new THREE.Matrix4(), quat = new THREE.Quaternion(), scale = new THREE.Vector3(), dir = new THREE.Vector3(), UP = new THREE.Vector3(0, 1, 0)
const n3 = new THREE.Vector3(), t1 = new THREE.Vector3(), t2 = new THREE.Vector3()

export function impacts(ctx: Context) {
  const group = new THREE.Group()
  group.name = 'impact bits'
  group.userData.body = false // flying bits, not things (src/physics/home.ts)
  const bits = new Pool(new THREE.TetrahedronGeometry(1), new THREE.MeshStandardMaterial({ roughness: 0.7 }), 96, 'bits', 'bit')
  const sparks = new Pool(new THREE.OctahedronGeometry(1), new THREE.MeshBasicMaterial({ toneMapped: false }), 48, 'sparks', 'spark')
  const puffs = new Pool(new THREE.IcosahedronGeometry(1, 1), new THREE.MeshStandardMaterial({ roughness: 1, transparent: true, opacity: 0.34, depthWrite: false }), 32, 'puffs', 'puff')
  const pools = [bits, sparks, puffs]
  for (const p of pools) group.add(p.mesh)
  own(ctx, group)

  let thisFrame = 0
  const colourOf = (name: string) => new THREE.Color(material(name)?.look.color ?? '#c9b089')
  const rand = (lo: number, hi: number) => lo + Math.random() * (hi - lo)

  /** Bits thrown from a point round a normal: `n` of them at about `speed`, made by `make`. */
  const burst = (pool: Pool, e: Impact, n: number, speed: number, spread: number, make: (b: Bit) => void) => {
    n3.set(e.normal.x, e.normal.y, e.normal.z)
    // Away from the floor or the wall, whichever way the normal was reported.
    if (n3.y < -0.3) n3.negate()
    t1.set(n3.y, n3.z, n3.x).cross(n3).normalize()
    t2.crossVectors(n3, t1)
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, out = spread * Math.sqrt(Math.random())
      const v = new THREE.Vector3().copy(n3).multiplyScalar(rand(0.35, 1)).addScaledVector(t1, Math.cos(a) * out).addScaledVector(t2, Math.sin(a) * out).multiplyScalar(speed * rand(0.6, 1.2))
      const b: Bit = { p: new THREE.Vector3(e.at.x, e.at.y, e.at.z), v, axis: new THREE.Vector3(rand(-1, 1), rand(-1, 1), rand(-1, 1)).normalize(), turn: rand(8, 22), size: new THREE.Vector3(1, 1, 1), colour: DUST, life: 0, span: 0, floor: Math.max(0.01, e.at.y - 1.2) }
      make(b)
      b.span = b.life
      pool.add(b)
    }
  }

  ctx.on('village/physics', (e) => {
    if (e.kind !== 'impact' || thisFrame >= PER_FRAME) return
    const loud = loudness(e.impulse * e.impact)
    if (loud < QUIET) return
    thisFrame++
    const k = (loud - QUIET) / (1 - QUIET)
    const voices = e.materials.map(voiceOf)
    const softer = Math.min(voices[0].hard, voices[1].hard)
    // What breaks off is the smaller thing's, unless it is the tougher of the two.
    const small = reach(e.shapes[0]) <= reach(e.shapes[1]) ? 0 : 1
    for (const i of [small, 1 - small]) {
      const v = voices[i], other = voices[1 - i]
      const metal = v.modes.length > 4
      if (metal) {
        if (other.hard >= 0.5 && k > 0.2) burst(sparks, e, Math.round(3 + 9 * k), 2.6, 0.9, (b) => {
          b.size.set(0.006, 0.02, 0.006)
          b.colour = HOT
          b.life = rand(0.16, 0.34)
        })
      } else if (v.hard >= 0.8) {
        if (k > 0.25 && i === small) burst(bits, e, Math.round(2 + 5 * k), 1.7, 0.8, (b) => {
          b.size.setScalar(rand(0.012, 0.024))
          b.colour = colourOf(e.materials[i]).lerp(WHITE, 0.35)
          b.life = rand(0.5, 0.9)
        })
      } else if (v.hard >= 0.4) {
        if (k > 0.35 && i === small) burst(bits, e, Math.round(2 + 5 * k), 1.5, 0.7, (b) => {
          b.size.set(rand(0.006, 0.01), rand(0.02, 0.045), rand(0.005, 0.009))
          b.colour = colourOf(e.materials[i]).lerp(WHITE, 0.15)
          b.life = rand(0.5, 0.9)
        })
      }
    }
    // Dust where anything lands on what is not hard and clean.
    if (softer < 0.75) burst(puffs, e, Math.round(2 + 4 * k), 0.5 + 0.5 * k, 1.3, (b) => {
      b.size.setScalar(rand(0.03, 0.05) * (1 + k))
      b.colour = DUST
      b.life = rand(0.45, 0.75)
    })
  })
  // A thing breaking throws a shower of its own chips.
  ctx.on('village/physics', (e) => {
    if (e.kind !== 'broke') return
    burst(bits, { at: e.at, normal: { x: 0, y: 1, z: 0 } } as Impact, 14, 2, 1.2, (b) => {
      b.size.setScalar(rand(0.01, 0.022))
      b.colour = colourOf(e.material).lerp(WHITE, 0.4)
      b.life = rand(0.5, 1)
    })
  })
  ctx.on('village/frame', (dt) => {
    thisFrame = 0
    for (const p of pools) p.step(Math.min(dt, 0.05))
  })
  return { flying: () => pools.reduce((n, p) => n + p.live.length, 0) }
}

const WHITE = new THREE.Color('#ffffff')
