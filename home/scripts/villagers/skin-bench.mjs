// #47 look regroup 3 (sewn skin): build time, triangles and draw calls (meshes) per villager, with and without the
// trusted skin (gen/skin.ts), on saved modules. No model calls. Every module goes through the sandbox and the
// assembler in the page (villagerGen.trial), with the checks on (species and mark), the kit on and the requested role.
// Usage: node scripts/villagers/skin-bench.mjs <prefix> [base-url] [--skin] [--runs=3]   (dev server running)
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const dir = resolve(dirname(fileURLToPath(import.meta.url)), '../../generated/villagers')
const prefix = process.argv[2] ?? 'r8-'
const base = process.argv[3]?.startsWith('http') ? process.argv[3] : 'http://localhost:5332/'
const skin = process.argv.includes('--skin')
const runs = Number(process.argv.find((a) => a.startsWith('--runs='))?.slice(7) ?? 3)
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu', '--use-angle=metal'] })
const rows = []
try {
  const page = await browser.newPage({ viewport: { width: 640, height: 400 } })
  await page.goto(`${base}?plugins=renderer,camera&q=low&villager=gen&gen=none`)
  await page.waitForFunction(() => window.villagerGen, null, { timeout: 30000 })
  for (const id of readdirSync(dir).filter((d) => d.startsWith(prefix)).sort()) {
    const meta = JSON.parse(readFileSync(join(dir, id, 'meta.json'), 'utf8'))
    const code = readFileSync(join(dir, id, meta.file ?? 'villager.code.txt'), 'utf8')
    let best = null
    for (let k = 0; k < runs; k++) {
      const r = await page.evaluate(([c, o]) => window.villagerGen.trial(c, o), [code, { mark: true, species: true, accent: meta.accent, role: meta.role, skin }])
      if (!r.ok) { best = r; break }
      if (!best || r.timing.assembleMs < best.timing.assembleMs) best = r
    }
    const row = best.ok
      ? { id, ok: true, triangles: best.triangles, meshes: best.meshes, assembleMs: +best.timing.assembleMs.toFixed(1), skinMs: best.timing.skinMs === undefined ? undefined : +best.timing.skinMs.toFixed(1), skin: best.fixes.filter((f) => f.startsWith('skin') || f.startsWith('kit: hat')) }
      : { id, ok: false, reason: best.reason.slice(0, 300) }
    rows.push(row)
    console.log(JSON.stringify(row))
  }
} finally {
  await browser.close()
}
const ok = rows.filter((r) => r.ok)
const med = (xs) => xs.sort((a, b) => a - b)[Math.floor(xs.length / 2)]
console.log(JSON.stringify({ skin, villagers: rows.length, ok: ok.length, medianTriangles: med(ok.map((r) => r.triangles)), maxTriangles: Math.max(...ok.map((r) => r.triangles)), medianMeshes: med(ok.map((r) => r.meshes)), medianAssembleMs: med(ok.map((r) => r.assembleMs)), maxAssembleMs: Math.max(...ok.map((r) => r.assembleMs)), medianSkinMs: skin ? med(ok.map((r) => r.skinMs ?? 0)) : undefined, maxSkinMs: skin ? Math.max(...ok.map((r) => r.skinMs ?? 0)) : undefined }))
