// The heat field (#74): heat, water and char over the home as a grid of cells on the GPU, the
// HeatField fire.ts drives. 64 × 16 × 64 cells packed as a 256 × 256 atlas (one 64 × 64 tile per
// layer of height), half floats, stepped by a full-screen pass between two render targets. A
// fragment pass, not a compute shader: three.js's WebGL2 backend (the fallback where WebGPU is
// missing) cannot read a neighbour's cell in compute, and a fragment pass runs the same on both.
//   r  heat, °C above the room. It spreads to neighbours, rises, cools, and water quenches it.
//   g  water, 0 to 1. It falls, spreads a little at the floor, and heat dries it.
//   b  char, 0 to 1. Heat over about 350 °C chars a cell; it stays.
// Burning parts heat the cells in their box (sources). What comes back to the CPU is one sample
// per part: the hottest heat, the most water and the char in its box, written to a 2048 × 1
// target and read back without stalling, a few times a second. The whole field is never read.
// The looks read the same field: fieldLook() lights, chars and wets whatever the camera sees.
import * as THREE from 'three/webgpu'
import { abs, clamp, float, floor, Fn, getViewPosition, If, int, ivec2, Loop, max, min, mix, mod, mx_noise_float, mx_worley_noise_vec2, smoothstep, sin, texture, textureLoad, uniform, uv, vec2, vec3, vec4 } from 'three/tsl'
import type { Vec3 } from './core'
import { MAX_PROBES, MAX_SOURCES, type HeatField, type Source } from './fire'

export const NX = 64, NY = 16, NZ = 64
const TILES = 4
const W = NX * TILES, H = NZ * (NY / TILES)

type N = THREE.Node<'float'>
type V3 = THREE.Node<'vec3'>

// One field the looks read (there is one home): the post chain is built before physics loads,
// so it binds these and the running field points them at its own texture.
const blank = new THREE.DataTexture(new Uint16Array(4), 1, 1, THREE.RGBAFormat, THREE.HalfFloatType)
blank.magFilter = blank.minFilter = THREE.LinearFilter
blank.needsUpdate = true
const look = {
  field: texture(blank),
  origin: uniform(new THREE.Vector3()),
  cell: uniform(new THREE.Vector3(1, 1, 1)),
  active: uniform(0),
  /** 1 while the field steps (fire or water at work): the looks read heat and light only then. */
  hot: uniform(0),
  time: uniform(0),
  flash: uniform(0),
}

/** Atlas uv of the point g in cell units (cell centres at i + 0.5), in layer y. */
const atlasUv = (gx: N, y: N, gz: N) => vec2(mod(y, TILES).mul(NX).add(gx).div(W), floor(y.div(TILES)).mul(NZ).add(gz).div(H))

/** The field at a world point, trilinear: two bilinear reads, one per layer, kept inside each tile. */
function fieldAt(tex: THREE.TextureNode, p: V3, origin: V3, cell: V3): THREE.Node<'vec4'> {
  const g = p.sub(origin).div(cell)
  const gx = clamp(g.x, 0.5, NX - 0.5), gz = clamp(g.z, 0.5, NZ - 0.5)
  const gy = clamp(g.y.sub(0.5), 0, NY - 1)
  const y0 = floor(gy), y1 = min(y0.add(1), NY - 1)
  return mix(tex.sample(atlasUv(gx, y0, gz)), tex.sample(atlasUv(gx, y1, gz)), gy.sub(y0))
}

const target = (w: number, h: number, type: THREE.TextureDataType) => {
  const t = new THREE.RenderTarget(w, h, { type, format: THREE.RGBAFormat, depthBuffer: false, generateMipmaps: false })
  t.texture.minFilter = t.texture.magFilter = type === THREE.HalfFloatType ? THREE.LinearFilter : THREE.NearestFilter
  return t
}

export interface Bounds { min: Vec3; max: Vec3 }

export class GpuHeatField implements HeatField {
  private targets = [target(W, H, THREE.HalfFloatType), target(W, H, THREE.HalfFloatType)]
  private current = 0
  private probes = target(MAX_PROBES, 1, THREE.FloatType)
  private sourceData = new Float32Array(MAX_SOURCES * 3 * 4)
  private sourceTex = new THREE.DataTexture(this.sourceData, MAX_SOURCES, 3, THREE.RGBAFormat, THREE.FloatType)
  private probeData = new Float32Array(MAX_PROBES * 2 * 4)
  private probeTex = new THREE.DataTexture(this.probeData, MAX_PROBES, 2, THREE.RGBAFormat, THREE.FloatType)
  private src = texture(this.targets[0].texture)
  private u = { dt: uniform(0), count: uniform(0, 'int'), rain: uniform(0), clear: uniform(0), probeCount: uniform(0, 'int') }
  private stepQuad: THREE.QuadMesh
  private probeQuad: THREE.QuadMesh
  private dirty = true
  readonly bounds: Bounds

  constructor(private renderer: THREE.WebGPURenderer, bounds: Bounds) {
    // Cells as near cubes as the home allows: the grid covers the home's floor and a storey and a bit of height.
    const size = [0, 1, 2].map((i) => Math.max(0.5, bounds.max[i] - bounds.min[i]))
    const cell = new THREE.Vector3(size[0] / NX, size[1] / NY, size[2] / NZ)
    this.bounds = bounds
    look.origin.value.set(...bounds.min)
    look.cell.value.copy(cell)
    for (const t of [this.sourceTex, this.probeTex]) {
      t.minFilter = t.magFilter = THREE.NearestFilter
      t.needsUpdate = true
    }
    this.stepQuad = new THREE.QuadMesh(this.stepMaterial())
    this.probeQuad = new THREE.QuadMesh(this.probeMaterial())
    look.field.value = this.targets[0].texture
  }

  private stepMaterial() {
    const { src, u, sourceTex } = this
    const { origin, cell } = look
    const shader = Fn(() => {
      const px = floor(uv().x.mul(W)), py = floor(uv().y.mul(H))
      const x = mod(px, NX), z = mod(py, NZ), y = floor(py.div(NZ)).mul(TILES).add(floor(px.div(NX)))
      const at = (cx: N, cy: N, cz: N) => src.sample(atlasUv(clamp(cx, 0, NX - 1).add(0.5), clamp(cy, 0, NY - 1), clamp(cz, 0, NZ - 1).add(0.5)))
      const self = at(x, y, z).toVar()
      const below = at(x, y.sub(1), z), above = at(x, y.add(1), z)
      const sides = at(x.sub(1), y, z).add(at(x.add(1), y, z)).add(at(x, y, z.sub(1))).add(at(x, y, z.add(1)))
      const T = self.r, Wt = self.g
      const dt = u.dt
      // Heat: toward the mean of the six neighbours, up from a hotter cell below, out to the room, quenched by water.
      const mean = sides.r.add(below.r).add(above.r).div(6)
      const heat = T.add(mean.sub(T).mul(0.12)).toVar()
      heat.addAssign(max(below.r.sub(T), 0).mul(0.22))
      heat.mulAssign(float(-0.35).mul(dt).exp())
      heat.divAssign(Wt.mul(18).mul(dt).add(1))
      // Water: falls a cell at a time (rain falls in from the top), pools on the floor, spreads a little, dries in heat.
      const inflow = mix(above.g, u.rain, y.greaterThanEqual(NY - 1).select(1, 0)).mul(0.5)
      const outflow = y.greaterThan(0).select(Wt.mul(0.5), 0)
      const water = Wt.sub(outflow).add(inflow).add(sides.g.div(4).sub(Wt).mul(y.equal(0).select(0.12, 0.03))).toVar()
      water.mulAssign(float(-0.05).sub(heat.mul(0.004)).mul(dt).exp())
      // Char: what is hot enough blackens, and stays.
      const char = max(self.b, min(self.b.add(dt.mul(0.08).mul(smoothstep(450, 850, heat))), 0.6)).toVar()
      const p = vec3(x, y, z).add(0.5).mul(cell).add(origin)
      Loop(u.count, ({ i }) => {
        const c = textureLoad(sourceTex, ivec2(i, int(0)))
        const h = textureLoad(sourceTex, ivec2(i, int(1)))
        const w = textureLoad(sourceTex, ivec2(i, int(2)))
        const d = abs(p.sub(c.xyz)).sub(h.xyz).sub(cell.mul(0.5))
        If(max(d.x, max(d.y, d.z)).lessThanEqual(0), () => {
          heat.assign(max(heat, mix(heat, c.w, min(h.w.mul(dt), 1))))
          water.assign(max(water, w.x))
          char.assign(max(char, w.y))
        })
      })
      const out = vec4(min(heat, 3000), clamp(water, 0, 1), char, 1)
      return u.clear.greaterThan(0.5).select(vec4(0), out)
    })
    const m = new THREE.NodeMaterial()
    m.fragmentNode = shader()
    m.depthTest = m.depthWrite = false
    return m
  }

  private probeMaterial() {
    const { src, u, probeTex } = this
    const { origin, cell } = look
    const shader = Fn(() => {
      const i = int(floor(uv().x.mul(MAX_PROBES)))
      const c = textureLoad(probeTex, ivec2(i, int(0))).xyz
      const h = textureLoad(probeTex, ivec2(i, int(1))).xyz.mul(0.8)
      const best = fieldAt(src, c, origin, cell).toVar()
      for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
        const s = fieldAt(src, c.add(h.mul(vec3(sx, sy, sz))), origin, cell)
        best.assign(vec4(max(best.r, s.r), max(best.g, s.g), max(best.b, s.b), 1))
      }
      // Heat rises: just over the top of the box counts too.
      const top = fieldAt(src, c.add(vec3(0, h.y.div(0.8).add(cell.y.mul(0.5)), 0)), origin, cell)
      best.assign(vec4(max(best.r, top.r), max(best.g, top.g), best.b, 1))
      return i.lessThan(u.probeCount).select(best, vec4(0))
    })
    const m = new THREE.NodeMaterial()
    m.fragmentNode = shader()
    m.depthTest = m.depthWrite = false
    return m
  }

  private pass(quad: THREE.QuadMesh, into: THREE.RenderTarget) {
    const before = this.renderer.getRenderTarget()
    this.renderer.setRenderTarget(into)
    quad.render(this.renderer)
    this.renderer.setRenderTarget(before)
  }

  step(dt: number, sources: Source[], rain: number) {
    const n = Math.min(MAX_SOURCES, sources.length)
    const d = this.sourceData
    for (let i = 0; i < n; i++) {
      const s = sources[i]
      d.set([s.center[0], s.center[1], s.center[2], s.heat], i * 4)
      d.set([s.half[0], s.half[1], s.half[2], s.rate], (MAX_SOURCES + i) * 4)
      d.set([s.water, s.char, 0, 0], (2 * MAX_SOURCES + i) * 4)
    }
    this.sourceTex.needsUpdate = true
    this.u.count.value = n
    this.u.dt.value = dt
    this.u.rain.value = rain
    this.u.clear.value = this.dirty ? 1 : 0
    this.dirty = false
    const next = 1 - this.current
    this.src.value = this.targets[this.current].texture
    this.pass(this.stepQuad, this.targets[next])
    this.current = next
    this.src.value = look.field.value = this.targets[next].texture
    look.time.value += dt
  }

  async sample(boxes: { center: Vec3; half: Vec3 }[]) {
    const n = Math.min(MAX_PROBES, boxes.length)
    if (!n) return new Float32Array(0)
    const d = this.probeData
    for (let i = 0; i < n; i++) {
      const b = boxes[i]
      d.set([b.center[0], b.center[1], b.center[2], 0], i * 4)
      d.set([b.half[0], b.half[1], b.half[2], 0], (MAX_PROBES + i) * 4)
    }
    this.probeTex.needsUpdate = true
    this.u.probeCount.value = n
    this.src.value = this.targets[this.current].texture
    this.pass(this.probeQuad, this.probes)
    const out = await this.renderer.readRenderTargetPixelsAsync(this.probes, 0, 0, n, 1)
    return out instanceof Float32Array ? out : null
  }

  clear() {
    // Each target is written black while the pass reads the other (never the one it writes), and the next step clears again.
    this.dirty = true
    this.u.clear.value = 1
    for (const [i, t] of this.targets.entries()) {
      this.src.value = this.targets[1 - i].texture
      this.pass(this.stepQuad, t)
    }
    this.u.clear.value = 0
    this.src.value = look.field.value = this.targets[this.current].texture
  }

  setHot(hot: boolean) {
    look.hot.value = hot ? 1 : 0
  }

  setFlash(flash: number) {
    look.flash.value = flash
  }

  setActive(active: boolean) {
    look.active.value = active ? 1 : 0
  }

  dispose() {
    look.active.value = look.flash.value = look.hot.value = 0
    look.field.value = blank
    for (const t of [...this.targets, this.probes]) t.dispose()
    this.sourceTex.dispose()
    this.probeTex.dispose()
    for (const q of [this.stepQuad, this.probeQuad]) (q.material as THREE.Material).dispose()
  }
}

/** A blackbody-ish ramp: dull red at 500 °C, orange, then yellow-white past 1000 °C. */
const glowOf = (t: N) => vec3(smoothstep(420, 700, t), smoothstep(600, 1000, t).mul(0.62), smoothstep(900, 1400, t).mul(0.35))

/**
 * What the field does to the picture (the post chain calls it on the lit scene colour): what has
 * charred goes black, what is wet goes darker, fire lights what is near it (a warm light that
 * flickers, from the heat round each surface), and what is hot enough glows: embers in the char,
 * red-hot steel. Nothing is read while nothing has burnt or is wet; one read a pixel while only char remains.
 */
export function fieldLook(color: THREE.Node<'vec4'>, depth: THREE.Node<'float'>, camera: THREE.Camera): THREE.Node<'vec4'> {
  const projectionInverse = uniform(camera.projectionMatrixInverse)
  const world = uniform(camera.matrixWorld)
  return Fn(() => {
    const out = vec4(color).toVar()
    If(look.active.greaterThan(0.5).and(depth.lessThan(0.99999)), () => {
      const view = getViewPosition(uv(), depth, projectionInverse)
      const p = world.mul(vec4(view, 1)).xyz
      // Only inside the field's box: past it, a read would be the edge cell's, metres away.
      const g = p.sub(look.origin).div(look.cell)
      If(min(g.x, min(g.y, g.z)).greaterThanEqual(0).and(g.x.lessThanEqual(NX)).and(g.y.lessThanEqual(NY)).and(g.z.lessThanEqual(NZ)), () => {
        const toEye = world.mul(vec4(0, 0, 0, 1)).xyz.sub(p).normalize()
        // Char and wet are the surface's own, read where it is; while the field rests, that is the only read.
        const own = fieldAt(look.field, p.sub(toEye.mul(look.cell.x.mul(0.25))), look.origin, look.cell)
        const color = out.rgb.toVar()
        const charred = color.mul(mix(vec3(1), vec3(0.2, 0.16, 0.13), own.b.mul(0.92)))
        out.assign(vec4(charred.mul(float(1).sub(own.g.mul(0.18))), out.a))
        If(look.hot.greaterThan(0.5), () => {
          // Heat is the air's, a little in front of the surface, where its flames are.
          const s = fieldAt(look.field, p.add(toEye.mul(look.cell.x.mul(0.6))), look.origin, look.cell)
          const T = s.r, wet = max(s.g, own.g), char = max(s.b, own.b)
          const t = look.time
          const flicker = sin(t.mul(23).add(p.x.mul(7))).mul(0.08).add(sin(t.mul(37).add(p.z.mul(5))).mul(0.06)).add(0.86)
          // Char is a warm charcoal over the material (its grain still shows); soot on walls is the same, lighter.
          const base = color.mul(mix(vec3(1), vec3(0.2, 0.16, 0.13), char.mul(0.92))).mul(float(1).sub(wet.mul(0.18)))
          // Firelight: the hottest air round the surface, a little above and to each side, so a fire lights the floor and things beside it too.
          const reach = look.cell.x.mul(2.2)
          const around = (dx: number, dz: number) => fieldAt(look.field, p.add(vec3(reach.mul(dx), reach.mul(0.6), reach.mul(dz))), look.origin, look.cell).r
          const near = max(max(around(1, 0), around(-1, 0)), max(around(0, 1), around(0, -1))).mul(0.7)
          const warmth = smoothstep(30, 500, max(T, near)).mul(flicker)
          const lit = base.add(color.mul(vec3(1.0, 0.42, 0.12)).mul(warmth.mul(0.75)))
          // Embers: on deeply charred surfaces that are still hot, a network of glowing cracks between charcoal plates.
          const ember = vec3(0).toVar()
          If(char.greaterThan(0.45), () => {
            const cells = mx_worley_noise_vec2(p.mul(14).add(vec3(0, t.mul(0.05), 0)))
            const crack = smoothstep(0.05, 0.0, cells.y.sub(cells.x))
            const pulse = mx_noise_float(p.mul(4).add(vec3(t.mul(0.5)))).mul(0.35).add(0.75)
            ember.assign(glowOf(max(T, own.r)).mul(smoothstep(0.5, 0.95, char)).mul(smoothstep(450, 650, max(T, own.r))).mul(crack).mul(pulse).mul(1.6))
          })
          out.assign(vec4(lit.add(ember), out.a))
        })
      })
    })
    // Lightning: the whole room goes cold white for a moment.
    return vec4(out.rgb.add(vec3(0.75, 0.82, 1.0).mul(look.flash.mul(0.9))), out.a)
  })()
}
