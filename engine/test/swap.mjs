// The core swapped while the game runs (#264, the workshop): a world with a rule, an actor, edits and a page open;
// the core's file changes (a build); the server is told to look; the world's process and the page each take the
// new module and go on. Nothing is started again and the page is not loaded again. Says what is kept and what is lost.
//
//   node test/swap.mjs [--edits 400]
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { arg, chrome, here, still } from './kit.mjs'
import { until, wait, world } from './plugkit.mjs'

const w = await world(), { check } = w
const wasm = join(here, 'page', 'core.wasm'), bytes = readFileSync(wasm), edits = Number(arg('edits', '400'))
const browser = await chrome()
try {
  await w.post('join', { by: 'wren', at: [700, 4060] })
  await w.rule('teller', `on('start', (world) => world.actor('teller', { name: 'Odile', at: [700, 4009] }))\non('tick', (world) => { world.keep.n = (world.keep.n || 0) + 1 })`)
  await until('the rule runs', async () => (await w.how('teller'))?.actors === 1)
  // Things done to the world: holes in the road (kept), and many small edits to have something to send again.
  await w.post('ask', { by: 'wren', blast: [720, 154, 4070], radius: 4, spark: false })
  for (let i = 0; i < edits; i++) { await w.post('ask', { by: 'wren', edit: [0, 760 + (i % 100) * 3, 156 + Math.floor(i / 100) * 3, 4070, 1, 8], release: [760, 156, 4070] }); if (i % 50 === 49) await wait(900) }
  await wait(2500)
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 })).newPage()
  page.on('pageerror', (e) => w.failures.push(`page error: ${e.message}`))
  await page.goto(`${w.url}/city?shared=1&fly=0&x=72&z=409`)
  await page.waitForFunction(() => globalThis.engine?.plugins, null, { timeout: 90_000 })
  await still(page)
  /** A row of cells through the hole and the heap, as the world's process has them. */
  const cells = async () => { const out = []; for (let x = 712; x <= 728; x += 2) for (const y of [152, 154, 156]) out.push((await w.send(`/world/at?x=${x}&y=${y}&z=4070`)).kind); return out.join(' ') }
  const loaded = await page.evaluate(() => performance.timeOrigin), before = await cells(), hole = await w.send('/world/at?x=720&y=154&z=4070'), calls = (await w.how('teller')).calls
  // Something in the air as the swap happens: a ball thrown high.
  await w.post('ask', { by: 'wren', ball: { from: [700, 400, 4070], speed: [0, 300, 0], radius: 3, kind: 12 } })
  await until('the ball is in the air', async () => (await page.evaluate(() => globalThis.engine.bodies)) > 0)
  await page.evaluate(() => { globalThis.gaps = []; let last = performance.now(); const tick = (now) => { globalThis.gaps.push(now - last); last = now; requestAnimationFrame(tick) }; requestAnimationFrame(tick) })
  await wait(500)

  // A build: the same module with a custom section added, so it is another file to everyone who reads it.
  writeFileSync(wasm, Buffer.concat([bytes, Buffer.from([0, 2, 1, 120])]))
  const t0 = performance.now(), r = await w.send('/core/look', { method: 'POST' }), took = performance.now() - t0, home = r.worlds[0]
  check(r.changed && !home.error, `the world's process took the new core while it ran: ${home.instantiate} ms to start the module, ${home.ms} ms with ${home.edits} edits sent again (${took.toFixed(0)} ms for the request)`)
  const after = await cells()
  check(hole.kind !== hole.ground && before === after && new Set(before.split(' ')).size > 1, `what was done to the world is in the new core: a row of cells through the blast reads the same before and after (${after})`)
  await until('the rule goes on', async () => (await w.how('teller')).calls > calls + 1)
  const how = await w.how('teller')
  check(how.actors === 1 && how.error === '' && (await w.get('around?by=wren')).you, 'the rule, its actor and someone in a seat went on as they were: they are the process\'s, not the core\'s')
  const pageMs = await page.waitForFunction(() => globalThis.engine.plugins.took['the core'], null, { timeout: 20_000 }).then((h) => h.jsonValue())
  const remade0 = performance.now()
  await page.waitForFunction(() => globalThis.engine.world.stats.stale > 0, null, { timeout: 20_000 }).catch(() => {})
  await page.waitForFunction(() => globalThis.engine.world.stats.stale === 0 && globalThis.engine.world.stats.wanted === 0, null, { timeout: 120_000 })
  const remade = performance.now() - remade0, made = await page.evaluate(() => globalThis.engine.world.stats.ready)
  const gaps = (await page.evaluate(() => globalThis.gaps)).slice(2).sort((a, b) => a - b)
  check((await page.evaluate(() => performance.timeOrigin)) === loaded, `the page, not loaded again, took it too: ${pageMs.toFixed(0)} ms on its own thread, every sector (${made}) made again by the new core behind the picture in ${(remade / 1000).toFixed(1)} s; frames meanwhile ${gaps[gaps.length >> 1].toFixed(1)} ms at the middle, ${gaps[Math.floor(gaps.length * 0.99)].toFixed(0)} ms at the 99th in a hundred, ${gaps.at(-1).toFixed(0)} ms the worst`)
  const air = await page.evaluate(() => globalThis.engine.bodies)
  check(air === 0, `what was lost: the ball that was in the air is gone from the world and from the page (the page now counts ${air} bodies)`)
  const again = await w.send('/core/look', { method: 'POST' })
  check(!again.changed, 'told to look again with nothing built, nothing is swapped')
} catch (e) { w.failures.push(String(e?.stack ?? e)) } finally { writeFileSync(wasm, bytes) }
await browser.close().catch(() => {})
w.finish('swap')
