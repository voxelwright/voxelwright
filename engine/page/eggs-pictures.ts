// What the window screen shows for an egg (eggs.ts, march.ts SCREEN): drawn into its small picture (SCREEN_SIZE),
// whose rgb is light and whose alpha is how much of a pane's own lamp it puts out. Fetched only when an egg starts.
// From the site's landing (static/landing/matrix.js and video.js, November 19), where the same eggs played on the
// park's view of the city: the code rain is that rain, the video is fitted into the same band of the view.
import { SCREEN_SIZE } from './march.ts'

export interface Picture {
  /** Whether the picture moves of itself (it is drawn every frame). */
  readonly moving: boolean
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

/** The band of the view, top to bottom, where the city's windows are from the park: above it is sky. */
const BAND = [0.1, 0.98]

/**
 * A video on the windows. The media element plays it, sound and all, and is the clock: each new frame it shows is
 * copied into the picture, so the windows and the sound cannot drift apart and pausing it pauses both. `outside` is
 * what the panes beyond the video show (rgb and how much of their lamp it puts out; null keeps the city's own), and
 * `contrast` a lift round mid-grey, so the picture survives the haze and the glass. `aspect` is the view's.
 */
export function videoPicture(media: HTMLVideoElement, aspect: () => number, { outside = null as readonly [number, number, number, number] | null, contrast = 1, crop = 0.5 } = {}): Picture {
  const [w, h] = SCREEN_SIZE
  const canvas = new OffscreenCanvas(w, h), ctx = canvas.getContext('2d', { alpha: true })!
  ctx.imageSmoothingQuality = 'high'
  let frames = 0, drawn = -1
  const watch = typeof media.requestVideoFrameCallback === 'function'
  let handle = 0
  const tick = () => { frames++; handle = media.requestVideoFrameCallback(tick) }
  if (watch) handle = media.requestVideoFrameCallback(tick)
  const seeked = () => { frames++ }
  media.addEventListener('seeked', seeked)
  return {
    moving: true,
    draw(device, texture) {
      const ready = media.readyState >= 2 && media.videoWidth > 0
      const key = !ready ? -1 : watch ? frames : media.currentTime
      if (key === drawn) return false
      drawn = key
      ctx.clearRect(0, 0, w, h)
      if (outside) { ctx.fillStyle = `rgb(${outside[0]} ${outside[1]} ${outside[2]} / ${outside[3] / 255})`; ctx.fillRect(0, 0, w, h) }
      if (ready) {
        // The picture is the view's shape stretched to the screen's: a video as tall as the band allows, unless that
        // would lose more than `crop` of its width off the sides (a tall phone crops a 4:3 picture's sides).
        const sx = w / (h * aspect()), top = BAND[0] * h, tall = (BAND[1] - BAND[0]) * h, va = media.videoWidth / media.videoHeight
        const height = Math.min(tall, (h * aspect()) / (1 - crop) / va), width = height * va * sx
        ctx.filter = contrast === 1 ? 'none' : `contrast(${contrast})`
        ctx.drawImage(media, (w - width) / 2, top + (tall - height) / 2, width, height)
        ctx.filter = 'none'
      }
      device.queue.copyExternalImageToTexture({ source: canvas }, { texture }, [w, h])
      return true
    },
    dispose() { if (watch) media.cancelVideoFrameCallback(handle); media.removeEventListener('seeked', seeked) },
  }
}
