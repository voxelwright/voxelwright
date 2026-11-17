// The page stage (#430): the engine with nothing of the world in it, for drawing small solids of cubes into an
// ordinary page. No town, no sky, no ground, no worker, and no frame of its own: something is drawn when somebody
// hands it a part that changed (`put`), and at rest nothing runs. It holds one device, the block pass (pass.ts),
// and for each part a canvas that shows the device's picture directly.
//
// Parts handed over in one turn of the page are drawn together: each is laid on a sheet (59 parts took 12 sheets),
// a sheet is drawn in two passes, and each part's area is copied to its canvas on the GPU. No pixel comes back to the page's thread. Why a
// canvas a part, and not one canvas copied with `drawImage` or one canvas under the window, is measured in
// blocks/proof and told in the README ("Blocks").
import { blocks, fail, type Blocks, type Frame } from './pass.ts'

export interface Stats { draws: number; drawMs: number; flushes: number; flushMs: number; first: number; opened: number; ready: number; lost: number; faults: string[] }

export interface PageStage {
  /** Draws a part into its own canvas by the end of this turn of the page, with the other parts put in it; sooner when the sheet is full. False only if it will never be drawn. */
  put(frame: Frame, canvas: HTMLCanvasElement): boolean
  /** Draws whatever waits now, and resolves when the GPU has done everything asked of it. */
  settle(): Promise<void>
  /** Called when the device was lost and there is a new one: every picture is gone, and every part must be put again. */
  onrestore: (() => void) | null
  /** Called when the device was lost and none could be opened again: nothing will be drawn any more. */
  onfail: (() => void) | null
  readonly device: GPUDevice
  /** For whoever measures. Times are ms on the page's own thread. */
  readonly stats: Stats
  /** Bytes of GPU memory held, by its own count. */
  bytes(): number
  destroy(): void
}

const up = (n: number) => Math.ceil(n / 256) * 256

/** A device with the adapter's own largest texture, and the format its canvases show: null where there is no WebGPU or no adapter. */
async function openDevice(): Promise<{ device: GPUDevice; format: GPUTextureFormat; most: number } | null> {
  if (!navigator.gpu) return null
  const adapter = await navigator.gpu.requestAdapter()
  if (!adapter) return null
  // Asked for by name: a device opened with no limits has the specification's lowest (8192), and a long list at
  // 8 px a cube is taller.
  const most = adapter.limits.maxTextureDimension2D
  return { device: await adapter.requestDevice({ requiredLimits: { maxTextureDimension2D: most } }), format: navigator.gpu.getPreferredCanvasFormat(), most }
}

/** The stage, or null where there is no WebGPU or no adapter. */
export async function pageStage(): Promise<PageStage | null> {
  // The sheet parts are drawn onto together is at most SHEET pixels each way, unless one part is larger; REST ms
  // after the last part was drawn, the textures parts are drawn through are let go.
  const began = performance.now(), SHEET = 1024, REST = 4000
  const stats: Stats = { draws: 0, drawMs: 0, flushes: 0, flushMs: 0, first: 0, opened: 0, ready: 0, lost: 0, faults: [] }
  interface Held { device: GPUDevice; format: GPUTextureFormat; most: number; pass: Blocks }
  let held: Held | null = null, closed = false

  const open = async (): Promise<Held | null> => {
    const got = await openDevice()
    if (!got) return null
    stats.opened ||= performance.now() - began
    const { device } = got
    device.addEventListener('uncapturederror', (e) => stats.faults.push((e as GPUUncapturedErrorEvent).error.message))
    const made: Held = { ...got, pass: await blocks(device, got.format) }
    // A lost device takes every picture with it. Whoever put the parts is told once there is a new one, and puts
    // them again; until then `put` takes parts and shows nothing, so nobody goes on asking every frame.
    void device.lost.then(async (info) => {
      if (closed || held !== made) return
      held = null
      stats.lost++
      stats.faults.push(`lost: ${info.reason ?? ''} ${info.message}`)
      waiting.length = 0
      sheets.length = 0
      for (let tries = 0; tries < 3 && !held && !closed; tries++) {
        if (tries) await new Promise((r) => setTimeout(r, 1000 * tries))
        held = await open().catch((e) => { stats.faults.push(`not opened again: ${e instanceof Error ? e.message : String(e)}`); return null })
      }
      if (held) self.onrestore?.()
      else { stats.faults.push('no device could be opened again'); self.onfail?.() }
    })
    return made
  }
  held = await open()
  if (!held) return null
  stats.ready = performance.now() - began

  // The sheet is as large as what is laid on it and no larger, to the next 256: what is cleared and brought down to
  // one sample a pixel is the whole sheet, however little of it a part covers. A texture is kept for each of the
  // last few sizes.
  const sheets: GPUTexture[] = []
  const sheetFor = (h: Held, w: number, ht: number): GPUTexture => {
    const W = Math.min(h.most, up(w)), H = Math.min(h.most, up(ht))
    const at = sheets.findIndex((t) => t.width === W && t.height === H)
    if (at >= 0) { const [found] = sheets.splice(at, 1); sheets.push(found); return found }
    if (sheets.length === 4) sheets.shift()!.destroy()
    const made = h.device.createTexture({ size: [W, H], format: h.format, usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC })
    sheets.push(made)
    return made
  }

  // Each part's canvas shows the device's picture: it is told so once, and again when its size or the device changes.
  const shown = new WeakMap<HTMLCanvasElement, { context: GPUCanvasContext; w: number; h: number; device: GPUDevice }>()
  const contextOf = (h: Held, canvas: HTMLCanvasElement): GPUCanvasContext => {
    let own = shown.get(canvas)
    if (!own) shown.set(canvas, (own = { context: canvas.getContext('webgpu') as GPUCanvasContext, w: 0, h: 0, device: h.device }))
    if (own.w !== canvas.width || own.h !== canvas.height || own.device !== h.device) {
      own.w = canvas.width; own.h = canvas.height; own.device = h.device
      own.context.configure({ device: h.device, format: h.format, alphaMode: 'premultiplied', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_DST })
    }
    return own.context
  }

  interface Waiting { canvas: HTMLCanvasElement; x: number; y: number; w: number; h: number }
  const waiting: Waiting[] = []
  let ax = 0, ay = 0, ah = 0, needW = 0, needH = 0, asked = false
  let resting: ReturnType<typeof setTimeout> | undefined

  const flush = () => {
    asked = false
    const h = held
    if (!waiting.length || !h) return
    const t0 = performance.now(), encoder = h.device.createCommandEncoder(), to = sheetFor(h, needW, needH)
    h.pass.draw(encoder, to.createView(), [to.width, to.height])
    for (const p of waiting) {
      // A part taken out of the page, or shrunk to nothing, since it was laid has nowhere to go. One made smaller is cut to fit.
      if (!p.w || !p.canvas.isConnected || p.canvas.width < 1 || p.canvas.height < 1) continue
      const w = Math.min(p.w, p.canvas.width, to.width - p.x), ht = Math.min(p.h, p.canvas.height, to.height - p.y)
      encoder.copyTextureToTexture({ texture: to, origin: [p.x, p.y] }, { texture: contextOf(h, p.canvas).getCurrentTexture() }, [w, ht])
    }
    h.device.queue.submit([encoder.finish()])
    waiting.length = 0
    ax = ay = ah = needW = needH = 0
    stats.flushes++; stats.flushMs += performance.now() - t0
    if (!stats.first) stats.first = performance.now()
    // Once nothing has been drawn for a while, what parts are drawn through is let go. One timer, and it ends.
    clearTimeout(resting)
    resting = setTimeout(() => { if (waiting.length || !held) return; held.pass.rest(); for (const t of sheets) t.destroy(); sheets.length = 0 }, REST)
  }

  const self: PageStage = {
    get device() { return held?.device ?? fail('the device is lost') },
    stats,
    onrestore: null,
    onfail: null,
    put(frame, canvas) {
      const h = held, w = frame.wpx, ht = frame.hpx
      if (closed || w < 1 || ht < 1) return false
      // Lost: taken, and put again when `onrestore` says.
      if (!h) return true
      const t0 = performance.now()
      if (w > h.most || ht > h.most) { if (!stats.faults.some((f) => f.startsWith('a part larger'))) stats.faults.push(`a part larger than the device's largest texture (${w} x ${ht}, ${h.most}) is cut off`) }
      if (ax + w > SHEET && ax > 0) { ax = 0; ay += ah; ah = 0 }
      if (ay + ht > SHEET && waiting.length) flush()
      if (!h.pass.lay(frame, { x: ax, y: ay })) { flush(); if (!h.pass.lay(frame, { x: 0, y: 0 })) fail('a part that cannot be laid alone') }
      // A part put twice in one turn is shown as it was last put.
      for (const p of waiting) if (p.canvas === canvas) p.w = 0
      waiting.push({ canvas, x: ax, y: ay, w, h: ht })
      needW = Math.max(needW, ax + w); needH = Math.max(needH, ay + ht)
      ax += w; ah = Math.max(ah, ht)
      if (!asked) { asked = true; queueMicrotask(flush) }
      stats.draws++; stats.drawMs += performance.now() - t0
      return true
    },
    settle() {
      flush()
      return held ? held.device.queue.onSubmittedWorkDone() : Promise.resolve()
    },
    bytes() { return (held?.pass.bytes() ?? 0) + sheets.reduce((n, t) => n + t.width * t.height * 4, 0) },
    destroy() {
      closed = true
      clearTimeout(resting)
      held?.pass.destroy()
      for (const t of sheets) t.destroy()
      held?.device.destroy()
      held = null
    },
  }
  return self
}
