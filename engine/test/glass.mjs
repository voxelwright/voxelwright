// Glass is seen through (#163): the city page in the installed Chrome with WebGPU, nothing stubbed. A lamp, bright
// and warm, is put behind glass and looked at through it, from outside in and from inside out: in the world's own
// cells (the works yard's office of glass) and through a piece's glass (a living thing, a box with walls of glass). Where glass stopped
// the eye, the middle of the picture was the pale blue of the glass or what it mirrored, never the lamp. With mirrors
// off (Shift+M) glass is a pale face again, the world's and a body's: there the lamp is not seen, which is told by
// the middle being no brighter than the same pane beside it. (Putting the lamp out to compare was an edit, and it
// set off what stood round it: the office's wall came down, and the lamp's cells fell on each other.) And the wand stops at a pane, as a pick does: its
// ring is drawn on a window, not lost behind it.
//
// Smoke and dust are not drawn while the middle is measured. They drift: the yard's chimney's smoke lay across the
// look to the lamp in some runs and not others, and with it the lamp read 0.53 to 0.87 where it reads 1.00 without.
//
//   node test/glass.mjs [--out dir]     with --out: the pictures measured
import { mkdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { arg, start, still } from './kit.mjs'

const out = arg('out', '') && resolve(arg('out', ''))
if (out) await mkdir(out, { recursive: true })
const { city, check, failures, finish } = await start()
// A lamp in the colour of a street lamp's own (46) is lit by day; in any other it is a sign, lit only at night (march.ts lit).
const GLASS = 11, LAMP = 15 | (46 << 8), STEEL = 12
try {
  const page = await city('fire=0&sound=0&music=0&people=0&scale=1', { size: [960, 540], dpr: 1 })
  await still(page)
  await page.evaluate(() => { const off = globalThis.engine.off; off.add('puffs'); off.add('crumbs') })
  // Where the page starts: in the street, in the sun.
  const home = await page.evaluate(() => { const p = globalThis.engine.pose; return [Math.round(p.x * 10), Math.round(p.z * 10)] })
  /** Stands the eye at a point (cells; with `up`, that far over the ground there) and turns it to another. */
  const eye = (from, to, up) => page.evaluate(([from, t, up]) => {
    const e = globalThis.engine, f = up === undefined ? from : [from[0], Math.round(e.ground(from[0] / 10, from[2] / 10) * 10) + up, from[2]]
    Object.assign(e.pose, { x: f[0] / 10, y: f[1] / 10, z: f[2] / 10, yaw: Math.atan2(t[0] - f[0], -(t[2] - f[2])), pitch: Math.atan2(t[1] - f[1], Math.hypot(t[0] - f[0], t[2] - f[2])) })
  }, [from, to, up])
  /** The square of `half` pixels each way round the middle of the picture as it is shown (or `dx` pixels to the right of it), as rgba bytes (once the town and the sun's maps are made). */
  const square = async (name, half, dx = 0) => {
    await page.waitForTimeout(300)
    await still(page, { sun: true })
    await page.waitForTimeout(500)
    const png = await page.screenshot()
    if (out) await writeFile(join(out, `${name}.png`), png)
    return page.evaluate(async ([png, half, dx]) => {
      const picture = await createImageBitmap(await (await fetch(`data:image/png;base64,${png}`)).blob())
      const w = picture.width, h = picture.height, paper = new OffscreenCanvas(w, h).getContext('2d')
      paper.drawImage(picture, 0, 0)
      return [...paper.getImageData((w >> 1) - half + dx, (h >> 1) - half, half * 2, half * 2).data]
    }, [png.toString('base64'), half, dx])
  }
  /** The middle of the picture (but the mark at its very middle), or `dx` pixels to the right of it: its mean red, green and blue, 0 to 1. */
  const middle = async (name, dx = 0) => {
    const d = await square(name, 24, dx), rgb = [0, 0, 0]
    let n = 0
    for (let y = 0; y < 48; y++) for (let x = 0; x < 48; x++) {
      if (!dx && Math.abs(x - 24) < 8 && Math.abs(y - 24) < 8) continue
      for (let c = 0; c < 3; c++) rgb[c] += d[(y * 48 + x) * 4 + c] / 255
      n++
    }
    return rgb.map((v) => v / n)
  }
  /** How much brighter the middle is than the same pane 150 pixels to its left (the most of red, green and blue, on the mean): next to nothing where the pane hides the lamp. */
  const shows = async (name) => {
    const lit = await middle(name), side = await middle(`${name}-beside`, -150)
    return Math.max(...lit.map((v, c) => v - side[c]))
  }
  /** Mirrors on or off (the M key): the page's own flags, shadows and mirrors or shadows alone. */
  const mirrors = (on) => page.evaluate((on) => { globalThis.engine.flags = on ? 3 : 1 }, on)
  // The lamp is near white on the screen, through a tint or not. Glass that stopped the eye showed 0.2 to 0.6 here.
  const lamp = (rgb) => Math.min(...rgb) > 0.66
  const say = (rgb) => rgb.map((v) => v.toFixed(2)).join(', ')

  const set = (c, r, kind) => page.evaluate(([c, r, kind]) => globalThis.engine.set(c, r, kind), [c, r, kind])
  const kindAt = (c) => page.evaluate((c) => globalThis.engine.kind(...c) & 15, c)

  // The world's cells: the works yard's office of glass (city.rs stamp_office, YARD_OFFICE: 12 m by 10 m from cell
  // 940, 4550, its walls one cell of glass, a steel column at each end of the middle bay of its long sides). A lamp
  // on its floor, looked at from the yard through the middle of its south wall; a lamp in the yard, looked at from
  // inside through the same wall.
  const floor = await page.evaluate(() => Math.round(globalThis.engine.ground(100, 460) * 10) + 1)
  const inside = [990, floor + 4, 4570], outside = [1010, Math.round(await page.evaluate(() => globalThis.engine.ground(101, 452)) * 10) + 4, 4520]
  check(await kindAt([990, floor + 12, 4550]) === GLASS, 'the office stands, its south wall of glass')
  await set(inside, 8, LAMP)
  await set(outside, 6, LAMP)
  await still(page)
  check(await kindAt(inside) === 15 && await kindAt(outside) === 15, 'a lamp stands in it and one outside it')
  await eye([990, 0, 4528], inside, 10)
  const inWorld = await middle('world-outside-in')
  check(lamp(inWorld), `from the yard the lamp in the office is seen through its wall (${say(inWorld)})`)
  await mirrors(false)
  const hidWorld = await shows('world-mirrors-off')
  check(hidWorld < 0.05, `with mirrors off the office's glass is a face again: the lamp in it is not seen (the middle ${hidWorld.toFixed(2)} brighter than the pane beside it)`)
  await mirrors(true)
  // The wand in hand, aimed at a point on the wall of glass: its ring is drawn on the pane, round the middle of the
  // picture. Where the wand took the depth of what is behind the pane, the ring was a ring round a point far from
  // anything drawn there, and not one pixel of it showed.
  // (Aside from the lamp: on the lamp the ring is white on white.)
  await eye([990, 0, 4528], [950, floor + 14, 4560], 10)
  const ringSquare = 90, bare = await square('world-no-wand', ringSquare)
  await page.evaluate(() => { const w = globalThis.engine.wand; w.held = true; w.mode = 'point' })
  await page.waitForTimeout(800)
  const aimed = await page.evaluate(() => { const e = globalThis.engine, t = e.wand.target; return t && { how: t.how, material: t.cell ? e.kind(...t.cell) & 15 : 0 } })
  const ringed = await square('world-wand', ringSquare)
  await page.evaluate(() => { globalThis.engine.wand.held = false })
  // Whole: in each quarter round the middle. (Before, a stair just behind the pane caught half of it.)
  const quarters = [0, 0, 0, 0], across = ringSquare * 2
  for (let i = 0; i < bare.length; i += 4) if (Math.max(Math.abs(bare[i] - ringed[i]), Math.abs(bare[i + 1] - ringed[i + 1]), Math.abs(bare[i + 2] - ringed[i + 2])) > 20) {
    const x = (i >> 2) % across, y = Math.floor((i >> 2) / across)
    quarters[(x < ringSquare ? 0 : 1) + (y < ringSquare ? 0 : 2)]++
  }
  const changed = quarters.reduce((a, b) => a + b)
  check(aimed?.how === 'point' && aimed.material === GLASS && changed > 600 && Math.min(...quarters) > changed * 0.15, `the wand aimed at the office's glass wall draws its ring, whole, on the pane (${aimed?.how} on ${aimed?.material}, pixels changed in each quarter round it ${quarters.join(', ')})`)
  await eye([1010, floor + 12, 4575], outside)
  const outWorld = await middle('world-inside-out')
  check(lamp(outWorld), `from inside the office the lamp in the yard is seen through its wall (${say(outWorld)})`)

  // In the open yard west of the office, with nothing round it for 6 m and nothing over it for 4 m (so that only
  // what is put there is between the eye and the lamp): [x, ground, z] in cells, the ground its top cell.
  const r = await page.evaluate(() => {
    const e = globalThis.engine
    for (let z = 4420; z < 4780; z += 20) for (let x = 60; x < 880; x += 20) {
      const g = Math.round(e.ground(x / 10, z / 10) * 10)
      let clear = true
      for (let dx = -60; dx <= 60 && clear; dx += 5) for (let dz = -40; dz <= 40 && clear; dz += 5) {
        const h = Math.round(e.ground((x + dx) / 10, (z + dz) / 10) * 10)
        if (Math.abs(h - g) > 8) clear = false
        for (let y = 1; y < 40 && clear; y += 3) if (e.kind(x + dx, h + y, z + dz)) clear = false
      }
      if (clear) return [x, g, z]
    }
    return null
  })
  check(!!r, `an open place in the yard (${r})`)

  // A piece: a living thing that is a box with walls of glass on a steel floor under a steel roof, standing still
  // (drawn by pieces.ts, not marched). A lamp in the world's cells beyond it.
  const side = 24, low = [r[0] - side / 2, r[1] + 2, r[2] - side / 2]
  const thing = await page.evaluate(async ([low, side, GLASS, STEEL]) => {
    const e = globalThis.engine, cells = new Int32Array(side * side * side)
    for (let y = 0; y < side; y++) for (let z = 0; z < side; z++) for (let x = 0; x < side; x++) {
      const wall = x === 0 || x === side - 1 || z === 0 || z === side - 1
      if (y === 0 || y === side - 1) cells[x + side * (z + side * y)] = STEEL
      else if (wall) cells[x + side * (z + side * y)] = GLASS
    }
    const foot = (x, z) => ({ at: [x, 1, z], reach: 3, steers: false, drives: true })
    const motor = { front: 0, grip: 1.3, power: 0, top: 0, steer: 0, hover: 0, lift: 0, upright: 1, turns: 0, jump: 0, tough: 1000, feet: [foot(2, 2), foot(side - 3, 2), foot(2, side - 3), foot(side - 3, side - 3)] }
    globalThis.box = await e.alive.spawn({ name: 'box', cells, size: [side, side, side], low, controls: 'drive', motor })
    return globalThis.box.id
  }, [low, side, GLASS, STEEL])
  check(thing > 0, `a box of glass is brought to life (body ${thing})`)
  await page.waitForFunction(() => globalThis.engine.bodies === 0 && globalThis.engine.alive.where(globalThis.box), null, { timeout: 20_000 })
  const mid = await page.evaluate(() => globalThis.engine.alive.where(globalThis.box).at.map(Math.round))
  const light = [mid[0] + side / 2 + 14, r[1] + 5, mid[2]]
  await set(light, 8, LAMP)
  await still(page)
  await eye([mid[0] - side / 2 - 16, 0, mid[2]], [light[0], light[1] + 3, light[2]], 10)
  const inPiece = await middle('piece-outside-in')
  check(lamp(inPiece), `from outside a box of glass, through both its sides, the lamp beyond it is seen (${say(inPiece)})`)
  await mirrors(false)
  const hidPiece = await shows('piece-mirrors-off')
  check(hidPiece < 0.05, `with mirrors off the box's glass is a face: the lamp beyond it is not seen (the middle ${hidPiece.toFixed(2)} brighter than the pane beside it)`)
  await mirrors(true)
  await eye(mid, light)
  const outPiece = await middle('piece-inside-out')
  check(lamp(outPiece), `from inside the box the lamp outside it is seen (${say(outPiece)})`)

  // The sun through glass, traced and from the sun's maps alike (K: every shadow traced). A lump of glass 1 m across
  // in the street in the sun: the maps let the sun through it, and traced shadows let it through three panes each
  // crossed whole, so the ground where its shadow would fall is lit either way. Traced, it had been dark: a look to
  // the sun stopped at the third cell of glass it met, and a lump is ten.
  const lump = [home[0] + 120, 0, home[1] - 60]
  lump[1] = await page.evaluate(([x, z]) => Math.round(globalThis.engine.ground(x / 10, z / 10) * 10), [lump[0], lump[2]]) + 6
  await set(lump, 5, GLASS)
  await still(page)
  // Where the sun through its middle meets the ground, looked down at from 3 m over it.
  const under = await page.evaluate(([x, y, z]) => { const s = globalThis.engine.march.sun.s, down = (y - Math.round(globalThis.engine.ground(x / 10, z / 10) * 10)) / s[1]; return [Math.round(x - s[0] * down), Math.round(z - s[2] * down)] }, lump)
  await page.evaluate(([x, z]) => { const e = globalThis.engine; Object.assign(e.pose, { x: x / 10, y: e.ground(x / 10, z / 10) + 3, z: z / 10, yaw: 0, pitch: -Math.PI / 2 + 0.001 }) }, under)
  const mapped = await middle('lump-maps')
  await page.evaluate(() => { globalThis.engine.march.maps = false })
  const traced = await middle('lump-traced')
  await page.evaluate(() => { globalThis.engine.march.maps = true })
  const apart = Math.max(...mapped.map((v, c) => Math.abs(v - traced[c])))
  check(apart < 0.05, `the ground under a lump of glass in the sun is lit as brightly with every shadow traced as from the sun's maps (${say(mapped)} against ${say(traced)})`)
} catch (e) {
  failures.push(String(e))
}
await finish('glass')
