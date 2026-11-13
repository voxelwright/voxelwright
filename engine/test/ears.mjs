// What stands in for ears (#247): the measurements the sound checks are made of, and a picture and a file of what
// was rendered, for someone who can hear. Nothing here knows the synthesiser: it is given samples.
import { deflateSync } from 'node:zlib'
import { writeFileSync } from 'node:fs'

/** An FFT in place (radix 2): re and im of a power-of-two length. */
export function fft(re, im) {
  const n = re.length
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1
    for (; j & bit; bit >>= 1) j ^= bit
    j ^= bit
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]] }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len, wr = Math.cos(ang), wi = Math.sin(ang)
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0
      for (let k = 0; k < len / 2; k++) {
        const a = i + k, b = a + len / 2, xr = re[b] * cr - im[b] * ci, xi = re[b] * ci + im[b] * cr
        re[b] = re[a] - xr; im[b] = im[a] - xi; re[a] += xr; im[a] += xi
        const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t
      }
    }
  }
}

/** The power in each bin of a Hann-windowed stretch of `x` starting at `from`, `size` long (a power of two). */
export function spectrum(x, from = 0, size = 8192) {
  const re = new Float64Array(size), im = new Float64Array(size)
  for (let i = 0; i < size; i++) re[i] = (x[from + i] ?? 0) * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / size))
  fft(re, im)
  const p = new Float64Array(size / 2)
  for (let i = 0; i < size / 2; i++) p[i] = re[i] * re[i] + im[i] * im[i]
  return p
}
/** Where the weight of a spectrum lies, Hz: how bright. */
export function centroid(x, sr, from = 0, size = 8192) {
  const p = spectrum(x, from, size)
  let a = 0, b = 0
  for (let i = 1; i < p.length; i++) { a += p[i] * i; b += p[i] }
  return b ? (a / b) * (sr / size) : 0
}
/** The strongest peaks of a spectrum, Hz, loudest first. */
export function peaks(x, sr, { from = 0, size = 16384, most = 6, floor = 1e-3 } = {}) {
  const p = spectrum(x, from, size), top = Math.max(...p), found = []
  for (let i = 2; i < p.length - 2; i++) if (p[i] > p[i - 1] && p[i] >= p[i + 1] && p[i] > p[i - 2] && p[i] >= p[i + 2] && p[i] > top * floor) {
    // A parabola through the three bins round a peak says where between them it is.
    const a = Math.log(p[i - 1]), b = Math.log(p[i]), c = Math.log(p[i + 1])
    found.push({ hz: (i + (0.5 * (a - c)) / (a - 2 * b + c)) * (sr / size), power: p[i] })
  }
  return found.sort((a, b) => b.power - a.power).slice(0, most)
}
/** The share of a stretch's power between two pitches. */
export function band(x, sr, lo, hi, size = 8192) {
  let a = 0, b = 0
  // Every stretch of it, so that one drop or one crack does not speak for the whole.
  for (let from = 0; from === 0 || from + size <= x.length; from += size) {
    const p = spectrum(x, from, size)
    for (let i = 1; i < p.length; i++) { const hz = (i * sr) / size; b += p[i]; if (hz >= lo && hz < hi) a += p[i] }
  }
  return b ? a / b : 0
}
export const peak = (x) => { let m = 0; for (const v of x) if (Math.abs(v) > m) m = Math.abs(v); return m }
export const rms = (x, from = 0, to = x.length) => { let s = 0; for (let i = from; i < to; i++) s += x[i] * x[i]; return Math.sqrt(s / Math.max(1, to - from)) }
export const db = (v) => 20 * Math.log10(Math.max(v, 1e-12))
/** How loud it is in windows of `ms`: its envelope. */
export function envelope(x, sr, ms = 10) {
  const n = Math.round((sr * ms) / 1000), out = []
  for (let i = 0; i + n <= x.length; i += n) out.push(rms(x, i, i + n))
  return out
}
/** Seconds from its loudest window until it has fallen by `by` dB and stays there. */
export function decay(x, sr, by = 60, ms = 10) {
  const e = envelope(x, sr, ms), top = Math.max(...e), at = e.indexOf(top), under = top * 10 ** (-by / 20)
  let last = at
  for (let i = at; i < e.length; i++) if (e[i] > under) last = i
  return ((last + 1 - at) * ms) / 1000
}
/** When it first rises over a level, seconds. */
export const onset = (x, sr, over = 1e-3) => { for (let i = 0; i < x.length; i++) if (Math.abs(x[i]) > over) return i / sr; return -1 }

/** Loudness as BS.1770 has it (K-weighted, 400 ms blocks, gated), LUFS, of left and right. */
export function lufs(l, r, sr) {
  const k = (x) => {
    // The two filters of the standard, worked out for this rate (a high shelf, then a high-pass).
    const stage = (x, b, a) => { const y = new Float64Array(x.length); let x1 = 0, x2 = 0, y1 = 0, y2 = 0; for (let i = 0; i < x.length; i++) { const v = b[0] * x[i] + b[1] * x1 + b[2] * x2 - a[1] * y1 - a[2] * y2; x2 = x1; x1 = x[i]; y2 = y1; y1 = v; y[i] = v } return y }
    const f0 = 1681.974450955533, G = 3.999843853973347, Q = 0.7071752369554196, K = Math.tan((Math.PI * f0) / sr), Vh = 10 ** (G / 20), Vb = Vh ** 0.4996667741545416, a0 = 1 + K / Q + K * K
    const shelf = stage(x, [(Vh + (Vb * K) / Q + K * K) / a0, (2 * (K * K - Vh)) / a0, (Vh - (Vb * K) / Q + K * K) / a0], [1, (2 * (K * K - 1)) / a0, (1 - K / Q + K * K) / a0])
    const f1 = 38.13547087602444, Q1 = 0.5003270373238773, K1 = Math.tan((Math.PI * f1) / sr), b0 = 1 + K1 / Q1 + K1 * K1
    return stage(shelf, [1, -2, 1], [1, (2 * (K1 * K1 - 1)) / b0, (1 - K1 / Q1 + K1 * K1) / b0])
  }
  const kl = k(l), kr = k(r), size = Math.round(0.4 * sr), hop = Math.round(0.1 * sr), blocks = []
  for (let i = 0; i + size <= kl.length; i += hop) { let s = 0; for (let j = i; j < i + size; j++) s += kl[j] * kl[j] + kr[j] * kr[j]; blocks.push(s / size) }
  const loud = (z) => -0.691 + 10 * Math.log10(Math.max(z, 1e-12)), mean = (a) => a.reduce((x, y) => x + y, 0) / Math.max(1, a.length)
  const over = blocks.filter((z) => loud(z) > -70)
  if (!over.length) return -Infinity
  const gate = loud(mean(over)) - 10, kept = over.filter((z) => loud(z) > gate)
  return loud(mean(kept.length ? kept : over))
}

/** Writes left and right as a 16-bit WAV. */
export function wav(file, l, r, sr) {
  const n = l.length, b = Buffer.alloc(44 + n * 4)
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 4, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(2, 22); b.writeUInt32LE(sr, 24); b.writeUInt32LE(sr * 4, 28); b.writeUInt16LE(4, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * 4, 40)
  for (let i = 0; i < n; i++) { b.writeInt16LE(Math.round(Math.max(-1, Math.min(1, l[i])) * 32767), 44 + i * 4); b.writeInt16LE(Math.round(Math.max(-1, Math.min(1, r[i])) * 32767), 46 + i * 4) }
  writeFileSync(file, b)
}

const crc = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c } return (buf) => { let c = ~0; for (const v of buf) c = t[(c ^ v) & 255] ^ (c >>> 8); return ~c >>> 0 } })()
function png(file, w, h, rgb) {
  const raw = Buffer.alloc((w * 3 + 1) * h)
  for (let y = 0; y < h; y++) rgb.copy(raw, y * (w * 3 + 1) + 1, y * w * 3, (y + 1) * w * 3)
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const body = Buffer.concat([Buffer.from(type), data]); const sum = Buffer.alloc(4); sum.writeUInt32BE(crc(body)); return Buffer.concat([len, body, sum]) }
  const head = Buffer.alloc(13); head.writeUInt32BE(w, 0); head.writeUInt32BE(h, 4); head[8] = 8; head[9] = 2
  writeFileSync(file, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', head), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]))
}

/**
 * A picture of a sound: time left to right, pitch bottom to top on a scale that gives low notes room (40 Hz to 16 kHz,
 * by octaves), loudness as brightness over 70 dB. Marks along the bottom every `tick` seconds.
 */
export function spectrogram(file, x, sr, { width = 1200, height = 420, size = 2048, tick = 1 } = {}) {
  const hop = Math.max(1, Math.floor((x.length - size) / width)), rgb = Buffer.alloc(width * height * 3), lo = Math.log(40), hi = Math.log(16000)
  const ramp = (t) => [Math.round(255 * Math.min(1, Math.max(0, 1.6 * t - 0.2) ** 0.9)), Math.round(255 * Math.min(1, Math.max(0, 1.5 * t - 0.5))), Math.round(255 * Math.max(0, Math.min(1, t < 0.4 ? t * 1.6 : 1.9 - 2.4 * t + (t > 0.8 ? (t - 0.8) * 5 : 0))))]
  let top = 1e-9
  const cols = []
  for (let c = 0; c < width; c++) { const p = spectrum(x, c * hop, size); cols.push(p); for (const v of p) if (v > top) top = v }
  for (let c = 0; c < width; c++) for (let y = 0; y < height; y++) {
    const hz = Math.exp(lo + ((height - 1 - y) / (height - 1)) * (hi - lo)), bin = Math.min(size / 2 - 1, Math.max(1, Math.round((hz * size) / sr)))
    // A bin a pixel at the top would skip most of them: take the loudest the pixel covers.
    const next = Math.min(size / 2 - 1, Math.round((Math.exp(lo + ((height - y) / (height - 1)) * (hi - lo)) * size) / sr))
    let v = 0
    for (let b = bin; b <= Math.max(bin, next); b++) v = Math.max(v, cols[c][b])
    const t = Math.max(0, 1 + (10 * Math.log10(v / top + 1e-12)) / 70), [r, g, b] = ramp(t), o = (y * width + c) * 3
    rgb[o] = r; rgb[o + 1] = g; rgb[o + 2] = b
  }
  for (let s = tick; s * sr < x.length; s += tick) { const c = Math.round((s * sr) / hop); if (c < width) for (let y = height - 8; y < height; y++) { const o = (y * width + c) * 3; rgb[o] = rgb[o + 1] = rgb[o + 2] = 255 } }
  for (const hz of [100, 1000, 10000]) { const y = Math.round((height - 1) * (1 - (Math.log(hz) - lo) / (hi - lo))); for (let c = 0; c < 10; c++) { const o = (y * width + c) * 3; rgb[o] = rgb[o + 1] = rgb[o + 2] = 255 } }
  png(file, width, height, rgb)
}
