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
import { abs, clamp, dot, getNormalFromDepth, float, floor, Fn, getScreenPosition, getViewPosition, If, int, interleavedGradientNoise, ivec2, Loop, max, min, mix, mod, perspectiveDepthToViewZ, rtt, screenCoordinate, smoothstep, sin, texture, textureLoad, time, uniform, uniformArray, uv, vec2, vec3, vec4 } from 'three/tsl'
import type { Vec3 } from './core'
import { MAX_PROBES, MAX_SOURCES, type HeatField, type Source } from './fire'
import { drift } from './noise'

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

/** The fires that light the room (flames.ts aims them): where, and how strong (0 is dark). */
const fires = [0, 1, 2, 3].map(() => new THREE.Vector4())
export const firelight = { array: fires, node: uniformArray(fires, 'vec4') }
const fireAt = (i: number) => firelight.node.element(i) as unknown as THREE.Node<'vec4'>
/** Steps of each firelight shadow's march through the picture's depth. */
const SHADOW_STEPS = 8

/** Atlas uv of the point g in cell units (cell centres at i + 0.5), in layer y. */
const atlasUv = (gx: N, y: N, gz: N) => vec2(mod(y, TILES).mul(NX).add(gx).div(W), floor(y.div(TILES)).mul(NZ).add(gz).div(H))

/** The field at a world point, trilinear: two bilinear reads, one per layer, kept inside each tile. */
function fieldAt(tex: THREE.TextureNode, p: V3, origin: V3, cell: V3): THREE.Node<'vec4'> {
  const g = p.sub(origin).div(cell)
  const gx = clamp(g.x, 0.5, NX - 0.5), gz = clamp(g.z, 0.5, NZ - 0.5)
  const gy = clamp(g.y.sub(0.5), 0, NY - 1)
  const y0 = floor(gy), y1 = min(y0.add(1), NY - 1)
  // Level 0 by name: a read that leaves the choice of level to the GPU is done whether or not its branch is taken.
  return mix(tex.sample(atlasUv(gx, y0, gz)).level(float(0)), tex.sample(atlasUv(gx, y1, gz)).level(float(0)), gy.sub(y0))
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
 * How much firelight falls on each point of the picture, as its own half-size pass: each of the
 * strongest fires (firelight) is a point light that flickers, shading every surface by where it
 * faces and how far it is, and with `shadows` the two strongest (flames.ts lists them strongest first) cast shadows, found by marching
 * the picture's own depth toward the fire. Its own pass because it is only rendered while a
 * fire is lit (a branch in the main picture's shader still cost several ms when not taken), and
 * half size because firelight is soft.
 */
function firelightMap(depthTexture: THREE.TextureNode, camera: THREE.Camera, shadows: boolean) {
  const projectionInverse = uniform(camera.projectionMatrixInverse)
  const projection = uniform(camera.projectionMatrix)
  const toView = uniform(camera.matrixWorldInverse)
  const lens = camera as THREE.PerspectiveCamera
  const near = uniform(lens.near), far = uniform(lens.far)
  const map = rtt(Fn(() => {
    const light = float(0).toVar()
    light.assign(0)
    const depth = depthTexture.sample(uv()).level(float(0)).x
    If(depth.lessThan(0.99999), () => {
      const view = getViewPosition(uv(), depth, projectionInverse)
      // The surface's facing, from the depth alone (no normal target to read).
      const facing = getNormalFromDepth(uv(), depthTexture.value as unknown as THREE.Node, projectionInverse)
      const grain = interleavedGradientNoise(screenCoordinate.xy)
      for (let i = 0; i < firelight.array.length; i++) {
        const fire = fireAt(i)
        If(fire.w.greaterThan(0), () => {
          // Each fire flickers on its own beat, and its heart wanders a little, so its shadows dance.
          const beat = time.mul(11).add(i * 2.4)
          const flicker = sin(beat).mul(0.09).add(sin(beat.mul(2.3).add(1)).mul(0.06)).add(sin(beat.mul(0.37)).mul(0.08)).add(0.86)
          const heart = fire.xyz.add(vec3(sin(beat.mul(0.9)), sin(beat.mul(1.3).add(2)), sin(beat.mul(1.1).add(4))).mul(0.025))
          const toFire = toView.mul(vec4(heart, 1)).xyz.sub(view)
          const away = toFire.length()
          const reach = fire.w.sqrt().mul(4).add(0.6)
          If(away.lessThan(reach), () => {
            // Soft falloff, wrapped a little round the surface so nothing near a fire is ever black.
            const fall = fire.w.mul(3.4).div(away.div(0.75).pow2().add(1)).mul(smoothstep(reach, reach.mul(0.4), away))
            const wrap = clamp(dot(facing, toFire.div(away)).add(0.25).div(1.25), 0, 1)
            const lightOn = float(1).toVar()
            if (shadows && i < 2) {
              // The fire's shadow: step from the surface toward the fire, and see whether the picture has something standing in the way.
              const hidden = float(0).toVar()
              // Only the first metre and a half toward the fire: the picture's depth knows what stands near a surface, and guesses badly across a room.
              const span = min(away.mul(0.9), 1.5)
              Loop(SHADOW_STEPS, ({ i: step }) => {
                const at = view.add(toFire.div(away).mul(float(step).add(grain).div(SHADOW_STEPS).mul(span).add(0.03)))
                const spot = getScreenPosition(at, projection)
                const there = perspectiveDepthToViewZ(depthTexture.sample(spot).level(float(0)).x, near, far)
                const gap = there.sub(at.z)
                const inside = spot.x.greaterThan(0).and(spot.x.lessThan(1)).and(spot.y.greaterThan(0)).and(spot.y.lessThan(1))
                hidden.assign(max(hidden, inside.select(smoothstep(0.02, 0.06, gap).mul(smoothstep(0.5, 0.3, gap)), 0)))
              })
              // A small flame (a candle) casts none: its own stick would shadow half its pool of light.
              lightOn.assign(float(1).sub(hidden.mul(0.85).mul(smoothstep(0.12, 0.4, fire.w))))
            }
            light.addAssign(fall.mul(wrap).mul(lightOn).mul(flicker))
          })
        })
      }
    })
    return vec4(light, 0, 0, 1)
  })(), null, null, { type: THREE.HalfFloatType })
  map.setResolutionScale(0.5)
  const draw = map.updateBefore.bind(map)
  map.updateBefore = (frame) => {
    if (!fires.some((f) => f.w > 0)) return undefined
    near.value = lens.near
    far.value = lens.far
    const done = draw(frame)
    ;(map as typeof map & { onDraw?: (width: number, height: number) => void }).onDraw?.(map.renderTarget!.width, map.renderTarget!.height)
    return done
  }
  return map as typeof map & { onDraw?: (width: number, height: number) => void }
}

/**
 * What the field does to the picture (the post chain calls it on the lit scene colour): what has
 * charred goes black, raggedly, its edge glowing while it still eats forward; what is wet goes
 * darker; deep char that is still hot glows through its cracks; and fire lights the room
 * (firelightMap) while the rest of it sinks a little. Nothing is read while nothing has burnt,
 * is wet or is lit; one read a pixel while only char remains.
 */
export function fieldLook(color: THREE.Node<'vec4'>, depthTexture: THREE.TextureNode, camera: THREE.Camera, shadows: boolean): { color: THREE.Node<'vec4'>; dispose(): void } {
  const projectionInverse = uniform(camera.projectionMatrixInverse)
  const world = uniform(camera.matrixWorld)
  const depth = depthTexture.x
  const firelit = firelightMap(depthTexture, camera, shadows)
  // One texel of the firelight map, in uv (set as the map is drawn).
  const texel = uniform(new THREE.Vector2(1 / 1280, 1 / 800))
  firelit.onDraw = (w, h) => texel.value.set(1 / w, 1 / h)
  const out = Fn(() => {
    const out = vec4(color).toVar()
    const glare = fireAt(0).w.add(fireAt(1).w).add(fireAt(2).w).add(fireAt(3).w)
    If(look.active.greaterThan(0.5).or(glare.greaterThan(0)).and(depth.lessThan(0.99999)), () => {
      const view = getViewPosition(uv(), depth, projectionInverse)
      const p = world.mul(vec4(view, 1)).xyz
      const toEye = world.mul(vec4(0, 0, 0, 1)).xyz.sub(p).normalize()
      // Each is given its value here, at the top: a variable first met inside a branch would belong to that branch.
      const color = vec3(0).toVar(), lit = vec3(0).toVar(), T = float(0).toVar(), char = float(0).toVar(), edge = float(0).toVar()
      color.assign(out.rgb)
      T.assign(0)
      char.assign(0)
      edge.assign(0)
      // Only inside the field's box: past it, a read would be the edge cell's, metres away.
      const g = p.sub(look.origin).div(look.cell)
      If(look.active.greaterThan(0.5).and(min(g.x, min(g.y, g.z)).greaterThanEqual(0)).and(g.x.lessThanEqual(NX)).and(g.y.lessThanEqual(NY)).and(g.z.lessThanEqual(NZ)), () => {
        // Char and wet are the surface's own, read where it is; while the field rests, that is the only read.
        const own = fieldAt(look.field, p.sub(toEye.mul(look.cell.x.mul(0.25))), look.origin, look.cell)
        char.assign(own.b)
        const wet = own.g.toVar()
        If(look.hot.greaterThan(0.5), () => {
          // Heat is the air's, a little in front of the surface, where its flames are.
          const s = fieldAt(look.field, p.add(toEye.mul(look.cell.x.mul(0.6))), look.origin, look.cell)
          T.assign(max(s.r, own.r))
          wet.assign(max(wet, s.g))
          char.assign(max(char, s.b))
        })
        // Char eats into a surface raggedly: scorched patches first, then charcoal all over (the grain still shows a little).
        const tooth = drift(p.x.mul(0.9).add(p.y.mul(0.37)), p.z.mul(0.9).add(p.y.mul(0.53))).x.mul(0.3).add(drift(p.x.mul(3.1).sub(p.y.mul(1.3)), p.z.mul(3.1).add(p.y.mul(0.7))).y.mul(0.2)).add(0.5)
        const black = smoothstep(tooth.mul(0.55), tooth.mul(0.55).add(0.22), char)
        color.assign(mix(color, color.mul(vec3(0.06, 0.047, 0.04)).add(vec3(0.004, 0.003, 0.003)), black.mul(0.96)).mul(float(1).sub(wet.mul(0.18))))
        // Where the char is still eating forward and the air is hot, its edge glows like burning paper.
        edge.assign(black.mul(float(1).sub(black)).mul(4).mul(smoothstep(150, 450, T)))
      })
      lit.assign(color)
      If(glare.greaterThan(0), () => {
        // The eye settles on the fire: the rest of the room sinks a little, so the firelight reads in daylight too.
        lit.mulAssign(float(1).sub(smoothstep(0, 2.2, glare).mul(0.5)))
        // Four reads a texel apart: the shadows' grain melts into soft firelight.
        const tap = (x: number, y: number) => firelit.sample(uv().add(vec2(x, y).mul(texel))).level(float(0)).x
        const glow = tap(-1, -1).add(tap(1, -1)).add(tap(-1, 1)).add(tap(1, 1)).mul(0.25)
        // The lit colour stands in for the surface's own (there is no albedo to read), with a little of the fire's on top.
        lit.addAssign(color.mul(vec3(1.0, 0.5, 0.16)).add(vec3(0.05, 0.016, 0.003)).mul(glow))
      })
      lit.addAssign(vec3(1.0, 0.32, 0.04).mul(edge.mul(1.3)))
      out.assign(vec4(lit, out.a))
    })
    // Lightning: the whole room goes cold white for a moment.
    return vec4(out.rgb.add(vec3(0.75, 0.82, 1.0).mul(look.flash.mul(0.9))), out.a)
  })()
  return { color: out, dispose: () => firelit.dispose() }
}
