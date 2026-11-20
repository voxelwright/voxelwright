// What the place costs to draw from the photograph's eye (#423), on this machine's GPU.
//
//   node landing/ina/cost.mjs [--place ina] [--sizes 2018x864,1600x900,1170x2532] [--rounds 5] [--query "&clouds=0"]
//
// For each size of picture: the march alone and the march with the place's far model, turn about, at the device's
// own pace and the picture's full size (`engine.spotPasses`, as bay/cost.mjs measures landmarks); and then the page
// left to run as a visitor has it (its own choice of how many pixels to march), the gaps between its frames over
// eight seconds. Both of this machine's turns on the GPU are held meanwhile, so no other thread's check draws beside it.
import { arg, chrome, quiet } from '../../test/kit.mjs'

const server = arg('server', 'http://127.0.0.1:5961'), place = arg('place', 'ina'), rounds = Number(arg('rounds', '5'))
await quiet()
const browser = await chrome()
const r = (v) => Math.round(v * 100) / 100
for (const size of arg('sizes', '2018x864,1600x900,1170x2532').split(',')) {
  const [width, height] = size.split('x').map(Number)
  const open = async (more) => {
    const page = await (await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 })).newPage()
    await page.goto(`${server}/city?place=${place}&fly=0&sound=0&people=0${arg('query', '')}${more}`)
    await page.waitForFunction(() => globalThis.engine?.world.stats.ready > 0 && engine.spot, null, { timeout: 240_000 })
    await page.waitForFunction(() => engine.spot.coming === 0 && engine.world.stats.wanted === 0, null, { timeout: 600_000 })
    await page.waitForTimeout(4000)
    return page
  }
  // At full size, paced.
  let page = await open('&scale=1')
  const paced = await page.evaluate((rounds) => engine.spotPasses(rounds), rounds)
  await page.context().close()
  // As a visitor has it: the page steers its own scale; the gaps between frames.
  page = await open('')
  const ran = await page.evaluate(() => new Promise((done) => {
    const gaps = []; let last = performance.now(); const began = last
    const tick = (now) => { gaps.push(now - last); last = now; if (now - began < 8000) requestAnimationFrame(tick); else { gaps.sort((a, b) => a - b); done({ frames: gaps.length, middle: gaps[gaps.length >> 1], p99: gaps[Math.floor(gaps.length * 0.99)], over25: gaps.filter((g) => g > 25).length, hud: document.querySelector('#hud')?.textContent ?? '' }) } }
    requestAnimationFrame(tick)
  }))
  await page.context().close()
  console.log(JSON.stringify({ size, faces: paced.faces, marchAlone: r(paced.march), marchWithPlace: r(paced.withPlace), place: r(paced.withPlace - paced.march), running: { frames: ran.frames, middleMs: r(ran.middle), p99Ms: r(ran.p99), over25ms: ran.over25, hud: ran.hud.slice(0, 90) } }))
}
await browser.close()
process.exit(0)
