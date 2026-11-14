// The place before its rule, from the real page (#264, the BUILD lane): a realm asked for in the bar can be stepped
// into as soon as its place stands, while its rules are still being written. A kept idea, a kept plan and a kept
// rule stand in for the model, and the rule's reply is held back until the check lets it go: the page must offer
// the realm before that. No model is run.
//
//   node test/placed.mjs
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { helper } from '../helper.mjs'
import { chrome, serve } from './kit.mjs'

const failures = []
const check = (ok, what) => { console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) failures.push(what) }
const dir = mkdtempSync(join(tmpdir(), 'engine-placed-'))
const server = await serve('/dev/null', ['--world', join(dir, 'world.log')]), world = server.url
const IDEA = JSON.stringify({ name: 'Regatta', about: 'A sailing club on a beach. A starter with a flag stands by a wooden jetty.', questions: [] })
const PLAN = JSON.stringify({ land: 'shore', room: 300, stands: 'A jetty runs north into the sea from a marker post.', builds: [{ name: 'jetty', parts: [['posts', 'steel', '0:4', [[0, -100]], 4, 30], ['line', 'wood', 'own', [[0, -100], [0, -260]], 12, 2, 4]] }] })
let release, rules = 0
const held = new Promise((r) => { release = r })
const model = async (q) => {
  if (q.system.startsWith('You design the PLACE')) return { text: PLAN, model: 'a kept reply', ms: 0, cost: 0 }
  if (q.system.startsWith('Someone in a world made of small cubes')) return { text: IDEA, model: 'a kept reply', ms: 0, cost: 0 }
  rules++
  await held
  const [, ax, az] = /People arrive at \[(-?\d+), (-?\d+)\]/.exec(q.prompt) ?? []
  return { model: 'a kept reply', ms: 0, cost: 0, text: `NAME: regatta\nCANNOT:\nnothing\nRULE:\n\`\`\`js\non('start', (world) => { if (!world.people.some((p) => p.mine)) world.actor('starter', { name: 'Starter', at: [${ax} + 30, ${az}] }) })\non('said', (world, e) => world.actor('starter', { face: e.at, say: 'Ready when you are, ' + e.name + '.' }))\n\`\`\`` }
}
const h = await helper({ world, port: 0, model, journal: join(dir, 'made.jsonl'), kept: join(dir, 'library') })
const browser = await chrome()
try {
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 })).newPage()
  await page.goto(`${world}/city?fly=0&shared=1&name=Ada&at=70,17.2,406&look=0,-11.3${new URL(h.link).hash}`)
  await page.waitForFunction(() => globalThis.engine?.world.stats.ready > 0, null, { timeout: 120_000 })
  const choice = (starts) => page.waitForFunction((s) => !document.querySelector('#choice')?.hidden && document.querySelector('#choice p')?.textContent.startsWith(s), starts, { timeout: 30_000 })
  await page.keyboard.press('Enter')
  await page.keyboard.type('Create a realm called regatta. A sailing club on a beach.')
  const began = Date.now()
  await page.keyboard.press('Enter')
  await choice('A new realm.')
  await page.keyboard.press('Digit1')
  await choice('With a director?')
  await page.keyboard.press('Digit2')
  await choice('Regatta: its place stands')
  const realms = (await (await fetch(`${world}/realms`)).json()).realms.filter((r) => !r.home), there = realms[0] ? await (await fetch(`${world}/realm/${realms[0].id}/world/rules`)).json() : []
  check(realms.length === 1 && there.length === 1 && there[0].id === 'place' && there[0].running && rules <= 1, `the page offers the realm as soon as its place stands (${Date.now() - began} ms after Enter, the model answering at once), with its rules not yet written: the realm's only rule is "${there[0]?.id}"`)
  const [x, z] = realms[0].arrive.at, record = await (await fetch(`${world}/realm/${realms[0].id}/world/realm`)).json()
  check(Number.isFinite(x) && Number.isFinite(z) && Math.hypot(x - 700, z - 4070) > 20000 && record.name === 'Regatta', `it arrives at its own ground, ${(Math.hypot(x - 700, z - 4070) / 10000).toFixed(1)} km from the town`)
  await page.keyboard.press('Digit1')
  await page.waitForFunction(() => document.querySelector('#choice').hidden, null, { timeout: 10_000 })
  check(true, 'chosen, the way in is opened while the rules are still being written')
  release()
  await page.waitForFunction(() => [...document.querySelectorAll('#notices p')].some((p) => p.textContent === 'Regatta: its people have arrived'), null, { timeout: 90_000 })
  let after = []
  for (let i = 0; i < 50 && !(after.length === 2 && after.every((r) => r.running)); i++) { after = await (await fetch(`${world}/realm/${realms[0].id}/world/rules`)).json(); await new Promise((r) => setTimeout(r, 100)) }
  check(after.length === 2 && after.every((r) => r.running) && !(await page.evaluate(() => !document.querySelector('#choice').hidden && document.querySelector('#choice p')?.textContent.includes('is ready'))), `when its rules land the asker is told its people have arrived, and is not asked again whether to step in (${after.map((r) => r.id).join(', ')})`)
} catch (e) { failures.push(String(e?.stack ?? e)) }
await browser.close().catch(() => {})
h.close?.()
server.stop()
if (failures.length) { console.error(`FAILED\n  ${failures.join('\n  ')}`); process.exit(1) }
console.log('placed: ok')
process.exit(0)
