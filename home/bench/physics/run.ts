// Runs every scene on every candidate and prints Markdown tables. See README.md.
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { gzipSync } from 'node:zlib'
import { createRequire } from 'node:module'
import type { PhysicsCore } from './core.ts'
import { createRapier, loadRapier } from './rapier.ts'
import { createJolt, loadJolt } from './jolt.ts'
import { createXpbd } from './xpbd.ts'
import { bounceShots, bumperShots, flipperShots, heightfieldScene, pinballShots, scaleScene } from './scenes.ts'

const quick = process.argv.includes('--quick')
const SHOTS = quick ? 200 : 1000
await loadRapier()
await loadJolt()
const f = (x: number, d = 3) => (Number.isFinite(x) ? x.toFixed(d) : '-')
const out = (s = '') => console.log(s)

type Make = () => PhysicsCore
const engines: [string, Make, number[], boolean][] = [
  ['rapier 0.21.0', createRapier, [1, 2, 4, 8, 16], true],
  ['jolt 1.1.1', () => createJolt(), [1, 2, 4, 8, 16], true],
  ['xpbd (TS)', () => createXpbd(), [4, 8, 12, 16, 24], false],
]
const best: Record<string, { substeps: number; ccd: boolean }> = {
  'rapier 0.21.0': { substeps: 1, ccd: true },
  'jolt 1.1.1': { substeps: 1, ccd: true },
  'xpbd (TS)': { substeps: 16, ccd: false },
}

out(`## Pinball tunnelling (${SHOTS} random shots at 10 m/s, 27 mm ball, 5 mm walls, 45 frames each)`)
out()
out('| engine | ccd | substeps | tunnelled | ms per 60 Hz frame |')
out('|---|---|---|---|---|')
for (const [name, make, subs, hasCcd] of engines) {
  const configs = subs.map(s => ({ substeps: s, ccd: false }))
  if (hasCcd) configs.push({ substeps: 1, ccd: true })
  for (const cfg of configs) {
    const c = make(); c.setRules(cfg)
    const r = pinballShots(c, SHOTS, 10)
    out(`| ${name} | ${cfg.ccd ? 'on' : 'off'} | ${cfg.substeps} | ${r.tunneled} | ${f(r.msPerFrame, 4)} |`)
    c.dispose()
  }
}
out()
out('## Pinball at the best setting per engine')
out()
out('| engine | setting | tunnelled at 25 m/s | bounce out/in (expect 0.50) | bumper contacts seen | ball speed after bumper kick (m/s) | impulse at bumper (N·s) | flipper launch speed median / min (m/s) | flipper tunnelled | deterministic rerun |')
out('|---|---|---|---|---|---|---|---|---|---|')
for (const [name, make] of engines) {
  const cfg = best[name]
  // Every world is disposed after use: Jolt worlds hold their own wasm heap.
  const use = <T,>(fn: (c: PhysicsCore) => T): T => { const c = make(); c.setRules(cfg); const r = fn(c); c.dispose(); return r }
  const fast = use(c => pinballShots(c, SHOTS / 2, 25, 9))
  const bounce = use(c => bounceShots(c, 100))
  const bump = use(c => bumperShots(c, 200))
  const flip = use(c => flipperShots(c, 200))
  const d1 = use(c => pinballShots(c, 50, 10, 5).final), d2 = use(c => pinballShots(c, 50, 10, 5).final)
  const same = d1.every((x, i) => Object.is(x, d2[i]))
  out(`| ${name} | ${cfg.ccd ? 'ccd, ' : ''}${cfg.substeps} substep${cfg.substeps > 1 ? 's' : ''} | ${fast.tunneled}/${SHOTS / 2} | ${f(bounce.median)} | ${bump.detected}/${bump.shots} | ${f(bump.outMean, 2)} ± ${f(bump.outSd, 2)} | ${f(bump.impulseMedian)} | ${f(flip.speedMedian, 2)} / ${f(flip.speedMin, 2)} | ${flip.tunneled}/200 | ${same ? 'identical' : 'differs'} |`)
}

out()
out('## Scale: 180 dynamic boxes + 20 kinematic capsule villagers, 60 Hz, node, single thread')
out()
out('| engine | setting | step median ms | step p95 ms | boxes lost | new contacts reported | 50 sphere overlap queries, ms |')
out('|---|---|---|---|---|---|---|')
const scaleRuns: [string, string, Make, Partial<{ substeps: number }>][] = [
  ['rapier 0.21.0', '1 step, events on', createRapier, {}],
  ['jolt 1.1.1', '1 step, JS contact listener', () => createJolt(), {}],
  ['jolt 1.1.1', '1 step, no listener', () => createJolt({ listener: false }), {}],
  ['rapier 0.21.0', '4 steps', createRapier, { substeps: 4 }],
  ['jolt 1.1.1', '4 collision steps, listener', () => createJolt(), { substeps: 4 }],
  ['xpbd (TS)', '8 substeps', () => createXpbd(), { substeps: 8 }],
  ['xpbd (TS)', '4 substeps', () => createXpbd(), { substeps: 4 }],
]
for (const [name, setting, make, rules] of scaleRuns) {
  const c = make(); c.setRules(rules)
  const r = scaleScene(c, { warm: 120, frames: quick ? 200 : 600, overlapQueries: 50 })
  c.dispose()
  out(`| ${name} | ${setting} | ${f(r.median)} | ${f(r.p95)} | ${r.fallen} | ${r.contactsSeen} | ${f(r.queryMedian)} |`)
}

out()
out('## Heightfield 128x128 (32 m), 40 resting 0.5 m boxes, 9 on the edited area')
out()
out('| engine | asleep before | placed right | 16x16 raise ms | awake after raise | right after raise | 48x48 crater ms | awake after crater | right after crater | others still right |')
out('|---|---|---|---|---|---|---|---|---|---|')
const hfRuns: [string, Make][] = [
  ['rapier 0.21.0 (collider rebuilt)', createRapier],
  ['jolt 1.1.1 (SetHeights + wake box)', () => createJolt()],
  ['jolt 1.1.1 (SetHeights, no wake)', () => createJolt({ wakeOnEdit: false })],
  ['xpbd (TS)', () => { const c = createXpbd(); c.setRules({ substeps: 8 }); return c }],
]
for (const [name, make] of hfRuns) {
  const c = make()
  const r = heightfieldScene(c)
  c.dispose()
  out(`| ${name} | ${r.sleptBefore}/${r.total} | ${r.mappingOk}/${r.total} | ${f(r.raiseMs)} | ${r.awakeAfterRaise}/9 | ${r.raiseOk}/9 | ${f(r.craterMs)} | ${r.awakeAfterCrater}/9 | ${r.craterOk}/9 | ${r.outsideOk}/31 |`)
}

out()
out('## Size and load (node, median of 5 cold processes)')
out()
out('| engine | raw wasm | wasm gzip | shipped JS module (wasm inlined as base64) | cold load ms |')
out('|---|---|---|---|---|')
const req = createRequire(import.meta.url)
const rapierDir = req.resolve('@dimforge/rapier3d-compat').replace(/rapier\.c?js$/, '')
const joltDir = req.resolve('jolt-physics/wasm').replace(/jolt-physics\.wasm\.js$/, '')
const sizes: [string, string | null, string | null][] = [
  ['rapier', rapierDir + 'rapier_wasm3d_bg.wasm', rapierDir + 'rapier.mjs'],
  ['jolt', joltDir + 'jolt-physics.wasm.wasm', joltDir + 'jolt-physics.wasm-compat.js'],
  ['xpbd', null, new URL('./xpbd.ts', import.meta.url).pathname],
]
const kb = (n: number) => `${(n / 1024).toFixed(0)} KB`
for (const [name, wasm, js] of sizes) {
  const loads = Array.from({ length: 5 }, () => Number(execFileSync(process.execPath, [new URL('./load.ts', import.meta.url).pathname, name]).toString().trim()))
  const w = wasm ? readFileSync(wasm) : null
  out(`| ${name} | ${w ? kb(w.length) : '-'} | ${w ? kb(gzipSync(w).length) : '-'} | ${js ? kb(readFileSync(js).length) : '-'} | ${f(loads.sort((a, b) => a - b)[2], 1)} |`)
}
