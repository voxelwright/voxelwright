// Audio analysis shared by the voice scripts. Copied verbatim from check-babble.mjs
// (YIN f0, spectral centroid, BS.1770 LUFS, 16-bit WAV writer); rate() is new.
import { writeFileSync } from 'node:fs'

export const SR = 48000
export const decode = (b64) => new Float32Array(Buffer.from(b64, 'base64').buffer.slice(0))
export const db = (x) => 20 * Math.log10(Math.max(x, 1e-12))
export const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b)
  return s.length ? s[Math.floor(s.length / 2)] : NaN
}
export const FRAME = 2048
export const HOP = 512

export function frames(x, fn) {
  let maxRms = 0
  const rms = []
  for (let i = 0; i + FRAME <= x.length; i += HOP) {
    let s = 0
    for (let j = 0; j < FRAME; j++) s += x[i + j] ** 2
    rms.push(Math.sqrt(s / FRAME))
    maxRms = Math.max(maxRms, rms.at(-1))
  }
  const out = []
  rms.forEach((r, k) => {
    if (r > maxRms * 0.2) {
      const v = fn(x.subarray(k * HOP, k * HOP + FRAME), k * HOP)
      if (v != null && Number.isFinite(v.value ?? v)) out.push(v)
    }
  })
  return out
}

/**
 * YIN fundamental estimate for one frame, 90 to 900 Hz. Takes the shortest lag
 * whose normalized difference is close to the frame's best, so a formant on the
 * second harmonic does not read as an octave up and multiples of the period do
 * not read as an octave down.
 */
export function yin(frame) {
  const W = FRAME / 2
  const minLag = Math.floor(SR / 900)
  const maxLag = Math.ceil(SR / 90)
  const cmnd = new Float32Array(maxLag + 1)
  let sum = 0
  for (let tau = 1; tau <= maxLag; tau++) {
    let s = 0
    for (let j = 0; j < W; j++) {
      const v = frame[j] - frame[j + tau]
      s += v * v
    }
    sum += s
    cmnd[tau] = (s * tau) / (sum || 1)
  }
  let best = Infinity
  for (let tau = minLag; tau <= maxLag; tau++) best = Math.min(best, cmnd[tau])
  if (best > 0.3) return null
  for (let tau = minLag; tau <= maxLag; tau++) {
    if (cmnd[tau] < best + 0.06) {
      while (tau + 1 <= maxLag && cmnd[tau + 1] < cmnd[tau]) tau++
      return SR / tau
    }
  }
  return null
}

export function fft(re, im) {
  const n = re.length
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1
    for (; j & bit; bit >>= 1) j ^= bit
    j ^= bit
    if (i < j) {
      ;[re[i], re[j]] = [re[j], re[i]]
      ;[im[i], im[j]] = [im[j], im[i]]
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len
    for (let i = 0; i < n; i += len) {
      for (let k = 0; k < len / 2; k++) {
        const wr = Math.cos(ang * k)
        const wi = Math.sin(ang * k)
        const ur = re[i + k]
        const ui = im[i + k]
        const vr = re[i + k + len / 2] * wr - im[i + k + len / 2] * wi
        const vi = re[i + k + len / 2] * wi + im[i + k + len / 2] * wr
        re[i + k] = ur + vr
        im[i + k] = ui + vi
        re[i + k + len / 2] = ur - vr
        im[i + k + len / 2] = ui - vi
      }
    }
  }
}

export function centroid(frame) {
  const re = new Float64Array(FRAME)
  const im = new Float64Array(FRAME)
  for (let j = 0; j < FRAME; j++) re[j] = frame[j] * (0.5 - 0.5 * Math.cos((2 * Math.PI * j) / (FRAME - 1)))
  fft(re, im)
  let num = 0
  let den = 0
  for (let k = 1; k < FRAME / 2; k++) {
    const m = Math.hypot(re[k], im[k])
    num += ((k * SR) / FRAME) * m
    den += m
  }
  return den ? num / den : null
}

/** BS.1770-4 integrated loudness at 48 kHz (K-weighting, 400 ms blocks, absolute and relative gates). */
export function lufs(x) {
  const biquad = (input, b, a) => {
    const y = new Float64Array(input.length)
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0
    for (let i = 0; i < input.length; i++) {
      const v = b[0] * input[i] + b[1] * x1 + b[2] * x2 - a[1] * y1 - a[2] * y2
      x2 = x1; x1 = input[i]; y2 = y1; y1 = v
      y[i] = v
    }
    return y
  }
  const k = biquad(biquad(x, [1.53512485958697, -2.69169618940638, 1.19839281085285], [1, -1.69065929318241, 0.73248077421585]), [1, -2, 1], [1, -1.99004745483398, 0.99007225036621])
  const block = 0.4 * SR
  const step = block / 4
  const z = []
  for (let i = 0; i + block <= k.length; i += step) {
    let s = 0
    for (let j = 0; j < block; j++) s += k[i + j] ** 2
    z.push(s / block)
  }
  const level = (zs) => -0.691 + 10 * Math.log10(zs.reduce((a, b) => a + b, 0) / zs.length)
  const abs = z.filter((v) => -0.691 + 10 * Math.log10(v) > -70)
  const rel = level(abs) - 10
  return level(abs.filter((v) => -0.691 + 10 * Math.log10(v) > rel))
}

export const peakOf = (x) => x.reduce((m, v) => Math.max(m, Math.abs(v)), 0)

export function wav(x, path) {
  const data = Buffer.alloc(x.length * 2)
  for (let i = 0; i < x.length; i++) data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, x[i])) * 32767), i * 2)
  const h = Buffer.alloc(44)
  h.write('RIFF', 0); h.writeUInt32LE(36 + data.length, 4); h.write('WAVE', 8); h.write('fmt ', 12)
  h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(SR, 24)
  h.writeUInt32LE(SR * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(data.length, 40)
  writeFileSync(path, Buffer.concat([h, data]))
}


/** Syllables a second while sounding: peaks of a smoothed 10 ms RMS envelope that rise 35% above the valley before them, divided by the seconds the envelope is above 10% of its maximum, so word gaps do not count. */
export function rate(x) {
  const win = Math.round(0.01 * SR)
  const env = []
  for (let i = 0; i + win <= x.length; i += win) {
    let s = 0
    for (let j = 0; j < win; j++) s += x[i + j] ** 2
    env.push(Math.sqrt(s / win))
  }
  const smooth = env.map((_, i) => {
    let s = 0, n = 0
    for (let k = Math.max(0, i - 2); k <= Math.min(env.length - 1, i + 2); k++) { s += env[k]; n++ }
    return s / n
  })
  const max = smooth.reduce((m, v) => Math.max(m, v), 0)
  let onsets = 0
  let valley = Infinity
  let rising = false
  for (let i = 1; i < smooth.length; i++) {
    valley = Math.min(valley, smooth[i])
    if (!rising && smooth[i] > Math.max(valley * 1.35, max * 0.15) && smooth[i] > smooth[i - 1]) {
      onsets++
      rising = true
    } else if (rising && smooth[i] < smooth[i - 1] * 0.8) {
      rising = false
      valley = smooth[i]
    }
  }
  const active = smooth.filter((v) => v > max * 0.1).length * 0.01
  return active > 0 ? onsets / active : NaN
}
