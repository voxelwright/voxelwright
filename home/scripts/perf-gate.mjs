// Performance gate before merging to main (#42): production builds of a base ref and the
// head, measured in one headless Chrome with base and head interleaved, against an
// absolute 60 fps target and against the base. Exits non-zero when any gate fails.
//
// Usage: npm run perf-gate -- [--base <ref>] [--head <ref>] [--scenes a,b] [--full] [--seconds 2] [--json path]
//   --base  defaults to the merge base of HEAD with origin/main (or main, then feature/village).
//   --head  defaults to the working tree of this checkout.
//   --scenes  names scenes; the default is every scene not marked `full` in SCENES below.
//   --full  adds the `full` scenes (?q=low), which do not fit the 30 s budget.
//   --seconds  steady measuring time per version per scene (default 2).
//
// Builds are cached by commit SHA (base) or by the home/ tree hash of the working tree
// (head) under ~/.cache/village/perf-gate, so every worktree shares them. A base build
// extracts the ref with `git archive`, runs `npm ci` and `vite build` there.
//
// The probe runs in the page before the app (addInitScript), so base and head are measured
// the same way whatever their code: Math.random is seeded, requestAnimationFrame is wrapped
// to time every frame's callbacks (CPU ms) and to hold them while the page is paused, and
// GPU ms is the wait from a frame's last submit to device.queue.onSubmittedWorkDone(), the
// renderer's own measure, without ?gpu=1's timestamp queries. Only one page renders at a time.
import { spawn, execFileSync } from 'node:child_process'
import { createServer } from 'node:http'
import { existsSync } from 'node:fs'
import { mkdir, readFile, rm, writeFile, rename } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { dirname, extname, join, normalize, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const started = Date.now()
const HOME = join(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const opt = (name) => {
  const i = args.findIndex((a) => a === `--${name}` || a.startsWith(`--${name}=`))
  if (i < 0) return undefined
  return args[i].includes('=') ? args[i].slice(args[i].indexOf('=') + 1) : args[i + 1]
}
const git = (...a) => execFileSync('git', a, { cwd: HOME, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
const tryGit = (...a) => { try { return git(...a) } catch { return null } }
const CACHE = join(process.env.XDG_CACHE_HOME ?? join(homedir(), '.cache'), 'village', 'perf-gate')
const PORTS = { base: 5430, head: 5431 }
const SECONDS = Number(opt('seconds') ?? 2)
const WINDOWS = 2 // per version, when base and head alternate; a head-only scene takes one window
const WARM_MS = 300 // after each resume
// After ready() a page keeps compiling pipelines for a few seconds; it renders until this
// many frames in a row arrive on time before it is paused, or the next page would stall.
const SETTLE_FRAMES = 20
const SETTLE_MAX_MS = 10_000
const MIN_FRAMES = 0.9 // a version measured with fewer than this share of 60 Hz frames is invalid
const VIEWPORT = { width: 1440, height: 900 }
const DPR = 2

// ── Gates ──────────────────────────────────────────────────────────────────────
// Absolute, head only, every scene: the owner's consistent 60 fps. Headless Chrome caps at
// 60 Hz, so an interval over 20 ms is a missed frame.
const MAX_DROPPED = 0.01 // intervals over 20 ms, as a share of frames
const MAX_P99_MS = 20
const MAX_LONG_TASK_MS = 50 // any long task over this in the steady windows fails
// Headroom: at the high tier, GPU p95 stays under the tier's step-down threshold, read
// from TIERS in src/plugins/renderer.ts (the one owner of that number).
// Relative, head against base, where the base has the scene: allowed growth is the larger
// of a share of the base value and a floor. The floors sit above the base-against-base
// spread measured on the M1 Pro on November 6, 2026 (README, "Performance gate"): GPU p50
// moved up to 2.4 ms and GPU p95 up to 7.3 ms with other agents' headless Chrome sharing the
// GPU; CPU p50 0.1 ms; draw calls 0. Remeasure with --base X --head X on a quiet machine.
const RELATIVE = {
  gpuP50: { label: 'GPU p50 ms', share: 0.1, floor: 3 },
  gpuP95: { label: 'GPU p95 ms', share: 0.1, floor: 8 },
  cpuP50: { label: 'CPU p50 ms', share: 0.1, floor: 0.5 },
  drawCalls: { label: 'draw calls', share: 0.1, floor: 10 },
}

/**
 * Scenes. Each `page` is loaded once per version; scenes on the same page run in order.
 * `needs` names a plugin the base must have for the scene to be compared; without it the
 * scene runs on the head only (absolute gates).
 */
const SCENES = [
  { name: 'home', page: 'home', query: '?q=high', tier: 'high' },
  { name: 'home-low', page: 'low', query: '?q=low', tier: 'low', full: true },
  { name: 'villagers', page: 'npc', query: '?talk=npc&q=high', tier: 'high', needs: 'talk' },
  { name: 'talk', page: 'npc', query: '?talk=npc&q=high', tier: 'high', needs: 'talk', setup: openTalk },
]
const wanted = opt('scenes')?.split(',')
const scenes = wanted ? SCENES.filter((s) => wanted.includes(s.name)) : SCENES.filter((s) => !s.full || args.includes('--full'))
if (!scenes.length) throw new Error(`no scene matches --scenes ${opt('scenes')}; known: ${SCENES.map((s) => s.name).join(', ')}`)

/** A talk close-up with Alex's villager: hover it (it pauses), click it, wait out the camera arc. */
async function openTalk(page) {
  const at = () => page.evaluate(() => window.village.talk.screen('alex'))
  await page.mouse.move(...Object.values(await at()))
  await page.waitForTimeout(150)
  const p = await at()
  await page.mouse.click(p.x, p.y)
  const end = Date.now() + 4000
  while (Date.now() < end) {
    if ((await page.evaluate(() => window.village.talk.state().mode)) === 'talk') return page.waitForTimeout(500)
    await page.waitForTimeout(50)
  }
  throw new Error('the talk close-up did not open within 4 s')
}

// ── Refs and builds ────────────────────────────────────────────────────────────
function mainBranch() {
  for (const ref of ['origin/main', 'main', 'origin/feature/village', 'feature/village']) {
    if (tryGit('rev-parse', '--verify', '--quiet', `${ref}^{commit}`) && tryGit('merge-base', 'HEAD', ref)) return ref
  }
  throw new Error('no main branch shares history with HEAD; pass --base <ref>')
}
const baseRef = opt('base') ?? mainBranch()
const baseSha = opt('base') ? git('rev-parse', `${baseRef}^{commit}`) : git('merge-base', 'HEAD', baseRef)
const headRef = opt('head') ?? null

/** The home/ tree hash of the working tree, untracked files included, without touching the real index. */
function workingTreeHash() {
  const index = join(tmpdir(), `perf-gate-index-${process.pid}`)
  try {
    execFileSync('cp', [git('rev-parse', '--path-format=absolute', '--git-path', 'index'), index])
    const env = { ...process.env, GIT_INDEX_FILE: index }
    execFileSync('git', ['add', '-A', '--', '.'], { cwd: HOME, env })
    const tree = execFileSync('git', ['write-tree'], { cwd: HOME, env, encoding: 'utf8' }).trim()
    return git('rev-parse', `${tree}:${relative(git('rev-parse', '--show-toplevel'), HOME)}`)
  } finally {
    rm(index, { force: true })
  }
}

function run(cmd, argv, cwd, env = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, argv, { cwd, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] })
    let out = ''
    child.stdout.on('data', (d) => (out += d))
    child.stderr.on('data', (d) => (out += d))
    child.on('error', reject)
    child.on('exit', (code) => (code === 0 ? resolve(out) : reject(new Error(`${cmd} ${argv.join(' ')} exited ${code}:\n${out.slice(-1500)}`))))
  })
}
const vite = (cwd, outDir) => run(process.execPath, [join(cwd, 'node_modules/vite/bin/vite.js'), 'build', '--logLevel', 'error', '--emptyOutDir', '--outDir', outDir], cwd)

/** Build a commit's home/ into the cache once; returns { dist, ms, cached }. */
async function buildCommit(sha) {
  const dist = join(CACHE, `commit-${sha}`)
  if (existsSync(join(dist, 'index.html'))) return { dist, ms: 0, cached: true }
  const t = Date.now()
  const src = join(CACHE, `src-${sha}-${process.pid}`)
  await rm(src, { recursive: true, force: true })
  await mkdir(src, { recursive: true })
  try {
    await run('sh', ['-c', `set -o pipefail; git archive ${sha} home | tar -x -C "${src}"`], git('rev-parse', '--show-toplevel'))
    const home = join(src, 'home')
    await run('npm', ['ci', '--no-audit', '--no-fund', '--loglevel=error'], home, { PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: '1' })
    await vite(home, `${dist}.tmp`)
    await rename(`${dist}.tmp`, dist)
  } finally {
    await rm(src, { recursive: true, force: true })
  }
  return { dist, ms: Date.now() - t, cached: false }
}

/** Build this checkout's working tree into the cache, keyed by its home/ tree hash. */
async function buildWorkingTree() {
  const hash = workingTreeHash()
  const dist = join(CACHE, `tree-${hash}`)
  if (existsSync(join(dist, 'index.html'))) return { dist, ms: 0, cached: true, hash }
  const t = Date.now()
  await rm(`${dist}.tmp`, { recursive: true, force: true })
  await vite(HOME, `${dist}.tmp`)
  await rename(`${dist}.tmp`, dist)
  return { dist, ms: Date.now() - t, cached: false, hash }
}

// ── Static servers ─────────────────────────────────────────────────────────────
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wasm': 'application/wasm' }
function serve(dist, port) {
  const server = createServer(async (req, res) => {
    let path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname))
    if (path.endsWith('/')) path += 'index.html'
    const file = join(dist, path)
    if (!file.startsWith(dist)) return res.writeHead(403).end()
    try {
      const body = await readFile(file)
      res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' }).end(body)
    } catch {
      res.writeHead(404).end()
    }
  })
  return new Promise((resolve, reject) => {
    server.once('error', (e) => reject(new Error(`port ${port}: ${e.message}`)))
    server.listen(port, '127.0.0.1', () => resolve(server))
  })
}

// ── The in-page probe ──────────────────────────────────────────────────────────
function probe() {
  let seed = 42
  Math.random = () => {
    seed = (seed + 0x6d2b79f5) >>> 0
    let t = seed
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  const raf = window.requestAnimationFrame.bind(window)
  const P = { paused: true, held: [], frames: [], cpu: 0, gpu: [], longTasks: [], queue: null, waiting: false, submitted: false }
  window.__perf = P
  if (window.GPUQueue) {
    const submit = GPUQueue.prototype.submit
    GPUQueue.prototype.submit = function (...a) {
      P.queue = this
      P.submitted = true
      return submit.apply(this, a)
    }
  }
  window.requestAnimationFrame = (cb) => {
    if (P.paused) {
      P.held.push(cb)
      return 0
    }
    return raf((t) => {
      const a = performance.now()
      try {
        cb(t)
      } finally {
        const b = performance.now()
        P.cpu += b - a
        if (P.submitted && P.queue && !P.waiting) {
          P.waiting = true
          P.submitted = false
          P.queue.onSubmittedWorkDone().then(() => {
            P.waiting = false
            P.gpu.push(performance.now() - b)
          })
        }
      }
    })
  }
  const tick = (t) => {
    if (!P.paused) P.frames.push([t, P.cpu])
    P.cpu = 0
    raf(tick)
  }
  raf(tick)
  P.pause = () => { P.paused = true }
  P.resume = () => {
    P.paused = false
    for (const cb of P.held.splice(0)) window.requestAnimationFrame(cb)
  }
  // The page renders while it loads (shader compile happens then); the gate pauses it afterwards.
  P.paused = false
  try {
    new PerformanceObserver((list) => { for (const e of list.getEntries()) P.longTasks.push([e.startTime, e.duration]) }).observe({ type: 'longtask', buffered: true })
  } catch {}
}

/** Render until SETTLE_FRAMES frames in a row arrive within 20 ms; returns the ms it took, or null. */
const settle = (page) =>
  page.evaluate(
    ([need, max]) =>
      new Promise((resolve) => {
        const P = window.__perf
        P.resume()
        const t0 = performance.now()
        let from = P.frames.length
        const check = () => {
          const f = P.frames
          for (let i = Math.max(from, 1); i < f.length; i++) if (f[i][0] - f[i - 1][0] > 20) from = i
          if (f.length - from >= need) return resolve(performance.now() - t0)
          if (performance.now() - t0 > max) return resolve(null)
          setTimeout(check, 50)
        }
        check()
      }),
    [SETTLE_FRAMES, SETTLE_MAX_MS],
  )

/** Resume, warm up, record `ms` of frames, pause; returns the raw samples. */
const record = (page, warm, ms) =>
  page.evaluate(
    ([warm, ms]) =>
      new Promise((resolve) => {
        const P = window.__perf
        P.resume()
        setTimeout(() => {
          const f0 = P.frames.length, g0 = P.gpu.length, t0 = performance.now()
          setTimeout(() => {
            const t1 = performance.now()
            const frames = P.frames.slice(f0)
            const s = window.village.snapshot()
            P.pause()
            resolve({
              intervals: frames.slice(1).map((f, i) => f[0] - frames[i][0]),
              cpu: frames.map((f) => f[1]),
              gpu: P.gpu.slice(g0),
              longTasks: P.longTasks.filter(([at, d]) => at >= t0 && at <= t1).map(([, d]) => d),
              drawCalls: s.render?.drawCalls ?? null,
              triangles: s.render?.triangles ?? null,
              heapMB: performance.memory ? performance.memory.usedJSHeapSize / 2 ** 20 : null,
              quality: s.quality,
              backend: s.backend,
            })
          }, ms)
        }, warm)
      }),
    [warm, ms],
  )

const pick = (sorted, p) => (sorted.length ? sorted[Math.floor(p * (sorted.length - 1))] : null)
const median = (list) => pick([...list].sort((a, b) => a - b), 0.5)
function summarize(windows) {
  const all = (key) => windows.flatMap((w) => w[key]).sort((a, b) => a - b)
  const intervals = all('intervals'), gpu = all('gpu'), cpu = all('cpu'), longTasks = all('longTasks')
  const r = (x, d = 2) => (x == null ? null : +x.toFixed(d))
  return {
    frames: intervals.length,
    p50: r(pick(intervals, 0.5)),
    p95: r(pick(intervals, 0.95)),
    p99: r(pick(intervals, 0.99)),
    maxInterval: r(intervals.at(-1)),
    over20: intervals.filter((x) => x > 20).length,
    over33: intervals.filter((x) => x > 33.4).length,
    dropped: intervals.length ? r(intervals.filter((x) => x > 20).length / intervals.length, 4) : null,
    gpuP50: r(pick(gpu, 0.5)),
    gpuP95: r(pick(gpu, 0.95)),
    gpuSamples: gpu.length,
    cpuP50: r(pick(cpu, 0.5)),
    cpuP95: r(pick(cpu, 0.95)),
    longTasks: longTasks.length,
    longestTask: r(longTasks.at(-1) ?? 0, 0),
    drawCalls: median(windows.map((w) => w.drawCalls)),
    triangles: median(windows.map((w) => w.triangles)),
    heapMB: r(windows.at(-1).heapMB, 1),
    quality: windows.at(-1).quality,
    backend: windows.at(-1).backend,
  }
}

/**
 * Other headless Chrome instances on this machine (other agents' checks) share the GPU and
 * move GPU ms by several ms; the report names them so a failure can be rerun on a quiet machine.
 */
function otherHeadlessChromes() {
  try {
    const ps = execFileSync('ps', ['-Ao', 'pid,command'], { encoding: 'utf8' })
    return ps.split('\n').filter((l) => /Google Chrome(?! Helper).*--headless/.test(l) && !l.includes(String(process.pid))).length
  } catch {
    return 0
  }
}

// ── Run ────────────────────────────────────────────────────────────────────────
const times = {}
const lap = (name, t) => (times[name] = Date.now() - t)
let browser
const servers = []
const errors = { base: [], head: [] }
let exitCode = 1
try {
  await mkdir(CACHE, { recursive: true })
  const contendedBefore = otherHeadlessChromes()
  const tierHigh = Number(/high:\s*\{[^}]*maxGpuMs:\s*([\d.]+)/.exec(await readFile(join(HOME, 'src/plugins/renderer.ts'), 'utf8'))?.[1])
  if (!Number.isFinite(tierHigh)) throw new Error('could not read the high tier maxGpuMs from src/plugins/renderer.ts')

  // The head builds while the browser starts and the base pages load.
  const headBuild = (headRef ? buildCommit(git('rev-parse', `${headRef}^{commit}`)) : buildWorkingTree()).then((b) => (lap('headBuild', started), b))
  let t = Date.now()
  const baseBuild = await buildCommit(baseSha)
  lap('baseBuild', t)
  servers.push(await serve(baseBuild.dist, PORTS.base))

  browser = await chromium.launch({
    channel: 'chrome',
    headless: true,
    args: ['--enable-unsafe-webgpu', '--use-angle=metal', '--ignore-gpu-blocklist', '--enable-precise-memory-info'],
  })
  // One context per page, so each page has its own renderer process and a paused page's
  // timers never run on the measured page's main thread.
  const pages = { base: {}, head: {} }
  const loads = {}
  const open = async (side, scene) => {
    const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: DPR })
    await context.addInitScript(probe)
    const page = await context.newPage()
    page.on('pageerror', (e) => errors[side].push(`${scene.page}: ${e}`))
    const t = Date.now()
    await page.goto(`http://127.0.0.1:${PORTS[side]}/${scene.query}`)
    const ready = await page.evaluate(() => window.village.ready())
    if (!ready.ok) throw new Error(`${side} ${scene.query} did not become ready: ${JSON.stringify(ready.problems)}`)
    const readyMs = Date.now() - t
    const settledMs = await settle(page)
    loads[`${side}:${scene.page}`] = { readyMs, settledMs: settledMs == null ? `not settled in ${SETTLE_MAX_MS} ms` : Math.round(settledMs) }
    await page.evaluate(() => window.__perf.pause())
    const plugins = await page.evaluate(() => window.village.snapshot().plugins.registered)
    return { page, plugins }
  }
  t = Date.now()
  const pageScenes = [...new Map(scenes.map((s) => [s.page, s])).values()]
  for (const scene of pageScenes) {
    // A scene the base cannot show is checked on the head only.
    const known = Object.values(pages.base)[0]?.plugins
    if (scene.needs && known && !known.includes(scene.needs)) continue
    pages.base[scene.page] = await open('base', scene)
    if (scene.needs && !pages.base[scene.page].plugins.includes(scene.needs)) delete pages.base[scene.page]
  }
  const head = await headBuild
  servers.push(await serve(head.dist, PORTS.head))
  const skipped = []
  for (const scene of pageScenes) {
    pages.head[scene.page] = await open('head', scene)
    if (scene.needs && !pages.head[scene.page].plugins.includes(scene.needs)) delete pages.head[scene.page]
  }
  lap('pageLoads', t)

  t = Date.now()
  const results = []
  for (const scene of scenes) {
    if (!pages.head[scene.page]) {
      skipped.push(`${scene.name} (the head has no ${scene.needs} plugin)`)
      continue
    }
    const sides = ['base', 'head'].filter((side) => pages[side][scene.page])
    for (const side of sides) if (scene.setup) {
      const p = pages[side][scene.page]
      await p.page.evaluate(() => window.__perf.resume())
      await scene.setup(p.page)
      await p.page.evaluate(() => window.__perf.pause())
    }
    const windows = { base: [], head: [] }
    // Interleave base and head (B, H, B, H) so drift falls on both alike.
    const count = sides.length > 1 ? WINDOWS : 1
    for (let i = 0; i < count; i++) {
      for (const side of sides) windows[side].push(await record(pages[side][scene.page].page, WARM_MS, (SECONDS * 1000) / count))
    }
    results.push({
      scene: scene.name,
      query: scene.query,
      tier: scene.tier,
      base: windows.base.length ? summarize(windows.base) : null,
      head: summarize(windows.head),
    })
  }
  lap('measure', t)

  // ── Verdicts ─────────────────────────────────────────────────────────────────
  const rows = []
  const failures = []
  const warnings = []
  const row = (scene, metric, base, head, limit, ok, warnOnly = false) => {
    rows.push({ scene, metric, base, head, delta: base == null || head == null ? null : +(head - base).toFixed(2), limit, ok, warnOnly })
    const line = `${scene} ${metric}: ${head} (limit ${limit}${base == null ? '' : `, base ${base}`})`
    if (!ok) (warnOnly ? warnings : failures).push(line)
  }
  for (const r of results) {
    const h = r.head, b = r.base
    if (h.quality !== r.tier) row(r.scene, 'tier', b?.quality ?? null, h.quality, r.tier, false)
    // A stalled or starved measurement is a failure, never a pass on too few frames.
    const minFrames = Math.floor(SECONDS * 60 * MIN_FRAMES)
    row(r.scene, 'frames measured', b?.frames ?? null, h.frames, `>= ${minFrames}`, h.frames >= minFrames && (!b || b.frames >= minFrames))
    row(r.scene, 'dropped >20 ms', b?.dropped ?? null, h.dropped, `< ${MAX_DROPPED * 100}%`, h.frames > 0 && h.dropped < MAX_DROPPED)
    row(r.scene, 'frame p99 ms', b?.p99 ?? null, h.p99, `<= ${MAX_P99_MS}`, h.p99 != null && h.p99 <= MAX_P99_MS)
    row(r.scene, 'long tasks >50 ms', b?.longTasks ?? null, h.longTasks, '0', h.longTasks === 0)
    // Warning only until GPU ms measures GPU work: submit-to-done includes the main thread's
    // delay delivering the callback, so at the 60 Hz cap p95 settles near one frame (16-17 ms)
    // even on main. The owner's gate is consistent 60 fps plus no regression; headroom is ours.
    if (r.tier === 'high') row(r.scene, 'GPU p95 ms (headroom)', b?.gpuP95 ?? null, h.gpuP95, `< ${tierHigh}`, h.gpuP95 != null && h.gpuP95 < tierHigh, true)
    if (b) for (const [key, g] of Object.entries(RELATIVE)) {
      if (b[key] == null || h[key] == null) continue
      const allowed = Math.max(g.share * b[key], g.floor)
      row(r.scene, `${g.label} vs base`, b[key], h[key], `+${+allowed.toFixed(2)}`, h[key] - b[key] <= allowed)
    }
  }
  exitCode = failures.length ? 1 : 0
  const contended = Math.max(contendedBefore, otherHeadlessChromes() - 1)
  times.total = Date.now() - started

  // ── Report ───────────────────────────────────────────────────────────────────
  const fmt = (v) => (v == null ? 'n/a' : typeof v === 'number' ? String(+v.toFixed(2)) : String(v))
  const table = [['scene', 'metric', 'base', 'head', 'delta', 'limit', 'verdict'], ...rows.map((x) => [x.scene, x.metric, fmt(x.base), fmt(x.head), fmt(x.delta), x.limit, x.ok ? 'pass' : x.warnOnly ? 'warn' : 'FAIL'])]
  const widths = table[0].map((_, i) => Math.max(...table.map((r) => r[i].length)))
  console.log(`perf gate: base ${baseRef} ${baseSha.slice(0, 10)} against head ${headRef ?? 'working tree'} (${head.hash ?? ''})`)
  for (const r of table) console.log(r.map((c, i) => c.padEnd(widths[i])).join('  '))
  console.log('\nper scene (head): frames, frame p50/p95/p99, >33 ms, GPU p50/p95, CPU p50/p95, draws, triangles, heap')
  for (const r of results) for (const side of ['base', 'head']) {
    const s = r[side]
    if (s) console.log(`  ${r.scene.padEnd(10)} ${side}: ${s.frames} frames, ${s.p50}/${s.p95}/${s.p99} ms, ${s.over33} over 33 ms, GPU ${s.gpuP50}/${s.gpuP95} ms, CPU ${s.cpuP50}/${s.cpuP95} ms, ${s.drawCalls} draws, ${s.triangles} tris, ${s.heapMB} MB`)
  }
  const sec = (ms) => (ms / 1000).toFixed(1)
  console.log(`\ntime: total ${sec(times.total)} s; base build ${baseBuild.cached ? 'cached' : `${sec(baseBuild.ms)} s`}; head build ${head.cached ? 'cached' : `${sec(head.ms)} s`}; page loads ${sec(times.pageLoads)} s; measuring ${sec(times.measure)} s`)
  if (skipped.length) console.log(`skipped: ${skipped.join(', ')}`)
  if (contended) console.log(`warning: ${contended} other headless Chrome instance(s) ran during the gate and share the GPU; GPU ms is unreliable, rerun on a quiet machine before trusting a GPU verdict`)
  if (errors.head.length) console.log(`head page errors: ${errors.head.slice(0, 3).join(' | ')}`)
  const out = opt('json') ?? join(HOME, 'perf-gate.json')
  await writeFile(out, JSON.stringify({ base: { ref: baseRef, sha: baseSha, build: baseBuild }, head: { ref: headRef ?? 'working tree', build: head }, settings: { seconds: SECONDS, windows: WINDOWS, viewport: VIEWPORT, dpr: DPR, tierHighMaxGpuMs: tierHigh, relative: RELATIVE }, times, loads, contended, skipped, results, rows, failures, warnings, errors }, null, 2))
  if (warnings.length) console.log(`warn (${warnings.length}, not gating): ${warnings.join('; ')}`)
  console.log(`${failures.length ? `FAIL (${failures.length}): ${failures.join('; ')}` : 'PASS'}\njson: ${out}`)
} catch (e) {
  console.error(`perf gate error: ${e.stack ?? e}`)
  exitCode = 2
} finally {
  await browser?.close()
  for (const s of servers) {
    s.closeAllConnections()
    s.close()
  }
  process.exitCode = exitCode
}
