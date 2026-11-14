// The conductor (#247): keeps the music going for the place the ears are in. It asks for sections ahead of time
// (they are composed on another thread), plays them on the audio clock a third of a second ahead, brings a piece in
// a layer at a time, and when the place changes hands over at the next bar line: the old music stops being struck
// and rings out while the new comes in under it. Every mood is in D, so the handover is a change of colour.
//
// It never repeats a piece: each is composed from a new number. Within a piece the drums and chords hold and the
// melodies are found again for every section, scored on coming back to the piece's own figure. Calm places are
// silent between pieces for most of a minute or two, so that the place is heard.
import { BUS, type Sound } from '../sound.ts'
import { arc, resolve, type Section } from './compose.ts'
import { length, perform, stepTime } from './perform.ts'
import type { Line } from './rules.ts'
import type { Want } from './worker.ts'

/** Seconds ahead that notes are given to the synthesiser. */
const AHEAD = 0.35
/** Seconds a new place must hold before the music follows it (danger does not wait). */
const SETTLE = 4

interface Piece { mood: string; seed: number; sections: Section[]; from: number; layers: number[]; figure?: Line; asked: number; done: number; ends: number; /** Up to when its notes have been given. */ given?: number }

export function conductor(voice: Sound, seed = (Math.random() * 2 ** 31) | 0) {
  const worker = new Worker('/page/sound/music/worker.ts', { type: 'module' })
  const waiting = new Map<number, (s: Section) => void>()
  let asks = 0
  worker.onmessage = (e: MessageEvent<{ id: number; section: Section }>) => { waiting.get(e.data.id)?.(e.data.section); waiting.delete(e.data.id) }
  const ask = (want: Omit<Want, 'id'>) => new Promise<Section>((done) => { const id = ++asks; waiting.set(id, done); worker.postMessage({ id, ...want } satisfies Want) })

  let wanted: string | null = null, since = 0, piece: Piece | null = null, next: Piece | null = null, quiet = 0, pieces = 0, on = true
  /** How much of the music is in, 0 to 1, when someone says (a realm's rule); null lets a piece come in and thin by itself. And whether pieces follow each other with no quiet between. */
  let drive: number | null = null, steady = false
  const layersOf = (p: Piece, index: number) => { if (drive === null) return p.layers[index]; const most = Math.max(...resolve(p.mood).voices.map((v) => v.layer)); return Math.max(1, Math.min(most, Math.round(1 + drive * (most - 1)))) }
  /** For whoever shows it: what is playing, and each section as it starts. */
  const state = { mood: null as string | null, section: null as Section | null, index: 0, layers: 0, composed: 0, ms: 0, onsection: null as null | ((s: Section, index: number, layers: number) => void) }

  /** A new piece of a mood, its first section asked for; it starts when that has come, no sooner than `at`. */
  const begin = (mood: string, at: number, takingOver = false): Piece => {
    const m = resolve(mood), p: Piece = { mood, seed: (seed + Math.imul(++pieces, 0x2545f491)) | 0, sections: [], from: at, layers: arc(m.sections, Math.max(...m.voices.map((v) => v.layer)), takingOver), asked: 0, done: 0, ends: Infinity }
    more(p)
    return p
  }
  /** Asks for a piece's next section. A place with no pulse is one section that goes round, its lines of unlike lengths drifting. */
  const more = (p: Piece) => {
    const m = resolve(p.mood), index = p.asked++
    if (m.voices.some((v) => v.bars && m.bars % v.bars) && index > 0) { p.sections[index] = p.sections[0]; return }
    void ask({ mood: p.mood, seed: p.seed + index, groove: p.seed + (index >> 1) * 7919, figure: p.figure }).then((s) => {
      p.sections[index] = s
      p.figure ??= s.parts.find((part) => part.line)?.line
      state.composed++; state.ms = s.ms
    })
  }

  return {
    state,
    /** The place the ears are in, by name (a mood of MOODS), or null for none; `now` hands over at the next beat. */
    want(mood: string | null, now = false) {
      const t = voice.context.currentTime
      if (mood !== wanted) { wanted = mood; since = now ? -Infinity : t }
    },
    /** How much of the music is in, 0 to 1 (null: a piece builds and thins by itself), and whether pieces follow with no quiet between. */
    set drive(v: number | null) { drive = v === null ? null : Math.min(1, Math.max(0, v)) },
    get drive() { return drive },
    set steady(v: boolean) { steady = v },
    /** Music on or off altogether. */
    set on(v: boolean) { on = v; if (!v) { piece = next = null; voice.hush(BUS.music); state.mood = null } },
    get on() { return on },
    /** Once a frame or so. */
    tick() {
      if (!on || !voice.running) return
      const t = voice.context.currentTime
      // The place has changed and held: the piece playing is told where to stop, and the new one where to start.
      if (wanted !== (next ?? piece)?.mood && t - since >= SETTLE) {
        if (piece) {
          const s = piece.sections[Math.min(piece.done, piece.sections.length - 1)], bar = s ? stepTime(s) * s.steps : 1, beat = s ? stepTime(s) * s.beat : 0.5, unit = since === -Infinity ? beat : bar
          piece.ends = piece.from + Math.ceil((t + 0.1 - piece.from) / unit) * unit
        }
        next = wanted ? begin(wanted, piece ? piece.ends : t + 0.2, !!piece) : null
        if (!piece) { piece = next; next = null }
        quiet = 0
      }
      if (!piece) {
        // Between pieces: quiet for a while, then another of the same place.
        if (wanted && t >= quiet && t - since >= SETTLE) piece = begin(wanted, t + 0.2)
        return
      }
      const m = resolve(piece.mood), s = piece.sections[piece.done]
      if (!s) { if (piece.done === 0) piece.from = Math.max(piece.from, t + 0.1); return }
      const len = length(s), start = piece.from + piece.done * len, steps = s.steps * s.bars, step = stepTime(s)
      if (state.section !== s && t + AHEAD >= start) { state.mood = piece.mood; state.section = s; state.index = piece.done; state.layers = layersOf(piece, piece.done); state.onsection?.(s, piece.done, state.layers) }
      // What falls between what was last given and a third of a second from now, but nothing past where the piece is to stop.
      const until = Math.min(t + AHEAD, piece.ends), given = piece.given ?? start
      if (until > given) {
        const a = Math.max(0, Math.ceil((given - start) / step - 1e-6)), b = Math.min(steps, Math.ceil((until - start) / step - 1e-6))
        state.layers = layersOf(piece, piece.done)
        for (const n of perform(s, piece.done * steps + a, piece.done * steps + b, state.layers)) {
          voice.play(n.patch, { bus: BUS.music, pitch: n.hz, force: n.force, dur: n.dur, when: Math.max(t + 0.005, piece.from + n.at), pan: n.pan, gain: n.gain, room: n.room })
        }
        piece.given = start + b * step
      }
      // The next section is asked for as this one starts, so it has all of this one's length to be found in.
      if (piece.asked === piece.done + 1 && piece.done + 1 < m.sections) more(piece)
      // Where there is no quiet between pieces (danger, making), the next piece is ready to start on this one's last bar line.
      if (piece.done === m.sections - 1 && (steady || m.gap[1] === 0) && wanted === piece.mood && !next) next = begin(piece.mood, piece.from + m.sections * len, true)
      const over = until >= piece.ends
      if (t + AHEAD >= start + len || over) {
        piece.done++
        piece.given = undefined
        if (piece.done >= m.sections || over) {
          // The piece is over: the next place's, if there is one waiting, or quiet for a while.
          const [lo, hi] = steady ? [0, 0] : m.gap
          quiet = t + len * 0.25 + lo + (hi - lo) * Math.random()
          piece = next; next = null
          if (!piece) state.mood = null
        }
      }
    },
  }
}
