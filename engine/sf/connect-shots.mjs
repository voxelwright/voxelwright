// Pictures of every state of connecting a visitor's own AI (#526, page/connect.ts), for the UI Craft loop: on a desk
// and on a phone held upright, by day and by night, and the panel with a phone's keyboard up (a short page: headless
// Chrome has no keyboard). The providers are answered by test/providers.mjs: no provider is asked and no model run.
//
//   node sf/connect-shots.mjs [--dist dist-sf] [--port 6012] [--out ~/.village/engine/sf/connect/shots] [--only desk-day]
import { mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { chromium, devices } from 'playwright'
import { arg, CHROME, here, turn } from '../test/kit.mjs'
import { plain } from '../player/serve.mjs'
import { KEYS, PROVIDERS, providers } from '../test/providers.mjs'

const dist = join(here, arg('dist', 'dist-sf')), out = arg('out', join(homedir(), '.village', 'engine', 'sf', 'connect', 'shots')), only = arg('only', '')
mkdirSync(out, { recursive: true })
const site = await plain(dist, '127.0.0.1', Number(arg('port', '6012')))
const back = await turn()
const NOWHERE = `--host-resolver-rules=${['api.anthropic.com', 'api.openai.com', 'generativelanguage.googleapis.com', 'openrouter.ai'].map((h) => `MAP ${h} 127.0.0.1:9`).join(', ')}`
const browser = await chromium.launch({ ...CHROME, args: [...CHROME.args, NOWHERE] })
const PHONE = { ...devices['iPhone 15 Pro'], viewport: { width: 390, height: 844 } }
const SETS = [
  ['desk-day', { viewport: { width: 1280, height: 720 } }, 12],
  ['desk-night', { viewport: { width: 1280, height: 720 } }, 21],
  ['phone-day', PHONE, 12],
  ['phone-night', PHONE, 21],
].filter(([name]) => !only || only.split(',').includes(name))

for (const [name, device, hour] of SETS) {
  const { state, answer } = providers()
  const context = await browser.newContext({ ...device, userAgent: undefined })
  await context.route(PROVIDERS, answer)
  const page = await context.newPage()
  page.on('pageerror', (e) => console.log(`  page error: ${e.message}`))
  await page.goto(`${site.url}/sf/index.html?making=1`)
  await page.waitForFunction(() => globalThis.engine?.explore && globalThis.engine.seen?.whole > 0, null, { timeout: 300_000 })
  await page.evaluate(() => globalThis.engine.explore.go())
  await page.waitForFunction(() => globalThis.engine.first.engaged && globalThis.engine.explore.state === 'in', null, { timeout: 60_000 })
  const stand = () => page.evaluate((hour) => {
    const e = globalThis.engine, k = e.local.kept[0].at, x = k[0] + 80, z = k[2] + 2
    let y = 1500
    for (; y > 0 && !e.kind(x, y, z); y--);
    e.me.walk(false)
    e.hour = hour
    Object.assign(e.pose, { x: x / 10, y: (y + 18) / 10, z: z / 10, yaw: -Math.PI / 2, pitch: -0.3 })
  }, hour)
  await stand(); await page.waitForTimeout(3000); await stand()
  await page.waitForFunction(() => { const e = globalThis.engine; return e.world.stats.wanted === 0 && e.world.stats.stale === 0 }, null, { timeout: 120_000 }).catch(() => {})
  await page.waitForTimeout(2500)
  const shot = async (state) => { await page.waitForTimeout(700); await page.screenshot({ path: join(out, `${name}-${state}.png`) }); console.log(`  ${name}-${state}.png`) }
  const wish = async (words) => {
    await page.evaluate(() => { globalThis.__done = new Promise((done) => { const off = globalThis.engine.wish.on((s) => { if (s.stage === 'done') { off(); done(s) } }) }) })
    await page.evaluate(() => globalThis.engine.hud.line.show())
    await page.fill('#line', '')
    await page.type('#line', words, { delay: 10 })
    await page.evaluate(() => document.querySelector('#ask-send').click())
  }
  const ended = () => page.evaluate(() => globalThis.__done)
  const panel = () => page.waitForFunction(() => document.querySelector('#connect')?.open, null, { timeout: 15_000 })

  await wish('a purple submarine')
  await page.waitForFunction(() => !document.querySelector('#choice')?.hidden, null, { timeout: 60_000 })
  await shot('1-offered')
  await page.click('#choice button >> nth=0')
  await panel()
  await shot('2-choosing')
  state.mode = 'slowlist'; state.slow = 4000
  await page.fill('#connect-key', KEYS.anthropic); await page.press('#connect-key', 'Enter')
  await page.click('#connect .reveal')
  await shot('3-key')
  await page.waitForFunction(() => document.querySelector('#connect select')?.options.length, null, { timeout: 15_000 })
  await page.click('#connect .reveal')
  await shot('4-models')
  state.mode = 'slow'; state.slow = 9000
  await page.click('#connect .go')
  await page.waitForFunction(() => /Stop/.test(document.querySelector('#ai-line')?.textContent ?? ''), null, { timeout: 30_000 })
  await page.waitForTimeout(2500)
  await shot('5-making')
  const done = await ended()
  await page.waitForFunction(() => /tokens/.test(document.querySelector('#ai-line')?.textContent ?? ''), null, { timeout: 10_000 }).catch(() => {})
  await page.waitForTimeout(1200)
  await shot(`6-made-${done.state}`)
  await page.evaluate(() => globalThis.engine.unmake())
  // The panel as it is with something connected: from the realm's settings.
  await page.evaluate(() => globalThis.engine.realmControls.fold(false))
  await page.waitForTimeout(500)
  await shot('7-settings')
  await page.click('#realm button.ai')
  await panel()
  await shot('8-connected')
  await page.keyboard.press('Escape')
  // What goes wrong, each with what to do next.
  state.mode = 'cut'
  await wish('a stone birdbath'); await ended()
  await shot('9-cut')
  state.mode = 'slow'; state.slow = 20_000
  await wish('a stone birdbath')
  await page.waitForFunction(() => /Stop/.test(document.querySelector('#ai-line')?.textContent ?? ''), null, { timeout: 30_000 })
  await page.click('#ai-line button'); await ended()
  await shot('10-stopped')
  state.mode = 'echo'
  await wish('a stone birdbath'); await ended()
  await shot('11-limit')
  state.mode = 'refuse'
  await wish('a stone birdbath')
  await panel()
  await shot('12-refused')
  await page.keyboard.press('Escape'); await ended()
  await shot('13-refused-let-go')
  state.mode = 'ok'
  await context.close()
}

// The panel over a phone's keyboard: what is seen above it is a page 390 x 460 (an iPhone 15 Pro's, its keyboard up).
if (!only || only.split(',').includes('phone-keyboard')) {
  const { answer } = providers()
  const context = await browser.newContext({ ...PHONE, viewport: { width: 390, height: 460 }, userAgent: undefined })
  await context.route(PROVIDERS, answer)
  const page = await context.newPage()
  await page.goto(`${site.url}/sf/index.html?making=1`)
  await page.waitForFunction(() => globalThis.engine?.explore && globalThis.engine.seen?.whole > 0, null, { timeout: 300_000 })
  await page.evaluate(() => globalThis.engine.explore.go())
  await page.waitForFunction(() => globalThis.engine.first.engaged && globalThis.engine.explore.state === 'in', null, { timeout: 60_000 })
  await page.waitForTimeout(2000)
  // (The settings are taller than this page: their key is pressed where it is.)
  await page.evaluate(() => { globalThis.engine.realmControls.fold(false); document.querySelector('#realm button.ai').click() })
  await page.waitForFunction(() => document.querySelector('#connect')?.open)
  await page.fill('#connect-key', KEYS.anthropic); await page.press('#connect-key', 'Enter')
  await page.waitForFunction(() => document.querySelector('#connect select')?.options.length, null, { timeout: 15_000 })
  await page.focus('#connect-key')
  await page.waitForTimeout(900)
  const seen = await page.evaluate(() => { const r = (s) => document.querySelector(s).getBoundingClientRect(); return { field: r('#connect-key').bottom, go: r('#connect .go').bottom, height: innerHeight } })
  console.log(`  phone-keyboard: the field ends at ${seen.field.toFixed(0)} px and the main key at ${seen.go.toFixed(0)} px of ${seen.height}`)
  await page.screenshot({ path: join(out, 'phone-keyboard.png') })
  await context.close()
}
await browser.close()
back()
site.stop()
