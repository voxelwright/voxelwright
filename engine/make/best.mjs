// A wish made at once, then made better (#372). The first version is a program by a quick model (seconds; a
// thing in cells as fine as 1.25 cm), or what was kept for the wish; it stands in the world as soon as it is made.
// Behind it the best model writes its own, which takes minutes, and that one takes the first one's place where it
// stands, if the first is still as it was put (nobody holds it, it has not been moved or taken out). Either way the
// better one is kept, so the next asker of that wish gets it with no model and no wait.
import { make, undo } from '../make.mjs'
import { fieldKeys } from './form.mjs'
import { recalled } from './library.mjs'

/** Whether a making stood whole: there, and nothing of it left out or let fall. */
const whole = (r) => r.state === 'there' && !r.left
/** What a rule adds to a wish that is for a hand (plugins/make/page.ts): the thing alone, lying on its side. Such a one is kept apart from the standing thing of the same words. */
const HAND = /\s*\(to carry in one hand:[^)]*\)\s*$/

/**
 * Makes a wish of words (and, if they came with it, a picture or a page). `first` and `best` are how a reply is
 * got from the quick and the best model ({ system, prompt, pictures } to { text, model, ms, cost }); `best` may be
 * left out. `shelf` is the kept library (library.mjs) or null. `known`: the kept entry to make, if the asker chose one
 * (the ghost on the ask bar: library.mjs `guess`). Resolves to { first, better }: what came of the first making (as
 * `make` resolves), and a promise of what came of the better one, or null if none was begun. Without `first` only
 * what is kept is made.
 */
export async function wished({ wish, picture, page, fresh = false, world, where, facing, by, journal, first, best, shelf, known, say = () => {}, told = () => {} }) {
  const plain = shelf && wish && !picture && !page, fields = fieldKeys()
  const words = wish.replace(HAND, ''), apart = HAND.test(wish) ? 'hand' : ''
  const run = (how, model, more = {}) => make({ wish, picture, page, world, where, facing, by, journal, how, model, say, ...more })
  known ??= plain && !fresh ? await shelf.find(words, apart, fields) : null
  let r = null, entry = known
  if (known) {
    told({ stage: 'known', name: known.name })
    const { how, model, ...more } = recalled(known)
    r = await run(how, model, more)
    // What was kept could not be used after all (the form has moved on since): it is made as if nothing had been kept.
    if (r.state === 'refused') { r = null; entry = null }
    // Kept before things were kept as cells: the cells it came to are kept with it now, and it is never run again.
    else if (!known.made && r.toCells) await shelf?.made(known, r.toCells(), whole(r)).catch(() => {})
  }
  if (!r && !first) return { first: { state: 'refused', why: 'nothing like it is kept, and no model is here to make it' }, better: null }
  if (!r) {
    r = await run('program', first)
    if (plain && r.reply && ['there', 'held'].includes(r.state)) { entry = { reply: r.reply, form: 'program', grade: 'quick', name: r.name, model: r.model }; await shelf.keep(words, apart, r.reply, { ...entry, fields, made: r.toCells?.(), stands: whole(r) }).catch(() => {}) }
  }
  // The better one: not for a wish whose best is already kept, nor one that came to nothing.
  if (!best || entry?.grade === 'best' || !['there', 'held'].includes(r.state)) return { first: r, better: null }
  const better = (async () => {
    const standing = r.state === 'there' ? { id: r.id, at: r.origin } : null
    const b = await make({ wish, picture, page, world, where: standing ? { at: [r.origin[0], r.origin[2]] } : where, facing: r.facing, by, journal, how: 'program', model: best, instead: standing ?? { id: null }, say: (words) => say(`(better) ${words}`) })
    if (plain && b.reply && ['there', 'kept', 'held', 'fell'].includes(b.state)) await shelf.keep(words, apart, b.reply, { name: b.name, model: b.model, fields, form: 'program', grade: 'best', made: b.toCells?.(), stands: whole(b) }).catch(() => {})
    // The first was taken out for it and it could not be stood there after all: the first is put back.
    if (b.swapped && b.state !== 'there' && entry) await make({ wish, world, where: { at: [r.origin[0], r.origin[2]] }, facing: r.facing, by, journal, ...recalled(entry), say: (words) => say(`(put back) ${words}`) }).catch(() => {})
    return b
  })()
  better.catch(() => {})
  return { first: r, better }
}
export { undo }
