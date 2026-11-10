// Reminders (#86): what a person asked their own villager to remind them of, kept in
// one file in their folder, <root>/people/<id>/reminders.json (mode 0600, written to a
// temporary file and renamed, so a crash never leaves half a file). Only the person's own
// villager and their own paired session reach it; a visit never has these tools (villager.ts).
//
// Times are said in the person's time zone (villager.ts keeps the zone of their last line);
// the instant a reminder is due is stored in UTC. The host takes an injectable clock (`now`),
// so the checks control time.
//
// `transition` is the one owner of every state change. Settling (time passing) happens
// when the page asks for reminders or the villager uses a tool, never in the background:
// a reminder whose time passed while nobody was looking (host down, page closed) arrives
// late (`due` with `late`), and is shown once, marked as missed, the next time the page opens.
import { randomBytes } from 'node:crypto'
import { lstat, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk'
import { z } from 'zod'
import { withFileLock } from './file-lock.ts'

/**
 * Where a reminder is. Waiting: `pending`, `put off`. On its way to the page: `due`. On the fridge: `shown`.
 * Final: `done`, `cancelled`. Whether it arrived late is a separate fact, `late`.
 *
 * - pending: set, waiting for its time.
 * - put off: the person put it off from the fridge (an hour, or tomorrow morning); waiting for the new time.
 * - due: its time came; the page has not yet said it showed it. `late` when it came while no page was asking (the host
 *   was down or the home closed: settled more than GRACE_MS after its time), or it stayed unshown that long.
 * - shown: the page showed it (it said so with an ack); it stays on the fridge until ticked off or put off.
 * - done: ticked off by the person (from the fridge or the today note). Final.
 * - cancelled: cancelled through the villager. Final.
 */
export type State = 'pending' | 'put off' | 'due' | 'shown' | 'done' | 'cancelled'

export interface Reminder {
  /** 8 lowercase hex digits. */
  id: string
  /** What to be reminded of, one cleaned line, as the villager wrote it from the person's words. */
  what: string
  /** The instant it is (next) due, ISO 8601 in UTC. Putting it off moves it. */
  at: string
  state: State
  /** When its state last changed, ISO 8601 UTC: final reminders are pruned by it. */
  changed: string
  /** It arrived late (see State); kept while it is `shown` so the fridge can say so; cleared when put off. */
  late?: true
}

interface File { version: 1; reminders: Reminder[] }

export type Event =
  | { kind: 'arrive' }
  | { kind: 'shown' }
  | { kind: 'done' }
  | { kind: 'later'; at: number }
  | { kind: 'cancel' }

/** A refusal said in plain words, for the person (through the villager or the page). */
export class ReminderError extends Error {
  /** The HTTP status for the page: 400 for a bad ask, 404 for no such reminder, 409 for a change its state does not allow. */
  readonly status: number
  constructor(message: string, status = 409) {
    super(message)
    this.status = status
  }
}

const ID = /^[a-f0-9]{8}$/
const MAX_WHAT = 160
/** Waiting or on its way: at most this many at once. */
export const MAX_OPEN = 50
/** Done and cancelled ones are kept this long (for the today note), and at most MAX_FINAL of them. */
const KEEP_FINAL_MS = 14 * 86_400_000
const MAX_FINAL = 100
const MAX_FILE = 128_000
/** How late a reminder may be settled and still count as arriving while the home was open. Above Chrome's one-per-minute timer for hidden tabs. */
export const GRACE_MS = 5 * 60_000
const MAX_AHEAD_MS = 366 * 86_400_000
/** "Tomorrow morning" on the fridge, in the person's zone. */
export const MORNING_HOUR = 9

const OPEN: State[] = ['pending', 'put off', 'due', 'shown']
export const isOpen = (r: Reminder) => OPEN.includes(r.state)

/**
 * The one place a reminder changes state. Returns the changed reminder, the same object when the
 * event changes nothing (a repeated ack), or throws a ReminderError saying why not.
 */
export function transition(r: Reminder, event: Event, now: number): Reminder {
  const changed = new Date(now).toISOString()
  const to = (state: State, more: Partial<Reminder> = {}): Reminder => ({ ...r, ...more, state, changed })
  const final = r.state === 'done' || r.state === 'cancelled'
  switch (event.kind) {
    case 'arrive': {
      const late = now - Date.parse(r.at)
      if ((r.state === 'pending' || r.state === 'put off') && late >= 0) return late <= GRACE_MS ? to('due') : to('due', { late: true })
      if (r.state === 'due' && !r.late && late > GRACE_MS) return to('due', { late: true })
      return r
    }
    case 'shown':
      if (r.state === 'due') return to('shown')
      if (r.state === 'shown' || final) return r
      throw new ReminderError('That reminder is not due yet.')
    case 'done':
      if (r.state === 'done') return r
      if (r.state === 'cancelled') throw new ReminderError('That reminder was cancelled.')
      return to('done')
    case 'later': {
      if (r.state !== 'due' && r.state !== 'shown') throw new ReminderError(final ? `That reminder is already ${r.state}.` : 'That reminder is not due yet.')
      const { late: _, ...rest } = r
      return { ...rest, state: 'put off', at: new Date(event.at).toISOString(), changed }
    }
    case 'cancel':
      if (final) throw new ReminderError(`That reminder is already ${r.state}.`)
      return to('cancelled')
  }
}

// ── time in a zone ──────────────────────────────────────────────────────────

/** A zone the host's Intl knows, or a ReminderError. */
export function checkZone(zone: unknown): string {
  if (typeof zone !== 'string' || !zone || zone.length > 64 || !/^[A-Za-z0-9_+\-/]+$/.test(zone)) throw new ReminderError('That is not a time zone.', 400)
  try {
    // Kept as the page said it: resolvedOptions() turns Europe/Kyiv back into ICU's older Europe/Kiev.
    new Intl.DateTimeFormat('en-GB', { timeZone: zone })
    return zone
  } catch {
    throw new ReminderError('That is not a time zone.', 400)
  }
}

const formats = new Map<string, Intl.DateTimeFormat>()
const fieldsFormat = (zone: string) => {
  let f = formats.get(zone)
  if (!f) formats.set(zone, (f = new Intl.DateTimeFormat('en-GB', { timeZone: zone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', weekday: 'long' })))
  return f
}
interface Wall { year: number; month: number; day: number; hour: number; minute: number; weekday: string }
/** The wall clock in `zone` at instant `t`. */
export function wall(t: number, zone: string): Wall {
  const p = Object.fromEntries(fieldsFormat(zone).formatToParts(new Date(t)).map((x) => [x.type, x.value]))
  return { year: +p.year, month: +p.month, day: +p.day, hour: +p.hour, minute: +p.minute, weekday: p.weekday }
}
/** Milliseconds `zone` is ahead of UTC at instant `t`. */
const offsetAt = (t: number, zone: string) => {
  const w = wall(t, zone)
  return Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute) - Math.floor(t / 60_000) * 60_000
}

/**
 * The instants at which the wall clock in `zone` reads this local time: none in a spring-forward gap,
 * two in a fall-back overlap (earlier first), else one.
 */
export function instantsOf(local: { year: number; month: number; day: number; hour: number; minute: number }, zone: string): number[] {
  const naive = Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute)
  const found = new Set<number>()
  // The zone's offsets a day either side cover any transition near this time.
  for (const probe of [naive - 86_400_000, naive, naive + 86_400_000]) {
    const t = naive - offsetAt(probe, zone)
    const w = wall(t, zone)
    if (w.year === local.year && w.month === local.month && w.day === local.day && w.hour === local.hour && w.minute === local.minute) found.add(t)
  }
  return [...found].sort((a, b) => a - b)
}

const timeWords = (t: number, zone: string) =>
  new Intl.DateTimeFormat('en-GB', { timeZone: zone, hour: 'numeric', minute: '2-digit', hour12: true }).format(new Date(t)).replace(/\s/g, ' ')
const dayKey = (w: Pick<Wall, 'year' | 'month' | 'day'>) => Date.UTC(w.year, w.month - 1, w.day) / 86_400_000

/** "today at 9:30 pm", "tomorrow (Tuesday 10 November) at 9:00 am", "Friday 13 November at 6:00 pm". */
export function when(t: number, zone: string, now: number): string {
  const w = wall(t, zone)
  const days = dayKey(w) - dayKey(wall(now, zone))
  const date = new Intl.DateTimeFormat('en-GB', { timeZone: zone, weekday: 'long', day: 'numeric', month: 'long', ...(w.year !== wall(now, zone).year ? { year: 'numeric' } : {}) }).format(new Date(t)).replace(',', '')
  const day = days === 0 ? 'today' : days === 1 ? `tomorrow (${date})` : days === -1 ? `yesterday (${date})` : date
  return `${day} at ${timeWords(t, zone)}`
}

/** Whether `t` falls on today's date in `zone`. */
export const isToday = (t: number, zone: string, now: number) => dayKey(wall(t, zone)) === dayKey(wall(now, zone))

/** The line the villager's turn gets so it can read "tomorrow at nine": the person's date, time and zone now. */
export function nowLine(now: number, zone: string): string {
  const date = new Intl.DateTimeFormat('en-GB', { timeZone: zone, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(now)).replace(',', '')
  const w = wall(now, zone)
  return `Now it is ${date}, ${String(w.hour).padStart(2, '0')}:${String(w.minute).padStart(2, '0')} in ${zone}.`
}

/** "Tomorrow morning" for the fridge's put-off: MORNING_HOUR on the next local day. */
export function tomorrowMorning(now: number, zone: string): number {
  const w = wall(now, zone)
  const next = new Date(Date.UTC(w.year, w.month - 1, w.day + 1))
  const local = { year: next.getUTCFullYear(), month: next.getUTCMonth() + 1, day: next.getUTCDate(), hour: MORNING_HOUR, minute: 0 }
  // No zone moves its clocks at 9 am, but if one ever did, an hour later still reads as morning.
  return instantsOf(local, zone)[0] ?? instantsOf({ ...local, hour: MORNING_HOUR + 1 }, zone)[0]
}

/**
 * The instant a villager's request names: `at` as local "YYYY-MM-DDTHH:MM" in `zone`, or `in_minutes` from now.
 * Refuses, in plain words, anything else: both or neither, a malformed or impossible date, a time the clocks skip,
 * the past, more than a year ahead. `note` says which of two times was taken when the clocks go back.
 */
export function understand(ask: { at?: unknown; in_minutes?: unknown }, zone: string, now: number): { t: number; note?: string } {
  const hasAt = ask.at !== undefined && ask.at !== null && ask.at !== ''
  const hasIn = ask.in_minutes !== undefined && ask.in_minutes !== null
  if (hasAt === hasIn) throw new ReminderError('Give either a time ("at") or a number of minutes from now ("in_minutes"), not both and not neither.', 400)
  let t: number
  let note: string | undefined
  if (hasIn) {
    const m = ask.in_minutes
    if (typeof m !== 'number' || !Number.isInteger(m) || m < 1) throw new ReminderError('Minutes from now must be a whole number, at least 1.', 400)
    t = now + m * 60_000
  } else {
    const match = typeof ask.at === 'string' ? /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(ask.at) : null
    if (!match) throw new ReminderError('A time is written like 2026-11-10T09:00, in their own time zone.', 400)
    const [year, month, day, hour, minute] = match.slice(1).map(Number)
    const real = new Date(Date.UTC(year, month - 1, day))
    if (month < 1 || month > 12 || real.getUTCDate() !== day || real.getUTCMonth() !== month - 1 || hour > 23 || minute > 59) throw new ReminderError(`There is no such date or time as ${ask.at}.`, 400)
    const found = instantsOf({ year, month, day, hour, minute }, zone)
    if (!found.length) throw new ReminderError(`The clocks go forward that night, so ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')} never happens on that day in ${zone}. Ask for another time.`, 400)
    t = found[0]
    if (found.length > 1) note = 'The clocks go back that night, so that time happens twice; this is the first one.'
  }
  if (t <= now) throw new ReminderError(`That time has already passed: ${nowLine(now, zone)}`, 400)
  if (t - now > MAX_AHEAD_MS) throw new ReminderError('That is more than a year away; a reminder can be at most a year ahead.', 400)
  return { t, ...(note ? { note } : {}) }
}

/** What to be reminded of: one line without control characters, 1 to MAX_WHAT characters. */
export function cleanWhat(what: unknown): string {
  const s = typeof what === 'string' ? what.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]+/g, ' ').replace(/\s+/g, ' ').trim() : ''
  if (!s) throw new ReminderError('Say what the reminder is for.', 400)
  if (s.length > MAX_WHAT) throw new ReminderError(`Keep what the reminder says to ${MAX_WHAT} characters.`, 400)
  return s
}

// ── the store ───────────────────────────────────────────────────────────────


function checkFile(raw: unknown): File {
  const f = raw as File
  if (!f || f.version !== 1 || !Array.isArray(f.reminders)) throw new Error('reminders.json is not a version 1 reminders file')
  for (const r of f.reminders) {
    if (!r || !ID.test(r.id) || typeof r.what !== 'string' || !Number.isFinite(Date.parse(r.at)) || !(OPEN.includes(r.state) || r.state === 'done' || r.state === 'cancelled')) throw new Error('reminders.json holds an entry that is not a reminder')
  }
  return f
}

export interface Store {
  /** Settles what time has made due, then returns every reminder (open and recently finished). */
  all(now: number): Promise<Reminder[]>
  /** Settles, then applies `change` to the list and writes it. `change` may throw a ReminderError; nothing is written then. */
  update<T>(now: number, change: (list: Reminder[]) => { list: Reminder[]; result: T }): Promise<T>
}

/**
 * A person's reminders file. A file that cannot be read or is malformed is never treated as empty
 * (that would drop reminders): every call fails until it is fixed. A failed write rejects, and the
 * caller says so; nothing is reported as kept unless the rename succeeded.
 */
export function reminderStore(personDir: string): Store {
  const file = join(personDir, 'reminders.json')
  const read = async (): Promise<File> => {
    try {
      const stat = await lstat(file)
      if (!stat.isFile()) throw new Error('reminders.json is not a plain file')
      if (stat.size > MAX_FILE) throw new Error('reminders.json is too large')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { version: 1, reminders: [] }
      throw error
    }
    return checkFile(JSON.parse(await readFile(file, 'utf8')))
  }
  const write = async (list: Reminder[], now: number) => {
    // Finished ones go after two weeks, and beyond the newest MAX_FINAL.
    const final = list.filter((r) => !isOpen(r) && now - Date.parse(r.changed) < KEEP_FINAL_MS).sort((a, b) => b.changed.localeCompare(a.changed)).slice(0, MAX_FINAL)
    const kept = list.filter((r) => isOpen(r) || final.includes(r))
    const text = JSON.stringify({ version: 1, reminders: kept } satisfies File)
    if (Buffer.byteLength(text) > MAX_FILE) throw new ReminderError('There is no room for more reminders; finish or cancel some first.')
    await mkdir(personDir, { recursive: true, mode: 0o700 })
    const temp = join(personDir, `.reminders.json.${process.pid}.${randomBytes(4).toString('hex')}.tmp`)
    await writeFile(temp, text, { mode: 0o600 })
    await rename(temp, file)
  }
  /** Applies 'arrive' to every reminder; true when any changed. */
  const settle = (list: Reminder[], now: number) => {
    let moved = false
    const next = list.map((r) => {
      const s = transition(r, { kind: 'arrive' }, now)
      if (s !== r) moved = true
      return s
    })
    return { next, moved }
  }
  return {
    // One read-modify-write at a time per file, across processes too (a dev host and the live host on one root): file-lock.ts.
    all: (now) => withFileLock(file, async () => {
      const { next, moved } = settle((await read()).reminders, now)
      if (moved) await write(next, now)
      return next
    }),
    update: (now, change) => withFileLock(file, async () => {
      const { next } = settle((await read()).reminders, now)
      const { list, result } = change(next)
      await write(list, now)
      return result
    }),
  }
}

/** A new reminder, checked: what and when, against the open count. */
export function newReminder(list: Reminder[], what: unknown, t: number, now: number): Reminder {
  if (list.filter(isOpen).length >= MAX_OPEN) throw new ReminderError(`There are already ${MAX_OPEN} reminders waiting; finish or cancel some first.`)
  const stamp = new Date(now).toISOString()
  let id: string
  do id = randomBytes(4).toString('hex')
  while (list.some((r) => r.id === id))
  return { id, what: cleanWhat(what), at: new Date(t).toISOString(), state: 'pending', changed: stamp }
}

/** Applies `event` to reminder `id` in the store. 404 when there is none. */
export function act(store: Store, id: string, event: Event, now: number): Promise<Reminder> {
  if (!ID.test(id)) return Promise.reject(new ReminderError('There is no such reminder.', 404))
  return store.update(now, (list) => {
    const i = list.findIndex((r) => r.id === id)
    if (i < 0) throw new ReminderError('There is no such reminder.', 404)
    const next = transition(list[i], event, now)
    return { list: list.map((r, j) => (j === i ? next : r)), result: next }
  })
}

// ── the villager's tools ────────────────────────────────────────────────────

export interface ToolText { text: string; isError?: true }

/** What the villager's reminder tools do. The stub agent calls these same functions. */
export interface ReminderDesk {
  set(ask: { what?: unknown; at?: unknown; in_minutes?: unknown }): Promise<ToolText>
  list(): Promise<ToolText>
  cancel(ask: { id?: unknown }): Promise<ToolText>
}

const STATE_WORDS: Record<State, string> = {
  pending: 'waiting', 'put off': 'put off, waiting', due: 'due now', shown: 'on the fridge', done: 'done', cancelled: 'cancelled',
}

/** A failure that is not a refusal (a write that failed, say) is said as such: nothing was kept. */
const failed = (error: unknown, what: string): ToolText =>
  error instanceof ReminderError ? { text: error.message, isError: true } : { text: `Something went wrong and ${what}. Tell them it did not work.`, isError: true }

/** The tools for one person's own villager. `zone` is read on every call: the page sends it with each line. */
export function reminderDesk(store: Store, zone: () => string, clock: () => number): ReminderDesk {
  return {
    async set(ask) {
      const now = clock()
      try {
        const z = zone()
        const { t, note } = understand(ask, z, now)
        const r = await store.update(now, (list) => {
          const made = newReminder(list, ask.what, t, now)
          return { list: [...list, made], result: made }
        })
        return { text: `Set: "${r.what}", ${when(t, z, now)} (${z} time). ${note ? `${note} ` : ''}Say this time back to them in these words.` }
      } catch (error) {
        return failed(error, 'the reminder was not kept')
      }
    },
    async list() {
      const now = clock()
      try {
        const z = zone()
        const open = (await store.all(now)).filter(isOpen).sort((a, b) => a.at.localeCompare(b.at))
        if (!open.length) return { text: 'No reminders are waiting.' }
        return { text: open.map((r) => `${r.id}: "${r.what}", ${when(Date.parse(r.at), z, now)} (${STATE_WORDS[r.state]})`).join('\n') }
      } catch (error) {
        return failed(error, 'the reminders could not be read')
      }
    },
    async cancel(ask) {
      const now = clock()
      try {
        const id = typeof ask.id === 'string' ? ask.id.trim() : ''
        const r = await act(store, id, { kind: 'cancel' }, now)
        return { text: `Cancelled: "${r.what}" (it was for ${when(Date.parse(r.at), zone(), now)}).` }
      } catch (error) {
        return failed(error, 'nothing was cancelled')
      }
    },
  }
}

export const REMINDERS_SERVER = 'reminders'
export const REMINDER_TOOLS = ['set_reminder', 'list_reminders', 'cancel_reminder'].map((t) => `mcp__${REMINDERS_SERVER}__${t}`)

const asResult = (r: ToolText) => ({ content: [{ type: 'text' as const, text: r.text }], ...(r.isError ? { isError: true } : {}) })

/** A fresh MCP server over the desk, for one villager process. */
export function reminderServer(desk: ReminderDesk) {
  return createSdkMcpServer({
    name: REMINDERS_SERVER,
    version: '1.0.0',
    tools: [
      tool('set_reminder', 'Keep a one-off reminder for this person. Give "at" as their local date and time (YYYY-MM-DDTHH:MM, in their time zone, from the "Now it is" line), or "in_minutes" from now, never both. The result says the time understood; say that back.', {
        what: z.string().describe('What to remind them of, short, in their words: "call the dentist"'),
        at: z.string().optional().describe('Local date and time, e.g. "2026-11-10T09:00"'),
        in_minutes: z.number().int().optional().describe('Whole minutes from now, e.g. 20'),
      }, (ask) => desk.set(ask).then(asResult)),
      tool('list_reminders', "List this person's waiting reminders, soonest first, with their ids.", {}, () => desk.list().then(asResult)),
      tool('cancel_reminder', 'Cancel one reminder by its id (from list_reminders).', { id: z.string().describe('e.g. "a1b2c3d4"') }, (ask) => desk.cancel(ask).then(asResult)),
    ],
  })
}
