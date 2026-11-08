// Recipes the palette's cues are made of (#52). Each one schedules its own nodes into
// `out` at a time on the audio clock and lets them end by themselves: sources stop at the
// end of their envelope, nothing disconnects in onended, and every parameter gets one
// automation curve. Times snap to whole samples so a cue renders the same at any start.

import type { Kit } from '../contract'
import { mixFor } from '../../voice/buses'

/** The music bed is in C major / A minor at A = 440; tonal cues use its pentatonic notes (C D E G A). */
export const NOTE = {
  C4: 261.63, D4: 293.66, E4: 329.63, G4: 392.0, A4: 440.0,
  C5: 523.25, D5: 587.33, E5: 659.26, G5: 783.99, A5: 880.0,
  C6: 1046.5, D6: 1174.66, E6: 1318.51, G6: 1567.98, A6: 1760.0,
} as const

/** A seeded random in [0, 1) (mulberry32). */
export function seededRandom(seed: number): () => number {
  let a = seed | 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Linear gain from decibels. */
export const db = (d: number) => 10 ** (d / 20)

/** A time rounded to a whole sample of this context. */
export const snap = (ctx: BaseAudioContext, t: number) => Math.round(t * ctx.sampleRate) / ctx.sampleRate

/**
 * Samples a shape over [0, 1] into a curve, about 2000 points a second (Chrome interpolates linearly between them).
 * A plain array, not a Float32Array: setValueCurveAtTime takes a sequence<float>, and Chrome
 * converts a typed array through its iterator at about 200 ns a point (0.8 ms for a 4000-point
 * envelope) but a packed array about six times faster. The values reach the param as the same
 * floats either way (each double rounds to the nearest float once).
 */
export function curve(dur: number, fn: (u: number) => number, perSecond = 2000): number[] {
  const n = Math.max(16, Math.ceil(dur * perSecond))
  const c: number[] = []
  for (let i = 0; i < n; i++) c.push(fn(i / (n - 1)))
  return c
}

const cosRise = (x: number) => 0.5 - 0.5 * Math.cos(Math.PI * Math.min(1, Math.max(0, x)))

/**
 * A struck envelope over `dur` seconds: a raised-cosine attack, an exponential decay with time
 * constant `tau`, and a cosine fade over the last `tail` of it, so it always ends at exactly 0.
 */
export function strike(dur: number, attack: number, tau: number, tail = 0.25) {
  return (u: number) => {
    const t = u * dur
    const a = t < attack ? cosRise(t / attack) : Math.exp(-(t - attack) / tau)
    const end = u > 1 - tail ? cosRise((1 - u) / tail) : 1
    return a * end
  }
}

/** A swell: a raised-sine hump peaking at `peak` (0..1), with power `k` to sharpen it. */
export function swell(peak = 0.5, k = 1) {
  return (u: number) => {
    const s = u < peak ? cosRise(u / peak) : cosRise((1 - u) / (1 - peak))
    return s ** k
  }
}

/** Smooth seeded random in [0, 1] at about `rate` changes a second over `dur`, for paper grain and cloth. */
export function wobble(random: () => number, rate: number, dur: number) {
  const n = Math.max(2, Math.ceil(rate * dur) + 2)
  const pts = Array.from({ length: n }, () => random())
  return (u: number) => {
    const x = u * (n - 2)
    const i = Math.floor(x)
    const f = cosRise(x - i)
    return pts[i] * (1 - f) + pts[i + 1] * f
  }
}

/** Short seeded bumps (a tear's fibres, a pencil's grain): `count` raised-cosine bumps `width` s wide. */
export function crackle(random: () => number, dur: number, count: number, width: number) {
  const bumps = Array.from({ length: count }, () => ({ at: random() * dur, h: 0.35 + 0.65 * random() }))
  return (u: number) => {
    const t = u * dur
    let v = 0
    for (const b of bumps) {
      const d = Math.abs(t - b.at)
      if (d < width) v += b.h * (0.5 + 0.5 * Math.cos((Math.PI * d) / width))
    }
    return Math.min(1, v)
  }
}

export interface Partial {
  /** Frequency as a multiple of the note. */
  ratio: number
  /** Level relative to the fundamental's. */
  amp: number
  /** Decay time constant in seconds. */
  tau: number
}

/** Tuned-instrument partials. Ratios from bar and tine modes, rounded; upper modes die fast so the tone stays warm. */
export const BODY = {
  /** A kalimba tine: a strong fundamental, a weak octave, and the bright inharmonic "tink" that dies within 30 ms. */
  kalimba: [{ ratio: 1, amp: 1, tau: 0.32 }, { ratio: 2.01, amp: 0.08, tau: 0.12 }, { ratio: 5.4, amp: 0.07, tau: 0.018 }],
  /** A soft-mallet marimba bar: fundamental plus the 4th-harmonic tuning mode, which is brief. */
  marimba: [{ ratio: 1, amp: 1, tau: 0.22 }, { ratio: 3.93, amp: 0.18, tau: 0.035 }, { ratio: 9.2, amp: 0.03, tau: 0.008 }],
  /** A music-box comb: near-harmonic and long. */
  musicBox: [{ ratio: 1, amp: 1, tau: 0.45 }, { ratio: 2.0, amp: 0.22, tau: 0.2 }, { ratio: 3.0, amp: 0.06, tau: 0.08 }],
  /** A small glass bowl: inharmonic, slow-blooming, quiet upper modes. */
  glass: [{ ratio: 1, amp: 1, tau: 0.5 }, { ratio: 2.32, amp: 0.18, tau: 0.28 }, { ratio: 4.25, amp: 0.05, tau: 0.12 }],
  /** A wood block: a short resonant body and one inharmonic mode. */
  wood: [{ ratio: 1, amp: 1, tau: 0.045 }, { ratio: 2.76, amp: 0.25, tau: 0.02 }],
} satisfies Record<string, Partial[]>

/**
 * A modal pluck: one sine per partial, each with its own decay. Partials above `ceiling`
 * Hz are left out, which keeps tonal content under about 3 kHz.
 */
export function pluck(ctx: BaseAudioContext, out: AudioNode, t: number, freq: number, partials: Partial[],
  o: { gain: number; attack?: number; /** Longest it rings, 0.45 s unless given; the last quarter fades to 0. */ dur?: number; ceiling?: number; bend?: number }) {
  const at = snap(ctx, t)
  const attack = o.attack ?? 0.004
  const ceiling = o.ceiling ?? 3600
  for (const p of partials) {
    const f = freq * p.ratio
    if (f > ceiling) continue
    const dur = snap(ctx, Math.min(o.dur ?? 0.45, attack + p.tau * 6.9))
    const osc = new OscillatorNode(ctx, { frequency: f })
    if (o.bend) {
      const bend = o.bend
      osc.frequency.setValueCurveAtTime(curve(dur, (u) => f * 2 ** ((bend * (1 - Math.exp(-u * 4))) / 1200), 400), at, dur)
    }
    const env = strike(dur, attack, p.tau)
    const g = new GainNode(ctx, { gain: 0 })
    g.gain.setValueCurveAtTime(curve(dur, (u) => o.gain * p.amp * env(u)), at, dur)
    osc.connect(g).connect(out)
    osc.start(at)
    osc.stop(at + dur)
  }
}

/**
 * Filtered noise from the kit's seeded second of noise: a filter whose centre may move
 * (`freq` as a shape of u), then an envelope. The read position comes from `random`, so
 * repeats differ. Paper, cloth, air, pencil and breath are all this.
 */
export function noise(ctx: BaseAudioContext, out: AudioNode, kit: Kit, t: number, o: {
  dur: number
  env: (u: number) => number
  gain: number
  random: () => number
  type?: BiquadFilterType
  freq: number | ((u: number) => number)
  q?: number
  /** A second, fixed lowpass that rounds the top, in Hz. */
  top?: number
}) {
  const at = snap(ctx, t)
  const dur = snap(ctx, o.dur)
  const src = new AudioBufferSourceNode(ctx, { buffer: kit.noise, loop: dur > kit.noise.duration * 0.7 })
  const freq = o.freq
  const f = new BiquadFilterNode(ctx, { type: o.type ?? 'bandpass', Q: o.q ?? 1, frequency: typeof freq === 'number' ? freq : freq(0) })
  if (typeof freq !== 'number') f.frequency.setValueCurveAtTime(curve(dur, freq, 500), at, dur)
  const g = new GainNode(ctx, { gain: 0 })
  g.gain.setValueCurveAtTime(curve(dur, (u) => o.gain * o.env(u), 4000), at, dur)
  let node: AudioNode = src.connect(f)
  if (o.top) node = node.connect(new BiquadFilterNode(ctx, { type: 'lowpass', frequency: o.top, Q: 0.5 }))
  node.connect(g).connect(out)
  const offset = snap(ctx, o.random() * Math.max(0, kit.noise.duration - dur - 0.01))
  src.start(at, offset)
  src.stop(at + dur)
}

/** A felt thump: a low sine falling in pitch, plus a puff of lowpassed noise. */
export function thump(ctx: BaseAudioContext, out: AudioNode, kit: Kit, t: number, o: {
  from: number; to: number; dur: number; gain: number; random: () => number; puff?: number; cut?: number
}) {
  const at = snap(ctx, t)
  const dur = snap(ctx, o.dur)
  const osc = new OscillatorNode(ctx, { frequency: o.from })
  osc.frequency.setValueCurveAtTime(curve(dur, (u) => o.to + (o.from - o.to) * Math.exp(-u * 6), 500), at, dur)
  const env = strike(dur, 0.006, dur / 4)
  const g = new GainNode(ctx, { gain: 0 })
  g.gain.setValueCurveAtTime(curve(dur, (u) => o.gain * env(u)), at, dur)
  osc.connect(g).connect(out)
  osc.start(at)
  osc.stop(at + dur)
  const puff = o.puff ?? 0.6
  if (puff > 0) {
    noise(ctx, out, kit, at, { dur: dur * 0.7, env: strike(dur * 0.7, 0.003, dur / 8), gain: o.gain * puff, random: o.random, type: 'lowpass', freq: o.cut ?? 600, q: 0.6 })
  }
}

/** A wooden tock: a short band of noise for the strike and a resonant wood body under it. */
export function tock(ctx: BaseAudioContext, out: AudioNode, kit: Kit, t: number, o: {
  freq: number; gain: number; random: () => number; click?: number; band?: number
}) {
  noise(ctx, out, kit, t, { dur: 0.018, env: strike(0.018, 0.0015, 0.004), gain: o.gain * (o.click ?? 0.5), random: o.random, freq: o.band ?? o.freq * 2.2, q: 1.6 })
  pluck(ctx, out, t, o.freq, BODY.wood, { gain: o.gain, attack: 0.002 })
}

const rooms = new WeakMap<BaseAudioContext, AudioBuffer>()

/** One short, dark room response per context: a few early reflections and a 0.3 s lowpassed tail. */
function roomResponse(ctx: BaseAudioContext): AudioBuffer {
  let ir = rooms.get(ctx)
  if (ir) return ir
  const n = Math.round(0.32 * ctx.sampleRate)
  ir = new AudioBuffer({ length: n, sampleRate: ctx.sampleRate, numberOfChannels: 1 })
  const d = ir.getChannelData(0)
  const next = seededRandom(0x5eed)
  const rand = () => next() * 2 - 1
  let lp = 0
  for (let i = 0; i < n; i++) {
    const t = i / ctx.sampleRate
    const k = 0.25 + 0.6 * Math.exp(-t / 0.05) // the tail darkens as it decays
    lp += k * (rand() - lp)
    d[i] = lp * Math.exp(-t / 0.075) * cosRise(t / 0.004) * cosRise((0.32 - t) / 0.06)
  }
  for (const [ms, a] of [[7, 0.35], [13, 0.25], [21, 0.18], [29, 0.12]]) d[Math.round((ms / 1000) * ctx.sampleRate)] += a
  let e = 0
  for (const v of d) e += v * v
  const norm = 1 / Math.sqrt(e)
  for (let i = 0; i < n; i++) d[i] *= norm
  rooms.set(ctx, ir)
  return ir
}

/** One room per context: a ConvolverNode on the shared response, feeding the master. */
const sends = new WeakMap<BaseAudioContext, GainNode>()

/**
 * The context's room: its send, built once. The player builds it with the context (about
 * 1.5 ms: the response and the convolver's kernel), so the first tonal cue does not pay
 * for it inside an event.
 */
export function roomSend(ctx: BaseAudioContext): GainNode {
  let send = sends.get(ctx)
  if (!send) {
    send = new GainNode(ctx)
    const conv = new ConvolverNode(ctx, { buffer: roomResponse(ctx), disableNormalization: true })
    send.connect(conv).connect(mixFor(ctx).master)
    sends.set(ctx, send)
  }
  return send
}

/**
 * A little wooden room for tonal cues: returns a node to play into that feeds `out` dry and
 * sends `wet` of it to the context's one shared room, which joins the mix at the master
 * (so mute still covers the tail; the tail is centred, not panned). One convolver per
 * context, not per play: Chrome prepares a convolver's kernel on the main thread when it
 * gets its buffer, which cost about 1 ms per tonal cue and doubled the offline render cost.
 */
export function room(ctx: BaseAudioContext, out: AudioNode, wet = 0.22): AudioNode {
  const send = roomSend(ctx)
  const input = new GainNode(ctx)
  input.connect(out)
  input.connect(new GainNode(ctx, { gain: wet })).connect(send)
  return input
}

/**
 * Plays one take of a sprite: `take` is [start, length] in the file's seconds; `from` skips into
 * it and `len` cuts it shorter (with a cosine fade). Returns false when the file has not loaded
 * yet, so the cue can play its synthesized stand-in instead.
 */
export function sample(ctx: BaseAudioContext, out: AudioNode, buffer: AudioBuffer | undefined, t: number,
  take: readonly [number, number], o: { gain: number; rate?: number; from?: number; len?: number; /** A lowpass that rounds the top, in Hz. */ top?: number }): boolean {
  if (!buffer) return false
  const at = snap(ctx, t)
  const rate = o.rate ?? 1
  const skip = o.from ?? 0
  const len = Math.min(take[1] - skip, o.len ?? Infinity)
  const dur = snap(ctx, len / rate)
  const src = new AudioBufferSourceNode(ctx, { buffer, playbackRate: rate })
  const g = new GainNode(ctx, { gain: 0 })
  const fade = Math.min(0.04, dur / 3)
  const head = skip ? Math.min(0.006, dur / 4) : 0
  g.gain.setValueCurveAtTime(curve(dur, (u) => {
    const s = u * dur
    return o.gain * (head && s < head ? cosRise(s / head) : 1) * (s > dur - fade ? cosRise((dur - s) / fade) : 1)
  }), at, dur)
  ;(o.top ? src.connect(new BiquadFilterNode(ctx, { type: 'lowpass', frequency: o.top, Q: 0.5 })) : src).connect(g).connect(out)
  src.start(at, take[0] + skip, len)
  src.stop(at + dur)
  return true
}

/** The event's `seconds`, a default when it has none, clamped to what the cue can ring. */
export function seconds(s: number, fallback: number, max: number) {
  return Math.min(max, Number.isFinite(s) ? Math.max(0, s) : fallback)
}
