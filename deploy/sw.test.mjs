import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'

const SW_SOURCE = readFileSync(new URL('./sw.js', import.meta.url), 'utf8')

function createCacheStorage() {
  const stores = new Map()
  const keyOf = (req) => (typeof req === 'string' ? new URL(req, 'https://voxelwright.world').href : req.url)
  const open = async (name) => {
    if (!stores.has(name)) stores.set(name, new Map())
    const map = stores.get(name)
    return {
      async put(req, res) { map.set(keyOf(req), res) },
      async match(req) {
        const hit = map.get(keyOf(req))
        return hit ? hit.clone() : undefined
      },
      async keys() { return [...map.keys()].map((u) => new Request(u)) },
      async delete(req) { return map.delete(keyOf(req)) },
    }
  }
  return {
    stores,
    caches: {
      open,
      async keys() { return [...stores.keys()] },
      async delete(name) { return stores.delete(name) },
    },
  }
}

function loadSw({ version = 'abc123def456', precache = ['/', '/manifest.webmanifest', '/page/core.wasm'], fetchImpl, quota = 2 * 1024 * 1024 * 1024, fetchTimeoutMs } = {}) {
  const { stores, caches } = createCacheStorage()
  const listeners = new Map()
  let skipped = false, claimed = false
  const selfObj = {
    location: new URL('https://voxelwright.world/sw.js'),
    navigator: { storage: { estimate: async () => ({ quota, usage: 0 }) } },
    skipWaiting: async () => { skipped = true },
    clients: { claim: async () => { claimed = true } },
    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, [])
      listeners.get(type).push(fn)
    },
  }
  let code = SW_SOURCE
    .replace("/*SHELL_VERSION*/'dev'", JSON.stringify(version))
    .replace("/*PRECACHE*/['/', '/manifest.webmanifest', '/favicon.svg']", JSON.stringify(precache))
  if (fetchTimeoutMs !== undefined) {
    code = code.replace('const RELEASE_FETCH_TIMEOUT_MS = 12_000', `const RELEASE_FETCH_TIMEOUT_MS = ${Number(fetchTimeoutMs)}`)
  }
  const context = vm.createContext({
    self: selfObj,
    caches,
    fetch: fetchImpl,
    Request,
    Response,
    Headers,
    URL,
    AbortController,
    setTimeout,
    clearTimeout,
    Date,
    Map,
    Set,
    Promise,
    Number,
    Math,
    JSON,
    Error,
    console,
  })
  vm.runInContext(code, context, { filename: 'sw.js' })

  const dispatchLifecycle = async (type) => {
    const waits = []
    for (const fn of listeners.get(type) ?? []) fn({ waitUntil: (p) => waits.push(p) })
    await Promise.all(waits)
  }
  const dispatchFetch = async (url, init = {}, extra = {}) => {
    const req = new Request(url, init)
    if (extra.mode) Object.defineProperty(req, 'mode', { value: extra.mode })
    let responded = null
    const waits = []
    for (const fn of listeners.get('fetch') ?? []) {
      fn({
        request: req,
        respondWith(p) { responded = p },
        waitUntil(p) { waits.push(p) },
      })
    }
    if (!responded) return { handled: false, response: null, settled: async () => { await Promise.all(waits) } }
    const response = await responded
    await Promise.all(waits)
    return { handled: true, response }
  }
  return { stores, caches, dispatchLifecycle, dispatchFetch, state: () => ({ skipped, claimed }) }
}

test('install precaches shell files and activate prunes older shell caches without touching releases', async () => {
  const fetched = []
  const sw = loadSw({
    version: '111111222222',
    precache: ['/', '/manifest.webmanifest', '/page/core.wasm'],
    fetchImpl: async (req) => {
      const u = typeof req === 'string' ? req : req.url
      fetched.push(u)
      return new Response(`body:${u}`, { status: 200 })
    },
  })
  await sw.caches.open('vw-shell-old000000000')
  await sw.caches.open('vw-release-keepme123456')

  await sw.dispatchLifecycle('install')
  await sw.dispatchLifecycle('activate')

  assert.equal(sw.state().skipped, true)
  assert.equal(sw.state().claimed, true)
  assert.deepEqual(fetched, ['/', '/manifest.webmanifest', '/page/core.wasm'])
  assert.equal(sw.stores.has('vw-shell-111111222222'), true)
  assert.equal(sw.stores.has('vw-shell-old000000000'), false, 'old shell cache pruned')
  assert.equal(sw.stores.has('vw-release-keepme123456'), true, 'release tile cache survives shell updates')
})

test('navigate uses network-first and falls back to cached shell offline', async () => {
  let online = true
  const sw = loadSw({
    fetchImpl: async (req) => {
      if (!online) throw new Error('offline')
      return new Response(`<html>fresh:${new URL(req.url).search}</html>`, { status: 200, headers: { 'Content-Type': 'text/html' } })
    },
  })
  const first = await sw.dispatchFetch('https://voxelwright.world/', {}, { mode: 'navigate' })
  assert.equal(first.handled, true)
  assert.equal(await first.response.text(), '<html>fresh:</html>')

  online = false
  const offlineNav = await sw.dispatchFetch('https://voxelwright.world/?hour=21.5', {}, { mode: 'navigate' })
  assert.equal(offlineNav.handled, true)
  assert.equal(offlineNav.response.status, 200)
  assert.equal(await offlineNav.response.text(), '<html>fresh:</html>')
})

test('/current.json updates cache and prunes older release caches while keeping the active pin', async () => {
  let online = true
  const pinA = 'aaaaaaaaaaaa999999999999'
  const pinB = 'bbbbbbbbbbbb888888888888'
  let active = pinA
  const sw = loadSw({
    fetchImpl: async () => {
      if (!online) throw new Error('offline')
      return Response.json({ version: 1, release: active, manifest: `releases/${active}/manifest.json` })
    },
  })
  await sw.caches.open(`vw-release-${pinA.slice(0, 12)}`)
  await sw.caches.open(`vw-release-${pinB.slice(0, 12)}`)

  active = pinB
  const res = await sw.dispatchFetch('https://voxelwright.world/current.json')
  assert.equal((await res.response.json()).release, pinB)
  assert.equal(sw.stores.has(`vw-release-${pinA.slice(0, 12)}`), false, 'superseded release cache pruned')
  assert.equal(sw.stores.has(`vw-release-${pinB.slice(0, 12)}`), true, 'active release cache kept')

  online = false
  const cached = await sw.dispatchFetch('https://voxelwright.world/current.json')
  assert.equal((await cached.response.json()).release, pinB)
})

test('/releases/* serves cache-first and enforces bounded LRU byte budget while keeping manifest.json', async () => {
  let hits = 0
  // Small quota (1 MiB -> 35% budget ~358 KiB) so LRU eviction triggers with just a few 100 KiB tiles.
  const sw = loadSw({
    quota: 1024 * 1024,
    fetchImpl: async (req) => {
      hits++
      const pathname = new URL(req.url).pathname
      const size = pathname.endsWith('manifest.json') ? 1024 : 120 * 1024
      return new Response(new Uint8Array(size), { status: 200, headers: { 'Content-Length': String(size) } })
    },
  })
  const base = 'https://voxelwright.world/releases/abcdef0123456789/'
  await sw.dispatchFetch(`${base}manifest.json`)
  await sw.dispatchFetch(`${base}tiles/0/0_0.bay`)
  // Second fetch of the same tile must come from cache without hitting network.
  const before = hits
  const hitRes = await sw.dispatchFetch(`${base}tiles/0/0_0.bay`)
  assert.equal(hitRes.response.status, 200)
  assert.equal(hits, before, 'cached release tile does not hit network/Worker')

  // Load more tiles past the ~358 KiB budget to trigger eviction.
  await sw.dispatchFetch(`${base}tiles/0/1_0.bay`)
  await sw.dispatchFetch(`${base}tiles/0/2_0.bay`)
  await sw.dispatchFetch(`${base}tiles/0/3_0.bay`)

  const bucket = sw.stores.get('vw-release-abcdef012345')
  assert.ok(bucket.has(`${base}manifest.json`), 'manifest.json is pinned against tile LRU eviction')
  assert.ok(bucket.size < 5, `LRU evicted oldest tiles (remaining: ${bucket.size})`)
})

test('/weather falls back to cached observation when offline or upstream returns 502', async () => {
  let mode = 'ok'
  const sw = loadSw({
    fetchImpl: async () => {
      if (mode === 'offline') throw new Error('offline')
      if (mode === '502') return Response.json({ error: 'upstream' }, { status: 502 })
      return Response.json({ observed: { time: '2026-11-27T09:00:00Z', clouds: ['FEW'] } })
    },
  })
  const ok = await sw.dispatchFetch('https://voxelwright.world/weather')
  assert.equal((await ok.response.json()).observed.clouds[0], 'FEW')

  mode = '502'
  const fallback502 = await sw.dispatchFetch('https://voxelwright.world/weather')
  assert.equal(fallback502.response.status, 200)
  assert.equal((await fallback502.response.json()).observed.clouds[0], 'FEW')

  mode = 'offline'
  const fallbackOffline = await sw.dispatchFetch('https://voxelwright.world/weather')
  assert.equal(fallbackOffline.response.status, 200)
  assert.equal((await fallbackOffline.response.json()).observed.clouds[0], 'FEW')
})

test('service worker ignores cross-origin requests, range requests, sw.js itself and egg videos', async () => {
  const sw = loadSw({ fetchImpl: async () => new Response('ok') })
  assert.equal((await sw.dispatchFetch('https://www.youtube.com/iframe_api')).handled, false)
  assert.equal((await sw.dispatchFetch('https://voxelwright.world/sw.js')).handled, false)
  assert.equal((await sw.dispatchFetch('https://voxelwright.world/eggs/rick.mp4')).handled, false)
  assert.equal((await sw.dispatchFetch('https://voxelwright.world/bay/map.bin', { headers: { Range: 'bytes=0-100' } })).handled, false)
  assert.equal((await sw.dispatchFetch('https://voxelwright.world/weather', { method: 'POST' })).handled, false)
})

test('content-hashed /assets/* chunks are served cache-first without hitting network again', async () => {
  let fetches = 0
  const sw = loadSw({
    fetchImpl: async () => {
      fetches++
      return new Response('export const x = 1;', { status: 200, headers: { 'Content-Type': 'text/javascript' } })
    },
  })
  const first = await sw.dispatchFetch('https://voxelwright.world/assets/main-deadbeef.js')
  assert.equal(first.handled, true)
  assert.equal(fetches, 1)
  const second = await sw.dispatchFetch('https://voxelwright.world/assets/main-deadbeef.js')
  assert.equal(second.handled, true)
  assert.equal(fetches, 1, 'cached immutable asset chunk served without revalidation')
})

test('/releases/* aborts stalled upstream fetches instead of hanging forever', async () => {
  let aborted = false
  const sw = loadSw({
    fetchTimeoutMs: 60,
    fetchImpl: (_req, init) => new Promise((_, rej) => {
      init?.signal?.addEventListener('abort', () => { aborted = true; rej(new Error('aborted')) }, { once: true })
    }),
  })
  const t0 = Date.now()
  await assert.rejects(
    sw.dispatchFetch('https://voxelwright.world/releases/abcdef0123456789/tiles/0/206_263.bay'),
    /timeout|aborted/i,
  )
  assert.equal(aborted, true, 'AbortController signal fired on timeout')
  assert.ok(Date.now() - t0 < 1000, 'stalled release fetch rejected promptly')
})

test('/releases/* without Content-Length caches cleanly and survives cache quota errors', async () => {
  const payload = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])
  const sw = loadSw({
    fetchImpl: async () => new Response(payload, { status: 200 }),
  })
  const url = 'https://voxelwright.world/releases/abcdef0123456789/tiles/0/207_264.bay'
  const first = await sw.dispatchFetch(url)
  assert.equal(first.response.status, 200)
  assert.deepEqual(new Uint8Array(await first.response.arrayBuffer()), payload)
  const bucket = sw.stores.get('vw-release-abcdef012345')
  assert.ok(bucket?.has(url), 'headerless release tile was cached cleanly')

  // Simulate Safari QuotaExceededError during cache.put — response must still succeed.
  const origOpen = sw.caches.open
  sw.caches.open = async (name) => {
    const c = await origOpen(name)
    return { ...c, put: async () => { throw new Error('QuotaExceededError') } }
  }
  const second = await sw.dispatchFetch('https://voxelwright.world/releases/abcdef0123456789/tiles/0/208_264.bay')
  assert.equal(second.response.status, 200)
  assert.deepEqual(new Uint8Array(await second.response.arrayBuffer()), payload)
})
