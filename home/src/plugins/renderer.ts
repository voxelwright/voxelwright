import * as THREE from 'three/webgpu'
import type { Context } from 'cordis'
import { replace, type Quality, type Stage } from '../kernel'
import { gpuPassTimer, type GpuFrame } from '../gpu-time.js'

const params = new URLSearchParams(location.search)
const TIER_NAMES: Quality[] = ['high', 'medium', 'low']
/** ?q= names a tier and skips calibration; without it the page starts high and measures. */
const asked = TIER_NAMES.find((t) => t === params.get('q'))
/** ?gpu=1 keeps GPU timing on for the whole visit, for scripts/measure.mjs. */
const gpuMode = params.get('gpu') === '1'
/** ?fx=csm,gtao names exactly the features to run, overriding the tier's set, so each one's cost is measured alone. */
const fxParam = params.get('fx')
/** ?webgl=1 runs three.js's WebGL2 backend even where WebGPU is available. */
const forceWebGL = params.get('webgl') === '1'

/**
 * Each tier: device pixel ratio cap and the features it runs. maxGpuMs is the
 * median GPU busy time (src/gpu-time.js) over the calibration frames above which
 * the page steps down to the next tier. Numbers come from the README's tables.
 */
export const TIERS: Record<Quality, { dpr: number; fx: string[]; maxGpuMs: number }> = {
  // M1 Pro, the dollhouse at 2880x1800 (November 9): 6.8 ms with phys and traa, +0.5 ms for
  // the lens's shallow focus (dof), +3.2 ms for ambient occlusion at half resolution with 8
  // samples (gtao), 11.9 ms with both. csm (+2 ms, +286 draws) showed no visible change and
  // ssgi (+286 ms) costs too much; those two stay opt-in through ?fx=.
  high: { dpr: 2, fx: ['phys', 'traa', 'gtao', 'dof'], maxGpuMs: 13 },
  medium: { dpr: 1.5, fx: ['phys', 'traa', 'gtao', 'dof'], maxGpuMs: 12 },
  low: { dpr: 1, fx: ['dof'], maxGpuMs: Infinity },
}
// Calibration skips shader-compile frames, then takes the median of 45 frames, or of
// whatever arrived in 2 s (at least 8), so a very slow GPU steps down quickly.
const WARMUP_FRAMES = 15
const CALIBRATION_FRAMES = 45
const CALIBRATION_MS = 2000

export default {
  name: 'renderer',
  async apply(ctx: Context) {
    let quality: Quality = asked ?? 'high'
    const calibrating = !asked
    const renderer = new THREE.WebGPURenderer({
      antialias: quality !== 'low',
      powerPreference: 'high-performance',
      forceWebGL,
    })
    await renderer.init()
    const backendState = renderer.backend as unknown as { isWebGPUBackend?: boolean; device?: { queue: { onSubmittedWorkDone(): Promise<void> } } }
    const device = backendState.device
    // WebGL2 has no queue-done signal to time, and its frame interval is vsync, not
    // GPU cost. Without a measurement the page takes the light tier instead of guessing.
    const unmeasurable = calibrating && !device
    if (unmeasurable) quality = 'low'
    const dpr = () => Math.min(devicePixelRatio, TIERS[quality].dpr)
    renderer.setPixelRatio(dpr())
    renderer.setSize(innerWidth, innerHeight)
    // Neutral keeps a painted colour's hue and saturation up to the highlights, where the filmic curves washed them towards grey.
    renderer.toneMapping = THREE.NeutralToneMapping
    renderer.toneMappingExposure = 1.1
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = params.get('sh') === 'pcf' ? THREE.PCFShadowMap : THREE.VSMShadowMap

    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(38, innerWidth / innerHeight, 0.1, 60)
    const backend = backendState.isWebGPUBackend ? 'WebGPU' : 'WebGL2'
    const timer = device ? gpuPassTimer(device) : null
    const timing: Stage['timing'] = { gpu: [], submitToDone: [], passSum: [], cpu: [], tracking: !!timer, tierReason: asked ? `?q=${asked}` : unmeasurable ? 'WebGL2: no GPU timer, so the light tier' : 'calibrating', tierSettled: !calibrating || unmeasurable }

    const passes: Array<() => void> = []
    // Calibration pauses while anything holds it, and drops a frame submitted before the last release.
    let holds = 0
    let releasedAt = 0
    const stage: Stage = {
      renderer,
      scene,
      camera,
      get quality() {
        return quality
      },
      features: () => new Set(fxParam !== null ? fxParam.split(',').filter(Boolean) : TIERS[quality].fx),
      timing,
      backend,
      draw: () => (passes.at(-1) ?? (() => renderer.render(scene, camera)))(),
      addDrawPass: (pass) => {
        passes.push(pass)
        return () => {
          const i = passes.lastIndexOf(pass)
          if (i >= 0) passes.splice(i, 1)
        }
      },
      drawPasses: () => passes.length,
      hold: () => {
        holds++
        let held = true
        return () => {
          if (!held) return
          held = false
          holds--
          releasedAt = performance.now()
        }
      },
    }

    const canvas = renderer.domElement
    canvas.dataset.backend = backend
    document.body.prepend(canvas)

    const resize = () => {
      camera.aspect = innerWidth / innerHeight
      camera.updateProjectionMatrix()
      renderer.setSize(innerWidth, innerHeight)
    }
    addEventListener('resize', resize)

    // GPU ms per frame is the union of the frame's pass intervals from timestamp
    // queries (src/gpu-time.js): it leaves out main-thread delay, which the older
    // submit-to-done wait counted (a 12 ms CPU loop read as 39 ms of GPU). Without
    // timestamp queries, calibration falls back to submit-to-done. ?gpu=1 records both.
    let frame = 0
    let waiting = false
    let settled = !calibrating || unmeasurable
    let samples: number[] = []
    let since = 0
    const settleTier = (median: number) => {
      const next = TIER_NAMES[TIER_NAMES.indexOf(quality) + 1]
      if (median <= TIERS[quality].maxGpuMs || !next) {
        timing.tierReason = `measured ${median.toFixed(2)} ms GPU at ${quality}`
        settled = true
        timing.tierSettled = true
        return
      }
      timing.tierReason = `${median.toFixed(2)} ms GPU at ${quality} > ${TIERS[quality].maxGpuMs} ms`
      quality = next
      renderer.setPixelRatio(dpr())
      ctx.emit('village/tier', quality)
      samples = []
      frame = 0
    }
    const timed = (ms: number, submitted: number) => {
      if (settled || holds > 0 || submitted < releasedAt) return
      if (++frame <= WARMUP_FRAMES) return
      if (!samples.length) since = performance.now()
      samples.push(ms)
      const enough = samples.length >= CALIBRATION_FRAMES || (samples.length >= 8 && performance.now() - since > CALIBRATION_MS)
      if (!enough) return
      const sorted = [...samples].sort((a, b) => a - b)
      settleTier(sorted[Math.floor(sorted.length / 2)])
      if (settled && !gpuMode) timer?.listeners.delete(onGpuFrame)
    }
    const keep = (list: number[], ms: number) => {
      list.push(ms)
      if (list.length > 4000) list.splice(0, 2000)
    }
    const onGpuFrame = (f: GpuFrame) => {
      keep(timing.gpu, f.busyMs)
      keep(timing.passSum, f.sumMs)
      timed(f.busyMs, f.endedAt ?? performance.now())
    }
    if (timer && (gpuMode || calibrating)) timer.listeners.add(onGpuFrame)

    const clock = new THREE.Timer()
    renderer.setAnimationLoop((time) => {
      const start = performance.now()
      clock.update(time)
      ctx.emit('village/frame', Math.min(clock.getDelta(), 0.1), clock.getElapsed())
      stage.draw()
      const submitted = performance.now()
      timing.cpu.push(submitted - start)
      if (timing.cpu.length > 4000) timing.cpu.splice(0, 2000)
      timer?.endFrame()
      if (device && (gpuMode || (!timer && !settled)) && !waiting) {
        waiting = true
        device.queue.onSubmittedWorkDone().then(() => {
          waiting = false
          const ms = performance.now() - submitted
          keep(timing.submitToDone, ms)
          if (!timer) timed(ms, submitted)
        })
      }
    })

    ctx.effect(() => () => {
      timer?.listeners.delete(onGpuFrame)
      renderer.setAnimationLoop(null)
      removeEventListener('resize', resize)
      canvas.remove()
      renderer.dispose()
    }, 'renderer')
    ctx.provide('stage', stage)
  },
}

if (import.meta.hot) import.meta.hot.accept((m) => m && replace(m.default))
