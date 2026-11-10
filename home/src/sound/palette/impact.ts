// What two things sound like when they meet (#107, the physical half of #52), made from the
// materials' own facts (src/engine/materials.ts), not from a list of sounds: how hard a thing
// is sets how bright its strike is, how long it rings and how high; metal rings longest and
// with close, clangy modes; a big thing sounds lower than a small one; the softer of the two
// rounds the strike off (a felt ball on a steel pot is a dull bong, a spoon on it a clang);
// and the harder they meet, the louder and the brighter. Both things are heard: the plate's
// clack and the table's low knock under it. A material added at runtime sounds right with no
// line here.
import type { Shape } from '../../engine/core'
import { material } from '../../engine/materials'
import type { CueName, Kit, Play } from '../contract'
import { noise, room, snap, strike } from './synth'

/** What a thing of a material sounds like, from its facts. */
export interface Voice {
  /** 0 to 1, the material's. */
  hard: number
  /** Seconds its main mode rings in a hand-sized piece. */
  ring: number
  /** Hz of its main mode in a piece 12 cm across. */
  pitch: number
  /** Its modes as multiples of the main one. */
  modes: readonly number[]
}

const METAL = [1, 1.58, 2.71, 3.93, 5.2, 6.8]
const GLAZED = [1, 2.32, 4.25, 6.63]
const WOODEN = [1, 2.76, 5.4]
const SOFT = [1]

export function voiceOf(name: string): Voice {
  const m = material(name)
  const hard = m?.hardness ?? 0.5
  const metal = m ? m.look.metalness >= 0.5 || m.density > 6000 : false
  const ring = metal ? 0.5 + 0.5 * hard : hard >= 0.9 ? 0.45 : hard >= 0.8 ? 0.16 : 0.012 + 0.08 * hard
  return { hard, ring, pitch: (150 + 1900 * hard ** 2.2) * (metal ? 0.6 : 1), modes: metal ? METAL : hard >= 0.8 ? GLAZED : hard >= 0.4 ? WOODEN : SOFT }
}

/** How big a thing is for its sound: its longest half size, m. */
export const reach = (s: Shape | undefined): number =>
  !s ? 0.06 : s.kind === 'sphere' ? s.radius : s.kind === 'box' ? Math.max(...s.half) : s.kind === 'compound' ? Math.max(...s.boxes.map((b) => Math.max(...b.half))) : Math.max(s.radius, s.halfHeight)

/** An impact as the sound needs it; an event's fields, each optional so a cue can be played alone. */
export interface Struck { materials?: [string, string]; shapes?: [Shape, Shape]; impulse?: number; impact?: number }

/** 0 to 1 from an impulse in N·s: a set-down mug is about 0.2, a thrown kettle 0.9. */
export const loudness = (impulse: number) => Math.min(1, 1.05 * (impulse / (impulse + 0.5)) ** 0.7)

/** The two things of an impact, the smaller (the one mostly heard) first. */
function sides(e: Struck) {
  const [ma, mb] = e.materials ?? ['maple', 'walnut']
  const a = { voice: voiceOf(ma), reach: reach(e.shapes?.[0]) }, b = { voice: voiceOf(mb), reach: reach(e.shapes?.[1] ?? { kind: 'box', half: [0.9, 0.03, 0.5] }) }
  return a.reach <= b.reach ? [a, b] : [b, a]
}

/** The cue an impact plays, by what the smaller thing is: each kind keeps its own gap, so a clack is never dropped for a thud. */
export function cueOf(e: Struck): CueName {
  const [{ voice }] = sides(e)
  return voice.ring >= 0.4 ? 'ring' : voice.ring >= 0.12 ? 'clack' : voice.hard >= 0.4 ? 'knock' : 'thud'
}

/** One mode: a sine struck and left to die away. */
function mode(a: BaseAudioContext, out: AudioNode, t: number, freq: number, gain: number, tau: number, drop = 0) {
  const attack = 0.0012
  const end = snap(a, t + attack + Math.min(1.5, tau * 7))
  const osc = new OscillatorNode(a, { frequency: freq })
  // A soft thing gives under the blow: its pitch falls as it dies.
  if (drop) osc.frequency.setTargetAtTime(freq * (1 - drop), t, tau * 1.5)
  const g = new GainNode(a, { gain: 0 })
  g.gain.setValueAtTime(0, t)
  g.gain.linearRampToValueAtTime(gain, t + attack)
  g.gain.setTargetAtTime(0, t + attack, tau)
  osc.connect(g).connect(out)
  osc.start(t)
  osc.stop(end)
}

export function playImpact(a: BaseAudioContext, out: AudioNode, p: Play, kit: Kit, fallback: Struck) {
  const e: Struck = { ...fallback, ...(p.event as Struck) }
  const t = snap(a, p.at)
  const loud = loudness(Math.max(0, (e.impulse ?? 0.15) * (e.impact ?? 1)))
  const [small, big] = sides(e)
  // The softer of the two is the hammer: it rounds off everything above `top` Hz, less so in a hard blow.
  const softer = Math.min(small.voice.hard, big.voice.hard)
  const top = 350 + 9000 * softer ** 1.6 * (0.35 + 0.65 * loud)
  // Two soft things, or anything against a person, never shout.
  const level = p.gain * loud * (0.45 + 0.55 * Math.max(small.voice.hard, softer * 2))
  const wet = room(a, out, 0.12 + 0.1 * small.voice.ring)
  for (const [side, weight] of [[small, 1], [big, big.voice.ring >= 0.12 ? 0.35 : 0.6]] as const) {
    const v = side.voice
    const f0 = Math.min(4200, Math.max(70, v.pitch * p.rate * (0.06 / Math.max(0.01, side.reach)) ** 0.75))
    const longer = Math.min(2.2, Math.max(0.6, (side.reach / 0.06) ** 0.35))
    v.modes.forEach((ratio, k) => {
      const f = f0 * ratio
      const amp = (1 / (k + 1) ** 1.1) / (1 + (f / top) ** 2)
      if (f > 9000 || amp < 0.02) return
      const tau = Math.min(0.22, Math.max(0.012, (v.ring * longer) / ratio ** 0.8))
      mode(a, wet, t, f, level * weight * amp, tau, v.hard < 0.4 ? 0.35 : 0)
    })
  }
  // The touch itself: a short breath of noise, shorter and brighter the harder the two are.
  const dur = 0.005 + 0.022 * (1 - softer)
  noise(a, out, kit, t, { dur, env: strike(dur, 0.0008, dur / 4), gain: level * (0.2 + 0.5 * softer), random: p.random, freq: Math.min(6000, top * 0.7), q: 0.9, top: top * 1.5 })
}
