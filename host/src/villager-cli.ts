// npm run villager -- [--agent warm|claude|stub] [--model haiku] [--thinking] [--router-model sonnet] [--maker-model sonnet] [--port 5190] [--root ~/.village]
// warm (the default, #42) keeps one Claude Code process per person between turns; claude starts one per turn.
// VILLAGER_PEOPLE=alex:Alex,sam:Sam,mia:Mia lists the synthetic people; the default is alex:Alex.
// Each entry may add an age band and a language (alex:Alex:adult:en). VILLAGER_PROFILES=<file.json> sets
// whole profiles ({"alex": {"age": "adult", "language": "en", "style": "...", "humour": "cheeky"}}) and wins.
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import { Context } from 'cordis'
import villager, { parsePeopleSpec } from './villager.ts'
import { checkProfile, type Profile } from './persona.ts'
import { claudeAgent, stubAgent, warmAgent } from './villager-agent.ts'
import { claudeMaker, claudeRouter, stubMaker, stubRouter } from './villager-input.ts'

const { values } = parseArgs({
  options: {
    agent: { type: 'string', default: 'warm' },
    model: { type: 'string', default: 'haiku' },
    thinking: { type: 'boolean', default: false },
    'router-model': { type: 'string', default: 'sonnet' },
    'maker-model': { type: 'string', default: 'sonnet' },
    port: { type: 'string', default: '5190' },
    root: { type: 'string', default: join(homedir(), '.village') },
  },
})
if (values.agent !== 'warm' && values.agent !== 'claude' && values.agent !== 'stub') {
  console.error('--agent is warm, claude or stub')
  process.exit(2)
}

let people: Record<string, string> | undefined
let profiles: Record<string, Profile> | undefined
try {
  if (process.env.VILLAGER_PEOPLE) ({ people, profiles } = parsePeopleSpec(process.env.VILLAGER_PEOPLE))
} catch (error) {
  console.error(`VILLAGER_PEOPLE: ${(error as Error).message}`)
  process.exit(2)
}
try {
  if (process.env.VILLAGER_PROFILES) {
    const file = JSON.parse(readFileSync(process.env.VILLAGER_PROFILES, 'utf8')) as Record<string, unknown>
    profiles = { ...profiles }
    for (const [id, raw] of Object.entries(file)) profiles[id] = checkProfile(raw)
  }
} catch (error) {
  console.error(`VILLAGER_PROFILES: ${(error as Error).message}`)
  process.exit(2)
}

const root = new Context()
const fiber = root.plugin(villager, {
  root: values.root,
  port: Number(values.port),
  people,
  profiles,
  agent: values.agent === 'stub' ? stubAgent() : (values.agent === 'warm' ? warmAgent : claudeAgent)({ model: values.model, thinking: values.thinking }),
  router: values.agent === 'stub' ? stubRouter() : claudeRouter(values['router-model']),
  maker: values.agent === 'stub' ? stubMaker() : claudeMaker(values['maker-model']),
})
await fiber.await()
console.log(`villager (${values.agent}${values.agent === 'stub' ? '' : `, ${values.model}`}) for ${Object.keys(people ?? { alex: 1 }).join(', ')} listening on 127.0.0.1:${root.villager.port}`)

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, async () => {
    await fiber.dispose()
    process.exit(0)
  })
}
