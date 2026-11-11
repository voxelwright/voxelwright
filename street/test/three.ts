// All three of the block's problems solved by typing (#118), with a real model, by hand: it
// spends the signed-in Claude Code's usage. A walker asks for stairs by Otis, a bridge for
// Mabel, crosses it, and asks for shade by Ines. Records <out>/clip.webm,
// stills and what the street said. Each ask gets one try; the report says which were solved.
// Usage: node test/three.ts <out-dir> [maker]
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { GRADE, TRENCH } from '../src/ground.ts'
import { doorOf, houseAt } from '../src/houses.ts'
import { browser, sleep, startPage, startWorld } from './lib.ts'

const [out, maker = 'sonnet'] = process.argv.slice(2)
if (!out) throw new Error('Usage: node test/three.ts <out-dir> [maker]')
mkdirSync(out, { recursive: true })
const WT = 5733, PAGE = 5538, LEN = Math.hypot(1, GRADE)
const dir = mkdtempSync(join(tmpdir(), 'street-three-'))
const ines = doorOf(houseAt(6, 1))
const vite = await startPage(PAGE, WT)
const world = await startWorld(WT, '--maker', maker, '--problems', '--rest', '900', '--world', dir, '--crates', '24', '--balls', '6')
world.stdout!.on('data', (d) => { const t = String(d); if (/solved|asked/.test(t)) process.stdout.write(`[world] ${t}`) })
const chrome = await browser()
const told: Record<string, unknown>[] = []
try {
  const context = await chrome.newContext({ viewport: { width: 1280, height: 720 }, recordVideo: { dir: out, size: { width: 1280, height: 720 } } })
  const page = await context.newPage()
  const s = <T>(body: string) => page.evaluate(`(async () => { const s = window.__street; return ${body} })()`) as Promise<T>
  const at = () => s<number[]>('s.shownOf(s.you)')
  const go = async (key: string, done: (p: number[]) => boolean, ms = 9000) => { await page.keyboard.down(key); for (const t0 = Date.now(); !done(await at()) && Date.now() - t0 < ms;) await sleep(20); await page.keyboard.up(key); await sleep(250) }
  /** Types a sentence, waits for the thing, then up to `wait` seconds for the street to say a problem is solved. */
  const typed = async (sentence: string, shot: string, wait = 14) => {
    const before = await s<string>('s.notice()')
    await page.keyboard.press('Enter')
    await page.keyboard.type(sentence, { delay: 35 })
    await sleep(300)
    await page.keyboard.press('Enter')
    const t0 = Date.now()
    let words: { kind: string; text: string }[] = []
    for (; Date.now() - t0 < 90_000;) { words = await s('s.bubbles()'); if (words.some((b) => /bubble (made|sorry)/.test(b.kind))) break; await sleep(200) }
    const madeIn = +((Date.now() - t0) / 1000).toFixed(1)
    let notice = ''
    for (const t1 = Date.now(); Date.now() - t1 < wait * 1000;) { notice = await s<string>('s.notice()'); if (notice && notice !== before) break; await sleep(200) }
    await sleep(1800)
    await page.screenshot({ path: join(out, shot) })
    const row = { sentence, madeInS: madeIn, made: words.find((b) => /bubble (made|sorry)/.test(b.kind))?.text, street: notice && notice !== before ? notice : '', words: (await s<{ text: string; kind: string }[]>('s.bubbles()')).filter((b) => b.kind === 'bubble said').map((b) => b.text) }
    told.push(row)
    console.log(JSON.stringify(row))
    await sleep(2500)
  }
  await page.goto(`http://localhost:${PAGE}/?name=Pavlo`)
  await page.waitForFunction('window.__street?.ready', undefined, { timeout: 30_000 })
  await sleep(1500)
  // Round the crates on the sunny side, then to the middle of the road a few metres above Otis.
  await go('KeyA', (p) => p[0] > 3.2)
  await go('KeyW', (p) => p[2] > -20.4)
  await go('KeyD', (p) => p[0] < 1.1)
  await go('KeyW', (p) => p[2] > -19.4)
  await typed('stairs up to a platform two metres high', '1-otis.png', 40)
  // Past the stairs and down to the trench, where Mabel waits.
  await go('KeyD', (p) => p[0] < -1.4)
  await go('KeyW', (p) => p[2] > (TRENCH.from - 1.6) / LEN, 14_000)
  await typed('a wide plank bridge across the trench', '2-mabel.png', 25)
  // Over the bridge, on down the hill, and across to the pavement above Ines's door.
  await go('KeyW', (p) => p[2] > ines[2] - 4.7, 14_000)
  await go('KeyA', (p) => p[0] > ines[0] - 0.4)
  await sleep(600)
  await typed('a big beach umbrella', '3-ines.png')
  const solved = existsSync(join(dir, 'solved.jsonl')) ? readFileSync(join(dir, 'solved.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l)) : []
  const stats = await s<Record<string, unknown>>('s.stats()')
  const report = { maker, told, solved, frameMs: stats.frameMs, unread: stats.unread }
  writeFileSync(join(out, 'report.json'), JSON.stringify(report, null, 1))
  console.log(JSON.stringify({ solved: solved.map((e: { solver: string; done: string; with: string }) => `${e.solver} ${e.done} with ${e.with}`), unread: stats.unread }))
  await context.close()
  const video = readdirSync(out).find((f) => f.endsWith('.webm') && f !== 'clip.webm')
  if (video) renameSync(join(out, video), join(out, 'clip.webm'))
} finally {
  await chrome.close()
  world.kill()
  vite.kill()
  rmSync(dir, { recursive: true, force: true })
}
