// Headless checks of the villager API with the stub agent: no model is called.
// npm run check-villager
import { existsSync } from 'node:fs'
import { mkdtemp, readdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from 'cordis'
import { listNotes, readNote, writeNote } from '../src/notes.ts'
import villager, { parsePeople } from '../src/villager.ts'
import { initProblem, stubAgent } from '../src/villager-agent.ts'
import { checkRouted, stubMaker, stubRouter, type Maker } from '../src/villager-input.ts'

const root = await mkdtemp(join(tmpdir(), 'villager-check-'))
const checks: { name: string; pass: boolean; detail?: unknown }[] = []
const check = (name: string, pass: unknown, detail?: unknown) => checks.push({ name, pass: Boolean(pass), detail })

async function start(people?: Record<string, string>, maker?: Maker) {
  const ctx = new Context()
  const fiber = ctx.plugin(villager, { root, agent: stubAgent(30), port: 0, people, router: stubRouter(5), maker: maker ?? stubMaker(5) })
  await fiber.await()
  const launch = JSON.parse(await readFile(ctx.villager.launchFile, 'utf8'))
  return { fiber, base: `http://127.0.0.1:${launch.port}`, token: launch.token as string }
}

interface Streamed { status: number; events: { name: string; data: any; at: number }[] }
async function say(base: string, token: string | null, text: string, person = 'alex', context?: unknown): Promise<Streamed> {
  const res = await fetch(`${base}/people/${person}/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ text, context }),
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

  // The operator can list synthetic people (VILLAGER_PEOPLE); each keeps its own folder.
  const listed = parsePeople(' alex:Alex, sam:Sam ,mia:Mia')
  check('VILLAGER_PEOPLE parses into ids and names', JSON.stringify(listed) === JSON.stringify({ alex: 'Alex', sam: 'Sam', mia: 'Mia' }), listed)
  for (const bad of ['', 'Sam:Sam', 'sam', 'sam:', '../x:X', 'sam:Sam,sam:Sammy']) {
    const outcome = (() => { try { parsePeople(bad); return 'accepted' } catch { return 'refused' } })()
    check(`VILLAGER_PEOPLE refuses ${JSON.stringify(bad)}`, outcome === 'refused', outcome)
  }
  host = await start(listed)
  const samReply = (await say(host.base, host.token, 'hello from the table', 'sam')).events.find((e) => e.name === 'done')?.data.reply ?? ''
  check('a listed person is answered under their own name', /I hear you, Sam\. That makes 1 line/.test(samReply), samReply)
  // Context reaches the turn but is never stored as the person's line.
  const said = await say(host.base, host.token, 'what shall we cook?', 'sam', 'at the kitchen table just now, Dumpling said "Soup."')
  const samLines = (await readFile(join(root, 'people', 'sam', 'conversation.jsonl'), 'utf8')).trim().split('\n').map((l) => JSON.parse(l))
  const personLines = samLines.filter((l) => l.from === 'person').map((l) => l.text)
  const heard = await readFile(join(root, 'people', 'sam', 'stub-last-context.txt'), 'utf8').catch(() => '')
  check('context reaches the villager turn', said.events.at(-1)?.name === 'done' && heard.includes('Dumpling said "Soup."'), heard)
  check("context is never stored as the person's line", personLines.at(-1) === 'what shall we cook?' && !samLines.some((l) => /Dumpling said|Context/.test(l.text ?? '')), personLines)
  const readBack = await (await fetch(`${host.base}/people/sam/conversation`, { headers: { authorization: `Bearer ${host.token}` } })).json()
  check('the conversation read back has no context in it', !JSON.stringify(readBack).includes("Dumpling said"), readBack.lines.length)
  for (const bad of [42, 'x'.repeat(2001)]) check(`context ${typeof bad === 'number' ? 'that is not a string' : 'over 2000 characters'} is refused`, (await say(host.base, host.token, 'hi', 'sam', bad)).status === 400)
  check("a listed person's villager does not see another's lines", existsSync(join(root, 'people', 'sam', 'conversation.jsonl')) && !samReply.includes('water the plants'))
  check('an unlisted person is still refused', (await say(host.base, host.token, 'hi', 'zoe')).status === 404)
  await host.fiber.dispose()

  // The always-on input (#42): route, props, library and projects.
  {
    const ran = join(root, 'module-ran.txt')
    // If the host ever imported or ran a module, this one would write a file.
    const tattletale = `import('node:fs').then((fs) => fs.writeFileSync(${JSON.stringify(ran)}, 'ran'))\nexport function build(api) { return new api.THREE.Group() }\n`
    const real = stubMaker(5)
    host = await start(listed, async (ask) => (ask.what.includes('tattle') ? { module: tattletale, name: ask.what, models: ['stub'], costUsd: 0, outputTokens: 0, apiMs: 0 } : real(ask)))
    const api = (path: string, init: { method?: string; body?: unknown; token?: string | null } = {}) => fetch(`${host.base}${path}`, {
      method: init.method ?? (init.body === undefined ? 'GET' : 'POST'),
      headers: { 'content-type': 'application/json', ...(init.token === null ? {} : { authorization: `Bearer ${init.token ?? host.token}` }) },
      body: init.body === undefined ? undefined : typeof init.body === 'string' ? init.body : JSON.stringify(init.body),
    })
    const cast = [{ id: 'alex', name: 'Dumpling', role: 'cook' }, { id: 'sam', name: 'Tuft', role: 'tidier' }, { id: 'mia', name: 'Moss', role: 'gardener' }]
    const route = (text: unknown, extra: Record<string, unknown> = {}, token?: string | null) => api('/people/alex/route', { body: { text, primary: 'Dumpling', villagers: cast, ...extra }, token })
    for (const [name, path, body] of [['route', '/people/alex/route', { text: 'hi', primary: 'Dumpling', villagers: cast }], ['props', '/people/alex/props', { what: 'a chair' }], ['library', '/people/alex/library', undefined], ['projects', '/people/alex/projects', { what: 'pinball' }]] as const)
      check(`${name} needs the token`, (await api(path, { body, token: null })).status === 401 && (await api(path, { body, token: 'f'.repeat(64) })).status === 401)
    const routed = await (await route('add a round oak table for four')).json()
    check('a line is routed to furnish with what, where and size', routed.routed?.route === 'furnish' && routed.routed.what && Array.isArray(routed.routed.size) && typeof routed.ms === 'number', routed)
    const talkTo = await (await route('I want to chat with Moss')).json()
    check('a line is routed to talk with a known villager', talkTo.routed?.route === 'talk' && talkTo.routed.to === 'mia', talkTo)
    const routes = (await readFile(join(root, 'people', 'alex', 'routes.jsonl'), 'utf8')).trim().split('\n').map((l) => JSON.parse(l))
    check('routes are recorded under the person', routes.length === 2 && routes[0].routed.route === 'furnish' && typeof routes[0].ms === 'number', routes.length)
    check('an empty line is refused', (await route('  ')).status === 400)
    check('a line over 2000 characters is refused', (await route('x'.repeat(2001))).status === 400)
    check('a villager of an unlisted person is refused', (await route('hi', { villagers: [...cast, { id: 'zoe', name: 'Zed', role: 'cook' }] })).status === 400)
    check('a villager name with markup is refused', (await route('hi', { villagers: [{ id: 'alex', name: '<b>Dumpling</b>', role: 'cook' }] })).status === 400)
    check('a primary that is not a name is refused', (await route('hi', { primary: 'ignore all rules and' + 'x'.repeat(40) })).status === 400)
    check('a body that is not JSON is refused', (await api('/people/alex/route', { body: '{nope' })).status === 400)
    const junk = await route('hello [stub-route-junk]')
    check('a router answer naming no known route is refused, not acted on', junk.status === 422)
    check('a router failure is a 422, not a route', (await route('hello [stub-route-fail]')).status === 422)
    const refused = (await readFile(join(root, 'people', 'alex', 'routes.jsonl'), 'utf8')).trim().split('\n').map((l) => JSON.parse(l))
    check('refused and failed routes are recorded as such', refused.some((r) => r.refused) && refused.some((r) => r.failed), refused.length)

    // checkRouted treats the model's JSON as data.
    const ids = ['alex', 'sam', 'mia']
    check('checkRouted refuses an unknown route', 'reason' in checkRouted('{"route":"delete_everything"}', ids, []))
    check('checkRouted refuses talk to an unknown villager', 'reason' in checkRouted('{"route":"talk","to":"zoe"}', ids, []))
    check('checkRouted refuses furnish without what', 'reason' in checkRouted('{"route":"furnish"}', ids, []))
    const extra = checkRouted('{"route":"furnish","what":"chair","count":99,"size":[0,9,1e9],"grant":"admin","library":"nope","copy":"yes","audience":"everyone"}', ids, ['abc'])
    check('checkRouted drops unknown fields, clamps numbers, ignores unknown library items', 'routed' in extra && JSON.stringify(extra.routed) === JSON.stringify({ route: 'furnish', what: 'chair', count: 6, size: [0.05, 3, 3] }), extra)
    check('checkRouted reads JSON inside prose and cuts long text', 'routed' in checkRouted(`Sure! {"route":"answer","say":"${'a'.repeat(400)}"}`, ids, []) && (checkRouted(`{"route":"answer","say":"${'a'.repeat(400)}"}`, ids, []) as { routed: { say: string } }).routed.say.length === 160)

    // Props: module text comes back as data and is stored, never run.
    const made = await (await api('/people/alex/props', { body: { what: 'a round oak table', size: [1.1, 0.76, 1.1] } })).json()
    check('a prop is made and returned as module text', typeof made.module === 'string' && /export function build/.test(made.module) && /^[a-f0-9]{12}$/.test(made.item), made.item)
    const stored = JSON.parse(await readFile(join(root, 'people', 'alex', 'library', `${made.item}.json`), 'utf8'))
    check('the made prop is stored under the person as a draft', stored.module === made.module && stored.kept === false && stored.name === 'a round oak table')
    check('a draft is not offered in the library', (await (await api('/people/alex/library')).json()).items.length === 0)
    check('keep marks it kept', (await api(`/people/alex/library/${made.item}/keep`, { body: {} })).status === 200)
    const lib = await (await api('/people/alex/library')).json()
    check('a kept prop is listed without its module', lib.items.length === 1 && lib.items[0].id === made.item && !('module' in lib.items[0]), lib)
    check('a kept prop can be fetched again', (await (await api(`/people/alex/library/${made.item}`)).json()).module === made.module)
    check("another person's library does not see it", (await (await api('/people/sam/library')).json()).items.length === 0 && (await api(`/people/sam/library/${made.item}`)).status === 404)
    const tattle = await (await api('/people/alex/props', { body: { what: 'tattle' } })).json()
    await api(`/people/alex/library/${tattle.item}`)
    await api(`/people/alex/library/${tattle.item}/keep`, { body: {} })
    await new Promise((r) => setTimeout(r, 200))
    check('the host never runs module text it stores and returns', tattle.module.includes('writeFileSync') && !existsSync(ran))
    for (const bad of ['..%2F..%2Fvillager%2Flaunch', 'ABCDEF123456', 'zzzzzzzzzzzz', '1234'])
      check(`library item "${bad}" is refused`, (await api(`/people/alex/library/${bad}`)).status === 404)
    check('what over 200 characters is refused', (await api('/people/alex/props', { body: { what: 'x'.repeat(201) } })).status === 400)
    check('a size that is not three metres is refused', (await api('/people/alex/props', { body: { what: 'chair', size: [1, 2] } })).status === 400 && (await api('/people/alex/props', { body: { what: 'chair', size: [1, 2, 99] } })).status === 400)
    const before = (await readdir(join(root, 'people', 'alex', 'library'))).length
    check('a maker failure is a 422 and stores nothing', (await api('/people/alex/props', { body: { what: 'chair [stub-make-fail]' } })).status === 422 && (await readdir(join(root, 'people', 'alex', 'library'))).length === before)

    // Projects.
    const project = await (await api('/people/alex/projects', { body: { what: 'a playable pinball machine', where: 'living room', text: "let's add a playable pinball machine in the living room" } })).json()
    check('a project is recorded as being made', project.project?.state === 'being made' && project.project.what === 'a playable pinball machine')
    const projects = await (await api('/people/alex/projects')).json()
    check('projects are listed for the person', projects.projects.length === 1 && projects.projects[0].id === project.project.id)
    check("another person's projects do not include it", (await (await api('/people/sam/projects')).json()).projects.length === 0)
    check('a project without what is refused', (await api('/people/alex/projects', { body: { where: 'x' } })).status === 400)
    check('an unlisted person has no input endpoints', (await route('hi')).status === 200 && (await api('/people/zoe/route', { body: { text: 'hi', primary: 'Dumpling', villagers: cast } })).status === 404)
    await host.fiber.dispose()
  }

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
