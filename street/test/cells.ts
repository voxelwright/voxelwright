// A street made of cells, end to end (#138), with a stand-in for the model: two pages and the
// world hold the same cells; a thing made by a sentence is made of cells; a blow from one page
// takes the same cells out for everyone; a lamp cut at its foot falls as a thing of its own; a
// page that comes later is given the street as it now stands; and a walker goes down into a
// hole blown in the road. With an out-dir it also records the first page. No model is called.
// Usage: node test/cells.ts [out-dir]
import { mkdirSync, readdirSync, renameSync } from 'node:fs'
import { join } from 'node:path'
import type { Page } from 'playwright'
import { planeAt } from '../src/ground.ts'
import { browser, sleep, startPage, startWorld, stop } from './lib.ts'

const out = process.argv[2]
if (out) mkdirSync(out, { recursive: true })
const WT = Number(process.env.STREET_WT ?? 5063), PAGE = Number(process.env.STREET_PAGE ?? 5388)
type Sums = Record<string, [number, number]>
const checks: boolean[] = []
const check = (name: string, pass: unknown, detail?: unknown) => { checks.push(Boolean(pass)); console.log(`${pass ? 'ok  ' : 'FAIL'} ${name}${pass || detail === undefined ? '' : ` ${JSON.stringify(detail)}`}`) }
const call = <T>(page: Page, body: string) => page.evaluate(`(async () => { const s = window.__street; return ${body} })()`) as Promise<T>
const until = async <T>(read: () => Promise<T>, good: (v: T) => boolean, ms = 8000) => { for (const t0 = Date.now(); ;) { const v = await read(); if (good(v) || Date.now() - t0 > ms) return v; await sleep(100) } }
const world = () => fetch(`http://127.0.0.1:${WT + 1}/cells`).then((r) => r.json()) as Promise<Sums>
const differ = (a: Sums, b: Sums) => [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((k) => a[k]?.[0] !== b[k]?.[0] || a[k]?.[1] !== b[k]?.[1])
/** Whether a page holds the cells the world holds, given a moment to hear of them. */
const same = async (page: Page) => { let off: string[] = []; for (const t0 = Date.now(); Date.now() - t0 < 5000; await sleep(150)) { off = differ(await world(), await call<Sums>(page, 's.cellSums()')); if (!off.length) break } return off }

const vite = await startPage(PAGE, WT)
const chrome = await browser()
const sim = await startWorld(WT, '--maker', 'stub', '--world', 'none', '--crates', '6', '--balls', '0', '--cells')
const errors: string[] = []
try {
  const open = async (record = false) => {
    const context = await chrome.newContext({ viewport: { width: 1280, height: 720 }, ...(record && out ? { recordVideo: { dir: out, size: { width: 1280, height: 720 } } } : {}) })
    const page = await context.newPage()
    page.on('pageerror', (e) => errors.push(String(e).slice(0, 300)))
    page.on('console', (m) => { if (m.type() === 'error' && !/favicon|404/.test(m.text())) errors.push(m.text().slice(0, 300)) })
    await page.goto(`http://localhost:${PAGE}/?name=Pavlo`)
    await page.waitForFunction('window.__street?.ready', undefined, { timeout: 40_000 })
    return page
  }
  const a = await open(true), b = await open()
  const drawn = await call<{ cell: number; things: number; quads: number }>(a, 's.cells()')
  check('the page draws a street made of cells', drawn.cell === 0.1 && drawn.things > 40 && drawn.quads > 20_000, drawn)
  check('nothing of the page\'s own is laid over it', (await call<{ groups: string[] }>(a, 's.drawn()')).groups.every((g) => !/^(street|houses|cars|dressing)$/.test(g)), await call(a, 's.drawn().groups'))
  check('both pages hold the cells the world holds', !(await same(a)).length && !(await same(b)).length, [await same(a), await same(b)])

  // A thing made by a sentence is made of cells, for everyone.
  await sleep(1200)
  await call(a, `s.make('a bridge')`)
  const made = await until(() => call<Sums>(b, 's.cellSums()'), (s) => Object.keys(s).some((k) => k.startsWith('made-1/')), 12_000)
  const bridge = Object.keys(made).find((k) => k.startsWith('made-1/'))
  check('a sentence on one page is a thing of cells on the other', bridge && made[bridge][0] > 100, Object.keys(made).filter((k) => k.startsWith('made')))
  if (out) await a.screenshot({ path: join(out, '1-made.png') })
  const place = bridge ? await call<{ at: number[]; size: number[] }>(a, `s.cellPlace(${JSON.stringify(bridge)})`) : null
  // One page breaks it: the same cells go for everyone.
  if (place) await call(a, `s.blow(${JSON.stringify(place.at)}, 'boom')`)
  const broken = await until(() => call<Sums>(b, 's.cellSums()'), (s) => !bridge || !s[bridge] || s[bridge][0] < made[bridge][0])
  check('a blow from one page takes cells out of it on the other', bridge && (!broken[bridge] || broken[bridge][0] < made[bridge][0]), bridge && [made[bridge], broken[bridge]])
  check('and both pages still hold what the world holds', !(await same(a)).length && !(await same(b)).length, [await same(a), await same(b)])
  if (out) { await sleep(500); await a.screenshot({ path: join(out, '2-broken.png') }) }

  // A lamp cut at its foot comes down as a thing of its own.
  await sleep(600)
  const lamp = await call<{ at: number[]; size: number[] }>(a, `s.cellPlace('furniture/lamp-1')`)
  const before = await world()
  await call(a, `s.blow(${JSON.stringify([lamp.at[0], lamp.at[1] - lamp.size[1] / 2 + 0.6, lamp.at[2]])}, 'boom')`)
  const after = await until(() => world(), (s) => Object.keys(s).some((k) => k.startsWith('bit-') && !before[k]))
  const bits = Object.keys(after).filter((k) => k.startsWith('bit-') && !before[k])
  check('a lamp cut at its foot comes loose as things of their own', bits.length > 0 && after['furniture/lamp-1'][0] < before['furniture/lamp-1'][0], { bits, lamp: [before['furniture/lamp-1'], after['furniture/lamp-1']] })
  // The other page sees the loose pieces move: where each is when first seen there, and a while after.
  const places = () => call<Record<string, number[]>>(b, `Object.fromEntries(${JSON.stringify(bits)}.map((k) => [k, s.cellPlace(k)?.at]).filter(([, at]) => at))`)
  const seen = await until(places, (p) => Object.keys(p).length > 0)
  await sleep(2200)
  const fell = await places()
  const moved = Object.keys(seen).filter((k) => fell[k] && Math.hypot(fell[k][0] - seen[k][0], fell[k][1] - seen[k][1], fell[k][2] - seen[k][2]) > 0.3)
  check('the other page sees it fall', moved.length > 0, { seen, fell })
  check('and the pages hold what the world holds', !(await same(a)).length && !(await same(b)).length, [await same(a), await same(b)])
  if (out) await a.screenshot({ path: join(out, '3-lamp.png') })

  // A page that comes now is given the street as it stands.
  const c = await open()
  check('a page that comes later holds the street as it now stands', !(await same(c)).length, await same(c))
  await c.close()

  // The boom in hand, a real click strikes the street where it points.
  await sleep(500)
  await a.keyboard.press('Digit5')
  let spot: [number, number] | null = null
  for (const [px, py] of [[900, 300], [380, 300], [1000, 240], [640, 420]] as const) if (await call(a, `s.meets(${px}, ${py})`)) { spot = [px, py]; break }
  const unclicked = await world()
  if (spot) await a.mouse.click(spot[0], spot[1])
  const clicked = await until(() => world(), (s) => differ(s, unclicked).length > 0, 5000)
  check('with the boom in hand, a click strikes the street where it points', spot && differ(clicked, unclicked).length > 0, { spot, mode: await a.textContent('#mode') })
  await a.keyboard.press('Digit1')

  // The road blown away under its feet (and whatever rubble it stood on): the walker goes down into the hole, on its own page and for the other.
  const [x, y, z] = await call<number[]>(a, 's.shownOf(s.you)')
  await sleep(500)
  await call(a, `s.blow(${JSON.stringify([x, y - 1, z])}, 'boom')`)
  await sleep(1500)
  // Once it has come to rest: its own page (which guesses ahead) and the other page (which is told) agree where it is.
  const me = await call<number>(a, 's.you')
  const both = () => Promise.all([call<number[]>(a, 's.shownOf(s.you)'), call<number[]>(b, `s.shownOf(${me})`)])
  const near = ([p, q]: number[][]) => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]) < 0.35
  const [mine, theirs] = await until(both, near, 5000)
  check('a walker goes down into a hole blown under it', mine[1] < planeAt(mine[2]) + 0.95 - 0.4, { y: mine[1], roadThere: planeAt(mine[2]) })
  check('and is drawn where the world has it', Math.hypot(mine[0] - theirs[0], mine[1] - theirs[1], mine[2] - theirs[2]) < 0.35, { mine, theirs })
  if (out) await a.screenshot({ path: join(out, '4-hole.png') })
  // Dug as deep as it goes: the bottom of the world holds, and the walker stands on it.
  for (let i = 0; i < 4; i++) { const at = await call<number[]>(a, 's.shownOf(s.you)'); await call(a, `s.blow(${JSON.stringify([at[0], at[1] - 1, at[2]])}, 'boom')`); await sleep(700) }
  await sleep(2000)
  const [deep, deepThere] = await until(both, near, 5000)
  // Rubble falls in with it, so how deep it ends is not one number: deeper than before, never through the bottom, and the same on both pages.
  check('digging on down, the walker never falls through the bottom of the world', deep[1] < mine[1] - 0.3 && deep[1] > planeAt(deep[2]) - 3.2 && Math.abs(deep[1] - deepThere[1]) < 0.35 && Math.abs(deep[2] - mine[2]) < 3, { deep, deepThere, was: mine[1], road: planeAt(deep[2]) })
  if (out) await a.screenshot({ path: join(out, '5-deep.png') })

  const stats = await call<{ unread: number; gpuMs: unknown; cpuMs: unknown }>(a, 's.stats()')
  check('the page acted on every line and threw nothing', stats.unread === 0 && !errors.length, { unread: stats.unread, errors: errors.slice(0, 4) })
  const tick = await fetch(`http://127.0.0.1:${WT + 1}/stats`).then((r) => r.json()) as { stepMs: unknown }
  console.log(JSON.stringify({ page: { gpuMs: stats.gpuMs, cpuMs: stats.cpuMs, cells: await call(a, 's.cells()') }, world: tick.stepMs }))
  await a.context().close()
  if (out) for (const f of readdirSync(out)) if (f.endsWith('.webm') && f !== 'clip.webm') renameSync(join(out, f), join(out, 'clip.webm'))
} catch (e) {
  check('the check ran to its end', false, String(e instanceof Error ? e.stack : e).slice(0, 600))
} finally {
  await chrome.close()
  await stop(sim)
  await stop(vite)
}
console.log(`\n${checks.filter(Boolean).length}/${checks.length} passed`)
process.exit(checks.every(Boolean) ? 0 : 1)
