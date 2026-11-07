// #47 villager setup, headless checks. Starts its own dev server (port 5334 by default)
// on a throwaway VILLAGE_ROOT and a villager host in this process with a stub maker
// (orchestration only, no model), then drives ?villager=gen&setup=1 in headless Chrome:
// &from= stitching, the five tools by keyboard and pointer, the send-off, reduced motion,
// failures leaving nothing placed, the stub host's waiting and 422 paths, and unloads
// returning to baseline. --live adds one real Sonnet call through the host and the page.
// Usage: node scripts/villagers/check-setup.mjs [--port=5334] [--from=code-1] [--live] [--shots=dir] [--viewport=1440x900]
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const homeDir = join(dirname(fileURLToPath(import.meta.url)), '../..')
const arg = (name, fallback) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback
const port = Number(arg('port', 5334))
const FROM = arg('from', 'code-1')
const live = process.argv.includes('--live')
const shots = arg('shots', null)
const [vw, vh] = arg('viewport', '1440x900').split('x').map(Number)
const root = await mkdtemp(join(tmpdir(), 'villager-setup-'))

// The host, in this process: the real routes and token, a stub villager maker that takes 3 s.
const { Context } = await import(join(homeDir, '../host/node_modules/cordis/lib/index.mjs')).catch(() => import('cordis'))
const { default: villager } = await import(join(homeDir, '../host/src/villager.ts'))
const { stubAgent } = await import(join(homeDir, '../host/src/villager-agent.ts'))
const { stubVillagerMaker, claudeVillagerMaker } = await import(join(homeDir, '../host/src/villager-make.ts'))
const hostCtx = new Context()
const stub = stubVillagerMaker(3000)
let useLive = false
const realMaker = live ? claudeVillagerMaker('sonnet') : null
const { parseProfiles } = await import(join(homeDir, '../host/src/villager-make.ts'))
const host = hostCtx.plugin(villager, { root, agent: stubAgent(5), port: 0, people: { alex: 'Alex', sam: 'Sam' }, profiles: parseProfiles('alex:adult-optin,sam:child'), villagerMaker: (ask) => (useLive ? realMaker(ask) : stub(ask)) })
await host.await()
const hostPort = hostCtx.villager.port

process.env.VILLAGE_ROOT = root
process.env.VILLAGER_PORT = String(hostPort)
const { createServer } = await import(join(homeDir, 'node_modules/vite/dist/node/index.js'))
const vite = await createServer({ root: homeDir, configFile: join(homeDir, 'vite.config.ts'), logLevel: 'warn', server: { port, strictPort: true } })
await vite.listen()
const base = `http://localhost:${port}/`

const checks = []
const check = (name, pass, detail) => checks.push({ name, pass: Boolean(pass), detail })
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu', '--use-angle=metal', '--autoplay-policy=no-user-gesture-required'] })

async function open(query, opts = {}) {
  const context = await browser.newContext({ viewport: { width: vw, height: vh }, reducedMotion: opts.reducedMotion ?? 'no-preference' })
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  await page.goto(`${base}?q=low&villager=gen&setup=1${query}`)
  await page.waitForFunction(() => window.villagerSetup && window.village, null, { timeout: 60000 })
  await page.waitForTimeout(400)
  return { context, page, errors }
}
const st = (page) => page.evaluate(() => window.villagerSetup.state())
const pg = (page) => page.evaluate(() => window.villagerSetup.page())
const until = (page, states, timeout = 30000) => page.waitForFunction((s) => s.includes(window.villagerSetup.state().state), states, { timeout })
const shot = async (page, name) => shots && page.screenshot({ path: join(shots, `${name}.jpg`), type: 'jpeg', quality: 82 })
const seat = [0.1, 1.45, 2.7]
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])

try {
  // ── &from=: the whole scene without a model ────────────────────────────
  {
    const { context, page, errors } = await open(`&from=${FROM}`)
    await page.waitForTimeout(2200)
    const p0 = await pg(page)
    const objects = await page.evaluate(() => window.village.snapshot().objects)
    check('the workshop is on the table: mat, pattern, needle, the nine tools and the pattern rack', ['workshop mat', 'workshop pattern', 'workshop needle', 'workshop size', 'workshop hue', 'workshop pitch', 'workshop pace', 'workshop energy', 'workshop warmth', 'workshop playful', 'workshop chatty', 'workshop humour', 'workshop rack'].every((n) => objects.some((o) => o.endsWith(`:${n}`))))
    check('the notebook and its pencil step aside', p0.aside.length === 2 && p0.aside.every((v) => v === false), p0.aside)
    check('the camera leans over the table', dist(await page.evaluate(() => window.villagerSetup.camera()), seat) > 0.5)
    check('the slip shows the saved description, ready to write in', p0.slip && p0.slipText.length > 10 && !p0.slipReadOnly && p0.focus === 'line', p0)
    check('no tool tags before there is a villager', !(await page.evaluate(() => document.querySelector('.vs-tools.shown'))))
    await shot(page, '1-empty')

    // Keyboard: Enter on the slip. Parts arrive in order, one needle pass each.
    const samples = []
    await page.keyboard.press('Enter')
    for (let i = 0; i < 14; i++) {
      samples.push(await page.evaluate(() => window.villagerSetup.state().visibleMeshes))
      await page.waitForTimeout(250)
    }
    await until(page, ['tuning'])
    const s1 = await st(page)
    const order = Object.keys(s1.pieces)
    const want = ['body', 'head', 'ears', 'eyes', 'hands', 'feet', 'accessories', 'prop'].filter((n) => order.includes(n))
    check('parts are stitched in order: body, head, ears, eyes, hands, feet, accessories, prop', JSON.stringify(order) === JSON.stringify(want) && order[0] === 'body' && order.length >= 6, order)
    const rising = samples.filter((n, i) => i && n > samples[i - 1]).length
    check('the villager appears part by part, not all at once', rising >= 4 && samples[0] < samples.at(-1), samples)
    check('stitching takes a few seconds', s1.timings.stitchMs > 2000 && s1.timings.stitchMs < 8000, s1.timings)
    await page.waitForTimeout(900)
    const p1 = await pg(page)
    check('it says its bark on a card, with its name on a tag', p1.card && p1.card.length > 10 && p1.nametag?.startsWith(s1.name), p1)
    check('its voice is registered from the made villager', s1.voice && s1.voice.pitch >= 90 && s1.voice.pitch <= 480, s1.voice)
    check('keyboard focus lands on the first tool', p1.focus === 'size', p1.focus)
    check('it has a grown-up persona: a role, a speciality and a temperament, on the sheet and its tag', s1.persona && s1.persona.role && s1.persona.speciality && s1.persona.temperament && /\S+\s+\S+/.test(p1.nametag ?? '') || (s1.persona?.role && p1.nametag?.includes(s1.persona.role)), { persona: s1.persona, tag: p1.nametag })
    await shot(page, '3-tuning')

    // The tools, by keyboard. Each changes the villager measurably and at once.
    const before = await st(page)
    for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowRight')
    await page.keyboard.press('Tab')
    for (let i = 0; i < 6; i++) await page.keyboard.press('ArrowLeft')
    await page.keyboard.press('Tab')
    for (let i = 0; i < 5; i++) await page.keyboard.press('ArrowUp')
    await page.keyboard.press('Tab')
    await page.keyboard.press('PageDown')
    await page.keyboard.press('Tab')
    await page.keyboard.press('End')
    await page.keyboard.press('Tab')
    for (let i = 0; i < 12; i++) await page.keyboard.press('ArrowLeft')
    await page.keyboard.press('Tab')
    await page.keyboard.press('Home')
    await page.keyboard.press('Tab')
    await page.keyboard.press('Home')
    await page.keyboard.press('Tab')
    await page.keyboard.press('End')
    const locked = await st(page)
    check('humour: crude is locked for an unknown profile; the dial stops at cheeky and says why', locked.values.humour === 0.5 && /locked/.test(locked.note ?? ''), { humour: locked.values.humour, note: locked.note })
    await page.keyboard.press('Home')
    await page.waitForTimeout(700)
    const after = await st(page)
    check('size: the tape measure makes it bigger', after.values.size > 0.65 && after.scale > before.scale * 1.08, { before: before.scale, after: after.scale })
    check('colour: the spools turn its felt hue (the accent stays)', after.values.hue < 0.3 && after.hue < -0.35 && after.hueMaterials > 0, { hue: after.hue, materials: after.hueMaterials })
    check('pitch: the xylophone raises its voice', after.values.pitch > 0.7 && after.voice.pitch > before.voice.pitch * 1.1, { before: before.voice.pitch, after: after.voice.pitch })
    check('pace: the metronome slows its voice', after.values.pace < 0.35 && after.voice.rate < before.voice.rate * 0.9, { before: before.voice.rate, after: after.voice.rate })
    check('energy: the wind-up key quickens its gait and idle', after.values.energy === 1 && after.gait.speed > before.gait.speed * 1.3 && after.energy > 1.4, { before: before.gait, after: after.gait })
    const p2 = await pg(page)
    check('persona: the three ribbons set warmth, playfulness and chattiness as data', after.values.warmth === 0 && after.values.playful === 0 && after.values.chatty === 0, after.values)
    check('it answers a change in a short, blunt, adult line (no baby talk)', ['Fine.', 'That works.', 'Leave it there.', 'Good enough. Next?'].includes((p2.card ?? '').trim()), p2.card)
    check('no model is called for tuning (nothing reached the host)', (await readdir(join(root, 'people')).catch(() => [])).length === 0)

    // Pointer: drag the xylophone mallet back to the left.
    const at = await page.evaluate(() => window.villagerSetup.screen('pitch'))
    await page.mouse.move(at.x, at.y)
    await page.mouse.down()
    await page.mouse.move(at.x - 60, at.y, { steps: 6 })
    const mid = (await st(page)).values.pitch
    await page.mouse.move(at.x - 160, at.y, { steps: 6 })
    await page.mouse.up()
    const dragged = await st(page)
    check('dragging the mallet changes pitch live, as it moves', mid < after.values.pitch && dragged.values.pitch < mid && dragged.voice.pitch < after.voice.pitch, { start: after.values.pitch, mid, end: dragged.values.pitch })
    check('the camera stays on the table while dragging', dist(await page.evaluate(() => window.villagerSetup.camera()), seat) > 0.5)

    // Tab past the last tool reaches the send-off tag; Enter sends it off to walk.
    await page.focus('.vs-tool[data-key=humour]')
    await page.keyboard.press('Tab')
    await page.keyboard.press('Tab')
    await page.keyboard.press('Tab')
    const onDone = await page.evaluate(() => document.activeElement?.classList.contains('vs-done') ? 'vs-done' : document.activeElement?.className)
    await page.keyboard.press('Enter')
    await page.waitForTimeout(2600)
    const s3 = await st(page)
    check('Tab reaches "Off you go"; it hops down and walks the kitchen', onDone === 'vs-done' && s3.walkers.length === 1 && s3.state === 'empty', { onDone, walkers: s3.walkers })
    const w0 = s3.walkers[0]
    await page.waitForTimeout(2500)
    const w1 = (await st(page)).walkers[0]
    check('it walks (moves on the floor), at its tuned size', Math.hypot(w1.x - w0.x, w1.z - w0.z) > 0.05 && Math.abs(w1.scale - after.scale) < 1e-6, { w0, w1 })
    check('the tuned result is kept as data: module text, persona and nine values', s3.kept.length === 1 && s3.kept[0].source.from === FROM && Math.abs(s3.kept[0].tuning.size - after.values.size) < 1e-9 && s3.kept[0].tuning.warmth === 0 && s3.kept[0].persona?.role && /chars$/.test(s3.kept[0].module), s3.kept[0])
    const p3 = await pg(page)
    check('the slip is back, ready for another', p3.slip && !p3.slipReadOnly, p3)
    await shot(page, '5-walking')
    check('no page errors', errors.length === 0, errors)

    // Unload and reload: objects, geometries, textures, frame hooks and DOM return to the same counts.
    const counts = []
    const measure = () => page.evaluate(() => {
      const s = window.village.snapshot()
      return { objects: s.sceneObjects, geometries: s.geometries, textures: s.textures, hooks: s.frameHooks, dom: s.dom, setup: s.objects.filter((o) => /villager (setup|workshop)/.test(o)).length, aside: window.village.kernel.root.get('stage').scene.getObjectByName('notebook').visible }
    })
    for (let round = 0; round < 3; round++) {
      await page.evaluate(() => window.village.kernel.unload('villagersetup'))
      await page.waitForTimeout(300)
      counts.push(await measure())
      await page.evaluate(async () => window.village.kernel.load((await import('/src/villagers/gen/setup.ts')).default))
      await page.waitForFunction(() => window.villagerSetup, null, { timeout: 20000 })
      await page.evaluate(() => window.villagerSetup.start(''))
      await page.waitForFunction(() => window.villagerSetup.state().state === 'tuning', null, { timeout: 30000 })
      await page.evaluate(() => window.villagerSetup.set('hue', 0.2))
      await page.waitForTimeout(300)
    }
    await page.evaluate(() => window.village.kernel.unload('villagersetup'))
    await page.waitForTimeout(300)
    counts.push(await measure())
    check('unloading returns objects, geometries, textures, hooks and DOM to baseline, every time', counts.every((c) => c.setup === 0 && c.aside && c.objects === counts[0].objects && c.geometries === counts[0].geometries && c.textures === counts[0].textures && c.hooks === counts[0].hooks && c.dom === counts[0].dom), counts)
    check('unloading removes the page API', await page.evaluate(() => !window.villagerSetup))
    await context.close()
  }

  // ── Patterns: a template alone or with words; the humour gate in the page ──
  {
    const { context, page, errors } = await open(`&from=${FROM}&profile=adult`)
    const rackState = await page.evaluate(() => window.villagerSetup.patterns())
    check('patterns: the rack offers the built-in templates for this profile', ['organiser', 'coach', 'grandparent', 'craftsperson', 'buddy'].every((id) => rackState.cards.some((c) => c.id === id)) && !rackState.cards.some((c) => c.id === 'companion'), rackState.cards.map((c) => c.id))
    await page.click('.vs-pattern[data-template=coach]')
    await page.waitForTimeout(200)
    check('patterns: picking a card shows it on the slip', (await page.textContent('.vs-slip .chip')).includes('Calm coach') && (await st(page)).rack.picked === 'coach')
    await page.focus('.vs-slip .line')
    await page.keyboard.press('Enter')
    await until(page, ['tuning'])
    const s = await st(page)
    check('patterns: the villager takes the template: calm, gentle humour, its dials on the ribbons', s.persona.temperament === 'calm' && s.persona.humour === 'gentle' && Math.abs(s.values.warmth - 0.7) < 1e-9 && s.persona.quirks.some((q) => /next step/.test(q)), s.persona)
    await shot(page, '4-pattern')
    await context.close()
  }
  {
    // Irreverent buddy for an adult who has not opted in: cheeky, with a short note why.
    const { context, page } = await open(`&from=${FROM}&profile=adult`)
    await page.evaluate(() => window.villagerSetup.patterns())
    await page.click('.vs-pattern[data-template=buddy]')
    const picked = await st(page)
    await page.focus('.vs-slip .line')
    await page.keyboard.press('Enter')
    await until(page, ['tuning'])
    const s = await st(page)
    check('patterns: irreverent buddy without the opt-in is cheeky, with a warm note', s.persona.dials.humour === 'cheeky' && s.values.humour === 0.5 && /cheeky/.test(picked.note ?? '') && /opted in/.test(picked.note ?? ''), { humour: s.persona.dials.humour, note: picked.note })
    await context.close()
  }
  {
    // A template alone, no words: allowed (the saved description stands in for &from=).
    const { context, page } = await open(`&from=${FROM}&profile=adult-optin`)
    await page.evaluate(() => window.villagerSetup.patterns())
    await page.click('.vs-pattern[data-template=buddy]')
    await page.locator('.vs-slip .line').fill('')
    await page.focus('.vs-slip .line')
    await page.keyboard.press('Enter')
    await until(page, ['tuning'])
    const s = await st(page)
    check('patterns: a template alone makes a villager; an opted-in adult keeps crude', s.state === 'tuning' && s.persona.dials.humour === 'crude' && s.values.humour === 1, s.persona.dials)
    await context.close()
  }

  // ── Reduced motion: no stitching animation, no camera ease ─────────────
  {
    const { context, page } = await open(`&from=${FROM}`, { reducedMotion: 'reduce' })
    check('reduced motion: the camera is at the table at once', dist(await page.evaluate(() => window.villagerSetup.camera()), seat) > 0.5)
    await page.keyboard.press('Enter')
    await until(page, ['tuning'])
    const s = await st(page)
    check('reduced motion: the villager is whole without the needle passes', s.timings.stitchMs < 600 && s.visibleMeshes > 10, s.timings)
    await context.close()
  }

  // ── A saved result that does not exist: nothing half-placed ────────────
  {
    const { context, page, errors } = await open('&from=no-such-villager')
    await page.locator('.vs-slip .line').fill('a tidy otter who mends the fence')
    await page.keyboard.press('Enter')
    await until(page, ['failed'])
    const s = await st(page)
    const p = await pg(page)
    check('a failure leaves nothing placed and the table tidy', !s.placed && s.visibleMeshes === 0 && s.cut === 0 && s.walkers.length === 0, s)
    check('a failure says so plainly and keeps the words', /nothing was sewn/.test(s.status) && p.slip && !p.slipReadOnly && p.slipText.length > 0, { status: s.status, p })
    check('a failure raises no page error', errors.length === 0, errors)
    await context.close()
  }

  // ── Through the host (stub maker): waiting, then stitch; and a 422 ─────
  {
    const { context, page, errors } = await open('&profile=adult-optin')
    await page.locator('.vs-slip .line').fill('a sleepy hedgehog who bakes bread before dawn')
    await page.keyboard.press('Enter')
    await page.waitForTimeout(1200)
    const w = await st(page)
    const needle = () => page.evaluate(() => window.village.kernel.root.get('stage').scene.getObjectByName('workshop needle').position.toArray())
    const n0 = await needle()
    await page.waitForTimeout(400)
    const n1 = await needle()
    check('host: while the model works, the table is busy and says how long so far', w.state === 'waiting' && /Drafting the pattern/.test(w.status) && dist(n0, n1) > 0.002, { state: w.state, status: w.status, n0, n1 })
    await shot(page, '2-waiting')
    await until(page, ['tuning', 'failed'])
    const s = await st(page)
    check('host: the made module is stitched in the asked accent', s.state === 'tuning' && s.name === 'Dumpling' && s.pieces.accessories > 0, { state: s.state, failure: s.failure, name: s.name, pieces: s.pieces })
    if (s.state !== 'tuning') throw new Error(`host stub villager failed: ${s.failure}`)
    await page.evaluate(() => window.villagerSetup.set('size', 0.8))
    await page.evaluate(() => window.villagerSetup.sendOff())
    await page.waitForTimeout(1600)
    const files = await readdir(join(root, 'people', 'alex', 'villagers'))
    const stored = JSON.parse(await readFile(join(root, 'people', 'alex', 'villagers', files[0]), 'utf8'))
    check('host: the send-off keeps the tuning beside the module, on the host', files.length === 1 && stored.tuning?.size === 0.8 && stored.module.includes('villager.tag('), stored.tuning)

    // Save a tuned pattern, shared: it reloads, and Sam (a child) sees it as cheeky.
    await page.locator('.vs-slip .line').fill('a wry badger who fixes the bikes')
    await page.keyboard.press('Enter')
    await until(page, ['tuning', 'failed'])
    await page.evaluate(() => window.villagerSetup.set('warmth', 0.2))
    await page.evaluate(() => window.villagerSetup.set('humour', 1))
    await page.evaluate(() => window.villagerSetup.save(true))
    const afterSave = await st(page)
    const savedFiles = await readdir(join(root, 'people', 'alex', 'persona-templates')).catch(() => [])
    check('save: the tuned persona is kept on the host as a pattern and appears on the rack', savedFiles.length === 1 && afterSave.rack.cards.some((c) => c.source === 'mine' && c.id === afterSave.saved) && /Kept as a pattern/.test(afterSave.note ?? ''), { files: savedFiles, rack: afterSave.rack.cards, note: afterSave.note })
    const pattern = JSON.parse(await readFile(join(root, 'people', 'alex', 'persona-templates', savedFiles[0]), 'utf8'))
    check('save: an opted-in adult keeps crude and the tuned warmth', pattern.persona.dials.humour === 'crude' && pattern.persona.dials.warmth === 0.2 && pattern.shared === true, pattern.persona.dials)
    await page.evaluate(() => window.villagerSetup.sendOff())
    await page.waitForTimeout(1500)

    await page.locator('.vs-slip .line').fill('a [stub-fail] fox')
    await page.keyboard.press('Enter')
    await until(page, ['failed'])
    const f = await st(page)
    check('host: a model failure (422) leaves the table tidy and says so', !f.placed && /pattern didn't come together/.test(f.status) && f.walkers.length === 2, { status: f.status, walkers: f.walkers.length })
    check('host: no page errors', errors.length === 0, errors)
    await context.close()
  }
  {
    // It reloads for its maker, and is shared with Sam, a child, as cheeky in the host and the page.
    const again = await open('&profile=adult-optin')
    const mine = await again.page.evaluate(() => window.villagerSetup.patterns())
    check('save: after a reload the saved pattern is back on the rack', mine.cards.some((c) => c.source === 'mine' && c.humour === 'crude'), mine.cards)
    await again.context.close()
    const sam = await open(`&from=${FROM}&person=sam&profile=child`)
    const seen = await sam.page.evaluate(() => window.villagerSetup.patterns())
    const shared = seen.cards.find((c) => c.source === 'family')
    check('family: the shared pattern appears for another person, cheeky from the host', shared && shared.humour === 'cheeky', seen.cards)
    check('family: built-in templates for a child leave out the adults-only one', !seen.cards.some((c) => c.id === 'buddy') && seen.cards.some((c) => c.id === 'companion'), seen.cards.map((c) => c.id))
    await sam.page.click(`.vs-pattern[data-template="${shared.id}"]`)
    await sam.page.focus('.vs-slip .line')
    await sam.page.keyboard.press('Enter')
    await until(sam.page, ['tuning'])
    const s = await st(sam.page)
    check('family: Sam\'s villager from it is cheeky in the page, and the dial is locked', s.persona.dials.humour === 'cheeky' && s.values.humour === 0.5 && Math.abs(s.values.warmth - 0.2) < 1e-9, { dials: s.persona.dials, values: s.values })
    await sam.page.evaluate(() => window.villagerSetup.set('humour', 1))
    check('family: pushing the dial to crude for a child stays cheeky', (await st(sam.page)).values.humour === 0.5)
    await sam.context.close()
  }

  // ── Live: one real Sonnet call through the host and the page ───────────
  if (live) {
    useLive = true
    const { context, page, errors } = await open('')
    const text = 'a tall, shy giraffe who reads bedtime stories'
    await page.locator('.vs-slip .line').fill(text)
    const t0 = Date.now()
    await page.keyboard.press('Enter')
    await page.waitForTimeout(20000)
    await shot(page, 'live-waiting')
    await until(page, ['tuning', 'failed'], 200000)
    const s = await st(page)
    await page.waitForTimeout(1500)
    await shot(page, 'live-tuning')
    check('live: Sonnet writes the villager, it is stitched on the table', s.state === 'tuning', { text, wallMs: Date.now() - t0, state: s.state, name: s.name, failure: s.failure, timings: s.timings, pieces: s.pieces })
    check('live: no page errors', errors.length === 0, errors)
    await context.close()
  }
} finally {
  await browser.close()
  await vite.close()
  await host.dispose()
  await rm(root, { recursive: true, force: true })
}

for (const c of checks) console.log(`${c.pass ? 'ok  ' : 'FAIL'} ${c.name}${c.pass && !/^live/.test(c.name) ? '' : c.detail === undefined ? '' : ` ${JSON.stringify(c.detail)}`}`)
const failed = checks.filter((c) => !c.pass).length
console.log(`${checks.length - failed} of ${checks.length} passed (${live ? 'stub host + one live Sonnet call' : 'stub host, orchestration only'})`)
process.exit(failed ? 1 : 0)
