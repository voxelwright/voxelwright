// The daily home, end to end (#85, #86, #87), with the stub villager, stub router and
// stub Elder executor (the gates are real), so no model is called.
//
// `npm run village` on a scratch root installs the live home and serves it with the
// villagers and the approval page. A device is paired with `link alex --add`. In
// headless Chrome the notepad line "Elder, put a small brass bell on the table" starts
// a run; the card follows it; its link opens the approval page; Keep there puts the
// bell into the same open home page without a reload; Undo takes it out. Before that,
// every way the live home's origin could approve is tried with the session cookie (and
// without it), by fetch and by form, and nothing is promoted; the approval page cannot
// be framed; extra parameters in its address approve nothing; a script's click and a
// click before the buttons are armed do nothing. Then a reminder is set, the host is
// restarted, and the note reaches the fridge once it is due.
//
//   node test/daily-home.ts [--port 5320] [--approval-port <port + 1>] [--keep-root]
//   node test/daily-home.ts --real   the same flow with the real villager (warm Haiku), router (Sonnet) and Elder
//                                    (claude-code), on the operator's login; the attacks are left to the stub run
import { execFile, spawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseArgs, promisify } from 'node:util'
import { chromium, type BrowserContext, type Page } from 'playwright'

const { values } = parseArgs({ options: { port: { type: 'string', default: '5320' }, 'approval-port': { type: 'string' }, 'keep-root': { type: 'boolean', default: false }, real: { type: 'boolean', default: false } } })
const real = values.real
const port = Number(values.port)
const approvalPort = Number(values['approval-port'] ?? port + 1)
const home = `http://localhost:${port}/`
const approvalOrigin = `http://localhost:${approvalPort}`
const scratch = await mkdtemp(join(tmpdir(), 'daily-home-'))
const root = join(scratch, 'root')
const live = join(root, 'live')
// No VILLAGER_PEOPLE: `npm run village` lists the household the page's cast shows (Alex, Sam and Mia) by itself.
const env: Record<string, string> = {}
delete process.env.VILLAGER_PEOPLE
const steps: { step: string; ok: boolean }[] = []
const measured: Record<string, unknown> = {}
const check = (step: string, ok: unknown, detail?: unknown) => {
  steps.push({ step, ok: Boolean(ok) })
  console.log(`${ok ? 'PASS' : 'FAIL'} ${step}${detail === undefined ? '' : ' ' + JSON.stringify(detail).slice(0, 300)}`)
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
async function until<T>(get: () => Promise<T>, test: (v: T) => boolean, ms: number, every = 250): Promise<T> {
  const end = Date.now() + ms
  let v = await get()
  while (!test(v) && Date.now() < end) {
    await sleep(every)
    v = await get()
  }
  return v
}

let village: ChildProcess | undefined
function startVillage(): Promise<ChildProcess> {
  const child = spawn(process.execPath, ['src/village.ts', '--root', root, '--port', String(port), '--approval-port', String(approvalPort), '--agent', real ? 'warm' : 'stub'], { cwd: process.cwd(), env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'], detached: true })
  return new Promise((resolve, reject) => {
    let out = ''
    const timer = setTimeout(() => reject(new Error(`village did not start: ${out.replace(/pair=\w+/g, 'pair=…').slice(-600)}`)), 15 * 60_000)
    const read = (d: Buffer) => {
      out += d
      if (/Village is open at/.test(out)) {
        clearTimeout(timer)
        resolve(child)
      }
    }
    child.stdout!.on('data', read)
    child.stderr!.on('data', read)
    child.on('exit', (code) => reject(new Error(`village exited ${code}: ${out.replace(/pair=\w+/g, 'pair=…').slice(-600)}`)))
  })
}
const stop = (child: ChildProcess | undefined) =>
  new Promise<void>((resolve) => {
    if (!child || child.exitCode !== null) return resolve()
    child.once('exit', () => resolve())
    process.kill(-child.pid!, 'SIGTERM')
  })

const promotions = async () => (existsSync(join(live, 'promotions.jsonl')) ? (await readFile(join(live, 'promotions.jsonl'), 'utf8')).split('\n').filter(Boolean).length : 0)
const card = (page: Page) => page.evaluate(() => (window as any).village?.talk?.state().elder ?? null)
const active = (page: Page) => page.evaluate(() => (window as any).village.snapshot().plugins.active as string[])

/** The run as the host has it, read with the device's session through the approval server (no browser headers: a read). */
async function hostRun(context: BrowserContext, id: string) {
  const secret = (await context.cookies(`${home}villager/api/`)).find((c) => c.name.startsWith('village_'))?.value
  const res = await fetch(`${approvalOrigin}/villager/api/people/alex/elder/runs/${id}`, { headers: { cookie: `village_session=${secret}` } })
  return ((await res.json()) as { run?: { status: string; promotion?: string } }).run
}

/**
 * A page on the live home's origin with no Content Security Policy: the worst a promoted plugin could get. The
 * browser treats it as http://localhost:<port>, so the device's session cookie goes with every request it makes.
 * It tries the act every way a page can, and reports what each try saw.
 */
async function attackFromHome(context: BrowserContext, id: string, act: 'keep' | 'undo', body: Record<string, string>) {
  const probe = `${home}__probe`
  await context.route(probe, (route) => route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>probe</title><body></body>' }))
  const page = await context.newPage()
  await page.goto(probe)
  const tries = await page.evaluate(
    async ({ approvalOrigin, id, act, body }) => {
      const path = `/villager/api/people/alex/elder/runs/${id}/${act}`
      const out: Record<string, string> = {}
      const attempt = async (name: string, f: () => Promise<Response>) => {
        try {
          const r = await f()
          out[name] = r.type === 'opaque' ? 'opaque (sent, unreadable)' : `${r.status} ${(await r.text()).slice(0, 80)}`
        } catch (e) {
          out[name] = `threw ${(e as Error).name}`
        }
      }
      const json = JSON.stringify(body)
      await attempt('fetch approval origin, JSON, with cookie', () => fetch(approvalOrigin + path, { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' }, body: json }))
      await attempt('fetch approval origin, no-cors text, with cookie', () => fetch(approvalOrigin + path, { method: 'POST', mode: 'no-cors', credentials: 'include', headers: { 'content-type': 'text/plain' }, body: json }))
      await attempt('fetch own origin, JSON, with cookie', () => fetch(path, { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' }, body: json }))
      await attempt('fetch own origin, JSON, no cookie', () => fetch(path, { method: 'POST', credentials: 'omit', headers: { 'content-type': 'application/json' }, body: json }))
      const form = (action: string, name: string) =>
        new Promise<void>((resolve) => {
          const frame = document.createElement('iframe')
          frame.name = name
          document.body.append(frame)
          const f = document.createElement('form')
          f.method = 'POST'
          f.action = action
          f.target = name
          f.enctype = 'text/plain'
          const input = document.createElement('input')
          input.name = json.slice(0, -1) + ',"x":"'
          input.value = '"}'
          f.append(input)
          document.body.append(f)
          frame.addEventListener('load', () => resolve(), { once: true })
          setTimeout(resolve, 3000)
          f.submit()
        })
      await form(approvalOrigin + path, 'to-approval')
      await form(path, 'to-home')
      out['form to approval origin'] = 'submitted'
      out['form to own origin'] = 'submitted'
      return out
    },
    { approvalOrigin, id, act, body },
  )
  await page.close()
  await context.unroute(probe)
  return tries
}

/** A person's choice on the approval page: press the button and hold it (A3), with a real mouse. */
/** A person's hand on the approval page: the pointer moves across it (A3), the buttons arm. */
async function moveOver(page: Page, selector: string) {
  const box = (await page.locator(selector).boundingBox())!
  await page.mouse.move(box.x + box.width / 2 - 40, box.y + box.height / 2 + 30)
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 4 })
}
async function hold(page: Page, selector: string, ms = 1000) {
  await page.locator(selector).waitFor({ timeout: 10_000 })
  await moveOver(page, selector)
  const button = page.locator(`${selector}[aria-disabled="false"]`)
  await button.waitFor({ timeout: 10_000 })
  const box = (await button.boundingBox())!
  await page.mouse.down()
  await sleep(ms)
  await page.mouse.up()
}

let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined
const t0 = Date.now()
try {
  village = await startVillage()
  measured.startMs = Date.now() - t0
  const headers = (await fetch(`${approvalOrigin}/`)).headers
  check('the approval page is served on its own port with a strict policy and no framing', /frame-ancestors 'none'/.test(headers.get('content-security-policy') ?? '') && /script-src 'self'/.test(headers.get('content-security-policy') ?? '') && headers.get('x-frame-options') === 'DENY', headers.get('content-security-policy'))

  // ── Pair, the way a person does ─────────────────────────────────────────
  const linked = await promisify(execFile)(process.execPath, ['src/village.ts', 'link', 'alex', '--add', '--root', root, '--port', String(port)], { env: { ...process.env, ...env } })
  const link = /(http:\/\/\S+#pair=[0-9a-f]+)/.exec(linked.stdout)?.[1]
  check('`link alex --add` makes a one-time link for one more device', link && /one more of alex's devices/.test(linked.stdout))
  browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu', '--use-angle=metal', '--ignore-gpu-blocklist'] })
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  const page = await context.newPage()
  let loads = 0
  page.on('load', () => loads++)
  await page.goto(link!)
  await page.evaluate(() => (window as any).village.ready(60_000))
  await page.evaluate(() => Object.assign(window, { dailyMarker: 'still here' }))
  await sleep(800)
  check('the home is paired: the session is an HttpOnly cookie on the API path', (await context.cookies(`${home}villager/api/`)).some((c) => c.name.startsWith('village_') && c.httpOnly))

  // ── Ask the Elder from the notepad ──────────────────────────────────────
  const asked = Date.now()
  await page.keyboard.type('Elder, put a small brass bell on the table')
  await page.keyboard.press('Enter')
  const running = await until(() => card(page), (s) => s?.status === 'running', 30_000)
  check('the notepad line starts a run and the card shows it', running?.status === 'running', running?.status === 'running' ? undefined : await page.evaluate(() => ({ quips: (window as any).village.talk.state().input?.quips?.slice(-2), card: (window as any).village.talk.state().elder, focus: document.activeElement?.tagName })))
  if (running?.status !== 'running') throw new Error('no run started')
  const passed = await until(() => card(page), (s) => s?.status && s.status !== 'running', 15 * 60_000, 1000)
  measured.runMs = Date.now() - asked
  check('the card follows the run to passed', passed?.status === 'passed', { status: passed?.status, reason: passed?.reason, detail: passed?.status === 'passed' ? undefined : (await hostRun(context, passed?.id) as any)?.detail })
  if (passed?.status !== 'passed') throw new Error('the run did not pass')
  const id = passed.id as string
  const pluginsBefore = await active(page)
  const finished = (await hostRun(context, id)) as Record<string, unknown> | undefined
  measured.run = { totalMs: finished?.totalMs, costUsd: finished?.costUsd, model: finished?.model }
  check("the card offers the approval page, on the approval origin, and no Keep of its own", passed.approval === `${approvalOrigin}/#run=${id}` && !passed.buttons.some((b: string) => /keep/i.test(b)), { approval: passed.approval, buttons: passed.buttons })

  if (!real) {
  // ── Nothing on the live home's origin approves ──────────────────────────
  // Nothing a home page sends grows the run record (D).
  const recordLines = async () => (await readFile(join(root, 'elder', 'runs.jsonl'), 'utf8')).split('\n').length
  const recordBefore = await recordLines()
  const fromPage = await page.evaluate(async (id) => {
    const r = await fetch(`/villager/api/people/alex/elder/runs/${id}/keep`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ candidate: id }) })
    return { status: r.status, body: await r.text() }
  }, id)
  check('Keep from the home page itself (same origin, with the cookie) is not routed there (404)', fromPage.status === 404, fromPage)
  const keepTries = await attackFromHome(context, id, 'keep', { candidate: id })
  measured.keepTries = keepTries
  check('a script on the live origin with the cookie: fetch and form to both origins promote nothing', (await promotions()) === 0 && (await hostRun(context, id))?.status === 'passed', keepTries)
  const bare = await browser.newContext()
  const bareTries = await attackFromHome(bare, id, 'keep', { candidate: id })
  check('the same without the cookie promotes nothing', (await promotions()) === 0 && (await hostRun(context, id))?.status === 'passed', bareTries)
  check('none of those tries from the home grew the run record', (await recordLines()) === recordBefore, { before: recordBefore, after: await recordLines() })
  await bare.close()

  // The approval page in a frame on the live origin: refused by the browser.
  const framer = await context.newPage()
  await context.route(`${home}__frame`, (r) => r.fulfill({ status: 200, contentType: 'text/html', body: `<!doctype html><iframe src="${approvalOrigin}/#run=${id}"></iframe>` }))
  await framer.goto(`${home}__frame`)
  await sleep(2000)
  const framed = await Promise.all(framer.frames().filter((f) => f !== framer.mainFrame()).map(async (f) => ({ url: f.url(), page: await f.evaluate(() => Boolean(document.querySelector('main.sheet'))).catch(() => false) })))
  check('the approval page cannot be framed', framed.length === 1 && !framed[0].page, framed)
  await framer.close()

  // A popup window (sized and placed by its opener) never arms. Chrome driven by Playwright reports the location bar
  // visible even in a window.open popup, so the popup's hidden location bar is simulated here, before the page loads.
  const popup = await context.newPage()
  await popup.addInitScript(() => Object.defineProperty(window, 'locationbar', { value: { visible: false } }))
  await popup.goto(`${approvalOrigin}/#run=${id}`)
  await popup.locator('[data-act="keep"]').waitFor({ timeout: 10_000 })
  const pbox = (await popup.locator('[data-act="keep"]').boundingBox())!
  await popup.mouse.move(pbox.x - 40, pbox.y + 40)
  await popup.mouse.move(pbox.x + pbox.width / 2, pbox.y + pbox.height / 2, { steps: 4 })
  await popup.keyboard.press('Tab')
  await sleep(2000)
  const popupState = await popup.evaluate(() => ({ aria: document.querySelector('[data-act="keep"]')?.getAttribute('aria-disabled'), note: document.getElementById('note')?.textContent }))
  await popup.mouse.move(pbox.x + pbox.width / 2, pbox.y + pbox.height / 2)
  await popup.mouse.down()
  await sleep(1000)
  await popup.mouse.up()
  await sleep(800)
  check('the approval page in a window without a location bar (a popup) never arms, says to open it in a tab, and keeps nothing', popupState.aria === 'true' && /tab of its own/.test(popupState.note ?? '') && (await promotions()) === 0 && (await hostRun(context, id))?.status === 'passed', popupState)
  await popup.close()

  // Extra parameters, a script's click, and a click before the buttons are armed.
  const odd = await context.newPage()
  await odd.goto(`${approvalOrigin}/?keep=1&approve=1&action=keep&candidate=${id}#run=${id}&keep=1&action=keep&approve=true&candidate=${id}`)
  await odd.waitForSelector('[data-act="keep"]')
  await moveOver(odd, '[data-act="keep"]')
  await sleep(3000)
  const scripted = await odd.evaluate(() => {
    const b = document.querySelector<HTMLButtonElement>('[data-act="keep"]')!
    const enabled = b.getAttribute('aria-disabled') === 'false'
    b.click()
    b.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    return enabled
  })
  await sleep(1500)
  check('an approval address with extra parameters approves nothing', (await promotions()) === 0 && (await hostRun(context, id))?.status === 'passed')
  check("a script's click on an armed Keep does nothing (not a real press)", scripted && (await promotions()) === 0 && (await hostRun(context, id))?.status === 'passed')
  await odd.close()
  const early = await context.newPage()
  await early.goto(`${approvalOrigin}/#run=${id}`)
  await early.locator('[data-act="keep"]').click({ force: true, timeout: 5000 })
  const earlyDisabled = (await early.locator('[data-act="keep"]').getAttribute('aria-disabled')) === 'true'
  await sleep(1500)
  check('a real click before the buttons are armed does nothing', earlyDisabled && (await promotions()) === 0 && (await hostRun(context, id))?.status === 'passed', { earlyDisabled })
  await early.close()
  }

  // ── Keep, on the approval page, opened from the card ────────────────────
  await page.bringToFront()
  const added = (list: string[]) => list.filter((p) => !pluginsBefore.includes(p))
  check('the change is not in the home yet', !added(await active(page)).length)
  const [approval] = await Promise.all([context.waitForEvent('page'), page.locator('.elder-card a[data-key="decide"]').click()])
  await approval.waitForLoadState()
  await approval.bringToFront()
  const opened = Date.now()
  // The pointer rests where the page opened under it (A3): the timer runs out, but with no move since, a hold keeps nothing.
  await approval.locator('[data-act="keep"]').waitFor({ timeout: 10_000 })
  const still = (await approval.locator('[data-act="keep"]').boundingBox())!
  await approval.mouse.move(still.x + still.width / 2, still.y + still.height / 2)
  await sleep(1500)
  const stillDisabled = (await approval.locator('[data-act="keep"]').getAttribute('aria-disabled')) === 'true'
  await approval.mouse.down()
  await sleep(1000)
  await approval.mouse.up()
  await sleep(1000)
  check('a hold on Keep under a pointer that has not moved since the page opened does nothing', stillDisabled && (await promotions()) === 0 && (await hostRun(context, id))?.status === 'passed')
  await moveOver(approval, '[data-act="keep"]')
  const keep = approval.locator('[data-act="keep"][aria-disabled="false"]')
  await keep.waitFor({ timeout: 10_000 })
  measured.armMs = Date.now() - opened
  const shows = await approval.evaluate(() => ({ who: document.getElementById('who')?.textContent, request: document.getElementById('request')?.textContent, pictures: Array.from(document.querySelectorAll<HTMLImageElement>('.pictures img'), (i) => i.naturalWidth), stages: document.querySelectorAll('.stage.pass').length }))
  check("the approval page shows the words, both pictures and the gates, and says only whose home asked", /^Asked from Alex's home\. If you didn't ask for this, choose Not this\.$/.test(shows.who ?? '') && /brass bell/.test(shows.request ?? '') && shows.pictures.length === 2 && shows.pictures.every((w) => w > 0) && shows.stages >= 6, shows)
  // A burst of clicks on an armed Keep (a plugin opening this page under the cursor) chooses nothing.
  const box = (await keep.boundingBox())!
  for (let i = 0; i < 10; i++) await approval.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { delay: 20 })
  await sleep(1500)
  check('ten quick clicks on an armed Keep leave the home unchanged', (await promotions()) === 0 && (await hostRun(context, id))?.status === 'passed')
  // Pressed, then a change of mind: dragged 300 px off Keep and released there. Nothing is kept.
  await approval.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await approval.mouse.down()
  await approval.mouse.move(box.x + box.width / 2, box.y + box.height / 2 + 300, { steps: 10 })
  await sleep(1000)
  await approval.mouse.up()
  await sleep(1000)
  check('a hold dragged 300 px off Keep and released there keeps nothing', (await promotions()) === 0 && (await hostRun(context, id))?.status === 'passed')
  // Touch (a phone, no hover: the timer alone arms). Real touch events through the browser's input: a finger that
  // slides off Keep keeps nothing; a steady one keeps.
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })
  await phone.addCookies(await context.cookies())
  const thumb = await phone.newPage()
  await thumb.goto(`${approvalOrigin}/#run=${id}`)
  const cdp = await phone.newCDPSession(thumb)
  const touch = (type: 'touchStart' | 'touchMove' | 'touchEnd', x = 0, y = 0) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] })
  await thumb.locator('[data-act="keep"][aria-disabled="false"]').waitFor({ timeout: 10_000 })
  await thumb.locator('[data-act="keep"]').scrollIntoViewIfNeeded()
  const tbox = (await thumb.locator('[data-act="keep"]').boundingBox())!
  const [tx, ty] = [tbox.x + tbox.width / 2, tbox.y + tbox.height / 2]
  await touch('touchStart', tx, ty)
  for (let i = 1; i <= 10; i++) await touch('touchMove', tx, ty + 30 * i)
  await sleep(1000)
  await touch('touchEnd')
  await sleep(1000)
  check('a touch that slides 300 px off Keep keeps nothing', (await promotions()) === 0 && (await hostRun(context, id))?.status === 'passed')
  await thumb.locator('[data-act="keep"]').scrollIntoViewIfNeeded()
  const again = (await thumb.locator('[data-act="keep"]').boundingBox())!
  const keptAt = Date.now()
  await touch('touchStart', again.x + again.width / 2, again.y + again.height / 2)
  await sleep(1000)
  await touch('touchEnd')
  await until(() => thumb.locator('#status').textContent(), (t) => /^Kept/.test(t ?? ''), 30_000)
  check('a steady touch on Keep keeps', (await promotions()) === 1)
  await phone.close()
  await page.bringToFront()
  const kept = await until(() => card(page), (s) => s?.status === 'kept', 30_000)
  measured.keepToCardMs = Date.now() - keptAt
  check('Keep on the approval page promotes it, and the card follows', kept?.status === 'kept' && (await promotions()) === 1, { status: kept?.status })
  const shown = await until(() => active(page), (a) => added(a).length > 0, 30_000)
  measured.keepToVisibleMs = Date.now() - keptAt
  measured.plugin = added(shown)
  check('the change appears in the same open home page without a reload', (real || shown.includes('stubbell')) && added(shown).length > 0 && loads === 1 && (await page.evaluate(() => (window as any).dailyMarker)) === 'still here', { loads, ms: measured.keepToVisibleMs })
  await approval.close()

  // Undo is the approval page's too.
  const run = await hostRun(context, id)
  if (!real) {
  const undoTries = await attackFromHome(context, id, 'undo', { promotion: run?.promotion ?? '' })
  check('Undo from the live origin with the cookie, by fetch and by form, changes nothing', (await promotions()) === 1 && (await hostRun(context, id))?.status === 'kept', undoTries)
  }
  const [undoPage] = await Promise.all([context.waitForEvent('page'), page.locator('.elder-card a[data-key="undo"]').click()])
  await undoPage.bringToFront()
  const undoAt = Date.now()
  await hold(undoPage, '[data-act="undo"]')
  await until(() => undoPage.locator('#status').textContent(), (t) => /^Undone/.test(t ?? ''), 30_000)
  await page.bringToFront()
  const undone = await until(() => card(page), (s) => s?.status === 'undone', 30_000)
  const gone = await until(() => active(page), (a) => !added(a).length, 30_000)
  measured.undoToGoneMs = Date.now() - undoAt
  check('Undo on the approval page takes it out of the same open page, without a reload', undone?.status === 'undone' && !added(gone).length && (await promotions()) === 2 && loads === 1)
  await undoPage.close()

  // ── A reminder survives a restart and reaches the fridge ────────────────
  const secret = (await context.cookies(`${home}villager/api/`)).find((c) => c.name.startsWith('village_'))?.value
  const sentAt = Date.now()
  const said = await fetch(`${home}villager/api/people/alex/messages`, { method: 'POST', headers: { 'content-type': 'application/json', cookie: `village_session=${secret}` }, body: JSON.stringify({ text: real ? 'remind me in a minute to water the plants' : 'remind me in a minute to water the plants [stub-remind:water the plants|in=1]', zone: 'Europe/Kyiv' }) })
  const reply = await said.text()
  measured.reminderTurnMs = Date.now() - sentAt
  const words = reply.split('\n').filter((l) => l.startsWith('data: ')).map((l) => { try { return JSON.parse(l.slice(6)) } catch { return null } })
  if (real) measured.reminderReply = String(words.find((w) => typeof w?.reply === 'string')?.reply ?? '').slice(0, 200)
  check('a reminder is set through the villager', said.status === 200 && /water/.test(reply) && existsSync(join(root, 'people', 'alex', 'reminders.json')) && /water the plants|plants/.test(await readFile(join(root, 'people', 'alex', 'reminders.json'), 'utf8')))
  const setAt = Date.now()
  await stop(village)
  village = await startVillage()
  check('the host restarted', true, { restartMs: Date.now() - setAt })
  await page.reload()
  await page.evaluate(() => (window as any).village.ready(60_000))
  const onFridge = await until(() => page.evaluate(() => (window as any).village.kernel.root.get('stage').scene.getObjectByName('reminder notes')?.children.length ?? 0), (n) => n > 0, 150_000, 1000)
  measured.reminderSetToFridgeMs = Date.now() - setAt
  check('after the restart the reminder is on the fridge once it is due, with the same paired session', onFridge > 0, { ms: measured.reminderSetToFridgeMs })

  // ── Sam's own device (A4): the page's person is whoever the device is paired as ──
  const samLinked = await promisify(execFile)(process.execPath, ['src/village.ts', 'link', 'sam', '--add', '--root', root, '--port', String(port)], { env: { ...process.env, ...env } })
  const samLink = /(http:\/\/\S+#pair=[0-9a-f]+)/.exec(samLinked.stdout)?.[1]
  const tablet = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  const sams = await tablet.newPage()
  const asked_: string[] = []
  sams.on('response', (r) => r.url().includes('/villager/api/people/') && asked_.push(`${r.status()} ${new URL(r.url()).pathname.replace('/villager/api', '')}`))
  await sams.goto(samLink!)
  // Paired as someone other than the page started as, the page loads once more as Sam.
  await until(() => sams.evaluate(() => JSON.parse(localStorage.getItem('village.villager.paired') ?? 'null')?.person).catch(() => null), (p) => p === 'sam', 30_000)
  await sleep(1000)
  await sams.waitForLoadState('load')
  await until(() => sams.evaluate(() => (window as any).village.ready(60_000).then(() => true)).catch(() => false), (ok) => ok, 90_000, 1000)
  await sleep(1500)
  await sams.keyboard.type('hello from my own tablet')
  await sams.keyboard.press('Enter')
  const samSaid = await until(async () => (await readFile(join(root, 'people', 'sam', 'conversation.jsonl'), 'utf8').catch(() => '')), (t) => t.includes('hello from my own tablet'), 30_000)
  const samReminders = await until(async () => asked_.filter((a) => /^200 \/people\/sam\/reminders/.test(a)), (a) => a.length > 0, 40_000)
  check("a device paired as Sam writes to Sam's villager and reads Sam's reminders, and nothing it asks is refused", samSaid.includes('hello from my own tablet') && samReminders.length > 0 && !asked_.some((a) => /^40[13] /.test(a)) && !asked_.some((a) => a.includes('/people/alex/')), asked_.slice(0, 12))
  await tablet.close()
} catch (error) {
  check('the proof ran to the end', false, String((error as Error).stack ?? error).replace(/pair=\w+/g, 'pair=…'))
} finally {
  await browser?.close()
  await stop(village)
  measured.totalMs = Date.now() - t0
  const failed = steps.filter((s) => !s.ok)
  console.log(`${steps.length - failed.length} of ${steps.length} steps; ${JSON.stringify(measured).slice(0, 1500)}`)
  if (!values['keep-root']) await rm(scratch, { recursive: true, force: true })
  process.exit(failed.length ? 1 : 0)
}
