// zahynailo.dev's one Worker (#450). Everything is a static asset; this runs only for the paths cloudflare.config.ts
// sends it first (the city's release and the engine's binary files) and answers each with the quality-11 Brotli copy
// sf/build.mjs wrote beside it (`<file>.br`), byte for byte. Static assets alone cannot: an asset given
// `Content-Encoding: br` in _headers is compressed a second time, and `.bay`, `.far` and `.bin` files are sent
// uncompressed. `encodeBody: "manual"` sends the stored bytes as they are.
const TYPES = { '.json': 'application/json', '.bin': 'application/octet-stream', '.bay': 'application/octet-stream', '.far': 'application/octet-stream', '.txt': 'text/plain; charset=utf-8' }
const extension = (path) => path.slice(path.lastIndexOf('.'))

export default {
  async fetch(request, env) {
    const url = new URL(request.url)
    const wantsBrotli = /\bbr\b/.test(request.headers.get('Accept-Encoding') ?? '')
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
