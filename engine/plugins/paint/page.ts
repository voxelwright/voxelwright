// Marks on the ground, on the page (#264): the rings and lines rules drew (world.mjs) laid on the picture as chalk
// is laid on a street. One pass over the whole picture after the world and its people are drawn: each pixel's place
// is found again from the picture's depth (as the wand finds what it lights), and a place on something level near
// the ground under a mark takes the mark's colour. So a mark lies on the road and the pavement, goes under a parked
// car and behind a house, and is never drawn over a wall or a person.
//
// It draws through the door the page gives its plugins (`engine.draws`, page/plugins.ts): a pass every frame after
// people, puffs and crumbs, taken out again on `close`. One that fails is taken out by the page, which says so.

interface View { eye: readonly number[]; forward: readonly number[]; right: readonly number[]; up: readonly number[]; tanHalf: number }
interface Target { color: GPUTextureView; depth: GPUTextureView; size: readonly [number, number] }
type Draw = (encoder: GPUCommandEncoder, to: Target, view: View, time: number) => void
interface Engine { gpu: { device: GPUDevice; format: GPUTextureFormat }; draws: { add(name: string, draw: Draw): void; remove(name: string): void; names: string[] }; feet(x: number, z: number): number; march: { day: number } }
interface Mark { id: string; colour: string; wide: number; fill: number; at?: [number, number]; within?: number; line?: [number, number][]; closed?: boolean }

/** The most marks drawn, and points of lines between them (world.mjs keeps a world to 64 marks of 32 points). */
const MOST = 64, POINTS = MOST * 32
/** Floats a mark is told to the GPU as: five vec4f. */
const EACH = 20

const CODE = /* wgsl */ `
struct U { eye: vec3f, tanHalf: f32, right: vec3f, aspect: f32, up: vec3f, fine: f32, forward: vec3f, count: f32, res: vec2f, light: f32, pad: f32 }
// a: ring 0 or line 1, points, first point, closed; b: colour, how wide; c: fill, lowest, highest, within; d: the box it lies in (x, z to x, z); e: its middle
struct Mark { a: vec4f, b: vec4f, c: vec4f, d: vec4f, e: vec4f }
@group(0) @binding(0) var<uniform> u: U;
@group(0) @binding(1) var depths: texture_depth_2d;
@group(0) @binding(2) var<storage, read> marks: array<Mark>;
@group(0) @binding(3) var<storage, read> points: array<vec2f>;

@vertex fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
  let p = vec2f(f32((i << 1u) & 2u), f32(i & 2u));
  return vec4f(p * 2.0 - 1.0, 0.5, 1.0);
}
const NEAR = 1.0;
const FAR = 100000.0;
fn grain(c: vec2f) -> f32 {
  var h = (u32(i32(c.x)) * 73856093u) ^ (u32(i32(c.y)) * 83492791u);
  h = (h ^ (h >> 13u)) * 0x5bd1e995u;
  return f32((h ^ (h >> 15u)) >> 8u) / 16777216.0;
}
fn toSegment(p: vec2f, a: vec2f, b: vec2f) -> f32 {
  let ab = b - a;
  let k = clamp(dot(p - a, ab) / max(dot(ab, ab), 1.0e-6), 0.0, 1.0);
  return length(p - a - ab * k);
}
@fragment fn fs(@builtin(position) at: vec4f) -> @location(0) vec4f {
  let uv = (at.xy / u.res) * 2.0 - 1.0;
  let rd = normalize(u.forward + u.right * (uv.x * u.tanHalf * u.aspect) - u.up * (uv.y * u.tanHalf));
  let depth = textureLoad(depths, vec2i(at.xy), 0);
  let t = (NEAR / max(1.0e-7, 1.0 - depth * (FAR - NEAR) / FAR)) / dot(rd, u.forward);
  let pos = (u.eye + rd * t) / u.fine;
  // Which way what is there faces: a mark lies only on what is level (a road, a pavement, a step), not on a wall.
  let n = cross(dpdx(pos), dpdy(pos));
  if (depth >= 0.999999 || abs(n.y) < 0.85 * length(n)) { discard; }
  // How wide a pixel is there, in cells: a line far off is kept a pixel wide.
  let px = max(t / u.fine * u.tanHalf * 2.0 / u.res.y, 0.02);
  let p = pos.xz;
  var colour = vec3f(0.0);
  var cover = 0.0;
  for (var i = 0u; i < u32(u.count); i++) {
    let m = marks[i];
    let edge = m.b.w * 0.5 + px;
    if (pos.y < m.c.y || pos.y > m.c.z || p.x < m.d.x - edge || p.y < m.d.y - edge || p.x > m.d.z + edge || p.y > m.d.w + edge) { continue; }
    var d = 1.0e9;
    var inside = false;
    if (m.a.x == 0.0) {
      let r = length(p - m.e.xy);
      d = abs(r - m.c.w);
      inside = r < m.c.w;
    } else {
      let first = u32(m.a.z);
      let many = u32(m.a.y);
      let ends = select(many - 1u, many, m.a.w > 0.5);
      for (var k = 0u; k < ends; k++) {
        let a = points[first + k];
        let b = points[first + (k + 1u) % many];
        d = min(d, toSegment(p, a, b));
        // Inside a closed line: how many of its sides a line from here to the east crosses.
        if (m.a.w > 0.5 && ((a.y > p.y) != (b.y > p.y)) && p.x < a.x + (p.y - a.y) * (b.x - a.x) / (b.y - a.y)) { inside = !inside; }
      }
      inside = inside && m.a.w > 0.5;
    }
    let half = max(m.b.w * 0.5, px * 0.75);
    let line = 1.0 - smoothstep(half - px * 0.5, half + px * 0.5, d);
    // Chalk: not quite even, by the cell.
    let a = max(line * (0.78 + 0.22 * grain(floor(p * 2.0))), select(0.0, m.c.x, inside));
    colour = m.b.rgb * u.light * a + colour * (1.0 - a);
    cover = a + cover * (1.0 - a);
  }
  if (cover <= 0.0) { discard; }
  return vec4f(colour, cover);
}`

const COLOUR = /^#[0-9a-f]{6}$/
const num = (v: unknown, lo: number, hi: number): v is number => typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi
const spot = (p: unknown): p is [number, number] => Array.isArray(p) && p.length === 2 && p.every((v) => num(v, -(2 ** 30), 2 ** 30))
/** What the world said, read again as a stranger's: the marks a page can draw, and no more of them than it draws. */
const read = (v: unknown): Mark[] => (Array.isArray(v) ? v : []).filter((m): m is Mark => !!m && typeof m === 'object' && typeof m.id === 'string' && typeof m.colour === 'string' && COLOUR.test(m.colour) && num(m.wide, 1, 40) && num(m.fill, 0, 0.8)
  && ((spot(m.at) && num(m.within, 1, 2000)) || (Array.isArray(m.line) && m.line.length >= 2 && m.line.length <= 32 && m.line.every(spot)))).slice(0, MOST)

export default ({ engine }: { engine: Engine }) => {
  const { device, format } = engine.gpu
  // ?fine=n: the page's cells are 2^n to the world's (main.ts FINE).
  const fine = 2 ** Number(new URLSearchParams(location.search).get('fine') ?? 0)
  const block = new Float32Array(20), uniforms = device.createBuffer({ size: block.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST })
  const markBuffer = device.createBuffer({ size: MOST * EACH * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST })
  const pointBuffer = device.createBuffer({ size: POINTS * 8, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST })
  let pipeline: GPURenderPipeline | null = null, bound: { depth: GPUTextureView; group: GPUBindGroup } | null = null
  let count = 0, frames = 0, failed = ''
  /** What is drawn, for a check: each mark's id and the heights it lies between. */
  let shown: { id: string; low: number; high: number }[] = []
  const module = device.createShaderModule({ label: 'paint', code: CODE })
  void device.createRenderPipelineAsync({
    label: 'paint', layout: 'auto', vertex: { module, entryPoint: 'vs' },
    fragment: { module, entryPoint: 'fs', targets: [{ format, blend: { color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' }, alpha: { srcFactor: 'zero', dstFactor: 'one' } } }] },
  }).then((p) => { pipeline = p }, (e) => { failed = String(e); console.warn(`paint: ${e}`) })

  const put = (marks: Mark[]) => {
    const floats = new Float32Array(MOST * EACH), at = new Float32Array(POINTS * 2)
    let used = 0
    shown = []
    marks.forEach((m, i) => {
      const c = [1, 3, 5].map((k) => parseInt(m.colour.slice(k, k + 2), 16) / 255)
      // The heights it lies between: the ground under it, felt for at its points (a ring: its middle and round it).
      const ring = m.at && m.within ? m.at : null, line = m.line ?? []
      const felt = ring ? [ring, ...Array.from({ length: 16 }, (_, k) => [ring[0] + Math.sin(k * Math.PI / 8) * m.within! * (k & 1 ? 0.5 : 1), ring[1] - Math.cos(k * Math.PI / 8) * m.within! * (k & 1 ? 0.5 : 1)])]
        : line.flatMap((p, k) => { const q = line[(k + 1) % line.length]; return [p, [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2]] })
      const ys = felt.map((p) => engine.feet(Math.round(p[0]), Math.round(p[1]))).filter(Number.isFinite)
      const low = (ys.length ? Math.min(...ys) : 0) - 2, high = (ys.length ? Math.max(...ys) : 0) + 2
      shown.push({ id: m.id, low, high })
      const xs = ring ? [ring[0] - m.within!, ring[0] + m.within!] : line.map((p) => p[0]), zs = ring ? [ring[1] - m.within!, ring[1] + m.within!] : line.map((p) => p[1])
      floats.set([ring ? 0 : 1, line.length, used, m.closed ? 1 : 0, ...c, m.wide, m.fill, low, high, m.within ?? 0, Math.min(...xs), Math.min(...zs), Math.max(...xs), Math.max(...zs), ...(ring ?? [0, 0]), 0, 0], i * EACH)
      for (const p of line) { at.set(p, used * 2); used++ }
    })
    count = marks.length
    device.queue.writeBuffer(markBuffer, 0, floats)
    device.queue.writeBuffer(pointBuffer, 0, at)
  }

  const paint = (encoder: GPUCommandEncoder, to: Target, view: View) => {
    if (!count || !pipeline) return
    block.set([...view.eye, view.tanHalf, ...view.right, to.size[0] / to.size[1], ...view.up, fine, ...view.forward, count, to.size[0], to.size[1], 0.3 + 0.7 * engine.march.day, 0])
    device.queue.writeBuffer(uniforms, 0, block)
    if (bound?.depth !== to.depth) bound = { depth: to.depth, group: device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: uniforms } }, { binding: 1, resource: to.depth }, { binding: 2, resource: { buffer: markBuffer } }, { binding: 3, resource: { buffer: pointBuffer } }] }) }
    const pass = encoder.beginRenderPass({ colorAttachments: [{ view: to.color, loadOp: 'load', storeOp: 'store' }] })
    pass.setPipeline(pipeline)
    pass.setBindGroup(0, bound.group)
    pass.draw(3)
    pass.end()
    frames++
  }
  engine.draws.add('paint', (encoder, to, view) => paint(encoder, to, view))

  return {
    state(v: unknown) { put(read(v)) },
    close() { engine.draws.remove('paint'); count = 0; uniforms.destroy(); markBuffer.destroy(); pointBuffer.destroy() },
    /** For a check: what is drawn, how many frames it has been drawn in, and what went wrong if it was switched off. */
    get shown() { return { marks: shown, frames, failed: failed || (engine.draws.names.includes('paint') ? '' : 'its pass failed and was taken out') } },
  }
}
