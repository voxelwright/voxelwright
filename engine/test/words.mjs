// What typed words mean, of what is kept, and where a thing made of them stands (#220). On November 16 the owner was
// given the wrong kept thing again and again ("bmw m2" a BMW X3, "f1 car" the saloon, "water" a water ball, "make it
// drivable" a thing kept under "make it water"), and a new car was stood inside a living one. This check holds those
// cases on a made-up shelf built here (two living cars imported as the bench writes them, a waterball, a Formula 1
// car, and three entries once kept under wishes to change a thing) beside what comes with the engine (make/kept/).
// NO MODEL IS RUN: the helper's models are stand-ins that count.
//
// - What words mean, as the ghost reads them (`guess`) and as Enter does (`find`), compared with the base's answers
//   over generated phrasings (below); the journal's cases named; what is kept and what is not. `--meaning`: only this.
// - The helper: Enter with the ghost's id and without it make the same thing; a ghost's id the words do not name is
//   not made; wishes to change a thing, and ordinary wishes nothing kept answers, go to the model and are never refused.
// - A thing is not stood inside a living one: by `make.mjs --at`, and from the bar.
//
//   node test/words.mjs
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { helper } from '../helper.mjs'
import { importTo } from '../make/import.mjs'
import { SHIPPED, library, words as wordsOf } from '../make/library.mjs'
import { SAY_NOTHING, called, entriesOf, texts, without, writeMadeUp } from './phrasings.mjs'
import { fineCar } from '../page/living.ts'
import { here, serve } from './kit.mjs'

const failures = []
const check = (ok, what) => { console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) failures.push(what) }
const dir = mkdtempSync(join(tmpdir(), 'engine-words-')), shelfDir = join(dir, 'shelf'), keeps = join(dir, 'keeps')
mkdirSync(shelfDir)
mkdirSync(keeps)

// ── The made-up shelf ───────────────────────────────────────────────────────────────────────────────────────────
// Two living cars, as the bench writes a build (test/kept-car.mjs): "a BMW X3" and "a Tesla Model 3".
const car = fineCar([0, 0, 0]), look = car.fine[0]
for (const name of ['BMW X3', 'Tesla Model 3']) {
  const build = { name, living: { body: { size: car.size, cells: [...car.cells] }, motor: car.motor, seats: car.seats, eye: car.eye }, parts: { whole: { size: look.size, per: look.per, low: look.low, cells: Buffer.from(look.cells.buffer).toString('base64') } }, asked: {}, measured: {} }
  writeFileSync(join(dir, 'build.json'), JSON.stringify(build))
  await importTo(join(dir, 'build.json'), { shelf: shelfDir })
}
// Things of plain cells, each the shipped tree under another wish and name; three of them kept, as the first change
// let them be, under wishes to change a thing aimed at. Each is written as it was then, with the words it had.
const tree = JSON.parse(readFileSync(join(SHIPPED, readdirSync(SHIPPED).find((n) => JSON.parse(readFileSync(join(SHIPPED, n), 'utf8')).wish === 'a tree')), 'utf8'))
const OLD_EMPTY = new Set(['a', 'an', 'the', 'some', 'please', 'make', 'build', 'me', 'i', 'want', 'would', 'like', 'give', 'us', 'one', 'of', 'here', 'there', 'can', 'you', 'to', 'have', 'need'])
for (const [wish, name] of [['waterball', 'inflatable waterball'], ['formula 1 car', 'Formula 1 car'], ['make it drivable', 'drivable blue hatchback car'], ['make it water', 'stone fountain running with water'], ['make it 10x large', 'giant enamel mug, 10x size']]) {
  const words = [...new Set(wish.toLowerCase().split(/\s+/).filter((w) => !OLD_EMPTY.has(w)))].sort()
  writeFileSync(join(shelfDir, `${createHash('sha256').update(`${words.join(' ')}|`).digest('hex').slice(0, 24)}.json`), JSON.stringify({ ...tree, wish, words, name, grade: 'quick', kept: '2026-11-16T12:00:00.000Z' }))
}
const shelf = library(shelfDir)

// ── What words mean, against the base (make/library.mjs `guess` on 70f526e9) ──────────────────────────────────
// Every phrasing (test/phrasings.mjs), read as the ghost reads it (as typed) and as Enter does (as sent), on what
// comes with the engine alone and with the made-up shelf beside it. What the base answered is test/words-base.json.
// The answer now is the base's, except where one of four differences applies, and there it is what that one says:
// - a change: words that ask to change a thing mean nothing kept;
// - says nothing: words that say nothing are not read ("those trees" is "trees"), and alone they mean nothing;
// - word missing: a word said whole that the base's answer does not have makes it nothing ("bmw m2"); a last word
//   still being typed is said whole once it can no longer become one of the answer's words;
// - unfinished: one word alone lacking more than two letters of the answer's word means nothing, for the ghost as
//   for Enter ("water" is not the waterball).
// - a space after: the last word is read as it would be without a space after it (Enter sends the words without
//   it), so a ghost and Enter never differ by a space.
// Any other difference fails, and so does any phrasing that the ghost and Enter read differently.
const record = JSON.parse(readFileSync(join(here, 'test', 'words-base.json'), 'utf8'))
const BASE_EMPTY = new Set(['a', 'an', 'the', 'some', 'please', 'make', 'build', 'me', 'i', 'want', 'would', 'like', 'give', 'us', 'one', 'of', 'here', 'there', 'can', 'you', 'to', 'have', 'need'])
const said = (text) => String(text).toLowerCase().normalize('NFKD').replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter((w) => w && !BASE_EMPTY.has(w) && !SAY_NOTHING.includes(w))
const plural = (w) => (w.length > 4 && /(x|s|sh|ch|z)es$/.test(w) ? w.slice(0, -2) : w.length > 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w)
/** One letter out, one more, one other, or two side by side swapped. */
const letterOff = (a, b) => {
  if (Math.abs(a.length - b.length) > 1) return false
  if (a.length === b.length) { const off = [...a].map((c, i) => (c === b[i] ? -1 : i)).filter((i) => i >= 0); return off.length <= 1 || (off.length === 2 && off[1] === off[0] + 1 && a[off[0]] === b[off[1]] && a[off[1]] === b[off[0]]) }
  const [s, l] = a.length < b.length ? [a, b] : [b, a]
  for (let i = 0; i < l.length; i++) if (l.slice(0, i) + l.slice(i + 1) === s) return true
  return false
}
/** Wishes to change a thing, among the phrasings: the named ones and the two made-up entries kept under such wishes. */
const CHANGES = new Set(['make it drivable', 'make it water', 'make it 10x large', 'make it rain', 'paint it red', 'make that a castle'])
const shelves = {}
for (const [name, own] of [['shipped', join(dir, 'none')], ['made up', join(dir, 'mine')]]) { mkdirSync(own); if (name === 'made up') writeMadeUp(own); shelves[name] = { lib: library(own), things: [...entriesOf(own), ...entriesOf(SHIPPED)] } }
/** What the answer should be for words read as the ghost does (`sent` false) or as Enter does, and which difference made it so. */
const wanted = (shelf, text, sent) => {
  const t = text.trim(), answers = record.shelves[shelf], left = without(t)
  if (!(left in answers)) return { stale: t }
  if (CHANGES.has(t.trim().toLowerCase())) return { want: null, why: 'a change' }
  const base = answers[left], why = left === t ? null : 'says nothing'
  const ws = said(left), typing = true
  if (!ws.length) return { want: null, why: 'says nothing' }
  if (typing && ws.at(-1).length < 2) ws.pop()
  if (!base || !ws.length) return { want: base, why }
  const e = shelves[shelf].things.find((x) => called(x) === base), own = [...new Set([...(e.words ?? []), ...String(e.name ?? '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean).map(plural)])]
  for (const [i, w] of ws.entries()) {
    const whole = own.some((k) => k === w || k === plural(w) || (w.length >= 4 && letterOff(w, k)))
    if (whole) continue
    const begins = typing && i === ws.length - 1 && w.length >= 2 ? own.filter((k) => k.startsWith(w)) : []
    if (!begins.length) return { want: null, why: 'word missing' }
    if (ws.length === 1 && begins.every((k) => k.length - w.length > 2)) return { want: null, why: 'unfinished' }
  }
  return { want: base, why }
}
const tally = { phrasings: 0, reads: 0, same: 0, 'a change': 0, 'says nothing': 0, 'word missing': 0, 'unfinished': 0, 'a space after': 0 }, wrong = [], stale = new Set(), differ = []
for (const [shelf, { lib, things }] of Object.entries(shelves)) {
  const { phrasings: ps } = texts(things)
  tally.phrasings += ps.size
  for (const text of ps.keys()) for (const sent of [false, true]) {
    const w = wanted(shelf, text, sent)
    if (w.stale) { stale.add(w.stale); continue }
    const now = called(sent ? await lib.find(text.trim()) : (await lib.guess(text))?.entry), base = record.shelves[shelf][sent ? text.trim() : text]
    tally.reads++
    if (now !== w.want) { wrong.push(`${shelf}, ${sent ? 'Enter' : 'ghost'} "${text}": ${now ?? 'nothing'}; base ${base ?? 'nothing'}, wanted ${w.want ?? 'nothing'}${w.why ? ` (${w.why})` : ''}`); continue }
    if (now === base) tally.same++
    else tally[w.why ?? 'a space after']++
    // The ghost reads the words as typed, Enter as sent (without a space after): they mean one thing.
    if (sent) { const shown = called((await lib.guess(text))?.entry); if (shown !== now) differ.push(`${shelf} "${text}": the ghost ${shown ?? 'nothing'}, Enter ${now ?? 'nothing'}`) }
  }
}
check(!differ.length, `the ghost and Enter mean the same for every phrasing, a space after it or not${differ.length ? `: ${differ.length} differ, the first ${differ.slice(0, 5).join('; ')}` : ''}`)
check(!stale.size, `every phrasing has the base's answer in test/words-base.json${stale.size ? ` (${stale.size} missing: make/kept/ or the phrasings changed; run node test/words-base.mjs)` : ''}`)
for (const line of wrong.slice(0, 40)) console.log(`    ${line}`)
check(!wrong.length, `${tally.reads} readings of ${tally.phrasings} phrasings: ${tally.same} as the base, ${tally['a change']} a change, ${tally['says nothing']} saying nothing, ${tally['word missing']} with a word missing, ${tally.unfinished} unfinished, ${tally['a space after']} by a space after, ${wrong.length} otherwise different`)

// Named examples, said plainly (each is also among the readings above).
const mine = shelves['made up'].lib
const ghost = async (t) => (await mine.guess(t))?.entry.name ?? null, enter = async (t) => (await mine.find(t))?.name ?? null
for (const [t, g, e] of [
  ['tesla', 'Tesla Model 3', 'Tesla Model 3'], ['a tesla', 'Tesla Model 3', 'Tesla Model 3'], ['stall', 'market stall with striped awning', 'market stall with striped awning'],
  ['a market', 'market stall with striped awning', 'market stall with striped awning'], ['striped', 'market stall with striped awning', 'market stall with striped awning'], ['model', 'Tesla Model 3', 'Tesla Model 3'],
  ['bmw m2', null, null], ['f1 car', null, null], ['a red car', null, null], ['a big tree', null, null], ['with', null, null], ['the', null, null],
  ['make it drivable', null, null], ['make it water', null, null], ['paint it red', null, null], ['make these flowers', null, null], ['make that castle', null, null],
  ['those trees', 'broad-crowned tree', 'broad-crowned tree'], ['a ca', 'blue saloon car', 'blue saloon car'],
]) { const [gg, ee] = [await ghost(t), await enter(t)]; check(gg === g && ee === e, `"${t}": ghost ${gg ?? 'nothing'}, Enter ${ee ?? 'nothing'}`) }
// As the shelf was when each was typed on November 16: "f1 car" and "water" with the two cars and the waterball on it
// (and what comes with the engine), "make it drivable" once "make it water" was kept too. Enter makes none of them.
const shelfOf = (name, wishes) => {
  const to = join(dir, name)
  mkdirSync(to)
  for (const n of readdirSync(shelfDir)) if (wishes.includes(JSON.parse(readFileSync(join(shelfDir, n), 'utf8')).wish)) writeFileSync(join(to, n), readFileSync(join(shelfDir, n)))
  return library(to)
}
const then = shelfOf('then', ['a BMW X3', 'a Tesla Model 3', 'waterball']), before = shelfOf('before', ['a BMW X3', 'a Tesla Model 3', 'waterball', 'make it water'])
for (const [at, words] of [[then, 'f1 car'], [then, 'water'], [before, 'make it drivable']]) {
  const found = (await at.find(words))?.name ?? null
  check(!found, `on the shelf as it was then, Enter on "${words}" makes nothing kept (${found ?? 'nothing kept'})`)
}
for (const wish of ['make it drivable', 'paint it red']) await library(keeps, []).keep(wish, '', '{}', { name: 'a stand-in', model: 'stand-in' })
check(readdirSync(keeps).length === 0, 'words that change a thing are never kept as if they named one')
for (const wish of ['these flowers', 'make that castle']) await library(keeps, []).keep(wish, '', '{}', { name: 'a stand-in', model: 'stand-in' })
check(readdirSync(keeps).length === 2, `"these flowers" and "make that castle" are kept, under "${wordsOf('these flowers').join(' ')}" and "${wordsOf('make that castle').join(' ')}"`)

// A ghost and Enter mean one thing (#220, review of 7f122f7b): after other words a half-typed word is still read by
// both, and a word alone that lacks too much is read by neither.
for (const [t, want] of [['a car sal', 'blue saloon car'], ['a car sal ', 'blue saloon car'], ['3 ', null], ['3', null], ['a woo', null], ['a wood', 'wooden farmhouse chair'], ['water', null], ['waterba', 'inflatable waterball']]) {
  const [gg, ee] = [await ghost(t), await enter(t)]
  check(gg === want && ee === want, `"${t}": the ghost shows ${gg ?? 'nothing'} and Enter makes ${ee ?? 'nothing'} (${want ?? 'nothing'})`)
}
// A wish is filed under the words it always was (review of 7f122f7b): a copy of one's own beside what comes with the
// engine answers (asked anew with Shift and Enter, the stall was kept under other words than the shipped one, and
// then neither answered), and a thing kept before under its joining words is found and kept again in the one file.
{
  const own = join(dir, 'own'), lib = library(own), wish = 'a market stall with a striped awning'
  const shipped = entriesOf(SHIPPED).find((e) => e.wish === wish)
  check(!!shipped, `what comes with the engine holds "${wish}"`)
  await lib.keep(wish, '', shipped?.reply ?? shipped?.made ?? '{}', { name: 'striped stall of my own', model: 'stand-in', form: shipped?.form })
  const kept = JSON.parse(readFileSync(join(own, readdirSync(own)[0]), 'utf8'))
  check(kept.words.join(' ') === shipped?.words.join(' '), `kept anew, it is under the words the shipped one is: "${kept.words.join(' ')}"`)
  for (const t of [wish, 'market st', 'stall']) { const g = (await lib.guess(t))?.entry, e = await lib.find(t); check(g?.mine === true && e?.mine === true, `"${t}" with one's own copy beside the shipped one: the ghost ${g ? (g.mine ? 'one\'s own' : 'the shipped') : 'nothing'}, Enter ${e ? (e.mine ? 'one\'s own' : 'the shipped') : 'nothing'}`) }
  await lib.keep(wish, '', shipped?.reply ?? shipped?.made ?? '{}', { name: 'striped stall of my own', model: 'stand-in', form: shipped?.form })
  check(readdirSync(own).length === 1, `kept again, it is one file still (${readdirSync(own).length})`)
}

// `--meaning`: the words alone, with no world or helper.
if (process.argv.includes('--meaning')) { rmSync(dir, { recursive: true, force: true }); console.log(failures.length ? `\n${failures.length} failed` : '\nall passed'); process.exit(failures.length ? 1 : 0) }

// ── The helper and a world of its own ─────────────────────────────────────────────────────────────────────────────
const server = await serve('/dev/null', ['--world', join(dir, 'world.log')])
const journal = join(dir, 'made.jsonl')
let asked = 0
const standin = async () => { asked++; throw new Error('no model is run here') }
// One helper with a model to write programs at once (`first`, as the bar runs), one with only a model of parts.
const h = await helper({ world: server.url, port: 0, model: standin, first: standin, journal, kept: shelfDir })
const plain = await helper({ world: server.url, port: 0, model: standin, journal, kept: shelfDir })
await Promise.all([h.warm, plain.warm])
const post = async (at, path, body) => { const r = await fetch(`${at.url}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-village-secret': at.secret }, body: JSON.stringify(body) }); return path === '/kept' ? r.json() : (await r.text()).trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) }
const lines = () => readFileSync(journal, 'utf8').trim().split('\n').map((l) => JSON.parse(l))
const made = (id) => Object.assign({}, ...lines().filter((l) => l.id === id))
/** The box a thing's rows fill across the ground: [x0, z0, x1, z1]. */
const box = (rows) => rows.reduce((b, r) => [Math.min(b[0], r[0]), Math.min(b[1], r[3]), Math.max(b[2], r[1]), Math.max(b[3], r[3] + 1)], [Infinity, Infinity, -Infinity, -Infinity])
const apart = (a, b) => a[2] <= b[0] || b[2] <= a[0] || a[3] <= b[1] || b[3] <= a[1]
// Where the eye is: 5 m back from a place on the main street and 4.6 m up, looking down at it.
const from = (x, z) => ({ eye: [x, 200, z + 50], toward: [0, -0.35, -1] })
let x = 300
try {
  // Enter with the ghost's id and without it (sent before the ghost's answer came) make the same thing, with no model.
  for (const words of ['bmw', 'a ca']) {
    const at = (x += 300), ghost = await post(h, '/kept', { words, from: from(at, 4070) })
    const slow = (await post(h, '/ask', { wish: words, kept: ghost.id, from: from(at, 4070), by: 'Rhea' })).at(-1)
    const fast = (await post(h, '/ask', { wish: words, from: from((x += 300), 4070), by: 'Rhea' })).at(-1)
    check(ghost.id && slow.state === 'there' && fast.state === 'there' && slow.name === ghost.name && fast.name === ghost.name && asked === 0, `"${words}": the ghost shows ${ghost.name ?? 'nothing'}; Enter after it makes ${slow.name ?? slow.why}, Enter before it ${fast.name ?? fast.why}; models asked ${asked}`)
  }
  // A ghost's id the words as sent do not name is not made: "bmw m2" with the X3's id goes on to the model.
  const x3 = await post(h, '/kept', { words: 'bmw', from: from((x += 300), 4070) }), before = asked
  const m2 = (await post(h, '/ask', { wish: 'bmw m2', kept: x3.id, from: from(x, 4070), by: 'Rhea' })).at(-1)
  check(m2.name !== 'BMW X3' && asked > before, `"bmw m2" sent with the X3's ghost id is not the X3: ${m2.state}${m2.name ? ` ${m2.name}` : ''}, models asked ${asked - before}`)
  // What the words mean does not hang on where the eye is: aimed at open water to the west, where no ground near will take a car, the saloon is named with no place.
  const saloon = await post(h, '/kept', { words: 'a car', from: from((x += 300), 4070) }), nowhere = await post(h, '/kept', { words: 'a car', from: { eye: [-3000, 194, -900], toward: [0, -1, 0] } })
  check(saloon.at && nowhere.id === saloon.id && !nowhere.at, `"a car" aimed where there is no place for it is still the saloon, with no place (${nowhere.name ?? 'nothing'}, at ${nowhere.at ?? 'none'})`)
  // Never refused: wishes to change a thing and wishes nothing kept answers go to the model, on both helpers.
  for (const [at, which] of [[h, 'with a quick model'], [plain, 'with a model of parts only']]) {
    // ("make it drivable" too, aimed where no made thing of the asker's stands: #245 brings only that to life.)
    for (const wish of ['make it drivable', 'make it water', 'make it 10x large', 'these flowers', 'make it rain', 'paint it red', 'water', 'f1 car']) {
      const was = asked, done = (await post(at, '/ask', { wish, from: from((x += 300), 4070), by: 'Rhea' })).at(-1)
      check(asked > was && !/change something/.test(done.why ?? '') && done.name === undefined, `${which}, "${wish}" goes to the model (models asked ${asked - was}: ${done.state}, ${done.why})`)
    }
  }

  // make.mjs --at: an X3, then a Tesla 17 cells from it across the street (a car's body is 18 cells wide).
  const node = (wish, at) => spawnSync('node', ['make.mjs', wish, '--world', server.url, '--at', at, '--facing', 'east', '--library', shelfDir, '--journal', journal, '--by', 'Rhea'], { cwd: here, encoding: 'utf8' })
  const runs = [node('a bmw x3', '770,4074'), node('a tesla model 3', '770,4057')]
  const [one, two] = lines().filter((l) => l.state === 'sending').slice(-2).map((l) => made(l.id))
  check(one.name === 'BMW X3' && two.name === 'Tesla Model 3' && one.state === 'there' && two.state === 'there', `both are made from what is kept: ${one.name} ${one.state}, ${two.name} ${two.state}${runs.some((r) => r.status) ? ` (${runs.map((r) => r.stdout.trim().split('\n').at(-1)).join('; ')})` : ''}`)
  check(one.rows && two.rows && apart(box(one.rows), box(two.rows)), `by make.mjs --at, the Tesla is stood clear of the living X3: X3 ${one.rows ? box(one.rows).join(',') : '-'}, Tesla ${two.rows ? box(two.rows).join(',') : '-'}`)
  // From the bar: a Tesla asked for where the eye looks straight at that X3 is stood beside it, not in it.
  const fb = box(one.rows), mid = [(fb[0] + fb[2]) / 2, one.origin[1], (fb[1] + fb[3]) / 2], eye = [mid[0], mid[1] + 30, mid[2] + 60], to = mid.map((v, a) => v - eye[a])
  const bar = (await post(h, '/ask', { wish: 'a tesla model 3', from: { eye, toward: to.map((v) => v / Math.hypot(...to)) }, by: 'Rhea' })).at(-1)
  const bt = made(lines().filter((l) => l.wish === 'a tesla model 3' && l.state === 'sending').at(-1)?.id)
  check(bar.state === 'there' && bt.rows && apart(fb, box(bt.rows)) && apart(box(two.rows), box(bt.rows)), `from the bar, aimed at the living X3, the Tesla stands clear of both cars: ${bar.state}, X3 ${fb.join(',')}, Tesla ${bt.rows ? box(bt.rows).join(',') : '-'}`)
} finally {
  await h.close()
  await plain.close()
  server.stop()
  rmSync(dir, { recursive: true, force: true })
}
console.log(failures.length ? `\n${failures.length} failed` : '\nall passed')
process.exit(failures.length ? 1 : 0)
