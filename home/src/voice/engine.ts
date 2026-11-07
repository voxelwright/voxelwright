// The babble synthesizer (#42): every sound is made here in code, nothing is sampled.
// A syllable is a soft glottal-like tone through three formant band-passes, a
// little breath noise, and a short noise burst for its consonant. It works on any
// BaseAudioContext, so scripts/check-babble.mjs renders the same graph offline.
import { NEUTRAL, VOICES, voiceKey, type VoiceProfile } from './profiles'
import { planWord, seeded, type Note, type Vowel } from './text'

/** One revealed word, as talk.ts announces it with `village/said`. */
export interface Said { villager: string; word: string; index: number; last: boolean }

/** Formant centres (Hz) and relative levels, near adult averages; each voice scales them. */
const FORMANTS: Record<Vowel, [number, number, number]> = {
  a: [800, 1250, 2700],
  e: [560, 1900, 2600],
  i: [320, 2300, 3000],
  o: [540, 920, 2500],
  u: [360, 900, 2300],
}
const LEVELS = [1, 0.55, 0.22]
const BANDWIDTH = [90, 120, 170]
/** Start this far after "now", so a word heard at once is never clipped by the render quantum. */
const LEAD = 0.006
/** A voice more than this far behind its text skips words until it catches up (the last word always sounds). */
const MAX_LAG = 0.3
/** How quickly a stop fades the voice out, in seconds. */
const STOP_FADE = 0.012
/** Master level: quiet, under the room. scripts/check-babble.mjs measures the result. */
export const LEVEL = 0.12

/** Soft envelope shared by every blip: a raised-cosine attack, a gentle decay and a rounded release. */
const ENVELOPE = (() => {
  const n = 64
  const env = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const u = i / (n - 1)
    if (u < 0.12) env[i] = 0.5 - 0.5 * Math.cos((Math.PI * u) / 0.12)
    else if (u < 0.75) env[i] = 0.55 + 0.45 * Math.exp(-(u - 0.12) * 5)
    else env[i] = (0.55 + 0.45 * Math.exp(-0.63 * 5)) * (0.5 + 0.5 * Math.cos((Math.PI * (u - 0.75)) / 0.25))
  }
  env[n - 1] = 0
  return env
})()

/** A short burst for consonants: fast attack, quick fall. */
const BURST = (() => {
  const n = 32
  const env = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const u = i / (n - 1)
    env[i] = u < 0.15 ? u / 0.15 : (1 - u) ** 2 / 0.7225
  }
  env[n - 1] = 0
  return env
})()

interface Bus { gain: GainNode; speaker: string }

/**
 * Speaks revealed words in a villager's voice. One speaker at a time: a word
 * from someone else fades the previous speaker out. `output` sets the voices' level
 * and connects to `destination`: the voices bus (voice/buses.ts), which owns mute
 * and the limiter.
 */
export class Babbler {
  readonly output: GainNode
  private noiseBuffer: AudioBuffer
  private waves = new Map<number, PeriodicWave>()
  private bus: Bus | null = null
  private speaker: string | null = null
  private cursor = 0
  private position = new Map<string, number>()
  private live = new Set<AudioScheduledSourceNode>()
  private warned = new Set<string>()

  constructor(readonly ctx: BaseAudioContext, destination: AudioNode, opts: { level?: number } = {}) {
    this.output = new GainNode(ctx, { gain: opts.level ?? LEVEL })
    this.output.connect(destination)
    const rand = seeded('village babble noise')
    this.noiseBuffer = new AudioBuffer({ length: ctx.sampleRate, sampleRate: ctx.sampleRate, numberOfChannels: 1 })
    const data = this.noiseBuffer.getChannelData(0)
    for (let i = 0; i < data.length; i++) data[i] = rand() * 2 - 1
  }

  /** Sources scheduled or sounding right now. */
  get active(): number {
    return this.live.size
  }

  /** Live sources per speaker: only the current speaker should have any once a stop has faded. */
  liveBySpeaker(): Record<string, number> {
    const out: Record<string, number> = {}
    for (const s of this.live) {
      const { speaker } = (s as unknown as { bus: Bus }).bus
      out[speaker] = (out[speaker] ?? 0) + 1
    }
    return out
  }

  /** Who is speaking, by voice key (or the raw name for an unknown villager). */
  get speaking(): string | null {
    return this.speaker
  }

  /**
   * Schedule one revealed word, heard at `at` (the context's clock). Returns the
   * time its first blip starts, or null when it is silent (punctuation only, an
   * unknown word shape, or skipped to catch up with the text).
   */
  said(e: Said, at = this.ctx.currentTime): number | null {
    const key = voiceKey(e.villager)
    if (!key && !this.warned.has(e.villager)) {
      this.warned.add(e.villager)
      console.warn(`babble: no voice for "${e.villager}", using a neutral one`)
    }
    const name = key ?? e.villager
    const voice: VoiceProfile = key ? VOICES[key] : NEUTRAL
    if (this.speaker !== name) {
      this.stop(at)
      this.speaker = name
    }
    if (e.index === 0) this.position.set(name, 0)
    const position = this.position.get(name) ?? 0
    const plan = planWord(e.word, voice, position)
    this.position.set(name, plan.mark && plan.mark !== 'pause' ? 0 : position + 1)
    const start = this.sample(Math.max(at + LEAD, this.cursor))
    if (!plan.notes.length) {
      this.cursor = Math.max(this.cursor, at) + plan.length
      return null
    }
    if (start - at > MAX_LAG && !e.last) return null
    this.cursor = start + plan.length
    if (!this.bus) {
      const gain = new GainNode(this.ctx, { gain: 1 })
      gain.connect(this.output)
      this.bus = { gain, speaker: name }
    }
    for (const note of plan.notes) this.blip(note, voice, start + this.sample(note.at), this.bus)
    return start
  }

  /** Fade the current speaker out from `at` and cancel everything it still had to say. */
  stop(at = this.ctx.currentTime): void {
    const bus = this.bus
    this.bus = null
    this.speaker = null
    this.cursor = 0
    if (!bus) return
    bus.gain.gain.cancelScheduledValues(at)
    bus.gain.gain.setValueAtTime(1, at)
    bus.gain.gain.linearRampToValueAtTime(0, at + STOP_FADE)
    for (const s of this.live) if ((s as unknown as { bus: Bus }).bus === bus) s.stop(at + STOP_FADE + 0.004)
  }

  /** Stop at once and disconnect. The context is the caller's to close. */
  dispose(): void {
    const now = this.ctx.currentTime
    this.stop(now)
    for (const s of this.live) s.stop(now)
    this.output.disconnect()
  }

  private wave(tilt: number): PeriodicWave {
    let wave = this.waves.get(tilt)
    if (!wave) {
      // A glottal-like source: every harmonic, falling off by 1/n^tilt. No square-wave odd-only buzz.
      const n = 40
      const real = new Float32Array(n)
      const imag = new Float32Array(n)
      for (let k = 1; k < n; k++) imag[k] = 1 / k ** tilt
      wave = new PeriodicWave(this.ctx, { real, imag })
      this.waves.set(tilt, wave)
    }
    return wave
  }

  // Finished nodes are not disconnected by hand: a stopped source and the filters
  // after it are collected once their tails have rung out (Web Audio's node
  // lifetime rules), and a disconnect from onended would cut a tail at a moment
  // that varies run to run, so the same word would not render the same.
  private track(source: AudioScheduledSourceNode, bus: Bus) {
    ;(source as unknown as { bus: Bus }).bus = bus
    this.live.add(source)
    source.onended = () => this.live.delete(source)
  }

  /**
   * Round a time to a whole sample. Sources start with sub-sample accuracy, so
   * without this a word's syllables land on a different fraction of a sample
   * each time and the same word comes out slightly different.
   */
  private sample(seconds: number): number {
    return Math.round(seconds * this.ctx.sampleRate) / this.ctx.sampleRate
  }

  private blip(note: Note, voice: VoiceProfile, t: number, bus: Bus) {
    const { ctx } = this
    const dur = this.sample(note.dur)
    const out = new GainNode(ctx, { gain: note.gain * voice.gain })
    out.connect(bus.gain)

    // Voiced part: tone and breath share one envelope and one set of formants.
    const mix = new GainNode(ctx, { gain: 0 })
    mix.gain.setValueCurveAtTime(ENVELOPE, t, dur)
    const osc = new OscillatorNode(ctx, { periodicWave: this.wave(voice.tilt) })
    osc.frequency.setValueCurveAtTime(note.pitch, t, dur)
    osc.connect(mix)
    if (voice.breath > 0) {
      const breath = new AudioBufferSourceNode(ctx, { buffer: this.noiseBuffer, loop: true })
      const level = new GainNode(ctx, { gain: voice.breath })
      breath.connect(level).connect(mix)
      breath.start(t, note.noise * 0.9)
      breath.stop(t + dur)
      this.track(breath, bus)
    }
    const formants = FORMANTS[note.vowel]
    formants.forEach((f, i) => {
      const freq = f * voice.formant
      const band = new BiquadFilterNode(ctx, { type: 'bandpass', frequency: freq, Q: freq / (BANDWIDTH[i] * voice.formant) })
      // Band-passes keep only a sliver of the source; this restores speaking level.
      const level = new GainNode(ctx, { gain: LEVELS[i] * 3.2 })
      mix.connect(band).connect(level).connect(out)
    })
    // A little of the source below the first formant gives the felt its body.
    const body = new BiquadFilterNode(ctx, { type: 'lowpass', frequency: 700 * voice.formant, Q: 0.5 })
    const bodyLevel = new GainNode(ctx, { gain: 0.18 })
    mix.connect(body).connect(bodyLevel).connect(out)
    osc.start(t)
    osc.stop(t + dur)
    this.track(osc, bus)

    if (note.onset) {
      const o = note.onset
      const src = new AudioBufferSourceNode(ctx, { buffer: this.noiseBuffer, loop: true })
      const band = new BiquadFilterNode(ctx, { type: 'bandpass', frequency: Math.min(o.freq, ctx.sampleRate * 0.45), Q: o.q })
      const env = new GainNode(ctx, { gain: 0 })
      env.gain.setValueCurveAtTime(BURST.map((v) => v * o.gain), t, this.sample(o.dur))
      src.connect(band).connect(env).connect(out)
      src.start(t, (note.noise * 0.9 + 0.05) % 0.95)
      src.stop(t + this.sample(o.dur))
      this.track(src, bus)
    }
  }
}
