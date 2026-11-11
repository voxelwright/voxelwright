// An agent sits down on the street (#118): a plain MCP client stands in for the agent's harness
// (no model is called). It arrives with a name, is told what is around it, walks, talks, builds a
// thing it wrote itself, asks the street's maker (a stand-in) for another, takes it back, falls
// into the trench and gets out. A page watches all of it, and hands out a key of its own.
// Usage: node test/agent.ts
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { Page } from 'playwright'
import { browser, sleep, startPage, startWorld } from './lib.ts'

const WT = 5433, PAGE = 5408
const dir = mkdtempSync(join(tmpdir(), 'street-agent-'))
const keyFile = join(dir, 'key')
const checks: boolean[] = []
const check = (name: string, pass: unknown, detail?: unknown) => { checks.push(Boolean(pass)); console.log(`${pass ? 'ok  ' : 'FAIL'} ${name}${pass || detail === undefined ? '' : ` ${JSON.stringify(detail).slice(0, 600)}`}`) }
const on = <T>(page: Page, body: string) => page.evaluate(`(async () => { const s = window.__street; return ${body} })()`) as Promise<T>
const until = async <T>(read: () => Promise<T>, good: (v: T) => boolean, ms = 8000) => { for (const t0 = Date.now(); ;) { const v = await read(); if (good(v) || Date.now() - t0 > ms) return v; await sleep(100) } }
const url = new URL(`http://127.0.0.1:${WT + 1}/mcp`)
async function agent(key: string) {
  const client = new Client({ name: 'street-check', version: '0' })
  await client.connect(new StreamableHTTPClientTransport(url, { requestInit: { headers: { Authorization: `Bearer ${key}` } } }))
  return async (name: string, args: Record<string, unknown> = {}) => {
    const r = await client.callTool({ name, arguments: args }) as { isError?: boolean; content: { text: string }[] }
    const text = r.content[0]?.text ?? ''
    let value: any = text
    try { value = JSON.parse(text) } catch { /* plain words */ }
    return { error: Boolean(r.isError), value }
  }
}

const vite = await startPage(PAGE, WT)
const chrome = await browser()
const world = await startWorld(WT, '--maker', 'stub', '--world', dir, '--crates', '24', '--balls', '0', '--agent-key-file', keyFile)
try {
  const page = await chrome.newPage({ viewport: { width: 900, height: 600 } })
  await page.goto(`http://localhost:${PAGE}/?name=Pat`)
  await page.waitForFunction('window.__street?.ready', undefined, { timeout: 20_000 })

  const refused = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer street_nope' }, body: '{}' })
  check('a call without a live key is refused with a bare 401', refused.status === 401 && !refused.headers.get('www-authenticate'), refused.status)
  check('the key file is the owner\'s alone', (statSync(keyFile).mode & 0o777) === 0o600, (statSync(keyFile).mode & 0o777).toString(8))
  const ada = await agent(readFileSync(keyFile, 'utf8'))

  const early = await ada('look')
  check('an agent that has not arrived is told to', early.error && /arrive/.test(String(early.value)), early)
  const arrived = await ada('arrive', { name: 'Ada' })
  const names = await until(() => on<Record<string, string>>(page, 's.names()'), (n) => Object.values(n).includes('Ada'))
  check('it arrives with a name the page reads over its head', !arrived.error && Object.values(names).includes('Ada') && Object.values(names).includes('Pat'), { arrived: arrived.value?.you, names })
  const look = await ada('look')
  check('it is told where it is, who is here and what is loose', look.value.you?.where === 'on the road' && look.value.you.at[1] < -20 && look.value.residents.some((r: { name: string }) => r.name === 'Pat') && /24 wooden crates/.test(look.value.loose), look.value)
  const still = (look.value.street ?? []) as { what: string; at: [number, number]; away: number }[]
  check('it is told what stands on the street: sixteen houses, lamps and trees, nearest first', still.filter((x) => /^No\. \d+, a .+ house$/.test(x.what)).length === 16 && still.some((x) => x.what === 'a street lamp') && still.some((x) => x.what === 'a tree') && still.every((x, n) => n === 0 || x.away >= still[n - 1].away), still.slice(0, 4))

  const walked = await ada('walk_to', { x: 5, z: -18 })
  const at = walked.value.you?.at ?? [0, 0]
  check('it walks to a point and says it arrived', walked.value.result === 'arrived' && Math.hypot(at[0] - 5, at[1] + 18) < 0.6, walked.value)
  await ada('say', { text: 'hello from Ada' })
  const heard = await until(() => on<{ text: string }[]>(page, 's.bubbles()'), (b) => b.some((x) => x.text === 'hello from Ada'))
  check('what it says the page reads', heard.some((x) => x.text === 'hello from Ada'), heard)
  await on(page, `s.say('hi Ada')`)
  const events = await ada('observe', { cursor: 0 })
  check('it hears what was said, from a cursor', events.value.events.some((e: { kind: string; who: string; text: string }) => e.kind === 'said' && e.who === 'Pat' && e.text === 'hi Ada') && events.value.cursor > 0, events.value)

  const guide = await ada('guide')
  check('the guide says how to write a thing', /pieces/.test(String(guide.value)) && /material/.test(String(guide.value)), String(guide.value).slice(0, 200))
  const stool = { label: 'Stool', gadgets: [], wires: [], parts: [{ id: 'stool', material: 'maple', motion: 'dynamic', mass: 4, at: [0, 0.02, 0], pieces: [{ shape: { kind: 'cylinder', halfHeight: 0.02, radius: 0.18 }, at: [0, 0.45, 0], paint: '#c98d5a' }, ...[[-0.12, -0.12], [0.12, -0.12], [-0.12, 0.12], [0.12, 0.12]].map(([x, z]) => ({ shape: { kind: 'cylinder', halfHeight: 0.215, radius: 0.02 }, at: [x, 0.215, z] }))] }] }
  await ada('face', { x: 5, z: 0 })
  const built = await ada('build', { toy: stool, say: 'A stool, by my own hand.' })
  const toys = await until(() => on<string[]>(page, 's.toys()'), (t) => t.includes(built.value.toy))
  check('a thing it wrote itself is built at once, for everyone', built.value.ok && toys.includes(built.value.toy), { built: built.value, toys })
  await sleep(2100)
  const bad = await ada('build', { toy: { ...stool, parts: [{ ...stool.parts[0], material: 'unobtainium' }] } })
  check('a thing that cannot be built is refused with the reason', bad.value.ok === false && /unobtainium/.test(bad.value.say), bad.value)
  await sleep(2100)
  const asked = await ada('make', { text: 'a crate of pears' })
  check('it may ask the street\'s maker too', asked.value.ok && /^made-/.test(asked.value.toy), asked.value)
  const undone = await ada('undo')
  const fewer = await until(() => on<string[]>(page, 's.toys()'), (t) => !t.includes(asked.value.toy))
  check('undo takes back its last thing', undone.value.removed === asked.value.toy && !fewer.includes(asked.value.toy) && fewer.includes(built.value.toy), { undone: undone.value, fewer })
  const seen = await ada('look')
  check('look lists what was made, by whom', seen.value.things.some((t: { id: string; by: string; what: string }) => t.id === built.value.toy && t.by === 'Ada' && t.what === 'Stool'), seen.value.things)

  const fell = await ada('walk_to', { x: 5, z: 6.5 })
  check('walking over the trench, it falls in and is told so', /in the trench/.test(fell.value.you?.where ?? ''), fell.value)
  const out = await ada('top')
  await sleep(600)
  const back = await ada('look')
  check('top takes it back up the hill', back.value.you.where === 'on the road' && back.value.you.at[1] < -20, { out: out.value, back: back.value.you })

  await on(page, 's.invite()')
  const command = await until(() => on<string>(page, 's.invitation()'), (c) => /Bearer street_/.test(c))
  check('a resident can ask for a key and is shown how to hand it over', /^claude mcp add --transport http street http:\/\/127\.0\.0\.1:\d+\/mcp --header "Authorization: Bearer street_[\w-]{20,}"$/.test(command), command.replace(/street_[\w-]+/, 'street_…'))
  const bo = await agent(/Bearer (street_[\w-]+)/.exec(command)![1])
  const second = await bo('arrive', { name: 'Bo' })
  const both = await until(() => on<Record<string, string>>(page, 's.names()'), (n) => Object.values(n).includes('Bo'))
  check('and that key seats a second agent', !second.error && Object.values(both).includes('Bo') && Object.values(both).includes('Ada'), both)
} catch (e) {
  check('ran to the end', false, String(e).split('\n').slice(0, 3))
} finally {
  await chrome.close()
  world.kill()
  vite.kill()
  rmSync(dir, { recursive: true, force: true })
}
console.log(`\n${checks.filter(Boolean).length}/${checks.length} passed`)
process.exit(checks.every(Boolean) ? 0 : 1)
