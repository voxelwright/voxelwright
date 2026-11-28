// Run with node engine/test/ragdoll-live.mjs. Exercise the same packed instances submitted to the GPU.
import assert from 'node:assert/strict'
import { read } from '../page/told.ts'
import { figure } from '../page/people.ts'
import { wheels } from '../page/wheels.ts'
import { RagdollLiveController } from '../page/ragdoll-live.ts'
import { BONE, BONE_COUNT, POSE_TAG, RAGDOLL_MODE, packPoseWords } from '../page/ragdoll-bridge.ts'

Object.assign(globalThis, {
  GPUShaderStage: { VERTEX: 1, FRAGMENT: 2 },
  GPUBufferUsage: { VERTEX: 1, COPY_DST: 2, UNIFORM: 4 },
})
const noop = () => ({})
const renderer = await wheels({
  createShaderModule: () => ({ getCompilationInfo: () => ({ messages: [] }) }),
  createBindGroupLayout: noop, createPipelineLayout: noop, createRenderPipelineAsync: noop,
  createBuffer: noop, createBindGroup: noop, queue: { writeBuffer: noop },
}, 'rgba8unorm', {})
const vehicle = {
  id: 21, pos: [0, 0, 0], rot: [0, 0, 0, 1], size: [20, 10, 12], low: [0, 0, 0],
  bornLow: [0, 0, 0], bornCom: [10, 5, 6], front: 0, topSpeed: 80, steerLimit: 0.6,
  feet: [[2, 3, 2], [2, 3, 10], [18, 3, 2], [18, 3, 10]].map(at => ({ at, reach: 5 })),
}
const view = { eye: [0, 0, 50], forward: [0, 0, -1], up: [0, 1, 0], right: [1, 0, 0], tanHalf: 1 }
for (let mask = 0; mask < 16; mask++) {
  for (let panels = 0; panels < 16; panels++) {
    const words = Uint32Array.of(11, 12, 21, 0, 3, 4, 0, 0, 0, 7 | (171 << 8) | (127 << 16) | (mask << 24) | (panels << 28), 0, 0, 0, 0)
    const f = new Float32Array(words.buffer)
    f[3] = 12.5
    f.set([0.75, -0.25, 1], 6)
    f.set([0, 1, 0, 0], 10)
    const [live] = read(words).live
    assert.deepEqual(live, {
      id: 21, speed: 12.5, feet: 3, touches: 4, go: 0.75, turn: -0.25, rise: 1,
      aloft: true, boosting: true, launching: true, boost: 171 / 255, burnout: 127 / 255,
      frame: [0, 1, 0, 0], detachedWheels: mask, detachedPanels: panels,
    })
    vehicle.detachedWheels = live.detachedWheels
    renderer.step(1 / 60, [vehicle], () => 0)
    renderer.prepare({ size: [800, 600] }, view)
    const attached = vehicle.feet.filter((_, i) => !(mask & (1 << i)))
    assert.equal(renderer.count, attached.length)
    renderer.state.get(21).wheels.forEach((w, i) => assert.equal(w.detached, !!(mask & (1 << i))))
  }
}
vehicle.detachedWheels = 0
renderer.step(1 / 60, [vehicle], () => 0)
renderer.prepare({ size: [800, 600] }, view)
assert.equal(renderer.count, 4)
renderer.step(1 / 60, [], () => 0)
assert.equal(renderer.count, 0)

const controller = new RagdollLiveController()
const calls = [], cues = [], settled = []
const npc = 123, feet = [100, 12, 300], impulse = [22, 4, -19]
const mover = {
  async ragdollSpawn(pos) { calls.push(['spawn', pos]); return 17 },
  ragdollHit(...args) { calls.push(['hit', ...args]); return true },
  combatAudio: Object.fromEntries(['bluntHit', 'bladeStab', 'shockwaveBoom'].map(k => [k, opts => cues.push([k, opts])])),
  onSettled(id, pose) { settled.push([id, pose.feetPos]) },
}
const hit = target => controller.onHitOrBlast(npc, feet, impulse, target, mover)
assert.deepEqual(await Promise.all([hit(BONE.ThighR), hit({ bone: BONE.ForearmL, cutEnergy: 7 }), hit({ radius: 8 })]), [true, true, true])
assert.deepEqual(calls, [
  ['spawn', feet], ['hit', 17, BONE.ThighR, impulse, 0], ['hit', 17, BONE.ForearmL, impulse, 7], ['hit', 17, BONE.Chest, impulse, 0],
])
assert.deepEqual(cues, [
  ['bluntHit', { at: feet, material: 'flesh' }], ['bladeStab', { at: feet, material: 'flesh' }], ['shockwaveBoom', { at: feet, radius: 8 }],
])
const bones = Array.from({ length: BONE_COUNT }, (_, i) => [0, 0, Math.sin(i / 24), Math.cos(i / 24)])
function ingest(missingLimbs, mode, id = 17) {
  const row = packPoseWords({ id, bones, pelvisPos: [100, 21.45, 300], missingLimbs, mode })
  controller.ingestPoses(read(Uint32Array.of(POSE_TAG, row.length, ...row)).poses)
  return controller.poseFor(npc)
}

assert.equal(ingest(0, RAGDOLL_MODE.FullRagdoll, 303), undefined)
const pose = ingest(0, RAGDOLL_MODE.FullRagdoll)
assert.equal(pose.limbs.length, 13)
function draw(ragdollPose) {
  const data = new Float32Array(24 * 500)
  const n = figure({ at: feet, yaw: 0, seed: npc, ragdollPose }, data, 0, [0, 0, 0])
  const boxes = []
  for (let i = 0; i < n; i += 24) boxes.push(data.slice(i, i + 24))
  return boxes
}
const close = (a, b) => a.every((v, i) => Math.abs(v - b[i]) < 0.0001)
const oriented = (box, frame) => close(box.slice(8, 11), frame.slice(0, 3)) && close(box.slice(12, 15), frame.slice(3, 6))
const intact = draw(pose)
for (const limb of pose.limbs) assert.ok(intact.some(box => oriented(box, limb.frame)), limb.name)
const severed = ingest(1 << BONE.UpperArmL, RAGDOLL_MODE.GetUp)
assert.equal(severed.missingLimbs, 1 << BONE.UpperArmL)
assert.equal(severed.visibility.segments.handL, false)
const capped = draw(severed)
for (const bone of [BONE.UpperArmL, BONE.ForearmL]) assert.ok(!capped.some(box => oriented(box, severed.limbs[bone].frame)))
const [cap] = severed.stumpCaps
assert.ok(capped.some(box => close(box.slice(0, 3), cap.pos) && oriented(box, cap.frame)))
assert.deepEqual([...controller.detachedFor(npc).keys()], [BONE.UpperArmL])
assert.ok(ingest(1 << BONE.UpperArmL, RAGDOLL_MODE.Locomotion))
assert.equal(ingest(0, RAGDOLL_MODE.Locomotion), undefined)
assert.equal(settled[0][0], npc)
assert.equal(controller.detachedFor(npc), undefined)

const pending = controller.onHitOrBlast(npc, feet, impulse, BONE.Chest, mover)
controller.clear()
assert.equal(await pending, false)
assert.equal(await controller.onHitOrBlast(npc, feet, impulse, BONE.Chest, { ...mover, ragdollSpawn: () => 0 }), false)
assert.equal(await controller.onHitOrBlast(npc, feet, impulse, BONE.Chest, { ...mover, ragdollHit: () => false }), false)
assert.equal(cues.length, 3)
console.log('PASS: 256 LIVE flag combinations, wheel instance counts, shared spawn, impact audio, 13 articulated bones, severed subtree, stump cap, recovery and reset')

// Optional end-to-end solver check after npm --prefix engine run core.
if (process.argv.includes('--wasm')) {
  const { readFile } = await import('node:fs/promises')
  const wasm = await readFile(new URL('../page/core.wasm', import.meta.url))
  const { instance } = await WebAssembly.instantiate(wasm)
  const core = instance.exports, live = new RagdollLiveController()
  assert.ok(await live.onHitOrBlast(npc, [720, 200, 4070], [120, 0, 0], BONE.Chest, {
    ragdollSpawn: feet => core.ragdoll_spawn(...feet),
    ragdollHit: (id, bone, impulse, cut) => !!core.ragdoll_hit(id, bone, ...impulse, cut),
  }))
  const count = core.bodies_advance(1 / 60)
  live.ingestPoses(read(new Uint32Array(core.memory.buffer, core.bodies_words(), count)).poses)
  assert.equal(live.poseFor(npc).limbs.length, 13)
  console.log('PASS: Wasm spawn, hit and bodies_advance produced 13 renderable bones')
}
