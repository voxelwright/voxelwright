// A problem on the street (#118), end to end with a stand-in maker: three residents want
// something; one of them, Mabel, wants to be across the trench. A page asks for a bridge; she
// walks over it herself; the world sees her body past the line and says it is solved, to the
// page and to an agent; after the rest the bridge is swept and she wants it again. Before that
// she is told to try with nothing there, and falls in. Usage: node test/problem.ts [pictures/]
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { GRADE, TRENCH } from '../src/ground.ts'
import { browser, sleep, startPage, startWorld } from './lib.ts'

const out = process.argv[2]
if (out) mkdirSync(out, { recursive: true })
const WT = 5713, PAGE = 5518, LEN = Math.hypot(1, GRADE), REST = 7
const dir = mkdtempSync(join(tmpdir(), 'street-problem-'))
const keyFile = join(dir, 'key')
const bad: string[] = []
const check = (what: string, ok: unknown, seen?: unknown) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${ok || seen === undefined ? '' : ` ${JSON.stringify(seen).slice(0, 500)}`}`); if (!ok) bad.push(what) }
const vite = await startPage(PAGE, WT)
const world = await startWorld(WT, '--maker', 'stub', '--problems', '--rest', String(REST), '--world', dir, '--crates', '0', '--balls', '0', '--agent-key-file', keyFile)
const chrome = await browser()
try {
  const page = await chrome.newPage({ viewport: { width: 1280, height: 720 } })
  const s = <T>(body: string) => page.evaluate(`(async () => { const s = window.__street; return ${body} })()`) as Promise<T>
  const until = async <T>(read: () => Promise<T>, good: (v: T) => boolean, ms: number) => { for (const t0 = Date.now(); ;) { const v = await read(); if (good(v) || Date.now() - t0 > ms) return v; await sleep(100) } }
  const at = () => s<number[]>('s.shownOf(s.you)')
  await page.goto(`http://localhost:${PAGE}/?name=Pavlo`)
  await page.waitForFunction('window.__street?.ready', undefined, { timeout: 30_000 })
  await sleep(700)
  const wants = await s<Record<string, string>>('s.wants()')
  check('three residents each want something, in words over their heads', Object.keys(wants).sort().join() === 'Ines,Mabel,Otis' && /walk across/.test(wants.Mabel) && /climb/.test(wants.Otis) && /shade/.test(wants.Ines), wants)
  const home = await s<number[]>(`s.whereIs('Mabel')`)

  // An agent is told the same.
  const client = new Client({ name: 'street-check', version: '0' })
  await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${WT + 1}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${readFileSync(keyFile, 'utf8')}` } } }))
  const call = async (name: string, args: Record<string, unknown> = {}) => JSON.parse(((await client.callTool({ name, arguments: args })) as { content: { text: string }[] }).content[0].text)
  await call('arrive', { name: 'Ada' })
  const look = await call('look')
  check('an agent is told who wants what and where', look.wanted?.length === 3 && look.wanted.some((w: { who: string; wants: string }) => w.who === 'Mabel' && /walk across/.test(w.wants)), look.wanted)

  // To the middle of the road and down to a couple of metres above the trench.
  await s(`s.hold('KeyD', true)`)
  await until(at, (p) => p[0] < 0.3, 6000)
  await s(`s.hold('KeyD', false)`)
  await s(`s.hold('KeyW', true)`)
  await until(at, (p) => p[2] > (TRENCH.from - 1.6) / LEN, 12_000)
  await s(`s.hold('KeyW', false)`)
  await sleep(500)

  // Told to try with nothing to walk on, she does, falls in, and is back at her place.
  await s(`s.say('Go on, try it')`)
  const fell = await until(() => s<{ text: string }[]>('s.bubbles()'), (b) => b.some((x) => /Oof/.test(x.text)), 15_000)
  check('told to try with nothing there, she walks in and falls', fell.some((x) => /Oof/.test(x.text)), fell)
  const again = await until(() => s<number[]>(`s.whereIs('Mabel')`), (p) => Math.hypot(p[0] - home[0], p[2] - home[2]) < 0.6 && p[1] > home[1] - 0.5, 8000)
  check('and is back at her place a moment later, still wanting', Math.hypot(again[0] - home[0], again[2] - home[2]) < 0.6 && (await s<Record<string, string>>('s.wants()')).Mabel, again)

  await s(`s.make('a bridge')`)
  const said = await until(() => s<string>('s.notice()'), (n) => !!n, 30_000)
  check('she walks over the bridge herself and everyone is told who helped and with what', said === 'Pavlo got Mabel across the trench with Plank bridge', said)
  if (out) { await sleep(500); await page.screenshot({ path: join(out, '1-solved.png') }) }
  const across = await s<number[]>(`s.whereIs('Mabel')`)
  check('her body is past the trench, on the road', across[2] > TRENCH.to / LEN + 1 && across[1] > -GRADE * across[2] - 0.5, across)
  check('she no longer wants it; the others still do', Object.keys(await s<Record<string, string>>('s.wants()')).sort().join() === 'Ines,Otis')
  const record = readFileSync(join(dir, 'solved.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l))
  check('the world wrote down who solved what with what', record.length === 1 && record[0].problem === 'across' && record[0].solver === 'Pavlo' && record[0].with === 'Plank bridge', record)
  const events = await call('observe', { seconds: 0 })
  check('an agent hears that it was solved', JSON.stringify(events).includes('got Mabel across the trench'), events)

  // After the rest the way is cleared and she wants it again, back where she stood.
  const reopened = await until(() => s<Record<string, string>>('s.wants()'), (w) => !!w.Mabel, (REST + 6) * 1000)
  await sleep(600)
  const back = await s<number[]>(`s.whereIs('Mabel')`), toys = await s<string[]>('s.toys()')
  check('after the rest the bridge is swept, she is back and wants it again', reopened.Mabel && Math.hypot(back[0] - home[0], back[2] - home[2]) < 0.6 && !toys.some((t) => t.startsWith('made-')), { reopened: Object.keys(reopened), back, toys: toys.filter((t) => t.startsWith('made-')) })
  check('the page acted on every line', (await s<number>('s.stats().unread')) === 0)
  if (out) await page.screenshot({ path: join(out, '2-again.png') })
} finally {
  await chrome.close()
  world.kill()
  vite.kill()
  rmSync(dir, { recursive: true, force: true })
}
if (bad.length) { console.log(`FAILED: ${bad.join('; ')}`); process.exit(1) }
console.log('the problem is asked, solved, told and asked again')
