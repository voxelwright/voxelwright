// What test/launch-perf.mjs puts in the page before any of its own script runs (#83): clocks round the things a first
// visit waits on, a ledger of what the GPU is asked to hold, and the gaps between frames. It changes nothing the page
// does but for two things said where they happen (a device is asked for `timestamp-query` where its adapter has it,
// and a render pass with no clock of its own is given one on every eighth frame).
//
// Every time is ms since 1970 (`performance.timeOrigin + performance.now()`), so a worker's times (worker-probe.js,
// which has its own time origin) lie on the same line. All of it is read back from `globalThis.__launch`.
(() => {
  if (globalThis.__launch) return
  const abs = () => performance.timeOrigin + performance.now()
  /** Who called: the first frame of the stack outside this script, as `file:line`. */
  const caller = () => { const lines = String(new Error().stack).split('\n'); for (let i = 2; i < lines.length; i++) { const m = /\/([\w.-]+\.js)(?:\?[^:]*)?:(\d+):\d+/.exec(lines[i]); if (m) return `${m[1]}:${m[2]}` } return '?' }
  const L = globalThis.__launch = {
    origin: performance.timeOrigin, marks: [], wasm: [], workers: [], workerSaid: [], gpu: { calls: [], live: new Map(), bytes: 0, peak: 0, made: 0, freed: 0, collected: 0, canvases: [] },
    long: [], loaf: [], paints: [], gaps: [], json: { n: 0, ms: 0, big: [] }, messages: { n: 0, ms: 0, big: [] }, passes: new Map(), passFrames: 0, frame: 0,
  }
  const mark = (name, more) => { L.marks.push({ name, at: abs(), ...more }) }
  L.mark = mark

  // ── The loader's stages (page/loading.html), as the page passes them ──
  let loader
  Object.defineProperty(globalThis, 'villageLoading', {
    configurable: true,
    get: () => loader,
    set: (v) => { loader = v; for (const k of ['step', 'done', 'fail']) { const was = v[k].bind(v); v[k] = (a) => { mark(k === 'step' ? `step:${a}` : `loader:${k}`); return was(a) } } },
  })

  // ── The core: every way a module is fetched, compiled and made ──
  const W = WebAssembly
  for (const kind of ['instantiateStreaming', 'compileStreaming', 'instantiate', 'compile']) {
    const was = W[kind].bind(W)
    W[kind] = async (...a) => { const e = { where: 'page', kind, start: abs(), end: 0 }; L.wasm.push(e); try { return await was(...a) } finally { e.end = abs() } }
  }

  // ── Workers: when each is asked for, and when it first answers ──
  const Real = globalThis.Worker
  const timed = (fn, url) => function (e) {
    const t0 = performance.now()
    try { return typeof fn === 'function' ? fn.call(this, e) : fn.handleEvent(e) } finally { const ms = performance.now() - t0; L.messages.n++; L.messages.ms += ms; if (ms > 8) L.messages.big.push({ at: abs(), ms, url }) }
  }
  globalThis.Worker = class extends Real {
    constructor(url, options) {
      super(url, options)
      const entry = { url: String(url).replace(location.origin, ''), made: abs(), first: 0 }
      L.workers.push(entry)
      this.__url = entry.url
      Real.prototype.addEventListener.call(this, 'message', () => { if (!entry.first) entry.first = abs() })
    }
    addEventListener(type, fn, options) { return super.addEventListener(type, type === 'message' && fn ? timed(fn, this.__url) : fn, options) }
    set onmessage(fn) { super.onmessage = fn ? timed(fn, this.__url) : fn }
    get onmessage() { return super.onmessage }
  }
  try { new BroadcastChannel('__launch').onmessage = (e) => { L.workerSaid.push(e.data) } } catch { /* no channel: workers say nothing */ }

  // ── JSON read on the page's thread ──
  const parse = JSON.parse
  JSON.parse = function (text, reviver) {
    const t0 = performance.now()
    try { return parse.call(JSON, text, reviver) } finally { const ms = performance.now() - t0; L.json.n++; L.json.ms += ms; if (ms > 4) L.json.big.push({ at: abs(), ms, chars: String(text).length, by: caller() }) }
  }

  // ── The GPU: adapter, device, shaders, pipelines; what is held ──
  const call = (kind, start, more) => { const e = { kind, start, end: abs(), ...more }; L.gpu.calls.push(e); return e }
  const BPP = { r8unorm: 1, r8uint: 1, rg8unorm: 2, r16float: 2, r16uint: 2, rgba8unorm: 4, 'rgba8unorm-srgb': 4, bgra8unorm: 4, 'bgra8unorm-srgb': 4, r32float: 4, r32uint: 4, rg16float: 4, rgba16float: 8, rg32float: 8, rgba32float: 16, rgba32uint: 16, depth24plus: 4, 'depth24plus-stencil8': 8, depth32float: 4, depth16unorm: 2, rg11b10ufloat: 4, rgb10a2unorm: 4 }
  const textureBytes = (d) => {
    const s = Array.isArray(d.size) || ArrayBuffer.isView(d.size) ? [...d.size] : [d.size.width, d.size.height ?? 1, d.size.depthOrArrayLayers ?? 1]
    const w = s[0], h = s[1] ?? 1, layers = s[2] ?? 1, per = BPP[d.format] ?? 4
    let bytes = 0
    for (let m = 0; m < (d.mipLevelCount ?? 1); m++) bytes += Math.max(1, w >> m) * Math.max(1, h >> m) * layers * per
    return { bytes: bytes * (d.sampleCount ?? 1), size: [w, h, layers] }
  }
  const lost = typeof FinalizationRegistry === 'function' ? new FinalizationRegistry((id) => { const e = L.gpu.live.get(id); if (e) { L.gpu.live.delete(id); L.gpu.bytes -= e.bytes; L.gpu.collected++ } }) : null
  let ids = 0
  const hold = (thing, entry) => {
    const id = ++ids
    L.gpu.live.set(id, entry); L.gpu.bytes += entry.bytes; L.gpu.peak = Math.max(L.gpu.peak, L.gpu.bytes); L.gpu.made++
    thing.__held = id
    lost?.register(thing, id, thing)
  }
  const free = (thing) => { const e = L.gpu.live.get(thing.__held); if (e) { L.gpu.live.delete(thing.__held); L.gpu.bytes -= e.bytes; L.gpu.freed++; lost?.unregister(thing) } }
  if (globalThis.GPU) {
    const adapter = GPU.prototype.requestAdapter
    GPU.prototype.requestAdapter = async function (...a) { const t = abs(); const got = await adapter.apply(this, a); call('requestAdapter', t); return got }
    const dev = GPUAdapter.prototype.requestDevice
    GPUAdapter.prototype.requestDevice = async function (d = {}) {
      const t = abs()
      // Asked for where it may be had, so that every device's passes can be timed (the page's own asks for it too).
      const features = new Set(d.requiredFeatures ?? [])
      if (this.features.has('timestamp-query')) features.add('timestamp-query')
      const got = await dev.call(this, { ...d, requiredFeatures: [...features] })
      call('requestDevice', t, { by: caller() })
      return got
    }
    const P = GPUDevice.prototype
    const shader = P.createShaderModule
    P.createShaderModule = function (d) { const t = abs(); const m = shader.call(this, d); call('createShaderModule', t, { chars: d.code.length, by: caller() }); return m }
    const info = GPUShaderModule.prototype.getCompilationInfo
    GPUShaderModule.prototype.getCompilationInfo = async function () { const t = abs(), by = caller(); const got = await info.call(this); call('getCompilationInfo', t, { by }); return got }
    for (const kind of ['createRenderPipeline', 'createComputePipeline']) {
      const sync = P[kind], later = P[`${kind}Async`]
      P[kind] = function (d) { const t = abs(); const p = sync.call(this, d); call(kind, t, { by: caller() }); return p }
      P[`${kind}Async`] = async function (d) { const t = abs(), by = caller(); const p = await later.call(this, d); call(`${kind}Async`, t, { by }); return p }
    }
    const buffer = P.createBuffer
    P.createBuffer = function (d) { const b = buffer.call(this, d); hold(b, { what: 'buffer', bytes: d.size, label: d.label ?? '', usage: d.usage, by: caller(), at: abs() }); return b }
    const destroyBuffer = GPUBuffer.prototype.destroy
    GPUBuffer.prototype.destroy = function () { free(this); return destroyBuffer.call(this) }
    const texture = P.createTexture
    P.createTexture = function (d) { const t = texture.call(this, d); hold(t, { what: 'texture', ...textureBytes(d), format: d.format, label: d.label ?? '', by: caller(), at: abs() }); return t }
    const destroyTexture = GPUTexture.prototype.destroy
    GPUTexture.prototype.destroy = function () { free(this); return destroyTexture.call(this) }
    const configure = GPUCanvasContext.prototype.configure
    GPUCanvasContext.prototype.configure = function (d) { L.gpu.canvases.push({ at: abs(), size: [this.canvas.width, this.canvas.height], format: d.format, by: caller() }); return configure.call(this, d) }
    const current = GPUCanvasContext.prototype.getCurrentTexture
    let shown = false
    GPUCanvasContext.prototype.getCurrentTexture = function () { if (!shown) { shown = true; mark('first getCurrentTexture', { size: [this.canvas.width, this.canvas.height] }) } return current.call(this) }

    // ── What each render pass costs the GPU, on every eighth frame, by the GPU's own clock ──
    const MOST = 48, timing = new WeakMap(), of = new WeakMap(), pending = new WeakMap()
    const clockOf = (device) => {
      let c = timing.get(device)
      if (c === undefined) {
        c = device.features.has('timestamp-query') ? { set: device.createQuerySet({ type: 'timestamp', count: MOST * 2 }), resolved: buffer.call(device, { size: MOST * 16, usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC }), spare: [], next: 0, frame: -1 } : null
        timing.set(device, c)
      }
      return c
    }
    const encoder = P.createCommandEncoder
    P.createCommandEncoder = function (d) { const e = encoder.call(this, d); of.set(e, this); return e }
    const begin = GPUCommandEncoder.prototype.beginRenderPass
    GPUCommandEncoder.prototype.beginRenderPass = function (d) {
      const device = of.get(this), c = L.passesOn && device && L.frame % 8 === 0 ? clockOf(device) : null
      if (!c || d.timestampWrites) return begin.call(this, d)
      if (c.frame !== L.frame) { c.frame = L.frame; c.next = 0; L.passFrames++ }
      if (c.next >= MOST) return begin.call(this, d)
      const i = c.next++, list = pending.get(this) ?? []
      list.push({ i, name: d.label || caller(), c })
      pending.set(this, list)
      return begin.call(this, { ...d, timestampWrites: { querySet: c.set, beginningOfPassWriteIndex: i * 2, endOfPassWriteIndex: i * 2 + 1 } })
    }
    const finish = GPUCommandEncoder.prototype.finish
    GPUCommandEncoder.prototype.finish = function (d) {
      const list = pending.get(this)
      if (list?.length) {
        const c = list[0].c, lo = Math.min(...list.map((p) => p.i)), hi = Math.max(...list.map((p) => p.i))
        const read = c.spare.pop() ?? buffer.call(of.get(this), { size: MOST * 16, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ })
        // (Resolved from the first query: where a resolve is written must be a multiple of 256 bytes, so one that began
        // at this encoder's own first pass made the whole encoder invalid, and the frame with it.)
        this.resolveQuerySet(c.set, 0, (hi + 1) * 2, c.resolved, 0)
        this.copyBufferToBuffer(c.resolved, lo * 16, read, lo * 16, (hi - lo + 1) * 16)
        const done = finish.call(this, d)
        reads.set(done, { read, list, c })
        return done
      }
      return finish.call(this, d)
    }
    const reads = new WeakMap()
    const submit = GPUQueue.prototype.submit
    GPUQueue.prototype.submit = function (buffers) {
      const got = submit.call(this, buffers)
      for (const b of buffers) {
        const r = reads.get(b)
        if (!r) continue
        r.read.mapAsync(GPUMapMode.READ).then(() => {
          const t = new BigUint64Array(r.read.getMappedRange().slice(0))
          r.read.unmap(); r.c.spare.push(r.read)
          for (const p of r.list) {
            const ms = Number(t[p.i * 2 + 1] - t[p.i * 2]) / 1e6
            if (!(ms >= 0 && ms < 1000)) continue
            let e = L.passes.get(p.name)
            if (!e) L.passes.set(p.name, e = { n: 0, ms: 0, worst: 0, all: [] })
            e.n++; e.ms += ms; e.worst = Math.max(e.worst, ms); if (e.all.length < 4000) e.all.push(ms)
          }
        }, () => {})
      }
      return got
    }
  }

  // ── Frames, long tasks, paints ──
  let last = 0
  const tick = (now) => { if (last) L.gaps.push(now - last, performance.timeOrigin + now); last = now; L.frame++; requestAnimationFrame(tick) }
  requestAnimationFrame(tick)
  const watch = (type, take) => { try { new PerformanceObserver((list) => { for (const e of list.getEntries()) take(e) }).observe({ type, buffered: true }) } catch { /* not in this browser */ } }
  watch('longtask', (e) => L.long.push({ at: performance.timeOrigin + e.startTime, ms: e.duration }))
  watch('long-animation-frame', (e) => L.loaf.push({ at: performance.timeOrigin + e.startTime, ms: e.duration, blocking: e.blockingDuration, scripts: e.scripts.map((s) => ({ ms: s.duration, invoker: s.invoker, type: s.invokerType, fn: s.sourceFunctionName, url: s.sourceURL.replace(location.origin, ''), forced: s.forcedStyleAndLayoutDuration })) }))
  watch('paint', (e) => L.paints.push({ name: e.name, at: performance.timeOrigin + e.startTime }))
  watch('largest-contentful-paint', (e) => L.paints.push({ name: 'largest-contentful-paint', at: performance.timeOrigin + e.startTime, size: e.size, url: (e.url ?? '').replace(location.origin, '') }))
  try { performance.setResourceTimingBufferSize(20000) } catch { /* fixed */ }

  /** What the GPU holds now, by who asked for it. */
  L.held = () => {
    const by = new Map()
    for (const e of L.gpu.live.values()) { const k = `${e.what} ${e.label ? e.label.replace(/ [\d/_.-]+$/, ' *') : e.by}`; const g = by.get(k) ?? { n: 0, bytes: 0 }; g.n++; g.bytes += e.bytes; by.set(k, g) }
    return { bytes: L.gpu.bytes, peak: L.gpu.peak, made: L.gpu.made, freed: L.gpu.freed, collected: L.gpu.collected, live: L.gpu.live.size, by: [...by].map(([k, g]) => ({ k, ...g })).sort((a, b) => b.bytes - a.bytes) }
  }
})()
