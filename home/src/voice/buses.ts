// The mix (#52): every sound on a context goes through one of four buses, then the master
// (where mute lives) and one stateless soft limiter, then the destination.
//
//   ui ──────────────┐
//   world ───────────┤
//   voices ──────────┼─> master ─> limiter ─> destination
//   music ─> duck ───┘
//
// Built lazily, once per context, by the first caller, so no plugin depends on another's
// ready() order. Works on any BaseAudioContext, so the checks render the same chain offline.
import type { BusName } from '../sound/contract'

/** How far the music drops while a villager speaks, as a gain (-6 dB). */
export const DUCKED = 0.5
/** Time constants (s) of the duck going down and coming back, so neither is a jump. */
const DUCK_IN = 0.08
const DUCK_OUT = 0.25
/** Seconds after the last word before the music comes back. */
const HOLD = 0.6
/** Mute ramp, in seconds: short enough that a word 50 ms after `M` is already silent, long enough not to click. */
const MUTE_RAMP = 0.02

/** Linear to 0.6, then a tanh shoulder towards 0.89 (-1 dBFS); input beyond ±1 holds the end value. */
const SOFT_CLIP = (() => {
  const n = 4097
  const curve = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1
    const a = Math.abs(x)
    curve[i] = Math.sign(x) * (a <= 0.6 ? a : 0.6 + 0.29 * Math.tanh((a - 0.6) / 0.29))
  }
  return curve
})()

export interface Mix {
  readonly buses: Record<BusName, GainNode>
  /** The music after its duck: the point to tap for the music alone. */
  readonly ducked: GainNode
  readonly master: GainNode
  /**
   * A gentle limiter: transparent below -4.4 dBFS and never above -1 dBFS. Stateless, unlike
   * a DynamicsCompressorNode, whose adaptive release and make-up gain would make a sound
   * depend on what came before. The point to tap for everything.
   */
  readonly output: WaveShaperNode
  readonly muted: boolean
  /** The current duck gain: 1 is untouched, DUCKED is down. */
  readonly ducking: number
  setMuted(muted: boolean, at?: number): void
  /** Duck the music (true) or bring it back (false), exponentially from where the gain is now. */
  duck(on: boolean, at?: number): void
}

const mixes = new WeakMap<BaseAudioContext, Mix & { release?: ReturnType<typeof setTimeout> }>()

/** The context's mix, built on first use, unmuted (plugins/sound.ts applies the stored switch). */
export function mixFor(audio: BaseAudioContext): Mix {
  let mix = mixes.get(audio)
  if (mix) return mix
  let isMuted = false
  const master = new GainNode(audio, { gain: 1 })
  const output = new WaveShaperNode(audio, { curve: SOFT_CLIP })
  master.connect(output).connect(audio.destination)
  const ducked = new GainNode(audio, { gain: 1 })
  ducked.connect(master)
  const bus = () => new GainNode(audio, { gain: 1 })
  const buses: Record<BusName, GainNode> = { ui: bus(), world: bus(), voices: bus(), music: bus() }
  buses.ui.connect(master)
  buses.world.connect(master)
  buses.voices.connect(master)
  buses.music.connect(ducked)
  mix = {
    buses,
    ducked,
    master,
    output,
    get muted() {
      return isMuted
    },
    get ducking() {
      return ducked.gain.value
    },
    setMuted(muted, at = audio.currentTime) {
      isMuted = muted
      const g = master.gain
      g.cancelScheduledValues(at)
      g.setValueAtTime(g.value, at)
      g.linearRampToValueAtTime(muted ? 0 : 1, at + MUTE_RAMP)
    },
    duck(on, at = audio.currentTime) {
      const g = ducked.gain
      g.cancelScheduledValues(at)
      g.setValueAtTime(g.value, at)
      g.setTargetAtTime(on ? DUCKED : 1, at, on ? DUCK_IN : DUCK_OUT)
    },
  }
  mixes.set(audio, mix)
  return mix
}

/** One bus of the context's mix: what a Babbler, a Bed or a cue connects to. */
export const busFor = (audio: BaseAudioContext, name: BusName): GainNode => mixFor(audio).buses[name]

/**
 * A villager's word was just scheduled on the voices bus: duck the music now and bring it
 * back HOLD seconds after the last word (a comma's pause keeps it down).
 */
export function voicesSpoke(audio: BaseAudioContext): void {
  mixFor(audio).duck(true)
  voicesStopped(audio)
}

/** The voices stopped (a reply cut short, or the last word): bring the music back after HOLD. */
export function voicesStopped(audio: BaseAudioContext): void {
  const mix = mixes.get(audio)
  if (!mix) return
  clearTimeout(mix.release)
  mix.release = setTimeout(() => mix.duck(false), HOLD * 1000)
}
