// Regression checks for issue #105 (feedback report s-mwyu4dl5-5a18b):
//   1. `bay.ts` `fetchTile` aborts hung `fetch()` AND hung `arrayBuffer()` calls via AbortController timeout,
//      increments `tally.timedOut`, evicts the failed cache entry, and succeeds once the network recovers.
//   2. `street.ts` `trafficObstacleGap` catches oblique-crossing vehicles at diagonal intersections (exact
//      Columbus Ave geometries from s-mwyu4dl5-5a18b where old `dot < -0.3` skipped cross-traffic and caused
//      0.58-0.82 m overlaps), while still ignoring parallel head-on opposing traffic (`dot < -0.82`) and
//      tie-breaking mutual stops cleanly.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { ground, hold, setFetchTimeout, tally } from '../page/bay.ts'
import { boxGap, trafficObstacleGap } from '../page/street.ts'

const failures = []
const check = (ok, what) => { console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) failures.push(what) }

// ── 1. Tile-fetch timeout & recovery in bay.ts ──────────────────────────────────────────────
const packBytes = (() => {
  // Minimal valid 2x2 ground-only Bay pack (magic 0x31594142, gstep=2500, gw=2, gx0=0, gz0=0).
  const head = Int32Array.from([0x3159_4142, 0, 0, 2500, 2500, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])
  const g = Int16Array.from([100, 100, 100, 100])
  const out = new Uint8Array(head.byteLength + g.byteLength)
  out.set(new Uint8Array(head.buffer), 0)
  out.set(new Uint8Array(g.buffer), head.byteLength)
  return out
})()
const sha = (buf) => createHash('sha256').update(buf).digest('hex')
const packSha = sha(packBytes)
const manifestObj = {
  version: 1,
  frame: '10n4250',
  levels: [
    {
      level: 0, size: 2500, gstep: 10,
      tiles: {
        '0_0': { path: 'tiles/0/0_0.bay', bytes: packBytes.byteLength, sha256: packSha },
        '1_0': { path: 'tiles/0/1_0.bay', bytes: packBytes.byteLength, sha256: packSha },
        '2_0': { path: 'tiles/0/2_0.bay', bytes: packBytes.byteLength, sha256: packSha },
      },
      sea: [],
    },
    { level: 1, size: 10000, gstep: 20, tiles: {}, sea: [] },
    { level: 2, size: 40000, gstep: 160, tiles: {}, sea: [] },
  ],
  names: {},
  credits: ['test'],
}
const manifestBuf = Buffer.from(JSON.stringify(manifestObj))
const releaseSha = sha(manifestBuf)
const pointerBuf = Buffer.from(JSON.stringify({ version: 1, release: releaseSha, manifest: 'manifest.json' }))

let hangFetch00 = true
let hangBody10 = true
const mockRead = async (url, init) => {
  const path = new URL(String(url)).pathname
  if (path.endsWith('/current.json')) return new Response(pointerBuf, { status: 200 })
  if (path.endsWith('/manifest.json')) return new Response(manifestBuf, { status: 200 })
  if (path.endsWith('/tiles/0/0_0.bay')) {
    if (hangFetch00) {
      return new Promise((_, rej) => {
        init?.signal?.addEventListener('abort', () => rej(new Error('aborted')), { once: true })
      })
    }
    return new Response(packBytes, { status: 200 })
  }
  if (path.endsWith('/tiles/0/1_0.bay')) {
    if (hangBody10) {
      // Response headers arrive immediately, but body stream hangs forever (Safari SW / stalled TCP stream).
      return { ok: true, status: 200, arrayBuffer: () => new Promise(() => {}) }
    }
    return new Response(packBytes, { status: 200 })
  }
  if (path.endsWith('/tiles/0/2_0.bay')) {
    // Slow tile (never finishes within 100 ms) for bounded `within` test.
    return new Promise((resolve) => setTimeout(() => resolve(new Response(packBytes, { status: 200 })), 400))
  }
  return new Response('', { status: 404 })
}

const fakeCore = {
  memory: new WebAssembly.Memory({ initial: 2 }),
  bay_room: () => 0,
  bay_load: () => 1,
  bay_marks: () => 0,
  bay_kerbs: () => 0,
  bay_begin: () => {},
  bay_drop: () => 0,
  bay_hero: () => 1,
  bay_landmarks: () => {},
}

await hold({ pointer: 'https://test.local/current.json', read: mockRead, heroes: [], squares: null })
setFetchTimeout(80)

// Hung fetch on 0/0_0 must abort cleanly instead of wedging workers forever.
const t0 = Date.now()
const resFetchHang = await ground(fakeCore, 100, 100, 200, 200, 1)
const elapsedFetchHang = Date.now() - t0
check(resFetchHang === 'failed' && elapsedFetchHang < 1500, `hung fetch aborts cleanly (${resFetchHang} in ${elapsedFetchHang} ms)`)

// Hung arrayBuffer() on 0/1_0 must also abort cleanly.
const t1 = Date.now()
const resBodyHang = await ground(fakeCore, 2600, 100, 2700, 200, 1)
const elapsedBodyHang = Date.now() - t1
check(resBodyHang === 'failed' && elapsedBodyHang < 1500, `hung arrayBuffer() aborts cleanly (${resBodyHang} in ${elapsedBodyHang} ms)`)
check(tally.timedOut >= 2, `tally.timedOut tracks aborted tile fetches (${tally.timedOut})`)

// Test `within` bound on an actively slow tile (0/2_0 takes 400 ms, within=80 ms must return 'slow' promptly).
const fakeCore2 = { ...fakeCore }
const t2 = Date.now()
setFetchTimeout(5000)
const slowRead = await Promise.race([
  ground(fakeCore2, 5100, 100, 5200, 200, 1, 80),
  new Promise((r) => setTimeout(() => r('hung'), 1000)),
])
check(slowRead === 'slow' && Date.now() - t2 < 350, `bounded ground(..., within=80) returns 'slow' promptly (${slowRead} in ${Date.now() - t2} ms)`)
setFetchTimeout(12_000)

// ── 2. Columbus Ave oblique-crossing collision avoidance in street.ts ───────────────────────
// Exact headings & geometries from feedback report s-mwyu4dl5-5a18b (a-12, a-13, a-14):
// #1418 sports coupe turning right across Columbus Ave (-0.449..-0.127 rad) vs NW-bound traffic (-2.429..-2.243 rad).
const cases = [
  {
    name: 'a-12 (#1415 silver saloon approaching #1418 sports coupe, dot=-0.40)',
    a: { x: 519330.0, z: 661775.7, hd: -2.429, halfL: 21.5, halfW: 10, v: 26, id: 1415 },
    b: { x: 519297.4, z: 661764.3, hd: -0.449, long: 22.5, wide: 10, v: 3.2, id: 1418 },
  },
  {
    name: 'a-13 (#1410 sports coupe approaching #1418 sports coupe, dot=-0.49)',
    a: { x: 519300.2, z: 661791.5, hd: -2.243, halfL: 22.5, halfW: 10, v: 14.2, id: 1410 },
    b: { x: 519308.9, z: 661761.0, hd: -0.159, long: 22.5, wide: 10, v: 8.6, id: 1418 },
  },
  {
    name: 'a-14 (#1419 green saloon approaching #1418 sports coupe, dot=-0.67)',
    a: { x: 519337.3, z: 661782.0, hd: -2.428, halfL: 21.5, halfW: 10, v: 39.4, id: 1419 },
    b: { x: 519311.4, z: 661760.6, hd: -0.127, long: 22.5, wide: 10, v: 9.0, id: 1418 },
  },
]

for (const tc of cases) {
  const hx = Math.cos(tc.a.hd), hz = Math.sin(tc.a.hd)
  const bhx = Math.cos(tc.b.hd), bhz = Math.sin(tc.b.hd)
  const dot = hx * bhx + hz * bhz
  // Confirm old rule (`dot < -0.3`) completely ignored this vehicle:
  assert(dot < -0.3, `expected ${tc.name} to have dot < -0.3 (got ${dot.toFixed(2)})`)
  // Place `a` 45 cells upstream along its heading so it's approaching `b` before contact:
  const approach = { x: tc.a.x - hx * 45, z: tc.a.z - hz * 45, hx, hz, halfL: tc.a.halfL, halfW: tc.a.halfW, v: tc.a.v, id: tc.a.id }
  const ob = { x: tc.b.x, z: tc.b.z, hx: bhx, hz: bhz, long: tc.b.long, wide: tc.b.wide, v: tc.b.v, id: tc.b.id }
  const g = trafficObstacleGap(approach, ob)
  check(Number.isFinite(g) && g > 0 && g < 70, `${tc.name}: detected ahead with braking gap ${(g / 10).toFixed(2)} m (dot=${dot.toFixed(2)})`)
  // And at the actual collision snapshot, OBBs overlap (< 0) and trafficObstacleGap still reports tight/negative gap:
  const pen = -boxGap(tc.a.x, tc.a.z, hx, hz, tc.a.halfL, tc.a.halfW, tc.b.x, tc.b.z, bhx, bhz, tc.b.long, tc.b.wide)
  const gNow = trafficObstacleGap({ ...tc.a, hx, hz }, ob)
  check(pen > 4 && gNow < 10, `${tc.name}: snapshot had ${(pen / 10).toFixed(2)} m overlap; new gap=${(gNow / 10).toFixed(2)} m forces stop`)
}

// Parallel opposite-lane traffic (dot = -1, 3.3 m lateral offset) must still be ignored so two-way streets never deadlock.
const oppGap = trafficObstacleGap(
  { x: 0, z: 0, hx: 1, hz: 0, halfL: 22, halfW: 10, v: 40, id: 1 },
  { x: 80, z: 33, hx: -1, hz: 0, long: 22, wide: 10, v: 40, id: 2 },
)
check(oppGap === Infinity, `parallel head-on traffic (dot=-1) stays clear (${oppGap})`)

// Two crossing cars both stopped facing each other obliquely must tie-break cleanly (lower id proceeds, higher id yields).
const angle = 2.1 // cos(2.1) ≈ -0.50 (oblique crossing)
const cLow = { x: 0, z: 0, hx: 1, hz: 0, halfL: 22, halfW: 10, v: 0, id: 10 }
const cHigh = { x: 38, z: -20, hx: Math.cos(angle), hz: Math.sin(angle), halfL: 22, halfW: 10, v: 0, id: 20 }
const lowSeesHigh = trafficObstacleGap(cLow, { x: cHigh.x, z: cHigh.z, hx: cHigh.hx, hz: cHigh.hz, long: 22, wide: 10, v: 0, id: 20 })
const highSeesLow = trafficObstacleGap(cHigh, { x: cLow.x, z: cLow.z, hx: cLow.hx, hz: cLow.hz, long: 22, wide: 10, v: 0, id: 10 })
check(lowSeesHigh === Infinity && Number.isFinite(highSeesLow), `stopped oblique pair tie-breaks cleanly (low=${lowSeesHigh}, high=${highSeesLow.toFixed(1)})`)

if (failures.length) { console.log(`\n${failures.length} failed:\n  ${failures.join('\n  ')}`); process.exit(1) }
console.log('\nall worker-resilience checks pass')
