// A thing drawn and carved (#245). A wish that nothing kept answers is drawn: an image model draws one sheet of the
// thing from five sides (left, right, front, rear, top, no perspective), and the builder carves and paints cells from
// those views (draw/sheet.py). What a picture cannot say (how big it is, what it is made of, whether it is driven
// and how fast such a thing goes, and whether it is a thing to draw at all) a model says beside it, at the same
// time (`FACTS`). The cells go into the world as any reply of cells goes (make.mjs), a driven one alive
// (make/drivable.mjs), and are kept on the asker's shelf, so the same words stand at once the next time.
//
//   the drawer   fal.ai's nano-banana-2, words only, through its sync API (.agents/skills/fal-model-api): `falDrawer`
//   the facts    the asker's own Claude Code, the quick model (make/model.mjs), one short JSON reply
//   the builder  draw/build.py through uv, started when the wish is, so its imports are done while the picture is drawn
//
// With no drawer (no key), a drawer that fails or draws what will not build, or a model that says it is not a thing
// to draw, nothing is sent and `drawn` resolves to null with why: the wish goes the way it went before.
import { execFile, spawn } from 'node:child_process'
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { palette } from '../page/march.ts'
import { written } from './cells.mjs'
import { OWN_FRONT, bodyOf, driven } from './drivable.mjs'
import { MATERIALS, drivesOf, fieldKeys } from './form.mjs'
import { towards } from './place.mjs'

const here = dirname(fileURLToPath(import.meta.url)), DRAW = join(here, '..', 'draw')

/** What the drawer is asked: the bench's sheet (fal5.py), the asker's words after it. */
export const SHEET = 'An orthographic turnaround sheet for a 3D modeller: five views of the one thing, all drawn at exactly the same scale, ' +
  'with no perspective at all (parallel projection), on a plain pure white background, with no shadows, no ground, no ' +
  'reflections of surroundings, no text, no labels, no lines or borders. Layout, with clear white gaps between views: ' +
  'top row: LEFT side view (its front pointing left) and RIGHT side view (its front pointing right). Middle row: FRONT ' +
  'view and REAR view. Bottom row: TOP view seen from straight above, its front pointing left. Even, soft studio light ' +
  'so every surface shows its own colour. Photorealistic. Landscape image. ' +
  // Added November 17 (#245): of six sheets drawn for this lane, one had seven views, one six, one overlapping views,
  // and one side views as wide as its front view. Said again, plainly:
  'Exactly five drawings and nothing else on the sheet: never a sixth view, never a view twice, no words. Each view shows ' +
  'the whole thing once, apart from the others, never overlapping. The side views and the top view show its full length ' +
  'from front to back; the front and rear views show its width.'
export const ENDPOINT = 'fal-ai/nano-banana-2'

/** The materials a drawn thing may be made of: one for all its cells (a second picture would say which part is which: not yet). */
const STUFF = ['wood', 'steel', 'rock', 'concrete', 'brick', 'plaster', 'glass', 'leaves', 'sand', 'earth']

/** What the model beside the picture is told. */
export const FACTS = `You answer with one JSON object and nothing else: no words round it, no code fence.

Someone typed a wish for a thing to be made in a game world built of small cubes. While you answer, a picture of the thing is drawn from five sides (left, right, front, rear, above) and carved into cubes, one solid shape painted from the picture. The picture cannot say how big the thing is, what it is made of or how it moves: you say that.

{"draw": true, "name": "red racing car", "size_m": [2.0, 0.95, 5.6], "material": "steel", "drives": {"top_kmh": 330, "zero_to_100_s": 2.6}}

- "draw": true when the wish is one solid thing that a picture can show whole and that needs nothing but its shape: a car, a chair, a statue, a boat, a bench, a tractor, a tree, a guitar. false when it is several things or a place (a forest, a street, a garden), a building one goes inside, a change to something already there, something to do or to happen, or a thing that must work in a way a picture cannot give it: light up, open and close, pour, fly, shoot, play. With false, give nothing else.
- "name": what it is, in two to five plain words, lower case.
- "size_m": [width from side to side, height, length from front to back] in metres, as such a thing truly is. No side over 25.
- "material": what most of it is made of: one of ${STUFF.join(', ')}.
- "drives": for a thing a person gets into or onto and drives on wheels (a car, a truck, a bus, a kart, a tractor, a motorbike): {"top_kmh": its top speed, "zero_to_100_s": seconds from 0 to 100 km/h, or 60 if it never gets there}, as such a thing really goes. Otherwise false.`

/** The longest side a drawn thing may have (m), and the cell it is carved in for its size: as fine as 256 cells along its longest side allow. */
const LONGEST = 25.6
const cmFor = (m) => (m <= 1.6 ? 1.25 : m <= 6.4 ? 2.5 : m <= 12.8 ? 5 : 10)
/** How far a drawn thing's proportions may be from the size the model said (a factor), before the drawing is taken to be of something else, or of views that do not agree. */
const UNLIKE = 1.8
/** How long the drawer, the model and the builder may take (ms). */
const DRAW_MOST = 60_000, FACTS_MOST = 45_000, BUILD_MOST = 20_000

/** The fal key: FAL_KEY, else this Mac's login Keychain (service village-fal). Read when asked, never kept or printed. Resolves to the key or null. */
export async function falKey() {
  if (process.env.FAL_KEY) return process.env.FAL_KEY
  if (process.platform !== 'darwin') return null
  return new Promise((resolve) => execFile('security', ['find-generic-password', '-a', process.env.USER ?? '', '-s', 'village-fal', '-w'], { timeout: 5000 }, (e, out) => resolve(e ? null : out.trim() || null)))
}

/**
 * The drawer: fal's sync API, words only (.agents/skills/fal-model-api). Resolves to a function (words, signal) to
 * { png: Buffer, ms, model }, or null when there is no key. The key is read for each call and sent only to fal.
 */
export async function falDrawer({ endpoint = ENDPOINT, key = falKey } = {}) {
  if (!(await key())) return null
  return async (words, signal) => {
    const k = await key()
    if (!k) throw new Error('no fal key')
    const began = Date.now()
    const r = await fetch(`https://fal.run/${endpoint}`, {
      method: 'POST', signal,
      headers: { Authorization: `Key ${k}`, 'Content-Type': 'application/json', 'X-Fal-Store-IO': '0' },
      body: JSON.stringify({ prompt: `${SHEET} The thing is: ${words}.`, aspect_ratio: '3:2', resolution: '1K', output_format: 'png', sync_mode: true }),
    })
    if (!r.ok) throw new Error(`the drawer answered ${r.status}`)
    // Its answer is data: read up to a size, and a picture is fetched only from fal's own store, with no redirect followed.
    let url
    try { url = JSON.parse((await capped(r, ANSWER_MOST)).toString('utf8'))?.images?.[0]?.url } catch { throw new Error('the drawer\'s answer could not be read') }      // nothing of the answer itself goes into what is said or logged
    if (typeof url !== 'string') throw new Error('the drawer drew nothing')
    let png
    if (url.startsWith('data:')) png = Buffer.from(url.slice(url.indexOf(',') + 1), 'base64')
    else {
      if (!falsOwn(url)) throw new Error('the drawer named a picture that is not in its own store')
      const got = await fetch(url, { signal, redirect: 'error' })
      if (!got.ok) throw new Error(`the picture answered ${got.status}`)
      png = await capped(got, PICTURE_MOST)
    }
    if (png.length > PICTURE_MOST) throw new Error('the picture is too big')
    return { png, ms: Date.now() - began, model: endpoint }
  }
}

/** The most of fal's answer and of a picture that is read (bytes): a sheet of 1K is about 1 MB, 1.4 MB as a data URI. */
const ANSWER_MOST = 24 << 20, PICTURE_MOST = 16 << 20
/** A response's body, read up to `most` bytes: more is refused, not read. */
async function capped(res, most) {
  if (Number(res.headers.get('content-length')) > most) throw new Error('too big')
  const parts = []
  let n = 0
  for await (const part of res.body) { n += part.length; if (n > most) throw new Error('too big'); parts.push(part) }
  return Buffer.concat(parts)
}
/** Whether an address is a file in fal's own store (https, fal.media or a host under it). */
export const falsOwn = (url) => { try { const u = new URL(url); return u.protocol === 'https:' && (u.hostname === 'fal.media' || u.hostname.endsWith('.fal.media')) } catch { return false } }

/** The model's facts, checked: { draw: false } or { draw: true, name, size: [w, h, l] in m, material, drives: {...} | null }. Throws with why. */
export function factsOf(text) {
  const t = String(text).trim().replace(/^```(json)?\s*|\s*```$/g, '')
  let f
  try { f = JSON.parse(t.slice(t.indexOf('{'), t.lastIndexOf('}') + 1)) } catch { throw new Error('the facts are not JSON') }
  if (!f || typeof f !== 'object') throw new Error('the facts are not an object')
  if (f.draw !== true) return { draw: false }
  const size = f.size_m
  if (!Array.isArray(size) || size.length !== 3 || !size.every((v) => typeof v === 'number' && v >= 0.03 && v <= LONGEST)) throw new Error(`size_m is three lengths in metres, none over ${LONGEST}`)
  const name = typeof f.name === 'string' && f.name.trim() ? f.name.trim().slice(0, 60) : null
  if (!name) throw new Error('name is a few words')
  const material = STUFF.includes(f.material) ? f.material : 'plaster'
  let drives = null
  if (f.drives && typeof f.drives === 'object') { try { drives = drivesOf({ top_kmh: f.drives.top_kmh, zero_to_100_s: Math.min(60, f.drives.zero_to_100_s) }) } catch { drives = {} } }
  return { draw: true, name, size, material, drives }
}

/**
 * The builder, started now: uv runs draw/build.py, which imports what it needs and waits for one sheet. `build(sheet,
 * long, out)` resolves to what it found ({ size, turned, views_agree, ... } or { why }). `stop()` ends it unused.
 * It is started with no key in its environment.
 */
export function builder({ uv = 'uv' } = {}) {
  const env = Object.fromEntries(['HOME', 'PATH', 'USER', 'LOGNAME', 'TMPDIR', 'LANG'].filter((k) => process.env[k] !== undefined).map((k) => [k, process.env[k]]))
  const child = spawn(uv, ['run', '--quiet', '--project', DRAW, 'python', join(DRAW, 'build.py')], { cwd: DRAW, env, stdio: ['pipe', 'pipe', 'pipe'] })
  let out = '', err = ''
  child.stdout.on('data', (c) => { out += c })
  child.stderr.on('data', (c) => { err += c })
  child.stdin.on('error', () => {})
  const ended = new Promise((resolve) => { child.on('error', (e) => { err += e.message; resolve(-1) }); child.on('close', resolve) })
  return {
    async build(sheet, long, to) {
      child.stdin.end(JSON.stringify({ sheet, long, out: to }) + '\n')
      const timer = setTimeout(() => child.kill('SIGTERM'), BUILD_MOST)
      const code = await ended.finally(() => clearTimeout(timer))
      try { return JSON.parse(out.trim().split('\n').at(-1)) } catch { return { why: `the builder stopped (${code}): ${err.trim().split('\n').at(-1)?.slice(0, 160) ?? ''}` } }
    },
    stop() { child.stdin.end(); child.kill('SIGTERM') },
  }
}

/** Each colour's nearest of the world's 255 (page/march.ts `palette`), in OKLab, from a table of 32 by 32 by 32 made once. */
let table = null
function nearest() {
  if (table) return table
  const lab = (r, g, b) => {
    const lin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
    const [R, G, B] = [lin(r), lin(g), lin(b)]
    const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B), m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B), s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B)
    return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s]
  }
  // The palette is kept as the page lights it (each value raised to 2.2): as it is seen, it is that value's 2.2th root.
  const p = palette(), labs = []
  for (let i = 1; i < 256; i++) labs.push(lab(p[i * 4] ** (1 / 2.2), p[i * 4 + 1] ** (1 / 2.2), p[i * 4 + 2] ** (1 / 2.2)))
  table = new Uint8Array(32 * 32 * 32)
  for (let r = 0; r < 32; r++) for (let g = 0; g < 32; g++) for (let b = 0; b < 32; b++) {
    const q = lab((r + 0.5) / 32, (g + 0.5) / 32, (b + 0.5) / 32)
    let best = 0, near = Infinity
    for (let i = 0; i < labs.length; i++) { const d = (q[0] - labs[i][0]) ** 2 + (q[1] - labs[i][1]) ** 2 + (q[2] - labs[i][2]) ** 2; if (d < near) { near = d; best = i + 1 } }
    table[(r * 32 + g) * 32 + b] = best
  }
  return table
}

/** The builder's bytes (red, green, blue, filled: four to a cell, in a reply's order) as kinds of one material. */
export function kindsOf(bytes, material) {
  const t = nearest(), m = MATERIALS[material], cells = new Uint16Array(bytes.length / 4)
  for (let i = 0, j = 0; i < cells.length; i++, j += 4) if (bytes[j + 3]) cells[i] = m | (t[((bytes[j] >> 3) * 32 + (bytes[j + 1] >> 3)) * 32 + (bytes[j + 2] >> 3)] << 8)
  return cells
}

/**
 * Whether a carved thing ([w, h, l] in cells) is not the shape of the size the model said ([w, h, l] in m): views that
 * disagree, a plinth of shadow or another thing drawn come out another shape. Its height, and its two sides along the
 * ground longer and shorter, each within a factor of UNLIKE: which of those is its front is the drawing's to say (a
 * model may call a bench's long side its width or its length).
 */
export function unlike([W, H, L], [wm, hm, lm]) {
  const built = [Math.max(W, L), H, Math.min(W, L)], said = [Math.max(wm, lm), hm, Math.min(wm, lm)]
  const s = Math.max(...built) / Math.max(...said)
  return Math.max(...built.map((v, a) => Math.abs(Math.log(v / s / said[a])))) > Math.log(UNLIKE)
}

/** A promise that gives up after `ms`, with why. */
const within = (p, ms, why) => Promise.race([p, new Promise((_, no) => setTimeout(() => no(new Error(why)), ms).unref())])

/**
 * Draws a wish and makes it (make.mjs `make`, as a reply of cells). `draw` is the drawer ((words, signal) to { png,
 * ms, model }), `know` how the model beside it is asked ({ system, prompt } to { text, ms }), `make` and `ground` are
 * make.mjs's (passed in: make.mjs imports this). `sheets`: a folder where each sheet drawn is kept, with what was
 * asked and found (for looking at by hand). Resolves to { made, text, entry, times } when it was sent (whatever the
 * world said), or null with `why` when nothing was sent and the wish should go the way it went before.
 * `say(words, stage)` hears how it goes: { stage: 'place' }, { stage: 'drawing' }, { stage: 'shaped' }, then make's.
 */
export async function drawn({ wish, world, where, facing, by, journal, draw, know, make, ground, shelf, sheets, say = () => {} }) {
  const t0 = Date.now(), times = {}, tell = (why) => ({ made: null, why, times })
  const dir = await mkdtemp(join(tmpdir(), 'drawn-'))
  const build = builder(), stop = new AbortController()
  try {
    // Where it goes, said at once: what covers the wait gathers there while it is drawn.
    const found = await ground(world, where)
    if (found.why) return tell(found.why)
    facing ??= found.eye ? towards(found.spot, found.eye) : 'south'
    say('drawing it from five sides', { stage: 'drawing' })
    say('a place was found', { stage: 'place', at: found.spot, facing })
    const picture = within(draw(wish, stop.signal), DRAW_MOST, 'the drawer took too long').then((p) => { times.picture = Date.now() - t0; return p })
    const facts = within(know({ system: FACTS, prompt: `The wish: ${wish}` }), FACTS_MOST, 'the model took too long').then((r) => { times.model = Date.now() - t0; return { ...factsOf(r.text), ms: r.ms } })
    picture.catch(() => {})
    let f
    try { f = await facts } catch (e) { stop.abort(); return tell(`the facts: ${e.message}`) }
    if (!f.draw) { stop.abort(); return tell('the model says it is not a thing to draw') }
    // Its size is known before its picture: what covers the wait closes into a box of that size.
    const [wm, hm, lm] = f.size, cm = cmFor(Math.max(...f.size))
    say(`drawing ${f.name}`, { stage: 'shaped', name: f.name, size: [wm, hm, lm].map((v) => Math.max(1, Math.round(v * 10))), facing })
    let p
    try { p = await picture } catch (e) { return tell(`the drawer: ${e.message}`) }
    const sheet = join(dir, 'sheet.png')
    await writeFile(sheet, p.png)
    let kept = null
    if (sheets) { kept = join(sheets, `${new Date().toISOString().replace(/[:.]/g, '-')}-${wish.replace(/[^a-z0-9]+/gi, '-').slice(0, 40)}`); await mkdir(kept, { recursive: true }); await copyFile(sheet, join(kept, 'sheet.png')) }
    // Carved along its longest side in as many cells as its size and cell say.
    const long = Math.min(256, Math.round((Math.max(...f.size) * 100) / cm))
    say(`carving ${f.name} from the drawing`, { stage: 'carving', name: f.name })
    const b = await build.build(sheet, long, join(dir, 'cells.bin'))
    times.build = Date.now() - t0
    if (kept) await writeFile(join(kept, 'found.json'), JSON.stringify({ wish, facts: f, built: b, times, drawer: p.model }, null, 1))
    if (b.why) return tell(b.why)
    if (unlike(b.size, f.size)) return tell(`the drawing is not the shape of ${f.name}: ${b.size.join(' by ')} cells against ${f.size.join(' by ')} m`)
    const cells = kindsOf(await readFile(join(dir, 'cells.bin')), f.material)
    const thing = { name: f.name, size: b.size, cm, cells }
    // Driven: brought to life from its cells, nose first (z 0, as the builder turned it; not known when the view from
    // above was drawn turned round), its eye over what it is: a drawing has no inside to sit in.
    let text
    if (f.drives) {
      try {
        const r = await driven({ name: f.name, size: b.size, cm, cells: bodyOf(thing), front: b.front_low === null ? undefined : OWN_FRONT['-z'], asked: f.drives, open: true })
        text = r.text
        // Nobody could tell its front (the view from above did not say, and a drawing has no lamps to go by): the person is told, as for a made thing brought to life.
        if (r.unsure) say(r.unsure, { stage: 'note', why: r.unsure })
      } catch (e) { say(`it stands as it is: ${e.message}`, { stage: 'note', why: `it stands as it is: ${e.message}` }) }
    }
    text ??= written(thing)
    times.cells = Date.now() - t0
    const model = `drawn by ${p.model}, its facts by ${f.ms !== undefined ? 'the quick model' : 'a model'}`
    const made = await make({ wish, world, where, facing, by, journal, how: 'cells', model: async () => ({ text, model, ms: Date.now() - t0, cost: 0 }), tries: 1, say: (words, stage) => stage?.stage !== 'asking' && say(words, stage) })
    times.made = Date.now() - t0
    // Sent, whatever the world said of it: it is not made again some other way. Nothing was sent: the wish goes on as before.
    if (made.state === 'refused') return tell(`not made: ${made.why}`)
    let entry = null
    if (shelf && ['there', 'held'].includes(made.state)) {
      entry = { name: f.name, model, fields: fieldKeys(), form: 'cells', grade: 'best', made: text, stands: made.state === 'there' && !made.left }
      await shelf.keep(wish, '', text, entry).catch((e) => say(`not kept: ${e.message}`))
    }
    if (kept) await writeFile(join(kept, 'found.json'), JSON.stringify({ wish, facts: f, built: b, times, drawer: p.model, state: made.state, why: made.why }, null, 1))
    return { made, text, entry, times }
  } finally {
    stop.abort()
    build.stop()
    await rm(dir, { recursive: true, force: true })
  }
}
