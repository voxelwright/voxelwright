// Water over water (#226): the core as wasm keeps water under a deck and on it as two layers of one column, says
// where it changed in a few boxes, and makes its surface as bricks of a distance field; the page keeps those bricks
// in a forest (page/water.ts `brickForest`) and draws them with real WebGPU in headless Chrome.
//
//   1. In Node: a channel with a deck across it is built in the sky with edits, water is let go under the deck and
//      on it, and the wasm's own answers are read: two wet layers in one column, the lower one's ceiling the deck's
//      underside, dirty boxes round the water and none once it is still, bricks only for the hidden layer until
//      all are asked for, and two bricks side by side agreeing where they overlap.
//   2. In Chrome: the same water in the page's own instance. The forest draws nothing until the rays have asked
//      for bricks; asked, made and set, it draws the water under the deck; a wall in front hides it; requests
//      written before the root was laid out again are dropped; far off, coarser bricks are asked for and drawn;
//      and the old heights pass draws beside it. No GPU fault in any of it.
//
//   node engine/test/water-layers.mjs
import { readFile } from 'node:fs/promises'
import { here, start } from './kit.mjs'

/** Builds the channel and its deck in a core's world, lets the water go and runs it. Runs in Node and in the page. */
const rig = (core, seconds = 6) => {
  const CONCRETE = 7, at = [700, 3000, 4060]
  const fill = (lo, hi, kind = CONCRETE) => {
    const rows = []
    for (let y = lo[1]; y < hi[1]; y++) for (let z = lo[2]; z < hi[2]; z++) rows.push(at[0] + lo[0], at[0] + hi[0], at[1] + y, at[2] + z, kind)
    const address = core.edits_room(2 + rows.length)
    new Int32Array(core.memory.buffer, address, 2 + rows.length).set([1, rows.length / 5, ...rows])
    core.world_edit(-1)
  }
  // A floor 60 by 12 cells with walls 30 tall, a deck two cells thick ten cells up across its middle, kerbed at each end.
  fill([-2, -2, -2], [62, 0, 14])
  fill([-2, 0, -2], [62, 30, 0]); fill([-2, 0, 12], [62, 30, 14]); fill([-2, 0, 0], [0, 30, 12]); fill([60, 0, 0], [62, 30, 12])
  fill([20, 10, 0], [40, 12, 12]); fill([20, 12, 0], [22, 16, 12]); fill([38, 12, 0], [40, 16, 12])
  let poured = 0
  for (let z = 1; z < 12; z += 2) {
    for (let x = 1; x < 18; x += 2) poured += 16 * core.water_pour(at[0] + x, at[1] + 6, at[2] + z, 16, 0)
    for (let x = 23; x < 38; x += 2) poured += 8 * core.water_pour(at[0] + x, at[1] + 20, at[2] + z, 8, 1)
  }
  let told = null
  for (let k = 0; k < seconds * 60; k++) {
    const n = core.bodies_advance(1 / 60)
    // The heights the page is told, as its FLOW record (tag 8): the last of them is kept.
    const out = new Uint32Array(core.memory.buffer, core.bodies_words(), n)
    for (let i = 0; i < n; i += 2 + out[i + 1]) if (out[i] === 8) told = out.slice(i + 2, i + 2 + out[i + 1])
  }
  return { at, poured, told, deck: core.world_kind(at[0] + 30, at[1] + 11, at[2] + 6), air: core.world_kind(at[0] + 30, at[1] + 5, at[2] + 6) }
}
/** The wet layers, read from the core. */
const layersOf = (core) => {
  const n = core.water_layers_len(), words = new Uint32Array(core.memory.buffer, core.water_layers_ptr(), n).slice()
  const floats = new Float32Array(words.buffer)
  return Array.from({ length: n / 5 }, (_, k) => ({ cx: words[5 * k] & 0xffff, cz: words[5 * k] >>> 16, bottom: floats[5 * k + 1], top: floats[5 * k + 2], ceiling: floats[5 * k + 3], fluid: words[5 * k + 4] & 255, stack: words[5 * k + 4] >>> 16 }))
}
const bricksOf = (core) => {
  const n = core.water_sdf_brick_count()
  return new Int32Array(core.memory.buffer, core.water_sdf_bricks_ptr(), 3 * n).slice()
}
const brickOf = (core, key, lod = 0) => {
  const held = core.water_sdf_build_brick_lod(key[0], key[1], key[2], lod, 0)
  return { held, sdf: new Int8Array(core.memory.buffer, core.water_sdf_room(), 512).slice() }
}

const { url, page: openPage, check, failures, finish } = await start()
try {
  // ── 1. The core as wasm, in Node ──
  const core = (await WebAssembly.instantiate(await readFile(here + 'page/core.wasm'), {})).instance.exports
  const names = ['water_layer_count', 'water_layers_stacked', 'water_layers_at', 'water_dirty_boxes_ptr', 'water_dirty_boxes_len', 'water_sdf_brick_count', 'water_sdf_bricks_ptr', 'water_sdf_build_brick', 'water_pour']
  check(names.every((n) => typeof core[n] === 'function'), `the wasm has the water's new questions (${names.filter((n) => typeof core[n] !== 'function').join(', ') || 'all of them'})`)
  const made = rig(core)
  const { at } = made
  check(made.deck === 7 && made.air === 0, `the deck stands in the solver's world (${made.deck} in it, ${made.air} under it)`)
  const layers = layersOf(core), window_ = new Int32Array(core.memory.buffer, core.water_window_ptr(), 4).slice()
  const column = (x, z) => layers.filter((l) => l.cx === Math.floor((at[0] + x - window_[0]) / window_[2]) && l.cz === Math.floor((at[2] + z - window_[1]) / window_[2])).sort((a, b) => a.bottom - b.bottom)
  const mid = column(30, 6)
  check(core.water_layers_stacked() === 2 && mid.length === 2 && mid.every((l) => l.stack === 2), `water lies under the deck and on it at once: ${core.water_layer_count()} wet layers, ${mid.length} in the deck's middle column`)
  check(mid.length === 2 && mid[0].bottom === at[1] && mid[0].ceiling === at[1] + 10 && mid[0].top > at[1] + 0.5 && mid[0].top <= at[1] + 10 && mid[0].fluid === 0, `the lower layer lies on the floor under the deck's underside (floor ${mid[0]?.bottom - at[1]}, top ${(mid[0]?.top - at[1]).toFixed(2)}, ceiling ${mid[0]?.ceiling - at[1]})`)
  check(mid.length === 2 && mid[1].bottom === at[1] + 12 && mid[1].ceiling === Infinity && mid[1].top > at[1] + 12.5 && mid[1].fluid === 1, `the upper layer lies on the deck under the sky, and is the sea's as it was let go (floor ${mid[1]?.bottom - at[1]}, top ${(mid[1]?.top - at[1]).toFixed(2)})`)
  const beyond = column(44, 6)
  check(beyond.length === 1 && beyond[0].bottom === at[1] && beyond[0].fluid === 0, `the water let go upstream ran under the deck and out the far side (${beyond.length} layer there, ${(beyond[0]?.top - at[1]).toFixed(2)} deep)`)
  check(core.water_layers_at(at[0] + 30, at[2] + 6) >= 2, 'the column of the world answers with both its layers')
  // The heights told to the page are of the top-most water: over the deck that is the deck's.
  const told = made.told
  const word = told[9 + (Math.floor((at[0] + 30 - window_[0]) / 2) - told[5]) + told[7] * (Math.floor((at[2] + 6 - window_[1]) / 2) - told[6])]
  check(Math.abs((word & 0x3ffff) / 8 + (told[4] | 0) - mid[1]?.top) < 0.2, `the heights tell the top-most layer there (${((word & 0x3ffff) / 8 + (told[4] | 0) - at[1]).toFixed(2)} over the floor)`)

  // Where it changed: a few boxes, all round the channel.
  const dirty = () => { const n = core.water_dirty_boxes_len(); return Array.from({ length: n }, (_, k) => [...new Int32Array(core.memory.buffer, core.water_dirty_boxes_ptr() + 24 * k, 6)]) }
  const boxes = dirty()
  check(boxes.length >= 1 && boxes.length <= 8 && boxes.every((b) => b[0] >= at[0] - 2 && b[3] <= at[0] + 62 && b[1] >= at[1] && b[4] <= at[1] + 24 && b[2] >= at[2] - 2 && b[5] <= at[2] + 14), `the water's changes are in ${boxes.length} box(es) that keep to the channel: ${JSON.stringify(boxes.map((b) => b.map((v, i) => v - at[i % 3])))}`)
  // The field as it begins: only the layer the heights cannot show.
  const under = bricksOf(core)
  const lowOnly = under.length > 0 && Array.from({ length: under.length / 3 }, (_, k) => under[3 * k + 1]).every((by) => by * 12 <= at[1] + 2 && (by + 1) * 12 >= at[1] - 2)
  check(lowOnly, `the field begins as the hidden layer alone: ${under.length / 3} bricks, all at the floor's height`)
  let surfaces = 0, kinds = new Set()
  for (let k = 0; k < under.length; k += 3) { const b = brickOf(core, under.subarray(k, k + 3)); kinds.add(b.held); if (b.held === 3) surfaces++ }
  check(surfaces > 0 && !kinds.has(0), `every one of them holds some of the field, ${surfaces} a surface`)
  // Two bricks side by side hold the same numbers where their borders overlap.
  const keyAt = (x, z, y) => [Math.floor((at[0] + x - window_[0]) / 12), Math.floor(y / 12), Math.floor((at[2] + z - window_[1]) / 12)]
  const one = keyAt(28, 6, mid[0].top), a = brickOf(core, one), b = brickOf(core, [one[0] + 1, one[1], one[2]])
  let seam = 0
  for (let z = 0; z < 8; z++) for (let y = 0; y < 8; y++) seam += Math.abs(a.sdf[6 + 8 * y + 64 * z] - b.sdf[8 * y + 64 * z]) + Math.abs(a.sdf[7 + 8 * y + 64 * z] - b.sdf[1 + 8 * y + 64 * z])
  check(a.held === 3 && seam === 0, 'two bricks side by side agree where they overlap: no seam between them')
  // Up through a brick the field crosses zero once, at the water's top.
  const ys = Array.from({ length: 8 }, (_, i) => a.sdf[3 + 8 * i + 64 * 3] * 4 / 127), k0 = ys.findIndex((v, i) => v < 0 && ys[i + 1] >= 0)
  const yOf = (i) => (one[1] * 6 - 1 + i + 0.5) * 2, zero = k0 < 0 ? NaN : yOf(k0) + 2 * ys[k0] / (ys[k0] - ys[k0 + 1])
  check(Math.abs(zero - mid[0].top) < 0.15, `the field is zero at the water's top (${(zero - at[1]).toFixed(2)} against ${(mid[0].top - at[1]).toFixed(2)} over the floor)`)
  core.water_sdf_cover(1)
  const all = bricksOf(core)
  check(all.length > under.length, `asked for every layer, it has more bricks (${all.length / 3} against ${under.length / 3}): the deck's water and the open channel's too`)
  core.water_sdf_cover(0)
  // Still, nothing is marked.
  let waited = 0
  while (core.bodies_flowing() && waited++ < 60 * 90) core.bodies_advance(1 / 60)
  core.water_dirty_clear()
  for (let k = 0; k < 120; k++) core.bodies_advance(1 / 60)
  check(!core.bodies_flowing() && core.water_dirty_boxes_len() === 0, `once the water lies still (after ${(waited / 60).toFixed(0)} s more) no box is marked`)

  // ── 2. The forest of bricks, drawn in Chrome ──
  const page = await openPage({ size: [640, 360], dpr: 1 })
  await page.route('**/probe-water-layers', (r) => r.fulfill({ contentType: 'text/html', body: '<!doctype html><html><body></body></html>' }))
  await page.goto(`${url}/probe-water-layers`)
  const seen = await page.evaluate(async (rigSource) => {
    const { shader, depthFor, DEPTH, NEAR, FAR } = await import('/probe/gpu.ts')
    const { brickForest, flowing, BRICK_BYTES } = await import('/page/water.ts')
    const adapter = await navigator.gpu?.requestAdapter({ powerPreference: 'high-performance' })
    if (!adapter) throw new Error('WebGPU gave no adapter')
    const device = await adapter.requestDevice()
    const faults = []
    device.addEventListener('uncapturederror', (e) => faults.push(`error: ${e.error.message}`))
    void device.lost.then((info) => faults.push(`lost: ${info.reason} ${info.message}`))

    const core = (await WebAssembly.instantiateStreaming(fetch('/page/core.wasm'), {})).instance.exports
    const made = new Function(`return (${rigSource})`)()(core)
    const { at } = made
    const win = new Int32Array(core.memory.buffer, core.water_window_ptr(), 4).slice()
    const bricks = () => { const n = core.water_sdf_brick_count(); return new Int32Array(core.memory.buffer, core.water_sdf_bricks_ptr(), 3 * n).slice() }
    const brick = (key, lod) => { const held = core.water_sdf_build_brick_lod(key[0], key[1], key[2], lod, 0); return { held, sdf: new Int8Array(core.memory.buffer, core.water_sdf_room(), BRICK_BYTES).slice() } }

    const W = 256, H = 144, format = 'rgba16float'
    const colour = device.createTexture({ size: [W, H], format, usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC })
    const depth = depthFor(device, [W, H])
    const to = { color: colour.createView(), depth: depth.createView(), size: [W, H] }
    // What stands in the world, for the checks: a wall a way along the eye's forward, or nothing (depth 1).
    const wallModule = await shader(device, 'test-wall', /* wgsl */ `
      @group(0) @binding(0) var<uniform> w: vec4f;
      @vertex fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f { return vec4f(vec2f(f32((i << 1u) & 2u), f32(i & 2u)) * 2.0 - 1.0, 0.5, 1.0); }
      @fragment fn fs() -> @builtin(frag_depth) f32 { return clamp(w.z / (w.z - w.y) * (1.0 - w.y / max(w.x, w.y)), 0.0, 1.0); }`)
    const wallPipe = await device.createRenderPipelineAsync({ layout: 'auto', vertex: { module: wallModule, entryPoint: 'vs' }, fragment: { module: wallModule, entryPoint: 'fs', targets: [] }, depthStencil: { format: DEPTH, depthWriteEnabled: true, depthCompare: 'always' } })
    const wallU = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST })
    const wallBind = device.createBindGroup({ layout: wallPipe.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: wallU } }] })
    const half = (h) => { const e = (h >> 10) & 31, m = h & 1023, s = h & 0x8000 ? -1 : 1; return e === 0 ? s * m * 2 ** -24 : e === 31 ? (m ? NaN : s * Infinity) : s * (1 + m / 1024) * 2 ** (e - 15) }
    const landing = device.createBuffer({ size: W * H * 8, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ })
    const view = (eye, target) => {
      const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], unit = (v) => { const l = Math.hypot(...v); return v.map((c) => c / l) }
      const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
      const forward = unit(sub(target, eye)), right = unit(cross(forward, [0, 1, 0]))
      return { eye, forward, right, up: cross(right, forward), tanHalf: Math.tan(Math.PI / 6) }
    }
    /** One frame: the world's depth (a wall or none), then whatever `draw` draws; what the picture then holds. */
    const frame = async (draw, wall = 0) => {
      device.queue.writeBuffer(wallU, 0, new Float32Array([wall || FAR, NEAR, FAR, 0]))
      const encoder = device.createCommandEncoder()
      const world = encoder.beginRenderPass({ colorAttachments: [], depthStencilAttachment: { view: to.depth, depthClearValue: 1, depthLoadOp: 'clear', depthStoreOp: 'store' } })
      if (wall) { world.setPipeline(wallPipe); world.setBindGroup(0, wallBind); world.draw(3) }
      world.end()
      encoder.beginRenderPass({ colorAttachments: [{ view: to.color, loadOp: 'clear', clearValue: [0, 0, 0, 0], storeOp: 'store' }] }).end()
      draw(encoder)
      encoder.copyTextureToBuffer({ texture: colour }, { buffer: landing, bytesPerRow: W * 8 }, [W, H])
      device.queue.submit([encoder.finish()])
      await landing.mapAsync(GPUMapMode.READ)
      const raw = new Uint16Array(landing.getMappedRange().slice(0))
      landing.unmap()
      let covered = 0, bad = 0, blue = 0, most = 0
      for (let i = 0; i < raw.length; i += 4) {
        const [r, g, b, a] = [half(raw[i]), half(raw[i + 1]), half(raw[i + 2]), half(raw[i + 3])]
        if (![r, g, b, a].every(Number.isFinite) || r < 0 || g < 0 || b < 0) bad++
        if (a > 0.02) { covered++; if (b >= r) blue++ }
        most = Math.max(most, a)
      }
      return { covered, bad, blue, most }
    }

    const forest = await brickForest(device, format)
    const list = bricks()
    forest.place([win[0], win[1]], win[2])
    forest.active(list)
    // From upstream in the channel, under the deck's height, looking along the water under the deck.
    const near = view([at[0] + 8, at[1] + 6, at[2] + 6], [at[0] + 30, at[1] + 1, at[2] + 6])
    const drawForest = (v) => (encoder) => forest.draw(encoder, to, v, 1.5)
    const wantedAtFirst = forest.wanted
    const empty = await frame(drawForest(near))
    /** What the rays asked for is read, made by the core and set, until they ask for nothing more. */
    const feed = async (v, rounds = 8) => {
      let builtAt = [0, 0, 0], asked = 0
      for (let round = 0; round < rounds; round++) {
        forest.poll()
        await forest.settled()
        const wants = forest.requests(256)
        if (!wants.length && round > 1) break
        for (const want of wants) { asked++; const b = brick(want.key, want.lod); if (forest.set(want.key, want.lod, b.sdf)) builtAt[want.lod]++ }
        await frame(drawForest(v))
      }
      return { asked, builtAt }
    }
    const fed = await feed(near)
    const shown = await frame(drawForest(near))
    const afterNear = forest.stats()
    const walled = await frame(drawForest(near), 3)
    const behind = await frame(drawForest(near), 4000)

    // A request written before the root is laid out again is of another root: it is dropped.
    forest.touch([at[0], at[1] - 2, at[2]], [at[0] + 60, at[1] + 12, at[2] + 12])
    const touched = forest.wanted
    await frame(drawForest(near))
    await device.queue.onSubmittedWorkDone()
    const before = forest.stats()
    forest.clear()
    forest.active(list)
    forest.poll()
    await forest.settled()
    const after = forest.stats(), kept = forest.requests(256).length

    // Far off, coarser bricks are what is asked for.
    const far = view([at[0] + 30, at[1] + 560, at[2] + 70], [at[0] + 30, at[1] + 1, at[2] + 6])
    await frame(drawForest(far))
    const fedFar = await feed(far)
    core.water_sdf_cover(1)
    forest.covers = 'all'
    forest.clear()
    forest.active(bricks())
    await frame(drawForest(far))
    const fedAll = await feed(far)
    const shownFar = await frame(drawForest(far))

    // The heights pass as it was, and with its own forest beside it: both in one frame.
    const water = await flowing(device, format)
    const none = water.bricks
    water.set(made.told)
    const heights = await frame((encoder) => water.draw(encoder, to, view([at[0] + 30, at[1] + 60, at[2] - 40], [at[0] + 30, at[1] + 6, at[2] + 6]), 1.5))
    const own = await water.forest()
    core.water_sdf_cover(0)
    own.place([win[0], win[1]], win[2])
    own.active(bricks())
    for (let k = 0; k < bricks().length; k += 3) { const key = [...bricks().subarray(k, k + 3)]; own.set(key, 0, brick(key, 0).sdf) }
    const both = await frame((encoder) => water.draw(encoder, to, near, 1.5))
    await device.queue.onSubmittedWorkDone()
    return { faults, bricks: list.length / 3, wantedAtFirst, empty, fed, shown, afterNear, walled, behind, touched, before, after, kept, fedFar, fedAll, shownFar, none: none === null, columns: water.columns, heights, both, ownBricks: own.bricks }
  }, String(rig))

  const s = seen
  check(s.wantedAtFirst === s.bricks && s.empty.covered === 0, `told where the surface is, the forest wants ${s.wantedAtFirst} bricks and draws nothing until it has one (${s.empty.covered} pixels)`)
  check(s.fed.asked > 0 && s.fed.builtAt[0] > 0 && s.afterNear.bricks > 0 && s.afterNear.asked > 0, `the rays asked for ${s.fed.asked} bricks through the ring, and ${s.fed.builtAt[0]} were made by the core and set (${s.afterNear.bricks} places hold one, ${s.afterNear.wanted} still unseen, ${s.afterNear.reads} reads of the ring)`)
  check(s.shown.covered > 300 && s.shown.blue > s.shown.covered * 0.9 && s.shown.bad === 0 && s.shown.most <= 0.97, `the water under the deck is drawn: ${s.shown.covered} pixels of ${256 * 144}, ${s.shown.blue} of them no redder than blue, none of them not a number`)
  check(s.walled.covered === 0 && s.behind.covered === s.shown.covered, `a wall in front of it hides all of it (${s.walled.covered} pixels), one behind it none (${s.behind.covered})`)
  check(s.touched > 0 && s.after.version > s.before.version && s.after.stale > s.before.stale && s.kept === 0, `requests written before the root was laid out again are dropped: ${s.after.stale - s.before.stale} of them, none kept (version ${s.before.version} to ${s.after.version})`)
  check(s.fedFar.asked > 0 && s.fedFar.builtAt[0] === 0 && s.fedFar.builtAt[1] + s.fedFar.builtAt[2] > 0, `from far off the rays ask for coarser bricks: ${s.fedFar.builtAt[1]} twice as coarse and ${s.fedFar.builtAt[2]} four times, none of the finest`)
  check(s.fedAll.builtAt[1] + s.fedAll.builtAt[2] > 0 && s.shownFar.covered > 20 && s.shownFar.bad === 0, `and all the water's layers are drawn from them (${s.shownFar.covered} pixels)`)
  check(s.none && s.columns > 100 && s.heights.covered > 300 && s.heights.bad === 0, `the heights pass is as it was, with no forest until one is asked for: ${s.columns} columns, ${s.heights.covered} pixels`)
  check(s.ownBricks > 0 && s.both.covered > 300 && s.both.bad === 0, `with its forest, the heights and the bricks are drawn in one frame (${s.ownBricks} bricks, ${s.both.covered} pixels)`)
  check(s.faults.length === 0, `no GPU fault${s.faults.length ? `: ${s.faults.join('; ')}` : ''}`)
} catch (e) {
  failures.push(String(e?.stack ?? e))
}
await finish('water-layers')
