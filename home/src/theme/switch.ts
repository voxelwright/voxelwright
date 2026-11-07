// How a live theme switch is eased on screen, and measured.
//
// Same post chain shape: the theme plugin blends the tokens and postfx reads them as
// uniforms, so nothing is rebuilt. Another shape: postfx must be rebuilt, which leaves
// frames drawn without post-processing (the rebuild is async) and stalls on the first
// frame of the new chain while its shaders compile. So the last frame is copied to a
// canvas laid over the scene first, held until the new chain has drawn and the GPU has
// finished that frame, then faded out.
import type { Stage } from '../kernel'
import { root } from '../kernel'
import { noteSwitch, release, switching, type SwitchReport } from './index'
import { sameShape } from './blend'
import type { Theme } from './tokens'

export const FADE_MS = 600
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)')
/** A frame interval under this counts as an ordinary frame again. */
const SETTLED_FRAME_MS = 25

let overlay: HTMLCanvasElement | null = null
let generation = 0

const nextFrame = () => new Promise<void>((done) => {
  const off = root.on('village/frame', () => {
    off()
    done()
  })
})

/**
 * Copy what the canvas shows into a 2D canvas laid over it. A WebGPU canvas can only be
 * read while its frame is current (read later it comes back blank), so the copy runs in a
 * microtask queued from the frame event: after this frame's draw, before it is presented.
 */
function hold(stage: Stage): Promise<HTMLCanvasElement> {
  return new Promise((done) => {
    const off = root.on('village/frame', () => {
      off()
      queueMicrotask(() => {
        const source = stage.renderer.domElement
        const copy = overlay ?? document.createElement('canvas')
        if (copy !== overlay) {
          copy.className = 'village-theme-hold'
          copy.setAttribute('aria-hidden', 'true')
          Object.assign(copy.style, { position: 'fixed', left: '0', top: '0', width: '100vw', height: '100vh', pointerEvents: 'none', opacity: '1' })
          copy.width = source.width
          copy.height = source.height
          copy.getContext('2d')!.drawImage(source, 0, 0)
          // Just above the scene canvas and below every DOM layer added after it.
          source.after(copy)
          overlay = copy
        }
        copy.style.transition = 'none'
        copy.style.opacity = '1'
        done(copy)
      })
    })
  })
}

/** Frame intervals from now until `until()` holds and one ordinary frame has followed. */
function watch(until: () => boolean, started: number) {
  return new Promise<{ worstMs: number; settledMs: number; frames: number }>((done) => {
    let last = started, worst = 0, frames = 0
    const step = (now: number) => {
      const dt = now - last
      last = now
      frames++
      worst = Math.max(worst, dt)
      if (until() && dt < SETTLED_FRAME_MS) return done({ worstMs: +worst.toFixed(1), settledMs: +(now - started).toFixed(1), frames })
      requestAnimationFrame(step)
    }
    requestAnimationFrame(step)
  })
}

/**
 * Ease the change from `previous` to `next` (both already chosen through setTheme).
 * `rebuild` replaces postfx; it is called only when the chain's shape changes.
 */
export async function ease(stage: Stage | undefined, previous: Theme, next: Theme, rebuild: () => Promise<void>) {
  const started = performance.now()
  const base = { from: previous.id, to: next.id }
  if (sameShape(previous, next)) {
    const path = reducedMotion.matches ? 'instant' : 'blend'
    noteSwitch({ ...base, path, worstMs: 0, settledMs: 0, frames: 0, done: false })
    const r = await watch(() => !switching(), started)
    noteSwitch({ ...base, path, ...r, done: true })
    return
  }
  const mine = ++generation
  noteSwitch({ ...base, path: 'rebuild', worstMs: 0, settledMs: 0, frames: 0, done: false })
  if (!stage) {
    release()
    await rebuild()
    return
  }
  const measured = watch(() => mine !== generation || !overlay, started)
  const copy = await hold(stage)
  release()
  await rebuild()
  // The new chain is in once postfx has added its draw pass; the frame after that one has
  // drawn with it (the first draw compiles its shaders), and the GPU has finished it.
  while (stage.drawPasses() === 0) await nextFrame()
  await nextFrame()
  await nextFrame()
  const device = (stage.renderer.backend as unknown as { device?: { queue: { onSubmittedWorkDone(): Promise<void> } } }).device
  await device?.queue.onSubmittedWorkDone()
  const firstFrameMs = +(performance.now() - started).toFixed(1)
  if (mine !== generation) return
  const fade = reducedMotion.matches ? 0 : FADE_MS
  copy.style.transition = `opacity ${fade}ms ease-in-out`
  copy.style.opacity = '0'
  setTimeout(() => {
    if (mine !== generation || overlay !== copy) return
    copy.remove()
    overlay = null
  }, fade + 30)
  noteSwitch({ ...base, path: 'rebuild', ...(await measured), firstFrameMs, done: true })
}
