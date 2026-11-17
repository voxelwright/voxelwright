// The kept library (#243, #244): what a model made for a wish before is kept on the asker's own machine, so the
// same wish, or one close to it, is made again at once with no model. What is kept is the model's reply, the data
// it was read from, and (#220) for a program or cells the thing it came to, as cells (make/cells.mjs): a kept
// thing is never run again. What was proved of it when it was kept is kept with it (`proved`): that every cell is
// joined to the ground, and whether it stood whole. Where it goes, the ground there and what is in the way are
// checked anew every time, as for a fresh reply.
//
// Only wishes of words are kept (a picture or a link is not a key, and neither is ever written down). A wish to
// fill a space is kept apart from the plain wish, by its size. An entry made before some lane named a further
// key of the reply (`field`, form.mjs) does not count: that thing would lack what the lane's key gives.
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const LIBRARY = join(homedir(), '.village', 'engine', 'library')
/** What comes with the engine (#372): the things realms ask for over and over, each made once by the best model and kept here, so that the first asker anywhere has them at once. Read, never written. */
export const SHIPPED = fileURLToPath(new URL('./kept', import.meta.url))
/** Words that say nothing of what is wanted: asking words. */
const EMPTY = new Set(['a', 'an', 'the', 'some', 'please', 'make', 'build', 'me', 'i', 'want', 'would', 'like', 'give', 'us', 'one', 'of', 'here', 'there', 'can', 'you', 'to', 'have', 'need'])
/** Pointing and joining words: they say nothing in a wish ("those trees" is trees), and are not read in what is typed; a kept thing's name keeps them, as it always has. */
const POINTING = new Set(['with', 'and', 'this', 'that', 'these', 'those', 'it', 'them'])
/** One word as it is kept: lower case, and "boxes" or "cars" as "box" and "car". */
const one = (w) => (w.length > 4 && /(x|s|sh|ch|z)es$/.test(w) ? w.slice(0, -2) : w.length > 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w)
const split = (text, pointing = true) => String(text).toLowerCase().normalize('NFKD').replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter((w) => w && !EMPTY.has(w) && !(pointing && POINTING.has(w)))
/**
 * A wish as the words that matter in it, each once, in order of the alphabet: "A red  Telephone-box, please!" is
 * "box red telephone". What a wish is filed under and kept with, so it keeps its pointing and joining words as it
 * always has: left out here, an entry kept before and one kept after for the same wish were two files with two sets of
 * words, neither of which answered. They are left out only of what is typed (`meant`).
 */
export const words = (wish) => [...new Set(split(wish, false).map(one))].sort()
/** A kept thing's name as the words it is called by. */
const nameWords = words
/**
 * Whether a wish asks for a change to something already there ("make it water", "paint it red", "make that a
 * castle"), not for a thing: such words name nothing kept, so nothing kept answers them and nothing is kept under
 * them. They are not refused: they go to the model as any other wish does. A pointing word followed by a word is a
 * thing pointed at, not a change, after "make": "make these flowers", "make that castle".
 */
export const asksAChange = (wish) => /^\s*(please\s+)?((turn|change|set|paint|colou?r)\s+(it|this|that|them|these|those)\b|make\s+(it|them)\b|make\s+(this|that|these|those)(\s+(a|an|the)\b|\s*[.!]?\s*$))/i.test(String(wish))
/** Whether two words differ by one letter at most: one out, one more, one other, or two side by side swapped. */
const near = (a, b) => {
  if (Math.abs(a.length - b.length) > 1) return false
  if (a.length === b.length) {
    const off = [...a].map((c, i) => (c === b[i] ? -1 : i)).filter((i) => i >= 0)
    return off.length <= 1 || (off.length === 2 && off[1] === off[0] + 1 && a[off[0]] === b[off[1]] && a[off[1]] === b[off[0]])
  }
  const [s, l] = a.length < b.length ? [a, b] : [b, a]
  for (let i = 0; i < l.length; i++) if (l.slice(0, i) + l.slice(i + 1) === s) return true
  return false
}
/** How sure a guess must be to be shown, and by how much it must lead the next: below either, the words do not yet say which. */
const SURE = 0.6, AHEAD = 0.12
/** How many letters a word typed alone may still lack of a thing's word to stand for it: "ca" is the car; "water" is not the waterball. */
const UNTYPED_MOST = 2

/**
 * What words mean, of the entries given (#220): the one reading by which the ghost is shown as words are typed and
 * by which a wish sent is made from what is kept, so that the same words mean the same thing whenever they arrive.
 * The last word may be half typed (a space after it or not: Enter sends the words without it), a letter out or two
 * swapped is forgiven, a rarer word weighs more, and the answer must be sure enough and far enough ahead of the next.
 * Then the answer is nothing if
 * - the words ask to change a thing ("make it drivable"), or say nothing ("the");
 * - a word said whole is not one of the answer's (its own or its name's): "bmw m2" is not the X3, "a red car" not the
 *   blue car. A last word still being typed is said whole once it begins none of the answer's words;
 * - one word alone lacks more than two letters of the answer's word it begins: "water" is not the waterball. This
 *   holds for the ghost as for Enter, so that Enter never makes what no ghost showed, nor a ghost shows what Enter
 *   would not make. After other words a half-typed last word is still read ("a car sal" is the saloon car).
 * Resolves to {entry, sure} or null.
 */
function meant(text, shelves) {
  if (asksAChange(text)) return null
  // The last word may always be unfinished, a space after it or not: Enter sends the words without that space, and
  // read otherwise "a car sal " showed no ghost and Enter made the saloon car.
  const said = split(text)
  // A word begun with one letter says nothing yet.
  if (said.length && said.at(-1).length < 2) said.pop()
  if (!said.length) return null
  // How telling a word is: one that every kept thing is called by says little.
  const called = (e) => [e.words ?? [], nameWords(e.name ?? '')]
  const seen = new Map()
  for (const e of shelves) for (const w of new Set(called(e).flat())) seen.set(w, (seen.get(w) ?? 0) + 1)
  const weight = (w) => Math.log(1 + shelves.length / (seen.get(w) ?? 0.5))
  const scores = []
  for (const e of shelves) {
    let best = 0
    for (const names of called(e)) {
      if (!names.length) continue
      let got = 0, total = 0
      said.forEach((raw, i) => {
        const half = i === said.length - 1, w = half ? raw : one(raw)
        let s = 0, like = w
        for (const k of names) {
          if (k === w || k === one(w)) { s = 1; like = k; break }
          if (half && w.length >= 2 && k.startsWith(w)) { const v = 0.55 + (0.45 * w.length) / k.length; if (v > s) { s = v; like = k } }
          else if (w.length >= 4 && near(w, k) && s < 0.75) { s = 0.75; like = k }
        }
        // A word typed that this name does not have counts against it by what that word would tell.
        const wt = s > 0 ? weight(like) : seen.has(w) ? weight(w) : 1.5
        got += s * wt; total += wt
      })
      // A name mostly left unsaid is a weaker match than one said whole.
      best = Math.max(best, (got / total) * (0.75 + (0.25 * said.length) / Math.max(said.length, names.length)))
    }
    if (best > 0) scores.push({ entry: e, sure: best })
  }
  scores.sort((a, b) => b.sure - a.sure || (b.entry.mine ? 1 : 0) - (a.entry.mine ? 1 : 0))
  const [first, second] = scores
  if (!first || first.sure < SURE) return null
  // Two kept under the same words (one's own, and what came with the engine) are one meaning: the first.
  if (second && second.entry.words?.join() !== first.entry.words?.join() && first.sure - second.sure < AHEAD) return null
  // Every word said is the answer's own or its name's.
  const has = [...new Set(called(first.entry).flat())]
  const fits = said.every((raw, i) => {
    const w = one(raw)
    if (has.some((k) => k === raw || k === w || (raw.length >= 4 && near(raw, k)) || (w.length >= 4 && near(w, k)))) return true
    const begins = i === said.length - 1 && raw.length >= 2 ? has.filter((k) => k.startsWith(raw)) : []
    return begins.length > 0 && (said.length > 1 || begins.some((k) => k.length - raw.length <= UNTYPED_MOST))
  })
  return fits ? { entry: first.entry, sure: Math.round(first.sure * 1000) / 1000 } : null
}

/**
 * How a kept entry is made again (make.mjs `make`'s `how`, `model` and `proved`): from the cells it came to if it has
 * them, with what was proved of them; else from its reply. No model is run.
 */
export const recalled = (entry) => ({
  ...(entry.made ? { how: 'cells', proved: entry.proved ?? {} } : { how: entry.form ?? 'parts', proved: {} }),
  model: async () => ({ text: entry.made ?? entry.reply, model: `kept (${entry.model})`, ms: 0, cost: 0 }),
  tries: 1,
})

export function library(dir = LIBRARY, also = [SHIPPED]) {
  const file = (key) => join(dir, `${createHash('sha256').update(key).digest('hex').slice(0, 24)}.json`)
  const keyOf = (wish, apart) => `${words(wish).join(' ')}|${apart}`
  /** Entries as read, by their file: read again only when the file has changed. */
  const read = new Map()
  /** Every entry on the shelves, the asker's own first: each with `id` (its file's name), `file` and `mine` (on the asker's own shelf, which may be written). */
  const all = async () => {
    const out = []
    for (const from of [dir, ...also]) for (const name of (await readdir(from).catch(() => [])).sort()) {
      if (!name.endsWith('.json')) continue
      const path = join(from, name)
      try {
        const s = await stat(path), was = read.get(path)
        if (was && was.at === s.mtimeMs && was.size === s.size) { out.push(was.entry); continue }
        // An entry's id says which shelf it is on and which writing of it this is: one's own entry and the engine's for the
        // same words are two things, and a better one written over an entry is another thing again. A ghost drawn from
        // an id and the thing Enter then makes are the same entry, or the id no longer answers.
        const kept = JSON.parse(await readFile(path, 'utf8'))
        const entry = { ...kept, id: `${name.slice(0, -5)}${from === dir ? 'm' : 's'}${createHash('sha256').update(`${kept.kept ?? ''}|${s.size}`).digest('hex').slice(0, 8)}`, file: path, mine: from === dir }
        read.set(path, { at: s.mtimeMs, size: s.size, entry })
        out.push(entry)
      } catch { /* not an entry */ }
    }
    return out
  }
  return {
    all,
    /**
     * The reply kept for this wish, or null: what the words mean (`meant`), of the entries kept apart as this wish is
     * (`apart`: a size to fill, a hand). `fields` are the keys lanes have named now.
     */
    async find(wish, apart = '', fields = []) {
      const fresh = (e) => fields.every((f) => e.fields?.includes(f))
      return meant(wish, (await all()).filter((e) => e.apart === apart && fresh(e)))?.entry ?? null
    },
    /** An entry by its id, if it is still on a shelf and is of the keys lanes have named now. */
    async byId(id, fields = []) {
      if (typeof id !== 'string' || !/^[0-9a-f]{24}[ms][0-9a-f]{8}$/.test(id)) return null
      return (await all()).find((e) => e.id === id && fields.every((f) => e.fields?.includes(f))) ?? null
    },
    /**
     * What words being typed mean, of things that stand (not for a hand): what `find` makes of them sent as they
     * stand, so that the ghost shown is what Enter makes. Resolves to the entry and how sure (0 to 1), or null when the
     * words do not yet say which (or say nothing kept).
     */
    async guess(text, fields = []) {
      return meant(text, (await all()).filter((e) => e.apart === '' && fields.every((f) => e.fields?.includes(f))))
    },
    /**
     * Keeps a reply a thing was made from. `made`: the thing as cells (make/cells.mjs), kept beside a program or
     * cells reply so it is never run again; `stands`: it stood whole when it was made (nothing of it fell or was
     * left out), so on level ground it is not stood in the maker's core again.
     */
    async keep(wish, apart, reply, { name, model, fields = [], form = 'parts', grade = 'quick', made, stands = false }) {
      if (!split(wish).length || asksAChange(wish)) return
      await mkdir(dir, { recursive: true })
      // `form`: how the reply is read ('parts': form.mjs; 'program': program.mjs; 'cells': cells.mjs). `grade`: 'quick',
      // or 'best' for one the best model took its time over (#372). A best one is never written over by a quick one.
      if (grade !== 'best') { try { if (JSON.parse(await readFile(file(keyOf(wish, apart)), 'utf8')).grade === 'best') return } catch { /* none kept */ } }
      await writeFile(file(keyOf(wish, apart)), JSON.stringify({ wish, words: words(wish), apart, name, model, fields, form, grade, kept: new Date().toISOString(), reply, ...(made ? { made, proved: { joined: true, stands } } : {}) }))
    },
    /** Gives an entry of the asker's own shelf, kept before things were kept as cells, the cells it came to (what came with the engine already has them). */
    async made(entry, made, stands = false) {
      if (!entry?.mine || entry.made) return
      const { id, file: path, mine, ...kept } = entry
      await writeFile(path, JSON.stringify({ ...kept, made, proved: { joined: true, stands } }))
    },
  }
}

// Gives what comes with the engine (or a shelf named with --dir) the cells each thing came to, and what was proved
// of them, by making each once (dry: nothing is sent) in a world started for it:
//   node make/library.mjs --cells --world http://127.0.0.1:5930 [--dir make/kept]
if (process.argv[1] === fileURLToPath(import.meta.url) && process.argv.includes('--cells')) {
  const flag = (name) => { const i = process.argv.indexOf(`--${name}`); return i < 0 ? undefined : process.argv[i + 1] }
  const world = flag('world'), into = flag('dir') ?? SHIPPED
  if (!world) { console.error('say which world to stand them in: --world http://127.0.0.1:port'); process.exit(2) }
  const { make } = await import('../make.mjs')
  let x = 700
  for (const name of (await readdir(into)).filter((n) => n.endsWith('.json')).sort()) {
    const path = join(into, name), e = JSON.parse(await readFile(path, 'utf8'))
    if (e.form === 'parts') continue
    const r = await make({ wish: e.wish, world, where: { at: [x += 200, 4070] }, how: e.form, model: async () => ({ text: e.reply, model: 'kept', ms: 0, cost: 0 }), tries: 1, dry: true })
    if (r.state !== 'dry') { console.log(`${e.wish}: not made (${r.why})`); continue }
    const made = r.toCells(), stands = !r.left
    await writeFile(path, JSON.stringify({ ...e, made, proved: { joined: true, stands } }))
    console.log(`${e.wish}${e.apart ? ` (${e.apart})` : ''}: ${r.name}, ${r.cells} cells, ${made.length} characters of cells${stands ? ', stood whole' : `, ${r.left} in a hundred would fall`}`)
  }
}
