// worker.mjs with a stand-in for the assets binding (#450): the release's own Brotli copy where the client takes it,
// the plain file where it does not, and the release kept for a year.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import worker, { securityHeaders } from './worker.mjs'
import { takesBrotli } from './encoding.mjs'

const FILES = { '/releases/p/t.bay': 'PLAIN', '/releases/p/t.bay.br': 'BROTLI', '/releases/p/br-only.bay.br': 'ONLY_BR', '/bay/marks.bin': 'MARKS', '/bay/map.bin.br': 'MAP_BR' }
const asked = []
const env = { ASSETS: { fetch: async (r) => { const u = new URL(r.url); asked.push(u.href); const p = u.pathname; return u.host === 'voxelwright.world' && p in FILES ? new Response(FILES[p], { headers: { ETag: '"e"' } }) : new Response('not found', { status: 404 }) } } }
const get = (path, accept, method = 'GET') => worker.fetch(new Request(`https://voxelwright.world${path}`, { method, headers: accept === undefined ? {} : { 'Accept-Encoding': accept } }), env)
const SECURITY = securityHeaders()
const secured = (answer, what) => { for (const [name, value] of Object.entries(SECURITY)) assert.equal(answer.headers.get(name), value, `${what}: ${name}`) }

test('Accept-Encoding: br with no q or a q above 0 takes Brotli; q=0, other codings and none do not', () => {
  for (const yes of ['br', 'gzip, br', 'BR;Q=0.5', 'br;q=0.001', 'gzip, deflate, br, zstd']) assert.equal(takesBrotli(yes), true, yes)
  for (const no of ['br;q=0', 'gzip, br; q=0.0', 'gzip', '*', '', undefined, 'brotli']) assert.equal(takesBrotli(no), false, String(no))
})

test('a release file goes as its own Brotli copy, kept a year; without Brotli, as the plain file', async () => {
  const squeezed = await get('/releases/p/t.bay', 'gzip, br')
  assert.equal(squeezed.headers.get('content-encoding'), 'br')
  assert.equal(squeezed.headers.get('content-type'), 'application/octet-stream')
  assert.match(squeezed.headers.get('cache-control'), /immutable/)
  assert.equal(await squeezed.text(), 'BROTLI')
  const plain = await get('/releases/p/t.bay', 'gzip, br;q=0')
  assert.equal(plain.headers.get('content-encoding'), null)
  assert.equal(await plain.text(), 'PLAIN')
  const head = await get('/releases/p/t.bay', 'br', 'HEAD')
  assert.equal(head.status, 200)
  assert.equal(await head.text(), '')
})

test('a file with no Brotli copy, and a missing one, go as the assets answer them', async () => {
  assert.equal(await (await get('/bay/marks.bin', 'br')).text(), 'MARKS')
  assert.equal((await get('/releases/p/none.bay', 'br')).status, 404)
})

test('a Brotli-only binary asset serves br to Brotli clients and 406 with Vary to clients without br', async () => {
  const ok = await get('/releases/p/br-only.bay', 'gzip, br')
  assert.equal(ok.status, 200)
  assert.equal(ok.headers.get('content-encoding'), 'br')
  assert.equal(await ok.text(), 'ONLY_BR')
  const noBr = await get('/releases/p/br-only.bay', 'gzip')
  assert.equal(noBr.status, 406)
  assert.equal(noBr.headers.get('vary'), 'Accept-Encoding')
  assert.equal((await get('/releases/p/missing.bay', 'gzip')).status, 404)
})

test("/weather is the station's latest report of the sky, trimmed, kept five minutes; a failed service is a 502 not kept in the browser", async () => {
  const real = globalThis.fetch
  try {
    let asked
    const report = (timestamp, cloudLayers, presentWeather = []) => ({ properties: { timestamp, textDescription: 'Cloudy', presentWeather, cloudLayers, visibility: { unitCode: 'wmoUnit:m', value: 16093.44 } } })
    const reports = { features: [
      // the hour's main report, its layers unread: passed over
      report('2026-11-25T06:56:00+00:00', []),
      report('2026-11-25T06:20:00+00:00', [{ base: { value: 1188 }, amount: 'FEW' }, { base: { value: 2438 }, amount: 'BKN' }, { base: { value: 3352 }, amount: 'OVC' }], [{ intensity: 'light', weather: 'drizzle', rawString: '-DZ' }]),
      report('2026-11-25T06:00:00+00:00', [{ base: { value: 3810 }, amount: 'CLR' }]),
    ] }
    globalThis.fetch = async (url, init) => { asked = { url: String(url), init }; return Response.json(reports) }
    const answer = await get('/weather')
    assert.equal(answer.status, 200)
    assert.equal(asked.url, 'https://api.weather.gov/stations/KSFO/observations?limit=8')
    assert.ok(asked.init.headers['User-Agent'])
    assert.equal(asked.init.headers['User-Agent'], 'voxelwright.world (https://voxelwright.world)')
    assert.deepEqual(asked.init.cf.cacheTtlByStatus, { '200-299': 600, '400-599': 60 })
    secured(answer, '/weather')
    assert.match(answer.headers.get('cache-control'), /max-age=300/)
    assert.deepEqual(await answer.json(), { observed: { time: '2026-11-25T06:20:00+00:00', present: ['-DZ'], clouds: ['FEW', 'BKN', 'OVC'], ceiling: 2438, visibility: 16093.44 } })
    for (const failing of [async () => new Response('busy', { status: 503 }), async () => { throw Error('offline') }, async () => Response.json({ features: [report('2026-11-25T06:56:00+00:00', [])] }), async () => Response.json({})]) {
      globalThis.fetch = failing
      const failed = await get('/weather')
      assert.equal(failed.status, 502)
      assert.equal(failed.headers.get('cache-control'), 'no-store')
      secured(failed, 'a failed /weather')
    }
  } finally { globalThis.fetch = real }
})

test('/weather takes only GET and HEAD, and refuses the rest before asking the weather service', async () => {
  const real = globalThis.fetch
  let calls = 0
  try {
    globalThis.fetch = async () => { calls++; return Response.json({ features: [] }) }
    for (const method of ['POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS']) {
      const refused = await get('/weather', undefined, method)
      assert.equal(refused.status, 405, method)
      assert.equal(refused.headers.get('allow'), 'GET, HEAD')
      secured(refused, `${method} /weather`)
    }
    assert.equal(calls, 0)
    assert.equal((await get('/weather', undefined, 'HEAD')).status, 502)
    assert.equal(calls, 1)
  } finally { globalThis.fetch = real }
})

test('every answer carries the security headers: Brotli, plain, 404 and 406', async () => {
  secured(await get('/releases/p/t.bay', 'br'), 'Brotli release file')
  secured(await get('/releases/p/t.bay', 'gzip'), 'plain release file')
  secured(await get('/releases/p/none.bay', 'br'), '404')
  secured(await get('/releases/p/br-only.bay', 'gzip'), '406')
  secured(await get('/bay/marks.bin', 'br'), 'plain bay file')
})

test('the bay\'s files are kept a day and refreshed in the background for a week, Brotli or plain', async () => {
  const BAY = 'public, max-age=86400, stale-while-revalidate=604800'
  assert.equal((await get('/bay/map.bin', 'br')).headers.get('cache-control'), BAY)
  assert.equal((await get('/bay/marks.bin', 'br')).headers.get('cache-control'), BAY)
  assert.equal((await get('/bay/marks.bin', 'gzip')).headers.get('cache-control'), BAY)
  assert.notEqual((await get('/bay/none.bin', 'gzip')).headers.get('cache-control'), BAY)
})

test('a path that starts with // asks the assets for the same origin, never another host', async () => {
  asked.length = 0
  await get('//evil.example/x.bay', 'br')
  assert.ok(asked.length > 0)
  for (const href of asked) assert.equal(new URL(href).host, 'voxelwright.world', href)
})
