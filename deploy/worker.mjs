// zahynailo.dev's one Worker (#450). Everything is a static asset; this runs only for the paths cloudflare.config.ts
// sends it first (the city's release and the engine's binary files) and answers each with the quality-11 Brotli copy
// sf/build.mjs wrote beside it (`<file>.br`), byte for byte. Static assets alone cannot: an asset given
// `Content-Encoding: br` in _headers is compressed a second time, and `.bay`, `.far` and `.bin` files are sent
// uncompressed. `encodeBody: "manual"` sends the stored bytes as they are.
//
// /weather (#524) is San Francisco's weather now, for the realm's "SF now" sky: the latest report that saw the sky
// from the airport's station (KSFO; the downtown one reports no sky), from the National Weather Service's API
// (api.weather.gov: public domain, no key, a User-Agent naming the caller, a generic one: .agents/skills/sf-sky). Kept
// ten minutes at the edge, so a data centre's visitors share one call (a failure not at all: a negative TTL is not
// cached), and trimmed to what the sky reads (engine/page/almanac.ts `weatherOf`).
import { takesBrotli } from './encoding.mjs'

const TYPES = { '.json': 'application/json', '.bin': 'application/octet-stream', '.bay': 'application/octet-stream', '.far': 'application/octet-stream', '.txt': 'text/plain; charset=utf-8' }
const extension = (path) => (path.includes('.') ? path.slice(path.lastIndexOf('.')) : '')

export const WEATHER = 'https://api.weather.gov/stations/KSFO/observations?limit=8'

async function weather() {
  try {
    const answer = await fetch(WEATHER, { headers: { 'User-Agent': 'village-engine (sky)', Accept: 'application/geo+json' }, cf: { cacheEverything: true, cacheTtlByStatus: { '200-299': 600, '400-599': -1 } } })
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
    if (url.pathname === '/weather') return weather()
    const wantsBrotli = takesBrotli(request.headers.get('Accept-Encoding'))
    if ((request.method === 'GET' || request.method === 'HEAD') && wantsBrotli && !url.pathname.endsWith('.br')) {
      const squeezed = await env.ASSETS.fetch(new Request(new URL(`${url.pathname}.br`, url), { headers: request.headers }))
      if (squeezed.status === 200 || squeezed.status === 304) {
        const headers = new Headers(squeezed.headers)
        headers.set('Content-Type', TYPES[extension(url.pathname)] ?? 'application/octet-stream')
        headers.set('Content-Encoding', 'br')
        headers.set('Vary', 'Accept-Encoding')
        // A release is named by its hash and never changes; the rest keeps the platform's revalidate-every-time.
        if (url.pathname.startsWith('/releases/')) headers.set('Cache-Control', 'public, max-age=31536000, immutable')
        return new Response(request.method === 'HEAD' || squeezed.status === 304 ? null : squeezed.body, { status: squeezed.status, headers, encodeBody: 'manual' })
      }
    }
    const plain = await env.ASSETS.fetch(request)
    if (!url.pathname.startsWith('/releases/') || plain.status !== 200) return plain
    const headers = new Headers(plain.headers)
    headers.set('Cache-Control', 'public, max-age=31536000, immutable')
    headers.set('Vary', 'Accept-Encoding')
    return new Response(plain.body, { status: plain.status, headers })
  },
}
