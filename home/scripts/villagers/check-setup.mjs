// #47 villager setup, headless checks. Starts its own dev server (port 5334 by default)
// on a throwaway VILLAGE_ROOT and a villager host in this process with a stub maker
// (orchestration only, no model), then drives ?villager=gen&setup=1 in headless Chrome:
// &from= stitching, the five tools by keyboard and pointer, the send-off, reduced motion,
// failures leaving nothing placed, the stub host's waiting and 422 paths, and unloads
// returning to baseline, the one repair pass (a refused module or a refused persona), the jokes dial as
// the host's humourCeiling locks it, patterns from the host, and the send-off writing persona.json.
// --live adds one real Sonnet make (and at most one remake) through the host and the page.
// Usage: node scripts/villagers/check-setup.mjs [--port=5334] [--from=code-1] [--live] [--shots=dir] [--viewport=1440x900]
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
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
// Profiles are #42's and live on the host only (the page has no profile flag): Alex and Jo are adults with
// no humour setting (the dial is clean or cheeky), Lee an adult whose admin set crude, Sam a child, and Kit
// has no profile (unknown).
const { Context } = await import(join(homeDir, '../host/node_modules/cordis/lib/index.mjs')).catch(() => import('cordis'))
const { default: villager } = await import(join(homeDir, '../host/src/villager.ts'))
const { stubAgent } = await import(join(homeDir, '../host/src/villager-agent.ts'))
const { stubVillagerMaker, claudeVillagerMaker } = await import(join(homeDir, '../host/src/villager-make.ts'))
const hostCtx = new Context()
const stub = stubVillagerMaker(3000)
// One flow waits longer, so the waiting capture shows a pattern piece already cut and pinned.
const slowStub = stubVillagerMaker(10000)
let slow = false
let useLive = false
const realMaker = live ? claudeVillagerMaker('sonnet') : null
const { TEMPLATES } = await import(join(homeDir, '../host/src/persona.ts'))
const host = hostCtx.plugin(villager, { root, agent: stubAgent(5), port: 0, people: { alex: 'Alex', sam: 'Sam', jo: 'Jo', lee: 'Lee', kit: 'Kit' }, profiles: { alex: { age: 'adult' }, jo: { age: 'adult' }, lee: { age: 'adult', humour: 'crude' }, sam: { age: 'child' } }, villagerMaker: (ask) => (useLive ? realMaker(ask) : slow ? slowStub(ask) : stub(ask)) })
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
/**
 * The layout gate: every visible label (tool tags, ribbon ends, pattern names, the slip, the speech card,
 * the name, save and send-off tags) lies inside the screen and overlaps no other, nor the villager's projected
 * bounds; and no tool on the table lies under the slip. Run at every captured moment.
 */
const LABELS = ['.vs-tool', '.vs-end', '.vs-pattern', '.vs-slip', '.vs-card', '.vs-name', '.vs-save', '.vs-done', '.vs-saved']
const layout = (page) => page.evaluate((selectors) => {
  const boxes = []
  for (const s of selectors) for (const e of document.querySelectorAll(s)) {
    const cs = getComputedStyle(e)
    if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) < 0.05) continue
    const r = e.getBoundingClientRect()
    if (r.width && r.height) boxes.push({ what: `${s}${e.dataset.key ? `[${e.dataset.key}]` : e.dataset.template ? `[${e.dataset.template}]` : ''}`, r })
  }
  const labels = boxes.length
  const outside = boxes.filter(({ r }) => r.left < 0 || r.top < 0 || r.right > innerWidth || r.bottom > innerHeight).map((b) => b.what)
  // The villager on the table is a box too: no label may lie over it.
  const v = window.villagerSetup.bounds()
  if (v && window.villagerSetup.state().state === 'tuning') boxes.push({ what: 'villager', r: v })
  const hit = (a, b) => a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1
  const overlaps = []
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) if (hit(boxes[i].r, boxes[j].r)) overlaps.push(`${boxes[i].what} × ${boxes[j].what}`)
  // The slip is paper over the table: no tool may lie under it.
  const slip = boxes.find((b) => b.what === '.vs-slip')
  if (slip) for (const t of window.villagerSetup.toolBounds()) if (hit(slip.r, t)) overlaps.push(`.vs-slip × tool ${t.key}`)
  return { labels, outside, overlaps }
}, LABELS)
const shot = async (page, name) => {
  const l = await layout(page)
  check(`layout at ${name} (${vw}×${vh}): ${l.labels} labels, all on screen, none overlapping`, l.labels > 0 && !l.outside.length && !l.overlaps.length, l)
  if (shots) await page.screenshot({ path: join(shots, `${name}.jpg`), type: 'jpeg', quality: 82 })
}
const seat = [0.1, 1.45, 2.7]
/** Write on the slip; after a send-off it is a small "make another" tag first, opened by its button. */
const write = async (page, text) => {
  if (await page.evaluate(() => document.querySelector('.vs-slip')?.classList.contains('invite'))) await page.click('.vs-slip .sew')
  await page.locator('.vs-slip .line').fill(text)
}
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])

try {
  // ── &from=: the whole scene without a model ────────────────────────────
  {
    // As Jo, so every capture shows the same five pattern cards an adult sees.
    const { context, page, errors } = await open(`&from=${FROM}&person=jo`)
    await page.waitForTimeout(2200)
    const p0 = await pg(page)
    const objects = await page.evaluate(() => window.village.snapshot().objects)
    check('the workshop is on the table: mat, pattern, needle, the nine tools and the pattern rack', ['workshop mat', 'workshop pattern', 'workshop needle', 'workshop size', 'workshop hue', 'workshop pitch', 'workshop pace', 'workshop energy', 'workshop warmth', 'workshop playful', 'workshop chatty', 'workshop humour', 'workshop rack'].every((n) => objects.some((o) => o.endsWith(`:${n}`))))
    check('the notebook and its pencil step aside', p0.aside.length === 2 && p0.aside.every((v) => v === false), p0.aside)
    check('the camera leans over the table', dist(await page.evaluate(() => window.villagerSetup.camera()), seat) > 0.5)
    check('the slip shows the saved description, ready to write in', p0.slip && p0.slipText.length > 10 && !p0.slipReadOnly && p0.focus === 'line', p0)
    check('before there is a villager the tool tags are only a quiet preview: nothing to grab or tab to', await page.evaluate(() => !document.querySelector('.vs-tools.shown') && [...document.querySelectorAll('.vs-tool')].every((t) => t.tabIndex === -1)))
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
    check('humour: crude is never picked on the table; the dial stops at cheeky and says only the household\'s admin sets it', locked.values.humour === 0.5 && /household's admin/.test(locked.note ?? ''), { humour: locked.values.humour, note: locked.note, dial: locked.humourDial })
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
    await page.mouse.move(at.x - 15, at.y, { steps: 3 })
    const mid = (await st(page)).values.pitch
    await page.mouse.move(at.x - 60, at.y, { steps: 6 })
    await page.mouse.up()
    const dragged = await st(page)
    check('dragging the mallet changes pitch live, as it moves', mid < after.values.pitch && dragged.values.pitch < mid && dragged.voice.pitch < after.voice.pitch, { start: after.values.pitch, mid, end: dragged.values.pitch })
    check('the camera stays on the table while dragging', dist(await page.evaluate(() => window.villagerSetup.camera()), seat) > 0.5)

    // The colour goes back to as made before the send-off, so the walk-off capture shows the villager the
    // tuning capture showed (the colour turn itself was checked above).
    await page.evaluate(() => window.villagerSetup.set('hue', 0.5))
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
    check('the camera follows it as it walks off: it stays in view', w0.seen && w1.seen, { w0, w1 })
    check('the tuned result is kept as data: module text, persona and nine values', s3.kept.length === 1 && s3.kept[0].source.from === FROM && Math.abs(s3.kept[0].tuning.size - after.values.size) < 1e-9 && s3.kept[0].tuning.warmth === 0 && s3.kept[0].persona?.role && /chars$/.test(s3.kept[0].module), s3.kept[0])
    const p3 = await pg(page)
    const invite = await page.evaluate(() => ({ invite: document.querySelector('.vs-slip').classList.contains('invite'), button: document.querySelector('.vs-slip .sew').textContent, note: document.querySelector('.vs-note').classList.contains('shown') }))
    check('after the send-off only a small "Make another" tag shows, and no note from the tuning', p3.slip && !p3.slipReadOnly && invite.invite && invite.button === 'Make another' && !invite.note, { p3, invite })
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
    // The renderer may keep one or two internal resources after the first cycle (village-home-stack: they do not grow).
    const b = counts[1]
    check('unloading returns objects, hooks and DOM to baseline every time; geometries and textures do not grow', counts.every((c) => c.setup === 0 && c.aside && c.objects === counts[0].objects && c.hooks === counts[0].hooks && c.dom === counts[0].dom) && counts.slice(1).every((c) => c.geometries === b.geometries && c.textures === b.textures) && b.geometries - counts[0].geometries <= 2 && b.textures - counts[0].textures <= 2, counts)
    check('unloading removes the page API', await page.evaluate(() => !window.villagerSetup))
    await context.close()
  }

  // ── Patterns from the host: with words or alone; the manner set by the host; the admin's crude ──
  {
    const { context, page, errors } = await open('&person=lee')
    const rackState = await page.evaluate(() => window.villagerSetup.patterns())
    check('patterns: the rack offers the host\'s built-in patterns for this profile', ['organiser', 'coach', 'grandparent', 'craftsperson', 'buddy'].every((id) => rackState.cards.some((c) => c.id === id)) && !rackState.cards.some((c) => c.id === 'companion'), rackState.cards.map((c) => c.id))
    await page.locator('.vs-slip .line').fill('a quiet heron who keeps the diary')
    await page.click('.vs-pattern[data-template=coach]')
    await page.waitForTimeout(600)
    check('patterns: picking a card shows it on the slip', (await page.textContent('.vs-slip .chip')).includes('Calm coach') && (await st(page)).rack.picked === 'coach')
    await shot(page, '1b-picked')
    await page.focus('.vs-slip .line')
    await page.keyboard.press('Enter')
    await until(page, ['tuning', 'failed'])
    const s = await st(page)
    check('patterns: the host sets the pattern\'s manner over the model\'s persona (coach register and quirks, the model\'s name)', s.persona?.template === 'coach' && s.persona.register === TEMPLATES.coach.register && s.persona.quirks.includes('breaks things into the smallest next step') && s.persona.name === 'Biscuit' && s.values.chatty === 0.5, s.persona)
    check('humour: for an adult whose admin set crude, the dial is pinned at crude (the persona\'s own lean stays cheeky)', s.humourDial?.locked === 'crude' && s.humourDial.by === 'admin' && s.values.humour === 1 && s.persona.humour.lean !== 'crude', { dial: s.humourDial, humour: s.values.humour })
    await page.evaluate(() => window.villagerSetup.set('humour', 0))
    const pinned = await st(page)
    check('humour: moving a pinned dial leaves it and says the household\'s admin set it', pinned.values.humour === 1 && /set by the household's admin/.test(pinned.note ?? ''), { humour: pinned.values.humour, note: pinned.note })
    await page.waitForTimeout(900)
    check('patterns: the name tag says which pattern it was made from', ((await pg(page)).nametag ?? '').includes('Calm coach pattern'), (await pg(page)).nametag)
    // The camera eases to fit this villager; the capture waits until it has stopped (slow on a busy machine).
    await page.waitForFunction(async () => {
      const a = window.villagerSetup.camera()
      await new Promise((r) => setTimeout(r, 250))
      return window.villagerSetup.camera().every((v, i) => Math.abs(v - a[i]) < 1e-4)
    }, null, { timeout: 15000 })
    await shot(page, '4-pattern')
    check('patterns: no page errors', errors.length === 0, errors)
    await context.close()
  }
  {
    // A pattern alone, no words: the model gets the pattern's name as the description.
    const { context, page } = await open('&person=lee')
    await page.evaluate(() => window.villagerSetup.patterns())
    await page.click('.vs-pattern[data-template=buddy]')
    await page.locator('.vs-slip .line').fill('')
    await page.focus('.vs-slip .line')
    await page.keyboard.press('Enter')
    await until(page, ['tuning', 'failed'])
    const s = await st(page)
    check('patterns: a pattern alone makes a villager, in the buddy\'s manner, never crude itself', s.state === 'tuning' && s.persona?.template === 'buddy' && s.persona.register === TEMPLATES.buddy.register && s.persona.humour.lean === 'cheeky', s.persona)
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
    const { context, page, errors } = await open('')
    await page.locator('.vs-slip .line').fill('a sleepy hedgehog who bakes bread before dawn')
    slow = true
    await page.keyboard.press('Enter')
    await page.waitForTimeout(1200)
    const w = await st(page)
    const needle = () => page.evaluate(() => window.village.kernel.root.get('stage').scene.getObjectByName('workshop needle').position.toArray())
    const n0 = await needle()
    await page.waitForTimeout(400)
    const n1 = await needle()
    check('host: while the model works, the table is busy and says how long so far', w.state === 'waiting' && /Drafting the pattern/.test(w.status) && dist(n0, n1) > 0.002, { state: w.state, status: w.status, n0, n1 })
    await page.waitForTimeout(5300)
    const cut = await st(page)
    check('host: while waiting, pattern pieces are cut and pinned on the mat, one every few seconds', cut.state === 'waiting' && cut.cut >= 1 && cut.cut <= 2, { state: cut.state, cut: cut.cut })
    await shot(page, '2-waiting')
    await until(page, ['tuning', 'failed'])
    slow = false
    const s = await st(page)
    check('host: the made module is stitched in the asked accent, named by its checked persona', s.state === 'tuning' && s.name === 'Biscuit' && s.persona?.name === 'Biscuit' && s.pieces.accessories > 0, { state: s.state, failure: s.failure, name: s.name, pieces: s.pieces })
    if (s.state !== 'tuning') throw new Error(`host stub villager failed: ${s.failure}`)
    await page.evaluate(() => window.villagerSetup.set('size', 0.8))
    await page.evaluate(() => window.villagerSetup.sendOff())
    await until(page, ['empty'])
    const files = await readdir(join(root, 'people', 'alex', 'villagers'))
    const stored = JSON.parse(await readFile(join(root, 'people', 'alex', 'villagers', files[0]), 'utf8'))
    check('host: the send-off keeps the tuning beside the module, on the host', files.length === 1 && stored.tuning?.size === 0.8 && stored.module.includes('villager.tag('), stored.tuning)
    await page.waitForFunction(() => window.villagerSetup.state().sentOff !== 'sending', null, { timeout: 10000 })
    const personaJson = JSON.parse(await readFile(join(root, 'people', 'alex', 'persona.json'), 'utf8'))
    const voiceJson = JSON.parse(await readFile(join(root, 'people', 'alex', 'voice.json'), 'utf8'))
    check('send-off: "Off you go" writes the person\'s persona.json (checked by the host) and its babble voice', (await st(page)).sentOff === 'Biscuit' && personaJson.name === 'Biscuit' && ['pitch', 'range', 'formant', 'rate', 'breath', 'wobble', 'wobbleRate', 'tilt', 'gain'].every((k) => Number.isFinite(voiceJson[k])), { sentOff: (await st(page)).sentOff, name: personaJson.name, voice: voiceJson })
    const current = await page.evaluate(async () => (await import('/src/villager.ts')).currentVillager('alex'))
    check('send-off: after a reload the host serves the villager and its voice', current.ok && current.persona?.name === 'Biscuit' && current.voice?.pitch === voiceJson.pitch, current)

    // Save a tuned pattern, shared: it reloads, and Sam (a child) sees it as cheeky.
    await write(page, 'a wry badger who fixes the bikes')
    await page.keyboard.press('Enter')
    await until(page, ['tuning', 'failed'])
    await page.evaluate(() => window.villagerSetup.set('warmth', 0.2))
    await page.evaluate(() => window.villagerSetup.set('humour', 1))
    check('humour: an adult without an admin setting cannot pick crude (the dial stays at cheeky)', (await st(page)).values.humour === 0.5)
    await page.evaluate(() => window.villagerSetup.save(true))
    const afterSave = await st(page)
    const savedFiles = await readdir(join(root, 'people', 'alex', 'persona-templates')).catch(() => [])
    check('save: the tuned persona is kept on the host as a pattern and appears on the rack', savedFiles.length === 1 && afterSave.rack.cards.some((c) => c.source === 'mine' && c.id === afterSave.saved) && /Kept as a pattern/.test(afterSave.note ?? ''), { files: savedFiles, rack: afterSave.rack.cards, note: afterSave.note })
    // Saving is seen: the new card drops into the rack, standing at its end, with a "saved" tag.
    await page.waitForTimeout(900)
    check('save: the saved card stands in the rack with a "saved" tag', await page.evaluate(() => document.querySelector('.vs-saved')?.classList.contains('shown')))
    await shot(page, '4b-saved')
    const pattern = JSON.parse(await readFile(join(root, 'people', 'alex', 'persona-templates', savedFiles[0]), 'utf8'))
    check('save: kept as a whole persona, the tuned warmth mapped in (blunt), cheeky at most, shared', /^blunt/.test(pattern.persona.temperament) && pattern.persona.humour.lean === 'cheeky' && pattern.shared === true && !('dials' in pattern.persona), pattern.persona)
    await page.evaluate(() => window.villagerSetup.sendOff())
    await until(page, ['empty'])

    await write(page, 'a [stub-fail] fox')
    await page.keyboard.press('Enter')
    await until(page, ['failed'])
    const f = await st(page)
    check('host: a model failure (422) leaves the table tidy and says so', !f.placed && /pattern didn't come together/.test(f.status) && f.walkers.length === 2, { status: f.status, walkers: f.walkers.length })
    check('host: no page errors', errors.length === 0, errors)
    await context.close()
  }
  {
    // It reloads for its maker, and is shared with Sam, a child, as cheeky in the host and the page.
    const again = await open('')
    const mine = await again.page.evaluate(() => window.villagerSetup.patterns())
    check('save: after a reload the saved pattern is back on the rack', mine.cards.some((c) => c.source === 'mine' && c.humour === 'cheeky'), mine.cards)
    await again.context.close()
    // The URL asks for an opted-in adult; the page has no such flag and takes Sam's profile from the host.
    const sam = await open('&person=sam&profile=adult-optin')
    const seen = await sam.page.evaluate(() => window.villagerSetup.patterns())
    check('profile: the page takes the person\'s profile from the host, whatever the URL says', JSON.stringify((await st(sam.page)).profile) === JSON.stringify({ age: 'child' }), (await st(sam.page)).profile)
    const shared = seen.cards.find((c) => c.source === 'family')
    check('family: the shared pattern appears for another person, as saved', shared && shared.humour === 'cheeky', seen.cards)
    check('family: built-in templates for a child leave out the adults-only one', !seen.cards.some((c) => c.id === 'buddy') && seen.cards.some((c) => c.id === 'companion'), seen.cards.map((c) => c.id))
    await sam.page.click(`.vs-pattern[data-template="${shared.id}"]`)
    await sam.page.locator('.vs-slip .line').fill('a patient owl who helps with spelling')
    await sam.page.focus('.vs-slip .line')
    await sam.page.keyboard.press('Enter')
    await until(sam.page, ['tuning', 'failed'])
    const s = await st(sam.page)
    check('family: Sam\'s villager takes the shared pattern\'s manner (blunt), cheeky at most', /^blunt/.test(s.persona?.temperament ?? '') && s.persona.humour.lean === 'cheeky' && s.values.humour === 0.5, { persona: s.persona, values: s.values })
    await sam.page.evaluate(() => window.villagerSetup.set('humour', 1))
    check('family: pushing the dial to crude for a child stays cheeky, with &profile=adult-optin in the URL', (await st(sam.page)).values.humour === 0.5)
    await sam.page.evaluate(() => window.villagerSetup.sendOff())
    await until(sam.page, ['empty'])
    await sam.context.close()
  }
  {
    // Kit has no profile on the host: unknown, so crude stays locked.
    const kit = await open(`&from=${FROM}&person=kit&profile=adult-optin`)
    await kit.page.evaluate(() => window.villagerSetup.patterns())
    await kit.page.evaluate(() => window.villagerSetup.start(''))
    await until(kit.page, ['tuning'])
    await kit.page.evaluate(() => window.villagerSetup.set('humour', 1))
    const k = await st(kit.page)
    check('profile: a person the host has no profile for is unknown, and the dial stops at cheeky', k.profile?.age === 'unknown' && k.values.humour === 0.5, { profile: k.profile, humour: k.values.humour })
    await kit.context.close()
  }

  // ── Repair: the home's checks refuse the first module; one remake with the reason ──
  {
    const { context, page, errors } = await open('')
    await page.locator('.vs-slip .line').fill('a [stub-mark-head] giraffe who reads bedtime stories')
    await page.keyboard.press('Enter')
    await page.waitForFunction(() => /re-cut/.test(window.villagerSetup.state().status), null, { timeout: 15000 })
    const r = await st(page)
    check('repair: when the checks refuse a live module, the table says a piece is being re-cut, still counting', r.state === 'waiting' && /One piece didn't sit right, so it's being re-cut… \d+ s/.test(r.status) && /head itself is tagged with villager\.mark\(\)/.test(r.refusal), { status: r.status, refusal: r.refusal })
    await until(page, ['tuning', 'failed'])
    const s = await st(page)
    const files = await readdir(join(root, 'people', 'alex', 'villagers'))
    const records = await Promise.all(files.map(async (f) => JSON.parse(await readFile(join(root, 'people', 'alex', 'villagers', f), 'utf8'))))
    const record = records.find((x) => x.description.includes('giraffe'))
    check('repair: the remade module is stitched, and the host keeps the reason and the first module', s.state === 'tuning' && s.timings.repaired === 1 && record?.repair?.reason === r.refusal && record.repair.previous.includes("villager.mark(villager.tag(new THREE.Group(), 'head'))") && !record.module.includes('villager.mark(villager.tag'), { state: s.state, failure: s.failure, repair: record?.repair?.reason })
    check('repair: no page errors', errors.length === 0, errors)
    await context.close()
  }
  {
    // The host's persona check refuses the first persona (a crude lean): one remake with that reason.
    const { context, page, errors } = await open('&person=kit')
    await page.locator('.vs-slip .line').fill('a [stub-bad-persona] vole who sorts the post')
    await page.keyboard.press('Enter')
    await until(page, ['tuning', 'failed'])
    const s = await st(page)
    check('repair: a persona the host refused is remade once with the check\'s reason, and the repaired one is used', s.state === 'tuning' && s.timings.repaired === 1 && /humour\.lean is clean or cheeky/.test(s.refusal) && s.persona?.name === 'Biscuit', { state: s.state, refusal: s.refusal, failure: s.failure })
    check('repair (persona): no page errors', errors.length === 0, errors)
    await context.close()
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
    // Up to two model calls (the make and, if the checks refuse it, one remake) and the stitching.
    await until(page, ['tuning', 'failed'], 420000)
    const s = await st(page)
    // Keep what the model wrote and why it was refused before the throwaway root goes.
    const liveDir = join(root, 'people', 'alex', 'villagers')
    const liveRecords = await Promise.all((await readdir(liveDir)).map(async (f) => JSON.parse(await readFile(join(liveDir, f), 'utf8'))))
    const liveRecord = liveRecords.find((x) => x.description === text)
    if (liveRecord) {
      const keep = shots ?? join(homeDir, 'generated/villagers')
      await writeFile(join(keep, 'live-record.json'), JSON.stringify({ ...liveRecord, wallMs: Date.now() - t0, state: s.state, failure: s.failure, refusal: s.refusal, timings: s.timings }, null, 1))
      console.log(`live record kept in ${join(keep, 'live-record.json')}`)
    }
    await page.waitForTimeout(1500)
    await shot(page, 'live-tuning')
    check('live: Sonnet writes the villager, it is stitched on the table (after at most one remake)', s.state === 'tuning', { text, wallMs: Date.now() - t0, state: s.state, name: s.name, failure: s.failure, refusal: s.refusal, timings: s.timings, pieces: s.pieces, firstCostUsd: liveRecord?.costUsd, firstMs: liveRecord?.ms, remake: liveRecord?.repair ? { ms: liveRecord.repair.ms, costUsd: liveRecord.repair.costUsd, outputTokens: liveRecord.repair.outputTokens } : null })
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
