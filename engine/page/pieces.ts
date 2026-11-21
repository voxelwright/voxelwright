// A body on its way (#140, #146). While it moves it is not cells of the world, so the rays do
// not see it: it is drawn as its outside faces, rows of them merged in the core, over the
// marched picture and tested against its depth. The faces are sent to the GPU once; each frame
// only says where the body is and how it is turned. It is lit as the world is and stands in the
// world's shadows (the sun's maps); it casts none of its own. Its glass is seen through (#163): drawn after what is
// solid, it lets what is behind it show, tinted, with what it mirrors on it. Its glass faces are kept apart from the
// solid ones when it is made, so the solid faces are drawn as they were and the glass passes draw only glass. With
// mirrors off its glass is a pale face as the world's is.
import { shader, type Target } from '../probe/gpu.ts'
import { GLASS, GLOBALS, LIGHT, PAINT, SUNLIT, type Marcher, type View } from './march.ts'
import type { Born } from './told.ts'

const CODE = /* wgsl */ `
struct U {
  eye: vec3f, tanHalf: f32,
  right: vec3f, aspect: f32,
  up: vec3f, pad0: f32,
  forward: vec3f, pad1: f32,
  sun: vec3f, pad2: f32,
  // The body's middle of mass from the anchor, and in its own cells; where its low corner was in the world when
  // it came loose (its cells keep their shades); and how it is turned, as the three columns of a matrix.
  // cell: how big one of the body's cells is, in the world's (1 for what came loose from it; less for a thing made finer).
  pos: vec3f, cell: f32,
  // ghost: not 0 for a thing not yet made, drawn pale and seen through (the ask bar's ghost, #220).
  cells: vec3i, ghost: i32,
  com: vec3f, pad5: f32,
  c0: vec3f, pad6: f32,
  c1: vec3f, pad7: f32,
  c2: vec3f, pad8: f32,
}
struct Material { colour: vec3f, wander: f32, rough: f32, mirror: f32, glow: f32, pad: f32 }
struct Looks { palette: array<vec4f, 256>, material: array<Material, 16> }
@group(0) @binding(0) var<uniform> u: U;
@group(0) @binding(1) var<uniform> looks: Looks;
${GLOBALS}
@group(1) @binding(0) var<uniform> g: Globals;
@group(1) @binding(1) var sunMap: texture_2d_array<f32>;
// Where the march looked through a pane of the world's glass: what it lets through, and how far off it is (march.ts panes).
@group(1) @binding(2) var panes: texture_2d<f32>;
${SUNLIT}
${LIGHT}
${GLASS}
struct Out {
  @builtin(position) pos: vec4f,
  @location(0) at: vec3f,
  @location(1) @interpolate(flat) n: vec3f,
  @location(2) @interpolate(flat) kind: u32,
  @location(3) @interpolate(flat) facing: vec3f,
  @location(4) seen: vec3f,
}
const NEAR = 1.0;
const FAR = 100000.0;
// A face is two words: where its row starts in the piece, then how long it is, which way it looks and its kind.
@vertex fn vs(@builtin(vertex_index) v: u32, @location(0) a: u32, @location(1) b: u32) -> Out {
  let start = vec3f(f32(a & 1023u), f32((a >> 10u) & 1023u), f32((a >> 20u) & 1023u));
  let long = f32(b & 255u);
  let axis = (b >> 8u) & 3u;
  let side = f32((b >> 10u) & 1u);
  let cu = f32(v & 1u);
  let cv = f32((v >> 1u) & 1u);
  var p = start;
  var n = vec3f(0.0);
  if (axis == 1u) { p += vec3f(cu * long, side, cv); n = vec3f(0.0, side * 2.0 - 1.0, 0.0); }
  else if (axis == 2u) { p += vec3f(cu * long, cv, side); n = vec3f(0.0, 0.0, side * 2.0 - 1.0); }
  else { p += vec3f(side, cv, cu * long); n = vec3f(side * 2.0 - 1.0, 0.0, 0.0); }
  let turned = mat3x3f(u.c0, u.c1, u.c2);
  let world = u.pos + turned * ((p - u.com) * u.cell) - u.eye;
  let d = dot(world, u.forward);
  var out: Out;
  out.pos = vec4f(dot(world, u.right) / (u.tanHalf * u.aspect), dot(world, u.up) / u.tanHalf, FAR / (FAR - NEAR) * (d - NEAR), d);
  out.at = p;
  out.n = n;
  out.facing = turned * n;
  out.seen = world;
  out.kind = b >> 16u;
  return out;
}
${PAINT}
// What is behind a pane of the world's glass that the march looked through is seen through it, tinted as the pane tints.
fn behindPane(in: Out) -> vec3f {
  let pane = textureLoad(panes, vec2i(in.pos.xy), 0);
  return select(vec3f(1.0), pow(pane.rgb, vec3f(0.4545)), pane.a > 0.0 && length(in.seen) > pane.a);
}
@fragment fn fs(in: Out) -> @location(0) vec4f {
  // (Glass faces come here only with mirrors off: a pale face.)
  let m = looks.material[in.kind & 15u];
  // The cell as it was in the world when the body came loose, and the face as it then looked.
  // Paint goes by the world's cells: a finer thing's boards and bricks are the size the town's are.
  let inside = (in.at - in.n * 0.5) * u.cell;
  let albedo = paint(in.kind, vec3i(floor(inside)) + u.cells, in.n, 1.0, fract(inside), 1.0 / (max(length(in.seen), 1.0) * u.tanHalf * 0.0022));
  var direct = max(dot(in.facing, u.sun), 0.0);
  if (direct > 0.0) {
    // In the world's shadow where the sun's maps say so; where they cannot say, in the sun.
    let sunny = sunlit(in.seen + u.eye, in.facing, 0u);
    if (sunny >= 0.0) { direct *= sunny; }
  }
  let lit = tone(shade(albedo, in.facing, normalize(in.seen), u.sun, direct, 1.0, m.rough, m.glow));
  if (u.ghost != 0) {
    // Every other pixel, in a grain that drifts upward, and paler: the world shows through.
    let p = vec2u(in.pos.xy);
    if (((p.x + p.y + u32(in.at.y * u.cell * 4.0)) & 1u) == 0u) { discard; }
    return vec4f(mix(lit, vec3f(0.75, 0.88, 1.0), 0.45) * behindPane(in), 1.0);
  }
  return vec4f(lit * behindPane(in), 1.0);
}
// A pane of a body's glass, the face of it that looks at the eye (one face a pane, from inside or out). Two passes,
// so that panes need no order among themselves: what is already drawn behind is multiplied by what comes through
// (fs_tint), then what the pane adds of itself goes on top (fs_glint). Both in the picture's own terms, after tone().
fn pane(in: Out) -> bool { return (in.kind & 15u) == 11u && dot(in.facing, in.seen) < 0.0; }
// How much a pane mirrors. In cells finer than the world's a sloping pane is a stair of small faces, half of them seen
// nearly along: each mirrored the sky hard and a windscreen was bands of blue. There the look along a face counts for
// no more than a look at 53 degrees, so every step of the stair mirrors alike.
fn paneMirror(rd: vec3f, n: vec3f) -> f32 {
  if (u.cell >= 1.0) { return glassMirror(rd, n); }
  let facing = min(1.0 - clamp(dot(-rd, n), 0.0, 1.0), 0.4);
  return looks.material[11].mirror * (0.08 + 0.92 * pow(facing, 5.0));
}
@fragment fn fs_tint(in: Out) -> @location(0) vec4f {
  if (!pane(in)) { discard; }
  let rd = normalize(in.seen);
  // (A picture already toned: what lets a share through of the light lets about that share's root through of the picture.)
  return vec4f(pow(glassTint(in.kind, u.cell + 0.5) * 0.94 * (1.0 - paneMirror(rd, in.facing)), vec3f(0.4545)), 1.0);
}
@fragment fn fs_glint(in: Out) -> @location(0) vec4f {
  if (!pane(in)) { discard; }
  let rd = normalize(in.seen);
  let m = looks.material[11];
  // What it mirrors: the sky as the hour colours it, lighter towards the horizon (a body's glass does not ask the world).
  let back = reflect(rd, in.facing);
  let sky = mix(g.skyHorizon.rgb, g.skyZenith.rgb, pow(clamp(back.y, 0.0, 1.0), g.skyZenith.a));
  var direct = max(dot(in.facing, u.sun), 0.0);
  if (direct > 0.0) { let sunny = sunlit(in.seen + u.eye, in.facing, 0u); if (sunny >= 0.0) { direct *= sunny; } }
  // Its own faint film, and the sun's glint off it.
  let own = shade(m.colour, in.facing, rd, u.sun, direct, 1.0, m.rough, 0.0);
  // Added to a picture already toned: as much as it would add to a thing of middling brightness behind it.
  let add = own * 0.1 + sky * paneMirror(rd, in.facing);
  return vec4f(tone(add + 0.3) - tone(vec3f(0.3)), 0.0);
}
`

/** One body as the GPU holds it. */
export interface Piece {
  born: Born
  /** Its middle of mass in the world's finest cells, and its turn (x, y, z, w). */
  pos: [number, number, number]
  rot: [number, number, number, number]
  /** How big one of its cells is, in the world's cells. */
  cell: number
  /** A thing not yet made, drawn pale and seen through. */
  ghost?: boolean
  destroy(): void
}

export interface Pieces {
  /** share: its faces may be drawn from one buffer with every other piece made from the same `born.faces`. */
  add(born: Born, share?: boolean): Piece
  /** mirrors: false is the M key's mirrors off, under which glass is a pale face. */
  draw(encoder: GPUCommandEncoder, to: Target, view: View, sun: readonly [number, number, number], timing?: GPURenderPassTimestampWrites, mirrors?: boolean): void
  readonly count: number
  /** How many faces are drawn a frame. */
  readonly faces: number
}

export async function pieces(device: GPUDevice, format: GPUTextureFormat, march: Marcher): Promise<Pieces> {
  const looks = march.looks
  const module = await shader(device, 'pieces', CODE)
  // One layout for the solid faces and the glass, so a piece's bindings serve all three pipelines.
  const both = GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT
  const own = device.createBindGroupLayout({ entries: [{ binding: 0, visibility: both, buffer: {} }, { binding: 1, visibility: both, buffer: {} }] })
  const shared = device.createBindGroupLayout({ entries: [{ binding: 0, visibility: both, buffer: {} }, { binding: 1, visibility: both, texture: { sampleType: 'unfilterable-float', viewDimension: '2d-array' } }, { binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'unfilterable-float' } }] })
  const layout = device.createPipelineLayout({ bindGroupLayouts: [own, shared] })
  const drawn = (entryPoint: string, glass?: GPUBlendComponent) => device.createRenderPipelineAsync({
    label: `pieces ${entryPoint}`, layout,
    vertex: { module, entryPoint: 'vs', buffers: [{ arrayStride: 8, stepMode: 'instance', attributes: [{ shaderLocation: 0, offset: 0, format: 'uint32' }, { shaderLocation: 1, offset: 4, format: 'uint32' }] }] },
    fragment: { module, entryPoint, targets: [{ format, ...(glass ? { blend: { color: glass, alpha: { srcFactor: 'zero', dstFactor: 'one', operation: 'add' } } } : {}) }] },
    primitive: { topology: 'triangle-strip', cullMode: 'none' },
    // The glass after everything solid, read against its depth and not written to it.
    depthStencil: { format: 'depth24plus', depthWriteEnabled: !glass, depthCompare: 'less' },
  })
  const [pipeline, tint, glint] = await Promise.all([drawn('fs'), drawn('fs_tint', { srcFactor: 'zero', dstFactor: 'src', operation: 'add' }), drawn('fs_glint', { srcFactor: 'one', dstFactor: 'one', operation: 'add' })])
  let lit: { panes: GPUTextureView; group: GPUBindGroup } | null = null
  const litFor = (panes: GPUTextureView) => {
    if (lit?.panes !== panes) lit = { panes, group: device.createBindGroup({ layout: shared, entries: [{ binding: 0, resource: { buffer: march.globals } }, { binding: 1, resource: march.sun.all }, { binding: 2, resource: panes }] }) }
    return lit.group
  }
  /** count: all its faces; glass: how many of them, the last ones, are glass. */
  interface Held extends Piece { faces: GPUBuffer; uniforms: GPUBuffer; bind: GPUBindGroup; count: number; glass: number }
  const live = new Set<Held>()
  /** Faces already on the GPU, by the array they came from: many pieces of one look (the street's cars, #450) draw from one buffer. */
  const common = new WeakMap<Uint32Array, { faces: GPUBuffer; count: number; glass: number; users: number }>()
  return {
    get count() { return live.size },
    get faces() { let n = 0; for (const p of live) n += p.count; return n },
    add(born, share = false) {
      let made = share ? common.get(born.faces) : undefined
      if (!made) {
        // The solid faces first, then the glass ones.
        const all = born.faces, sorted = new Uint32Array(all.length)
        let solid = 0, glass = 0
        for (let i = 0; i < all.length; i += 2) if (((all[i + 1] >>> 16) & 15) !== 11) { sorted[solid * 2] = all[i]; sorted[solid * 2 + 1] = all[i + 1]; solid++ }
        for (let i = 0; i < all.length; i += 2) if (((all[i + 1] >>> 16) & 15) === 11) { sorted[(solid + glass) * 2] = all[i]; sorted[(solid + glass) * 2 + 1] = all[i + 1]; glass++ }
        const faces = device.createBuffer({ size: Math.max(8, sorted.byteLength), usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST })
        device.queue.writeBuffer(faces, 0, sorted)
        made = { faces, count: solid + glass, glass, users: 0 }
        if (share) common.set(born.faces, made)
      }
      made.users++
      const held = made, uniforms = device.createBuffer({ size: 176, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST })
      const bind = device.createBindGroup({ layout: own, entries: [{ binding: 0, resource: { buffer: uniforms } }, { binding: 1, resource: { buffer: looks } }] })
      const piece: Held = { born, pos: [born.low[0] + born.com[0], born.low[1] + born.com[1], born.low[2] + born.com[2]], rot: [0, 0, 0, 1], cell: 1, faces: held.faces, uniforms, bind, count: held.count, glass: held.glass, destroy() { if (!live.delete(piece)) return; uniforms.destroy(); if (--held.users === 0) { held.faces.destroy(); if (common.get(born.faces) === held) common.delete(born.faces) } } }
      live.add(piece)
      return piece
    },
    draw(encoder, to, view, sun, timing, mirrors = true) {
      if (!live.size) return
      const anchor = view.eye.map((e) => Math.floor(e / 64) * 64)
      const block = new ArrayBuffer(176), f = new Float32Array(block), i32 = new Int32Array(block)
      f.set([view.eye[0] - anchor[0], view.eye[1] - anchor[1], view.eye[2] - anchor[2], view.tanHalf, ...view.right, to.size[0] / to.size[1], ...view.up, 0, ...view.forward, 0, ...sun, 0])
      const pass = encoder.beginRenderPass({
        colorAttachments: [{ view: to.color, loadOp: 'load', storeOp: 'store' }],
        depthStencilAttachment: { view: to.depth, depthLoadOp: 'load', depthStoreOp: 'store' },
        ...(timing ? { timestampWrites: timing } : {}),
      })
      pass.setPipeline(pipeline)
      pass.setBindGroup(1, litFor(march.panes(to.size)))
      for (const piece of live) {
        // A piece of no size or no faces is not drawn: a living thing's own cells while it wears a finer look (living.ts), or what is held out of sight.
        if (!piece.cell || !piece.count) continue
        const [x, y, z, w] = piece.rot, b = piece.born
        f.set([piece.pos[0] - anchor[0], piece.pos[1] - anchor[1], piece.pos[2] - anchor[2], piece.cell], 20)
        i32.set(b.low, 24)
        i32[27] = piece.ghost ? 1 : 0
        f.set(b.com, 28)
        // The turn as a matrix, a column at a time.
        f.set([1 - 2 * (y * y + z * z), 2 * (x * y + z * w), 2 * (x * z - y * w)], 32)
        f.set([2 * (x * y - z * w), 1 - 2 * (x * x + z * z), 2 * (y * z + x * w)], 36)
        f.set([2 * (x * z + y * w), 2 * (y * z - x * w), 1 - 2 * (x * x + y * y)], 40)
        device.queue.writeBuffer(piece.uniforms, 0, block.slice(0))
        pass.setBindGroup(0, piece.bind)
        pass.setVertexBuffer(0, piece.faces)
        // The solid faces; with mirrors off the glass too, as pale faces.
        pass.draw(4, mirrors ? piece.count - piece.glass : piece.count)
      }
      // The glass of those that have any: what is behind it tinted, then what it adds of itself.
      if (mirrors) for (const panes of [tint, glint]) {
        pass.setPipeline(panes)
        for (const piece of live) {
          if (!piece.glass || !piece.cell) continue
          pass.setBindGroup(0, piece.bind)
          pass.setVertexBuffer(0, piece.faces)
          pass.draw(4, piece.glass, 0, piece.count - piece.glass)
        }
      }
      pass.end()
    },
  }
}
