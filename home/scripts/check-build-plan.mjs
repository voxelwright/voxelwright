// Headless proof for the #48 build-mode experiment (?build=1).
// Usage: node scripts/check-build-plan.mjs [base-url] [--skip-pixels] [--skip-drag]   (dev server running)
// 1. Pixel-close: the kitchen without ?build=1 vs the plan-generated one, iso and seated,
//    against the noise floor of two runs without the flag (fixed clock, seeded Math.random).
// 2. The plan model: validate, JSON round trip, addRoom with a shared wall, rejections.
// 3. Drag and bend the right wall in iso with the mouse: snapping, live rebuild,
//    no geometry leak, Escape cancels, drags become versions, unloading restores room.ts's room.
// Exits non-zero when any check fails. Writes screenshots/build/*.jpg and a clip.
import { execFileSync } from 'node:child_process'
import { mkdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { chromium } from 'playwright'

const args = process.argv.slice(2)
const base = args.find((a) => !a.startsWith('--')) ?? 'http://localhost:5350/'
const OUT = 'screenshots/build'
mkdirSync(OUT, { recursive: true })
const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
  args: ['--enable-unsafe-webgpu', '--use-angle=metal', '--ignore-gpu-blocklist'],
})

const checks = []
const check = (name, pass, detail) => {
  checks.push({ name, pass: Boolean(pass), detail })
  console.log(`${pass ? 'ok  ' : 'FAIL'} ${name}${detail === undefined ? '' : ` (${typeof detail === 'string' ? detail : JSON.stringify(detail)})`}`)
}

async function open(query, { video, frozen } = {}) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1,
    ...(video ? { recordVideo: { dir: video, size: { width: 960, height: 600 } } } : {}),
  })
  // The furnished kitchen's wall clock shows real time; anything random gets one seed.
  await context.clock.setFixedTime(new Date('2026-11-06T10:10:00'))
  await context.addInitScript((frozen) => {
    let s = 20261106
    Math.random = () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646
    if (!frozen) return
    // Frames run only when the script steps them, each 1/60 s apart, so every capture
    // sees the same animation time (camera breath, motes, swaying leaves).
    const queue = new Map()
    let id = 0, frame = 0
    window.requestAnimationFrame = (cb) => (queue.set(++id, cb), id)
    window.cancelAnimationFrame = (n) => queue.delete(n)
    // THREE.Timer and TSL's time read performance.now(); it advances only with the frames.
    performance.now = () => (frame * 1000) / 60
    window.__step = async (n) => {
      for (let i = 0; i < n; i++) {
        const due = [...queue.values()]
        queue.clear()
        frame++
        for (const cb of due) cb((frame * 1000) / 60)
        await new Promise((r) => setTimeout(r, 0))
      }
    }
  }, Boolean(frozen))
  const page = await context.newPage()
  const errors = []
  page.on('console', (m) => m.type() === 'error' && !m.text().includes('503') && errors.push(m.text()))
  page.on('pageerror', (e) => errors.push(String(e)))
  await page.goto(base + query)
  const ready = await page.evaluate(() => window.village.ready())
  if (frozen) {
    await page.waitForTimeout(1500)
    await page.evaluate(() => window.__step(150))
    await page.waitForTimeout(500)
  } else {
    if (query.includes('build=1')) await page.evaluate(() => window.villageBuild.ready)
    await page.waitForTimeout(3000)
  }
  return { context, page, errors, ready }
}

// Mean absolute difference per channel (0-255) over the frame, and a diff image (x8, warm on dark).
async function diff(a, b, name) {
  const page = await browser.newPage()
  const result = await page.evaluate(async ([a, b]) => {
    const load = (src) => new Promise((done) => { const i = new Image(); i.onload = () => done(i); i.src = src })
    const [ia, ib] = await Promise.all([load(a), load(b)])
    const c = document.createElement('canvas')
    c.width = ia.width
    c.height = ia.height
    const g = c.getContext('2d')
    g.drawImage(ia, 0, 0)
    const da = g.getImageData(0, 0, c.width, c.height)
    g.drawImage(ib, 0, 0)
    const db = g.getImageData(0, 0, c.width, c.height)
    const out = g.createImageData(c.width, c.height)
    let sum = 0, changed = 0, max = 0, differing = 0
    const box = [Infinity, Infinity, -1, -1]
    for (let i = 0; i < da.data.length; i += 4) {
      const d = Math.abs(da.data[i] - db.data[i]) + Math.abs(da.data[i + 1] - db.data[i + 1]) + Math.abs(da.data[i + 2] - db.data[i + 2])
      sum += d
      if (d > 24) changed++
      if (d > 0) {
        differing++
        max = Math.max(max, d)
        const p = i / 4, x = p % c.width, y = Math.floor(p / c.width)
        box[0] = Math.min(box[0], x); box[1] = Math.min(box[1], y); box[2] = Math.max(box[2], x); box[3] = Math.max(box[3], y)
      }
      const v = Math.min(255, d * 8)
      out.data[i] = 20 + v
      out.data[i + 1] = 16 + v * 0.7
      out.data[i + 2] = 14 + v * 0.3
      out.data[i + 3] = 255
    }
    g.putImageData(out, 0, 0)
    return { mean: sum / (da.data.length / 4) / 3, changedPct: (100 * changed) / (da.data.length / 4), differing, max, box: differing ? box : null, image: c.toDataURL('image/jpeg', 0.85) }
  }, [a, b].map((buf) => `data:image/png;base64,${buf.toString('base64')}`))
  await page.close()
  if (name) writeFileSync(join(OUT, name), Buffer.from(result.image.split(',')[1], 'base64'))
  return { mean: +result.mean.toFixed(3), changedPct: +result.changedPct.toFixed(3), differingPixels: result.differing, maxChannelSum: result.max, box: result.box }
}

const jpg = (page, name) => page.screenshot({ path: join(OUT, name), type: 'jpeg', quality: 85 })

// ── 1. pixels ───────────────────────────────────────────────────────────────
if (!args.includes('--skip-pixels')) {
  for (const [label, query] of [['iso', '?cam=iso&q=low&fx='], ['seat', '?q=low&fx=']]) {
    const shots = []
    for (const q of [query, query, `${query}&build=1`]) {
      const { context, page, errors } = await open(q, { frozen: true })
      // The scene is what is compared: build mode's paper note (no host is running here) is not part of it.
      if (q.includes('build=1')) {
        check(`${label}: with no host, build mode says once that nothing will be kept`, await page.evaluate(() => /goes when the page closes/.test(window.villageBuild.noted() ?? '')))
        await page.addStyleTag({ content: '.build-note { display: none !important; }' })
      }
      shots.push(await page.screenshot({ type: 'png' }))
      if (q.includes('build=1')) {
        check(`${label}: no console errors with build=1`, errors.length === 0, errors.slice(0, 3))
        const swap = await page.evaluate(() => {
          const s = window.village.snapshot().objects
          const scene = window.village.kernel.root.get('stage').scene
          return { todayRoomChildren: scene.getObjectByName('room').children.length, todayShell: Boolean(scene.getObjectByName('diorama shell')), generated: s.filter((o) => o.endsWith(':build seat') || o.endsWith(':build shell') || o.endsWith(':build floor')).length }
        })
        check(`${label}: the capture shows generated walls, today's are set aside`, swap.todayRoomChildren === 0 && !swap.todayShell && swap.generated === (label === 'iso' ? 3 : 1), swap)
        await jpg(page, `${label}-generated.jpg`)
      } else if (shots.length === 1) await jpg(page, `${label}-baseline.jpg`)
      await context.close()
    }
    const floor = await diff(shots[0], shots[1])
    const generated = await diff(shots[0], shots[2], `${label}-diff.jpg`)
    // The seated view is bit-identical; iso differs only in scattered floor pixels (UVs from world positions, about 3,800 px, max 43).
    const exact = label === 'seat'
    check(`${label}: generated vs without the flag ${exact ? 'bit-identical' : 'within the measured floor residual'}`, exact ? generated.differingPixels === 0 : generated.differingPixels <= 5000 && generated.maxChannelSum <= 60, { noiseFloor: floor, generated })
  }
}

// ── 2 and 3. model, drag and bend ───────────────────────────────────────────
if (!args.includes('--skip-drag')) {
  const baseline = await open('?cam=iso&q=low&fx=')
  const today = await baseline.page.evaluate(() => window.village.snapshot())
  await baseline.context.close()

  const videoDir = join(OUT, 'video-tmp')
  rmSync(videoDir, { recursive: true, force: true })
  const { context, page, errors } = await open('?cam=iso&q=low&fx=&build=1', { video: videoDir })
  const stats = () => page.evaluate(() => {
    const s = window.village.snapshot()
    return { geometries: s.geometries, textures: s.textures }
  })

  // The model, imported straight from the dev server.
  const model = await page.evaluate(async () => {
    const P = await import('/src/build/plan.ts')
    const K = P.KITCHEN
    const out = { kitchen: P.validate(K), roundTrip: JSON.stringify(JSON.parse(JSON.stringify(K))) === JSON.stringify(K) }
    out.kitchenArea = +P.roomArea(K, 'kitchen').toFixed(4)
    const added = P.apply(K, { op: 'addRoom', room: { id: 'pantry', label: 'Pantry' }, wallId: 'kitchen.left', from: 1, to: 5, depth: 3, door: { id: 'pantry.door', from: 2.25, to: 3.75, leaves: 2 } })
    const joined = (loop, a, b) => loop.some((c, i) => { const n = loop[(i + 1) % loop.length]; return (c === a && n === b) || (c === b && n === a) })
    const shared = added.walls.filter((w) => added.rooms.every((r) => joined(r.loop, w.a, w.b)))
    out.added = {
      valid: P.validate(added), walls: added.walls.length, shared: shared.map((w) => ({ id: w.id, length: +P.curveOf(added, w).length.toFixed(3), openings: w.openings })),
      pantryArea: +P.roomArea(added, 'pantry').toFixed(4), kitchenArea: +P.roomArea(added, 'kitchen').toFixed(4), kitchenLoop: added.rooms[0].loop.length,
    }
    out.moveOpening = P.wallOf(P.apply(K, { op: 'moveOpening', openingId: 'kitchen.window', from: 2.05, to: 3.45 }), 'kitchen.back').openings.find((o) => o.id === 'kitchen.window')
    try { P.apply(K, { op: 'moveOpening', openingId: 'kitchen.window', from: 0.5, to: 1.9 }); out.overlapRejected = [] } catch (e) { out.overlapRejected = e.reasons }
    const withWalls = (extra, corners = []) => ({ ...K, corners: [...K.corners, ...corners], walls: [...K.walls, ...extra] })
    const bare = (id, a, b) => ({ id, a, b, thickness: 0.18, height: 3, sagitta: 0, openings: [] })
    out.rejects = {
      dangling: P.validate({ ...K, walls: K.walls.map((w) => (w.id === 'kitchen.front' ? { ...w, b: 'nowhere' } : w)) }),
      short: P.validate(withWalls([bare('tiny', 'x1', 'x2')], [{ id: 'x1', x: 0, z: 0 }, { id: 'x2', x: 0.3, z: 0 }])),
      halfCircle: P.validate({ ...K, walls: K.walls.map((w) => (w.id === 'kitchen.right' ? { ...w, sagitta: 3.2 } : w)) }),
      crossing: P.validate({ ...withWalls([bare('d1', 'kitchen.back-right', 'kitchen.front-left'), bare('d2', 'kitchen.front-right', 'kitchen.back-left')]), rooms: [...K.rooms, { id: 'bow', label: 'Bow', loop: ['kitchen.back-left', 'kitchen.back-right', 'kitchen.front-left', 'kitchen.front-right'] }] }),
    }
    try { P.apply(P.apply(K, { op: 'bendWall', wallId: 'kitchen.left', sagitta: 0.5 }), { op: 'addRoom', room: { id: 'nook', label: 'Nook' }, wallId: 'kitchen.left', from: 1, to: 3, depth: 2 }); out.curvedSplit = [] } catch (e) { out.curvedSplit = e.reasons }
    return out
  })
  check('model: the kitchen plan validates and survives a JSON round trip', model.kitchen.length === 0 && model.roundTrip, { reasons: model.kitchen, area: model.kitchenArea })
  const shared = model.added.shared
  check('model: addRoom 4 x 3 m on the left wall with a double door validates', model.added.valid.length === 0, model.added.valid)
  check('model: the shared wall exists once, in both loops, and carries the double door', shared.length === 1 && shared[0].length === 4 && shared[0].openings.some((o) => o.leaves === 2 && o.kind === 'door'), shared)
  check('model: the new room is 12 m² and the kitchen keeps its area', Math.abs(model.added.pantryArea - 12) < 1e-6 && Math.abs(model.added.kitchenArea - model.kitchenArea) < 1e-6, model.added)
  check('model: moveOpening moves the window; an overlap with the door is rejected', model.moveOpening.from === 2.05 && model.overlapRejected.length > 0, { window: model.moveOpening, rejected: model.overlapRejected })
  for (const [name, reasons] of Object.entries(model.rejects)) check(`model: validate rejects ${name}`, reasons.length > 0, reasons)
  check('model: addRoom refuses to split a curved wall, with a reason', model.curvedSplit.length > 0, model.curvedSplit)

  // Drag the right wall with the mouse.
  const where = () => page.evaluate(() => {
    const p = window.villageBuild.plan()
    const br = p.corners.find((c) => c.id === 'kitchen.back-right'), fr = p.corners.find((c) => c.id === 'kitchen.front-right')
    const z = br.z + (fr.z - br.z) * 0.2, mid = (br.z + fr.z) / 2
    const pr = (x, zz) => window.villageBuild.project(x, 0.42, zz)
    return { x: br.x, at: pr(br.x, z), out: pr(br.x + 1, z), in: pr(br.x - 1, z), bend: pr(br.x, mid), bendOut: pr(br.x + 1, mid), floor: window.villageBuild.floorArea(), wallX: window.villageBuild.wallX(), sagitta: p.walls.find((w) => w.id === 'kitchen.right').sagitta }
  })
  const frames = (n = 12) => page.evaluate((n) => new Promise((r) => { const s = () => (--n ? requestAnimationFrame(s) : r()); requestAnimationFrame(s) }), n)
  const w0 = await where()
  await page.mouse.move(...w0.at)
  await frames()
  const cursor = await page.evaluate(() => document.querySelector('canvas').style.cursor)
  check('drag: hovering the right wall shows the grab handle', cursor === 'grab', cursor)
  await page.mouse.down()
  await page.mouse.move(...w0.out, { steps: 25 })
  await frames()
  // The size tag is drawn for the first time now (one geometry, one texture), so the leak check counts from here.
  const g0 = await stats()
  const out = await where()
  await jpg(page, 'drag-out.jpg')
  check('drag: 1 m out moves the plan by the snapped 1.0 m, and the wall and floor follow', Math.abs(out.x - w0.x - 1) < 1e-6 && Math.abs(out.wallX - w0.wallX - 1) < 1e-6 && Math.abs(out.floor - w0.floor - 6) < 0.01, { planX: [w0.x, out.x], wallX: [w0.wallX, out.wallX], floor: [+w0.floor.toFixed(3), +out.floor.toFixed(3)] })
  await page.mouse.move(...w0.in, { steps: 50 })
  await frames()
  const inn = await where()
  await jpg(page, 'drag-in.jpg')
  check('drag: 1 m in moves it by -1.0 m', Math.abs(inn.x - w0.x + 1) < 1e-6, { planX: inn.x, floor: +inn.floor.toFixed(3) })
  await page.mouse.move(...w0.at, { steps: 25 })
  await page.mouse.up()
  await frames(30)
  const back = await where()
  const g1 = await stats()
  check('drag: back at the start after 100 moves, geometries and textures flat since the first move', Math.abs(back.x - w0.x) < 1e-6 && g1.geometries === g0.geometries && g1.textures === g0.textures, { before: g0, after: g1 })

  // Escape cancels.
  await page.mouse.move(...w0.at)
  await page.mouse.down()
  await page.mouse.move((w0.at[0] + w0.out[0]) / 2, (w0.at[1] + w0.out[1]) / 2, { steps: 10 })
  await frames()
  const mid = await where()
  await page.keyboard.press('Escape')
  await page.mouse.up()
  await frames()
  const cancelled = await where()
  check('drag: Escape puts the wall back', Math.abs(mid.x - w0.x - 0.5) < 1e-6 && Math.abs(cancelled.x - w0.x) < 1e-6, { during: mid.x, after: cancelled.x })

  // A wall save that fails puts the wall back and says so.
  await page.evaluate(async () => { (await window.villageBuild.history()).commit = async () => { throw new Error('store down') } })
  const f0 = await where()
  await page.mouse.move(...f0.at)
  await frames()
  await page.mouse.down()
  await page.mouse.move(...f0.out, { steps: 25 })
  await frames()
  await page.mouse.up()
  await frames(30)
  const f1 = await where()
  const failedNote = await page.evaluate(() => window.villageBuild.noted())
  check('drag: a wall save that fails puts the wall back and says so', Math.abs(f1.x - f0.x) < 1e-6 && Math.abs(f1.wallX - f0.wallX) < 1e-6 && /put it back/.test(failedNote ?? ''), { f0: f0.wallX, f1: f1.wallX, failedNote })
  await page.evaluate(async () => { delete (await window.villageBuild.history()).commit })

  // Bend the wall out by 1 m at its middle.
  await page.mouse.move(...w0.bend)
  await frames()
  await page.mouse.down()
  await page.mouse.move(...w0.bendOut, { steps: 30 })
  await frames()
  await jpg(page, 'bend-drag.jpg')
  await page.mouse.up()
  await frames(30)
  const bent = await where()
  const expected = await page.evaluate(async () => {
    const P = await import('/src/build/plan.ts')
    const p = window.villageBuild.plan()
    return { segment: P.segmentArea(P.curveOf(p, P.wallOf(p, 'kitchen.right'))), planGrowth: P.roomArea(p, 'kitchen') - P.roomArea(P.KITCHEN, 'kitchen') }
  })
  const grew = bent.floor - w0.floor
  await jpg(page, 'bend.jpg')
  const g2 = await stats()
  check('bend: sagitta snaps to 1.00 m and the floor grows by about the circular segment', Math.abs(bent.sagitta - 1) < 1e-6 && Math.abs(grew - expected.segment) / expected.segment < 0.1, { sagitta: bent.sagitta, floorGrowth: +grew.toFixed(3), segment: +expected.segment.toFixed(3), planGrowth: +expected.planGrowth.toFixed(3) })
  check('bend: geometries and textures flat', g2.geometries === g0.geometries && g2.textures === g0.textures, g2)
  const versions = await page.evaluate(async () => {
    const h = await window.villageBuild.history()
    return { count: h.versions().length, head: JSON.stringify(h.plan) === JSON.stringify(window.villageBuild.plan()) }
  })
  check('versions: each committed drag is a version, and the head is what is drawn', versions.count > 1 && versions.head, versions)
  const ms = await page.evaluate(() => window.villageBuild.rebuildMs().slice(1).sort((a, b) => a - b))
  check('rebuild time per change (ms, median / max)', true, [ms[Math.floor(ms.length / 2)], ms[ms.length - 1]].map((v) => +v.toFixed(2)))

  // More than one room: a pantry on the left wall is drawn with its own floor, and the shared wall once.
  await page.evaluate(() => {
    window.villageBuild.intent({ op: 'addRoom', label: 'pantry', anchor: { side: 'left' }, size: { w: 4, d: 3 }, connect: { kind: 'door', leaves: 2 } })
    window.villageBuild.outline.confirm()
  })
  await page.waitForTimeout(800)
  await frames()
  const multi = await page.evaluate(() => {
    const p = window.villageBuild.plan()
    const scene = window.village.kernel.root.get('stage').scene
    const shared = p.walls.filter((w) => p.rooms.filter((r) => r.loop.includes(w.a) && r.loop.includes(w.b)).length === 2).map((w) => w.id)
    const drawn = {}
    scene.getObjectByName('build').traverse((o) => {
      if (!shared.includes(o.userData.wall) || o.userData.cutaway || !o.geometry || o.geometry.parameters?.height < 0.1) return
      const part = o.parent.name
      drawn[part] = (drawn[part] ?? 0) + 1
    })
    return { rooms: p.rooms.map((r) => r.id), floors: window.villageBuild.floors(), shared, drawn }
  })
  check('two rooms: each has its floor, and the shared wall is drawn by one room only', multi.rooms.length === 2 && multi.floors === 2 && multi.shared.length === 1 && Object.keys(multi.drawn).length === 1, multi)
  await jpg(page, 'two-rooms.jpg')

  await page.evaluate(() => window.village.unload('build'))
  await frames()
  const after = await page.evaluate(() => window.village.snapshot())
  // Other plugins that load only under ?build=1 (placing things, #48) keep their own objects; compare the rest.
  const others = /^Group:(placed things|placement)$/
  const sameObjects = JSON.stringify(after.objects.filter((o) => !others.test(o))) === JSON.stringify(today.objects)
  check('unload: today\'s room is back (scene object list equal to a page without build)', sameObjects, { objects: [today.objects.length, after.objects.length], geometries: [today.geometries, after.geometries] })
  check('drag page: no console errors', errors.length === 0, errors.slice(0, 3))
  const video = page.video()
  await context.close()
  if (video) {
    const webm = await video.path()
    const mp4 = join(OUT, 'drag.mp4')
    try {
      execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', webm, '-vf', 'scale=960:-2', '-c:v', 'libx264', '-crf', '28', '-pix_fmt', 'yuv420p', mp4])
      check('clip written', true, `${mp4}, ${(statSync(mp4).size / 1e6).toFixed(2)} MB`)
    } catch {
      renameSync(webm, join(OUT, 'drag.webm'))
      check('clip written', true, join(OUT, 'drag.webm'))
    }
    rmSync(videoDir, { recursive: true, force: true })
  }
}

// ── 4. A read-only house (its store answers but cannot be opened) ───────────
if (!args.includes('--skip-drag')) {
  const ro = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 })
  const rp = await ro.newPage()
  await rp.route('**/villager/launch', (r) => r.fulfill({ json: { token: 't' } }))
  await rp.route('**/villager/api/house/plans', (r) => r.fulfill({ status: 500, json: { error: 'plan event 3 follows 1' } }))
  await rp.goto(`${base}?cam=iso&q=low&fx=&build=1`)
  await rp.evaluate(() => window.village.ready())
  await rp.evaluate(() => window.villageBuild.history())
  await rp.waitForTimeout(1500)
  const at = await rp.evaluate(() => {
    const p = window.villageBuild.plan()
    const br = p.corners.find((c) => c.id === 'kitchen.back-right'), fr = p.corners.find((c) => c.id === 'kitchen.front-right')
    return window.villageBuild.project(br.x, 0.42, br.z + (fr.z - br.z) * 0.2)
  })
  await rp.mouse.move(...at)
  await rp.evaluate(() => new Promise((r) => { let n = 12; const s = () => (--n ? requestAnimationFrame(s) : r()); requestAnimationFrame(s) }))
  const roCursor = await rp.evaluate(() => document.querySelector('canvas').style.cursor)
  const roNote = await rp.evaluate(() => window.villageBuild.noted())
  check('a read-only house says so and offers no wall handle', roCursor !== 'grab' && /couldn't open the saved house/.test(roNote ?? ''), { roCursor, roNote })
  await ro.close()
}

console.log(JSON.stringify({ passed: checks.filter((c) => c.pass).length, failed: checks.filter((c) => !c.pass).map((c) => c.name) }))
await browser.close()
if (checks.some((c) => !c.pass)) process.exitCode = 1
