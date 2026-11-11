// A clip of the game (#118), with a real model, by hand: it spends the signed-in Claude Code's
// usage. A walker goes down to the trench where Mabel wants to be across, types a sentence,
// waits for the thing, watches her walk over it, and walks on. Writes <out>/clip.webm and stills. Usage: node test/clip.ts <out-dir> [maker] ["sentence"]
import { mkdirSync, mkdtempSync, readdirSync, renameSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { TRENCH } from '../src/ground.ts'
import { browser, sleep, startPage, startWorld } from './lib.ts'

const [out, maker = 'sonnet', sentence = 'a plank bridge across the trench'] = process.argv.slice(2)
if (!out) throw new Error('Usage: node test/clip.ts <out-dir> [maker] ["sentence"]')
mkdirSync(out, { recursive: true })
const WT = 5333, PAGE = 5398
const dir = mkdtempSync(join(tmpdir(), 'street-clip-'))
const vite = await startPage(PAGE, WT)
const world = await startWorld(WT, '--maker', maker, '--world', dir, '--crates', '48', '--balls', '10', '--problems')
world.stdout!.on('data', (d) => process.stdout.write(`[world] ${d}`))
const chrome = await browser()
try {
  const context = await chrome.newContext({ viewport: { width: 1280, height: 720 }, recordVideo: { dir: out, size: { width: 1280, height: 720 } } })
  const page = await context.newPage()
  const s = <T>(body: string) => page.evaluate(`(async () => { const s = window.__street; return ${body} })()`) as Promise<T>
  const z = async () => (await s<number[]>('s.shownOf(s.you)'))[2]
  await page.goto(`http://localhost:${PAGE}/?name=Pavlo`)
  await page.waitForFunction('window.__street?.ready', undefined, { timeout: 20_000 })
  await sleep(1200)
  // Round the crates, then down the hill to a couple of metres short of the trench.
  await page.keyboard.down('KeyA')
  for (const t0 = Date.now(); (await s<number[]>('s.shownOf(s.you)'))[0] < 3.3 && Date.now() - t0 < 4000;) await sleep(30)
  await page.keyboard.up('KeyA')
  await page.keyboard.down('KeyW')
  for (const t0 = Date.now(); (await z()) < (TRENCH.from - 2.2) / 1.01 && Date.now() - t0 < 15_000;) await sleep(30)
  await page.keyboard.up('KeyW')
  await sleep(700)
  await page.screenshot({ path: join(out, '1-at-the-trench.png') })
  await page.keyboard.press('Enter')
  await page.keyboard.type(sentence, { delay: 45 })
  await sleep(400)
  await page.keyboard.press('Enter')
  const t0 = Date.now()
  let told: { kind: string; text: string }[] = []
  for (; Date.now() - t0 < 90_000;) { told = await s('s.bubbles()'); if (told.some((b) => /made|sorry/.test(b.kind))) break; await sleep(200) }
  console.log(`answered in ${((Date.now() - t0) / 1000).toFixed(1)} s:`, JSON.stringify(told))
  await sleep(2200)
  await page.screenshot({ path: join(out, '2-made.png') })
  // Whoever wanted to be across walks over it by herself: wait for the street to say so, then follow her.
  for (const t1 = Date.now(); !(await s<string>('s.notice()')) && Date.now() - t1 < 25_000;) await sleep(200)
  console.log('the street says:', JSON.stringify(await s('s.notice()')), 'words:', JSON.stringify(await s('s.bubbles()')))
  await sleep(1500)
  await page.screenshot({ path: join(out, '3-solved.png') })
  await page.keyboard.down('KeyW'); await sleep(2600); await page.keyboard.up('KeyW')
  await sleep(1200)
  await page.screenshot({ path: join(out, '4-after.png') })
  console.log('walker ended at z', (await z()).toFixed(2), 'the trench ends at z', (TRENCH.to / 1.01).toFixed(2), 'stats', JSON.stringify(await s('s.stats()')).slice(0, 300))
  await context.close()
  const video = readdirSync(out).find((f) => f.endsWith('.webm') && f !== 'clip.webm')
  if (video) renameSync(join(out, video), join(out, 'clip.webm'))
} finally {
  await chrome.close()
  world.kill()
  vite.kill()
  rmSync(dir, { recursive: true, force: true })
}
