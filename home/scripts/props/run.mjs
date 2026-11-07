// #42 experiment runner: generate props with `claude -p`, check each in headless
// Chrome against the dev server, allow one repair pass fed the error.
// Usage: node scripts/props/run.mjs <out-dir> [base-url] [--only a-haiku-p1,...] [--concurrency 5]
// Writes home/generated/props/<run-id>/ (git-ignored) and <out-dir>/results.json.
import { spawn } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const here = dirname(fileURLToPath(import.meta.url))
const home = resolve(here, '../..')
const args = process.argv.slice(2)
const flag = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback)
const out = resolve(args[0])
const base = args[1] && !args[1].startsWith('--') ? args[1] : 'http://localhost:5302/'
const only = flag('--only', '')?.split(',').filter(Boolean)
const concurrency = Number(flag('--concurrency', 5))
const cwd = flag('--cwd', join(out, 'claude-cwd'))
mkdirSync(cwd, { recursive: true })

export const PROMPTS = {
  1: 'a round dining table in light oak for four',
  2: 'two slatted pine chairs to go with it',
  3: 'a cozy reading armchair in green velvet with a small side table',
  4: 'striped wallpaper in warm cream and sage for the back wall',
  5: 'a small tabletop pinball machine',
}
// Placement notes, identical for both arms.
const NOTES = {
  1: 'It stands in open floor space in the kitchen.',
  2: 'Make both chairs as one prop, standing around a round table about 1.1 m across centred at the origin (the table is not part of your prop).',
  3: 'Make both pieces as one prop, standing together in a corner.',
  4: 'Make it a thin wall-covering panel about 1.2 m wide and 2.6 m tall, standing on y = 0 and facing +z.',
  5: 'It stands on a kitchen counter.',
}
const style = readFileSync(join(here, 'style.md'), 'utf8')
const system = { code: `${style}\n${readFileSync(join(here, 'arm-code.md'), 'utf8')}`, spec: `${style}\n${readFileSync(join(here, 'arm-spec.md'), 'utf8')}` }

function claude(model, systemPrompt, prompt) {
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
  const want = blocks.find((b) => (arm === 'code' ? /ts|typescript|js/.test(b[1]) : b[1] === 'json')) ?? blocks[0]
  return want ? want[2] : text
}

const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu', '--use-angle=metal'] })
const page = await browser.newPage({ viewport: { width: 640, height: 400 } })
await page.goto(`${base}?plugins=renderer,camera&q=low&props=none`)
await page.waitForFunction(() => window.villageProps, null, { timeout: 30000 })

async function verify(id, arm, prompt, file) {
  const dir = join(home, 'generated/props', id)
  writeFileSync(join(dir, 'meta.json'), JSON.stringify({ arm, prompt, file }))
  if (arm === 'spec') {
    try {
      JSON.parse(readFileSync(join(dir, file), 'utf8'))
    } catch (e) {
      return { ok: false, error: `JSON.parse: ${e.message}` }
    }
  }
  const t0 = performance.now()
  const r = await page.evaluate(([meta, b]) => window.villageProps.check(meta, b), [{ arm, prompt, file }, `/generated/props/${id}`])
  return { ...r, checkMs: performance.now() - t0 }
}

async function job({ arm, model, prompt }) {
  const id = `${arm === 'code' ? 'a' : 'b'}-${model}-p${prompt}`
  const dir = join(home, 'generated/props', id)
  mkdirSync(dir, { recursive: true })
  const ext = arm === 'code' ? 'ts' : 'json'
  const ask = `${PROMPTS[prompt]}\n\n${NOTES[prompt]}`
  const first = await claude(model, system[arm], ask)
  writeFileSync(join(dir, `raw.txt`), first.text)
  const body = extract(first.text, arm)
  writeFileSync(join(dir, `prop.${ext}`), body)
  const firstCheck = await verify(id, arm, prompt, `prop.${ext}`)
  const row = { id, arm, model, prompt, first: { ...first, text: undefined, check: firstCheck } }
  if (!firstCheck.ok) {
    const repairAsk = `${ask}\n\nYour previous file:\n\`\`\`${ext}\n${body}\n\`\`\`\n\nIt failed with this error:\n${firstCheck.error}\n\nReturn the corrected complete file.`
    const repair = await claude(model, system[arm], repairAsk)
    writeFileSync(join(dir, `raw.repair.txt`), repair.text)
    writeFileSync(join(dir, `prop.repair.${ext}`), extract(repair.text, arm))
    const repairCheck = await verify(id, arm, prompt, `prop.repair.${ext}`)
    row.repair = { ...repair, text: undefined, check: repairCheck }
    if (!repairCheck.ok) writeFileSync(join(dir, 'meta.json'), JSON.stringify({ arm, prompt, file: `prop.repair.${ext}`, failed: true }))
  }
  console.log(id, row.first.wallMs.toFixed(0), firstCheck.ok, row.repair ? `repair ${row.repair.wallMs.toFixed(0)} ${row.repair.check.ok}` : '', firstCheck.error ?? '')
  return row
}

const jobs = []
for (const arm of ['spec', 'code']) for (const model of ['haiku', 'sonnet', 'opus']) for (const prompt of [1, 2, 3, 4, 5]) {
  const id = `${arm === 'code' ? 'a' : 'b'}-${model}-p${prompt}`
  if (!only?.length || only.includes(id)) jobs.push({ arm, model, prompt })
}
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
await browser.close()
