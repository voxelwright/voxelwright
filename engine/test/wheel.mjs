// The wheel of realms (#264): a key shows the realms the server keeps, home among them, the selected one marked,
// each with the last picture this browser had of it; picking one selects it and opens a window to it; the last
// entry hands over to making a new realm from words; and a realm that was made is stepped into by a window.
//
//   node test/wheel.mjs [--out dir]
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { arg, chrome, here, still } from './kit.mjs'

const failures = []
const check = (ok, what) => { console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) failures.push(what) }
const dir = join(tmpdir(), `engine-wheel-${process.pid}`), out = arg('out', '')
rmSync(dir, { recursive: true, force: true }); mkdirSync(dir, { recursive: true })
if (out) mkdirSync(out, { recursive: true })
const server = spawn('node', ['serve.mjs', '--port', '0', '--reports', '/dev/null', '--world', join(dir, 'home.log'), '--realms', join(dir, 'realms')], { cwd: here, stdio: ['ignore', 'pipe', 'inherit'] })
const url = await new Promise((resolve, reject) => {
  server.stdout.on('data', (chunk) => { const m = /engine page on (http:\/\/127\.0\.0\.1:\d+)/.exec(String(chunk)); if (m) resolve(m[1]) })
  server.on('exit', (code) => reject(new Error(`the server ended (${code})`)))
})
const post = (path, body) => fetch(url + path, { method: 'POST', body: JSON.stringify(body) }).then((r) => r.status)
// Something standing in for the asker's helper, so that the page takes wishes: it answers and keeps what it was asked.
const asked = []
const helper = createServer((req, res) => {
  const cors = { 'Access-Control-Allow-Origin': req.headers.origin ?? '*', 'Access-Control-Allow-Headers': 'Content-Type, X-Village-Secret', 'Cross-Origin-Resource-Policy': 'cross-origin' }
  if (req.method === 'OPTIONS') { res.writeHead(204, cors); return res.end() }
  let body = ''
  req.on('data', (c) => { body += c })
  req.on('end', () => { if (req.method === 'POST') asked.push(req.url); res.writeHead(200, { ...cors, 'Content-Type': 'application/json' }); res.end(req.method === 'POST' ? '{"stage":"done","state":"refused","why":"a check"}\n' : '{"helper":1}') })
})
await new Promise((r) => helper.listen(0, '127.0.0.1', r))
const browser = await chrome()
try {
  // Two realms beside home; one of them has a name that would be markup if it were not shown as text.
  await post('/realms', { by: 'check', id: 'dusk', name: 'Dusk in the east', about: 'the east end, late', arrive: { at: [9660, 4070] }, look: { hour: 17.6, tint: [0.8, 1, 0.84] } })
  await post('/realms', { by: 'check', id: 'odd', name: '<img src=x onerror=window.pwned=1>', about: '<b>bold</b>', arrive: { at: [3260, 4070] }, look: { hour: 22 } })
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 })
  const page = await context.newPage()
  page.on('pageerror', (e) => failures.push(`page error: ${e.message}`))
  await page.goto(`${url}/city?fly=0&shared=1&fire=0&sound=0&name=Cy&at=70,17.2,412.5&look=0,-4#helper=${encodeURIComponent(`http://127.0.0.1:${helper.address().port}`)}&secret=check`)
  await page.waitForFunction(() => globalThis.engine?.wheel, null, { timeout: 90_000 })
  await still(page, { limit: 90_000 })
  await page.evaluate(() => { try { localStorage.clear() } catch { /* nothing kept */ } globalThis.sameDocument = true })
  // A picture of where the page is, kept as it goes: wait for one.
  await page.waitForFunction(() => globalThis.engine.wheel.shot('home'), null, { timeout: 20_000 }).catch(() => {})
  const shot = await page.evaluate(() => globalThis.engine.wheel.shot('home'))
  check(typeof shot === 'string' && shot.startsWith('data:image/jpeg') && shot.length > 2000, `the page keeps a small picture of the realm it is in (${shot ? Math.round(shot.length / 1024) : 0} KB)`)

  await page.keyboard.press('Tab')
  await page.waitForFunction(() => globalThis.engine.wheel.open, null, { timeout: 5000 })
  const shown = await page.evaluate(() => { const p = document.querySelector('[data-panel="wheel"]'); return { entries: globalThis.engine.wheel.entries, names: [...p.querySelectorAll('button .name')].map((n) => n.textContent), pictured: [...p.querySelectorAll('button')].map((b) => !!b.style.backgroundImage), here: p.querySelector('button .here')?.parentElement.querySelector('.name').textContent, images: p.querySelectorAll('img').length, bold: p.querySelectorAll('b b').length, pwned: globalThis.pwned === 1, visible: getComputedStyle(p).display } })
  check(shown.visible === 'flex' && shown.entries.join() === 'home,dusk,odd,+' && shown.names[0] === 'Home' && shown.names[1] === 'Dusk in the east' && shown.names[3] === 'New realm', `Tab shows the wheel: home, the server's realms by name, and a new one (${shown.names.join(' | ')})`)
  check(shown.here === 'Home' && shown.pictured[0] && !shown.pictured[1], 'home is marked as where one is and has its last picture; a realm never seen has a colour of its own')
  check(shown.images === 0 && shown.bold === 0 && !shown.pwned && shown.names[2].startsWith('<img'), 'a name that would be markup is shown as the text it is')
  if (out) await page.screenshot({ path: join(out, 'wheel.png') })
  // Escape puts it away and nothing is picked.
  await page.keyboard.press('Escape')
  check(await page.evaluate(() => !globalThis.engine.wheel.open && !globalThis.engine.portal.gate && globalThis.engine.realms.selected === ''), 'Escape puts it away: nothing is selected and no window opens')

  // A number picks: the realm is selected and a window opens to it.
  await page.keyboard.press('Tab')
  await page.waitForFunction(() => globalThis.engine.wheel.open, null, { timeout: 5000 })
  await page.keyboard.press('Digit2')
  await page.waitForFunction(() => globalThis.engine.portal.gate && globalThis.engine.portal.to === 'dusk', null, { timeout: 15_000 })
  check(await page.evaluate(() => !globalThis.engine.wheel.open && globalThis.engine.realms.selected === 'dusk'), 'its number picks a realm: it is the selected one, and a window opens to it')
  await page.waitForFunction(() => globalThis.engine.portal.state.passable, null, { timeout: 60_000 })
  // Shown again, the selected one is marked; picking another leads the window there instead.
  await page.keyboard.press('Tab')
  await page.waitForFunction(() => globalThis.engine.wheel.open, null, { timeout: 5000 })
  const marked = await page.evaluate(() => document.querySelector('[data-panel="wheel"] button.selected .name')?.textContent)
  check(marked === 'Dusk in the east', `shown again, the selected realm is marked (${marked})`)
  if (out) await page.screenshot({ path: join(out, 'wheel-selected.png') })
  await page.evaluate(() => [...document.querySelectorAll('[data-panel="wheel"] button')].find((b) => b.querySelector('.name').textContent.startsWith('<img')).click())
  await page.waitForFunction(() => globalThis.engine.portal.gate && globalThis.engine.portal.to === 'odd', null, { timeout: 15_000 })
  check(await page.evaluate(() => globalThis.engine.realms.selected === 'odd'), 'a click on another realm selects it and leads the window there in place of the first')
  // P closes it; P again opens one to the selected realm.
  await page.keyboard.press('KeyP')
  await page.waitForFunction(() => !globalThis.engine.portal.gate, null, { timeout: 5000 })
  await page.keyboard.press('KeyP')
  await page.waitForFunction(() => globalThis.engine.portal.gate && globalThis.engine.portal.to === 'odd', null, { timeout: 15_000 })
  check(true, 'the portal\'s key then opens a window to the realm picked on the wheel')
  await page.keyboard.press('KeyP')

  // The new one: the ask bar opens with the words begun.
  await page.keyboard.press('Tab')
  await page.waitForFunction(() => globalThis.engine.wheel.open, null, { timeout: 5000 })
  // Typed at once, as someone would: the key that picks it, Enter out of habit, then the words. None of it is lost,
  // none of it is taken for the game's keys (R is rain), and a realm with nothing said of it is not made.
  await page.keyboard.press('Digit0')
  await page.keyboard.press('Enter')
  await page.keyboard.type('a rainy harbour', { delay: 15 })
  await page.waitForTimeout(300)
  const typed = await page.evaluate(() => ({ open: globalThis.engine.hud.line.open, words: document.querySelector('#line')?.value, rain: globalThis.engine.rain, tool: globalThis.engine.tool }))
  check(typed.open && typed.words === 'Create a realm called a rainy harbour' && typed.rain === 0 && asked.length === 0, `the new one, Enter and words typed at once: the line holds them, nothing was made of an empty idea, and no key reached the game (${JSON.stringify(typed)}; ${asked.length} asks of the helper)`)
  await page.keyboard.press('Escape')
  await page.keyboard.press('Tab')
  await page.waitForFunction(() => globalThis.engine.wheel.open, null, { timeout: 5000 })
  await page.keyboard.press('Digit0')
  await page.waitForFunction(() => globalThis.engine.hud.line.open, null, { timeout: 5000 })
  const bar = await page.evaluate(() => ({ open: globalThis.engine.hud.line.open, words: document.querySelector('#line')?.value, wheel: globalThis.engine.wheel.open }))
  check(bar.open && bar.words === 'Create a realm called ' && !bar.wheel, `the new one hands over to the ask bar, the words begun (${JSON.stringify(bar)})`)
  await page.keyboard.press('Escape')
  // A realm that was made is stepped into by a window, not by loading the page, and the line is put away so that the keys walk: what "Step in" does.
  await page.keyboard.press('Enter')
  await page.waitForFunction(() => globalThis.engine.hud.line.open, null, { timeout: 5000 })
  await page.evaluate(() => globalThis.engine.enterRealm('dusk'))
  check(await page.evaluate(() => !globalThis.engine.hud.line.open && globalThis.engine.input.top !== 'typing'), 'stepping in puts the line away: the keys are the person\'s to walk with')
  await page.waitForFunction(() => globalThis.engine.portal.gate && globalThis.engine.portal.to === 'dusk', null, { timeout: 15_000 })
  check(await page.evaluate(() => globalThis.sameDocument === true), 'and the page was never loaded again')
} catch (e) { failures.push(`the check itself failed: ${e.stack ?? e}`) }
await browser.close()
helper.close()
server.kill()
rmSync(dir, { recursive: true, force: true })
if (failures.length) { console.error(`FAILED\n  ${failures.join('\n  ')}`); process.exit(1) }
console.log('wheel: ok')
