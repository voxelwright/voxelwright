// #47 experiment runner: generate felt villagers from a description with `claude -p`,
// check each in headless Chrome against the dev server, allow one repair pass fed the error.
// Usage: node scripts/villagers/run.mjs <out-dir> [base-url] [--set round1|readability] [--arms spec,code] [--prefix r2-]
//        [--only spec-1,code-3] [--concurrency 5] [--model sonnet]
// Writes home/generated/villagers/<prefix><run-id>/ (git-ignored), <out-dir>/results.json and <out-dir>/voices.json.
// Round 2: the role is given with the request, the description's mapped voice is the starting voice,
// and assemble.ts's checks (gen/checks.ts) refuse a hidden face, a floating part, a tiny prop or odd proportions.
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
const set = flag('--set', 'round1')
const arms = flag('--arms', 'spec,code').split(',')
const prefix = flag('--prefix', '')
const cwd = flag('--cwd', join(out, 'claude-cwd'))
mkdirSync(cwd, { recursive: true })

/** Synthetic descriptions, each with its fixed owner and role. The accent is an input to generation, never the model's choice. */
export const SETS = JSON.parse(readFileSync(join(here, 'descriptions.json'), 'utf8'))
const DESCRIPTIONS = SETS[set]
/** Synthetic owner profiles: who may get crude humour (templates.ts gatePersona). */
const PROFILES = SETS.profiles ?? {}
// Templates for the ask, read from the source so the prompt and the merge use the same data.
const TEMPLATES = Object.fromEntries((await import('../../src/villagers/gen/templates.ts').catch(() => null))?.BUILTIN_TEMPLATES?.map((t) => [t.id, t]) ?? [])
if (!DESCRIPTIONS) throw new Error(`no description set "${set}"`)
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

// The description's mapped voice (src/voice/gen.ts), given to the model as its starting voice.
const mapVoice = (text) => page.evaluate(async (t) => (await import('/src/voice/gen.ts')).voiceFromDescription(t), text)
const round = (v) => Object.fromEntries(Object.entries(v).map(([k, x]) => [k, Math.round(x * 100) / 100]))

async function job({ arm, n }) {
  const id = `${prefix}${set === 'round1' ? `${arm}-` : ''}${n}`
  const d = DESCRIPTIONS[n]
  const dir = join(home, 'generated/villagers', id)
  mkdirSync(dir, { recursive: true })
  const file = FILE[arm]
  const mapped = round(await mapVoice(d.text))
  const template = d.template ? TEMPLATES[d.template] : null
  if (d.template && !template) throw new Error(`no template "${d.template}"`)
  const ask = `Make a villager: ${d.text}.\n\nIts role is ${d.role}. Its owner is ${d.owner}; the owner's accent colour is ${d.accent}.\n\nStarting voice, from the description: ${JSON.stringify(mapped)}`
    + (template ? `\n\nPersonality template "${template.name}": ${JSON.stringify(template.persona)}` : '')
  const meta = { arm, file, accent: d.accent, owner: d.owner, role: d.role, description: d.text, profile: PROFILES[d.owner] ?? null, ...(d.template ? { template: d.template } : {}) }
  const first = await claude(system[arm], ask)
  writeFileSync(join(dir, 'raw.txt'), first.text)
  const body = extract(first.text, arm)
  writeFileSync(join(dir, file), body)
  const firstCheck = await verify(id, meta)
  const row = { id, arm, n, description: d.text, owner: d.owner, accent: d.accent, role: d.role, template: d.template ?? null, profile: meta.profile, mappedVoice: mapped, model, first: { ...first, text: undefined, check: firstCheck } }
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
for (const arm of arms) for (const n of Object.keys(DESCRIPTIONS)) if (!only?.length || only.includes(`${arm}-${n}`) || only.includes(n)) jobs.push({ arm, n })
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
  voices.push({ id: row.id, arm: row.arm, description: row.description, role: row.role, declaredRole: v.role ?? null, name: v.name ?? null, voice: v.voice ?? null })
  row.persona = v.persona ?? null
  row.bark = v.bark ?? null
}
writeFileSync(join(out, 'voices.json'), JSON.stringify(voices, null, 1))
writeFileSync(resultsFile, JSON.stringify(results, null, 1))
// Personas, for checking that every one is adult, specific and different.
const cell = (x) => String(x ?? '').replace(/\|/g, '/')
writeFileSync(join(out, 'personas.md'), [
  '| id | name | role | template / profile | persona role | speciality | temperament | register | humour | warmth / playful / chatty | humour dial | quirks | topics | bark |',
  '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
  ...Object.values(results).sort((a, b) => a.id.localeCompare(b.id)).map((r) => {
    const p = r.persona
    const who = `${r.template ?? '-'} / ${r.profile ? (r.profile.adult ? `adult${r.profile.crudeOptIn ? ', crude opt-in' : ''}` : 'child') : 'unknown'}`
    if (!p) return `| ${r.id} | | ${r.role ?? ''} | ${who} | (no persona) | | | | | | | | | ${cell(r.bark)} |`
    return `| ${r.id} | ${cell(voices.find((v) => v.id === r.id)?.name)} | ${r.role ?? ''} | ${who} | ${cell(p.role)} | ${cell(p.speciality)} | ${p.temperament} | ${p.register} | ${p.humour} | ${p.dials.warmth} / ${p.dials.playful} / ${p.dials.chatty} | ${p.dials.humour} | ${p.quirks.map(cell).join('; ')} | ${p.topics.map(cell).join('; ')} | ${cell(r.bark)} |`
  }),
].join('\n') + '\n')
await browser.close()
