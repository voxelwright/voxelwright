// The page's guards against what a link, a host page or another's server can send it (#81), each a pure function
// the page uses, run here in Node: the solver's words read within their bounds (told.ts, against the real core's
// output too), the host origins heard (host.ts), the pictures a sign may show (screens.ts), the far model's paths
// (far.ts), the numbers an address may ask for (march.ts), where a visitor's key is kept (models.ts), what reaches a
// worker's address (bay.ts) and what each class of device may hold (bay.ts).
//
//   node test/client-security.mjs
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { fits, read } from '../page/told.ts'
import { allowed } from '../page/host.ts'
import { picture } from '../page/screens.ts'
import { samePath } from '../page/far.ts'
import { bounded } from '../page/march.ts'
import { keep, kept, remembered } from '../page/models.ts'
import { BUDGETS, forgetFar, llAsked, tierOf } from '../page/bay.ts'

let steps = 0
const step = async (name, run) => { await run(); steps++; console.log(`ok  ${name}`) }
const f32 = (v) => new Uint32Array(new Float32Array([v]).buffer)[0]

await step('told: records read as the core writes them, an unknown kind skipped', () => {
  const words = new Uint32Array([
    5, 16, 7, f32(1), f32(2), f32(3), 0, 0, 0, f32(1), 8, f32(4), f32(5), f32(6), 0, 0, 0, f32(1),
    99, 2, 1, 2,
    11, 12, 7, f32(3), 4, 3, 0, 0, 0, 1, 0, 0, 0, f32(1),
    6, 1, 42,
  ])
  const t = read(words)
  assert.deepEqual(t.moves.map((m) => m.id), [7, 8])
  assert.deepEqual(t.live.map((l) => [l.id, l.speed, l.feet, l.touches, l.aloft]), [[7, 3, 4, 3, true]])
  assert.deepEqual(t.broke, [42])
})

await step('told: a record that claims more words than came stops the reading, quickly, with what was read', () => {
  // A server that says a list of moves is four thousand million words long: before, the page walked that far.
  const words = new Uint32Array([6, 1, 9, 5, 0xffff_fff0, 7, f32(1), f32(2), f32(3)])
  const t0 = performance.now(), t = read(words)
  assert.ok(performance.now() - t0 < 50)
  assert.deepEqual(t.broke, [9])
  assert.equal(t.moves.length, 0)
  // Past the end by one word; a length that wraps the sum; a length at the end exactly.
  assert.equal(read(new Uint32Array([5, 9, 1, 0, 0, 0, 0, 0, 0, 0])).moves.length, 0)
  assert.equal(fits(5, 0xffff_ffff, 2, 10), false)
  assert.equal(fits(5, 8, 2, 10), true)
  // A lone tag with no length.
  assert.equal(read(new Uint32Array([5])).moves.length, 0)
})

await step('told: a record not the shape of its kind stops the reading', () => {
  // Rows of moves are 8 words, of living things 12: 13 is neither.
  assert.equal(read(new Uint32Array([11, 13, ...new Array(13).fill(0)])).live.length, 0)
  assert.equal(read(new Uint32Array([5, 9, ...new Array(9).fill(0)])).moves.length, 0)
  // Fixed parts too short: a struck of 3 words, a born of 2.
  assert.equal(read(new Uint32Array([10, 3, 0, 0, 0])).struck.length, 0)
  assert.equal(read(new Uint32Array([2, 2, 0, 0])).born.length, 0)
  assert.equal(fits(11, 0, 2, 2), true, 'an empty list is a list')
})

await step('told: every record the real core writes over a crash is read to its end', async () => {
  const bytes = await readFile(new URL('../page/core.wasm', import.meta.url)).catch(() => null)
  assert.ok(bytes, 'page/core.wasm is not built: npm --prefix engine run core')
  const { instance: { exports: core } } = await WebAssembly.instantiate(bytes, {})
  const write = (values, floats = false) => { const at = core.edits_room(values.length); new (floats ? Float32Array : Int32Array)(core.memory.buffer, at, values.length).set(values) }
  const rows = []
  for (let y = 2398; y < 2400; y++) for (let z = 3900; z < 4250; z++) rows.push(0, 30000, y, z, 6)
  for (let y = 2399; y < 2432; y++) for (let z = 4047; z < 4085; z++) rows.push(870, 872, y, z, 8)
  write([1, rows.length / 5, ...rows]); core.world_edit(-1)
  const cells = new Int32Array(42 * 10 * 18)
  for (let y = 2; y < 6; y++) for (let z = 1; z < 17; z++) for (let x = 0; x < 42; x++) if (x === 0 || x === 41 || z === 1 || z === 16 || y === 2 || y === 5) cells[x + 42 * (z + 18 * y)] = 12
  let records = 0, kinds = new Set()
  const check = (n) => {
    const words = new Uint32Array(core.memory.buffer, core.bodies_words(), n).slice()
    let i = 0
    while (i + 2 <= words.length) { assert.ok(fits(words[i], words[i + 1], i + 2, words.length), `record ${words[i]} of ${words[i + 1]} words at ${i} is refused`); kinds.add(words[i]); records++; i += 2 + words[i + 1] }
    assert.equal(i, words.length)
    read(words)
  }
  write(cells); check(core.living_spawn(42, 10, 18, 760, 2403, 4055, 0))
  const id = core.living_last()
  core.living_kick(id, 220, 0, 0)
  for (let s = 0; s < 90; s++) { core.living_drive(id, 1, 0, 0, 0, 0); check(core.bodies_advance(1 / 60)) }
  assert.ok(records > 90 && kinds.has(5) && kinds.has(11), `${records} records of kinds ${[...kinds]}`)
})

await step('host: heard and told only on this site, zahynailo.dev, and this machine when served from it', () => {
  const site = { origin: 'https://zahynailo.dev', hostname: 'zahynailo.dev' }
  assert.equal(allowed('https://zahynailo.dev', site), true)
  for (const o of ['https://evil.example', 'http://zahynailo.dev', 'https://zahynailo.dev.evil.example', 'http://127.0.0.1:6010', 'null', '']) assert.equal(allowed(o, site), false, o)
  const preview = { origin: 'https://preview.example', hostname: 'preview.example' }
  assert.equal(allowed('https://preview.example', preview), true)
  assert.equal(allowed('https://zahynailo.dev', preview), true)
  const local = { origin: 'http://127.0.0.1:6010', hostname: '127.0.0.1' }
  for (const o of ['http://127.0.0.1:6010', 'http://127.0.0.1:5950', 'http://localhost:3000']) assert.equal(allowed(o, local), true, o)
  for (const o of ['https://evil.example', 'http://127.0.0.2:80', 'http://localhost.evil.example']) assert.equal(allowed(o, local), false, o)
})

await step('screens: a sign shows this site\'s pictures, https: ones and raster ones drawn in the page, nothing else', () => {
  const here = 'https://zahynailo.dev/sf/index.html'
  assert.equal(picture('x.png', here), 'https://zahynailo.dev/sf/x.png')
  assert.equal(picture('/sf/a.webp', here), 'https://zahynailo.dev/sf/a.webp')
  assert.equal(picture('https://cdn.example/a.png', here), 'https://cdn.example/a.png')
  assert.equal(picture('data:image/png;base64,iVBORw0KGgo=', here), 'data:image/png;base64,iVBORw0KGgo=')
  for (const bad of ['javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'blob:https://zahynailo.dev/1234', 'http://tracker.example/p.png', 'data:image/svg+xml;base64,PHN2Zz4=', 'data:text/html,<script>1</script>', '', null, 42, { href: 'x' }]) assert.equal(picture(bad, here), null, String(bad))
  // On this machine the page is http: its own pictures still show.
  assert.equal(picture('x.png', 'http://127.0.0.1:6010/sf/index.html'), 'http://127.0.0.1:6010/sf/x.png')
})

await step('far: ?far= and ?farlanding= name only paths of this site', () => {
  const here = 'https://zahynailo.dev/'
  assert.equal(samePath('/sf/far/', here), 'https://zahynailo.dev/sf/far/')
  assert.equal(samePath('/sf/landing/landing.json', here), 'https://zahynailo.dev/sf/landing/landing.json')
  assert.equal(samePath('sf/far/far.json', here), 'https://zahynailo.dev/sf/far/far.json')
  for (const bad of ['https://evil.example/far/', '//evil.example/far/', '/\\evil.example', '\\\\evil.example', 'http:evil.example', '/sf/../../x', '/sf/%2e%2e/x', '%2F%2Fevil.example/', 'javascript:1', 'data:application/json,{}', '/sf\n/far', '', null]) assert.equal(samePath(bad, here), null, String(bad))
})

await step('query: numbers an address asks for are kept within bounds, and nonsense is the default', () => {
  assert.equal(bounded(null, 6, 1, 8, true), 6)
  assert.equal(bounded('', 6, 1, 8, true), 6)
  assert.equal(bounded('NaN', 6, 1, 8, true), 6)
  assert.equal(bounded('Infinity', 6, 1, 8, true), 6)
  assert.equal(bounded('1e9', 6, 1, 8, true), 8)
  assert.equal(bounded('-4', 6, 1, 8, true), 1)
  assert.equal(bounded('3.6', 6, 1, 8, true), 4)
  assert.equal(bounded('0.5', 0.75, 0.25, 1.5), 0.5)
  assert.equal(bounded('999999999999', 12_000_000, 100_000, 20_000_000, true), 20_000_000)
  assert.equal(bounded('5', 12_000_000, 100_000, 20_000_000, true), 100_000)
})

await step('models: a key is kept for the tab by default, in the browser only when asked, and forgetting clears both', () => {
  const stand = () => { const held = new Map(); return { held, getItem: (k) => held.get(k) ?? null, setItem: (k, v) => held.set(k, v), removeItem: (k) => held.delete(k) } }
  const tab = stand(), browser = stand()
  globalThis.sessionStorage = tab; globalThis.localStorage = browser
  const c = { route: 'anthropic', key: 'sk-ant-made-up-000000', model: 'claude-opus-5-5' }
  keep(c)
  assert.equal(browser.held.size, 0)
  assert.ok(tab.held.has('village.ai'))
  assert.equal(remembered(), false)
  keep(c, true)
  assert.equal(tab.held.size, 0)
  assert.equal(remembered(), true)
  keep(null)
  assert.equal(kept(), null)
  assert.equal(tab.held.size + browser.held.size, 0)
})

await step('bay: only two finite coordinates on Earth reach a worker\'s address', () => {
  assert.deepEqual(llAsked('37.8,-122.4'), [37.8, -122.4])
  for (const bad of ['37.8,-122.4&bay=0', '37.8,-122.4,1', 'x,y', ',', '91,0', '0,181', 'Infinity,0', '', null]) assert.equal(llAsked(bad), null, String(bad))
  assert.equal(encodeURIComponent([37.8, -122.4].join(',')), '37.8%2C-122.4')
})

await step('bay: a tablet holds less than a laptop, a phone least, and the far model\'s faces follow', () => {
  assert.equal(tierOf({ touch: 0, short: 2000 }), 'desktop')
  assert.equal(tierOf({ touch: 5, short: 390 }), 'phone')
  assert.equal(tierOf({ touch: 5, short: 820 }), 'tablet')
  assert.equal(tierOf({ touch: 5, short: 1024, memory: 4 }), 'tablet')
  assert.equal(tierOf({ touch: 5, short: 1024, memory: 8 }), 'desktop')
  assert.equal(tierOf({ touch: 5, short: 1024 }), 'desktop')
  assert.deepEqual([BUDGETS.phone.faces, BUDGETS.tablet.faces, BUDGETS.desktop.faces], [3_000_000, 6_000_000, 12_000_000])
  assert.ok(BUDGETS.phone.faces * 20 <= 60 * 2 ** 20, 'a phone holds at most about 60 MiB of far faces')
  for (const k of ['pool', 'workers', 'bytes']) assert.ok(BUDGETS.phone[k] <= BUDGETS.tablet[k] && BUDGETS.tablet[k] < BUDGETS.desktop[k], k)
})

await step('bay: street names keep the nearest squares, never one the eye is near', () => {
  const box = (i) => [i * 10_000, 0, i * 10_000 + 10_000, 10_000]
  const held = new Map(), entries = []
  for (let i = 0; i < 40; i++) { held.set(`s${i}`, { box: box(i) }); entries.push({ square: `s${i}`, url: `/n/s${i}.json` }) }
  const gone = []
  forgetFar(held, 5_000, 5_000, (square, url) => gone.push([square, url]), entries, 32)
  assert.equal(held.size, 32)
  assert.ok(held.has('s0') && held.has('s31') && !held.has('s39'))
  assert.deepEqual(gone[0], ['s39', '/n/s39.json'])
  // All near the eye: none goes, however many.
  const near = new Map([['a', { box: [0, 0, 10, 10] }], ['b', { box: [0, 0, 10, 10] }]])
  forgetFar(near, 5, 5, () => assert.fail('a near square went'), [], 1)
  assert.equal(near.size, 2)
})

console.log(`\n${steps} steps passed.`)
