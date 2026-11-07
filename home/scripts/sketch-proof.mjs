// Real-model proof of sketching (#42): starts a real villager host (Claude through the
// Agent SDK on the operator's login) and a dev server on a throwaway VILLAGE_ROOT,
// draws sketches programmatically as stroke paths, and makes or gives them.
// Usage: node scripts/sketch-proof.mjs <out-dir> [--six] [--story] [--video] [--judge] [--dev=5500] [--host=5501]
//   --six    the six sketches through the vision maker: latency, cost, first-try validity, captures
//   --story  pen mode, pinned beside the ghost, the prop, handing a doodle to Moss, ?q=low; and the injection sketch
//   --video  record --story as a 1280x800 clip (out-dir/video/*.webm)
//   --judge  a fresh `claude -p --model opus` per sketch, given the sketch and the result only
import { spawn } from 'node:child_process'
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { DOODLE, INJECTION, SKETCHES, drawWithMouse } from './sketches.mjs'

const args = process.argv.slice(2)
const out = resolve(args.find((a) => !a.startsWith('--')) ?? 'sketch-proof')
const opt = (name) => args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3)
const has = (name) => args.includes(`--${name}`)
const homeDir = join(dirname(fileURLToPath(import.meta.url)), '..')
const hostDir = join(homeDir, '..', 'host')
const devPort = Number(opt('dev') ?? 5500), hostPort = Number(opt('host') ?? 5501)
const base = `http://localhost:${devPort}/`
await mkdir(join(out, 'shots'), { recursive: true })
const resultsFile = join(out, 'results.json')
const results = existsSync(resultsFile) ? JSON.parse(readFileSync(resultsFile, 'utf8')) : {}
const save = () => writeFileSync(resultsFile, JSON.stringify(results, null, 1))

const children = new Set()
function run(cmd, argv, cwd, env, ready) {
  const child = spawn(cmd, argv, { cwd, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'], detached: true })
  children.add(child)
  child.on('exit', () => children.delete(child))
  return new Promise((done, fail) => {
    let s = ''
    const timer = setTimeout(() => fail(new Error(`${cmd} did not start: ${s.slice(-400)}`)), 60_000)
    child.stdout.on('data', (d) => {
      s += d
      if (ready.test(s)) {
        clearTimeout(timer)
        done(child)
      }
    })
    child.stderr.on('data', (d) => (s += d))
  })
}
const stop = (child) => new Promise((done) => {
  if (!children.has(child)) return done()
  child.once('exit', done)
  process.kill(-child.pid, 'SIGTERM')
})

async function judge(name) {
  const r = results[name]
  const shots = join(out, 'shots')
  const schema = JSON.stringify({ type: 'object', properties: { recognisable: { type: 'integer' }, belongs: { type: 'integer' }, reason: { type: 'string' } }, required: ['recognisable', 'belongs', 'reason'] })
  const ask = `Read the images ${shots}/${r.slug}-sketch.png and ${shots}/${r.slug}-close.jpg. The first is a person's quick pen sketch of a piece of furniture or decor, with their words on it. The second shows a home scene with the 3D item that was made from that sketch; the view centres on it. Score each 1-10: recognisable = is the item recognisably what the sketch draws (shape, proportions, drawn details and the words)? belongs = does the item look like it belongs in this painterly home? Give one short reason.`
  return new Promise((done) => {
    const child = spawn('claude', ['-p', '--model', 'opus', '--strict-mcp-config', '--tools', 'Read', '--allowedTools', 'Read', '--add-dir', shots, '--output-format', 'json', '--no-session-persistence', '--json-schema', schema], { cwd: shots })
    let s = ''
    child.stdout.on('data', (d) => (s += d))
    child.on('close', () => {
      try {
        const j = JSON.parse(s)
        done({ ...j.structured_output, costUsd: j.total_cost_usd })
      } catch {
        done({ error: s.slice(0, 200) })
      }
    })
    child.stdin.end(ask)
  })
}

if (has('judge') && !has('six') && !has('story')) {
  for (const name of Object.keys(results).filter((n) => results[n].slug && results[n].ok)) {
    results[name].judge = await judge(name)
    console.log(name, JSON.stringify(results[name].judge))
    save()
  }
  process.exit(0)
}

const root = await mkdtemp(join(tmpdir(), 'village-sketch-proof-'))
await run('node', ['src/villager-cli.ts', '--port', String(hostPort), '--root', root], hostDir, { VILLAGER_PEOPLE: 'alex:Alex,sam:Sam,mia:Mia' }, /listening on/)
await run('npx', ['vite', '--port', String(devPort), '--strictPort'], homeDir, { VILLAGE_ROOT: root, VILLAGER_PORT: String(hostPort) }, /Local:/)
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu', '--use-angle=metal'] })
const state = (page) => page.evaluate(() => window.village.talk.state())
async function until(page, test, ms = 30_000, every = 100) {
  const end = Date.now() + ms
  let s
  do {
    s = await state(page)
    if (test(s)) return s
    await page.waitForTimeout(every)
  } while (Date.now() < end)
  return s
}
async function openPage(page, query) {
  await page.goto(base + query)
  await page.evaluate(() => window.village.ready())
  await page.waitForTimeout(2500)
}
const shot = (page, name) => page.screenshot({ path: join(out, 'shots', `${name}.jpg`), quality: 90 })
/** Frame the last placed piece close up, as the props experiment's focus does. */
async function focusPlaced(page) {
  await page.evaluate(() => {
    const scene = window.village.kernel.root.get('stage').scene
    const group = scene.getObjectByName('talk furnishing')
    const placed = group.children.filter((o) => o.name.startsWith('talk furnishing ') && o.name !== 'talk furnishing ghost').at(-1)
    placed.updateWorldMatrix(true, true)
    let min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity]
    placed.traverse((o) => {
      if (!o.isMesh) return
      o.geometry.computeBoundingBox()
      const b = o.geometry.boundingBox.clone().applyMatrix4(o.matrixWorld)
      min = min.map((v, i) => Math.min(v, b.min.getComponent(i)))
      max = max.map((v, i) => Math.max(v, b.max.getComponent(i)))
    })
    const c = min.map((v, i) => (v + max[i]) / 2)
    const r = Math.max(0.3, Math.hypot(...max.map((v, i) => v - min[i])) / 2)
    const V = window.village.kernel.root.get('stage').camera.position.constructor
    const centre = new V(...c)
    const dir = new V(0.45, 0.5, 1).normalize()
    window.village.kernel.root.get('view').focus({ position: centre.clone().addScaledVector(dir, r * 2.6 + 0.4), look: centre }, 60)
  })
  await page.waitForTimeout(2200)
}

try {
  if (has('six')) {
    const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage()
    page.on('pageerror', (e) => console.error('page error', String(e)))
    await openPage(page, '?talk=npc&q=high')
    const only = opt('only')
    for (const [name, sketch] of Object.entries(SKETCHES).filter(([n]) => !only || only.split(',').includes(n))) {
      const slug = name.replace(/\s+/g, '-')
      await page.evaluate(() => window.village.talk.sketch.open(true))
      const opened = await until(page, (x) => x.input.padScale > 1.4, 5000)
      if (!opened.sketch.sketching) console.error('not sketching after open', JSON.stringify({ mode: opened.mode, input: { raise: opened.input.raise, padVisible: opened.input.padVisible, scale: opened.input.padScale } }))
      await drawWithMouse(page, sketch)
      const drawn = await state(page)
      console.error(name, 'drawn', drawn.sketch.strokes, drawn.sketch.sketching)
      await page.keyboard.type(sketch.words)
      await page.waitForTimeout(300)
      await shot(page, `${slug}-pen`)
      const t0 = Date.now()
      await page.keyboard.press('Enter')
      const n = (await state(page)).sketch.results.length
      await page.waitForTimeout(3500)
      await shot(page, `${slug}-ghost`)
      const s = await until(page, (x) => x.sketch.results.length > n, 180_000, 250)
      const r = s.sketch.results.at(-1)
      const timing = s.input.furnish.timings.at(-1)
      const ms = Date.now() - t0
      // The drawing the host was given, for the judge.
      const index = (await readFile(join(root, 'people', 'alex', 'sketches.jsonl'), 'utf8')).trim().split('\n').map((l) => JSON.parse(l)).filter((e) => e.drawn)
      await copyFile(join(root, 'people', 'alex', 'sketches', `${index.at(-1).id}.png`), join(out, 'shots', `${slug}-sketch.png`))
      const item = r?.item ? JSON.parse(await readFile(join(root, 'people', 'alex', 'library', `${r.item}.json`), 'utf8')) : null
      results[name] = { slug, words: sketch.words, ok: Boolean(r?.ok), why: r?.why, enterToPlacedMs: ms, makeMs: timing?.makeMs, boxMs: timing?.boxMs, costUsd: timing?.costUsd, name: item?.name, models: item?.models }
      if (item) await writeFile(join(out, 'shots', `${slug}-module.js`), item.module)
      console.log(name, JSON.stringify(results[name]))
      save()
      if (r?.ok) {
        await page.waitForTimeout(800)
        await focusPlaced(page)
        await shot(page, `${slug}-close`)
        await page.evaluate(() => window.village.kernel.root.get('view').focus(null))
        await page.waitForTimeout(1200)
        await shot(page, `${slug}-placed`)
        await page.evaluate(() => window.village.talk.undo())
      }
      await page.waitForTimeout(500)
    }
    await page.context().close()
  }

  if (has('story')) {
    const video = has('video')
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, ...(video ? { recordVideo: { dir: join(out, 'video'), size: { width: 1280, height: 800 } } } : {}) })
    const page = await context.newPage()
    page.on('pageerror', (e) => console.error('page error', String(e)))
    await openPage(page, '?talk=npc&q=high')
    await page.waitForTimeout(1000)
    // Tap the pencil, draw a vase, write "blue glaze".
    const pencil = (await state(page)).sketch.pencil
    await page.mouse.move(pencil.x + pencil.width / 2, pencil.y + pencil.height / 2, { steps: 12 })
    await page.waitForTimeout(400)
    await page.mouse.click(pencil.x + pencil.width / 2, pencil.y + pencil.height / 2)
    await until(page, (x) => x.input.padScale > 1.6, 5000)
    await page.waitForTimeout(400)
    await drawWithMouse(page, SKETCHES.vase, { delay: 6 })
    await page.keyboard.type('blue glaze, about 30 cm', { delay: 45 })
    await page.waitForTimeout(500)
    await shot(page, 'story-1-pen')
    const t0 = Date.now()
    await page.keyboard.press('Enter')
    await page.waitForTimeout(2600)
    await shot(page, 'story-2-ghost')
    let s = await until(page, (x) => x.sketch.results.length > 0, 180_000, 250)
    results.story = { make: { ...s.sketch.results.at(-1), enterToPlacedMs: Date.now() - t0, timing: s.input.furnish.timings.at(-1) } }
    console.log('story make', JSON.stringify(results.story.make))
    await page.waitForTimeout(1500)
    await shot(page, 'story-3-placed')
    await page.evaluate(() => window.village.talk.keep())
    // Talk to Moss and hand over a doodle.
    await page.keyboard.type('I want to chat with Moss', { delay: 40 })
    await page.keyboard.press('Enter')
    await until(page, (x) => x.mode === 'talk' && x.partner === 'mia' && !x.pending && !x.input.routing, 30_000)
    await page.waitForTimeout(2500)
    await page.evaluate(() => window.village.talk.sketch.open(true))
    await until(page, (x) => x.input.padScale > 1.2, 5000)
    await drawWithMouse(page, DOODLE, { delay: 6 })
    await page.keyboard.type('a sunflower for your window', { delay: 40 })
    await page.waitForTimeout(400)
    const g0 = Date.now()
    await page.keyboard.press('Enter')
    await page.waitForTimeout(1300)
    s = await until(page, (x) => x.cards.mia?.finished && !x.pending, 60_000, 200)
    results.story.give = { ms: Date.now() - g0, reply: s.cards.mia?.text }
    console.log('story give', JSON.stringify(results.story.give))
    await page.waitForTimeout(1200)
    await shot(page, 'story-4-moss')
    await page.waitForTimeout(2500)
    save()
    // The injection sketch, given to Moss: an in-character answer, no route; then made: a prop through the sandbox.
    if (!video) {
      await page.evaluate(() => window.village.talk.sketch.open(true))
      await until(page, (x) => x.input.padScale > 1.2, 5000)
      await drawWithMouse(page, INJECTION)
      await page.keyboard.type(INJECTION.words)
      await page.keyboard.press('Enter')
      s = await until(page, (x) => x.sketch.results.length >= 2 && x.cards.mia?.finished && !x.pending, 60_000, 200)
      const miaLog = (await readFile(join(root, 'people', 'mia', 'conversation.jsonl'), 'utf8')).trim().split('\n').map((l) => JSON.parse(l))
      const samLog = await readFile(join(root, 'people', 'sam', 'conversation.jsonl'), 'utf8').catch(() => '')
      results.injection = { give: { reply: s.cards.mia?.text, route: miaLog.at(-1)?.route ?? null, samLines: samLog.trim() ? samLog.trim().split('\n').length : 0 } }
      await page.keyboard.press('Escape')
      await page.keyboard.press('Escape')
      await until(page, (x) => x.mode === 'room', 5000)
      await page.keyboard.type('what should we have for lunch?')
      await page.keyboard.press('Enter')
      s = await until(page, (x) => x.cards.alex?.finished && !x.pending && !x.input.routing, 60_000, 200)
      results.injection.next = { to: s.partner, reply: s.cards.alex?.text, samLines: ((await readFile(join(root, 'people', 'sam', 'conversation.jsonl'), 'utf8').catch(() => '')).trim() || '').split('\n').filter(Boolean).length }
      await page.keyboard.press('Escape')
      await page.keyboard.press('Escape')
      await until(page, (x) => x.mode === 'room', 5000)
      await page.evaluate(() => window.village.talk.sketch.open(true))
      await until(page, (x) => x.input.padScale > 1.4, 5000)
      await drawWithMouse(page, INJECTION)
      await page.keyboard.type(INJECTION.words)
      await page.keyboard.press('Enter')
      const n = (await state(page)).sketch.results.length
      s = await until(page, (x) => x.sketch.results.length > n, 180_000, 250)
      results.injection.make = { ...s.sketch.results.at(-1), source: s.input.furnish.timings.at(-1)?.source, routes: s.input.routes.length }
      const item = s.sketch.results.at(-1)?.item
      if (item) await writeFile(join(out, 'shots', 'injection-module.js'), JSON.parse(await readFile(join(root, 'people', 'alex', 'library', `${item}.json`), 'utf8')).module)
      console.log('injection', JSON.stringify(results.injection))
      await shot(page, 'injection-placed')
      save()
      // Low quality: pen mode.
      await openPage(page, '?talk=npc&q=low')
      await page.evaluate(() => window.village.talk.sketch.open(true))
      await until(page, (x) => x.input.padScale > 1.4, 5000)
      await drawWithMouse(page, SKETCHES.lamp)
      await page.keyboard.type(SKETCHES.lamp.words)
      await page.waitForTimeout(400)
      await shot(page, 'story-5-low')
    }
    await context.close()
  }
  if (has('judge')) {
    for (const name of Object.keys(results).filter((n) => results[n].slug && results[n].ok)) {
      results[name].judge = await judge(name)
      console.log(name, JSON.stringify(results[name].judge))
      save()
    }
  }
} finally {
  await browser.close()
  for (const child of [...children]) await stop(child)
  // Usage, as the host logged it, then the throwaway root goes.
  const usage = {}
  for (const person of await readdir(join(root, 'people')).catch(() => [])) usage[person] = await readFile(join(root, 'people', person, 'usage.jsonl'), 'utf8').catch(() => '')
  results.usage = usage
  save()
  await rm(root, { recursive: true, force: true })
}
