// Runs one command holding every GPU turn (test/kit.mjs `quiet`), so a panel render draws alone (#450). What it starts
// is told it has a turn (ENGINE_TURN), so its own shot.mjs does not wait on this one.
//   node bay/quiet.mjs <command> [args...]
import { spawnSync } from 'node:child_process'
import { quiet } from '../test/kit.mjs'

const [cmd, ...args] = process.argv.slice(2)
if (!cmd) { console.error('usage: node bay/quiet.mjs <command> [args...]'); process.exit(2) }
const back = await quiet()
const began = Date.now()
const run = spawnSync(cmd, args, { stdio: 'inherit', env: process.env })
back()
console.log(`quiet: ${cmd} held the GPU ${Math.round((Date.now() - began) / 1000)} s, exit ${run.status}`)
process.exit(run.status ?? 1)
