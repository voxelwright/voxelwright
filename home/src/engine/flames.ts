// How fire looks (#74, #105): flames, embers and smoke over every burning part, as instanced
// quads whose motion is all in their shaders (TSL), so the CPU writes a few numbers per fire a
// few times a second and nothing per frame. They are their own layer of the picture
// (flameLayer, in the post chain after the lens's focus and before bloom): soft, bright past
// white so they bloom, hidden by what stands in front of them and fading where they meet a
// surface. Each flame stands on what is drawn, found by a ray down through the burning part's
// box, not on the box (a box over four chairs has no top). The strongest fires are the
// room's firelight (heat.ts lights and shadows the picture from them). Nothing is drawn, and
// the layer is not rendered, while nothing burns.
import * as THREE from 'three/webgpu'
import { abs, cameraFar, cameraNear, cameraPosition, cross, float, If, Fn, fract, instancedBufferAttribute, max, mix, normalize, pass, perspectiveDepthToViewZ, positionGeometry, positionView, screenUV, sin, smoothstep, texture, time, uniform, uv, vec2, vec3, vec4 } from 'three/tsl'
import type { Vec3 } from './core'
import { firelight } from './heat'
import { drift } from './noise'

export interface Burning {
  id: string; center: Vec3; half: Vec3; strength: number; fierce: number
  /** The whole part's box (center and half above are how far its fire has spread). */
  box: { center: Vec3; half: Vec3 }
}

const FLAMES = 160, EMBERS = 320, SMOKE = 64
/** Fires that light the room at once (heat.ts reads as many). */
export const LIGHTS = 4

// One layer for the home's fire (there is one home): the post chain is built before physics
// loads, so it binds these and the running Flames fills the scene.
const blankDepth = new THREE.DepthTexture(1, 1)
const layer = {
  scene: new THREE.Scene(),
  /** The home's depth, so a flame hides behind furniture and fades where it meets it. */
  depth: texture(blankDepth),
  /** 1 while anything is drawn. */
  on: uniform(0),
}

const seeded = (n: number) => {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453
  return x - Math.floor(x)
}

/** An instanced set of quads with two per-instance vec4s. */
function quads(count: number, material: THREE.NodeMaterial) {
  const geometry = new THREE.PlaneGeometry(1, 1).translate(0, 0.5, 0)
  const mesh = new THREE.InstancedMesh(geometry, material, count)
  mesh.count = 0
  mesh.frustumCulled = false
  mesh.userData.body = false
  mesh.castShadow = mesh.receiveShadow = false
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

/** 0 behind the home's surfaces, rising to 1 over `soft` metres in front of them. */
const inFront = (soft: number) => {
  const behind = perspectiveDepthToViewZ(layer.depth.sample(screenUV).level(float(0)).x, cameraNear, cameraFar)
  return smoothstep(0, soft, positionView.z.sub(behind))
}

/** Light over what is behind: colour times alpha is added, the background is dimmed by alpha (alpha 0 is pure glow). */
function glowing(output: THREE.Node<'vec4'>) {
  const m = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, depthTest: false, side: THREE.DoubleSide })
  m.blending = THREE.CustomBlending
  m.blendSrc = m.blendSrcAlpha = THREE.OneFactor
  m.blendDst = m.blendDstAlpha = THREE.OneMinusSrcAlphaFactor
  m.outputNode = output
  return m
}

interface Slot { at: THREE.Vector3; to: THREE.Vector3; power: number; target: number }

export class Flames {
  private group = new THREE.Group()
  private flame = { a: attr(FLAMES), b: attr(FLAMES), mesh: null as unknown as THREE.InstancedMesh }
  private ember = { a: attr(EMBERS), b: attr(EMBERS), mesh: null as unknown as THREE.InstancedMesh }
  private smoke = { a: attr(SMOKE), b: attr(SMOKE), mesh: null as unknown as THREE.InstancedMesh }
  /** Where flames stand on each burning part: points on what is drawn, world space, found once per part and place. */
  private anchors = new Map<string, { key: string; points: Vec3[] }>()
  private slots: Slot[] = Array.from({ length: LIGHTS }, () => ({ at: new THREE.Vector3(), to: new THREE.Vector3(), power: 0, target: 0 }))
  private ray = new THREE.Raycaster()

  constructor(private scene: THREE.Scene) {
    this.group.name = 'flames'
    this.flame.mesh = quads(FLAMES, this.flameMaterial())
    this.ember.mesh = quads(EMBERS, this.emberMaterial())
    this.smoke.mesh = quads(SMOKE, this.smokeMaterial())
    this.smoke.mesh.renderOrder = 1
    this.flame.mesh.renderOrder = 2
    this.ember.mesh.renderOrder = 3
    this.group.add(this.smoke.mesh, this.flame.mesh, this.ember.mesh)
    this.group.visible = false
    layer.scene.add(this.group)
  }

  get visible() {
    return this.group.visible
  }

  /** a: base xyz, width. b: height, seed, strength, fierce. */
  private flameMaterial() {
    const a = v4(this.flame.a), b = v4(this.flame.b)
    const m = glowing(Fn(() => {
      const seed = b.y, strength = b.z, fierce = b.w
      const p = uv()
      const t = time.mul(float(0.8).add(fierce.mul(0.5))).add(seed.mul(10))
      const x = p.x.sub(0.5).mul(2)
      // One quad is a sheet of fire, not one tongue: across it, in tenths of a metre, so licks are the same size on a candle and a sofa.
      const across = x.mul(a.w).mul(5)
      // The sheet leans and whips, more toward its top.
      const sway = drift(across.mul(0.06).add(seed.mul(0.37)), p.y.mul(0.17).sub(t.mul(0.1))).x.mul(0.55).mul(p.y)
      const xs = across.add(sway)
      // A candle's flame is one calm teardrop; a sofa's is torn into tongues by its own draught.
      const wild = mix(float(0.1), float(1), smoothstep(0.3, 0.9, fierce))
      // How high the fire stands along the sheet: tongues that rise, wander and fall.
      const stand = drift(xs.mul(0.14).add(seed.mul(0.61)), t.mul(0.06).add(seed.mul(3)).add(p.y.mul(0.05)))
      const crest = stand.x.mul(0.16).add(float(1).sub(abs(stand.y)).pow(3).mul(0.42)).mul(wild).add(mix(float(0.62), float(0.3), wild))
      // Two sizes of lick scrolling up. They bite harder the higher they go, so licks tear off and rise.
      const big = drift(xs.mul(0.13).add(seed.mul(0.83)), p.y.mul(0.3).sub(t.mul(0.22))).x
      const small = drift(xs.mul(0.33).add(seed.mul(0.29)), p.y.mul(0.66).sub(t.mul(0.4))).y
      const lick = big.mul(0.62).add(small.mul(0.38)).mul(mix(float(0.1), float(0.6), wild)).mul(p.y.mul(1.1).add(0.15))
      // Rounded off at the sheet's sides, narrowing upward, and clear of the quad's top edge.
      const v = crest.sub(p.y).sub(x.mul(x).mul(p.y.mul(0.9).add(0.55))).add(lick).sub(smoothstep(0.85, 1, p.y).mul(0.6)).toVar()
      // Hot at the heart, cooler out to the edge: cream, gold, orange, a deep rim. Past white at the heart, so it blooms.
      const rim = vec3(0.95, 0.12, 0.0), orange = vec3(1.0, 0.36, 0.02).mul(1.15), gold = vec3(1.0, 0.62, 0.07).mul(1.45), cream = vec3(1.0, 0.86, 0.4).mul(1.9)
      // Cooler toward the tips.
      const heat = v.sub(p.y.mul(0.22))
      const c = mix(mix(mix(rim, orange, smoothstep(0.0, 0.05, v)), gold, smoothstep(0.08, 0.2, heat)), cream, smoothstep(0.28, 0.46, heat)).toVar()
      // A small calm flame has a blue root.
      c.assign(mix(c, vec3(0.25, 0.4, 1.6), smoothstep(0.2, 0, p.y).mul(smoothstep(0.4, 0, wild)).mul(smoothstep(0.5, 0.1, abs(x))).mul(0.8)))
      const alpha = smoothstep(0, 0.025, v).mul(strength.mul(0.25).add(0.75)).mul(inFront(0.05))
      return vec4(c.mul(alpha), alpha.mul(0.94))
    })())
    m.positionNode = upright(a.xyz, a.w, b.x)
    return m
  }

  /** a: where it leaves the fire xyz, spread. b: rise, seed, strength, size. */
  private emberMaterial() {
    const a = v4(this.ember.a), b = v4(this.ember.b)
    const seed = b.y
    const life = fract(time.mul(float(0.3).add(fract(seed.mul(7.13)).mul(0.45))).add(seed))
    // Carried up fast, then slowing and wandering as the draught lets go.
    const up = life.mul(float(2).sub(life)).mul(b.x)
    const wander = vec3(sin(time.mul(1.9).add(seed.mul(40))).add(sin(time.mul(4.3).add(seed.mul(17))).mul(0.4)), 0, sin(time.mul(1.5).add(seed.mul(23))).add(sin(time.mul(3.7).add(seed.mul(31))).mul(0.4))).mul(life.mul(0.13).add(0.01))
    const start = vec3(fract(seed.mul(3.7)).sub(0.5), 0, fract(seed.mul(5.3)).sub(0.5)).mul(a.w.mul(2))
    const centre = a.xyz.add(start).add(vec3(0, up, 0)).add(wander)
    const size = b.w.mul(float(1).sub(life.mul(0.6)))
    const toEye = normalize(cameraPosition.sub(centre))
    const right = normalize(cross(vec3(0, 1, 0), toEye.add(vec3(1e-4, 0, 0))))
    const m = glowing(Fn(() => {
      const d = uv().sub(0.5).length().mul(2)
      const glow = smoothstep(1, 0.2, d).mul(smoothstep(1, 0.55, life)).mul(smoothstep(0, 0.04, life)).mul(b.z)
      const twinkle = sin(time.mul(17).add(seed.mul(90))).mul(0.35).add(0.65)
      return vec4(mix(vec3(1, 0.7, 0.25), vec3(1, 0.2, 0.03), life).mul(glow.mul(twinkle).mul(9)).mul(inFront(0.02)), 0)
    })())
    m.positionNode = centre.add(right.mul(positionGeometry.x.mul(size))).add(cross(toEye, right).mul(positionGeometry.y.sub(0.5).mul(size)))
    return m
  }

  /** a: base xyz, width. b: rise, seed, strength, unused. */
  private smokeMaterial() {
    const a = v4(this.smoke.a), b = v4(this.smoke.b)
    const seed = b.y
    const life = fract(time.mul(float(0.1).add(fract(seed.mul(3.3)).mul(0.05))).add(seed))
    const base = a.xyz.add(vec3(sin(time.mul(0.5).add(seed.mul(30))).mul(0.22).mul(life), life.mul(b.x), sin(time.mul(0.4).add(seed.mul(11))).mul(0.22).mul(life)))
    const grow = life.mul(2.4).add(0.6)
    const m = glowing(Fn(() => {
      const p = uv()
      const n = drift(p.x.mul(0.3).add(seed.mul(0.9)), p.y.mul(0.3).add(time.mul(0.04)).add(seed.mul(0.5))).x
      const d = p.sub(0.5).length().mul(2).add(n.mul(0.4))
      const alpha = smoothstep(1, 0.15, d).mul(smoothstep(0, 0.15, life)).mul(smoothstep(1, 0.35, life)).mul(0.38).mul(b.z).mul(inFront(0.25))
      // Lit from below by its fire while young, grey once it has risen.
      const c = mix(vec3(0.5, 0.2, 0.06), vec3(0.2, 0.19, 0.19), smoothstep(0, 0.35, life))
      return vec4(c.mul(alpha), alpha)
    })())
    m.positionNode = upright(base, a.w.mul(grow), a.w.mul(grow))
    return m
  }

  /** Points on what is drawn inside a part's box, seen from above: where its flames can stand. */
  private stand(fire: Burning): Vec3[] {
    const { center: [cx, cy, cz], half: [hx, hy, hz] } = fire.box
    const key = [cx, cy, cz, hx, hy, hz].map((v) => v.toFixed(2)).join()
    const known = this.anchors.get(fire.id)
    if (known?.key === key) return known.points
    // A thing that has moved since it caught is on the move: its flames ride its box, and the scene is not searched again every time it rolls.
    const moving = known !== undefined
    const top = cy + hy
    const n = Math.max(1, Math.min(24, Math.round((4 * hx * hz) / 0.045)))
    const nx = Math.max(1, Math.round(Math.sqrt((n * hx) / Math.max(hz, 1e-3))))
    const nz = Math.max(1, Math.ceil(n / nx))
    const spots: [number, number][] = []
    for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) {
      const s = i * 31 + j * 17 + cx * 7 + cz * 13
      spots.push([cx + hx * (nx === 1 ? 0 : ((i + 0.2 + 0.6 * seeded(s)) / nx) * 2 - 1), cz + hz * (nz === 1 ? 0 : ((j + 0.2 + 0.6 * seeded(s + 5)) / nz) * 2 - 1)])
    }
    const points: Vec3[] = []
    // A flat thing (a rug) is its own top; anything with height is whatever is drawn in its box.
    if (hy < 0.02 || moving) for (const [x, z] of spots) points.push([x, top, z])
    else {
      const box = new THREE.Box3(new THREE.Vector3(cx - hx, cy - hy, cz - hz), new THREE.Vector3(cx + hx, top + 0.02, cz + hz))
      const solids: THREE.Mesh[] = [], bounds = new THREE.Box3()
      const visit = (o: THREE.Object3D) => {
        if (!o.visible || o === this.group) return
        const mesh = o as THREE.Mesh
        if (mesh.isMesh && !(mesh as unknown as THREE.InstancedMesh).isInstancedMesh && !(mesh.material as THREE.Material).transparent) {
          if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox()
          if (bounds.copy(mesh.geometry.boundingBox!).applyMatrix4(mesh.matrixWorld).intersectsBox(box)) solids.push(mesh)
        }
        for (const c of o.children) visit(c)
      }
      visit(this.scene)
      const down = new THREE.Vector3(0, -1, 0), from = new THREE.Vector3()
      this.ray.far = 2 * hy + 0.1
      for (const [x, z] of spots) {
        this.ray.set(from.set(x, top + 0.05, z), down)
        const hit = this.ray.intersectObjects(solids, false)[0]
        // What the ray meets at the very bottom of a tall box is the floor the thing stands on, not the thing.
        if (hit && (hy < 0.1 || hit.point.y > cy - hy + 0.04)) points.push([x, hit.point.y, z])
      }
      if (!points.length) points.push([cx, top, cz])
    }
    this.anchors.set(fire.id, { key, points })
    return points
  }

  /** Lays flames, embers and smoke over what burns now (a few times a second: the motion is the shaders'), and aims the firelight. */
  update(burning: Burning[], eye: THREE.Vector3) {
    let f = 0, e = 0, s = 0
    const fa = this.flame.a.array as Float32Array, fb = this.flame.b.array as Float32Array
    const ea = this.ember.a.array as Float32Array, eb = this.ember.b.array as Float32Array
    const sa = this.smoke.a.array as Float32Array, sb = this.smoke.b.array as Float32Array
    const sorted = [...burning].sort((x, y) => y.strength * y.half[0] * y.half[2] - x.strength * x.half[0] * x.half[2])
    const tongues: { at: Vec3; width: number; height: number; seed: number; strength: number; fierce: number; far: number }[] = []
    const lights: { at: Vec3; power: number }[] = []
    for (const id of this.anchors.keys()) if (!burning.some((b) => b.id === id)) this.anchors.delete(id)
    for (const fire of sorted) {
      const [cx, cy, cz] = fire.center, [hx, hy, hz] = fire.half
      const all = this.stand(fire)
      const [bx, , bz] = fire.box.half
      const lit = all.filter(([x, , z]) => Math.abs(x - cx) <= hx + 0.03 && Math.abs(z - cz) <= hz + 0.03)
      // A big fire is a few wide sheets standing one behind another; a thing smaller than a hand has one flame its own size.
      const small = Math.min(bx, bz) < 0.06
      const grown = 0.45 + 0.55 * fire.strength
      const width = (small ? Math.max(bx, bz) * 3.2 : Math.min(0.62, Math.max(0.2, 2.6 * Math.sqrt(hx * hz)))) * grown
      const height = (small ? width * 2.1 : Math.min(0.95, width * 1.6)) * (0.6 + 0.4 * fire.fierce)
      // One sheet to about every half-width of burning surface.
      const want = Math.max(1, Math.min(7, Math.round((4 * hx * hz) / (width * width * 0.35))))
      const every = Math.max(1, Math.floor(lit.length / want))
      let top = -Infinity
      for (const [i, at] of lit.entries()) {
        top = Math.max(top, at[1])
        if (i % every) continue
        const seed = seeded(at[0] * 13.7 + at[2] * 7.3 + i)
        tongues.push({ at, width: width * (0.8 + 0.4 * seeded(seed * 31)), height: height * (0.75 + 0.5 * seeded(seed * 17)), seed, strength: fire.strength, fierce: fire.fierce, far: (at[0] - eye.x) ** 2 + (at[1] - eye.y) ** 2 + (at[2] - eye.z) ** 2 })
      }
      if (!lit.length) continue
      const spread = Math.sqrt(hx * hz)
      lights.push({ at: [cx, top + height * 0.35, cz], power: fire.strength * (0.25 + 0.75 * fire.fierce) * Math.min(1.6, 0.12 + spread * 3.2) })
      const embers = Math.round((2 + 22 * spread) * fire.fierce * fire.strength)
      for (let i = 0; i < embers && e < EMBERS; i++, e++) {
        const at = lit[i % lit.length]
        ea.set([at[0], at[1] + height * 0.3, at[2], width * 0.5], e * 4)
        eb.set([0.5 + height * 2.5 + seeded(i + cx) * 0.6, seeded(cx * 3 + cz * 5 + i * 5.1), fire.strength, 0.012 + 0.012 * seeded(i * 3.3 + cz)], e * 4)
      }
      if (fire.fierce > 0.4) for (let i = 0; i < Math.min(4, 1 + Math.round(spread * 6)) && s < SMOKE; i++, s++) {
        const at = lit[(i * 3) % lit.length]
        sa.set([at[0], at[1] + height * 0.75, at[2], Math.max(0.14, width * 1.1)], s * 4)
        sb.set([1.1 + height * 1.5, seeded(cx * 9 + cz + i * 13), fire.strength, 0], s * 4)
      }
    }
    // Far tongues first, so near ones lie over them.
    tongues.sort((x, y) => y.far - x.far)
    for (const t of tongues.slice(-FLAMES)) {
      // Sunk a little into the surface, so the flame grows out of it.
      fa.set([t.at[0], t.at[1] - t.height * 0.06, t.at[2], t.width], f * 4)
      fb.set([t.height, t.seed, t.strength, t.fierce], f * 4)
      f++
    }
    for (const [set, count] of [[this.flame, f], [this.ember, e], [this.smoke, s]] as const) {
      set.mesh.count = count
      set.a.needsUpdate = set.b.needsUpdate = true
    }
    this.group.visible = f > 0
    layer.on.value = f > 0 ? 1 : 0
    this.aim(lights)
  }

  /** The strongest fires, near ones merged, become the lights; each keeps its slot while it lasts so it never jumps. */
  private aim(lights: { at: Vec3; power: number }[]) {
    const merged: { at: THREE.Vector3; power: number }[] = []
    for (const l of lights.sort((a, b) => b.power - a.power)) {
      const p = new THREE.Vector3(...l.at)
      const near = merged.find((m) => m.at.distanceTo(p) < 0.8)
      if (near) {
        near.at.lerp(p, l.power / (near.power + l.power))
        near.power = Math.min(2.2, near.power + l.power * 0.6)
      } else if (merged.length < LIGHTS) merged.push({ at: p, power: l.power })
    }
    const free = new Set(this.slots)
    for (const s of this.slots) s.target = 0
    const rest: typeof merged = []
    for (const m of merged) {
      const slot = [...free].filter((s) => s.power > 0.01 && s.to.distanceTo(m.at) < 1).sort((a, b) => a.to.distanceTo(m.at) - b.to.distanceTo(m.at))[0]
      if (!slot) rest.push(m)
      else {
        free.delete(slot)
        slot.to.copy(m.at)
        slot.target = m.power
      }
    }
    for (const m of rest) {
      const slot = [...free].sort((a, b) => a.power - b.power)[0]
      if (!slot) break
      free.delete(slot)
      // A dark slot starts where its fire is; one still fading glides over.
      if (slot.power < 0.01) slot.at.copy(m.at)
      slot.to.copy(m.at)
      slot.target = m.power
    }
  }

  /** Every frame while there is firelight: the lights ease to where and how strong their fires are. */
  frame(dt: number) {
    const k = 1 - Math.exp(-dt * 5)
    for (const s of this.slots) {
      s.power += (s.target - s.power) * k
      s.at.lerp(s.to, k)
      if (s.target === 0 && s.power < 0.004) s.power = 0
    }
    // Strongest first: the first two cast shadows.
    for (const [i, s] of [...this.slots].sort((a, b) => b.power - a.power).entries()) firelight.array[i].set(s.at.x, s.at.y, s.at.z, s.power)
  }

  /** Whether any fire still lights the room (it fades for a moment after the last flame). */
  get glowing() {
    return this.slots.some((s) => s.power > 0)
  }

  dispose() {
    layer.scene.remove(this.group)
    layer.on.value = 0
    for (const v of firelight.array) v.set(0, 0, 0, 0)
    for (const set of [this.flame, this.ember, this.smoke]) {
      set.mesh.geometry.dispose()
      ;(set.mesh.material as THREE.Material).dispose()
      set.mesh.dispose()
    }
  }
}

/**
 * The fire layer over the picture (the post chain calls it on the scene colour, after the lens
 * and the heat field's look, before bloom). The layer is rendered at half size, and only while
 * something burns; `depth` is the scene pass's depth texture.
 */
export function flameLayer(color: THREE.Node<'vec4'>, depth: THREE.Texture, renderer: THREE.WebGPURenderer, camera: THREE.Camera): { color: THREE.Node<'vec4'>; dispose(): void } {
  const flames = pass(layer.scene, camera)
  flames.setResolutionScale(0.5)
  const draw = flames.updateBefore.bind(flames)
  const was = new THREE.Color()
  flames.updateBefore = (frame) => {
    if (layer.on.value === 0) return undefined
    // This chain's own depth, bound as it draws: another chain may be building beside it.
    layer.depth.value = depth
    const alpha = renderer.getClearAlpha()
    renderer.getClearColor(was)
    renderer.setClearColor(0x000000, 0)
    draw(frame)
    renderer.setClearColor(was, alpha)
    return undefined
  }
  const drawn = flames.getTextureNode()
  const out = Fn(() => {
    const c = vec4(color).toVar()
    If(layer.on.greaterThan(0.5), () => {
      const fire = drawn.sample(uv()).level(float(0))
      c.assign(vec4(c.rgb.mul(float(1).sub(fire.a)).add(max(fire.rgb, 0)), c.a))
    })
    return c
  })()
  return { color: out, dispose: () => flames.dispose() }
}
