// A real agent as a resident (#118), by hand: it spends the signed-in Claude Code's usage. The
// `claude` CLI, on its owner's own login, is given a key to the street and one goal; a page
// watches and records. Writes <out>/clip.webm, stills and what the agent did.
// Usage: node test/resident.ts <out-dir> [agent-model] [maker]
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { planeAt } from '../src/ground.ts'
import { browser, sleep, startPage, startWorld } from './lib.ts'

const [out, model = 'sonnet', maker = 'sonnet', goal = 'cross'] = process.argv.slice(2)
if (!out) throw new Error('Usage: node test/resident.ts <out-dir> [agent-model] [maker] [cross|help|help:<name>|help:all]')
const helping = goal.startsWith('help'), whom = goal.split(':')[1]
mkdirSync(out, { recursive: true })
const WT = 5533, PAGE = 5418
const dir = mkdtempSync(join(tmpdir(), 'street-resident-'))
const keyFile = join(dir, 'key'), config = join(dir, 'mcp.json')
const vite = await startPage(PAGE, WT)
const world = await startWorld(WT, '--maker', maker, '--world', dir, '--crates', '48', '--balls', '10', '--agent-key-file', keyFile, ...(helping ? ['--problems'] : []))
world.stdout!.on('data', (d) => process.stdout.write(`[world] ${d}`))
// The key goes into a config file only the owner can read, and nowhere else.
writeFileSync(config, JSON.stringify({ mcpServers: { street: { type: 'http', url: `http://127.0.0.1:${WT + 1}/mcp`, headers: { Authorization: `Bearer ${readFileSync(keyFile, 'utf8')}` } } } }), { mode: 0o600 })
// `help` gives it no task of its own: only that some residents want something. Whether one is helped is the world's to say (solved.jsonl).
const prompt = helping ? [
  'You are Juno, a resident of the Block, a small shared street in a physical world. You have a body there through the "street" MCP server.',
  `Arrive as Juno and look around. ${whom === 'all' ? 'Help everyone who needs it, one after another.' : whom ? `${whom} needs help: help them.` : 'Help whoever needs it.'} Say out loud, briefly, what you are doing as you go, so the people watching can follow.`,
  `Stop when the street tells you that you have helped ${whom === 'all' ? 'all of them' : whom ?? 'someone'}, or when you have tried four different ways for the same person.`,
].join(' ') : [
  'You are Juno, a resident of the Block, a small shared street in a physical world. You have a body there through the "street" MCP server.',
  'Arrive as Juno and look around. Greet whoever is there. Then get yourself to the far side of the trench (anywhere with z greater than 12). You cannot jump it: make or build something to cross on, and check with look that it is in place before you walk over it.',
  'Say out loud, briefly, what you are doing as you go, so the people watching can follow. When you are across, say so and stop. If you fall in, get out and try another way.',
].join(' ')
const chrome = await browser()
try {
  const context = await chrome.newContext({ viewport: { width: 1280, height: 720 }, recordVideo: { dir: out, size: { width: 1280, height: 720 } } })
  const page = await context.newPage()
  await page.goto(`http://localhost:${PAGE}/?name=Pavlo`)
  await page.waitForFunction('window.__street?.ready', undefined, { timeout: 20_000 })
  // Watch from the kerb above the trench.
  await page.evaluate(`window.__street.camera(${JSON.stringify([-7, planeAt(-2) + 6.5, -7])}, ${JSON.stringify([1, planeAt(6) + 0.5, 6])})`)
  const env = { ...process.env }
  delete env.NODE_OPTIONS
  delete env.CLAUDECODE
  const t0 = Date.now()
  const claude = spawn('claude', ['-p', prompt, '--mcp-config', config, '--strict-mcp-config', '--allowedTools', 'mcp__street', '--output-format', 'json', '--model', model], { env, cwd: tmpdir(), stdio: ['ignore', 'pipe', 'pipe'] })
  let stdout = '', stderr = ''
  claude.stdout.on('data', (d) => (stdout += d))
  claude.stderr.on('data', (d) => (stderr += d))
  const code = await new Promise<number | null>((resolve) => { claude.on('exit', resolve); setTimeout(() => { claude.kill(); resolve(-1) }, 420_000) })
  const seconds = Math.round((Date.now() - t0) / 1000)
  await sleep(1500)
  await page.screenshot({ path: join(out, 'end.png') })
  let result: Record<string, unknown> = {}
  try { result = JSON.parse(stdout) } catch { /* not JSON: an error before the first turn */ }
  const stats = await (await fetch(`http://127.0.0.1:${WT + 1}/stats`)).json() as { lateMs: unknown }
  const solved = existsSync(join(dir, 'solved.jsonl')) ? readFileSync(join(dir, 'solved.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l)) : []
  const report = { model, maker, goal, exit: code, seconds, turns: result.num_turns, costUsd: result.total_cost_usd, said: result.result, solved, error: code === 0 ? undefined : stderr.slice(0, 600), lateMs: stats.lateMs }
  writeFileSync(join(out, 'report.json'), JSON.stringify(report, null, 1))
  console.log(JSON.stringify(report, null, 1))
  await context.close()
  const video = readdirSync(out).find((f) => f.endsWith('.webm') && f !== 'clip.webm')
  if (video) renameSync(join(out, video), join(out, 'clip.webm'))
} finally {
  await chrome.close()
  world.kill()
  vite.kill()
  rmSync(dir, { recursive: true, force: true })
}
