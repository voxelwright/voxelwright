// The block pass (#430): small solids made of cubes. It draws the parts of the Voxelmorphism kit (plant-a-seed,
// packages/voxelmorphism): a button is about 500 cubes, a dialog about 8,000. Whoever uses it hands over a part's
// cubes as the kit keeps them (`Frame`) and says where the part goes (`Place`). Several parts are laid, then drawn
// together in two passes: every part's depth as the light sees it, then every part's picture.
//
// In a page the view is a cabinet projection: a cube's front face lands on whole pixels, and height shows as a
// shift right and down (`shear`). The light, the tones and the page's shadow are the kit's own (its SPEC.md,
// sections 3 and 5). Nothing goes through the world's tone curve or grade, so a material's front face comes out
// as the colour it was given. The picture is transparent where nothing is, with colour already times alpha.
//
// In the world (`world: true`) a part is placed by the caller's matrix and tested against the world's depth. Its
// colours are written at 0.8 and go through the world's last pass.
//
// Axes are the kit's: x right, y down, z towards the viewer, z = 0 the page.
import { DEPTH, GLOWS_OVER, shader } from '../probe/gpu.ts'

/** How far towards and away from the viewer a cube may be, in cubes. */
const Z_RANGE = 512
/** How far apart two parts' values are kept, bytes. A dynamic offset into a uniform buffer must be a multiple of the device's `minUniformBufferOffsetAlignment`, which is 256 unless a smaller one is asked for. The shader reads the first 240 (`VALUES`). */
const SLOT = 256

export interface Light {
  /** Towards the light. */
  toLight: readonly number[]
  sun: number
  ambient: { top: number; front: number; side: number; under: number }
  /** What faces in shadow lean to. */
  ambientTint: readonly number[]
  /** What faces lit past 1 lean to. */
  highlight: readonly number[]
  /** The shadow on the page: its colour and how strong. */
  shadow: readonly number[]
  seam: number
  glow: number
}

/** One part as the kit hands it to a renderer's `draw`. */
export interface Frame {
  /** Eight a cube: its middle, its size, and how it is turned (a quaternion). */
  pos: Float32Array<ArrayBuffer>
  /** Four a cube: its colour, and how much it glows (-1: no seams). */
  col: Float32Array<ArrayBuffer>
  /** Two a cube: how shut in each corner of each face is, two bits a corner. */
  ao: Uint32Array<ArrayBuffer>
  count: number
  /** The part's picture, device pixels. */
  wpx: number
  hpx: number
  /** Where cube 0, 0 is on the picture, device pixels, and how many device pixels a cube is. */
  ox: number
  oy: number
  s: number
  /** The picture's area in cubes: x0, y0, x1, y1. */
  bounds: readonly number[]
  light: Light
  shear: readonly number[]
  glows?: boolean
  /** A hole in the page, on the page's plane, in cubes: x0, y0, x1, y1. What is under the page shows only through it. */
  well?: readonly number[] | null
  groundShadow?: number
  soft?: number
  glowRadius?: number
  glowStrength?: number
}

/** Where a part goes: its picture's corner on what is drawn into (px), or how its cubes come to be seen in the world. */
export type Place = { x: number; y: number } | { clip: Float32Array; area: readonly [number, number, number, number] }

export interface Blocks {
  /**
   * Lays a part. In a page: with its picture's corner at x, y of whatever `draw` will be given. In the world: with
   * the matrix that takes a place among its cubes to where it is seen (`clip`), and the part of its page that takes
   * its shadow (`area`, in cubes). False when there is no room left for it among those laid: draw them, then lay
   * it again.
   */
  lay(frame: Frame, at: Place): boolean
  /**
   * Draws what was laid into `to`, which is `size` pixels. In a page each part is drawn within its own picture's
   * area, cut off at the edges of `to`. In the world `depth` is the world's own, and what is there stays.
   */
  draw(encoder: GPUCommandEncoder, to: GPUTextureView, size: readonly [number, number], how?: { depth?: GPUTextureView }): void
  /** Makes room for this many cubes in one lot, before any part of it is laid. Unasked, a lot holds 16,384, or one larger part alone. */
  reserve(cubes: number): void
  /** Lets go of the textures parts are drawn through: they are made again when next needed. */
  rest(): void
  /** Bytes of GPU memory this holds, for whoever measures. */
  bytes(): number
  destroy(): void
}

/** How many looks into the map of depths a pixel takes, each way from its own: 25 in all, as the kit's own renderer took. */
const LOOKS = 2

const wgsl = (world: boolean) => /* wgsl */ `
struct Part {
  clip: mat4x4f,    // from a place among the part's cubes to where it is seen
  view: vec4f,      // px a cube (z), how strong a glow's halo is (w)
  area: vec4f,      // the part of the page that is this part's picture, in cubes: x0, y0, x1, y1
  sun: vec4f,       // towards the light, its strength
  ambient: vec4f,   // top, front, side, under
  tint: vec4f,      // what shadowed faces lean to, how dark a seam is
  gleam: vec4f,     // what faces lit past 1 lean to, how much glowing cubes glow
  well: vec4f,      // the hole in the page
  shade: vec4f,     // the shadow on the page
  fall: vec4f,      // how far a shadow travels a cube of height (x, y), the penumbra, a halo's reach
  lrect: vec4f,     // the light's view of this part: corner, 1 / size, in cubes
  region: vec4f,    // where that view is kept in the map of depths: corner and size, 0 to 1
}
@group(0) @binding(0) var<uniform> part: Part;
@group(0) @binding(1) var depths: texture_depth_2d;
@group(0) @binding(2) var nearer: sampler_comparison;

fn turned(v: vec3f, q: vec4f) -> vec3f { return v + 2.0 * cross(q.xyz, cross(q.xyz, v) + q.w * v); }
fn lightUv(p: vec3f) -> vec2f { return (p.xy + part.fall.xy * p.z - part.lrect.xy) * part.lrect.zw; }

// How much of the light reaches a point: looks into the map of depths, a penumbra's width across.
fn lit(p: vec3f, n: vec3f, soft: f32) -> f32 {
  let q = p + n * 0.08;
  let uv = lightUv(q);
  let depth = 0.5 - (q.z + 0.06) / ${2 * Z_RANGE}.0;
  let r = soft * part.lrect.zw / ${LOOKS}.0;
  var s = 0.0;
  for (var i = -${LOOKS}; i <= ${LOOKS}; i++) {
    for (var j = -${LOOKS}; j <= ${LOOKS}; j++) {
      s += textureSampleCompareLevel(depths, nearer, part.region.xy + (uv + vec2f(f32(i), f32(j)) * r) * part.region.zw, depth);
    }
  }
  return s / ${(2 * LOOKS + 1) ** 2}.0;
}

struct Cube {
  @location(0) pos: vec3f, @location(1) normal: vec3f, @location(2) face: vec2f, @location(3) uv: vec2f,
  @location(4) at: vec4f, @location(5) quat: vec4f, @location(6) color: vec4f, @location(7) ao: vec2u,
}
struct Face {
  @builtin(position) at: vec4f,
  @location(0) n: vec3f, @location(1) p: vec3f, @location(2) uv: vec2f, @location(3) ao: f32, @location(4) color: vec4f,
}
@vertex fn cube(i: Cube) -> Face {
  let p = i.at.xyz + turned(i.pos * i.at.w, i.quat);
  let f = u32(i.face.x);
  let c = u32(i.face.y);
  var bits = i.ao.y >> ((f - 4u) * 8u + c * 2u);
  if (f < 4u) { bits = i.ao.x >> (f * 8u + c * 2u); }
  var o: Face;
  o.n = turned(i.normal, i.quat);
  o.p = p;
  o.uv = i.uv;
  o.ao = f32(bits & 3u);
  o.color = i.color;
  o.at = part.clip * vec4f(p, 1.0);
  return o;
}
@fragment fn face(i: Face) -> @location(0) vec4f {
${world ? `  // The page hides whatever sinks into it, except through a well cut for it. (In a page that is the page's own
  // depth: see \`page\`. Here the world's depth is not the part's to write a page into.)
  if (i.p.z < -0.001 && (i.p.x < part.well.x || i.p.y < part.well.y || i.p.x > part.well.z || i.p.y > part.well.w)) { discard; }
` : ''}  let n = normalize(i.n);
  let n2 = n * n;
  let amb = n2.x * part.ambient.z + n2.y * select(part.ambient.w, part.ambient.x, n.y < 0.0) + n2.z * select(part.ambient.w, part.ambient.y, n.z > 0.0);
  let ndl = max(dot(n, part.sun.xyz), 0.0);
  var sh = 0.0;
  if (ndl > 0.0) { sh = lit(i.p, n, part.fall.z); }
  let ao = 1.0 - i.ao * 0.17;
  let direct = part.sun.w * ndl * sh;
  let l = amb * ao + direct;
  // Faces in shadow lean to the ambient tint; faces lit past 1 lean to the highlight.
  let base = i.color.rgb;
  var c = base * min(l, 1.0);
  c = mix(c * part.tint.rgb, c, clamp(direct / max(part.sun.w * 0.6, 0.0001), 0.0, 1.0));
  c = mix(c, part.gleam.rgb, clamp((l - 1.0) * 1.5, 0.0, 0.55));
  // A seam along every edge of a cube, so the grid can be counted: one device pixel wide in a page, where a cube
  // is a whole number of them; in the world as wide as a pixel is there.
  let e = min(i.uv, 1.0 - i.uv) * ${world ? '(1.0 / max(fwidth(i.uv), vec2f(0.0001)))' : 'part.view.z'};
  var seam = 0.0;
  if (i.color.a >= 0.0) { seam = 1.0 - smoothstep(0.0, 1.0, min(e.x, e.y)); }
  c *= 1.0 - seam * part.tint.a;
  // Cubes that glow keep their colour whatever the light does.
  let g = max(i.color.a, 0.0) * part.gleam.a;
  c = mix(c, base * (0.86 + 0.14 * min(l, 1.15)) * (1.0 - seam * part.tint.a * 0.5), g * 0.36);
  ${world ? `// The world's last pass makes whatever is over ${GLOWS_OVER} of full glow (glow.ts): the kit's white is kept under it.
  return vec4f(c * ${GLOWS_OVER}, 1.0);` : 'return vec4f(c, 1.0);'}
}

// Depth as the light sees it.
@vertex fn shadow(@location(0) pos: vec3f, @location(4) at: vec4f, @location(5) quat: vec4f) -> @builtin(position) vec4f {
  let p = at.xyz + turned(pos * at.w, quat);
  let uv = lightUv(p);
  return vec4f(uv.x * 2.0 - 1.0, 1.0 - uv.y * 2.0, 0.5 - p.z / ${2 * Z_RANGE}.0, 1.0);
}

// The page hides whatever sinks into it, except through a well cut for it: the page is drawn into the depth alone,
// all of the part's area but the well, as four bands round the well. Throwing the hidden pixels away in \`face\`
// gives the same picture at rest and costs Safari 70 ms for a dialog where this costs 6: a shader that may throw
// a pixel away cannot skip the pixels behind another cube, and each pixel has four samples.
@vertex fn page(@builtin(vertex_index) v: u32, @builtin(instance_index) band: u32) -> @builtin(position) vec4f {
  let corner = vec2f(f32(v & 1u), f32(v >> 1u));
  var a = part.area.xy;
  var b = part.area.zw;
  if (band == 0u) { b.x = part.well.x; } else if (band == 1u) { a.x = part.well.z; } else { a.x = part.well.x; b.x = part.well.z; }
  if (band == 2u) { b.y = part.well.y; }
  if (band == 3u) { a.y = part.well.w; }
  return part.clip * vec4f(a + corner * (b - a), -0.001, 1.0);
}
@fragment fn nothing() -> @location(0) vec4f { return vec4f(0.0); }

// The page itself: nothing, but it takes shadow.
struct Ground { @builtin(position) at: vec4f, @location(0) p: vec3f }
@vertex fn ground(@builtin(vertex_index) v: u32) -> Ground {
  let corner = vec2f(f32(v & 1u), f32(v >> 1u));
  var o: Ground;
  // (In the world a part may stand on another's face: its page is drawn a little proud of that face.)
  o.p = vec3f(part.area.xy + corner * (part.area.zw - part.area.xy), ${world ? '0.03' : '0.0'});
  o.at = part.clip * vec4f(o.p, 1.0);
  return o;
}
@fragment fn shaded(i: Ground) -> @location(0) vec4f {
  let a = (1.0 - lit(i.p, vec3f(0.0, 0.0, 1.0), part.fall.z * 1.25)) * part.shade.a;
  return vec4f(part.shade.rgb * a, a);
}

// A soft halo round every cube that glows. Night only.
struct Halo { @builtin(position) at: vec4f, @location(0) c: vec2f, @location(1) color: vec4f }
@vertex fn halo(@builtin(vertex_index) v: u32, @location(4) at: vec4f, @location(6) color: vec4f) -> Halo {
  const corners = array(vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0), vec2f(-1.0, -1.0), vec2f(1.0, 1.0), vec2f(-1.0, 1.0));
  let corner = corners[v];
  let r = select(0.0, part.fall.w * at.w, color.a > 0.0);
  var o: Halo;
  o.c = corner;
  o.color = color;
  // The halo lies flat to the page round its cube's middle, and counts as a little nearer than it.
  let here = part.clip * vec4f(at.xy + corner * r, at.z, 1.0);
  let ahead = part.clip * vec4f(at.xy + corner * r, at.z + 0.6, 1.0);
  o.at = vec4f(here.xy, ahead.z / ahead.w * here.w, here.w);
  return o;
}
@fragment fn haloed(i: Halo) -> @location(0) vec4f {
  let d = dot(i.c, i.c);
  let g = exp(-d * 3.2) * (1.0 - smoothstep(0.7, 1.0, d)) * part.view.w * i.color.a;
  return vec4f(i.color.rgb * g, g * 0.35);
}
`

/** A cube's 36 corners, ten numbers each: where, its face's normal, which face and which corner of it, and where on the face. The order of faces and corners is the kit's (model.js `FACES`, `CORNERS`). */
function cubeCorners(): Float32Array<ArrayBuffer> {
  const faces = [
    { n: [1, 0, 0], a: [0, 1, 0], b: [0, 0, 1] }, { n: [-1, 0, 0], a: [0, 1, 0], b: [0, 0, 1] },
    { n: [0, 1, 0], a: [1, 0, 0], b: [0, 0, 1] }, { n: [0, -1, 0], a: [1, 0, 0], b: [0, 0, 1] },
    { n: [0, 0, 1], a: [1, 0, 0], b: [0, 1, 0] }, { n: [0, 0, -1], a: [1, 0, 0], b: [0, 1, 0] },
  ]
  const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]], out: number[] = []
  faces.forEach((F, f) => {
    for (const c of [0, 1, 2, 0, 2, 3]) {
      const [sa, sb] = corners[c]
      for (let k = 0; k < 3; k++) out.push(0.5 * (F.n[k] + F.a[k] * sa + F.b[k] * sb))
      out.push(F.n[0], F.n[1], F.n[2], f, c, (sa + 1) / 2, (sb + 1) / 2)
    }
  })
  return new Float32Array(out)
}

interface Laid { first: number; count: number; at: Place; ox: number; oy: number; s: number; shear: readonly number[]; w: number; h: number; region: [number, number, number, number]; glows: boolean }

export interface Options {
  /** Drawn into the world's picture, at one sample a pixel, and tested against the world's depth, not into a picture of its own at four. */
  world?: boolean
}

export async function blocks(device: GPUDevice, format: GPUTextureFormat, options: Options = {}): Promise<Blocks> {
  const world = options.world ?? false, samples = world ? 1 : 4, MAP = 2048, SLOTS = 64, VALUES = 240
  // At most this many texels a cube in the map of depths: 12 in a page, where a cube is 8 or 12 pixels; 6 in the world, where a whole panel is drawn in one lot and seen from further off.
  const DENSE = world ? 6 : 12
  const module = await shader(device, 'blocks', wgsl(world))
  const values: GPUBindGroupLayoutEntry = { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform', hasDynamicOffset: true, minBindingSize: VALUES } }
  const bare = device.createBindGroupLayout({ entries: [values] })
  const lit = device.createBindGroupLayout({ entries: [values, { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'depth' } }, { binding: 2, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'comparison' } }] })
  const layoutOf = (l: GPUBindGroupLayout) => device.createPipelineLayout({ bindGroupLayouts: [l] })

  const corners: GPUVertexBufferLayout = { arrayStride: 40, attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }, { shaderLocation: 1, offset: 12, format: 'float32x3' }, { shaderLocation: 2, offset: 24, format: 'float32x2' }, { shaderLocation: 3, offset: 32, format: 'float32x2' }] }
  const cornersOnly: GPUVertexBufferLayout = { arrayStride: 40, attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }] }
  const where: GPUVertexBufferLayout = { arrayStride: 32, stepMode: 'instance', attributes: [{ shaderLocation: 4, offset: 0, format: 'float32x4' }, { shaderLocation: 5, offset: 16, format: 'float32x4' }] }
  const whereOnly: GPUVertexBufferLayout = { arrayStride: 32, stepMode: 'instance', attributes: [{ shaderLocation: 4, offset: 0, format: 'float32x4' }] }
  const colour: GPUVertexBufferLayout = { arrayStride: 16, stepMode: 'instance', attributes: [{ shaderLocation: 6, offset: 0, format: 'float32x4' }] }
  const shut: GPUVertexBufferLayout = { arrayStride: 8, stepMode: 'instance', attributes: [{ shaderLocation: 7, offset: 0, format: 'uint32x2' }] }
  const over: GPUBlendState = { color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' }, alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' } }
  const multisample = { count: samples }
  const [shadowPipe, facePipe, groundPipe, haloPipe, pagePipe] = await Promise.all([
    device.createRenderPipelineAsync({
      label: 'blocks: depth from the light', layout: layoutOf(bare),
      vertex: { module, entryPoint: 'shadow', buffers: [cornersOnly, where] },
      depthStencil: { format: 'depth32float', depthWriteEnabled: true, depthCompare: 'less-equal' },
    }),
    device.createRenderPipelineAsync({
      label: 'blocks: cubes', layout: layoutOf(lit),
      vertex: { module, entryPoint: 'cube', buffers: [corners, where, colour, shut] },
      fragment: { module, entryPoint: 'face', targets: [{ format }] },
      depthStencil: { format: DEPTH, depthWriteEnabled: true, depthCompare: 'less-equal' },
      multisample,
    }),
    device.createRenderPipelineAsync({
      label: 'blocks: the shadow on the page', layout: layoutOf(lit),
      vertex: { module, entryPoint: 'ground' },
      fragment: { module, entryPoint: 'shaded', targets: [{ format, blend: over }] },
      // In a page nothing is in front of the page but the part's own cubes, drawn after it. In the world there may be.
      depthStencil: { format: DEPTH, depthWriteEnabled: false, depthCompare: world ? 'less-equal' : 'always' },
      primitive: { topology: 'triangle-strip' }, multisample,
    }),
    device.createRenderPipelineAsync({
      label: 'blocks: halos', layout: layoutOf(lit),
      vertex: { module, entryPoint: 'halo', buffers: [whereOnly, colour] },
      fragment: { module, entryPoint: 'haloed', targets: [{ format, blend: over }] },
      depthStencil: { format: DEPTH, depthWriteEnabled: false, depthCompare: 'less-equal' },
      multisample,
    }),
    device.createRenderPipelineAsync({
      label: 'blocks: the page, in depth alone', layout: layoutOf(lit),
      vertex: { module, entryPoint: 'page' },
      fragment: { module, entryPoint: 'nothing', targets: [{ format, writeMask: 0 }] },
      depthStencil: { format: DEPTH, depthWriteEnabled: true, depthCompare: 'always' },
      primitive: { topology: 'triangle-strip' }, multisample,
    }),
  ])

  const cubeBuffer = device.createBuffer({ size: 36 * 40, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST })
  device.queue.writeBuffer(cubeBuffer, 0, cubeCorners())
  const slots = device.createBuffer({ size: SLOT * SLOTS, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST })
  const slotValues = new Float32Array(new ArrayBuffer(SLOT * SLOTS))
  const bareGroup = device.createBindGroup({ layout: bare, entries: [{ binding: 0, resource: { buffer: slots, size: VALUES } }] })
  const sampler = device.createSampler({ compare: 'less-equal', magFilter: 'linear', minFilter: 'linear' })
  // The map of depths, and what reads it: made when first needed, and again after a rest.
  let map: { texture: GPUTexture; view: GPUTextureView; group: GPUBindGroup } | null = null
  const mapOf = () => {
    if (map) return map
    const texture = device.createTexture({ size: [MAP, MAP], format: 'depth32float', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING }), view = texture.createView()
    return (map = { texture, view, group: device.createBindGroup({ layout: lit, entries: [{ binding: 0, resource: { buffer: slots, size: VALUES } }, { binding: 1, resource: view }, { binding: 2, resource: sampler }] }) })
  }

  // Every laid part's cubes, one after another, in three buffers as the kit keeps them.
  let room = 0, cubes: { pos: GPUBuffer; col: GPUBuffer; ao: GPUBuffer } | null = null, used = 0
  const hold = (n: number) => {
    cubes?.pos.destroy(); cubes?.col.destroy(); cubes?.ao.destroy()
    room = n
    const usage = GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST
    cubes = { pos: device.createBuffer({ size: n * 32, usage }), col: device.createBuffer({ size: n * 16, usage }), ao: device.createBuffer({ size: n * 8, usage }) }
  }
  hold(16384)

  // In a page the picture is drawn at several samples a pixel into a texture of its own, and comes out into `to`
  // as one. A texture is kept for each of the last few sizes asked for: a button and then a dialog and then the
  // button again make nothing new.
  interface Scratch { size: readonly [number, number]; color: GPUTexture | null; depth: GPUTexture }
  const scratches: Scratch[] = []
  const scratchFor = (size: readonly [number, number]): Scratch => {
    const at = scratches.findIndex((s) => s.size[0] === size[0] && s.size[1] === size[1])
    if (at >= 0) { const [found] = scratches.splice(at, 1); scratches.push(found); return found }
    if (scratches.length === 4) { const old = scratches.shift()!; old.color?.destroy(); old.depth.destroy() }
    const made: Scratch = {
      size: [size[0], size[1]],
      color: samples > 1 ? device.createTexture({ size: [size[0], size[1]], format, sampleCount: samples, usage: GPUTextureUsage.RENDER_ATTACHMENT }) : null,
      depth: device.createTexture({ size: [size[0], size[1]], format: DEPTH, sampleCount: samples, usage: GPUTextureUsage.RENDER_ATTACHMENT }),
    }
    scratches.push(made)
    return made
  }

  const rest = () => {
    for (const s of scratches) { s.color?.destroy(); s.depth.destroy() }
    scratches.length = 0
    map?.texture.destroy()
    map = null
  }

  const laid: Laid[] = []
  // Where the next part's view from the light goes in the map: along a shelf, then on to the next.
  let shelfX = 0, shelfY = 0, shelfH = 0
  const GUTTER = 8, PER = SLOT / 4

  return {
    lay(frame, at) {
      const { count, light } = frame
      if (laid.length === SLOTS) return false
      // The light's view of the part: its picture's area, grown by how far the tallest thing can throw.
      const L = light.toLight, lsx = -L[0] / L[2], lsy = -L[1] / L[2], pad = 6
      const [bx0, by0, bx1, by1] = frame.bounds
      const u0 = bx0 - pad, v0 = by0 - pad, uw = bx1 - bx0 + pad * 2, vh = by1 - by0 + pad * 2
      // Texels are kept as dense on every part, so the penumbra is as wide on each.
      const texels = Math.min(MAP / uw, MAP / vh, DENSE)
      const sw = Math.max(1, Math.round(uw * texels)), sh = Math.max(1, Math.round(vh * texels))
      if (shelfX + sw > MAP) { shelfX = 0; shelfY += shelfH + GUTTER; shelfH = 0 }
      if (shelfY + sh > MAP) return laid.length === 0 ? fail('a part too large for the map of depths') : false
      if (count > room) { if (laid.length) return false; hold(2 ** Math.ceil(Math.log2(count))) }
      if (used + count > room) return false
      const region: Laid['region'] = [shelfX, shelfY, sw, sh]
      shelfX += sw + GUTTER
      shelfH = Math.max(shelfH, sh)

      if (count) {
        device.queue.writeBuffer(cubes!.pos, used * 32, frame.pos, 0, count * 8)
        device.queue.writeBuffer(cubes!.col, used * 16, frame.col, 0, count * 4)
        device.queue.writeBuffer(cubes!.ao, used * 8, frame.ao, 0, count * 2)
      }
      // Everything but the matrix, which waits to be told how large what is drawn into is.
      const well = frame.well ?? [0, 0, -1, -1], a = light.ambient, { ox, oy, s } = frame
      const area = 'clip' in at ? at.area : [-ox / s, -oy / s, (frame.wpx - ox) / s, (frame.hpx - oy) / s]
      slotValues.set([
        0, 0, s, light.glow * (frame.glowStrength ?? 0.11),
        area[0], area[1], area[2], area[3],
        L[0], L[1], L[2], light.sun,
        a.top, a.front, a.side, a.under,
        light.ambientTint[0], light.ambientTint[1], light.ambientTint[2], light.seam,
        light.highlight[0], light.highlight[1], light.highlight[2], light.glow,
        well[0], well[1], well[2], well[3],
        light.shadow[0], light.shadow[1], light.shadow[2], light.shadow[3] * (frame.groundShadow ?? 1),
        lsx, lsy, frame.soft ?? 0.22, frame.glowRadius ?? 2.4,
        u0, v0, 1 / uw, 1 / vh,
        region[0] / MAP, region[1] / MAP, region[2] / MAP, region[3] / MAP,
      ], laid.length * PER + 16)
      laid.push({ first: used, count, at, ox, oy, s, shear: frame.shear, w: frame.wpx, h: frame.hpx, region, glows: light.glow > 0 && !!frame.glows })
      used += count
      return true
    },
    draw(encoder, to, size, how = {}) {
      if (!laid.length) return
      const [W, H] = size
      laid.forEach((l, i) => {
        if ('clip' in l.at) return slotValues.set(l.at.clip, i * PER)
        // The cabinet projection: a cube's face on whole pixels, its height a shift right and down.
        const x = l.ox + l.at.x, y = l.oy + l.at.y
        slotValues.set([
          (2 * l.s) / W, 0, 0, 0,
          0, (-2 * l.s) / H, 0, 0,
          (2 * l.s * l.shear[0]) / W, (-2 * l.s * l.shear[1]) / H, -1 / (2 * Z_RANGE), 0,
          (2 * x) / W - 1, 1 - (2 * y) / H, 0.5, 1,
        ], i * PER)
      })
      device.queue.writeBuffer(slots, 0, slotValues, 0, laid.length * PER)

      const m = mapOf()
      const depth = encoder.beginRenderPass({ label: 'blocks: depth from the light', colorAttachments: [], depthStencilAttachment: { view: m.view, depthClearValue: 1, depthLoadOp: 'clear', depthStoreOp: 'store' } })
      depth.setPipeline(shadowPipe)
      depth.setVertexBuffer(0, cubeBuffer)
      depth.setVertexBuffer(1, cubes!.pos)
      laid.forEach((l, i) => {
        if (!l.count) return
        depth.setViewport(l.region[0], l.region[1], l.region[2], l.region[3], 0, 1)
        depth.setScissorRect(l.region[0], l.region[1], l.region[2], l.region[3])
        depth.setBindGroup(0, bareGroup, [i * SLOT])
        depth.draw(36, l.count, 0, l.first)
      })
      depth.end()

      const s = how.depth ? null : scratchFor(size), load: GPULoadOp = how.depth ? 'load' : 'clear'
      const picture = encoder.beginRenderPass({
        label: 'blocks: the pictures',
        colorAttachments: [s?.color
          ? { view: s.color.createView(), resolveTarget: to, loadOp: load, storeOp: 'discard' }
          : { view: to, loadOp: load, storeOp: 'store' }],
        depthStencilAttachment: how.depth
          ? { view: how.depth, depthLoadOp: 'load', depthStoreOp: 'store' }
          : { view: s!.depth.createView(), depthClearValue: 1, depthLoadOp: 'clear', depthStoreOp: 'discard' },
      })
      laid.forEach((l, i) => {
        if (!('clip' in l.at)) {
          // Only the part's own area, cut off where it leaves the picture.
          const x0 = Math.max(0, l.at.x), y0 = Math.max(0, l.at.y), x1 = Math.min(W, l.at.x + l.w), y1 = Math.min(H, l.at.y + l.h)
          if (x1 <= x0 || y1 <= y0) return
          picture.setScissorRect(x0, y0, x1 - x0, y1 - y0)
        }
        picture.setBindGroup(0, m.group, [i * SLOT])
        if (!world) { picture.setPipeline(pagePipe); picture.draw(4, 4) }
        picture.setPipeline(groundPipe)
        picture.draw(4)
        if (!l.count) return
        picture.setPipeline(facePipe)
        picture.setVertexBuffer(0, cubeBuffer)
        picture.setVertexBuffer(1, cubes!.pos)
        picture.setVertexBuffer(2, cubes!.col)
        picture.setVertexBuffer(3, cubes!.ao)
        picture.draw(36, l.count, 0, l.first)
        if (!l.glows) return
        picture.setPipeline(haloPipe)
        picture.setVertexBuffer(0, cubes!.pos)
        picture.setVertexBuffer(1, cubes!.col)
        picture.draw(6, l.count, 0, l.first)
      })
      picture.end()
      laid.length = 0
      used = 0
      shelfX = shelfY = shelfH = 0
    },
    reserve(n) { if (n > room && !laid.length) hold(2 ** Math.ceil(Math.log2(n))) },
    rest,
    bytes() {
      const px = scratches.reduce((n, s) => n + s.size[0] * s.size[1], 0)
      return (map ? MAP * MAP * 4 : 0) + room * 56 + px * 4 * samples * (samples > 1 ? 2 : 1)
    },
    destroy() {
      rest()
      cubes?.pos.destroy(); cubes?.col.destroy(); cubes?.ao.destroy()
      slots.destroy(); cubeBuffer.destroy()
    },
  }
}

export function fail(why: string): never { throw new Error(`blocks: ${why}`) }
