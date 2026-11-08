// How a live theme switch is eased on screen, and measured.
//
// Same post chain shape: the theme plugin blends the tokens and postfx reads them as
// uniforms, so nothing is rebuilt. Another shape: postfx builds the next look's chain and
// compiles it off screen with async pipelines while the current chain keeps drawing the
// room live (./index.ts holds the shown look until then). Once it is ready, the last frame
// is copied to a canvas laid over the scene, the new chain and the new look are swapped in
// under it in the same frame, and the copy fades out.
import type { Stage } from '../kernel'
import { root } from '../kernel'
import { prepare } from '../plugins/postfx'
import { keepShown, noteSwap, noteSwitch, release, switching, type SwitchReport } from './index'
import { sameShape } from './blend'
import type { Theme } from './tokens'

export const FADE_MS = 600
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)')
/** A frame interval under this counts as an ordinary frame again. */
const SETTLED_FRAME_MS = 25

let overlay: HTMLCanvasElement | null = null
/** Raised by every hold, so a fade that a later hold took over leaves the overlay alone. */
let holds = 0
/** Raised by every switch, so a rebuild still compiling when another switch comes is never shown. */
let generation = 0

const nextFrame = () => new Promise<void>((done) => {
  const off = root.on('village/frame', () => {
    off()
    done()
  })
})

/**
 * Copy what the canvas shows into a 2D canvas laid over it, then run `swap`. A WebGPU canvas
 * can only be read while its frame is current (read later it comes back blank), so the copy
 * runs in a microtask queued from the frame event: after this frame's draw, before it is
 * presented. `swap` runs in the same microtask, so the next frame is the new chain's, under
 * the copy. The copy is redrawn on every hold: an overlay still fading from an earlier switch
 * would otherwise show the look before last.
 */
function hold(stage: Stage, swap: () => void): Promise<HTMLCanvasElement> {
  return new Promise((done) => {
    const off = root.on('village/frame', () => {
      off()
      queueMicrotask(() => {
        const source = stage.renderer.domElement
        const copy = overlay ?? document.createElement('canvas')
        if (copy !== overlay) {
          copy.className = 'village-theme-hold'
          copy.setAttribute('aria-hidden', 'true')
          Object.assign(copy.style, { position: 'fixed', left: '0', top: '0', width: '100vw', height: '100vh', pointerEvents: 'none' })
          // Just above the scene canvas and below every DOM layer added after it.
          source.after(copy)
          overlay = copy
        }
        copy.width = source.width
        copy.height = source.height
        copy.getContext('2d')!.drawImage(source, 0, 0)
        copy.style.transition = 'none'
        copy.style.opacity = '1'
        holds++
        swap()
        done(copy)
      })
    })
  })
}

function fadeOut(copy: HTMLCanvasElement) {
  const mine = holds
  const fade = reducedMotion.matches ? 0 : FADE_MS
  copy.style.transition = `opacity ${fade}ms ease-in-out`
  copy.style.opacity = '0'
  setTimeout(() => {
    if (mine !== holds || overlay !== copy) return
    copy.remove()
    overlay = null
  }, fade + 30)
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

/** The latest switch's outcome: its last report, or null if a later switch took over. */
let latest: Promise<SwitchReport | null> = Promise.resolve(null)
/** How the switch setTheme just started ends (./ask.ts waits on it). */
export const settled = () => latest

/** Ease the change from `previous` to `next` (both already chosen through setTheme). */
export function ease(stage: Stage | undefined, previous: Theme, next: Theme): Promise<SwitchReport | null> {
  return (latest = run(stage, previous, next))
}

/** A report is published only while its switch is the latest, so an older one never replaces a newer one's. */
async function run(stage: Stage | undefined, previous: Theme, next: Theme): Promise<SwitchReport | null> {
  const started = performance.now()
  const base = { from: previous.id, to: next.id }
  const mine = ++generation
  const publish = (r: SwitchReport) => (mine === generation ? noteSwitch(r) : null)
  if (sameShape(previous, next)) {
    const path = reducedMotion.matches ? 'instant' : 'blend'
    publish({ ...base, path, worstMs: 0, settledMs: 0, frames: 0, done: false })
    const r = await watch(() => mine !== generation || !switching(), started)
    return publish({ ...base, path, ...r, done: true })
  }
  let fading = true
  const report: SwitchReport = { ...base, path: 'rebuild', worstMs: 0, settledMs: 0, frames: 0, done: false }
  publish(report)
  const measured = watch(() => mine !== generation || !fading, started)
  // The current chain keeps drawing the room while the next one compiles.
  let ready: Awaited<ReturnType<typeof prepare>>
  try {
    ready = await prepare(next)
  } catch (error) {
    // prepare() disposed the half-built chain. The current chain keeps drawing the look on
    // screen, which becomes the chosen one again (or resumes the blend this switch
    // interrupted); nothing was held, so nothing freezes.
    if (mine !== generation) return null
    const failed = String((error as Error)?.message ?? error).slice(0, 200)
    console.warn(`theme switch to ${next.id} failed, keeping ${previous.id}:`, error)
    keepShown()
    fading = false
    return publish({ ...report, ...(await measured), failed, done: true })
  }
  const compiledMs = +(performance.now() - started).toFixed(1)
  if (mine !== generation) {
    // A later switch took over: this chain is never shown.
    ready?.chain.dispose()
    return null
  }
  if (!ready || !stage) {
    // No postfx to rebuild (?plugins= without it): the look changes on the next frame.
    release()
    fading = false
    return publish({ ...report, ...(await measured), compiledMs, done: true })
  }
  const copy = await hold(stage, () => {
    // A switch that came while this waited for the frame owns the screen now.
    if (mine !== generation) return ready.chain.dispose()
    release()
    if (ready.take()) noteSwap(next.id)
    else ready.chain.dispose()
  })
  if (mine !== generation) {
    fadeOut(copy)
    return null
  }
  // The new chain draws from the next frame; wait until the GPU has finished that frame.
  await nextFrame()
  await nextFrame()
  const device = (stage.renderer.backend as unknown as { device?: { queue: { onSubmittedWorkDone(): Promise<void> } } }).device
  await device?.queue.onSubmittedWorkDone()
  const firstFrameMs = +(performance.now() - started).toFixed(1)
  fadeOut(copy)
  fading = false
  return publish({ ...report, ...(await measured), compiledMs, firstFrameMs, done: true })
}
