// Whether one body can see another (#245, for #264). No page: the real server and world process, a rule that is no
// game (a watchman who says aloud whom he sees and who sees him), and someone in a seat who stands before him, has
// a wall built between, a window put in it, and stands behind his back.
//
//   node test/sees.mjs
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { serve } from './kit.mjs'

const server = await serve('/dev/null', ['--world', join(mkdtempSync(join(tmpdir(), 'engine-sees-')), 'world.log')])
const failures = []
const check = (ok, what) => { console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) failures.push(what) }
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const post = async (path, body) => { for (;;) { const r = await fetch(`${server.url}/world/${path}`, { method: 'POST', body: JSON.stringify(body) }); if (r.status === 429) { await wait(300); continue } return r.json().catch(() => ({})) } }
// The watchman stands in the street facing east and says what he is told; told to, he turns his back.
const RULE = `on('start', (world) => world.actor('watch', {name: 'Watchman', at: [700, 4083], face: [900, 4083]}))
on('tick', (world) => { const w = world.who('watch'), r = world.people.find((p) => p.kind === 'seat' && p.name === 'runner'); if (w && r) world.actor('watch', {say: (world.sees('watch', r.id) ? 'I see you' : 'nobody') + '; ' + (world.sees(r.id, 'watch') ? 'you see me' : 'unseen') + '; ' + (w.sees || []).length}) })
on('said', (world, e) => { if (/turn/.test(e.text)) world.actor('watch', {face: [500, 4083]}) })`
let since = 0
const says = async (ok) => { let text = ''; for (let i = 0; i < 40; i++) { const a = await (await fetch(`${server.url}/world/around?by=runner&since=${since}`)).json(); for (const h of a.heard ?? []) if (h.name === 'Watchman') { text = h.text; since = Math.max(since, h.n) } if (text && ok(text)) return text; await wait(250) } return `(last: ${text})` }
try {
  const ground = Math.round((await (await fetch(`${server.url}/world/at?x=760&y=0&z=4083`)).json()).ground)
  // Eight metres east of him, facing him.
  await post('join', { by: 'runner', at: [780, 4083] })
  await post('turn', { by: 'runner', yaw: -Math.PI / 2 })
  check((await post('ask', { by: 'tester', rule: { id: 'watch', name: 'A watchman', source: RULE } })).asked, 'a rule that says whom its actor sees is taken')
  const open = await says((t) => /^I see you; you see me; 1/.test(t))
  check(/^I see you; you see me/.test(open), `eight metres apart in the open street, facing each other, each sees the other ("${open}")`)
  // A brick wall across the street between them, 3 m high.
  const wall = (kind, y0, y1, z0, z1) => { const rows = []; for (let y = y0; y < y1; y++) for (let z = z0; z < z1; z++) rows.push(740, 742, y, z, kind); return post('ask', { by: 'tester', edit: [1, rows.length / 5, ...rows], release: [741, ground + 40, 4083] }) }
  await wall(8, ground, ground + 30, 4063, 4103)
  const hid = await says((t) => /^nobody; unseen; 0/.test(t))
  check(/^nobody; unseen/.test(hid), `a wall built between them, neither sees the other ("${hid}")`)
  // A window in it at eye height: glass is seen through.
  await wall(11, ground + 12, ground + 20, 4080, 4087)
  const glass = await says((t) => /^I see you; you see me/.test(t))
  check(/^I see you; you see me/.test(glass), `a window of glass put in the wall at the height of their eyes, they see each other through it ("${glass}")`)
  // Behind his back, four metres off: he does not see who he is not facing; they see him.
  await post('join', { by: 'runner', at: [660, 4083] })
  await post('turn', { by: 'runner', yaw: Math.PI / 2 })
  const behind = await says((t) => /^nobody; you see me/.test(t))
  check(/^nobody; you see me/.test(behind), `four metres behind his back, he does not see them and they see him ("${behind}")`)
  // He turns round.
  await post('say', { by: 'runner', text: 'turn' })
  const turned = await says((t) => /^I see you; you see me/.test(t))
  check(/^I see you; you see me/.test(turned), `he turns round, and sees them ("${turned}")`)
  // Right at his back he notices them whichever way he faces.
  await post('join', { by: 'runner', at: [718, 4083] })
  const near = await says((t) => /^I see you/.test(t))
  check(/^I see you/.test(near), `two metres behind him, they are noticed whichever way he faces ("${near}")`)
} catch (e) { failures.push(String(e.stack ?? e)) }
server.stop()
if (failures.length) { console.error(`FAILED\n  ${failures.join('\n  ')}`); process.exit(1) }
console.log('sees: ok')
process.exit(0)
