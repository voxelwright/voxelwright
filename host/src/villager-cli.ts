// npm run villager -- [--agent claude|stub] [--model sonnet] [--port 5190] [--root ~/.village] [--home http://localhost:5181/]
// Prints each person's link to the home. The token is in the fragment, which the
// browser never sends to a server; the page keeps it for the tab and clears it.
import { homedir } from 'node:os'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import { Context } from 'cordis'
import villager from './villager.ts'
import { claudeAgent, stubAgent } from './villager-agent.ts'

const { values } = parseArgs({
  options: {
    agent: { type: 'string', default: 'claude' },
    model: { type: 'string', default: 'sonnet' },
    port: { type: 'string', default: '5190' },
    root: { type: 'string', default: join(homedir(), '.village') },
    home: { type: 'string', default: 'http://localhost:5181/' },
  },
})
if (values.agent !== 'claude' && values.agent !== 'stub') {
  console.error('--agent is claude or stub')
  process.exit(2)
}

const root = new Context()
const fiber = root.plugin(villager, {
  root: values.root,
  port: Number(values.port),
  agent: values.agent === 'stub' ? stubAgent() : claudeAgent(values.model),
})
await fiber.await()
console.log(`villager (${values.agent}) listening on 127.0.0.1:${root.villager.port}`)
for (const [person, token] of Object.entries(root.villager.tokens)) console.log(`${person}: ${new URL(`#token=${token}`, values.home)}`)

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, async () => {
    await fiber.dispose()
    process.exit(0)
  })
}
