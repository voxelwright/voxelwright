// What the page draws (#136), on a real page: the street's own sky, ground, houses, trees and cars
// stand in the scene and the world's plain shapes for them do not show beside them; the picture
// costs no more GPU time than the top tier allows on this machine; and a page that measures
// itself too slow steps down to the light tier without an error, its sun's shadow laid out again
// as one map. Usage: node test/drawn.ts
import { browser, sleep, startPage, startWorld } from './lib.ts'

const WT = 5933, PAGE = 5638
const bad: string[] = []
const check = (what: string, ok: boolean, seen?: unknown) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${ok || seen === undefined ? '' : ` ${JSON.stringify(seen).slice(0, 400)}`}`); if (!ok) bad.push(what) }
const vite = await startPage(PAGE, WT)
const world = await startWorld(WT, '--problems', '--crates', '24', '--balls', '6')
const chrome = await browser()
try {
  const open = async (query: string) => {
    const page = await chrome.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 2 })
    const said: string[] = []
    page.on('pageerror', (e) => said.push(String(e).slice(0, 300)))
    page.on('console', (m) => { if (m.type() === 'error' && !/favicon|404/.test(m.text())) said.push(m.text().slice(0, 300)) })
    await page.goto(`http://localhost:${PAGE}/?name=Looker&${query}`)
    await page.waitForFunction('window.__street?.ready', undefined, { timeout: 30_000 })
    return { page, said, s: <T>(body: string) => page.evaluate(`(() => { const s = window.__street; return ${body} })()`) as Promise<T> }
  }
  type Stats = { quality: string; unread: number; tier: string; gpuMs: { p50: number; n: number }; frameMs: { p50: number } }
  type Drawn = { groups: string[]; doubled: number; boxed: boolean }

  const a = await open('gpu=1')
  await sleep(7000)
  const drawn = await a.s<Drawn>('s.drawn()'), stats = await a.s<Stats>('s.stats()')
  const wanted = ['the sky', 'the ground', 'the houses', 'what stands along the street', 'the parked cars', 'the hill', 'the bay']
  check('the street\'s own sky, ground, houses, trees, cars and land stand in the scene', wanted.every((name) => drawn.groups.includes(name)), drawn.groups)
  check('none of the world\'s plain shapes for them shows beside them', drawn.doubled === 0, drawn.doubled)
  check('it settles on the top tier here, its sun in boxes that follow the camera', stats.quality === 'high' && drawn.boxed, { quality: stats.quality, tier: stats.tier, boxed: drawn.boxed })
  check('a frame costs the GPU less than the top tier allows (13 ms)', stats.gpuMs.n > 100 && stats.gpuMs.p50 < 13, stats.gpuMs)
  check('no error on the page, no line from the street dropped', !a.said.length && stats.unread === 0, { said: a.said, unread: stats.unread })

  // A machine a hundred times slower: every tier is over its time, so the page steps down twice.
  const b = await open('budget=0.01')
  for (const t0 = Date.now(); (await b.s<Stats>('s.stats()')).quality !== 'low' && Date.now() - t0 < 45_000;) await sleep(250)
  await sleep(1500)
  const low = await b.s<Stats>('s.stats()'), lowDrawn = await b.s<Drawn>('s.drawn()')
  check('a page that measures itself too slow steps down to the light tier', low.quality === 'low', { quality: low.quality, tier: low.tier })
  check('there its sun\'s shadow is one map, laid out again', !lowDrawn.boxed, lowDrawn.boxed)
  check('and it goes on drawing, with no error and nothing dropped', !b.said.length && low.unread === 0 && low.frameMs.p50 < 60, { said: b.said, unread: low.unread, frameMs: low.frameMs })
} finally {
  await chrome.close()
  world.kill()
  vite.kill()
}
if (bad.length) { console.log(`FAILED: ${bad.join('; ')}`); process.exit(1) }
console.log('the page draws what it should')
