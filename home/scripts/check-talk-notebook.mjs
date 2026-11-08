// Headless proof of the richer notebook behind ?talk=notebook (#42 prototype).
// Starts its own villager host with the stub agent (no model is called) and its
// own dev server, both on a throwaway VILLAGE_ROOT, and stops them at the end.
// Usage: node scripts/check-talk-notebook.mjs [--shot=dir] [--dev=5184] [--host=5193]
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const args = process.argv.slice(2)
const shot = args.find((a) => a.startsWith('--shot='))?.slice(7)
const homeDir = join(dirname(fileURLToPath(import.meta.url)), '..')
const hostDir = join(homeDir, '..', 'host')
const root = await mkdtemp(join(tmpdir(), 'talk-notebook-'))
// #40: the page takes its person's token from the link the host prints (#token=…), never from the dev server.
const tokenNow = async () => JSON.parse(await readFile(join(root, 'villager', 'launch.json'), 'utf8')).tokens.alex
const link = async (url) => `${url}#token=${await tokenNow()}`
const opt = (name) => args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3)
const hostPort = Number(opt('host') ?? 5193)
const devPort = Number(opt('dev') ?? 5184)
const base = `http://localhost:${devPort}/`
const checks = []
const check = (name, pass, detail) => {
  checks.push({ name, pass: Boolean(pass), detail })
  console.log(`${pass ? 'pass' : 'FAIL'}  ${name}${pass ? '' : `  ${JSON.stringify(detail)}`}`)
}
const children = new Set()

function run(cmd, argv, cwd, env, ready) {
  const child = spawn(cmd, argv, { cwd, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'], detached: true })
  children.add(child)
  child.on('exit', () => children.delete(child))
  return new Promise((resolve, reject) => {
    let out = ''
    const timer = setTimeout(() => reject(new Error(`${cmd} did not start: ${out.slice(-400)}`)), 30_000)
    const onData = (d) => {
      out += d
      if (ready.test(out)) {
        clearTimeout(timer)
        resolve(child)
      }
    }
    child.stdout.on('data', onData)
    child.stderr.on('data', onData)
    child.on('exit', (code) => reject(new Error(`${cmd} exited ${code}: ${out.slice(-400)}`)))
  })
}
const stop = (child) => new Promise((resolve) => {
  if (!children.has(child)) return resolve()
  child.once('exit', resolve)
  process.kill(-child.pid, 'SIGTERM')
})
const conversationFile = () => readFile(join(root, 'people', 'alex', 'conversation.jsonl'), 'utf8').then((s) => s.trim().split('\n').map((l) => JSON.parse(l)), () => [])

await run('node', ['src/villager-cli.ts', '--agent', 'stub', '--port', String(hostPort), '--root', root], hostDir, {}, /listening on/)
await run('npx', ['vite', '--port', String(devPort), '--strictPort'], homeDir, { VILLAGE_ROOT: root, VILLAGER_PORT: String(hostPort) }, /Local:/)
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu', '--use-angle=metal'] })

const flagged = `${base}?talk=notebook&q=low`
const voice = (page) => page.evaluate(() => {
  const el = document.querySelector('[data-talk]')
  return { state: el?.dataset.talk, text: el?.textContent }
})
const pageImage = (page, side) => page.evaluate((s) => window.village.kernel.root.get('stage').scene.getObjectByName(`talk ${s} page`).material.map.image.toDataURL(), side)
const cam = (page) => page.evaluate(() => window.village.kernel.root.get('stage').camera.position.toArray())
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])
/** Screen point of a named object's centre, or of a point on the right page at canvas (x, y) px. */
const screenOf = (page, target) => page.evaluate((t) => {
  const { scene, camera } = window.village.kernel.root.get('stage')
  const THREE = camera.position.constructor
  let p
  if (t.name) p = scene.getObjectByName(t.name).getWorldPosition(new THREE())
  else {
    const mesh = scene.getObjectByName('talk right page')
    mesh.geometry.computeBoundingBox()
    const box = mesh.geometry.boundingBox
    const u = t.x / 1024, v = 1 - t.y / 1412
    p = mesh.localToWorld(new THREE(box.min.x + u * (box.max.x - box.min.x), box.max.y, box.max.z - v * (box.max.z - box.min.z)))
  }
  p.project(camera)
  return { x: ((p.x + 1) / 2) * innerWidth, y: ((1 - p.y) / 2) * innerHeight }
}, target)
const settle = (page, ms = 900) => page.waitForTimeout(ms)

try {
  // Without the flag nothing changes: the table's notebook is the notebook.
  {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } })
    const page = await context.newPage()
    await page.goto(await link(`${base}?q=low&talk=off&build=0`))
    const ready = await page.evaluate(() => window.village.ready())
    await settle(page)
    const s = await page.evaluate(() => {
      const scene = window.village.kernel.root.get('stage').scene
      // The closed book's extent, every visible part: its cloth spine once had a 1 m radius and drew a red arc through the table (#42).
    const book = scene.getObjectByName('talk notebook')
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity]
    book?.updateWorldMatrix(true, true)
    book?.traverse((o) => {
      if (!o.isMesh) return
      for (let x = o; x; x = x.parent) if (!x.visible) return
      o.geometry.computeBoundingBox()
      const b = o.geometry.boundingBox.clone().applyMatrix4(o.matrixWorld)
      for (let i = 0; i < 3; i++) { lo[i] = Math.min(lo[i], b.min.getComponent(i)); hi[i] = Math.max(hi[i], b.max.getComponent(i)) }
    })
    return { size: hi.map((h, i) => +(h - lo[i]).toFixed(3)), talk: Boolean(book), table: scene.getObjectByName('notebook')?.visible, entries: document.querySelectorAll('[data-entry="notebook"]').length, offscreen: document.querySelectorAll('.village-offscreen').length }
    })
    check('without the flag the table notebook is unchanged and the talk plugin adds nothing', ready.ok && !s.talk && s.table === true && s.entries === 1 && s.offscreen === 2, s)
    await context.close()
  }

  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  await page.goto(await link(flagged))
  await page.evaluate(() => localStorage.clear())
  await page.reload()
  const ready = await page.evaluate(() => window.village.ready())
  await settle(page, 1200)
  const scene0 = await page.evaluate(() => {
    const scene = window.village.kernel.root.get('stage').scene
    // The closed book's extent, every visible part: its cloth spine once had a 1 m radius and drew a red arc through the table (#42).
    const book = scene.getObjectByName('talk notebook')
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity]
    book?.updateWorldMatrix(true, true)
    book?.traverse((o) => {
      if (!o.isMesh) return
      for (let x = o; x; x = x.parent) if (!x.visible) return
      o.geometry.computeBoundingBox()
      const b = o.geometry.boundingBox.clone().applyMatrix4(o.matrixWorld)
      for (let i = 0; i < 3; i++) { lo[i] = Math.min(lo[i], b.min.getComponent(i)); hi[i] = Math.max(hi[i], b.max.getComponent(i)) }
    })
    return { size: hi.map((h, i) => +(h - lo[i]).toFixed(3)), talk: Boolean(book), table: scene.getObjectByName('notebook')?.visible, entries: document.querySelectorAll('[data-entry="notebook"]').length, closed: scene.getObjectByName('talk left half').rotation.z }
  })
  check('with the flag the talk notebook takes the table book\'s place, closed, as the one notebook entry', ready.ok && scene0.talk && scene0.table === false && scene0.entries === 1 && Math.abs(scene0.closed + Math.PI) < 0.01, { ready: ready.ok, ...scene0 })
  check('the closed book is book-sized: no part reaches past its covers (under 0.8 m across, 0.1 m tall)', scene0.size[0] < 0.8 && scene0.size[1] < 0.1 && scene0.size[2] < 0.8, scene0.size)

  // Open with the keyboard: Tab to the notebook, Enter.
  const seat = await cam(page)
  for (let i = 0; i < 8 && (await page.evaluate(() => document.activeElement?.dataset?.entry)) !== 'notebook'; i++) await page.keyboard.press('Tab')
  await page.keyboard.press('Enter')
  await page.waitForTimeout(250)
  const midOpen = await page.evaluate(() => window.village.kernel.root.get('stage').scene.getObjectByName('talk left half').rotation.z)
  await settle(page, 1600)
  const opened = await page.evaluate(() => ({ z: window.village.kernel.root.get('stage').scene.getObjectByName('talk left half').rotation.z, focused: document.activeElement?.tagName, label: document.activeElement?.getAttribute('aria-label') }))
  const framed = await cam(page)
  check('Tab and Enter open the book: the cover swings and the camera eases down', midOpen > -Math.PI + 0.05 && midOpen < -0.05 && opened.z === 0 && dist(seat, framed) > 1 && opened.focused === 'INPUT' && /Alex's villager/.test(opened.label), { midOpen, opened, moved: dist(seat, framed) })
  if (shot) await page.screenshot({ path: join(shot, 'check-open.png') })

  // Switch villager with the keyboard: a real page turn, and June's page says she is not awake.
  const before = await pageImage(page, 'right')
  await page.keyboard.press('ArrowRight')
  await page.waitForTimeout(150)
  const turning = await page.evaluate(() => [0, 1, 2, 3].filter((k) => window.village.kernel.root.get('stage').scene.getObjectByName(`talk sheet ${k}`).visible).length)
  await settle(page)
  const june = await voice(page)
  const afterTurn = await page.evaluate(() => [0, 1, 2, 3].some((k) => window.village.kernel.root.get('stage').scene.getObjectByName(`talk sheet ${k}`).visible))
  check('ArrowRight turns several pages to June, whose page says she is not awake', turning >= 2 && !afterTurn && /June/.test(june.text) && /Not awake/.test(june.text) && (await pageImage(page, 'right')) !== before, { turning, afterTurn, june })
  await page.keyboard.type('hello')
  const typedAsleep = await page.evaluate(() => document.querySelector('input.village-offscreen').value)
  check('nothing can be written to a villager that is not awake', typedAsleep === '', typedAsleep)

  // Switch villager with the pointer: click Alex's ribbon tag.
  const tag = await screenOf(page, { name: 'talk tag alex' })
  await page.mouse.click(tag.x, tag.y)
  await settle(page)
  const alex = await voice(page)
  check('clicking Alex\'s ribbon tag turns back to Alex', /^Alex's pages/.test(alex.text), alex)

  // Write a line: the stub villager's reply is written gradually onto the page.
  await page.keyboard.type('I keep forgetting to water the plants')
  await page.keyboard.press('Enter')
  const states = new Set()
  const started = Date.now()
  while (Date.now() - started < 30_000) {
    states.add(await pageImage(page, 'right'))
    if ((await voice(page)).state !== 'writing') break
    await page.waitForTimeout(100)
  }
  // The pen nib blinks, so wait for the reply to finish rather than for a still page.
  for (let still = 0, last = null, until = Date.now() + 8000; still < 12 && Date.now() < until; ) {
    const now = await pageImage(page, 'right')
    still = now === last ? still + 1 : 0
    last = now
    states.add(now)
    await page.waitForTimeout(100)
  }
  const answered = await voice(page)
  const convo = await conversationFile()
  check('Enter sends the line and the reply is written onto the page', answered.state === 'answered' && convo.at(-1)?.from === 'villager' && answered.text === convo.at(-1).text && convo.at(-2)?.text === 'I keep forgetting to water the plants', { answered, last: convo.at(-1) })
  check('the reply appears gradually, as if written', states.size >= 8, { distinctPages: states.size })

  // #42 fix 12: a reply cut short (the stream ends with no "done"): the host has the line, so it is not kept to send again.
  await page.route('**/messages', async (r) => {
    const response = await r.fetch()
    const body = (await response.text()).split('\n\n').filter((block) => !/^event: done$/m.test(block)).join('\n\n')
    return r.fulfill({ response, body })
  })
  await page.keyboard.type('Tell me about bread')
  await page.keyboard.press('Enter')
  let cut = await voice(page)
  for (const end = Date.now() + 15_000; (cut.state === 'writing' || cut.state === 'answered') && Date.now() < end; cut = await voice(page)) await page.waitForTimeout(100)
  await page.unroute('**/messages')
  const unsent = await page.evaluate(() => JSON.parse(localStorage.getItem('village.talk.unsent') ?? '[]'))
  const bread = (await conversationFile()).filter((l) => l.from === 'person' && l.text === 'Tell me about bread')
  check('#42 fix 12: a reply cut short says so and is not kept as unsent (so history shows it once); the host has the line once', cut.state === 'cut' && /cut short/.test(cut.text) && !unsent.some((u) => u.text === 'Tell me about bread') && bread.length === 1, { cut, unsent, bread: bread.length })
  if (shot) await page.screenshot({ path: join(shot, 'check-replied.png') })

  // Tasks: ArrowDown opens the Tasks tab; tick one with the keyboard and one with the pointer.
  await page.keyboard.press('ArrowDown')
  await settle(page)
  const tasksVoice = await voice(page)
  for (let i = 0; i < 6; i++) await page.keyboard.press('Tab') // three ribbons, two tabs, then the first task
  const focused = await voice(page)
  await page.keyboard.press('Enter')
  const row = await screenOf(page, { x: 400, y: 200 + 70 * 2 + 35 }) // the second task's row
  await page.mouse.click(row.x, row.y)
  await page.waitForTimeout(200)
  const ticked = await page.evaluate(() => JSON.parse(localStorage.getItem('village.talk.tasks') ?? '{}'))
  check('ArrowDown turns to Tasks; Tab and Enter tick one task, a click ticks another', /tasks/.test(tasksVoice.text) && /Water the fern/.test(focused.text) && ticked['alex.fern'] && ticked['alex.books'] && Object.keys(ticked).length === 2, { tasksVoice, focused, ticked })
  if (shot) await page.screenshot({ path: join(shot, 'check-tasks.png') })

  // Escape closes the book and gives focus back to the notebook entry.
  await page.keyboard.press('Escape')
  await settle(page, 2200)
  const closed = await page.evaluate(() => ({ z: window.village.kernel.root.get('stage').scene.getObjectByName('talk left half').rotation.z, focus: document.activeElement?.dataset?.entry }))
  check('Escape closes the book and the camera eases back to the seat', Math.abs(closed.z + Math.PI) < 0.01 && closed.focus === 'notebook' && dist(await cam(page), seat) < 0.2, closed)

  // Reload: ticks, the last answer and the place in the book survive.
  await page.reload()
  await page.evaluate(() => window.village.ready())
  await settle(page, 1500)
  const kept = await page.evaluate(() => ({ ticks: JSON.parse(localStorage.getItem('village.talk.tasks') ?? '{}'), at: JSON.parse(localStorage.getItem('village.talk.at') ?? '{}') }))
  const remembered = await voice(page)
  const lastAnswer = (await conversationFile()).filter((l) => l.from === 'villager').at(-1)
  check('after a reload the ticks, the place in the book and the last answer are kept', kept.ticks['alex.fern'] && kept.ticks['alex.books'] && kept.at.section === 'tasks' && remembered.state === 'remembered' && remembered.text === lastAnswer?.text, { kept, remembered })

  // Clean unload and load again.
  const snap = await page.evaluate(() => window.village.snapshot())
  await page.evaluate(() => window.village.unload('talkbook'))
  await page.waitForTimeout(300)
  const gone = await page.evaluate(() => {
    const scene = window.village.kernel.root.get('stage').scene
    return { s: window.village.snapshot(), talk: Boolean(scene.getObjectByName('talk notebook')), table: scene.getObjectByName('notebook')?.visible, dom: document.querySelectorAll('.village-offscreen, [data-talk], [data-entry="notebook"]').length }
  })
  check('unloading removes the book, its controls, entry and frame hook, and gives the table book back', !gone.talk && gone.table === true && gone.dom === 0 && gone.s.frameHooks === snap.frameHooks - 1 && gone.s.geometries < snap.geometries, { gone: { ...gone, s: undefined }, hooks: [snap.frameHooks, gone.s.frameHooks], geometries: [snap.geometries, gone.s.geometries] })
  await page.evaluate(() => window.village.load('talkbook'))
  await settle(page)
  const again = await page.evaluate(() => {
    const scene = window.village.kernel.root.get('stage').scene
    // The closed book's extent, every visible part: its cloth spine once had a 1 m radius and drew a red arc through the table (#42).
    const book = scene.getObjectByName('talk notebook')
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity]
    book?.updateWorldMatrix(true, true)
    book?.traverse((o) => {
      if (!o.isMesh) return
      for (let x = o; x; x = x.parent) if (!x.visible) return
      o.geometry.computeBoundingBox()
      const b = o.geometry.boundingBox.clone().applyMatrix4(o.matrixWorld)
      for (let i = 0; i < 3; i++) { lo[i] = Math.min(lo[i], b.min.getComponent(i)); hi[i] = Math.max(hi[i], b.max.getComponent(i)) }
    })
    return { size: hi.map((h, i) => +(h - lo[i]).toFixed(3)), talk: Boolean(book), table: scene.getObjectByName('notebook')?.visible, frameHooks: window.village.snapshot().frameHooks, entries: document.querySelectorAll('[data-entry="notebook"]').length }
  })
  check('loading it again restores it', again.talk && again.table === false && again.frameHooks === snap.frameHooks && again.entries === 1, again)
  check('no page errors', errors.length === 0, errors)
  await context.close()
} finally {
  await browser.close()
  for (const child of [...children]) await stop(child)
  check('host and dev server stopped', children.size === 0 && !existsSync(join(root, 'villager', 'launch.json')))
  await rm(root, { recursive: true, force: true })
}

const failed = checks.filter((c) => !c.pass).length
console.log(`${checks.length - failed} of ${checks.length} passed`)
process.exitCode = failed ? 1 : 0
