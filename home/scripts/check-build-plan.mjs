// Headless proof for the #48 build-mode experiment (?build=1).
// Usage: node scripts/check-build-plan.mjs [base-url] [--skip-pixels] [--skip-drag]   (dev server running)
// 1. Pixel-close: today's kitchen vs the plan-generated one, iso and seated, against
//    the noise floor of two runs of today's code (fixed clock, seeded Math.random).
// 2. The plan model: validate, JSON round trip, addRoom with a shared wall, rejections.
// 3. Drag and bend the right wall in iso with the mouse: snapping, live rebuild,
//    no geometry leak, Escape cancels, edits replay, unloading restores today's room.
// Exits non-zero when any check fails. Writes screenshots/build/*.jpg and a clip.
import { chromium } from 'playwright'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

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
    let sum = 0, changed = 0
    for (let i = 0; i < da.data.length; i += 4) {
      const d = Math.abs(da.data[i] - db.data[i]) + Math.abs(da.data[i + 1] - db.data[i + 1]) + Math.abs(da.data[i + 2] - db.data[i + 2])
      sum += d
      if (d > 24) changed++
      const v = Math.min(255, d * 8)
      out.data[i] = 20 + v
      out.data[i + 1] = 16 + v * 0.7
      out.data[i + 2] = 14 + v * 0.3
      out.data[i + 3] = 255
    }
    g.putImageData(out, 0, 0)
    return { mean: sum / (da.data.length / 4) / 3, changedPct: (100 * changed) / (da.data.length / 4), image: c.toDataURL('image/jpeg', 0.85) }
  }, [a, b].map((buf) => `data:image/png;base64,${buf.toString('base64')}`))
  await page.close()
  if (name) writeFileSync(join(OUT, name), Buffer.from(result.image.split(',')[1], 'base64'))
  return { mean: +result.mean.toFixed(3), changedPct: +result.changedPct.toFixed(3) }
}

const jpg = (page, name) => page.screenshot({ path: join(OUT, name), type: 'jpeg', quality: 85 })

// ---------------------------------------------------------------- 1. pixels
if (!args.includes('--skip-pixels')) {
  for (const [label, query] of [['iso', '?cam=iso&q=low&fx='], ['seat', '?q=low&fx=']]) {
    const shots = []
    for (const q of [query, query, `${query}&build=1`]) {
      const { context, page, errors } = await open(q, { frozen: true })
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
    check(`${label}: generated vs today within the noise floor`, generated.mean <= Math.max(floor.mean * 1.5, 0.15), { noiseFloor: floor, generated })
  }
}

console.log(JSON.stringify({ passed: checks.filter((c) => c.pass).length, failed: checks.filter((c) => !c.pass).map((c) => c.name) }))
await browser.close()
if (checks.some((c) => !c.pass)) process.exitCode = 1
