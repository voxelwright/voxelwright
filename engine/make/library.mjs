// The kept library (#243, #244): what a model made for a wish before is kept on the asker's own machine, so the
// same wish, or one close to it, is made again at once with no model. What is kept is the model's reply, the data
// it was read from: it is read and checked again every time, stood and placed anew, exactly as a fresh reply is.
//
// Only wishes of words are kept (a picture or a link is not a key, and neither is ever written down). A wish to
// fill a space is kept apart from the plain wish, by its size. An entry made before some lane named a further
// key of the reply (`field`, form.mjs) does not count: that thing would lack what the lane's key gives.
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { homedir } from 'node:os'
import { join } from 'node:path'

export const LIBRARY = join(homedir(), '.village', 'engine', 'library')
/** Words that say nothing of what is wanted. */
const EMPTY = new Set(['a', 'an', 'the', 'some', 'please', 'make', 'build', 'me', 'i', 'want', 'would', 'like', 'give', 'us', 'one', 'of', 'here', 'there', 'can', 'you', 'to', 'have', 'need'])
/** A wish as the words that matter in it, each once, in order of the alphabet: "A red  Telephone-box, please!" is "box red telephone". */
export const words = (wish) => [...new Set(String(wish).toLowerCase().normalize('NFKD').replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter((w) => w && !EMPTY.has(w)).map((w) => (w.length > 4 && /(x|s|sh|ch|z)es$/.test(w) ? w.slice(0, -2) : w.length > 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w)))].sort()
/** How alike two wishes are, 0 to 1: the words they share over the words either has. */
const alike = (a, b) => { const both = a.filter((w) => b.includes(w)).length; return both / (a.length + b.length - both || 1) }
/** As alike as this, a wish is taken to be one made before. Two words of three shared is not enough; three of four is. */
const CLOSE = 0.75

export function library(dir = LIBRARY) {
  const file = (key) => join(dir, `${createHash('sha256').update(key).digest('hex').slice(0, 24)}.json`)
  const keyOf = (wish, apart) => `${words(wish).join(' ')}|${apart}`
  return {
    /** The reply kept for this wish or one close to it, or null. `apart` keeps wishes of different kinds apart (a size to fill); `fields` are the keys lanes have named now. */
    async find(wish, apart = '', fields = []) {
      const mine = words(wish)
      if (!mine.length) return null
      const fresh = (e) => fields.every((f) => e.fields?.includes(f))
      try { const e = JSON.parse(await readFile(file(keyOf(wish, apart)), 'utf8')); if (fresh(e)) return e } catch { /* not kept under these very words */ }
      let best = null, most = 0
      for (const name of await readdir(dir).catch(() => [])) {
        if (!name.endsWith('.json')) continue
        let e
        try { e = JSON.parse(await readFile(join(dir, name), 'utf8')) } catch { continue }
        const like = e.apart === apart && fresh(e) ? alike(mine, e.words ?? []) : 0
        if (like >= CLOSE && like > most) { most = like; best = e }
      }
      return best
    },
    /** Keeps a reply a thing was made from. */
    async keep(wish, apart, reply, { name, model, fields = [] }) {
      if (!words(wish).length) return
      await mkdir(dir, { recursive: true })
      await writeFile(file(keyOf(wish, apart)), JSON.stringify({ wish, words: words(wish), apart, name, model, fields, kept: new Date().toISOString(), reply }))
    },
  }
}
