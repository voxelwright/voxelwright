// The wait, filmed (#244): what is seen at the place while a thing is being made, and when it cannot be.
// NO MODEL IS RUN: a kept reply stands in for one, and takes as long as a model does (--seconds 14).
//
//   node test/wait.mjs --out dir [--seconds 14] [--refuse]      pictures every so often, and what a frame costs with and without
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { helper } from '../helper.mjs'
import { arg, chrome, has, serve } from './kit.mjs'

const out = arg('out', 'wait'), seconds = Number(arg('seconds', '14')), refuse = has('refuse'), held = has('held')
mkdirSync(out, { recursive: true })
const dir = mkdtempSync(join(tmpdir(), 'engine-wait-')), server = await serve('/dev/null', ['--world', join(dir, 'world.log')])
const STALL = { name: 'fruit stall', size: [34, 25, 18], parts: [
  ['box', 'wood', '2:6', 2, 0, 2, 4, 24, 4], ['box', 'wood', '2:6', 30, 0, 2, 32, 24, 4], ['box', 'wood', '2:6', 2, 0, 14, 4, 24, 16], ['box', 'wood', '2:6', 30, 0, 14, 32, 24, 16],
  ['box', 'wood', 'own', 2, 8, 2, 32, 9, 16], ['box', 'wood', '2:5', 4, 0, 3, 30, 8, 4],
  ['stripes', 'plaster', '0:4', 0, 24, 0, 34, 25, 18, 'x', 4, 'white'],
  ['box', 'leaves', '2:4', 6, 9, 5, 9, 11, 8], ['box', 'leaves', '0:4', 11, 9, 5, 14, 11, 8], ['ball', 'leaves', '8:4', 16, 9, 5, 19, 12, 8],
  ['cyl', 'wood', 'own', 22, 9, 5, 26, 13, 9, 'y'], ['text', 'lamp', '3:1', 3, 1, 2, 'FRUIT'],
] }
// Refused: a part that floats, every time, so it is asked three times and nothing is made.
const BAD = { ...STALL, parts: [...STALL.parts, ['box', 'wood', 'own', 10, 15, 6, 14, 19, 10]] }
// Held: a hall as big as a thing may be, asked for from inside a house, where no place near will take it.
const HALL = { name: 'brick hall', size: [64, 30, 64], parts: [['box', 'brick', 'own', 0, 0, 0, 64, 30, 64], ['box', 'roofing', 'own', 0, 28, 0, 64, 30, 64]] }
const model = async () => { await new Promise((r) => setTimeout(r, (refuse ? seconds / 3 : seconds) * 1000)); return { text: JSON.stringify(held ? HALL : refuse ? BAD : STALL), model: 'a kept reply', ms: 0, cost: 0 } }
const h = await helper({ world: server.url, port: 0, model, journal: join(dir, 'made.jsonl'), kept: join(dir, 'library') })
const browser = await chrome(), page = await (await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 })).newPage()
page.on('pageerror', (e) => console.log(`page error: ${e.message}`))
try {
  await page.goto(`${server.url}/city?fly=0&shared=1&name=Ada&at=${arg('at', held ? '70,17.2,399' : '70,17.6,407')}&look=${arg('look', held ? '0,-80' : '0,-14')}${new URL(h.link).hash}`)
  await page.waitForFunction(() => { const s = globalThis.engine?.world.stats; return s && s.ready > 0 && s.wanted === 0 && s.stale === 0 }, null, { timeout: 120_000 })
  await page.addStyleTag({ content: '#tools, #boom { display: none }' })
  await page.waitForTimeout(3000)
  const cost = () => page.evaluate(async () => { await new Promise((r) => setTimeout(r, 2500)); return { frame: +engine.frameMs.toFixed(2), cpu: +engine.cpuMs.toFixed(2), gpu: +engine.gpuMs.toFixed(2), scale: engine.scale, cubes: engine.gathering.cubes } })
  const before = await cost()
  await page.keyboard.press('Enter')
  await page.keyboard.type(refuse ? 'a thing that cannot be made' : 'a fruit stall')
  await page.keyboard.press('Enter')
  const t0 = Date.now(), shot = async (name) => { await page.screenshot({ path: join(out, `${held ? 'held' : refuse ? 'refuse' : 'make'}-${name}.png`) }); console.log(`  ${((Date.now() - t0) / 1000).toFixed(1)} s ${name}`) }
  for (const at of [0.6, 1.8, 3.5]) { await page.waitForTimeout(Math.max(0, at * 1000 - (Date.now() - t0))); await shot(`${at}s`) }
  const during = await cost()
  await shot('circling')
  if (held) {
    await page.waitForSelector('#choice button', { timeout: 120_000 }); await shot('asked')
    // Outside, looking at the house: put it there with the place cleared.
    await page.evaluate(() => Object.assign(engine.pose, { x: 70, y: 21, z: 412, yaw: 0, pitch: -0.25 }))
    await page.waitForTimeout(2500); await shot('asked-from-outside')
    await page.keyboard.press('Digit1')
    await page.waitForFunction(() => engine.asker.busy === 0, null, { timeout: 120_000 })
    await page.waitForTimeout(600); await shot('cleared-0'); await page.waitForTimeout(2500); await shot('cleared-1'); await page.waitForTimeout(6000); await shot('cleared-2')
  } else if (refuse) {
    await page.waitForTimeout(Math.max(0, (seconds / 3) * 1000 + 600 - (Date.now() - t0))); await shot('another-go')
    await page.waitForFunction(() => engine.asker.busy === 0, null, { timeout: 120_000 })
    for (const name of ['let-go', 'falling', 'lying']) { await page.waitForTimeout(350); await shot(name) }
    await page.waitForTimeout(5000); await shot('after')
  } else {
    await page.waitForFunction(() => [...document.querySelectorAll('#cues p')].some((p) => p.textContent === 'fruit stall'), null, { timeout: 120_000, polling: 50 })
    for (const name of ['closing-0', 'closing-1', 'closing-2', 'closing-3', 'closing-4', 'closing-5', 'closing-6', 'closing-7', 'closing-8', 'landed']) { await page.waitForTimeout(name === 'landed' ? 1500 : 120); await shot(name) }
  }
  const after = await cost()
  console.log(`a frame: before ${JSON.stringify(before)}\n         during ${JSON.stringify(during)}\n         after  ${JSON.stringify(after)}`)
} finally {
  await browser.close(); await h.close(); server.stop(); rmSync(dir, { recursive: true, force: true })
}
process.exit(0)
