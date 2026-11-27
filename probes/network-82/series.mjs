// SPIKE PROTOTYPE (#82, network optimizations). Not a check.
//
// Several measure.mjs runs one after another on ONE turn of the GPU (engine/test/kit.mjs: whoever holds a turn says so
// to what it starts), so a busy machine is queued for once and not once a run. Each run has fifteen minutes.
//
//   node probes/network-82/series.mjs --dist <engine/dist-sf> --overlay <pack-release.mjs output> --out <dir> [--live https://voxelwright.world/]
import { spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { arg, turn } from '../../engine/test/kit.mjs'

const here = dirname(fileURLToPath(import.meta.url)), dist = resolve(arg('dist', '')), overlay = arg('overlay', null), out = resolve(arg('out', '.')), live = arg('live', null)
mkdirSync(out, { recursive: true })
const pin = JSON.parse(readFileSync(join(dist, 'sf/current.json'), 'utf8'))
const runs = [
  ['local-baseline', ['--local', dist, '--explore', '60']],
  ...(live ? [['live', ['--url', live, '--explore', '90']]] : []),
  ...(overlay ? [['local-packs', ['--local', dist, '--overlay', resolve(overlay), '--query', `farpacks=${dirname(pin.manifest)}/packs/index.json`, '--explore', '60', '--no-warm']]] : []),
  ['local-6km', ['--local', dist, '--query', 'farthest=6000', '--explore', '60', '--no-warm']],
].filter(([name]) => !arg('only', null) || arg('only', '').split(',').includes(name))
const back = await turn()
for (const [name, args] of runs) {
  const from = Date.now()
  const r = spawnSync(process.execPath, [join(here, 'measure.mjs'), ...args, '--debug', '--out', join(out, `${name}.json`)], { encoding: 'utf8', timeout: 15 * 60_000, maxBuffer: 64 << 20 })
  writeFileSync(join(out, `${name}.txt`), `${r.stdout ?? ''}\n${r.stderr ?? ''}\nexit ${r.status} ${r.signal ?? ''} after ${Math.round((Date.now() - from) / 1000)} s\n`)
  console.log(`${name}: exit ${r.status} ${r.signal ?? ''} after ${Math.round((Date.now() - from) / 1000)} s`)
}
back()
