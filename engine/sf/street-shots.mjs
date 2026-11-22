// Street-level pictures of San Francisco (#450), each with what the march hit under a grid of its pixels, so that
// sf/street-checks.py can measure the road in the picture itself.
//
//   node sf/street-shots.mjs --out ~/.village/engine/sf/street/new [--only city|realm] [--places "Castro,Powell"] [--dist dist-sf] [--no-build] [--query "&shadows=0"] [--marks <marks.bin to find the yellow crossing in>]
//
// city: the panel's sixteen street cameras (~/.village/engine/bay/450-panel/fixed-poses.json), drawn by the page
// server from the same packs the panel draws them from (bay/city_panel.py), at 960 x 540 and 15h.
// realm: Powell St, California St and Filbert St at its steepest, and the longest crossing OSM says is yellow in the
// realm's pilot squares (School crossing), in the SF realm's static folder at 12.5h with street life off (a parked
// car would hide the road from the grid) and every pixel drawn (scale=1); and the panel's cameras in the places the
// realm's street graph covers, as realm-<place>. Each view is drawn again at twice the size, as <name>@2x.png.
// Beside each <name>.png goes <name>.json: the camera (and its view as the page had it: eye, forward, right, up,
// tanHalf) and, for a grid of pixels below the horizon, the material and colour the march's own pick found there,
// how far off it was and where (x, z in cells).
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { spawn, spawnSync } from 'node:child_process'
import { chromium } from 'playwright'
import { arg, CHROME, has, here, turn } from '../test/kit.mjs'
import { plain } from '../player/serve.mjs'

const out = arg('out', join(homedir(), '.village', 'engine', 'sf', 'street', 'new')), only = arg('only', ''), W = 960, H = 540
const places = arg('places', '').split(',').filter(Boolean), extra = arg('query', '')
mkdirSync(out, { recursive: true })
const PANEL = join(homedir(), '.village', 'engine', 'bay', '450-panel', 'fixed-poses.json')
// The panel's packs: the round-two groups (bay/city_panel.py renders each place from its square's group).
const GROUPS = join(homedir(), '.village', 'engine', 'bay', '450-city-paint', 'quality', 'round2', 'work', 'base')
const SQUARES = JSON.parse(readFileSync(join(here, 'bay', 'neighbourhoods.json'), 'utf8'))
const groupOf = (square) => readdirSync(join(GROUPS, 'controls')).includes(square) ? join(GROUPS, 'controls', square) : square === '553.7_4178.5' ? join(GROUPS, 'final', 'dog') : join(GROUPS, 'final', 'pilot')

/** What the march hits under a grid of pixels, from the bottom of the picture to a little over the horizon. */
const label = (page) => page.evaluate(async ({ W, H }) => {
  const e = globalThis.engine, v = e.view(), aspect = W / H, grid = []
  const add = (a, b, k) => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k]
  for (let py = Math.round(H * 0.45); py < H; py += 9) for (let px = 6; px < W; px += 12) {
    const u = (2 * (px + 0.5)) / W - 1, w = (2 * (py + 0.5)) / H - 1
    let d = add(add(v.forward, v.right, u * v.tanHalf * aspect), v.up, -w * v.tanHalf)
    const l = Math.hypot(...d); d = d.map((c) => c / l)
    const hit = await e.march.pick({ ...v, forward: d })
    // And where it met it, x and z in cells: what of the road's marks (marks.bin) is there is read from that.
    if (hit) grid.push([px, py, hit.material, hit.colour, Math.round(hit.t * 100) / 100, Math.round((v.eye[0] + d[0] * hit.t) * 100) / 100, Math.round((v.eye[2] + d[2] * hit.t) * 100) / 100])
  }
  return { grid, eye: v.eye, forward: v.forward, right: v.right, up: v.up, tanHalf: v.tanHalf }
}, { W, H })

const settle = (page) => page.waitForFunction(() => { const s = globalThis.engine.world.stats; return s.wanted === 0 && s.stale === 0 }, null, { timeout: 120_000, polling: 250 }).catch(() => console.log('  not all made in two minutes'))
const HIDE = '#hud, #aim, #boom, #tools, #over, #where, #realm, #first { display: none !important }'

// Pictures, with nothing timed: one turn on the GPU, like any check (test/kit.mjs).
const back = await turn()
const browser = await chromium.launch(CHROME)
const context = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1 })
const page = await context.newPage()
page.on('pageerror', (e) => console.log('page error:', e.message))
const save = async (name, camera) => {
  await page.addStyleTag({ content: HIDE })
  await page.waitForTimeout(800)
  await page.screenshot({ path: join(out, `${name}.png`) })
  const { grid, ...view } = await label(page)
  writeFileSync(join(out, `${name}.json`), JSON.stringify({ camera: { ...camera, view }, grid }))
  // The same view drawn at twice the size (sf/street_checks.py halves it, for how far off marks alias).
  await page.setViewportSize({ width: 2 * W, height: 2 * H })
  await page.waitForTimeout(1500)
  await settle(page)
  await page.waitForTimeout(2500)
  await page.screenshot({ path: join(out, `${name}@2x.png`) })
  await page.setViewportSize({ width: W, height: H })
  await page.waitForTimeout(1500)
  console.log(`  ${name}: ${grid.length} labelled pixels`)
}

try {
  if (only !== 'realm') {
    // ── The sixteen panel cameras, a server for each group of packs ──
    const poses = JSON.parse(readFileSync(PANEL, 'utf8'))
    const byGroup = new Map()
    for (const r of SQUARES) if (!places.length || places.includes(r.place)) { const g = groupOf(r.square); byGroup.set(g, [...(byGroup.get(g) ?? []), r]) }
    for (const [group, rows] of byGroup) {
      const server = spawn(process.execPath, ['serve.mjs', '--port', '0', '--reports', '/dev/null'], { cwd: here, env: { ...process.env, VILLAGE_BAY_ROOT: group }, stdio: ['ignore', 'pipe', 'inherit'] })
      const url = await new Promise((ok, no) => { let text = ''; server.stdout.on('data', (b) => { text += b; const m = text.match(/engine page on (http:\/\/127\.0\.0\.1:\d+)/); if (m) ok(m[1]) }); server.on('exit', () => no(new Error('server ended'))) })
      try {
        for (const r of rows) {
          const [x, y, z, yaw, pitch] = poses[r.place].street
          await page.goto(`${url}/city?bay=1&fly=0&sound=0&scale=1&hour=12.5&at=${x},${y},${z}&look=${yaw},${pitch}${extra}`)
          await page.waitForFunction(() => globalThis.engine?.world.stats.ready > 0, null, { timeout: 120_000 })
          await settle(page)
          await page.waitForTimeout(3000)
          await save(r.place, { x, y, z, yaw: (yaw * Math.PI) / 180, pitch, hour: 12.5 })
        }
      } finally { server.kill() }
    }
  }
  if (only !== 'city') {
    // ── Three streets in the realm ──
    const dist = join(here, arg('dist', 'dist-sf'))
    if (!has('no-build')) { const b = spawnSync(process.execPath, [join(here, 'sf/build.mjs'), '--out', dist], { cwd: here, encoding: 'utf8' }); if (b.status !== 0) throw new Error(b.stdout + b.stderr) }
    const graphs = readdirSync(join(here, 'sf/pilot-graph')).map((f) => JSON.parse(readFileSync(join(here, 'sf/pilot-graph', f), 'utf8')))
    const segments = (name) => graphs.flatMap((g) => g.roads.filter((r) => r.name === name).flatMap((r) => r.line.slice(1).map((b, i) => [r.line[i], b])))
    const site = await plain(dist, '127.0.0.1', 0, {})
    await page.goto(`${site.url}/sf/index.html?hour=12.5&street=0&people=0&knock=0&first=0&scale=1${extra}`)
    await page.waitForFunction(() => globalThis.engine?.seen?.whole > 0, null, { timeout: 300_000 })
    const STREETS = [
      // Powell at Washington (sf-life's place), looking up the hill to the north; California by Powell, looking down to
      // the east; Filbert where it is steepest in the pilot, looking up it.
      { name: 'Powell', street: 'Powell Street', at: [519580, 668046] },
      { name: 'California', street: 'California Street', at: [519200, 668950] },
      { name: 'Filbert', street: 'Filbert Street', steepest: true },
      { name: 'School crossing', yellow: true },
    ]
    // The road's marks the realm draws (sf/marks.mjs): the yellow crossings in the pilot's squares.
    const w = new Int32Array(new Uint8Array(readFileSync(arg('marks', join(dist, 'bay/marks.bin')))).buffer), nc = w[1]
    const pilot = new Set(graphs.map((g) => g.square)), inPilot = ([x, z]) => { const e = 500 + x / 10000, n = 4250 - z / 10000; return pilot.has(`${(Math.floor(e - 0.7) + 0.7).toFixed(1)}_${(Math.floor(n - 0.5) + 0.5).toFixed(1)}`) }
    const yellows = []
    for (let i = 0; i < w[2]; i++) { const s = w.subarray(3 + nc * 4 + i * 5, 3 + nc * 4 + i * 5 + 5); if ((s[4] & 15) === 4 && s[4] >> 4 === 1) yellows.push([[s[0], s[1]], [s[2], s[3]]]) }
    for (const s of STREETS.filter((s) => !places.length || places.includes(s.name))) {
      // A crossing: looked at along the road, 10 m back from its middle (the road runs across the crossing's line).
      if (s.yellow) {
        const [a, b] = yellows.filter((c) => inPilot(c[0])).sort((p, q) => Math.hypot(q[1][0] - q[0][0], q[1][1] - q[0][1]) - Math.hypot(p[1][0] - p[0][0], p[1][1] - p[0][1]))[0] ?? []
        if (!a) { console.log('  no yellow crossing in the pilot'); continue }
        const l = Math.hypot(b[0] - a[0], b[1] - a[1]), rx = -(b[1] - a[1]) / l, rz = (b[0] - a[0]) / l, mx = (a[0] + b[0]) / 2, mz = (a[1] + b[1]) / 2
        const pick = { x: (mx - rx * 100) / 10, z: (mz - rz * 100) / 10, yaw: Math.atan2(rx, -rz), grade: 0 }
        await page.evaluate((p) => { const e = globalThis.engine; Object.assign(e.pose, { x: p.x, z: p.z, y: e.ground(p.x, p.z) + 1.7, yaw: p.yaw, pitch: -0.15 }) }, pick)
        await page.waitForTimeout(1500)
        await settle(page)
        await page.waitForTimeout(3000)
        await save(s.name, { ...pick, hour: 12.5 })
        continue
      }
      const all = segments(s.street)
      const pick = await page.evaluate(({ all, s }) => {
        const e = globalThis.engine, mid = ([a, b]) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]
        const grade = ([a, b]) => { const l = Math.hypot(b[0] - a[0], b[1] - a[1]); return l < 40 ? 0 : (e.ground(b[0] / 10, b[1] / 10) - e.ground(a[0] / 10, a[1] / 10)) / (l / 10) }
        const best = s.steepest ? all.reduce((p, q) => Math.abs(grade(q)) > Math.abs(grade(p)) ? q : p) : all.reduce((p, q) => { const d = (g) => Math.hypot(mid(g)[0] - s.at[0], mid(g)[1] - s.at[1]); return d(q) < d(p) ? q : p })
        let [a, b] = best
        // Always looking uphill: the steps of a street face the eye that way.
        if (grade(best) < 0) [a, b] = [b, a]
        const l = Math.hypot(b[0] - a[0], b[1] - a[1]), dx = (b[0] - a[0]) / l, dz = (b[1] - a[1]) / l
        return { x: (a[0] - dx * 120) / 10, z: (a[1] - dz * 120) / 10, yaw: Math.atan2(dx, -dz), grade: grade(best) }
      }, { all, s })
      await page.evaluate((p) => { const e = globalThis.engine; Object.assign(e.pose, { x: p.x, z: p.z, y: e.ground(p.x, p.z) + 1.7, yaw: p.yaw, pitch: -0.08 }) }, pick)
      await page.waitForTimeout(1500)
      await settle(page)
      await page.waitForTimeout(3000)
      await save(s.name, { ...pick, hour: 12.5 })
    }
    // The panel's cameras in the places the realm's graph covers, as the realm draws them (with its marks).
    const covered = new Set(graphs.map((g) => g.square)), poses = JSON.parse(readFileSync(PANEL, 'utf8'))
    for (const r of SQUARES) {
      const name = `realm-${r.place}`
      if (!covered.has(r.square) || (places.length && !places.includes(name))) continue
      const [x, y, z, yaw, pitch] = poses[r.place].street
      await page.evaluate((p) => Object.assign(globalThis.engine.pose, p), { x, y, z, yaw: (yaw * Math.PI) / 180, pitch: (pitch * Math.PI) / 180 })
      await page.waitForTimeout(1500)
      await settle(page)
      await page.waitForTimeout(3000)
      await save(name, { x, y, z, yaw: (yaw * Math.PI) / 180, pitch, hour: 12.5 })
    }
    await site.close?.()
  }
} finally {
  await browser.close()
  back()
}
process.exit(0)
