// Plays cues (#52). Framework-free and on any BaseAudioContext, so plugins/sound.ts plays
// it live and the checks render the very same thing offline.
//
// One play: the cue's variant (a pick, else the palette's CHOSEN one, else 'a'), a seeded random, the cue's level
// with volume and pitch jitter, a round-robin index, and a StereoPannerNode into the
// cue's bus. Scheduled at currentTime + LEAD rounded to a whole sample, with no awaits
// between the event and `start`.
import type { BusName, Cue, CueName, Kit, Palette, Play } from './contract'
import { busFor, mixFor } from '../voice/buses'
import { CHOSEN } from './palette'
import { roomSend } from './palette/synth'

/** Seconds from the event to the first sample: enough for the render quantum, under 20 ms with the context's latency. */
const LEAD = 0.004
/** Plays kept in `log` (for recordings and latency); older ones drop off. */
const LOG_MAX = 500

export interface Logged { cue: CueName; variant: string; bus: BusName; at: number; contextTime: number; pan: number }
export interface PlayOptions {
  variant?: string
  /** -1 to 1; the caller clamps it. */
  pan?: number
  /** The event's `seconds`, when it has one. */
  seconds?: number
  event?: Record<string, unknown>
  /** Context time to start at; defaults to now + LEAD. */
  at?: number
}

/** mulberry32: small, fast and seedable. */
export function seeded(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const hash = (s: string) => {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619)
  return h >>> 0
}

export class Player {
  readonly log: Logged[] = []
  readonly kit: Kit
  private samples = new Map<string, AudioBuffer>()
  private index = new Map<CueName, number>()
  private last = new Map<CueName, number>()
  private plays = 0
  private loading: Promise<void> | null = null

  constructor(readonly audio: BaseAudioContext, readonly palette: Palette, readonly seed = 1, public picks: Partial<Record<CueName, string>> = {}) {
    mixFor(audio)
    roomSend(audio)
    const noise = new AudioBuffer({ length: audio.sampleRate, sampleRate: audio.sampleRate, numberOfChannels: 1 })
    const rand = seeded(hash('village sfx noise'))
    const data = noise.getChannelData(0)
    for (let i = 0; i < data.length; i++) data[i] = rand() * 2 - 1
    this.kit = { noise, sample: (name) => this.samples.get(name) }
  }

  /** The variant a play uses: the first that exists of asked for, picked, the palette's CHOSEN one, and 'a'. */
  variant(name: CueName, asked?: string): string {
    const variants = this.palette[name]
    return [asked, this.picks[name], CHOSEN[name]].find((v) => v !== undefined && Object.hasOwn(variants, v)) ?? 'a'
  }

  /** Every sample file the palette names. */
  sampleNames(): string[] {
    const names = new Set<string>()
    for (const variants of Object.values(this.palette)) for (const cue of Object.values(variants) as Cue[]) for (const s of cue.samples ?? []) names.add(s)
    return [...names]
  }

  /**
   * Fetch and decode every sample (after the first gesture, never on first play). Resolves
   * after the first attempt: a sample that failed plays its synthesized stand-in. Only a
   * network failure (a dropped connection on a phone) is tried again, after 2 and 8 s, in the
   * background; a missing or broken file is not. Retries stop once the context has closed.
   */
  load(base: string): Promise<void> {
    const once = async (name: string) => {
      const response = await fetch(`${base}${name}`)
      if (!response.ok) throw new Error(`${response.status}`)
      this.samples.set(name, await this.audio.decodeAudioData(await response.arrayBuffer()))
    }
    const retry = async (name: string) => {
      for (const wait of [2000, 8000]) {
        await new Promise((r) => setTimeout(r, wait))
        if ((this.audio as AudioContext).state === 'closed') return
        try {
          return await once(name)
        } catch {
          // Still offline: try once more, then give up quietly.
        }
      }
    }
    this.loading ??= Promise.all(
      this.sampleNames().map(async (name) => {
        try {
          await once(name)
        } catch (error) {
          console.warn(`sound: could not load ${name}`, error)
          // fetch() rejects with a TypeError only when the network failed.
          if (error instanceof TypeError) void retry(name)
        }
      }),
    ).then(() => undefined)
    return this.loading
  }

  /** Play a cue now (or at `o.at`). Returns what was played, or null when its gap dropped it. */
  play(name: CueName, o: PlayOptions = {}): Logged | null {
    const variant = this.variant(name, o.variant)
    const cue = this.palette[name][variant]
    const a = this.audio
    const sr = a.sampleRate
    const at = Math.round((o.at ?? a.currentTime + LEAD) * sr) / sr
    const previous = this.last.get(name)
    if (cue.gap && previous !== undefined && at - previous < cue.gap) return null
    this.last.set(name, at)
    const random = seeded(hash(`${name}:${variant}`) ^ Math.imul(this.seed, 2654435761) ^ this.plays++)
    const cents = cue.jitter?.cents ?? 0
    const db = cue.jitter?.db ?? 0
    const gainDb = cue.level + (random() * 2 - 1) * db
    const rate = 2 ** (((random() * 2 - 1) * cents) / 1200)
    const index = this.index.get(name) ?? 0
    this.index.set(name, index + 1)
    const pan = Math.max(-1, Math.min(1, o.pan ?? 0))
    const out = new StereoPannerNode(a, { pan })
    out.connect(busFor(a, cue.bus))
    const p: Play = { at, pan, gain: 10 ** (gainDb / 20), rate, index, random, seconds: o.seconds ?? NaN, event: o.event ?? {} }
    cue.play(a, out, p, this.kit)
    const logged: Logged = { cue: name, variant, bus: cue.bus, at, contextTime: a.currentTime, pan }
    this.log.push(logged)
    if (this.log.length > LOG_MAX) this.log.splice(0, this.log.length - LOG_MAX)
    return logged
  }
}

export interface OfflinePlay extends PlayOptions { cue: CueName; t: number }

/**
 * Render plays offline through the same bus, master and limiter chain, at 48 kHz stereo.
 * `solo` keeps one bus and silences the others, for per-bus loudness (the shared room's tail
 * joins at the master, so it stays in every solo). `pre` taps the master before the limiter,
 * so a check can see a level the limiter would hide.
 */
export async function renderOffline(palette: Palette, plays: OfflinePlay[], seconds: number, seed = 1, opts: { solo?: BusName; base?: string; pre?: boolean } = {}) {
  const off = new OfflineAudioContext(2, Math.ceil(seconds * 48000), 48000)
  const player = new Player(off, palette, seed)
  const mix = mixFor(off)
  mix.setMuted(false, 0)
  if (opts.pre) {
    mix.output.disconnect()
    mix.master.connect(off.destination)
  }
  if (opts.solo) for (const [name, bus] of Object.entries(mix.buses)) bus.gain.value = name === opts.solo ? 1 : 0
  if (opts.base) await player.load(opts.base)
  for (const p of plays) player.play(p.cue, { ...p, at: p.t })
  const t0 = performance.now()
  const buffer = await off.startRendering()
  return { channels: [buffer.getChannelData(0), buffer.getChannelData(1)], ms: performance.now() - t0, log: player.log }
}
