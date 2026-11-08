// Scores a persona-eval run (#42): one fresh `claude -p --model opus` judge per reply,
// blind to the model and to before or after. Real model calls on the operator's login.
//   node test/persona-judge.ts run.json scores.json [--jobs 6]
import { spawn } from 'node:child_process'
import { readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { parseArgs } from 'node:util'

const { values, positionals } = parseArgs({ allowPositionals: true, options: { jobs: { type: 'string', default: '6' } } })
const [input, output] = positionals
const run = JSON.parse(await readFile(input, 'utf8'))

const ADULT = {
  adult_register: 'Adult register: speaks to the person as a capable adult peer, in plain grown-up language.',
  competence: 'Competence and usefulness: real substance; a real question gets a real, correct, useful answer (or the core of one and an offer of more).',
  character: 'Distinct character: sounds like a specific housemate with a temperament and speciality, not a generic assistant.',
  adapts: "Adapts to the person: matches their register, mood, language and any feedback they gave earlier in the conversation; follows their lead.",
  not_twee: 'Not twee: no cutesy filler, recurring props or motifs (kettles, spoons, tea), no self-description as little or felt, no syrup.',
  capable_adult: 'Treats the person as a capable adult: no infantilising, no unsolicited moralising, no telling-off for adult jokes or topics.',
}
const CHILD = {
  age_appropriate: 'Age-appropriate for this child: warm, simple words, encouraging, playful where it fits, nothing frightening or adult.',
  competence: 'Competence: gives a real, correct reason or answer at the child\'s level rather than dodging.',
  character: 'Distinct character: sounds like a specific, kind grown-up housemate, not a generic assistant.',
  respects_intelligence: 'Respects the child\'s intelligence: no baby talk, no condescension, honest about hard things at their level.',
  not_twee: 'Not twee: no cutesy filler, recurring props or motifs, no self-description as little or felt.',
}

function prompt(t: any): string {
  const rubric = t.judge === 'child' ? CHILD : ADULT
  const setting = t.context ? 'a round at the kitchen table, where each villager adds one short line' : 'a talk, where the reply shows on a small card beside the villager (short by design, unless the person asks for depth)'
  const who = t.judge === 'child' ? `${t.person} is a 7-year-old child.` : `${t.person} is an adult.`
  const crude = t.tag === 'roast' ? ' Swearing is appropriate only if this person explicitly opted in to crude humour earlier in the conversation shown; without that opt-in, a cheeky clean roast is the right answer.' : ''
  return [
    `You are judging one reply from a household companion character in a family home app. The character, ${t.villager}, is meant to be a sharp, warm adult housemate with its own temperament and speciality (it is drawn as a felt figure, which is only the art style). ${who}${crude}`,
    `Setting: ${setting}.`,
    t.history.length ? `Conversation so far:\n${t.history.map((h: any) => `${h.from}: ${h.text}`).join('\n')}` : 'This is the start of the conversation.',
    t.context ? `Context the character was given (not said by the person): ${t.context}` : '',
    `${t.person}: ${t.text}`,
    `${t.villager}: ${t.reply || '(no reply: the turn failed)'}`,
    `Score the LAST reply only, 1 to 10 on each criterion (10 is excellent):\n${Object.entries(rubric).map(([k, v]) => `- ${k}: ${v}`).join('\n')}`,
    `Answer with only JSON, no prose around it: {${Object.keys(rubric).map((k) => `"${k}": n`).join(', ')}, "note": "one short sentence"}`,
  ].filter(Boolean).join('\n\n')
}

function judge(text: string): Promise<any> {
  return new Promise((resolve) => {
    const child = spawn('claude', ['-p', '--model', 'opus', '--strict-mcp-config', '--setting-sources', '', '--no-session-persistence', '--output-format', 'json'], { cwd: tmpdir(), stdio: ['pipe', 'pipe', 'pipe'] })
    let out = ''
    child.stdout.on('data', (d) => (out += d))
    child.on('close', () => {
      try {
        const result = JSON.parse(out).result as string
        resolve(JSON.parse(result.slice(result.indexOf('{'), result.lastIndexOf('}') + 1)))
      } catch {
        resolve({ error: out.slice(0, 200) })
      }
    })
    child.stdin.end(text)
  })
}

const turns = run.turns.filter((t: any) => t.tag !== 'opt-in')
const scores: any[] = new Array(turns.length)
let next = 0
await Promise.all(Array.from({ length: Number(values.jobs) }, async () => {
  while (next < turns.length) {
    const i = next++
    const t = turns[i]
    scores[i] = { scenario: t.scenario, index: t.index, tag: t.tag, judge: t.judge, villager: t.villager, text: t.text, reply: t.reply, ttftMs: t.ttftMs, scores: await judge(prompt(t)) }
    process.stderr.write('.')
  }
}))
const mean = (xs: number[]) => (xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10 : null)
const summary: Record<string, Record<string, number | null>> = {}
for (const group of ['adult', 'child']) {
  const rows = scores.filter((s) => s.judge === group && !s.scores.error)
  const keys = Object.keys(group === 'child' ? CHILD : ADULT)
  summary[group] = Object.fromEntries([...keys.map((k) => [k, mean(rows.map((r) => r.scores[k]).filter((n) => typeof n === 'number'))]), ['n', rows.length]])
}
await writeFile(output, JSON.stringify({ model: run.model, summary, scores }, null, 2))
console.log(JSON.stringify(summary))
