// The device, and how the probe times what it draws (#140).
//
// A page's frames are held to the screen's rate, so "60 fps" says nothing about how much room
// is left. The probe therefore draws a batch of frames into a texture nobody shows, waits until
// the GPU has finished them all, and divides: milliseconds a frame at the device's own pace.

export interface Gpu {
  adapter: GPUAdapter
  device: GPUDevice
  /** Preferred swapchain canvas format (e.g. bgra8unorm). */
  format: GPUTextureFormat
  /** Linear HDR offscreen scene format: rg11b10ufloat when renderable, else rgba16float. */
  sceneFormat: GPUTextureFormat
  /** Whether WGSL shader-f16 is enabled on this device. */
  canF16: boolean
  /** Whether the device can stamp the start and end of a pass with the GPU's own clock. */
  canTime: boolean
  /** Whatever went wrong on the device after it was opened, as text. */
  faults: string[]
  /**
   * Hears the device lost (#81): a GPU reset, a phone that ran short of memory, a tab long in the background. Told
   * once, at once if it is gone already. Nothing drawn with it is drawn again: the page must stop and say so.
   */
  onLost(each: (info: { reason: string; message: string }) => void): void
}

/** The limits the probe's work depends on. Asked for by name: a device opened with none has the specification's lowest. */
const LIMITS = ['maxTextureDimension2D', 'maxTextureDimension3D', 'maxBufferSize', 'maxStorageBufferBindingSize', 'maxUniformBufferBindingSize'] as const

export async function openGpu(): Promise<Gpu> {
  if (!navigator.gpu) throw new Error('this browser has no WebGPU')
  const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' })
  if (!adapter) throw new Error('WebGPU gave no adapter')
  const requiredLimits: Record<string, number> = {}
  for (const name of LIMITS) requiredLimits[name] = adapter.limits[name]
  const canTime = adapter.features.has('timestamp-query')
  const canRg11b10 = adapter.features.has('rg11b10ufloat-renderable')
  const canF16 = adapter.features.has('shader-f16')
  const requiredFeatures: GPUFeatureName[] = []
  if (canTime) requiredFeatures.push('timestamp-query')
  if (canRg11b10) requiredFeatures.push('rg11b10ufloat-renderable')
  if (canF16) requiredFeatures.push('shader-f16')
  const device = await adapter.requestDevice({ requiredLimits, requiredFeatures })
  const faults: string[] = []
  device.addEventListener('uncapturederror', (e) => faults.push(`error: ${(e as GPUUncapturedErrorEvent).error.message}`))
  let gone: { reason: string; message: string } | null = null
  const hearing = new Set<(info: { reason: string; message: string }) => void>()
  void device.lost.then((info) => {
    faults.push(`lost: ${info.reason} ${info.message}`)
    gone = { reason: String(info.reason ?? 'unknown'), message: String(info.message ?? '') }
    for (const each of hearing) try { each(gone) } catch (e) { console.error(e) }
    hearing.clear()
  })
  const onLost = (each: (info: { reason: string; message: string }) => void) => { if (gone) each(gone); else hearing.add(each) }
  const sceneFormat: GPUTextureFormat = canRg11b10 ? 'rg11b10ufloat' : 'rgba16float'
  return { adapter, device, format: navigator.gpu.getPreferredCanvasFormat(), sceneFormat, canF16, canTime, faults, onLost }
}

/** A shader module, or an error that says what the compiler said. */
export async function shader(device: GPUDevice, label: string, code: string): Promise<GPUShaderModule> {
  const module = device.createShaderModule({ label, code })
  const info = await module.getCompilationInfo()
  const errors = info.messages.filter((m) => m.type === 'error')
  if (errors.length) throw new Error(`${label}: ${errors.map((m) => `${m.lineNum}:${m.linePos} ${m.message}`).join('; ')}`)
  return module
}

/** Somewhere to draw: a colour texture and a depth texture, with an active viewport sub-rect (`size`) inside `allocSize`. */
export interface Target {
  color: GPUTextureView
  depth: GPUTextureView
  /** Active render viewport dimensions `[width, height]`. */
  size: readonly [number, number]
  /** Backing GPU texture dimensions `[width, height]` (grow-only when resized). Defaults to `size`. */
  readonly allocSize?: readonly [number, number]
  /** Ratio `[size[0] / allocSize[0], size[1] / allocSize[1]]` for UV sampling from a persistent target. Defaults to `[1, 1]`. */
  readonly uvScale?: readonly [number, number]
  /** Colour attachment texture format, when known. */
  readonly format?: GPUTextureFormat
}
export interface Offscreen extends Target {
  readonly texture: GPUTexture
  readonly allocSize: readonly [number, number]
  readonly uvScale: readonly [number, number]
  readonly format: GPUTextureFormat
  /**
   * Updates the active render viewport to `size`. Backing textures grow only when `size` exceeds `allocSize`,
   * avoiding GPU allocation churn during dynamic resolution scaling (`steer`). Returns true if backing textures
   * were reallocated.
   */
  resize(size: readonly [number, number]): boolean
  destroy(): void
}

/** What a Target's depth tells apart, cells: nearer than NEAR is 0, further than FAR is 1. (Each pass of the world still writes the pair itself in its shader: #430 says which.) */
export const NEAR = 1, FAR = 100000
/** What a Target's depth is kept as. */
export const DEPTH: GPUTextureFormat = 'depth24plus'
/** Exposed linear HDR luminance threshold above which the bloom pass extracts glow (glow.ts). */
export const GLOWS_OVER = 1.0

export const depthFor = (device: GPUDevice, size: readonly [number, number]) => device.createTexture({ size: [size[0], size[1]], format: DEPTH, usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING })

export function offscreen(gpu: Gpu, size: readonly [number, number], format: GPUTextureFormat = gpu.format): Offscreen {
  const allocate = (dim: readonly [number, number]) => {
    const w = Math.max(1, dim[0]), h = Math.max(1, dim[1])
    const tex = gpu.device.createTexture({ size: [w, h], format, usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC | GPUTextureUsage.TEXTURE_BINDING })
    const dep = depthFor(gpu.device, [w, h])
    return { tex, dep, color: tex.createView(), depth: dep.createView(), alloc: [w, h] as readonly [number, number] }
  }
  let state = allocate(size)
  let active: readonly [number, number] = [Math.max(1, size[0]), Math.max(1, size[1])]
  let uv: readonly [number, number] = [active[0] / state.alloc[0], active[1] / state.alloc[1]]
  return {
    get texture() { return state.tex },
    get color() { return state.color },
    get depth() { return state.depth },
    get size() { return active },
    get allocSize() { return state.alloc },
    get uvScale() { return uv },
    format,
    resize(next) {
      const w = Math.max(1, next[0]), h = Math.max(1, next[1])
      let reallocated = false
      if (w > state.alloc[0] || h > state.alloc[1]) {
        const grown: readonly [number, number] = [Math.max(w, state.alloc[0]), Math.max(h, state.alloc[1])]
        state.tex.destroy()
        state.dep.destroy()
        state = allocate(grown)
        reallocated = true
      }
      active = [w, h]
      uv = [w / state.alloc[0], h / state.alloc[1]]
      return reallocated
    },
    destroy() { state.tex.destroy(); state.dep.destroy() },
  }
}

/** Draws one frame. `timing`, when given, goes on the pass that does the work. */
export type Draw = (encoder: GPUCommandEncoder, to: Target, timing?: GPURenderPassTimestampWrites) => void

/** Waits until everything submitted has been drawn: the queue says so, and a pixel of the last frame is read back. */
async function settle(gpu: Gpu, from: Offscreen, pixel: GPUBuffer) {
  const encoder = gpu.device.createCommandEncoder()
  encoder.copyTextureToBuffer({ texture: from.texture }, { buffer: pixel }, [1, 1])
  gpu.device.queue.submit([encoder.finish()])
  await gpu.device.queue.onSubmittedWorkDone()
  await pixel.mapAsync(GPUMapMode.READ)
  pixel.unmap()
}

/**
 * Milliseconds a frame, at the device's own pace: batches of frames drawn back to back into
 * `to`, each batch bigger until one takes `budget` ms. The time includes writing the commands.
 */
export async function pace(gpu: Gpu, to: Offscreen, draw: Draw, budget = 160): Promise<{ ms: number; frames: number }> {
  const pixel = gpu.device.createBuffer({ size: 16, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ })
  const batch = async (frames: number) => {
    const t0 = performance.now()
    for (let i = 0; i < frames; i++) {
      const encoder = gpu.device.createCommandEncoder()
      draw(encoder, to)
      gpu.device.queue.submit([encoder.finish()])
    }
    await settle(gpu, to, pixel)
    return performance.now() - t0
  }
  await batch(2)
  let frames = 2, ms = 0
  for (;;) {
    const took = await batch(frames)
    ms = took / frames
    if (took >= budget || frames >= 512) break
    frames = Math.min(512, Math.ceil(frames * Math.min(8, Math.max(1.5, (budget * 1.2) / Math.max(took, 1)))))
  }
  pixel.destroy()
  return { ms, frames }
}

/** The GPU's own time for the pass that does the work, ms: the middle of five frames. Null where the device cannot say. */
export async function passTime(gpu: Gpu, to: Offscreen, draw: Draw): Promise<number | null> {
  if (!gpu.canTime) return null
  const { device } = gpu
  const querySet = device.createQuerySet({ type: 'timestamp', count: 2 })
  const resolved = device.createBuffer({ size: 16, usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC })
  const read = device.createBuffer({ size: 16, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ })
  const times: number[] = []
  for (let i = 0; i < 5; i++) {
    const encoder = device.createCommandEncoder()
    draw(encoder, to, { querySet, beginningOfPassWriteIndex: 0, endOfPassWriteIndex: 1 })
    encoder.resolveQuerySet(querySet, 0, 2, resolved, 0)
    encoder.copyBufferToBuffer(resolved, 0, read, 0, 16)
    device.queue.submit([encoder.finish()])
    await read.mapAsync(GPUMapMode.READ)
    const [start, end] = new BigUint64Array(read.getMappedRange().slice(0))
    read.unmap()
    if (end > start) times.push(Number(end - start) / 1e6)
  }
  querySet.destroy(); resolved.destroy(); read.destroy()
  if (!times.length) return null
  times.sort((a, b) => a - b)
  return times[times.length >> 1]
}

// ── A camera ────────────────────────────────────────────────────────────────

export type V3 = readonly [number, number, number]
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const unit = (a: V3): V3 => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l] }

export interface Camera {
  eye: V3
  forward: V3
  right: V3
  up: V3
  /** Tangent of half the upright field of view. */
  tanHalf: number
}
export function camera(eye: V3, target: V3, fovY = 60): Camera {
  const forward = unit(sub(target, eye)), right = unit(cross(forward, [0, 1, 0])), up = cross(right, forward)
  return { eye, forward, right, up, tanHalf: Math.tan((fovY * Math.PI) / 360) }
}
/** World to clip space, 16 numbers column by column, depth 0 (near) to 1 (far). */
export function viewProjection(c: Camera, aspect: number, near: number, far: number): Float32Array {
  const f = 1 / c.tanHalf, back: V3 = [-c.forward[0], -c.forward[1], -c.forward[2]]
  const view = [c.right[0], c.up[0], back[0], 0, c.right[1], c.up[1], back[1], 0, c.right[2], c.up[2], back[2], 0, -dot(c.right, c.eye), -dot(c.up, c.eye), -dot(back, c.eye), 1]
  const proj = [f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, far / (near - far), -1, 0, 0, (far * near) / (near - far), 0]
  const out = new Float32Array(16)
  for (let col = 0; col < 4; col++) for (let row = 0; row < 4; row++) {
    let sum = 0
    for (let k = 0; k < 4; k++) sum += proj[k * 4 + row] * view[col * 4 + k]
    out[col * 4 + row] = sum
  }
  return out
}

/** A whole number from 0 to 1 for two whole numbers and a seed: the same everywhere. */
export function chance(x: number, z: number, seed: number): number {
  let h = (Math.imul(x, 73856093) ^ Math.imul(z, 83492791) ^ Math.imul(seed, 2654435761)) >>> 0
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d) >>> 0
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39) >>> 0
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296
}

/** The shading every piece of work shares, so a lit pixel costs the same in each: a shade for each cell, one sun, the air. */
export const SHADE = /* wgsl */ `
const SUN = vec3f(0.5088, 0.7632, 0.3976);
fn hash3(p: vec3f) -> f32 {
  var q = fract(p * vec3f(0.1031, 0.1030, 0.0973));
  q += dot(q, q.yzx + 33.33);
  return fract((q.x + q.y) * q.z);
}
fn sky(rd: vec3f) -> vec3f {
  let up = clamp(rd.y * 1.6 + 0.1, 0.0, 1.0);
  let glow = pow(max(dot(rd, SUN), 0.0), 64.0);
  return mix(vec3f(0.78, 0.86, 0.96), vec3f(0.24, 0.45, 0.85), up) + vec3f(1.0, 0.9, 0.7) * glow;
}
// A cell's colour lit by the sun: cell is which cell, n the face, light how much sun reaches it, dist how far away it is in metres.
fn lit(paint: vec3f, cell: vec3f, n: vec3f, rd: vec3f, light: f32, dist: f32) -> vec3f {
  let own = hash3(cell);
  let blot = hash3(floor(cell / 4.0) + 7.0);
  let albedo = paint * (0.82 + 0.26 * own + 0.12 * blot);
  let hv = normalize(SUN - rd);
  let shine = pow(max(dot(n, hv), 0.0), 32.0) * 0.25 * light;
  let direct = max(dot(n, SUN), 0.0) * light;
  let above = 0.5 + 0.5 * n.y;
  var col = albedo * (direct * 1.25 + mix(vec3f(0.16, 0.15, 0.14), vec3f(0.3, 0.36, 0.46), above)) + shine;
  col = mix(col, sky(rd), 1.0 - exp(-dist * 0.0012));
  return col;
}
fn tone(col: vec3f) -> vec3f {
  let c = col / (col + 0.6) * 1.35;
  return pow(clamp(c, vec3f(0.0), vec3f(1.0)), vec3f(0.4545));
}
`
