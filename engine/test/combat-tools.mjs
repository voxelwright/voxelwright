// Live combat and sports tools (#166): the melee arena's wasm exports (engine/core/src/melee_ffi.rs) on the
// real core.wasm, the tool state machines in engine/page/combat-tools.ts (saber, rifle, rocket, laser,
// grapple, tennis) with a recorded world and sound, and in headless Chrome the tools' WebGPU pass: its
// shader compiles, a lit blade lights pixels in front of a depth wall and none behind it, an idle draw
// changes nothing, and the device reports no fault.
//
//   node engine/test/combat-tools.mjs        (after `npm --prefix engine run core`)
import { readFileSync } from 'node:fs'
import { start } from './kit.mjs'
import { MeleeWasm, createCombatTools, decodeMeleeEvents, eyeFrame, quatTurn } from '../page/combat-tools.ts'
import { SportsWasm } from '../page/sports-court.ts'

const bytes = readFileSync(new URL('../page/core.wasm', import.meta.url))
const fresh = async () => (await WebAssembly.instantiate(bytes, {})).instance

const { url, page: openPage, check, failures, finish } = await start()
const near = (a, b, eps) => Math.abs(a - b) <= eps
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const unit = (v) => { const l = Math.hypot(...v); return v.map((c) => c / l) }

/** Every call a mock makes, by name. */
function recorder() {
  const calls = {}
  const proxy = new Proxy({}, { get: (_, name) => (...args) => { (calls[name] ??= []).push(args); return name === 'saberIgnite' || name.startsWith('tennis') ? true : undefined } })
  return { calls, proxy }
}

try {
  // ── 1. The melee arena's exports on the real core.wasm ──
  {
    const melee = new MeleeWasm(await fresh())
    melee.reset()
    melee.setGround('none')
    check(melee.spawn('lightsaber', [0, 10, 0]) === 1 && melee.count() === 1, 'melee_spawn makes a lightsaber with id 1')
    check(melee.ignite(1, true) === 0, 'melee_ignite: a saber spawns retracted (extension 0)')
    for (let i = 0; i < 20; i++) melee.step(1 / 60)
    const pose = melee.pose(1)
    check(pose?.extension === 1 && near(pose.pos[1], 10, 0.5), `melee_pose after 1/3 s: extension ${pose?.extension}, held at y ${pose?.pos[1].toFixed(2)}`)
    const blade = melee.blade(1)
    check(blade?.lit && near(blade.tip[1] - blade.emitter[1], 10, 0.1), 'melee_blade: a lit 10-cell plasma blade')
    check(melee.driveHand(99, [0, 0, 0], [0, 0, 0, 1], 1 / 60) === null, 'melee_drive_hand refuses a weapon that is not there')

    // Plunge the blade point-down into a plane of earth and drag it: a kerf, carved once, glowing, then cooling.
    melee.reset()
    melee.setGround('plane', 0)
    const down = [1, 0, 0, 0] // half a turn about X: blade points -Y
    const id = melee.spawn('lightsaber', [0, 14, 0], down)
    melee.ignite(id, true)
    for (let i = 0; i < 20; i++) melee.driveHand(id, [0, 30, 0], down, 1 / 60)
    const carved = new Set()
    let twice = 0, kerfs = 0
    for (let f = 1; f <= 60; f++) {
      const t = f / 60
      const events = melee.driveHand(id, [12 * Math.min(1, Math.max(0, (t - 0.33) / 0.67)), 14 + 16 * Math.max(0, 1 - t * 6) - 6 * Math.min(1, t * 3), 0], down, 1 / 60)
      for (const e of events) if (e.type === 'kerf') {
        kerfs++
        for (let k = 0; k < e.cells.length; k += 3) {
          const key = `${e.cells[k]},${e.cells[k + 1]},${e.cells[k + 2]}`
          if (carved.has(key)) twice++
          carved.add(key)
        }
      }
    }
    check(kerfs > 3 && carved.size >= 12 && twice === 0, `melee_drive_hand kerf: ${kerfs} kerf records, ${carved.size} cells, ${twice} cut twice`)
    const hot = melee.glow()
    check(hot.length / 4 > 0 && Math.max(...hot.filter((_, i) => i % 4 === 3)) > 0.9, `melee_glow_count: ${hot.length / 4} glowing cells, hottest near 1`)
    melee.ignite(id, false)
    for (let i = 0; i < 150; i++) melee.step(1 / 30)
    check(melee.glow().length === 0, 'kerf glow cools away within five seconds')

    // The decoder skips records it does not know by their length.
    const words = new Uint32Array([0x63 | (2 << 8), 1, 2, 8 | (3 << 8), 4, 5, 6])
    const decoded = decodeMeleeEvents(words)
    check(decoded.length === 1 && decoded[0].type === 'ignite' && decoded[0].cell.join() === '4,5,6', 'event decoder skips an unknown record by its length')
  }

  // ── 2. The tools' state machines, with a recorded world and sound ──
  const eye = [100, 16, 100]
  {
    const melee = new MeleeWasm(await fresh())
    melee.reset()
    const audio = recorder(), carves = []
    const tools = await createCombatTools(null, 'rgba16float', {
      melee, meleeGround: 'plane', groundAt: () => 8, combatAudio: audio.proxy,
      carveCells: (cells) => carves.push(cells.length / 3),
    })
    check(tools.drawList(eye, [0, 0, -1]).count === 0, 'fresh tools draw nothing')
    tools.select('saber')
    const aim = unit([0, -0.35, -1])
    tools.update(1 / 60, eye, aim)
    tools.primary(eye, aim, true)
    check(tools.state().saber.ignited && audio.calls.saberIgnite?.length === 1, 'saber: a click ignites it (saberIgnite)')
    let midDot = -1, sawSwing = false
    for (let f = 0; f < 60; f++) {
      tools.update(1 / 60, eye, aim)
      const s = tools.state().saber
      if (s.swinging) sawSwing = true
      if (f === 8) {
        const b = melee.blade(s.id)
        midDot = dot(unit([b.tip[0] - b.emitter[0], b.tip[1] - b.emitter[1], b.tip[2] - b.emitter[2]]), aim)
      }
    }
    const s = tools.state().saber
    check(sawSwing && !s.swinging && s.extension === 1, `saber: swing runs and returns to ready, extension ${s.extension}`)
    check(midDot > 0.6, `saber: mid-swing the blade sweeps through the aim (cos ${midDot.toFixed(2)})`)
    check(audio.calls.saberUpdate?.length > 30, 'saber: hum follows the blade every frame (saberUpdate)')
    // Swing at the ground a metre below the hand: the blade cuts it.
    for (let k = 0; k < 4; k++) {
      tools.swing()
      for (let f = 0; f < 30; f++) tools.update(1 / 60, eye, unit([0, -0.9, -0.5]))
    }
    const after = tools.state()
    check(after.saber.carved > 0 && carves.length > 0 && after.glowCells > 0, `saber: cuts the ground (${after.saber.carved} cells to carveCells, ${after.glowCells} glowing)`)
    const blade = melee.blade(after.saber.id)
    const { fwd } = eyeFrame(unit([0, -0.9, -0.5]))
    check(dot([blade.tip[0] - eye[0], blade.tip[1] - eye[1], blade.tip[2] - eye[2]], fwd) > 0, 'saber: the blade is in front of the eye')
    check(tools.drawList(eye, fwd).count >= 3, 'saber: blade, core and hilt are drawn')
    tools.secondary(eye, aim)
    check(!tools.state().saber.ignited && audio.calls.saberRetract?.length >= 1, 'saber: secondary retracts it (saberRetract)')
    tools.destroy()
    check(melee.count() === 0, 'destroy removes the saber from the arena')
  }
  {
    // Ranged tools against a steel floor at y = 0 and, for the laser, a mirror at z = 50 facing +Z, then a wall at x = 60.
    const audio = recorder(), world = recorder()
    const raycast = (o, d, max) => {
      const hits = []
      if (d[1] < -1e-6) { const t = -o[1] / d[1]; if (t > 0) hits.push({ t, normal: [0, 1, 0], hard: true }) }
      if (d[2] < -1e-6) { const t = (50 - o[2]) / d[2]; const y = o[1] + d[1] * t; if (t > 0 && y > 0) hits.push({ t, normal: [0, 0, 1], mirror: true, hard: true }) }
      if (d[0] < -1e-6) { const t = (60 - o[0]) / d[0]; if (t > 0) hits.push({ t, normal: [1, 0, 0] }) }
      hits.sort((a, b) => a.t - b.t)
      const h = hits[0]
      if (!h || h.t > max) return null
      return { pos: [o[0] + d[0] * h.t, o[1] + d[1] * h.t, o[2] + d[2] * h.t], normal: h.normal, dist: h.t, hard: h.hard, mirror: h.mirror }
    }
    let rope = 7
    const tools = await createCombatTools(null, 'rgba16float', {
      raycast, combatAudio: audio.proxy,
      ballisticsFire: (...a) => { world.proxy.ballisticsFire(...a); return 1 },
      shockwaveBlast: (...a) => { world.proxy.shockwaveBlast(...a); return 1 },
      beamsFire: (...a) => { world.proxy.beamsFire(...a); return 2 },
      jointsAddRope: (...a) => { world.proxy.jointsAddRope(...a); return rope },
      jointsSetWinch: (...a) => { world.proxy.jointsSetWinch(...a); return 1 },
    })
    tools.select('rifle')
    const graze = unit([0, -0.12, 1]) // away from the mirror, low along the floor
    tools.primary(eye, graze, true)
    const r = tools.state().rifle
    check(world.calls.ballisticsFire?.[0]?.[0] === 1 && audio.calls.bulletCrack?.length === 1, 'rifle: fires a 5.56 round (ballisticsFire caliber 1, bulletCrack)')
    check(r.ricochets === 1 && audio.calls.ricochet?.length === 1, `rifle: a grazing shot off steel ricochets (${r.ricochets})`)
    check(tools.drawList(eye, graze).count > 0, 'rifle: tracer drawn')
    for (let f = 0; f < 30; f++) tools.update(1 / 60, eye, graze)
    check(tools.state().rifle.tracers === 0, 'rifle: tracers fade within half a second')

    tools.select('rocket')
    const steep = unit([0, -0.5, -1])
    tools.primary(eye, steep, true)
    check(tools.state().rocket.inFlight === 1 && !world.calls.shockwaveBlast, 'rocket: in flight, no blast yet')
    tools.update(1 / 60, eye, steep)
    check(tools.drawList(eye, steep).count > 0, 'rocket: drawn in flight')
    for (let f = 0; f < 30; f++) tools.update(1 / 60, eye, steep)
    const blast = world.calls.shockwaveBlast?.[0]
    check(blast && near(blast[0][1], 0, 0.01) && tools.state().rocket.blasts === 1 && audio.calls.shockwaveBoom?.length === 1, `rocket: blasts on the floor (shockwaveBlast at y ${blast?.[0][1].toFixed(2)}, shockwaveBoom)`)

    tools.select('laser')
    const level = unit([0, -0.02, -1])
    tools.primary(eye, level, true)
    for (let f = 0; f < 5; f++) tools.update(1 / 60, eye, level)
    const l = tools.state().laser
    check(l.firing && l.reflections >= 1 && world.calls.beamsFire?.length >= 5, `laser: beamsFire each frame, reflects off the mirror (${l.segments} segments)`)
    check(audio.calls.laserSizzle?.[0]?.[0]?.active === true, 'laser: sizzle held while firing')
    tools.primary(eye, level, false)
    check(!tools.state().laser.firing && audio.calls.laserSizzle.at(-1)[0].active === false, 'laser: release stops beam and sizzle')

    tools.select('grapple')
    check(tools.grappleClick(eye, [0, 1, 0]) === 'missed', 'grapple: a click at the sky anchors nothing')
    check(tools.grappleClick(eye, unit([0, -1, -0.2])) === 'anchored', 'grapple: first click anchors A')
    check(tools.grappleClick(eye, unit([0, -1, 0.6])) === 'linked' && world.calls.jointsAddRope?.length === 1, 'grapple: second click links A to B (jointsAddRope)')
    tools.reel(1)
    for (let f = 0; f < 30; f++) tools.update(1 / 60, eye, level)
    check(world.calls.jointsSetWinch?.[0]?.join() === '7,30' && tools.state().grapple.winch === 30, 'grapple: reel winds the winch in (jointsSetWinch 7, 30)')
    rope = 0
    tools.grappleClick(eye, unit([0, -1, -0.2]))
    check(tools.grappleClick(eye, unit([0, -1, 0.6])) === 'refused' && tools.state().grapple.cables === 1, 'grapple: a cable the solver refuses is not drawn as made')
    check(tools.drawList(eye, [0, -1, 0]).count >= 16, 'grapple: the cable is drawn as a sagging line')
    tools.destroy()
  }
  {
    // Tennis on the real sports core: serve, bounces, the far side's return.
    const sports = SportsWasm.fromInstance(await fresh())
    const audio = recorder()
    const tools = await createCombatTools(null, 'rgba16float', { sports, combatAudio: audio.proxy, groundAt: () => 0 })
    tools.select('tennis')
    check(tools.tennisClick(eye, [0, 0, 1]) === 'serve', 'tennis: first click sets up a court round the player and serves')
    check(audio.calls.tennisPop?.length === 1 && tools.state().tennis.ballId > 0, 'tennis: serve pops (tennisPop) and a ball is live')
    for (let f = 0; f < 240; f++) tools.update(1 / 60, eye, [0, 0, 1])
    const t = tools.state().tennis
    check(t.bounces >= 1 && audio.calls.tennisBounce?.length >= 1, `tennis: the ball bounces on court (${t.bounces}, tennisBounce)`)
    check(tools.drawList(eye, [0, 0, 1]).count > 8, 'tennis: court lines, net and ball drawn')
    check(t.score !== null, `tennis: score ${t.score?.call}`)
    tools.destroy()
  }

  // ── 3. The WebGPU pass in headless Chrome ──
  const page = await openPage({ size: [640, 360], dpr: 1 })
  await page.route('**/probe-combat-tools', (r) => r.fulfill({ contentType: 'text/html', body: '<!doctype html><html><body></body></html>' }))
  await page.goto(`${url}/probe-combat-tools`)
  const gpu = await page.evaluate(async () => {
    const { shader, camera, NEAR, FAR, DEPTH } = await import('/probe/gpu.ts')
    const { createCombatTools, MeleeWasm } = await import('/page/combat-tools.ts')
    const adapter = await navigator.gpu.requestAdapter()
    const device = await adapter.requestDevice()
    const faults = []
    device.addEventListener('uncapturederror', (e) => faults.push(e.error.message))
    const W = 256, H = 192, FORMAT = 'rgba16float'
    const color = device.createTexture({ size: [W, H], format: FORMAT, usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING })
    const depth = device.createTexture({ size: [W, H], format: DEPTH, usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING })
    const to = { color: color.createView(), depth: depth.createView(), size: [W, H] }
    const wallMod = await shader(device, 'wall', `
struct WallU { wallZ: f32, nearZ: f32, farZ: f32, pad: f32 }
@group(0) @binding(0) var<uniform> w: WallU;
@vertex fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
  let p = vec2f(f32((i << 1u) & 2u), f32(i & 2u));
  return vec4f(p * 2.0 - 1.0, 0.5, 1.0);
}
@fragment fn fs() -> @builtin(frag_depth) f32 {
  return clamp(w.farZ / (w.farZ - w.nearZ) * (1.0 - w.nearZ / max(w.wallZ, w.nearZ)), 0.0, 1.0);
}`)
    const wallPipe = await device.createRenderPipelineAsync({ layout: 'auto', vertex: { module: wallMod, entryPoint: 'vs' }, fragment: { module: wallMod, entryPoint: 'fs', targets: [] }, depthStencil: { format: DEPTH, depthWriteEnabled: true, depthCompare: 'always' } })
    const wallU = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST })
    const wallBG = device.createBindGroup({ layout: wallPipe.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: wallU } }] })
    const readMod = await shader(device, 'read', `
@group(0) @binding(0) var src: texture_2d<f32>;
@group(0) @binding(1) var<storage, read_write> outBuf: array<vec4f>;
@compute @workgroup_size(8, 8) fn main(@builtin(global_invocation_id) g: vec3u) {
  let size = textureDimensions(src);
  if (g.x >= size.x || g.y >= size.y) { return; }
  outBuf[g.y * size.x + g.x] = textureLoad(src, vec2i(g.xy), 0);
}`)
    const readPipe = await device.createComputePipelineAsync({ layout: 'auto', compute: { module: readMod, entryPoint: 'main' } })
    const outBuf = device.createBuffer({ size: W * H * 16, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC })
    const readBG = device.createBindGroup({ layout: readPipe.getBindGroupLayout(0), entries: [{ binding: 0, resource: color.createView() }, { binding: 1, resource: { buffer: outBuf } }] })

    const core = (await WebAssembly.instantiateStreaming(fetch('/page/core.wasm'), {})).instance
    const melee = new MeleeWasm(core)
    melee.reset()
    const tools = await createCombatTools(device, FORMAT, { melee, meleeGround: 'none' })
    const eye = [0, 16, 0], dir = [0, 0, -1]
    const view = camera(eye, [0, 16, -100], 60)

    const frame = async (wallZ, draw) => {
      device.queue.writeBuffer(wallU, 0, new Float32Array([wallZ, NEAR, FAR, 0]))
      const enc = device.createCommandEncoder()
      enc.beginRenderPass({ colorAttachments: [{ view: to.color, loadOp: 'clear', clearValue: [0, 0, 0, 0], storeOp: 'store' }] }).end()
      const wall = enc.beginRenderPass({ colorAttachments: [], depthStencilAttachment: { view: to.depth, depthLoadOp: 'clear', depthClearValue: 1, depthStoreOp: 'store' } })
      wall.setPipeline(wallPipe); wall.setBindGroup(0, wallBG); wall.draw(3); wall.end()
      if (draw) tools.draw(enc, to, view, 0)
      const c = enc.beginComputePass(); c.setPipeline(readPipe); c.setBindGroup(0, readBG); c.dispatchWorkgroups(W / 8, H / 8); c.end()
      const staging = device.createBuffer({ size: W * H * 16, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ })
      enc.copyBufferToBuffer(outBuf, 0, staging, 0, W * H * 16)
      device.queue.submit([enc.finish()])
      await staging.mapAsync(GPUMapMode.READ)
      const px = new Float32Array(staging.getMappedRange().slice(0))
      staging.destroy()
      let lit = 0, peak = 0, bad = 0
      for (let i = 0; i < px.length; i += 4) {
        const l = px[i] + px[i + 1] + px[i + 2]
        if (!Number.isFinite(l) || !Number.isFinite(px[i + 3])) bad++
        else { if (l > 0.02) lit++; peak = Math.max(peak, l) }
      }
      return { lit, peak, bad }
    }

    const idle = await frame(50, true)
    tools.select('saber')
    tools.ignite(true)
    for (let i = 0; i < 30; i++) tools.update(1 / 60, eye, dir)
    const prims = tools.drawList(eye, dir).count
    const before = await frame(50, true)
    const behind = await frame(2, true)
    // Everything at once: a tracer, a laser, sparks, a pending grapple marker.
    const ray = (o, d, max) => ({ pos: [o[0] + d[0] * 40, o[1] + d[1] * 40, o[2] + d[2] * 40], normal: [0, 0, 1], dist: 40, hard: true })
    const busy = await createCombatTools(device, FORMAT, { raycast: ray })
    busy.select('rifle'); busy.fireRifle(eye, [0.05, -0.02, -1])
    busy.select('laser'); busy.fireLaser(eye, [-0.05, 0.03, -1], 1 / 60)
    busy.select('grapple'); busy.grappleClick(eye, [0.1, -0.1, -1])
    busy.update(1 / 120, eye, dir)
    const enc = device.createCommandEncoder()
    busy.draw(enc, to, view, 0)
    device.queue.submit([enc.finish()])
    await device.queue.onSubmittedWorkDone()
    const busyPrims = busy.drawList(eye, dir).count
    tools.destroy(); busy.destroy()
    await device.queue.onSubmittedWorkDone()
    return { idle, before, behind, prims, busyPrims, faults }
  })
  check(gpu.idle.lit === 0 && gpu.idle.bad === 0, `idle draw changes nothing (${gpu.idle.lit} lit pixels)`)
  check(gpu.prims >= 3, `lit saber is ${gpu.prims} primitives`)
  check(gpu.before.lit > 150 && gpu.before.peak > 3, `blade in front of a wall at 5 m lights ${gpu.before.lit} pixels, peak ${gpu.before.peak.toFixed(1)} (HDR)`)
  check(gpu.behind.lit === 0, `blade behind a wall at 0.2 m is hidden (${gpu.behind.lit} lit pixels)`)
  check(gpu.before.bad === 0 && gpu.behind.bad === 0, 'no NaN or Inf in the picture')
  check(gpu.busyPrims > 10, `tracer, laser, sparks and marker drawn (${gpu.busyPrims} primitives)`)
  check(gpu.faults.length === 0, `no GPU faults${gpu.faults.length ? `: ${gpu.faults.join('; ')}` : ''}`)
} catch (e) {
  failures.push(String(e?.stack ?? e))
}

await finish('combat-tools')
