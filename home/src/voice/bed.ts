// The music bed (#42): one looped recording under the villagers' voices. Like the
// Babbler it works on any BaseAudioContext, so scripts/check-music.mjs renders the
// same graph offline to measure its loudness, its ducking and the loop's seam.

/** Where the recording sits, as a gain: about -32 LUFS integrated (the file is -20.3 LUFS). scripts/check-music.mjs measures it. */
export const LEVEL = 0.26
/** How far the bed drops while a villager speaks, as a gain (-6 dB). */
export const DUCKED = 0.5
/** Seconds from the first sound to the full level. */
export const FADE_IN = 2
/** Time constants (s) of the duck going down and coming back, so neither is a jump. */
const DUCK_IN = 0.08
const DUCK_OUT = 0.25
/** Mute and unmute ramp, in seconds. */
const MUTE_RAMP = 0.1

/** Raised-cosine rise from 0 to 1: slower than a line at both ends, so the bed arrives without a push. */
const RISE = (() => {
  const n = 128
  const curve = new Float32Array(n)
  for (let i = 0; i < n; i++) curve[i] = 0.5 - 0.5 * Math.cos((Math.PI * i) / (n - 1))
  return curve
})()

/**
 * Source, then three gains in a row: `level` (the quiet bed and the fade-in), `duck`
 * (down while someone speaks) and `mute`, which is also the output to tap.
 */
export class Bed {
  readonly output: GainNode
  private source: AudioBufferSourceNode | null = null
  private level: GainNode
  private duckGain: GainNode
  private isMuted: boolean
  /** The context time the first sample was due to play, for finding the loop position later. */
  startedAt = NaN

  constructor(readonly ctx: BaseAudioContext, readonly buffer: AudioBuffer, destination: AudioNode = ctx.destination, opts: { muted?: boolean } = {}) {
    this.isMuted = Boolean(opts.muted)
    this.level = new GainNode(ctx, { gain: 0 })
    this.duckGain = new GainNode(ctx, { gain: 1 })
    this.output = new GainNode(ctx, { gain: this.isMuted ? 0 : 1 })
    this.level.connect(this.duckGain).connect(this.output).connect(destination)
  }

  /** Whether the loop is playing (or scheduled to). */
  get playing(): boolean {
    return this.source !== null
  }

  get muted(): boolean {
    return this.isMuted
  }

  /** How the source loops, for scripts/check-music.mjs; null before `start`. */
  get loop(): { loop: boolean; start: number; end: number } | null {
    return this.source && { loop: this.source.loop, start: this.source.loopStart, end: this.source.loopEnd }
  }

  /** The current duck gain: 1 is untouched, DUCKED is down. */
  get ducking(): number {
    return this.duckGain.gain.value
  }

  /**
   * Start the loop at `at` (the context's clock) and fade it in. The recording is
   * exactly eight bars, so the loop is the whole buffer, with no trimming at the seam.
   */
  start(at = this.ctx.currentTime, fade = FADE_IN): void {
    if (this.source) return
    const source = new AudioBufferSourceNode(this.ctx, { buffer: this.buffer, loop: true, loopStart: 0, loopEnd: this.buffer.duration })
    source.connect(this.level)
    source.start(at)
    this.source = source
    this.startedAt = at
    const g = this.level.gain
    g.setValueAtTime(0, at)
    if (fade > 0) g.setValueCurveAtTime(RISE.map((v) => v * LEVEL), at, fade)
    else g.setValueAtTime(LEVEL, at)
  }

  /** Duck for a speaker (true) or come back (false), exponentially from where the gain is now. */
  duck(on: boolean, at = this.ctx.currentTime): void {
    const g = this.duckGain.gain
    g.cancelScheduledValues(at)
    g.setValueAtTime(g.value, at)
    g.setTargetAtTime(on ? DUCKED : 1, at, on ? DUCK_IN : DUCK_OUT)
  }

  /** Mute or unmute with a short ramp, so neither clicks. */
  setMuted(muted: boolean, at = this.ctx.currentTime): void {
    this.isMuted = muted
    const g = this.output.gain
    g.cancelScheduledValues(at)
    g.setValueAtTime(g.value, at)
    g.linearRampToValueAtTime(muted ? 0 : 1, at + MUTE_RAMP)
  }

  /** Stop the loop and take the graph apart. */
  dispose(): void {
    const source = this.source
    this.source = null
    if (source) {
      try {
        source.stop()
      } catch {
        // Already stopped.
      }
      source.disconnect()
    }
    this.level.disconnect()
    this.duckGain.disconnect()
    this.output.disconnect()
  }
}
