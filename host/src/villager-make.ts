// #47 villager setup: the host's side of making a villager from a description.
// A tool-less model call writes the code-arm module (the same prompt files the
// round-1 runner used, read from home/scripts/villagers/) and, beside it, a persona
// in #42's persona.json shape. The host stores and returns the module as text and
// never imports or runs it; the home runs it in its prop sandbox.
//
//   POST /people/:id/villagers               {description, accent, template?} -> {item, module, persona, personaRefused?, dials, ms, models, costUsd, outputTokens}
//   GET  /people/:id/villagers/:item         -> {id, description, accent, module, persona, personaRefused?, dials, tuning}
//   POST /people/:id/villagers/:item/remake  {reason}  -> as the first POST, once per villager
//   POST /people/:id/villagers/:item/tuning  {size, hue, pitch, pace, energy, warmth, playful, chatty, humour} each 0..1 -> {ok, persona}
//   POST /people/:id/villagers/:item/send-off {tuning, voice} -> {ok, name}  writes people/<id>/persona.json (the old one kept as persona.prev.json) and voice.json
//   GET  /people/:id/villager                 -> {persona, voice}  the villager the person has now (persona.json, checked), and its babble voice
//   GET  /people/:id/persona-templates        -> {builtin, templates, profile, humour}  the built-in patterns this person may pick, their own saved ones, their profile and the humour dial
//   POST /people/:id/persona-templates        {name, persona, dials?, audience?, shared?} -> {template}
//   GET  /family/persona-templates?for=<id>   -> {templates}  every listed person's shared ones
//
// One owner per rule (#42): host/src/persona.ts owns the persona's shape and its check
// (checkPersona), the profile, and the humour rule (humourCeiling). Every persona this file
// stores, serves or writes, whether a model, a template, a request body or a stored file
// supplied it, passes checkPersona first. A persona's humour.lean is clean or cheeky; crude is
// only ever the operator's profile setting for an adult, so nothing here can raise it.
//
// The model writes the persona as a ```json block after the module. One that fails the check is
// refused with its reason: the record is stored with persona null and personaRefused, and the
// page asks for the one repair with that reason, as it does for a module its checks refuse.
//
// Templates: TEMPLATES in persona.ts, offered by TEMPLATE_CARDS' audience for the person's age band,
// and the person's own and the family's saved ones (whole personas under people/<id>/persona-templates/).
// The words say who the villager is, the pattern how it talks: the model is given the pattern, and
// the host then sets the pattern's manner over what the model wrote (applyPattern).
//
// The setup's three persona ribbons and the jokes dial are tuning data (0..1) for the sliders'
// positions. tunePersona() maps them into the schema from the model's own persona each time:
// warmth and playful add words to temperament and register, chatty sets lengths, and the jokes
// dial sets humour.lean (below 0.25 clean, else cheeky; the dial's crude end is stored as cheeky).
//
// Stored under <root>/people/<id>/villagers/<item>.json, each write to a temporary file in the
// same directory and then renamed over the record, so a crash never leaves half a record.
// Model failures answer 422; storage failures answer 500.
import { randomBytes } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { join } from 'node:path'
import { checkPersona, defaultPersona, humourCeiling, readPreferences, TEMPLATE_CARDS, TEMPLATES, type Humour, type Persona, type Profile } from './persona.ts'
import { extractModule, oneShot, type Call } from './villager-input.ts'

/** A pattern as the model and applyPattern see it: a whole persona's manner, under its card label. */
export interface Pattern { label: string; persona: Omit<Persona, 'name' | 'template'>; builtin?: string }
export interface VillagerAsk { description: string; owner: string; accent: string; signal: AbortSignal; pattern?: Pattern; repair?: { module: string; persona?: string; reason: string } }
/** `text` is the model's whole answer, read here for the persona block; a maker without one has no persona. */
export type VillagerMaker = (ask: VillagerAsk) => Promise<{ module: string; text?: string } & Call>
export type { Persona }

/** The setup's dials as data for the sliders' positions, never part of a persona. */
export interface Dials { warmth: number; playful: number; chatty: number; humour: number }
type Audience = 'any' | 'adult' | 'child'

interface Stored {
  id: string; description: string; accent: string; template?: string; module: string
  persona: Persona | null; personaRefused?: string; personaBlock?: string
  models: string[]; costUsd: number | null; outputTokens: number | null; ms: number; at: string
  tuning?: Record<string, number>
  repair?: { reason: string; previous: string; ms: number; models: string[]; costUsd: number | null; outputTokens: number | null; at: string }
}

const PERSON = /^[a-z][a-z0-9-]{0,31}$/
const ITEM = /^[a-f0-9]{12}$/
const ACCENT = /^#[0-9a-f]{6}$/i
const MAX_DESCRIPTION = 300
const MAX_BODY = 6000
const MAX_MODULE = 120_000
const KNOBS = ['size', 'hue', 'pitch', 'pace', 'energy', 'warmth', 'playful', 'chatty', 'humour'] as const
const VOICE = ['pitch', 'range', 'formant', 'rate', 'breath', 'wobble', 'wobbleRate', 'tilt', 'gain'] as const
const TEMPLATE = /^[a-f0-9]{12}$/
const MAX_TEMPLATES = 50
const MAX_LABEL = 40
/** A refusal reason from the home's checks or the persona check, as it enters the repair prompt. */
const MAX_REASON = 600
/** The jokes dial: clean 0, cheeky 0.5 (crude 1 is shown only as the operator's setting, never stored). */
const CHEEKY_FROM = 0.25

const capped = (v: unknown, max: number) => (typeof v === 'string' && v.trim() ? v.trim().replace(/\s+/g, ' ').slice(0, max) : '')
const reasonOf = (error: unknown) => String(error instanceof Error ? error.message : error).slice(0, 200)

/** The persona block the model wrote after the module (the last ```json block of at most 4 kB), checked. */
export function personaFrom(text: string | undefined): { persona: Persona; block: string } | { refused: string; block?: string } {
  const block = [...(text ?? '').matchAll(/```json\n([\s\S]*?)```/g)].map((m) => m[1]).filter((b) => b.length <= 4000).at(-1)
  if (!block) return { refused: 'persona: no ```json persona block after the module' }
  let raw: unknown
  try {
    raw = JSON.parse(block)
  } catch {
    return { refused: 'persona: the ```json block is not valid JSON', block }
  }
  if (raw && typeof raw === 'object' && !Array.isArray(raw) && Object.hasOwn(raw, 'persona') && Object.keys(raw).length === 1) raw = (raw as { persona: unknown }).persona
  try {
    return { persona: checkPersona(raw), block }
  } catch (error) {
    return { refused: `persona: ${reasonOf(error)}`, block }
  }
}

/**
 * The words say who it is, the pattern how it talks: the pattern's temperament, register, humour,
 * decides, mistakes and lengths over the model's; the model keeps its name, role, speciality, cares
 * and frictions; quirks are the model's first, then the pattern's, four at most; tastes the model's,
 * else the pattern's. A built-in pattern's id is kept as the persona's template. Checked again.
 */
export function applyPattern(persona: Persona, pattern: Pattern): Persona {
  const t = pattern.persona
  const quirks = [...persona.quirks, ...t.quirks.filter((q) => !persona.quirks.includes(q))].slice(0, 4)
  return checkPersona({
    ...persona,
    ...(pattern.builtin ? { template: pattern.builtin } : {}),
    temperament: t.temperament, register: t.register, humour: t.humour,
    ...(t.decides ? { decides: t.decides } : {}),
    ...(t.mistakes ? { mistakes: t.mistakes } : {}),
    lengths: t.lengths,
    quirks,
    ...(persona.tastes?.length ? {} : t.tastes ? { tastes: t.tastes } : {}),
  })
}

/** Where the sliders start for a persona: warmth and playful in the middle (as it was made), chatty from its card length, jokes from its lean. */
export const dialsOf = (p: Persona): Dials => ({ warmth: 0.5, playful: 0.5, chatty: (p.lengths.card - 1) / 2, humour: p.humour.lean === 'cheeky' ? 0.5 : 0 })

/** Words the ribbons add: [temperament word, register clause], for a ribbon pulled well toward one end. */
const LEANS = {
  warmth: { low: ['blunt', 'blunter than usual, no softeners'], high: ['warm', 'warmer than usual, with real encouragement'] },
  playful: { low: ['serious', 'keeps jokes rare and the tone straight'], high: ['playful', 'quick to joke and to play along'] },
} as const

/** Shortens text to fit, dropping its last comma or semicolon parts first, then its last words. */
function shorten(text: string, max: number): string {
  while (text.length > max) text = /[,;]/.test(text) ? text.replace(/\s*[,;][^,;]*$/, '') : text.slice(0, max).replace(/\s+\S*$/, '')
  return text
}

/**
 * The tuned persona: always from the model's (or pattern's) own persona, so tuning twice never
 * stacks words. A ribbon at 0.3 or below, or 0.7 or above, adds its word to the temperament and
 * its clause to the register; chatty sets lengths.card (1 to 3), and scales lengths.long around
 * the persona's own; the jokes dial sets humour.lean. Checked by checkPersona.
 */
export function tunePersona(base: Persona, dials: Dials): Persona {
  const temper: string[] = [], register: string[] = []
  let own = base.temperament
  for (const k of ['warmth', 'playful'] as const) {
    const low = dials[k] <= 0.3
    const lean = low ? LEANS[k].low : dials[k] >= 0.7 ? LEANS[k].high : null
    if (!lean) continue
    // Pulled the other way from the persona's own word: that word goes ("warm" when pulled to blunt).
    const opposite = (low ? LEANS[k].high : LEANS[k].low)[0]
    own = own.split(/\s*,\s*/).filter((w) => w.toLowerCase() !== opposite).join(', ')
    if (!new RegExp(`\\b${lean[0]}\\b`, 'i').test(own)) temper.push(lean[0])
    register.push(lean[1])
  }
  const c0 = (base.lengths.card - 1) / 2
  const long = Math.round(Math.min(20, Math.max(3, (base.lengths.long * (0.5 + dials.chatty)) / (0.5 + c0))))
  // The added words lead the temperament and close the register; the persona's own text gives way to fit.
  const added = temper.join(', ')
  const clauses = register.join('; ')
  return checkPersona({
    ...base,
    temperament: added ? `${added}, ${shorten(own, 60 - added.length - 2)}`.replace(/, $/, '') : own || base.temperament,
    register: clauses ? `${shorten(base.register, 160 - clauses.length - 2)}; ${clauses}`.replace(/^; /, '') : base.register,
    humour: { ...base.humour, lean: dials.humour >= CHEEKY_FROM ? 'cheeky' : 'clean' },
    lengths: { card: 1 + Math.round(dials.chatty * 2), table: dials.chatty >= 0.85 ? 2 : dials.chatty <= 0.15 ? 1 : base.lengths.table, long },
  })
}

/**
 * The jokes dial as humourCeiling (persona.ts, the rule's only owner) decides it for this person:
 * when the persona's lean no longer changes the ceiling, the dial is locked at that level, by the
 * operator's profile setting ('admin') or by the person's own "keep it clean" ('asked').
 */
export function humourDial(person: string, profile: Profile, prefs: Awaited<ReturnType<typeof readPreferences>>): { locked: Humour | null; by?: 'admin' | 'asked' } {
  const at = (lean: 'clean' | 'cheeky') => humourCeiling(profile, prefs, { ...defaultPersona(person), humour: { style: 'plain', lean } })
  const clean = at('clean'), cheeky = at('cheeky')
  return clean === cheeky ? { locked: clean, by: profile.humour ? 'admin' : 'asked' } : { locked: null }
}

/** May a person of this profile pick a pattern for this audience: adult ones for an adult, child ones for a child. */
const offered = (audience: Audience, profile: Profile) => audience === 'any' || (audience === 'adult' ? profile.age === 'adult' : profile.age === 'child')

/** Writes beside the target, then renames over it: a crash or a failed write leaves the old file whole. */
async function replaceFile(path: string, text: string) {
  const temp = `${path}.${randomBytes(4).toString('hex')}.tmp`
  try {
    await writeFile(temp, text, { mode: 0o600 })
    await rename(temp, path)
  } catch (error) {
    await rm(temp, { force: true })
    throw error
  }
}

const prompts = join(import.meta.dirname, '../../home/scripts/villagers')

/** The round-1 code arm's system prompt, read from its files so there is one copy: the style guide, then the module contract. */
export function villagerPrompt(): string {
  return `${readFileSync(join(prompts, 'style.md'), 'utf8')}\n${readFileSync(join(prompts, 'arm-code.md'), 'utf8')}`
}

/** The request as the round-1 runner wrote it, and the picked pattern's manner after it when there is one. */
export const villagerAsk = (description: string, owner: string, accent: string, pattern?: Pattern) => `Make a villager: ${description}.\n\nIts owner is ${owner}; the owner's accent colour is ${accent}.${pattern ? `\n\nPersonality pattern "${pattern.label}": write the persona's temperament, register, humour, decides, mistakes and lengths in this manner, and the rest from the description:\n\`\`\`json\n${JSON.stringify(pattern.persona)}\n\`\`\`` : ''}`
/** The repair request as the round-1 runner wrote it: the ask, the previous module (and persona block) and why it was refused. */
export const repairAsk = (ask: string, module: string, reason: string, persona?: string) => `${ask}\n\nYour previous file:\n\`\`\`js\n${module}\n\`\`\`\n${persona ? `\nYour previous persona block:\n\`\`\`json\n${persona}\`\`\`\n` : ''}\nIt failed with this error:\n${reason}\n\nReturn the corrected complete file${persona !== undefined ? ' and the persona block' : ''}.`

export function claudeVillagerMaker(model = 'sonnet'): VillagerMaker {
  const system = villagerPrompt()
  return async (ask) => {
    const first = villagerAsk(ask.description, ask.owner, ask.accent, ask.pattern)
    const { text, ...call } = await oneShot(model, system, ask.repair ? repairAsk(first, ask.repair.module, ask.repair.reason, ask.repair.persona ?? '') : first, ask.signal)
    return { module: extractModule(text), text, ...call }
  }
}

/** The stub's persona: a plain, valid one in the schema, named for the check of who answers next. */
export const STUB_PERSONA: Persona = {
  name: 'Biscuit', role: 'baker', speciality: 'bread, early mornings and getting the week’s baking done before anyone is up',
  temperament: 'calm, dry, patient', register: 'plain and unhurried, short sentences', humour: { style: 'dry asides about dough', lean: 'cheeky' },
  quirks: ['times everything by the oven'], cares: ['warm bread', 'quiet mornings'], decides: 'starts from what can be done before breakfast',
  lengths: { card: 2, table: 1, long: 10 },
}

/**
 * Stand-in for checks: the Dumpling example from arm-code.md in the asked accent, given a pup's
 * snout and tall ears so it passes the home's species check (gen/checks.ts: the example alone is
 * the round template the check refuses). "[stub-fail]" fails. "[stub-mark-head]" first returns it with
 * the whole head tagged as the role mark (the home's mark check refuses it), and the plain one on repair.
 * Its answer carries STUB_PERSONA as the persona block.
 */
export function stubVillagerMaker(delayMs = 200): VillagerMaker {
  const found = /^export default function \(villager, api\) \{\n[\s\S]*?\n\}$/m.exec(readFileSync(join(prompts, 'arm-code.md'), 'utf8').split(/^Example\b/m)[1] ?? '')?.[0]
  if (!found || !found.includes('\n  villager.add(head)\n')) throw new Error('arm-code.md has no example module with a head group')
  const example = found.replace('\n  villager.add(head)\n', `\n  villager.add(head)
  add(head, new THREE.CapsuleGeometry(0.045, 0.06, 6, 10), felt('#f6e6cc'), 0, -0.06, 0.17).rotation.x = Math.PI / 2
  for (const s of [-1, 1]) add(head, new THREE.CapsuleGeometry(0.03, 0.12, 6, 10), felt('#e2b98a'), s * 0.1, 0.2, -0.02).rotation.z = -s * 0.2
`)
  const markedHead = example.replace("villager.tag(new THREE.Group(), 'head')", "villager.mark(villager.tag(new THREE.Group(), 'head'))")
  if (markedHead === example) throw new Error('arm-code.md example no longer tags its head as villager.tag(new THREE.Group(), \'head\')')
  return async (ask) => {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(resolve, delayMs)
      ask.signal.addEventListener('abort', () => (clearTimeout(timer), reject(new Error('aborted'))), { once: true })
    })
    if (ask.description.includes('[stub-fail]')) throw new Error('stub villager failure requested')
    const module = ask.description.includes('[stub-mark-head]') && !ask.repair ? markedHead : example
    // "[stub-bad-persona]" first writes a persona the check refuses (a crude lean), and a good one on repair.
    const persona = ask.description.includes('[stub-bad-persona]') && !ask.repair ? { ...STUB_PERSONA, humour: { style: 'filthy', lean: 'crude' } } : STUB_PERSONA
    const text = `\`\`\`js\n${module}\n\`\`\`\n\`\`\`json\n${JSON.stringify(persona)}\n\`\`\``
    return { module: module.replaceAll('#c8553d', ask.accent), text, models: ['stub'], costUsd: 0, outputTokens: 0, apiMs: 0 }
  }
}


/** A saved pattern: a whole persona (checked), its card label, and who may see it. */
interface Saved { id: string; name: string; persona: Persona; audience: Audience; shared: boolean; maker: string; at: string }

/**
 * The /people/:id/villagers routes. Returns a handler that answers and returns
 * true for those paths (after the caller has checked the token), false otherwise.
 * `profileOf` is the host's own profile of a person (villager.ts), the only input to who may see what.
 */
export function villagerRoutes(config: { root: string; people: Record<string, string>; profileOf: (id: string) => Profile; maker?: VillagerMaker; timeoutMs?: number }) {
  const { profileOf } = config
  const making = new Set<string>()
  const personDir = (id: string) => join(config.root, 'people', id)
  const dir = (id: string) => join(personDir(id), 'villagers')
  const send = (res: ServerResponse, status: number, value: unknown) => {
    res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' })
    res.end(JSON.stringify(value))
  }
  const body = async (req: IncomingMessage): Promise<Record<string, unknown>> => {
    let raw = ''
    for await (const chunk of req) {
      raw += chunk
      if (raw.length > MAX_BODY) throw new Error('too large')
    }
    const v = JSON.parse(raw)
    if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('not an object')
    return v
  }
  const read = async (id: string, item: string) => {
    try {
      return JSON.parse(await readFile(join(dir(id), `${item}.json`), 'utf8')) as Stored
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw error
    }
  }
  const write = async (id: string, record: Stored) => {
    await mkdir(dir(id), { recursive: true, mode: 0o700 })
    await replaceFile(join(dir(id), `${record.id}.json`), JSON.stringify(record))
  }
  /** A stored persona goes back through the check on every read: a file edited by hand is still only data. */
  const stillGood = (p: unknown): Persona | null => {
    try {
      return p ? checkPersona(p) : null
    } catch {
      return null
    }
  }
  /** Nine 0..1 numbers, or the reason they are not. */
  const knobs = (b: unknown): Record<string, number> | string => {
    const values: Record<string, number> = {}
    for (const k of KNOBS) {
      const v = (b as Record<string, unknown> | null)?.[k]
      if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 1) return `${k} is a number from 0 to 1`
      values[k] = v
    }
    // The jokes dial's crude end is the operator's setting, never a tuning: stored as cheeky.
    values.humour = Math.min(values.humour, 0.5)
    return values
  }
  const dialsFrom = (t: Record<string, number>): Dials => ({ warmth: t.warmth, playful: t.playful, chatty: t.chatty, humour: t.humour })
  const tunedOf = (r: Stored) => {
    const persona = stillGood(r.persona)
    return persona && r.tuning ? tunePersona(persona, dialsFrom(r.tuning)) : persona
  }

  const templateDir = (id: string) => join(personDir(id), 'persona-templates')
  const listTemplates = async (id: string): Promise<Saved[]> => {
    const files = (await readdir(templateDir(id)).catch((): string[] => [])).filter((f) => f.endsWith('.json') && TEMPLATE.test(f.slice(0, -5)))
    const out: Saved[] = []
    for (const f of files) {
      try {
        const t = JSON.parse(await readFile(join(templateDir(id), f), 'utf8')) as Saved
        // Re-read through the same check as on save; a file that fails it is skipped, not served.
        out.push({ id: f.slice(0, -5), name: capped(t.name, MAX_LABEL) || 'A saved pattern', persona: checkPersona(t.persona), audience: (['any', 'adult', 'child'] as const).includes(t.audience) ? t.audience : 'any', shared: t.shared === true, maker: id, at: String(t.at) })
      } catch {
        // An unreadable or refused file is skipped.
      }
    }
    return out.sort((a, b) => a.at.localeCompare(b.at))
  }
  const forReader = (list: Saved[], profile: Profile) => list.filter((t) => offered(t.audience, profile))
  const builtins = (profile: Profile) => Object.entries(TEMPLATE_CARDS).filter(([, c]) => offered(c.audience, profile)).map(([id, c]) => ({ id, name: c.label, audience: c.audience, persona: TEMPLATES[id], dials: dialsOf({ name: 'X', ...TEMPLATES[id] }) }))
  /** A pattern reference from the page: a built-in id, or "<maker>:<id>" for a saved one this person may see. */
  const patternFor = async (id: string, ref: unknown): Promise<Pattern | null | 'refused'> => {
    if (ref === undefined || ref === null || ref === '') return null
    if (typeof ref !== 'string') return 'refused'
    const profile = profileOf(id)
    if (Object.hasOwn(TEMPLATE_CARDS, ref)) return offered(TEMPLATE_CARDS[ref].audience, profile) ? { label: TEMPLATE_CARDS[ref].label, persona: TEMPLATES[ref], builtin: ref } : 'refused'
    const [maker, tid] = ref.split(':')
    if (!PERSON.test(maker ?? '') || !Object.hasOwn(config.people, maker) || !TEMPLATE.test(tid ?? '')) return 'refused'
    const t = (await listTemplates(maker)).find((x) => x.id === tid && (maker === id || x.shared) && offered(x.audience, profile))
    if (!t) return 'refused'
    const { name: _name, template: _template, ...manner } = t.persona
    return { label: t.name, persona: manner }
  }

  /** One model call; answers 422 itself and returns null when the maker fails or writes no module. */
  const makeOnce = async (res: ServerResponse, ask: Omit<VillagerAsk, 'signal'>) => {
    const started = Date.now()
    let made: Awaited<ReturnType<VillagerMaker>>
    try {
      // 240 s: the module and the persona block are about 7,000 output tokens; a live make timed out at 150 s on a loaded machine.
      made = await config.maker!({ ...ask, signal: AbortSignal.timeout(config.timeoutMs ?? 240_000) })
    } catch {
      send(res, 422, { error: 'the maker failed', ms: Date.now() - started })
      return null
    }
    const ms = Date.now() - started
    if (typeof made.module !== 'string' || !made.module.trim() || made.module.length > MAX_MODULE) {
      send(res, 422, { error: 'the maker returned no usable module', ms })
      return null
    }
    // The persona block through #42's check, then the pattern's manner over it; a refusal keeps its reason for the repair.
    const found = personaFrom(made.text)
    let persona: Persona | null = null, personaRefused: string | undefined
    if ('persona' in found) {
      try {
        persona = ask.pattern ? applyPattern(found.persona, ask.pattern) : found.persona
      } catch (error) {
        personaRefused = `persona: ${reasonOf(error)}`
      }
    } else personaRefused = found.refused
    return { ...made, ms, persona, personaRefused, personaBlock: found.block }
  }
  const answer = (r: Stored, made: { ms: number; models: string[]; costUsd: number | null; outputTokens: number | null; apiMs: number | null }) => ({
    item: r.id, module: r.module, persona: r.persona, ...(r.personaRefused ? { personaRefused: r.personaRefused } : {}), dials: r.persona ? dialsOf(r.persona) : null,
    ms: made.ms, models: made.models, costUsd: made.costUsd, outputTokens: made.outputTokens, apiMs: made.apiMs,
  })

  return async (path: string, req: IncomingMessage, res: ServerResponse): Promise<boolean> => {
    if (path === '/family/persona-templates' && req.method === 'GET') {
      const reader = new URL(req.url ?? '/', 'http://x').searchParams.get('for') ?? ''
      const profile = PERSON.test(reader) && Object.hasOwn(config.people, reader) ? profileOf(reader) : { age: 'unknown' as const }
      const all = (await Promise.all(Object.keys(config.people).map(listTemplates))).flat().filter((t) => t.shared)
      return send(res, 200, { templates: forReader(all, profile) }), true
    }
    const now = /^\/people\/([^/]+)\/villager$/.exec(path)
    if (now && req.method === 'GET') {
      const id = now[1]
      if (!PERSON.test(id) || !Object.hasOwn(config.people, id)) return send(res, 404, { error: 'no such person' }), true
      const json = (name: string) => readFile(join(personDir(id), name), 'utf8').then((t) => JSON.parse(t) as unknown, () => null)
      const voice = await json('voice.json')
      return send(res, 200, { persona: stillGood(await json('persona.json')), voice: voiceOf(voice) }), true
    }
    const t = /^\/people\/([^/]+)\/persona-templates$/.exec(path)
    if (t) {
      const id = t[1]
      if (!PERSON.test(id) || !Object.hasOwn(config.people, id)) return send(res, 404, { error: 'no such person' }), true
      const profile = profileOf(id)
      if (req.method === 'GET') {
        const humour = humourDial(id, profile, await readPreferences(personDir(id)))
        return send(res, 200, { builtin: builtins(profile), templates: forReader(await listTemplates(id), profile), profile, humour }), true
      }
      if (req.method !== 'POST') return send(res, 405, { error: 'method not allowed' }), true
      let b: Record<string, unknown>
      try {
        b = await body(req)
      } catch {
        return send(res, 400, { error: 'expected JSON {"name", "persona", "dials"?, "audience"?, "shared"?}' }), true
      }
      const name = capped(b.name, MAX_LABEL)
      if (!name) return send(res, 400, { error: `name is 1 to ${MAX_LABEL} characters` }), true
      let persona: Persona
      try {
        persona = checkPersona(b.persona)
        if (b.dials !== undefined) {
          const d = b.dials as Record<string, unknown> | null
          if (!d || !(['warmth', 'playful', 'chatty', 'humour'] as const).every((k) => typeof d[k] === 'number' && (d[k] as number) >= 0 && (d[k] as number) <= 1)) throw new Error('dials are warmth, playful, chatty and humour, each 0 to 1')
          persona = tunePersona(persona, d as unknown as Dials)
        }
      } catch (error) {
        return send(res, 400, { error: reasonOf(error) }), true
      }
      const audience = b.audience === undefined ? 'any' : b.audience
      if (audience !== 'any' && audience !== 'adult' && audience !== 'child') return send(res, 400, { error: 'audience is any, adult or child' }), true
      if ((await listTemplates(id)).length >= MAX_TEMPLATES) return send(res, 409, { error: `at most ${MAX_TEMPLATES} saved patterns` }), true
      const template: Saved = { id: randomBytes(6).toString('hex'), name, persona, audience, shared: b.shared === true, maker: id, at: new Date().toISOString() }
      await mkdir(templateDir(id), { recursive: true, mode: 0o700 })
      await replaceFile(join(templateDir(id), `${template.id}.json`), JSON.stringify(template))
      return send(res, 200, { template }), true
    }
    const m = /^\/people\/([^/]+)\/villagers(?:\/([^/]+)(?:\/(tuning|remake|send-off))?)?$/.exec(path)
    if (!m) return false
    const [, id, item, action] = m
    if (!PERSON.test(id) || !Object.hasOwn(config.people, id)) return send(res, 404, { error: 'no such person' }), true
    if (item !== undefined && !ITEM.test(item)) return send(res, 404, { error: 'no such villager' }), true

    if (!item && req.method === 'POST') {
      if (!config.maker) return send(res, 503, { error: 'no villager maker' }), true
      let b: Record<string, unknown>
      try {
        b = await body(req)
      } catch {
        return send(res, 400, { error: 'expected JSON {"description", "accent", "template"?}' }), true
      }
      const description = typeof b.description === 'string' ? b.description.trim().replace(/\s+/g, ' ') : ''
      if (!description || description.length > MAX_DESCRIPTION) return send(res, 400, { error: `description is 1 to ${MAX_DESCRIPTION} characters` }), true
      if (typeof b.accent !== 'string' || !ACCENT.test(b.accent)) return send(res, 400, { error: 'accent is a #rrggbb colour' }), true
      const pattern = await patternFor(id, b.template)
      if (pattern === 'refused') return send(res, 400, { error: 'template is not a pattern this person can pick' }), true
      if (making.has(id)) return send(res, 409, { error: 'already making a villager' }), true
      making.add(id)
      try {
        const made = await makeOnce(res, { description, owner: config.people[id], accent: b.accent, ...(pattern ? { pattern } : {}) })
        if (!made) return true
        // Stored and returned as text for the home's sandbox; never imported, evaluated or run here.
        const record: Stored = { id: randomBytes(6).toString('hex'), description, accent: b.accent, ...(pattern ? { template: b.template as string } : {}), module: made.module, persona: made.persona, ...(made.personaRefused ? { personaRefused: made.personaRefused } : {}), ...(made.personaBlock ? { personaBlock: made.personaBlock } : {}), models: made.models, costUsd: made.costUsd, outputTokens: made.outputTokens, ms: made.ms, at: new Date().toISOString() }
        // A storage failure throws past here to the host's 500, never the maker's 422.
        await write(id, record)
        return send(res, 200, answer(record, made)), true
      } finally {
        making.delete(id)
      }
    }
    if (item && action === 'remake' && req.method === 'POST') {
      if (!config.maker) return send(res, 503, { error: 'no villager maker' }), true
      const found = await read(id, item)
      if (!found) return send(res, 404, { error: 'no such villager' }), true
      if (found.repair) return send(res, 409, { error: 'this villager was already re-made once' }), true
      let b: Record<string, unknown>
      try {
        b = await body(req)
      } catch {
        return send(res, 400, { error: 'expected JSON {"reason"}' }), true
      }
      // The reason enters the model's prompt as data about the refusal: one capped line of plain text.
      const reason = capped(b.reason, MAX_REASON)
      if (!reason) return send(res, 400, { error: `reason is 1 to ${MAX_REASON} characters` }), true
      const pattern = await patternFor(id, found.template)
      if (making.has(id)) return send(res, 409, { error: 'already making a villager' }), true
      making.add(id)
      try {
        const made = await makeOnce(res, { description: found.description, owner: config.people[id], accent: found.accent, ...(pattern && pattern !== 'refused' ? { pattern } : {}), repair: { module: found.module, reason, ...(found.personaBlock ? { persona: found.personaBlock } : {}) } })
        if (!made) return true
        // The repair's persona, else the first one if it was good; a refusal again is kept with its reason.
        const persona = made.persona ?? stillGood(found.persona)
        const record: Stored = { ...found, module: made.module, persona, personaRefused: persona ? undefined : made.personaRefused, personaBlock: made.personaBlock ?? found.personaBlock, repair: { reason, previous: found.module, ms: made.ms, models: made.models, costUsd: made.costUsd, outputTokens: made.outputTokens, at: new Date().toISOString() } }
        await write(id, record)
        return send(res, 200, answer(record, made)), true
      } finally {
        making.delete(id)
      }
    }
    if (item && !action && req.method === 'GET') {
      const found = await read(id, item)
      if (!found) return send(res, 404, { error: 'no such villager' }), true
      const persona = stillGood(found.persona)
      return send(res, 200, { id: found.id, description: found.description, accent: found.accent, module: found.module, persona, ...(found.personaRefused ? { personaRefused: found.personaRefused } : {}), dials: persona ? dialsOf(persona) : null, tuning: found.tuning ?? null, tuned: tunedOf(found) }), true
    }
    if (item && (action === 'tuning' || action === 'send-off') && req.method === 'POST') {
      const found = await read(id, item)
      if (!found) return send(res, 404, { error: 'no such villager' }), true
      let b: Record<string, unknown>
      try {
        b = await body(req)
      } catch {
        return send(res, 400, { error: action === 'tuning' ? `expected JSON {${KNOBS.join(', ')}}` : 'expected JSON {"tuning", "voice"}' }), true
      }
      const values = knobs(action === 'tuning' ? b : b.tuning)
      if (typeof values === 'string') return send(res, 400, { error: values }), true
      if (action === 'tuning') {
        found.tuning = values
        await write(id, found)
        return send(res, 200, { ok: true, persona: tunedOf(found) }), true
      }
      // Send-off: the tuned persona becomes the person's villager (#42 reads persona.json on every turn).
      const voice = voiceOf(b.voice)
      if (!voice) return send(res, 400, { error: `voice is {${VOICE.join(', ')}}, finite numbers` }), true
      found.tuning = values
      let persona: Persona | null
      try {
        persona = tunedOf(found)
      } catch (error) {
        return send(res, 422, { error: reasonOf(error) }), true
      }
      if (!persona) return send(res, 409, { error: found.personaRefused ?? 'this villager has no persona' }), true
      await write(id, found)
      await mkdir(personDir(id), { recursive: true, mode: 0o700 })
      const current = join(personDir(id), 'persona.json')
      const previous = await readFile(current, 'utf8').catch(() => null)
      if (previous !== null) await replaceFile(join(personDir(id), 'persona.prev.json'), previous)
      await replaceFile(current, JSON.stringify(persona, null, 2))
      await replaceFile(join(personDir(id), 'voice.json'), JSON.stringify({ ...voice, item: found.id }))
      return send(res, 200, { ok: true, name: persona.name, persona }), true
    }
    return send(res, 405, { error: 'method not allowed' }), true
  }
}

/** A babble voice as the page sent it: its nine numbers, finite. The page clamps them to its ranges (gen/spec.ts RANGES.voice) on use. */
function voiceOf(raw: unknown): Record<string, number> | null {
  if (!raw || typeof raw !== 'object') return null
  const out: Record<string, number> = {}
  for (const k of VOICE) {
    const v = (raw as Record<string, unknown>)[k]
    if (typeof v !== 'number' || !Number.isFinite(v) || Math.abs(v) > 10_000) return null
    out[k] = v
  }
  return out
}
