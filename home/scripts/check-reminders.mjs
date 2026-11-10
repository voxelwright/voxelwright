// Headless proof of reminders on the fridge (#86). Starts its own stub villager host and dev server on a throwaway
// root, seeds synthetic reminders in Alex's file, and checks the page: a missed one arrives once, marked missed; a
// due one arrives with the cue; tick off and put off reach the host; a failed save never looks done; the today
// note; Tab and Enter; reduced motion; no frame hook while nothing is due; no page errors.
// Usage: node scripts/check-reminders.mjs [--dev=5331] [--host=5330] [--shots=dir]
import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { pairLink } from './pairing.mjs'

const args = process.argv.slice(2)
const opt = (name) => args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3)
const homeDir = join(dirname(fileURLToPath(import.meta.url)), '..')
const hostDir = join(homeDir, '..', 'host')
const root = await mkdtemp(join(tmpdir(), 'reminders-page-'))
const hostPort = Number(opt('host') ?? 5330)
const devPort = Number(opt('dev') ?? 5331)
const shots = opt('shots')
const base = `http://localhost:${devPort}/`
const file = join(root, 'people', 'alex', 'reminders.json')
const checks = []
const check = (name, pass, detail) => checks.push({ name, pass: Boolean(pass), detail })

const children = new Set()
function run(cmd, argv, cwd, env, ready) {
  const child = spawn(cmd, argv, { cwd, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'], detached: true })
  children.add(child)
  child.on('exit', () => children.delete(child))
  return new Promise((resolve, reject) => {
    let out = ''
    const timer = setTimeout(() => reject(new Error(`${cmd} did not start: ${out.slice(-400)}`)), 90_000)
    child.stdout.on('data', (d) => {
      out += d
      if (ready.test(out)) {
        clearTimeout(timer)
        resolve(child)
      }
    })
    child.stderr.on('data', (d) => (out += d))
    child.on('exit', (code) => reject(new Error(`${cmd} exited ${code}: ${out.slice(-400)}`)))
  })
}
const stopAll = () => Promise.all([...children].map((child) => new Promise((resolve) => {
  child.once('exit', resolve)
  process.kill(-child.pid, 'SIGTERM')
})))

const iso = (ms) => new Date(Date.now() + ms).toISOString()
const reminder = (id, what, atMs, state = 'pending') => ({ id, what, at: iso(atMs), state, changed: iso(-86_400_000) })
// The pages run in a zone where it is about midday now, whatever the machine's clock says: "today", "this morning" and
// "later today" never straddle a midnight (Etc/GMT-3 is UTC+3).
const offset = 12 - new Date().getUTCHours()
const NOON_ZONE = offset >= 0 ? `Etc/GMT-${offset}` : `Etc/GMT+${-offset}`
const seed = async (list) => {
  await mkdir(dirname(file), { recursive: true })
  await writeFile(file, JSON.stringify({ version: 1, reminders: list }))
}
const stored = async () => JSON.parse(await readFile(file, 'utf8')).reminders
const byId = async (id) => (await stored()).find((r) => r.id === id)

try {
  await run('node', ['src/villager-cli.ts', '--agent', 'stub', '--port', String(hostPort), '--root', root], hostDir, { VILLAGER_PEOPLE: 'alex:Alex,sam:Sam,mia:Mia' }, /listening on/)
  await run('npx', ['vite', '--port', String(devPort), '--strictPort'], homeDir, { VILLAGER_PORT: String(hostPort) }, /Local:/)
  const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu', '--use-angle=metal'] })

  const open = async (context, query = '') => {
    const page = await context.newPage()
    const errors = []
    page.on('pageerror', (e) => errors.push(String(e)))
    page.on('console', (m) => m.type() === 'error' && !/Failed to load resource/.test(m.text()) && errors.push(m.text()))
    await page.goto(await pairLink(`${base}${query}`, root))
    await page.evaluate(() => window.village.ready())
    await page.evaluate(() => {
      window.__reminderEvents = []
      window.village.kernel.root.on('village/reminder', (e) => window.__reminderEvents.push(e.state))
    })
    return { page, errors }
  }
  const until = async (page, fn, ms = 15_000) => {
    const end = Date.now() + ms
    while (Date.now() < end) {
      if (await page.evaluate(fn).catch(() => false)) return true
      await page.waitForTimeout(100)
    }
    return false
  }
  const shot = async (page, name) => shots && page.screenshot({ path: join(shots, `${name}.png`) })
  const hooks = (page) => page.evaluate(() => window.village.snapshot().frameHooks)
  const doorNotes = (page) => page.evaluate(() => window.village.kernel.root.get('stage').scene.getObjectByName('reminder notes')?.children.length ?? 0)
  if (shots) await mkdir(shots, { recursive: true })

  // The page opens with nothing due: the frame hooks then are the idle baseline.
  await seed([])
  const desk = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2, timezoneId: NOON_ZONE })
  let { page, errors } = await open(desk)
  await page.waitForTimeout(1500)
  const idleHooks = await hooks(page)
  // Missed while nobody was asking: two hours late. A future one for later today, a done one from this morning.
  await seed([
    reminder('a1a1a1a1', 'call the dentist', -2 * 3_600_000),
    reminder('b2b2b2b2', 'take the bread out', 3 * 3_600_000),
    { ...reminder('c3c3c3c3', 'water the basil', -60_000, 'done') },
  ])
  await page.evaluate(() => window.village.reminders.poll())
  check('missed: the slip arrives, marked missed, in the villager\'s words', await until(page, () => document.querySelector('.rem-slip .rem-missed') && document.querySelector('.rem-slip .rem-what')?.textContent === 'call the dentist'))
  await page.waitForTimeout(600)
  await shot(page, 'missed')
  check('missed: the cue event fired once, as missed', JSON.stringify(await page.evaluate(() => window.__reminderEvents)) === '["missed"]', await page.evaluate(() => window.__reminderEvents))
  check('missed: the note is pinned on the fridge door', (await doorNotes(page)) === 1)
  check('missed: the page told the host it showed it', await (async () => { for (let i = 0; i < 30; i++) { if ((await byId('a1a1a1a1')).state === 'shown') return true; await new Promise((r) => setTimeout(r, 100)) } return false })())
  check('missed: the host still says it was missed', (await byId('a1a1a1a1')).late === true)
  check('while a slip follows the fridge the plugin has one or two frame hooks (slip, pin)', [1, 2].includes(await page.evaluate(() => window.village.reminders.frameHooks())))
  // Tab and Enter reach the note on the door.
  await page.click('.rem-close')
  await page.waitForTimeout(800)
  const own = () => page.evaluate(() => window.village.reminders.frameHooks())
  check('leaving it on the fridge removes the slip, and the plugin has no frame hook at rest', (await page.evaluate(() => document.querySelectorAll('.rem-slip').length)) === 0 && (await own()) === 0, { own: await own(), idleHooks, page: await hooks(page) })
  const labels = await page.evaluate(() => window.village.snapshot().entries.map((e) => e.label))
  check('the note on the door is an entry', labels.includes('Reminder: call the dentist'), labels)
  await page.evaluate(() => document.body.focus())
  let reached = false
  for (let i = 0; i < 30 && !reached; i++) {
    await page.keyboard.press('Tab')
    reached = await page.evaluate(() => document.activeElement?.dataset?.entry === 'reminder')
  }
  check('Tab reaches the reminder', reached)
  await page.keyboard.press('Enter')
  check('Enter opens the fridge with the today note and the note', await until(page, () => document.querySelector('.rem-today') && document.querySelector('.rem-board .rem-slip')))
  await page.waitForTimeout(1500)
  await shot(page, 'today')
  const today = await page.evaluate(() => [...document.querySelectorAll('.rem-today li')].map((li) => `${li.className}|${li.textContent}`))
  check('today note: today\'s reminders, the done one struck through, from the host without a model call', today.some((t) => t.startsWith('done|') && t.includes('water the basil')) && today.some((t) => t.includes('take the bread out')), today)
  check('the board takes keyboard focus on its first action', await page.evaluate(() => document.activeElement?.closest('.rem-board') !== null))
  // A failed save never looks done.
  await page.route('**/reminders/a1a1a1a1', (r) => r.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"x"}' }))
  await page.click('.rem-board .rem-done')
  check('failed tick: says it did not save, and is not ticked', await until(page, () => !document.querySelector('.rem-board .rem-oops')?.hidden && !document.querySelector('.rem-board .rem-slip.ticked')))
  check('failed tick: the host still has it', (await byId('a1a1a1a1')).state === 'shown')
  await shot(page, 'failed')
  await page.unroute('**/reminders/a1a1a1a1')
  await page.click('.rem-board .rem-done')
  check('tick off: done on the host', await until(page, () => true) && await (async () => { for (let i = 0; i < 30; i++) { if ((await byId('a1a1a1a1')).state === 'done') return true; await new Promise((r) => setTimeout(r, 100)) } return false })())
  check('tick off: the note leaves the door and the done cue fired', await until(page, () => window.village.kernel.root.get('stage').scene.getObjectByName('reminder notes')?.children.length === 0 && window.__reminderEvents.includes('done')))
  await page.keyboard.press('Escape')
  check('Escape closes the board', await until(page, () => !document.querySelector('.rem-board')))
  check('no page errors (desk)', errors.length === 0, errors)

  // Shown once: a reload does not deliver it again.
  await page.close()
  await seed([...(await stored()), reminder('d4d4d4d4', 'move the car', -3 * 60_000)])
  ;({ page, errors } = await open(desk))
  await until(page, () => document.querySelector('.rem-slip'))
  await page.reload()
  await page.evaluate(() => window.village.ready())
  await page.evaluate(() => { window.__reminderEvents = []; window.village.kernel.root.on('village/reminder', (e) => window.__reminderEvents.push(e.state)) })
  await page.waitForTimeout(1500)
  check('shown once: after a reload no slip arrives again, the note stays on the door', (await page.evaluate(() => document.querySelectorAll('.rem-slip').length)) === 0 && (await doorNotes(page)) === 1 && (await page.evaluate(() => window.__reminderEvents.length)) === 0)

  // Due while the page is open, then put off an hour.
  await seed([...(await stored()), reminder('e5e5e5e5', 'take the bread out of the oven', 2_000)])
  await page.waitForTimeout(2_500)
  await page.evaluate(() => window.village.reminders.poll())
  check('due: arrives on time, not marked missed, with the cue', await until(page, () => document.querySelector('.rem-slip .rem-what')?.textContent === 'take the bread out of the oven' && !document.querySelector('.rem-slip .rem-missed') && window.__reminderEvents.includes('arrived')))
  await page.waitForTimeout(700)
  await shot(page, 'due')
  await page.click('.rem-slip [data-until="hour"]')
  check('put off an hour: the host has it put off', await (async () => { for (let i = 0; i < 30; i++) { const r = await byId('e5e5e5e5'); if (r.state === 'put off') return Math.abs(Date.parse(r.at) - Date.now() - 3_600_000) < 60_000; await new Promise((r) => setTimeout(r, 100)) } return false })())
  check('no page errors (due)', errors.length === 0, errors)
  await page.close()

  // Phone width, reduced motion: the board as a sheet, no slide-in and no pinning animation.
  await seed([...(await stored()), reminder('f6f6f6f6', 'ring Grandma back', -60_000)])
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, reducedMotion: 'reduce', isMobile: true, hasTouch: true, timezoneId: NOON_ZONE })
  ;({ page, errors } = await open(phone))
  check('reduced motion: the slip appears without moving', await until(page, () => document.querySelector('.rem-slip')) && (await page.evaluate(() => getComputedStyle(document.querySelector('.rem-slip')).transitionDuration)).split(',').every((d) => parseFloat(d) === 0))
  await page.waitForTimeout(400)
  await shot(page, 'phone-arrival')
  await page.evaluate(() => window.village.kernel.root.get('entries').choose('fridge'))
  await until(page, () => document.querySelector('.rem-board'))
  await page.waitForTimeout(1200)
  await shot(page, 'phone-today')
  const fits = await page.evaluate(() => { const b = document.querySelector('.rem-board').getBoundingClientRect(); return b.left >= 0 && b.right <= innerWidth && b.bottom <= innerHeight })
  check('phone: the board fits the screen', fits)
  check('no page errors (phone)', errors.length === 0, errors)
  await browser.close()
} finally {
  await stopAll()
  await rm(root, { recursive: true, force: true })
}

for (const c of checks) console.log(`${c.pass ? 'pass' : 'FAIL'}  ${c.name}${c.pass ? '' : `  ${JSON.stringify(c.detail)?.slice(0, 400)}`}`)
const failed = checks.filter((c) => !c.pass).length
console.log(`${checks.length - failed} of ${checks.length} passed`)
process.exitCode = failed ? 1 : 0
