// The second verb with a real model, by hand (#118): it spends the signed-in Claude Code's usage.
// A walker makes one thing, then changes it with each sentence in turn, and a picture is taken
// after each. Usage: node test/changes.ts <out-dir> <maker> "<what to make>" "<change>" ["<change>" ...]
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { browser, sleep, startPage, startWorld } from './lib.ts'

const [out, maker, first, ...changes] = process.argv.slice(2)
if (!out || !maker || !first || !changes.length) throw new Error('Usage: node test/changes.ts <out-dir> <maker> "<what to make>" "<change>" ["<change>" ...]')
mkdirSync(out, { recursive: true })
const WT = 5743, PAGE = 5548
const vite = await startPage(PAGE, WT)
const world = await startWorld(WT, '--maker', maker, '--world', 'none', '--crates', '0', '--balls', '0')
world.stdout!.on('data', (d) => { const t = String(d); if (/asked/.test(t)) process.stdout.write(`[world] ${t}`) })
const chrome = await browser()
const rows: Record<string, unknown>[] = []
try {
  const page = await chrome.newPage({ viewport: { width: 1280, height: 720 } })
  const s = <T>(body: string) => page.evaluate(`(async () => { const s = window.__street; return ${body} })()`) as Promise<T>
  await page.goto(`http://localhost:${PAGE}/?name=Pavlo`)
  await page.waitForFunction('window.__street?.ready', undefined, { timeout: 30_000 })
  await sleep(1200)
  const typed = async (verb: 'make' | 'change', sentence: string, shot: string) => {
    const before = await s<string[]>('s.toys()')
    await s(`s.${verb}(${JSON.stringify(sentence)})`)
    const t0 = Date.now()
    let words: { kind: string; text: string }[] = []
    for (; Date.now() - t0 < 120_000;) { words = await s('s.bubbles()'); if (words.some((b) => /bubble (made|sorry)/.test(b.kind))) break; await sleep(200) }
    await sleep(2600)
    // From the side and a little above, so the thing is whole in the picture.
    const me = await s<number[]>('s.shownOf(s.you)')
    await s(`s.camera(${JSON.stringify([me[0] + 5.5, me[1] + 2.6, me[2] + 1])}, ${JSON.stringify([me[0], me[1] + 0.6, me[2] + 4.5])})`)
    await sleep(900)
    await page.screenshot({ path: join(out, shot) })
    await s('s.camera(null)').catch(() => {})
    const now = await s<string[]>('s.toys()')
    const row = { verb, sentence, seconds: +((Date.now() - t0) / 1000 - 3.5).toFixed(1), said: words.find((b) => /bubble (made|sorry)/.test(b.kind)), came: now.filter((t) => /^made-/.test(t) && !before.includes(t)), went: before.filter((t) => /^made-/.test(t) && !now.includes(t)) }
    rows.push(row)
    console.log(JSON.stringify(row))
    await sleep(2200)
  }
  await typed('make', first, '0-made.png')
  for (const [i, change] of changes.entries()) await typed('change', change, `${i + 1}-changed.png`)
  writeFileSync(join(out, 'report.json'), JSON.stringify(rows, null, 1))
} finally {
  await chrome.close()
  world.kill()
  vite.kill()
}
