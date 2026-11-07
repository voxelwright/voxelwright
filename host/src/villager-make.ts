// #47 villager setup: the host's side of making a villager from a description.
// A tool-less model call writes the code-arm module (the same prompt files the
// round-1 runner used, read from home/scripts/villagers/); the host stores and
// returns the module as text and never imports or runs it. The home runs it in
// its prop sandbox. Tuning is kept beside it as five numbers; it never calls a
// model again.
//
//   POST /people/:id/villagers               {description, accent}  -> {item, module, persona, ms, models, costUsd, outputTokens}
//   GET  /people/:id/villagers/:item         -> {id, description, accent, module, persona, tuning}
//   POST /people/:id/villagers/:item/remake  {reason}  -> {item, module, persona, ms, models, costUsd, outputTokens}  once per villager
//   POST /people/:id/villagers/:item/tuning  {size, hue, pitch, pace, energy, warmth, playful, chatty, humour} each 0..1
//   GET  /people/:id/persona-templates        -> {templates, profile}  the person's own saved patterns
//   POST /people/:id/persona-templates        {name, persona, audience?, shared?} -> {template}
//   GET  /family/persona-templates?for=<id>   -> {templates}  every listed person's shared ones
//
// Templates are data files under people/<id>/persona-templates/. Every persona and every
// tuning, stored or served, passes gatePersona() for the host's own profile of the person:
// neither a model, a request body nor a stored or shared file can unlock crude humour for a
// child or an unknown profile. The page learns the profile from GET persona-templates.
//
// Remake: when the home's checks refuse a made module, the page may ask once for a repair with
// the refusal's reason. The model gets its previous module and the reason, as the round-1
// runner's repair pass did; the host stores and returns the new text and still never runs it.
//
// The persona (#42's adult personality, provisional until its schema lands in
// host/README.md) is read from a ```json block in the answer if the model wrote
// one, kept to known fields with every length capped, and is null otherwise; the
// page also finds it in the module's own villager.about().
//
// Stored under <root>/people/<id>/villagers/<item>.json, each write to a temporary file in the
// same directory and then renamed over the record, so a crash never leaves half a record.
// Model failures answer 422; storage failures answer 500.
import { randomBytes } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { join } from 'node:path'
import { extractModule, oneShot, type Call } from './villager-input.ts'

export interface VillagerAsk { description: string; owner: string; accent: string; signal: AbortSignal; repair?: { module: string; reason: string } }
export type VillagerMaker = (ask: VillagerAsk) => Promise<{ module: string; persona?: Persona | null } & Call>

interface Stored { id: string; description: string; accent: string; module: string; persona: Persona | null; models: string[]; costUsd: number | null; outputTokens: number | null; ms: number; at: string; tuning?: Record<string, number>; repair?: { reason: string; previous: string; ms: number; models: string[]; costUsd: number | null; outputTokens: number | null; at: string } }

const PERSON = /^[a-z][a-z0-9-]{0,31}$/
const ITEM = /^[a-f0-9]{12}$/
const ACCENT = /^#[0-9a-f]{6}$/i
const MAX_DESCRIPTION = 300
const MAX_BODY = 4000
const MAX_MODULE = 120_000
const KNOBS = ['size', 'hue', 'pitch', 'pace', 'energy', 'warmth', 'playful', 'chatty', 'humour'] as const
const TEMPLATE = /^[a-f0-9]{12}$/
const MAX_TEMPLATES = 50
/** A refusal reason from the home's checks, as it enters the repair prompt. */
const MAX_REASON = 600

// The persona's shape is builder A's (home/src/villagers/gen/spec.ts) and the crude-humour rule is
// A's gatePersona() (templates.ts), its only owner. templates.ts imports './spec' without an
// extension, which the host's NodeNext typecheck refuses, so it is loaded by a path the checker
// does not follow, typed here, until that import names './spec.ts'.
import type { Persona } from '../../home/src/villagers/gen/spec.ts'
type Profile = { adult: boolean; crudeOptIn: boolean } | null
const templatesPath = '../../home/src/villagers/gen/templates.ts'
const { gatePersona } = (await import(templatesPath)) as { gatePersona: (persona: Persona, profile: Profile) => Persona }
export type { Persona }

const ENUM = {
  temperament: ['dry', 'upbeat', 'calm', 'blunt', 'warm', 'wry'],
  register: ['plain', 'formal', 'casual'],
  humour: ['none', 'dry', 'deadpan', 'wordplay', 'gentle'],
  humourDial: ['clean', 'cheeky', 'crude'],
} as const
/** spec.ts PERSONA_TEXT, the same caps. */
const CAP = { role: 40, speciality: 60, quirks: 3, quirk: 60, topics: 5, topic: 40, name: 40 }
const field = (o: unknown, k: string): unknown => (o !== null && typeof o === 'object' && !Array.isArray(o) && Object.hasOwn(o, k) ? (o as Record<string, unknown>)[k] : undefined)
const capped = (v: unknown, max: number) => (typeof v === 'string' && v.trim() ? v.trim().replace(/\s+/g, ' ').slice(0, max) : '')
const DEFAULT: Persona = { role: '', speciality: '', temperament: 'calm', register: 'plain', humour: 'none', quirks: [], topics: [], dials: { warmth: 0.5, playful: 0.3, chatty: 0.4, humour: 'clean' } }
type Partial_ = Partial<Omit<Persona, 'dials'>> & { dials?: Partial<Persona['dials']> }

/** Untrusted persona data to only its known fields: enums checked, text capped, dials clamped. Missing fields stay missing. */
export function personaFields(raw: unknown): Partial_ {
  const out: Partial_ = {}
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return out
  const role = capped(field(raw, 'role'), CAP.role), speciality = capped(field(raw, 'speciality'), CAP.speciality)
  if (role) out.role = role
  if (speciality) out.speciality = speciality
  for (const k of ['temperament', 'register', 'humour'] as const) {
    const v = field(raw, k)
    if (typeof v === 'string' && (ENUM[k] as readonly string[]).includes(v)) (out as Record<string, unknown>)[k] = v
  }
  for (const [k, n, max] of [['quirks', CAP.quirks, CAP.quirk], ['topics', CAP.topics, CAP.topic]] as const) {
    const v = field(raw, k)
    if (Array.isArray(v)) out[k] = v.slice(0, n).map((x) => capped(x, max)).filter(Boolean)
  }
  const d = field(raw, 'dials')
  const dials: Partial<Persona['dials']> = {}
  for (const k of ['warmth', 'playful', 'chatty'] as const) {
    const v = field(d, k)
    if (typeof v === 'number' && Number.isFinite(v)) dials[k] = Math.min(1, Math.max(0, v))
  }
  const h = field(d, 'humour')
  if (typeof h === 'string' && (ENUM.humourDial as readonly string[]).includes(h)) dials.humour = h as Persona['dials']['humour']
  if (Object.keys(dials).length) out.dials = dials
  return out
}

/** A whole persona from model output, or null when it names neither a role nor a speciality. Gated for the profile. */
export function checkPersona(raw: unknown, profile: Profile = null): Persona | null {
  const p = personaFields(raw)
  if (!p.role && !p.speciality) return null
  return gatePersona({ ...DEFAULT, ...p, dials: { ...DEFAULT.dials, ...p.dials } }, profile)
}

/** A template's partial persona, gated: crude humour survives only for a profile gatePersona allows. */
export function gateTemplate(persona: Partial_, profile: Profile): Partial_ {
  if (persona.dials?.humour !== 'crude') return persona
  const gated = gatePersona({ ...DEFAULT, ...persona, dials: { ...DEFAULT.dials, ...persona.dials } }, profile)
  return { ...persona, dials: { ...persona.dials, humour: gated.dials.humour } }
}

/** The humour knob's crude end (sliders.ts HUMOUR: clean 0, cheeky 0.5, crude 1; 0.75 and up rounds to crude). */
const CRUDE_FROM = 0.75
/** Tuning values with the humour knob held at cheeky unless gatePersona keeps crude for the profile. */
export function gateTuning<T extends Record<string, number>>(values: T, profile: Profile): T {
  if (!(values.humour >= CRUDE_FROM)) return values
  const kept = gatePersona({ ...DEFAULT, dials: { ...DEFAULT.dials, humour: 'crude' } }, profile).dials.humour === 'crude'
  return kept ? values : { ...values, humour: 0.5 }
}

/** A persona the model wrote beside the module, as a ```json block (at most 4 kB), or null. */
export function extractPersona(text: string, profile: Profile = null): Persona | null {
  const block = [...text.matchAll(/```json\n([\s\S]*?)```/g)].map((m) => m[1]).find((b) => b.length <= 4000)
  if (!block) return null
  try {
    const v = JSON.parse(block)
    return checkPersona(field(v, 'persona') ?? v, profile)
  } catch {
    return null
  }
}

/** VILLAGER_PROFILES=alex:adult-optin,sam:child (synthetic, until people have real profiles). Unlisted people are unknown. */
export function parseProfiles(spec: string | undefined): Record<string, Profile> {
  const out: Record<string, Profile> = {}
  for (const entry of (spec ?? '').split(',').map((e) => e.trim()).filter(Boolean)) {
    const [id, kind] = entry.split(':')
    if (kind === 'adult-optin') out[id] = { adult: true, crudeOptIn: true }
    else if (kind === 'adult') out[id] = { adult: true, crudeOptIn: false }
    else if (kind === 'child') out[id] = { adult: false, crudeOptIn: false }
    else throw new Error(`"${entry}" is not id:adult-optin|adult|child`)
  }
  return out
}

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

/** The request as the round-1 runner wrote it. */
export const villagerAsk = (description: string, owner: string, accent: string) => `Make a villager: ${description}.\n\nIts owner is ${owner}; the owner's accent colour is ${accent}.`
/** The repair request as the round-1 runner wrote it: the ask, the previous module and why it was refused. */
export const repairAsk = (ask: string, module: string, reason: string) => `${ask}\n\nYour previous file:\n\`\`\`js\n${module}\n\`\`\`\n\nIt failed with this error:\n${reason}\n\nReturn the corrected complete file.`

export function claudeVillagerMaker(model = 'sonnet'): VillagerMaker {
  const system = villagerPrompt()
  return async (ask) => {
    const first = villagerAsk(ask.description, ask.owner, ask.accent)
    const { text, ...call } = await oneShot(model, system, ask.repair ? repairAsk(first, ask.repair.module, ask.repair.reason) : first, ask.signal)
    return { module: extractModule(text), persona: extractPersona(text), ...call }
  }
}

/**
 * Stand-in for checks: the Dumpling example from arm-code.md in the asked accent, given a pup's
 * snout and tall ears so it passes the home's species check (gen/checks.ts: the example alone is
 * the round template the check refuses). "[stub-fail]" fails. "[stub-mark-head]" first returns it with
 * the whole head tagged as the role mark (the home's mark check refuses it), and the plain one on repair.
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
    return { module: module.replaceAll('#c8553d', ask.accent), models: ['stub'], costUsd: 0, outputTokens: 0, apiMs: 0 }
  }
}

/**
 * The /people/:id/villagers routes. Returns a handler that answers and returns
 * true for those paths (after the caller has checked the token), false otherwise.
 */
interface Template { id: string; name: string; persona: Partial_; audience: 'any' | 'adult' | 'child'; shared: boolean; maker: string; at: string }

export function villagerRoutes(config: { root: string; people: Record<string, string>; maker?: VillagerMaker; timeoutMs?: number; profiles?: Record<string, Profile> }) {
  const profileOf = (id: string): Profile => config.profiles?.[id] ?? null
  const making = new Set<string>()
  const dir = (id: string) => join(config.root, 'people', id, 'villagers')
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

  const templateDir = (id: string) => join(config.root, 'people', id, 'persona-templates')
  const listTemplates = async (id: string): Promise<Template[]> => {
    const files = (await readdir(templateDir(id)).catch((): string[] => [])).filter((f) => TEMPLATE.test(f.replace(/\.json$/, '')) && f.endsWith('.json'))
    const out: Template[] = []
    for (const f of files) {
      try {
        const t = JSON.parse(await readFile(join(templateDir(id), f), 'utf8')) as Template
        // Re-read through the same checks as on save: a file edited by hand is still only data.
        out.push({ id: t.id, name: capped(t.name, CAP.name) || 'A saved pattern', persona: personaFields(t.persona), audience: (['any', 'adult', 'child'] as const).includes(t.audience) ? t.audience : 'any', shared: t.shared === true, maker: id, at: String(t.at) })
      } catch {
        // An unreadable file is skipped, not served.
      }
    }
    return out.sort((a, b) => a.at.localeCompare(b.at))
  }
  /** Served to a reader: gated for their profile, and adult-only patterns only to a known adult. */
  const forReader = (list: Template[], profile: Profile) => list
    .filter((t) => t.audience === 'any' || (t.audience === 'adult' ? profile?.adult === true : profile?.adult === false))
    .map((t) => ({ ...t, persona: gateTemplate(t.persona, profile) }))

  /** One model call with the host's checks on its answer; answers 422 itself and returns null when the maker fails. */
  const makeOnce = async (res: ServerResponse, ask: Omit<VillagerAsk, 'signal'>) => {
    const started = Date.now()
    let made: Awaited<ReturnType<VillagerMaker>>
    try {
      made = await config.maker!({ ...ask, signal: AbortSignal.timeout(config.timeoutMs ?? 150_000) })
    } catch {
      send(res, 422, { error: 'the maker failed', ms: Date.now() - started })
      return null
    }
    const ms = Date.now() - started
    if (typeof made.module !== 'string' || !made.module.trim() || made.module.length > MAX_MODULE) {
      send(res, 422, { error: 'the maker returned no usable module', ms })
      return null
    }
    return { ...made, ms }
  }

  return async (path: string, req: IncomingMessage, res: ServerResponse): Promise<boolean> => {
    if (path === '/family/persona-templates' && req.method === 'GET') {
      const reader = new URL(req.url ?? '/', 'http://x').searchParams.get('for') ?? ''
      const profile = PERSON.test(reader) && Object.hasOwn(config.people, reader) ? profileOf(reader) : null
      const all = (await Promise.all(Object.keys(config.people).map(listTemplates))).flat().filter((t) => t.shared)
      return send(res, 200, { templates: forReader(all, profile) }), true
    }
    const t = /^\/people\/([^/]+)\/persona-templates$/.exec(path)
    if (t) {
      const id = t[1]
      if (!PERSON.test(id) || !Object.hasOwn(config.people, id)) return send(res, 404, { error: 'no such person' }), true
      if (req.method === 'GET') return send(res, 200, { templates: forReader(await listTemplates(id), profileOf(id)), profile: profileOf(id) }), true
      if (req.method !== 'POST') return send(res, 405, { error: 'method not allowed' }), true
      let b: Record<string, unknown>
      try {
        b = await body(req)
      } catch {
        return send(res, 400, { error: 'expected JSON {"name", "persona", "audience"?, "shared"?}' }), true
      }
      const name = capped(b.name, CAP.name)
      if (!name) return send(res, 400, { error: `name is 1 to ${CAP.name} characters` }), true
      const persona = personaFields(b.persona)
      if (!Object.keys(persona).length) return send(res, 400, { error: 'persona has no known fields' }), true
      const audience = b.audience === undefined ? 'any' : b.audience
      if (audience !== 'any' && audience !== 'adult' && audience !== 'child') return send(res, 400, { error: 'audience is any, adult or child' }), true
      if ((await listTemplates(id)).length >= MAX_TEMPLATES) return send(res, 409, { error: `at most ${MAX_TEMPLATES} saved patterns` }), true
      // Gated for its maker before it is ever written.
      const template: Template = { id: randomBytes(6).toString('hex'), name, persona: gateTemplate(persona, profileOf(id)), audience, shared: b.shared === true, maker: id, at: new Date().toISOString() }
      await mkdir(templateDir(id), { recursive: true, mode: 0o700 })
      await replaceFile(join(templateDir(id), `${template.id}.json`), JSON.stringify(template))
      return send(res, 200, { template }), true
    }
    const m = /^\/people\/([^/]+)\/villagers(?:\/([^/]+)(?:(\/tuning)|(\/remake))?)?$/.exec(path)
    if (!m) return false
    const [, id, item, tuning, remake] = m
    if (!PERSON.test(id) || !Object.hasOwn(config.people, id)) return send(res, 404, { error: 'no such person' }), true
    if (item !== undefined && !ITEM.test(item)) return send(res, 404, { error: 'no such villager' }), true

    if (!item && req.method === 'POST') {
      if (!config.maker) return send(res, 503, { error: 'no villager maker' }), true
      let b: Record<string, unknown>
      try {
        b = await body(req)
      } catch {
        return send(res, 400, { error: 'expected JSON {"description", "accent"}' }), true
      }
      const description = typeof b.description === 'string' ? b.description.trim().replace(/\s+/g, ' ') : ''
      if (!description || description.length > MAX_DESCRIPTION) return send(res, 400, { error: `description is 1 to ${MAX_DESCRIPTION} characters` }), true
      if (typeof b.accent !== 'string' || !ACCENT.test(b.accent)) return send(res, 400, { error: 'accent is a #rrggbb colour' }), true
      if (making.has(id)) return send(res, 409, { error: 'already making a villager' }), true
      making.add(id)
      try {
        const made = await makeOnce(res, { description, owner: config.people[id], accent: b.accent })
        if (!made) return true
        // Stored and returned as text for the home's sandbox; never imported, evaluated or run here.
        const persona = checkPersona(made.persona, profileOf(id))
        const record: Stored = { id: randomBytes(6).toString('hex'), description, accent: b.accent, module: made.module, persona, models: made.models, costUsd: made.costUsd, outputTokens: made.outputTokens, ms: made.ms, at: new Date().toISOString() }
        // A storage failure throws past here to the host's 500, never the maker's 422.
        await write(id, record)
        return send(res, 200, { item: record.id, module: record.module, persona, ms: made.ms, models: made.models, costUsd: made.costUsd, outputTokens: made.outputTokens, apiMs: made.apiMs }), true
      } finally {
        making.delete(id)
      }
    }
    if (item && remake && req.method === 'POST') {
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
      if (making.has(id)) return send(res, 409, { error: 'already making a villager' }), true
      making.add(id)
      try {
        const made = await makeOnce(res, { description: found.description, owner: config.people[id], accent: found.accent, repair: { module: found.module, reason } })
        if (!made) return true
        const persona = checkPersona(made.persona, profileOf(id)) ?? found.persona
        const record: Stored = { ...found, module: made.module, persona, repair: { reason, previous: found.module, ms: made.ms, models: made.models, costUsd: made.costUsd, outputTokens: made.outputTokens, at: new Date().toISOString() } }
        await write(id, record)
        return send(res, 200, { item: record.id, module: record.module, persona, ms: made.ms, models: made.models, costUsd: made.costUsd, outputTokens: made.outputTokens, apiMs: made.apiMs }), true
      } finally {
        making.delete(id)
      }
    }
    if (item && !tuning && !remake && req.method === 'GET') {
      const found = await read(id, item)
      if (!found) return send(res, 404, { error: 'no such villager' }), true
      return send(res, 200, { id: found.id, description: found.description, accent: found.accent, module: found.module, persona: found.persona ? gatePersona(found.persona, profileOf(id)) : null, tuning: found.tuning ? gateTuning(found.tuning, profileOf(id)) : null }), true
    }
    if (item && tuning && req.method === 'POST') {
      const found = await read(id, item)
      if (!found) return send(res, 404, { error: 'no such villager' }), true
      let b: Record<string, unknown>
      try {
        b = await body(req)
      } catch {
        return send(res, 400, { error: `expected JSON {${KNOBS.join(', ')}}` }), true
      }
      const values: Record<string, number> = {}
      for (const k of KNOBS) {
        const v = b[k]
        if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 1) return send(res, 400, { error: `${k} is a number from 0 to 1` }), true
        values[k] = v
      }
      // The host's profile is the only input to the gate: a body cannot ask for crude.
      found.tuning = gateTuning(values, profileOf(id))
      await write(id, found)
      return send(res, 200, { ok: true }), true
    }
    return send(res, 405, { error: 'method not allowed' }), true
  }
}
