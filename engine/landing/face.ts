// The face (#421): a head in relief on a wall, which a finger takes hold of and stretches, and which springs back.
// It is the one thing in the landing world that is not cells: a sheet of points drawn over the marched picture and
// tested against its depth, as a loose body is (page/pieces.ts), and lit as the world is.
//
// THE SLOT. What is drawn on it now is plainly a stand-in: a checked sheet in the owner's two colours with dots for
// eyes. Nobody's likeness is in it. `photo` is where a picture goes later: an image whose middle is the middle of a
// face, drawn over the head in place of the checks (clear where the picture is clear).
import { shader, type Target } from '../probe/gpu.ts'
import { GLOBALS, LIGHT, SUNLIT, type Marcher, type View } from '../page/march.ts'

type V3 = readonly [number, number, number]

/** Points across and up the sheet. */
const NU = 33, NV = 41
/** How a point comes back to its place: a spring to where it belongs, a spring to its neighbours, and what slows it. Loose enough to wobble three or four times. */
const HOME = 130, NEAR = 260, SLOW = 6.5
/** How far a point may be pulled before it gives a quarter as much, cells; and how far round the finger the sheet comes with it. */
const REACH = 24, ROUND = 10

const CODE = /* wgsl */ `
struct U {
  eye: vec3f, tanHalf: f32,
  right: vec3f, aspect: f32,
  up: vec3f, photo: f32,
  forward: vec3f, pad1: f32,
  sun: vec3f, pad2: f32,
  origin: vec3f, pad3: f32,
  blue: vec3f, pad4: f32,
  yellow: vec3f, pad5: f32,
}
@group(0) @binding(0) var<uniform> u: U;
@group(0) @binding(1) var photo: texture_2d<f32>;
@group(0) @binding(2) var smooth_: sampler;
${GLOBALS}
@group(1) @binding(0) var<uniform> g: Globals;
@group(1) @binding(1) var sunMap: texture_2d_array<f32>;
${SUNLIT}
${LIGHT}
struct Out {
  @builtin(position) pos: vec4f,
  @location(0) uv: vec2f,
  @location(1) n: vec3f,
  @location(2) seen: vec3f,
  @location(3) pull: f32,
}
const NEAR = 1.0;
const FAR = 100000.0;
@vertex fn vs(@location(0) at: vec3f, @location(1) n: vec3f, @location(2) uv: vec2f, @location(3) pull: f32) -> Out {
  let world = u.origin + at - u.eye;
  let d = dot(world, u.forward);
  var out: Out;
  out.pos = vec4f(dot(world, u.right) / (u.tanHalf * u.aspect), dot(world, u.up) / u.tanHalf, FAR / (FAR - NEAR) * (d - NEAR), d);
  out.uv = uv;
  out.n = n;
  out.seen = world;
  out.pull = pull;
  return out;
}
// Whether a place on the sheet is head: an egg, and an ear each side.
fn head(p: vec2f) -> f32 {
  let egg = length(vec2f(p.x / 0.74, (p.y + 0.02) / (0.9 + 0.06 * p.y))) - 1.0;
  let ear = length(vec2f((abs(p.x) - 0.8) / 0.13, (p.y - 0.06) / 0.2)) - 1.0;
  return min(egg, ear);
}
@fragment fn fs(in: Out) -> @location(0) vec4f {
  let p = in.uv;
  if (head(p) > 0.0) { discard; }
  var albedo: vec3f;
  if (u.photo > 0.5) {
    let c = textureSampleLevel(photo, smooth_, vec2f(p.x * 0.5 + 0.5, 0.5 - p.y * 0.5), 0.0);
    if (c.a < 0.5) { discard; }
    albedo = pow(c.rgb, vec3f(2.2));
  } else {
    // The stand-in: checks, as an untextured thing is shown, in the owner's blue; eyes, brows and a mouth in his yellow.
    let check = (i32(floor((p.x + 1.0) * 5.0)) + i32(floor((p.y + 1.0) * 6.0))) & 1;
    albedo = mix(u.blue, mix(u.blue, vec3f(1.0), 0.2), f32(check));
    let eye = length(vec2f(abs(p.x) - 0.31, p.y - 0.17) / vec2f(0.105, 0.085));
    if (eye < 1.0) { albedo = u.yellow; }
    if (length(vec2f(abs(p.x) - 0.31, p.y - 0.17)) < 0.035) { albedo = vec3f(0.01, 0.012, 0.04); }
    if (abs(p.y - 0.36 - 0.05 * (0.6 - abs(p.x))) < 0.02 && abs(abs(p.x) - 0.31) < 0.15) { albedo = u.yellow; }
    if (abs(p.y + 0.5 - 0.5 * p.x * p.x) < 0.022 && abs(p.x) < 0.27) { albedo = u.yellow; }
  }
  // Where it is pulled thin it pales a little, as stretched rubber does.
  albedo = mix(albedo, vec3f(1.0), min(0.25, in.pull * 0.012));
  let n = normalize(in.n);
  var direct = max(dot(n, u.sun), 0.0);
  if (direct > 0.0) {
    let sunny = sunlit(in.seen + u.eye, n, 0u);
    if (sunny >= 0.0) { direct *= sunny; }
  }
  return vec4f(tone(shade(albedo, n, normalize(in.seen), u.sun, direct, 1.0, 0.6, 0.0)), 1.0);
}
`

export interface Face {
  /** Draws it: one of the stage's passes. */
  draw(encoder: GPUCommandEncoder, to: Target, view: View): void
  /** Moves it on by `dt` seconds. */
  step(dt: number): void
  /** Where a look from `eye` along `way` meets the head: null where it misses. */
  met(eye: V3, way: V3): { at: V3 } | null
  /** Takes hold of it where a look meets it. False where it misses. */
  grab(eye: V3, way: V3): boolean
  /** The finger moved: the look it is now on. */
  drag(eye: V3, way: V3): void
  /** Let go: it springs back. */
  release(): void
  /** A knock, as from something thrown at it: it wobbles. */
  knock(at: V3, hard: number): void
  readonly held: boolean
  /** How far its furthest point is from where it belongs, cells: for whoever checks. */
  readonly stretch: number
}

/**
 * A face on a wall. `at` is the middle of the sheet on the wall, `wide` and `tall` its size in cells, `normal` the
 * way the wall looks (along x or z). `blue` and `yellow` are the stand-in's colours, as light (not as a screen shows
 * them). `photo` is the slot: an image to draw over the head, or nothing.
 */
export async function face(device: GPUDevice, format: GPUTextureFormat, march: Marcher, where: { at: V3; wide: number; tall: number; normal: V3 }, blue: V3, yellow: V3, photo?: ImageBitmap): Promise<Face> {
  const module = await shader(device, 'face', CODE)
  const pipeline = await device.createRenderPipelineAsync({
    label: 'face', layout: 'auto',
    vertex: { module, entryPoint: 'vs', buffers: [{ arrayStride: 36, attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }, { shaderLocation: 1, offset: 12, format: 'float32x3' }, { shaderLocation: 2, offset: 24, format: 'float32x2' }, { shaderLocation: 3, offset: 32, format: 'float32' }] }] },
    fragment: { module, entryPoint: 'fs', targets: [{ format }] },
    primitive: { topology: 'triangle-list', cullMode: 'none' },
    depthStencil: { format: 'depth24plus', depthWriteEnabled: true, depthCompare: 'less' },
  })
  const picture = device.createTexture({ size: photo ? [photo.width, photo.height] : [1, 1], format: 'rgba8unorm', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT })
  if (photo) device.queue.copyExternalImageToTexture({ source: photo }, { texture: picture }, [photo.width, photo.height])
  const uniforms = device.createBuffer({ size: 128, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST })
  const bind = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: uniforms } }, { binding: 1, resource: picture.createView() }, { binding: 2, resource: device.createSampler({ magFilter: 'linear', minFilter: 'linear' }) }] })
  const lit = device.createBindGroup({ layout: pipeline.getBindGroupLayout(1), entries: [{ binding: 0, resource: { buffer: march.globals } }, { binding: 1, resource: march.sun.all }] })

  // The sheet's own directions: out of the wall, across it (to the right as it is looked at) and up.
  const out: V3 = where.normal, across: V3 = [-out[2], 0, out[0]], hw = where.wide / 2, hh = where.tall / 2
  /** How far out of the wall the head stands at a place on the sheet (-1 to 1 each way), cells. */
  const relief = (x: number, y: number) => {
    const bump = (cx: number, cy: number, rx: number, ry: number) => Math.exp(-(((x - cx) / rx) ** 2) - ((y - cy) / ry) ** 2), ax = Math.abs(x)
    const egg = (x / 0.74) ** 2 + ((y + 0.02) / (0.9 + 0.06 * y)) ** 2
    let h = egg < 1 ? 11 * (1 - egg) ** 0.55 : 0
    const both = (cx: number, cy: number, rx: number, ry: number) => Math.exp(-(((ax - cx) / rx) ** 2) - ((y - cy) / ry) ** 2)
    h += 5.5 * bump(0, -0.06, 0.11, 0.26) + 3 * bump(0, -0.2, 0.13, 0.09)      // the nose
    h -= 2.4 * both(0.31, 0.17, 0.15, 0.1)                                      // where the eyes sit
    h += 1.6 * Math.exp(-(((y - 0.34) / 0.07) ** 2)) * Math.exp(-((ax / 0.6) ** 6)) // the brow
    h += 1.6 * both(0.42, -0.22, 0.2, 0.18)                                     // cheeks
    h += 1.4 * bump(0, -0.5, 0.33, 0.1) - 1.3 * bump(0, -0.5, 0.26, 0.03)       // the mouth
    h += 1.6 * bump(0, -0.76, 0.24, 0.12)                                       // the chin
    h += 5 * both(0.82, 0.06, 0.07, 0.17)                                       // ears
    return Math.max(0.4, h)
  }
  const count = NU * NV
  /** Each point's place at rest from the sheet's middle; how far it is from there; how fast that changes. Three numbers each. */
  const rest = new Float32Array(count * 3), off = new Float32Array(count * 3), speed = new Float32Array(count * 3)
  const uv = new Float32Array(count * 2)
  for (let j = 0; j < NV; j++) for (let i = 0; i < NU; i++) {
    const n = j * NU + i, x = (i / (NU - 1)) * 2 - 1, y = (j / (NV - 1)) * 2 - 1, h = relief(x, y)
    for (let a = 0; a < 3; a++) rest[n * 3 + a] = across[a] * x * hw + (a === 1 ? y * hh : 0) + out[a] * h
    uv[n * 2] = x; uv[n * 2 + 1] = y
  }
  const index = new Uint16Array((NU - 1) * (NV - 1) * 6)
  for (let j = 0, at = 0; j < NV - 1; j++) for (let i = 0; i < NU - 1; i++) { const a = j * NU + i; index.set([a, a + 1, a + NU, a + 1, a + NU + 1, a + NU], at); at += 6 }
  const points = new Float32Array(count * 9)
  const vertexBuffer = device.createBuffer({ size: points.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST })
  const indexBuffer = device.createBuffer({ size: index.byteLength, usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST })
  device.queue.writeBuffer(indexBuffer, 0, index)
  let stale = true, awake = false, stretch = 0
  /** The points as they are, with which way the sheet faces at each, written for the GPU. */
  const write = () => {
    const p = (n: number, a: number) => rest[n * 3 + a] + off[n * 3 + a]
    for (let j = 0; j < NV; j++) for (let i = 0; i < NU; i++) {
      const n = j * NU + i, l = j * NU + Math.max(0, i - 1), r = j * NU + Math.min(NU - 1, i + 1), d = Math.max(0, j - 1) * NU + i, t = Math.min(NV - 1, j + 1) * NU + i
      const ax = p(r, 0) - p(l, 0), ay = p(r, 1) - p(l, 1), az = p(r, 2) - p(l, 2), bx = p(t, 0) - p(d, 0), by = p(t, 1) - p(d, 1), bz = p(t, 2) - p(d, 2)
      let nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx
      // The sheet's own out is the way its normals look.
      if (nx * out[0] + ny * out[1] + nz * out[2] < 0) { nx = -nx; ny = -ny; nz = -nz }
      const len = Math.hypot(nx, ny, nz) || 1
      points.set([p(n, 0), p(n, 1), p(n, 2), nx / len, ny / len, nz / len, uv[n * 2], uv[n * 2 + 1], Math.hypot(off[n * 3], off[n * 3 + 1], off[n * 3 + 2])], n * 9)
    }
    device.queue.writeBuffer(vertexBuffer, 0, points)
    stale = false
  }

  /** Where a look meets the level of the wall that stands `lift` cells out of it, from the sheet's middle. */
  const onLevel = (eye: V3, way: V3, lift: number): [number, number, number] | null => {
    const down = way[0] * out[0] + way[1] * out[1] + way[2] * out[2]
    if (Math.abs(down) < 1e-4) return null
    const t = (lift - ((eye[0] - where.at[0]) * out[0] + (eye[1] - where.at[1]) * out[1] + (eye[2] - where.at[2]) * out[2])) / down
    return t > 0 ? [eye[0] + way[0] * t - where.at[0], eye[1] + way[1] * t - where.at[1], eye[2] + way[2] * t - where.at[2]] : null
  }
  const met = (eye: V3, way: V3) => {
    const p = onLevel(eye, way, 5)
    if (!p) return null
    const x = (p[0] * across[0] + p[2] * across[2]) / hw, y = p[1] / hh
    const egg = (x / 0.74) ** 2 + ((y + 0.02) / (0.9 + 0.06 * y)) ** 2, ear = ((Math.abs(x) - 0.8) / 0.13) ** 2 + ((y - 0.06) / 0.2) ** 2
    return egg < 1.1 || ear < 1.2 ? { p, x, y } : null
  }
  /** What is held: the point taken, how much of its move each point near it takes, and the level the finger moves on. */
  let hold: { n: number; share: Float32Array; lift: number } | null = null
  const pullTo = (eye: V3, way: V3) => {
    if (!hold) return
    const p = onLevel(eye, way, hold.lift)
    if (!p) return
    let d = [p[0] - rest[hold.n * 3], p[1] - rest[hold.n * 3 + 1], p[2] - rest[hold.n * 3 + 2]]
    // Along the wall only, and a little out of it the further it is pulled: it comes towards whoever pulls.
    const outward = d[0] * out[0] + d[1] * out[1] + d[2] * out[2]
    d = d.map((v, a) => v - out[a] * outward)
    const far = Math.hypot(d[0], d[1], d[2])
    if (far > REACH) { const k = (REACH + (far - REACH) * 0.25) / far; d = d.map((v) => v * k) }
    const lift = Math.min(far, REACH * 1.5) * 0.3
    for (let n = 0; n < count; n++) {
      const s = hold.share[n]
      if (s < 0.004) continue
      for (let a = 0; a < 3; a++) { const to = (d[a] + out[a] * lift) * s, was = off[n * 3 + a]; off[n * 3 + a] = to; speed[n * 3 + a] = (to - was) * 30 * s }
    }
    stale = true; awake = true
  }

  return {
    get held() { return !!hold },
    get stretch() { return stretch },
    met(eye, way) { const m = met(eye, way); return m && { at: [m.p[0] + where.at[0], m.p[1] + where.at[1], m.p[2] + where.at[2]] } },
    grab(eye, way) {
      const m = met(eye, way)
      if (!m) return false
      // The point of the sheet nearest where the look lands, as the sheet lies now.
      let best = 0, bestD = Infinity
      for (let n = 0; n < count; n++) { const d = (rest[n * 3] + off[n * 3] - m.p[0]) ** 2 + (rest[n * 3 + 1] + off[n * 3 + 1] - m.p[1]) ** 2 + (rest[n * 3 + 2] + off[n * 3 + 2] - m.p[2]) ** 2; if (d < bestD) { bestD = d; best = n } }
      const share = new Float32Array(count)
      for (let n = 0; n < count; n++) share[n] = Math.exp(-((rest[n * 3] - rest[best * 3]) ** 2 + (rest[n * 3 + 1] - rest[best * 3 + 1]) ** 2 + (rest[n * 3 + 2] - rest[best * 3 + 2]) ** 2) / (ROUND * ROUND))
      const r = [rest[best * 3], rest[best * 3 + 1], rest[best * 3 + 2]]
      hold = { n: best, share, lift: r[0] * out[0] + r[1] * out[1] + r[2] * out[2] }
      pullTo(eye, way)
      return true
    },
    drag: pullTo,
    release() { hold = null },
    knock(at, hard) {
      for (let n = 0; n < count; n++) {
        const d2 = (rest[n * 3] + where.at[0] - at[0]) ** 2 + (rest[n * 3 + 1] + where.at[1] - at[1]) ** 2 + (rest[n * 3 + 2] + where.at[2] - at[2]) ** 2, s = Math.exp(-d2 / 150) * hard
        for (let a = 0; a < 3; a++) speed[n * 3 + a] -= out[a] * s
      }
      awake = true
    },
    step(dt) {
      if (!awake) return
      // Small steps: the springs are stiff.
      const steps = Math.max(1, Math.ceil(dt / (1 / 240))), h = dt / steps
      let most = 0, quick = 0
      for (let s = 0; s < steps; s++) {
        for (let j = 0; j < NV; j++) for (let i = 0; i < NU; i++) {
          const n = j * NU + i
          // What the finger holds firmly it alone moves.
          const firm = hold ? hold.share[n] : 0
          if (firm > 0.6) continue
          for (let a = 0; a < 3; a++) {
            const k = n * 3 + a
            const round = ((i > 0 ? off[k - 3] : 0) + (i < NU - 1 ? off[k + 3] : 0) + (j > 0 ? off[k - NU * 3] : 0) + (j < NV - 1 ? off[k + NU * 3] : 0)) / 4
            speed[k] += (-HOME * off[k] + NEAR * (round - off[k]) - SLOW * speed[k]) * h * (1 - firm)
          }
        }
        for (let k = 0; k < count * 3; k++) off[k] += speed[k] * h
      }
      for (let k = 0; k < count * 3; k++) { most = Math.max(most, Math.abs(off[k])); quick = Math.max(quick, Math.abs(speed[k])) }
      stretch = most
      stale = true
      if (!hold && most < 0.02 && quick < 0.2) { off.fill(0); speed.fill(0); awake = false; stretch = 0 }
    },
    draw(encoder, to, view) {
      if (stale) write()
      const anchor = view.eye.map((e) => Math.floor(e / 64) * 64)
      const f = new Float32Array(32)
      f.set([view.eye[0] - anchor[0], view.eye[1] - anchor[1], view.eye[2] - anchor[2], view.tanHalf, ...view.right, to.size[0] / to.size[1], ...view.up, photo ? 1 : 0, ...view.forward, 0, ...march.sun.s, 0, where.at[0] - anchor[0], where.at[1] - anchor[1], where.at[2] - anchor[2], 0, ...blue, 0, ...yellow, 0])
      device.queue.writeBuffer(uniforms, 0, f)
      const pass = encoder.beginRenderPass({ colorAttachments: [{ view: to.color, loadOp: 'load', storeOp: 'store' }], depthStencilAttachment: { view: to.depth, depthLoadOp: 'load', depthStoreOp: 'store' } })
      pass.setPipeline(pipeline)
      pass.setBindGroup(0, bind)
      pass.setBindGroup(1, lit)
      pass.setVertexBuffer(0, vertexBuffer)
      pass.setIndexBuffer(indexBuffer, 'uint16')
      pass.drawIndexed(index.length)
      pass.end()
    },
  }
}
