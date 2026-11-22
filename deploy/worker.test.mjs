// worker.mjs with a stand-in for the assets binding (#450): the release's own Brotli copy where the client takes it,
// the plain file where it does not, and the release kept for a year.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import worker from './worker.mjs'
import { takesBrotli } from './encoding.mjs'

const FILES = { '/releases/p/t.bay': 'PLAIN', '/releases/p/t.bay.br': 'BROTLI', '/bay/marks.bin': 'MARKS' }
const env = { ASSETS: { fetch: async (r) => { const p = new URL(r.url).pathname; return p in FILES ? new Response(FILES[p], { headers: { ETag: '"e"' } }) : new Response('not found', { status: 404 }) } } }
const get = (path, accept, method = 'GET') => worker.fetch(new Request(`https://zahynailo.dev${path}`, { method, headers: accept === undefined ? {} : { 'Accept-Encoding': accept } }), env)

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
