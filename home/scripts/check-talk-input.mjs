// Headless proof of the always-on input (?talk=npc&input=held|speech, #42).
// Starts its own villager host (stub router, stub prop maker, stub villagers) and
// dev server on a throwaway VILLAGE_ROOT, and stops both at the end.
// Usage: node scripts/check-talk-input.mjs [--dev=5297] [--host=5298]
//   --agent=claude --variant=held|speech [--video=file.webm] [--shots=dir]: the real
//     session instead (idle, talk to Moss, a round oak table, a pinball project, the
//     journal), printing the route and furnishing timings.
//   --agent=claude --furnish: five furnishing requests, timed from Enter to ghost and to the final prop.
//   --only=fixes: only the checks for the #42 review's fixes (also run at the end of the full check).
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const args = process.argv.slice(2)
const opt = (name) => args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3)
const agent = opt('agent') ?? 'stub'
const homeDir = join(dirname(fileURLToPath(import.meta.url)), '..')
const hostDir = join(homeDir, '..', 'host')
const root = await mkdtemp(join(tmpdir(), 'villager-input-'))
// #40: the page takes its person's token from the link the host prints (#token=…), never from the dev server.
const tokenNow = async () => JSON.parse(await readFile(join(root, 'villager', 'launch.json'), 'utf8')).tokens.alex
const link = async (url) => `${url}#token=${await tokenNow()}`
const hostPort = Number(opt('host') ?? 5298)
const devPort = Number(opt('dev') ?? 5297)
const base = `http://localhost:${devPort}/`
const checks = []
const check = (name, pass, detail) => {
  checks.push({ name, pass: Boolean(pass), detail })
  if (process.env.LIVE) console.error(pass ? "pass" : "FAIL", name, pass ? "" : JSON.stringify(detail)?.slice(0, 600))
}
const children = new Set()

function run(cmd, argv, cwd, env, ready) {
  const child = spawn(cmd, argv, { cwd, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'], detached: true })
  children.add(child)
  child.on('exit', () => children.delete(child))
  return new Promise((resolve, reject) => {
    let out = ''
    const timer = setTimeout(() => reject(new Error(`${cmd} did not start: ${out.slice(-400)}`)), 30_000)
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
const stop = (child) => new Promise((resolve) => {
  if (!children.has(child)) return resolve()
  child.once('exit', resolve)
  process.kill(-child.pid, 'SIGTERM')
})
// The page is Alex's (its link's token). Talking with another villager is Alex's visit (#42), kept under Alex.
const folderOf = (person) => person === 'alex' ? join(root, 'people', 'alex') : join(root, 'people', 'alex', 'visits', person)
const jsonl = (person, file) => readFile(join(folderOf(person), file), 'utf8').then((s) => s.trim().split('\n').map((l) => JSON.parse(l)), () => [])

await run('node', ['src/villager-cli.ts', '--agent', agent, '--port', String(hostPort), '--root', root], hostDir, { VILLAGER_PEOPLE: 'alex:Alex,sam:Sam,mia:Mia' }, /listening on/)
await run('npx', ['vite', '--port', String(devPort), '--strictPort'], homeDir, { VILLAGE_ROOT: root, VILLAGER_PORT: String(hostPort) }, /Local:/)
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu', '--use-angle=metal'] })

const state = (page) => page.evaluate(() => window.village.talk.state())
async function until(page, test, ms = 20_000, every = 50) {
  const end = Date.now() + ms
  let s
  do {
    s = await state(page)
    if (test(s)) return s
    await page.waitForTimeout(every)
  } while (Date.now() < end)
  return s
}
async function open(page, query) {
  await page.goto(await link(base + query))
  await page.evaluate(() => window.village.ready())
  await page.waitForTimeout(800)
}
async function write(page, text, delay = 0) {
  await page.keyboard.type(text, { delay })
  await page.keyboard.press('Enter')
}
const back = async (page) => {
  for (let i = 0; i < 2; i++) {
    await page.keyboard.press('Escape')
    await page.waitForTimeout(150)
  }
  await until(page, (s) => s.mode === 'room', 5000)
}

/** The #42 review's fixes (round 1): each of these failed before its fix. A fresh page for each, so one cannot spoil the next. */
async function fixes() {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  // Every maker request is counted; the next one can be held back, and any can be made to fail.
  const props = { calls: 0, hold: 0, fail: false }
  await page.route('**/props', async (r) => {
    props.calls++
    if (props.fail) return r.fulfill({ status: 500, body: '{}' })
    if (props.hold) {
      const ms = props.hold
      props.hold = 0
      await new Promise((x) => setTimeout(x, ms))
    }
    return r.continue()
  })
  // A new document each time: the same link again would only be a hash change.
  const fresh = async (query = '?talk=npc&q=low') => {
    await page.goto('about:blank')
    await open(page, query)
  }
  const quipped = (re, ms = 10_000) => until(page, (x) => x.input.quips.some((q) => re.test(q.text)), ms)
  let s

  // fix 5: a second furnishing line while the first is being made waits its turn; each piece gets its own Undo.
  await fresh()
  props.hold = 4000
  await write(page, 'add a lamp by the window')
  await until(page, (x) => x.input.furnish.job?.ghosts > 0, 5000)
  await page.waitForTimeout(1500)
  await write(page, 'put a toy cow on the table')
  await page.waitForTimeout(2000)
  const callsWhileMaking = props.calls
  s = await until(page, (x) => x.input.furnish.job?.state === 'placed', 15_000)
  const first = s.input.furnish.job?.places?.[0]?.anchor
  await page.evaluate(() => window.village.talk.undo())
  s = await until(page, (x) => x.input.furnish.job?.state === 'placed', 15_000)
  const second = s.input.furnish.job?.places?.[0]?.anchor
  await page.evaluate(() => window.village.talk.undo())
  const waited = (await quipped(/One at a time/)).input.quips.some((q) => /One at a time/.test(q.text))
  await page.waitForTimeout(800)
  s = await state(page)
  check('#42 fix 5: a second furnishing line waits while the first is made, and Undo on each leaves nothing behind', callsWhileMaking === 1 && first === 'window' && second === 'table' && waited && s.input.furnish.placed === 0 && s.input.furnish.ghostsInRoom === 0 && s.input.furnish.job === null, { callsWhileMaking, first, second, waited, placed: s.input.furnish.placed, ghosts: s.input.furnish.ghostsInRoom, scales: s.input.furnish.scales })

  // fix 13 (the critic's): Keep in the first frames of the settle-in.
  await fresh()
  await write(page, 'add a plant in the corner')
  await page.evaluate(() => new Promise((done) => {
    const tick = () => {
      if (window.village.talk.state().input.furnish.job?.state === 'placed') {
        window.village.talk.keep()
        done()
      } else requestAnimationFrame(tick)
    }
    tick()
  }))
  await page.waitForTimeout(1200)
  s = await state(page)
  check('#42 fix 13: Keep during the settle-in leaves the piece full size and no ghost', s.input.furnish.placed === 1 && s.input.furnish.scales.every((k) => k === 1) && s.input.furnish.ghostsInRoom === 0 && s.input.furnish.job === null, { scales: s.input.furnish.scales, ghosts: s.input.furnish.ghostsInRoom, job: s.input.furnish.job })

  // fix 7: Keep waits for the host; a refused keep leaves the piece undecided and says so.
  await fresh()
  await write(page, 'add a lamp by the window')
  s = await until(page, (x) => x.input.furnish.job?.state === 'placed')
  const item = s.input.furnish.job?.item
  const keptOnHost = () => readFile(join(root, 'people', 'alex', 'library', `${item}.json`), 'utf8').then((f) => JSON.parse(f).kept === true, () => false)
  await page.waitForTimeout(600)
  await page.route('**/keep', (r) => r.fulfill({ status: 500, body: '{}' }))
  await page.evaluate(() => window.village.talk.keep())
  await page.waitForTimeout(300)
  const refused = await state(page)
  const toldRefused = (await quipped(/couldn't put that in your things/)).input.quips.some((q) => /couldn't put that in your things/.test(q.text))
  const keptAfterRefusal = await keptOnHost()
  await page.unroute('**/keep')
  await page.evaluate(() => window.village.talk.keep())
  await page.waitForTimeout(300)
  s = await state(page)
  check('#42 fix 7: a Keep the host refuses leaves the piece undecided and says so; Keep again keeps it', refused.input.furnish.job?.state === 'placed' && refused.input.furnish.choice && toldRefused && !keptAfterRefusal && s.input.furnish.job === null && (await keptOnHost()), { refused: refused.input.furnish.job, toldRefused, keptAfterRefusal, after: s.input.furnish.job })

  // fix 8: Try another keeps the piece until the new one is ready, and keeps it when the new one fails.
  // (Things never kept elsewhere in this check, so the router makes them rather than taking them from the library.)
  await fresh()
  await write(page, 'add a footstool by the window')
  s = await until(page, (x) => x.input.furnish.job?.state === 'placed')
  await page.waitForTimeout(600)
  props.fail = true
  await page.evaluate(() => window.village.talk.again())
  props.fail = false
  const afterRetry = await state(page)
  const toldKept = (await quipped(/the one you had is still here/)).input.quips.some((q) => /the one you had is still here/.test(q.text))
  check('#42 fix 8: a Try another that fails leaves the piece you had, and says so truthfully', afterRetry.input.furnish.placed === 1 && afterRetry.input.furnish.job?.state === 'placed' && afterRetry.input.furnish.choice && toldKept, { placed: afterRetry.input.furnish.placed, job: afterRetry.input.furnish.job, quips: afterRetry.input.quips.map((q) => q.text) })
  await page.evaluate(() => window.village.talk.undo())

  // fix 6: every place around the table taken: no maker call, no Keep, and the villager says there is no room.
  await fresh()
  for (let i = 0; i < 2; i++) {
    await write(page, 'add a couple of chairs around the table')
    await until(page, (x) => x.input.furnish.job?.state === 'placed')
    await page.evaluate(() => window.village.talk.keep())
    await until(page, (x) => x.input.furnish.job === null, 5000)
  }
  const callsBefore = props.calls
  // Stools are in no library here, so before the fix this went to the maker.
  await write(page, 'add a couple of stools around the table')
  s = await until(page, (x) => !x.input.routing && x.input.furnish.job === null && x.input.quips.some((q) => /no room left around the table/.test(q.text)), 10_000)
  check('#42 fix 6: with no place left around the table nothing is made or offered, and your villager says there is no room', props.calls === callsBefore && s.input.furnish.job === null && !s.input.furnish.choice && s.input.furnish.placed === 4 && s.input.quips.some((q) => /no room left around the table/.test(q.text)), { calls: props.calls - callsBefore, job: s.input.furnish.job, choice: s.input.furnish.choice, placed: s.input.furnish.placed, quips: s.input.quips.map((q) => q.text) })

  // fix 9: many projects stand inside the room, in bounded slots, with a Tab entry for each one shown.
  await page.evaluate(async () => {
    const token = sessionStorage.getItem('village.villager.token')
    for (let i = 0; i < 9; i++) {
      await fetch('/villager/api/people/alex/projects', { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify({ what: `a pinball machine ${i}`, where: i % 2 ? 'living room' : 'here', text: 'seeded by the check' }) })
    }
  })
  await fresh()
  s = await until(page, (x) => x.input.furnish.parcelBoxes.length > 0, 5000)
  await page.waitForTimeout(500)
  s = await state(page)
  const inside = (b) => ((b.x0 >= -3.31 && b.x1 <= 3.4) || (b.x0 >= 3.58 && b.x1 <= 8.38)) && b.z0 >= -2.2 && b.z1 <= 3.8
  const boxes = s.input.furnish.parcelBoxes
  check('#42 fix 9: parcels stand inside their room, in bounded slots, with one Tab entry for each one shown', boxes.length >= 2 && boxes.every(inside) && s.input.furnish.parcelEntries === boxes.length, { shown: boxes.length, entries: s.input.furnish.parcelEntries, outside: boxes.filter((b) => !inside(b)) })

  // fix 4: a piece still being made when the room closes starts no sandbox afterwards.
  await fresh()
  props.hold = 3000
  await write(page, 'add a hatstand by the window')
  await until(page, (x) => x.input.furnish.job?.ghosts > 0, 5000)
  await page.waitForTimeout(500)
  const framesBefore = await page.evaluate(() => document.querySelectorAll('iframe').length)
  await page.evaluate(() => window.village.unload('talk'))
  await page.waitForTimeout(4500)
  const framesAfter = await page.evaluate(() => document.querySelectorAll('iframe').length)
  check('#42 fix 4: furnishing in flight when the room closes leaves no sandbox frame behind', framesAfter <= framesBefore, { framesBefore, framesAfter })

  // fix 11: a click on another villager while your line is being routed does not move the reply.
  await fresh('?talk=npc&route=reply&q=low')
  await page.route('**/messages', async (r) => {
    await new Promise((x) => setTimeout(x, 2500))
    return r.continue()
  })
  const samBefore = (await jsonl('sam', 'conversation.jsonl')).length
  await write(page, 'How are you today?')
  await page.waitForTimeout(600)
  const sam = await page.evaluate(() => window.village.talk.screen('sam', 0.5))
  await page.mouse.click(sam.x, sam.y)
  s = await until(page, (x) => x.cards.alex?.finished && /I hear you, Alex/.test(x.cards.alex.text) && !x.pending, 15_000)
  await page.unroute('**/messages')
  check('#42 fix 11: a click on Tuft while your line is routed leaves the reply with your own villager', /I hear you, Alex/.test(s.cards.alex?.text ?? '') && !/I hear you/.test(s.cards.sam?.text ?? '') && (await jsonl('sam', 'conversation.jsonl')).length === samBefore, { partner: s.partner, alex: s.cards.alex?.text, sam: s.cards.sam?.text })

  // fix 12: a reply cut short (the stream ends with no "done") is not put back on the pad or kept to resend.
  await fresh()
  await write(page, 'I want to chat with Tuft')
  await until(page, (x) => x.mode === 'talk' && x.partner === 'sam' && !x.pending, 15_000)
  await page.waitForTimeout(600)
  await page.route('**/messages', async (r) => {
    const response = await r.fetch()
    const body = (await response.text()).split('\n\n').filter((block) => !/^event: done$/m.test(block)).join('\n\n')
    return r.fulfill({ response, body })
  })
  const samLinesBefore = (await jsonl('sam', 'conversation.jsonl')).length
  await write(page, 'Tell me about bread')
  s = await until(page, (x) => !x.pending && /cut short/.test(x.cards.sam?.text ?? ''), 15_000)
  await page.unroute('**/messages')
  const kept = await page.evaluate(() => JSON.parse(localStorage.getItem('village.talk.kept') ?? '[]'))
  const said = (await jsonl('sam', 'conversation.jsonl')).slice(samLinesBefore).filter((l) => l.from === 'person')
  check('#42 fix 12: a reply cut short says so; the line is not put back or kept to resend, and the host has it once', /cut short/.test(s.cards.sam?.text ?? '') && s.input.text === '' && !kept.some((k) => k.text === 'Tell me about bread') && said.length === 1, { card: s.cards.sam?.text, text: s.input.text, kept, said })

  check('#42 fixes: no page errors', errors.length === 0, errors)
  await context.close()
}

try {
  if (agent === 'claude') {
    const variant = opt('variant') ?? 'held'
    const video = opt('video')
    const shots = opt('shots')
    if (shots) await mkdir(shots, { recursive: true })
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, ...(video ? { recordVideo: { dir: dirname(video), size: { width: 1280, height: 800 } } } : {}) })
    const page = await context.newPage()
    const errors = []
    page.on('pageerror', (e) => errors.push(String(e)))
    const shot = (name) => shots && page.screenshot({ path: join(shots, `input-${variant}-${name}.jpg`), quality: 88 })
    await open(page, `?talk=npc&input=${variant}&q=high`)
    if (args.includes('--furnish')) {
      const requests = ['add a round oak table for four', 'add a couple of chairs around the table', 'replace the table with a round oak one', 'put a tall reading lamp by the window', 'a green velvet armchair in the corner']
      for (const text of requests) {
        await write(page, text, 0)
        const s = await until(page, (x) => x.input.furnish.timings.length > 0 && x.input.furnish.timings.at(-1).text === text || (!x.input.routing && !x.input.furnish.job && x.input.routes.at(-1)?.text === text && x.input.routes.at(-1)?.route !== 'furnish'), 150_000, 100)
        console.error(text, JSON.stringify(s.input.routes.at(-1)), JSON.stringify(s.input.furnish.timings.at(-1)))
        await page.waitForTimeout(800)
        await page.evaluate(() => window.village.talk.undo())
        await page.waitForTimeout(300)
      }
      const s = await state(page)
      console.log(JSON.stringify({ routes: s.input.routes, timings: s.input.furnish.timings, errors }, null, 1))
    } else {
      await page.waitForTimeout(4000)
      await shot('idle')
      await page.keyboard.type('I want to chat with Moss', { delay: 70 })
      await shot('typing')
      await page.keyboard.press('Enter')
      await page.waitForTimeout(450)
      await shot('sent')
      await until(page, (s) => s.mode === 'talk' && s.partner === 'mia', 30_000)
      await page.waitForTimeout(2500)
      await shot('talk')
      await page.keyboard.type('How is the basil doing?', { delay: 60 })
      await page.keyboard.press('Enter')
      await until(page, (s) => s.cards.mia?.finished && s.cards.mia.text.length > 40, 60_000, 200)
      await page.waitForTimeout(2500)
      await shot('talk-reply')
      await back(page)
      await page.waitForTimeout(1500)
      await page.keyboard.type('add a round oak table for four', { delay: 60 })
      await page.keyboard.press('Enter')
      await until(page, (s) => s.input.furnish.job?.ghosts > 0, 15_000)
      await page.waitForTimeout(1200)
      await shot('ghost')
      const placed = await until(page, (s) => s.input.furnish.job?.state === 'placed' || (s.input.furnish.job === null && !s.input.routing && s.input.routes.length >= 2), 150_000, 200)
      await page.waitForTimeout(1200)
      await shot('final')
      await page.waitForTimeout(1500)
      if (placed.input.furnish.job?.state === 'placed') await page.click('.furnish-choice [data-choice="keep"]')
      await page.waitForTimeout(1500)
      await page.keyboard.type("let's add a playable pinball machine in the living room", { delay: 55 })
      await page.keyboard.press('Enter')
      await until(page, (s) => s.input.furnish.parcels.length > 0 || (!s.input.routing && s.input.routes.length >= 3), 60_000, 200)
      await page.waitForTimeout(2500)
      await shot('project')
      await page.waitForTimeout(1000)
      await page.keyboard.press('j')
      await page.waitForTimeout(2600)
      await shot('journal')
      await page.waitForTimeout(1500)
      await page.keyboard.press('Escape')
      await page.waitForTimeout(2500)
      const s = await state(page)
      console.log(JSON.stringify({ routes: s.input.routes, timings: s.input.furnish.timings, parcels: s.input.furnish.parcels, errors }, null, 1))
    }
    await page.close()
    await context.close()
    if (video) {
      const v = await page.video()?.path()
      if (v) await (await import('node:fs/promises')).rename(v, video)
    }
  } else if (opt('only') === 'fixes') {
    await fixes()
  } else {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } })
    const page = await context.newPage()
    const errors = []
    page.on('pageerror', (e) => errors.push(String(e)))
    page.on('console', (m) => m.type() === 'error' && !/Failed to load resource/.test(m.text()) && errors.push(m.text()))

    // The slip variant has none of the input.
    await open(page, '?talk=npc&input=slip&q=low')
    const plain = await page.evaluate(() => ({ input: window.village.talk.state().input, dom: document.querySelectorAll('.talk-input-field, .talk-mine, .talk-journal, .talk-pad, .furnish-choice').length }))
    check('?input=slip has no always-on input', plain.input === null && plain.dom === 0, plain)

    // The held notepad is the default for ?talk=npc.
    await open(page, '?talk=npc&q=low')
    const baseline = await page.evaluate(() => window.village.snapshot())
    await page.waitForTimeout(600)
    let s = await state(page)
    check('held is the default: the notepad is in view, addressed to your own villager', s.input.variant === 'held' && s.input.padVisible && s.input.to === 'Dumpling' && s.mode === 'room', s.input)
    // At rest: held low on the right in perspective, showing whom it is to (#42 regroup: it was a strip at the bottom edge).
    const area = (r) => r.width * r.height
    const rest = s.input.padRect
    check('at rest the pad is held low on the right, under 9% of the screen, reaching the bottom edge', s.input.raise < 0.05 && area(rest) < 0.09 * 1280 * 800 && rest.left > 1280 * 0.55 && rest.top > 800 * 0.6 && rest.top + rest.height >= 799, { raise: s.input.raise, rest, share: area(rest) / (1280 * 800) })
    check('held: the pad and journal ride with the camera as scene objects', baseline.objects.some((o) => o.endsWith(':talk input')) && baseline.objects.some((o) => o.endsWith(':talk notepad')) && baseline.objects.some((o) => o.endsWith(':talk journal button')))

    // A keypress anywhere starts writing, and the pad rises to writing size.
    await page.mouse.click(640, 300)
    await page.keyboard.type('Hello')
    s = await state(page)
    check('a keypress anywhere starts writing (capital letters too)', s.input.text === 'Hello' && s.input.focused, s.input)
    const attending = (await state(page)).cast.alex.attending
    check('your villager turns to you while you write', attending, attending)
    const risen = await until(page, (x) => x.input.raise > 0.97, 2000, 30)
    check('the first keypress raises the pad smoothly to writing size', risen.input.raise > 0.97 && area(risen.input.padRect) > 1.5 * area(rest) && risen.input.padRect.top < rest.top - 60, { rest, risen: risen.input.padRect })
    await page.keyboard.press('Escape')
    s = await state(page)
    const settled = await until(page, (x) => x.input.raise < 0.03, 2000, 30)
    check('Escape clears the line and the pad settles back', s.input.text === '' && s.mode === 'room' && !settled.input.focused && settled.input.raise < 0.03, { text: s.input.text, raise: settled.input.raise })
    // A click on the resting pad raises it for writing.
    const pr = settled.input.padRect
    await page.mouse.click(pr.left + pr.width / 2, pr.top + Math.min(pr.height / 2, 10))
    const clicked = await until(page, (x) => x.input.raise > 0.97, 2000, 30)
    check('a click on the resting pad raises it and gives it the keyboard', clicked.input.focused && clicked.input.raise > 0.97, clicked.input)
    await page.keyboard.press('Escape')
    await until(page, (x) => x.input.raise < 0.03, 2000, 30)

    // J and the felt journal open the journal.
    await page.keyboard.press('Escape')
    await page.keyboard.press('j')
    await page.waitForTimeout(400)
    let active = await page.evaluate(() => document.querySelector('.talk-journal') && window.village.talk.state().input.padVisible)
    const journalOpen = () => page.evaluate(() => window.village.kernel.root.get('entries').active)
    check('J opens the journal and the input steps aside', (await journalOpen()) === 'notebook' && active === false, await journalOpen())
    await page.keyboard.press('Escape')
    await page.waitForTimeout(400)
    check('Escape closes the journal and the input comes back', (await journalOpen()) === null && (await state(page)).input.padVisible)
    const rect = (await state(page)).input.journalRect
    await page.mouse.click(rect.x + rect.width / 2, rect.y + rect.height / 2)
    await page.waitForTimeout(400)
    check('one click on the felt journal opens it', (await journalOpen()) === 'notebook', rect)
    await page.keyboard.press('Escape')
    await page.waitForTimeout(400)

    // talk: that villager turns and the camera eases to them.
    await write(page, 'I want to chat with Moss')
    s = await until(page, (x) => x.mode === 'talk' && x.partner === 'mia', 20_000, 10)
    // The camera turns to Moss only once the note has landed, so the note is seen on its way (#42 regroup).
    check('the camera waits for the sent note to land before turning to its reader', !s.input.flying || !s.focused, { flying: s.input.flying, focused: s.focused })
    s = await until(page, (x) => x.mode === 'talk' && x.partner === 'mia' && x.focused && !x.input.flying)
    check('talk route: "I want to chat with Moss" opens a talk with Moss', s.mode === 'talk' && s.partner === 'mia' && s.cards.mia && s.focused, { mode: s.mode, partner: s.partner, routes: s.input.routes })
    check('the input re-addresses to Moss', s.input.to === 'Moss', s.input.to)
    const before = (await jsonl('mia', 'conversation.jsonl')).length
    await write(page, 'How is the basil?')
    s = await until(page, (x) => x.cards.mia?.finished && /I hear you, Mia/.test(x.cards.mia.text), 15_000)
    const toMia = (await jsonl('mia', 'conversation.jsonl')).slice(before)
    check('in a talk with someone else, a line goes straight to them (not routed)', toMia[0]?.text === 'How is the basil?' && s.input.routes.length === 1, { toMia, routes: s.input.routes.length })
    await back(page)

    // answer: your own villager replies.
    await write(page, 'How are you today?')
    s = await until(page, (x) => x.cards.alex?.finished && /I hear you, Alex/.test(x.cards.alex.text), 15_000)
    check('answer route: your own villager turns to you and replies', s.mode === 'talk' && s.partner === 'alex' && s.input.routes.at(-1).route === 'answer', s.input.routes.at(-1))
    const answerUsage = (await jsonl('alex', 'usage.jsonl')).at(-1)
    check('plain chat costs one model call: no route context, no router call, and the pad settled after sending', s.input.routes.at(-1).calls === 1 && s.input.routes.at(-1).path === 'chat' && answerUsage && answerUsage.route === undefined && (await jsonl('alex', 'routes.jsonl')).every((r) => r.text !== 'How are you today?') && s.input.raise < 0.05, { route: s.input.routes.at(-1), answerUsage, raise: s.input.raise })
    await back(page)

    // A route that tries to send your words to someone you did not name is not followed (Sentinel, #42):
    // they go to your own villager, in your own words, and Sam's villager hears nothing.
    const samBefore = (await jsonl('sam', 'conversation.jsonl')).length
    const alexBefore = (await jsonl('alex', 'conversation.jsonl')).length
    await write(page, 'put my secret worry away [stub-route-redirect]')
    s = await until(page, (x) => x.cards.alex?.finished && /I hear you, Alex/.test(x.cards.alex.text) && !x.pending, 15_000)
    const samAfter = (await jsonl('sam', 'conversation.jsonl')).slice(samBefore)
    const alexAfter = (await jsonl('alex', 'conversation.jsonl')).slice(alexBefore)
    check("a model's talk route to a villager the line does not name is not followed", s.mode === 'talk' && s.partner === 'alex' && samAfter.length === 0 && alexAfter.filter((l) => l.from === 'person').every((l) => l.text === 'put my secret worry away [stub-route-redirect]') && !JSON.stringify(alexAfter).includes('paraphrase'), { mode: s.mode, partner: s.partner, samAfter, alexAfter })
    await back(page)

    // furnish: ghost at once, then the final prop in its place, then undo.
    await page.keyboard.type('add a round oak table for four')
    const t0 = Date.now()
    await page.keyboard.press('Enter')
    s = await until(page, (x) => x.input.furnish.job?.ghosts > 0, 3000, 10)
    const ghostSeen = Date.now() - t0
    check('furnish: a ghost appears at once', s.input.furnish.job?.state === 'ghost' && s.input.furnish.placed === 0 && ghostSeen < 400, { ghostSeen, job: s.input.furnish.job })
    s = await until(page, (x) => x.input.furnish.job?.state === 'placed')
    const t = s.input.furnish.timings.at(-1)
    check('furnish: the prop comes back through the sandbox and replaces the ghost', s.input.furnish.placed === 1 && s.input.furnish.job.source === 'made' && s.input.furnish.choice && t.ok && t.ghostMs < t.finalMs, t)
    await page.waitForTimeout(600)
    s = await state(page)
    check('the ghost is gone once the prop has settled', s.input.furnish.job?.ghosts === 0, s.input.furnish)
    check('your villager acknowledged it in the room', /let me see/i.test(s.cards.alex?.text ?? ''), s.cards.alex)
    const undoMiss = await page.click('.furnish-choice [data-choice="undo"]', { timeout: 3000 }).then(() => null, (e) => String(e).split('\n').slice(0, 12).join(' | '))
    s = await state(page)
    if (undoMiss) console.error('Undo click:', undoMiss.slice(0, 900))
    check('Undo takes it away again', s.input.furnish.placed === 0 && !s.input.furnish.choice && s.input.furnish.job === null, s.input.furnish)

    // Replacing the table hides it, and undo brings it back.
    await write(page, 'replace the table with a round oak one')
    s = await until(page, (x) => x.input.furnish.job?.state === 'placed')
    check('replace: the old table is hidden and the new one stands in its place', s.input.furnish.tableVisible === false && s.input.furnish.placed === 1, s.input.furnish)
    await page.evaluate(() => window.village.talk.undo())
    s = await state(page)
    check('undo restores the table', s.input.furnish.tableVisible === true && s.input.furnish.placed === 0, s.input.furnish)

    // A couple around the table, kept into the library; then placed again from it, and copied.
    await write(page, 'add a couple of green armchairs around the table')
    s = await until(page, (x) => x.input.furnish.job?.state === 'placed')
    check('"a couple ... around the table" places two, facing the table', s.input.furnish.placed === 2 && s.input.furnish.job.places.length === 2, s.input.furnish.job)
    await page.click('.furnish-choice [data-choice="keep"]', { timeout: 3000 }).catch(() => {})
    await page.waitForTimeout(300)
    const items = await Promise.all((await readdir(join(root, 'people', 'alex', 'library'))).map(async (f) => JSON.parse(await readFile(join(root, 'people', 'alex', 'library', f), 'utf8'))))
    check('Keep saves the prop to your library on the host, as module text', items.some((i) => i.kept && /armchairs/.test(i.name) && /export function build/.test(i.module)), items.map((i) => ({ name: i.name, kept: i.kept })))
    await write(page, 'put the green armchairs by the window')
    s = await until(page, (x) => x.input.furnish.job?.state === 'placed' || x.input.furnish.timings.length >= 4)
    check('a saved piece is placed again from the library, not made anew', s.input.furnish.job?.source === 'library' && s.input.furnish.placed === 3, s.input.furnish.job)
    await page.evaluate(() => window.village.talk.keep())
    const madeBefore = (await readdir(join(root, 'people', 'alex', 'library'))).length
    await write(page, 'another one like that')
    s = await until(page, (x) => x.input.furnish.job?.state === 'placed')
    check('"another one like that" copies without making anything', s.input.furnish.job?.source === 'copy' && s.input.furnish.placed === 4 && (await readdir(join(root, 'people', 'alex', 'library'))).length === madeBefore, s.input.furnish.job)
    await page.evaluate(() => window.village.talk.undo())

    // A failed generation, and one the sandbox rejects, leave nothing.
    for (const [label, text] of [['fails', 'add a lamp [stub-make-fail] by the window'], ['is rejected by the sandbox checks', 'add a lamp [stub-make-bad] by the window']]) {
      const placedBefore = (await state(page)).input.furnish.placed
      await write(page, text)
      await until(page, (x) => x.input.furnish.job?.ghosts > 0, 3000, 10)
      s = await until(page, (x) => x.input.furnish.job === null && !x.input.routing && /nothing|didn't come out/i.test(x.cards.alex?.text ?? ''), 20_000)
      check(`a generation that ${label} leaves no ghost and no prop, and says so`, s.input.furnish.placed === placedBefore && s.input.furnish.job === null && /nothing|didn't come out/i.test(s.cards.alex?.text ?? ''), { placed: s.input.furnish.placed, card: s.cards.alex?.text })
    }

    // project: a parcel where it will go, and a record on the host.
    await write(page, "let's add a playable pinball machine in the living room")
    s = await until(page, (x) => x.input.furnish.parcels.length > 0 && /project/i.test(x.cards.alex?.text ?? ''))
    const records = await jsonl('alex', 'projects.jsonl')
    check('project route: a wrapped parcel marks the place and your villager says so', s.input.furnish.parcels.length === 1 && /project/i.test(s.cards.alex?.text ?? ''), { parcels: s.input.furnish.parcels, card: s.cards.alex?.text })
    check('the project is saved by the host under the person', records.length === 1 && records[0].state === 'being made' && /pinball/.test(records[0].what), records)

    // journal route.
    await write(page, "show me Tuft's tasks in the journal")
    await page.waitForTimeout(1200)
    check('journal route: the journal opens', (await journalOpen()) === 'notebook')
    await page.keyboard.press('Escape')
    await page.waitForTimeout(400)

    // The router failing or answering nonsense keeps the line and says so in character.
    for (const [label, text] of [['fails', 'add a lamp [stub-route-fail]'], ['names no known route', 'add a lamp [stub-route-junk]']]) {
      await write(page, text)
      s = await until(page, (x) => !x.input.routing && x.input.routes.at(-1)?.text === text && /didn't quite follow/i.test(x.cards.alex?.text ?? ''))
      check(`a router that ${label} keeps the line on the input and your villager says so`, s.input.text === text && s.mode === 'room' && s.input.routes.at(-1).path === 'router', { text: s.input.text, card: s.cards.alex?.text })
      // Never a flash: the line is still up to read three seconds later.
      await page.waitForTimeout(3000)
      s = await state(page)
      check(`  ...and that line stays up to be read (3 s later it is still showing)`, /didn't quite follow/i.test(s.cards.alex?.text ?? '') && s.cards.alex?.as, s.cards.alex)
      await page.keyboard.press('Escape')
    }

    // The path a line takes (#42): the page's own check, before any model. Plain chat is one call to the
    // villager; a line that may change the room goes to the router, even with no verb at all.
    const routerCalls = async () => (await jsonl('alex', 'routes.jsonl')).length
    let calls0 = await routerCalls()
    await write(page, 'what should I cook tonight?')
    s = await until(page, (x) => x.cards.alex?.finished && /I hear you, Alex/.test(x.cards.alex.text) && !x.pending, 15_000)
    check('plain chat goes straight to your villager: one call, no router', s.input.routes.at(-1).path === 'chat' && s.input.routes.at(-1).calls === 1 && (await routerCalls()) === calls0, s.input.routes.at(-1))
    await back(page)
    for (const text of ['a toy cow on the table', 'add a cattle']) {
      calls0 = await routerCalls()
      await write(page, text)
      s = await until(page, (x) => x.input.routes.at(-1)?.text === text && x.input.furnish.job?.state === 'placed', 20_000)
      check(`"${text}" goes to the router and is furnished`, s.input.routes.at(-1).path === 'router' && s.input.routes.at(-1).route === 'furnish' && (await routerCalls()) === calls0 + 1, s.input.routes.at(-1))
      await page.click('.furnish-choice [data-choice="keep"]', { timeout: 3000 }).catch(() => {})
    }
    // A guessed ghost the router turns into an answer fades out (never blinks), and the answer stays to be read.
    await write(page, 'bring me some cheer')
    s = await until(page, (x) => x.input.routes.at(-1)?.text === 'bring me some cheer' && x.input.furnish.job === null, 15_000, 10)
    check('a guessed ghost the router answers instead fades away rather than blinking out', s.input.routes.at(-1).route === 'answer' && s.input.furnish.fading === 1, { route: s.input.routes.at(-1), fading: s.input.furnish.fading })
    s = await until(page, (x) => x.cards.alex?.finished && /I hear you, Alex/.test(x.cards.alex.text) && !x.pending, 15_000)
    await page.waitForTimeout(2000)
    s = await state(page)
    check('  ...and your villager answers in a talk that stays open', s.mode === 'talk' && s.partner === 'alex' && /I hear you, Alex/.test(s.cards.alex?.text ?? '') && s.input.furnish.fading === 0, { mode: s.mode, card: s.cards.alex?.text })
    await back(page)
    // Lines from your villager queue: the route's own line stays up before the living-room note replaces it.
    await write(page, 'add a picture above the sofa')
    s = await until(page, (x) => x.input.quips.some((q) => /living room/.test(q.text)), 15_000)
    const [sayQ, noteQ] = s.input.quips.slice(-2)
    check("your villager's lines queue: each stays up 2.5 s or more before the next", /let me see/.test(sayQ.text) && /living room/.test(noteQ.text) && noteQ.at - sayQ.at >= 2500, s.input.quips.slice(-3))
    s = await until(page, (x) => x.input.furnish.job?.state === 'placed', 20_000)
    const picture = s.input.furnish.job.places[0]
    check('"a picture above the sofa" goes on a wall, upright, at picture height', picture.mount === 'wall' && picture.wall && picture.y > 1 && picture.y < 2, picture)
    await page.click('.furnish-choice [data-choice="keep"]', { timeout: 3000 }).catch(() => {})

    // Placement (#42): distinct anchors give distinct poses, each on its mount.
    const poses = await page.evaluate(() => {
      const p = window.village.talk.placeFor
      return [
        ['put a 65 inch TV on the living room wall', p('65 inch flat screen TV, black', 'on the living room wall | put a 65 inch TV on the living room wall', 'floor')],
        ['add a picture above the sofa', p('picture', 'above the sofa | add a picture above the sofa', 'wall')],
        ['hang a paper lantern from the ceiling', p('paper lantern', 'from the ceiling | hang a paper lantern from the ceiling', 'ceiling')],
        ['a toy cow on the table', p('toy cow', 'on the table | a toy cow on the table', 'surface')],
        ['a plant by the window', p('plant', 'by the window | a plant by the window', 'floor')],
        ['add a lamp in the corner', p('lamp', 'in the corner', 'floor')],
        ['a mug on the counter', p('mug', 'on the counter', 'surface')],
        ['add a table to the interior with a cow', p('wooden table with black and white cow-spot print', 'the interior | add a table to the interior with a cow', 'floor')],
      ].map(([text, r]) => ({ text, mount: r.mount, anchor: r.poses[0].anchor, x: +r.poses[0].x.toFixed(2), y: +r.poses[0].y.toFixed(2), z: +r.poses[0].z.toFixed(2), size: r.size }))
    })
    const want = [['wall', 'livingWall'], ['wall', 'sofaWall'], ['ceiling', 'ceiling'], ['surface', 'table'], ['floor', 'window'], ['floor', 'corner'], ['surface', 'counter'], ['floor', 'floor']]
    check('each line gets its expected mount and anchor (a TV the model put on the floor goes on the wall)', poses.every((p, i) => p.mount === want[i][0] && p.anchor === want[i][1]), poses)
    const distinct = new Set(poses.map((p) => `${p.x},${p.y},${p.z}`))
    check('distinct anchors give distinct poses', distinct.size === poses.length, poses)
    // The living room (x 3.58 to 8.38 since #42's one house): the TV on its back wall, the picture on the wall behind the sofa.
    check('the living room is furnishable: "a TV on the living room wall" lands on its back wall, "a picture above the sofa" on the wall behind the sofa',
      poses[0].x > 3.7 && poses[0].x < 8.3 && Math.abs(poses[0].z + 2.2) < 0.05 && Math.abs(poses[1].x - 3.58) < 0.05 && poses[1].z > -0.1 && poses[1].z < 1.95, poses.slice(0, 2))
    const [tv, pic, lantern, cow, plant] = poses
    check('heights by mount: TV and picture up the wall, the lantern hanging, the cow on the table top, the plant on the floor', tv.y > 0.6 && tv.size[2] < tv.size[1] && pic.y > 1 && lantern.y > 1.5 && Math.abs(cow.y - 0.76) < 0.01 && plant.y === 0, poses)
    const stacked = await page.evaluate(() => {
      const p = window.village.talk.placeFor
      const cow = p('cow', 'on the table', 'surface').poses[0]
      return { cow, second: p('cow', 'on the table', 'surface', { taken: [cow] }).poses[0], tv: p('65 inch TV', 'on a wall', 'floor', { taken: [cow] }).poses[0] }
    })
    check('a second piece on the same anchor slides clear of the first, and a TV never lands on the cow', Math.hypot(stacked.second.x - stacked.cow.x, stacked.second.z - stacked.cow.z) > 0.25 && stacked.tv.mount === 'wall' && Math.hypot(stacked.tv.x - stacked.cow.x, stacked.tv.z - stacked.cow.z) > 0.5, stacked)

    // The parcel is there again after a reload: the project is read back from the host.
    await open(page, '?talk=npc&input=held&q=low')
    await page.waitForTimeout(500)
    s = await state(page)
    check('after a reload the project parcel stands where it was', s.input.furnish.parcels.length === 1, s.input.furnish.parcels)

    // Clean unload, three times over: no input, furnishing or parcels left, the table visible.
    await write(page, 'replace the table with a round oak one')
    await until(page, (x) => x.input.furnish.job?.state === 'placed')
    const counts = []
    for (let i = 0; i < 3; i++) {
      await page.evaluate(() => window.village.unload('talk'))
      await page.waitForTimeout(300)
      counts.push(await page.evaluate(() => {
        const snap = window.village.snapshot()
        return { objects: snap.sceneObjects, geometries: snap.geometries, textures: snap.textures, hooks: snap.frameHooks, dom: snap.dom, talkObjects: snap.objects.filter((o) => /:talk (input|notepad|journal button|note in flight|furnishing|project)/.test(o)).length, inputDom: document.querySelectorAll('.talk-input-field, .talk-mine, .talk-journal, .talk-pad, .furnish-choice').length, table: window.village.kernel.root.get('stage').scene.getObjectByName('table').visible }
      }))
      if (i < 2) {
        await page.evaluate(() => window.village.load('talk'))
        await page.waitForTimeout(900)
      }
    }
    check('unloading leaves no input, furnishing or parcel, and restores the table, every time', counts.every((c) => c.talkObjects === 0 && c.inputDom === 0 && c.table && c.objects === counts[0].objects && c.geometries === counts[0].geometries && c.textures === counts[0].textures && c.hooks === counts[0].hooks && c.dom === counts[0].dom), counts)

    // ?route=separate keeps the two-call path: the router first, then the answer; and the same redirect is refused there too.
    await open(page, '?talk=npc&route=separate&q=low')
    await write(page, 'What shall we bake?')
    s = await until(page, (x) => x.cards.alex?.finished && /I hear you, Alex/.test(x.cards.alex.text) && !x.pending, 15_000)
    const separate = await jsonl('alex', 'routes.jsonl')
    check('?route=separate: a router call first, then the answer (two calls)', s.input.routes.at(-1).calls === 2 && separate.at(-1)?.routed?.route === 'answer', { route: s.input.routes.at(-1), last: separate.at(-1) })
    await back(page)
    const samBefore2 = (await jsonl('sam', 'conversation.jsonl')).length
    await write(page, 'another worry [stub-route-redirect]')
    s = await until(page, (x) => x.cards.alex?.finished && /I hear you, Alex/.test(x.cards.alex.text) && !x.pending, 15_000)
    check('?route=separate: the redirect is refused there too', s.partner === 'alex' && (await jsonl('sam', 'conversation.jsonl')).length === samBefore2, { partner: s.partner })
    await back(page)

    // speech: no box until you type; words rise as your own card; Enter sends them off.
    await open(page, '?talk=npc&input=speech&q=low')
    s = await state(page)
    check('speech: no box at all until you type', !s.input.speechShown && !s.input.padVisible && (await page.locator('.talk-mine.shown').count()) === 0, s.input)
    await page.keyboard.type('I want to chat with Tuft')
    await page.waitForTimeout(100)
    s = await state(page)
    const card = await page.evaluate(() => ({ text: document.querySelector('.talk-mine .mine-words')?.textContent, tab: document.querySelector('.talk-mine .mine-tab')?.textContent, to: document.querySelector('.talk-mine .mine-to')?.textContent }))
    check('speech: your words rise as your own card, and naming Tuft re-addresses it as you type', s.input.speechShown && card.text === 'I want to chat with Tuft' && card.tab === 'You' && card.to === 'to Tuft', card)
    await page.keyboard.press('Enter')
    await page.waitForTimeout(60)
    const flying = await page.locator('.talk-mine.flying').count()
    s = await until(page, (x) => x.mode === 'talk' && x.partner === 'sam')
    check('speech: Enter sends the card off and the talk opens with Tuft', flying === 1 && s.partner === 'sam' && !s.input.speechShown, { flying, partner: s.partner })
    await back(page)
    await page.keyboard.press('j')
    await page.waitForTimeout(400)
    check('speech: J opens the journal too', (await journalOpen()) === 'notebook')
    check('no page errors', errors.length === 0, errors)
    await context.close()

    // A phone (touch emulation): a tap on the resting pad focuses a real, visible line inside the tap, so the keyboard comes up; type and send.
    const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 })
    const tp = await phone.newPage()
    const phoneErrors = []
    tp.on('pageerror', (e) => phoneErrors.push(String(e)))
    await open(tp, '?talk=npc&q=low')
    await tp.waitForTimeout(800)
    const coarse = await tp.evaluate(() => matchMedia('(pointer: coarse)').matches)
    const pad = (await state(tp)).input.padRect
    await tp.touchscreen.tap(pad.left + pad.width / 2, pad.top + Math.min(pad.height / 2, 12))
    await tp.waitForTimeout(200)
    const line = await tp.evaluate(() => {
      const f = document.querySelector('.talk-input-field')
      const r = f.getBoundingClientRect()
      return { focused: document.activeElement === f, hint: f.enterKeyHint, height: r.height, visible: r.left >= 0 && r.right <= innerWidth && r.bottom <= innerHeight && r.top >= 0 && getComputedStyle(f).opacity === '1' }
    })
    check('phone: a tap on the notepad focuses a visible line, 44 px or taller, with a send key', coarse && line.focused && line.visible && line.height >= 44 && line.hint === 'send', { coarse, pad, line })
    const phoneBefore = (await jsonl('alex', 'conversation.jsonl')).length
    await tp.keyboard.type('Hello from my phone')
    await tp.keyboard.press('Enter')
    const sentPhone = await until(tp, (x) => x.cards.alex?.finished && /I hear you, Alex/.test(x.cards.alex.text) && !x.pending, 15_000)
    const phoneLines = (await jsonl('alex', 'conversation.jsonl')).slice(phoneBefore)
    check('phone: typing and send reaches your villager, and the line hides again', phoneLines[0]?.text === 'Hello from my phone' && sentPhone.partner === 'alex' && !(await tp.evaluate(() => document.querySelector('.talk-input-field').classList.contains('touch'))), { phoneLines })
    check('phone: no page errors', phoneErrors.length === 0, phoneErrors)
    await phone.close()
    await fixes()
  }
} finally {
  await browser.close()
  for (const child of [...children]) await stop(child)
  check('host and dev server stopped', children.size === 0 && !existsSync(join(root, 'villager', 'launch.json')))
  await rm(root, { recursive: true, force: true })
}

if (agent !== 'claude') {
  for (const c of checks) console.log(`${c.pass ? 'pass' : 'FAIL'}  ${c.name}${c.pass ? '' : `  ${JSON.stringify(c.detail)}`}`)
  const failed = checks.filter((c) => !c.pass).length
  console.log(`${checks.length - failed} of ${checks.length} passed`)
  process.exitCode = failed ? 1 : 0
}
