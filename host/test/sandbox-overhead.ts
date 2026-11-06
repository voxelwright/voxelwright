// Measures what srt adds to the candidate tools: tsc --noEmit and vite build,
// each run three times directly and three times under the build sandbox.
//
//   node test/sandbox-overhead.ts <repo with an installed home/>
import { join } from 'node:path'
import { exec } from '../src/proc.ts'
import { createSandbox } from '../src/sandbox.ts'

const repo = process.argv[2]
if (!repo) throw new Error('Usage: node test/sandbox-overhead.ts <repo>')
const home = join(repo, 'home')
const env = { PATH: `${join(process.execPath, '..')}:/usr/bin:/bin`, HOME: home }
const tools = [['tsc', ['--noEmit']], ['vite', ['build']]] as const
const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]

const sandbox = await createSandbox({ repo, network: 'none' })
const rows: Record<string, { directMs: number[]; srtMs: number[] }> = {}
try {
  for (const [tool, args] of tools) {
    const row: { directMs: number[]; srtMs: number[] } = (rows[tool] = { directMs: [], srtMs: [] })
    for (let i = 0; i < 3; i++) {
      const direct = await exec(join(home, 'node_modules/.bin', tool), [...args], { cwd: home, env, timeoutMs: 120_000 })
      const boxed = await sandbox.run(join(home, 'node_modules/.bin', tool), [...args], { cwd: home, timeoutMs: 120_000 })
      if (direct.code !== 0 || boxed.code !== 0) throw new Error(`${tool} failed: direct ${direct.code}, srt ${boxed.code} ${boxed.stderr.slice(-300)}`)
      row.directMs.push(direct.durationMs)
      row.srtMs.push(boxed.durationMs)
    }
  }
} finally {
  await sandbox.dispose()
}
for (const [tool, { directMs, srtMs }] of Object.entries(rows)) {
  console.log(`${tool}: direct ${directMs.join(', ')} ms; srt ${srtMs.join(', ')} ms; median added ${median(srtMs) - median(directMs)} ms`)
}
