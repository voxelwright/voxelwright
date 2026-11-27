// #37. Run: cd engine && node test/deform.mjs. No server, model, or software GPU.
// Linux requires AMD RDNA 3; Mac accepts its hardware adapter. GPU timings describe
// this explicit mesh/workload, not a complete game frame or arbitrary vertex counts.
import assert from 'node:assert/strict'
import { writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium } from 'playwright'
import { VehicleDeformation, MAX_DENTS, DEFORM_BYTES, DEFORM_STRUCT, DEFORM_WGSL, packDeformUniforms, deformPointCpu, recordImpact, repairVehicle, clearVehicle, getVehicleDamage } from '../page/deform.ts'

const near = (a, b, tolerance = 1e-5) => assert.ok(Math.abs(a - b) <= tolerance, `${a} != ${b} (+/- ${tolerance})`)
const vector = (a, b, tolerance) => a.forEach((v, i) => near(v, b[i], tolerance))
const body = { pos: [0, 0, 0], rot: [0, 0, 0, 1], cell: 1, born: { com: [0, 0, 0], size: [80, 24, 40] }, front: 0 }
const cabin = { min: [20, 8, 8], max: [45, 32, 32] }
const hood = [68, 15, 20], normal = [0, 1, 0]
const tracker = new VehicleDeformation()
assert.equal(tracker.recordImpact(1, body, hood, normal, 17.99, 1e9, cabin), undefined)
const state = tracker.recordImpact(1, body, hood, normal, 65, 8000, cabin)
assert.equal(state.dentCount, 1)
vector([...state.dents[0].center], hood)
vector([...state.dents[0].dir], [0, -1, 0])
const beforeDepth = state.dents[0].depth, beforeRadius = state.dents[0].radius
assert.equal(tracker.recordImpact(1, body, [69, 15, 20], normal, 65, 8000, cabin), state)
assert.equal(state.dentCount, 1)
assert.ok(state.dents[0].depth > beforeDepth && state.dents[0].radius >= beforeRadius)

// Independent quaternion forward rotation, nonzero COM/translation, fine cell scale,
// all rotation components and non-unit input quaternion (normalization is deliberate).
function rotate(q, p) {
  const norm = Math.hypot(...q), [x, y, z, w] = q.map(v => v / norm)
  return [
    (1 - 2*y*y - 2*z*z)*p[0] + (2*x*y - 2*z*w)*p[1] + (2*x*z + 2*y*w)*p[2],
    (2*x*y + 2*z*w)*p[0] + (1 - 2*x*x - 2*z*z)*p[1] + (2*y*z - 2*x*w)*p[2],
    (2*x*z - 2*y*w)*p[0] + (2*y*z + 2*x*w)*p[1] + (1 - 2*x*x - 2*y*y)*p[2],
  ]
}
for (const cell of [1, 0.25, 0.0625]) {
  const b = { ...body, pos: [53123, 48, -120], rot: [0.3, -0.7, 0.2, 0.6], cell, born: { ...body.born, com: [31, 9, 13] } }
  const hit = rotate(b.rot, hood.map((v, a) => (v - b.born.com[a]) * cell)).map((v, a) => v + b.pos[a])
  const s = tracker.recordImpact(10 + cell * 16, b, hit, rotate(b.rot, normal), 70, 12000, cabin)
  vector([...s.dents[0].center], hood, 1e-8)
  vector([...s.dents[0].dir], [0, -1, 0], 1e-12)
}
// Physical size/depth do not change with fine-cell resolution.
let physicalDepth
for (const cell of [1, 0.25, 0.0625]) {
  const b = { ...body, cell, born: { com: [0, 0, 0], size: body.born.size.map(v => v / cell) } }
  const box = { min: cabin.min.map(v => v / cell), max: cabin.max.map(v => v / cell) }
  const s = tracker.recordImpact(100 + cell * 16, b, hood, normal, 65, 8000, box)
  physicalDepth ??= s.dents[0].depth * cell
  near(s.dents[0].depth * cell, physicalDepth)
}
const snapshot = JSON.stringify(state)
for (const args of [
  [body, hood, normal, NaN, 1, cabin], [body, hood, normal, 80, -1, cabin],
  [{ ...body, cell: 0 }, hood, normal, 80, 1, cabin], [body, [NaN, 0, 0], normal, 80, 1, cabin],
  [body, hood, [0, 0, 0], 80, 1, cabin], [{ ...body, rot: [0, 0, 0, 0] }, hood, normal, 80, 1, cabin],
  [body, hood, normal, 80, 1, { min: [2, 0, 0], max: [1, 1, 1] }],
]) { assert.equal(tracker.recordImpact(1, ...args), state); assert.equal(JSON.stringify(state), snapshot) }

// Severity curves, progressive saturation, all four front axes and window zones.
const depths = [], health = [], hoods = [], glass = []
for (const speed of [25, 40, 65, 100, 150]) {
  const s = tracker.recordImpact(200 + speed, body, hood, normal, speed, 8000, cabin)
  depths.push(s.dents[0].depth); health.push(1 - s.health); hoods.push(s.hoodDamage); glass.push(Math.max(...s.glassCrack))
}
for (const list of [depths, health, hoods, glass]) for (let i = 1; i < list.length; i++) assert.ok(list[i] >= list[i-1])
assert.ok(depths[4] > depths[1] * 2 && glass[0] === 0 && glass[4] > 0)
for (let front = 0; front < 4; front++) {
  const axis = front < 2 ? 0 : 2, sign = front % 2 === 0 ? 1 : -1
  const p = [40, 20, 20]; p[axis] = sign > 0 ? body.born.size[axis] : 0
  const s = tracker.recordImpact(400 + front, { ...body, front }, p, normal, 150, 8000, cabin)
  assert.ok(s.hoodDamage > 0 && s.glassCrack[0] > 0)
  const rear = [...p]; rear[axis] = sign > 0 ? 0 : body.born.size[axis]
  const r = tracker.recordImpact(410 + front, { ...body, front }, rear, normal, 150, 8000, cabin)
  assert.equal(r.hoodDamage, 0); assert.ok(r.glassCrack[1] > 0)
}
for (const [id, z, zone] of [[420, 0, 2], [421, 40, 3]]) {
  const s = tracker.recordImpact(id, body, [40, 20, z], normal, 150, 8000, cabin)
  assert.ok(s.glassCrack[zone] > 0)
}
for (let i = 0; i < 200; i++) tracker.recordImpact(1, body, hood, normal, 150, 1e6, cabin)
assert.equal(state.health, 0); assert.equal(state.hoodDamage, 1); assert.equal(state.scuff, 1)
assert.equal(state.glassCrack[0], 1)

// Six distinct slots; the seventh replaces the shallowest, never grows the allocation.
const roomy = { ...body, born: { com: [0, 0, 0], size: [400, 100, 100] } }
const remoteCabin = { min: [150, 50, 30], max: [250, 120, 70] }
for (let i = 0; i < 6; i++) tracker.recordImpact(500, roomy, [i * 50, 10, 0], normal, 25 + i * 10, 8000, remoteCabin)
const six = tracker.get(500), slots = six.dents
assert.equal(six.dentCount, MAX_DENTS)
tracker.recordImpact(500, roomy, [390, 10, 0], normal, 90, 8000, remoteCabin)
assert.equal(six.dents, slots); assert.equal(six.dentCount, 6); near(six.dents[0].center[0], 390)

const distBox = (p, box) => Math.hypot(...p.map((v, a) => Math.max(box[a] - v, 0, v - box[a+3])))
function safe(s) {
  let total = 0
  for (let i = 0; i < s.dentCount; i++) {
    const d = s.dents[i], distance = distBox([...d.center], s.cabin)
    if (d.depth > 0) assert.ok(d.radius + 1.18 * d.depth <= distance + 1e-8)
    assert.ok(d.depth <= d.radius * 0.2 + 1e-10)
    total += d.depth
  }
  // Independent graph traversal of swept supports: each connected component
  // (not the whole car) must fit the displacement budget.
  const seen = new Set()
  for (let i = 0; i < s.dentCount; i++) {
    if (seen.has(i)) continue
    const group = [i]; seen.add(i); total = 0
    for (const a of group) {
      const d = s.dents[a]; total += d.depth
      for (let b = 0; b < s.dentCount; b++) {
        const e = s.dents[b]
        if (!seen.has(b) && d.depth > 0 && e.depth > 0 && Math.hypot(...d.center.map((v,k) => v-e.center[k])) < d.radius + e.radius + 1.18*(d.depth+e.depth)) { seen.add(b); group.push(b) }
      }
    }
    assert.ok(total * 1.18 <= s.maxCrushCells + 1e-8)
  }
}
for (let i = 0; i < 120; i++) {
  tracker.recordImpact(600, body, [i % 3 === 0 ? 19 : 46, 7 + i % 27, 7 + i % 26], [i % 3 === 0 ? -1 : 1, 0, 0], 200, 1e6, cabin)
  safe(tracker.get(600))
}
const protectedState = tracker.get(600)
tracker.recordImpact(600, body, [30, 18, 20], normal, 200, 1e6, cabin)
safe(protectedState)
assert.ok(protectedState.dents.some(d => d.radius > 0 && d.depth === 0))
// Expanding protection and lowering the total budget must re-clamp existing dents.
tracker.recordImpact(500, { ...roomy, maxCrushCells: 0.1 }, [390, 10, 0], normal, 100, 8000, { min: [0, 11, 0], max: [400, 120, 100] })
safe(six)
// Regression: severe, disjoint corner impacts must all remain visible.
for (const hit of [[0,0,0],[80,0,0],[0,0,40],[80,0,40]]) tracker.recordImpact(640, body, hit, normal, 150, 1e6, cabin)
const disconnected = tracker.get(640)
assert.equal(disconnected.dentCount, 4)
assert.ok(disconnected.dents.slice(0,4).every(d => d.depth > 2))
safe(disconnected)
// Regression: current fine car windshield inside fallback protection still cracks.
const windshield = tracker.recordImpact(645, { ...body, cell: 0.25, born: { com: [0,0,0], size: [168,52,72] } }, [27,8.75,9], normal, 150, 1e6)
assert.equal(windshield.dents[0].depth, 0); assert.ok(windshield.dents[0].radius > 0)
assert.ok(Math.max(...windshield.glassCrack) > 0)
const fallback = tracker.recordImpact(650, body, [40, 15, 20], normal, 150, 8000)
assert.equal(fallback.dents[0].depth, 0)

assert.equal(DEFORM_BYTES, 208)
const packed = new Float32Array(60).fill(-17)
packDeformUniforms(state, packed, 4)
assert.ok(packed.slice(0, 4).every(v => v === -17) && packed.slice(56).every(v => v === -17))
near(packed[4], state.dentCount); near(packed[5], state.health); near(packed[6], state.hoodDamage); near(packed[7], Math.max(...state.glassCrack))
for (let i = 0; i < 6; i++) {
  const d = state.dents[i], active = i < state.dentCount
  vector([...packed.slice(8 + i*4, 12 + i*4)], active ? [...d.center, d.radius] : [0,0,0,0])
  vector([...packed.slice(32 + i*4, 36 + i*4)], active ? [...d.dir, d.depth] : [0,0,0,0])
}
assert.throws(() => packDeformUniforms(state, packed, 1), RangeError)
assert.throws(() => packDeformUniforms(state, new Float32Array(51)), RangeError)
assert.throws(() => packDeformUniforms(state, new Float32Array(new ArrayBuffer(240), 4, 52)), RangeError)
packDeformUniforms(undefined, packed, 4); assert.ok(packed.slice(4, 56).every(v => v === 0))
recordImpact(999, body, hood, normal, 80, 8000, cabin)
const repaired = getVehicleDamage(999), refs = repaired.dents
repairVehicle(999); assert.equal(getVehicleDamage(999), repaired); assert.equal(repaired.dents, refs)
assert.equal(repaired.health, 1); assert.equal(repaired.dentCount, 0)
packDeformUniforms(repaired, packed, 4); assert.ok(packed.slice(4, 56).every(v => v === 0))
clearVehicle(999); assert.equal(getVehicleDamage(999), undefined)

// Independent position-only oracle; normals below come from finite differences,
// NOT a copy of the shader's analytical derivative.
function position(p, s) {
  const q = [...p]
  if (!s) return q
  for (let i = 0; i < s.dentCount; i++) {
    const d = s.dents[i], r = Math.hypot(...q.map((v, a) => v - d.center[a]))
    if (d.radius <= 0.0001 || r >= d.radius || d.depth <= 0) continue
    const [dx, dy, dz] = d.dir
    const envelope = (r) => Math.max(0, 1 - (r / d.radius) ** 2) ** 2
    const side = [dz, 0, -dx], up = [-dy*dx, 1-dy*dy, -dy*dz]
    const relative = () => q.map((v,i) => (v-d.center[i])/d.radius)
    const project = (v, axis) => v.reduce((sum, x, i) => sum + x*axis[i], 0)
    const smooth = x => { const t = Math.max(0, Math.min(1, x)); return t*t*(3-2*t) }
    let v = relative()
    const ridge = 1 - smooth(Math.abs(3.7*project(v, side) + 1.85*project(v, up) - 0.89) / 0.89)
    const inward = d.depth * (1-0.1*up[1]) * envelope(r) * (1-0.66*up[1]*ridge)
    for (let i = 0; i < 3; i++) q[i] += d.dir[i]*inward
    v = relative()
    const seam = 1 - smooth(Math.abs(3.4*project(v, side) + 2.25*project(v, d.dir) - 0.65))
    const top = smooth((project(v, up) + 0.45)/0.72)
    const drop = 0.42 * d.depth * Math.max(0, 1-project(v,v))**2 * seam * top
    for (let i = 0; i < 3; i++) q[i] -= up[i]*drop

  }
  return q
}
function numericalNormal(p, s) {
  const e = 0.0001, tangents = [0, 2].map(axis => {
    const a = [...p], b = [...p]; a[axis] += e; b[axis] -= e
    const x = position(a, s), y = position(b, s)
    return x.map((v, i) => (v - y[i]) / (2 * e))
  })
  const [a, b] = tangents, n = [b[1]*a[2]-b[2]*a[1], b[2]*a[0]-b[0]*a[2], b[0]*a[1]-b[1]*a[0]], len = Math.hypot(...n)
  return n.map(v => v / len)
}
// A six-zone overlapping hood, and the cabin torture case, packed through the public API.
for (let i = 0; i < 6; i++) tracker.recordImpact(700, body, [57 + (i%3)*8, 15, 14 + Math.floor(i/3)*12], normal, 55, 8000, cabin)
const multi = tracker.get(700)
assert.equal(multi.dentCount, 6); safe(multi)
// A side strike must gather metal into a ridge. Measure the volume change as well as
// the travel and normals. A positive determinant means neighbours stay in order.
const side = tracker.recordImpact(705, body, hood, [1, 0, 0], 150, 10000, cabin)
let lowest = 0, highest = 0, minVolume = Infinity
const dent = side.dents[0]
for (let x = -6; x <= 6; x++) for (let y = -6; y <= 6; y++) for (let z = -6; z <= 6; z++) {
  const p = [x,y,z].map((v,i) => dent.center[i] + v * dent.radius / 6)
  const q = deformPointCpu(p, [0,1,0], side).pos
  lowest = Math.min(lowest, q[1]-p[1]); highest = Math.max(highest, q[1]-p[1])
  assert.ok(Math.hypot(...q.map((v,i) => v-p[i])) <= dent.depth + 1e-6)
  const [a,b,c] = [0,1,2].map(axis => {
    const ahead = [...p]; ahead[axis] += 0.0001
    return deformPointCpu(ahead, [0,1,0], side).pos.map((v,i) => (v-q[i]) / 0.0001)
  })
  minVolume = Math.min(minVolume, a[0]*(b[1]*c[2]-b[2]*c[1]) + a[1]*(b[2]*c[0]-b[0]*c[2]) + a[2]*(b[0]*c[1]-b[1]*c[0]))
}
assert.ok(lowest < -0.32 * dent.depth && highest <= 1e-6 && minVolume > 0, 'the hood folds down below the sightline and the skin stays in order')
// The grille used to stretch downward and open wider under a horizontal blow.
const gapAt = (y) => {
  const p = [dent.center[0], dent.center[1] + y*dent.radius, dent.center[2]]
  return deformPointCpu(p, [1,0,0], side).pos[1] - p[1]
}
assert.ok(gapAt(0.16) < gapAt(-0.28) - 0.12*dent.depth, 'a struck grille pinches closed across its upper and lower edges')
const states = [undefined, state, multi, protectedState, windshield, side]
const uniforms = new Float32Array(52 * 64)
for (let i = 0; i < 64; i++) packDeformUniforms(states[i % states.length], uniforms, i * 52)
const vertices = [], expected = []
for (const vehicle of [0,1,2,3,5]) {
  for (let z = 0; z <= 32; z++) for (let x = 0; x <= 32; x++) {
    const p = [48 + x, 15, 4 + z]
    vertices.push(...p, vehicle); expected.push({ p, s: states[vehicle] })
  }
}
// Points inside and just outside all six faces of the survival box.
for (let y = 8; y <= 32; y += 2) for (let z = 8; z <= 32; z += 2) for (const x of [19.999, 20, 30, 45, 45.001]) {
  const p = [x, y, z]; vertices.push(...p, 3); expected.push({ p, s: protectedState })
}
// Sample a 1.2 m painted patch across a single hit, finely enough to resolve its gouges.
const swatchStart = expected.length
for (let j = -10; j <= 10; j++) for (let i = -30; i <= 30; i++) {
  const p = [hood[0]+i*0.2, hood[1], hood[2]+j*0.15]
  vertices.push(...p, 1); expected.push({p,s:state})
}
const swatchEnd = expected.length
const benchStates = new Float32Array(64 * 52)
for (let i = 0; i < 64; i++) packDeformUniforms(multi, benchStates, i * 52)
vertices.push(108,35,36,4); expected.push({ p: [108,35,36], s: windshield })
// Warm and measure pack-only CPU work, reusing both state and output arrays.
const samples = []
for (let batch = 0; batch < 25; batch++) {
  const start = performance.now()
  for (let repeat = 0; repeat < 100; repeat++) for (let i = 0; i < 64; i++) packDeformUniforms(multi, benchStates, i * 52)
  if (batch >= 5) samples.push((performance.now() - start) / 100)
}
samples.sort((a,b) => a-b)
const cpuPackMs = samples[Math.floor(samples.length / 2)]
// CPU deformPointCpu matches the position oracle & finite-difference normal for all six overlapping dents (#61).
for (const p of [[57, 15, 14], [65, 15, 22], [72, 15, 28], [20, 18, 20]]) {
  const got = deformPointCpu(p, [0, 1, 0], multi)
  vector(got.pos, position(p, multi), 1e-6)
  vector(got.norm, numericalNormal(p, multi), 1e-3)
}
const healthyCpu = deformPointCpu([60, 15, 20], [0, 1, 0], undefined)
vector(healthyCpu.pos, [60, 15, 20], 0); vector(healthyCpu.norm, [0, 1, 0], 0)
console.log('CPU: transforms, merging/replacement, survival box, damage curves, repair, malformed input, 208-byte layout, deformPointCpu PASS')

const linux = process.platform === 'linux'
const browser = await chromium.launch({ headless: true, ...(process.platform === 'darwin' ? { channel: 'chrome' } : {}), args: linux ? ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-angle=vulkan', '--ignore-gpu-blocklist'] : ['--enable-unsafe-webgpu', '--use-angle=metal'] })
try {
  const page = await browser.newPage({ viewport: { width: 1000, height: 500 } })
  // Route a localhost secure context in memory; no listening socket or server process.
  await page.route('http://localhost/**', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><canvas width="1000" height="500"></canvas>' }))
  await page.goto('http://localhost/deform')
  const gpu = await page.evaluate(async ({ source, uniforms, vertices, benchStates, linux }) => {
    const check = (ok, message) => { if (!ok) throw Error(message) }
    const adapter = await navigator.gpu?.requestAdapter({ powerPreference: 'high-performance' })
    check(adapter, 'WebGPU hardware adapter unavailable')
    const info = { vendor: adapter.info.vendor, architecture: adapter.info.architecture, description: adapter.info.description }
    check(!adapter.info.isFallbackAdapter && !/swiftshader|llvmpipe|software/i.test(JSON.stringify(info)), 'Software adapter is not a GPU proof')
    if (linux) check(info.vendor === 'amd' && /rdna-3/i.test(info.architecture), `Expected Ally AMD RDNA 3: ${JSON.stringify(info)}`)
    check(adapter.features.has('timestamp-query'), 'Hardware GPU timestamps required for this benchmark')
    const device = await adapter.requestDevice({ requiredFeatures: ['timestamp-query'] })
    const uncaptured = []; device.addEventListener('uncapturederror', e => uncaptured.push(e.error.message))
    device.pushErrorScope('validation')
    const module = device.createShaderModule({ code: source + `
struct Fleet { cars: array<Deform, 64> }
@group(0) @binding(0) var<uniform> fleet: Fleet;
@group(0) @binding(1) var<storage, read> points: array<vec4f>;
struct Answer { pos: vec4f, norm: vec4f, damage: vec4f, paint: vec4f }
@group(0) @binding(2) var<storage, read_write> answers: array<Answer>;
@compute @workgroup_size(64) fn main(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x; if (i >= arrayLength(&points)) { return; }
  let p = points[i]; let def = fleet.cars[u32(p.w)];
  let d = deformPoint(p.xyz, vec3f(0.0, 1.0, 0.0), def);
  let paint = deformPaint(vec3f(0.7, 0.12, 0.04), d.scuff, d.crease, (p.xyz-def.posR[0].xyz).xzy);
  answers[i] = Answer(vec4f(d.pos, 1.0), vec4f(d.norm, deformLamp(d.scuff)), vec4f(d.scuff, d.crease, paint.roughBoost, paint.clearcoatKeep), vec4f(paint.albedo, deformGlass(def.status.w, d.scuff, p.xyz - def.posR[0].xyz)));
}
@compute @workgroup_size(64) fn base(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x; if (i >= arrayLength(&points)) { return; }
  answers[i] = Answer(vec4f(points[i].xyz, 1.0), vec4f(0.0,1.0,0.0,0.0), vec4f(0.0,0.0,0.0,1.0), vec4f(0.7,0.12,0.04,0.0));
}
struct ViewOut { @builtin(position) clip: vec4f, @location(0) p: vec3f, @location(1) norm: vec3f, @location(2) damage: vec2f }
@vertex fn vs(@builtin(vertex_index) i: u32, @builtin(instance_index) car: u32) -> ViewOut {
  let corners = array<vec2f, 6>(vec2f(0,0),vec2f(1,0),vec2f(0,1),vec2f(0,1),vec2f(1,0),vec2f(1,1));
  let tile = i / 6u; let uv = (vec2f(f32(tile % 64u), f32(tile / 64u)) + corners[i % 6u]) / 64.0;
  let p = vec3f(48.0 + uv.x * 32.0, 15.0, 4.0 + uv.y * 32.0);
  let d = deformPoint(p, vec3f(0,1,0), fleet.cars[car]);
  let clip = vec4f((uv.x - 0.5)*0.84 + select(-0.5,0.5,car == 1u), (uv.y-0.5)*1.5 + (d.pos.y-15.0)*0.025, 0.0, 1.0);
  return ViewOut(clip, p, d.norm, vec2f(d.scuff,d.crease));
}
@fragment fn fs(v: ViewOut) -> @location(0) vec4f {
  let paint = deformPaint(vec3f(0.7,0.12,0.04),v.damage.x,v.damage.y,v.p);
  let light = normalize(vec3f(0.4,1.0,0.5));
  let spec = pow(max(dot(v.norm,normalize(vec3f(0.25,1.0,0.1))),0.0),64.0)*paint.clearcoatKeep;
  return vec4f(paint.albedo*(0.2+0.65*max(dot(v.norm,light),0.0))+vec3f(spec*0.7),1.0);
}
` })
    const errors = (await module.getCompilationInfo()).messages.filter(m => m.type === 'error')
    check(errors.length === 0, errors.map(m => `${m.lineNum}: ${m.message}`).join('\n'))
    const layout = device.createBindGroupLayout({ entries: [
      { binding: 0, visibility: GPUShaderStage.COMPUTE | GPUShaderStage.VERTEX, buffer: { type: 'uniform' } },
      { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
      { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
    ] })
    const pipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [layout] })
    const pipelines = await Promise.all(['base', 'main'].map(entryPoint => device.createComputePipelineAsync({ layout: pipelineLayout, compute: { module, entryPoint } })))
    const render = await device.createRenderPipelineAsync({ layout: pipelineLayout, vertex: { module, entryPoint: 'vs' }, fragment: { module, entryPoint: 'fs', targets: [{ format: 'rgba8unorm' }] } })
    const buffer = (size, usage, data) => { const b = device.createBuffer({ size, usage }); if (data) device.queue.writeBuffer(b, 0, data); return b }
    const make = (u, v) => {
      const uniform = buffer(u.byteLength, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST, u)
      const input = buffer(v.byteLength, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST, v)
      const output = buffer(v.length / 4 * 64, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC)
      const bind = device.createBindGroup({ layout, entries: [uniform, input, output].map((b, binding) => ({ binding, resource: { buffer: b } })) })
      return { uniform, input, output, bind, count: v.length / 4 }
    }
    const numeric = make(new Float32Array(uniforms), new Float32Array(vertices))
    const read = buffer(numeric.count * 64, GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ)
    const encoder = device.createCommandEncoder(), pass = encoder.beginComputePass()
    pass.setPipeline(pipelines[1]); pass.setBindGroup(0, numeric.bind); pass.dispatchWorkgroups(Math.ceil(numeric.count / 64)); pass.end()
    encoder.copyBufferToBuffer(numeric.output, 0, read, 0, read.size)
    device.queue.submit([encoder.finish()]); await read.mapAsync(GPUMapMode.READ)
    const values = Array.from(new Float32Array(read.getMappedRange())); read.unmap()
    // Real render proof, read back via the canvas PNG after drawing.
    const canvas = document.querySelector('canvas'), context = canvas.getContext('webgpu')
    context.configure({ device, format: 'rgba8unorm', alphaMode: 'opaque' })
    const drawing = device.createCommandEncoder(), rp = drawing.beginRenderPass({ colorAttachments: [{ view: context.getCurrentTexture().createView(), loadOp: 'clear', storeOp: 'store', clearValue: [0.025,0.03,0.045,1] }] })
    rp.setPipeline(render); rp.setBindGroup(0, numeric.bind); rp.draw(64*64*6, 2); rp.end(); device.queue.submit([drawing.finish()]); await device.queue.onSubmittedWorkDone()
    const png = canvas.toDataURL('image/png')
    const timings = []
    const median = xs => [...xs].sort((a,b) => a-b)[Math.floor(xs.length/2)]
    // 64 vehicles, 289 hood vertices each, all six dents active. Separate timed
    // passes, alternating baseline/damaged, 8 warm pairs + 24 measured pairs.
    const v = new Float32Array(64 * 17 * 17 * 4)
    let at = 0
    for (let car = 0; car < 64; car++) for (let z = 0; z <= 16; z++) for (let x = 0; x <= 16; x++) { v[at++] = 48+x*2; v[at++] = 15; v[at++] = 4+z*2; v[at++] = car }
    const bench = make(new Float32Array(benchStates), v)
    const queries = device.createQuerySet({ type: 'timestamp', count: 128 })
    const resolved = buffer(128*8, GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC)
    const stamps = buffer(128*8, GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ)
    const enc = device.createCommandEncoder(), start = performance.now()
    for (let i = 0; i < 64; i++) {
      const cp = enc.beginComputePass({ timestampWrites: { querySet: queries, beginningOfPassWriteIndex: i*2, endOfPassWriteIndex: i*2+1 } })
      cp.setPipeline(pipelines[i%2]); cp.setBindGroup(0, bench.bind); cp.dispatchWorkgroups(Math.ceil(bench.count/64)); cp.end()
    }
    enc.resolveQuerySet(queries, 0, 128, resolved, 0); enc.copyBufferToBuffer(resolved, 0, stamps, 0, stamps.size)
    const encodingMs = (performance.now()-start)/64
    device.queue.submit([enc.finish()]); await stamps.mapAsync(GPUMapMode.READ)
    const ts = new BigUint64Array(stamps.getMappedRange())
    for (let i = 16; i < 64; i++) timings.push(Number(ts[i*2+1]-ts[i*2])/1e6)
    stamps.unmap()
    const base = timings.filter((_,i) => i%2 === 0), damaged = timings.filter((_,i) => i%2 === 1)
    const validation = await device.popErrorScope()
    check(!validation, validation?.message); check(!uncaptured.length, uncaptured.join('\n'))
    const report = { info, values, png, verticesPerVehicle: 289, vehicles: 64, dentsPerVehicle: 6, gpuBaseMs: median(base), gpuDamagedMs: median(damaged), gpuIncrementMs: median(damaged.map((v,i) => v-base[i])), cpuEncodingMs: encodingMs, validationErrors: 0 }
    device.destroy()
    return report
  }, { source: DEFORM_STRUCT + DEFORM_WGSL, uniforms: [...uniforms], vertices, benchStates: [...benchStates], linux })
  let changed = 0, tilted = 0, scuffed = 0, cracked = 0
  for (let i = 0; i < expected.length; i++) {
    const { p, s } = expected[i], row = gpu.values.slice(i*16, i*16+16), want = position(p, s)
    assert.ok(row.every(Number.isFinite), `finite GPU output ${i}`)
    vector(row.slice(0,3), want, 2e-5)
    vector(row.slice(4,7), numericalNormal(p, s), 2e-4)
    near(Math.hypot(...row.slice(4,7)), 1, 1e-5)
    const distance = Math.hypot(...want.map((v,a) => v-p[a]))
    const affected = s && s.dents.slice(0,s.dentCount).some(d => d.radius > 0.0001 && Math.hypot(...p.map((v,a) => v-d.center[a])) < d.radius)
    if (!affected) { vector(row.slice(0,3), p.map(Math.fround), 0); near(row[8], 0); near(row[9], 0); near(row[10], 0); near(row[11], 1); near(row[15], 0) }
    else {
      changed++; if ((s === state || s === multi) && distance > 1e-5) assert.ok(row[1] < p[1]); assert.ok(distance <= s.maxCrushCells + 1e-5)
      if (Math.abs(row[4]) + Math.abs(row[6]) > 0.03) tilted++
      assert.ok(row[8] > 0 && row[9] > 0 && row[10] > 0 && row[11] <= 1); scuffed++
      if (row[15] > 0) cracked++
      if (row[8] > 0.35 && row[8] < 0.55) assert.equal(row[7], 0, 'a lamp beside the impact keeps its light')
      if (row[8] > 0.92) assert.equal(row[7], 1, 'a directly crushed lamp goes dark')
      if (distance > 0) assert.ok(distBox(want, s.cabin) > 0, 'deformed metal stays outside cabin')
    }
    for (const j of [8,9,10,11,15]) assert.ok(row[j] >= 0 && row[j] <= 1)
  }
  let marked = 0, outsideContact = 0
  for (let i = swatchStart; i < swatchEnd; i++) {
    if (Math.abs(gpu.values[i*16+12]-0.7) < 0.05) continue
    marked++
    const p = expected[i].p
    if (Math.abs(p[0]-hood[0]) > 4.0 || Math.abs(p[2]-hood[2]) > 1) outsideContact++
  }
  const coverage = marked / (swatchEnd-swatchStart)
  console.log(`Paint swatch: ${(coverage*100).toFixed(1)}% marked, ${outsideContact} marks outside the contact strip`)
  assert.ok(coverage > 0.015 && coverage < 0.25 && outsideContact === 0, 'a scrape has a visible core and finite tips')
  const windowRow = gpu.values.slice(-16)
  vector(windowRow.slice(0,3), [108,35,36], 0); assert.ok(windowRow[8] > 0 && windowRow[15] > 0, 'protected windshield still scuffs/cracks')
  assert.ok(changed > 300 && tilted > 100 && scuffed > 300 && cracked > 100)
  const centerIndex = expected.findIndex(({p,s}) => s === state && p.every((v,a) => v === hood[a]))
  near(gpu.values[centerIndex*16+1], hood[1] - state.dents[0].depth, 1e-5)
  const artifact = join(tmpdir(), 'voxelwright-deform')
  await mkdir(artifact, { recursive: true })
  await writeFile(join(artifact, 'hood.png'), Buffer.from(gpu.png.split(',')[1], 'base64'))
  const { values, png, ...timing } = gpu
  const report = { ...timing, cpuPackMs, overheadMs: gpu.gpuIncrementMs + cpuPackMs + gpu.cpuEncodingMs, changed, tilted, scuffed, cracked }
  await writeFile(join(artifact, 'report.json'), JSON.stringify(report, null, 2)+'\n')
  console.log('GPU: compute + render compilation, validation scopes, position/finite-difference normals, scuff/crease/glass, cabin protection PASS')
  console.log(JSON.stringify(report, null, 2))
  console.log(`Hood render (undamaged left, dented right): ${join(artifact, 'hood.png')}`)
  // By the GPU's own clock only, and far from what it costs (about 0.05 ms on the M1 Pro): the CPU's wall clock and a
  // GPU other checks share moved the sum by ten times between runs. This catches a shader gone badly wrong.
  assert.ok(report.gpuIncrementMs < 0.5, `64 vehicles' dents cost ${report.gpuIncrementMs.toFixed(4)} ms of the GPU, more than 0.5 ms; see the workload above`)
} finally { await browser.close() }
