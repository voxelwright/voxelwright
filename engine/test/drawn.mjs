// A thing drawn and carved (#245, make/drawn.mjs). The real page in Chrome, a shared world of its own, and the
// helper with stand-ins: a drawer that serves a sheet kept on disk (test/drawn/racer.jpg, test/drawn/hydrant.jpg:
// two sheets fal drew for made-up words on November 16) and a model that says the facts a picture cannot. The
// builder is the real one (draw/build.py through uv). A wish that nothing kept answers is drawn, built and stands;
// a car wished for stands alive, E gets on, W takes it nose first (the end its tall rear wing is not at), and V puts
// the eye where it sees the road, not inside the drawing's shell. Typed again, it stands at once from the shelf,
// with no drawer and no model asked. With no drawer, with a drawer that fails, and with words the model says are no
// thing to draw, the wish is made as before (by the stand-in for the maker's model), and the place is told nothing
// of the drawing. A change to a thing is not drawn. A drawing is paid for: a rule's wish (words nobody typed) is never
// drawn, words whose drawing did not stand are not drawn again, and a helper draws no more in a day than it is told.
// NO MODEL AND NO DRAWER IS RUN: the stand-ins prove the joining, not what fal draws or what a real model says.
//
//   node test/drawn.mjs [--out dir]      dir: the drawn car beside the person, from behind while driven, from its seat; the hydrant
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { helper } from '../helper.mjs'
import { undo } from '../make.mjs'
import { falsOwn } from '../make/drawn.mjs'
import { arg, chrome, here, serve } from './kit.mjs'

const failures = []
const check = (ok, what) => { console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) failures.push(what) }
const dir = mkdtempSync(join(tmpdir(), 'engine-drawn-')), out = arg('out', '') && resolve(arg('out', ''))
if (out) mkdirSync(out, { recursive: true })
const RACER = readFileSync(join(here, 'test/drawn/racer.jpg')), HYDRANT = readFileSync(join(here, 'test/drawn/hydrant.jpg'))
/** What the stand-in for the maker's model makes, when a wish is not drawn: a plain grey box, its name saying which wish. */
const BOX = (name) => JSON.stringify({ name, size: [8, 8, 8], parts: [['box', 'concrete', 'grey:6', 0, 0, 0, 8, 8, 8]] })

const server = await serve('/dev/null', ['--world', join(dir, 'world.log')])
const journal = join(dir, 'made.jsonl')
const asked = { draw: 0, know: 0, model: 0 }
const t00 = Date.now(), log = process.env.DEBUG ? (w) => console.log(`    helper ${((Date.now() - t00) / 1000).toFixed(1)}: ${w}`) : () => {}
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
/** The drawer: a sheet from disk for the racing car and the hydrant, a little later than at once (so the wait can be seen), and a failure for anything else. */
const draw = async (words) => {
  asked.draw++
  await wait(1500)
  if (/racing car/.test(words)) return { png: RACER, ms: 1500, model: 'a sheet kept on disk' }
  if (/hydrant/.test(words)) return { png: HYDRANT, ms: 1500, model: 'a sheet kept on disk' }
  throw new Error('the stand-in drawer has nothing for that')
}
/** The model beside it: the facts of each wish, as a real one would say them. */
const know = async ({ prompt }) => {
  asked.know++
  const w = prompt.toLowerCase()
  const facts = /racing car/.test(w) ? { draw: true, name: 'yellow racing car', size_m: [2.0, 1.0, 5.0], material: 'steel', drives: { top_kmh: 300, zero_to_100_s: 3 } }
    : /hydrant/.test(w) ? { draw: true, name: 'red fire hydrant', size_m: [0.6, 0.9, 0.6], material: 'steel', drives: false }
      : /lamp/.test(w) ? { draw: false } : { draw: true, name: 'a thing', size_m: [1, 1, 1], material: 'wood', drives: false }
  return { text: JSON.stringify(facts), model: 'a stand-in', ms: 0, cost: 0 }
}
const model = async ({ prompt }) => { asked.model++; return { text: BOX(/lamp/.test(prompt) ? 'glowing lamp box' : /bus/.test(prompt) ? 'blue bus box' : /broken/.test(prompt) ? 'broken teapot box' : 'some box'), model: 'a stand-in', ms: 0, cost: 0 } }
const d = await helper({ world: server.url, port: 0, journal, say: log, kept: join(dir, 'shelf'), model, draw, know })
const n = await helper({ world: server.url, port: 0, journal, say: log, kept: join(dir, 'shelf-n'), model })
const m = await helper({ world: server.url, port: 0, journal, say: log, kept: join(dir, 'shelf-m'), model, draw, know, drawMost: 1 })
await Promise.all([d.warm, n.warm, m.warm])
const things = () => fetch(`${server.url}/world/things`).then((r) => r.json())

/** A living thing's look as the world keeps it: its first part's size, kinds and where it lies in the body's cells. */
async function lookOf(t) {
  const f = t.controls.fine[0], bytes = new Uint8Array(await (await fetch(`${server.url}/world/fine/${f.kept}`)).arrayBuffer())
  return { ...f, kinds: new Uint16Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 2) }
}
/**
 * Which way its nose points, from its look alone: the end of its longer side whose tallest cell is lower (a racing
 * car's nose is low, its rear wing tall). In the look's own axes, as the world lays the body (x, z).
 */
function noseOf(look) {
  const [w, h, d] = look.size, along = w > d ? 0 : 2, n = along === 0 ? w : d, end = Math.floor(n / 6), top = [0, 0]
  for (let y = 0, i = 0; y < h; y++) for (let z = 0; z < d; z++) for (let x = 0; x < w; x++, i++) if (look.kinds[i]) { const l = along === 0 ? x : z; if (l < end) top[0] = Math.max(top[0], y); if (l >= n - end) top[1] = Math.max(top[1], y) }
  const sign = top[0] < top[1] ? -1 : 1
  return { way: along === 0 ? [sign, 0] : [0, sign], top }
}
/** Whether the eye sees out ahead: straight ahead and ten degrees down, until it leaves the look's box, it meets no cell of the thing. */
function seesAhead(look, eye, way) {
  const [w, h, d] = look.size, per = look.per, at = (x, y, z) => (x < 0 || y < 0 || z < 0 || x >= w || y >= h || z >= d ? -1 : look.kinds[(y * d + z) * w + x])
  const from = [(eye[0] - look.low[0]) * per, (eye[1] - look.low[1]) * per, (eye[2] - look.low[2]) * per]
  const met = []
  for (const down of [0, Math.tan((10 * Math.PI) / 180)]) {
    let hit = 0
    for (let s = 0; s < 4 * Math.max(w, h, d); s += 0.5) {
      const k = at(Math.floor(from[0] + way[0] * s), Math.floor(from[1] - down * s), Math.floor(from[2] + way[1] * s))
      if (k < 0) break
      if (k) hit++
    }
    met.push(hit)
  }
  return met
}

// The builder alone: a sheet whose side views draw the front to the right (as the drawer now and then does) is turned
// so its front is at z 0, and its front end is painted from its front view, as the same sheet drawn as asked is.
{
  const r = spawnSync('uv', ['run', '--quiet', '--project', 'draw', 'python', 'draw/check.py', 'test/drawn/racer.jpg'], { cwd: here, encoding: 'utf8' })
  check(r.status === 0, `a sheet drawn the other way round is turned, and its front end painted from its front view: ${r.stdout.trim().replace(/\n/g, ' ')}${r.stderr ? ` ${r.stderr.trim().split('\n').at(-1)}` : ''}`)
}

// What the drawer's answer may make the helper fetch: a file in fal's own store over https, and nothing else.
check(falsOwn('https://v3.fal.media/files/a/b.png') && falsOwn('https://fal.media/files/a.png') && !['http://fal.media/a.png', 'https://fal.media.example.com/a.png', 'https://127.0.0.1:5740/world/things', 'https://notfal.media/a.png', 'file:///etc/hosts', 'not an address'].some(falsOwn), 'a picture is fetched only from fal\'s own store: not another host, not this machine, not plain http')

const browser = await chrome()
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 }), page = await context.newPage()
  page.on('pageerror', (e) => failures.push(`page error: ${e.message}`))
  const answered = []
  page.on('response', (r) => { if (r.request().method() === 'POST' && new URL(r.url()).pathname === '/ask') void r.text().then((t) => answered.push(...t.split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l) } catch { return { stage: 'unread', text: l } } })), () => {}) })
  let opened = 0
  const open = async (h, at = '70,17.2,412', look = '0,-25') => {
    await page.goto(`${server.url}/city?fly=0&shared=1&people=0&name=Ada&at=${at}&look=${look}&n=${++opened}${new URL(h.link).hash}`)
    await page.waitForFunction(() => globalThis.engine?.kept && engine.asker.known && engine.hud.line.onsubmit, null, { timeout: 90_000 })
    await page.waitForFunction(() => { const s = engine.world.stats; return s.wanted === 0 && s.stale === 0 && s.ready > 0 }, null, { timeout: 120_000 })
  }
  /** Types words, presses Enter, and keeps what the cue said while it waited: the bar's label, what was made, what was said, how long. */
  const ask = async (words) => {
    const before = new Set((await things()).map((t) => t.id))
    await page.keyboard.press('Enter')
    await page.keyboard.type(words, { delay: 30 })
    await page.waitForTimeout(900)
    const label = await page.evaluate(() => { const b = document.querySelector('#ask-which'); return b && !b.hidden ? b.textContent : null })
    const was = answered.length, cues = new Set(), t = Date.now()
    await page.keyboard.press('Enter')
    let ms = 0
    for (let i = 0; i < 240 && !answered.slice(was).some((l) => l.stage === 'done'); i++) {
      for (const c of await page.evaluate(() => [...document.querySelectorAll('#cues p')].map((p) => p.textContent ?? ''))) cues.add(c.replace(/\d+ s$/, 'n s'))
      await page.waitForTimeout(150)
    }
    ms = Date.now() - t
    await page.waitForFunction(() => engine.asker.busy === 0, null, { timeout: 10_000 }).catch(() => {})
    await page.waitForTimeout(400)
    const now = await things(), lines = answered.slice(was)
    return { label, made: now.find((t) => !before.has(t.id)) ?? null, lines, stages: lines.map((l) => l.stage), cues: [...cues], ms }
  }
  const walkUp = (ref, back = false) => page.evaluate(([ref, back]) => {
    const e = globalThis.engine, t = e.alive.things.find((t) => t.ref === ref), w = t && e.alive.where(t)
    if (!w) return
    const side = back ? [-w.front[0], -w.front[2]] : [-w.front[2], w.front[0]], n = Math.hypot(...side) || 1, far = back ? 6 : 3.4
    const x = w.at[0] / 10 + (side[0] / n) * far, z = w.at[2] / 10 + (side[1] / n) * far
    e.pose.x = x; e.pose.z = z; e.pose.y = e.ground(x, z) + 1.7; e.pose.yaw = Math.atan2(w.at[0] / 10 - x, -(w.at[2] / 10 - z)); e.pose.pitch = -0.2; e.me.walk(true)
  }, [ref, back])
  const where = () => page.evaluate(() => { const t = engine.alive.riding, w = t && engine.alive.where(t); return w ? w.at : null })

  // ── A car that nothing kept answers: drawn, built, alive ──
  await open(d)
  const car = await ask('a yellow racing car')
  check(car.label === 'Make', `"a yellow racing car" reads ${car.label}`)
  check(asked.draw === 1 && asked.know === 1 && asked.model === 0, `it was drawn (the drawer asked ${asked.draw}, the facts ${asked.know}, the maker's model ${asked.model})`)
  const order = ['drawing', 'place', 'shaped', 'carving', 'sending', 'done'].map((s) => car.stages.indexOf(s))
  check(order.every((i, k) => i >= 0 && (k === 0 || i > order[k - 1])), `the place hears it drawn, sized, carved, sent: ${car.stages.join(', ')}`)
  check(car.cues.some((c) => /^Drawing yellow racing car from five sides · n s$/.test(c)) && car.cues.some((c) => /^Carving yellow racing car from the drawing$/.test(c)), `the cue says what is being done: ${JSON.stringify(car.cues)}`)
  const t = car.made
  check(t?.name === 'yellow racing car' && !!t?.controls?.motor && t.controls.motor.feet.length >= 4 && t.controls.fine?.length === 1, `it stands alive in its drawn look (${t?.name}: ${t?.controls ? `${t.controls.motor.feet.length} feet, ${t.controls.fine?.length} look` : 'no controls'})`)
  if (t?.controls?.fine?.length) {
    const look = await lookOf(t), nose = noseOf(look)
    if (out) { await walkUp(t.id); await page.waitForTimeout(1500); await page.screenshot({ path: join(out, 'car-beside.png') }) }
    await walkUp(t.id)
    await page.waitForFunction((ref) => engine.alive.near?.ref === ref, t.id, { timeout: 10_000 }).catch(() => {})
    await page.keyboard.press('KeyE'); await page.waitForTimeout(400)
    const riding = await page.evaluate(() => engine.alive.riding?.ref ?? null)
    check(riding === t.id, `E gets on it (riding ${riding === t.id})`)
    const from = await where()
    await page.keyboard.down('KeyW'); await page.waitForTimeout(1100)
    if (out) await page.screenshot({ path: join(out, 'car-behind.png') })
    await page.waitForTimeout(500); await page.keyboard.up('KeyW')
    const to = await where(), went = from && to ? [to[0] - from[0], to[2] - from[2]] : [0, 0], m = Math.hypot(...went) / 10, ahead = (went[0] * nose.way[0] + went[1] * nose.way[1]) / 10
    check(m > 1.5 && ahead > 0.9 * m, `W takes it ${m.toFixed(1)} m, ${ahead.toFixed(1)} m of it nose first (the low end of its look: tallest cell ${nose.top[0]} at one end and ${nose.top[1]} at the other)`)
    await page.keyboard.press('KeyV'); await page.waitForTimeout(600)
    const inside = await page.evaluate(() => engine.alive.inside)
    const met = seesAhead(look, t.controls.eye, nose.way)
    check(inside && met[0] === 0 && met[1] === 0, `V puts the eye in its seat (${inside}), and from there it sees ahead: cells of its own met straight ahead ${met[0]}, ten degrees down ${met[1]}`)
    if (out) await page.screenshot({ path: join(out, 'car-seat.png') })
    await page.keyboard.press('KeyV'); await page.waitForTimeout(200)
    await page.keyboard.press('KeyE'); await page.waitForTimeout(300)
  }
  check((await undo({ world: server.url, journal, id: t?.id })).state === 'undone', 'the drawn car is taken out again')

  // ── Typed again: from the shelf at once, no drawer, no model ──
  await open(d)
  const again = await ask('a yellow racing car')
  check(again.made?.name === 'yellow racing car' && !!again.made?.controls && asked.draw === 1 && asked.know === 1 && asked.model === 0 && !again.stages.includes('drawing'), `typed again, it stands alive from the shelf with no drawer or model asked (${again.made?.name}; drawer ${asked.draw}, facts ${asked.know}, model ${asked.model}; ${again.stages.join(', ')})`)
  check(again.ms < 4000, `in ${(again.ms / 1000).toFixed(1)} s from Enter (the first took ${(car.ms / 1000).toFixed(1)} s)`)
  if (again.made?.controls) { const look = await lookOf(again.made), met = seesAhead(look, again.made.controls.eye, noseOf(look).way); check(met[0] === 0 && met[1] === 0, `the one from the shelf sees ahead from its seat too (${met})`) }
  await undo({ world: server.url, journal, id: again.made?.id })

  // ── A thing that is not a car ──
  await open(d)
  const hydrant = await ask('a red fire hydrant')
  check(hydrant.made?.name === 'red fire hydrant' && !hydrant.made?.controls && asked.draw === 2 && asked.model === 0, `"a red fire hydrant" is drawn and stands, not alive (${hydrant.made?.name}, drawer ${asked.draw}, model ${asked.model})`)
  const hb = hydrant.made && (hydrant.made.facing === 'east' || hydrant.made.facing === 'west' ? [hydrant.made.size[2], hydrant.made.size[1], hydrant.made.size[0]] : hydrant.made.size)
  check(!!hb && hb[1] >= 7 && hb[1] <= 11, `as tall as the model said it is (0.9 m): ${hb ? (hb[1] / 10).toFixed(1) : '?'} m`)
  if (out && hydrant.made) { await page.evaluate(([x, z]) => { const e = globalThis.engine; e.pose.x = x / 10 + 2.2; e.pose.z = z / 10 + 2.2; e.pose.y = e.ground(e.pose.x, e.pose.z) + 1.7; e.pose.yaw = Math.atan2(-2.2, 2.2); e.pose.pitch = -0.3; e.me.walk(true) }, [hydrant.made.at[0], hydrant.made.at[2]]); await page.waitForTimeout(1500); await page.screenshot({ path: join(out, 'hydrant.png') }) }
  await undo({ world: server.url, journal, id: hydrant.made?.id })

  // ── Not drawn: made as before, with nothing said of a drawing ──
  const quietly = (r) => !r.lines.some((l) => l.stage === 'note' || l.stage === 'refused') && r.lines.at(-1)?.state === 'there'
  await open(d)
  const broken = await ask('a broken teapot')
  check(broken.made?.name === 'broken teapot box' && asked.model === 1 && quietly(broken), `a drawer that fails: made by the maker's model as before (${broken.made?.name}), nothing alarming said (${broken.stages.join(', ')})`)
  check(!broken.cues.some((c) => /Drawing/.test(c) && c === broken.cues.at(-1)), `and the cue does not stay on the drawing: ${JSON.stringify(broken.cues)}`)
  await undo({ world: server.url, journal, id: broken.made?.id })
  await open(d)
  const lamp = await ask('a glowing lamp')
  check(lamp.made?.name === 'glowing lamp box' && asked.model === 2 && quietly(lamp), `what the model says is no thing to draw (a lamp that lights): made as before (${lamp.made?.name})`)
  await undo({ world: server.url, journal, id: lamp.made?.id })
  const drew = asked.draw
  await open(n)
  const bus = await ask('a blue racing car bus')
  check(bus.made?.name === 'blue bus box' && asked.draw === drew && asked.model === 3 && quietly(bus) && !bus.stages.includes('drawing'), `with no drawer (no key): made as before (${bus.made?.name}; ${bus.stages.join(', ')})`)
  await undo({ world: server.url, journal, id: bus.made?.id })
  // A change to a thing is not drawn ("paint it red" is the maker's, as before).
  await open(d)
  const change = await ask('paint it red')
  check(asked.draw === drew && !change.stages.includes('drawing'), `"paint it red" is not drawn (the drawer asked ${asked.draw - drew} times)`)
  if (change.made) await undo({ world: server.url, journal, id: change.made.id })

  // ── A drawing is paid for: only what a person typed, never twice for words that did not draw, and a day has its most ──
  // A rule's world.make reaches the page as engine.wish.thing (plugins/make/page.ts), with words nobody typed.
  await open(d)
  const had = new Set((await things()).map((t) => t.id)), drewBefore = asked.draw
  const ruled = await page.evaluate(() => engine.wish.thing({ wish: 'a green racing car' }))
  const byRule = (await things()).find((t) => !had.has(t.id))
  check(asked.draw === drewBefore && ruled.state === 'there' && byRule?.name === 'some box', `a rule's wish (words nobody typed) is made as before and never drawn (the drawer asked ${asked.draw - drewBefore} times; ${byRule?.name})`)
  await undo({ world: server.url, journal, id: byRule?.id })
  // The teapot's drawing failed above. With what was made instead gone from the shelf, the same words are not drawn (and paid for) again.
  for (const f of readdirSync(join(dir, 'shelf'))) if (f.endsWith('.json') && /broken teapot/.test(readFileSync(join(dir, 'shelf', f), 'utf8'))) rmSync(join(dir, 'shelf', f))
  await open(d)
  const twice = await ask('a broken teapot')
  check(asked.draw === drewBefore && twice.made?.name === 'broken teapot box' && !twice.stages.includes('drawing'), `words whose drawing did not stand are not drawn again (the drawer asked ${asked.draw - drewBefore} times; ${twice.stages.join(', ')})`)
  await undo({ world: server.url, journal, id: twice.made?.id })
  // A helper that pays for one drawing a day: the second wish is made as before.
  await open(m)
  const first = await ask('a red fire hydrant'), second = await ask('a yellow racing car')
  check(first.made?.name === 'red fire hydrant' && asked.draw === drewBefore + 1 && second.made?.name === 'some box' && !second.stages.includes('drawing') && quietly(second), `with one drawing a day, the first wish is drawn and the second made as before (${first.made?.name}, then ${second.made?.name}; the drawer asked ${asked.draw - drewBefore} times)`)
  await undo({ world: server.url, journal, id: first.made?.id }); await undo({ world: server.url, journal, id: second.made?.id })
} catch (e) { failures.push(`stopped: ${e.message}`); console.error(e) }
await browser.close()
await d.close(); await n.close(); await m.close()
server.stop()
rmSync(dir, { recursive: true, force: true })
if (failures.length) { console.error(`FAILED\n  ${failures.join('\n  ')}`); process.exit(1) }
console.log('drawn: ok (no model and no drawer was run: stand-ins)')
process.exit(0)
