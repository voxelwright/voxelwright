// Headless proof of adding rooms by saying so (#48, ?talk=npc&build=1).
// Starts its own villager host (stub router and villagers by default) and dev
// server on a throwaway VILLAGE_ROOT, and stops both at the end.
// Usage: node scripts/check-build-addroom.mjs [--dev=5351] [--host=5352]
//   --look: screenshots/build/addroom-*.jpg (the outline, adjusted, close, the move-in's step through the door (reveal) and
//     its settled frame (built), the new doorway seated, the phone) and addroom.mp4.
//   --look --variant=<name>: a look prototype (&look=<name>, for a future regroup): the outline, reveal and built shots only,
//     as addroom-outline-<name>.jpg, addroom-reveal-<name>.jpg and addroom-built-<name>.jpg.
//   --agent=claude: add-room lines through the real router (?route=separate, Sonnet),
//     printing each routed intent, whether it matched, and Enter to outline (or to the question).
import { spawn, execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, rmSync, statSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const args = process.argv.slice(2)
const opt = (name) => args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3)
const agent = opt('agent') ?? 'stub'
const look = args.includes('--look')
/** --variant=<name>: a look prototype (?look=<name>), shot to addroom-outline-<name>.jpg and addroom-built-<name>.jpg only. */
const variant = opt('variant')
const shot = (name) => join(OUT, variant ? `addroom-${name}-${variant}.jpg` : `addroom-${name}.jpg`)
const homeDir = join(dirname(fileURLToPath(import.meta.url)), '..')
const hostDir = join(homeDir, '..', 'host')
const OUT = join(homeDir, 'screenshots', 'build')
mkdirSync(OUT, { recursive: true })
const root = await mkdtemp(join(tmpdir(), 'build-addroom-'))
const hostPort = Number(opt('host') ?? 5352)
const devPort = Number(opt('dev') ?? 5351)
const base = `http://localhost:${devPort}/`
const checks = []
const check = (name, pass, detail) => {
  checks.push({ name, pass: Boolean(pass), detail })
  console.log(`${pass ? 'ok  ' : 'FAIL'} ${name}${detail === undefined ? '' : `  ${JSON.stringify(detail)?.slice(0, 400)}`}`)
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

await run('node', ['src/villager-cli.ts', '--agent', agent, '--port', String(hostPort), '--root', root], hostDir, { VILLAGER_PEOPLE: 'alex:Alex,sam:Sam,mia:Mia' }, /listening on/)
await run('npx', ['vite', '--port', String(devPort), '--strictPort'], homeDir, { VILLAGE_ROOT: root, VILLAGER_PORT: String(hostPort) }, /Local:/)
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu', '--use-angle=metal', '--ignore-gpu-blocklist'] })

async function open(query, context) {
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  page.on('console', (m) => m.type() === 'error' && !/Failed to load resource/.test(m.text()) && errors.push(m.text()))
  // The moment Enter goes down, before any of the page's own handlers.
  await page.addInitScript(() => addEventListener('keydown', (e) => e.key === 'Enter' && (window.__enterAt = performance.now()), true))
  await page.goto(base + query)
  await page.evaluate(() => window.village.ready())
  await page.evaluate(() => window.villageBuild.history())
  await page.waitForTimeout(1500)
  return { page, errors }
}
const B = (page, fn, arg) => page.evaluate(fn, arg)
const state = (page) => B(page, () => {
  const b = window.villageBuild
  const snap = window.village.snapshot()
  return {
    draft: b.outline.draft(), rooms: b.plan().rooms.map((r) => r.id), floors: b.floors(), said: b.said(), selected: b.selected(),
    objects: snap.objects, geometries: snap.geometries, textures: snap.textures, card: window.village.talk?.state().cards.alex?.text ?? null,
  }
})
const versions = (page) => B(page, async () => (await window.villageBuild.history()).versions().map((v) => ({ id: v.id, note: v.note })))
async function until(page, test, ms = 5000, every = 16) {
  const end = Date.now() + ms
  let s
  do {
    s = await state(page)
    if (test(s)) return s
    await page.waitForTimeout(every)
  } while (Date.now() < end)
  return s
}
async function say(page, text, delay = 0) {
  await page.keyboard.type(text, { delay })
  await page.keyboard.press('Enter')
}
const frames = (page, n = 10) => page.evaluate((n) => new Promise((r) => { const s = () => (--n ? requestAnimationFrame(s) : r()); requestAnimationFrame(s) }), n)
async function drag(page, from, to, steps = 20) {
  await page.mouse.move(...from)
  await frames(page, 3)
  await page.mouse.down()
  await page.mouse.move(...to, { steps })
  await frames(page, 3)
  await page.mouse.up()
  // A changed room re-frames the view; let it settle before the next aim.
  await page.waitForTimeout(1300)
}
const grips = (page) => B(page, () => window.villageBuild.outline.grips() && (({ at, ...g }) => g)(window.villageBuild.outline.grips()))
const floorPoint = (page, along, across) => B(page, ([a, c]) => window.villageBuild.outline.grips().at(a, c), [along, across])
/** The yard as drawn at this moment: each instanced mesh's matrices, and the triangles each merged yard mesh draws. */
const yardNow = (page) => B(page, () => {
  const scene = window.village.kernel.root.get('stage').scene
  const fence = scene.getObjectByName('picket fence')
  const rail = fence.parent.children.find((c) => c.isMesh && c !== fence && c.material === fence.material)
  const out = {}
  for (const name of ['picket fence', 'yard blooms', 'stepping stones']) out[name] = Array.from(scene.getObjectByName(name).instanceMatrix.array).join(',')
  for (const [name, m] of [['rails', rail], ['yard plants', scene.getObjectByName('yard plants')]]) out[name] = m.geometry.index ? m.geometry.index.count : m.geometry.attributes.position.count
  return out
})
/** Yard things still drawn inside an added room or its walls: instance middles, and merged triangles by their middle. */
const yardInside = (page) => B(page, async () => {
  const P = await import('/src/build/plan.ts')
  const scene = window.village.kernel.root.get('stage').scene
  const p = window.villageBuild.plan()
  // The house's own rooms stand where diorama.ts drew no yard; only added rooms push it aside.
  const rings = p.rooms.filter((r) => r.id !== 'kitchen' && r.id !== 'living').map((r) => P.outline(p, r, -0.09))
  const inRing = (x, z) => rings.some((poly) => {
    let inn = false
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) if ((poly[i][1] > z) !== (poly[j][1] > z) && x < ((poly[j][0] - poly[i][0]) * (z - poly[i][1])) / (poly[j][1] - poly[i][1]) + poly[i][0]) inn = !inn
    return inn
  })
  const fence = scene.getObjectByName('picket fence')
  const M4 = fence.matrixWorld.constructor, V3 = fence.position.constructor
  const m4 = new M4(), v = new V3(), sc = new V3()
  const out = {}
  for (const name of ['picket fence', 'yard blooms', 'stepping stones']) {
    const m = scene.getObjectByName(name)
    m.updateMatrixWorld()
    let n = 0
    for (let i = 0; i < m.count; i++) {
      m.getMatrixAt(i, m4)
      sc.setFromMatrixScale(m4)
      v.setFromMatrixPosition(m4).applyMatrix4(m.matrixWorld)
      if (sc.x > 1e-6 && inRing(v.x, v.z)) n++
    }
    out[name] = n
  }
  const rail = fence.parent.children.find((c) => c.isMesh && c !== fence && c.material === fence.material)
  for (const [name, m] of [['rails', rail], ['yard plants', scene.getObjectByName('yard plants')]]) {
    const pos = m.geometry.attributes.position, idx = m.geometry.index
    const count = idx ? idx.count : pos.count
    let n = 0
    for (let t = 0; t + 2 < count; t += 3) {
      let x = 0, z = 0
      for (let j = 0; j < 3; j++) {
        v.fromBufferAttribute(pos, idx ? idx.getX(t + j) : t + j).applyMatrix4(m.matrixWorld)
        x += v.x / 3
        z += v.z / 3
      }
      if (inRing(x, z)) n++
    }
    out[name] = n
  }
  return { rooms: rings.length, out, total: Object.values(out).reduce((a, b) => a + b, 0) }
})
const LEFT = 'add a playroom to the left side, connected by double doors, 2/3 the size of the current room'
const STUDY = 'add a 4 by 3 metre study behind the living room'

try {
  if (agent === 'claude') {
    // ── Real model: the router (Sonnet), then the trusted resolver ──────────
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
    const { page, errors } = await open('?talk=npc&build=1&route=separate&q=low', context)
    const lines = [
      [LEFT, (i) => i?.anchor?.side === 'left' && Math.abs((i.size?.fraction ?? 0) - 2 / 3) < 0.01 && i.connect?.leaves === 2, true],
      ['add a 4 by 3 metre study behind the kitchen', (i) => i?.anchor?.side === 'behind' && i.size?.w === 4 && i.size?.d === 3 && /study/i.test(i.label ?? ''), false],
      ['put a small pantry on the right, about 3 by 2 metres', (i) => i?.anchor?.side === 'right' && i.size?.w === 3 && i.size?.d === 2 && /pantry/i.test(i.label ?? ''), true],
      ['add a bedroom in front of the kitchen with a single door', (i) => i?.anchor?.side === 'front' && /bedroom/i.test(i.label ?? '') && (i.connect?.leaves ?? 1) === 1, true],
      ['make a playroom to the right, half the size of this room, with an open archway', (i) => i?.anchor?.side === 'right' && Math.abs((i.size?.fraction ?? 0) - 0.5) < 0.01 && i.connect?.kind === 'opening', true],
      ['add a room', (i) => i && !i.anchor?.side, false],
      ['add a 5 by 4 metre office to the left of the kitchen with double doors', (i) => i?.anchor?.side === 'left' && i.size?.w === 5 && i.size?.d === 4 && i.connect?.leaves === 2 && /office/i.test(i.label ?? ''), true],
    ]
    const results = []
    for (const [text, right, drawn] of lines) {
      const before = (await state(page)).said.length
      await say(page, text)
      const s = await until(page, (x) => x.draft || x.said.length > before, 60_000, 50)
      const t = await B(page, () => ({ shown: window.villageBuild.outline.shownAt(), enter: window.__enterAt, now: performance.now() }))
      const routes = await B(page, () => window.village.talk.state().input.routes)
      const routed = await (await fetch(`http://127.0.0.1:${hostPort}/`).catch(() => null))
      void routed
      const last = routes.at(-1)
      const intent = await page.evaluate(() => window.__lastIntent ?? null)
      void intent
      results.push({ text, route: last?.route, routeMs: last?.ms, drawn: Boolean(s.draft), expectedDrawn: drawn, outlineMs: s.draft ? Math.round(t.shown - t.enter) : null, said: s.said.at(-1), draft: s.draft && { wall: s.draft.wallId, w: +(s.draft.to - s.draft.from).toFixed(1), d: s.draft.depth, leaves: s.draft.door.leaves ?? 'opening', label: s.draft.label } })
      if (s.draft) await B(page, () => window.villageBuild.outline.cancel())
      await page.waitForTimeout(400)
    }
    // The routed intents themselves, from the host's route log.
    const { readFile } = await import('node:fs/promises')
    const log = (await readFile(join(root, 'people', 'alex', 'routes.jsonl'), 'utf8').catch(() => '')).trim().split('\n').filter(Boolean).map((l) => JSON.parse(l))
    lines.forEach(([text, right], i) => {
      const entry = log.find((l) => l.text === text)
      results[i].intent = entry?.routed?.intent ?? entry?.refused ?? entry?.failed
      results[i].correct = entry?.routed?.route === 'build' && right(entry.routed.intent)
      results[i].models = entry?.models
    })
    console.log(JSON.stringify(results, null, 1))
    console.log(JSON.stringify({ correct: results.filter((r) => r.correct).length, of: results.length, errors }))
    await context.close()
  } else if (look) {
    // ── The look: screenshots and a clip ────────────────────────────────────
    const tmp = join(OUT, 'addroom-video-tmp')
    rmSync(tmp, { recursive: true, force: true })
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, ...(variant ? {} : { recordVideo: { dir: tmp, size: { width: 960, height: 600 } } }) })
    const { page } = await open(`?talk=npc&build=1&q=high${variant ? `&look=${encodeURIComponent(variant)}` : ''}`, context)
    await page.waitForTimeout(1200)
    // Open the notepad by its pad first: on a loaded machine the first stray key can be lost while the pad takes the keyboard.
    await page.click('.talk-pad').catch(() => {})
    await page.waitForTimeout(300)
    await say(page, LEFT, 35)
    await until(page, (x) => x.draft, 10_000)
    await page.waitForTimeout(1800)
    await page.screenshot({ path: shot('outline'), quality: 88, type: 'jpeg' })
    let g = await grips(page)
    const d0 = (await state(page)).draft
    await drag(page, g.far, await floorPoint(page, (d0.from + d0.to) / 2, d0.depth - 1), 40)
    await page.waitForTimeout(500)
    g = await grips(page)
    const d1 = (await state(page)).draft
    await drag(page, g.door, await floorPoint(page, (d1.door.from + d1.door.to) / 2 + 1, 0), 40)
    await page.waitForTimeout(500)
    await page.click('.build-dim[data-dim="w"]')
    await page.waitForTimeout(300)
    await page.keyboard.press('Backspace')
    await page.keyboard.type('4.5', { delay: 120 })
    await page.waitForTimeout(400)
    await page.keyboard.press('Enter')
    await page.waitForTimeout(700)
    g = await grips(page)
    const d2 = (await state(page)).draft
    await drag(page, g.bend, await floorPoint(page, (d2.from + d2.to) / 2, d2.depth - 0.55 + 0.8), 40)
    await page.waitForTimeout(900)
    if (!variant) await page.screenshot({ path: join(OUT, 'addroom-adjusted.jpg'), quality: 88, type: 'jpeg' })
    // Close: the wheel zooms the dollhouse in.
    if (!variant) {
    await page.mouse.move(520, 420)
    for (let i = 0; i < 6; i++) {
      await page.mouse.wheel(0, -240)
      await page.waitForTimeout(60)
    }
    await page.waitForTimeout(1600)
    await page.screenshot({ path: join(OUT, 'addroom-close.jpg'), quality: 88, type: 'jpeg' })
    for (let i = 0; i < 6; i++) {
      await page.mouse.wheel(0, 240)
      await page.waitForTimeout(60)
    }
    }
    await page.waitForTimeout(1200)
    await page.keyboard.press('Enter')
    // The move-in: the doorway step as the in-between shot, then its settled frame.
    const reveal = () => B(page, () => window.villageBuild.reveal?.().phase ?? null)
    if ((await reveal()) !== null) {
      const end = Date.now() + 25_000
      let crossed = false
      for (let p; (p = await reveal()) !== 'settled' && Date.now() < end;) {
        if (p === 'crossing' && !crossed) {
          crossed = true
          await page.screenshot({ path: shot('reveal'), quality: 88, type: 'jpeg' })
        }
        await page.waitForTimeout(40)
      }
      const r = await B(page, () => window.villageBuild.reveal())
      console.log(`reveal ${JSON.stringify(r)} crossed=${crossed}`)
      await page.waitForTimeout(1600)
    } else await page.waitForTimeout(2200)
    await page.screenshot({ path: shot('built'), quality: 88, type: 'jpeg' })
    await page.waitForTimeout(800)
    if (variant) {
      await context.close()
      console.log(`shots ${shot('outline')} ${shot('built')}`)
    } else {
    const video = page.video()
    await context.close()
    const webm = await video.path()
    const mp4 = join(OUT, 'addroom.mp4')
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', webm, '-vf', 'scale=960:-2', '-c:v', 'libx264', '-crf', '30', '-preset', 'medium', '-pix_fmt', 'yuv420p', mp4])
    rmSync(tmp, { recursive: true, force: true })
    console.log(`clip ${mp4} ${(statSync(mp4).size / 1e6).toFixed(2)} MB`)

    // The new doorway from inside the kitchen (seated view), framed on it.
    const doorContext = await browser.newContext({ viewport: { width: 1440, height: 900 } })
    const { page: dp } = await open('?build=1&q=high', doorContext)
    await B(dp, async () => {
      const P = await import('/src/build/plan.ts')
      const p = window.villageBuild.plan()
      const w = p.walls.find((x) => x.openings.some((o) => o.kind === 'door' && !o.id.startsWith('kitchen.')))
      const o = w.openings.find((x) => x.kind === 'door' && !x.id.startsWith('kitchen.'))
      const c = P.curveOf(p, w)
      const [x, z] = P.pointAt(c, (o.from + o.to) / 2)
      const root = window.village.kernel.root
      const V = root.get('stage').camera.position.constructor
      root.get('view').focus({ position: new V(x + 2.7, 1.75, z + 0.7), look: new V(x, 0.95, z) }, 50)
    })
    await dp.waitForTimeout(1500)
    await dp.screenshot({ path: join(OUT, 'addroom-door.jpg'), quality: 88, type: 'jpeg' })
    await doorContext.close()

    const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, deviceScaleFactor: 2 })
    const { page: tp } = await open('?talk=npc&build=1&q=low', phone)
    await B(tp, () => window.villageBuild.intent({ op: 'addRoom', label: 'study', anchor: { room: 'kitchen', side: 'right' }, size: { w: 4, d: 3 }, connect: { kind: 'door', leaves: 2 } }))
    await tp.waitForTimeout(2200)
    await tp.screenshot({ path: join(OUT, 'addroom-phone.jpg'), quality: 88, type: 'jpeg' })
    await phone.close()
    }
  } else {
    // ── Unit checks for the resolver, in the page's own modules ─────────────
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
    // ?route=separate: the stub router answers in about 30 ms; the default one-call path streams the stub villager's
    // ROUTE reply six letters at a time, which measures the stub, not the house.
    const { page, errors } = await open('?talk=npc&build=1&route=separate&q=low', context)
    const unit = await B(page, async () => {
      const P = await import('/src/build/plan.ts'), R = await import('/src/build/resolve.ts'), I = await import('/src/build/intent.ts')
      const K = P.HOUSE_PLAN
      // The default dollhouse view: yaw 0.6 rad off looking down -z.
      const view = [-Math.sin(0.6), -Math.cos(0.6)]
      const go = (plan, raw, ctx = {}) => {
        const c = I.checkIntent(raw)
        if ('reason' in c) return { reason: c.reason }
        // Looking into the kitchen, so "this room" is the kitchen (the house has two rooms).
        return R.resolve(plan, c.intent, { view, current: 'kitchen', ...ctx })
      }
      const out = {}
      const left = go(K, { op: 'addRoom', anchor: { room: 'this', side: 'left' }, size: { fraction: 2 / 3 }, connect: { kind: 'door', leaves: 2 } })
      out.left = { draft: left.draft, area: left.plan && P.roomArea(left.plan, left.draft.roomId), target: (2 / 3) * P.roomArea(K, 'kitchen'), valid: left.plan && P.validate(left.plan) }
      const study = go(K, { op: 'addRoom', label: 'study', anchor: { room: 'living room', side: 'behind' }, size: { w: 4, d: 3 } })
      out.study = { draft: study.draft, ask: study.ask, area: study.plan && P.roomArea(study.plan, 'study'), owner: study.draft && study.plan.rooms.filter((r) => P.roomWalls(study.plan, r).some(({ wall }) => wall.id === study.draft.wallId)).map((r) => r.id) }
      const sel = go(K, { op: 'addRoom', anchor: { wall: 'selected' }, connect: { kind: 'door', at: 'selected-point' } }, { selected: { wallId: 'kitchen.left', t: 2.0 } })
      out.selected = { ask: sel.ask, draft: sel.draft, doorCentre: sel.draft && (sel.draft.door.from + sel.draft.door.to) / 2 }
      out.asks = {
        noSide: go(K, { op: 'addRoom', anchor: {} }).ask,
        unknownRoom: go(K, { op: 'addRoom', anchor: { room: 'study', side: 'behind' }, size: { w: 4, d: 3 } }).ask,
        sharedWall: go(K, { op: 'addRoom', anchor: { side: 'right' } }).ask,
        sharedSelected: go(K, { op: 'addRoom', anchor: { wall: 'selected' } }, { selected: { wallId: 'kitchen.right', t: 1 } }).ask,
        windowInTheWay: go(K, { op: 'addRoom', label: 'pantry', anchor: { room: 'kitchen', side: 'behind' }, size: { w: 4, d: 3 } }).ask,
        curved: go(P.apply(K, { op: 'bendWall', wallId: 'kitchen.left', sagitta: 0.6 }), { op: 'addRoom', anchor: { side: 'left' } }).ask,
        overlap: (() => {
          // A den on the kitchen's left wall, a nook in front of the den, then a room on the rest of the left wall runs into the nook.
          const den = go(K, { op: 'addRoom', label: 'den', anchor: { wall: 'selected' }, size: { w: 3.6, d: 3 } }, { selected: { wallId: 'kitchen.left', t: 1.8 } })
          const nook = go(den.plan, { op: 'addRoom', label: 'nook', anchor: { wall: 'selected' }, size: { w: 2, d: 4 } }, { selected: { wallId: 'den.w3', t: 1 } })
          return go(nook.plan, { op: 'addRoom', anchor: { wall: 'selected' }, size: { w: 2, d: 3 } }, { selected: { wallId: 'den.rest', t: 1.3 } }).ask
        })(),
        corner: go(K, { op: 'addRoom', anchor: { side: 'left' } }, { view: [-1, -1] }).ask,
        noSelection: go(K, { op: 'addRoom', anchor: { wall: 'selected' } }).ask,
        tooWide: go(K, { op: 'addRoom', anchor: { side: 'left' }, size: { w: 9, d: 3 } }).ask,
      }
      // Built-ins along the wall (fixtures.ts measures them in the page; here they are given): the whole wall, then all but a single door's gap.
      const LEFT_INTENT = { op: 'addRoom', anchor: { room: 'this', side: 'left' }, size: { fraction: 2 / 3 }, connect: { kind: 'door', leaves: 2 } }
      out.blocked = go(K, LEFT_INTENT, { occupied: () => [{ from: 0, to: 6.18, name: 'dresser' }] }).ask
      const gap = go(K, LEFT_INTENT, { occupied: () => [{ from: 0, to: 3.7, name: 'dresser' }, { from: 4.95, to: 6.18, name: 'bench' }] })
      out.single = { door: gap.draft?.door, note: gap.note }
      out.refused = { op: I.checkIntent({ op: 'deleteHouse' }), shape: I.checkIntent({ op: 'addRoom', anchor: {}, shape: 'L' }) }
      out.clamped = I.checkIntent({ op: 'addRoom', label: 'x<script>', anchor: { side: 'up', room: 'this' }, size: { w: 400, d: -3 }, connect: { leaves: 7 }, extra: 1 })
      const snapped = go(K, { op: 'addRoom', anchor: { side: 'left' }, size: { w: 3.33, d: 2.77 } })
      out.snapped = snapped.draft
      // A wall piece of exactly 0.5 m is a wall (validate allows rounding), and a sliver says so, not "a window".
      out.overtaken = (() => {
        // This page draws a room on den.rest; another page then builds a nook on den.w3 across its floor.
        const den = go(K, { op: 'addRoom', label: 'den', anchor: { wall: 'selected' }, size: { w: 3.6, d: 3 } }, { selected: { wallId: 'kitchen.left', t: 1.8 } })
        const drawn = go(den.plan, { op: 'addRoom', label: 'study', anchor: { wall: 'selected' }, size: { w: 2, d: 3 } }, { selected: { wallId: 'den.rest', t: 1.3 } })
        const nook = go(den.plan, { op: 'addRoom', label: 'nook', anchor: { wall: 'selected' }, size: { w: 2, d: 4 } }, { selected: { wallId: 'den.w3', t: 1 } })
        return R.fit(nook.plan, drawn.draft).ask
      })()
      out.front58 = go(K, { op: 'addRoom', anchor: { side: 'front' }, size: { w: 5.8, d: 3 } }, { view: [0, -1] })
      out.front66 = go(K, { op: 'addRoom', anchor: { side: 'front' }, size: { w: 6.6, d: 3 } }, { view: [0, -1] }).ask
      return out
    })
    const L = unit.left
    check("fit: a drawn room that another page's room now overlaps is refused as running into it", /runs into the nook/.test(unit.overtaken ?? ''), unit.overtaken)
    check('resolver: a 5.8 m room on the front wall is drawn, not refused', !('ask' in unit.front58) && unit.front58.draft, unit.front58.ask)
    check('resolver: a width that leaves a sliver on a wall with no openings says so', /sliver/.test(unit.front66 ?? ''), unit.front66)
    check('resolver: "to the left, double doors, 2/3 the size" hangs on the left wall with a double door', L.draft?.wallId === 'kitchen.left' && L.draft.door.leaves === 2 && L.valid?.length === 0, L.draft)
    check('resolver: 2/3 of the kitchen floor area within 1%', Math.abs(L.area / L.target - 1) < 0.01, { area: +L.area?.toFixed(3), target: +L.target.toFixed(3), error: `${(100 * Math.abs(L.area / L.target - 1)).toFixed(2)}%` })
    check('resolver: "a 4 by 3 m study behind the living room" goes on the living room, 12 m²', unit.study.draft && unit.study.owner?.[0] === 'living' && Math.abs(unit.study.area - 12) < 1e-6 && unit.study.draft.to - unit.study.draft.from === 4, unit.study)
    check('resolver: "this wall" and the clicked point: the room and its door centre on that point', unit.selected.draft?.wallId === 'kitchen.left' && Math.abs(unit.selected.doorCentre - 2.0) < 0.06, unit.selected)
    check('resolver: the wall the kitchen shares with the living room takes no new room, and says the living room is there', /living room/i.test(unit.asks.sharedWall ?? '') && /living room/i.test(unit.asks.sharedSelected ?? ''), [unit.asks.sharedWall, unit.asks.sharedSelected])
    for (const [name, ask] of Object.entries(unit.asks)) check(`resolver asks, one line: ${name}`, typeof ask === 'string' && ask.length < 140 && !ask.includes('\n'), ask)
    check('resolver: a wall blocked end to end gets one line naming what is in the way, and no outline', /^The dresser is in the way there/.test(unit.blocked ?? '') && !unit.blocked.includes('\n'), unit.blocked)
    check('resolver: double doors with only a single door\'s gap become a single door in the gap, and the villager says so', unit.single.door?.leaves === 1 && unit.single.door.from >= 3.8 - 1e-9 && unit.single.door.to <= 4.85 + 1e-9 && /dresser.*single door/.test(unit.single.note ?? ''), unit.single)
    check('intent: unknown changes and shapes are refused', 'reason' in unit.refused.op && 'reason' in unit.refused.shape, unit.refused)
    check('intent: out-of-range numbers clamp, unknown values and fields drop', JSON.stringify(unit.clamped) === JSON.stringify({ intent: { op: 'addRoom', anchor: { room: 'this' }, size: { w: 12, d: 1.5 }, connect: { kind: 'door', leaves: 1 } } }), unit.clamped)
    const sn = unit.snapped
    const on10 = (v) => Math.abs(v * 10 - Math.round(v * 10)) < 1e-6
    check('resolver: everything snaps to 10 cm', sn && [sn.from, sn.to, sn.depth, sn.door.from, sn.door.to].every(on10) && Math.abs(sn.to - sn.from - 3.3) < 1e-6 && Math.abs(sn.depth - 2.8) < 1e-6, sn)

    // ── The notepad path ───────────────────────────────────────────────────
    const s0 = await state(page)
    const yard0 = await yardNow(page)
    const v0 = await versions(page)
    const plan0 = await B(page, () => JSON.stringify(window.villageBuild.plan()))
    await say(page, LEFT)
    let s = await until(page, (x) => x.draft)
    const t = await B(page, () => ({ shown: window.villageBuild.outline.shownAt(), enter: window.__enterAt }))
    const enterToOutline = t.shown - t.enter
    const routeMs = await B(page, () => window.village.talk.state().input.routes.at(-1)?.ms)
    check('notepad: a build line draws the outline within 400 ms of Enter (stub router)', s.draft && enterToOutline < 400, { enterToOutline: Math.round(enterToOutline), enterToRoute: routeMs, draft: s.draft })
    await page.waitForTimeout(150)
    s = await state(page)
    check('notepad: double doors do not fit by the dresser, so your villager says it drew a single door, in one short line', /dresser.*single door/i.test(s.card ?? '') && s.card.length <= 60 && s.draft.door.leaves === 1, s.card)
    // The door against the kitchen's real built-ins, both faces of the shared wall, measured from the scene.
    const clear = await B(page, () => {
      const d = window.villageBuild.outline.draft()
      const all = window.villageBuild.fixtures(d.wallId)
      const hit = all.filter((f) => f.y0 < 2.3 && d.door.from < f.to + 0.1 - 1e-6 && d.door.to > f.from - 0.1 + 1e-6)
      return { door: d.door, hit, near: [...new Set(all.map((f) => `${f.name}@${f.side}`))], scans: window.villageBuild.fixtureScans() }
    })
    check('the door keeps 10 cm clear of every built-in on either face (dresser, shelf, bench, coat pegs...)', clear.hit.length === 0 && clear.near.some((n) => /dresser/.test(n)) && clear.near.some((n) => /shelf/.test(n)), clear)
    const tq = await B(page, () => {
      const d = window.villageBuild.outline.draft()
      const t0 = performance.now()
      for (let i = 0; i < 100; i++) window.villageBuild.fixtures(d.wallId)
      return { firstScanMs: window.villageBuild.fixtureScans()[0], queryMs: (performance.now() - t0) / 100 }
    })
    check('fixtures: a query after the first scan is under 5 ms', tq.queryMs < 5, tq)
    const dom = await B(page, () => ({ dims: [...document.querySelectorAll('.build-dim.shown')].map((e) => e.textContent), choice: document.querySelector('.build-choice.shown .title')?.textContent }))
    check('outline: the size tags show metres and the choice tag says the size in words', dom.dims.length === 2 && dom.dims.every((t) => / m$/.test(t)) && /(smaller|bigger|as big|half|twice)[^·]* the kitchen/.test(dom.choice ?? '') && !/m²/.test(dom.choice ?? ''), dom)
    const ghosts = await B(page, () => {
      const scene = window.village.kernel.root.get('stage').scene
      const g = scene.getObjectByName('build outline ghosts')
      return { pieces: window.villageBuild.outline.pieces().map((f) => f.id), shown: g ? g.children.filter((c) => c.visible).map((c) => c.name) : [] }
    })
    check('outline: the playroom\'s first pieces stand inside as ghosts (a play rug, the little table, the toy chest at least)', ['play-rug', 'play-table', 'toy-chest'].every((k) => ghosts.pieces.includes(`playroom.${k}`) && ghosts.shown.includes(`build outline ghost ${k}`)), ghosts)
    // The choice card stands clear of the staked-out room: no grip on screen falls inside it.
    const cardClear = await B(page, () => {
      const r = document.querySelector('.build-choice.shown').getBoundingClientRect()
      const g = window.villageBuild.outline.grips()
      const under = Object.entries(g).filter(([k, p]) => k !== 'at' && p[0] > r.left && p[0] < r.right && p[1] > r.top && p[1] < r.bottom).map(([k]) => k)
      return { card: [r.left, r.top, r.right, r.bottom].map(Math.round), under, tail: document.querySelector('.build-choice').dataset.tail }
    })
    check('outline: the choice card covers no part of the outline (no grip under it) and points its tail at the room', cardClear.under.length === 0 && Boolean(cardClear.tail), cardClear)
    // The doorway to be is taped out on the face of the shared wall the camera sees.
    const marked = await B(page, () => {
      const scene = window.village.kernel.root.get('stage').scene
      const m = scene.getObjectByName('build outline door mark')
      const cam = window.village.kernel.root.get('stage').camera
      if (!m) return null
      m.updateMatrixWorld()
      const n = m.getWorldDirection(m.position.clone())
      const to = cam.position.clone().sub(m.getWorldPosition(m.position.clone()))
      return { visible: m.visible, facesCamera: n.dot(to) > 0, y: +m.position.y.toFixed(2) }
    })
    check('outline: the doorway to be is marked on the shared wall, on the face the camera sees', marked?.visible && marked.facesCamera, marked)
    await page.keyboard.press('Escape')
    await frames(page, 4)
    // The notepad's furnishing guess for the line fades out on its own (#42); give it the time.
    await page.waitForTimeout(800)
    s = await state(page)
    const v1 = await versions(page)
    const plan1 = await B(page, () => JSON.stringify(window.villageBuild.plan()))
    check('Escape: no trace (plan, history and scene object list unchanged)', !s.draft && plan1 === plan0 && v1.length === v0.length && JSON.stringify(s.objects) === JSON.stringify(s0.objects), { versions: [v0.length, v1.length], objects: [s0.objects.length, s.objects.length], added: s.objects.filter((o) => !s0.objects.includes(o)), gone: s0.objects.filter((o) => !s.objects.includes(o)) })

    // Adjust: drag the far wall, move the door, type a width.
    await say(page, LEFT)
    s = await until(page, (x) => x.draft)
    // The view eases out to take in the new room; let it settle before aiming at the floor.
    await page.waitForTimeout(1500)
    let g = await grips(page)
    const before = s.draft
    // A quarter along the far wall: the whole wall is a grip, and its middle sits under the size tag in this view.
    await drag(page, await floorPoint(page, before.from + (before.to - before.from) / 4, before.depth), await floorPoint(page, before.from + (before.to - before.from) / 4, before.depth - 1))
    s = await state(page)
    check('drag the far wall 1 m in: depth -1.0 m, snapped', Math.abs(s.draft.depth - (before.depth - 1)) < 1e-6, { before: before.depth, after: s.draft.depth })
    const d1 = s.draft
    g = await grips(page)
    // 1 m along is the bench: the door will not stop there, and the tag says why while it is held.
    {
      const to = await floorPoint(page, (d1.door.from + d1.door.to) / 2 + 1, 0)
      await page.mouse.move(...g.door)
      await frames(page, 3)
      await page.mouse.down()
      await page.mouse.move(...to, { steps: 20 })
      await frames(page, 3)
      const held = await B(page, () => ({ door: window.villageBuild.outline.draft().door, tag: document.querySelector('.build-choice .title .area')?.textContent }))
      await page.mouse.up()
      await page.waitForTimeout(1300)
      s = await state(page)
      check('drag the door 1 m onto the bench: it stays clear and the tag names the bench', held.door.from === d1.door.from && held.door.to === d1.door.to && /bench/.test(held.tag ?? '') && s.draft.door.from === d1.door.from, { before: d1.door, held, after: s.draft.door })
    }
    await page.click('.build-dim[data-dim="w"]')
    await page.keyboard.press('Backspace')
    await page.keyboard.type('4.5')
    await page.keyboard.press('Enter')
    await frames(page, 3)
    s = await state(page)
    const wTag = await B(page, () => document.querySelector('.build-dim[data-dim="w"]').textContent)
    check('click the width tag and type 4.5: the room is 4.5 m along the wall, still being drawn', s.draft && Math.abs(s.draft.to - s.draft.from - 4.5) < 1e-6 && wTag === '4.5 m', { draft: s.draft, wTag })
    g = await grips(page)
    const d2 = s.draft
    await drag(page, g.bend, await floorPoint(page, (d2.from + d2.to) / 2, d2.depth - 0.55 + 0.51))
    s = await state(page)
    check('pull the dot: the far wall bends out 0.5 m', Math.abs(s.draft.bend - 0.5) < 1e-6, s.draft.bend)

    // Enter builds it: one version, the room drawn.
    const gBefore = (await state(page)).geometries
    const ghostLayout = await B(page, () => window.villageBuild.outline.pieces())
    // Another villager has news waiting, so the reward can be seen to quiet it.
    await B(page, () => window.village.talk.notify('mia'))
    await page.waitForTimeout(1500)
    const glyph = () => B(page, () => window.village.talk.state().cast.mia?.glyph ?? 0)
    const markerBefore = await glyph()
    await page.keyboard.press('Enter')
    s = await until(page, (x) => !x.draft && x.rooms.length === 3)
    await frames(page, 6)
    s = await state(page)
    const v2 = await versions(page)
    check('Enter: one new version, "Added the playroom", and the room is drawn with its floor (and nobody says it does not fit)', v2.length === v0.length + 1 && v2.at(-1).note === 'Added the playroom' && s.floors === 3 && !/fit/.test(s.said.at(-1)), { versions: v2, floors: s.floors, said: s.said.at(-1) })
    const builtLayout = await B(page, () => window.villageBuild.plan().furniture.filter((f) => f.id.startsWith('playroom.')))
    // The plan keeps a turn in (-π, π], so a ghost turned 3.142 is built at -3.141: the same pose.
    const pose = (f) => JSON.stringify({ ...f, at: f.at.mount === 'floor' ? { ...f.at, yaw: (((f.at.yaw % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)).toFixed(2).replace('6.28', '0.00') } : f.at })
    check('built: every piece stands exactly where its ghost stood', ghostLayout.length > 0 && ghostLayout.length === builtLayout.length && ghostLayout.every((g, i) => pose(g) === pose(builtLayout[i])), { ghosts: ghostLayout.length, built: builtLayout.length, differ: ghostLayout.map((g, i) => [g, builtLayout[i]]).filter(([a, b]) => JSON.stringify(a) !== JSON.stringify(b)).slice(0, 2) })
    // The move-in: Alex's Dumpling (who asked) walks from the kitchen through the new door's gap and sits at the play table.
    const walk = await B(page, () => new Promise((done) => {
      const where = () => window.village.talk.where('alex')
      const samples = []
      const t0 = performance.now()
      const tick = () => {
        const r = window.villageBuild.reveal()
        const w = where()
        if (w) samples.push([w.x, w.z])
        if ((r.phase === 'settled' && w?.seated) || performance.now() - t0 > 25000) return done({ r, w, samples })
        requestAnimationFrame(tick)
      }
      tick()
    }))
    const crossings = []
    if (walk.r.door) {
      const [a, b] = walk.r.door.gap, mid = walk.r.door.mid
      const along = [b[0] - a[0], b[1] - a[1]], L = Math.hypot(...along), u = [along[0] / L, along[1] / L], n = [-u[1], u[0]]
      const side = (p) => (p[0] - mid[0]) * n[0] + (p[1] - mid[1]) * n[1]
      for (let i = 1; i < walk.samples.length; i++) {
        const p = walk.samples[i - 1], q = walk.samples[i]
        if (Math.sign(side(p)) === Math.sign(side(q)) || side(p) === 0) continue
        const k = side(p) / (side(p) - side(q))
        const x = [p[0] + (q[0] - p[0]) * k, p[1] + (q[1] - p[1]) * k]
        // How far along the wall from the gap's middle it crossed, against half the gap.
        crossings.push({ off: +Math.abs((x[0] - mid[0]) * u[0] + (x[1] - mid[1]) * u[1]).toFixed(3), half: +(L / 2).toFixed(3) })
      }
    }
    const inPlayroom = walk.w && await B(page, async (w) => {
      const P = await import('/src/build/plan.ts')
      const p = window.villageBuild.plan()
      return P.inside(P.floorOf(p, p.rooms.find((r) => r.id === 'playroom')), [w.x, w.z])
    }, walk.w)
    check('move-in: the villager who asked (Alex\'s Dumpling) crosses the shared wall only through the new door\'s gap', walk.r.person === 'alex' && crossings.length >= 1 && crossings.every((c) => c.off < c.half - 0.1), { crossings, samples: walk.samples.length })
    check('move-in: they end seated on a stool at the play table, in the new room, and say one short line', walk.w?.seated && walk.w.spot === 'buildMovein' && inPlayroom && Math.abs(walk.w.y - 0.635) < 0.01 && /love it/.test((await state(page)).card ?? ''), { w: walk.w, seat: walk.r.seat })
    // The settled frame, the shared wall as the reveal shows it: low in front of the door, standing from the door back.
    await page.waitForTimeout(400)
    const wallsNow = await B(page, () => ({ walls: window.villageBuild.walls(), hung: window.villageBuild.hung(), fixtures: window.villageBuild.fixtures('playroom.shared'), door: window.villageBuild.plan().walls.find((w) => w.id === 'playroom.shared')?.openings.find((o) => o.kind === 'door'), reveal: window.villageBuild.reveal() }))
    {
      const { walls, hung, fixtures, door, reveal } = wallsNow
      const gap = reveal.door?.gap ?? [[0, 0], [0, 0]]
      const front = Math.max(gap[0][1], gap[1][1]), back = Math.min(gap[0][1], gap[1][1])
      const full = walls.filter((w) => !w.stub && !w.timber && w.y1 > 2.9 && Math.abs(w.x - reveal.door.mid[0]) < 0.1)
      const frontLow = full.filter((w) => w.wall === 'playroom.shared' && w.z0 >= front - 1e-3).every((w) => !w.shown)
      const timber = walls.filter((w) => w.wall === 'playroom.shared' && w.timber && w.shown)
      const posts = timber.filter((w) => w.y0 < 0.02 && w.y1 > door.head - 0.05 && w.z1 - w.z0 < 0.2)
      const lintel = timber.filter((w) => w.y0 > door.head - 0.2 && w.z0 <= back + 0.02 && w.z1 >= front - 0.02)
      const above = full.filter((w) => w.wall === 'playroom.shared' && w.y0 > door.head - 0.01 && w.shown)
      check('the doorway is a real opening while the wall in front of it is low: posts either side, a lintel and the wall over it standing', frontLow && posts.length >= 2 && lintel.length >= 1 && above.length >= 1, { frontLow, posts: posts.length, lintel: lintel.length, above: above.length })
      // Behind the new room's back wall the house's own wall stands to the back corner: no gap where the two back walls meet.
      const behind = full.filter((w) => w.shown && w.z1 <= back + 1e-3).sort((a, b) => a.z0 - b.z0)
      let reach = -Infinity, from = behind[0]?.z0 ?? Infinity
      for (const w of behind) if (reach === -Infinity || w.z0 <= reach + 0.01) reach = Math.max(reach, w.z1)
      const cornerZ = await B(page, () => window.villageBuild.plan().corners.find((c) => c.id === 'kitchen.back-left').z)
      const roomBack = await B(page, () => Math.min(...window.villageBuild.plan().corners.filter((c) => c.id.startsWith('playroom.')).map((c) => c.z)))
      check('the back-wall junction is closed: the house\'s wall stands at full height from its back corner past the new room\'s back wall', from <= cornerZ + 0.1 && reach >= roomBack, { from, reach, cornerZ, roomBack })
      // Nothing hung on the shared wall floats: each hung fixture is on a stretch that stands, or it is away with the wall.
      const hungShown = hung.filter((h) => h.shown)
      // The kitchen's face of the shared wall (side -1); stretches run from its front corner, z = the door's front edge + door.from - t.
      const hangingOnLow = fixtures.filter((f) => f.y0 > 0.3 && !f.through && f.side === -1).map((f) => ({ name: f.name, z0: reveal.door.gap[0][1] + (door.from - f.to), z1: reveal.door.gap[0][1] + (door.from - f.from) }))
        .filter((f) => !full.some((w) => w.shown && w.z0 <= f.z0 + 0.02 && w.z1 >= f.z1 - 0.02))
      const covered = hangingOnLow.every((f) => hung.some((h) => !h.shown && h.z0 <= f.z0 + 0.05 && h.z1 >= f.z1 - 0.05))
      check('no wall thing floats: what the kitchen hung on the shared wall goes while the wall is low', hung.length >= 1 && hungShown.length === 0 && covered, { hung, onLow: hangingOnLow })
    }
    const markerDuring = await glyph()
    const hushed = await B(page, () => window.villageBuild.reveal().hushed)
    // The way back: the tag is offered while the view is held, and it glides out to the whole house.
    const tagShown = await B(page, () => window.villageBuild.backShown())
    await page.click('.build-back')
    await page.waitForTimeout(1600)
    const markerAfter = await glyph()
    check('during the reward the other villagers\' "!" is quiet, and it comes back after', markerBefore > 0.5 && hushed && markerDuring < 0.05 && markerAfter > 0.5, { markerBefore, hushed, markerDuring, markerAfter })
    const out = await B(page, () => ({ held: window.villageBuild.reveal().held, frame: window.village.kernel.root.get('view').frame, shown: window.villageBuild.backShown() }))
    check('"Back to the house" is offered while the reveal holds the view, and glides out to the whole house', tagShown && !out.held && !out.shown && out.frame.zoom < 0.02, out)
    const built = await B(page, () => {
      const p = window.villageBuild.plan()
      // The wall the playroom shares (the kitchen and living room share theirs already).
      const shared = p.walls.filter((w) => { const rs = p.rooms.filter((r) => r.loop.includes(w.a) && r.loop.includes(w.b)); return rs.length === 2 && rs.some((r) => r.id === 'playroom') })
      return { shared: shared.map((w) => ({ id: w.id, openings: w.openings })), bent: p.walls.find((w) => w.id === 'playroom.w2')?.sagitta }
    })
    // The yard does not follow the plan yet (diorama.ts), so what of it stands in the new room steps aside.
    const yardBuilt = await yardInside(page)
    const yardBuiltNow = await yardNow(page)
    check('built: no fence picket or rail, flower, stone or shrub stands inside the new room or its walls (and some were moved aside)', yardBuilt.rooms === 1 && yardBuilt.total === 0 && Object.keys(yard0).some((k) => yardBuiltNow[k] !== yard0[k]), { yardBuilt, changed: Object.keys(yard0).filter((k) => yardBuiltNow[k] !== yard0[k]) })
    // The first pieces are plan furniture in that same version, drawn from the plan, clear of each other and inside the room.
    const pieces = () => B(page, async () => {
      const P = await import('/src/build/plan.ts')
      const p = window.villageBuild.plan()
      const scene = window.village.kernel.root.get('stage').scene
      const things = scene.getObjectByName('placed things')
      const ids = p.furniture.filter((f) => f.id.startsWith('playroom.')).map((f) => f.id)
      const drawn = things.children.filter((c) => String(c.userData.furniture ?? '').startsWith('playroom.'))
      const room = p.rooms.find((r) => r.id === 'playroom')
      const ring = room ? P.floorOf(p, room) : []
      const boxes = drawn.filter((c) => !/picture|play-wall/.test(c.userData.furniture)).map((c) => {
        c.updateMatrixWorld(true)
        const box = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] }
        c.traverse((o) => {
          if (!o.isMesh) return
          o.geometry.computeBoundingBox()
          const bb = o.geometry.boundingBox.clone().applyMatrix4(o.matrixWorld)
          for (let i = 0; i < 3; i++) {
            box.min[i] = Math.min(box.min[i], bb.min.getComponent(i))
            box.max[i] = Math.max(box.max[i], bb.max.getComponent(i))
          }
        })
        return { id: c.userData.furniture, box }
      })
      const overlaps = []
      const solid = boxes.filter((b) => !/rug/.test(b.id))
      for (let i = 0; i < solid.length; i++) for (let j = i + 1; j < solid.length; j++) {
        const a = solid[i].box, b = solid[j].box
        const o = [0, 1, 2].map((k) => Math.min(a.max[k], b.max[k]) - Math.max(a.min[k], b.min[k]))
        if (o.every((v) => v > 0.005)) overlaps.push([solid[i].id, solid[j].id, o.map((v) => +v.toFixed(3))])
      }
      // Every floor piece's world box, corner by corner, inside the room's floor.
      const outside = boxes.filter(({ box }) => [[box.min[0], box.min[2]], [box.max[0], box.min[2]], [box.max[0], box.max[2]], [box.min[0], box.max[2]]].some((q) => !P.inside(ring, q))).map((b) => b.id)
      return { ids, drawn: drawn.map((c) => c.userData.furniture), overlaps, outside }
    })
    const firstPieces = await pieces()
    check('built: the playroom arrives with play things, a second grouping and a picture as plan furniture in the same version, all drawn (no sofa)', ['play-rug', 'play-table', 'toy-chest', 'play-tent', 'toy-shelf', 'potted-plant', 'play-wall'].every((k) => firstPieces.ids.includes(`playroom.${k}`)) && !firstPieces.ids.includes('playroom.sofa') && firstPieces.drawn.length === firstPieces.ids.length, firstPieces)
    check('built: the pieces do not overlap one another and stand inside the room', firstPieces.overlaps.length === 0 && firstPieces.outside.length === 0, firstPieces)
    const covered = await B(page, async () => {
      const P = await import('/src/build/plan.ts')
      const p = window.villageBuild.plan()
      const lawn = window.villageBuild.lawn()
      if (!lawn) return { lawn: null }
      const out = p.rooms.flatMap((r) => P.outline(p, r, -0.2).filter((q) => !P.inside(lawn, q)).map((q) => [r.id, q]))
      return { lawn: lawn.length, out }
    })
    check('the lawn has grown and holds every room with its walls', covered.lawn && covered.out.length === 0, covered)
    check('the shared wall is one wall with the door; the far wall is bent', built.shared.length === 1 && built.shared[0].openings.some((o) => o.kind === 'door') && built.bent !== 0, built)
    const windowed = await B(page, () => {
      const p = window.villageBuild.plan()
      const scene = window.village.kernel.root.get('stage').scene
      return { window: p.walls.find((w) => w.id === 'playroom.w2')?.openings.find((o) => o.kind === 'window') ?? null, daylight: Boolean(scene.getObjectByName('build window daylight')) }
    })
    check('built: the far wall has a window, and daylight falls through it onto the floor', windowed.window && windowed.daylight, windowed)
    // One clean lawn: every turn of its outline goes the same way, so no corner steps in.
    const convex = await B(page, () => {
      const l = window.villageBuild.lawn()
      if (!l) return null
      const turns = l.map((p, i) => {
        const a = l[(i + l.length - 1) % l.length], b = l[(i + 1) % l.length]
        return Math.sign((p[0] - a[0]) * (b[1] - p[1]) - (p[1] - a[1]) * (b[0] - p[0]))
      }).filter((t) => t !== 0)
      return { points: l.length, ways: [...new Set(turns)] }
    })
    check('built: the lawn is one clean shape, with no corner stepping in', convex && convex.ways.length === 1, convex)
    // The door is a real gap in the generated walls: a level ray at 1 m through its middle, from 1 m inside one room
    // to 1 m inside the other, meets no wall; the same ray 0.3 m past a jamb meets the shared wall.
    const gap = await B(page, async () => {
      const P = await import('/src/build/plan.ts')
      const p = window.villageBuild.plan()
      const M = await import('/src/build/mount.ts')
      const w = p.walls.find((x) => x.openings.some((o) => o.id === 'playroom.door'))
      const o = w.openings.find((x) => x.id === 'playroom.door')
      const c = P.curveOf(p, w)
      const ray = (t, s) => {
        const [x, z] = P.pointAt(c, t), [nx, nz] = P.normalAt(c, t)
        return window.villageBuild.wallHit([x - nx * s, 1, z - nz * s], [nx * s, 0, nz * s], 2)
      }
      const mid = (o.from + o.to) / 2
      // And no built-in: the same level ray, from 1 m inside one room to 1 m inside the other, against everything solid but the house.
      const scene = window.village.kernel.root.stage.scene
      const [x, z] = P.pointAt(c, mid), [nx, nz] = P.normalAt(c, mid)
      // Each solid part's world box (mount.ts's obstacles: the house, people and light are not in it), against the segment, by slabs.
      const things = M.obstacles(scene, [scene.getObjectByName('placed things')]).flatMap(({ box, name }) => {
        if (box.min.y > 1 || box.max.y < 1) return []
        let t0 = -1, t1 = 1
        for (const [p, d, lo, hi] of [[x, nx, box.min.x, box.max.x], [z, nz, box.min.z, box.max.z]]) {
          if (Math.abs(d) < 1e-9) { if (p < lo || p > hi) return []; continue }
          const a = (lo - p) / d, b = (hi - p) / d
          t0 = Math.max(t0, Math.min(a, b)); t1 = Math.min(t1, Math.max(a, b))
        }
        return t0 <= t1 ? [{ name, at: +t0.toFixed(2) }] : []
      })
      return { door: [o.from, o.to], through: [ray(mid, 1), ray(mid, -1)], jamb: [ray(o.from - 0.3, 1), ray(o.to + 0.3, -1)], things }
    })
    check('the doorway is open from both rooms (a ray through it hits no wall; 0.3 m past each jamb it hits the shared wall)', gap.through.every((h) => h === null) && gap.jamb.every((h) => h && built.shared.some((w) => w.id === h.wall)), gap)
    check('and no built-in: the level ray at 1 m through the door\'s middle meets nothing within 1 m of the wall on either side', gap.things.length === 0, gap.things)

    // Undo and redo, geometries flat.
    const counts = []
    for (let i = 0; i < 4; i++) {
      await page.keyboard.press('Control+z')
      s = await until(page, (x) => x.rooms.length === 2)
      await frames(page, 4)
      const undone = (await state(page)).floors
      if (i === 0) {
        const back = await yardNow(page)
        check('undo: with the room gone, the yard is exactly as diorama.ts drew it', Object.keys(yard0).every((k) => back[k] === yard0[k]), Object.keys(yard0).filter((k) => back[k] !== yard0[k]))
        const gone = await pieces()
        check('one undo takes the room and its first pieces away together', gone.ids.length === 0 && gone.drawn.length === 0, gone)
      }
      await page.keyboard.press('Control+Shift+z')
      s = await until(page, (x) => x.rooms.length === 3)
      // The cutaway re-sorts walls every 30 frames, and a stub's geometry uploads the first time it shows.
      await frames(page, 45)
      s = await state(page)
      counts.push({ undone, floors: s.floors, geometries: s.geometries, textures: s.textures })
    }
    // The first round trip warms the room's pieces; from then on every rebuild returns to the same count.
    check('Ctrl+Z takes the room away and Shift+Ctrl+Z brings it back, geometries and textures flat', counts.every((c) => c.undone === 2 && c.floors === 3) && counts.slice(1).every((c) => c.geometries === counts[1].geometries && c.textures === counts[1].textures), { gBefore, counts })

    // A reload draws the first pieces again from the stored plan.
    {
      const again = await open('?talk=npc&build=1&route=separate&q=low', context)
      const back = await B(again.page, () => {
        const p = window.villageBuild.plan()
        const things = window.village.kernel.root.get('stage').scene.getObjectByName('placed things')
        return { ids: p.furniture.filter((f) => f.id.startsWith('playroom.')).map((f) => f.id), drawn: things.children.filter((c) => String(c.userData.furniture ?? '').startsWith('playroom.')).length }
      })
      check('reload: the first pieces are still there, drawn from the plan', back.ids.length === firstPieces.ids.length && back.drawn === back.ids.length, back)
      await again.page.close()
    }

    // The README's second example, against the room just added.
    await say(page, STUDY)
    s = await until(page, (x) => x.draft)
    check('"a 4 by 3 metre study behind the living room" draws on the living room', s.draft?.label === 'Study' && Math.abs(s.draft.to - s.draft.from - 4) < 1e-6 && s.draft.depth === 3 && /^living\./.test(s.draft.wallId), s.draft)
    await page.click('.build-choice [data-choice="apply"]')
    s = await until(page, (x) => !x.draft && x.rooms.length === 4)
    check('"Build it" on the paper tag adds the study as a version', s.rooms.length === 4 && (await versions(page)).at(-1).note === 'Added the study', s.rooms)
    // In a study the villager steps up to the desk chair from behind it and sits, standing inside the study, clear of the desk.
    const study = await B(page, () => new Promise((done) => {
      const t0 = performance.now()
      const tick = async () => {
        const w = window.village.talk.where('alex')
        if (!(w?.state === 'sit' && w.spot === 'buildMovein') && performance.now() - t0 < 20000) return requestAnimationFrame(tick)
        const P = await import('/src/build/plan.ts')
        const p = window.villageBuild.plan(), r = window.villageBuild.reveal()
        const desk = p.furniture.find((f) => f.id === 'study.desk')?.at
        // The stand-point in the desk's own frame: outside its 1.2 × 0.6 m top.
        const dx = r.spot[0] - desk.x, dz = r.spot[1] - desk.z, c = Math.cos(desk.yaw), s = Math.sin(desk.yaw)
        const lx = dx * c - dz * s, lz = dx * s + dz * c
        done({ seated: Boolean(w?.seated), y: w?.y, inStudy: P.inside(P.floorOf(p, p.rooms.find((x) => x.id === 'study')), r.spot), clearOfDesk: Math.abs(lx) > 0.6 || lz > 0.12 || lz < -0.48, local: [+lx.toFixed(2), +lz.toFixed(2)] })
      }
      tick()
    }))
    check('move-in: in the study they step up to the desk chair from behind it, inside the study and clear of the desk, and sit', study.seated && Math.abs(study.y - 0.635) < 0.01 && study.inStudy && study.clearOfDesk, study)

    // Clarifying lines.
    for (const [line, want] of [['add a room somewhere', /which side|which room/i], ['add a pantry behind the kitchen', /window or a door/i]]) {
      const n = (await state(page)).said.length
      await say(page, line)
      // Your villager's lines queue (#42: each stays up at least 3 s), so wait for this one to reach the card.
      s = await until(page, (x) => x.said.length > n && x.card === x.said.at(-1), 12000)
      check(`ambiguous or impossible: "${line}" gets one clarifying line from your villager, and no outline`, !s.draft && want.test(s.said.at(-1)) && s.card === s.said.at(-1), { said: s.said.at(-1), card: s.card })
      await page.waitForTimeout(200)
    }

    // The selection path: back from the study's move-in to the whole house, click a wall, then "open a door here into a new room".
    await B(page, () => window.villageBuild.back())
    await page.waitForTimeout(2600)
    // #42's held writing pad is a button low on the right whose box can cover this wall, so click the point
    // nearest 4 m along it, low on the wall, that the 3D view itself is under (the talk's paper canvas lets pointers through).
    const pick = await B(page, () => {
      for (const t of [4.0, 3.75, 4.25, 3.5, 4.5, 3.25, 4.75, 3.0, 5.0]) {
        const at = window.villageBuild.wallPoint('living.right', t, 0.43, 0)
        if (document.elementFromPoint(...at)?.tagName === 'CANVAS') return { t, at }
      }
      return null
    })
    check('a point near 4 m along the living room\'s right wall is not covered by the page', pick, pick)
    if (pick) await page.mouse.click(...pick.at)
    await frames(page, 3)
    s = await state(page)
    check('clicking a wall selects it and remembers the point', s.selected?.wallId === 'living.right' && Math.abs(s.selected.t - pick?.t) < 0.15, { selected: s.selected, clicked: pick?.t })
    await say(page, 'open a door here into a new room')
    s = await until(page, (x) => x.draft)
    // On the living room's right wall, past the Workshop's door: the door takes the nearest clear spot to the point.
    const rightClear = await B(page, () => {
      const d = window.villageBuild.outline.draft()
      return d && window.villageBuild.fixtures('living.right').filter((f) => f.y0 < 2.3 && d.door.from < f.to + 0.1 - 1e-6 && d.door.to > f.from - 0.1 + 1e-6).map((f) => f.name)
    })
    check('"open a door here into a new room" hangs the room on that wall, the door at the nearest clear spot to that point', s.draft?.wallId === 'living.right' && rightClear?.length === 0 && Math.abs((s.draft.door.from + s.draft.door.to) / 2 - (await state(page)).selected.t) < 0.7, { draft: s.draft, selected: s.selected, rightClear })
    await page.keyboard.press('Enter')
    s = await until(page, (x) => !x.draft && x.rooms.length === 5 && x.floors === 5)
    check('and Enter builds it', s.rooms.length === 5 && s.floors === 5, s.rooms)
    // Another page builds on the floor an outline is drawn on, before "Build it": the room is not built into it.
    await B(page, () => window.villageBuild.intent({ op: 'addRoom', label: 'den', anchor: { room: 'kitchen', side: 'front' }, size: { w: 3, d: 3 } }))
    s = await until(page, (x) => x.draft || /\?/.test(x.said.at(-1) ?? ''))
    const denDraft = s.draft
    if (denDraft) {
      await B(page, async (d) => {
        const H = await import('/src/build/history.ts'), P = await import('/src/build/plan.ts')
        const { token } = await (await fetch('/villager/launch')).json()
        const other = await H.PlanHistory.open(H.hostStore({ base: '/villager/api', token }), P.HOUSE_PLAN)
        await other.commit([{ op: 'addRoom', room: { id: 'nook', label: 'Nook' }, wallId: d.wallId, from: d.from, to: d.to, depth: 2 }], 'Added the nook')
      }, denDraft)
      await B(page, () => window.villageBuild.outline.confirm())
      await frames(page, 10)
      await B(page, () => window.villageBuild.outline.confirm())
      s = await until(page, (x) => !x.draft, 5000)
    }
    check('a room drawn on a stretch another page then built on is not built, and your villager says so', denDraft && !s.draft && !s.rooms.includes(denDraft.roomId) && s.rooms.includes('nook') && /runs into the nook|doesn't fit/i.test(s.said.at(-1) ?? ''), { draft: denDraft, rooms: s.rooms, said: s.said.at(-1) })
    const yardThree = await yardInside(page)
    check('with the rooms added, still nothing of the yard inside any of them', yardThree.rooms >= 3 && yardThree.total === 0, yardThree)
    // Taking the camera ends the move-in's hold: a drag, the wheel, a held WASD key, Escape. Back to the two-room house,
    // then the playroom built (by intent, as Alex) and taken away again for each.
    for (let i = 0; i < 12 && (await state(page)).rooms.length > 2; i++) {
      await B(page, async () => (await window.villageBuild.history()).undo())
      await frames(page, 4)
    }
    const holds = {}
    for (const how of ['drag', 'wheel', 'wasd', 'escape']) {
      await B(page, () => window.villageBuild.intent({ op: 'addRoom', label: 'playroom', anchor: { room: 'kitchen', side: 'left' }, size: { fraction: 2 / 3 }, connect: { kind: 'door', leaves: 2 } }, 'alex'))
      await until(page, (x) => x.draft, 5000)
      await page.waitForTimeout(400)
      await B(page, () => window.villageBuild.outline.confirm())
      await until(page, (x) => !x.draft && x.rooms.includes('playroom'), 5000)
      await page.waitForTimeout(300)
      const before = await B(page, () => window.villageBuild.reveal().held)
      if (how === 'drag') {
        await page.mouse.move(300, 700)
        await page.mouse.down()
        await page.mouse.move(380, 660, { steps: 8 })
        await page.mouse.up()
      } else if (how === 'wheel') {
        await page.mouse.move(700, 450)
        await page.mouse.wheel(0, 200)
      } else if (how === 'wasd') {
        // Nothing being written, so a held letter moves the view (camera.ts).
        await B(page, () => document.activeElement?.blur())
        await page.keyboard.down('d')
        await page.waitForTimeout(900)
        await page.keyboard.up('d')
      } else await page.keyboard.press('Escape')
      await page.waitForTimeout(how === 'escape' ? 2400 : 300)
      holds[how] = { before, after: await B(page, () => window.villageBuild.reveal().held), ...(how === 'escape' ? { zoom: await B(page, () => window.village.kernel.root.get('view').frame.zoom) } : {}) }
      await B(page, async () => (await window.villageBuild.history()).undo())
      await frames(page, 4)
    }
    check('the reveal\'s hold on the view ends on a drag, the wheel, a held WASD key and Escape (which glides out to the house)', Object.values(holds).every((h) => h.before && !h.after) && holds.escape.zoom < 0.02, holds)
    await B(page, () => window.village.unload('build'))
    await frames(page, 4)
    const yardGone = await yardNow(page)
    check('unloading build puts the whole yard back as diorama.ts drew it', Object.keys(yard0).every((k) => yardGone[k] === yard0[k]), Object.keys(yard0).filter((k) => yardGone[k] !== yard0[k]))
    check('no page errors', errors.length === 0, errors.slice(0, 3))
    await context.close()
  }
} finally {
  await browser.close()
  for (const child of [...children]) await stop(child)
  await rm(root, { recursive: true, force: true })
}
if (agent !== 'claude' && !look) {
  const failed = checks.filter((c) => !c.pass)
  console.log(`${checks.length - failed.length} of ${checks.length} passed`)
  process.exitCode = failed.length ? 1 : 0
}
void existsSync
