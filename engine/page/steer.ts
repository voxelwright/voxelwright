// Dynamic render-scale controller (#129): keeps GPU march work inside the frame budget without
// thrashing offscreen render targets when frames are CPU-bound (especially on phones where the
// GPU timestamp clock is untrusted).

export interface SteerState {
  scale: number
  held: number
  lateRun: number
  /** Consecutive backoff count used to damp scale oscillation on unclocked (touch) devices. */
  backoffs: number
  /** Frames elapsed since the last scale drop, so calm periods reset oscillation damping. */
  sinceDrop: number
}

export interface SteerInput {
  budget: number
  gap: number
  frameMs: number
  cpuMs: number
  /** Main-thread JS/encode work excluding WebGPU swapchain/submit wait (#155). Falls back to `cpuMs` when omitted. */
  workCpuMs?: number
  gpuMs: number
  marchMs: number
  /** Full-resolution GPU passes whose cost does not shrink with render scale (e.g. TAA resolve + sharpen), ms. */
  fixedGpuMs?: number
  clocked: boolean
  calm: boolean
  fixed: boolean
}

const quantize = (v: number) => Math.round(Math.max(0.3, Math.min(1, v)) * 20) / 20

/**
 * Updates `state` in place for one frame and returns `true` when `scale` changed.
 *
 * On clocked desktops, GPU timestamps steer directly toward 60% of the frame budget (reserving `fixedGpuMs`
 * for native-res passes like TAA so ultrawide displays scale down smoothly instead of overshooting).
 * On unclocked touch devices (phones), scale only backs off when late frames are NOT already
 * CPU-bound (`workCpuMs <= budget * 0.72`), uses a deadband before stepping back up (`frameMs <= budget * 1.04`),
 * and holds longer after a drop so `fit()` does not reallocate GPU targets every ~0.8 s.
 * Using `workCpuMs` (excluding `getCurrentTexture()` / `queue.submit()` blocking wait) prevents
 * iOS Metal swapchain backpressure from masquerading as CPU-bound work and locking scale at 1.0 (#155).
 */
export function steerScale(s: SteerState, input: SteerInput): boolean {
  const { budget, gap, frameMs, cpuMs, workCpuMs, gpuMs, marchMs, fixedGpuMs = 0, clocked, calm, fixed } = input
  const mainCpuMs = workCpuMs ?? cpuMs
  const extraGpu = fixedGpuMs > 0 ? fixedGpuMs : 0
  const marchBudget = Math.max(2, 0.6 * budget - extraGpu)
  const totalGpuMs = gpuMs + extraGpu
  const totalMarchMs = marchMs + extraGpu
  if (fixed || s.held > 1e6) return false

  if (calm) {
    if (!clocked || gpuMs <= 0 || --s.held > 0) return false
    const next = quantize(s.scale * Math.sqrt(marchBudget / gpuMs))
    if (next !== s.scale) { s.scale = next; s.held = 20; return true }
    return false
  }

  s.sinceDrop++
  if (s.sinceDrop > 480) s.backoffs = 0

  // Two late frames close together with a trustworthy GPU clock saying march + TAA exceeded budget: drop immediately.
  s.lateRun = s.lateRun * 0.85 + (gap > budget * 1.4 ? 1 : 0)
  if (s.lateRun >= 1.4 && clocked && totalMarchMs > budget && s.scale > 0.3) {
    const fits = quantize(Math.min(s.scale - 0.05, s.scale * Math.sqrt(marchBudget / Math.max(marchMs, 0.1))))
    s.lateRun = 0
    if (fits !== s.scale) { s.scale = fits; s.held = 20; s.sinceDrop = 0; return true }
    return false
  }

  if (--s.held > 0) return false

  const late = frameMs > budget * 1.12
  // Shrinking render resolution cannot relieve a CPU-bound main thread; slashing scale when real JS/encode
  // work already consumes >72% of the frame budget only degrades sharpness and reallocates GPU targets.
  const cpuBound = mainCpuMs > budget * 0.72 && (!clocked || totalGpuMs < budget * 0.65)

  let want: number
  if (late) {
    if (cpuBound) { s.held = 45; return false }
    want = s.scale * 0.85
  } else if (clocked && gpuMs > 0) {
    want = s.scale * Math.sqrt(marchBudget / gpuMs)
  } else {
    // Unclocked (phone) ramp-up deadband: only step up when frames and real CPU work are comfortably inside budget.
    if (frameMs > budget * 1.04 || mainCpuMs > budget * 0.65) { s.held = 30; return false }
    want = s.scale + 0.05
  }

  const next = quantize(want)
  if (next === s.scale) return false
  const dropped = next < s.scale
  s.scale = next
  if (clocked) {
    s.held = late ? 45 : 20
  } else if (dropped) {
    s.backoffs = Math.min(3, s.backoffs + 1)
    s.sinceDrop = 0
    // 150 -> 240 -> 360 frames (~2.5 s -> 4 s -> 6 s) cooldown after backoff to prevent sawtooth reallocation.
    s.held = s.backoffs === 1 ? 150 : s.backoffs === 2 ? 240 : 360
  } else {
    // After stepping up, wait 90 frames (~1.5 s) before stepping up again.
    s.held = 90
  }
  return true
}
