// #47 experiment runner: generate felt villagers from a description with `claude -p`,
// check each in headless Chrome against the dev server, allow one repair pass fed the error.
// Usage: node scripts/villagers/run.mjs <out-dir> [base-url] [--only spec-1,code-3] [--concurrency 5] [--model sonnet]
// Writes home/generated/villagers/<run-id>/ (git-ignored), <out-dir>/results.json and <out-dir>/voices.json.
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const here = dirname(fileURLToPath(import.meta.url))
const home = resolve(here, '../..')
const args = process.argv.slice(2)
const flag = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback)
const out = resolve(args[0])
const base = args[1] && !args[1].startsWith('--') ? args[1] : 'http://localhost:5330/'
const only = flag('--only', '')?.split(',').filter(Boolean)
const concurrency = Number(flag('--concurrency', 5))
const model = flag('--model', 'sonnet')
const cwd = flag('--cwd', join(out, 'claude-cwd'))
mkdirSync(cwd, { recursive: true })

/** Synthetic descriptions, each with its fixed owner. The accent is an input to generation, never the model's choice. */
export const DESCRIPTIONS = {
  1: { text: 'a patient old tortoise who keeps the family calendar and loves jazz', owner: 'Alex', accent: '#c8553d' },
  2: { text: 'a jittery little mouse who sorts the mail and never stops chattering', owner: 'Sam', accent: '#3d7cc8' },
  3: { text: 'a big gentle bear who cooks slow Sunday breakfasts and hums while working', owner: 'Alex', accent: '#c8553d' },
  4: { text: 'a tall, slightly strict heron who tutors the kids in maths', owner: 'Mia', accent: '#e0b53a' },
  5: { text: 'a cheerful round frog who waters the plants and tells terrible puns', owner: 'Sam', accent: '#3d7cc8' },
}
const style = readFileSync(join(here, 'style.md'), 'utf8')
const system = { code: `${style}\n${readFileSync(join(here, 'arm-code.md'), 'utf8')}`, spec: `${style}\n${readFileSync(join(here, 'arm-spec.md'), 'utf8')}` }
// The code arm's module is saved as text: it is only handed to the sandbox, and a fetched .js would join Vite's module graph and reload the page when rewritten.
const FILE = { spec: 'villager.json', code: 'villager.code.txt' }

function claude(systemPrompt, prompt) {
  return new Promise((done) => {
    const t0 = performance.now()
    const child = spawn('claude', ['-p', '--model', model, '--strict-mcp-config', '--tools', '', '--output-format', 'json', '--no-session-persistence', '--system-prompt', systemPrompt], { cwd, stdio: ['pipe', 'pipe', 'pipe'] })
    let stdout = '', stderr = ''
    child.stdout.on('data', (d) => (stdout += d))
    child.stderr.on('data', (d) => (stderr += d))
    child.on('close', (code) => {
      const wallMs = performance.now() - t0
      try {
        const j = JSON.parse(stdout)
        done({ wallMs, text: j.result ?? '', apiMs: j.duration_api_ms, outputTokens: j.usage?.output_tokens, costUsd: j.total_cost_usd, isError: j.is_error })
      } catch {
        done({ wallMs, text: '', error: `exit ${code}: ${stderr.slice(0, 300)}` })
      }
    })
    child.stdin.end(prompt)
  })
}

function extract(text, arm) {
  const blocks = [...text.matchAll(/```(\w*)\n([\s\S]*?)```/g)]
  const want = blocks.find((b) => (arm === 'code' ? /js|javascript|ts/.test(b[1]) : b[1] === 'json')) ?? blocks[0]
  return want ? want[2] : text
}

const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu', '--use-angle=metal'] })
const page = await browser.newPage({ viewport: { width: 640, height: 400 } })
await page.goto(`${base}?plugins=renderer,camera&q=low&villager=gen&gen=none`)
await page.waitForFunction(() => window.villagerGen, null, { timeout: 30000 })

async function verify(id, meta) {
  const dir = join(home, 'generated/villagers', id)
  writeFileSync(join(dir, 'meta.json'), JSON.stringify(meta))
  const t0 = performance.now()
  const r = await page.evaluate(([m, b]) => window.villagerGen.check(m, b), [meta, `/generated/villagers/${id}`])
  return { ...r, checkMs: performance.now() - t0 }
}

async function job({ arm, n }) {
  const id = `${arm}-${n}`
  const d = DESCRIPTIONS[n]
  const dir = join(home, 'generated/villagers', id)
  mkdirSync(dir, { recursive: true })
  const file = FILE[arm]
  const ask = `Make a villager: ${d.text}.\n\nIts owner is ${d.owner}; the owner's accent colour is ${d.accent}.`
  const meta = { arm, file, accent: d.accent, owner: d.owner, description: d.text }
  const first = await claude(system[arm], ask)
  writeFileSync(join(dir, 'raw.txt'), first.text)
  const body = extract(first.text, arm)
  writeFileSync(join(dir, file), body)
  const firstCheck = await verify(id, meta)
  const row = { id, arm, n, description: d.text, owner: d.owner, accent: d.accent, model, first: { ...first, text: undefined, check: firstCheck } }
  if (!firstCheck.ok) {
    const repairAsk = `${ask}\n\nYour previous file:\n\`\`\`${arm === 'code' ? 'js' : 'json'}\n${body}\n\`\`\`\n\nIt failed with this error:\n${firstCheck.error}\n\nReturn the corrected complete file.`
    const repair = await claude(system[arm], repairAsk)
    writeFileSync(join(dir, 'raw.repair.txt'), repair.text)
    const repairFile = file.replace('.', '.repair.')
    writeFileSync(join(dir, repairFile), extract(repair.text, arm))
    const repairCheck = await verify(id, { ...meta, file: repairFile })
    row.repair = { ...repair, text: undefined, check: repairCheck }
    if (!repairCheck.ok) writeFileSync(join(dir, 'meta.json'), JSON.stringify({ ...meta, file: repairFile, failed: true }))
  }
  console.log(id, (row.first.wallMs / 1000).toFixed(1), firstCheck.ok, row.repair ? `repair ${(row.repair.wallMs / 1000).toFixed(1)} ${row.repair.check.ok}` : '', firstCheck.error ?? '')
  return row
}

const jobs = []
for (const arm of ['spec', 'code']) for (const n of [1, 2, 3, 4, 5]) if (!only?.length || only.includes(`${arm}-${n}`)) jobs.push({ arm, n })
const resultsFile = join(out, 'results.json')
const results = existsSync(resultsFile) ? JSON.parse(readFileSync(resultsFile, 'utf8')) : {}
let next = 0
await Promise.all(Array.from({ length: concurrency }, async () => {
  while (next < jobs.length) {
    const row = await job(jobs[next++])
    results[row.id] = row
    writeFileSync(resultsFile, JSON.stringify(results, null, 1))
  }
}))

// Each result's voice for the voice builder: read back through the same checker the home uses.
const voices = []
for (const row of Object.values(results).sort((a, b) => a.id.localeCompare(b.id))) {
  const meta = JSON.parse(readFileSync(join(home, 'generated/villagers', row.id, 'meta.json'), 'utf8'))
  const v = await page.evaluate(([m, b]) => window.villagerGen.check(m, b), [meta, `/generated/villagers/${row.id}`])
  voices.push({ id: row.id, arm: row.arm, description: row.description, name: v.name ?? null, voice: v.voice ?? null })
}
writeFileSync(join(out, 'voices.json'), JSON.stringify(voices, null, 1))
await browser.close()
