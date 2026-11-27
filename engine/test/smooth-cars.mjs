// Smooth faces for things of fine cells (#38): a car of 2.5 cm cells looked 3D-printed, every step of a curved hood
// a bright tread and a dark riser. fine.ts `facesWithSmooth` gives each outside face a normal from the shape round it
// and how open it is; pieces.ts lights by them. Checked here, without a page:
//   - a hollow dome (a shell two cells thick over a floor, air inside): its outside faces' normals lie within a few
//     degrees of the sphere's, treads and risers alike, where the square normals are up to 90 degrees off; every face
//     inside keeps its square normal (no smooth word);
//   - a hood, a body whose top slopes 1 in 5: tread and riser faces get the same normal, the slope's;
//   - a slot cut into a block: the faces at its bottom are less open than the block's flat top;
//   - flat walls still merge into rows: a box's faces are as few as `faces` makes;
//   - the time it takes for the default fine car (living.ts `fineCar`, 168 x 52 x 72) and the street's SUV look.
// Then, with `--page`, the default fine car in the real page (Chrome, WebGPU): no WebGPU errors, and its brightness
// changes less from row to row of the picture than with square normals (`engine.falling.smooth = false`).
//
//   node test/smooth-cars.mjs [--page] [--out dir]
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { faces, facesWithSmooth } from '../page/fine.ts'
import { fineCar } from '../page/living.ts'
import { COUPE_KINDS } from '../page/car-sculpt.ts'
import { unrun } from '../page/runs.ts'
import { has } from './kit.mjs'

const failures = []
const check = (ok, what) => { console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) failures.push(what) }
const deg = (c) => (Math.acos(Math.max(-1, Math.min(1, c))) * 180) / Math.PI
const q = (xs, p) => { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(s.length * p))] ?? 0 }

/** A smooth word's normal (pieces.ts `unfold`), and how open it is. */
const unfold = (word) => {
  let u = ((word & 1023) / 1022) * 2 - 1, v = (((word >>> 10) & 1023) / 1022) * 2 - 1
  let z = 1 - Math.abs(u) - Math.abs(v)
  if (z < 0) { const pu = u; u = (1 - Math.abs(v)) * Math.sign(pu || 1); v = (1 - Math.abs(pu)) * Math.sign(v || 1) }
  const l = Math.hypot(u, v, z)
  return { n: [u / l, v / l, z / l], open: ((word >>> 20) & 255) / 255 }
}
/** Each face of a block as its cells: where each cell's face is (its middle), its square normal, and its smooth word there (its corners' blended at the cell's middle; 0 for none). */
const each = (made, fn) => {
  for (let f = 0; f < made.faces.length / 2; f++) {
    const a = made.faces[f * 2], b = made.faces[f * 2 + 1], words = made.smooth.subarray(f * 4, f * 4 + 4)
    const start = [a & 1023, (a >>> 10) & 1023, (a >>> 20) & 1023], long = b & 255, axis = (b >>> 8) & 3, side = (b >>> 10) & 1
    const own = [0, 0, 0]
    own[axis] = side * 2 - 1
    const corners = words[0] ? [...words].map(unfold) : null
    for (let k = 0; k < long; k++) {
      const c = [...start]
      c[axis === 0 ? 2 : 0] += k
      const mid = [c[0] + 0.5 + own[0] * 0.5, c[1] + 0.5 + own[1] * 0.5, c[2] + 0.5 + own[2] * 0.5]
      let word = null
      if (corners) {
        const t = (k + 0.5) / long, wt = [(1 - t) * 0.5, t * 0.5, (1 - t) * 0.5, t * 0.5], n = [0, 0, 0]
        let open = 0
        corners.forEach((q, j) => { for (let e = 0; e < 3; e++) n[e] += q.n[e] * wt[j]; open += q.open * wt[j] })
        const l = Math.hypot(...n)
        word = { n: n.map((v) => v / l), open }
      }
      fn({ cell: c, mid, own, axis, side, word })
    }
  }
}

// ── A hollow dome: a shell two cells thick, radius 30, over a floor, air inside ──
{
  const R = 30, w = 2 * R + 6, h = R + 6, d = w, cells = new Uint16Array(w * h * d), c = [w / 2, 2, d / 2]
  for (let y = 0; y < h; y++) for (let z = 0; z < d; z++) for (let x = 0; x < w; x++) {
    const r = Math.hypot(x + 0.5 - c[0], y + 0.5 - c[1], z + 0.5 - c[2])
    if ((y >= 2 && r <= R && r > R - 2) || (y < 2 && r <= R)) cells[(y * d + z) * w + x] = 12
  }
  const made = facesWithSmooth(cells, [w, h, d])
  const outside = [], square = [], inside = { faces: 0, smooth: 0 }
  each(made, ({ mid, own, word }) => {
    const r = Math.hypot(mid[0] - c[0], mid[1] - c[1], mid[2] - c[2])
    const radial = [(mid[0] - c[0]) / r, (mid[1] - c[1]) / r, (mid[2] - c[2]) / r]
    // (Near its foot the floor's edge is near too: a real edge, not the sphere's.)
    if (mid[1] < 8) return
    if (r < R - 1) { inside.faces++; if (word) inside.smooth++; return }
    if (!word) return
    const { n } = word
    outside.push(deg(n[0] * radial[0] + n[1] * radial[1] + n[2] * radial[2]))
    square.push(deg(own[0] * radial[0] + own[1] * radial[1] + own[2] * radial[2]))
  })
  check(outside.length > 1000 && q(outside, 0.5) < 4 && q(outside, 0.95) < 9, `a hollow dome's outside faces lie along the sphere: ${outside.length} faces, ${q(outside, 0.5).toFixed(1)} degrees off at the median, ${q(outside, 0.95).toFixed(1)} at the 95th (square normals: ${q(square, 0.5).toFixed(1)}, ${q(square, 0.95).toFixed(1)})`)
  check(inside.faces > 500 && inside.smooth === 0, `its ${inside.faces} faces inside keep their square normals (${inside.smooth} smooth)`)
}

// ── A hood: a body whose top slopes up 1 in 2, 1 in 5 and 1 in 10 along x ──
for (const run of [2, 5, 10]) {
  const w = 120, h = 4 + Math.ceil(120 / run) + 4, d = 40, cells = new Uint16Array(w * h * d)
  for (let y = 0; y < h; y++) for (let z = 0; z < d; z++) for (let x = 0; x < w; x++) if (y < 4 + Math.floor(x / run)) cells[(y * d + z) * w + x] = 12
  const made = facesWithSmooth(cells, [w, h, d]), l = Math.hypot(1, run), slope = [-1 / l, run / l, 0], treads = [], risers = []
  each(made, ({ cell, own, word }) => {
    // The middle of the hood, its upper faces only (treads look up, risers back down the slope).
    if (cell[0] < 30 || cell[0] > 90 || cell[2] < 10 || cell[2] > 30 || !word) return
    if (!(own[1] === 1 || own[0] === -1)) return
    const { n } = word, off = deg(n[0] * slope[0] + n[1] * slope[1] + n[2] * slope[2])
    ;(own[1] === 1 ? treads : risers).push(off)
  })
  const square = deg(slope[1])
  check(treads.length > 100 && risers.length > 50 && q(treads, 0.95) < 5 && q(risers, 0.95) < 5, `a hood sloping 1 in ${run}: treads and risers alike lie along the slope (${treads.length} treads ${q(treads, 0.5).toFixed(1)}/${q(treads, 0.95).toFixed(1)} degrees off, median/95th; ${risers.length} risers ${q(risers, 0.5).toFixed(1)}/${q(risers, 0.95).toFixed(1)}; square normals are ${square.toFixed(0)} and ${(90 - square).toFixed(0)} off)`)
}

// ── A slot cut into a block, and a plain box ──
{
  const w = 40, h = 20, d = 40, cells = new Uint16Array(w * h * d)
  for (let y = 0; y < h; y++) for (let z = 0; z < d; z++) for (let x = 0; x < w; x++) if (!(Math.abs(x - 20) <= 1 && y >= 12)) cells[(y * d + z) * w + x] = 12
  const made = facesWithSmooth(cells, [w, h, d]), bottom = [], top = []
  each(made, ({ cell, own, word }) => {
    if (own[1] !== 1 || !word || cell[2] < 8 || cell[2] > 32) return
    if (Math.abs(cell[0] - 20) <= 1) bottom.push(word.open)
    else if (Math.abs(cell[0] - 20) > 8) top.push(word.open)
  })
  const mean = (xs) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length)
  check(top.length && bottom.length && mean(top) > 0.95 && mean(bottom) < 0.6, `a slot's bottom is shut in (open ${mean(bottom).toFixed(2)}), a flat top open (${mean(top).toFixed(2)})`)
  const box = new Uint16Array(w * h * d)
  for (let y = 4; y < 16; y++) for (let z = 4; z < 36; z++) for (let x = 4; x < 36; x++) box[(y * d + z) * w + x] = 12
  // Its top is 32 cells square: a row across the middle of it is one face where its slope reaches no edge (5 cells in from each).
  const plain = faces(box, [w, h, d]).length / 2, boxed = facesWithSmooth(box, [w, h, d])
  let middle = 0
  for (let f = 0; f < boxed.faces.length / 2; f++) {
    const a = boxed.faces[f * 2], b = boxed.faces[f * 2 + 1]
    if (((b >>> 8) & 3) === 1 && (b >>> 10) & 1 && ((a >>> 20) & 1023) === 20 && (a & 1023) <= 10 && (a & 1023) + (b & 255) >= 30) middle = b & 255
  }
  check(middle >= 20, `a plain box's flat top still merges into rows: its middle row is a face ${middle} cells long (${boxed.faces.length / 2} faces in all, ${plain} square)`)
}

// ── Time: the default fine car, and the street's SUV where its library is on this machine ──
{
  const cpu = (fn) => { fn(); const best = []; for (let k = 0; k < 5; k++) { const u = process.cpuUsage(); fn(); const v = process.cpuUsage(u); best.push((v.user + v.system) / 1000) } return Math.min(...best) }
  const car = fineCar([0, 0, 0]).fine[0], plain = cpu(() => faces(car.cells, car.size)), smooth = cpu(() => facesWithSmooth(car.cells, car.size))
  const made = facesWithSmooth(car.cells, car.size)
  // Its cabin is shut (glass and paint all round, car-sculpt.ts): the seats' inserts and the dash keep their square
  // normals for the eye in the seat.
  const inside = [COUPE_KINDS.insert, COUPE_KINDS.dash]
  let seats = 0, smoothSeats = 0, outside = 0
  for (let f = 0; f < made.faces.length / 2; f++) {
    const kind = made.faces[f * 2 + 1] >>> 16, soft = made.smooth[f * 4] !== 0
    if (inside.includes(kind)) { seats++; if (soft) smoothSeats++ } else if (soft) outside++
  }
  check(seats > 200 && smoothSeats === 0 && outside > 1000, `the fine car's cabin is shut: its ${seats} faces of seat and dash keep their square normals (${smoothSeats} smooth), ${outside} faces outside are smooth`)
  check(smooth < 120, `the fine car (${car.size.join(' x ')}): ${made.faces.length / 2} faces with smooth words in ${smooth.toFixed(1)} ms of CPU (${(faces(car.cells, car.size).length / 2)} square in ${plain.toFixed(1)} ms)`)
  const suv = join(homedir(), '.village/engine/bay/450-city-paint/cars/suv.json')
  if (existsSync(suv)) {
    const l = JSON.parse(readFileSync(suv, 'utf8')).looks[0], cells = unrun(l.runs, l.size[0] * l.size[1] * l.size[2], l.kinds)
    const t = cpu(() => facesWithSmooth(cells, l.size)), p = cpu(() => faces(cells, l.size))
    console.log(`  (the SUV's outside look, ${l.size.join(' x ')}: ${t.toFixed(1)} ms smooth, ${p.toFixed(1)} ms square)`)
  }
}

// ── The default fine car in the real page: no WebGPU errors, and its paint bands less down the bonnet ──
if (has('page')) {
  const { mkdirSync, writeFileSync } = await import('node:fs')
  const { resolve } = await import('node:path')
  const { arg, start, still } = await import('./kit.mjs')
  const out = arg('out', '') && resolve(arg('out', ''))
  if (out) mkdirSync(out, { recursive: true })
  const kit = await start()
  const gpu = []
  try {
    // (Heard from the first line the page says: a shader or a buffer layout that does not fit is said as it starts.)
    const page = await kit.page({ size: [1280, 720], dpr: 1 })
    page.on('console', (m) => { if (m.type() === 'error' || (m.type() === 'warning' && /WebGPU|validation|shader|WGSL/i.test(m.text()))) gpu.push(m.text()) })
    page.on('pageerror', (e) => gpu.push(e.message))
    await page.goto(`${kit.url}/city?fly=0&fire=0&people=0&sound=0&music=0&living=finecar&hour=12&scale=1`)
    // (Its look is drawn square at once and smooth once the worker has made its smooth faces: main.ts `smoothen`.)
    await page.waitForFunction(() => { const e = globalThis.engine; const t = e?.alive?.things?.[0]; return !!t && e.alive.where(t) && e.bodies === 0 && e.alive.look(t).parts.some((p) => p.cell > 0) && e.smoothing?.() === 0 }, null, { timeout: 90_000 })
    await page.addStyleTag({ content: '#hud, #aim, #boom, #tools, #over, #where, #realm, #first { display: none !important }' }).catch(() => {})
    // Off its front corner, a little above, looking down along the bonnet.
    await page.evaluate(() => {
      const e = globalThis.engine, w = e.alive.where(e.alive.things[0]), c = [w.at[0] / 10, w.at[1] / 10, w.at[2] / 10]
      Object.assign(e.pose, { x: c[0] + 4.2, y: c[1] + 1.5, z: c[2] - 2.6 })
      e.pose.yaw = Math.atan2(c[0] - e.pose.x, -(c[2] - e.pose.z)); e.pose.pitch = Math.atan2(c[1] - 0.3 - e.pose.y, Math.hypot(c[0] - e.pose.x, c[2] - e.pose.z))
    })
    await still(page, { sun: true }).catch(() => {})
    const shot = async (name, set) => { await page.evaluate(set); await page.waitForTimeout(800); const png = await page.screenshot(); if (out) writeFileSync(`${out}/${name}.png`, png); return png.toString('base64') }
    const bare = await shot('none', () => globalThis.engine.off.add('pieces'))
    const square = await shot('square', () => { const e = globalThis.engine; e.off.delete('pieces'); e.falling.smooth = false })
    const smooth = await shot('smooth', () => { globalThis.engine.falling.smooth = true })
    // Where the car is (it changes the picture), and how much brightness changes from one row to the next there:
    // a stair of bright treads and dark risers is a change at every step.
    const [banding, pixels] = await page.evaluate(async (pngs) => {
      const read = async (png) => { const b = await createImageBitmap(await (await fetch(`data:image/png;base64,${png}`)).blob()), c = new OffscreenCanvas(b.width, b.height).getContext('2d'); c.drawImage(b, 0, 0); return c.getImageData(0, 0, b.width, b.height) }
      const [none, ...lit] = await Promise.all(pngs.map(read)), w = none.width, h = none.height, L = (d, i) => (d[i] * 0.2126 + d[i + 1] * 0.7152 + d[i + 2] * 0.0722) / 255
      const car = (i) => Math.abs(L(none.data, i) - L(lit[0].data, i)) > 0.03 && Math.abs(L(none.data, i) - L(lit[1].data, i)) > 0.03
      const steps = [0, 0]
      let n = 0
      for (let y = 2; y < h - 3; y++) for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4, j = i + w * 4 * 2
        if (!car(i) || !car(j) || !car(i - w * 4 * 2) || !car(j + w * 4)) continue
        n++
        for (let k = 0; k < 2; k++) steps[k] += Math.abs(L(lit[k].data, j) - L(lit[k].data, i))
      }
      return [steps.map((v) => v / Math.max(n, 1)), n]
    }, [bare, square, smooth])
    kit.check(pixels > 20_000 && banding[1] < banding[0] * 0.8, `the fine car's paint changes less from row to row lit smooth (${banding[1].toFixed(4)} a row) than square (${banding[0].toFixed(4)}), over ${pixels} of its pixels`)
    // From the seat (E, then V): the cabin keeps its square faces, and the windscreen is seen through, smooth on or off.
    await page.evaluate(() => { const e = globalThis.engine, w = e.alive.where(e.alive.things[0]); Object.assign(e.pose, { x: w.at[0] / 10 - 1.5, y: w.at[1] / 10 + 1.5, z: w.at[2] / 10 + 3.5 }) })
    await page.waitForFunction(() => globalThis.engine.alive.near, null, { timeout: 5000 }).catch(() => {})
    const tap = async (code) => { await page.keyboard.down(code); await page.waitForTimeout(80); await page.keyboard.up(code) }
    await tap('KeyE')
    await page.waitForFunction(() => globalThis.engine.alive.riding, null, { timeout: 5000 })
    await tap('KeyV')
    await page.waitForTimeout(1200)
    const seat = []
    for (const on of [false, true]) {
      await page.evaluate((on) => { globalThis.engine.falling.smooth = on }, on)
      await page.waitForTimeout(600)
      const png = await page.screenshot()
      if (out) writeFileSync(`${out}/seat-${on ? 'smooth' : 'square'}.png`, png)
      seat.push(png.toString('base64'))
    }
    // Above the bonnet (the top 45% of the picture: the pillars, the roof's edge, the doors' tops and the street through
    // the glass), nothing changes smooth against square: the bonnet below is outside and smooth, the rest is the cabin
    // or seen through glass. The pillars' outsides, seen through the glass, once mirrored the sky and glowed lavender:
    // 7.7% of those pixels changed by more than 12 of 255.
    const changed = await page.evaluate(async (pngs) => {
      const read = async (png) => { const b = await createImageBitmap(await (await fetch(`data:image/png;base64,${png}`)).blob()), c = new OffscreenCanvas(b.width, b.height).getContext('2d'); c.drawImage(b, 0, 0); return c.getImageData(0, 0, b.width, Math.floor(b.height * 0.45)) }
      const [a, b] = await Promise.all(pngs.map(read))
      let n = 0
      for (let i = 0; i < a.data.length; i += 4) {
        const la = a.data[i] * 0.2126 + a.data[i + 1] * 0.7152 + a.data[i + 2] * 0.0722, lb = b.data[i] * 0.2126 + b.data[i + 1] * 0.7152 + b.data[i + 2] * 0.0722
        if (Math.abs(la - lb) > 12 || Math.abs(a.data[i + 2] - b.data[i + 2]) > 12) n++
      }
      return n / (a.data.length / 4)
    }, seat)
    kit.check(changed < 0.005, `from the seat, above the bonnet, ${(changed * 100).toFixed(2)}% of the picture changes smooth against square: the cabin and the pillars are drawn as they were`)
    kit.check(gpu.length === 0, `no errors from the page or WebGPU (${gpu.slice(0, 3).join(' | ') || 'none'})`)
  } catch (e) { kit.check(false, `the page: ${e.message}`) }
  kit.failures.push(...failures)
  await kit.finish('smooth-cars')
}
console.log(failures.length ? `smooth-cars: ${failures.length} failed` : 'smooth-cars: ok')
process.exit(failures.length ? 1 : 0)
