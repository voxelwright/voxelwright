// Exercise the released city's first frame and the later reflection handoff without a GPU queue.
import assert from 'node:assert/strict'
import { mock } from 'node:test'
import { marcher, MIRRORS } from '../page/march.ts'

for (const name of ['GPUTextureUsage', 'GPUShaderStage', 'GPUBufferUsage']) globalThis[name] = {}

const empty = () => ({})
const world = { options: { grid: [8, 8, 8] }, levels: [] }
const view = { eye: [0, 0, 0], up: [0, 1, 0], right: [1, 0, 0], forward: [0, 0, 1], tanHalf: 1 }
const pipeline = (label) => ({ label, getBindGroupLayout: empty })
for (const outcome of ['ready', 'failed', 'reshaded']) {
  const pending = Promise.withResolvers()
  let drawing = false, requests = 0
  const device = {
    createShaderModule: () => ({ getCompilationInfo: () => ({ messages: [] }) }),
    createRenderPipelineAsync({ label }) {
      if (label === 'march') {
        assert.ok(drawing, 'the first city frame waits for reflections')
        if (++requests === 1) return pending.promise
        return Promise.resolve(pipeline('reshaded mirrors'))
      }
      return Promise.resolve(pipeline(label))
    },
    createTexture: () => ({ createView: empty }), createPipelineLayout: empty,
    createBindGroupLayout: empty, createBuffer: empty, createBindGroup: empty, queue: { writeBuffer() {} },
  }
  const scene = await marcher(device, 'rgba8unorm', world, false, true)
  let last
  const encoder = {
    beginRenderPass({ colorAttachments }) {
      return {
        setPipeline(p) { last = [p.label, colorAttachments.length] },
        setBindGroup() {}, draw() {}, end() {},
      }
    },
  }
  drawing = true
  const draw = () => scene.draw(encoder, { size: [16, 16] }, view, MIRRORS, 0)
  draw()
  draw()
  assert.equal(requests, 1)
  assert.equal(scene.glassReady, false)
  assert.deepEqual(last, ['march without mirrors', 1])
  if (outcome === 'reshaded') await scene.reshade(source => source)
  if (outcome === 'failed') {
    const logged = mock.method(console, 'error', () => {})
    pending.reject(new Error('test compilation failure'))
    await Promise.resolve()
    logged.mock.restore()
    assert.equal(logged.mock.callCount(), 1)
  } else {
    pending.resolve(pipeline('original mirrors'))
    await Promise.resolve()
  }
  draw()
  assert.equal(scene.glassReady, outcome !== 'failed')
  const expected = { ready: ['original mirrors', 2], failed: ['march without mirrors', 1], reshaded: ['reshaded mirrors', 2] }
  assert.deepEqual(last, expected[outcome])
}
console.log('Released city draws during compilation and switches to the requested glass pipeline')
