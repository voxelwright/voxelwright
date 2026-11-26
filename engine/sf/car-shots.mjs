// Cars close up (#39), for looking at full size before and after a change to how they are made: the hand-written car
// (page/living.ts `fineCar`) and the SF library's (sf/cars.mjs, made afresh), each brought to life alone on the same
// spot of the town in its finest look, its paint polished as the street polishes it (street.ts), and seen from off its
// front corner, off its back corner, from its side and close up; then ridden: from the driver's seat (V) by day, and
// at night from behind as it brakes and from in front (X) with its lamps lit.
//
//   node sf/car-shots.mjs --out <dir> [--cars finecar,coupe,saloon,suv,hatch,van,truck] [--no-ride] [--lib <a library>] [--lod 2]
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { arg, has, here, start, still, turn } from '../test/kit.mjs'

const out = resolve(arg('out', 'car-shots')), wanted = arg('cars', 'finecar,coupe,saloon,suv,hatch,van,truck').split(',')
mkdirSync(out, { recursive: true })

// The library: made now from what is on disk, or one made before (--lib, for a picture of what was).
const given = arg('lib', ''), lib = given ? resolve(given) : mkdtempSync(join(tmpdir(), 'car-shots-'))
if (!given) {
  const made = spawnSync(process.execPath, [join(here, 'sf/cars.mjs'), lib], { cwd: here, encoding: 'utf8' })
  if (made.status !== 0) throw new Error(made.stdout + made.stderr)
  console.log(made.stdout.trim())
}
// Which of its looks: its own (4 and 8 to a body cell), or with --lod 2 the coarser copy the street draws from 20 m to 90 m.
const lod = Number(arg('lod', '0'))
/** Runs (sf/cars.mjs `runsOf`) as a grid of kinds, base64 of 16-bit kinds: as a page's look takes its cells. */
function unrun(runs, palette, n, polish = []) {
  const bytes = Buffer.from(runs, 'base64'), cells = new Uint16Array(n)
  let i = 0, at = 0
  const leb = () => { let v = 0, s = 1, b; do { b = bytes[i++]; v += (b & 127) * s; s *= 128 } while (b & 128); return v }
  while (i < bytes.length) { const count = leb(), which = leb(); cells.fill(palette[which] | (polish[which] ? 128 : 0), at, at + count); at += count }
  return cells
}
const library = {}
for (const c of JSON.parse(readFileSync(join(lib, 'index.json'), 'utf8')).cars) {
  const r = JSON.parse(readFileSync(join(lib, c.path), 'utf8')), n = (s) => s[0] * s[1] * s[2]
  // Its own looks, not the coarser copies of its outside made for far off: the finest and, for a kept car, its inside.
  const looks = r.looks.filter((l) => (lod ? l.per === lod && Math.abs(l.low[0]) < 0.5 : l.per >= 4)).map((l) => ({ size: l.size, per: l.per, low: l.low, cells: Buffer.from(unrun(l.runs, l.palette, n(l.size), l.roles.map((x) => x === 'paint')).buffer).toString('base64') }))
  library[c.id] = { name: r.name, size: r.size, body: [...unrun(r.body.runs, r.body.palette, n(r.size))], motor: r.motor, seats: r.seats, eye: r.eye, fine: looks }
}
if (!given) rmSync(lib, { recursive: true, force: true })

// One turn on the GPU, as the checks take theirs, so that neither's timings suffer the other's frames.
const back = await turn(), { city, finish } = await start()
const page = await city('fire=0&people=0', { size: [1600, 1000], dpr: 1 })
await page.addStyleTag({ content: '#hud, #aim, #boom, #tools, #over, #where, #first, #card, #toast { display: none !important }' })
await still(page)
const tap = async (code, ms = 80) => { await page.keyboard.down(code); await page.waitForTimeout(ms); await page.keyboard.up(code) }
const shot = async (name) => { await page.waitForTimeout(700); await page.screenshot({ path: join(out, `${name}.png`) }) }
const AT = [760, 4074]
try {
  for (const id of wanted) {
    const car = id === 'finecar' ? null : library[id]
    if (id !== 'finecar' && !car) { console.log(`  ${id}: not in the library`); continue }
    await page.evaluate(async ({ car, AT }) => {
      const e = globalThis.engine
      for (const t of e.alive.things) e.alive.vanish(t)
      const ground = Math.round(e.ground(AT[0] / 10, AT[1] / 10) * 10), low = [AT[0], ground + 5, AT[1]]
      const making = car ? { name: car.name, cells: Int32Array.from(car.body), size: car.size, low, controls: 'drive', motor: car.motor, ...(car.seats ? { seats: car.seats } : {}), ...(car.eye ? { eye: car.eye } : {}), fine: car.fine } : e.fineCar(low)
      e.hour = 12.5
      await e.alive.spawn(making)
    }, { car, AT })
    await page.waitForFunction(() => { const e = globalThis.engine, t = e.alive.things.find((t) => t.alive); return t && e.alive.where(t) && e.bodies === 0 }, null, { timeout: 20_000 })
    await page.waitForTimeout(1200); await still(page).catch(() => {})
    // Views round it: the angle from its front (degrees, towards its left), how far from its middle and how high (metres).
    for (const [view, angle, far, high, fov] of [['front', -40, 6.2, 1.55, 50], ['rear', 142, 6.2, 1.55, 50], ['side', 90, 6.5, 1.1, 50], ['close', -28, 3.6, 1.75, 50], ['close-rear', 150, 3.6, 1.75, 50]]) {
      await page.evaluate(({ angle, far, high, fov }) => {
        const e = globalThis.engine, t = e.alive.things.find((t) => t.alive), w = e.alive.where(t)
        const a = (angle * Math.PI) / 180, f = w.front, l = [f[2], 0, -f[0]], c = [w.at[0] / 10, w.at[1] / 10, w.at[2] / 10]
        const ex = c[0] + (f[0] * Math.cos(a) + l[0] * Math.sin(a)) * far, ez = c[2] + (f[2] * Math.cos(a) + l[2] * Math.sin(a)) * far
        const ey = e.ground(c[0], c[2]) + high
        Object.assign(e.pose, { x: ex, y: ey, z: ez, yaw: Math.atan2(c[0] - ex, -(c[2] - ez)), pitch: -Math.atan2(ey - c[1] - 0.1, far) })
        e.fov = fov
      }, { angle, far, high, fov })
      await page.waitForTimeout(400); await still(page).catch(() => {})
      await shot(`${id}-${view}`)
    }
    if (has('no-ride')) continue
    // Ridden: get on from beside the driver's door.
    await page.evaluate(() => { const e = globalThis.engine, t = e.alive.things.find((t) => t.alive), w = e.alive.where(t), f = w.front; Object.assign(e.pose, { x: w.at[0] / 10 + f[2] * 2.2, z: w.at[2] / 10 - f[0] * 2.2, y: e.ground(w.at[0] / 10, w.at[2] / 10) + 1.7 }) })
    await page.waitForFunction(() => globalThis.engine.alive.near, null, { timeout: 5000 }).catch(() => {})
    await tap('KeyE')
    const rode = await page.waitForFunction(() => globalThis.engine.alive.riding, null, { timeout: 5000 }).then(() => true, () => false)
    if (!rode) { console.log(`  ${id}: could not get on`); continue }
    await tap('KeyV'); await page.waitForTimeout(900)
    await shot(`${id}-seat`)
    await tap('KeyV'); await page.waitForTimeout(600)
    await page.evaluate(() => { globalThis.engine.hour = 21.5 })
    await page.keyboard.down('KeyW'); await page.waitForTimeout(1300); await page.keyboard.up('KeyW')
    await page.keyboard.down('KeyS'); await page.waitForTimeout(220)
    await page.screenshot({ path: join(out, `${id}-night-braking.png`) })
    await page.keyboard.up('KeyS'); await page.waitForTimeout(1800)
    await page.keyboard.down('KeyX'); await page.waitForTimeout(700)
    await page.screenshot({ path: join(out, `${id}-night-front.png`) })
    await page.keyboard.up('KeyX')
    await tap('KeyE'); await page.waitForTimeout(500)
    await page.evaluate(() => { globalThis.engine.hour = 12.5 })
  }
  console.log(`  pictures in ${out}`)
} finally { back(); await finish('car shots') }
