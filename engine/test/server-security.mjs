// Bounded checks of the admission rules and a temporary world's storage.
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { named } from '../guard.mjs'
import { passwordTries, seatConflict, selectedAddress } from '../door.mjs'
import askPlugin from '../plugins/ask/world.mjs'
import { rowsOf } from '../plugins/build/world.mjs'
import { placement } from '../workshop/route.mjs'
import { serve } from './kit.mjs'

assert.ok(named('Host.Tailnet.ts.net:443'))
for (const host of ['.ts.net', 'foo..ts.net', 'two names.ts.net', 'a/b.ts.net']) assert.equal(named(host), false)
const pc = { sctp: { transport: { iceTransport: { getSelectedCandidatePair: () => null } } } }
assert.equal(selectedAddress(pc), null)
pc.sctp.transport.iceTransport.getSelectedCandidatePair = () => ({ remote: { address: '192.0.2.1' } })
assert.equal(selectedAddress(pc), '192.0.2.1')
const passwords = passwordTries(2)
assert.equal(passwords.reserve(['first']), 0)
assert.ok(passwords.reserve(['first']) > 0)
assert.equal(passwords.reserve(['second']), 0)
assert.ok(passwords.reserve(['third']) > 0)
passwords.passed(['second'])
assert.equal(passwords.reserve(['third']), 0)
const rider = { riding: 'bike' }, visitor = {}
assert.ok(seatConflict(visitor, { id: 'bike', on: true }, [rider]))
assert.ok(seatConflict(rider, { id: 'cart', on: true }, []))
assert.equal(seatConflict(rider, { id: 'bike', on: false }, []), null)
assert.ok(seatConflict(visitor, { id: 'bike' }, []))
assert.equal(seatConflict(visitor, { id: 'bike', on: true }, []), null)
for (const w of [{ at: [1, 2], facing: 'south' }, { at: [1, NaN, 3], facing: 'south' }, { at: [1, 2, 3], facing: 'up' }]) assert.equal(placement(w), undefined)
assert.deepEqual(placement({ at: [1, 2, 3], facing: 'west' }), { at: [1, 2, 3], facing: 'west' })
let received
askPlugin({ hear: (_, event, data) => { received = { event, ...data } } }).does.ask({ id: 'sender' }, { id: 'question', of: 'recipient', by: 'other', ask: 'other' }, 0, assert.fail)
assert.deepEqual(received, { event: 'asked', by: 'sender', ask: 'question' })
assert.throws(() => rowsOf([['room', 'wood', '2:4', 0, 0, 0, 16, 16, 16, 'constructor']], [0, 0, 0], () => 0), /doorway/)

const dir = mkdtempSync(join(tmpdir(), 'world-security-'))
const args = ['--world', join(dir, 'world.log')]
let server = await serve('/dev/null', args)
try {
  const post = (body) => fetch(server.url + '/world/ask', { method: 'POST', body: JSON.stringify(body) })
  const as = { things: 4, cells: 100, at: [0, 200, 0], reach: 100 }
  const row = { edit: [1, 1, 0, 1, 200, 0, 1], release: as.at }
  const thing = { id: 'block', name: 'block', at: as.at, size: [1, 1, 1], facing: 'north' }
  assert.equal((await post({ as, by: 'visitor', ...row })).status, 403)
  assert.equal((await post({ as, by: 'visitor', blast: [150, 200, 0], radius: 1 })).status, 403)
  assert.equal((await post({ by: 'owner', ...row, thing, wait: true })).status, 202)
  for (const action of [{ blast: as.at, radius: 1 }, { ignite: as.at, radius: 1 }, { ball: { from: as.at, speed: [1, 1, 1], radius: 1, kind: 1 } }, { ...row, thing: { ...thing, id: 'overlap' } }]) {
    assert.equal((await post({ as, by: 'visitor', ...action })).status, 403)
  }
  const tile = await fetch(server.url + '/bay/earth/10n4250/0/0_0.bay', { headers: { origin: 'https://example.invalid' } })
  assert.equal(tile.status, 403)
  const csp = (await fetch(server.url)).headers.get('content-security-policy')
  assert.match(csp, /default-src 'self'/)
  assert.match(csp, /frame-ancestors 'self'/)
  const upload = (v) => fetch(server.url + '/world/fine', { method: 'POST', body: Uint8Array.of(v, 0), headers: { 'x-world-stranger': 'visitor' } }).then(r => r.json())
  const { kept } = await upload(1), unused = await upload(2)
  assert.ok(existsSync(join(dir, 'world.fine', kept + '.gz.stage')))
  const motor = { front: 0, grip: 1, power: 20, top: 10, steer: 1, hover: 0, lift: 0, upright: 1, turns: 1, jump: 0, tough: 20, feet: [] }
  const controls = { scheme: 'drive', motor, fine: [{ size: [1, 1, 1], low: [0, 0, 0], per: 1, kept }] }
  assert.equal((await post({ as, by: 'owner', thing: { id: 'block', controls } })).status, 202)
  const file = join(dir, 'world.fine', kept + '.gz')
  for (let i = 0; i < 100 && !existsSync(file); i++) await new Promise(r => setTimeout(r, 50))
  assert.ok(existsSync(file))
  server.stop()
  server = await serve('/dev/null', args)
  assert.equal((await fetch(server.url + '/world/fine/' + unused.kept, { method: 'HEAD' })).status, 404)
  assert.equal((await fetch(server.url + '/world/fine/' + kept, { method: 'HEAD' })).status, 200)
  console.log('server security checks passed')
} finally { server.stop(); rmSync(dir, { recursive: true, force: true }) }
