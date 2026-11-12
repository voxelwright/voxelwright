// What a page tells the server about the device it ran on (#140): the browser, the GPU, the
// screen's rate, and whatever the page measured. Shared by the probe and the city, so a visit
// to either needs nobody to read anything out.
import type { Gpu } from './gpu.ts'

export interface Report {
  run: string
  build: string
  stage: string
  env: Record<string, unknown>
  notes: string[]
  [more: string]: unknown
}

export const round = (n: number, places = 2) => Number(n.toFixed(places))
export const nextFrame = () => new Promise<number>((resolve) => requestAnimationFrame(resolve))

// What wasm this browser runs: 128-bit SIMD, and threads over shared memory.
const WASM_SIMD = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11])
const WASM_THREADS = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 4, 1, 96, 0, 0, 3, 2, 1, 0, 5, 4, 1, 3, 1, 1, 10, 11, 1, 9, 0, 65, 0, 254, 16, 2, 0, 26, 11])

export function environment(): Record<string, unknown> {
  const nav = navigator as Navigator & { deviceMemory?: number }
  return {
    ua: nav.userAgent,
    touch: nav.maxTouchPoints,
    cores: nav.hardwareConcurrency,
    memory: nav.deviceMemory ?? null,
    dpr: devicePixelRatio,
    screen: [screen.width, screen.height],
    window: [innerWidth, innerHeight],
    isolated: crossOriginIsolated,
    sharedMemory: typeof SharedArrayBuffer !== 'undefined',
    wasmSimd: WebAssembly.validate(WASM_SIMD),
    wasmThreads: WebAssembly.validate(WASM_THREADS),
    webTransport: 'WebTransport' in globalThis,
    offscreenCanvas: 'OffscreenCanvas' in globalThis,
    webgpu: 'gpu' in navigator,
  }
}

export async function describe(gpu: Gpu): Promise<Record<string, unknown>> {
  const adapter = gpu.adapter as GPUAdapter & { requestAdapterInfo?: () => Promise<GPUAdapterInfo> }
  const info = adapter.info ?? (await adapter.requestAdapterInfo?.())
  const limits: Record<string, number> = {}
  for (const name in adapter.limits) { const v = (adapter.limits as unknown as Record<string, unknown>)[name]; if (typeof v === 'number') limits[name] = v }
  return {
    format: gpu.format,
    vendor: info?.vendor, architecture: info?.architecture, device: info?.device, description: info?.description,
    features: [...adapter.features].sort(),
    limits,
    canTime: gpu.canTime,
  }
}

/** The screen's own rate: the middle gap between frames. Low Power Mode on a phone shows here as 30. */
export async function cadence(): Promise<{ ms: number; hz: number }> {
  const gaps: number[] = []
  let last = await nextFrame()
  for (let i = 0; i < 50; i++) { const now = await nextFrame(); gaps.push(now - last); last = now }
  gaps.sort((a, b) => a - b)
  const ms = gaps[gaps.length >> 1]
  return { ms: round(ms), hz: Math.round(1000 / ms) }
}

/** A report, and how to send it as it stands. The page's comings and goings are noted on it. */
export function reporter(build: string): { report: Report; post(stage: string): Promise<boolean> } {
  const report: Report = { run: Math.random().toString(36).slice(2, 8), build, stage: 'start', env: {}, notes: [] }
  const since = performance.now()
  document.addEventListener('visibilitychange', () => report.notes.push(`${round((performance.now() - since) / 1000, 1)} s: page ${document.visibilityState}`))
  return {
    report,
    async post(stage) {
      report.stage = stage
      try {
        return (await fetch('/report', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(report), keepalive: true })).ok
      } catch { return false }
    },
  }
}
