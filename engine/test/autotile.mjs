// Architectural auto-tiling (#226, march.ts AUTOTILE): a face of a fine cell takes trim from its neighbours. The city
// page in the installed Chrome with WebGPU, nothing stubbed. On level open ground a bed of grass and a small scene are
// built cell by cell: a brick wall with a window of glass (coping on top, a sill and lintel round the window, chamfered corners and
// jambs, a plinth where it meets the ground), half of its foot on a concrete pavement and half on grass (the grass
// creeps onto it), a plaster colonnade of two posts one cell wide under a lintel one cell high (fluted posts, a
// moulded band), and a low concrete wall on grass. It is drawn with the trims and without them at the same camera:
//   1. the shaders compile with the trims in, and the GPU reports no fault;
//   2. near, the trims change the picture measurably, and where they are said to: the wall's foot darker, its top lighter;
//   3. far (5x as far), the trims fade: what changes is a smaller share of the picture than near;
//   4. `?autotile=0` in the address draws what the trims switched off in the shader draws.
// The A/B on one page switches the trims off by rebuilding its shaders (march.reshade), so nothing else moves.
//
//   node test/autotile.mjs [--out dir]     pictures go to --out (default: a folder in the system's temporary one)
import { mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { arg, start, still } from './kit.mjs'

const out = resolve(arg('out', join(tmpdir(), 'engine-autotile')))
await mkdir(out, { recursive: true })
const { city, check, failures, finish } = await start()
const BRICK = 8, PLASTER = 9, CONCRETE = 7, GLASS = 11, GRASS = 3
// GI and ReSTIR off: their history is not carried through a shader rebuild, so with them on the A/B would measure them too.
const QUERY = 'fire=0&sound=0&music=0&people=0&living=0&scale=1&taa=0&hour=11&gi=0&restir=0'

/** Finds flat grass with nothing over it, builds the scene there, and says where it is. */
async function build(page, at) {
  const spot = at ?? await page.evaluate(() => {
    const e = globalThis.engine, ground = (x, z) => Math.round(e.ground(x / 10, z / 10) * 10)
    // Level ground under the scene, and a clear look at it from 18 m in front: nothing standing in the way.
    const clear = (x0, z0) => {
      const g = ground(x0, z0)
      for (let z = z0 - 10; z <= z0 + 4; z += 2) for (let x = x0 - 4; x <= x0 + 56; x += 4) {
        if (ground(x, z) !== g) return null
        for (const up of [1, 4, 10, 20, 40]) if (e.kind(x, g + up, z) !== 0) return null
      }
      for (let z = z0 - 190; z < z0 - 10; z += 6) for (let x = x0 - 10; x <= x0 + 62; x += 6) {
        if (ground(x, z) > g + 3) return null
        for (const up of [4, 12, 24]) if (e.kind(x, g + up, z) !== 0) return null
      }
      return g
    }
    const p = e.pose, x0 = Math.round(p.x * 10), z0 = Math.round(p.z * 10)
    for (let r = 0; r < 2000; r += 20) for (let dz = -r; dz <= r; dz += 20) for (let dx = -r; dx <= r; dx += 20) {
      if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue
      const g = clear(x0 + dx, z0 + dz)
      if (g === null) continue
      // The top solid cell there; the bed of grass goes on it, the scene on the bed.
      let y = g + 4
      while (y > g - 8 && e.kind(x0 + dx, y, z0 + dz) === 0) y--
      return [x0 + dx, y + 2, z0 + dz]
    }
    return null
  })
  if (!spot) return null
  await page.evaluate(([[X, G, Z], K]) => {
    const e = globalThis.engine, put = (x, y, z, k) => e.set([x, y, z], 0, k)
    // A bed of grass one cell deep over the level ground, and a pavement of concrete in front of the wall's right half, flush with it.
    for (let x = X - 4; x < X + 56; x++) for (let z = Z - 10; z < Z + 4; z++) if (!(x >= X + 12 && x < X + 26 && z >= Z - 8 && z < Z)) put(x, G - 1, z, K.GRASS)
    for (let x = X + 12; x < X + 26; x++) for (let z = Z - 8; z < Z; z++) put(x, G - 1, z, K.CONCRETE)
    // The brick wall, two cells thick, with a window of glass in its left half.
    for (let y = G; y < G + 16; y++) for (let x = X; x < X + 24; x++) for (let z = Z; z < Z + 2; z++) {
      const pane = x >= X + 4 && x < X + 9 && y >= G + 6 && y < G + 11
      put(x, y, z, pane ? K.GLASS : K.BRICK)
    }
    // A colonnade of plaster: two posts one cell wide, a lintel one cell high on them.
    for (let y = G; y < G + 12; y++) { put(X + 30, y, Z, K.PLASTER); put(X + 37, y, Z, K.PLASTER) }
    for (let x = X + 29; x < X + 39; x++) put(x, G + 12, Z, K.PLASTER)
    // A low concrete wall on the grass.
    for (let y = G; y < G + 6; y++) for (let x = X + 42; x < X + 52; x++) for (let z = Z; z < Z + 2; z++) put(x, y, z, K.CONCRETE)
  }, [spot, { BRICK, PLASTER, CONCRETE, GLASS, GRASS }])
  await still(page)
  return spot
}

/** Stands the eye `back` cells in front of the scene's middle, a little over it, looking at it (moved `aside` cells along the wall). */
const look = (page, [X, G, Z], back, aside = 0) => page.evaluate(([X, G, Z, back, aside]) => {
  const e = globalThis.engine, f = [X + 26 + aside, G + 7 + back * 0.08, Z - back], t = [X + 26 + aside, G + 7, Z]
  Object.assign(e.pose, { x: f[0] / 10, y: f[1] / 10, z: f[2] / 10, yaw: Math.atan2(t[0] - f[0], -(t[2] - f[2])), pitch: Math.atan2(t[1] - f[1], Math.hypot(t[0] - f[0], t[2] - f[2])) })
}, [X, G, Z, back, aside])

/** The picture as shown, once the town and the sun's maps are made, saved as `name`. */
async function shot(page, name) {
  await page.waitForTimeout(400)
  await still(page, { sun: true })
  await page.waitForTimeout(700)
  const png = await page.screenshot()
  await writeFile(join(out, `${name}.png`), png)
  return png.toString('base64')
}

/** How two pictures differ: the share of pixels off by more than 6 of 255, the mean difference, and the mean difference inside each box given ([top, bottom, left, right], fractions of the picture). */
const differ = (page, a, b, bands = []) => page.evaluate(async ([a, b, bands]) => {
  const read = async (png) => {
    const img = await createImageBitmap(await (await fetch(`data:image/png;base64,${png}`)).blob())
    const paper = new OffscreenCanvas(img.width, img.height).getContext('2d')
    paper.drawImage(img, 0, 0)
    return paper.getImageData(0, 0, img.width, img.height)
  }
  const A = await read(a), B = await read(b), w = A.width, h = A.height
  let off = 0, sum = 0
  const band = bands.map(() => [0, 0])
  for (let i = 0; i < A.data.length; i += 4) {
    const d = Math.max(Math.abs(A.data[i] - B.data[i]), Math.abs(A.data[i + 1] - B.data[i + 1]), Math.abs(A.data[i + 2] - B.data[i + 2]))
    if (d > 6) off++
    sum += d
    const y = Math.floor(i / 4 / w) / h
    bands.forEach(([lo, hi, x0, x1], k) => {
      const x = ((i / 4) % w) / w
      if (y >= lo && y < hi && x >= x0 && x < x1) { band[k][0] += d; band[k][1]++ }
    })
  }
  return { off: off / (w * h), mean: sum / (w * h), bands: band.map(([s, n]) => (n ? s / n : 0)) }
}, [a, b, bands])

/** Where a cell is drawn on the screen, as fractions of the width and height (the march's pick does not say this). */
const onScreen = (page, cell) => page.evaluate((c) => {
  const v = globalThis.engine.view(), dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
  const d = [c[0] - v.eye[0], c[1] - v.eye[1], c[2] - v.eye[2]], z = dot(d, v.forward)
  return [0.5 + dot(d, v.right) / (z * v.tanHalf * (innerWidth / innerHeight)) / 2, 0.5 - dot(d, v.up) / (z * v.tanHalf) / 2]
}, cell)

/** The page's own GPU time a frame (ms), the median of three seconds' worth, at the camera as it stands. */
const gpuTime = (page) => page.evaluate(async () => {
  const seen = []
  for (let i = 0; i < 30; i++) { await new Promise((r) => setTimeout(r, 100)); seen.push(globalThis.engine.gpuMs) }
  seen.sort((a, b) => a - b)
  return seen[15]
})

try {
  const page = await city(`${QUERY}&autotile=1`, { size: [1280, 720], dpr: 1 })
  await still(page)
  await page.evaluate(() => { const off = globalThis.engine.off; off.add('puffs'); off.add('crumbs') })
  const spot = await build(page)
  check(!!spot, `a flat patch of grass with nothing over it is found and the scene built on it (${spot})`)
  if (!spot) throw new Error('no place for the scene')
  const [X, G, Z] = spot
  check(await page.evaluate(([X, G, Z]) => (globalThis.engine.kind(X + 2, G + 15, Z) & 15) === 8 && (globalThis.engine.kind(X + 30, G + 6, Z) & 15) === 9, spot), 'the wall and the colonnade stand')

  await look(page, spot, 34)
  const nearOn = await shot(page, 'near-autotile-1')
  const msOn = await gpuTime(page)
  await look(page, spot, 100)
  const midOn = await shot(page, 'mid-autotile-1')
  await look(page, spot, 100, 0.3)
  const midOnAside = await shot(page, 'mid-autotile-1-aside')
  await look(page, spot, 170)
  const farOn = await shot(page, 'far-autotile-1')
  const faultsOn = await page.evaluate(() => [...globalThis.engine.gpu.faults])
  check(faultsOn.length === 0, `with the trims the GPU reports no fault (${faultsOn.join('; ') || 'none'})`)

  // The same page, the trims switched off in the shader and nothing else.
  const rebuilt = await page.evaluate(() => globalThis.engine.march.reshade((wgsl) => {
    const call = 'if (AUTOTILE && !slope'
    if (!wgsl.includes(call)) throw new Error('the march has no autotile call to switch off')
    return wgsl.replace(call, 'if (false && !slope')
  }))
  check(rebuilt.compiled > 0, `the shaders are rebuilt without the trims (${rebuilt.compiled} in ${Math.round(rebuilt.ms)} ms)`)
  await look(page, spot, 34)
  const nearOff = await shot(page, 'near-autotile-0')
  const msOff = await gpuTime(page)
  console.log(`  GPU a frame, near (median): ${msOn.toFixed(2)} ms with the trims, ${msOff.toFixed(2)} ms without (one session, a shared GPU: a ratio, not a budget)`)
  await look(page, spot, 100)
  const midOff = await shot(page, 'mid-autotile-0')
  await look(page, spot, 100, 0.3)
  const midOffAside = await shot(page, 'mid-autotile-0-aside')
  await look(page, spot, 170)
  const farOff = await shot(page, 'far-autotile-0')
  const again = await shot(page, 'far-autotile-0-again')

  // Boxes along the wall's foot course, its top course and a course halfway up, on its right half (no window there):
  // where the wall's cells fall on the screen.
  await look(page, spot, 34)
  const course = async (y) => {
    const [x0, y0] = await onScreen(page, [X + 14, y + 0.3, Z]), [x1, y1] = await onScreen(page, [X + 22, y + 0.7, Z])
    return [Math.min(y0, y1), Math.max(y0, y1), Math.min(x0, x1), Math.max(x0, x1)]
  }
  const boxes = [await course(G), await course(G + 15), await course(G + 8)]
  // The scene's own box on the screen: the HUD, the clouds and the far town are left out of what is measured.
  const sceneBox = async () => {
    const [x0, y0] = await onScreen(page, [X - 2, G - 1, Z]), [x1, y1] = await onScreen(page, [X + 54, G + 17, Z])
    return [Math.min(y0, y1), Math.max(y0, y1), Math.min(x0, x1), Math.max(x0, x1)]
  }
  const scene = await sceneBox()
  boxes.push(scene)
  console.log(`  courses on the screen: ${boxes.map((b) => b.map((v) => v.toFixed(3)).join(' ')).join(' | ')}`)
  const near = await differ(page, nearOn, nearOff, boxes)
  await look(page, spot, 170)
  const farScene = await sceneBox()
  const far = await differ(page, farOn, farOff, [farScene])
  const noise = await differ(page, farOff, again, [farScene])
  // Shimmer: at 10 m (where a cell is 4 to 7 pixels, the trims half faded in) the eye moved a third of a cell along
  // the wall changes the picture with the trims no more than without them.
  await look(page, spot, 100)
  const midScene = await sceneBox()
  const shimmerOn = (await differ(page, midOn, midOnAside, [midScene])).bands[0], shimmerOff = (await differ(page, midOff, midOffAside, [midScene])).bands[0]
  const midChange = (await differ(page, midOn, midOff, [midScene])).bands[0]
  console.log(`  mid (10 m): trims change the scene by ${midChange.toFixed(2)}; a third of a cell aside changes it by ${shimmerOn.toFixed(2)} with them, ${shimmerOff.toFixed(2)} without`)
  check(shimmerOn < shimmerOff * 1.25 + 0.3, `at 10 m the trims add no shimmer: a third of a cell aside changes the scene by ${shimmerOn.toFixed(2)} with them, ${shimmerOff.toFixed(2)} without`)
  const [foot, top, mid, sceneNear] = near.bands
  const sceneFar = far.bands[0], sceneNoise = noise.bands[0]
  console.log(`  near: ${(near.off * 100).toFixed(2)}% of pixels changed, mean ${near.mean.toFixed(2)}; foot course ${foot.toFixed(1)}, top course ${top.toFixed(1)}, middle course ${mid.toFixed(1)} (of 255)`)
  console.log(`  scene box: near mean change ${sceneNear.toFixed(2)}, far ${sceneFar.toFixed(2)}, the same far picture twice ${sceneNoise.toFixed(2)} (of 255)`)
  check(sceneNear > sceneNoise * 3 + 0.5, `near, the trims change the scene (mean ${sceneNear.toFixed(2)} of 255 against ${sceneNoise.toFixed(2)} for no change)`)
  check(foot > 4 && foot > mid * 3, `the plinth changes the wall's foot course (${foot.toFixed(1)} of 255) and not its middle (${mid.toFixed(1)})`)
  check(top > 4 && top > mid * 3, `the coping changes the wall's top course (${top.toFixed(1)} of 255) and not its middle (${mid.toFixed(1)})`)
  check(sceneFar < sceneNear * 0.5, `far (5x as far), the trims fade: the scene changes by ${sceneFar.toFixed(2)} of 255 against ${sceneNear.toFixed(2)} near`)
  await page.context().close()

  // The address's switch: the same scene in a page asked for no trims draws as the shader without them did.
  const plain = await city(`${QUERY}&autotile=0`, { size: [1280, 720], dpr: 1 })
  await still(plain)
  await plain.evaluate(() => { const off = globalThis.engine.off; off.add('puffs'); off.add('crumbs') })
  await build(plain, spot)
  await look(plain, spot, 34)
  const asked = await shot(plain, 'near-address-autotile-0')
  const sameAsOff = await differ(plain, asked, nearOff, boxes), sameAsOn = await differ(plain, asked, nearOn, boxes)
  const offFoot = sameAsOff.bands[0], onFoot = sameAsOn.bands[0]
  check(offFoot < onFoot * 0.3 && sameAsOff.bands[1] < sameAsOn.bands[1] * 0.3, `?autotile=0 draws the wall's foot and top as the shader without the trims does (differences ${offFoot.toFixed(1)}, ${sameAsOff.bands[1].toFixed(1)} from it switched off; ${onFoot.toFixed(1)}, ${sameAsOn.bands[1].toFixed(1)} from it on)`)
  const faultsOff = await plain.evaluate(() => [...globalThis.engine.gpu.faults])
  check(faultsOff.length === 0, `with ?autotile=0 the GPU reports no fault (${faultsOff.join('; ') || 'none'})`)
  console.log(`  pictures: ${out}`)
} catch (e) {
  failures.push(String(e?.stack ?? e))
}
await finish('autotile')
