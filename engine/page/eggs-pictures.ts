// What the window screen shows for an egg (eggs.ts, march.ts SCREEN): drawn into its small picture (SCREEN_SIZE),
// whose rgb is light and whose alpha is how much of a pane's own lamp it puts out. Fetched only when an egg starts.
// From the site's landing (static/landing/matrix.js and video.js, November 19), where the same eggs played on the
// park's view of the city: the code rain is that rain, the video is fitted into the same band of the view.
import { SCREEN_SIZE } from './march.ts'

export const WINDOW_EFFECTS = ['ambilight', 'equalizer', 'off'] as const
export type WindowEffect = (typeof WINDOW_EFFECTS)[number]

export interface Picture {
  /** Whether the picture moves of itself (it is drawn every frame). */
  readonly moving: boolean
  /** Whether open sky gaps (no building) also display this picture via the drone + fog sky pass (eggs-sky.ts). */
  readonly sky: boolean
  /** Normalized [u0, v0, u1, v1] bounds of the active picture in SCREEN_SIZE (used by eggs-sky.ts). */
  readonly rect: readonly [number, number, number, number]
  /** Draws it at `t` seconds; false if nothing changed since the last. */
  draw(device: GPUDevice, texture: GPUTexture, t: number): boolean
  dispose(): void
}

const hash = (n: number) => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x) }
const HEAD = [200, 255, 210], TAIL = [20, 235, 90]
/** Between drops a pane is dark glass: the picture puts out 90% of its lamp. */
const DARK = 230
const DROPS = 3

/** The Matrix: drops of light fall down each column of windows, a pale head and a green tail that flickers as its glyph changes. Original to the site; no font, sprite or footage. */
export function codeRain(): Picture {
  const [w, h] = SCREEN_SIZE, px = new Uint8Array(w * h * 4)
  return {
    moving: true,
    sky: false,
    rect: [0, 0, 1, 1],
    draw(device, texture, t) {
      for (let i = 0; i < px.length; i += 4) { px[i] = px[i + 1] = px[i + 2] = 0; px[i + 3] = DARK }
      for (let x = 0; x < w; x++) {
        for (let k = 0; k < DROPS; k++) {
          const seed = x * 7.13 + k * 101.7, speed = 9 + hash(seed) * 22, length = 6 + hash(seed + 1) * 30
          const period = h + length + 4 + hash(seed + 2) * h
          // Every drop starts above the top: the rain arrives rather than appears.
          const raw = t * speed - hash(seed + 3) * h * 0.9 - k * period * 0.4
          if (raw < 0) continue
          const head = raw % period, top = Math.max(0, Math.ceil(head - length)), bottom = Math.min(h - 1, Math.floor(head))
          for (let y = top; y <= bottom; y++) {
            const d = head - y, fade = (1 - d / length) ** 1.6
            const swap = Math.floor(t * (6 + hash(x * 3.1 + y) * 10) + hash(x + y * 9.7) * 9)
            const flicker = 0.62 + 0.38 * hash(x * 131 + y * 17 + swap * 0.37)
            const c = d < 1 ? HEAD : TAIL, b = d < 1 ? 1 : fade * flicker, i = (y * w + x) * 4
            px[i] = Math.max(px[i], c[0] * b); px[i + 1] = Math.max(px[i + 1], c[1] * b); px[i + 2] = Math.max(px[i + 2], c[2] * b)
          }
        }
      }
      device.queue.writeTexture({ texture }, px, { bytesPerRow: w * 4 }, [w, h])
      return true
    },
    dispose() {},
  }
}

/** Vertical bands where videos sit: on portrait phones, lifted into the upper sky + skyline above dark foreground roofs and clear of top HUD; on wide views, across the skyline. */
const BAND_WIDE = [0.1, 0.9] as const
const BAND_TALL = [0.18, 0.72] as const

/** What of the view a video must stay off, top to bottom (fractions of it): the player's strip (eggs.ts). */
export interface Clear { top: number; bottom: number }

/**
 * Where a video stands on the view, as fractions of it (left, top, width, height): in its band (by the view's shape),
 * as tall as the band allows between what it must stay off (`clear`), unless that would lose more than `crop` of its
 * width off the sides. `aspect` is the view's width over its height, `va` the video's. The one rule for it: the
 * picture is drawn by it, and the player keeps clear of it by it (#134).
 */
export function videoRect(aspect: number, va: number, crop = 0, clear: Clear = { top: 0, bottom: 1 }) {
  const band = aspect < 1 ? BAND_TALL : BAND_WIDE
  const top = Math.max(band[0], clear.top), tall = Math.max(0, Math.min(band[1], clear.bottom) - top)
  const h = Math.min(tall, aspect / (1 - crop) / va), w = Math.min(1, (h * va) / aspect)
  return { x: (1 - w) / 2, y: top + (tall - h) / 2, w, h }
}

// ── Lazy singleton Web Audio analyser for the Skyline Equalizer mode ──
// Attached to the singleton <video> element only when the user actually enables 'equalizer' (so 'ambilight' and 'off'
// leave the browser's native media playback path completely untouched). All egg videos load from same-origin blob: URLs
// (eggs.ts `fetchVideo`), so createMediaElementSource is always CORS-clean.
interface AudioTap {
  ctx: AudioContext
  analyser: AnalyserNode
  bins: Uint8Array<ArrayBuffer>
  resume(): void
}
const audioTaps = new WeakMap<HTMLVideoElement, AudioTap | null>()

function getAudioTap(media: HTMLVideoElement): AudioTap | null {
  if (audioTaps.has(media)) return audioTaps.get(media) ?? null
  const Ctor = (globalThis as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }).AudioContext
    ?? (globalThis as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!Ctor) { audioTaps.set(media, null); return null }
  try {
    // Match sound.ts: playback session avoids iPhone hardware ringer switch silencing Web Audio.
    const session = (navigator as Navigator & { audioSession?: { type: string } }).audioSession
    if (session) try { session.type = 'playback' } catch { /* older Safari */ }
    const ctx = new Ctor({ latencyHint: 'interactive' })
    const source = ctx.createMediaElementSource(media)
    const analyser = ctx.createAnalyser()
    analyser.fftSize = 256
    analyser.smoothingTimeConstant = 0.68
    analyser.minDecibels = -88
    analyser.maxDecibels = -22
    source.connect(analyser)
    analyser.connect(ctx.destination)
    const bins = new Uint8Array(new ArrayBuffer(analyser.frequencyBinCount))
    const resume = () => { if (ctx.state === 'suspended') void ctx.resume().catch(() => {}) }
    media.addEventListener('play', resume)
    const tap: AudioTap = { ctx, analyser, bins, resume }
    audioTaps.set(media, tap)
    resume()
    return tap
  } catch {
    audioTaps.set(media, null)
    return null
  }
}

/** Resumes the equalizer's Web Audio context inside a user gesture (iOS Safari requirement). */
export function wakeVideoAudio(media: HTMLVideoElement | null, effect: WindowEffect): void {
  if (!media || effect !== 'equalizer') return
  getAudioTap(media)?.resume()
}

const clamp255 = (v: number) => (v <= 0 ? 0 : v >= 255 ? 255 : v | 0)

/** Boosts chroma slightly so compressed video edges cast vibrant ambient light on dark glass. */
function boostColor(r: number, g: number, b: number, sat: number, out: Float32Array, offset: number): void {
  const lum = 0.299 * r + 0.587 * g + 0.114 * b
  out[offset] = Math.max(0, Math.min(255, lum + (r - lum) * sat))
  out[offset + 1] = Math.max(0, Math.min(255, lum + (g - lum) * sat))
  out[offset + 2] = Math.max(0, Math.min(255, lum + (b - lum) * sat))
}

/**
 * A video on the windows (and, when `sky` is true, on the sky-gap drone + fog formation in eggs-sky.ts). The media
 * element plays it, sound and all, and is the clock: each new frame it shows is copied into the picture, so the
 * windows and the sound cannot drift apart and pausing it pauses both. `outside` is what the panes beyond the video
 * show when `windowEffect()` is `'off'` (rgb and how much of their lamp it puts out; null keeps the city's own), and
 * `contrast` a lift round mid-grey, so the picture survives the haze and the glass. `aspect` is the view's.
 *
 * When `windowEffect()` is `'ambilight'` (default) or `'equalizer'`, the unused windows outside `rect` (especially the
 * lower ~40% of portrait phone viewports below the skyline) display either a soft wet-glass skylight spill or a live
 * audio-reactive skyline spectrum equalizer — strictly outside `rect`, so sky drones in `eggs-sky.ts` never see it.
 */
export function videoPicture(
  media: HTMLVideoElement,
  aspect: () => number,
  {
    outside = null as readonly [number, number, number, number] | null,
    contrast = 1,
    crop = 0,
    sky = true,
    windowEffect = (() => 'ambilight') as () => WindowEffect,
    clear = (): Clear | undefined => undefined,
  } = {},
): Picture {
  const [w, h] = SCREEN_SIZE
  const SW = 16, SH = 8
  const videoCanvas = new OffscreenCanvas(w, h)
  const vctx = videoCanvas.getContext('2d', { alpha: true, willReadFrequently: true })!
  vctx.imageSmoothingQuality = 'high'
  const sampleCanvas = new OffscreenCanvas(SW, SH)
  const sctx = sampleCanvas.getContext('2d', { alpha: false, willReadFrequently: true })!
  sctx.imageSmoothingQuality = 'low'

  const outPx = new Uint8Array(w * h * 4)
  const vidPx = new Uint8Array(w * h * 4)
  const targetRgb = new Float32Array(SW * SH * 3)
  const smoothRgb = new Float32Array(SW * SH * 3)
  const boostedRgb = new Float32Array(SW * SH * 3)
  let smoothReady = false
  let hasFrame = false

  // Symmetric center-bass equalizer state (6 bold frequency bands mirrored across 12 architectural columns so bars
  // read clearly with crisp dark gaps across irregular San Francisco facades).
  const HALF_BANDS = 6
  const BARS = HALF_BANDS * 2
  const BAND_BINS: readonly [number, number][] = [
    [1, 2], [2, 4], [4, 7], [7, 12], [12, 20], [20, 36],
  ]
  const barVal = new Float32Array(BARS)
  const barPeak = new Float32Array(BARS)
  const barHold = new Float32Array(BARS)

  const reduced = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null

  let frames = 0, drawn = -1
  let lastAspect = -1, lastShape = ''
  let lastEffect: WindowEffect | null = null
  let lastT = -1
  let x0 = 0, y0 = 0, width: number = w, height: number = h
  let ix0 = 0, iy0 = 0, ix1: number = w, iy1: number = h
  const band0 = aspect() < 1 ? BAND_TALL : BAND_WIDE
  const rect: [number, number, number, number] = [0, band0[0], 1, band0[1]]
  const watch = typeof media.requestVideoFrameCallback === 'function'
  let handle = 0
  const tick = () => { frames++; handle = media.requestVideoFrameCallback(tick) }
  if (watch) handle = media.requestVideoFrameCallback(tick)
  const seeked = () => { frames++; smoothReady = false }
  media.addEventListener('seeked', seeked)

  /** Bilinear sample from `boostedRgb` (SW × SH) at normalized (u, v) in [0..1]. */
  const sampleAt = (u: number, v: number, dst: [number, number, number]) => {
    const fx = Math.max(0, Math.min(SW - 1.0001, u * (SW - 1)))
    const fy = Math.max(0, Math.min(SH - 1.0001, v * (SH - 1)))
    const xA = fx | 0, yA = fy | 0
    const xB = Math.min(SW - 1, xA + 1), yB = Math.min(SH - 1, yA + 1)
    const tx = fx - xA, ty = fy - yA
    const i00 = (yA * SW + xA) * 3, i10 = (yA * SW + xB) * 3
    const i01 = (yB * SW + xA) * 3, i11 = (yB * SW + xB) * 3
    const w00 = (1 - tx) * (1 - ty), w10 = tx * (1 - ty), w01 = (1 - tx) * ty, w11 = tx * ty
    dst[0] = boostedRgb[i00] * w00 + boostedRgb[i10] * w10 + boostedRgb[i01] * w01 + boostedRgb[i11] * w11
    dst[1] = boostedRgb[i00 + 1] * w00 + boostedRgb[i10 + 1] * w10 + boostedRgb[i01 + 1] * w01 + boostedRgb[i11 + 1] * w11
    dst[2] = boostedRgb[i00 + 2] * w00 + boostedRgb[i10 + 2] * w10 + boostedRgb[i01 + 2] * w01 + boostedRgb[i11 + 2] * w11
  }

  /** Copies the cached active video rectangle [ix0..ix1, iy0..iy1] into outPx. */
  const blitVideo = () => {
    if (!hasFrame) return
    for (let y = iy0; y < iy1; y++) {
      const row = y * w * 4
      const start = row + ix0 * 4
      const end = row + ix1 * 4
      outPx.set(vidPx.subarray(start, end), start)
    }
  }

  const fillOutsideBase = () => {
    const r = outside ? outside[0] : 0
    const g = outside ? outside[1] : 0
    const b = outside ? outside[2] : 0
    const a = outside ? outside[3] : 0
    for (let i = 0; i < outPx.length; i += 4) {
      outPx[i] = r; outPx[i + 1] = g; outPx[i + 2] = b; outPx[i + 3] = a
    }
  }

  const paintAmbilight = () => {
    const outR = outside ? outside[0] : 10
    const outG = outside ? outside[1] : 10
    const outB = outside ? outside[2] : 14
    const outA = outside ? outside[3] : 200
    const rgb: [number, number, number] = [0, 0, 0]
    const lowH = Math.max(1, h - iy1)
    const topH = Math.max(1, iy0)
    const leftW = Math.max(1, ix0)
    const rightW = Math.max(1, w - ix1)
    const invW = 1 / Math.max(1, width)
    const invH = 1 / Math.max(1, height)

    for (let y = 0; y < h; y++) {
      const below = y >= iy1
      const above = y < iy0
      const row = y * w * 4
      for (let x = 0; x < w; x++) {
        if (!below && !above && x >= ix0 && x < ix1) continue
        const p = row + x * 4
        if (below) {
          // Vertically mirrored skylight spill & wet-glass reflection from the video's bottom half.
          const dy = (y - iy1) / lowH
          const uRaw = Math.max(0, Math.min(1, (x - x0) * invW))
          // Gentle horizontal diffusion as the light travels down across foreground hills.
          const u = uRaw + (0.5 - uRaw) * (dy * 0.28)
          const v = 1 - Math.min(0.68, dy * 0.74)
          sampleAt(u, v, rgb)
          const falloff = (1 - dy) ** 1.4
          const gain = falloff * 0.84 + (1 - dy) * 0.08
          // Suppress natural warm lamps strongly right under the skyline seam, fading down so neighborhood lights return.
          const lampMask = Math.max(46, Math.round(Math.max(outA, 220) * (1 - dy * 0.78)))
          outPx[p] = clamp255(outR * (1 - falloff) * 0.4 + rgb[0] * gain)
          outPx[p + 1] = clamp255(outG * (1 - falloff) * 0.4 + rgb[1] * gain)
          outPx[p + 2] = clamp255(outB * (1 - falloff) * 0.4 + rgb[2] * gain)
          outPx[p + 3] = lampMask
        } else if (above) {
          const uy = (iy0 - 1 - y) / topH
          const uRaw = Math.max(0, Math.min(1, (x - x0) * invW))
          const v = Math.min(0.45, uy * 0.5)
          sampleAt(uRaw, v, rgb)
          const falloff = (1 - uy) ** 2.2
          const gain = falloff * 0.5
          outPx[p] = clamp255(outR * (1 - falloff) + rgb[0] * gain)
          outPx[p + 1] = clamp255(outG * (1 - falloff) + rgb[1] * gain)
          outPx[p + 2] = clamp255(outB * (1 - falloff) + rgb[2] * gain)
          outPx[p + 3] = outA
        } else {
          // Left/right skyscraper pillars (e.g. 4:3 videos on wide landscape screens).
          const isLeft = x < ix0
          const dx = isLeft ? (ix0 - 1 - x) / leftW : (x - ix1) / rightW
          const u = isLeft ? Math.min(0.42, dx * 0.48) : 1 - Math.min(0.42, dx * 0.48)
          const v = Math.max(0, Math.min(1, (y - y0) * invH))
          sampleAt(u, v, rgb)
          const falloff = (1 - dx) ** 1.5
          const gain = falloff * 0.68
          outPx[p] = clamp255(outR * (1 - falloff) + rgb[0] * gain)
          outPx[p + 1] = clamp255(outG * (1 - falloff) + rgb[1] * gain)
          outPx[p + 2] = clamp255(outB * (1 - falloff) + rgb[2] * gain)
          outPx[p + 3] = Math.max(55, Math.round(outA * (1 - dx * 0.62)))
        }
      }
    }
  }

  const paintEqualizer = (dt: number, tap: AudioTap | null, lessMotion: boolean) => {
    // Pick a vivid saturated accent hue weighted by per-cell chroma across the 16x8 video map so pale/washed frames
    // still drive rich architectural neon bars rather than flat white.
    let wR = 0, wG = 0, wB = 0, wSum = 0
    for (let i = 0; i < boostedRgb.length; i += 3) {
      const r = boostedRgb[i], g = boostedRgb[i + 1], b = boostedRgb[i + 2]
      const c = Math.max(r, g, b) - Math.min(r, g, b)
      if (c > 16) {
        const wt = c * c
        wR += r * wt; wG += g * wt; wB += b * wt; wSum += wt
      }
    }
    let baseR: number, baseG: number, baseB: number
    let midR: number, midG: number, midB: number
    let topR: number, topG: number, topB: number
    if (wSum > 0) {
      const dr = wR / wSum, dg = wG / wSum, db = wB / wSum
      // Normalize hue to high chroma (pull minimum channel down, push max channel to 255).
      const mn = Math.min(dr, dg, db), mx = Math.max(dr, dg, db)
      const span = Math.max(1, mx - mn)
      const nr = ((dr - mn) / span) * 255
      const ng = ((dg - mn) / span) * 255
      const nb = ((db - mn) / span) * 255
      baseR = nr * 0.62; baseG = ng * 0.62; baseB = nb * 0.62
      midR = Math.min(255, nr * 0.95 + 32); midG = Math.min(255, ng * 0.95 + 32); midB = Math.min(255, nb * 0.95 + 32)
      topR = Math.min(255, nr * 0.45 + 185); topG = Math.min(255, ng * 0.45 + 165); topB = Math.min(255, nb * 0.45 + 125)
    } else {
      // Monochrome / high-contrast clips (e.g. Bad Apple!!): vivid cyan-to-ice-gold bars.
      baseR = 24; baseG = 135; baseB = 255
      midR = 72; midG = 225; midB = 255
      topR = 255; topG = 246; topB = 205
    }

    // Update frequency bands from AnalyserNode (if audio is live and unmuted); otherwise decay smoothly to 0.
    const liveAudio = !!tap && !media.muted && !media.paused && tap.ctx.state === 'running'
    if (liveAudio) tap.analyser.getByteFrequencyData(tap.bins)

    const attackK = 1 - Math.exp(-dt * (lessMotion ? 10 : 28))
    const decayK = 1 - Math.exp(-dt * (lessMotion ? 4.0 : 7.5))
    let activeEnergy = 0
    for (let side = 0; side < HALF_BANDS; side++) {
      const [b0, b1] = BAND_BINS[side]
      let leftRaw = 0, rightRaw = 0
      if (liveAudio) {
        let sum = 0, peak = 0
        for (let k = b0; k < b1; k++) { const v = tap.bins[k] / 255; sum += v; if (v > peak) peak = v }
        const avg = sum / Math.max(1, b1 - b0)
        // Perceptual loudness lift across mids & highs so outer columns climb energetically beside center bass.
        const tilt = 1.05 + side * 0.14
        const base = Math.min(1, (avg * 0.45 + peak * 0.55) * tilt)
        const alt = tap.bins[Math.min(tap.bins.length - 1, b1)] / 255
        leftRaw = Math.min(1, base * 0.86 + alt * 0.18 * tilt)
        rightRaw = Math.min(1, base * 0.94 + (tap.bins[Math.max(1, b0 - 1)] / 255) * 0.1 * tilt)
      }
      const pair: readonly [number, number][] = [
        [HALF_BANDS - 1 - side, leftRaw],
        [HALF_BANDS + side, rightRaw],
      ]
      for (const [idx, raw] of pair) {
        const shaped = raw > 0.03 ? Math.min(1, ((raw - 0.03) / 0.97) ** 0.8) : 0
        const prev = barVal[idx]
        const next = prev + (shaped - prev) * (shaped > prev ? attackK : decayK)
        barVal[idx] = next < 0.004 ? 0 : next
        if (barVal[idx] >= barPeak[idx]) {
          barPeak[idx] = barVal[idx]
          barHold[idx] = lessMotion ? 0.28 : 0.2
        } else if (barHold[idx] > 0) {
          barHold[idx] -= dt
        } else {
          barPeak[idx] = Math.max(barVal[idx], barPeak[idx] - dt * (lessMotion ? 0.45 : 0.82))
        }
        if (barVal[idx] > activeEnergy) activeEnergy = barVal[idx]
        if (barPeak[idx] > activeEnergy) activeEnergy = barPeak[idx]
      }
    }

    // Dim moody backdrop outside the video so the glowing bars have crisp architectural contrast.
    const bgR = clamp255(baseR * 0.08)
    const bgG = clamp255(baseG * 0.08)
    const bgB = clamp255(baseB * 0.1)
    const outA = outside ? outside[3] : 205
    for (let y = 0; y < h; y++) {
      const row = y * w * 4
      const inY = y >= iy0 && y < iy1
      for (let x = 0; x < w; x++) {
        if (inY && x >= ix0 && x < ix1) continue
        const p = row + x * 4
        // Quiet / muted: gradually let natural city windows breathe through instead of a dead black slab.
        const dimA = activeEnergy > 0.02 ? Math.max(215, outA) : Math.round(outA * 0.72)
        outPx[p] = bgR; outPx[p + 1] = bgG; outPx[p + 2] = bgB; outPx[p + 3] = dimA
      }
    }

    /** Paints bold architectural EQ columns into a target region [rx0..rx1, ry0..ry1]. */
    const drawBars = (rx0: number, ry0: number, rx1: number, ry1: number, count: number, offset: number) => {
      const regionW = rx1 - rx0
      const regionH = ry1 - ry0
      if (regionW < 4 || regionH < 4) return
      const colW = regionW / count
      const gap = colW >= 14 ? 4 : colW >= 8 ? 3 : colW >= 5 ? 2 : 1
      for (let b = 0; b < count; b++) {
        const idx = offset + b
        const val = barVal[idx]
        const peak = barPeak[idx]
        const bx0 = Math.round(rx0 + b * colW) + (gap >> 1)
        const bx1 = Math.max(bx0 + 1, Math.round(rx0 + (b + 1) * colW) - Math.ceil(gap / 2))
        const barH = Math.round(val * regionH)
        const barTop = ry1 - barH
        const capH = regionH >= 24 ? 3 : regionH >= 12 ? 2 : 1
        const peakY = Math.max(ry0, Math.min(ry1 - capH, ry1 - Math.round(peak * regionH)))

        if (barH > 0) {
          for (let y = Math.max(ry0, barTop); y < ry1; y++) {
            const frac = 1 - (y - ry0) / regionH // 0 at bottom -> 1 at top of region
            const stripe = (y % 3) === 0 ? 0.78 : 1 // Architectural floor-level banding
            let r: number, g: number, bl: number
            if (frac < 0.55) {
              const s = frac / 0.55
              r = baseR + (midR - baseR) * s
              g = baseG + (midG - baseG) * s
              bl = baseB + (midB - baseB) * s
            } else {
              const s = (frac - 0.55) / 0.45
              r = midR + (topR - midR) * s
              g = midG + (topG - midG) * s
              bl = midB + (topB - midB) * s
            }
            const cr = clamp255(r * stripe), cg = clamp255(g * stripe), cb = clamp255(bl * stripe)
            const row = y * w * 4
            for (let x = bx0; x < bx1; x++) {
              const p = row + x * 4
              outPx[p] = cr; outPx[p + 1] = cg; outPx[p + 2] = cb; outPx[p + 3] = 248
            }
          }
        }
        // Hot warm-gold / white peak-hold cap gliding down the floors.
        if (peak > 0.04) {
          for (let y = peakY; y < Math.min(ry1, peakY + capH); y++) {
            const row = y * w * 4
            for (let x = bx0; x < bx1; x++) {
              const p = row + x * 4
              outPx[p] = 255; outPx[p + 1] = 244; outPx[p + 2] = 205; outPx[p + 3] = 255
            }
          }
        }
      }
    }

    const lowH = h - iy1
    if (lowH >= 22) {
      // Portrait / square viewports: 12 bold architectural columns anchored above the darkest foreground rooftops so
      // bars surge straight up through the dense mid-ground & Nob Hill windows all the way to the video seam.
      const rgb: [number, number, number] = [0, 0, 0]
      const seamH = Math.min(4, lowH)
      for (let y = iy1; y < iy1 + seamH; y++) {
        const fade = (1 - (y - iy1) / seamH) * 0.45
        const row = y * w * 4
        for (let x = 0; x < w; x++) {
          sampleAt(Math.max(0, Math.min(1, (x - x0) / Math.max(1, width))), 1, rgb)
          const p = row + x * 4
          outPx[p] = clamp255(bgR + rgb[0] * fade)
          outPx[p + 1] = clamp255(bgG + rgb[1] * fade)
          outPx[p + 2] = clamp255(bgB + rgb[2] * fade)
          outPx[p + 3] = 230
        }
      }
      const roofPad = Math.round(lowH * 0.1)
      drawBars(3, iy1 + 2, w - 3, h - roofPad, BARS, 0)
    } else {
      // Landscape viewports: tall flanking skyline equalizer bars in 4:3 side pillars + compact horizon strip below.
      if (ix0 >= 14) {
        drawBars(2, iy0 + 4, ix0 - 2, h - 2, 4, 2)
        drawBars(ix1 + 2, iy0 + 4, w - 2, h - 2, 4, 6)
      }
      if (lowH >= 5) drawBars(ix0, iy1 + 1, ix1, h, BARS, 0)
    }
    return activeEnergy > 0.005 || liveAudio
  }

  return {
    moving: true,
    sky,
    rect,
    draw(device, texture, t) {
      const ready = media.readyState >= 2 && media.videoWidth > 0
      const a = aspect()
      const effect = windowEffect()
      const key = !ready ? -1 : watch ? frames : media.currentTime
      // (Drawn again for the view turned or the player's strip moved, a paused frame too.)
      const r = ready ? videoRect(a, media.videoWidth / media.videoHeight, crop, clear()) : null
      const shape = r ? `${r.x} ${r.y} ${r.w} ${r.h}` : ''
      const newFrame = key !== drawn || Math.abs(a - lastAspect) >= 1e-4 || shape !== lastShape
      const newEffect = effect !== lastEffect
      const dt = lastT >= 0 ? Math.max(0.001, Math.min(0.08, t - lastT)) : 0.016
      lastT = t

      const tap = effect === 'equalizer' ? getAudioTap(media) : null
      const lessMotion = !!reduced?.matches

      // Determine whether this frame needs a GPU texture upload.
      let needSmooth = false
      if (effect === 'ambilight' && smoothReady && !media.paused && !lessMotion) {
        for (let i = 0; i < smoothRgb.length; i++) {
          if (Math.abs(targetRgb[i] - smoothRgb[i]) > 0.6) { needSmooth = true; break }
        }
      }
      const needEq = effect === 'equalizer' && (
        (!media.paused && !media.muted && tap?.ctx.state === 'running')
        || barPeak.some((v) => v > 0.005)
      )
      if (!newFrame && !newEffect && !needSmooth && !needEq) return false

      if (newFrame) {
        drawn = key
        lastAspect = a
        lastShape = shape
        if (r) {
          // Fit the full uncropped video (crop = 0 by default) into the active band (videoRect): on portrait phones the
          // sky-gap drone/fog formation carries the upper part while the skyscraper windows carry the lower part seamlessly.
          ix0 = Math.max(0, Math.round(r.x * w))
          iy0 = Math.max(0, Math.round(r.y * h))
          ix1 = Math.min(w, Math.max(ix0 + 1, ix0 + Math.round(r.w * w)))
          iy1 = Math.min(h, Math.max(iy0 + 1, iy0 + Math.round(r.h * h)))
          x0 = ix0; y0 = iy0; width = ix1 - ix0; height = iy1 - iy0
          rect[0] = ix0 / w
          rect[1] = iy0 / h
          rect[2] = ix1 / w
          rect[3] = iy1 / h

          vctx.clearRect(0, 0, w, h)
          vctx.filter = contrast === 1 ? 'none' : `contrast(${contrast})`
          vctx.drawImage(media, ix0, iy0, width, height)
          vctx.filter = 'none'
          vidPx.set(vctx.getImageData(0, 0, w, h).data)
          hasFrame = true

          // Downsample into 16×8 light map (hardware bilinear = smooth blur, Safari-safe).
          sctx.drawImage(media, 0, 0, SW, SH)
          const sd = sctx.getImageData(0, 0, SW, SH).data
          for (let i = 0, j = 0; i < sd.length; i += 4, j += 3) {
            targetRgb[j] = sd[i]
            targetRgb[j + 1] = sd[i + 1]
            targetRgb[j + 2] = sd[i + 2]
          }
          if (!smoothReady || media.paused || lessMotion) {
            smoothRgb.set(targetRgb)
            smoothReady = true
          }
        } else {
          hasFrame = false
        }
      }

      // Exponential temporal smoothing on the 16×8 light map so rapid cuts glow organically without harsh strobing.
      if (smoothReady) {
        const k = media.paused || lessMotion ? 1 : 1 - Math.exp(-dt * 7.5)
        for (let i = 0; i < smoothRgb.length; i += 3) {
          smoothRgb[i] += (targetRgb[i] - smoothRgb[i]) * k
          smoothRgb[i + 1] += (targetRgb[i + 1] - smoothRgb[i + 1]) * k
          smoothRgb[i + 2] += (targetRgb[i + 2] - smoothRgb[i + 2]) * k
          boostColor(smoothRgb[i], smoothRgb[i + 1], smoothRgb[i + 2], 1.38, boostedRgb, i)
        }
      }

      lastEffect = effect

      if (!hasFrame || effect === 'off') {
        fillOutsideBase()
        blitVideo()
      } else if (effect === 'ambilight') {
        paintAmbilight()
        blitVideo()
      } else {
        paintEqualizer(dt, tap, lessMotion)
        blitVideo()
      }

      device.queue.writeTexture({ texture }, outPx, { bytesPerRow: w * 4 }, [w, h])
      return true
    },
    dispose() { if (watch) media.cancelVideoFrameCallback(handle); media.removeEventListener('seeked', seeked) },
  }
}
