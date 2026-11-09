// How fire looks (#74): flames, embers and smoke over every burning part, drawn as three
// instanced sets of quads whose motion is all in their shaders (TSL), so the CPU writes a few
// numbers per fire a few times a second and nothing per frame. The light fire gives and the
// char it leaves are the heat field's (heat.ts fieldLook); these are the flames themselves.
// Nothing is drawn while nothing burns.
import * as THREE from 'three/webgpu'
import { abs, cameraPosition, cross, float, Fn, fract, instancedBufferAttribute, mix, mx_fractal_noise_float, mx_noise_float, normalize, positionGeometry, pow, sin, smoothstep, time, uv, vec3, vec4 } from 'three/tsl'
import type { Vec3 } from './core'

export interface Burning { id: string; center: Vec3; half: Vec3; strength: number; fierce: number }

const FLAMES = 96, EMBERS = 160, SMOKE = 48, HALOS = 32

const seeded = (n: number) => {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453
  return x - Math.floor(x)
}

/** An instanced set of quads with three per-instance vec4s: a, b, c. */
function quads(count: number, material: THREE.NodeMaterial, attrs: THREE.InstancedBufferAttribute[]) {
  const geometry = new THREE.PlaneGeometry(1, 1).translate(0, 0.5, 0)
  const mesh = new THREE.InstancedMesh(geometry, material, count)
  mesh.count = 0
  mesh.frustumCulled = false
  mesh.renderOrder = 10
  mesh.userData.body = false
  mesh.castShadow = mesh.receiveShadow = false
  for (const a of attrs) a.setUsage(THREE.DynamicDrawUsage)
  return mesh
}

/** A per-instance vec4. */
const v4 = (a: THREE.InstancedBufferAttribute) => instancedBufferAttribute(a, 'vec4') as unknown as THREE.Node<'vec4'>
const attr = (count: number) => new THREE.InstancedBufferAttribute(new Float32Array(count * 4), 4)

/** Upright quads turned to the camera about the vertical (flames and smoke stay upright). */
const upright = (base: THREE.Node<'vec3'>, width: THREE.Node<'float'>, height: THREE.Node<'float'>) => {
  const toEye = cameraPosition.sub(base)
  const right = normalize(cross(vec3(0, 1, 0), vec3(toEye.x, 0, toEye.z).add(vec3(1e-4, 0, 0))))
  return base.add(right.mul(positionGeometry.x.mul(width))).add(vec3(0, 1, 0).mul(positionGeometry.y.mul(height)))
}

export class Flames {
  readonly group = new THREE.Group()
  private flame = { a: attr(FLAMES), b: attr(FLAMES), mesh: null as unknown as THREE.InstancedMesh }
  private ember = { a: attr(EMBERS), b: attr(EMBERS), mesh: null as unknown as THREE.InstancedMesh }
  private smoke = { a: attr(SMOKE), b: attr(SMOKE), mesh: null as unknown as THREE.InstancedMesh }
  private halo = { a: attr(HALOS), b: attr(HALOS), mesh: null as unknown as THREE.InstancedMesh }

  constructor() {
    this.group.name = 'flames'
    this.group.userData.body = false
    this.flame.mesh = quads(FLAMES, this.flameMaterial(), [this.flame.a, this.flame.b])
    this.ember.mesh = quads(EMBERS, this.emberMaterial(), [this.ember.a, this.ember.b])
    this.smoke.mesh = quads(SMOKE, this.smokeMaterial(), [this.smoke.a, this.smoke.b])
    this.halo.mesh = quads(HALOS, this.haloMaterial(), [this.halo.a, this.halo.b])
    this.group.add(this.halo.mesh, this.smoke.mesh, this.flame.mesh, this.ember.mesh)
    this.group.visible = false
  }

  /** a: base xyz, width. b: height, seed, strength, fierce. */
  private flameMaterial() {
    const a = v4(this.flame.a), b = v4(this.flame.b)
    // Cut out, not blended: solid paper tongues that hide each other properly, never a tinted sheet.
    const m = new THREE.MeshBasicNodeMaterial({ alphaTest: 0.5, side: THREE.DoubleSide })
    m.positionNode = upright(a.xyz, a.w, b.x)
    m.colorNode = Fn(() => {
      const seed = b.y, strength = b.z, t = time.mul(float(1.3).add(seed.mul(0.5)))
      const p = uv()
      // Two octaves of noise scrolling up: the big sway and the small licks.
      const big = mx_noise_float(vec3(p.x.mul(2.4).add(seed.mul(13)), p.y.mul(2.2).sub(t.mul(1.9)), t.mul(0.35)))
      const small = mx_noise_float(vec3(p.x.mul(5.5).add(seed.mul(7)), p.y.mul(4.8).sub(t.mul(3.4)), t.mul(0.6).add(seed)))
      const n = big.mul(0.65).add(small.mul(0.35))
      // Each tongue leans its own way and bends more toward its tip; its sides are not twins.
      const lean = fract(seed.mul(5.7)).sub(0.5).mul(0.6)
      const x0 = p.x.sub(0.5).mul(2).add(n.mul(0.32).mul(p.y)).sub(lean.mul(p.y.mul(p.y)))
      const x = x0.mul(mix(float(1), float(0.8).add(fract(seed.mul(3.1)).mul(0.4)), smoothstep(-0.05, 0.05, x0)))
      // A teardrop, rounded at the root and licking to a point; the noise bites into its sides as it rises.
      const taper = pow(float(1).sub(p.y), 0.8).mul(smoothstep(0, 0.1, p.y).mul(0.3).add(0.7))
      const v = taper.sub(abs(x)).sub(n.mul(0.3).mul(p.y)).sub(0.04)
      // Toon fire for a felt-and-paper home: a thin orange edge, a golden body, a small cream heart.
      const rim = smoothstep(0, 0.03, v)
      const body = smoothstep(0.07, 0.1, v)
      const heart = smoothstep(0.4, 0.44, v.add(float(1).sub(p.y).mul(0.06)))
      const edge = vec3(0.85, 0.16, 0.03), gold = vec3(1.0, 0.4, 0.05), cream = vec3(1.0, 0.72, 0.28)
      const c = mix(mix(edge, gold, body), cream, heart)
      const tip = smoothstep(1, 0.62, p.y)
      // (The heat field's look lights everything in hot air, these flames too: they are drawn darker to land right.)
      // A candle's small flame has a blue root.
      const blue = smoothstep(0.2, 0.0, p.y).mul(float(1).sub(b.w)).mul(0.7)
      return vec4(mix(c, vec3(0.3, 0.42, 1.0), blue).mul(float(0.55).add(heart.mul(0.3))), rim.mul(tip).mul(strength.mul(0.4).add(0.6)))
    })()
    return m
  }

  /** A soft warm glow behind each fire, so the cut-out flames sit in light. a: base xyz, size. b: strength, seed. */
  private haloMaterial() {
    const a = v4(this.halo.a), b = v4(this.halo.b)
    const m = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide })
    m.positionNode = upright(a.xyz.sub(vec3(0, a.w.mul(0.35), 0)), a.w.mul(1.6), a.w)
    m.colorNode = Fn(() => {
      const d = uv().sub(vec3(0.5, 0.4, 0).xy).mul(vec3(1.2, 1, 0).xy).length().mul(2)
      const flick = sin(time.mul(9).add(b.y.mul(40))).mul(0.1).add(sin(time.mul(23).add(b.y.mul(13))).mul(0.06)).add(0.84)
      const g = smoothstep(1, 0, d).pow(2).mul(b.x).mul(flick).mul(0.35)
      return vec4(vec3(1.0, 0.45, 0.1).mul(g), g)
    })()
    return m
  }

  /** a: centre xyz of the part's top, spread x. b: spread z, seed, strength, rise. */
  private emberMaterial() {
    const a = v4(this.ember.a), b = v4(this.ember.b)
    const m = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide })
    const seed = b.y
    const life = fract(time.mul(float(0.35).add(fract(seed.mul(7.13)).mul(0.4))).add(seed))
    const drift = vec3(sin(time.mul(1.7).add(seed.mul(40))).mul(0.12), 0, sin(time.mul(1.3).add(seed.mul(23))).mul(0.12)).mul(life)
    const start = vec3(fract(seed.mul(3.7)).sub(0.5).mul(2).mul(a.w), 0, fract(seed.mul(5.3)).sub(0.5).mul(2).mul(b.x))
    const centre = a.xyz.add(start).add(vec3(0, life.mul(b.w), 0)).add(drift)
    const size = float(0.016).mul(float(1).sub(life.mul(0.6)))
    const toEye = normalize(cameraPosition.sub(centre))
    const right = normalize(cross(vec3(0, 1, 0), toEye.add(vec3(1e-4, 0, 0))))
    const up = cross(toEye, right)
    m.positionNode = centre.add(right.mul(positionGeometry.x.mul(size))).add(up.mul(positionGeometry.y.sub(0.5).mul(size)))
    m.colorNode = Fn(() => {
      const d = uv().sub(0.5).length().mul(2)
      const glow = smoothstep(1, 0, d).mul(smoothstep(1, 0.6, life)).mul(b.z)
      const twinkle = sin(time.mul(20).add(seed.mul(90))).mul(0.3).add(0.7)
      return vec4(mix(vec3(1, 0.75, 0.3), vec3(1, 0.25, 0.04), life).mul(glow.mul(twinkle).mul(3)), glow)
    })()
    return m
  }

  /** a: base xyz, width. b: height, seed, strength, unused. */
  private smokeMaterial() {
    const a = v4(this.smoke.a), b = v4(this.smoke.b)
    const m = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide })
    const seed = b.y
    const life = fract(time.mul(0.12).add(seed))
    const base = a.xyz.add(vec3(sin(time.mul(0.6).add(seed.mul(30))).mul(0.15).mul(life), life.mul(b.x).mul(1.6), 0))
    const grow = life.mul(1.8).add(0.5)
    m.positionNode = upright(base, a.w.mul(grow), a.w.mul(grow))
    m.colorNode = Fn(() => {
      const p = uv()
      const n = mx_fractal_noise_float(vec3(p.mul(2.2).add(seed.mul(9)), time.mul(0.25).add(seed)), 3, 2, 0.5)
      const d = p.sub(0.5).length().mul(2).add(n.mul(0.35))
      const alpha = smoothstep(1, 0.2, d).mul(smoothstep(0, 0.12, life)).mul(smoothstep(1, 0.4, life)).mul(0.32).mul(b.z)
      return vec4(mix(vec3(0.16, 0.14, 0.13), vec3(0.42, 0.4, 0.38), life), alpha)
    })()
    return m
  }

  /** Lays flames, embers and smoke over what burns now (a few times a second: the motion is the shaders'). */
  update(burning: Burning[]) {
    let f = 0, e = 0, s = 0, h = 0
    const ha = this.halo.a.array as Float32Array, hb = this.halo.b.array as Float32Array
    const fa = this.flame.a.array as Float32Array, fb = this.flame.b.array as Float32Array
    const ea = this.ember.a.array as Float32Array, eb = this.ember.b.array as Float32Array
    const sa = this.smoke.a.array as Float32Array, sb = this.smoke.b.array as Float32Array
    const sorted = [...burning].sort((x, y) => y.strength * y.half[0] * y.half[2] - x.strength * x.half[0] * x.half[2])
    for (const [n, fire] of sorted.entries()) {
      const [cx, cy, cz] = fire.center, [hx, hy, hz] = fire.half
      const area = 4 * hx * hz
      // Many small tongues over a big fire, not one big cone.
      const k = Math.max(1, Math.min(9, Math.round(area / 0.025)))
      const width = Math.min(0.2, Math.max(0.015, Math.sqrt(area / k) * 0.95)) * (0.3 + 0.7 * fire.fierce) * (0.55 + 0.45 * fire.strength)
      const height = width * (1.5 + 0.8 * fire.fierce) * (0.6 + 0.5 * fire.strength)
      const seed = seeded(n + cx * 13 + cz * 7)
      for (let i = 0; i < k && f < FLAMES; i++, f++) {
        // Spread over the top face, a little in from its edges, and sunk into it so a flame grows out of the surface.
        const u = k === 1 ? 0 : (seeded(seed * 31 + i) - 0.5) * 1.4, v = k === 1 ? 0 : (seeded(seed * 17 + i * 3) - 0.5) * 1.4
        fa.set([cx + u * hx, cy + hy - Math.min(hy, width) * 0.35, cz + v * hz, width * (0.8 + 0.4 * seeded(i + seed))], f * 4)
        fb.set([height * (0.6 + 0.8 * seeded(i * 7 + seed)), seeded(seed + i * 11), fire.strength, fire.fierce], f * 4)
      }
      // A tall part (a bookcase) burns up its front too.
      if (hy > 0.35) for (let i = 0; i < 2 && f < FLAMES; i++, f++) {
        fa.set([cx + (i ? 0.5 : -0.5) * hx, cy - hy * 0.2 + i * hy * 0.5, cz + (i ? -0.5 : 0.5) * hz, width], f * 4)
        fb.set([height, seeded(seed + 50 + i), fire.strength * 0.85, fire.fierce], f * 4)
      }
      if (h < HALOS) {
        ha.set([cx, cy + hy, cz, Math.max(0.12, Math.min(1.2, Math.max(hx, hz) * 1.6 + height))], h * 4)
        hb.set([fire.strength, seed, 0, 0], h * 4)
        h++
      }
      const embers = Math.round(1 + 3 * fire.fierce * fire.strength)
      for (let i = 0; i < embers && e < EMBERS; i++, e++) {
        ea.set([cx, cy + hy, cz, hx * 0.8], e * 4)
        eb.set([hz * 0.8, seeded(seed * 3 + i * 5), fire.strength, 0.6 + height * 3], e * 4)
      }
      if (fire.fierce > 0.4) for (let i = 0; i < 2 && s < SMOKE; i++, s++) {
        sa.set([cx, cy + hy + height * 0.8, cz, Math.max(0.12, width * 1.4)], s * 4)
        sb.set([1 + height, seeded(seed * 9 + i * 13), fire.strength, 0], s * 4)
      }
    }
    for (const [set, count] of [[this.flame, f], [this.ember, e], [this.smoke, s], [this.halo, h]] as const) {
      set.mesh.count = count
      set.a.needsUpdate = set.b.needsUpdate = true
    }
    this.group.visible = f > 0
  }

  dispose() {
    for (const set of [this.flame, this.ember, this.smoke, this.halo]) {
      set.mesh.geometry.dispose()
      ;(set.mesh.material as THREE.Material).dispose()
      set.mesh.dispose()
    }
  }
}
