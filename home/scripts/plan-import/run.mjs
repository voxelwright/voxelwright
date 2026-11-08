// Sends each plan image to a Claude model through the official CLI and keeps the validated result.
// Usage: node scripts/plan-import/run.mjs <model> <tag> [plan ids...]
//   e.g. node scripts/plan-import/run.mjs sonnet sonnet a b c d e f
// Writes out/runs/<tag>/<plan>.json. One repair pass with the validator's reasons is allowed.
import { spawn } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { SYSTEM, PROMPT, repairPrompt } from './prompt.mjs'
import { extractJson, validate } from './validate.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const [model, tag, ...ids] = process.argv.slice(2)
if (!model || !tag) { console.error('usage: run.mjs <model> <tag> [plan ids]'); process.exit(2) }
const plans = ids.length ? ids : ['a', 'b', 'c', 'd', 'e', 'f']
const outDir = join(here, 'out', 'runs', tag)
await mkdir(outDir, { recursive: true })
await writeFile(join(here, 'out', 'empty-mcp.json'), '{"mcpServers":{}}')

// One isolated, tool-less CLI turn: image + text in, final result line out.
function ask(png, text) {
  const msg = { type: 'user', message: { role: 'user', content: [
    { type: 'image', source: { type: 'base64', media_type: 'image/png', data: png.toString('base64') } },
    { type: 'text', text },
  ] } }
  const args = ['-p', '--model', model, '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose',
    '--tools', '', '--no-session-persistence', '--strict-mcp-config', '--mcp-config', join(here, 'out', 'empty-mcp.json'),
    '--setting-sources', '', '--disable-slash-commands', '--system-prompt', SYSTEM]
  return new Promise((resolve, reject) => {
    const t0 = Date.now()
    const p = spawn('claude', args, { cwd: outDir, stdio: ['pipe', 'pipe', 'pipe'] })
    let out = '', err = ''
    p.stdout.on('data', (d) => (out += d)); p.stderr.on('data', (d) => (err += d))
    p.on('close', (code) => {
      const last = out.trim().split('\n').map((l) => { try { return JSON.parse(l) } catch { return null } }).filter((l) => l?.type === 'result').at(-1)
      if (!last) return reject(new Error(`claude exited ${code} without a result: ${err.slice(0, 300)}`))
      if (last.is_error) return reject(new Error(`claude error: ${String(last.result).slice(0, 300)}`))
      resolve({ text: last.result, wallMs: Date.now() - t0, cost: last.total_cost_usd, models: Object.keys(last.modelUsage || {}), usage: last.usage })
    })
    p.stdin.end(JSON.stringify(msg) + '\n')
  })
}

function check(text) {
  try { const data = extractJson(text); return { data, ...validate(data) } }
  catch (e) { return { data: null, ok: false, reasons: [`unparseable: ${e.message}`] } }
}

for (const id of plans) {
  const png = await readFile(join(here, 'out', 'plans', `${id}.png`))
  const record = { plan: id, model, attempts: [] }
  try {
    const first = await ask(png, PROMPT)
    let res = check(first.text)
    record.attempts.push({ ...first, ok: res.ok, reasons: res.reasons })
    record.validFirstTry = res.ok
    if (!res.ok) {
      const second = await ask(png, repairPrompt(first.text.slice(0, 60000), res.reasons))
      res = check(second.text)
      record.attempts.push({ ...second, ok: res.ok, reasons: res.reasons })
    }
    record.valid = res.ok
    record.result = res.data
  } catch (e) {
    record.error = String(e.message || e)
  }
  record.wallMs = record.attempts.reduce((s, a) => s + a.wallMs, 0)
  record.cost = record.attempts.reduce((s, a) => s + (a.cost || 0), 0)
  await writeFile(join(outDir, `${id}.json`), JSON.stringify(record, null, 1))
  console.log(tag, id, record.error ? `ERROR ${record.error}` : `valid=${record.valid} first=${record.validFirstTry}`, `${(record.wallMs / 1000).toFixed(1)}s`, `$${record.cost.toFixed(3)}`,
    record.attempts.map((a) => a.reasons?.slice(0, 3).join('; ')).filter(Boolean).join(' | '))
}
