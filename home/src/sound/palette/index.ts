// Village's sound palette (#52): every cue src/sound/map.ts can reach, in felt, paper, wood
// and a little kalimba and glass. Tonal cues share one instrument family and the music bed's
// key (C major / A minor at A = 440, measured by chroma), using its pentatonic notes so they
// sit over any of the bed's chords. Most cues end within 0.6 s, rewards within 1.2 s.
//
// Variants: `a` is the default. chose, sent, card, news, placed and page have b and c, honestly
// different characters for a listening round (`?sfx=chose:b`).

import type { CueName, Cue, Palette, Play, Kit } from '../contract'
import { BODY, NOTE, crackle, noise, pluck, room, seconds, snap, strike, swell, thump, tock, wobble } from './synth'

type Ctx = BaseAudioContext

/** A cue with its play function typed once. */
const cue = (c: Cue): Cue => c

/** Picks from a list by round-robin index, so consecutive plays differ. */
const pick = <T>(p: Play, xs: readonly T[]): T => xs[p.index % xs.length]

// ── paper and cloth shapes ──────────────────────────────────────────────────

/** A paper slide: noise whose band moves `from` -> `to` Hz, with a fibrous grain. */
function slide(a: Ctx, out: AudioNode, kit: Kit, t: number, p: Play, o: { dur: number; from: number; to: number; gain: number; peak?: number; q?: number }) {
  const grain = wobble(p.random, 70, o.dur)
  const body = swell(o.peak ?? 0.35, 1.4)
  noise(a, out, kit, t, {
    dur: o.dur, gain: o.gain, random: p.random, q: o.q ?? 0.9, top: 5000,
    freq: (u) => (o.from + (o.to - o.from) * u) * p.rate,
    env: (u) => body(u) * (0.55 + 0.45 * grain(u)),
  })
}

/** A paper flick: a short, bright burst with a softer body under it. */
function flick(a: Ctx, out: AudioNode, kit: Kit, t: number, p: Play, o: { gain: number; freq?: number; dur?: number }) {
  const dur = o.dur ?? 0.09
  const f = (o.freq ?? 2600) * p.rate
  noise(a, out, kit, t, { dur, gain: o.gain, random: p.random, freq: f, q: 1.1, top: 5500, env: strike(dur, 0.004, dur / 3.5) })
  noise(a, out, kit, t, { dur: dur * 1.3, gain: o.gain * 0.5, random: p.random, freq: f * 0.35, q: 0.8, env: strike(dur * 1.3, 0.006, dur / 2.5) })
}

/** A tear: fibres popping in a band that rises a little as the slip comes free. */
function tear(a: Ctx, out: AudioNode, kit: Kit, t: number, p: Play, gain: number) {
  const dur = 0.15
  const fibres = crackle(p.random, dur, 26, 0.0035)
  const body = swell(0.6, 1)
  noise(a, out, kit, t, {
    dur, gain, random: p.random, q: 1.3, top: 6000,
    freq: (u) => (1900 + 900 * u) * p.rate,
    env: (u) => body(u) * (0.25 + 0.75 * fibres(u)),
  })
}

/** Cloth: two overlapping soft rustles in the low mids. */
function rustle(a: Ctx, out: AudioNode, kit: Kit, t: number, p: Play, o: { dur: number; gain: number }) {
  for (const [delay, f, g] of [[0, 1300, 1], [o.dur * 0.3, 900, 0.7]] as const) {
    const dur = o.dur * (0.75 + 0.2 * p.random())
    const grain = wobble(p.random, 45, dur)
    const body = swell(0.3 + 0.2 * p.random(), 1.3)
    noise(a, out, kit, t + delay, { dur, gain: o.gain * g, random: p.random, freq: f * p.rate, q: 0.7, top: 3800, env: (u) => body(u) * (0.4 + 0.6 * grain(u)) })
  }
}

/** A page leaf: a band that rises then settles, ending with a soft paper touch. */
function leaf(a: Ctx, out: AudioNode, kit: Kit, t: number, p: Play, o: { dur: number; gain: number; low?: number; high?: number; snapAt?: number }) {
  const low = (o.low ?? 900) * p.rate
  const high = (o.high ?? 2400) * p.rate
  const grain = wobble(p.random, 60, o.dur)
  const body = swell(0.45, 1.2)
  noise(a, out, kit, t, {
    dur: o.dur, gain: o.gain, random: p.random, q: 0.9, top: 5000,
    freq: (u) => low + (high - low) * Math.sin(Math.PI * Math.min(1, u * 1.2)) ** 2 + 200 * u,
    env: (u) => body(u) * (0.5 + 0.5 * grain(u)),
  })
  if (o.snapAt !== undefined) flick(a, out, kit, t + o.dur * o.snapAt, p, { gain: o.gain * 0.6, freq: 2200, dur: 0.05 })
}

// ── the cues ────────────────────────────────────────────────────────────────

const hover = {
  a: cue({
    bus: 'ui', level: -27.5, gap: 0.12, length: 0.12, jitter: { cents: 4, db: 1.5 },
    play(a, out, p, kit) {
      // A breath of felt and the faintest tuned tick, both under 60 ms.
      noise(a, out, kit, p.at, { dur: 0.05, gain: p.gain * 0.5, random: p.random, freq: 1100, q: 0.7, env: strike(0.05, 0.008, 0.014) })
      pluck(a, out, p.at, NOTE.G5 * p.rate, BODY.kalimba, { gain: p.gain * 0.35, attack: 0.004, dur: 0.1 })
    },
  }),
}

const chose = {
  a: cue({
    bus: 'ui', level: -20.5, gap: 0.05, length: 0.5, jitter: { cents: 3, db: 1 },
    play(a, out, p, kit) {
      // A wooden tock with a small kalimba G above it.
      tock(a, out, kit, p.at, { freq: NOTE.G4 * p.rate * (1 + 0.01 * (p.random() - 0.5)), gain: p.gain * 0.7, random: p.random })
      pluck(a, room(a, out, 0.18), p.at + 0.006, pick(p, [NOTE.G5, NOTE.G5, NOTE.A5]) * p.rate, BODY.kalimba, { gain: p.gain * 0.45, dur: 0.3 })
    },
  }),
  b: cue({
    bus: 'ui', level: -16, gap: 0.05, length: 0.6, jitter: { cents: 3, db: 1 },
    play(a, out, p, kit) {
      // A soft felt press and a music-box E high above it.
      thump(a, out, kit, p.at, { from: 240, to: 130, dur: 0.07, gain: p.gain * 0.8, random: p.random, puff: 0.5, cut: 900 })
      pluck(a, room(a, out, 0.2), p.at + 0.012, NOTE.E6 * p.rate, BODY.musicBox, { gain: p.gain * 0.22, dur: 0.5 })
    },
  }),
  c: cue({
    bus: 'ui', level: -21, gap: 0.05, length: 0.6, jitter: { cents: 3, db: 1 },
    play(a, out, p, kit) {
      // A soft-mallet marimba C, a tuned bar only, with a breath of felt on the strike.
      noise(a, out, kit, p.at, { dur: 0.03, gain: p.gain * 0.25, random: p.random, freq: 700, q: 0.8, env: strike(0.03, 0.003, 0.008) })
      pluck(a, room(a, out, 0.22), p.at, pick(p, [NOTE.C5, NOTE.C5, NOTE.D5]) * p.rate, BODY.marimba, { gain: p.gain * 0.75, attack: 0.005, dur: 0.35 })
    },
  }),
}

const backed = {
  a: cue({
    bus: 'ui', level: -21.5, gap: 0.05, length: 0.45, jitter: { cents: 3, db: 1 },
    play(a, out, p, kit) {
      // The inverse of chose: a lower, duller tock and a kalimba C that sags a few cents.
      tock(a, out, kit, p.at, { freq: NOTE.C4 * p.rate, gain: p.gain * 0.55, random: p.random, click: 0.3, band: 900 })
      pluck(a, room(a, out, 0.15), p.at + 0.008, NOTE.C5 * p.rate, BODY.kalimba, { gain: p.gain * 0.4, bend: -25, dur: 0.3 })
    },
  }),
}

const glide = {
  a: cue({
    bus: 'ui', level: -23, length: 2.5, jitter: { cents: 80, db: 1 },
    play(a, out, p, kit) {
      // Air that swells and fades with the camera; nothing when the move is instant.
      const dur = seconds(p.seconds, 0.8, 2.5)
      if (dur < 0.08) return
      const body = swell(0.4, 1.6)
      noise(a, out, kit, p.at, {
        dur, gain: p.gain * 0.7, random: p.random, q: 0.6, top: 2500,
        freq: (u) => (420 + 520 * Math.sin(Math.PI * u)) * p.rate,
        env: body,
      })
    },
  }),
}

const turned = {
  a: cue({
    bus: 'world', level: -12.5, gap: 0.2, length: 0.4, jitter: { cents: 150, db: 1.5 },
    play(a, out, p, kit) {
      // Felt clothes turning: two soft rustles.
      rustle(a, out, kit, p.at, p, { dur: 0.3, gain: p.gain * 0.6 })
    },
  }),
}

const card = {
  a: cue({
    bus: 'ui', level: -11, gap: 0.06, length: 0.2, jitter: { cents: 120, db: 1 },
    play(a, out, p, kit) {
      // A paper flick; a later page is a touch higher and shorter.
      const next = Number(p.event.page ?? 0) > 0
      flick(a, out, kit, p.at, p, { gain: p.gain * 0.8, freq: next ? 2900 : 2400, dur: next ? 0.07 : 0.1 })
    },
  }),
  b: cue({
    bus: 'ui', level: -17, gap: 0.06, length: 0.6, jitter: { cents: 3, db: 1 },
    play(a, out, p, kit) {
      // The flick, and on a new reply a quiet glass E: something arrived.
      flick(a, out, kit, p.at, p, { gain: p.gain * 0.7, freq: 2500 * p.rate, dur: 0.09 })
      if (Number(p.event.page ?? 0) === 0) pluck(a, room(a, out, 0.25), p.at + 0.03, NOTE.E6 * p.rate, BODY.glass, { gain: p.gain * 0.18, attack: 0.012, dur: 0.5 })
    },
  }),
  c: cue({
    bus: 'ui', level: -13.5, gap: 0.06, length: 0.2, jitter: { cents: 100, db: 1 },
    play(a, out, p, kit) {
      // A card sliding in: a quick soft "fwip" that rises.
      const dur = 0.14
      noise(a, out, kit, p.at, { dur, gain: p.gain * 0.75, random: p.random, q: 1.4, top: 5000, freq: (u) => (900 + 2200 * u * u) * p.rate, env: swell(0.65, 1.5) })
    },
  }),
}

const padUp = {
  a: cue({
    bus: 'ui', level: -14.5, gap: 0.15, length: 0.4, jitter: { cents: 100, db: 1 },
    play(a, out, p, kit) {
      // The notepad rising: a paper slide that brightens.
      slide(a, out, kit, p.at, p, { dur: 0.32, from: 700, to: 1900, gain: p.gain * 0.7, peak: 0.55 })
    },
  }),
}

const padDown = {
  a: cue({
    bus: 'ui', level: -16.5, gap: 0.15, length: 0.45, jitter: { cents: 100, db: 1 },
    play(a, out, p, kit) {
      // Lowering it: a darkening slide that settles on felt.
      slide(a, out, kit, p.at, p, { dur: 0.3, from: 1700, to: 600, gain: p.gain * 0.7, peak: 0.3 })
      thump(a, out, kit, p.at + 0.27, { from: 180, to: 110, dur: 0.08, gain: p.gain * 0.35, random: p.random, puff: 0.6, cut: 700 })
    },
  }),
}

const writing = {
  a: cue({
    bus: 'ui', level: -25, gap: 0.075, length: 0.35, jitter: { cents: 150, db: 2 },
    play(a, out, p, kit) {
      // Pencil on paper. The player sends one event per keystroke and `gap` drops those
      // closer than 75 ms, so steady typing becomes overlapping grains of one scratch that
      // stops when typing stops. Deleting is a softer, lower rub; a paste is one longer stroke.
      const added = Number(p.event.added ?? 1)
      if (!added) return
      const erase = added < 0
      const dur = Math.min(0.3, 0.13 + 0.01 * Math.max(0, Math.abs(added) - 1))
      const strokes = crackle(p.random, dur, 3 + Math.floor(p.random() * 3), 0.022)
      const body = swell(0.4, 0.8)
      noise(a, out, kit, p.at, {
        dur, gain: p.gain * (erase ? 0.6 : 1), random: p.random, q: erase ? 0.7 : 1.1, top: erase ? 2500 : 4500,
        freq: (erase ? 1100 : 2300) * p.rate,
        env: (u) => body(u) * (0.35 + 0.65 * strokes(u)),
      })
    },
  }),
}

/** The flight of a sent slip, shared by the three `sent` variants: `seconds` long, at least 0.25 s. */
const flight = (p: Play) => Math.max(0.25, seconds(p.seconds, 0.7, 1.0))

const sent = {
  a: cue({
    bus: 'world', level: -11, length: 1.2, jitter: { cents: 100, db: 1 },
    play(a, out, p, kit) {
      // Torn off, then a paper flutter that fades as it flies and a soft tap as it lands.
      tear(a, out, kit, p.at, p, p.gain * 0.8)
      const fly = flight(p)
      const flaps = (u: number) => 0.5 + 0.5 * Math.cos(2 * Math.PI * u * fly * (11 + 3 * p.random()))
      const body = swell(0.25, 1)
      noise(a, out, kit, p.at + 0.12, { dur: fly, gain: p.gain * 0.45, random: p.random, freq: 1500 * p.rate, q: 0.8, top: 4000, env: (u) => body(u) * (0.3 + 0.7 * flaps(u)) })
      flick(a, out, kit, p.at + 0.12 + fly - 0.02, p, { gain: p.gain * 0.35, freq: 2000, dur: 0.06 })
    },
  }),
  b: cue({
    bus: 'world', level: -11.5, length: 1.2, jitter: { cents: 100, db: 1 },
    play(a, out, p, kit) {
      // Torn off, then one airy whoosh that passes and lands on felt.
      tear(a, out, kit, p.at, p, p.gain * 0.8)
      const fly = flight(p)
      noise(a, out, kit, p.at + 0.1, { dur: fly, gain: p.gain * 0.5, random: p.random, q: 0.7, top: 3000, freq: (u) => (500 + 900 * Math.sin(Math.PI * u)) * p.rate, env: swell(0.55, 1.8) })
      thump(a, out, kit, p.at + 0.1 + fly - 0.03, { from: 200, to: 120, dur: 0.07, gain: p.gain * 0.35, random: p.random, puff: 0.7, cut: 900 })
    },
  }),
  c: cue({
    bus: 'world', level: -19, length: 1.4, jitter: { cents: 3, db: 1 },
    play(a, out, p, kit) {
      // Torn off, then a kalimba run (C E G) across the flight that lands on the high C.
      tear(a, out, kit, p.at, p, p.gain * 0.7)
      const fly = flight(p)
      const r = room(a, out, 0.22)
      const notes = [NOTE.C5, NOTE.E5, NOTE.G5]
      notes.forEach((f, i) => pluck(a, r, p.at + 0.1 + (fly * i) / notes.length, f * p.rate, BODY.kalimba, { gain: p.gain * (0.22 + 0.04 * i), dur: 0.35 }))
      pluck(a, r, p.at + 0.1 + fly, NOTE.C6 * p.rate, BODY.kalimba, { gain: p.gain * 0.35, dur: 0.6 })
    },
  }),
}

const routed = {
  a: cue({
    bus: 'ui', level: -22.5, gap: 0.2, length: 0.6, jitter: { cents: 3, db: 1 },
    play(a, out, p) {
      // Found its place: kalimba G then C, a fourth up.
      const r = room(a, out, 0.2)
      pluck(a, r, p.at, NOTE.G5 * p.rate, BODY.kalimba, { gain: p.gain * 0.4, dur: 0.3 })
      pluck(a, r, p.at + 0.085, NOTE.C6 * p.rate, BODY.kalimba, { gain: p.gain * 0.45, dur: 0.4 })
    },
  }),
}

const unrouted = {
  a: cue({
    bus: 'ui', level: -21.5, gap: 0.2, length: 0.6, jitter: { cents: 3, db: 1 },
    play(a, out, p) {
      // "Hm": two soft marimba notes, E down to D, a thoughtful step rather than an error.
      const r = room(a, out, 0.2)
      pluck(a, r, p.at, NOTE.E5 * p.rate, BODY.marimba, { gain: p.gain * 0.45, attack: 0.008 })
      pluck(a, r, p.at + 0.14, NOTE.D5 * p.rate, BODY.marimba, { gain: p.gain * 0.4, attack: 0.01, bend: -10 })
    },
  }),
}

const ghost = {
  a: cue({
    bus: 'world', level: -23, gap: 0.3, length: 0.7, jitter: { cents: 3, db: 1 },
    play(a, out, p) {
      // A ghost shimmer: three slow-blooming glass tones (E G A, high) that tremble and fade.
      const dur = 0.6
      ;[NOTE.E6, NOTE.G6, NOTE.A6].forEach((f, i) => {
        const at = snap(a, p.at + i * 0.04)
        const osc = new OscillatorNode(a, { frequency: f * p.rate })
        const g = new GainNode(a, { gain: 0 })
        const rate = 7 + 2 * i + p.random()
        const body = swell(0.3, 1.5)
        g.gain.setValueCurveAtTime(Float32Array.from({ length: 1200 }, (_, k) => {
          const u = k / 1199
          return p.gain * (0.3 - 0.07 * i) * body(u) * (0.7 + 0.3 * Math.cos(2 * Math.PI * u * dur * rate))
        }), at, dur)
        osc.connect(g).connect(out)
        osc.start(at)
        osc.stop(at + dur)
      })
    },
  }),
}

/** A small sparkle: two quick music-box notes high up. */
function sparkle(a: Ctx, out: AudioNode, t: number, p: Play, gain: number, notes: readonly number[] = [NOTE.G6, NOTE.C6]) {
  const r = room(a, out, 0.3)
  notes.forEach((f, i) => pluck(a, r, t + i * 0.055, f * p.rate, BODY.musicBox, { gain: gain * (1 - 0.3 * i), attack: 0.003, dur: 0.45 }))
}

const placed = {
  a: cue({
    bus: 'world', level: -17, gap: 0.1, length: 0.8, jitter: { cents: 3, db: 1 },
    play(a, out, p, kit) {
      // A felt thump as the prop arrives and a little music-box sparkle after it.
      thump(a, out, kit, p.at, { from: 210, to: 110, dur: 0.16, gain: p.gain * 0.9, random: p.random, puff: 0.6, cut: 700 })
      sparkle(a, out, p.at + 0.07, p, p.gain * 0.16)
    },
  }),
  b: cue({
    bus: 'world', level: -14.5, gap: 0.1, length: 0.8, jitter: { cents: 3, db: 1 },
    play(a, out, p, kit) {
      // A wooden set-down: a low wood knock with a glass E ringing over it.
      tock(a, out, kit, p.at, { freq: NOTE.C4 * p.rate, gain: p.gain * 0.75, random: p.random, click: 0.35, band: 800 })
      thump(a, out, kit, p.at, { from: 130, to: 80, dur: 0.1, gain: p.gain * 0.4, random: p.random, puff: 0.2 })
      pluck(a, room(a, out, 0.25), p.at + 0.05, NOTE.E6 * p.rate, BODY.glass, { gain: p.gain * 0.15, attack: 0.01, dur: 0.6 })
    },
  }),
  c: cue({
    bus: 'world', level: -14, gap: 0.1, length: 0.7, jitter: { cents: 3, db: 1 },
    play(a, out, p, kit) {
      // A cushion "pomf": a slow, round puff of air and one kalimba C.
      noise(a, out, kit, p.at, { dur: 0.22, gain: p.gain * 0.7, random: p.random, type: 'lowpass', freq: 550 * p.rate, q: 0.7, env: strike(0.22, 0.018, 0.05) })
      thump(a, out, kit, p.at + 0.005, { from: 170, to: 100, dur: 0.14, gain: p.gain * 0.55, random: p.random, puff: 0 })
      pluck(a, room(a, out, 0.22), p.at + 0.09, NOTE.C6 * p.rate, BODY.kalimba, { gain: p.gain * 0.2, dur: 0.45 })
    },
  }),
}

const kept = {
  a: cue({
    bus: 'world', level: -19.5, gap: 0.3, length: 1.1, jitter: { cents: 3, db: 1 },
    play(a, out, p) {
      // A small reward: kalimba C E G rolled quickly, the G left ringing.
      const r = room(a, out, 0.25)
      ;[NOTE.C5, NOTE.E5, NOTE.G5].forEach((f, i) => pluck(a, r, p.at + i * 0.07, f * p.rate, BODY.kalimba, { gain: p.gain * (0.35 + 0.05 * i), dur: i === 2 ? 0.95 : 0.5 }))
    },
  }),
}

const undone = {
  a: cue({
    bus: 'world', level: -16, gap: 0.2, length: 0.5, jitter: { cents: 3, db: 1 },
    play(a, out, p, kit) {
      // A soft reverse: a breath drawn in and a kalimba G that swells instead of striking.
      const dur = 0.32
      noise(a, out, kit, p.at, { dur, gain: p.gain * 0.35, random: p.random, freq: (u) => (1400 - 700 * u) * p.rate, q: 0.8, top: 3000, env: swell(0.85, 2) })
      const at = snap(a, p.at)
      const osc = new OscillatorNode(a, { frequency: NOTE.G5 * p.rate })
      const g = new GainNode(a, { gain: 0 })
      const rise = swell(0.82, 2.2)
      g.gain.setValueCurveAtTime(Float32Array.from({ length: 800 }, (_, k) => p.gain * 0.3 * rise(k / 799)), at, dur)
      osc.connect(g).connect(out)
      osc.start(at)
      osc.stop(at + dur)
    },
  }),
}

const failed = {
  a: cue({
    bus: 'world', level: -21, gap: 0.3, length: 0.7, jitter: { cents: 3, db: 1 },
    play(a, out, p, kit) {
      // Soft and sympathetic: a felt bump and a marimba E falling gently to C.
      thump(a, out, kit, p.at, { from: 180, to: 110, dur: 0.1, gain: p.gain * 0.4, random: p.random, puff: 0.4 })
      const r = room(a, out, 0.2)
      pluck(a, r, p.at + 0.02, NOTE.E5 * p.rate, BODY.marimba, { gain: p.gain * 0.4, attack: 0.008 })
      pluck(a, r, p.at + 0.2, NOTE.C5 * p.rate, BODY.marimba, { gain: p.gain * 0.38, attack: 0.012, bend: -8 })
    },
  }),
}

const bookOpen = {
  a: cue({
    bus: 'ui', level: -13, gap: 0.2, length: 0.55, jitter: { cents: 80, db: 1 },
    play(a, out, p, kit) {
      // The cover lifts off felt, and the pages breathe open.
      thump(a, out, kit, p.at, { from: 150, to: 95, dur: 0.07, gain: p.gain * 0.35, random: p.random, puff: 0.5, cut: 600 })
      slide(a, out, kit, p.at + 0.03, p, { dur: 0.4, from: 600, to: 1500, gain: p.gain * 0.55, peak: 0.4, q: 0.7 })
    },
  }),
}

const bookClose = {
  a: cue({
    bus: 'ui', level: -15, gap: 0.2, length: 0.5, jitter: { cents: 80, db: 1 },
    play(a, out, p, kit) {
      // Pages fold in with a short swish, and the cover meets them with a soft clap.
      const dur = Math.max(0.12, seconds(p.seconds, 0.3, 0.35) - 0.04)
      slide(a, out, kit, p.at, p, { dur, from: 1500, to: 700, gain: p.gain * 0.5, peak: 0.6, q: 0.7 })
      thump(a, out, kit, p.at + dur, { from: 190, to: 100, dur: 0.09, gain: p.gain * 0.55, random: p.random, puff: 0.9, cut: 900 })
    },
  }),
}

const page = {
  a: cue({
    bus: 'ui', level: -15, gap: 0.05, length: 0.9, jitter: { cents: 100, db: 1 },
    play(a, out, p, kit) {
      // A leaf turning; several leaves riffle across the turn's seconds (up to five heard).
      const leaves = Math.min(5, Math.max(1, Number(p.event.leaves ?? 1)))
      const span = seconds(p.seconds, 0.3, 0.6)
      for (let i = 0; i < leaves; i++) {
        leaf(a, out, kit, p.at + (leaves > 1 ? (span * i) / leaves : 0), p, { dur: leaves > 1 ? 0.16 : 0.24, gain: p.gain * (i === leaves - 1 ? 0.75 : 0.5) })
      }
    },
  }),
  b: cue({
    bus: 'ui', level: -15, gap: 0.05, length: 0.9, jitter: { cents: 100, db: 1 },
    play(a, out, p, kit) {
      // A crisper leaf: brighter and quicker, landing with a small paper snap.
      const leaves = Math.min(5, Math.max(1, Number(p.event.leaves ?? 1)))
      const span = seconds(p.seconds, 0.3, 0.6)
      for (let i = 0; i < leaves; i++) {
        const last = i === leaves - 1
        leaf(a, out, kit, p.at + (leaves > 1 ? (span * i) / leaves : 0), p, { dur: 0.16, gain: p.gain * (last ? 0.65 : 0.45), low: 1400, high: 3200, snapAt: last ? 0.85 : undefined })
      }
    },
  }),
  c: cue({
    bus: 'ui', level: -14, gap: 0.05, length: 0.9, jitter: { cents: 60, db: 1 },
    play(a, out, p, kit) {
      // A heavy, soft page: lower and slower, more air than paper.
      const leaves = Math.min(4, Math.max(1, Number(p.event.leaves ?? 1)))
      const span = seconds(p.seconds, 0.35, 0.6)
      for (let i = 0; i < leaves; i++) {
        leaf(a, out, kit, p.at + (leaves > 1 ? (span * i) / leaves : 0), p, { dur: 0.3, gain: p.gain * (i === leaves - 1 ? 0.8 : 0.5), low: 500, high: 1300 })
      }
    },
  }),
}

const sat = {
  a: cue({
    bus: 'world', level: -17, gap: 0.15, length: 1.4, jitter: { cents: 3, db: 1.5 },
    play(a, out, p, kit) {
      // A cushioned chair as the hop lands: a round low bump, a "pff" of air, a small wood creak.
      const t = p.at + seconds(p.seconds, 0, 1)
      thump(a, out, kit, t, { from: 160, to: 85, dur: 0.16, gain: p.gain * 0.8, random: p.random, puff: 0.8, cut: 650 })
      noise(a, out, kit, t + 0.01, { dur: 0.2, gain: p.gain * 0.25, random: p.random, freq: 800, q: 0.6, top: 2000, env: strike(0.2, 0.02, 0.05) })
      noise(a, out, kit, t + 0.05, { dur: 0.12, gain: p.gain * 0.12, random: p.random, freq: (u) => (520 + 140 * u) * p.rate, q: 9, env: swell(0.5, 1) })
    },
  }),
}

const news = {
  a: cue({
    bus: 'world', level: -18, gap: 0.6, length: 1.2, jitter: { cents: 2, db: 1 },
    play(a, out, p) {
      // A friendly call: kalimba G then the C above it, the second left to ring.
      const r = room(a, out, 0.3)
      pluck(a, r, p.at, NOTE.G5 * p.rate, BODY.kalimba, { gain: p.gain * 0.42, dur: 0.5 })
      pluck(a, r, p.at + 0.16, NOTE.C6 * p.rate, [{ ratio: 1, amp: 1, tau: 0.42 }, ...BODY.kalimba.slice(1)], { gain: p.gain * 0.48, dur: 0.95 })
    },
  }),
  b: cue({
    bus: 'world', level: -18, gap: 0.6, length: 1.2, jitter: { cents: 2, db: 1 },
    play(a, out, p) {
      // A music-box call, E then A high up, with a glass bloom under the second note.
      const r = room(a, out, 0.32)
      pluck(a, r, p.at, NOTE.E6 * p.rate, BODY.musicBox, { gain: p.gain * 0.3, dur: 0.5 })
      pluck(a, r, p.at + 0.15, NOTE.A6 * p.rate, BODY.musicBox, { gain: p.gain * 0.3, dur: 0.9 })
      pluck(a, r, p.at + 0.15, NOTE.A5 * p.rate, BODY.glass, { gain: p.gain * 0.18, attack: 0.03, dur: 0.95 })
    },
  }),
  c: cue({
    bus: 'world', level: -16, gap: 0.6, length: 1.2, jitter: { cents: 2, db: 1 },
    play(a, out, p) {
      // A marimba double-strike E-E then A, with a ghost shimmer on the A.
      const r = room(a, out, 0.28)
      pluck(a, r, p.at, NOTE.E5 * p.rate, BODY.marimba, { gain: p.gain * 0.4 })
      pluck(a, r, p.at + 0.09, NOTE.E5 * p.rate, BODY.marimba, { gain: p.gain * 0.3 })
      pluck(a, r, p.at + 0.22, NOTE.A5 * p.rate, [{ ratio: 1, amp: 1, tau: 0.35 }, ...BODY.marimba.slice(1)], { gain: p.gain * 0.5 })
      pluck(a, r, p.at + 0.24, NOTE.E6 * p.rate, BODY.glass, { gain: p.gain * 0.1, attack: 0.05, dur: 0.9 })
    },
  }),
}

const walk = {
  a: cue({
    bus: 'world', level: -18, gap: 0.2, length: 2.2, jitter: { cents: 150, db: 1.5 },
    play(a, out, p, kit) {
      // Soft felt steps on the music's eighth notes (90 BPM): two to five as the camera
      // heads for the door, two as the new room eases in.
      const arrive = p.event.phase === 'arrive'
      const span = seconds(p.seconds, 1, 2)
      const step = 60 / 90 / 2
      const count = arrive ? 2 : Math.min(5, Math.max(2, Math.round(span / step)))
      for (let i = 0; i < count; i++) {
        const t = p.at + i * step + 0.012 * (p.random() - 0.5)
        const soft = i % 2 ? 0.8 : 1
        thump(a, out, kit, t, { from: 150 * p.rate, to: 85, dur: 0.09, gain: p.gain * 0.55 * soft * (arrive && i === 1 ? 0.6 : 1), random: p.random, puff: 0.9, cut: 700 })
      }
    },
  }),
}

const refused = {
  a: cue({
    bus: 'world', level: -18, gap: 0.6, length: 0.45, jitter: { cents: 40, db: 1 },
    play(a, out, p, kit) {
      // The closed door: two soft wooden knocks and a small latch rattle.
      for (const [dt, g] of [[0, 0.7], [0.11, 0.55]] as const) {
        tock(a, out, kit, p.at + dt, { freq: 210 * p.rate, gain: p.gain * g, random: p.random, click: 0.4, band: 700 })
      }
      const ticks = crackle(p.random, 0.12, 5, 0.004)
      noise(a, out, kit, p.at + 0.24, { dur: 0.12, gain: p.gain * 0.18, random: p.random, freq: 1600, q: 3, env: ticks })
    },
  }),
}

export const PALETTE: Palette = {
  hover, chose, backed, glide, turned, card,
  'pad-up': padUp, 'pad-down': padDown, writing, sent, routed, unrouted,
  ghost, placed, kept, undone, failed,
  'book-open': bookOpen, 'book-close': bookClose, page, sat, news, walk, refused,
}

/** One line per variant for the listening page. */
export const DESCRIPTIONS: Record<CueName, Record<string, string>> = {
  hover: { a: 'A breath of felt and the faintest kalimba G, under 60 ms; rate-limited to one per 120 ms.' },
  chose: {
    a: 'Wooden tock with a small kalimba G (A every third play).',
    b: 'Soft felt press with a high music-box E.',
    c: 'Soft-mallet marimba C, a tuned bar with a breath of felt.',
  },
  backed: { a: 'A lower, duller tock and a kalimba C that sags a few cents: chose in reverse.' },
  glide: { a: 'Air that swells and fades with the camera move; silent when the move is instant.' },
  turned: { a: 'Two soft cloth rustles.' },
  card: {
    a: 'A paper flick; a later page is higher and shorter.',
    b: 'The paper flick, with a quiet glass E when a new reply arrives.',
    c: 'A quick rising "fwip" of a card sliding in.',
  },
  'pad-up': { a: 'A paper slide that brightens as the pad rises.' },
  'pad-down': { a: 'A darkening paper slide that settles on felt.' },
  writing: { a: 'Pencil grains, at most one per 75 ms, overlapping into one scratch while typing; deleting is a softer rub.' },
  sent: {
    a: 'Tear, a paper flutter across the flight, and a soft paper tap on landing.',
    b: 'Tear, one airy whoosh that passes, and a felt landing.',
    c: 'Tear, then a kalimba run C-E-G across the flight landing on high C.',
  },
  routed: { a: 'Kalimba G then C, a fourth up: found its place.' },
  unrouted: { a: 'Marimba E stepping down to D: a thoughtful "hm", not an error.' },
  ghost: { a: 'Three slow-blooming, trembling glass tones (E G A).' },
  placed: {
    a: 'Felt thump and a two-note music-box sparkle.',
    b: 'A low wooden set-down with a glass E ringing over it.',
    c: 'A round cushion "pomf" and one kalimba C.',
  },
  kept: { a: 'Kalimba C E G rolled quickly, the G left ringing: a small reward.' },
  undone: { a: 'A breath drawn in and a kalimba G that swells instead of striking.' },
  failed: { a: 'A felt bump and a marimba E falling gently to C.' },
  'book-open': { a: 'The cover lifts off felt and the pages breathe open.' },
  'book-close': { a: 'Pages fold in with a swish and the cover meets them with a soft clap.' },
  page: {
    a: 'A leaf turning; several leaves riffle over the turn.',
    b: 'A crisper, brighter leaf that lands with a small snap.',
    c: 'A heavy, soft page: lower and slower, more air than paper.',
  },
  sat: { a: 'Cushioned chair as the hop lands: a round bump, a "pff" of air and a small wood creak.' },
  news: {
    a: 'Kalimba G then high C, the second left ringing.',
    b: 'Music-box E then high A with a glass bloom.',
    c: 'Marimba E-E then A with a ghost shimmer.',
  },
  walk: { a: 'Soft felt steps on the music\'s eighth notes: two to five leaving, two arriving.' },
  refused: { a: 'Two soft wooden knocks and a small latch rattle at the closed door.' },
}

/** Third-party samples the palette plays, for the in-app credit. */
export const SAMPLE_CREDITS: { title: string; author: string; source: string; licence: string; licenceUrl: string }[] = []
