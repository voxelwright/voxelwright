// Headless checks of the #47 villager-making endpoints with a stub maker: orchestration
// only, no model is called. node test/villager-make.ts
// With --live, one real Sonnet call through the same endpoint (operator login).
import { chmod, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from 'cordis'
import villager from '../src/villager.ts'
import { stubAgent } from '../src/villager-agent.ts'
import { checkPersona, claudeVillagerMaker, extractPersona, parseProfiles, repairAsk, stubVillagerMaker, villagerAsk, villagerPrompt, type VillagerMaker } from '../src/villager-make.ts'

const live = process.argv.includes('--live')
const root = await mkdtemp(join(tmpdir(), 'villager-make-check-'))
const checks: { name: string; pass: boolean; detail?: unknown }[] = []
const check = (name: string, pass: unknown, detail?: unknown) => checks.push({ name, pass: Boolean(pass), detail })

async function start(villagerMaker?: VillagerMaker) {
  const ctx = new Context()
  const fiber = ctx.plugin(villager, { root, agent: stubAgent(5), port: 0, people: { alex: 'Alex', sam: 'Sam', jo: 'Jo' }, villagerMaker, profiles: parseProfiles('alex:adult-optin,sam:child') })
  await fiber.await()
  const launch = JSON.parse(await readFile(ctx.villager.launchFile, 'utf8'))
  const base = `http://127.0.0.1:${launch.port}`
  const api = (path: string, opts: { body?: unknown; token?: string | null; method?: string } = {}) => fetch(`${base}${path}`, {
    method: opts.method ?? (opts.body === undefined ? 'GET' : 'POST'),
    headers: { 'content-type': 'application/json', ...(opts.token === null ? {} : { authorization: `Bearer ${opts.token ?? launch.token}` }) },
    body: opts.body === undefined ? undefined : typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body),
  })
  return { fiber, api }
}

try {
  // The prompt is the round-1 files, not a copy.
  const system = villagerPrompt()
  const style = await readFile(join(import.meta.dirname, '../../home/scripts/villagers/style.md'), 'utf8')
  const arm = await readFile(join(import.meta.dirname, '../../home/scripts/villagers/arm-code.md'), 'utf8')
  check('the system prompt is style.md then arm-code.md, read from home/scripts/villagers', system === `${style}\n${arm}`)
  check('the request reads as the round-1 runner wrote it', villagerAsk('a sleepy hedgehog', 'Alex', '#c8553d') === "Make a villager: a sleepy hedgehog.\n\nIts owner is Alex; the owner's accent colour is #c8553d.")

  // The persona is data: known fields only, lengths capped, dials clamped; junk is null.
  const p = extractPersona('```js\nexport default function () {}\n```\n```json\n' + JSON.stringify({ persona: { role: 'keeper', speciality: 'x'.repeat(500), temperament: 'sarcastic', register: 'formal', humour: 'dry', quirks: ['a', 'b', 'c', 'd'], topics: [], dials: { warmth: 7, playful: -1, chatty: 'lots' }, admin: true } }) + '\n```')
  check('persona: known fields only, text capped, enums checked, dials clamped', p && p.speciality.length === 60 && p.temperament === 'calm' && p.register === 'formal' && p.quirks.length === 3 && p.dials.warmth === 1 && p.dials.playful === 0 && p.dials.chatty === 0.4 && !('admin' in p), p)
  check('persona: none, or not an object, is null', extractPersona('```js\nx\n```') === null && checkPersona([1]) === null && checkPersona({ temperament: 'dry' }) === null)
  const crude = { role: 'buddy', dials: { humour: 'crude' } }
  check('persona: model output never grants crude to a child or an unknown profile', checkPersona(crude, { adult: false, crudeOptIn: false })?.dials.humour === 'cheeky' && checkPersona(crude)?.dials.humour === 'cheeky' && checkPersona(crude, { adult: true, crudeOptIn: false })?.dials.humour === 'cheeky' && checkPersona(crude, { adult: true, crudeOptIn: true })?.dials.humour === 'crude')

  let calls: { description: string; owner: string; accent: string; repair?: { module: string; reason: string } }[] = []
  const stub = stubVillagerMaker(60)
  const counting: VillagerMaker = async (ask) => {
    calls.push({ description: ask.description, owner: ask.owner, accent: ask.accent, ...(ask.repair ? { repair: ask.repair } : {}) })
    return stub(ask)
  }
  let host = await start(counting)
  const { api } = host

  check('no token is refused', (await api('/people/alex/villagers', { body: { description: 'a hedgehog', accent: '#c8553d' }, token: null })).status === 401)
  check('a wrong token is refused', (await api('/people/alex/villagers', { body: { description: 'a hedgehog', accent: '#c8553d' }, token: 'f'.repeat(64) })).status === 401)
  check('an unlisted person is refused', (await api('/people/zed/villagers', { body: { description: 'a hedgehog', accent: '#c8553d' } })).status === 404)
  check('an odd person id is refused', (await api('/people/..%2Fetc/villagers', { body: { description: 'a hedgehog', accent: '#c8553d' } })).status === 404)
  check('an empty description is refused', (await api('/people/alex/villagers', { body: { description: '   ', accent: '#c8553d' } })).status === 400)
  check('a description over 300 characters is refused', (await api('/people/alex/villagers', { body: { description: 'x'.repeat(301), accent: '#c8553d' } })).status === 400)
  check('an accent that is not #rrggbb is refused', (await api('/people/alex/villagers', { body: { description: 'a hedgehog', accent: 'red' } })).status === 400)
  check('a body that is not JSON is refused', (await api('/people/alex/villagers', { body: '{nope' })).status === 400)
  check('no model was asked for any refused request', calls.length === 0, calls)

  const t0 = Date.now()
  const res = await api('/people/alex/villagers', { body: { description: '  a sleepy   hedgehog who bakes bread ', accent: '#3d7cc8' } })
  const made = await res.json() as { item: string; module: string; ms: number; models: string[] }
  check('a made villager comes back as module text with an item id', res.status === 200 && /^[a-f0-9]{12}$/.test(made.item) && made.module.includes('export default function (villager, api)'), { status: res.status, item: made.item })
  check('the maker saw the tidied description, the person\'s name and the accent', calls.length === 1 && calls[0].description === 'a sleepy hedgehog who bakes bread' && calls[0].owner === 'Alex' && calls[0].accent === '#3d7cc8', calls)
  check('the stub module wears the asked accent', made.module.includes("felt('#3d7cc8')") && !made.module.includes('#c8553d'))
  const stored = JSON.parse(await readFile(join(root, 'people', 'alex', 'villagers', `${made.item}.json`), 'utf8'))
  check('it is stored under the person, as text', stored.module === made.module && stored.description === 'a sleepy hedgehog who bakes bread' && stored.accent === '#3d7cc8' && typeof stored.ms === 'number', { ms: Date.now() - t0 })
  check('nothing is stored under another person', !(await readdir(join(root, 'people')).catch((): string[] => [])).includes('sam'))

  // One at a time per person.
  const slow = api('/people/alex/villagers', { body: { description: 'a slow one', accent: '#c8553d' } })
  await new Promise((r) => setTimeout(r, 15))
  const clash = await api('/people/alex/villagers', { body: { description: 'and another', accent: '#c8553d' } })
  const other = await api('/people/sam/villagers', { body: { description: 'sam\'s own', accent: '#e0b53a' } })
  await slow
  check('one villager at a time per person (409), another person is not blocked', clash.status === 409 && other.status === 200, { clash: clash.status, other: other.status })

  // A model failure is a 422 and stores nothing.
  const before = (await readdir(join(root, 'people', 'alex', 'villagers'))).length
  const failed = await api('/people/alex/villagers', { body: { description: 'a [stub-fail] fox', accent: '#c8553d' } })
  check('a maker failure is a 422 and stores nothing', failed.status === 422 && (await readdir(join(root, 'people', 'alex', 'villagers'))).length === before, failed.status)
  const empty = await start(async () => ({ module: '   ', models: ['stub'], costUsd: 0, outputTokens: 0, apiMs: 0 }))
  check('an empty module is a 422', (await empty.api('/people/alex/villagers', { body: { description: 'a fox', accent: '#c8553d' } })).status === 422)
  await empty.fiber.dispose()

  // Tuning: five numbers kept beside the module; no model call.
  const n = calls.length
  const tuned = await api(`/people/alex/villagers/${made.item}/tuning`, { body: { size: 0.7, hue: 0.4, pitch: 0.9, pace: 0.2, energy: 0.55, warmth: 0.3, playful: 0.6, chatty: 0.1, humour: 0.5 } })
  const got = await (await api(`/people/alex/villagers/${made.item}`)).json() as { module: string; tuning: Record<string, number> }
  check('tuning is kept with the module and read back', tuned.status === 200 && got.module === made.module && got.tuning.size === 0.7 && got.tuning.pitch === 0.9 && got.tuning.chatty === 0.1, got.tuning)
  check('tuning never calls the model', calls.length === n)
  // The humour knob's crude end is decided by the host's profile only, on save and on serve.
  const knobs = { size: 0.5, hue: 0.5, pitch: 0.5, pace: 0.5, energy: 0.5, warmth: 0.5, playful: 0.5, chatty: 0.5, humour: 1 }
  const samMade = await (await api('/people/sam/villagers', { body: { description: 'a gentle owl', accent: '#c8553d' } })).json() as { item: string }
  const joMade = await (await api('/people/jo/villagers', { body: { description: 'a quiet mole', accent: '#c8553d' } })).json() as { item: string }
  const storedHumour = async (person: string, item: string) => JSON.parse(await readFile(join(root, 'people', person, 'villagers', `${item}.json`), 'utf8')).tuning.humour
  const tunedSam = await api(`/people/sam/villagers/${samMade.item}/tuning`, { body: knobs })
  const tunedJo = await api(`/people/jo/villagers/${joMade.item}/tuning`, { body: knobs })
  await api(`/people/alex/villagers/${made.item}/tuning`, { body: knobs })
  check('tuning: humour 1 for a child or an unknown profile is stored as cheeky (0.5); an opted-in adult keeps crude', tunedSam.status === 200 && tunedJo.status === 200 && await storedHumour('sam', samMade.item) === 0.5 && await storedHumour('jo', joMade.item) === 0.5 && await storedHumour('alex', made.item) === 1)
  const samFile = join(root, 'people', 'sam', 'villagers', `${samMade.item}.json`)
  await writeFile(samFile, JSON.stringify({ ...JSON.parse(await readFile(samFile, 'utf8')), tuning: knobs }))
  const samServed = await (await api(`/people/sam/villagers/${samMade.item}`)).json() as { tuning: { humour: number } }
  check('tuning: a stored file edited to crude is served to a child as cheeky', samServed.tuning.humour === 0.5, samServed.tuning)
  check('tuning out of range is refused', (await api(`/people/alex/villagers/${made.item}/tuning`, { body: { size: 2, hue: 0.4, pitch: 0.9, pace: 0.2, energy: 0.5, warmth: 0.5, playful: 0.5, chatty: 0.5, humour: 0.5 } })).status === 400)
  check('tuning with a missing knob is refused', (await api(`/people/alex/villagers/${made.item}/tuning`, { body: { size: 0.5 } })).status === 400)
  check('another person cannot read it', (await api(`/people/sam/villagers/${made.item}`)).status === 404)
  check('an odd item id is refused', (await api('/people/alex/villagers/zzz')).status === 404)
  check('GET on the collection is not allowed', (await api('/people/alex/villagers')).status === 405)

  // Persona templates: data files per person, a family list of shared ones, gated for each reader.
  const tpl = (person: string, body: unknown) => api(`/people/${person}/persona-templates`, { body })
  check('templates need the token', (await api('/people/alex/persona-templates', { token: null })).status === 401)
  check('templates: an unlisted person is refused', (await api('/people/zed/persona-templates')).status === 404)
  check('templates: no name or no persona is refused', (await tpl('alex', { name: '', persona: { temperament: 'dry' } })).status === 400 && (await tpl('alex', { name: 'x', persona: { nonsense: 1 } })).status === 400)
  const mine = await (await tpl('alex', { name: 'Late-night buddy', persona: { temperament: 'wry', humour: 'wordplay', quirks: ['Roasts the plan, then does it'], dials: { warmth: 0.6, playful: 0.9, chatty: 0.5, humour: 'crude' }, admin: true }, shared: true })).json() as { template: { id: string; persona: { dials: { humour: string } } } }
  check('templates: an opted-in adult keeps crude on their own pattern', mine.template.persona.dials.humour === 'crude' && !('admin' in mine.template.persona))
  const own = await (await api('/people/alex/persona-templates')).json() as { templates: { id: string; persona: { dials: { humour: string } } }[]; profile: unknown }
  check('templates: it reloads for its maker, unchanged', own.templates.length === 1 && own.templates[0].id === mine.template.id && own.templates[0].persona.dials.humour === 'crude', own)
  await tpl('alex', { name: 'Grown-ups only', persona: { temperament: 'dry' }, audience: 'adult', shared: true })
  await tpl('alex', { name: 'Private one', persona: { temperament: 'calm' } })
  const fam = async (who?: string) => (await (await api(`/family/persona-templates${who ? `?for=${who}` : ''}`)).json() as { templates: { name: string; maker: string; persona: { dials?: { humour?: string } } }[] }).templates
  const forSam = await fam('sam'), forJo = await fam('jo'), forNone = await fam()
  check('family: a shared pattern appears for another person, a private one does not', forSam.some((t) => t.name === 'Late-night buddy' && t.maker === 'alex') && !forSam.some((t) => t.name === 'Private one'), forSam.map((t) => t.name))
  check('family: a crude pattern is cheeky for a child, an unknown profile and no reader', forSam.find((t) => t.name === 'Late-night buddy')?.persona.dials?.humour === 'cheeky' && forJo.find((t) => t.name === 'Late-night buddy')?.persona.dials?.humour === 'cheeky' && forNone.find((t) => t.name === 'Late-night buddy')?.persona.dials?.humour === 'cheeky')
  check('family: an adults-only pattern is not offered to a child', !forSam.some((t) => t.name === 'Grown-ups only') && (await fam('alex')).some((t) => t.name === 'Grown-ups only'))
  const kid = await (await tpl('sam', { name: 'Cheeky', persona: { temperament: 'wry', dials: { humour: 'crude' } } })).json() as { template: { id: string; persona: { dials: { humour: string } } } }
  check('templates: a child saving crude stores cheeky', kid.template.persona.dials.humour === 'cheeky' && JSON.parse(await readFile(join(root, 'people', 'sam', 'persona-templates', `${kid.template.id}.json`), 'utf8')).persona.dials.humour === 'cheeky')
  // A stored file edited by hand to crude is still served cheeky to the child.
  await writeFile(join(root, 'people', 'sam', 'persona-templates', `${kid.template.id}.json`), JSON.stringify({ ...kid.template, persona: { temperament: 'wry', dials: { humour: 'crude' } } }))
  const reread = await (await api('/people/sam/persona-templates')).json() as { templates: { persona: { dials: { humour: string } } }[] }
  check('templates: a stored file never unlocks crude for a child on load', reread.templates[0].persona.dials.humour === 'cheeky', reread.templates)
  await mkdir(join(root, 'people', 'sam', 'persona-templates'), { recursive: true })
  await writeFile(join(root, 'people', 'sam', 'persona-templates', 'junk.json'), '{')
  check('templates: a stray file is ignored', (await (await api('/people/sam/persona-templates')).json() as { templates: unknown[] }).templates.length === 1)

  check('templates: the person\'s own list says their profile, from the host', JSON.stringify((await (await api('/people/sam/persona-templates')).json() as { profile: unknown }).profile) === JSON.stringify({ adult: false, crudeOptIn: false }) && (await (await api('/people/jo/persona-templates')).json() as { profile: unknown }).profile === null)

  // Remake: once, with the home's refusal reason; the model sees its previous module and the reason.
  calls = []
  const first = await (await api('/people/alex/villagers', { body: { description: 'a [stub-mark-head] giraffe', accent: '#c8553d' } })).json() as { item: string; module: string }
  check('remake: the stub\'s first module marks its whole head', first.module.includes("villager.mark(villager.tag(new THREE.Group(), 'head'))"))
  check('remake: a reason is required', (await api(`/people/alex/villagers/${first.item}/remake`, { body: { reason: '  ' } })).status === 400)
  const reason = 'check: the head itself is tagged with villager.mark(); tag only the carer\'s stocking cap ' + 'x'.repeat(2000)
  const remade = await api(`/people/alex/villagers/${first.item}/remake`, { body: { reason } })
  const second = await remade.json() as { item: string; module: string }
  const record = JSON.parse(await readFile(join(root, 'people', 'alex', 'villagers', `${first.item}.json`), 'utf8'))
  check('remake: the model gets its previous module and the capped reason, and the new module comes back', remade.status === 200 && second.item === first.item && !second.module.includes('villager.mark(villager.tag') && calls.length === 2 && calls[1].repair?.module === first.module && calls[1].repair?.reason.length === 600 && calls[1].repair?.reason.startsWith('check: the head itself'), { status: remade.status, calls: calls.length, reason: calls[1]?.repair?.reason.length })
  check('remake: the record keeps the new module, the reason and the previous module', record.module === second.module && record.repair?.previous === first.module && record.repair?.reason.length === 600 && typeof record.repair?.ms === 'number')
  check('remake: only once per villager (409), and never for another person\'s or an unknown villager', (await api(`/people/alex/villagers/${first.item}/remake`, { body: { reason: 'again' } })).status === 409 && (await api(`/people/sam/villagers/${first.item}/remake`, { body: { reason: 'x' } })).status === 404 && (await api('/people/alex/villagers/aaaaaaaaaaaa/remake', { body: { reason: 'x' } })).status === 404 && calls.length === 2)
  check('remake: the repair prompt is the runner\'s', repairAsk('ASK', 'MOD', 'WHY') === 'ASK\n\nYour previous file:\n```js\nMOD\n```\n\nIt failed with this error:\nWHY\n\nReturn the corrected complete file.')

  // Storage: every write goes to a temporary file and is renamed over the record.
  const vdir = join(root, 'people', 'alex', 'villagers')
  const good = await readFile(join(vdir, `${made.item}.json`), 'utf8')
  await writeFile(join(vdir, `${made.item}.json.deadbeef.tmp`), good.slice(0, 40))
  check('storage: a partial temporary file left by a crash never replaces the good record', (await api(`/people/alex/villagers/${made.item}`)).status === 200 && await readFile(join(vdir, `${made.item}.json`), 'utf8') === good)
  await rm(join(vdir, `${made.item}.json.deadbeef.tmp`))
  const count = (await readdir(vdir)).length
  await chmod(vdir, 0o500)
  try {
    const failedTune = await api(`/people/alex/villagers/${made.item}/tuning`, { body: { ...knobs, size: 0.9 } })
    const failedMake = await api('/people/alex/villagers', { body: { description: 'a badger', accent: '#c8553d' } })
    const after = await api(`/people/alex/villagers/${made.item}`)
    check('storage: a failed write answers 500 (not the maker\'s 422) and leaves the record whole and readable', failedTune.status === 500 && failedMake.status === 500 && after.status === 200 && await readFile(join(vdir, `${made.item}.json`), 'utf8') === good, { tune: failedTune.status, make: failedMake.status, get: after.status })
    check('storage: the making lock is released after a storage failure (500 again, not 409)', (await api('/people/alex/villagers', { body: { description: 'a badger', accent: '#c8553d' } })).status === 500)
  } finally {
    await chmod(vdir, 0o700)
  }
  check('storage: no temporary file is left behind', (await readdir(vdir)).length === count && (await readdir(vdir)).every((f) => f.endsWith('.json')))

  await host.fiber.dispose()
  // Without a maker the endpoint answers 503 (the host is up, the feature is not).
  host = await start()
  check('no maker configured answers 503', (await host.api('/people/alex/villagers', { body: { description: 'a fox', accent: '#c8553d' } })).status === 503)
  // The old routes still answer as before.
  check('the existing conversation route is untouched', (await host.api('/people/alex/conversation')).status === 200)
  await host.fiber.dispose()

  if (live) {
    const real = await start(claudeVillagerMaker('sonnet'))
    const t1 = Date.now()
    const r = await real.api('/people/alex/villagers', { body: { description: 'a sleepy hedgehog who bakes bread before dawn', accent: '#c8553d' } })
    const body = await r.json() as Record<string, unknown>
    const wall = Date.now() - t1
    check('live: Sonnet writes a villager module through the endpoint', r.status === 200 && String(body.module).includes('villager.tag('), { status: r.status, persona: body.persona, wallMs: wall, ms: body.ms, apiMs: body.apiMs, models: body.models, costUsd: body.costUsd, outputTokens: body.outputTokens, chars: String(body.module ?? '').length })
    await real.fiber.dispose()
  }
} finally {
  await rm(root, { recursive: true, force: true })
}

for (const c of checks) console.log(`${c.pass ? 'ok  ' : 'FAIL'} ${c.name}${c.pass && !c.name.startsWith('live') ? '' : c.detail === undefined ? '' : ` ${JSON.stringify(c.detail)}`}`)
const failedCount = checks.filter((c) => !c.pass).length
console.log(`${checks.length - failedCount} of ${checks.length} passed (${live ? 'stub + one live Sonnet call' : 'stub maker, orchestration only'})`)
process.exit(failedCount ? 1 : 0)
