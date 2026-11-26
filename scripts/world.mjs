// A local realm uses only its pinned inputs, even on the machine that packed them.
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { plain } from '../engine/player/serve.mjs'

const home = resolve('.voxelwright')
const inputs = { ...process.env, HOME: home, VOXELWRIGHT_EGG_MEDIA: '' }
delete inputs.GITHUB_REPOSITORY
delete inputs.GH_TOKEN
function step(label, script, args, env) {
  const start = performance.now()
  const child = spawnSync(process.execPath, [script, ...args], { stdio: 'inherit', env })
  if (child.status !== 0) process.exit(child.status ?? 1)
  console.log(`${label} ${((performance.now() - start) / 1000).toFixed(1)} s`)
}
step('Core build', 'engine/core/build.mjs', ['--no-cache'], process.env)
step('Data fetch and verification', 'deploy/data.mjs', ['fetch'], inputs)
step('Realm build', 'engine/sf/build.mjs', [], inputs)
try {
  const site = await plain(resolve('engine/dist-sf'), '127.0.0.1', 5760)
  console.log(`Open ${site.url}/sf/index.html`)
} catch (error) {
  console.error(`Could not serve the realm on port 5760 (${error.code ?? error.message}).`)
  process.exitCode = 1
}
