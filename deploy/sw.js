// Voxelwright PWA Service Worker (voxelwright.world):
// - Precaches the engine shell (HTML, core.wasm, fonts, loader images, icons) keyed by assembly build hash.
// - Serves immutable /releases/<pin>/* tiles cache-first from a bounded LRU tile cache (saving Cloudflare Worker hits
//   and enabling offline exploration of visited San Francisco), and prunes old releases whenever /current.json advances.
// - Serves /bay/* stale-while-revalidate and /weather network-first with cached offline fallback.
// - Skips large egg media (.mp4/.m4a), range requests, non-GET requests and cross-origin requests.
//
// deploy/assemble.mjs replaces the placeholders below with the assembled build's hash and shell list.
const SHELL_VERSION = /*SHELL_VERSION*/'dev'
const PRECACHE = /*PRECACHE*/['/', '/manifest.webmanifest', '/favicon.svg']

const SHELL_CACHE = `vw-shell-${SHELL_VERSION}`
const BAY_CACHE = 'vw-bay-v1'
const WEATHER_CACHE = 'vw-weather-v1'
const RELEASE_PREFIX = 'vw-release-'

// Cache Storage holds decoded (uncompressed) responses, so cap cached release tiles tightly to stay well inside
// mobile and desktop storage quotas (~180 MiB or 35% of available quota, and at most 600 entries).
const MAX_TILE_BYTES = 180 * 1024 * 1024
const MAX_TILE_ENTRIES = 600
const RELEASE_FETCH_TIMEOUT_MS = 12_000

async function fetchWithTimeout(request, timeoutMs = RELEASE_FETCH_TIMEOUT_MS) {
  if (typeof AbortController !== 'function' || typeof setTimeout !== 'function' || !(timeoutMs > 0)) {
    return fetch(request)
  }
  const ac = new AbortController()
  let onAbort = null
  const timer = setTimeout(() => ac.abort(new Error('sw fetch timeout')), timeoutMs)
  try {
    const req = fetch(request, { signal: ac.signal })
    return await Promise.race([
      req,
      new Promise((_, rej) => {
        onAbort = () => rej(new Error('sw fetch timeout'))
        ac.signal.addEventListener('abort', onAbort, { once: true })
      }),
    ])
  } finally {
    clearTimeout(timer)
    if (onAbort) ac.signal.removeEventListener('abort', onAbort)
  }
}

// In-memory LRU accounting for the active SW lifecycle; falls back cleanly to Cache.keys() insertion order after restarts.
const tileSizes = new Map()
const tileTouched = new Map()

const OFFLINE_HTML = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"><meta name="theme-color" content="#10141a"><title>Offline · Voxelwright</title><style>html,body{margin:0;min-height:100%;background:#10141a;color:#e8ebf2;font:400 1rem/1.5 system-ui,-apple-system,sans-serif;display:grid;place-items:center;padding:16px;box-sizing:border-box}main{max-width:28rem;padding:24px;background:#1a2029;border-inline-start:8px solid #fff600;box-shadow:4px 5px 0 rgb(0 0 0/.45)}h1{margin:0 0 10px;font-size:1.35rem}p{margin:0;color:#b4bccb}button{margin-top:18px;padding:10px 16px;border:0;background:#fff600;color:#0a0f3d;font:650 0.95rem system-ui,sans-serif;cursor:pointer}</style></head><body><main><h1>You’re offline</h1><p>Voxelwright needs one online visit to cache San Francisco on this device. Reconnect and try again.</p><button type="button" onclick="location.reload()">Try again</button></main></body></html>`

const isPinnedReleaseMeta = (pathname) => /\/(?:manifest|far)\.json$|\/names\/|\/packs\/landing\.pack$/.test(pathname)

function releasePinFromPath(pathname) {
  const m = /^\/releases\/([0-9a-zA-Z_-]+)\//.exec(pathname)
  return m ? m[1].slice(0, 12) : null
}

async function pruneOldReleases(activePin) {
  const keep = `${RELEASE_PREFIX}${activePin.slice(0, 12)}`
  const names = await caches.keys()
  await Promise.all(names.filter((n) => n.startsWith(RELEASE_PREFIX) && n !== keep).map((n) => caches.delete(n)))
}

async function responseSize(res) {
  const header = Number(res.headers.get('content-length'))
  if (Number.isFinite(header) && header > 0) return header
  try { return (await res.clone().arrayBuffer()).byteLength } catch { return 128 * 1024 }
}

async function tileByteBudget() {
  try {
    if (self.navigator?.storage?.estimate) {
      const est = await self.navigator.storage.estimate()
      if (typeof est.quota === 'number' && est.quota > 0) {
        return Math.min(MAX_TILE_BYTES, Math.floor(est.quota * 0.35))
      }
    }
  } catch { /* ignore */ }
  return MAX_TILE_BYTES
}

async function enforceTileBudget(cacheName) {
  const cache = await caches.open(cacheName)
  const keys = await cache.keys()
  if (keys.length === 0) return
  const budget = await tileByteBudget()

  let totalBytes = 0
  const evictable = []
  for (let i = 0; i < keys.length; i++) {
    const req = keys[i]
    const url = req.url
    const size = tileSizes.get(url) ?? 128 * 1024
    totalBytes += size
    const pathname = new URL(url).pathname
    if (!isPinnedReleaseMeta(pathname)) {
      evictable.push({ req, url, size, touched: tileTouched.get(url) ?? i })
    }
  }

  if (keys.length <= MAX_TILE_ENTRIES && totalBytes <= budget) return

  // Oldest touched first; drop until safely under both entry and byte caps (with 15% headroom to avoid thrashing).
  evictable.sort((a, b) => a.touched - b.touched)
  const targetBytes = Math.floor(budget * 0.85)
  const targetEntries = Math.floor(MAX_TILE_ENTRIES * 0.9)
  let count = keys.length

  for (const item of evictable) {
    if (count <= targetEntries && totalBytes <= targetBytes) break
    await cache.delete(item.req)
    tileSizes.delete(item.url)
    tileTouched.delete(item.url)
    totalBytes -= item.size
    count--
  }
}

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL_CACHE)
    // Precache individually so one missing optional file never aborts installation.
    await Promise.all(PRECACHE.map(async (url) => {
      try {
        const res = await fetch(url, { cache: 'reload' })
        if (res.ok) await cache.put(url, res)
      } catch { /* retry lazily on first fetch */ }
    }))
    await self.skipWaiting()
  })())
})

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys()
    await Promise.all(
      names
        .filter((name) => name.startsWith('vw-shell-') && name !== SHELL_CACHE)
        .map((name) => caches.delete(name)),
    )
    await self.clients.claim()
  })())
})

self.addEventListener('message', (event) => {
  const msg = event.data
  if (!msg || typeof msg !== 'object') return
  if (msg.type === 'SKIP_WAITING') void self.skipWaiting()
  if (msg.type === 'CLEAR_TILE_CACHE') {
    event.waitUntil((async () => {
      const names = await caches.keys()
      await Promise.all(names.filter((n) => n.startsWith(RELEASE_PREFIX)).map((n) => caches.delete(n)))
      tileSizes.clear()
      tileTouched.clear()
    })())
  }
})

async function handleNavigate(request) {
  const cache = await caches.open(SHELL_CACHE)
  try {
    const res = await fetch(request)
    if (res.ok && new URL(request.url).pathname === '/') {
      void cache.put('/', res.clone())
    }
    return res
  } catch {
    return (await cache.match('/')) ?? (await cache.match('/index.html')) ?? new Response(OFFLINE_HTML, {
      status: 503,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    })
  }
}

async function handleCurrentJson(request, event) {
  const cache = await caches.open(SHELL_CACHE)
  try {
    const res = await fetch(request)
    if (res.ok) {
      const copy = res.clone()
      event.waitUntil((async () => {
        await cache.put('/current.json', copy.clone())
        try {
          const pointer = await copy.json()
          if (typeof pointer?.release === 'string' && pointer.release.length >= 12) {
            await pruneOldReleases(pointer.release)
          }
        } catch { /* ignore malformed pointer */ }
      })())
    }
    return res
  } catch {
    const cached = await cache.match('/current.json')
    if (cached) return cached
    throw new Error('offline and no cached current.json')
  }
}

async function handleReleaseAsset(request, pathname, event) {
  const pin = releasePinFromPath(pathname)
  const cacheName = `${RELEASE_PREFIX}${pin ?? 'default'}`
  const cache = await caches.open(cacheName)
  const hit = await cache.match(request)
  if (hit) {
    tileTouched.set(request.url, Date.now())
    return hit
  }
  const res = await fetchWithTimeout(request, RELEASE_FETCH_TIMEOUT_MS)
  if (res.ok) {
    const copy = res.clone()
    event.waitUntil((async () => {
      try {
        const header = Number(copy.headers.get('content-length'))
        let size = Number.isFinite(header) && header > 0 ? header : 0
        if (size > 0) {
          await cache.put(request, copy)
        } else {
          // Buffer once instead of double-cloning the response stream (avoids WebKit stream backpressure stalls).
          const buf = await copy.arrayBuffer()
          size = buf.byteLength
          await cache.put(request, new Response(buf, { status: copy.status, statusText: copy.statusText, headers: copy.headers }))
        }
        tileSizes.set(request.url, size)
        tileTouched.set(request.url, Date.now())
        await enforceTileBudget(cacheName)
      } catch { /* quota or aborted cache write must never stall tile delivery */ }
    })())
  }
  return res
}

async function handleStaleWhileRevalidate(request, cacheName, event) {
  const cache = await caches.open(cacheName)
  const hit = await cache.match(request)
  const refresh = fetch(request).then((res) => {
    if (res.ok) void cache.put(request, res.clone())
    return res
  })
  if (hit) {
    event.waitUntil(refresh.catch(() => {}))
    return hit
  }
  return refresh
}

async function handleWeather(request, event) {
  const cache = await caches.open(WEATHER_CACHE)
  try {
    const res = await fetch(request)
    if (res.ok) {
      event.waitUntil(cache.put('/weather', res.clone()))
      return res
    }
    return (await cache.match('/weather')) ?? res
  } catch {
    return (await cache.match('/weather')) ?? new Response(JSON.stringify({ error: 'offline' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    })
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') return
  if (request.headers.has('range')) return
  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return

  const { pathname } = url
  // Never intercept or cache the service worker itself, nor large media clips.
  if (pathname === '/sw.js' || /\.(?:mp4|m4a)$/i.test(pathname)) return

  if (request.mode === 'navigate') {
    event.respondWith(handleNavigate(request))
    return
  }
  if (pathname === '/current.json') {
    event.respondWith(handleCurrentJson(request, event))
    return
  }
  if (pathname.startsWith('/releases/')) {
    event.respondWith(handleReleaseAsset(request, pathname, event))
    return
  }
  if (pathname.startsWith('/bay/')) {
    event.respondWith(handleStaleWhileRevalidate(request, BAY_CACHE, event))
    return
  }
  if (pathname === '/weather') {
    event.respondWith(handleWeather(request, event))
    return
  }
  // Content-hashed loader images, bundled JS/WASM chunks and hashed kit stylesheet: cache-first.
  if (/^\/loading-[^/]+\.webp$/.test(pathname) || pathname.startsWith('/assets/') || /^\/kit\/voxelmorphism-[0-9a-f]+\.css$/.test(pathname)) {
    event.respondWith((async () => {
      const cache = await caches.open(SHELL_CACHE)
      const hit = await cache.match(request)
      if (hit) return hit
      const res = await fetch(request)
      if (res.ok) event.waitUntil(cache.put(request, res.clone()))
      return res
    })())
    return
  }
  // Engine modules, WASM, Voxelmorphism kit, fonts, shelf items, icons, manifest.
  if (
    pathname.startsWith('/page/') ||
    pathname.startsWith('/kit/') ||
    pathname.startsWith('/blocks/') ||
    pathname.startsWith('/shelf/') ||
    pathname.startsWith('/icons/') ||
    pathname === '/manifest.webmanifest' ||
    pathname === '/favicon.svg' ||
    pathname === '/alpha.js' ||
    pathname === '/CREDITS.txt' ||
    pathname.startsWith('/eggs/')
  ) {
    event.respondWith(handleStaleWhileRevalidate(request, SHELL_CACHE, event))
  }
})
