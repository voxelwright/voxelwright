// The driver's seat is one of the driving camera's views, and every car is seen out of from it (#74). The city page
// in the installed Chrome with WebGPU, nothing stubbed.
//
// The camera: C (as the touch kit's Cam and a pad's next camera, which press it) goes round every view of
// drive-cam.ts `DRIVE_CAM_MODES` in turn, the seat among them, the eye in the seat exactly while the camera says
// so, and each view is named as it comes. V still goes straight into the seat, and back to the view it left.
//
// The cars: the hand-written car (living.ts `car`), and San Francisco's kept cars as this checkout makes them
// (sf/cars.mjs: the street's, sf/kept.mjs: the realm's parked saloon), each as the page wears it: its body, and
// every look of 2.5 cm or finer, its inside too. The kept saloon and SUV come from the shelf of this machine
// (~/.village/engine/kept-cars/shelf, or --shelf); without it they are said to be left out. Each car is mounted
// on a level street with the eye in its seat, mirrors on and off (the Low and Medium presets have them off), and:
//   - from the eye the page uses, straight ahead and 10 degrees to either side, level and 5 degrees down, the
//     first of its own cells met is glass, or none: no seat back, roof or headrest is in the way (the street's
//     blue saloon had its eye 3 cm over its own seat's back, which filled the lower half of the picture);
//   - a band of the picture through its windscreen, from over the dash to under the roof, is the street seen
//     through glass: compared with the same picture with the car not drawn, its light and shade follow the
//     street's (correlation over 0.6) and keep a third of its contrast. With mirrors off a car's glass was a pale
//     face, opaque from its own seat: the band was flat and followed nothing.
//
//   node test/seat-view.mjs [--out dir] [--shelf dir]   dir: the seat's pictures, and the street's without the car
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { DRIVE_CAM_LABELS, DRIVE_CAM_MODES } from '../page/drive-cam.ts'
import { car } from '../page/living.ts'
import { arg, here, start, still } from './kit.mjs'

const out = arg('out', '') && resolve(arg('out', ''))
if (out) mkdirSync(out, { recursive: true })
const GLASS = 11

// ── The cars, as this checkout makes them ──
/** Runs (a count and which of the palette, each unsigned LEB128, in base64) as `n` cells. */
const unrun = (palette, runs, n) => {
  const bytes = Buffer.from(runs, 'base64'), cells = new Int32Array(n)
  let at = 0, i = 0
  const leb = () => { let v = 0, shift = 1, b; do { b = bytes[i++]; v += (b & 127) * shift; shift *= 128 } while (b & 128); return v }
  while (i < bytes.length) { const count = leb(), kind = palette[leb()]; cells.fill(kind, at, at + count); at += count }
  if (at !== n) throw new Error('runs that do not fill their cells')
  return cells
}
const cells = (r, size) => [...unrun(r.palette, r.runs, size[0] * size[1] * size[2])]
const cars = []
{
  const c = car([0, 0, 0])
  cars.push({ id: 'car', name: c.name, size: c.size, cells: [...c.cells], motor: c.motor, controls: c.controls, seats: c.seats, eye: c.eye, fine: c.fine.map((f) => ({ size: f.size, per: f.per, low: f.low, cells: [...f.cells] })) })
}
const made = mkdtempSync(join(tmpdir(), 'engine-seat-view-')), shelf = arg('shelf', join(homedir(), '.village/engine/kept-cars/shelf'))
try {
  const fleet = spawnSync(process.execPath, [join(here, 'sf/cars.mjs'), made, '--shelf', shelf], { encoding: 'utf8' })
  if (fleet.status !== 0) throw new Error(`sf/cars.mjs: ${fleet.stderr}`)
  for (const line of fleet.stderr.split('\n').filter((l) => /left out/.test(l))) console.log(`  left out: ${line.trim()}`)
  for (const entry of JSON.parse(readFileSync(join(made, 'index.json'), 'utf8')).cars) {
    const m = JSON.parse(readFileSync(join(made, entry.path), 'utf8'))
    // The street's cars as street.ts wakes one to be driven: its body in its own colours, and every look of 2.5 cm or finer.
    if (!m.motor || (m.controls ?? 'drive') !== 'drive') continue
    cars.push({ id: entry.id, name: m.name, size: m.size, cells: cells(m.body, m.size), motor: m.motor, controls: 'drive', seats: m.seats, eye: m.eye, fine: m.looks.filter((l) => l.per >= 4).map((l) => ({ size: l.size, per: l.per, low: l.low, cells: cells(l, l.size) })) })
  }
  // The realm's parked saloon, as sf/build.mjs keeps it.
  const record = join(shelf, '1cb43f52cfc96e74e974e0a7.json')
  if (existsSync(record)) {
    const kept = spawnSync(process.execPath, [join(here, 'sf/kept.mjs'), record, join(made, 'kept.json'), '--name', 'red saloon'], { encoding: 'utf8' })
    if (kept.status !== 0) throw new Error(`sf/kept.mjs: ${kept.stderr}`)
    const m = JSON.parse(readFileSync(join(made, 'kept.json'), 'utf8'))
    cars.push({ id: 'kept-saloon', name: m.name, size: m.size, cells: cells(m.body, m.size), motor: m.motor, controls: m.controls, seats: m.seats, eye: m.eye, fine: (m.fine ?? []).map((f) => ({ size: f.size, per: f.per, low: f.low, cells: cells(f, f.size) })) })
  } else console.log(`  left out: the realm's kept saloon (${record} is not on this machine)`)
} finally {
  rmSync(made, { recursive: true, force: true })
}
console.log(`  cars: ${cars.map((c) => `${c.id} (${c.name})`).join(', ')}`)

// ── In the look's own cells: from the eye, the first of its own cells met ──
const FRONTS = [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1]]
/** From an eye along a way turned `side` degrees to the right and `down` degrees down: the first of a car's cells met that is not glass, as [kind, cm], or null where glass or the open air is met first. */
function firstMet(c, eye, side, down) {
  const parts = [...c.fine].sort((a, b) => b.per - a.per), f = FRONTS[c.motor.front], r = [-f[2], 0, f[0]], a = (side * Math.PI) / 180
  const d = [f[0] * Math.cos(a) + r[0] * Math.sin(a), -Math.tan((down * Math.PI) / 180), f[2] * Math.cos(a) + r[2] * Math.sin(a)], n = Math.hypot(...d)
  for (let t = 0.25; t < 80; t += 1 / 16) {
    const p = [0, 1, 2].map((i) => eye[i] + (d[i] / n) * t)
    let k = 0, inside = false
    for (const part of parts) {
      const x = Math.floor((p[0] - part.low[0]) * part.per), y = Math.floor((p[1] - part.low[1]) * part.per), z = Math.floor((p[2] - part.low[2]) * part.per)
      if (x < 0 || y < 0 || z < 0 || x >= part.size[0] || y >= part.size[1] || z >= part.size[2]) continue
      inside = true
      k = part.cells[x + part.size[0] * (z + part.size[2] * y)]
      if (k) break
    }
    if (!inside) return null
    if ((k & 15) === GLASS) return null
    if (k) return [k, Math.round(t * 10)]
  }
  return null
}

// ── In the picture: a band through the windscreen ──
/** The band of the picture through a windscreen (fractions of its width and height): over the dash, under the roof. */
const BAND = { x: [0.38, 0.62], y: [0.28, 0.42] }
/** The picture as shown, 160 by 90, as brightness 0 to 1: the band's pixels. */
const band = async (page, path) => {
  const png = (await page.screenshot(path ? { path } : {})).toString('base64')
  return page.evaluate(async ([png, B]) => {
    const picture = await createImageBitmap(await (await fetch(`data:image/png;base64,${png}`)).blob())
    const paper = new OffscreenCanvas(160, 90).getContext('2d')
    paper.drawImage(picture, 0, 0, 160, 90)
    const d = paper.getImageData(0, 0, 160, 90).data, out = []
    for (let y = Math.round(B.y[0] * 90); y < Math.round(B.y[1] * 90); y++) for (let x = Math.round(B.x[0] * 160); x < Math.round(B.x[1] * 160); x++) { const i = (y * 160 + x) * 4; out.push((d[i] * 0.2126 + d[i + 1] * 0.7152 + d[i + 2] * 0.0722) / 255) }
    return out
  }, [png, BAND])
}
/** How the seat's band follows the street's: their correlation, and the seat's contrast over the street's. */
const follows = (seat, street) => {
  const mean = (v) => v.reduce((a, b) => a + b, 0) / v.length, ms = mean(seat), mt = mean(street)
  let cov = 0, vs = 0, vt = 0
  for (let i = 0; i < seat.length; i++) { cov += (seat[i] - ms) * (street[i] - mt); vs += (seat[i] - ms) ** 2; vt += (street[i] - mt) ** 2 }
  return { r: vs && vt ? cov / Math.sqrt(vs * vt) : 0, contrast: vt ? Math.sqrt(vs / vt) : 0 }
}

const { city, check, failures, finish } = await start()
try {
  for (const mirrors of [1, 0]) {
    const page = await city(`fire=0&sound=0&music=0&people=0&scale=1&hour=11&mirrors=${mirrors}`, { size: [1280, 720], dpr: 1 })
    await still(page)
    await page.evaluate(() => { const off = globalThis.engine.off; off.add('puffs'); off.add('crumbs') })
    const tap = async (code) => { await page.keyboard.down(code); await page.waitForTimeout(60); await page.keyboard.up(code); await page.waitForTimeout(150) }
    /** Brings a car to life on the level street the city page starts by, facing along +x, once its look is worn; and mounts it. */
    const ride = async (c) => {
      await page.evaluate(async (c) => {
        const e = globalThis.engine
        for (const t of [...e.alive.things]) e.alive.vanish(t)
        const x = 760, z = 4074, ground = Math.round(e.ground(x / 10, z / 10) * 10)
        await e.alive.spawn({ ...c, cells: Int32Array.from(c.cells), low: [Math.round(x - c.size[0] / 2), ground + 4, Math.round(z - c.size[2] / 2)], fine: c.fine.map((f) => ({ ...f, cells: Uint16Array.from(f.cells) })) })
      }, c)
      await page.waitForFunction(() => { const e = globalThis.engine, t = e.alive.things.find((t) => t.alive); return t && e.alive.where(t) && e.bodies === 0 && e.alive.look(t).parts.length > 0 }, null, { timeout: 30_000 })
      await page.evaluate(() => { const e = globalThis.engine; e.alive.mount(e.alive.things.find((t) => t.alive)) })
      await page.waitForTimeout(300)
    }
    const state = () => page.evaluate(() => { const e = globalThis.engine; return { cam: e.alive.telemetry?.cam, inside: e.alive.inside, toast: document.querySelector('[data-panel="drive-hud"] .dh-cam')?.textContent ?? '' } })

    // ── The camera: C goes round every view, the seat among them (once: it is the same with mirrors off) ──
    if (mirrors) {
      await ride(cars[0])
      const was = await state(), seen = []
      for (let i = 0; i < DRIVE_CAM_MODES.length; i++) { await tap('KeyC'); seen.push(await state()) }
      const order = DRIVE_CAM_MODES.map((_, i) => DRIVE_CAM_MODES[(DRIVE_CAM_MODES.indexOf(was.cam) + 1 + i) % DRIVE_CAM_MODES.length])
      check(DRIVE_CAM_MODES.includes('seat') && seen.map((s) => s.cam).join() === order.join(), `C goes round every view of the driving camera, the seat among them: from ${was.cam}, ${seen.map((s) => s.cam).join(', ')}`)
      check(seen.every((s) => s.inside === (s.cam === 'seat')), `the eye is in the seat exactly while the camera says so: C takes it in, and the next C out to ${seen[seen.findIndex((s) => s.cam === 'seat') + 1]?.cam}`)
      check(seen.every((s) => s.toast === `CAM · ${DRIVE_CAM_LABELS[s.cam]}`), `each view is named as it comes (${seen.map((s) => s.toast).join(', ')})`)
      await tap('KeyC')
      const before = await state()
      await tap('KeyV')
      const inV = await state()
      await tap('KeyV')
      const outV = await state()
      check(inV.inside && inV.cam === 'seat' && !outV.inside && outV.cam === before.cam, `V goes straight into the seat from ${before.cam} (${inV.cam}) and back to ${before.cam} (${outV.cam})`)
    }

    // ── Every car, from its seat ──
    for (const c of cars) {
      await ride(c)
      await tap('KeyV')
      await page.waitForTimeout(900)
      // The eye the page uses, in the car's own cells from its low corner.
      const eye = await page.evaluate(() => { const t = globalThis.engine.alive.riding; return t.eye ?? (t.seats?.[0] ? [t.seats[0][0], t.seats[0][1] + 12, t.seats[0][2]] : null) })
      if (mirrors) {
        const met = [[-10, 0], [0, 0], [10, 0], [-10, 5], [0, 5], [10, 5]].map(([side, down]) => firstMet(c, eye, side, down))
        const moved = c.eye && eye.some((v, i) => Math.abs(v - c.eye[i]) > 0.01) ? `, the eye moved from ${c.eye.join(' ')} to ${eye.join(' ')}` : ''
        check(met.every((m) => !m), `${c.id}: from the eye the page uses, ahead and 10 degrees to either side, level and 5 down, glass or the open air is met first (${met.map((m) => (m ? `kind ${m[0] & 15}:${m[0] >> 8} at ${m[1]} cm` : 'ok')).join(', ')}${moved})`)
      }
      const name = `${c.id}-mirrors-${mirrors ? 'on' : 'off'}`
      const seat = await band(page, out && join(out, `${name}-seat.png`))
      await page.evaluate(async () => { globalThis.engine.off.add('pieces'); await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))) })
      await page.waitForTimeout(150)
      const street = await band(page, out && join(out, `${name}-street.png`))
      await page.evaluate(() => globalThis.engine.off.delete('pieces'))
      const f = follows(seat, street), inside = await page.evaluate(() => globalThis.engine.alive.inside)
      check(inside && f.r > 0.6 && f.contrast > 0.33, `${c.id}, mirrors ${mirrors ? 'on' : 'off'}: through its windscreen from the seat the street is seen (its light and shade follow the street's by ${f.r.toFixed(2)}, ${(f.contrast * 100).toFixed(0)}% of its contrast)`)
      await tap('KeyV')
    }
    await page.evaluate(() => { const e = globalThis.engine; for (const t of [...e.alive.things]) e.alive.vanish(t) })
    await page.close()
  }
} catch (e) {
  failures.push(`the check broke: ${e.stack ?? e}`)
}
await finish('seat-view')
