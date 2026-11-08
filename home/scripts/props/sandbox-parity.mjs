// #42 prop sandbox: parity and overhead for generated code modules.
// Parity: each run id is captured through the sandbox and through the old direct
// import (&run=direct, comparison only), plus a second direct capture as the noise
// floor, and the pairs are pixel-diffed in the browser.
// Overhead: module text to prop on screen, cold (a fresh page per sample) and warm
// (repeated in one page), split into box start, run, serialize, transfer, rebuild.
// Usage: node scripts/props/sandbox-parity.mjs <out-dir> [base-url] [run-id ...]   (dev server running)
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { chromium } from 'playwright'

const out = resolve(process.argv[2])
const base = process.argv[3] ?? 'http://localhost:5304/'
const ids = process.argv.slice(4).length ? process.argv.slice(4) : [1, 2, 3, 4, 5].map((p) => `a-sonnet-p${p}`)
const COLD = 3, WARM = 7
mkdirSync(join(out, 'shots'), { recursive: true })
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu', '--use-angle=metal'] })

async function open(query) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
  await page.goto(`${base}?talk=off&build=0&cam=iso&q=high&${query}`)
  await page.waitForFunction(() => window.village && window.villageProps, null, { timeout: 30000 })
  await page.evaluate(() => window.village.ready())
  return page
}

async function shoot(id, direct, file) {
  const page = await open(`props=${id}&focus=1${direct ? '&run=direct' : ''}`)
  const report = (await page.evaluate(() => window.villageProps.loaded))[id]
  await page.waitForTimeout(2500)
  const png = await page.screenshot({ path: join(out, 'shots', file), type: 'png' })
  await page.close()
  return { report, png: png.toString('base64') }
}

/** Fraction of pixels whose largest channel differs by more than 16, and the mean absolute difference (0-255). */
async function diff(a, b) {
  const page = await browser.newPage()
  const result = await page.evaluate(async ([x, y]) => {
    const load = async (s) => createImageBitmap(await (await fetch(`data:image/png;base64,${s}`)).blob())
    const [ia, ib] = await Promise.all([load(x), load(y)])
    const read = (img) => {
      const c = new OffscreenCanvas(img.width, img.height)
      const g = c.getContext('2d')
      g.drawImage(img, 0, 0)
      return g.getImageData(0, 0, img.width, img.height).data
    }
    const da = read(ia), db = read(ib)
    let changed = 0, sum = 0
    for (let i = 0; i < da.length; i += 4) {
      const d = Math.max(Math.abs(da[i] - db[i]), Math.abs(da[i + 1] - db[i + 1]), Math.abs(da[i + 2] - db[i + 2]))
      sum += d
      if (d > 16) changed++
    }
    return { changedPct: (100 * changed) / (da.length / 4), meanAbs: sum / (da.length / 4) }
  }, [a, b])
  await page.close()
  return result
}

const p50 = (xs) => {
  const s = xs.filter(Number.isFinite).sort((a, b) => a - b)
  return s.length ? s[Math.floor((s.length - 1) / 2)] : NaN
}
const split = (t) => ({
  start: t.timing.startMs, run: t.timing.runMs, serialize: t.timing.serializeMs, transfer: t.timing.transferMs,
  rebuild: t.timing.validateMs + t.timing.rebuildMs, total: t.toFrameMs,
})

const results = {}
for (const id of ids) {
  const prompt = Number(/p(\d+)$/.exec(id)?.[1] ?? 1)
  const box = await shoot(id, false, `${id}-box.png`)
  const direct = await shoot(id, true, `${id}-direct.png`)
  const direct2 = await shoot(id, true, `${id}-direct2.png`)
  const parity = { boxVsDirect: await diff(box.png, direct.png), directVsDirect: await diff(direct.png, direct2.png) }

  const code = await (await fetch(`${base}generated/props/${id}/prop.ts`)).text()
  const cold = [], warm = []
  for (let i = 0; i < COLD; i++) {
    const page = await open('props=none')
    await page.waitForTimeout(800)
    const t = await page.evaluate(([c, p]) => window.villageProps.trial(c, { place: true, prompt: p }), [code, prompt])
    if (!t.ok) throw new Error(`${id} cold: ${t.reason}`)
    cold.push(split(t))
    if (i === COLD - 1) {
      for (let k = 0; k < WARM; k++) {
        await page.waitForTimeout(300) // lets the relay pre-start the next worker, as between real requests
        const w = await page.evaluate(([c, p]) => window.villageProps.trial(c, { place: true, prompt: p }), [code, prompt])
        if (!w.ok) throw new Error(`${id} warm: ${w.reason}`)
        warm.push(split(w))
      }
    }
    await page.close()
  }
  const summary = (rows) => Object.fromEntries(Object.keys(rows[0]).map((k) => [k, Math.round(p50(rows.map((r) => r[k])) * 10) / 10]))
  results[id] = {
    ok: box.report?.ok && direct.report?.ok,
    triangles: box.report?.triangles,
    meshes: box.report?.meshes,
    parity,
    directBuildMs: [direct.report?.buildMs, direct2.report?.buildMs].map((v) => Math.round(v)),
    cold: summary(cold),
    warm: summary(warm),
  }
  console.log(id, JSON.stringify(results[id]))
}
writeFileSync(join(out, 'sandbox-parity.json'), JSON.stringify(results, null, 1))
await browser.close()
