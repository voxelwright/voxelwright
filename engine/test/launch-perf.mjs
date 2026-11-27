// What a first visit to the San Francisco realm costs, measured (#83): the built folder (dist-sf) served as a host of
// plain files serves it, with this checkout's code laid over it (launch-perf/host.mjs), opened cold in the installed
// Chrome with WebGPU. Nothing here is a bound: it prints what it measured and writes it as JSON.
//
//   node test/launch-perf.mjs [--dist dist-sf] [--device desktop|tablet|phone] [--samples 3] [--query 'a=1&b=2']
//        [--variants 'a=1;b=2' --samples 5]   the same visit as it is and with each query, in turn, and the medians of each
//        [--mbit 25]                    a link of that speed with 40 ms each way (the page's own requests only)
//        [--split]                      each worker's core in three parts: the bytes, the compile, the instance
//        [--explore]                    then into the city by the EXPLORE board, timed
//        [--walk 40]                    then walk that many seconds (after --explore), frame gaps and what stalls
//        [--glide 4000]                 or carry the eye that many metres through the city at 15 m/s, memory as it goes
//        [--passes]                     each render pass's GPU time, every eighth frame, with every turn on the GPU held
//        [--alone]                      with every turn on the GPU held (kit.mjs `quiet`): no other lane's check draws beside it
//        [--out file.json] [--headed] [--bare]   (`--bare`: no probe in the workers)
//
// A cold visit is a browser started for it, with an empty profile. The driver's own cache of compiled shaders is the
// machine's and is not emptied: a first run after a shader changes is slower than these.
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { chromium } from 'playwright'
import { arg, CHROME, has, here, quiet, turn } from './kit.mjs'
import { fingerprint, host } from './launch-perf/host.mjs'

const dist = join(here, arg('dist', 'dist-sf')), samples = Number(arg('samples', '1')), mbit = Number(arg('mbit', '0'))
const DEVICES = {
  desktop: { viewport: { width: 1280, height: 720 }, deviceScaleFactor: 2 },
  laptop: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 },
  hd: { viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 },
  // An iPad Pro 11 held upright and an iPhone 15: the sizes and touch only. The GPU, the memory and the browser are this Mac's.
  tablet: { viewport: { width: 834, height: 1194 }, screen: { width: 834, height: 1194 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true },
  phone: { viewport: { width: 393, height: 852 }, screen: { width: 393, height: 852 }, deviceScaleFactor: 3, hasTouch: true, isMobile: true },
}
const device = arg('device', 'desktop')
const round = (n, to = 0) => Math.round(n * 10 ** to) / 10 ** to
const median = (list) => { const s = list.filter((v) => Number.isFinite(v)).sort((a, b) => a - b); return s.length ? s[s.length >> 1] : NaN }
const quantile = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))]
const mb = (bytes) => round(bytes / 2 ** 20, 1)
const freeGb = () => Number(execFileSync('df', ['-k', here], { encoding: 'utf8' }).trim().split('\n').pop().split(/\s+/)[3]) / 2 ** 20
const probe = has('bare') ? null : readFileSync(join(here, 'test/launch-perf/worker-probe.js'), 'utf8').replace('/*SPLIT*/false', String(has('split')))
const pageProbe = readFileSync(join(here, 'test/launch-perf/page-probe.js'), 'utf8')
const began = fingerprint(dist)
const site = await host({ base: dist, root: here, probe })

/** What the browser's processes hold: resident memory by kind of process, and the GPU process's footprint as macOS counts it. */
async function processes(browser) {
  const link = await browser.newBrowserCDPSession()
  const { processInfo } = await link.send('SystemInfo.getProcessInfo')
  await link.detach()
  const held = {}
  for (const p of processInfo) {
    const rss = Number(execFileSync('ps', ['-o', 'rss=', '-p', String(p.id)], { encoding: 'utf8' }).trim() || 0) / 1024
    held[p.type] = round((held[p.type] ?? 0) + rss)
    if (p.type === 'GPU' || p.type === 'renderer') {
      try { const said = execFileSync('footprint', ['-p', String(p.id)], { encoding: 'utf8', timeout: 20_000 }); const m = /phys_footprint:\s*([\d.]+)\s*(KB|MB|GB)/.exec(said); if (m) held[`${p.type} footprint`] = round((held[`${p.type} footprint`] ?? 0) + Number(m[1]) * { KB: 1 / 1024, MB: 1, GB: 1024 }[m[2]]) } catch { /* not allowed, or gone */ }
    }
  }
  return held
}

/** What the page and its workers hold now. */
async function holding(page, browser) {
  const inPage = await page.evaluate(async () => {
    const e = globalThis.engine, L = globalThis.__launch, m = await e.tiles.memory()
    const last = new Map()
    for (const s of L.workerSaid) if (s.what === 'memory') last.set(s.who, s)
    return {
      heap: performance.memory.usedJSHeapSize, heapTotal: performance.memory.totalJSHeapSize, cores: { page: m.page, workers: m.workers }, tilesHeld: m.tiles,
      workers: [...last].map(([who, s]) => ({ who, wasm: s.wasm, heap: s.heap })),
      pool: { usedMb: (e.world.stats.poolUsed * 4) / 2 ** 20, mb: (e.world.stats.poolWords * 4) / 2 ** 20, sectors: e.world.stats.ready, made: e.world.stats.made, makeMs: Math.round(e.world.stats.makeMs), tally: { ...e.tiles.tally } }, farStats: e.far?.stats ? { faces: e.far.stats.faces, fetched: e.far.stats.fetched, held: e.far.held?.().length } : null,
      gpu: L.held(), canvas: [document.querySelector('canvas').width, document.querySelector('canvas').height], scale: e.scale, pose: [Math.round(e.pose.x), Math.round(e.pose.y), Math.round(e.pose.z)],
      far: e.far ? { tiles: e.far.tiles?.size ?? e.far.held ?? null } : null,
    }
  })
  return { ...inPage, processes: await processes(browser) }
}
const heldLine = (h) => `JS heap ${mb(h.heap)} MB, cores ${mb(h.cores.page + h.cores.workers.reduce((a, b) => a + b, 0))} MB (page ${mb(h.cores.page)}, workers ${h.cores.workers.map(mb).join(' ')}), tiles held ${mb(h.tilesHeld)} MB, tree pool ${round(h.pool.usedMb)} of ${round(h.pool.mb)} MB used, GPU asked ${mb(h.gpu.bytes)} MB in ${h.gpu.live} (peak ${mb(h.gpu.peak)}), processes ${JSON.stringify(h.processes)}`

/** Frame gaps and what stalled between two times, from what the probe kept. */
const paced = (page, from, to) => page.evaluate(({ from, to }) => {
  const L = globalThis.__launch, gaps = []
  for (let i = 0; i < L.gaps.length; i += 2) if (L.gaps[i + 1] >= from && L.gaps[i + 1] <= to) gaps.push(L.gaps[i])
  const within = (list) => list.filter((e) => e.at >= from && e.at <= to)
  const scripts = new Map()
  for (const f of within(L.loaf)) for (const s of f.scripts) { const k = `${s.url.split('?')[0]} ${s.fn || s.invoker}`.trim(); const g = scripts.get(k) ?? { n: 0, ms: 0, worst: 0 }; g.n++; g.ms += s.ms; g.worst = Math.max(g.worst, s.ms); scripts.set(k, g) }
  return {
    gaps, long: within(L.long).map((l) => Math.round(l.ms)), loaf: within(L.loaf).length, loafWorst: Math.max(0, ...within(L.loaf).map((f) => f.ms)),
    scripts: [...scripts].map(([k, g]) => ({ k, ...g })).sort((a, b) => b.ms - a.ms).slice(0, 12),
    json: within(L.json.big), messages: within(L.messages.big), jsonAll: { n: L.json.n, ms: L.json.ms }, messagesAll: { n: L.messages.n, ms: L.messages.ms },
  }
}, { from, to })
const pacedLine = (p) => {
  const g = p.gaps.filter((x) => x >= 2).sort((a, b) => a - b)
  return { frames: g.length, p50: round(quantile(g, 0.5), 1), p95: round(quantile(g, 0.95), 1), p99: round(quantile(g, 0.99), 1), worst: round(g.at(-1), 1), over25: g.filter((x) => x > 25).length, over50: g.filter((x) => x > 50).length, longTasks: p.long.length, longTaskMs: p.long.reduce((a, b) => a + b, 0), longest: Math.max(0, ...p.long) }
}

/**
 * A sampled profile of the page's thread, summed: the functions with the most time of their own, the page's functions
 * with the most time under them, and the same for each window (`windows`, ms since 1970). The profile's clock is not
 * the page's: its start is taken as when it was asked for, which is right to a few ms.
 */
function profiled(profile, startedAt, windows) {
  const nodes = new Map(profile.nodes.map((n) => [n.id, n])), parent = new Map()
  for (const n of profile.nodes) for (const c of n.children ?? []) parent.set(c, n.id)
  const name = (n) => `${n.callFrame.functionName || '(anonymous)'} ${n.callFrame.url.replace(/^https?:\/\/[^/]+/, '').split('?')[0]}${n.callFrame.url ? `:${n.callFrame.lineNumber + 1}` : ''}`.trim()
  const own = new Map(), under = new Map(), inWindow = windows.map(() => new Map())
  let t = profile.startTime
  for (let i = 0; i < profile.samples.length; i++) {
    const dt = (profile.timeDeltas[i] ?? 0) / 1000
    t += profile.timeDeltas[i] ?? 0
    const when = startedAt + (t - profile.startTime) / 1000, node = nodes.get(profile.samples[i])
    if (!node || /^\((idle|program|garbage collector)\)$/.test(node.callFrame.functionName) && node.callFrame.functionName !== '(garbage collector)') continue
    own.set(name(node), (own.get(name(node)) ?? 0) + dt)
    const seen = new Set()
    for (let id = node.id; id !== undefined; id = parent.get(id)) { const n = nodes.get(id), k = name(n); if (!n.callFrame.url || seen.has(k)) continue; seen.add(k); under.set(k, (under.get(k) ?? 0) + dt) }
    for (const [w, win] of windows.entries()) if (when >= win.from && when <= win.to) for (const k of seen) inWindow[w].set(k, (inWindow[w].get(k) ?? 0) + dt)
    for (const [w, win] of windows.entries()) if (when >= win.from && when <= win.to) inWindow[w].set(`self: ${name(node)}`, (inWindow[w].get(`self: ${name(node)}`) ?? 0) + dt)
  }
  const top = (map, n) => [...map].sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, ms]) => `${Math.round(ms)} ms ${k}`)
  return { self: top(own, 30), inclusive: top(under, 40), windows: inWindow.map((m) => top(m, 14)) }
}

/** One cold visit: what it took, by stage, ms from the navigation's start. */
async function visit(query) {
  if (freeGb() < 1) throw new Error(`under 1 GB of disk is free (${round(freeGb(), 2)} GB): not starting a browser`)
  if (fingerprint(dist) !== began) throw new Error(`${dist} changed under the run (built again?)`)
  const browser = await chromium.launch({ ...CHROME, headless: !has('headed'), args: [...CHROME.args, '--disk-cache-size=268435456', '--enable-precise-memory-info', '--enable-webgpu-developer-features'] })
  try {
    const context = await browser.newContext(DEVICES[device])
    const page = await context.newPage()
    const errors = []
    page.on('pageerror', (e) => errors.push(e.message))
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 300)) })
    await page.addInitScript(pageProbe)
    if (mbit) {
      const cdp = await context.newCDPSession(page)
      await cdp.send('Network.enable')
      await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 40, downloadThroughput: (mbit * 1e6) / 8, uploadThroughput: (5 * 1e6) / 8 })
    }
    // The page's own thread, sampled (`--profile`): which functions the time went to, and in each long task.
    let profiler = null, profiledFrom = 0
    if (has('profile')) {
      profiler = await context.newCDPSession(page)
      await profiler.send('Profiler.enable')
      await profiler.send('Profiler.setSamplingInterval', { interval: 250 })
      await profiler.send('Profiler.start')
      profiledFrom = Date.now()
    }
    const askedFrom = site.asked.length, t0 = Date.now()
    await page.goto(`${site.url}/sf/index.html${query ? `?${query}` : ''}`, { waitUntil: 'commit' })
    await page.waitForFunction(() => globalThis.engine?.seen?.whole > 0, null, { timeout: 300_000 })
    await page.waitForFunction(() => globalThis.__launch.marks.some((m) => m.name === 'loader:done'), null, { timeout: 60_000 }).catch(() => {})
    await page.waitForTimeout(2500)   // each worker says what it holds every two seconds
    const raw = await page.evaluate(() => {
      const L = globalThis.__launch, e = globalThis.engine, nav = performance.getEntriesByType('navigation')[0]
      return {
        origin: L.origin, seen: e.seen, nav: { response: nav.responseStart, html: nav.responseEnd, dom: nav.domContentLoadedEventEnd },
        resources: performance.getEntriesByType('resource').map((r) => ({ url: r.name.replace(location.origin, ''), start: r.startTime, end: r.responseEnd, wire: r.transferSize, bytes: r.decodedBodySize, kind: r.initiatorType })),
        marks: L.marks, wasm: L.wasm, workers: L.workers, said: L.workerSaid.filter((s) => s.what !== 'memory'), calls: L.gpu.calls, canvases: L.gpu.canvases, paints: L.paints, long: L.long,
        loaf: L.loaf.map((f) => ({ at: f.at, ms: f.ms, scripts: f.scripts.filter((s) => s.ms > 20).map((s) => ({ ms: Math.round(s.ms), what: `${s.url.split('?')[0]} ${s.fn || s.invoker}`.trim() })) })),
        device: e.tiles.device, cores: navigator.hardwareConcurrency, json: { n: L.json.n, ms: L.json.ms, big: L.json.big }, messages: { n: L.messages.n, ms: L.messages.ms, big: L.messages.big },
      }
    })
    const profile = profiler ? profiled((await profiler.send('Profiler.stop')).profile, profiledFrom, raw.loaf.filter((f) => f.ms > 80).map((f) => ({ from: f.at, to: f.at + f.ms }))) : null
    const at = (abs) => abs - raw.origin, mark = (name) => { const m = raw.marks.find((m) => m.name === name); return m ? at(m.at) : NaN }
    const call = (kind) => raw.calls.filter((c) => c.kind === kind)
    const span = (list) => list.reduce((n, c) => n + (c.end - c.start), 0)
    const code = raw.resources.filter((r) => /\.js(\?|$)/.test(r.url)), core = raw.wasm.find((w) => w.where === 'page')
    const whole = raw.seen.whole
    const wire = site.asked.slice(askedFrom).filter((a) => a.status === 200)
    const sentBy = (ms) => { const upTo = wire.filter((a) => a.at <= raw.origin + ms); return { requests: upTo.length, mb: mb(upTo.reduce((n, a) => n + a.wire, 0)), decodedMb: mb(upTo.reduce((n, a) => n + a.bytes, 0)) } }
    const workers = raw.workers.map((w) => {
      const said = raw.said.filter((s) => s.who.startsWith(w.url.split('/').pop().split('?')[0]))
      return { url: w.url.split('?')[0], made: at(w.made), first: w.first ? at(w.first) : NaN, said }
    })
    // A worker's own words are matched to it in the order the page made them (workers of one script begin in that order).
    const byScript = new Map()
    for (const s of raw.said) { const k = s.who; if (!byScript.has(k)) byScript.set(k, []); byScript.get(k).push(s) }
    const tellers = [...byScript].map(([who, list]) => ({ who, script: who.split('#')[0], began: at(list.find((s) => s.what === 'began')?.at ?? NaN), core: list.find((s) => s.what === 'core'), firstAnswer: at(list.find((s) => s.what === 'first answer')?.at ?? NaN), fetches: list.filter((s) => s.what === 'fetch') })).sort((a, b) => a.began - b.began)
    const cores = tellers.filter((t) => t.core).map((t) => ({ script: t.script, began: round(t.began), start: round(at(t.core.start)), ...(t.core.kind === 'split' ? { fetch: round(t.core.fetched - t.core.start), compile: round(t.core.compiled - t.core.fetched), instance: round(t.core.end - t.core.compiled, 1) } : {}), kind: t.core.kind, took: round(t.core.end - t.core.start), ready: round(at(t.core.end)), firstAnswer: round(t.firstAnswer) }))
    const makers = cores.filter((c) => c.script === 'worker.js')
    const stages = {
      html: round(raw.nav.html), firstPaint: round(at(raw.paints.find((p) => p.name === 'first-contentful-paint')?.at ?? NaN)), lcp: round(at(raw.paints.filter((p) => p.name === 'largest-contentful-paint').at(-1)?.at ?? NaN)),
      codeFiles: code.length, codeWireKb: round(code.reduce((n, r) => n + r.wire, 0) / 1024), codeLoaded: round(Math.max(...code.filter((r) => r.end < at(call('requestAdapter')[0]?.start ?? Infinity)).map((r) => r.end))),
      adapterAsked: round(at(call('requestAdapter')[0]?.start ?? NaN)), adapter: round(span(call('requestAdapter').slice(0, 1))), device: round(span(call('requestDevice').slice(0, 1))), stepGpu: round(mark('step:gpu')),
      pageCoreAsked: core ? round(at(core.start)) : NaN, pageCore: core ? round(core.end - core.start) : NaN, firstWorkerMade: round(Math.min(...workers.map((w) => w.made))),
      shaderModules: call('createShaderModule').length, shaderChars: call('createShaderModule').reduce((n, c) => n + c.chars, 0), shaderSyncMs: round(span(call('createShaderModule'))), compilationInfoMs: round(span(call('getCompilationInfo'))),
      pipelinesSync: call('createRenderPipeline').length, pipelinesSyncMs: round(span(call('createRenderPipeline'))), pipelinesAsync: call('createRenderPipelineAsync').length, pipelinesAsyncMs: round(span(call('createRenderPipelineAsync'))),
      stepEngine: round(mark('step:engine')), stepSkyline: round(mark('step:skyline')), stepStreets: round(mark('step:streets')), firstCanvasFrame: round(mark('first getCurrentTexture')),
      seenFirst: round(raw.seen.first), seenNear: round(raw.seen.near), seenWhole: round(whole), loaderDone: round(mark('loader:done')),
      makers: makers.length, makerCoreMedian: round(median(makers.map((c) => c.took))), makerCoreWorst: round(Math.max(...makers.map((c) => c.took))), makerReadyLast: round(Math.max(...makers.map((c) => c.ready))), makerFirstAnswer: round(Math.min(...makers.map((c) => c.firstAnswer))),
      longTasksToWhole: raw.long.filter((l) => at(l.at) < whole).length, longTaskMsToWhole: round(raw.long.filter((l) => at(l.at) < whole).reduce((n, l) => n + l.ms, 0)), longestTask: round(Math.max(0, ...raw.long.filter((l) => at(l.at) < whole).map((l) => l.ms))),
      jsonParses: raw.json.n, jsonMs: round(raw.json.ms), messageMs: round(raw.messages.ms),
      wireToFirst: sentBy(raw.seen.first), wireToNear: sentBy(raw.seen.near), wireToWhole: sentBy(whole),
    }
    const result = { query, device, tier: raw.device, hardwareConcurrency: raw.cores, canvas: raw.canvases.map((c) => c.size).sort((a, b) => b[0] * b[1] - a[0] * a[1])[0], stages, cores, workers: workers.map((w) => ({ url: w.url, made: round(w.made), first: round(w.first) })), errors,
      bigTasks: raw.loaf.filter((f) => f.ms > 80).map((f, i) => ({ at: round(at(f.at)), ms: round(f.ms), scripts: f.scripts, top: profile?.windows[i] })).filter((f) => f.at < whole).slice(0, 30),
      profile: profile ? { self: profile.self, inclusive: profile.inclusive } : undefined,
      bigJson: raw.json.big.map((j) => ({ at: round(at(j.at)), ms: round(j.ms, 1), kb: round(j.chars / 1024), by: j.by })).slice(0, 30),
      calls: has('calls') ? raw.calls.map((c) => ({ kind: c.kind, at: round(at(c.start)), ms: round(c.end - c.start, 1), by: c.by, chars: c.chars })) : undefined,
      fetchedByWorkers: tellers.map((t) => ({ who: t.who, fetches: t.fetches.length, urls: [...new Set(t.fetches.map((f) => f.url.split('?')[0].replace(/[0-9a-f]{64}/, '<release>')))].slice(0, 6) })),
      heldWhole: await holding(page, browser), wallMs: Date.now() - t0 }
    console.log(`  visit${query ? ` ?${query}` : ''}: first picture ${stages.seenFirst} ms, near ${stages.seenNear}, whole ${stages.seenWhole}; loader done ${stages.loaderDone}`)

    if (has('explore')) {
      const asked = await page.evaluate(() => { const at = performance.now(); globalThis.engine.explore.go(); return at })
      const arrived = await page.waitForFunction(() => globalThis.engine.explore.state === 'in' && globalThis.engine.me.feet ? performance.now() : 0, null, { timeout: 120_000, polling: 'raf' }).then((h) => h.jsonValue())
      const settled = await page.waitForFunction(() => { const s = globalThis.engine.world.stats; return s.wanted === 0 && s.stale === 0 ? performance.now() : 0 }, null, { timeout: 120_000, polling: 100 }).then((h) => h.jsonValue(), () => NaN)
      const flight = pacedLine(await paced(page, raw.origin + asked, raw.origin + arrived))
      result.explore = { askedAt: round(asked), toFeet: round(arrived - asked), toSettled: round(settled - asked), flight, times: await page.evaluate(() => globalThis.engine.explore.times ?? null) }
      console.log(`  explore: on its feet in the city ${result.explore.toFeet} ms after the ask, the world whole there at ${result.explore.toSettled} ms; flight frames ${JSON.stringify(flight)}`)
      await page.waitForTimeout(2500)
      result.heldIn = await holding(page, browser)
    }
    if (arg('walk', null)) {
      const seconds = Number(arg('walk'))
      let give = null
      if (has('passes')) { give = await quiet(); await page.evaluate(() => { globalThis.__launch.passesOn = true }) }
      const from = await page.evaluate(() => performance.timeOrigin + performance.now())
      const start = await page.evaluate(() => { const e = globalThis.engine; return { feet: e.me.feet?.at ? [...e.me.feet.at] : null, pose: { ...e.pose } } })
      const scales = [], clocks = []
      await page.keyboard.down('KeyW')
      for (let s = 0; s < seconds; s++) {
        await page.waitForTimeout(1000)
        if (s % 6 === 5) { await page.keyboard.down(s % 12 === 5 ? 'KeyA' : 'KeyD'); await page.waitForTimeout(350); await page.keyboard.up(s % 12 === 5 ? 'KeyA' : 'KeyD') }
        const now = await page.evaluate(() => { const e = globalThis.engine; return { scale: e.scale, gpuMs: e.gpuMs, cpuMs: e.cpuMs, frameMs: e.frameMs, laps: { ...e.laps } } })
        scales.push(now.scale); clocks.push(now)
      }
      await page.keyboard.up('KeyW')
      const to = await page.evaluate(() => performance.timeOrigin + performance.now())
      const end = await page.evaluate(() => { const e = globalThis.engine; return { feet: e.me.feet?.at ? [...e.me.feet.at] : null, pose: { ...e.pose } } })
      const p = await paced(page, from, to)
      const passes = await page.evaluate(() => { const L = globalThis.__launch; L.passesOn = false; return { frames: L.passFrames, passes: [...L.passes].map(([name, e]) => { const s = e.all.slice().sort((a, b) => a - b); return { name, n: e.n, perFrame: e.n / Math.max(1, L.passFrames), mean: e.ms / e.n, p50: s[s.length >> 1], p95: s[Math.floor(s.length * 0.95)], worst: e.worst, msPerFrame: e.ms / Math.max(1, L.passFrames) } }).sort((a, b) => b.msPerFrame - a.msPerFrame) } })
      give?.()
      const metres = start.feet && end.feet ? Math.hypot(end.feet[0] - start.feet[0], end.feet[2] - start.feet[2]) / 10 : Math.hypot(end.pose.x - start.pose.x, end.pose.z - start.pose.z)
      result.walk = { seconds, metres: round(metres, 1), frames: pacedLine(p), scale: { low: Math.min(...scales), high: Math.max(...scales), changes: scales.filter((s, i) => i && s !== scales[i - 1]).length }, marchMs: round(median(clocks.map((c) => c.gpuMs)), 2), cpuMs: round(median(clocks.map((c) => c.cpuMs)), 2), laps: Object.fromEntries(Object.keys(clocks[0].laps).map((k) => [k, round(median(clocks.map((c) => c.laps[k])), 2)])), scripts: p.scripts.map((s) => ({ ...s, ms: round(s.ms), worst: round(s.worst) })), bigJson: p.json.map((j) => ({ ms: round(j.ms, 1), kb: round(j.chars / 1024), by: j.by })), bigMessages: p.messages.map((m) => ({ ms: round(m.ms, 1), url: m.url.split('?')[0] })).sort((a, b) => b.ms - a.ms).slice(0, 12), passes: has('passes') ? passes : undefined }
      console.log(`  walk ${seconds} s, ${result.walk.metres} m: ${JSON.stringify(result.walk.frames)}; scale ${result.walk.scale.low} to ${result.walk.scale.high} (${result.walk.scale.changes} changes), march ${result.walk.marchMs} ms, page ${result.walk.cpuMs} ms`)
      result.heldWalked = await holding(page, browser)
    }
    if (arg('glide', null)) {
      const metres = Number(arg('glide')), speed = Number(arg('speed', '15')), up = Number(arg('up', '1.7'))
      const from = await page.evaluate(() => performance.timeOrigin + performance.now())
      const startPose = await page.evaluate(() => ({ ...globalThis.engine.pose }))
      const trail = [{ m: 0, ...(await holding(page, browser)) }]
      // West along the hill, then south: a line through the city's blocks, the eye a person's height over the ground under it.
      await page.evaluate(({ metres, speed, up }) => {
        const e = globalThis.engine, x0 = e.pose.x, z0 = e.pose.z, half = metres / 2, t0 = performance.now()
        globalThis.__glide = { m: 0, done: false }
        const step = () => {
          const d = Math.min(metres, ((performance.now() - t0) / 1000) * speed)
          const x = x0 - Math.min(d, half), z = z0 + Math.max(0, d - half)
          Object.assign(e.pose, { x, z, y: e.ground(x, z) + up, yaw: d < half ? -Math.PI / 2 : Math.PI, pitch: 0 })
          globalThis.__glide.m = d
          if (d >= metres) { globalThis.__glide.done = true; return }
          requestAnimationFrame(step)
        }
        step()
      }, { metres, speed, up })
      for (;;) {
        await page.waitForTimeout(15_000)
        const g = await page.evaluate(() => globalThis.__glide)
        const h = await holding(page, browser)
        trail.push({ m: round(g.m), ...h })
        console.log(`  glide ${round(g.m)} m: ${heldLine(h)}`)
        if (g.done) break
      }
      const to = await page.evaluate(() => performance.timeOrigin + performance.now())
      result.glide = { metres, speed, frames: pacedLine(await paced(page, from, to)) }
      await page.waitForTimeout(20_000)
      trail.push({ m: metres, rested: true, ...(await holding(page, browser)) })
      // Back where it began: what was taken on the way should be let go.
      await page.evaluate((pose) => Object.assign(globalThis.engine.pose, pose), startPose)
      await page.waitForFunction(() => { const s = globalThis.engine.world.stats; return s.wanted === 0 && s.stale === 0 }, null, { timeout: 120_000, polling: 250 }).catch(() => {})
      await page.waitForTimeout(20_000)
      trail.push({ m: 0, back: true, ...(await holding(page, browser)) })
      console.log(`  back at the start: ${heldLine(trail.at(-1))}`)
      result.glide.trail = trail.map((t) => ({ m: t.m, rested: t.rested, back: t.back, heapMb: mb(t.heap), coresMb: mb(t.cores.page + t.cores.workers.reduce((a, b) => a + b, 0)), workerHeapsMb: t.workers.map((w) => mb(w.heap ?? 0)), tilesHeldMb: mb(t.tilesHeld), gpuMb: mb(t.gpu.bytes), gpuLive: t.gpu.live, gpuMade: t.gpu.made, gpuFreed: t.gpu.freed, gpuCollected: t.gpu.collected, processes: t.processes, top: t.gpu.by.slice(0, 6).map((b) => `${b.k} ${b.n}x ${mb(b.bytes)}`) }))
    }
    return result
  } finally { await browser.close().catch(() => {}) }
}

// `--variants 'a=1;b=2'`: the visit as it is, then with each of those queries, in turn. `--ab 'a=1'` is one of them.
const more = (arg('variants', arg('ab', '')) || '').split(';').filter(Boolean)
const queries = [arg('query', ''), ...more.map((v) => [arg('query', ''), v].filter(Boolean).join('&'))]
// One turn on the GPU for the whole run (kit.mjs): the visits come one after another.
const back = has('alone') ? await quiet() : await turn()
const results = queries.map(() => [])
console.log(`launch-perf: ${device}, ${samples} cold visit${samples > 1 ? 's' : ''}${queries.length > 1 ? ` each of ${queries.map((q) => q || 'as it is').join(' | ')}, in turn` : ''}${mbit ? `, ${mbit} Mbit/s` : ''}; ${round(freeGb(), 1)} GB of disk free`)
for (let i = 0; i < samples; i++) for (const q of queries.keys()) {
  // In turn, and the other way round on odd rounds: whatever drifts on this machine falls on all of them.
  const which = i % 2 ? queries.length - 1 - q : q
  results[which].push(await visit(queries[which]))
}
const KEYS = ['html', 'firstPaint', 'codeLoaded', 'adapterAsked', 'adapter', 'device', 'stepGpu', 'pageCore', 'firstWorkerMade', 'shaderSyncMs', 'compilationInfoMs', 'pipelinesSyncMs', 'pipelinesAsyncMs', 'stepEngine', 'stepSkyline', 'stepStreets', 'firstCanvasFrame', 'seenFirst', 'seenNear', 'seenWhole', 'loaderDone', 'makerCoreMedian', 'makerCoreWorst', 'makerReadyLast', 'makerFirstAnswer', 'longTasksToWhole', 'longTaskMsToWhole', 'longestTask', 'jsonMs', 'messageMs']
const summary = results.map((list, q) => ({ query: queries[q], n: list.length, median: Object.fromEntries(KEYS.map((k) => [k, median(list.map((r) => r.stages[k]))])), all: Object.fromEntries(['seenFirst', 'seenNear', 'seenWhole', 'makerReadyLast', 'makerFirstAnswer'].map((k) => [k, list.map((r) => r.stages[k])])), explore: list[0]?.explore ? { toFeet: median(list.map((r) => r.explore.toFeet)), toSettled: median(list.map((r) => r.explore.toSettled)), all: list.map((r) => r.explore.toFeet) } : undefined }))
for (const s of summary) console.log(`\n${s.query || 'as it is'} (median of ${s.n}):\n${JSON.stringify(s.median)}\n${JSON.stringify(s.all)}${s.explore ? `\nexplore ${JSON.stringify(s.explore)}` : ''}`)
const first = results[0][0]
console.log(`\nfirst visit, in full:\n  tier ${first.tier}, canvas ${first.canvas}, ${first.hardwareConcurrency} threads; wire ${JSON.stringify({ first: first.stages.wireToFirst, near: first.stages.wireToNear, whole: first.stages.wireToWhole })}`)
console.log(`  cores: ${JSON.stringify(first.cores)}`)
console.log(`  held when whole: ${heldLine(first.heldWhole)}`)
for (const b of first.heldWhole.gpu.by.slice(0, 14)) console.log(`    ${b.k}: ${b.n} x, ${mb(b.bytes)} MB`)
if (first.errors.length) console.log(`  page errors: ${JSON.stringify(first.errors.slice(0, 5))}`)
if (arg('out', null)) writeFileSync(arg('out'), JSON.stringify({ at: new Date().toISOString(), device, mbit, samples, queries, summary, results }, null, 1))
site.stop()
back()
process.exit(0)
