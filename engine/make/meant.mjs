// What typed words mean of what is kept (#220, #244): the one rule by which the ghost is shown as words are typed and
// by which a wish sent is made from what is kept, for the helper (make/library.mjs, whose shelf this reads nothing of)
// and for a page that holds its own shelf (page/maker.ts) alike. Nothing here reads a file.

/** Words that say nothing of what is wanted: asking words. */
const EMPTY = new Set(['a', 'an', 'the', 'some', 'please', 'make', 'build', 'me', 'i', 'want', 'would', 'like', 'give', 'us', 'one', 'of', 'here', 'there', 'can', 'you', 'to', 'have', 'need'])
/** Pointing and joining words: they say nothing in a wish ("those trees" is trees), and are not read in what is typed; a kept thing's name keeps them, as it always has. */
const POINTING = new Set(['with', 'and', 'this', 'that', 'these', 'those', 'it', 'them'])
/** One word as it is kept: lower case, and "boxes" or "cars" as "box" and "car". */
const one = (w) => (w.length > 4 && /(x|s|sh|ch|z)es$/.test(w) ? w.slice(0, -2) : w.length > 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w)
export const split = (text, pointing = true) => String(text).toLowerCase().normalize('NFKD').replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter((w) => w && !EMPTY.has(w) && !(pointing && POINTING.has(w)))
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
export function meant(text, shelves) {
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

