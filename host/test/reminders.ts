// Headless checks of reminders (#86) with the stub agent and a controlled clock: no model is called.
// npm run check-reminders
import { chmod, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from 'cordis'
import villager from '../src/villager.ts'
import { stubAgent, warmAgent, type StartQuery } from '../src/villager-agent.ts'
import { pairedLaunch } from './paired.ts'
import { GRACE_MS, MAX_OPEN, REMINDER_TOOLS, reminderDesk, reminderStore, transition, type Reminder } from '../src/reminders.ts'

const root = await mkdtemp(join(tmpdir(), 'reminders-check-'))
const checks: { name: string; pass: boolean; detail?: unknown }[] = []
const check = (name: string, pass: unknown, detail?: unknown) => checks.push({ name, pass: Boolean(pass), detail })

const ZONE = 'Europe/Kyiv'
let t = Date.parse('2026-11-09T12:00:00Z') // 14:00 on Monday in Kyiv
const clock = () => t
const minutes = (m: number) => (t += m * 60_000)

async function start() {
  const ctx = new Context()
  const fiber = ctx.plugin(villager, { root, agent: stubAgent(1), port: 0, people: { alex: 'Alex', sam: 'Sam', mia: 'Mia' }, now: clock })
  await fiber.await()
  const launch = await pairedLaunch(ctx.villager, ['alex', 'sam', 'mia'])
  return { fiber, base: `http://127.0.0.1:${launch.port}`, tokens: launch.tokens as Record<string, string> }
}
type Host = Awaited<ReturnType<typeof start>>

/** A line to a villager, as the page sends it; the reply that came back (`done`), or the failure. */
async function say(host: Host, as: string, text: string, path = `/people/${as}/messages`): Promise<{ status: number; reply?: string; failed?: boolean }> {
  const res = await fetch(`${host.base}${path}`, { method: 'POST', headers: { cookie: `village_session=${host.tokens[as]}`, 'content-type': 'application/json' }, body: JSON.stringify({ text, zone: ZONE }) })
  if (!res.headers.get('content-type')?.startsWith('text/event-stream')) return { status: res.status }
  const raw = await res.text()
  const done = /event: done\ndata: (.*)/.exec(raw)
  return { status: res.status, ...(done ? { reply: JSON.parse(done[1]).reply } : { failed: true }) }
}
const get = async (host: Host, as: string, person = as, zone = ZONE) => {
  const res = await fetch(`${host.base}/people/${person}/reminders?zone=${encodeURIComponent(zone)}`, { headers: { cookie: `village_session=${host.tokens[as]}` } })
  return { status: res.status, body: await res.json() as { villager: string; reminders: (Pick<Reminder, 'id' | 'what' | 'at' | 'state' | 'late'> & { when: string; today: boolean })[]; error?: string } }
}
const post = async (host: Host, as: string, id: string, body: unknown, person = as) => {
  const res = await fetch(`${host.base}/people/${person}/reminders/${id}`, { method: 'POST', headers: { cookie: `village_session=${host.tokens[as]}`, 'content-type': 'application/json' }, body: JSON.stringify(body) })
  return { status: res.status, body: await res.json() as { reminder?: { state: string; at: string; when: string }; error?: string } }
}
const file = join(root, 'people', 'alex', 'reminders.json')
const stored = async (): Promise<Reminder[]> => JSON.parse(await readFile(file, 'utf8')).reminders
const find = <T extends { what: string }>(list: T[], words: string) => list.find((r) => r.what.includes(words))

try {
  let host = await start()

  // Set, in the person's zone, with the understood time said back.
  const dentist = await say(host, 'alex', 'remind me to call the dentist tomorrow at nine [stub-remind:call the dentist|at=2026-11-10T09:00]')
  check('set: the villager says the understood time back in plain words', dentist.reply?.includes('"call the dentist", tomorrow (Tuesday 10 November) at 9:00 am (Europe/Kyiv time)'), dentist)
  check('set: the turn was told the person\'s date, time and zone', (await readFile(join(root, 'people', 'alex', 'stub-last-now.txt'), 'utf8')) === 'Now it is Monday 9 November 2026, 14:00 in Europe/Kyiv.')
  check('set: the own villager\'s prompt has the reminder rules and no longer denies reminders', ((p) => p.includes('You keep one-off reminders for Alex') && p.includes('cannot set repeating reminders') && !p.includes('messages or reminders'))(await readFile(join(root, 'people', 'alex', 'stub-last-prompt.txt'), 'utf8')))
  const bread = await say(host, 'alex', 'remind me in 20 minutes to take the bread out [stub-remind:take the bread out|in=20]')
  check('set: "in 20 minutes" is today at 2:20 pm', bread.reply?.includes('today at 2:20 pm'), bread)
  let list = await stored()
  check('stored: two pending reminders, the dentist at 07:00 UTC', list.length === 2 && list.every((r) => r.state === 'pending') && find(list, 'dentist')?.at === '2026-11-10T07:00:00.000Z', list)
  check('stored: the file is 0600 and no temp file is left', ((await stat(file)).mode & 0o777) === 0o600 && !(await readdir(join(root, 'people', 'alex'))).some((f) => f.endsWith('.tmp')))

  // Bad times are refused in plain words, and nothing is kept.
  const past = await say(host, 'alex', '[stub-remind:yesterday thing|at=2026-11-09T09:00]')
  check('refused: a time that has passed, said plainly', past.reply?.startsWith('That time has already passed') && (await stored()).length === 2, past)
  const gap = await say(host, 'alex', '[stub-remind:spring thing|at=2027-03-28T03:30]')
  check('refused: a time the clocks skip', gap.reply?.includes('never happens on that day in Europe/Kyiv'), gap)
  const nonsense = await say(host, 'alex', '[stub-remind:odd|at=2026-02-30T09:00]')
  check('refused: a date that does not exist', nonsense.reply?.includes('There is no such date'), nonsense)
  check('refused: nothing was kept for any of them', (await stored()).length === 2)

  // "What's coming up?"
  const upcoming = await say(host, 'alex', "what's coming up? [stub-reminders]")
  check('list: soonest first, with the time in words', /take the bread out", today at 2:20 pm \(waiting\)\n.*call the dentist", tomorrow/.test(upcoming.reply ?? ''), upcoming)

  // A restart keeps them; nothing is due yet.
  await host.fiber.dispose()
  host = await start()
  let page = await get(host, 'alex')
  check('restart: both reminders survive and nothing is due', page.status === 200 && page.body.reminders.length === 2 && page.body.reminders.every((r) => r.state === 'pending'), page.body)
  check('the page gets the villager\'s name for the signature', typeof page.body.villager === 'string' && page.body.villager.length > 0, page.body.villager)
  check('today: the bread is today, the dentist is not', find(page.body.reminders, 'bread')?.today === true && find(page.body.reminders, 'dentist')?.today === false)

  // Time passes with the page open: due, shown once, ticked off.
  minutes(21)
  page = await get(host, 'alex')
  const breadId = find(page.body.reminders, 'bread')!.id
  check('due: the bread arrives as due, not missed', find(page.body.reminders, 'bread')?.state === 'due' && !find(page.body.reminders, 'bread')?.late, page.body)
  check('due: asking again before the page acks still says due (never dropped)', find((await get(host, 'alex')).body.reminders, 'bread')?.state === 'due')
  const ack = await post(host, 'alex', breadId, { action: 'shown', zone: ZONE })
  check('shown: the page\'s ack moves it to shown', ack.status === 200 && ack.body.reminder?.state === 'shown', ack)
  check('shown: a repeated ack changes nothing', (await post(host, 'alex', breadId, { action: 'shown' })).body.reminder?.state === 'shown')
  check('shown: it is no longer arriving', find((await get(host, 'alex')).body.reminders, 'bread')?.state === 'shown')
  const ticked = await post(host, 'alex', breadId, { action: 'done' })
  check('done: ticked off', ticked.status === 200 && ticked.body.reminder?.state === 'done', ticked)
  page = await get(host, 'alex')
  check('today: a ticked-off one stays on the today note as done', find(page.body.reminders, 'bread')?.state === 'done' && find(page.body.reminders, 'bread')?.today === true, page.body)

  // Missed while the host was down and the home closed: shown once, as missed.
  await host.fiber.dispose()
  t = Date.parse('2026-11-10T07:30:00Z')
  host = await start()
  page = await get(host, 'alex')
  const dentistId = find(page.body.reminders, 'dentist')!.id
  check('missed: due while closed, it arrives late (due, marked late)', find(page.body.reminders, 'dentist')?.state === 'due' && find(page.body.reminders, 'dentist')?.late === true, page.body)
  check('missed: never dropped, it is still in the file, late', (await stored()).some((r) => r.id === dentistId && r.state === 'due' && r.late === true))
  await post(host, 'alex', dentistId, { action: 'shown' })
  page = await get(host, 'alex')
  check('missed: once shown it is not delivered again, and still says it was missed', find(page.body.reminders, 'dentist')?.state === 'shown' && find(page.body.reminders, 'dentist')?.late === true, page.body)

  // Put off: an hour, then tomorrow morning.
  const later = await post(host, 'alex', dentistId, { action: 'later', until: 'hour', zone: ZONE })
  check('put off an hour', later.body.reminder?.state === 'put off' && Date.parse(later.body.reminder.at) === t + 3_600_000 && later.body.reminder.when === 'today at 10:30 am', later)
  check('put off clears missed', !(await stored()).find((r) => r.id === dentistId)?.late)
  minutes(61)
  page = await get(host, 'alex')
  check('put off: it comes back as due an hour later (a new delivery)', find(page.body.reminders, 'dentist')?.state === 'due', page.body)
  // Another device in another zone polls (B1): it is answered in its zone, but the person's zone stays the one their line gave.
  await say(host, 'alex', 'thanks')
  const elsewhere = await get(host, 'alex', 'alex', 'America/New_York')
  check('a poll from another zone is answered in that zone', (elsewhere.body as { zone?: string }).zone === 'America/New_York')
  // An ack from that device carries its zone too; it is used for that ack and not kept as the person's.
  check('an ack from another zone is answered', (await post(host, 'alex', dentistId, { action: 'shown', zone: 'America/New_York' })).status === 200)
  const morning = await post(host, 'alex', dentistId, { action: 'later', until: 'morning' })
  check("no-zone fallback: put off without a zone falls back to the zone of Alex's last line (9:00 am in Kyiv), not a polling or acking device's", morning.body.reminder?.at === '2026-11-11T07:00:00.000Z' && morning.body.reminder.when.startsWith('tomorrow (Wednesday 11 November) at 9:00 am'), morning)
  check('put off: a waiting one cannot be put off again from the page', (await post(host, 'alex', dentistId, { action: 'later', until: 'hour' })).status === 409)
  // The page always sends its zone: put off from a New York device, tomorrow morning is 9:00 in New York.
  await say(host, 'alex', '[stub-remind:call the bank|in=1]')
  minutes(2)
  const bankId = find((await get(host, 'alex')).body.reminders, 'bank')!.id
  const nyMorning = await post(host, 'alex', bankId, { action: 'later', until: 'morning', zone: 'America/New_York' })
  const nyWall = new Intl.DateTimeFormat('en-GB', { timeZone: 'America/New_York', hourCycle: 'h23', hour: '2-digit', minute: '2-digit', day: '2-digit' })
  check('put off until tomorrow morning from a New York device: 9:00 the next morning in New York', nyWall.format(new Date(nyMorning.body.reminder?.at ?? 0)).endsWith('09:00') && Date.parse(nyMorning.body.reminder?.at ?? '') > t && Date.parse(nyMorning.body.reminder?.at ?? '') - t < 86_400_000 + 3_600_000 * 10, nyMorning.body.reminder)

  // A due one the page never showed becomes late once it is GRACE_MS old (the page closed before it could show it).
  await say(host, 'alex', '[stub-remind:stretch|in=5]')
  minutes(5)
  check('unshown due: due first', find((await get(host, 'alex')).body.reminders, 'stretch')?.state === 'due')
  minutes(GRACE_MS / 60_000 + 1)
  check('unshown due: then late, still waiting to be shown', ((r) => r?.state === 'due' && r.late === true)(find((await get(host, 'alex')).body.reminders, 'stretch')))

  // Cancel through the villager.
  await say(host, 'alex', '[stub-remind:water the plants|in=30]')
  const cancelled = await say(host, 'alex', 'cancel the plants one [stub-cancel:plants]')
  check('cancel: through the villager, said back', cancelled.reply?.startsWith('Cancelled: "water the plants"'), cancelled)
  const plantsId = (await stored()).find((r) => r.what === 'water the plants')!.id
  check('cancel: it is cancelled in the file and gone from the page', (await stored()).find((r) => r.id === plantsId)?.state === 'cancelled' && !find((await get(host, 'alex')).body.reminders, 'plants'))
  check('cancel: a cancelled one cannot be ticked off (409)', (await post(host, 'alex', plantsId, { action: 'done' })).status === 409)
  const dentistCancel = await say(host, 'alex', 'cancel the dentist one [stub-cancel:dentist]')
  check('cancel the dentist one', dentistCancel.reply?.startsWith('Cancelled: "call the dentist"'), dentistCancel)

  // Bad requests from the page.
  check('page: a bad zone is 400', (await get(host, 'alex', 'alex', 'Mars/Base')).status === 400)
  check('page: an unknown action is 400', (await post(host, 'alex', plantsId, { action: 'eat' })).status === 400)
  check('page: an unknown id is 404', (await post(host, 'alex', 'deadbeef', { action: 'done' })).status === 404)
  check('page: a malformed id is 404', (await post(host, 'alex', '..%2Fx', { action: 'done' })).status === 404)
  check('messages: a bad zone is 400', (await fetch(`${host.base}/people/alex/messages`, { method: 'POST', headers: { cookie: `village_session=${host.tokens.alex}` }, body: JSON.stringify({ text: 'hi', zone: '../etc' }) })).status === 400)

  // Only the person sees their reminders.
  const before = await readFile(file, 'utf8')
  check("another person: Sam's session on Alex's reminders is 403", (await get(host, 'sam', 'alex')).status === 403)
  check("another person: Sam's session cannot tick Alex's off (403)", (await post(host, 'sam', dentistId, { action: 'done' }, 'alex')).status === 403)
  check("another person: Sam's own list is empty, not Alex's", (await get(host, 'sam')).body.reminders?.length === 0)
  const visit = await say(host, 'sam', 'what is coming up for Alex? [stub-reminders]', '/people/sam/visits/alex/messages')
  check('a visitor: the villager has no reminder tools on a visit and says so', visit.reply?.includes("can't see or set reminders here"), visit)
  const visitSet = await say(host, 'sam', '[stub-remind:prank Alex|in=5]', '/people/sam/visits/alex/messages')
  check('a visitor cannot set one through the visit', visitSet.reply?.includes("can't see or set reminders here") && !existsSync(join(root, 'people', 'sam', 'reminders.json')))
  check("a visit's prompt has no reminder tools", (await readFile(join(root, 'people', 'sam', 'visits', 'alex', 'stub-last-prompt.txt'), 'utf8')).includes('Reminders are kept only between a person and their own villager'))
  check('a visit has no reminder paths (404)', (await fetch(`${host.base}/people/sam/visits/alex/reminders`, { headers: { cookie: `village_session=${host.tokens.sam}` } })).status === 404)
  check("Alex's reminders file is unchanged by all of that", (await readFile(file, 'utf8')) === before)
  check('no session is 401', (await fetch(`${host.base}/people/alex/reminders`)).status === 401)

  // The next day the bread ticked off yesterday is gone from today's note; after two weeks it is gone from the file.
  minutes(24 * 60)
  check("today: yesterday's ticked-off reminder is gone from today's note", !find((await get(host, 'alex')).body.reminders, 'bread'))
  check('a finished reminder is still kept before two weeks', (await stored()).some((r) => r.id === breadId && r.state === 'done'))
  minutes(15 * 24 * 60)
  await say(host, 'alex', '[stub-remind:fold the laundry|in=30]')
  check('finished reminders older than two weeks are pruned at the next write', !(await stored()).some((r) => r.id === breadId) && (await stored()).some((r) => r.what === 'fold the laundry'))

  const beforeFailure = await readFile(file, 'utf8')
  // A failed write never looks like success.
  const alexDir = join(root, 'people', 'alex')
  await chmod(alexDir, 0o500)
  try {
    const blocked = await say(host, 'alex', '[stub-remind:something|in=10]')
    check('failed write: the villager is told it did not work', blocked.reply?.includes('the reminder was not kept') && blocked.reply.includes('did not work'), blocked)
    const tick = await post(host, 'alex', (await stored()).find((r) => r.what === 'stretch')!.id, { action: 'shown' })
    check('failed write: the page gets 500, not a success', tick.status === 500, tick)
  } finally {
    await chmod(alexDir, 0o700)
  }
  check('failed write: nothing changed', (await readFile(file, 'utf8')) === beforeFailure)
  // A file that cannot be read is never treated as empty (that would drop reminders).
  await writeFile(file, '{"version": 1, "reminders": [{"id": "nope"}]}')
  check('a malformed file: the page gets 500', (await get(host, 'alex')).status === 500)
  const overwrite = await say(host, 'alex', '[stub-remind:fresh|in=10]')
  check('a malformed file: setting one fails plainly and the file is not overwritten', overwrite.reply?.includes('did not work') && (await readFile(file, 'utf8')).includes('"nope"'))
  await writeFile(file, beforeFailure)
  await host.fiber.dispose()

  // The warm agent keeps the words a model says after a reminder tool (the time it understood).
  {
    const fake: StartQuery = ({ prompt }) => {
      const lines = prompt[Symbol.asyncIterator]()
      const out: unknown[] = []
      let wake: (() => void) | null = null
      let closed = false
      const emit = (m: unknown) => { out.push(m); wake?.() }
      const delta = (text: string) => emit({ type: 'stream_event', parent_tool_use_id: null, event: { type: 'content_block_delta', delta: { type: 'text_delta', text } } })
      void (async () => {
        await lines.next()
        emit({ type: 'system', subtype: 'init', mcp_servers: [{ name: 'notes', status: 'connected', source: 'sdk' }, { name: 'reminders', status: 'connected', source: 'sdk' }], tools: REMINDER_TOOLS })
        delta('Let me pop that on the fridge.')
        emit({ type: 'stream_event', parent_tool_use_id: null, event: { type: 'content_block_start', content_block: { type: 'tool_use', name: 'mcp__reminders__set_reminder' } } })
        emit({ type: 'stream_event', parent_tool_use_id: null, event: { type: 'message_start' } })
        delta('Done: tomorrow at 9:00 am.')
        emit({ type: 'result', subtype: 'success', is_error: false, result: '', session_id: 's1', modelUsage: {}, usage: {}, total_cost_usd: 0 })
      })()
      return {
        async next() {
          while (!out.length && !closed) await new Promise<void>((r) => (wake = r))
          return closed ? { value: undefined, done: true } : { value: out.shift(), done: false }
        },
        close() { closed = true; wake?.() },
      } as ReturnType<StartQuery>
    }
    const agent = warmAgent({ model: 'fake' }, fake)
    const desk = reminderDesk(reminderStore(join(root, 'fake')), () => ZONE, clock)
    const r = await agent({ name: 'Alex', text: 'remind me', reminders: desk, notesDir: join(root, 'fake', 'notes'), personDir: join(root, 'fake'), signal: AbortSignal.timeout(2000), onText: () => {} })
    check('warm: words after a reminder tool are kept (the understood time)', r.reply === 'Let me pop that on the fridge. Done: tomorrow at 9:00 am.' && (r.usage as { spokeAfterReminder?: boolean }).spokeAfterReminder === true, r.reply)
    agent.close!()
  }

  // The store on its own: the transition table, bounds and concurrent writes.
  {
    // At most 100 finished reminders are kept, the newest.
    const hundred = reminderStore(join(root, 'people', 'many'))
    await hundred.update(t, () => ({ list: Array.from({ length: 105 }, (_, i) => ({ id: (0x10000000 + i).toString(16), what: `done ${i}`, at: new Date(t - 3_600_000).toISOString(), state: 'done' as const, changed: new Date(t - (105 - i) * 60_000).toISOString() })), result: null }))
    const keptFinal = JSON.parse(await readFile(join(root, 'people', 'many', 'reminders.json'), 'utf8')).reminders as { what: string }[]
    check('at most 100 finished reminders are kept, the newest', keptFinal.length === 100 && !keptFinal.some((r) => ['done 0', 'done 4'].includes(r.what)) && keptFinal.some((r) => r.what === 'done 104'), keptFinal.length)

    const base: Reminder = { id: 'aaaaaaaa', what: 'x', at: new Date(t + 60_000).toISOString(), state: 'pending', changed: '' }
    const refused = (r: Reminder, kind: 'shown' | 'later' | 'cancel') => { try { transition(r, kind === 'later' ? { kind, at: t } : { kind }, t); return false } catch { return true } }
    check('transition: a pending one cannot be shown or put off', refused(base, 'shown') && refused(base, 'later'))
    check('transition: arriving before its time changes nothing', transition(base, { kind: 'arrive' }, t) === base)
    check('transition: done and cancelled are final', refused({ ...base, state: 'done' }, 'cancel') && refused({ ...base, state: 'cancelled' }, 'later'))
    const desk = reminderDesk(reminderStore(join(root, 'bounds')), () => ZONE, clock)
    const many = await Promise.all(Array.from({ length: MAX_OPEN + 5 }, (_, i) => desk.set({ what: `thing ${i}`, in_minutes: i + 1 })))
    const kept = JSON.parse(await readFile(join(root, 'bounds', 'reminders.json'), 'utf8')).reminders.length
    check(`bounds: ${MAX_OPEN + 5} set at once keep exactly ${MAX_OPEN} (one write at a time) and refuse the rest plainly`, kept === MAX_OPEN && many.filter((m) => m.isError && m.text.includes('already 50 reminders')).length === 5, kept)
    const long = await reminderDesk(reminderStore(join(root, 'long')), () => ZONE, clock).set({ what: 'x'.repeat(161), in_minutes: 5 })
    check('bounds: what is at most 160 characters', long.isError && long.text.includes('160'))
    const controls = await reminderDesk(reminderStore(join(root, 'clean')), () => ZONE, clock).set({ what: 'line\none\u0007 two', in_minutes: 5 })
    check('what is cleaned to one line', controls.text.includes('"line one two"'), controls)
    const both = await desk.set({ what: 'x', at: '2026-11-10T09:00', in_minutes: 5 })
    check('both a time and minutes is refused', both.isError && both.text.startsWith('Give either'))
  }
} finally {
  await rm(root, { recursive: true, force: true })
}

for (const c of checks) console.log(`${c.pass ? 'pass' : 'FAIL'}  ${c.name}${c.pass ? '' : `  ${JSON.stringify(c.detail)}`}`)
const failed = checks.filter((c) => !c.pass).length
console.log(`${checks.length - failed} of ${checks.length} passed`)
process.exitCode = failed ? 1 : 0
