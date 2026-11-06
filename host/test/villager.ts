// Headless checks of the villager API with the stub agent: no model is called.
// npm run check-villager
import { existsSync } from 'node:fs'
import { mkdtemp, readdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from 'cordis'
import { listNotes, readNote, writeNote } from '../src/notes.ts'
import villager from '../src/villager.ts'
import { initProblem, stubAgent } from '../src/villager-agent.ts'

const root = await mkdtemp(join(tmpdir(), 'villager-check-'))
const checks: { name: string; pass: boolean; detail?: unknown }[] = []
const check = (name: string, pass: unknown, detail?: unknown) => checks.push({ name, pass: Boolean(pass), detail })

async function start() {
  const ctx = new Context()
  const fiber = ctx.plugin(villager, { root, agent: stubAgent(30), port: 0 })
  await fiber.await()
  const launch = JSON.parse(await readFile(ctx.villager.launchFile, 'utf8'))
  return { fiber, base: `http://127.0.0.1:${launch.port}`, token: launch.token as string }
}

interface Streamed { status: number; events: { name: string; data: any; at: number }[] }
async function say(base: string, token: string | null, text: string, person = 'alex'): Promise<Streamed> {
  const res = await fetch(`${base}/people/${person}/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ text }),
  })
  const events: Streamed['events'] = []
  if (res.headers.get('content-type')?.startsWith('text/event-stream')) {
    const decoder = new TextDecoder()
    let buffer = ''
    for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
      buffer += decoder.decode(chunk, { stream: true })
      let cut
      while ((cut = buffer.indexOf('\n\n')) >= 0) {
        const block = buffer.slice(0, cut)
        buffer = buffer.slice(cut + 2)
        const name = /^event: (.*)$/m.exec(block)?.[1] ?? ''
        const data = JSON.parse(/^data: (.*)$/m.exec(block)?.[1] ?? 'null')
        events.push({ name, data, at: Date.now() })
      }
    }
  } else await res.text()
  return { status: res.status, events }
}

try {
  let host = await start()

  // Token.
  check('no token is refused', (await say(host.base, null, 'hello')).status === 401)
  check('a wrong token is refused', (await say(host.base, 'f'.repeat(64), 'hello')).status === 401)
  const listing = await fetch(`${host.base}/people/alex/conversation`)
  check('the conversation needs the token too', listing.status === 401)

  // Send, stream, reply.
  const first = await say(host.base, host.token, 'I keep forgetting to water the plants')
  const texts = first.events.filter((e) => e.name === 'text')
  const done = first.events.find((e) => e.name === 'done')
  const spread = texts.length > 1 ? texts.at(-1)!.at - texts[0].at : 0
  check('the reply streams in pieces before done', first.status === 200 && texts.length >= 5 && spread >= 100 && first.events.at(-1)?.name === 'done', { pieces: texts.length, spreadMs: spread })
  check('the streamed pieces make the reply', done && texts.map((e) => e.data.t).join('') === done.data.reply, done?.data)

  const dir = join(root, 'people', 'alex')
  const usage = (await readFile(join(dir, 'usage.jsonl'), 'utf8')).trim().split('\n').map((l) => JSON.parse(l))
  check('usage is logged per turn', usage.length === 1 && usage[0].models[0] === 'stub' && typeof usage[0].totalMs === 'number' && usage[0].resumed === false, usage)
  check('the villager wrote a note in the person folder', (await listNotes(join(dir, 'notes'))).includes('stub.md'))

  // Busy: a second line while the first reply is still being written.
  const slow = say(host.base, host.token, 'one more thing')
  await new Promise((r) => setTimeout(r, 50))
  const clash = await say(host.base, host.token, 'and another')
  await slow
  check('one turn at a time per person', clash.status === 409, clash.status)

  // Persistence across a host restart: new token, same session.
  const oldToken = host.token
  await host.fiber.dispose()
  check('the launch file is removed when the host stops', !existsSync(join(root, 'villager', 'launch.json')))
  host = await start()
  check('a new launch has a new token', host.token !== oldToken && (await say(host.base, oldToken, 'hi')).status === 401)
  const third = await say(host.base, host.token, 'did you remember?')
  const reply = third.events.find((e) => e.name === 'done')?.data.reply ?? ''
  check('the conversation resumes after a host restart', /3 lines/.test(reply) && reply.includes('water the plants'), reply)
  const history = await (await fetch(`${host.base}/people/alex/conversation`, { headers: { authorization: `Bearer ${host.token}` } })).json()
  check('the page can read back both sides', history.lines.length === 6 && history.lines.at(-1).from === 'villager', history.lines.length)

  // A failed turn is not silently a reply, and does not move the session.
  const state = await readFile(join(dir, 'villager.json'), 'utf8')
  const failed = await say(host.base, host.token, 'please [stub-fail]')
  check('a failed turn reports failure', failed.events.at(-1)?.name === 'failed' && !failed.events.some((e) => e.name === 'done'), failed.events.map((e) => e.name))
  check('a failed turn keeps the stored session', (await readFile(join(dir, 'villager.json'), 'utf8')) === state)
  const after = await say(host.base, host.token, 'still there?')
  check('the next turn resumes the same session', /4 lines/.test(after.events.find((e) => e.name === 'done')?.data.reply ?? ''))

  // Person ids.
  for (const id of ['..%2Falex', 'Alex', 'sam']) check(`person "${id}" is refused`, (await say(host.base, host.token, 'hi', id)).status === 404)
  await host.fiber.dispose()

  // Notes cannot leave the person folder.
  const notes = join(root, 'people', 'alex', 'notes')
  const outside = join(root, 'people', 'alex', 'secret.md')
  await writeFile(outside, 'not for the villager')
  await symlink(outside, join(notes, 'link.md'))
  const attempts: [string, () => Promise<unknown>][] = [
    ['write ../escape.md', () => writeNote(notes, '../escape.md', 'x')],
    ['write a/../../escape.md', () => writeNote(notes, 'a/../../escape.md', 'x')],
    ['write an absolute path', () => writeNote(notes, join(root, 'escape.md'), 'x')],
    ['read ../secret.md', () => readNote(notes, '../secret.md')],
    ['read ../../../villager/launch.json', () => readNote(notes, '../../../villager/launch.json')],
    ['read through a planted symlink', () => readNote(notes, 'link.md')],
    ['write through a planted symlink', () => writeNote(notes, 'link.md', 'x')],
    ['write a dotfile', () => writeNote(notes, '.hidden.md', 'x')],
  ]
  for (const [name, attempt] of attempts) {
    const outcome = await attempt().then(() => 'allowed', (e) => e.constructor.name)
    check(`notes refuse: ${name}`, outcome === 'NoteError', outcome)
  }
  check('nothing was written outside the notes folder', !existsSync(join(root, 'people', 'alex', 'escape.md')) && !existsSync(join(root, 'escape.md')) && (await readFile(outside, 'utf8')) === 'not for the villager')
  await writeNote(notes, 'plants.md', 'Water on Sundays.')
  check('a plain note round-trips', (await readNote(notes, 'plants.md')) === 'Water on Sundays.')

  // The init guard.
  const tools = ['mcp__notes__list_notes', 'mcp__notes__read_note', 'mcp__notes__write_note']
  check('init with only the notes server passes', initProblem({ mcp_servers: [{ name: 'notes', status: 'connected', source: 'sdk' }], tools }) === undefined)
  check('init with a foreign MCP server fails', initProblem({ mcp_servers: [{ name: 'notes', status: 'connected', source: 'sdk' }, { name: 'gmail', status: 'connected' }], tools: [...tools, 'mcp__gmail__send'] }))
  check('init with a built-in file tool fails', initProblem({ mcp_servers: [{ name: 'notes', status: 'connected', source: 'sdk' }], tools: [...tools, 'Read'] }))
  check('a notes server from user config fails', initProblem({ mcp_servers: [{ name: 'notes', status: 'connected', source: 'user' }], tools }))
  check('a missing init fails', initProblem(undefined))
  check('no temp files were left in the notes folder', !(await readdir(notes)).some((f) => f.endsWith('.tmp')))
} finally {
  await rm(root, { recursive: true, force: true })
}

for (const c of checks) console.log(`${c.pass ? 'pass' : 'FAIL'}  ${c.name}${c.pass ? '' : `  ${JSON.stringify(c.detail)}`}`)
const failed = checks.filter((c) => !c.pass).length
console.log(`${checks.length - failed} of ${checks.length} passed`)
process.exitCode = failed ? 1 : 0
