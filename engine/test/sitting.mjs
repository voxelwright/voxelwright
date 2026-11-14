// A sitting (#367): someone plays the real page for a long while, and every frame is written down.
//
// The engine's aim is 60 frames a second. An average hides what a player feels, which is the long frame: so this
// keeps each frame's gap, what the page's own thread spent inside it, the raw parts of it (`engine.laps`), and where
// the feet and the eye were, under the name of what was being done. A long gap with a long time inside the frame is
// the page's code and the parts name it; a long gap with a short one is the GPU, the picture-size steer, or another
// thread drawing on this machine. Nothing is filmed while it measures (a recorder costs frames).
//
//   node test/sitting.mjs [--parts street,turns,far,...] [--out dir] [--size 1512x860] [--query 'shadows=0'] [--alone]
//
// Not one of `npm run check`'s: it takes as long as it plays and its numbers are this machine's at this hour.
import { mkdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { chromium } from 'playwright'
import { arg, CHROME, has, serve, still, turn } from './kit.mjs'

const out = resolve(arg('out', join(homedir(), '.village', 'engine', 'polish', 'sitting')))
mkdirSync(out, { recursive: true })
const [W, H] = arg('size', '1512x860').split('x').map(Number)
const wanted = arg('parts', 'street,turns,far').split(',')
const alone = has('alone')

/** In the page before anything of its own runs: every frame's gap and the time spent inside it, kept with where the body and the eye were. */
const recorder = () => {
  const N = 120_000, F = 12
  const rows = new Float32Array(N * F), long = [], names = ['start']
  let n = 0, label = 0, last = 0, turning = 0
  const raf = globalThis.requestAnimationFrame.bind(globalThis)
  globalThis.requestAnimationFrame = (f) => raf((now) => {
    const t0 = performance.now()
    f(now)
    const e = globalThis.engine
    // Only the page's own frame (it reads `engine.laps` as it goes): other callbacks are not frames of the picture.
    if (!e || !e.laps || f.name !== 'frame') return
    const cpu = performance.now() - t0, gap = last ? now - last : 0
    last = now
    if (turning) e.pose.yaw += turning * Math.min(0.05, gap / 1000)
    const feet = e.me.feet, s = e.world.stats
    if (n < N) rows.set([now, gap, cpu, label, feet ? feet.at[0] : NaN, feet ? feet.at[1] : NaN, feet ? feet.at[2] : NaN, e.pose.x * 10, e.pose.y * 10, e.pose.z * 10, e.pose.yaw, e.scale], n++ * F)
    if (gap > 25) long.push({ at: now, label: names[label], gap, cpu, laps: { ...e.laps }, wanted: s.wanted, stale: s.stale, scale: e.scale, gpu: e.gpuMs, portal: e.portal?.state ? { ...e.portal.state } : undefined, realm: e.realms?.here })
  })
  globalThis.sitting = {
    mark(name) { label = names.push(name) - 1 },
    turn(rate) { turning = rate },
    peek(name) { const at = names.lastIndexOf(name), got = []; for (let i = 0; i < n; i++) if (rows[i * F + 3] === at) got.push([rows[i * F] / 1000, rows[i * F + 4], rows[i * F + 5], rows[i * F + 6], rows[i * F + 7], rows[i * F + 8], rows[i * F + 9]]); return got },
    take() { const got = { rows: Array.from(rows.subarray(0, n * F)), long: long.splice(0), names: [...names], F }; n = 0; return got },
  }
}

const done = await turn()
const world = join(out, `world-${Date.now()}.log`)
const server = await serve('/dev/null', alone ? [] : ['--world', world])
const browser = await chromium.launch(CHROME)
const context = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 2 })
const page = await context.newPage()
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
await page.addInitScript(recorder)
await page.goto(`${server.url}/city?fly=0&${alone ? '' : 'shared=1&name=Ada&'}${arg('query', '')}`)
await page.waitForFunction(() => globalThis.engine, null, { timeout: 90_000 })
await still(page, { sun: true })

const wait = (ms) => page.waitForTimeout(ms)
const keys = async (codes, ms) => { for (const c of codes) await page.keyboard.down(c); await wait(ms); for (const c of codes) await page.keyboard.up(c) }
const turnBy = async (rate, ms) => { await page.evaluate((r) => globalThis.sitting.turn(r), rate); await wait(ms); await page.evaluate(() => globalThis.sitting.turn(0)) }
// A picture taken stops the page for half a second: those frames are under a name of their own and not counted.
let doing = 'start'
const mark = async (name) => { doing = name; await page.evaluate((name) => globalThis.sitting.mark(name), name) }
const shot = async (name) => { const was = doing; await mark('picture'); await page.screenshot({ path: join(out, `${name}.png`) }); await wait(300); await mark(was) }
/** Onto the feet on the street the page starts above, looking east along it. */
const down = async (x = 76, z = 408.3, yaw = Math.PI / 2) => {
  await page.evaluate(([x, z, yaw]) => { const e = globalThis.engine; if (e.me.on) e.me.walk(false); e.pose.x = x; e.pose.z = z; e.pose.y = e.ground(x, z) + 2; e.pose.yaw = yaw; e.pose.pitch = -0.12; e.me.walk(true) }, [x, z, yaw])
  await page.waitForFunction(() => globalThis.engine.me.feet, null, { timeout: 10_000 })
  await wait(1500)
}

const parts = {
  // Standing, a walk, a run, jumps, stopping: on the start street.
  async street() {
    await down()
    await mark('stand'); await wait(4000)
    await shot('street-stand')
    await mark('walk'); await keys(['KeyW'], 6000)
    await mark('stop'); await wait(1500)
    await mark('run'); await keys(['ShiftLeft', 'KeyW'], 8000)
    await shot('street-run')
    await mark('stop'); await wait(1500)
    await mark('jump'); for (let i = 0; i < 4; i++) { await page.keyboard.press('Space'); await wait(900) }
    await mark('run-jump'); await page.keyboard.down('ShiftLeft'); await page.keyboard.down('KeyW'); for (let i = 0; i < 4; i++) { await wait(700); await page.keyboard.press('Space') } await wait(700); await page.keyboard.up('KeyW'); await page.keyboard.up('ShiftLeft')
    await mark('stop'); await wait(1500)
  },
  // The head turned while standing and while walking, aside and back.
  async turns() {
    await down()
    await mark('look-round'); await turnBy(1.6, 4000)
    await mark('walk-turn'); await page.keyboard.down('KeyW'); await turnBy(0.8, 5000); await turnBy(-0.8, 5000); await page.keyboard.up('KeyW')
    await mark('aside'); await keys(['KeyA'], 2000); await keys(['KeyD'], 2000); await keys(['KeyS'], 2000)
    await mark('run-turn'); await page.keyboard.down('ShiftLeft'); await page.keyboard.down('KeyW'); await turnBy(1.2, 6000); await page.keyboard.up('KeyW'); await page.keyboard.up('ShiftLeft')
    await shot('turns-end')
  },
  // A long run east along the street: new parts of the town come in as it goes.
  async far() {
    await down()
    await mark('far-run'); await keys(['ShiftLeft', 'KeyW'], 45_000)
    await shot('far-end')
    await mark('stop'); await wait(2000)
  },
}

/** The rows kept so far under one name, as [seconds, feet x, y, z, eye x, y, z]: for a part that says something of its own. */
const traced = async (name) => page.evaluate((name) => globalThis.sitting.peek(name), name)
const line = (what) => console.log(`  ${what}`)
// How the body answers: a start, a stop, a wall met at a slant, a kerb, a jump, a fall.
parts.body = async () => {
  await down()
  await mark('b-start'); await keys(['ShiftLeft', 'KeyW'], 3000)
  await mark('b-stop'); await wait(1500)
  let t = await traced('b-start'), v = t.map((r, i) => i ? Math.hypot(r[1] - t[i - 1][1], r[3] - t[i - 1][3]) / (r[0] - t[i - 1][0]) : 0)
  line(`a run from standing reaches 4 m/s in ${(t[v.findIndex((x) => x > 40)]?.[0] - t[0][0]).toFixed(2)} s, top ${(Math.max(...v) / 10).toFixed(2)} m/s`)
  t = await traced('b-stop'); v = t.map((r, i) => i ? Math.hypot(r[1] - t[i - 1][1], r[3] - t[i - 1][3]) / (r[0] - t[i - 1][0]) : 0)
  line(`let go at a run it stops in ${(t[v.findIndex((x, i) => i > 2 && x < 1)]?.[0] - t[0][0]).toFixed(2)} s and ${(Math.hypot(t.at(-1)[1] - t[0][1], t.at(-1)[3] - t[0][3]) / 10).toFixed(2)} m`)
  // A jump standing: how high, how long.
  await mark('b-jump'); await page.keyboard.press('Space'); await wait(1400)
  t = await traced('b-jump')
  const y0 = t[0][2], up = t.filter((r) => r[2] > y0 + 0.5)
  line(`a standing jump rises ${((Math.max(...t.map((r) => r[2])) - y0) / 10).toFixed(2)} m and is off the ground ${up.length ? (up.at(-1)[0] - up[0][0]).toFixed(2) : 0} s; lands ${(Math.min(...t.slice(-30).map((r) => r[2])) - y0).toFixed(1)} cells from where it rose`)
  // North off the road, over the kerb, at a slant into the house fronts, held there.
  await down(90, 408.3, 0.6)
  await mark('b-kerb-wall'); await keys(['KeyW'], 14000)
  t = await traced('b-kerb-wall')
  const dy = t.map((r, i) => i ? r[2] - t[i - 1][2] : 0), ey = t.map((r, i) => i ? r[5] - t[i - 1][5] : 0)
  line(`walking north-east 14 s: feet went ${((t.at(-1)[1] - t[0][1]) / 10).toFixed(1)} m east, ${((t[0][3] - t.at(-1)[3]) / 10).toFixed(1)} m north, ${((t.at(-1)[2] - t[0][2]) / 10).toFixed(2)} m up; biggest step of the feet in one frame ${Math.max(...dy.map(Math.abs)).toFixed(1)} cells, of the eye ${Math.max(...ey.map(Math.abs)).toFixed(1)} cells`)
  const lastSec = t.filter((r) => r[0] > t.at(-1)[0] - 3)
  line(`in its last 3 s (against whatever it met) it went ${(Math.hypot(lastSec.at(-1)[1] - lastSec[0][1], lastSec.at(-1)[3] - lastSec[0][3]) / 10).toFixed(2)} m (a free walk is 4.3 m)`)
  await shot('body-wall')
  writeFileSync(join(out, 'body-kerb-wall.json'), JSON.stringify(t))
}

const all = { rows: [], long: [], names: null, F: 12 }
for (const name of wanted) {
  if (!parts[name]) { console.log(`no part called ${name}`); continue }
  console.log(`part: ${name}`)
  await parts[name]()
  const got = await page.evaluate(() => globalThis.sitting.take())
  all.rows.push(...got.rows); all.long.push(...got.long); all.names = got.names; all.F = got.F
}
await browser.close(); server.stop(); done()

// What it was like, by what was being done.
const F = all.F, by = new Map()
for (let i = 0; i < all.rows.length; i += F) {
  const name = all.names[all.rows[i + 3]]
  if (!by.has(name)) by.set(name, [])
  by.get(name).push(all.rows.slice(i, i + F))
}
const pct = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))]
console.log('\nwhat                frames   p50    p95    p99  worst  >20ms >33ms  cpu p95  feet m/s  uneven  eye uneven  scale')
for (const [name, rows] of by) {
  if (name === 'start' || name === 'picture') continue
  const gaps = rows.map((r) => r[1]).filter((g) => g > 0).sort((a, b) => a - b), cpus = rows.map((r) => r[2]).sort((a, b) => a - b)
  // How even the going is: the speed of the feet (and of the eye) from one frame to the next, as its spread over its mean. A steady walk is near 0.
  const speeds = (a) => { const v = []; for (let i = 1; i < rows.length; i++) { const dt = rows[i][1] / 1000; if (dt > 0 && Number.isFinite(rows[i][a]) && Number.isFinite(rows[i - 1][a])) v.push(Math.hypot(rows[i][a] - rows[i - 1][a], rows[i][a + 2] - rows[i - 1][a + 2]) / dt) } return v }
  const spread = (v) => { if (v.length < 2) return [0, 0]; const m = v.reduce((a, b) => a + b, 0) / v.length; return [m, Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / v.length) / (m || 1)] }
  const [fm, fs] = spread(speeds(4)), [, es] = spread(speeds(7))
  console.log(`${name.padEnd(18)} ${String(gaps.length).padStart(7)} ${pct(gaps, 0.5).toFixed(1).padStart(6)} ${pct(gaps, 0.95).toFixed(1).padStart(6)} ${pct(gaps, 0.99).toFixed(1).padStart(6)} ${gaps.at(-1).toFixed(1).padStart(6)} ${String(gaps.filter((g) => g > 20).length).padStart(6)} ${String(gaps.filter((g) => g > 33.4).length).padStart(5)} ${pct(cpus, 0.95).toFixed(1).padStart(8)} ${(fm / 10).toFixed(2).padStart(9)} ${fs.toFixed(2).padStart(7)} ${es.toFixed(2).padStart(11)} ${rows.at(-1)[11].toFixed(2).padStart(6)}`)
}
all.long = all.long.filter((l) => l.label !== 'start' && l.label !== 'picture')
const worst = [...all.long].sort((a, b) => b.gap - a.gap).slice(0, 25)
console.log(`\nframes over 25 ms: ${all.long.length}; over 33.4 ms: ${all.long.filter((l) => l.gap > 33.4).length}. The longest:`)
for (const l of worst) {
  const top = Object.entries(l.laps).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, v]) => `${k} ${v.toFixed(1)}`).join(', ')
  console.log(`  ${l.gap.toFixed(0).padStart(4)} ms in ${l.label.padEnd(12)} inside the frame ${l.cpu.toFixed(1)} ms (${top}); making ${l.wanted}, stale ${l.stale}, picture ${l.scale.toFixed(2)}, march ${l.gpu.toFixed(1)} ms${l.portal ? `, portal ${JSON.stringify(l.portal)}` : ''}`)
}
writeFileSync(join(out, `sitting-${Date.now()}.json`), JSON.stringify(all))
if (errors.length) console.log(`page errors:\n  ${errors.join('\n  ')}`)
console.log(`kept in ${out}`)
process.exit(0)
