// Flat faces that show a picture (#450): the screen of a digital billboard and the banner a plane tows. A face is a
// rectangle in the world with words, an image or a video on it (signs.ts `Content`), drawn over the marched picture
// and tested against its depth, as bodies are (pieces.ts). A billboard's screen is lit of itself, by night as by day;
// a banner is cloth, lit by the day (and kept under what the last pass spreads into a glow). A screen is in tiles: one whose cells behind it are gone shows nothing, so a
// board broken by any tool has a hole in its picture where the hole in it is (boards.ts says which).
import { shader, type Target } from '../probe/gpu.ts'
import type { View } from './march.ts'
import type { Content } from './signs.ts'

const SEGMENTS = 16
const CODE = /* wgsl */ `
struct U {
  right: vec3f, tanHalf: f32,
  up: vec3f, aspect: f32,
  forward: vec3f, time: f32,
  // Its middle from the eye, half its width and half its height as vectors (cells).
  at: vec3f, lit: f32,
  hu: vec3f, wave: f32,
  hv: vec3f, push: f32,
  // Which tiles show (a bit each, across then up from the lower left), how many across and up, and 1 if it reads from both sides.
  mask: u32, cols: u32, rows: u32, both: u32,
}
@group(0) @binding(0) var<uniform> u: U;
@group(0) @binding(1) var picture: texture_2d<f32>;
@group(0) @binding(2) var smooth_: sampler;
struct Out { @builtin(position) pos: vec4f, @location(0) uv: vec2f, @location(1) @interpolate(flat) front: f32 }
const NEAR = 1.0;
const FAR = 100000.0;
@vertex fn vs(@builtin(vertex_index) v: u32) -> Out {
  let s = f32(v >> 1u) / ${SEGMENTS}.0;
  let t = f32(v & 1u);
  let n = normalize(cross(u.hu, u.hv));
  // Cloth: held at its leading edge, it waves more the further along.
  var p = u.at + u.hu * (2.0 * s - 1.0) + u.hv * (2.0 * t - 1.0) + n * u.wave * s * sin(s * 9.0 - u.time * 3.0);
  // A little towards the eye, more from far off: its housing's cells are coarser there than the gap in front of them.
  p -= normalize(p) * u.push;
  let d = dot(p, u.forward);
  var out: Out;
  out.pos = vec4f(dot(p, u.right) / (u.tanHalf * u.aspect), dot(p, u.up) / u.tanHalf, FAR / (FAR - NEAR) * (d - NEAR), d);
  out.uv = vec2f(s, t);
  out.front = select(0.0, 1.0, dot(n, u.at) < 0.0);
  return out;
}
@fragment fn fs(in: Out) -> @location(0) vec4f {
  if (in.front < 0.5 && u.both == 0u) { discard; }
  let tile = min(vec2u(in.uv * vec2f(f32(u.cols), f32(u.rows))), vec2u(u.cols - 1u, u.rows - 1u));
  if (((u.mask >> (tile.y * u.cols + tile.x)) & 1u) == 0u) { discard; }
  // From behind, a banner reads the right way round all the same.
  let across = select(1.0 - in.uv.x, in.uv.x, in.front > 0.5);
  let c = textureSampleLevel(picture, smooth_, vec2f(across, 1.0 - in.uv.y), 0.0);
  if (c.a < 0.5) { discard; }
  return vec4f(c.rgb * u.lit, 1.0);
}
`

export interface Style { /** Its ground and its letters, CSS colours. */ ground: string; ink: string; /** Lit of itself (a screen), or by the day (cloth). */ glows: boolean }
export interface Screen {
  /** Its middle in the world's cells, and half its width and half its height as vectors: read every frame. */
  at: [number, number, number]
  hu: [number, number, number]
  hv: [number, number, number]
  /** Which tiles show (boards.ts): a bit each, across then up. */
  mask: number
  hidden: boolean
  /** How far it waves, cells (a banner). */
  wave: number
  show(content: Content | null): void
  /** What it shows now, as a word for the checks: 'text', 'image', 'video' or 'nothing', and whether its picture has come. */
  readonly showing: { kind: string; ready: boolean }
  destroy(): void
}
export interface Screens {
  add(o: { /** Across and up, in pixels of its picture. */ pixels: [number, number]; tiles?: [number, number]; both?: boolean; style: Style }): Screen
  draw(encoder: GPUCommandEncoder, to: Target, view: View, time: number, day: number): void
  readonly count: number
}

export async function screens(device: GPUDevice, format: GPUTextureFormat): Promise<Screens> {
  const module = await shader(device, 'screens', CODE)
  const pipeline = await device.createRenderPipelineAsync({
    label: 'screens', layout: 'auto',
    vertex: { module, entryPoint: 'vs' },
    fragment: { module, entryPoint: 'fs', targets: [{ format }] },
    primitive: { topology: 'triangle-strip', cullMode: 'none' },
    depthStencil: { format: 'depth24plus', depthWriteEnabled: true, depthCompare: 'less' },
  })
  const sampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear' })
  interface Held extends Screen { uniforms: GPUBuffer; bind: GPUBindGroup; tiles: [number, number]; both: boolean; style: Style; tick(): void }
  const live = new Set<Held>()
  return {
    get count() { return live.size },
    add({ pixels, tiles = [1, 1], both = false, style }) {
      const texture = device.createTexture({ size: pixels, format: 'rgba8unorm', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT })
      const uniforms = device.createBuffer({ size: 112, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST })
      const bind = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: uniforms } }, { binding: 1, resource: texture.createView() }, { binding: 2, resource: sampler }] })
      const paper = new OffscreenCanvas(pixels[0], pixels[1]), pen = paper.getContext('2d')!
      const sent = () => device.queue.copyExternalImageToTexture({ source: paper }, { texture }, pixels)
      /** A picture laid over the whole of it, cut to fit and not squeezed. */
      const cover = (source: CanvasImageSource, w: number, h: number) => {
        const scale = Math.max(pixels[0] / w, pixels[1] / h)
        pen.drawImage(source, (pixels[0] - w * scale) / 2, (pixels[1] - h * scale) / 2, w * scale, h * scale)
      }
      const words = (text: string) => {
        pen.fillStyle = style.ground; pen.fillRect(0, 0, pixels[0], pixels[1])
        const lines = text.split('\n').slice(0, 4), room = [pixels[0] * 0.92, pixels[1] * 0.84]
        // The biggest letters that fit, every line the same.
        let size = room[1] / lines.length
        pen.font = `800 ${size}px "Helvetica Neue", Arial, sans-serif`
        const widest = Math.max(1, ...lines.map((l) => pen.measureText(l).width))
        size *= Math.min(1, room[0] / widest)
        pen.font = `800 ${size}px "Helvetica Neue", Arial, sans-serif`
        pen.fillStyle = style.ink; pen.textAlign = 'center'; pen.textBaseline = 'middle'
        lines.forEach((l, i) => pen.fillText(l, pixels[0] / 2, pixels[1] / 2 + (i - (lines.length - 1) / 2) * size * 1.05))
      }
      let video: HTMLVideoElement | null = null, frame = -1, asked = 0, showing = { kind: 'nothing', ready: false }
      const held: Held = {
        at: [0, 0, 0], hu: [1, 0, 0], hv: [0, 1, 0], mask: 0xffffffff, hidden: false, wave: 0, uniforms, bind, tiles, both, style,
        get showing() { return showing },
        show(content) {
          const mine = ++asked
          video = null
          if (!content) { showing = { kind: 'nothing', ready: true }; pen.fillStyle = style.ground; pen.fillRect(0, 0, pixels[0], pixels[1]); sent(); return }
          if ('text' in content) { showing = { kind: 'text', ready: true }; words(content.text); sent(); return }
          if ('video' in content) { showing = { kind: 'video', ready: false }; video = content.video; frame = -1; return }
          // An image: its ground until it has come; one that does not come is said on the console, and the ground stays.
          showing = { kind: 'image', ready: false }
          pen.fillStyle = style.ground; pen.fillRect(0, 0, pixels[0], pixels[1]); sent()
          const image = new Image()
          image.crossOrigin = 'anonymous'
          image.onload = () => { if (mine !== asked) return; cover(image, image.naturalWidth, image.naturalHeight); sent(); showing = { kind: 'image', ready: true } }
          image.onerror = () => { if (mine === asked) console.warn(`a sign's image did not come: ${content.image}`) }
          image.src = content.image
        },
        tick() {
          // A video's frame, when it has a new one.
          if (!video || video.readyState < 2 || video.currentTime === frame) return
          frame = video.currentTime
          try { cover(video, video.videoWidth, video.videoHeight); sent(); showing = { kind: 'video', ready: true } } catch { /* a frame that may not be read (another origin's): the last one stays */ }
        },
        destroy() { if (!live.delete(held)) return; texture.destroy(); uniforms.destroy() },
      }
      live.add(held)
      return held
    },
    draw(encoder, to, view, time, day) {
      if (!live.size) return
      const pass = encoder.beginRenderPass({ colorAttachments: [{ view: to.color, loadOp: 'load', storeOp: 'store' }], depthStencilAttachment: { view: to.depth, depthLoadOp: 'load', depthStoreOp: 'store' } })
      pass.setPipeline(pipeline)
      const block = new ArrayBuffer(112), f = new Float32Array(block), u = new Uint32Array(block)
      for (const s of live) {
        s.tick()
        if (s.hidden || !s.mask) continue
        const from = [s.at[0] - view.eye[0], s.at[1] - view.eye[1], s.at[2] - view.eye[2]], far = Math.hypot(from[0], from[1], from[2])
        f.set([...view.right, view.tanHalf, ...view.up, to.size[0] / to.size[1], ...view.forward, time, ...from, s.style.glows ? 0.94 : 0.2 + 0.58 * day, ...s.hu, s.wave, ...s.hv, s.style.glows ? Math.max(0.6, far * 0.0015) : 0])
        u.set([s.mask >>> 0, s.tiles[0], s.tiles[1], s.both ? 1 : 0], 24)
        device.queue.writeBuffer(s.uniforms, 0, block.slice(0))
        pass.setBindGroup(0, s.bind)
        pass.draw((SEGMENTS + 1) * 2)
      }
      pass.end()
    },
  }
}
