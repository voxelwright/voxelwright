// The street by touch (#118), in WebKit at a phone's size, with a stand-in maker: walking with
// the stick under a thumb, tapping to jump, tapping the dark button round its three verbs,
// tapping the sentence and typing into it. One problem is solved that way and the bridge is
// then changed. Nothing here uses the keyboard hooks the other checks walk with. The stick's
// drags are pointer events put on the page (touch ones, as a finger's are); taps are the
// browser's own. Usage: node test/touch.ts [pictures/]
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { webkit } from 'playwright'
import { GRADE, TRENCH } from '../src/ground.ts'
import { sleep, startPage, startWorld } from './lib.ts'

const out = process.argv[2]
if (out) mkdirSync(out, { recursive: true })
const WT = 5753, PAGE = 5558, LEN = Math.hypot(1, GRADE)
const bad: string[] = []
const check = (what: string, ok: unknown, seen?: unknown) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${ok || seen === undefined ? '' : ` ${JSON.stringify(seen).slice(0, 500)}`}`); if (!ok) bad.push(what) }
const vite = await startPage(PAGE, WT)
const world = await startWorld(WT, '--maker', 'stub', '--problems', '--rest', '600', '--world', 'none', '--crates', '0', '--balls', '0')
const browser = await webkit.launch()
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true })
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(String(e).slice(0, 200)))
  const s = <T>(body: string) => page.evaluate(`(async () => { const s = window.__street; return ${body} })()`) as Promise<T>
  const until = async <T>(read: () => Promise<T>, good: (v: T) => boolean, ms: number) => { for (const t0 = Date.now(); ;) { const v = await read(); if (good(v) || Date.now() - t0 > ms) return v; await sleep(80) } }
  const at = () => s<number[]>('s.shownOf(s.you)')
  /** A thumb down on the left of the picture and dragged: right and up are 1. Lifted on the exact animation frame `axis` crosses `goal`, so IPC latency does not overshoot Otis's frame or the trench's bridge window. */
  const walkUntil = (right: number, up: number, axis: 0 | 2, cmp: '<' | '>', goal: number, ms: number) =>
    page.evaluate(([r, u, i, op, g, lim]) => new Promise<number[]>((resolve) => {
      const send = (k: string, px: number, py: number) => (k === 'pointerdown' ? document.querySelector('canvas')! : window).dispatchEvent(new PointerEvent(k, { pointerId: 7, pointerType: 'touch', clientX: px, clientY: py, bubbles: true, isPrimary: true }))
      const st = (window as unknown as { __street: { shownOf(id: number): number[]; you: number } }).__street
      const t0 = performance.now()
      send('pointerdown', 90, 620)
      send('pointermove', 90 + r * 50, 620 - u * 50)
      const step = () => {
        const p = st.shownOf(st.you)
        if ((op === '<' ? p[i] < g : p[i] > g) || performance.now() - t0 > lim) { send('pointerup', 90, 620); resolve(p); return }
        requestAnimationFrame(step)
      }
      requestAnimationFrame(step)
    }), [right, up, axis, cmp, goal, ms] as const)

  await page.goto(`http://localhost:${PAGE}/?name=Phone`)
  await page.waitForFunction('window.__street?.ready', undefined, { timeout: 40_000 })
  await sleep(1000)
  const start = await at()
  // The stick: to the right is the road's middle from here, up is down the hill.
  await walkUntil(1, 0, 0, '<', 0.3, 6000)
  const side = await at()
  check('the stick to the right walks you to the right', side[0] < 0.4 && Math.abs(side[2] - start[2]) < 1, { start, side })
  await walkUntil(0, 1, 2, '>', -19.5, 8000)
  await sleep(700)
  // What someone wants, over their head, stays on a narrow screen.
  const heads = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>('.head')].filter((h) => h.style.display !== 'none' && !h.querySelector<HTMLElement>('.wants')!.hidden).map((h) => { const r = h.getBoundingClientRect(); return { text: h.querySelector('.wants')!.textContent!.slice(0, 24), left: Math.round(r.left), right: Math.round(r.right) } }))
  check('what a resident wants is whole on the screen, not cut off at its side', heads.length > 0 && heads.every((h) => h.left >= 0 && h.right <= 390) && heads.some((h) => h.text.length > 3), heads)
  if (out) await page.screenshot({ path: join(out, '1-near-otis.png') })
  // A tap on the right of the picture is a jump.
  const ground = (await at())[1]
  await page.touchscreen.tap(300, 380)
  const top = await until(at, (p) => p[1] > ground + 0.4, 1500)
  check('a tap jumps', top[1] > ground + 0.4, { ground, top: top[1] })
  await sleep(900)
  await walkUntil(0, 1, 2, '>', (TRENCH.from - 1.6) / LEN, 12_000)
  await sleep(500)

  // The sentence, by tapping it and typing: a bridge, and Mabel crosses.
  await page.tap('#words')
  await page.keyboard.type('a bridge')
  await page.keyboard.press('Enter')
  const said = await until(() => s<string>('s.notice()'), (n) => !!n, 30_000)
  check('a sentence typed into the bar by touch solves a problem', said === 'Phone got Mabel across the trench with Plank bridge', said)
  if (out) { await sleep(400); await page.screenshot({ path: join(out, '2-solved.png') }) }

  // The dark button goes round its verbs (on a street of cells the hammer and the boom are among them); in "change" the sentence is about the bridge.
  const verbs: string[] = []
  const round = (await page.evaluate('window.__street.cells().cell')) ? 'change,say,hammer,boom,make' : 'change,say,make'
  for (let i = 0; i < round.split(',').length; i++) { await page.tap('#mode'); verbs.push((await page.textContent('#mode'))!) }
  check('tapping the dark button goes round make, change, say', verbs.join() === round, verbs)
  if (round.includes('boom')) {
    // On a street of cells: with the boom in hand, a tap on the street strikes it there.
    for (let i = 0; i < 4; i++) await page.tap('#mode')
    const sums = () => page.evaluate('JSON.stringify(window.__street.cellSums())') as Promise<string>
    const before = await sums()
    let spot: [number, number] | null = null
    for (const [px, py] of [[300, 330], [330, 260], [250, 400], [350, 420]] as const) if (await page.evaluate(`window.__street.meets(${px}, ${py})`)) { spot = [px, py]; break }
    if (spot) await page.touchscreen.tap(spot[0], spot[1])
    let after = before
    for (const t0 = Date.now(); after === before && Date.now() - t0 < 5000;) { await sleep(150); after = await sums() }
    check('with the boom in hand, a tap strikes the street where it points', spot && after !== before, { spot, mode: await page.textContent('#mode') })
    await page.tap('#mode')
  }
  await page.tap('#mode')
  await sleep(2200)
  await page.tap('#words')
  await page.keyboard.type('make it bigger')
  await page.keyboard.press('Enter')
  const toys = await until(() => s<string[]>('s.toys()'), (t) => t.includes('made-2') && !t.includes('made-1'), 15_000)
  check('and a sentence in "change" changes the bridge you stand by', toys.includes('made-2') && !toys.includes('made-1'), toys.filter((t) => t.startsWith('made-')))
  const stats = await s<{ backend: string; unread: number; frameMs: { p50: number } }>('s.stats()')
  check('the page acted on every line and threw nothing', stats.unread === 0 && errors.length === 0, { unread: stats.unread, errors })
  console.log(JSON.stringify({ browser: `webkit ${browser.version()}`, backend: stats.backend, frameMs: stats.frameMs.p50 }))
} finally {
  await browser.close()
  world.kill()
  vite.kill()
}
if (bad.length) { console.log(`FAILED: ${bad.join('; ')}`); process.exit(1) }
console.log('the street can be played by touch')
