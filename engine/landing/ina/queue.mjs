// Runs a chain of this lane's GPU-bound steps on one turn (#423). Every tool here that opens a browser to draw
// waits its turn on the machine's GPU (test/kit.mjs `turn`); when other lanes' checks hold the turns for half an
// hour, each step of a chain would queue again behind them. This waits once, then runs the steps one after another
// with the turn held (they are told they have it).
//
//   node landing/ina/queue.mjs "node landing/ina/cull.mjs" "node landing/ina/shoot.mjs --name r7" ...
import { spawnSync } from 'node:child_process'
import { turn } from '../../test/kit.mjs'

const began = Date.now()
await turn()
console.log(`a turn after ${Math.round((Date.now() - began) / 1000)} s`)
for (const step of process.argv.slice(2)) {
  const at = Date.now()
  const ran = spawnSync('/bin/sh', ['-c', step], { stdio: 'inherit', env: process.env })
  console.log(`[${ran.status === 0 ? 'ok' : `failed ${ran.status}`}, ${Math.round((Date.now() - at) / 1000)} s] ${step}`)
}
process.exit(0)
