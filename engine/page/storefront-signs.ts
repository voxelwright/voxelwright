// Single-draw-call instanced storefront & civic plaza signage renderer (#93).
// Draws up to 64 active nearby shop fascia signboards, double-sided projecting blade signs,
// and neighborhood plaza archway plaques in ONE GPU instanced pass using a 2048x2048 OffscreenCanvas
// texture atlas (4 cols x 16 rows of crisp 512x128 sign slots).
// Tested against both the raymarched world depth24plus buffer and farModel.depth, realistically
// shaded by sun & sky in daylight, and warmly self-illuminated at dusk/night.
import { shader, type Target } from '../probe/gpu.ts'
import type { View } from './march.ts'

export interface SignStyle {
  bg: string
  ink: string
  accent: string
  trim: string
  font: 'serif' | 'bold' | 'retro' | 'clean'
  glow: boolean
}

export interface SignSpec {
  id: string
  title: string
  subtitle?: string
  category: string
  kind: 'fascia' | 'blade' | 'plaza'
  /** Center position in world cells (10 cm). */
  at: [number, number, number]
  /** Half-width vector along the sign's right edge (cells). */
  hu: [number, number, number]
  /** Half-height vector along the sign's up edge (cells). */
  hv: [number, number, number]
  /** Outward face normal (unit vector). */
  normal: [number, number, number]
  /** 1 = readable from both sides (projecting blade signs & plaza entrance archways). */
  both: boolean
  style: SignStyle
}

export interface StorefrontSigns {
  /** Updates the active set of visible nearby signs (reuses cached atlas slots, zero per-frame repainting for unchanged ids). */
  sync(specs: readonly SignSpec[]): void
  /** Uploads sign uniforms before a render pass begins; returns true when at least one sign will draw. */
  prepare(
    to: Target,
    view: View,
    sun: readonly [number, number, number],
    day: number,
    dull: number,
    faced?: GPUTextureView | null,
  ): boolean
  /** Records the prepared storefront and plaza signs into an active `(to.color, to.depth)` render pass. */
  record(pass: GPURenderPassEncoder): void
  draw(
    encoder: GPUCommandEncoder,
    to: Target,
    view: View,
    sun: readonly [number, number, number],
    day: number,
    dull: number,
    faced?: GPUTextureView | null,
    sharedPass?: GPURenderPassEncoder,
  ): void
  readonly count: number
  clear(): void
}

const COLS = 4
const ROWS = 16
const SLOT_W = 512
const SLOT_H = 128
const ATLAS_W = COLS * SLOT_W
const ATLAS_H = ROWS * SLOT_H
const MAX_SIGNS = COLS * ROWS // 64 slots
const FLOATS_PER_INST = 20 // 5 x vec4f (80 bytes)

const CODE = /* wgsl */ `
struct U {
  eye: vec3f, tanHalf: f32,
  right: vec3f, aspect: f32,
  up: vec3f, day: f32,
  forward: vec3f, dull: f32,
  sun: vec3f, pad: f32,
}
@group(0) @binding(0) var<uniform> u: U;
@group(0) @binding(1) var atlas: texture_2d<f32>;
@group(0) @binding(2) var samp: sampler;
@group(0) @binding(3) var faced: texture_depth_2d;

struct Out {
  @builtin(position) pos: vec4f,
  @location(0) uv: vec2f,
  @location(1) @interpolate(flat) uvRect: vec4f,
  @location(2) @interpolate(flat) front: f32,
  @location(3) @interpolate(flat) both: f32,
  @location(4) @interpolate(flat) glow: f32,
  @location(5) @interpolate(flat) norm: vec3f,
}

const NEAR = 1.0;
const FAR = 100000.0;

@vertex fn vs(
  @builtin(vertex_index) v: u32,
  @location(0) atGlow: vec4f,
  @location(1) huBoth: vec4f,
  @location(2) hvPad: vec4f,
  @location(3) normPad: vec4f,
  @location(4) uvRect: vec4f,
) -> Out {
  let corner = array<vec2f, 6>(
    vec2f(0.0, 0.0), vec2f(1.0, 0.0), vec2f(1.0, 1.0),
    vec2f(0.0, 0.0), vec2f(1.0, 1.0), vec2f(0.0, 1.0),
  )[v % 6u];
  let relCenter = atGlow.xyz - u.eye;
  let n = normalize(normPad.xyz);
  let front = select(0.0, 1.0, dot(n, relCenter) < 0.0);
  var p = relCenter + huBoth.xyz * (corner.x * 2.0 - 1.0) + hvPad.xyz * (corner.y * 2.0 - 1.0);
  // Small depth bias toward camera prevents z-fighting on voxel walls at distance without detaching the sign.
  let dist = max(length(p), 1.0);
  p -= (p / dist) * min(2.2, 0.35 + dist * 0.0012);
  let d = dot(p, u.forward);
  var out: Out;
  out.pos = vec4f(
    dot(p, u.right) / (u.tanHalf * u.aspect),
    dot(p, u.up) / u.tanHalf,
    FAR / (FAR - NEAR) * (d - NEAR),
    d,
  );
  out.uv = corner;
  out.uvRect = uvRect;
  out.front = front;
  out.both = huBoth.w;
  out.glow = atGlow.w;
  out.norm = select(-n, n, front > 0.5);
  return out;
}

@fragment fn fs(in: Out) -> @location(0) vec4f {
  if (in.front < 0.5 && in.both < 0.5) { discard; }
  let fsize = textureDimensions(faced);
  if (fsize.x > 1u) {
    let behind = textureLoad(faced, min(vec2u(in.pos.xy), fsize - 1u), 0);
    if (behind > in.pos.w * 1.004) { discard; }
  }
  // Keep text reading left-to-right on BOTH faces of double-sided blade & archway signs.
  let uCoord = select(1.0 - in.uv.x, in.uv.x, in.front > 0.5);
  let vCoord = 1.0 - in.uv.y;
  let sampleUv = mix(in.uvRect.xy, in.uvRect.zw, vec2f(uCoord, vCoord));
  let tex = textureSampleLevel(atlas, samp, sampleUv, 0.0);
  if (tex.a < 0.45) { discard; }
  // Physically grounded daylight shading in linear HDR with realistic sky bounce so shaded storefront signs stay legible.
  let base = pow(max(tex.rgb, vec3f(0.0)), vec3f(2.2));
  let ndl = max(dot(normalize(in.norm), normalize(u.sun)), 0.0);
  let daylight = (0.62 + 0.38 * ndl) * (0.30 + 0.70 * u.day) * (1.0 - 0.18 * u.dull);
  let night = 1.0 - u.day;
  // Illuminated signs & plaza plaques stay crisp in daytime shade and glow warmly in linear HDR at dusk/night.
  let lit = select(max(0.22, daylight), max(daylight, 0.72 * u.day + 0.88 * night), in.glow > 0.5);
  let warmTint = mix(vec3f(1.0), vec3f(1.08, 0.88, 0.64), night * in.glow);
  let gain = pow(lit, 1.8) * 1.65 + select(0.0, 0.65 * night, in.glow > 0.5);
  return vec4f(base * gain * warmTint, 1.0);
}
`

function fontFamily(kind: SignStyle['font']): string {
  switch (kind) {
    case 'serif':
      return 'Georgia, "Times New Roman", serif'
    case 'retro':
      return '"Trebuchet MS", "Arial Black", "Helvetica Neue", sans-serif'
    case 'bold':
      return '"Helvetica Neue", Arial, sans-serif'
    default:
      return 'system-ui, -apple-system, "Helvetica Neue", sans-serif'
  }
}

function drawBadge(pen: OffscreenCanvasRenderingContext2D, category: string, x: number, y: number, r: number, color: string) {
  pen.save()
  pen.translate(x, y)
  pen.fillStyle = color
  pen.strokeStyle = color
  pen.lineWidth = Math.max(2, r * 0.14)
  pen.lineCap = 'round'
  pen.lineJoin = 'round'
  switch (category) {
    case 'pizza': {
      pen.beginPath()
      pen.moveTo(0, -r * 0.85)
      pen.lineTo(r * 0.78, r * 0.72)
      pen.quadraticCurveTo(0, r * 0.96, -r * 0.78, r * 0.72)
      pen.closePath()
      pen.stroke()
      pen.beginPath()
      pen.arc(0, r * 0.1, r * 0.16, 0, Math.PI * 2)
      pen.arc(-r * 0.25, r * 0.45, r * 0.13, 0, Math.PI * 2)
      pen.arc(r * 0.25, r * 0.42, r * 0.13, 0, Math.PI * 2)
      pen.fill()
      break
    }
    case 'burger': {
      pen.beginPath()
      pen.arc(0, -r * 0.12, r * 0.72, Math.PI, 0)
      pen.fill()
      pen.fillRect(-r * 0.76, r * 0.04, r * 1.52, r * 0.24)
      pen.fillRect(-r * 0.70, r * 0.42, r * 1.40, r * 0.28)
      break
    }
    case 'coffee': {
      pen.strokeRect(-r * 0.56, -r * 0.2, r * 0.95, r * 0.85)
      pen.beginPath()
      pen.arc(r * 0.40, r * 0.2, r * 0.26, -Math.PI * 0.5, Math.PI * 0.5)
      pen.stroke()
      pen.beginPath()
      pen.moveTo(-r * 0.22, -r * 0.42)
      pen.lineTo(-r * 0.22, -r * 0.78)
      pen.moveTo(r * 0.12, -r * 0.42)
      pen.lineTo(r * 0.12, -r * 0.78)
      pen.stroke()
      break
    }
    case 'ice_cream': {
      pen.beginPath()
      pen.arc(0, -r * 0.26, r * 0.48, 0, Math.PI * 2)
      pen.fill()
      pen.beginPath()
      pen.moveTo(-r * 0.42, -r * 0.04)
      pen.lineTo(r * 0.42, -r * 0.04)
      pen.lineTo(0, r * 0.88)
      pen.closePath()
      pen.stroke()
      break
    }
    case 'books': {
      pen.beginPath()
      pen.moveTo(0, -r * 0.45)
      pen.quadraticCurveTo(-r * 0.45, -r * 0.72, -r * 0.8, -r * 0.45)
      pen.lineTo(-r * 0.8, r * 0.55)
      pen.quadraticCurveTo(-r * 0.45, r * 0.28, 0, r * 0.55)
      pen.quadraticCurveTo(r * 0.45, r * 0.28, r * 0.8, r * 0.55)
      pen.lineTo(r * 0.8, -r * 0.45)
      pen.quadraticCurveTo(r * 0.45, -r * 0.72, 0, -r * 0.45)
      pen.stroke()
      pen.beginPath()
      pen.moveTo(0, -r * 0.45)
      pen.lineTo(0, r * 0.55)
      pen.stroke()
      break
    }
    case 'florist': {
      for (let a = 0; a < 5; a++) {
        const ang = (a * Math.PI * 2) / 5
        pen.beginPath()
        pen.arc(Math.cos(ang) * r * 0.36, Math.sin(ang) * r * 0.36 - r * 0.1, r * 0.28, 0, Math.PI * 2)
        pen.fill()
      }
      pen.beginPath()
      pen.moveTo(0, r * 0.25)
      pen.lineTo(0, r * 0.85)
      pen.stroke()
      break
    }
    case 'supermarket':
    case 'grocery':
    case 'corner_store':
    case 'market': {
      // Leaf / market star emblem
      pen.beginPath()
      pen.ellipse(0, 0, r * 0.65, r * 0.38, -0.55, 0, Math.PI * 2)
      pen.fill()
      pen.beginPath()
      pen.moveTo(-r * 0.55, r * 0.55)
      pen.lineTo(r * 0.42, -r * 0.42)
      pen.stroke()
      break
    }
    case 'urgent_care': {
      // Crisp medical cross emblem inside a subtle ring
      pen.beginPath()
      pen.arc(0, 0, r * 0.84, 0, Math.PI * 2)
      pen.stroke()
      const arm = r * 0.54
      const thick = r * 0.28
      pen.fillRect(-thick * 0.5, -arm, thick, arm * 2)
      pen.fillRect(-arm, -thick * 0.5, arm * 2, thick)
      break
    }
    case 'plaza': {
      // Stylized redwood / civic tree emblem
      pen.beginPath()
      pen.moveTo(0, -r * 0.85)
      pen.lineTo(r * 0.62, r * 0.28)
      pen.lineTo(-r * 0.62, r * 0.28)
      pen.closePath()
      pen.fill()
      pen.fillRect(-r * 0.14, r * 0.25, r * 0.28, r * 0.58)
      break
    }
    default: {
      pen.beginPath()
      pen.moveTo(0, -r * 0.7)
      pen.lineTo(r * 0.6, 0)
      pen.lineTo(0, r * 0.7)
      pen.lineTo(-r * 0.6, 0)
      pen.closePath()
      pen.stroke()
      break
    }
  }
  pen.restore()
}

function paintSign(pen: OffscreenCanvasRenderingContext2D, spec: SignSpec) {
  const W = SLOT_W, H = SLOT_H
  pen.clearRect(0, 0, W, H)
  const { bg, ink, accent, trim, font } = spec.style
  const fam = fontFamily(font)

  if (spec.kind === 'blade') {
    // Compact rounded plaque with bold border for perpendicular projecting blade signs
    const pad = 10
    const rad = 20
    pen.beginPath()
    pen.roundRect(pad, pad, W - pad * 2, H - pad * 2, rad)
    pen.fillStyle = bg
    pen.fill()
    pen.lineWidth = 8
    pen.strokeStyle = trim
    pen.stroke()

    pen.beginPath()
    pen.roundRect(pad + 10, pad + 10, W - (pad + 10) * 2, H - (pad + 10) * 2, rad - 6)
    pen.lineWidth = 2.5
    pen.strokeStyle = accent
    pen.stroke()

    drawBadge(pen, spec.category, 66, H * 0.5, 26, accent)

    const text = spec.title.toUpperCase()
    const words = text.split(/\s+/).filter(Boolean)
    const lines = words.length > 2 && text.length > 13
      ? [words.slice(0, Math.ceil(words.length / 2)).join(' '), words.slice(Math.ceil(words.length / 2)).join(' ')]
      : [text]
    const leftX = 112, availW = W - leftX - 32
    let size = lines.length > 1 ? 36 : 48
    const weight = font === 'serif' ? '700' : '800'
    pen.font = `${weight} ${size}px ${fam}`
    const widest = Math.max(1, ...lines.map((l) => pen.measureText(l).width))
    size = Math.max(20, Math.min(size, size * (availW / widest)))
    pen.font = `${weight} ${size}px ${fam}`
    pen.fillStyle = ink
    pen.textAlign = 'center'
    pen.textBaseline = 'middle'
    const cx = leftX + availW * 0.5
    lines.forEach((l, i) => {
      pen.fillText(l, cx, H * 0.5 + (i - (lines.length - 1) / 2) * size * 1.06)
    })
    return
  }

  // Fascia signboard or Civic Plaza archway header plaque
  pen.fillStyle = trim
  pen.fillRect(0, 0, W, H)

  // Subtle architectural recessed signboard face
  pen.fillStyle = bg
  pen.fillRect(6, 6, W - 12, H - 12)

  // Fine inner pinstripe frame
  pen.strokeStyle = accent
  pen.lineWidth = spec.kind === 'plaza' ? 3.5 : 2.5
  pen.strokeRect(13, 13, W - 26, H - 26)

  // Decorative corner accents for plazas & classic serif/retro fascia
  if (spec.kind === 'plaza' || font === 'serif' || font === 'retro') {
    pen.fillStyle = accent
    for (const [cx, cy] of [[18, 18], [W - 18, 18], [18, H - 18], [W - 18, H - 18]]) {
      pen.beginPath()
      pen.arc(cx, cy, 3.5, 0, Math.PI * 2)
      pen.fill()
    }
  }

  const hasBadge = spec.kind === 'plaza' || ['pizza', 'burger', 'coffee', 'ice_cream', 'books', 'florist', 'supermarket', 'grocery', 'corner_store', 'market', 'urgent_care'].includes(spec.category)
  if (hasBadge) {
    drawBadge(pen, spec.kind === 'plaza' ? 'plaza' : spec.category, 56, H * 0.5, 24, accent)
    if (spec.kind === 'plaza') drawBadge(pen, 'plaza', W - 56, H * 0.5, 24, accent)
  }

  const padL = hasBadge ? 96 : 30
  const padR = spec.kind === 'plaza' ? 96 : 30
  const availW = W - padL - padR
  const cx = padL + availW * 0.5
  const title = spec.title.toUpperCase()
  const sub = (spec.subtitle ?? '').trim().toUpperCase()
  const weight = font === 'serif' ? '700' : '800'
  let size = sub ? 44 : 56
  pen.font = `${weight} ${size}px ${fam}`
  const measured = Math.max(1, pen.measureText(title).width)
  size = Math.max(20, Math.min(size, size * (availW / measured)))
  pen.font = `${weight} ${size}px ${fam}`
  pen.fillStyle = ink
  pen.textAlign = 'center'
  pen.textBaseline = 'middle'
  pen.fillText(title, cx, sub ? H * 0.42 : H * 0.52)

  if (sub) {
    let subSize = 18
    pen.font = `700 ${subSize}px system-ui, -apple-system, sans-serif`
    const sw = Math.max(1, pen.measureText(sub).width)
    subSize = Math.max(11, Math.min(subSize, subSize * ((availW * 0.92) / sw)))
    pen.font = `700 ${subSize}px system-ui, -apple-system, sans-serif`
    pen.fillStyle = accent
    pen.fillText(sub, cx, H * 0.76)
  }
}

export async function createStorefrontSigns(device: GPUDevice, format: GPUTextureFormat): Promise<StorefrontSigns> {
  const module = await shader(device, 'storefront-signs', CODE)
  const pipeline = await device.createRenderPipelineAsync({
    label: 'storefront-signs',
    layout: 'auto',
    vertex: {
      module,
      entryPoint: 'vs',
      buffers: [
        {
          arrayStride: FLOATS_PER_INST * 4,
          stepMode: 'instance',
          attributes: [
            { shaderLocation: 0, offset: 0, format: 'float32x4' },
            { shaderLocation: 1, offset: 16, format: 'float32x4' },
            { shaderLocation: 2, offset: 32, format: 'float32x4' },
            { shaderLocation: 3, offset: 48, format: 'float32x4' },
            { shaderLocation: 4, offset: 64, format: 'float32x4' },
          ],
        },
      ],
    },
    fragment: { module, entryPoint: 'fs', targets: [{ format }] },
    primitive: { topology: 'triangle-list', cullMode: 'none' },
    depthStencil: { format: 'depth24plus', depthWriteEnabled: true, depthCompare: 'less' },
  })

  const atlas = device.createTexture({
    label: 'storefront-sign-atlas',
    size: [ATLAS_W, ATLAS_H],
    format: 'rgba8unorm',
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
  })
  const atlasView = atlas.createView()
  const sampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear' })
  const uniforms = device.createBuffer({ size: 80, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST })
  const instances = device.createBuffer({
    size: MAX_SIGNS * FLOATS_PER_INST * 4,
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
  })

  // Fallback 1x1 depth32float when farModel is absent.
  const nothing = device.createTexture({
    size: [1, 1],
    format: 'depth32float',
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
  })
  {
    const enc = device.createCommandEncoder()
    enc.beginRenderPass({
      colorAttachments: [],
      depthStencilAttachment: { view: nothing.createView(), depthClearValue: 0, depthLoadOp: 'clear', depthStoreOp: 'store' },
    }).end()
    device.queue.submit([enc.finish()])
  }
  const none = nothing.createView()

  let bound: { faced: GPUTextureView; group: GPUBindGroup } | null = null
  const bindFor = (faced: GPUTextureView) => {
    if (!bound || bound.faced !== faced) {
      bound = {
        faced,
        group: device.createBindGroup({
          layout: pipeline.getBindGroupLayout(0),
          entries: [
            { binding: 0, resource: { buffer: uniforms } },
            { binding: 1, resource: atlasView },
            { binding: 2, resource: sampler },
            { binding: 3, resource: faced },
          ],
        }),
      }
    }
    return bound.group
  }

  const paper = new OffscreenCanvas(SLOT_W, SLOT_H)
  const pen = paper.getContext('2d')!

  // LRU-like slot allocation: maps sign id -> slot index [0..MAX_SIGNS-1].
  const MAX_PAINTS_PER_FRAME = 6
  const slotOf = new Map<string, number>()
  const slotOwner: (string | null)[] = Array(MAX_SIGNS).fill(null)
  const slotPainted: boolean[] = Array(MAX_SIGNS).fill(false)
  let currentSpecs: readonly SignSpec[] = []
  let hasPendingPaints = false
  const instData = new Float32Array(MAX_SIGNS * FLOATS_PER_INST)
  const uData = new Float32Array(20)
  let activeCount = 0
  let preparedBind: GPUBindGroup | null = null
  let preparedCount = 0

  const uploadActiveInstances = (paintBudget: number) => {
    let paintedNow = 0
    let pending = false
    let outIdx = 0
    for (let i = 0; i < currentSpecs.length; i++) {
      const spec = currentSpecs[i]
      const slot = slotOf.get(spec.id)
      if (slot === undefined) continue
      if (!slotPainted[slot]) {
        if (paintedNow < paintBudget) {
          paintSign(pen, spec)
          const col = slot % COLS
          const row = Math.floor(slot / COLS)
          device.queue.copyExternalImageToTexture(
            { source: paper },
            { texture: atlas, origin: [col * SLOT_W, row * SLOT_H, 0] },
            [SLOT_W, SLOT_H],
          )
          slotPainted[slot] = true
          paintedNow++
        } else {
          pending = true
          continue
        }
      }
      const col = slot % COLS
      const row = Math.floor(slot / COLS)
      // Inset UV by half a texel so linear filtering never bleeds from neighboring atlas slots.
      const u0 = (col * SLOT_W + 0.5) / ATLAS_W
      const v0 = (row * SLOT_H + 0.5) / ATLAS_H
      const u1 = ((col + 1) * SLOT_W - 0.5) / ATLAS_W
      const v1 = ((row + 1) * SLOT_H - 0.5) / ATLAS_H

      const o = outIdx * FLOATS_PER_INST
      instData[o + 0] = spec.at[0]
      instData[o + 1] = spec.at[1]
      instData[o + 2] = spec.at[2]
      instData[o + 3] = spec.style.glow ? 1 : 0
      instData[o + 4] = spec.hu[0]
      instData[o + 5] = spec.hu[1]
      instData[o + 6] = spec.hu[2]
      instData[o + 7] = spec.both ? 1 : 0
      instData[o + 8] = spec.hv[0]
      instData[o + 9] = spec.hv[1]
      instData[o + 10] = spec.hv[2]
      instData[o + 11] = 0
      instData[o + 12] = spec.normal[0]
      instData[o + 13] = spec.normal[1]
      instData[o + 14] = spec.normal[2]
      instData[o + 15] = 0
      instData[o + 16] = u0
      instData[o + 17] = v0
      instData[o + 18] = u1
      instData[o + 19] = v1
      outIdx++
    }
    hasPendingPaints = pending
    activeCount = outIdx
    if (activeCount > 0) {
      device.queue.writeBuffer(instances, 0, instData.subarray(0, activeCount * FLOATS_PER_INST))
    }
  }

  const self: StorefrontSigns = {
    get count() {
      return activeCount
    },
    clear() {
      slotOf.clear()
      slotOwner.fill(null)
      slotPainted.fill(false)
      currentSpecs = []
      hasPendingPaints = false
      activeCount = 0
      preparedCount = 0
    },
    sync(specs) {
      const capped = specs.length > MAX_SIGNS ? specs.slice(0, MAX_SIGNS) : specs
      const wanted = new Set(capped.map((s) => s.id))
      // Free slots no longer in the active window.
      for (let i = 0; i < MAX_SIGNS; i++) {
        const owner = slotOwner[i]
        if (owner && !wanted.has(owner)) {
          slotOf.delete(owner)
          slotOwner[i] = null
          slotPainted[i] = false
        }
      }
      for (let i = 0; i < capped.length; i++) {
        const spec = capped[i]
        if (slotOf.has(spec.id)) continue
        const slot = slotOwner.indexOf(null)
        if (slot < 0) continue
        slotOwner[slot] = spec.id
        slotOf.set(spec.id, slot)
        slotPainted[slot] = false
      }
      currentSpecs = capped
      // Paint up to MAX_PAINTS_PER_FRAME signs per frame so entering a dense retail street never stalls the main thread.
      uploadActiveInstances(MAX_PAINTS_PER_FRAME)
    },
    prepare(to, view, sun, day, dull, faced = null) {
      if (hasPendingPaints) {
        uploadActiveInstances(MAX_PAINTS_PER_FRAME)
      }
      if (activeCount <= 0) {
        preparedCount = 0
        return false
      }
      uData[0] = view.eye[0]; uData[1] = view.eye[1]; uData[2] = view.eye[2]; uData[3] = view.tanHalf
      uData[4] = view.right[0]; uData[5] = view.right[1]; uData[6] = view.right[2]; uData[7] = to.size[0] / to.size[1]
      uData[8] = view.up[0]; uData[9] = view.up[1]; uData[10] = view.up[2]; uData[11] = day
      uData[12] = view.forward[0]; uData[13] = view.forward[1]; uData[14] = view.forward[2]; uData[15] = dull
      uData[16] = sun[0]; uData[17] = sun[1]; uData[18] = sun[2]; uData[19] = 0
      device.queue.writeBuffer(uniforms, 0, uData)
      preparedBind = bindFor(faced ?? none)
      preparedCount = activeCount
      return true
    },
    record(pass) {
      if (preparedCount <= 0 || !preparedBind) return
      pass.setPipeline(pipeline)
      pass.setBindGroup(0, preparedBind)
      pass.setVertexBuffer(0, instances)
      pass.draw(6, preparedCount)
    },
    draw(encoder, to, view, sun, day, dull, faced = null, sharedPass) {
      if (!self.prepare(to, view, sun, day, dull, faced)) return
      if (sharedPass) { self.record(sharedPass); return }
      const pass = encoder.beginRenderPass({
        colorAttachments: [{ view: to.color, loadOp: 'load', storeOp: 'store' }],
        depthStencilAttachment: { view: to.depth, depthLoadOp: 'load', depthStoreOp: 'store' },
      })
      pass.setViewport(0, 0, to.size[0], to.size[1], 0, 1)
      pass.setScissorRect(0, 0, to.size[0], to.size[1])
      self.record(pass)
      pass.end()
    },
  }
  return self
}
