// The door between the street and the home (#118): a resident walks to the home's door on the
// block, goes inside (the page becomes the home, told where the street is), and comes back out
// to stand at that door. Starts a world told where a home is, the street's page, and the home's
// own dev server. Usage: node test/door.ts [out-dir for pictures]
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { doorOf, houseAt } from '../src/houses.ts'
import { browser, here, sleep, start, startPage, startWorld } from './lib.ts'

const out = process.argv[2]
if (out) mkdirSync(out, { recursive: true })
const WT = 5683, PAGE = 5478, HOME = 5488
const door = doorOf(houseAt(0, 1))
const bad: string[] = []
const check = (what: string, ok: boolean, seen?: unknown) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${ok ? '' : ` (${JSON.stringify(seen)})`}`); if (!ok) bad.push(what) }
const home = await start('npx', ['--prefix', join(here, '../home'), 'vite', join(here, '../home'), '--port', String(HOME), '--strictPort'], 'Local')
const vite = await startPage(PAGE, WT)
const world = await startWorld(WT, '--world', 'none', '--crates', '8', '--balls', '0', '--home', `http://localhost:${HOME}/?talk=off`)
const chrome = await browser()
try {
  // Someone else is on the street first, and watches.
  const watcher = await chrome.newPage({ viewport: { width: 640, height: 400 } })
  await watcher.goto(`http://localhost:${PAGE}/?name=Watcher`)
  await watcher.waitForFunction('window.__street?.ready', undefined, { timeout: 30_000 })
  const who = (p: typeof watcher) => p.evaluate('window.__street.who()') as Promise<Record<string, number>>
  const page = await chrome.newPage({ viewport: { width: 1280, height: 720 } })
  const s = <T>(body: string) => page.evaluate(`(async () => { const s = window.__street; return ${body} })()`) as Promise<T>
  const at = () => s<number[]>('s.shownOf(s.you)')
  const shown = () => page.evaluate(() => !(document.getElementById('door') as HTMLButtonElement).hidden)
  await page.goto(`http://localhost:${PAGE}/?name=Pavlo`)
  await page.waitForFunction('window.__street?.ready', undefined, { timeout: 30_000 })
  await sleep(800)
  check('arriving at the top, no way in is offered', !(await shown()))
  const was = (await who(page)).Pavlo
  // Across to the sunny side, then up the hill to the first door.
  await s(`s.hold('KeyA', true)`)
  for (const t0 = Date.now(); (await at())[0] < door[0] - 0.4 && Date.now() - t0 < 8000;) await sleep(30)
  await s(`s.hold('KeyA', false)`)
  await s(`s.hold('KeyS', true)`)
  for (const t0 = Date.now(); (await at())[2] > door[2] + 0.3 && Date.now() - t0 < 8000;) await sleep(30)
  await s(`s.hold('KeyS', false)`)
  await sleep(600)
  const stood = await at()
  check('at the home\'s door, the way in is offered', await shown(), { stood, door })
  if (out) await page.screenshot({ path: join(out, '1-at-the-door.png') })
  await page.keyboard.press('KeyF')
  await page.waitForURL((url) => url.port === String(HOME), { timeout: 15_000 }).catch(() => {})
  const inside = new URL(page.url())
  check('going in opens the home, told where the street is', inside.port === String(HOME) && inside.searchParams.get('street') === `http://localhost:${PAGE}/`, page.url())
  await page.waitForSelector('.street-door', { timeout: 30_000 }).catch(() => {})
  check('the home shows the way back out', (await page.locator('.street-door').count()) === 1)
  await sleep(out ? 5000 : 500)
  if (out) await page.screenshot({ path: join(out, '2-inside.png') })
  await page.locator('.street-door').click()
  await page.waitForURL((url) => url.port === String(PAGE), { timeout: 15_000 }).catch(() => {})
  await page.waitForFunction('window.__street?.ready', undefined, { timeout: 30_000 })
  await sleep(1200)
  const back = await at()
  check('coming out, you stand at the home\'s door', new URL(page.url()).searchParams.get('from') === 'home' && Math.hypot(back[0] - door[0], back[2] - door[2]) < 0.6, { back, door })
  check('and the way in is offered again', await shown())
  // A new seat would be the next felt figure along: the browser remembers which one it was, and asks to be it again.
  const now = (await who(page)).Pavlo, seen = (await who(watcher)).Pavlo
  check('you come out as who you went in: the same name and the same felt figure, to yourself and to others', was !== undefined && now === was && seen === was, { was, now, seen, watcher: await who(watcher) })
  if (out) await page.screenshot({ path: join(out, '3-back-out.png') })
  const unread = [await s<number>('s.stats().unread'), await watcher.evaluate('window.__street.stats().unread') as number]
  check('both pages acted on every line the world sent', unread.every((n) => n === 0), unread)
  // A home opened with a street on another machine's name shows no way out: the address is not believed.
  const other = await chrome.newPage()
  await other.goto(`http://localhost:${HOME}/?talk=off&street=${encodeURIComponent('https://elsewhere.example/')}`)
  await other.waitForSelector('canvas', { timeout: 30_000 })
  await sleep(2500)
  check('a street on another machine\'s name is not believed', (await other.locator('.street-door').count()) === 0)
} finally {
  await chrome.close()
  world.kill()
  vite.kill()
  home.kill()
}
if (bad.length) { console.log(`FAILED: ${bad.join('; ')}`); process.exit(1) }
console.log('the door works both ways')
