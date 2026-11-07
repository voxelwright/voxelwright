// npm run villager -- [--agent claude|stub] [--model sonnet] [--router-model sonnet] [--maker-model sonnet] [--port 5190] [--root ~/.village]
// VILLAGER_PEOPLE=alex:Alex,sam:Sam,mia:Mia lists the synthetic people; the default is alex:Alex.
import { homedir } from 'node:os'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import { Context } from 'cordis'
import villager, { parsePeople } from './villager.ts'
import { claudeAgent, stubAgent } from './villager-agent.ts'
import { claudeMaker, claudeRouter, stubMaker, stubRouter } from './villager-input.ts'
import { claudeVillagerMaker, parseProfiles, stubVillagerMaker } from './villager-make.ts'

const { values } = parseArgs({
  options: {
    agent: { type: 'string', default: 'claude' },
    model: { type: 'string', default: 'sonnet' },
    'router-model': { type: 'string', default: 'sonnet' },
    'maker-model': { type: 'string', default: 'sonnet' },
    port: { type: 'string', default: '5190' },
    root: { type: 'string', default: join(homedir(), '.village') },
  },
})
if (values.agent !== 'claude' && values.agent !== 'stub') {
  console.error('--agent is claude or stub')
  process.exit(2)
}

let people: Record<string, string> | undefined
try {
  if (process.env.VILLAGER_PEOPLE) people = parsePeople(process.env.VILLAGER_PEOPLE)
} catch (error) {
  console.error(`VILLAGER_PEOPLE: ${(error as Error).message}`)
  process.exit(2)
}

const root = new Context()
const fiber = root.plugin(villager, {
  root: values.root,
  port: Number(values.port),
  people,
  agent: values.agent === 'stub' ? stubAgent() : claudeAgent(values.model),
  router: values.agent === 'stub' ? stubRouter() : claudeRouter(values['router-model']),
  maker: values.agent === 'stub' ? stubMaker() : claudeMaker(values['maker-model']),
  villagerMaker: values.agent === 'stub' ? stubVillagerMaker() : claudeVillagerMaker(values['maker-model']),
  profiles: parseProfiles(process.env.VILLAGER_PROFILES),
})
await fiber.await()
console.log(`villager (${values.agent}) for ${Object.keys(people ?? { alex: 1 }).join(', ')} listening on 127.0.0.1:${root.villager.port}`)

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, async () => {
    await fiber.dispose()
    process.exit(0)
  })
}
