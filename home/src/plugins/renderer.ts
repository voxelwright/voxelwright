import * as THREE from 'three/webgpu'
import type { Context } from 'cordis'
import { replace, type Quality, type Stage } from '../kernel'

const params = new URLSearchParams(location.search)
const TIER_NAMES: Quality[] = ['high', 'medium', 'low']
/** ?q= names a tier and skips calibration; without it the page starts high and measures. */
const asked = TIER_NAMES.find((t) => t === params.get('q'))
/** ?gpu=1 keeps GPU timestamps on for the whole visit, for scripts/measure.mjs. */
const gpuMode = params.get('gpu') === '1'
/** ?fx=csm,gtao names exactly the features to run, overriding the tier's set, so each one's cost is measured alone. */
const fxParam = params.get('fx')

/**
 * Each tier: device pixel ratio cap and the features it runs. GPU ms thresholds
 * (measured pass time at the tier above, median of the calibration frames) decide
 * when the page steps down. Numbers come from the README's measured tables.
 */
export const TIERS: Record<Quality, { dpr: number; fx: string[]; maxGpuMs: number }> = {
  high: { dpr: 2, fx: [], maxGpuMs: Infinity },
  medium: { dpr: 1.5, fx: [], maxGpuMs: Infinity },
  low: { dpr: 1, fx: [], maxGpuMs: Infinity },
}
const WARMUP_FRAMES = 30
const CALIBRATION_FRAMES = 45

export default {
  name: 'renderer',
  async apply(ctx: Context) {
    let quality: Quality = asked ?? 'high'
    const calibrating = !asked
    const renderer = new THREE.WebGPURenderer({
      antialias: quality !== 'low',
      powerPreference: 'high-performance',
      trackTimestamp: gpuMode,
    })
    await renderer.init()
    const backendState = renderer.backend as unknown as { isWebGPUBackend?: boolean; trackTimestamp: boolean; device?: { queue: { onSubmittedWorkDone(): Promise<void> } } }
    const dpr = () => Math.min(devicePixelRatio, TIERS[quality].dpr)
    renderer.setPixelRatio(dpr())
    renderer.setSize(innerWidth, innerHeight)
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = 1.25
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = THREE.PCFSoftShadowMap

    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(38, innerWidth / innerHeight, 0.1, 60)
    const backend = backendState.isWebGPUBackend ? 'WebGPU' : 'WebGL2'
    const timing: Stage['timing'] = { gpu: [], passSum: [], cpu: [], tracking: backendState.trackTimestamp, tierReason: asked ? `?q=${asked}` : 'calibrating' }

    const passes: Array<() => void> = []
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

    // GPU time per frame is the wait from the frame's last submit until the queue
    // reports that work done. On the M1 Pro, three.js's summed timestamp-query pass
    // durations overlapped (bloom mips of a few pixels each "took" 5 ms, 72 ms total
    // at a steady 60 fps), so they are kept only as per-pass detail under ?gpu=1.
    // The timestamp pool holds 256 queries, so it is resolved every frame while on.
    let frame = 0
    let resolving = false
    let waiting = false
    const device = backendState.device
    let settled = !calibrating
    let samples: number[] = []
    const settleTier = (median: number) => {
      const next = TIER_NAMES[TIER_NAMES.indexOf(quality) + 1]
      if (median <= TIERS[quality].maxGpuMs || !next) {
        timing.tierReason = `measured ${median.toFixed(2)} ms GPU at ${quality}`
        settled = true
        return
      }
      timing.tierReason = `${median.toFixed(2)} ms GPU at ${quality} > ${TIERS[quality].maxGpuMs} ms`
      quality = next
      renderer.setPixelRatio(dpr())
      ctx.emit('village/tier', quality)
      samples = []
      frame = 0
    }
    const timed = (ms: number) => {
      timing.gpu.push(ms)
      if (timing.gpu.length > 4000) timing.gpu.splice(0, 2000)
      if (settled || ++frame <= WARMUP_FRAMES) return
      samples.push(ms)
      if (samples.length < CALIBRATION_FRAMES) return
      const sorted = [...samples].sort((a, b) => a - b)
      settleTier(sorted[Math.floor(sorted.length / 2)])
    }

    const clock = new THREE.Timer()
    renderer.setAnimationLoop((time) => {
      const start = performance.now()
      clock.update(time)
      ctx.emit('village/frame', Math.min(clock.getDelta(), 0.1), clock.getElapsed())
      stage.draw()
      const submitted = performance.now()
      timing.cpu.push(submitted - start)
      if (timing.cpu.length > 4000) timing.cpu.splice(0, 2000)
      if (device && (gpuMode || !settled) && !waiting) {
        waiting = true
        device.queue.onSubmittedWorkDone().then(() => {
          waiting = false
          timed(performance.now() - submitted)
        })
      }
      if (backendState.trackTimestamp && !resolving) {
        resolving = true
        renderer.resolveTimestampsAsync('render').then((ms) => {
          resolving = false
          if (typeof ms === 'number' && ms > 0) timing.passSum.push(ms)
        })
      }
    })

    ctx.effect(() => () => {
      renderer.setAnimationLoop(null)
      removeEventListener('resize', resize)
      canvas.remove()
      renderer.dispose()
    }, 'renderer')
    ctx.provide('stage', stage)
  },
}

if (import.meta.hot) import.meta.hot.accept((m) => m && replace(m.default))
