// The rules music is scored by (#247). Each takes a candidate and says how well it does one named thing, from 0 to
// 1, and each says where the thing comes from and whether that source was read for this or is carried from memory
// (the skill `game-sound` has the list). Nothing here hears: a rule is a measurement of a pattern.
//
// After the reference the owner gave (Deedy Das, November 12, 2026: a model asked to make house tracks without
// hearing scores thousands of random patterns for each instrument against named rules with their sources and keeps
// the best). Its own page could not be read; these rules are ours, from the sources it cites and others.

/** A pattern of one bar or more: how loud each step is struck, 0 for a rest. */
export type Beat = number[]
/** A line: for each step a scale degree counted from the tonic of the lowest octave (0, 1, 2...), -1 for a rest, -2 for the note before still sounding. */
export type Line = number[]
/** What a candidate is judged against: the bar's shape, the harmony, the other voices. */
export interface Around {
  /** Steps in a bar, and in a beat. */
  steps: number; beat: number
  /** Semitones of the scale's degrees from its tonic. */
  scale: number[]
  /** Whether the scale's third is minor. */
  minor: boolean
  /** The chord of each bar, as scale degrees. */
  chords: number[][]
  /** The kick's pattern, for those that fit round it. */
  kick?: Beat
  /** How many onsets a bar wants, and how much of a line should be notes. */
  want: number
  /** The piece's own figure: where its notes fall, to be come back to. */
  motif?: Line
}
export interface Rule<T> { name: string; why: string; source: string; read: 'read' | 'from memory' | 'ours'; weight: number; score(c: T, a: Around): number }

const clamp = (v: number) => Math.max(0, Math.min(1, v))
const near = (v: number, want: number, spread: number) => Math.exp(-((v - want) ** 2) / (2 * spread * spread))
const onsets = (b: number[]) => b.reduce((n, v) => n + (v > 0 ? 1 : 0), 0)

/** The most even way to put k onsets in n steps: Bjorklund's algorithm gives the same necklace as this rounding. */
export function euclid(k: number, n: number): Beat {
  return Array.from({ length: n }, (_, i) => ((i * k) % n < k ? 1 : 0))
}
/** How strong each step of a bar is: 0 for the bar's first, -1 for its middle, and down by halves (Longuet-Higgins and Lee's weights). */
export function metre(steps: number, beat: number): number[] {
  return Array.from({ length: steps }, (_, i) => {
    if (i === 0) return 0
    if (steps % 2 === 0 && i === steps / 2) return -1
    if (i % beat === 0) return -2
    if (beat % 2 === 0 && i % (beat / 2) === 0) return -3
    return -4
  })
}
/** Syncopation after Longuet-Higgins and Lee: for each note on a weak step with a rest on the next stronger one, how much stronger. 0 to about 1. */
export function syncopation(b: Beat, steps: number, beat: number): number {
  const w = metre(steps, beat)
  let sum = 0
  for (let i = 0; i < b.length; i++) {
    if (!(b[i] > 0)) continue
    for (let j = 1; j < steps; j++) {
      const k = (i + j) % b.length
      if (w[k % steps] > w[i % steps]) { if (!(b[k] > 0)) sum += w[k % steps] - w[i % steps]; break }
      if (b[k] > 0) break
    }
  }
  return clamp(sum / (b.length / steps) / 12)
}

// ── Rhythm ────────────────────────────────────────────────────────────────
export const onTheFloor: Rule<Beat> = { name: 'four on the floor', why: 'a kick on every beat and nowhere else', source: 'Butler 2006, Unlocking the Groove, through Marshall’s review (Music Theory Spectrum 31)', read: 'read', weight: 3,
  score: (b, a) => { let good = 0; for (let i = 0; i < b.length; i++) if ((b[i] > 0) === (i % a.beat === 0)) good++; return good / b.length } }
export const fillsGaps: Rule<Beat> = { name: 'fills the gaps', why: 'sounds where the kick does not', source: 'the reference post (Das 2026); Butler 2006 on layers', read: 'read', weight: 2,
  score: (b, a) => { const n = onsets(b); if (!n || !a.kick) return 0; let clash = 0; for (let i = 0; i < b.length; i++) if (b[i] > 0 && a.kick[i % a.kick.length] > 0) clash++; return 1 - clash / n } }
export const amount: Rule<Beat> = { name: 'the right amount', why: 'about as many strokes a bar as the idiom has', source: 'the reference post (Das 2026)', read: 'read', weight: 2,
  score: (b, a) => near(onsets(b) / (b.length / a.steps), a.want, Math.max(1, a.want * 0.2)) }
export const even: Rule<Beat> = { name: 'evenly spread', why: 'as near as may be to the most even spread of that many strokes', source: 'Toussaint 2005, The Euclidean Algorithm Generates Traditional Musical Rhythms', read: 'read', weight: 2,
  score: (b) => {
    const at: number[] = []; b.forEach((v, i) => { if (v > 0) at.push(i) })
    if (at.length < 2) return at.length
    const ideal = b.length / at.length
    let off = 0
    for (let i = 0; i < at.length; i++) off += Math.abs(((at[(i + 1) % at.length] - at[i] + b.length) % b.length || b.length) - ideal)
    return clamp(1 - off / at.length / ideal)
  } }
export const repeats: Rule<Beat> = { name: 'repeats each half', why: 'the second half of the bar is the first again', source: 'the reference post (Das 2026)', read: 'read', weight: 1,
  score: (b) => { const h = b.length >> 1; let same = 0; for (let i = 0; i < h; i++) if ((b[i] > 0) === (b[i + h] > 0)) same++; return same / h } }
export const loudAndSoft: Rule<Beat> = { name: 'loud and soft', why: 'strokes on the beat are louder than those between, by a little', source: 'the reference post (Das 2026)', read: 'read', weight: 1,
  score: (b, a) => { let on = 0, n1 = 0, off = 0, n2 = 0; b.forEach((v, i) => { if (!(v > 0)) return; if (i % (a.beat / 2 || 1) === 0) { on += v; n1++ } else { off += v; n2++ } }); if (!n1 || !n2) return 0.3; return near(on / n1 - off / n2, 0.25, 0.15) } }
export const pushes: Rule<Beat> = { name: 'pushes a little', why: 'some syncopation, not none and not much: both are less liked', source: 'Witek et al. 2014, Syncopation, Body-Movement and Pleasure in Groove Music (PLOS ONE); the measure after Longuet-Higgins and Lee 1984', read: 'read', weight: 2,
  score: (b, a) => near(syncopation(b, a.steps, a.beat), 0.3, 0.15) }
export const backbeat: Rule<Beat> = { name: 'on two and four', why: 'a clap on the second and fourth beats', source: 'common practice; Butler 2006 on the backbeat in house', read: 'from memory', weight: 3,
  score: (b, a) => { let good = 0; for (let i = 0; i < b.length; i++) { const want = i % a.beat === 0 && (i / a.beat) % 2 === 1; if ((b[i] > 0) === want) good++ } return good / b.length } }
export const likeATradition: Rule<Beat> = { name: 'a rhythm people keep', why: 'a turn of one of the patterns Toussaint finds the world over (tresillo, cinquillo, the Venda clap)', source: 'Toussaint 2005', read: 'read', weight: 2,
  score: (b, a) => {
    const n = onsets(b.slice(0, a.steps)), e = euclid(n, a.steps)
    let best = 0
    for (let r = 0; r < a.steps; r++) { let same = 0; for (let i = 0; i < a.steps; i++) if ((b[i] > 0) === (e[(i + r) % a.steps] > 0)) same++; best = Math.max(best, same / a.steps) }
    return best
  } }

// ── Lines ─────────────────────────────────────────────────────────────────
/** Krumhansl and Kessler's key profiles: how well each of the twelve notes fits a major and a minor key, the tonic first. */
export const KK = { major: [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88], minor: [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17] }
/** The notes of a line, in order: degree, the step it starts on, how many steps it lasts. */
export function notes(l: Line): { degree: number; at: number; len: number }[] {
  const out: { degree: number; at: number; len: number }[] = []
  for (let i = 0; i < l.length; i++) { if (l[i] >= 0) out.push({ degree: l[i], at: i, len: 1 }); else if (l[i] === -2 && out.length && out[out.length - 1].at + out[out.length - 1].len === i) out[out.length - 1].len++ }
  return out
}
const semis = (degree: number, scale: number[]) => 12 * Math.floor(degree / scale.length) + scale[((degree % scale.length) + scale.length) % scale.length]

export const inKey: Rule<Line> = { name: 'sounds in its key', why: 'how long it spends on each note matches how well listeners say each fits the key', source: 'Krumhansl and Kessler 1982, the key profiles (values from rnhart.net/articles/key-finding)', read: 'read', weight: 2,
  score: (l, a) => {
    const h = new Array(12).fill(0), p = a.minor ? KK.minor : KK.major
    for (const n of notes(l)) h[((semis(n.degree, a.scale) % 12) + 12) % 12] += n.len
    const mh = h.reduce((x, y) => x + y, 0) / 12, mp = p.reduce((x, y) => x + y, 0) / 12
    let num = 0, d1 = 0, d2 = 0
    for (let i = 0; i < 12; i++) { num += (h[i] - mh) * (p[i] - mp); d1 += (h[i] - mh) ** 2; d2 += (p[i] - mp) ** 2 }
    return d1 ? clamp((num / Math.sqrt(d1 * d2) + 0.2) / 1.0) : 0
  } }
export const bySteps: Rule<Line> = { name: 'moves by step', why: 'six to nine moves in ten are to the next note of the scale: a line all leaps is not sung, and one with none is a scale', source: 'Huron 2001, Tone and Voice; the voice-leading rules as commonly given', read: 'from memory', weight: 2,
  score: (l) => { const n = notes(l); if (n.length < 2) return 0; let steps = 0; for (let i = 1; i < n.length; i++) if (Math.abs(n[i].degree - n[i - 1].degree) <= 1) steps++; const share = steps / (n.length - 1); return share < 0.6 ? share / 0.6 : share <= 0.9 ? 1 : 1 - (share - 0.9) * 2 } }
export const leapsTurnBack: Rule<Line> = { name: 'a leap turns back', why: 'after a jump the line comes back by step the other way', source: 'Narmour, Huron: post-skip reversal; the voice-leading rules as commonly given', read: 'from memory', weight: 1.5,
  score: (l) => { const n = notes(l); let leaps = 0, good = 0; for (let i = 1; i < n.length - 1; i++) { const d = n[i].degree - n[i - 1].degree; if (Math.abs(d) < 3) continue; leaps++; const back = n[i + 1].degree - n[i].degree; if (back * d < 0 && Math.abs(back) <= 2) good++ } return leaps ? good / leaps : 1 } }
export const oneSummit: Rule<Line> = { name: 'one summit', why: 'it rises to a highest note once, past its middle, and comes down', source: 'the melodic arch (Huron 1996); counterpoint teaching', read: 'from memory', weight: 1.5,
  score: (l) => { const n = notes(l); if (n.length < 3) return 0; const top = Math.max(...n.map((x) => x.degree)), tops = n.filter((x) => x.degree === top), where = tops[0].at / l.length; return (tops.length === 1 ? 1 : 0.5) * near(where, 0.6, 0.22) } }
export const keepsItsRange: Rule<Line> = { name: 'keeps to a voice', why: 'it spans about an octave, not three notes and not three octaves', source: 'Huron 2001 on tessitura', read: 'from memory', weight: 1,
  score: (l, a) => { const n = notes(l); if (!n.length) return 0; const span = Math.max(...n.map((x) => x.degree)) - Math.min(...n.map((x) => x.degree)); return near(span, a.scale.length, a.scale.length * 0.45) } }
export const onTheChord: Rule<Line> = { name: 'lands on the chord', why: 'the notes that fall on beats belong to the bar’s chord', source: 'common practice', read: 'from memory', weight: 2,
  score: (l, a) => { let on = 0, good = 0; for (const n of notes(l)) { if (n.at % a.beat) continue; on++; const chord = a.chords[Math.floor(n.at / a.steps) % a.chords.length]; if (chord.some((c) => (c - n.degree) % a.scale.length === 0)) good++ } return on ? good / on : 0 } }
export const comesHome: Rule<Line> = { name: 'comes to rest', why: 'it ends on the key’s first or fifth note, held', source: 'Krumhansl and Kessler 1982: the tonic and fifth are the most stable', read: 'read', weight: 1.5,
  score: (l, a) => { const n = notes(l), last = n[n.length - 1]; if (!last) return 0; const d = ((last.degree % a.scale.length) + a.scale.length) % a.scale.length, s = a.scale[d]; return (s === 0 ? 1 : s === 7 ? 0.8 : s === 3 || s === 4 ? 0.4 : 0) * (last.len >= a.beat ? 1 : 0.6) } }
export const leavesRoom: Rule<Line> = { name: 'leaves room', why: 'it is silent for a good part of the time: the place is to be heard too', source: 'Breath of the Wild’s sparse piano (Kataoka, Wakai, in interviews); Eno on ambient music', read: 'from memory', weight: 2,
  score: (l, a) => { let sound = 0; for (const v of l) if (v !== -1) sound++; return near(sound / l.length, a.want, 0.15) } }
export const returnsToItsFigure: Rule<Line> = { name: 'returns to its figure', why: 'its notes fall mostly where the piece’s own figure’s do, not wholly: heard before, and new', source: 'ours, after Butler 2006 on loops that change', read: 'ours', weight: 1.5,
  score: (l, a) => { if (!a.motif) return 0.5; let same = 0; for (let i = 0; i < l.length; i++) if ((l[i] >= 0) === (a.motif[i % a.motif.length] >= 0)) same++; return near(same / l.length, 0.85, 0.12) } }
export const doesNotStammer: Rule<Line> = { name: 'does not stammer', why: 'no note more than twice running', source: 'ours', read: 'ours', weight: 1,
  score: (l) => { const n = notes(l); let run = 1, worst = 1; for (let i = 1; i < n.length; i++) { run = n[i].degree === n[i - 1].degree ? run + 1 : 1; worst = Math.max(worst, run) } return worst <= 2 ? 1 : worst === 3 ? 0.5 : 0 } }
export const rootsDown: Rule<Line> = { name: 'the root on the bar', why: 'each bar begins on its chord’s root', source: 'common practice for a bass', read: 'from memory', weight: 3,
  score: (l, a) => { let good = 0; const bars = l.length / a.steps; for (let b = 0; b < bars; b++) { const v = l[b * a.steps]; if (v >= 0 && (v - a.chords[b % a.chords.length][0]) % a.scale.length === 0) good++ } return good / bars } }
export const fewNotes: Rule<Line> = { name: 'few notes', why: 'a bass says little: the root, its fifth, a step between', source: 'common practice for a bass', read: 'from memory', weight: 1,
  score: (l) => near(new Set(notes(l).map((n) => n.degree)).size, 3, 1.2) }
export const lineRhythm = (rule: Rule<Beat>): Rule<Line> => ({ ...rule, score: (l, a) => rule.score(l.map((v) => (v >= 0 ? 1 : 0)), a) })

// ── Harmony ───────────────────────────────────────────────────────────────
/** A run of chords, one a bar: each the scale degree of its root. */
export type Chords = number[]
const triad = (root: number) => [root, root + 2, root + 4]
export const startsAtHome: Rule<Chords> = { name: 'starts at home', why: 'the first chord is the key’s own', source: 'common practice', read: 'from memory', weight: 2, score: (c) => (c[0] === 0 ? 1 : 0) }
export const leadsBack: Rule<Chords> = { name: 'leads back', why: 'the last chord is one that wants the first again (the fifth, the fourth, the seventh)', source: 'common practice: the cadence', read: 'from memory', weight: 1.5, score: (c) => ([4, 3, 6].includes(c[c.length - 1]) ? 1 : c[c.length - 1] === 0 ? 0.3 : 0.5) }
export const keepsATone: Rule<Chords> = { name: 'keeps a note', why: 'each chord shares a note with the one before', source: 'voice leading: common tones are held (as commonly given)', read: 'read', weight: 2,
  score: (c, a) => { let good = 0; for (let i = 0; i < c.length; i++) { const x = triad(c[i]).map((d) => d % a.scale.length), y = triad(c[(i + 1) % c.length]).map((d) => d % a.scale.length); if (c[i] !== c[(i + 1) % c.length] && x.some((d) => y.includes(d))) good++ } return good / c.length } }
export const showsItsColour: Rule<Chords> = { name: 'shows its colour', why: 'a chord has the note that makes this mode itself (the raised fourth, the flat second)', source: 'modal harmony as commonly taught', read: 'from memory', weight: 1.5,
  score: (c, a) => { const colour = a.want; return c.some((r) => triad(r).some((d) => d % a.scale.length === colour)) ? 1 : 0 } }
export const noSourChord: Rule<Chords> = { name: 'no sour chord', why: 'no chord with two notes half an octave apart', source: 'common practice in calm music', read: 'from memory', weight: 2,
  score: (c, a) => { let sour = 0; for (const r of c) { const t = triad(r).map((d) => semis(d, a.scale)); if ([t[1] - t[0], t[2] - t[1], t[2] - t[0]].some((gap) => ((gap % 12) + 12) % 12 === 6)) sour++ } return 1 - sour / c.length } }
export const moves: Rule<Chords> = { name: 'goes somewhere', why: 'three different chords in four bars, none twice running', source: 'ours', read: 'ours', weight: 1.5,
  score: (c) => { let still = 0; for (let i = 1; i < c.length; i++) if (c[i] === c[i - 1]) still++; return clamp(new Set(c).size / Math.min(3, c.length)) * (1 - still / c.length) } }

/** The weighted mean of a candidate's scores, and each rule's own. */
export function judge<T>(rules: Rule<T>[], c: T, a: Around): { total: number; each: number[] } {
  let sum = 0, weight = 0
  const each = rules.map((r) => { const s = clamp(r.score(c, a)); sum += s * r.weight; weight += r.weight; return s })
  return { total: weight ? sum / weight : 0, each }
}
