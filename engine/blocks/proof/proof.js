// The proof for #430: sixty of the kit's parts on one page, each in its own picture, drawn by the engine
// (renderer.ts) or by the kit's own WebGL2 renderer, each measured the same way. The page says what it found on itself and posts it to /report, so a browser that cannot be driven (real Safari) reports too.
//
//   ?run=gl,own   who draws: one after another in this tab (with &auto), or the first alone
//   &frames=120  &dark  &shots (opens the dialog and the menu at the end, for a picture)
import { use, adopt, ready } from '/kit/packages/voxelmorphism/src/index.js'
import { Renderer as GL } from '/kit/packages/voxelmorphism/src/core/gl.js'
import { renderer } from '../renderer.ts'

const q = new URLSearchParams(location.search)
const run = (q.get('run') ?? 'gl').split(','), at = Number(q.get('i') ?? 0), route = run[at]
if (q.has('dark')) document.documentElement.dataset.theme = 'dark'
document.querySelector('#what').textContent += ` Route: ${route}.`

// ── Sixty parts ──
const bench = document.querySelector('#bench'), parts = []
const words = ['Plant a seed', 'Water it', 'Let it bloom', 'Not yet', 'Pull it up', 'Show the session', 'Move it', 'Keep']
for (let i = 0; i < 26; i++) parts.push(`<button class="vx-button"${['', ' data-vx-material="chalk"', ' data-vx-material="brick"', ' disabled'][i % 4]}${i % 3 === 0 ? ` data-vx-icon="${['plus', 'drop', 'check', 'seed'][i % 4]}"` : ''}>${words[i % words.length]}</button>`)
for (let i = 0; i < 8; i++) parts.push(`<label class="vx-toggle"><input type="checkbox" role="switch"${i % 2 ? '' : ' checked'}><span class="vx-switch"></span>Switch ${i + 1}</label>`)
for (let i = 0; i < 6; i++) parts.push(`<span class="vx-slider wide"><input type="range" min="1" max="10" value="${2 + i}"></span>`)
for (let i = 0; i < 4; i++) parts.push(`<label class="vx-field wide"><span class="vx-field-label">Seed ${i + 1}</span><span class="vx-well"><input type="text" value="A new easter egg"></span></label>`)
for (let i = 0; i < 4; i++) parts.push(`<span class="vx-meter wide"><progress value="${i + 1}" max="5">${i + 1} of 5</progress></span>`)
for (let i = 0; i < 4; i++) parts.push(`<article class="vx-card wide" data-vx-edge="${['walnut', 'leaf', 'brick', 'signal'][i]}"><p><strong>Watered on ${14 + i} November</strong></p><p>Hide the egg in the footer.</p></article>`)
for (let i = 0; i < 2; i++) parts.push(`<div class="vx-tabs" role="tablist" aria-label="Garden ${i}"><button role="tab" aria-selected="true">Growing</button><button role="tab" aria-selected="false">Bloomed</button><button role="tab" aria-selected="false">Wilted</button></div>`)
for (let i = 0; i < 2; i++) parts.push(`<ul class="vx-list wide"><li aria-current="true"><a href="#x">A new easter egg</a><span class="vx-row-meta">bud</span></li><li><a href="#x">A greeting in the console</a><span class="vx-row-meta">sprout</span></li></ul>`)
bench.innerHTML = parts.join('\n')

const said = document.querySelector('#said'), out = { route, run: q.get('run'), browser: '', dpr: devicePixelRatio, window: [innerWidth, innerHeight], dark: q.has('dark') }
const ua = navigator.userAgent
out.browser = ua.match(/Chrome\/(\d+)/) ? `Chrome ${ua.match(/Chrome\/(\d+)/)[1]}` : ua.match(/Version\/([\d.]+).*Safari/) ? `Safari ${ua.match(/Version\/([\d.]+).*Safari/)[1]}` : ua
const frame = () => new Promise((r) => requestAnimationFrame(r))
// Where it has got to, said as it goes: a browser that cannot be watched may stop anywhere.
const step = (name, more = {}) => { try { navigator.sendBeacon('/report', JSON.stringify({ route, browser: out.browser, step: name, ms: Math.round(performance.now()), hidden: document.hidden, ...more })) } catch { /* nobody is listening */ } }
setTimeout(() => { if (!document.documentElement.dataset.done) { out.failed = 'not done in 150 s'; void finish() } }, 150000)
const round = (n, to = 2) => Math.round(n * 10 ** to) / 10 ** to
const spread = (xs) => { const s = [...xs].sort((a, b) => a - b); return { mean: round(s.reduce((a, b) => a + b, 0) / s.length), middle: round(s[s.length >> 1]), p95: round(s[Math.floor(s.length * 0.95)]), worst: round(s[s.length - 1]) } }
const finish = async () => {
  said.textContent = JSON.stringify(out, null, 1)
  try { await fetch('/report', { method: 'POST', body: JSON.stringify(out) }) } catch { /* nobody is listening */ }
  document.documentElement.dataset.done = '1'
  if (q.has('auto') && at + 1 < run.length) { q.set('i', String(at + 1)); setTimeout(() => location.replace(`?${q}`), 400) }
}

try {
  // ── The renderer, and when the first part was drawn ──
  const t0 = performance.now()
  const frames = new Map() // what each part was last drawn from, by its canvas
  let r, stats
  if (route === 'gl') {
    const gl = new GL(), draw = gl.draw.bind(gl)
    stats = { draws: 0, drawMs: 0, flushes: 0, flushMs: 0, first: 0, faults: [] }
    gl.draw = (f, ctx) => { const a = performance.now(), ok = draw(f, ctx); stats.draws++; stats.drawMs += performance.now() - a; if (!stats.first) stats.first = performance.now(); frames.set(ctx.canvas, f); return ok }
    r = { settle: async () => { gl.gl.finish() }, bytes: () => gl.canvas.width * gl.canvas.height * 4 * 6 + 2048 * 2048 * 4, gl }
    use(gl)
  } else {
    const made = renderer().then((made) => {
      if (!made) return null
      const draw = made.draw
      made.draw = (f, canvas) => { frames.set(canvas, f); return draw(f, canvas) }
      return made
    })
    use(made)
    const got = await made
    if (!got) { out.none = navigator.gpu ? 'no adapter' : 'no WebGPU'; await finish(); throw 0 }
    r = got.stage
    stats = r.stats
    out.opened = round(stats.opened, 1); out.ready = round(stats.ready, 1)
  }
  adopt()
  const stage = await ready()
  step('adopted', { stage: !!stage })
  if (!stage) { out.none = 'the kit stayed plain'; await finish(); throw 0 }
  const settled = async () => { for (let i = 0; i < 600 && stage.awake.size; i++) await frame(); await r.settle(); await frame(); await frame() }
  await settled()
  const lives = [...stage.lives.values()]
  out.cold = { firstPartAt: round(stats.first, 1), sinceScript: round(stats.first - t0, 1), allDrawnAt: round(performance.now(), 1) }
  out.parts = { adopted: lives.length, visible: lives.filter((l) => l.visible).length, cubes: lives.reduce((n, l) => n + l.capacity, 0), megapixels: round(lives.reduce((n, l) => n + l.wpx * l.hpx, 0) / 1e6) }

  step('settled')
  // ── Frames with nothing drawn: what the page's frames are like here by themselves ──
  const N = Number(q.get('frames') ?? 120)
  const watch = async (n, each) => {
    const gaps = [], work = [], drawn = []
    let last = 0, before = { ...stats }
    for (let i = 0; i < n + 1; i++) {
      const now = await frame()
      if (i > 0) { gaps.push(now - last); work.push(stats.drawMs + stats.flushMs - before.drawMs - before.flushMs); drawn.push(stats.draws - before.draws) }
      last = now; before = { ...stats }
      each()
    }
    await settled()
    return { frames: n, drawnAFrame: spread(drawn).middle, gapMs: spread(gaps), late: gaps.filter((g) => g > 25).length, pageThreadMs: spread(work) }
  }
  out.idle = await watch(60, () => {})
  step('idle', { gap: out.idle.gapMs.middle })
  // ── One part changes every frame (a press, a slide) ──
  const button = stage.lives.get(bench.querySelector('.vx-button'))
  out.one = { cubes: button.capacity, px: [button.wpx, button.hpx], ...(await watch(N, () => button.invalidate())) }
  step('one', { gap: out.one.gapMs.middle })
  // ── Every part changes in the same frame ──
  const shownLives = lives.filter((l) => l.visible)
  if (!q.has('brief')) out.together = await watch(N, () => { for (const l of lives) l.invalidate() })
  step('together')

  // ── As fast as it goes: the parts drawn, and the GPU waited for each time ──
  const pace = async (which, K) => {
    const a = performance.now()
    let sync = 0
    for (let k = 0; k < K; k++) {
      const b = performance.now()
      for (const l of which) { l.dirty = true; l.draw() }
      const done = r.settle()
      sync += performance.now() - b
      await done
    }
    if (route === 'gl') which[0].ctx.getImageData(0, 0, 1, 1)
    return { each: round((performance.now() - a) / K, 3), pageThread: round(sync / K, 3) }
  }
  await pace(shownLives, 2)
  out.paced = { parts: shownLives.length, all: await pace(shownLives, q.has('brief') ? 3 : 12) }
  out.paced.button = await pace([button], 40)
  step('paced')

  // ── A dialog (about 8,000 cubes), opened and built ──
  const dlg = document.querySelector('#dlg')
  dlg.showModal()
  await settled()
  const dialog = stage.lives.get(dlg)
  if (dialog) {
    out.dialog = { cubes: dialog.capacity, px: [dialog.wpx, dialog.hpx], ...(await watch(Math.min(N, 60), () => dialog.invalidate())) }
    out.paced.dialog = await pace([dialog], 20)
  }
  if (!q.has('shots')) { dlg.close(); await settled() }
  step('dialog')

  // ── The picture: the same part drawn by the kit's own renderer, pixel against pixel ──
  const ref = route === 'gl' ? r.gl : new GL()
  const read = (source, x, y, w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; const ctx = c.getContext('2d', { willReadFrequently: true }); ctx.drawImage(source, x, y, w, h, 0, 0, w, h); return ctx.getImageData(0, 0, w, h).data }
  const pictureOf = (live) => {
    const c = live.canvas, w = live.wpx, h = live.hpx
    if (route === 'gl') return live.ctx.getImageData(0, 0, w, h).data
    // A canvas the device shows directly can be read only in the turn it was drawn in: it is drawn again, then read.
    live.dirty = true; live.draw(); void r.settle()
    return read(c, 0, 0, w, h)
  }
  // Every part drawn in one turn, as the page draws them, and each read as it then stands: so a part laid beside
  // others on a sheet and copied from the wrong place does not pass. (For the device's own canvases only.)
  const own = route !== 'gl'
  const together = () => { for (const l of lives) { l.dirty = true; l.draw() } void r.settle(); return new Map(lives.filter((l) => l.visible).map((l) => [l, read(l.canvas, 0, 0, l.wpx, l.hpx)])) }
  const against = (live, drawn) => {
    const w = live.wpx, h = live.hpx, c = document.createElement('canvas'); c.width = w; c.height = h
    const ctx = c.getContext('2d', { willReadFrequently: true })
    ref.draw(frames.get(live.canvas), ctx)
    const want = ctx.getImageData(0, 0, w, h).data, got = drawn?.get(live) ?? pictureOf(live)
    let off = 0, worst = 0, sum = 0, filled = 0, opaque = null, shadow = null
    const where = []
    for (let i = 0; i < want.length; i += 4) {
      let d = 0
      for (let k = 0; k < 4; k++) d = Math.max(d, Math.abs(want[i + k] - got[i + k]))
      if (d > 2) { off++; if (where.length < 6) where.push({ at: [(i / 4) % w, Math.floor(i / 4 / w)], kit: [...want.slice(i, i + 4)], ours: [...got.slice(i, i + 4)] }) }
      worst = Math.max(worst, d); sum += d
      if (got[i + 3]) filled++
      const px = (i / 4) % w, py = Math.floor(i / 4 / w)
      if (!opaque && want[i + 3] === 255 && px > w / 2 && py > h / 2) opaque = { at: [px, py], kit: [...want.slice(i, i + 4)], ours: [...got.slice(i, i + 4)] }
      if (!shadow && want[i + 3] > 60 && want[i + 3] < 90 && py > h / 2) shadow = { at: [px, py], kit: [...want.slice(i, i + 4)], ours: [...got.slice(i, i + 4)] }
    }
    return { px: [w, h], filled: round(filled / (w * h), 3), differBy3OrMore: round(off / (w * h), 4), pixelsOff: off, where, worst, meanDiff: round(sum / (want.length / 4), 3), opaque, shadow }
  }
  // For whoever looks closer (blocks/proof/look.mjs): a part's picture from the kit's renderer and from this one.
  globalThis.proof = { stage, r, settled, against, pair(live) {
    const w = live.wpx, h = live.hpx, png = (data) => { const c = document.createElement('canvas'); c.width = w; c.height = h; c.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(data), w, h), 0, 0); return c.toDataURL() }
    const c = document.createElement('canvas'); c.width = w; c.height = h
    const ctx = c.getContext('2d', { willReadFrequently: true })
    ref.draw(frames.get(live.canvas), ctx)
    return { kit: c.toDataURL(), ours: png(pictureOf(live)) }
  } }
  // ── The picture while a thing is built and broken: time stepped by hand, as the kit's film does ──
  if (q.has('motion')) {
    const brief = (a) => ({ pixelsOff: a.pixelsOff, worst: a.worst, where: a.where.slice(0, 3) })
    out.motion = {}
    // Each step of time is a turn of the page of its own, as a frame is: a canvas the device shows can be read once
    // a turn (Playwright's WebKit gave nothing the second time).
    stage.manual = true
    dlg.showModal()
    await frame(); await frame() // the kit sees the dialog's new size and makes it again; no time passes
    const building = stage.lives.get(dlg)
    for (let f = 1; f <= 40; f++) { stage.advance(1 / 60); await frame(); if ([2, 6, 12, 20, 40].includes(f)) out.motion[`dialog built, frame ${f}`] = brief(against(building)) }
    const menu = document.querySelector('#menu'); menu.showPopover?.()
    await frame(); await frame()
    const popped = stage.lives.get(menu)
    for (let f = 1; f <= 14; f++) { stage.advance(1 / 60); await frame(); if (popped && [2, 6, 14].includes(f)) out.motion[`menu built, frame ${f}`] = brief(against(popped)) }
    menu.hidePopover?.()
    const card = stage.lives.get(bench.querySelector('.vx-card'))
    void card.play('crumble')
    for (let f = 1; f <= 12; f++) { stage.advance(1 / 60); await frame(); if ([2, 6, 12].includes(f)) out.motion[`card broken, frame ${f}`] = brief(against(card)) }
    void card.play('assemble')
    for (let f = 1; f <= 30; f++) stage.advance(1 / 60)
    const sw = stage.lives.get(bench.querySelector('.vx-switch'))
    bench.querySelector('.vx-toggle input').click()
    for (let f = 1; f <= 8; f++) { stage.advance(1 / 60); await frame(); if ([2, 5, 8].includes(f)) out.motion[`switch thrown, frame ${f}`] = brief(against(sw)) }
    for (let f = 1; f <= 60; f++) stage.advance(1 / 60)
    stage.manual = false
    dlg.close(); await settled()
  }
  if (!q.has('shots')) { for (const l of lives) l.invalidate(); await settled() }
  const shown = own ? together() : undefined, look = (sel) => against(stage.lives.get(bench.querySelector(sel)), shown)
  out.picture = { button: against(button, shown), toggle: look('.vx-switch'), card: look('.vx-card'), field: look('.vx-well'), slider: look('.vx-slider'), list: look('.vx-list') }

  step('picture')
  // ── What stays when nothing is drawn again: a part scrolled out of its box and back ──
  const scroller = document.querySelector('#scroller'), inBox = stage.lives.get(document.querySelector('#scrolled'))
  const drawsBefore = stats.draws
  scroller.scrollTop = 200; await frame(); await frame(); scroller.scrollTop = 0; await frame(); await frame(); await frame()
  const after = pictureOf(inBox); let kept = 0
  for (let i = 3; i < after.length; i += 4) if (after[i]) kept++
  out.scrolledBack = { drawnAgain: stats.draws - drawsBefore, filled: round(kept / (after.length / 4), 3) }
  const tilt = stage.lives.get(document.querySelector('#tilted')); let tf = 0; const tp = pictureOf(tilt)
  for (let i = 3; i < tp.length; i += 4) if (tp[i]) tf++
  out.underTransform = { filled: round(tf / (tp.length / 4), 3) }

  if (q.has('shots')) { document.querySelector('#menu').showPopover?.(); await settled() }
  out.bytes = { gpuByItsOwnCount: r.bytes(), partCanvases: lives.reduce((n, l) => n + l.wpx * l.hpx * 4, 0), jsHeap: performance.memory?.usedJSHeapSize ?? null }
  out.faults = stats.faults
  // ── The device destroyed on purpose, and a new one found ──
  if (q.has('lose') && own) {
    const t = performance.now(), d0 = stats.draws
    r.device.destroy()
    for (let i = 0; i < 600 && (stats.lost < 1 || stats.draws === d0 || stage.awake.size); i++) await frame()
    await settled()
    out.lost = { times: stats.lost, backAfterMs: round(performance.now() - t, 0), drawnAgain: stats.draws - d0, button: against(button, together()), faults: stats.faults.slice(-2) }
    delete out.lost.button.where; delete out.lost.button.opaque; delete out.lost.button.shadow
  }
  // ── The device lost, and none to be had again: the kit is told, and the page goes plain ──
  if (q.has('fail') && own) {
    const t = performance.now()
    Object.defineProperty(GPU.prototype, 'requestAdapter', { value: async () => null }) // on the prototype: WebKit hands out navigator.gpu anew
    r.device.destroy()
    for (let i = 0; i < 900 && document.querySelector('[data-vx-live]'); i++) await frame()
    out.failed_for_good = { plainAfterMs: round(performance.now() - t, 0), live: document.querySelectorAll('[data-vx-live]').length, canvases: document.querySelectorAll('canvas.vx-canvas').length, faults: stats.faults.slice(-2) }
  }
  out.totalMs = round(performance.now(), 0)
  await finish()
  // ── At rest: nothing is drawn again while the page is scrolled away and back; whoever watches compares pictures ──
  if (q.has('rest')) {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms)), d0 = stats.draws
    step('rest-before')
    await wait(3000)
    scrollTo(0, 1e5); await wait(1500); scrollTo(0, 0); await wait(1500)
    step('rest-after', { drawnAgain: stats.draws - d0 })
    document.documentElement.dataset.rested = String(stats.draws - d0)
  }
} catch (e) {
  if (e !== 0) { out.failed = String(e?.stack ?? e); await finish() }
}
