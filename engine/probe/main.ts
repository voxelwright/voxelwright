// The probe (#140): what can this device draw? It opens WebGPU, times three kinds of work at
// the device's own pace (lit pixels, faces, rays through cells), watches a steady load for a
// minute to see whether the device slows as it warms, and posts every number to the server it
// came from. Nobody has to read anything out.
//
//   ?heat=10   watch for 10 s instead of 60 (0 leaves it out)
import { depthFor, offscreen, openGpu, pace, passTime, chance, type Draw, type Offscreen, type Target } from './gpu.ts'
import { fill } from './fill.ts'
import { quads } from './quads.ts'
import { rays, stretch } from './rays.ts'
import { cadence, describe, environment, nextFrame, reporter, round } from './tell.ts'

const BUILD = 'probe-1'
const query = new URLSearchParams(location.search)
const HEAT = Number(query.get('heat') ?? 60)

const canvas = document.querySelector('canvas')!
const head = document.querySelector('#head')!
const lines = document.querySelector('#lines')!
const say = (text: string) => { head.textContent = text }
const line = (text: string) => { const p = document.createElement('p'); p.textContent = text; lines.append(p); lines.scrollTop = lines.scrollHeight }

const megapixels = (size: readonly [number, number]) => (size[0] * size[1]) / 1e6
const { report, post } = reporter(BUILD)

/** How fast this device's one thread walks cells: a block of 96 cells a side, about two thirds solid, split into its joined pieces, as the engine does after a blow. */
function walk(): { ms: number; cells: number; pieces: number } {
  const n = 96, total = n * n * n, cells = new Uint8Array(total), labels = new Int32Array(total), stack = new Int32Array(total)
  for (let i = 0; i < total; i++) cells[i] = chance(i, i >>> 9, 5) < 0.62 ? 1 : 0
  let best = Infinity, pieces = 0
  for (let turn = 0; turn < 3; turn++) {
    labels.fill(0)
    pieces = 0
    const t0 = performance.now()
    for (let start = 0; start < total; start++) {
      if (!cells[start] || labels[start]) continue
      const label = ++pieces
      let top = 0
      stack[top++] = start
      labels[start] = label
      while (top) {
        const i = stack[--top], y = (i / (n * n)) | 0, rem = i - y * n * n, z = (rem / n) | 0, x = rem - z * n
        let j
        if (x > 0 && cells[(j = i - 1)] && !labels[j]) { labels[j] = label; stack[top++] = j }
        if (x < n - 1 && cells[(j = i + 1)] && !labels[j]) { labels[j] = label; stack[top++] = j }
        if (z > 0 && cells[(j = i - n)] && !labels[j]) { labels[j] = label; stack[top++] = j }
        if (z < n - 1 && cells[(j = i + n)] && !labels[j]) { labels[j] = label; stack[top++] = j }
        if (y > 0 && cells[(j = i - n * n)] && !labels[j]) { labels[j] = label; stack[top++] = j }
        if (y < n - 1 && cells[(j = i + n * n)] && !labels[j]) { labels[j] = label; stack[top++] = j }
      }
    }
    best = Math.min(best, performance.now() - t0)
  }
  return { ms: round(best), cells: total, pieces }
}

async function main() {
  report.env = environment()
  say('Opening the GPU')
  const gpu = await openGpu()
  report.env.gpu = await describe(gpu)
  report.faults = gpu.faults
  const { device } = gpu
  const dpr = devicePixelRatio || 1
  const native: [number, number] = [Math.max(1, Math.round(canvas.clientWidth * dpr)), Math.max(1, Math.round(canvas.clientHeight * dpr))]
  canvas.width = native[0]
  canvas.height = native[1]
  report.env.canvas = native
  const context = canvas.getContext('webgpu')!
  context.configure({ device, format: gpu.format, alphaMode: 'opaque' })
  const screenDepth = depthFor(device, native).createView()
  const onScreen = (): Target => ({ color: context.getCurrentTexture().createView(), depth: screenDepth, size: native })
  const half: [number, number] = [Math.max(1, native[0] >> 1), Math.max(1, native[1] >> 1)]
  const full = offscreen(gpu, native), small = offscreen(gpu, half)
  const blit = await stretch(gpu)

  /** Times one piece of work at the device's pace and by the GPU's clock, and puts a frame of it on the screen. */
  const time = async (draw: Draw, to: Offscreen) => {
    const paced = await pace(gpu, to, draw)
    const gpuMs = await passTime(gpu, to, draw)
    const encoder = device.createCommandEncoder()
    if (to === full) draw(encoder, onScreen())
    else { draw(encoder, to); blit(encoder, to, context.getCurrentTexture().createView()) }
    device.queue.submit([encoder.finish()])
    await nextFrame()
    return { ms: round(paced.ms), frames: paced.frames, gpuMs: gpuMs === null ? null : round(gpuMs) }
  }

  say('Reading the screen\'s rate')
  report.base = await cadence()
  line(`screen ${(report.base as { hz: number }).hz} Hz, ${native[0]} x ${native[1]} (${round(megapixels(native), 1)} MP)`)
  report.walk = walk()
  line(`one thread walks ${round((report.walk as { cells: number }).cells / (report.walk as { ms: number }).ms / 1000, 1)} million cells a second`)

  say('Lit pixels')
  const fills: Record<string, unknown>[] = report.fill = []
  const filler = await fill(gpu)
  for (const [layers, to] of [[1, full], [4, full], [4, small]] as const) {
    const t = await time(filler.draw(layers), to)
    fills.push({ layers, size: to.size, mp: round(megapixels(to.size)), ...t })
    line(`fill ${layers} layer${layers > 1 ? 's' : ''} at ${to.size[0]} x ${to.size[1]}: ${t.ms} ms`)
  }

  say('Faces')
  const facesOut: Record<string, unknown>[] = report.quads = []
  const town = await quads(gpu)
  for (const grid of [512, 1024, 1448, 2048, 2896]) {
    if (grid > town.most) { report.notes.push(`faces stop at a lattice of ${town.most}: buffer limit`); break }
    const built = town.build(grid)
    const t = await time(built.draw, full)
    facesOut.push({ grid, count: built.count, cell: round(built.cell, 3), size: native, ...t })
    line(`${round(built.count / 1e6)} million faces: ${t.ms} ms`)
    if (t.ms > 45) break
  }
  town.destroy()

  say('Rays through cells')
  const raysOut: Record<string, unknown>[] = report.rays = []
  const marcher = await rays(gpu)
  for (const [view, shadow, to] of [['street', false, full], ['street', true, full], ['hill', false, full], ['hill', true, full], ['hill', true, small]] as const) {
    const t = await time(marcher.draw(view, shadow), to)
    const steps = round(await marcher.steps(view, shadow), 1)
    raysOut.push({ view, shadow, size: to.size, mp: round(megapixels(to.size)), steps, ...t })
    line(`rays, ${view}${shadow ? ' with shadows' : ''}, ${to.size[0]} x ${to.size[1]}: ${t.ms} ms (${steps} steps a pixel)`)
  }

  const sent = await post('sweep')
  line(sent ? 'sent' : 'could not send')

  if (HEAT > 0) {
    // A steady load of about a third of a 60 Hz frame: rays with shadows, marched small enough and stretched to the screen.
    const whole = (raysOut[3] as { ms: number }).ms
    const scale = Math.min(1, Math.max(0.2, Math.sqrt(5.5 / Math.max(whole, 0.1))))
    const size: [number, number] = [Math.max(1, Math.round(native[0] * scale)), Math.max(1, Math.round(native[1] * scale))]
    const to = offscreen(gpu, size), draw = marcher.draw('hill', true)
    const seconds: Record<string, number>[] = [], paced: Record<string, number>[] = []
    report.heat = { scale: round(scale), size, seconds, paced }
    let wake: { release(): Promise<void> } | null = null
    try { wake = await (navigator as Navigator & { wakeLock?: { request(kind: 'screen'): Promise<{ release(): Promise<void> }> } }).wakeLock?.request('screen') ?? null } catch { report.notes.push('no wake lock') }
    const start = performance.now()
    let last = await nextFrame(), mark = last, gaps: number[] = [], nextPace = 0
    while (last - start < HEAT * 1000) {
      const encoder = device.createCommandEncoder()
      draw(encoder, to)
      blit(encoder, to, context.getCurrentTexture().createView())
      device.queue.submit([encoder.finish()])
      const now = await nextFrame()
      gaps.push(now - last)
      last = now
      if (now - mark < 1000) continue
      gaps.sort((a, b) => a - b)
      const t = Math.round((now - start) / 1000)
      seconds.push({ t, frames: gaps.length, p50: round(gaps[gaps.length >> 1], 1), p95: round(gaps[Math.floor(gaps.length * 0.95)], 1), max: round(gaps[gaps.length - 1], 1) })
      say(`Watching for heat: ${Math.max(0, HEAT - t)} s left`)
      gaps = []
      if (t >= nextPace) {
        const p = await pace(gpu, to, draw, 100)
        paced.push({ t, ms: round(p.ms) })
        nextPace = t + 10
        last = await nextFrame()
      }
      mark = last
    }
    await wake?.release().catch(() => {})
    const first = paced[0]?.ms, end = paced[paced.length - 1]?.ms
    line(`held ${size[0]} x ${size[1]} for ${HEAT} s: ${first} ms a frame at the start, ${end} ms at the end`)
    line((await post('heat')) ? 'sent' : 'could not send')
  }
  say('Done. Thank you, you can close this page.')
  document.body.dataset.done = '1'
}

main().catch(async (e: unknown) => {
  const text = e instanceof Error ? `${e.message}\n${e.stack ?? ''}` : String(e)
  report.notes.push(`failed: ${text}`)
  say('This did not work here')
  line(text.split('\n')[0])
  line((await post('error')) ? 'the reason was sent' : 'the reason could not be sent')
  document.body.dataset.done = 'error'
})
