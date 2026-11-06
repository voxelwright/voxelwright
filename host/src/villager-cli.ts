// npm run villager -- [--agent claude|stub] [--model sonnet] [--port 5190] [--root ~/.village]
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

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, async () => {
    await fiber.dispose()
    process.exit(0)
  })
}
