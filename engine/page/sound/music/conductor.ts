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
import { perform, stepTime } from './perform.ts'
import type { Line } from './rules.ts'
import type { Want } from './worker.ts'

/** Seconds ahead that notes are given to the synthesiser. */
const AHEAD = 0.35
/** Seconds a new place must hold before the music follows it (danger does not wait). */
const SETTLE = 4

interface Piece { mood: string; seed: number; sections: Section[]; layers: number[]; figure?: Line; asked: number; done: number; /** The step of its section that is given next, and the moment that step falls. */ step: number; at: number; /** The step at which it is to stop, if it has been told to. */ stop: number | null }

export function conductor(voice: Sound, seed = (Math.random() * 2 ** 31) | 0) {
  // Beside this module, so that a static folder (#450) finds it as the page server does.
  const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })
  const waiting = new Map<number, (s: Section) => void>()
  let asks = 0
  worker.onmessage = (e: MessageEvent<{ id: number; section: Section }>) => { waiting.get(e.data.id)?.(e.data.section); waiting.delete(e.data.id) }
  const ask = (want: Omit<Want, 'id'>) => new Promise<Section>((done) => { const id = ++asks; waiting.set(id, done); worker.postMessage({ id, ...want } satisfies Want) })

  let wanted: string | null = null, since = 0, piece: Piece | null = null, next: Piece | null = null, quiet = 0, pieces = 0, on = true
  /** How much of the music is in, 0 to 1, when someone says (a realm's rule); null lets a piece come in and thin by itself. And whether pieces follow each other with no quiet between. */
  let drive: number | null = null, steady = false
  /** Beats a minute in place of the mood's own (0: its own). It is the pace of the piece playing, from its next step: nothing is composed again for it. */
  let pace = 0
  const layersOf = (p: Piece, index: number) => { if (drive === null) return p.layers[index]; const most = Math.max(...resolve(p.mood).voices.map((v) => v.layer)); return Math.max(1, Math.min(most, Math.round(1 + drive * (most - 1)))) }
  /** For whoever shows it: what is playing, and each section as it starts. */
  const state = { mood: null as string | null, section: null as Section | null, index: 0, layers: 0, pace: 0, composed: 0, ms: 0, onsection: null as null | ((s: Section, index: number, layers: number) => void) }

  /** A new piece of a mood, its first section asked for; it starts when that has come, no sooner than `at`. */
  const begin = (mood: string, at: number, takingOver = false): Piece => {
    const m = resolve(mood), p: Piece = { mood, seed: (seed + Math.imul(++pieces, 0x2545f491)) | 0, sections: [], layers: arc(m.sections, Math.max(...m.voices.map((v) => v.layer)), takingOver), asked: 0, done: 0, step: 0, at, stop: null }
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
    /** The place the ears are in, by name (a mood of MOODS), or null for none; `now` hands over at the next beat. `beats` a minute in place of the mood's own (0: its own) is taken up by the piece playing, from its next step. */
    want(mood: string | null, now = false, beats = 0) {
      const t = voice.context.currentTime
      if (mood !== wanted) { wanted = mood; since = now ? -Infinity : t }
      pace = beats
    },
    /** Cuts straight to a new mood (car radio station switch): hushes current music notes and begins the new groove after `delay` seconds. */
    cut(mood: string | null, delay = 0.09) {
      const t = voice.context.currentTime
      wanted = mood
      since = -Infinity
      quiet = 0
      pace = 0
      piece = null
      next = null
      voice.hush(BUS.music)
      if (!mood) { state.mood = null; return }
      if (on) piece = begin(mood, t + delay, true)
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
      // The place has changed and held: the piece playing is told at which step to stop (the next bar line, or the
      // next beat), and the new one is asked for. It starts on the very moment the old one stops.
      if (wanted !== (next ?? piece)?.mood && t - since >= SETTLE) {
        const s = piece?.sections[piece.done]
        if (piece && s) { const unit = since === -Infinity ? s.beat : s.steps; piece.stop = Math.ceil((piece.step + 1) / unit) * unit }
        next = wanted ? begin(wanted, t + 0.2, !!piece) : null
        if (!piece || !s) { piece = next; next = null }
        quiet = 0
      }
      if (!piece) {
        // Between pieces: quiet for a while, then another of the same place.
        if (wanted && t >= quiet && t - since >= SETTLE) piece = begin(wanted, t + 0.2)
        return
      }
      // A step at a time, a third of a second ahead: so the pace can change from one step to the next.
      for (let guard = 0; piece && piece.at < t + AHEAD && guard < 400; guard++) {
        const m = resolve(piece.mood), s: Section | undefined = piece.sections[piece.done]
        // Not composed yet: it starts when it has come.
        if (!s) { piece.at = Math.max(piece.at, t + 0.1); break }
        const steps = s.steps * s.bars
        if (piece.step >= steps || (piece.stop !== null && piece.step >= piece.stop)) {
          const stopped = piece.stop !== null && piece.step >= piece.stop
          piece.done++; piece.step = 0; piece.stop = null
          if (piece.done >= m.sections || stopped) {
            // The piece is over: the next, if one is waiting, starts on this very moment; or it is quiet for a while.
            const [lo, hi] = steady ? [0, 0] : m.gap
            quiet = t + lo + (hi - lo) * Math.random()
            if (next) next.at = Math.max(piece.at, t + 0.02)
            piece = next; next = null
            if (!piece) state.mood = null
          }
          continue
        }
        if (piece.at < t) piece.at = t + 0.02
        if (piece.step === 0) {
          state.mood = piece.mood; state.section = s; state.index = piece.done
          state.onsection?.(s, piece.done, layersOf(piece, piece.done))
          // The next section is asked for as this one starts, so it has all of this one's length to be found in.
          if (piece.asked === piece.done + 1 && piece.done + 1 < m.sections) more(piece)
          // Where there is no quiet between pieces, the next piece is asked for as this one's last section starts.
          if (piece.done === m.sections - 1 && (steady || m.gap[1] === 0) && wanted === piece.mood && !next) next = begin(piece.mood, piece.at, true)
        }
        // How long this step is at the pace asked for now, against the pace the section was written at.
        const own = stepTime(s), now = pace > 0 ? 60 / pace / s.beat : own, at = piece.done * steps + piece.step
        state.layers = layersOf(piece, piece.done); state.pace = pace > 0 ? pace : s.bpm
        for (const n of perform(s, at, at + 1, state.layers)) voice.play(n.patch, { bus: BUS.music, pitch: n.hz, force: n.force, dur: n.dur * (now / own), when: Math.max(t + 0.005, piece.at + (n.at - at * own) * (now / own)), pan: n.pan, gain: n.gain, room: n.room })
        piece.step++
        piece.at += now
      }
    },
  }
}
