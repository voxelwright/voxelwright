// Engine plugins picked up while the game runs (#264, plugins.mjs). The real server, a world, a rule running and a
// page open; then a plugin's folder lands, the server is told to look, and within the second the rule uses what it
// could not, in the same world process, on the same page (nothing started again, nothing loaded again). Then the
// plugin is changed, broken, mended and taken away, a page joins late, and the world is started again.
//
//   node test/plugins.mjs [--out picture.png]
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { guideFor } from '../make/rules.mjs'
import { arg, chrome, here } from './kit.mjs'
import { until, wait, world } from './plugkit.mjs'

const dir = mkdtempSync(join(tmpdir(), 'engine-plugins-'))
// Acquire the browser before opening the stream used to observe plugin state.
const browser = await chrome()
const w = await world(['--plugins', dir]), { check } = w
// A plugin made for this check: something a rule can count with, shown on the page. `by` is how much a count adds.
const WORLD = (by) => `export default ({ pages, was }) => {
  let n = was?.n ?? 0
  pages.state({ n, by: ${by} })
  return { does: { count(rule, w, now, wrong) { if (w.wrong) return wrong('counted wrong'); n += ${by}; pages.state({ n, by: ${by} }) } }, state: () => ({ n }) }
}
`
const PAGE = (tag) => `export default () => {
  const el = document.createElement('div')
  el.id = 'plugin-count'
  el.style.cssText = 'position:fixed;left:16px;top:16px;z-index:9;padding:8px 12px;border-radius:8px;background:#102a1ccc;color:#d8ffe6;font:600 15px system-ui'
  document.body.append(el)
  return { state(s) { el.textContent = 'plugged in while the game ran: count ' + s.n + ' (page ${tag})' }, close() { el.remove() } }
}
`
const put = (world, page, guide = 'world.count({})   adds to a count that every page shows') => { mkdirSync(join(dir, 'count'), { recursive: true }); if (world) writeFileSync(join(dir, 'count', 'world.mjs'), world); if (page) writeFileSync(join(dir, 'count', 'page.ts'), page); writeFileSync(join(dir, 'count', 'guide.txt'), guide) }
const RULE = `
on('start', (world, e) => { world.keep.starts = (world.keep.starts || 0) + 1; if (!world.people.some((p) => p.mine)) world.actor('teller', { name: 'Odile', at: [700, 4009] }); if (e.why === 'restart') world.count({}) })
on('said', (world, e) => {
  if (/count/.test(e.text)) world.count ? world.count({}) : world.actor('teller', { say: 'I cannot count.' })
  if (/wall/.test(e.text)) world.look ? world.look('north', { from: 'teller', to: [700, 175, 3900] }) : world.actor('teller', { say: 'I cannot look.' })
})
on('seen', (world, e) => { world.actor('teller', { say: 'I see ' + e.material + '.' })
})`
const open = async () => { const p = await (await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 })).newPage(); p.on('pageerror', (e) => w.failures.push(`page error: ${e.message}`)); p.on('console', (m) => { if (m.type() === 'warning' || m.type() === 'error') console.log(`  page ${m.type()}: ${m.text().slice(0, 300)}`) }); await p.goto(`${w.url}/city?shared=1&fly=0&x=70&z=406`); await p.waitForFunction(() => globalThis.engine?.plugins, null, { timeout: 90_000 }); return p }
const times = {}
try {
  // A world with a rule in it and a page open, and no plugins at all.
  await w.post('join', { by: 'wren', at: [700, 4060] })
  await w.rule('teller', RULE)
  await until('the rule runs', async () => (await w.how('teller'))?.actors === 1)
  const page = await open()
  await page.evaluate(() => { globalThis.sameLoad = performance.timeOrigin })
  const loaded = await page.evaluate(() => globalThis.sameLoad)
  await w.post('say', { by: 'wren', text: 'count' })
  await until('it says it cannot', async () => (await w.get('around?by=wren')).heard.some((h) => h.text === 'I cannot count.'))
  check(!guideFor(await (await fetch(`${w.url}/world/`)).text()).includes('world.count'), 'before: the rule cannot count, and the guide does not say it can')
  const before = await w.how('teller')

  // The plugin lands (a folder), and the server is told to look.
  const t0 = performance.now()
  put(WORLD(1), PAGE('v1'))
  cpSync(join(here, 'plugins', 'look'), join(dir, 'look'), { recursive: true })
  const looked = await w.look()
  times.look = performance.now() - t0
  check(looked.plugins.length === 2 && looked.plugins.every((p) => !p.error) && looked.worlds[0].loads.length === 2, `told to look, the running world took both in ${looked.worlds[0].ms} ms (${looked.worlds[0].loads.map((l) => `${l.name} ${l.ms} ms`).join(', ')})`)
  await w.post('say', { by: 'wren', text: 'count' })
  await until('a page is told the count', () => w.said.some((m) => m.plugin === 'count' && m.state?.n === 1))
  times.used = performance.now() - t0
  await page.waitForFunction(() => document.querySelector('#plugin-count')?.textContent?.includes('count 1 (page v1)'), null, { timeout: 10_000 }).catch(async (e) => { console.log(await page.evaluate(() => JSON.stringify({ e: globalThis.engine.plugins.errors, l: globalThis.engine.plugins.loaded, t: document.querySelector('#plugin-count')?.textContent }))); throw e })
  times.seen = performance.now() - t0
  const after = await w.how('teller'), took = await page.evaluate(() => globalThis.engine.plugins.took)
  check(after.calls > before.calls && after.error === '' && (await page.evaluate(() => globalThis.sameLoad)) === loaded, `the same rule in the same world process (its calls went ${before.calls} to ${after.calls}) uses it ${times.used.toFixed(0)} ms after the folder landed; the same page shows it at ${times.seen.toFixed(0)} ms (its import took ${took.count.toFixed(0)} ms)`)
  check(guideFor(await (await fetch(`${w.url}/world/`)).text()).includes('world.count({})   adds to a count'), 'and the guide a model writes rules from now says so')
  await w.post('say', { by: 'wren', text: 'what is that wall' })
  const saw = await until('it says what it sees', async () => (await w.get('around?by=wren')).heard.find((h) => /^I see /.test(h.text)))
  check(saw.text !== 'I see undefined.', `a real one too (plugins/look): asked what the wall behind it is, the rule looks and says "${saw.text}"`)
  if (arg('out', '')) await page.screenshot({ path: arg('out', '') })

  // What a page plugin draws with: a pass of its own in every frame; one that throws is taken out and the page goes on.
  await page.evaluate(() => { globalThis.passed = 0; globalThis.engine.draws.add('counts', () => { globalThis.passed++ }); globalThis.engine.draws.add('breaks', () => { throw new Error('a pass that breaks') }) })
  await page.waitForFunction(() => globalThis.passed > 5, null, { timeout: 10_000 })
  check((await page.evaluate(() => globalThis.engine.draws.names.join())) === 'counts', 'a page plugin is given a pass in every frame to draw with; one that throws is taken out, and the frames go on')
  await page.evaluate(() => globalThis.engine.draws.remove('counts'))

  // Changed while it runs: both sides are new, and what it had is handed on.
  put(WORLD(10), PAGE('v2'))
  const t1 = performance.now(), again = await w.look()
  await w.post('say', { by: 'wren', text: 'count' })
  await page.waitForFunction(() => document.querySelector('#plugin-count')?.textContent?.includes('count 11 (page v2)'), null, { timeout: 10_000 })
  times.changed = performance.now() - t1
  check(again.worlds[0].loads.length === 1 && (await page.evaluate(() => document.querySelectorAll('#plugin-count').length)) === 1, `changed, only it is loaded again (${again.worlds[0].loads[0].ms} ms); it kept its count (1, then 11), and the page's old module took its own things away: ${times.changed.toFixed(0)} ms in all`)

  // One that does not load leaves what was there, and says why.
  for (const [what, text, why] of [['does not parse', 'export default (', /./], ['takes a name that is taken', 'export default () => ({ does: { actor() {} } })', /already something a rule can do/], ['imports a file beside it', `import './more.mjs'\n${WORLD(1)}`, /one file/]]) {
    put(text, null)
    const bad = (await w.look()).plugins.find((p) => p.name === 'count')
    const was = w.said.filter((m) => m.plugin === 'count' && m.state).at(-1).state.n
    await w.post('say', { by: 'wren', text: 'count' })
    const n = await until('it still counts', () => { const now = w.said.filter((m) => m.plugin === 'count' && m.state).at(-1).state.n; return now > was && now })
    check(why.test(bad.error) && bad.error && n === was + 10 && !guideFor(await (await fetch(`${w.url}/world/`)).text()).includes('world.count'), `one that ${what} is not let in (${bad.error.slice(0, 60)}), the version before it goes on, and the guide leaves it out`)
    await wait(150)
  }
  put(WORLD(10), null)
  check((await w.look()).plugins.every((p) => !p.error), 'mended, it is in again')

  // A page that joins later has the module and what is so.
  const late = await open()
  await late.waitForFunction(() => /count \d+ \(page v2\)/.test(document.querySelector('#plugin-count')?.textContent ?? ''), null, { timeout: 10_000 })
  check(true, 'a page that joins later imports the page side and is given what is so')
  await late.context().close()

  // The world started again: a rule that uses a plugin as it starts finds it there.
  const n0 = (w.said.filter((m) => m.plugin === 'count' && m.state).at(-1)).state.n
  await page.context().close()
  await w.again()
  await w.post('join', { by: 'wren', at: [700, 4060] })
  await until('the rule starts again', async () => { const r = await w.how('teller').catch(() => null); return r?.running && r.calls >= 1 })
  await until('it counted as it started', () => w.said.some((m) => m.plugin === 'count' && m.state?.n === 10))
  check((await w.how('teller')).error === '', `after a restart the rule's start used the plugin with nothing wrong (the plugin's own count began again: ${n0} was not kept)`)

  // Taken away: the rule is told plainly, the page's part goes, the guide forgets it.
  rmSync(join(dir, 'count'), { recursive: true })
  await w.look()
  await w.post('say', { by: 'wren', text: 'count' })
  await until('it says it cannot', async () => (await w.get('around?by=wren')).heard.filter((h) => h.text === 'I cannot count.').length >= 1)
  check(!(await (await fetch(`${w.url}/world/`)).text()).includes('world.count'), 'taken away, a rule cannot do it and the guide does not say it can')
  console.log(`  measured: folder landed to look answered ${times.look.toFixed(0)} ms, to the rule's first use ${times.used.toFixed(0)} ms, to the page showing it ${times.seen.toFixed(0)} ms`)
} catch (e) { w.failures.push(String(e?.stack ?? e)) }
await browser.close().catch(() => {})
w.finish('plugins')
