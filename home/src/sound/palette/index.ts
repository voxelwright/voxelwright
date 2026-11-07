// STAND-IN palette (#52): one plain synthesized blip per cue, so the player, the map and the
// checks have something to play. The real palette replaces this file.
import type { BusName, Cue, CueName, Palette } from '../contract'

/** Raised-cosine attack over the first 15%, then a cosine fall to 0. */
const ENV = (() => {
  const n = 64
  const env = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const u = i / (n - 1)
    env[i] = u < 0.15 ? 0.5 - 0.5 * Math.cos((Math.PI * u) / 0.15) : 0.5 + 0.5 * Math.cos((Math.PI * (u - 0.15)) / 0.85)
  }
  env[n - 1] = 0
  return env
})()

/** A soft sine (`tone`) or band-passed noise (`air`) at `hz` for `length` seconds. */
function blip(bus: BusName, kind: 'tone' | 'air', hz: number, length: number, level: number, gap?: number): Record<string, Cue> {
  const cue: Cue = {
    bus,
    level,
    length,
    gap,
    jitter: { cents: 40, db: 1.5 },
    play(audio, out, p, kit) {
      const env = new GainNode(audio, { gain: 0 })
      env.gain.setValueCurveAtTime(ENV.map((v) => v * p.gain), p.at, length)
      env.connect(out)
      // Takes rotate between three nearby pitches, so no two plays in a row are alike.
      const f = hz * p.rate * [1, 1.06, 0.95][p.index % 3]
      if (kind === 'tone') {
        const osc = new OscillatorNode(audio, { type: 'sine', frequency: f })
        osc.connect(env)
        osc.start(p.at)
        osc.stop(p.at + length)
      } else {
        const noise = new AudioBufferSourceNode(audio, { buffer: kit.noise, loop: true })
        noise.connect(new BiquadFilterNode(audio, { type: 'bandpass', frequency: f, Q: 1.4 })).connect(env)
        noise.start(p.at, p.random() * 0.9)
        noise.stop(p.at + length)
      }
    },
  }
  return { a: cue }
}

export const PALETTE: Palette = {
  hover: blip('ui', 'tone', 1320, 0.05, -30, 0.08),
  chose: blip('ui', 'tone', 880, 0.09, -22),
  backed: blip('ui', 'tone', 660, 0.08, -24),
  glide: blip('world', 'air', 700, 0.4, -30, 0.3),
  turned: blip('world', 'tone', 520, 0.12, -26),
  card: blip('ui', 'air', 2400, 0.08, -26, 0.1),
  'pad-up': blip('ui', 'air', 1400, 0.18, -24),
  'pad-down': blip('ui', 'air', 1000, 0.16, -25),
  writing: blip('ui', 'air', 3200, 0.03, -32, 0.05),
  sent: blip('ui', 'air', 1800, 0.3, -22),
  routed: blip('ui', 'tone', 990, 0.14, -24),
  unrouted: blip('ui', 'tone', 330, 0.16, -24),
  ghost: blip('world', 'air', 2000, 0.25, -28),
  placed: blip('world', 'tone', 440, 0.14, -22),
  kept: blip('world', 'tone', 1175, 0.12, -24),
  undone: blip('world', 'tone', 392, 0.12, -25),
  failed: blip('world', 'tone', 262, 0.2, -24),
  'book-open': blip('ui', 'air', 900, 0.3, -24),
  'book-close': blip('ui', 'air', 600, 0.25, -24),
  page: blip('ui', 'air', 2600, 0.12, -27, 0.04),
  sat: blip('world', 'tone', 300, 0.1, -24),
  news: blip('world', 'tone', 1568, 0.12, -26),
  walk: blip('world', 'air', 500, 0.5, -28),
  refused: blip('ui', 'tone', 220, 0.12, -24),
} satisfies Record<CueName, Record<string, Cue>>
