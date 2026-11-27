// The voxelwright Worker's code (voxelwright.world, through world-worker.mjs; #450). Everything else is a static asset;
// this runs only for the paths cloudflare.config.ts sends it first (the city's release, the engine's binary files and
// /weather) and answers each release or bay file with the quality-11 Brotli copy
// sf/build.mjs wrote beside it (`<file>.br`), byte for byte. Static assets alone cannot: an asset given
// `Content-Encoding: br` in _headers is compressed a second time, and `.bay`, `.far` and `.bin` files are sent
// uncompressed. `encodeBody: "manual"` sends the stored bytes as they are.
//
// /weather (#524) is San Francisco's weather now, for the realm's "SF now" sky: the latest report that saw the sky
// from the airport's station (KSFO; the downtown one reports no sky), from the National Weather Service's API
// (api.weather.gov: public domain, no key, a User-Agent naming the caller and how to reach it: .agents/skills/sf-sky).
// Kept ten minutes at the edge, so a data centre's visitors share one call, and a failure one minute, so a flood of
// visitors during an outage still makes one call a minute; trimmed to what the sky reads (engine/page/almanac.ts
// `weatherOf`). Only GET and HEAD reach it.
//
// The site's security headers (#81) live here once: assemble.mjs writes them into dist-world/_headers for the static
// assets, with the page's inline scripts' hashes in the CSP, and every answer below carries them too.
import { takesBrotli } from './encoding.mjs'

const TYPES = { '.json': 'application/json', '.bin': 'application/octet-stream', '.bay': 'application/octet-stream', '.far': 'application/octet-stream', '.pack': 'application/octet-stream', '.txt': 'text/plain; charset=utf-8' }
const extension = (path) => (path.includes('.') ? path.slice(path.lastIndexOf('.')) : '')

export const WEATHER = 'https://api.weather.gov/stations/KSFO/observations?limit=8'

/**
 * voxelwright.world's Content-Security-Policy. `hashes` are the `'sha256-…'` sources of the page's inline scripts,
 * which only assemble.mjs knows; the Worker never answers with a page, so its own answers carry the policy without them.
 * WebAssembly needs 'wasm-unsafe-eval'; the car radio needs YouTube's player script, frame and thumbnails; a player's
 * own AI provider is reached from the page, and the lobbies over wss:.
 */
export function worldCsp(hashes = []) {
  return [
    `script-src 'self' 'wasm-unsafe-eval'${hashes.map((h) => ` ${h}`).join('')} https://www.youtube.com https://s.ytimg.com`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https://i.ytimg.com",
    "font-src 'self' data:",
    "media-src 'self' blob:",
    "worker-src 'self' blob:",
    "frame-src 'self' https://www.youtube.com https://www.youtube-nocookie.com",
    "connect-src 'self' https://api.anthropic.com https://api.openai.com https://generativelanguage.googleapis.com https://openrouter.ai https: wss:",
    "object-src 'none'",
    "base-uri 'self'",
    "manifest-src 'self'",
    "frame-ancestors 'self' https://zahynailo.dev",
  ].join('; ')
}

/** The headers every voxelwright.world answer carries, static or from this Worker. */
export function securityHeaders(hashes = []) {
  return {
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    'Content-Security-Policy': worldCsp(hashes),
  }
}

/** The answer with the security headers set, in a new Response whose headers can change. */
function secured(answer, init = {}) {
  const headers = new Headers(answer.headers)
  for (const [name, value] of Object.entries(securityHeaders())) headers.set(name, value)
  return new Response(init.body === undefined ? answer.body : init.body, { status: answer.status, statusText: answer.statusText, headers, ...(init.encodeBody ? { encodeBody: init.encodeBody } : {}) })
}

/** The same address with `.br` after its path. Set on a copy: `new URL("//host/x.br", url)` would leave the origin. */
function brotliCopy(url) {
  const brUrl = new URL(url)
  brUrl.pathname = `${url.pathname}.br`
  return brUrl
}

// The road's marks, landmarks and map change only when the realm is rebuilt: a day fresh, then a week in the background.
const BAY_CACHE = 'public, max-age=86400, stale-while-revalidate=604800'
const RELEASE_CACHE = 'public, max-age=31536000, immutable'

async function weather() {
  try {
    const answer = await fetch(WEATHER, { headers: { 'User-Agent': 'voxelwright.world (https://voxelwright.world)', Accept: 'application/geo+json' }, cf: { cacheEverything: true, cacheTtlByStatus: { '200-299': 600, '400-599': 60 } } })
    if (!answer.ok) throw Error(`${answer.status}`)
    // The latest report that saw the sky: an hour's main report sometimes comes with its layers unread (none at all,
    // not even CLR), and the specials between say what it left out. Newest first.
    const seen = ((await answer.json())?.features ?? []).map((f) => f?.properties).find((p) => typeof p?.timestamp === 'string' && p.cloudLayers?.length)
    if (!seen) throw Error('no report of the sky')
    const covered = seen.cloudLayers.filter((c) => ['BKN', 'OVC', 'VV'].includes(c.amount) && typeof c.base?.value === 'number')
    const observed = {
      time: seen.timestamp,
      present: (seen.presentWeather ?? []).map((w) => w.rawString).filter((w) => typeof w === 'string'),
      clouds: seen.cloudLayers.map((c) => c.amount).filter((c) => typeof c === 'string'),
      ceiling: covered.length ? Math.min(...covered.map((c) => c.base.value)) : null,
      visibility: typeof seen.visibility?.value === 'number' ? seen.visibility.value : null,
    }
    return Response.json({ observed }, { headers: { 'Cache-Control': 'public, max-age=300' } })
  } catch (e) {
    return Response.json({ error: `the weather service did not answer (${e.message})` }, { status: 502, headers: { 'Cache-Control': 'no-store' } })
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url)
    const readable = request.method === 'GET' || request.method === 'HEAD'
    if (url.pathname === '/weather') {
      if (!readable) return secured(new Response('Only GET and HEAD', { status: 405, headers: { Allow: 'GET, HEAD', 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } }))
      return secured(await weather())
    }
    const bay = url.pathname.startsWith('/bay/'), release = url.pathname.startsWith('/releases/')
    const wantsBrotli = takesBrotli(request.headers.get('Accept-Encoding'))
    if (readable && wantsBrotli && !url.pathname.endsWith('.br')) {
      const squeezed = await env.ASSETS.fetch(new Request(brotliCopy(url), { headers: request.headers }))
      if (squeezed.status === 200 || squeezed.status === 304) {
        const answer = secured(squeezed, { body: request.method === 'HEAD' || squeezed.status === 304 ? null : squeezed.body, encodeBody: 'manual' })
        answer.headers.set('Content-Type', TYPES[extension(url.pathname)] ?? 'application/octet-stream')
        answer.headers.set('Content-Encoding', 'br')
        answer.headers.set('Vary', 'Accept-Encoding')
        // A release is named by its hash and never changes; the bay's files change only with a rebuild.
        if (release) answer.headers.set('Cache-Control', RELEASE_CACHE)
        if (bay) answer.headers.set('Cache-Control', BAY_CACHE)
        return answer
      }
    }
    const plain = await env.ASSETS.fetch(request)
    if (plain.status === 404 && readable && !url.pathname.endsWith('.br')) {
      const hasBr = await env.ASSETS.fetch(new Request(brotliCopy(url), { method: 'HEAD' }))
      if (hasBr.status === 200) {
        return secured(new Response('Brotli encoding required (send Accept-Encoding: br)', {
          status: 406,
          headers: { 'Content-Type': 'text/plain; charset=utf-8', Vary: 'Accept-Encoding' },
        }))
      }
    }
    const answer = secured(plain)
    if (release && plain.status === 200) {
      answer.headers.set('Cache-Control', RELEASE_CACHE)
      answer.headers.set('Vary', 'Accept-Encoding')
    }
    if (bay && (plain.status === 200 || plain.status === 304)) answer.headers.set('Cache-Control', BAY_CACHE)
    return answer
  },
}
