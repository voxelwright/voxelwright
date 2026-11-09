// Routing accuracy and latency on 15 written lines, for one model or several (#42).
// node test/route-bench.ts haiku sonnet > out.json   (real model calls on the operator's login)
import { checkRouted, claudeRouter } from '../src/villager-input.ts'

const LINES: [string, string, string?][] = [
  ['I want to chat with Moss', 'talk', 'mia'],
  ["what's the status of my pinball project? let's keep working on it", 'answer'],
  ['did we have any messages from the school?', 'answer'],
  ['add a couple of chairs around the table', 'furnish'],
  ['wallpaper here, something with sage stripes', 'furnish'],
  ['replace the table with a round oak one', 'furnish'],
  ["let's add a playable pinball machine in the living room", 'project'],
  ['open my journal', 'journal'],
  ["show me Tuft's tasks", 'journal', 'sam'],
  ['ask Tuft whether the toys are tidied', 'talk', 'sam'],
  ['what should we cook tonight?', 'answer'],
  ['another chair like that, please', 'furnish'],
  ['put the green armchair in the living room', 'furnish'],
  ['build a little train set that really runs around the kitchen', 'project'],
  ["I'm feeling a bit tired today", 'answer'],
]
const villagers = [{ id: 'alex', name: 'Dumpling', role: 'cook' }, { id: 'sam', name: 'Tuft', role: 'tidier' }, { id: 'mia', name: 'Moss', role: 'gardener' }]
const library = [{ id: 'a1b2c3d4e5f6', name: 'green velvet armchair' }]
const out: unknown[] = []
for (const model of process.argv.slice(2)) {
  const router = claudeRouter(model)
  for (const [text, expected, to] of LINES) {
    const t0 = performance.now()
    try {
      const call = await router({ name: 'Alex', primary: 'Dumpling', text, villagers, library, signal: AbortSignal.timeout(60_000) })
      const ms = Math.round(performance.now() - t0)
      const checked = checkRouted(call.raw, villagers.map((v) => v.id), library)
      const got = 'routed' in checked ? checked.routed : null
      const ok = got?.route === expected && (!to || got.to === to)
      out.push({ model, text, expected, to, got, ok, ms, apiMs: call.apiMs, outputTokens: call.outputTokens, costUsd: call.costUsd })
      console.error(model, ok ? 'ok ' : 'MISS', ms, text, JSON.stringify(got))
    } catch (error) {
      out.push({ model, text, expected, ok: false, error: String(error) })
      console.error(model, 'ERR', text, String(error))
    }
  }
}
console.log(JSON.stringify(out, null, 1))
