// The form of an instrument's surface (#247) and the only reading of it: what it is and how it is played is in
// instrument.ts. Kept apart so that whoever checks a thing's record (the page, a tool, a check in Node) needs nothing
// of the page to do it.

export interface Part { shape: 'rect' | 'round' | 'poly'; at?: [number, number, number, number]; points?: [number, number][]; colour?: string; label?: string; key?: string; note?: number; slide?: { to: number; along: 'x' | 'y' }; level?: 'x' | 'y'; string?: number; chord?: number[]; strum?: number }
export interface Surface { size: [number, number]; release?: 'rings' | 'stops'; parts: Part[] }

export const COLOURS: Record<string, string> = { wood: '#8a5a33', pale: '#c9a271', dark: '#2a2018', ivory: '#f1ead9', ebony: '#191919', brass: '#c9a14a', steel: '#b9c0c8', clay: '#b5653f', red: '#c0463a', blue: '#3f6fb0', green: '#4c8a55', gold: '#e2b93b', sky: '#8fc3e6', night: '#1c2233', white: '#ffffff', grey: '#6d7681' }
const KEYS = new Set(['Space', ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map((c) => `Key${c}`), ...'0123456789'.split('').map((c) => `Digit${c}`)])
const PART = ['shape', 'at', 'points', 'colour', 'label', 'key', 'note', 'slide', 'level', 'string', 'chord', 'strum']
const num = (v: unknown, lo: number, hi: number): v is number => typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi
const plain = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype
const stray = (o: object, keys: readonly string[]) => Object.keys(o).find((k) => !keys.includes(k))

/** A surface read from data: the surface, or why it is refused. */
export function surface(v: unknown): { surface: Surface } | { refused: string } {
  const no = (why: string) => ({ refused: why })
  if (!plain(v)) return no('a surface is an object')
  const extra = stray(v, ['size', 'release', 'parts'])
  if (extra) return no(`a surface has no "${extra}"`)
  if (!Array.isArray(v.size) || v.size.length !== 2 || !v.size.every((n) => num(n, 2, 64))) return no('"size" is [wide, high], 2 to 64 each')
  if ('release' in v && v.release !== 'rings' && v.release !== 'stops') return no('"release" is "rings" or "stops"')
  if (!Array.isArray(v.parts) || v.parts.length < 1 || v.parts.length > 80) return no('"parts" is 1 to 80 parts')
  const [w, h] = v.size as [number, number]
  let strings = 0, sounding = 0
  for (const p of v.parts) {
    if (!plain(p)) return no('a part is an object')
    const odd = stray(p, PART)
    if (odd) return no(`a part has no "${odd}"`)
    if (p.shape === 'poly') {
      if (!Array.isArray(p.points) || p.points.length < 3 || p.points.length > 16 || !p.points.every((q) => Array.isArray(q) && q.length === 2 && num(q[0], 0, w) && num(q[1], 0, h))) return no('a "poly" has 3 to 16 "points" inside the surface')
      if ('at' in p) return no('a "poly" has "points", not "at"')
    } else if (p.shape === 'rect' || p.shape === 'round') {
      const a = p.at
      if (!Array.isArray(a) || a.length !== 4 || !num(a[0], 0, w) || !num(a[1], 0, h) || !num(a[2], 0.05, w) || !num(a[3], 0.05, h) || a[0] + a[2] > w + 1e-6 || a[1] + a[3] > h + 1e-6) return no('"at" is [x, y, wide, high] inside the surface')
      if ('points' in p) return no('only a "poly" has "points"')
    } else return no('"shape" is rect, round or poly')
    if ('colour' in p && !(typeof p.colour === 'string' && Object.hasOwn(COLOURS, p.colour))) return no(`"colour" is one of ${Object.keys(COLOURS).join(', ')}`)
    if ('label' in p && !(typeof p.label === 'string' && /^[A-Za-z0-9#'+\- ]{1,6}$/.test(p.label))) return no('"label" is 1 to 6 letters, digits, #, \', + or -')
    if ('key' in p && !(typeof p.key === 'string' && KEYS.has(p.key))) return no('"key" is KeyA to KeyZ, Digit0 to Digit9 or Space')
    if ('note' in p && !num(p.note, 12, 120)) return no('"note" is 12 to 120')
    if ('slide' in p) { const s = p.slide; if (!plain(s) || stray(s, ['to', 'along']) || !num(s.to, 12, 120) || (s.along !== 'x' && s.along !== 'y') || !('note' in p)) return no('"slide" is {to: 12 to 120, along: "x" or "y"}, on a part with a note') }
    if ('level' in p && p.level !== 'x' && p.level !== 'y') return no('"level" is "x" or "y"')
    if ('string' in p) { if (!Number.isInteger(p.string) || !num(p.string, 0, 11) || !('note' in p)) return no('"string" is 0 to 11, on a part with its open note'); strings = Math.max(strings, (p.string as number) + 1) }
    if ('strum' in p && !num(p.strum, 0, 120)) return no('"strum" is 0 to 120 ms')
    if ('chord' in p && !(Array.isArray(p.chord) && p.chord.length >= 1 && p.chord.length <= 12 && p.chord.every((n) => num(n, 12, 120)))) return no('"chord" is 1 to 12 notes')
    if ((['note', 'strum', 'chord'] as const).filter((k) => k in p).length > 1) return no('a part sounds a note, strums or sets a chord: one of them')
    if ('note' in p || 'strum' in p) sounding++
  }
  if (!sounding) return no('one part at least sounds')
  for (const p of v.parts as Part[]) {
    if (p.chord && p.chord.length !== strings) return no(`a chord has a note for each of the ${strings} strings`)
    if ('strum' in p && !strings) return no('there is no string to strum')
  }
  for (let i = 0; i < strings; i++) if ((v.parts as Part[]).filter((p) => p.string === i).length !== 1) return no(`string ${i} is one part`)
  return { surface: v as unknown as Surface }
}
