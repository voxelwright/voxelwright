// Blind identification (#42): can a judge tell Dumpling, Tuft and Moss apart from
// one reply, with the names stripped? The same 12 everyday lines go to all three
// through the real host and model; then one fresh `claude -p --model opus` judge
// per reply picks who said it from the persona descriptions alone. Chance is 33%.
// Real model calls on the operator's login.
//   node test/persona-identify.ts --model haiku --out id.json [--port 5512] [--tmp dir] [--host-dir ../h] [--jobs 6]
//   node test/persona-identify.ts --replies id.json --out id.json    (judge saved replies again)
import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { pathToFileURL } from 'node:url'
import { Context } from 'cordis'

const { values } = parseArgs({ options: {
  model: { type: 'string', default: 'haiku' },
  out: { type: 'string' },
  replies: { type: 'string' },
  'host-dir': { type: 'string', default: resolve(import.meta.dirname, '..') },
  port: { type: 'string', default: '5512' },
  tmp: { type: 'string', default: process.env.TMPDIR ?? tmpdir() },
  jobs: { type: 'string', default: '6' },
} })
const hostDir = resolve(values['host-dir']!)
const { defaultPersona } = await import(pathToFileURL(join(hostDir, 'src/persona.ts')).href)

const CAST = [['alex', 'Alex', 'Dumpling'], ['sam', 'Sam', 'Tuft'], ['mia', 'Mia', 'Moss']] as const
const LINES = [
  'should I quit my job?',
  'my friend forgot my birthday',
  'rate my weekend plan: drinks on friday, a long hike on saturday, then sleeping in and films all sunday',
  'what do you think of pineapple on pizza?',
  "I'm thinking about getting a tattoo",
  'is it worth learning a second language at 30?',
  'my brother keeps borrowing my stuff and never gives it back',
  'should I text my ex?',
  "what's the best way to spend a free evening?",
  "I'm thinking of getting a dog",
  "I keep putting off booking the dentist",
  'I want to move to another city',
]
/** Words of each villager's trade, to show whether the job, not the person, gave a reply away. */
const TRADE: Record<string, RegExp> = {
  Dumpling: /\b(cook\w*|recipe|kitchen|dinner|meal|oven|pan|bake\w*|menu|onion\w*|soup|ingredient\w*|chef)\b/i,
  Tuft: /\b(tid\w*|declutter\w*|schedul\w*|calendar|deadline\w*|chore\w*|paperwork|admin|spreadsheet|budget\w*|logistic\w*)\b/i,
  Moss: /\b(garden\w*|plant\w*|soil|seed\w*|grow\w*|season\w*|weed\w*|root\w*|prun\w*|bloom\w*|compost|frost)\b/i,
}
const NAMES = /\b(Dumpling|Tuft|Moss|Alex|Sam|Mia)\b/g
const strip = (s: string) => s.replace(NAMES, (n) => (['Alex', 'Sam', 'Mia'].includes(n) ? '[person]' : '[housemate]'))

async function say(base: string, token: string, person: string, text: string) {
  const res = await fetch(`${base}/people/${person}/messages`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify({ text }) })
  const raw = await res.text()
  const done = raw.split('\n\n').filter(Boolean).map((b) => ({ name: /^event: (.*)$/m.exec(b)?.[1], data: JSON.parse(/^data: (.*)$/m.exec(b)?.[1] ?? 'null') })).find((e) => e.name === 'done')
  return done ? (done.data.reply as string) : ''
}

async function collect() {
  const villager = (await import(pathToFileURL(join(hostDir, 'src/villager.ts')).href)).default
  const { warmAgent } = await import(pathToFileURL(join(hostDir, 'src/villager-agent.ts')).href)
  const root = await mkdtemp(join(values.tmp!, 'persona-identify-'))
  const ctx = new Context()
  const agent = warmAgent({ model: values.model, thinking: false })
  const fiber = ctx.plugin(villager, { root, agent, port: Number(values.port), people: Object.fromEntries(CAST.map(([id, n]) => [id, n])), profiles: Object.fromEntries(CAST.map(([id]) => [id, { age: 'adult' }])) })
  await fiber.await()
  const launch = JSON.parse(await readFile(ctx.villager.launchFile, 'utf8'))
  await new Promise((r) => setTimeout(r, 5000))
  const base = `http://127.0.0.1:${launch.port}`
  const replies: any[] = []
  try {
    for (const [i, line] of LINES.entries()) {
      const got = await Promise.all(CAST.map(async ([id, person, name]) => ({ line: i, text: line, person, villager: name, reply: await say(base, launch.token, id, line) })))
      for (const r of got) console.error(`${i} ${r.villager}: ${r.reply}`)
      replies.push(...got)
    }
  } finally {
    await fiber.dispose()
    await rm(root, { recursive: true, force: true })
  }
  return replies
}

function describe(name: string, id: string): string {
  const p = defaultPersona(id)
  const { name: _n, template: _t, lengths: _l, ...rest } = p
  return `${name}: ${JSON.stringify(rest)}`
}

function judgePrompt(r: any): string {
  return [
    'Three adult housemate characters live in a family home app. Here is how each is described:',
    CAST.map(([id, , name]) => describe(name, id)).join('\n'),
    'One of them answered this line from the person they look after (names in the reply are replaced with [person] and [housemate]).',
    `Person: ${r.text}`,
    `Reply: ${strip(r.reply)}`,
    'Which of the three said it? Judge by how it decides, how it sounds and what it likes, from the descriptions alone. Answer with only JSON: {"who": "Dumpling" | "Tuft" | "Moss", "why": "one short sentence"}',
  ].join('\n\n')
}

function judge(text: string): Promise<any> {
  return new Promise((done) => {
    const child = spawn('claude', ['-p', '--model', 'opus', '--strict-mcp-config', '--setting-sources', '', '--no-session-persistence', '--output-format', 'json'], { cwd: tmpdir(), stdio: ['pipe', 'pipe', 'pipe'] })
    let out = ''
    child.stdout.on('data', (d) => (out += d))
    child.on('close', () => {
      try {
        const result = JSON.parse(out).result as string
        done(JSON.parse(result.slice(result.indexOf('{'), result.lastIndexOf('}') + 1)))
      } catch {
        done({ error: out.slice(0, 200) })
      }
    })
    child.stdin.end(text)
  })
}

const saved = values.replies ? JSON.parse(await readFile(values.replies, 'utf8')) : null
const model = saved?.summary?.model ?? values.model
const replies: any[] = saved?.replies ?? (await collect())
let next = 0
await Promise.all(Array.from({ length: Number(values.jobs) }, async () => {
  while (next < replies.length) {
    const r = replies[next++]
    r.guess = await judge(judgePrompt(r))
    r.ownTrade = TRADE[r.villager].test(r.reply)
    process.stderr.write('.')
  }
}))
const names = CAST.map(([, , n]) => n)
const confusion = Object.fromEntries(names.map((a) => [a, Object.fromEntries([...names, 'error'].map((b) => [b, replies.filter((r) => r.villager === a && (r.guess?.who ?? 'error') === b).length]))]))
const right = replies.filter((r) => r.guess?.who === r.villager).length
const summary = {
  model,
  accuracy: Math.round((right / replies.length) * 1000) / 10,
  right,
  n: replies.length,
  confusion,
  ownTradeMentions: replies.filter((r) => r.ownTrade).length,
  rightWithoutOwnTrade: `${replies.filter((r) => !r.ownTrade && r.guess?.who === r.villager).length}/${replies.filter((r) => !r.ownTrade).length}`,
}
const text = JSON.stringify({ summary, replies }, null, 2)
if (values.out) await writeFile(values.out, text)
console.log(JSON.stringify(summary))
