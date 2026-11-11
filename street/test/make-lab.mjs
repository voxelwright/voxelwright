// What does a model make of a sentence (#118)? A real-model run, by hand: it spends the signed-in
// Claude Code's usage. For each sentence and model: the seconds it took, whether the answer
// passed the engine's checker and settled in a scratch world, how many tries, and the toy.
// Usage: node test/make-lab.mjs <out.json> <model[:effort]>[,<model>...] ["sentence" ...]
import { writeFileSync } from 'node:fs'
import { createServer } from 'vite'

const [out, models = 'sonnet', ...given] = process.argv.slice(2)
if (!out) throw new Error('Usage: node test/make-lab.mjs <out.json> <model[:effort]>[,...] ["sentence" ...]')
const sentences = given.length ? given : ['a big red dog', 'a pool noodle', 'a plank bridge to cross a gap six metres wide', 'a ladder', 'a comically large rubber duck', 'a park bench', 'a seesaw', 'a small car', 'a snowman', 'stairs up to a platform one and a half metres high']
const vite = await createServer({ root: new URL('..', import.meta.url).pathname, configFile: false, appType: 'custom', server: { middlewareMode: true, hmr: false, ws: false, watch: null, fs: { allow: ['..'] } }, optimizeDeps: { noDiscovery: true }, logLevel: 'warn' })
const rows = []
try {
  const { loadJolt } = await vite.ssrLoadModule('../home/src/engine/jolt.ts')
  const { registerBlock } = await vite.ssrLoadModule('/src/scene.ts')
  const { claudeMaker, make, plotFor } = await vite.ssrLoadModule('/src/make.ts')
  await loadJolt()
  registerBlock()
  const plot = plotFor([0, 0, -20], 0)
  let n = 0
  await Promise.all(models.split(',').map(async (spec) => {
    const [model, effort = 'low'] = spec.split(':')
    const maker = claudeMaker(model, effort)
    // Three sentences at a time for each model.
    const queue = [...sentences]
    await Promise.all([0, 1, 2].map(async () => {
      for (let text; (text = queue.shift());) {
        const t0 = performance.now()
        let row
        try {
          const { result, tries, calls } = await make(maker, text, plot, `made-${++n}`, AbortSignal.timeout(180_000))
          const toy = 'toy' in result ? result.toy : null
          row = { model: spec, text, seconds: +((performance.now() - t0) / 1000).toFixed(1), ok: Boolean(toy), tries, say: 'say' in result ? result.say : undefined, reason: 'reason' in result ? result.reason : undefined, clamped: toy ? result.clamped : undefined, parts: toy?.parts.length, pieces: toy?.parts.reduce((a, p) => a + (p.pieces?.length ?? 1), 0), outputTokens: calls.reduce((a, c) => a + (c.outputTokens ?? 0), 0), costUsd: calls.reduce((a, c) => a + (c.costUsd ?? 0), 0), toy, raw: toy ? undefined : calls.at(-1)?.raw.slice(0, 1500) }
        } catch (e) {
          row = { model: spec, text, seconds: +((performance.now() - t0) / 1000).toFixed(1), ok: false, reason: `the call failed: ${String(e?.message ?? e).slice(0, 200)}` }
        }
        rows.push(row)
        console.log(JSON.stringify({ ...row, toy: undefined, raw: undefined }))
      }
    }))
  }))
} finally {
  writeFileSync(out, JSON.stringify(rows, null, 1))
  await vite.close()
}
