// Headless proof of the always-on input (?talk=npc&input=held|speech, #42).
// Starts its own villager host (stub router, stub prop maker, stub villagers) and
// dev server on a throwaway VILLAGE_ROOT, and stops both at the end.
// Usage: node scripts/check-talk-input.mjs [--dev=5297] [--host=5298]
//   --agent=claude --variant=held|speech [--video=file.webm] [--shots=dir]: the real
//     session instead (idle, talk to Moss, a round oak table, a pinball project, the
//     journal), printing the route and furnishing timings.
//   --agent=claude --furnish: five furnishing requests, timed from Enter to ghost and to the final prop.
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
const jsonl = (person, file) => readFile(join(root, 'people', person, file), 'utf8').then((s) => s.trim().split('\n').map((l) => JSON.parse(l)), () => [])

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
  await page.goto(base + query)
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
      await page.waitForTimeout(250)
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
  } else {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } })
    const page = await context.newPage()
    const errors = []
    page.on('pageerror', (e) => errors.push(String(e)))
    page.on('console', (m) => m.type() === 'error' && !/Failed to load resource/.test(m.text()) && errors.push(m.text()))

    // Without the flag nothing of the input exists.
    await open(page, '?talk=npc&q=low')
    const plain = await page.evaluate(() => ({ input: window.village.talk.state().input, dom: document.querySelectorAll('.talk-input-field, .talk-mine, .talk-journal, .furnish-choice').length }))
    check('without ?input= there is no always-on input', plain.input === null && plain.dom === 0, plain)

    await open(page, '?talk=npc&input=held&q=low')
    const baseline = await page.evaluate(() => window.village.snapshot())
    let s = await state(page)
    check('held: the notepad is in view, addressed to your own villager', s.input.padVisible && s.input.to === 'Dumpling' && s.mode === 'room', s.input)
    check('held: the pad and journal ride with the camera as scene objects', baseline.objects.some((o) => o.endsWith(':talk input')) && baseline.objects.some((o) => o.endsWith(':talk notepad')) && baseline.objects.some((o) => o.endsWith(':talk journal button')))

    // A keypress anywhere starts writing.
    await page.mouse.click(640, 300)
    await page.keyboard.type('Hello')
    s = await state(page)
    check('a keypress anywhere starts writing (capital letters too)', s.input.text === 'Hello' && s.input.focused, s.input)
    const attending = (await state(page)).cast.alex.attending
    check('your villager turns to you while you write', attending, attending)
    await page.keyboard.press('Escape')
    s = await state(page)
    check('Escape clears the line', s.input.text === '' && s.mode === 'room', s.input)

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
    s = await until(page, (x) => x.mode === 'talk' && x.partner === 'mia')
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
    await back(page)

    // furnish: ghost at once, then the final prop in its place, then undo.
    const t0 = Date.now()
    await page.keyboard.type('add a round oak table for four')
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
    await page.click('.furnish-choice [data-choice="undo"]', { timeout: 3000 }).catch(() => {})
    s = await state(page)
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
      s = await until(page, (x) => x.input.furnish.job === null && !x.input.routing, 20_000)
      await page.waitForTimeout(200)
      s = await state(page)
      check(`a generation that ${label} leaves no ghost and no prop, and says so`, s.input.furnish.placed === placedBefore && s.input.furnish.job === null && /nothing|didn't come out/i.test(s.cards.alex?.text ?? ''), { placed: s.input.furnish.placed, card: s.cards.alex?.text })
    }

    // project: a parcel where it will go, and a record on the host.
    await write(page, "let's add a playable pinball machine in the living room")
    s = await until(page, (x) => x.input.furnish.parcels.length > 0)
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
    for (const [label, text] of [['fails', 'hello [stub-route-fail]'], ['names no known route', 'hello [stub-route-junk]']]) {
      await write(page, text)
      s = await until(page, (x) => !x.input.routing && x.input.routes.at(-1)?.text === text)
      await page.waitForTimeout(100)
      s = await state(page)
      check(`a router that ${label} keeps the line on the input and your villager says so`, s.input.text === text && /didn't quite follow/i.test(s.cards.alex?.text ?? '') && s.mode === 'room', { text: s.input.text, card: s.cards.alex?.text })
      await page.keyboard.press('Escape')
    }

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
        return { objects: snap.sceneObjects, geometries: snap.geometries, textures: snap.textures, hooks: snap.frameHooks, dom: snap.dom, talkObjects: snap.objects.filter((o) => /:talk (input|notepad|journal button|note in flight|furnishing|project)/.test(o)).length, inputDom: document.querySelectorAll('.talk-input-field, .talk-mine, .talk-journal, .furnish-choice').length, table: window.village.kernel.root.get('stage').scene.getObjectByName('table').visible }
      }))
      if (i < 2) {
        await page.evaluate(() => window.village.load('talk'))
        await page.waitForTimeout(900)
      }
    }
    check('unloading leaves no input, furnishing or parcel, and restores the table, every time', counts.every((c) => c.talkObjects === 0 && c.inputDom === 0 && c.table && c.objects === counts[0].objects && c.geometries === counts[0].geometries && c.textures === counts[0].textures && c.hooks === counts[0].hooks && c.dom === counts[0].dom), counts)

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
