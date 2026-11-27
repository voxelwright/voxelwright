// Workers and the page can all request the same new tile before the manifest promise resumes.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { hold, tally, tile } from '../page/bay.ts'

const sha = bytes => createHash('sha256').update(bytes).digest('hex')
const body = Uint8Array.of(1, 2, 3)
const path = 'tiles/0/1_2.bay'
const manifest = JSON.stringify({
  version: 1, frame: '10n4250', names: {}, credits: [],
  levels: [{ level: 0, size: 2500, gstep: 10, sea: [], tiles: { '1_2': { path, bytes: body.length, sha256: sha(body) } } }],
})
const pointer = { version: 1, release: sha(manifest), manifest: 'manifest.json' }
let requests = 0, available = false
await hold({
  pointer: 'http://localhost/current.json', heroes: [], squares: null,
  read: async url => {
    switch (new URL(url).pathname) {
      case '/current.json': return Response.json(pointer)
      case '/manifest.json': return new Response(manifest)
      case '/' + path:
        requests++
        return available ? new Response(body) : new Response(null, { status: 503 })
      default: throw Error(`Unexpected object ${url}`)
    }
  },
})

const burst = () => Array.from({ length: 8 }, () => tile(0, '1_2'))
const failed = await Promise.allSettled(burst())
assert(failed.every(result => result.status === 'rejected'))
assert.equal(requests, 1, 'all callers share even a failed transfer')
assert.equal(tally.held, 0, 'a failed transfer retains no bytes')
available = true
const loaded = await Promise.all(burst())
assert(loaded.every(result => result === loaded[0]))
assert.deepEqual(new Uint8Array(loaded[0]), body)
assert.equal(requests, 2, 'a retry fetches one validated copy for all callers')
assert.equal(tally.held, body.byteLength, 'the cache counts the shared tile only once')
console.log('Eight callers shared one failed request and one retry, retaining one copy of the tile')
