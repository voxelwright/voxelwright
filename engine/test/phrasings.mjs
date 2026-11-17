// Phrasings of what is kept (#220), for test/words.mjs: generated from each thing's own words and its name's over two
// shelves, what comes with the engine (make/kept/) and a made-up shelf beside it, and read by `guess` as the base
// (70f526e9) had it, once, by test/words-base.mjs into test/words-base.json. The check compares what words mean now
// with those answers. Nothing here knows how words are matched: it only writes phrasings and the shelf.
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join } from 'node:path'

/**
 * The made-up shelf, as the asker's own: the owner's two cars as make/import.mjs keeps them, a water ball, a Formula 1
 * car, two entries once kept under wishes to change a thing (with the words they were kept under then), and two
 * more. Only what matching reads: the words written literally as they were kept, so that how words are read now does
 * not change the shelf.
 */
export const MADE_UP = [
  ['a BMW X3', ['bmw', 'x3'], 'BMW X3'],
  ['a Tesla Model 3', ['3', 'model', 'tesla'], 'Tesla Model 3'],
  ['waterball', ['waterball'], 'inflatable waterball'],
  ['formula 1 car', ['1', 'car', 'formula'], 'Formula 1 car'],
  ['make it water', ['it', 'water'], 'stone fountain running with water'],
  ['make it drivable', ['drivable', 'it'], 'drivable blue hatchback car'],
  ['a red telephone box', ['box', 'red', 'telephone'], 'red telephone box'],
  ['a park bench', ['bench', 'park'], 'green park bench'],
]
export function writeMadeUp(dir) {
  for (const [wish, words, name] of MADE_UP) writeFileSync(join(dir, `${createHash('sha256').update(`${words.join(' ')}|`).digest('hex').slice(0, 24)}.json`), JSON.stringify({ wish, words, apart: '', name, model: 'made up', fields: [], form: 'cells', grade: 'quick', kept: '2026-11-16T12:00:00.000Z', reply: null }))
}
/** What an answer is called in the record: the wish it was kept under and its name (ids differ between shelves and writings). */
export const called = (entry) => (entry ? `${entry.wish} / ${entry.name}` : null)

/** Words in no kept thing, beginning none and a letter off none: checked against both shelves below. */
export const FOREIGN = ['zorbly', 'quimpet']
/** Words the base read as words and now say nothing (make/library.mjs EMPTY): what typed text means without them. */
export const SAY_NOTHING = ['with', 'and', 'this', 'that', 'these', 'those', 'it', 'them']
export const without = (text) => {
  const left = text.split(/(\s+)/).filter((w) => !SAY_NOTHING.includes(w.toLowerCase())).join('').replace(/\s+/g, ' ').replace(/^ /, '')
  // Still being typed if it was: a word that says nothing at the end does not end the word before it.
  return /\s$/.test(text) ? left : left.trimEnd()
}

const BASE_EMPTY = new Set(['a', 'an', 'the', 'some', 'please', 'make', 'build', 'me', 'i', 'want', 'would', 'like', 'give', 'us', 'one', 'of', 'here', 'there', 'can', 'you', 'to', 'have', 'need'])
const tokens = (text) => String(text).toLowerCase().normalize('NFKD').replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter((w) => w && !BASE_EMPTY.has(w))

/** The entries of a shelf directory as written, standing things only (what `guess` reads). */
export const entriesOf = (dir) => readdirSync(dir).filter((n) => n.endsWith('.json')).map((n) => JSON.parse(readFileSync(join(dir, n), 'utf8'))).filter((e) => e.apart === '')

/**
 * Phrasings over the things given: [text, how it was made]. Each thing's words (its own and its name's) alone, in
 * pairs, with an article, half typed at each length, with a letter out and two swapped, with a foreign word added and
 * in place of one; each as typed and with a space after (the last word then said whole).
 */
export function phrasings(things) {
  const out = new Map()
  const add = (text, how) => { for (const t of [text, `${text} `]) if (!out.has(t)) out.set(t, how) }
  const all = new Set(things.flatMap((e) => [...(e.words ?? []), ...tokens(e.name ?? '')]))
  // No kept word begins as a foreign word does, begins one, or is within two edits of one.
  const edits = (a, b) => { let row = [...Array(b.length + 1).keys()]; for (const c of a) { const next = [row[0] + 1]; for (let j = 1; j <= b.length; j++) next[j] = Math.min(row[j] + 1, next[j - 1] + 1, row[j - 1] + (c === b[j - 1] ? 0 : 1)); row = next } return row[b.length] }
  for (const f of FOREIGN) for (const w of all) if (w.startsWith(f.slice(0, 2)) || f.startsWith(w) || edits(f, w) <= 2) throw new Error(`foreign word ${f} is too like ${w}`)
  for (const e of things) {
    const ws = [...new Set([...(e.words ?? []), ...tokens(e.name ?? '')])]
    for (const w of ws) {
      add(w, 'alone'); add(`a ${w}`, 'article')
      for (let n = 1; n < w.length; n++) add(w.slice(0, n), 'half')
      if (w.length >= 4) { const m = w.length >> 1; add(w.slice(0, m) + w.slice(m + 1), 'letter out'); add(w.slice(0, m - 1) + w[m] + w[m - 1] + w.slice(m + 1), 'swapped') }
      add(`${w} ${FOREIGN[0]}`, 'foreign added'); add(`${FOREIGN[1]} ${w}`, 'foreign added')
    }
    for (let i = 0; i < ws.length; i++) for (let j = 0; j < ws.length; j++) {
      if (i === j) continue
      add(`${ws[i]} ${ws[j]}`, 'pair'); add(`a ${ws[i]} ${ws[j]}`, 'article')
      if (j === i + 1) {
        for (let n = 1; n < ws[j].length; n++) add(`a ${ws[i]} ${ws[j].slice(0, n)}`, 'half')
        add(`${ws[i]} ${FOREIGN[0]}`, 'foreign in place'); add(`${FOREIGN[1]} ${ws[j]}`, 'foreign in place'); add(`a ${ws[i]} ${FOREIGN[0]} ${ws[j]}`, 'foreign added')
      }
    }
    add(e.wish, 'wish'); add(e.name ?? '', 'name')
  }
  return out
}

/** Named examples: the owner's journal of November 16 and the bearings measured on the base. */
export const NAMED = [
  'tesla', 'a tesla', 'bmw', 'x3', 'street', 'lamp', 'chair', 'wooden', 'striped', 'stall', 'a market', 'model', 'house', 'sword', 'car', 'with', '1', '3',
  'bmw m2', 'bmw x3', 'f1 car', 'water', 'a blue car', 'a red car', 'a big tree', 'water ball', 'waterball', 'formula 1 car',
  'make it drivable', 'make it water', 'make it 10x large', 'make it rain', 'paint it red', 'make that a castle',
  'make these flowers', 'make that castle', 'those trees', 'these flowers',
  'a ca', 'a tre', 'chiar', 'st', 'a carpet', 'bmw m', 'a car sal', 'water b', 'the', 'a', 'some',
]

/** Every text a check reads, on each shelf: the phrasings, the named examples, and each without the words that now say nothing. */
export function texts(things) {
  const ps = phrasings(things)
  for (const t of NAMED) for (const s of [t, `${t} `]) if (!ps.has(s)) ps.set(s, 'named')
  const every = new Set()
  for (const t of ps.keys()) for (const s of [t, t.trim()]) { every.add(s); every.add(without(s)) }
  return { phrasings: ps, every: [...every] }
}
