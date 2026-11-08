// Village's sound palette (#52): every cue src/sound/map.ts can reach, in felt, paper, wood
// and a little kalimba and glass. Tonal cues share one instrument family and the music bed's
// key (C major / A minor at A = 440, measured by chroma), using its pentatonic notes so they
// sit over any of the bed's chords. Most cues end within 0.6 s, rewards within 1.2 s.
//
// Variants: CHOSEN (below) names the owner's pick per cue, else `a` plays. chose, sent, card, news, placed and page have b and c for a
// listening round (`?sfx=chose:b`): each `b` is recorded or hybrid (Freesound CC0 takes in
// public/audio/sfx/, with the synthesized sound as a stand-in until the file has loaded), and
// `a` and `c` are two different synthesized characters. Round 2 (the owner's notes on round 1)
// adds news d and e, hover d to f, farewell b to d, and a much softer b for turned and the pad;
// turned and the pad's `a` were softened in place. Round 3 (the owner found every news call
// annoying and asked for something like a bubble pop) adds news f to i: small bubble pops, two
// recorded, one synthesized and one hybrid, with `a` kept to compare.

import type { CueName, Cue, Palette, Play, Kit } from '../contract'
import { BODY, NOTE, crackle, curve, noise, pluck, room, sample, seconds, snap, strike, swell, thump, tock, wobble } from './synth'
import { SPRITES } from './sprites'

/** The recorded sprites (public/audio/sfx/, made by scripts/make-sfx.mjs), by what they hold. */
const S = {
  click: SPRITES['wood-clicks'], kalimba: SPRITES['kalimba-g5'], musicBox: SPRITES['music-box-g5'], tear: SPRITES.tears,
  swish: SPRITES['paper-swish'], slide: SPRITES['paper-slide'], cushion: SPRITES.cushion, page: SPRITES['page-turn'],
  chair: SPRITES['chair-lift'], steps: SPRITES['sock-steps'], bubble: SPRITES['bubble-pops'],
}

type Ctx = BaseAudioContext

/** A cue with its play function typed once. */
const cue = (c: Cue): Cue => c

/** Picks from a list by round-robin index, so consecutive plays differ. */
const pick = <T>(p: Play, xs: readonly T[]): T => xs[p.index % xs.length]

// ── paper and cloth shapes ──────────────────────────────────────────────────

/** A paper slide: noise whose band moves `from` -> `to` Hz, with a fibrous grain. */
function slide(a: Ctx, out: AudioNode, kit: Kit, t: number, p: Play, o: { dur: number; from: number; to: number; gain: number; peak?: number; q?: number; top?: number }) {
  const grain = wobble(p.random, 70, o.dur)
  const body = swell(o.peak ?? 0.35, 1.4)
  noise(a, out, kit, t, {
    dur: o.dur, gain: o.gain, random: p.random, q: o.q ?? 0.9, top: o.top ?? 5000,
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

/** Cloth: two overlapping soft rustles in the low mids; `low` scales their bands down, `top` rounds them, `peak` delays the swell. */
function rustle(a: Ctx, out: AudioNode, kit: Kit, t: number, p: Play, o: { dur: number; gain: number; low?: number; top?: number; peak?: number }) {
  const low = o.low ?? 1
  for (const [delay, f, g] of [[0, 1300, 1], [o.dur * 0.3, 900, 0.7]] as const) {
    const dur = o.dur * (0.75 + 0.2 * p.random())
    const grain = wobble(p.random, 45, dur)
    const body = swell((o.peak ?? 0.3) + 0.2 * p.random(), 1.3)
    noise(a, out, kit, t + delay, { dur, gain: o.gain * g, random: p.random, freq: f * low * p.rate, q: 0.7, top: o.top ?? 3800, env: (u) => body(u) * (0.4 + 0.6 * grain(u)) })
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
  d: cue({
    bus: 'ui', level: -10, gap: 0.12, length: 0.12, jitter: { cents: 60, db: 1.5 },
    samples: [S.click.file],
    play(a, out, p, kit) {
      // A felt-wrapped wooden tap: the first 60 ms of a recorded click (six takes) through two lowpasses (1.2 kHz, then 900 Hz).
      const felt = new BiquadFilterNode(a, { type: 'lowpass', frequency: 900, Q: 0.5 })
      felt.connect(out)
      const tapped = sample(a, felt, kit.sample(S.click.file), p.at, pick(p, S.click.takes), { gain: p.gain * 2.2, rate: p.rate * (0.9 + 0.08 * p.random()), len: 0.06, top: 1200 })
      if (!tapped) feltTap(a, out, kit, p, p.gain * 0.09)
    },
  }),
  e: cue({
    bus: 'ui', level: -18.5, gap: 0.12, length: 0.12, jitter: { cents: 30, db: 1.5 },
    play(a, out, p, kit) {
      // A breathy felt "pff" tuned to G (a narrow band of air) with a faint pitched body under it.
      const dur = 0.08
      noise(a, out, kit, p.at, { dur, gain: p.gain * 0.9, random: p.random, freq: NOTE.G5 * p.rate, q: 5, top: 1600, env: strike(dur, 0.012, 0.02) })
      noise(a, out, kit, p.at, { dur: 0.05, gain: p.gain * 0.3, random: p.random, type: 'lowpass', freq: 500, q: 0.6, env: strike(0.05, 0.006, 0.012) })
      pluck(a, out, p.at + 0.004, NOTE.G4 * p.rate, [{ ratio: 1, amp: 1, tau: 0.03 }], { gain: p.gain * 0.25, attack: 0.01, dur: 0.1 })
    },
  }),
  f: cue({
    bus: 'ui', level: -25.5, gap: 0.12, length: 0.2, jitter: { cents: 3, db: 1.5 },
    play(a, out, p) {
      // A fingertip on a small glass: a pure tone that blooms over 15 ms and fades, stepping G, E, A, G.
      pluck(a, out, p.at, pick(p, [NOTE.G5, NOTE.E5, NOTE.A5, NOTE.G5]) * p.rate, [{ ratio: 1, amp: 1, tau: 0.045 }, { ratio: 2.32, amp: 0.05, tau: 0.02 }], { gain: p.gain * 0.5, attack: 0.015, dur: 0.18 })
    },
  }),
}

/** A synthesized felt tap (hover d's stand-in while its click loads): a short low wood body and a puff. */
function feltTap(a: Ctx, out: AudioNode, kit: Kit, p: Play, gain: number) {
  pluck(a, out, p.at, 420 * p.rate, BODY.wood, { gain: gain * 0.5, attack: 0.003 })
  noise(a, out, kit, p.at, { dur: 0.03, gain: gain * 0.3, random: p.random, type: 'lowpass', freq: 900, q: 0.6, env: strike(0.03, 0.002, 0.007) })
}

const chose = {
  a: cue({
    bus: 'ui', level: -20.5, gap: 0.05, length: 0.6, jitter: { cents: 3, db: 1 },
    play(a, out, p, kit) {
      // A wooden tock with a small kalimba G above it.
      tock(a, out, kit, p.at, { freq: NOTE.G4 * p.rate * (1 + 0.01 * (p.random() - 0.5)), gain: p.gain * 0.7, random: p.random })
      pluck(a, room(a, out, 0.18), p.at + 0.006, pick(p, [NOTE.G5, NOTE.G5, NOTE.A5]) * p.rate, BODY.kalimba, { gain: p.gain * 0.45, dur: 0.3 })
    },
  }),
  b: cue({
    bus: 'ui', level: -20.5, gap: 0.05, length: 0.5, jitter: { cents: 3, db: 1 },
    samples: [S.click.file, S.kalimba.file],
    play(a, out, p, kit) {
      // Recorded: one of six wooden clicks and a real kalimba G, played short.
      const clicked = sample(a, out, kit.sample(S.click.file), p.at, pick(p, S.click.takes), { gain: p.gain * 4, rate: p.rate * (0.97 + 0.06 * p.random()), top: 3200 })
      const rang = sample(a, out, kit.sample(S.kalimba.file), p.at + 0.006, S.kalimba.takes[0], { gain: p.gain * 3.3, rate: p.rate, len: 0.35 })
      if (!clicked || !rang) chose.a.play(a, out, p, kit)
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
    bus: 'ui', level: -21.5, gap: 0.05, length: 0.55, jitter: { cents: 3, db: 1 },
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
    bus: 'world', level: -15.5, gap: 0.2, length: 0.4, jitter: { cents: 150, db: 1.5 },
    play(a, out, p, kit) {
      // Felt clothes turning: two soft rustles, lower and rounder than round 1 (3 dB down, top 2.6 kHz, slower swell).
      rustle(a, out, kit, p.at, p, { dur: 0.32, gain: p.gain * 0.6, low: 0.8, top: 2600, peak: 0.42 })
    },
  }),
  b: cue({
    bus: 'world', level: -19.5, gap: 0.2, length: 0.45, jitter: { cents: 150, db: 1.5 },
    play(a, out, p, kit) {
      // Much softer: the same rustles 7 dB under round 1, darker still (top 1.8 kHz) and slower.
      rustle(a, out, kit, p.at, p, { dur: 0.36, gain: p.gain * 0.6, low: 0.65, top: 1800, peak: 0.5 })
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
    bus: 'ui', level: -17, gap: 0.06, length: 0.65, jitter: { cents: 3, db: 1 },
    samples: [S.slide.file],
    play(a, out, p, kit) {
      // Hybrid: a recorded sheet sliding (three takes, cut short), and on a new reply a quiet glass E.
      const slid = sample(a, out, kit.sample(S.slide.file), p.at, pick(p, S.slide.takes), { gain: p.gain * 0.6, rate: p.rate * (0.95 + 0.1 * p.random()), len: 0.3 })
      if (!slid) flick(a, out, kit, p.at, p, { gain: p.gain * 0.7, freq: 2500, dur: 0.09 })
      if (Number(p.event.page ?? 0) === 0) pluck(a, room(a, out, 0.25), p.at + 0.03, NOTE.E6 * p.rate, BODY.glass, { gain: p.gain * 0.18, attack: 0.012, dur: 0.35 })
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
    bus: 'ui', level: -17.5, gap: 0.15, length: 0.4, jitter: { cents: 100, db: 1 },
    play(a, out, p, kit) {
      // The notepad rising: a paper slide that brightens, softer than round 1 (3 dB down, lower band, top 3.2 kHz, later swell).
      slide(a, out, kit, p.at, p, { dur: 0.32, from: 600, to: 1500, gain: p.gain * 0.7, peak: 0.62, top: 3200 })
    },
  }),
  b: cue({
    bus: 'ui', level: -21.5, gap: 0.15, length: 0.4, jitter: { cents: 100, db: 1 },
    play(a, out, p, kit) {
      // Much softer: 7 dB under round 1, a duller slide (500 to 1100 Hz, top 2.2 kHz) that swells late.
      slide(a, out, kit, p.at, p, { dur: 0.34, from: 500, to: 1100, gain: p.gain * 0.7, peak: 0.68, top: 2200, q: 0.7 })
    },
  }),
}

const padDown = {
  a: cue({
    bus: 'ui', level: -19.5, gap: 0.15, length: 0.45, jitter: { cents: 100, db: 1 },
    play(a, out, p, kit) {
      // Lowering it: a darkening slide that settles on felt, softer than round 1 (3 dB down, lower band, top 3 kHz, later swell).
      slide(a, out, kit, p.at, p, { dur: 0.3, from: 1400, to: 550, gain: p.gain * 0.7, peak: 0.4, top: 3000 })
      thump(a, out, kit, p.at + 0.27, { from: 170, to: 105, dur: 0.08, gain: p.gain * 0.35, random: p.random, puff: 0.5, cut: 600 })
    },
  }),
  b: cue({
    bus: 'ui', level: -23.5, gap: 0.15, length: 0.45, jitter: { cents: 100, db: 1 },
    play(a, out, p, kit) {
      // Much softer: 7 dB under round 1, a dull slide (1100 to 450 Hz, top 2 kHz) and a lighter felt landing.
      slide(a, out, kit, p.at, p, { dur: 0.32, from: 1100, to: 450, gain: p.gain * 0.7, peak: 0.45, top: 2000, q: 0.7 })
      thump(a, out, kit, p.at + 0.29, { from: 160, to: 100, dur: 0.08, gain: p.gain * 0.28, random: p.random, puff: 0.4, cut: 500 })
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

const sketch = {
  a: cue({
    bus: 'ui', level: -27, gap: 0.075, length: 0.3, jitter: { cents: 150, db: 2 },
    play(a, out, p, kit) {
      // Writing's pencil, drawing: sketch.ts announces the moving pen at most every 75 ms, so a
      // stroke is overlapping grains of one scratch that stops when the pen does. The rubber is
      // softer, lower and broader; an undo or a clear is one short rub.
      const tool = String(p.event.tool ?? 'pen')
      const pen = tool === 'pen'
      const dur = pen ? 0.12 : tool === 'rubber' ? 0.15 : tool === 'clear' ? 0.26 : 0.18
      const strokes = crackle(p.random, dur, pen ? 3 + Math.floor(p.random() * 3) : 2, pen ? 0.02 : 0.04)
      const body = swell(0.4, 0.8)
      noise(a, out, kit, p.at, {
        dur, gain: p.gain * (pen ? 1 : 0.55), random: p.random, q: pen ? 1.1 : 0.6, top: pen ? 4500 : 2400,
        freq: (pen ? 2500 : 1000) * p.rate,
        env: (u) => body(u) * (0.4 + 0.6 * strokes(u)),
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
    bus: 'world', level: -16, length: 1.3, jitter: { cents: 100, db: 1 },
    samples: [S.tear.file, S.swish.file],
    play(a, out, p, kit) {
      // Recorded: a real paper tear (four takes, cut short) and a sheet waved through the air
      // (three takes) that ends as the slip lands on felt.
      const fly = flight(p)
      const swish = pick(p, S.swish.takes)
      // Each tear take starts 18 to 33 ms before the paper does (measured): skip that, so the tear is heard on the event.
      const k = p.index % S.tear.takes.length
      const tore = sample(a, out, kit.sample(S.tear.file), p.at, S.tear.takes[k], { gain: p.gain * 1.5, rate: p.rate, len: 0.32, from: [0.018, 0.018, 0.03, 0.033][k] })
      const flew = sample(a, out, kit.sample(S.swish.file), p.at + 0.1 + Math.max(0, fly - swish[1]), swish, { gain: p.gain * 2.1, rate: p.rate })
      if (tore && flew) {
        thump(a, out, kit, p.at + 0.1 + fly - 0.02, { from: 200, to: 120, dur: 0.07, gain: p.gain * 0.35, random: p.random, puff: 0.7, cut: 900 })
        return
      }
      // Stand-in while the files load: the synthesized tear, whoosh and felt landing.
      tear(a, out, kit, p.at, p, p.gain * 1.35)
      noise(a, out, kit, p.at + 0.1, { dur: fly, gain: p.gain * 0.85, random: p.random, q: 0.7, top: 3000, freq: (u) => (500 + 900 * Math.sin(Math.PI * u)) * p.rate, env: swell(0.55, 1.8) })
      thump(a, out, kit, p.at + 0.1 + fly - 0.03, { from: 200, to: 120, dur: 0.07, gain: p.gain * 0.6, random: p.random, puff: 0.7, cut: 900 })
    },
  }),
  c: cue({
    bus: 'world', level: -19, length: 1.8, jitter: { cents: 3, db: 1 },
    play(a, out, p, kit) {
      // Torn off, then a kalimba run (C E G) across the flight that lands on the high C.
      tear(a, out, kit, p.at, p, p.gain * 0.7)
      const fly = flight(p)
      const r = room(a, out, 0.22)
      const notes = [NOTE.C5, NOTE.E5, NOTE.G5]
      notes.forEach((f, i) => pluck(a, r, p.at + 0.1 + (fly * i) / notes.length, f * p.rate, BODY.kalimba, { gain: p.gain * (0.22 + 0.04 * i), dur: 0.35 }))
      pluck(a, r, p.at + 0.1 + fly, NOTE.C6 * p.rate, BODY.kalimba, { gain: p.gain * 0.35, dur: 0.35 })
    },
  }),
}

const routed = {
  a: cue({
    bus: 'ui', level: -22.5, gap: 0.2, length: 0.8, jitter: { cents: 3, db: 1 },
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
    bus: 'ui', level: -21.5, gap: 0.2, length: 0.8, jitter: { cents: 3, db: 1 },
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
        g.gain.setValueCurveAtTime(Array.from({ length: 1200 }, (_, k) => {
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
    bus: 'world', level: -17, gap: 0.1, length: 0.8, jitter: { cents: 3, db: 1 },
    samples: [S.cushion.file],
    play(a, out, p, kit) {
      // Hybrid: a recorded cushion impact (five takes) and the synthesized music-box sparkle.
      const landed = sample(a, out, kit.sample(S.cushion.file), p.at, pick(p, S.cushion.takes), { gain: p.gain * 1.8, rate: p.rate * (0.92 + 0.12 * p.random()) })
      if (!landed) thump(a, out, kit, p.at, { from: 210, to: 110, dur: 0.16, gain: p.gain * 0.9, random: p.random, puff: 0.6, cut: 700 })
      sparkle(a, out, p.at + 0.07, p, p.gain * 0.16)
    },
  }),
  c: cue({
    bus: 'world', level: -14.5, gap: 0.1, length: 0.8, jitter: { cents: 3, db: 1 },
    play(a, out, p, kit) {
      // A wooden set-down: a low wood knock with a glass E ringing over it.
      tock(a, out, kit, p.at, { freq: NOTE.C4 * p.rate, gain: p.gain * 0.75, random: p.random, click: 0.35, band: 800 })
      thump(a, out, kit, p.at, { from: 160, to: 100, dur: 0.1, gain: p.gain * 0.4, random: p.random, puff: 0.2 })
      pluck(a, room(a, out, 0.25), p.at + 0.05, NOTE.E6 * p.rate, BODY.glass, { gain: p.gain * 0.15, attack: 0.01, dur: 0.6 })
    },
  }),
}

const kept = {
  a: cue({
    bus: 'world', level: -19.5, gap: 0.3, length: 1.2, jitter: { cents: 3, db: 1 },
    play(a, out, p) {
      // A small reward: kalimba C E G rolled quickly, the G left ringing.
      const r = room(a, out, 0.25)
      ;[NOTE.C5, NOTE.E5, NOTE.G5].forEach((f, i) => pluck(a, r, p.at + i * 0.07, f * p.rate, BODY.kalimba, { gain: p.gain * (0.35 + 0.05 * i), dur: i === 2 ? 0.8 : 0.5 }))
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
      g.gain.setValueCurveAtTime(Array.from({ length: 800 }, (_, k) => p.gain * 0.3 * rise(k / 799)), at, dur)
      osc.connect(g).connect(out)
      osc.start(at)
      osc.stop(at + dur)
    },
  }),
}

const failed = {
  a: cue({
    bus: 'world', level: -21, gap: 0.3, length: 0.85, jitter: { cents: 3, db: 1 },
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
    bus: 'ui', level: -18, gap: 0.05, length: 1.3, jitter: { cents: 100, db: 1 },
    samples: [S.page.file],
    play(a, out, p, kit) {
      // Recorded: a real page turn, its flip only; earlier leaves of a riffle are short slices of it.
      const leaves = Math.min(5, Math.max(1, Number(p.event.leaves ?? 1)))
      const span = seconds(p.seconds, 0.3, 0.6)
      const buffer = kit.sample(S.page.file)
      if (buffer) {
        for (let i = 0; i < leaves; i++) {
          const last = i === leaves - 1
          const t = p.at + (leaves > 1 ? (span * i) / leaves : 0)
          sample(a, out, buffer, t, S.page.takes[0], last
            ? { gain: p.gain * 1.7, rate: p.rate, from: 0.46, len: 0.75 }
            : { gain: p.gain, rate: p.rate * (0.95 + 0.1 * p.random()), from: 0.5 + 0.3 * p.random(), len: 0.18 })
        }
        return
      }
      // Stand-in while the file loads: a crisp synthesized leaf with a small snap.
      for (let i = 0; i < leaves; i++) {
        const last = i === leaves - 1
        leaf(a, out, kit, p.at + (leaves > 1 ? (span * i) / leaves : 0), p, { dur: 0.16, gain: p.gain * (last ? 0.9 : 0.6), low: 1400, high: 3200, snapAt: last ? 0.85 : undefined })
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

const farewell = {
  a: cue({
    bus: 'world', level: -19, gap: 0.6, length: 1.4, jitter: { cents: 2, db: 1 },
    play(a, out, p, kit) {
      // Everyone gets up from the table: two soft cushion lifts, then a kalimba E falling to C, left to ring.
      for (const [i, dt] of [0, 0.14].entries()) {
        thump(a, out, kit, p.at + dt, { from: 150 + 20 * i, to: 95, dur: 0.12, gain: p.gain * 0.45, random: p.random, puff: 0.6, cut: 600 })
      }
      const r = room(a, out, 0.28)
      pluck(a, r, p.at + 0.3, NOTE.E5 * p.rate, BODY.kalimba, { gain: p.gain * 0.36, dur: 0.4 })
      pluck(a, r, p.at + 0.48, NOTE.C5 * p.rate, BODY.kalimba, { gain: p.gain * 0.4, dur: 0.75 })
    },
  }),
  b: cue({
    bus: 'world', level: -16, gap: 0.6, length: 1.2, jitter: { cents: 40, db: 1 },
    samples: [S.chair.file],
    play(a, out, p, kit) {
      // Chairs pushed back: two recorded wooden-chair lifts (a sit, reversed), staggered, with a cloth rustle between.
      const buffer = kit.sample(S.chair.file)
      const first = sample(a, out, buffer, p.at, S.chair.takes[p.index % 2], { gain: p.gain * 1.4, rate: p.rate, top: 2400 })
      const second = sample(a, out, buffer, p.at + 0.22, S.chair.takes[(p.index + 1) % 2], { gain: p.gain * 1.1, rate: p.rate * 0.9, top: 2000 })
      if (!first || !second) {
        lift(a, out, kit, p.at, p, p.gain * 1.75)
        lift(a, out, kit, p.at + 0.22, p, p.gain * 1.4)
      }
      rustle(a, out, kit, p.at + 0.45, p, { dur: 0.3, gain: p.gain * 0.3, low: 0.7, top: 2200, peak: 0.4 })
    },
  }),
  c: cue({
    bus: 'world', level: -16.5, gap: 0.6, length: 1.7, jitter: { cents: 40, db: 1 },
    samples: [S.chair.file, S.steps.file],
    play(a, out, p, kit) {
      // Getting up and going: a recorded chair lift, then three sock steps on wood that fade and darken as they leave.
      const chair = kit.sample(S.chair.file)
      const steps = kit.sample(S.steps.file)
      const lifted = sample(a, out, chair, p.at, S.chair.takes[1], { gain: p.gain * 1.3, rate: p.rate, top: 2400 })
      if (!lifted) lift(a, out, kit, p.at, p, p.gain * 0.85)
      for (let i = 0; i < 3; i++) {
        const t = p.at + 0.5 + i * 0.34
        const stepped = sample(a, out, steps, t, pick({ ...p, index: p.index * 3 + i }, S.steps.takes), { gain: p.gain * 1.6 * 0.62 ** i, rate: p.rate * (0.96 + 0.08 * p.random()), top: 2400 - 550 * i })
        if (!stepped) thump(a, out, kit, t, { from: 150, to: 85, dur: 0.09, gain: p.gain * 0.85 * 0.62 ** i, random: p.random, puff: 0.9, cut: 700 - 120 * i })
      }
    },
  }),
  d: cue({
    bus: 'world', level: -14, gap: 0.6, length: 1.3, jitter: { cents: 40, db: 1 },
    play(a, out, p, kit) {
      // Synthesized foley: two cushions breathing out as people rise, a cloth rustle, and two soft felt steps away.
      lift(a, out, kit, p.at, p, p.gain * 0.5)
      lift(a, out, kit, p.at + 0.18, p, p.gain * 0.38)
      rustle(a, out, kit, p.at + 0.3, p, { dur: 0.3, gain: p.gain * 0.35, low: 0.75, top: 2400, peak: 0.4 })
      for (const [i, dt] of [0.66, 0.99].entries()) {
        thump(a, out, kit, p.at + dt, { from: 150 * p.rate, to: 85, dur: 0.09, gain: p.gain * (0.45 - 0.15 * i), random: p.random, puff: 0.9, cut: 650 - 100 * i })
      }
    },
  }),
}

/** A cushion as someone rises: low air drawn up and let go, with a faint creak of the seat. */
function lift(a: Ctx, out: AudioNode, kit: Kit, t: number, p: Play, gain: number) {
  const dur = 0.26
  noise(a, out, kit, t, { dur, gain, random: p.random, type: 'lowpass', freq: (u) => (260 + 380 * u) * p.rate, q: 0.8, env: swell(0.7, 1.6) })
  noise(a, out, kit, t + 0.06, { dur: 0.12, gain: gain * 0.25, random: p.random, freq: (u) => (480 + 120 * u) * p.rate, q: 8, env: swell(0.5, 1) })
}

/**
 * A bubble's "bloop": one sine that sweeps up `sweep` octaves to `freq` (most of the way within
 * about `rise` seconds, as a recorded pop does) and dies with time constant `tau`, struck over
 * `attack` seconds so it has no click.
 */
function bloop(a: Ctx, out: AudioNode, t: number, o: { freq: number; gain: number; sweep?: number; rise?: number; tau?: number; attack?: number }) {
  const at = snap(a, t)
  const attack = o.attack ?? 0.003
  const tau = o.tau ?? 0.014
  const rise = (o.rise ?? 0.024) / 3
  const sweep = o.sweep ?? 0.75
  const dur = snap(a, attack + tau * 6.9)
  const osc = new OscillatorNode(a, { frequency: o.freq * 2 ** -sweep })
  osc.frequency.setValueCurveAtTime(curve(dur, (u) => o.freq * 2 ** (-sweep * Math.exp(-(u * dur) / rise))), at, dur)
  const env = strike(dur, attack, tau)
  const g = new GainNode(a, { gain: 0 })
  g.gain.setValueCurveAtTime(curve(dur, (u) => o.gain * env(u), 4000), at, dur)
  osc.connect(g).connect(out)
  osc.start(at)
  osc.stop(at + dur)
}

/**
 * Each bubble-pop take's playback rate that brings its pitch to G5 (784 Hz). Measured from
 * bubble-pops.ogg: the takes' energy-weighted peak frequencies are 821, 747, 1019 and 995 Hz.
 */
const POP_TO_G5 = [784 / 821, 784 / 747, 784 / 1019, 784 / 995]

const news = {
  a: cue({
    bus: 'world', level: -18, gap: 0.6, length: 1.2, jitter: { cents: 2, db: 1 },
    play(a, out, p) {
      // A friendly call: kalimba G then the C above it, the second left to ring.
      const r = room(a, out, 0.3)
      pluck(a, r, p.at, NOTE.G5 * p.rate, BODY.kalimba, { gain: p.gain * 0.42, dur: 0.5 })
      pluck(a, r, p.at + 0.16, NOTE.C6 * p.rate, [{ ratio: 1, amp: 1, tau: 0.42 }, ...BODY.kalimba.slice(1)], { gain: p.gain * 0.48, dur: 0.85 })
    },
  }),
  b: cue({
    bus: 'world', level: -18, gap: 0.6, length: 1.2, jitter: { cents: 2, db: 1 },
    samples: [S.musicBox.file],
    play(a, out, p, kit) {
      // Recorded: a real music-box G (retuned from +28 cents) played as G then the C above it.
      const r = room(a, out, 0.3)
      const box = kit.sample(S.musicBox.file)
      const first = sample(a, r, box, p.at, S.musicBox.takes[0], { gain: p.gain * 2.4, rate: p.rate, len: 0.45 })
      const second = sample(a, r, box, p.at + 0.16, S.musicBox.takes[0], { gain: p.gain * 2.7, rate: p.rate * 2 ** (5 / 12), len: 0.85 * 2 ** (5 / 12) })
      if (first && second) return
      pluck(a, r, p.at, NOTE.G5 * p.rate, BODY.musicBox, { gain: p.gain * 0.35, dur: 0.45 })
      pluck(a, r, p.at + 0.16, NOTE.C6 * p.rate, BODY.musicBox, { gain: p.gain * 0.4, dur: 0.85 })
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
  d: cue({
    bus: 'world', level: -20, gap: 0.6, length: 1.2, jitter: { cents: 2, db: 1 },
    play(a, out, p) {
      // a, rounder: the same kalimba G then high C, struck over 12 ms instead of 4, half the octave
      // partial and nothing above 2 kHz, less room, 2 dB quieter.
      const r = room(a, out, 0.18)
      const round = [{ ratio: 1, amp: 1, tau: 0.32 }, { ratio: 2.01, amp: 0.04, tau: 0.1 }]
      pluck(a, r, p.at, NOTE.G5 * p.rate, round, { gain: p.gain * 0.42, attack: 0.012, dur: 0.5, ceiling: 2000 })
      pluck(a, r, p.at + 0.16, NOTE.C6 * p.rate, [{ ratio: 1, amp: 1, tau: 0.42 }, round[1]], { gain: p.gain * 0.46, attack: 0.012, dur: 0.85, ceiling: 2000 })
    },
  }),
  e: cue({
    bus: 'world', level: -20, gap: 0.6, length: 1.2, jitter: { cents: 2, db: 1 },
    play(a, out, p, kit) {
      // a, an octave lower with a felt mallet: G4 then C5, a 9 ms strike with a soft thud of felt,
      // a little warmth from a quiet octave, less room, 2 dB quieter.
      const r = room(a, out, 0.2)
      const felt = [{ ratio: 1, amp: 1, tau: 0.36 }, { ratio: 2.0, amp: 0.1, tau: 0.12 }]
      noise(a, out, kit, p.at, { dur: 0.04, gain: p.gain * 0.15, random: p.random, type: 'lowpass', freq: 500, q: 0.6, env: strike(0.04, 0.004, 0.01) })
      pluck(a, r, p.at, NOTE.G4 * p.rate, felt, { gain: p.gain * 0.5, attack: 0.009, dur: 0.55, ceiling: 1600 })
      pluck(a, r, p.at + 0.16, NOTE.C5 * p.rate, [{ ratio: 1, amp: 1, tau: 0.46 }, felt[1]], { gain: p.gain * 0.55, attack: 0.009, dur: 0.9, ceiling: 1600 })
    },
  }),
  f: cue({
    bus: 'world', level: -19, gap: 0.6, length: 0.25, jitter: { cents: 30, db: 1 },
    samples: [S.bubble.file],
    play(a, out, p, kit) {
      // Recorded: one small bubble pop, four takes from four recordings in turn, top rolled off at 4 kHz.
      if (sample(a, out, kit.sample(S.bubble.file), p.at, pick(p, S.bubble.takes), { gain: p.gain, rate: p.rate, top: 4000 })) return
      bloop(a, out, p.at, { freq: 900 * p.rate, gain: p.gain })
    },
  }),
  g: cue({
    bus: 'world', level: -20.5, gap: 0.6, length: 0.25, jitter: { cents: 30, db: 1 },
    samples: [S.bubble.file],
    play(a, out, p, kit) {
      // Recorded, bigger: the same four pops at 0.63 speed (eight semitones down, longer), top at 2.4 kHz.
      if (sample(a, out, kit.sample(S.bubble.file), p.at, pick(p, S.bubble.takes), { gain: p.gain, rate: 0.63 * p.rate, top: 2400 })) return
      bloop(a, out, p.at, { freq: 560 * p.rate, gain: p.gain, tau: 0.02 })
    },
  }),
  h: cue({
    bus: 'world', level: -21, gap: 0.6, length: 0.25, jitter: { cents: 25, db: 1 },
    play(a, out, p) {
      // Synthesized: a sine bloop rising to G5, and a faint smaller one landing on D6 just after it.
      bloop(a, out, p.at, { freq: NOTE.G5 * p.rate, gain: p.gain })
      bloop(a, out, p.at + 0.075, { freq: NOTE.D6 * p.rate, gain: p.gain * 0.23, sweep: 0.6, rise: 0.012, tau: 0.007 })
    },
  }),
  i: cue({
    bus: 'world', level: -17.5, gap: 0.6, length: 0.25, jitter: { cents: 25, db: 1 },
    samples: [S.bubble.file],
    play(a, out, p, kit) {
      // Hybrid: a recorded pop retuned to G5 with a soft sine bloop on G5 under it, a touch longer.
      const n = p.index % S.bubble.takes.length
      bloop(a, out, p.at + 0.002, { freq: NOTE.G5 * p.rate, gain: p.gain * 0.12, sweep: 0.5, tau: 0.028, attack: 0.006 })
      if (sample(a, out, kit.sample(S.bubble.file), p.at, S.bubble.takes[n], { gain: p.gain * 0.8, rate: POP_TO_G5[n] * p.rate, top: 3200 })) return
      bloop(a, out, p.at, { freq: NOTE.G5 * p.rate, gain: p.gain * 0.73 })
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
        const t = p.at + i * step + (i ? 0.012 * (p.random() - 0.5) : 0)
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
  'pad-up': padUp, 'pad-down': padDown, writing, sketch, sent, routed, unrouted,
  ghost, placed, kept, undone, failed,
  'book-open': bookOpen, 'book-close': bookClose, page, sat, farewell, news, walk, refused,
}

/**
 * The owner's picks from the listening room, the default for every visit. The player falls back
 * to 'a' for a cue not named here; the page's stored picks and `?sfx=` still win over these.
 */
// Round 1 (Nov 7) and round 2 (Nov 8) picks. pad-up keeps its softened 'a'.
export const CHOSEN: Partial<Record<CueName, string>> = { chose: 'b', card: 'c', sent: 'b', placed: 'a', page: 'b', news: 'a', hover: 'e', farewell: 'c', turned: 'b', 'pad-down': 'b' }

/** One line per variant for the listening page. */
export const DESCRIPTIONS: Record<CueName, Record<string, string>> = {
  hover: {
    a: 'Round 1: a breath of felt and the faintest kalimba G, under 60 ms; rate-limited to one per 120 ms.',
    d: 'A felt-wrapped wooden tap: a real wooden click (six takes), cut to 60 ms with its top rolled off, so it is a soft "tok".',
    e: 'A breathy felt "pff" tuned to G, with a faint pitched body under it.',
    f: 'A fingertip on a small glass: a pure tone that blooms and fades, stepping G, E, A as you point at things.',
  },
  chose: {
    a: 'Wooden tock with a small kalimba G (A every third play).',
    b: 'Recorded: a wooden click (six takes) and a real kalimba G, short.',
    c: 'Soft-mallet marimba C, a tuned bar with a breath of felt.',
  },
  backed: { a: 'A lower, duller tock and a kalimba C that sags a few cents: chose in reverse.' },
  glide: { a: 'Air that swells and fades with the camera move; silent when the move is instant.' },
  turned: {
    a: 'Softer: two cloth rustles, 3 dB down from round 1, lower and rounder, swelling more slowly.',
    b: 'Much softer: 7 dB down from round 1, darker still and slower; barely there.',
  },
  card: {
    a: 'A paper flick; a later page is higher and shorter.',
    b: 'Hybrid: a recorded sheet sliding (three takes), with a quiet synthesized glass E on a new reply.',
    c: 'A quick rising "fwip" of a card sliding in.',
  },
  'pad-up': {
    a: 'Softer: the paper slide that brightens as the pad rises, 3 dB down from round 1, duller and with a later swell.',
    b: 'Much softer: 7 dB down from round 1, a dull short slide that swells late.',
  },
  'pad-down': {
    a: 'Softer: the darkening slide that settles on felt, 3 dB down from round 1, duller and gentler.',
    b: 'Much softer: 7 dB down from round 1, a dull slide and a lighter felt landing.',
  },
  writing: { a: 'Pencil grains, at most one per 75 ms, overlapping into one scratch while typing; deleting is a softer rub.' },
  sketch: { a: 'Pencil drawing: grains at most every 75 ms while the pen moves; the rubber, an undo or a clear is a softer, broader rub.' },
  sent: {
    a: 'Tear, a paper flutter across the flight, and a soft paper tap on landing.',
    b: 'Recorded: a real paper tear (four takes) and a sheet waved through the air (three takes), landing on felt.',
    c: 'Tear, then a kalimba run C-E-G across the flight landing on high C.',
  },
  routed: { a: 'Kalimba G then C, a fourth up: found its place.' },
  unrouted: { a: 'Marimba E stepping down to D: a thoughtful "hm", not an error.' },
  ghost: { a: 'Three slow-blooming, trembling glass tones (E G A).' },
  placed: {
    a: 'Felt thump and a two-note music-box sparkle.',
    b: 'Hybrid: a recorded cushion impact (five takes) and the synthesized music-box sparkle.',
    c: 'A low wooden set-down with a glass E ringing over it.',
  },
  kept: { a: 'Kalimba C E G rolled quickly, the G left ringing: a small reward.' },
  undone: { a: 'A breath drawn in and a kalimba G that swells instead of striking.' },
  failed: { a: 'A felt bump and a marimba E falling gently to C.' },
  'book-open': { a: 'The cover lifts off felt and the pages breathe open.' },
  'book-close': { a: 'Pages fold in with a swish and the cover meets them with a soft clap.' },
  page: {
    a: 'A leaf turning; several leaves riffle over the turn.',
    b: 'Recorded: a real page turn (its flip); a riffle adds short slices of it.',
    c: 'A heavy, soft page: lower and slower, more air than paper.',
  },
  sat: { a: 'Cushioned chair as the hop lands: a round bump, a "pff" of air and a small wood creak.' },
  farewell: {
    a: 'Round 1: two soft cushion lifts, then a kalimba E falling to C.',
    b: 'Chairs pushed back: two recorded wooden-chair lifts (a sit, played backwards), one after the other, and a cloth rustle.',
    c: 'Getting up and going: one recorded chair lift, then three sock steps on wood that fade and darken as they leave.',
    d: 'Synthesized foley: two cushions breathing out as people rise, a cloth rustle and two soft felt steps away.',
  },
  news: {
    a: 'Kalimba G then high C, the second left ringing.',
    b: 'Recorded: a real music-box note, retuned, played as G then high C.',
    c: 'Marimba E-E then A with a ghost shimmer.',
    d: 'A, rounder: the same kalimba G then high C with a slower strike, nothing above 2 kHz, less room, 2 dB quieter.',
    e: 'A, an octave lower with a felt mallet: G then C, warmer and rounder, less room, 2 dB quieter.',
    f: 'Recorded: one small bubble pop, a different one of four each time, its top rolled off.',
    g: 'Recorded, bigger: the same four bubble pops played slower, so they are deeper and rounder.',
    h: 'Synthesized: a soft "bloop" that rises to G, with a faint smaller bubble just after it.',
    i: 'Hybrid: a recorded bubble pop tuned to G with a soft synthesized bloop under it.',
  },
  walk: { a: 'Soft felt steps on the music\'s eighth notes: two to five leaving, two arriving.' },
  refused: { a: 'Two soft wooden knocks and a small latch rattle at the closed door.' },
}

/** Third-party samples the palette plays, for the in-app credit. */
export const SAMPLE_CREDITS: { title: string; author: string; source: string; licence: string; licenceUrl: string }[] = [
  ['Wooden clicks.wav', 'Anzbot', 'https://freesound.org/s/565027/'],
  ['G4 soft - kalimba', 'hollandm', 'https://freesound.org/s/691805/'],
  ['Hand Crank Music Box [G5 Note]', 'moodyfingers', 'https://freesound.org/s/732943/'],
  ['Tearing paper - 5', 'Valerie-Vivegnis', 'https://freesound.org/s/759322/'],
  ['Waving Paper in the Air.wav', 'krnash', 'https://freesound.org/s/389809/'],
  ['Paper sheets (sliding).wav', 'Pipelenisf', 'https://freesound.org/s/560352/'],
  ['Cushion Impacts.wav', 'mincedbeats', 'https://freesound.org/s/593948/'],
  ['Page Turn', 'davidbain', 'https://freesound.org/s/136778/'],
  ['18-sentandose silla de madera.wav', 'Tomycatts', 'https://freesound.org/s/429327/'],
  ['01-32 Footsteps, Wood, Socks, Slow Pace.wav', 'SpliceSound', 'https://freesound.org/s/369837/'],
  ['Bubble_4', 'BenParamoreAudio', 'https://freesound.org/s/868712/'],
  ['Bubble_Pop', 'arttim', 'https://freesound.org/s/733264/'],
  ['BubblePopping', 'Sess8it', 'https://freesound.org/s/762781/'],
  ['pop out, bubble, soft bursting', 'chaferwitt', 'https://freesound.org/s/776443/'],
].map(([title, author, source]) => ({ title, author, source, licence: 'CC0 1.0', licenceUrl: 'https://creativecommons.org/publicdomain/zero/1.0/' }))
