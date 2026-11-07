// #42 experiment: a fresh `claude -p --model opus` scorer per result, given only
// the two captures and the two questions. Usage: node scripts/props/score.mjs <out-dir>
import { spawn } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const out = resolve(process.argv[2])
const shots = join(out, 'shots')
const results = JSON.parse(readFileSync(join(out, 'results.json'), 'utf8'))
const PROMPTS = { 1: 'a round dining table in light oak for four', 2: 'two slatted pine chairs to go with it (a round dining table)', 3: 'a cozy reading armchair in green velvet with a small side table', 4: 'striped wallpaper in warm cream and sage for the back wall', 5: 'a small tabletop pinball machine' }
const schema = JSON.stringify({ type: 'object', properties: { belongs: { type: 'integer' }, asked: { type: 'integer' }, reason: { type: 'string' } }, required: ['belongs', 'asked', 'reason'] })

function score(id, prompt) {
  const ask = `Read the images ${shots}/${id}-iso.jpg and ${shots}/${id}-close.jpg. They show a home scene with one newly added item, the one the close view centres on. The person asked for: "${PROMPTS[prompt]}". Score each 1-10: belongs = does the new item look like it belongs in this painterly home? asked = is it what was asked? Give one short reason.`
  return new Promise((done) => {
    const child = spawn('claude', ['-p', '--model', 'opus', '--strict-mcp-config', '--tools', 'Read', '--allowedTools', 'Read', '--add-dir', shots, '--output-format', 'json', '--no-session-persistence', '--json-schema', schema], { cwd: shots })
    let s = ''
    child.stdout.on('data', (d) => (s += d))
    child.on('close', () => {
      try {
        const j = JSON.parse(s)
        done({ ...j.structured_output, costUsd: j.total_cost_usd })
      } catch {
        done({ error: s.slice(0, 200) })
      }
    })
    child.stdin.end(ask)
  })
}

const ids = Object.keys(results).filter((id) => results[id].capture?.report?.ok)
let next = 0
await Promise.all(Array.from({ length: 5 }, async () => {
  while (next < ids.length) {
    const id = ids[next++]
    results[id].score = await score(id, results[id].prompt)
    console.log(id, JSON.stringify(results[id].score))
  }
}))
writeFileSync(join(out, 'results.json'), JSON.stringify(results, null, 1))
