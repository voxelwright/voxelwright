// A local realm uses only its pinned inputs, even on the machine that packed them.
import { spawnSync } from 'node:child_process'
import { createServer } from 'node:net'
import { resolve } from 'node:path'
import { plain } from '../engine/player/serve.mjs'

const home = resolve('.voxelwright')
const inputs = { ...process.env, HOME: home, VOXELWRIGHT_EGG_MEDIA: '' }
delete inputs.GITHUB_REPOSITORY
delete inputs.GH_TOKEN
const port = Number(process.env.PORT ?? 5760)
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  console.error(`PORT must be a port number from 1 to 65535, not ${process.env.PORT}.`)
  process.exit(1)
}
const busy = (error) => `Port ${port} is ${error.code === 'EADDRINUSE' ? 'already in use' : `not available (${error.code ?? error.message})`}. Stop what is using it, or run PORT=<another port> ./world.`
// Ask for the port before the builds, so a busy one fails in a second rather than after them.
await new Promise((done) => {
  const probe = createServer().once('error', (error) => { console.error(busy(error)); process.exit(1) })
  probe.listen(port, '127.0.0.1', () => probe.close(done))
})
function step(label, script, args, env) {
  const start = performance.now()
  const child = spawnSync(process.execPath, [script, ...args], { stdio: 'inherit', env })
  if (child.status !== 0) process.exit(child.status ?? 1)
  console.log(`${label} ${((performance.now() - start) / 1000).toFixed(1)} s`)
}
step('Core build', 'engine/core/build.mjs', [], process.env)
step('Data fetch and verification', 'deploy/data.mjs', ['fetch'], inputs)
step('Realm build', 'engine/sf/build.mjs', [], inputs)
try {
  const site = await plain(resolve('engine/dist-sf'), '127.0.0.1', port)
  console.log(`Open ${site.url}/sf/index.html`)
} catch (error) {
  console.error(busy(error))
  process.exitCode = 1
}
