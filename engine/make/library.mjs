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
import { asksAChange, meant, split, words } from './meant.mjs'

export { asksAChange, recalled, words } from './meant.mjs'

export const LIBRARY = join(homedir(), '.village', 'engine', 'library')
/** What comes with the engine (#372): the things realms ask for over and over, each made once by the best model and kept here, so that the first asker anywhere has them at once. Read, never written. */
export const SHIPPED = fileURLToPath(new URL('./kept', import.meta.url))
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
