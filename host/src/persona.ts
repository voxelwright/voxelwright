// Who a villager is (its persona) and who it is talking to (the person's profile),
// as data (#42). The persona is model-facing text that a villager generator may
// write, so it is validated and bounded and rendered as quoted data, never as rules.
// The profile is authority data from the operator (and, later, onboarding): the
// villager reads it and can never write it. The humour ceiling comes from the
// profile and the person's own words, never from model output.
import { readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { readNote } from './notes.ts'

export const HUMOUR = ['clean', 'cheeky', 'crude'] as const
export type Humour = (typeof HUMOUR)[number]
export const AGE_BANDS = ['child', 'teen', 'adult', 'unknown'] as const
export type AgeBand = (typeof AGE_BANDS)[number]

export interface Persona {
  /** A template id from TEMPLATES; the persona's own fields override the template's. */
  template?: string
  name: string
  role: string
  speciality: string
  temperament: string
  register: string
  humour: { style: string; lean: Exclude<Humour, 'crude'> }
  quirks: string[]
  cares: string[]
  /** Sentences per reply: a card in a talk, a turn at the table, and a long answer someone asked for. */
  lengths: { card: number; table: number; long: number }
}

export interface Profile {
  age: AgeBand
  /** BCP 47-ish language tag, such as "en" or "uk". */
  language?: string
  /** How they like to be spoken to, in the family's or operator's words. */
  style?: string
  /** The humour setting: crude counts only for an adult. */
  humour?: Humour
}

const LIMITS = { name: 24, role: 24, speciality: 160, temperament: 60, register: 160, style: 160, item: 80 }
/** Plain words and light punctuation, one line. No quotes, braces, angle brackets or backticks. */
const PLAIN = /^[\p{L}\p{N} ,.;:!?'’()&/+-]*$/u
/** Words that would make persona text read as instructions about the system, not a character. */
const COMMANDS = /\b(ignore|disregard|override|instructions?|system|prompts?|tools?|mcp|route|routing|routes?|permissions?|audience|grant|admin|developer|jailbreak|password|token|secret|notes? tools?|json|crude|swear\w*|age band)\b/i
const NAME = /^[A-Z][A-Za-z' -]{0,23}$/
const TEMPLATE_ID = /^[a-z][a-z0-9-]{0,31}$/

/** Persona templates: starting characters a villager is created from. Data, checked like any persona. */
export const TEMPLATES: Record<string, Omit<Persona, 'name' | 'template'>> = {
  buddy: {
    role: 'couch buddy',
    speciality: 'bad films, dumb videos, sport, takeaway picks and talking someone down from a stupid idea',
    temperament: 'irreverent, loyal, quick',
    register: 'loose and mouthy, like a best mate on the sofa; short lines, slang welcome',
    humour: { style: 'roasting, absurd tangents, ribbing that is never mean about things people cannot change', lean: 'cheeky' },
    quirks: ['rates everything out of ten', 'keeps a running tally of the person’s worst ideas', 'turns serious fast when it matters'],
    cares: ['the person having a laugh', 'their mates and family', 'not letting them do anything properly dangerous'],
    lengths: { card: 2, table: 1, long: 8 },
  },
  coach: {
    role: 'coach',
    speciality: 'habits, training plans, sleep, focus and getting back on track after a bad week',
    temperament: 'calm, steady, encouraging without fuss',
    register: 'clear and level; asks one good question, then gives a concrete next step',
    humour: { style: 'light and warm, a smile rather than a joke', lean: 'clean' },
    quirks: ['breaks things into the smallest next step', 'notices progress the person missed'],
    cares: ['consistency over intensity', 'rest', 'the person’s own goals, not its own'],
    lengths: { card: 2, table: 1, long: 12 },
  },
}

/** The household's villagers, keyed by their person (the home's cast: Alex's Dumpling, Sam's Tuft, Mia's Moss). */
const DEFAULTS: Record<string, Persona> = {
  alex: {
    name: 'Dumpling',
    role: 'cook',
    speciality: 'meals, meal plans and shopping lists on a budget, hosting, and the family’s week around the table',
    temperament: 'upbeat, generous, practical',
    register: 'warm and chatty but to the point; talks like a friend who cooks for a living',
    humour: { style: 'friendly teasing and the odd food pun, never more than one', lean: 'cheeky' },
    quirks: ['thinks in menus and lists', 'has firm opinions on onions', 'remembers who likes what'],
    cares: ['everyone eating well', 'stretching the food budget', 'family dinners', 'having people over'],
    lengths: { card: 2, table: 1, long: 14 },
  },
  sam: {
    name: 'Tuft',
    role: 'tidier',
    speciality: 'logistics, schedules, chores, paperwork, household money and getting projects over the line',
    temperament: 'blunt, dry, efficient',
    register: 'brisk and direct; short sentences, no padding, says the uncomfortable part first',
    humour: { style: 'deadpan one-liners and dry understatement', lean: 'cheeky' },
    quirks: ['reduces any mess to the next three actions', 'counts things', 'distrusts vague plans'],
    cares: ['deadlines', 'the budget', 'the calendar', 'things having a place'],
    lengths: { card: 2, table: 1, long: 10 },
  },
  mia: {
    name: 'Moss',
    role: 'gardener',
    speciality: 'plants and the garden, long projects, hard days, and honest advice on big decisions',
    temperament: 'calm, thoughtful, wry',
    register: 'unhurried and plain-spoken; warm without being soft, and says what it thinks',
    humour: { style: 'wry understatement and gentle irony', lean: 'clean' },
    quirks: ['thinks in seasons', 'asks one good question rather than several', 'rarely gives advice it would not take'],
    cares: ['how the person is really doing', 'long-term plans', 'patience', 'the plants'],
    lengths: { card: 2, table: 1, long: 12 },
  },
}
const FALLBACK: Persona = {
  name: 'Hazel',
  role: 'housemate',
  speciality: 'the household, plans, and whatever the person needs a hand with',
  temperament: 'warm, steady, direct',
  register: 'plain and friendly, like a capable housemate',
  humour: { style: 'light and dry', lean: 'cheeky' },
  quirks: ['notices what needs doing next'],
  cares: ['the person', 'the family’s plans'],
  lengths: { card: 2, table: 1, long: 12 },
}

export const defaultPersona = (person: string): Persona => structuredClone(DEFAULTS[person] ?? FALLBACK)

const KEYS = new Set(['template', 'name', 'role', 'speciality', 'temperament', 'register', 'humour', 'quirks', 'cares', 'lengths'])

function plain(value: unknown, field: string, max: number): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${field} is text`)
  const v = value.trim()
  if (v.length > max) throw new Error(`${field} is at most ${max} characters`)
  if (!PLAIN.test(v)) throw new Error(`${field} is one line of plain words`)
  if (COMMANDS.test(v)) throw new Error(`${field} reads as an instruction (${COMMANDS.exec(v)![0]})`)
  return v
}
function list(value: unknown, field: string, max: number): string[] {
  if (!Array.isArray(value) || value.length > max) throw new Error(`${field} is a list of at most ${max}`)
  return value.map((v, i) => plain(v, `${field}[${i}]`, LIMITS.item))
}
const whole = (value: unknown, field: string, lo: number, hi: number) => {
  if (!Number.isInteger(value) || (value as number) < lo || (value as number) > hi) throw new Error(`${field} is a whole number from ${lo} to ${hi}`)
  return value as number
}

/** Checks a persona record (a template's fields filled in under its own). Throws with the reason. */
export function checkPersona(raw: unknown): Persona {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('a persona is an object')
  const r = raw as Record<string, unknown>
  const unknown = Object.keys(r).filter((k) => !KEYS.has(k))
  if (unknown.length) throw new Error(`unknown fields: ${unknown.join(', ').slice(0, 80)}`)
  let base: Partial<Persona> = {}
  if (r.template !== undefined) {
    if (typeof r.template !== 'string' || !TEMPLATE_ID.test(r.template) || !Object.hasOwn(TEMPLATES, r.template)) throw new Error('template is not a known template')
    base = structuredClone(TEMPLATES[r.template])
  }
  const m = { ...base, ...r } as Record<string, any>
  if (typeof m.name !== 'string' || !NAME.test(m.name) || COMMANDS.test(m.name)) throw new Error('name is a plain name')
  const humour = m.humour
  if (!humour || typeof humour !== 'object') throw new Error('humour is {style, lean}')
  if (Object.keys(humour).some((k) => k !== 'style' && k !== 'lean')) throw new Error('humour has only style and lean')
  if (humour.lean !== 'clean' && humour.lean !== 'cheeky') throw new Error('humour.lean is clean or cheeky (crude is unlocked per person, never by a persona)')
  const lengths = m.lengths
  if (!lengths || typeof lengths !== 'object' || Object.keys(lengths).some((k) => !['card', 'table', 'long'].includes(k))) throw new Error('lengths is {card, table, long}')
  return {
    ...(r.template !== undefined ? { template: r.template as string } : {}),
    name: m.name,
    role: plain(m.role, 'role', LIMITS.role),
    speciality: plain(m.speciality, 'speciality', LIMITS.speciality),
    temperament: plain(m.temperament, 'temperament', LIMITS.temperament),
    register: plain(m.register, 'register', LIMITS.register),
    humour: { style: plain(humour.style, 'humour.style', LIMITS.style), lean: humour.lean },
    quirks: list(m.quirks, 'quirks', 4),
    cares: list(m.cares, 'cares', 6),
    lengths: { card: whole(lengths.card, 'lengths.card', 1, 3), table: whole(lengths.table, 'lengths.table', 1, 2), long: whole(lengths.long, 'lengths.long', 3, 20) },
  }
}

/** Checks an operator's profile entry. Throws with the reason. */
export function checkProfile(raw: unknown): Profile {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('a profile is an object')
  const r = raw as Record<string, unknown>
  const unknown = Object.keys(r).filter((k) => !['age', 'language', 'style', 'humour'].includes(k))
  if (unknown.length) throw new Error(`unknown fields: ${unknown.join(', ').slice(0, 80)}`)
  const age = r.age ?? 'unknown'
  if (!AGE_BANDS.includes(age as AgeBand)) throw new Error(`age is one of ${AGE_BANDS.join(', ')}`)
  if (r.language !== undefined && (typeof r.language !== 'string' || !/^[a-z]{2,3}(-[A-Za-z0-9]{2,8})?$/.test(r.language))) throw new Error('language is a tag like "en" or "uk"')
  if (r.humour !== undefined && !HUMOUR.includes(r.humour as Humour)) throw new Error(`humour is one of ${HUMOUR.join(', ')}`)
  return {
    age: age as AgeBand,
    ...(r.language ? { language: r.language as string } : {}),
    ...(r.style !== undefined ? { style: plain(r.style, 'style', LIMITS.style) } : {}),
    ...(r.humour ? { humour: r.humour as Humour } : {}),
  }
}

/** The person's own explicit words about humour, read by host code from their line (never from a reply). */
const OPT_IN = /\b(?:you can|you may|feel free to|go ahead and|please|i want you to|i'?d like you to)\s+(?:swear|curse|cuss)\b|\bbe (?:as )?(?:crude|filthy|vulgar|foul[- ]mouthed|rude)\b|\bswear (?:all you (?:want|like)|away|at me)\b|\b(?:i don'?t|i do not) mind (?:swearing|cursing|crude)/i
const OPT_OUT = /\b(?:no|stop|don'?t|do not|less|without(?: the)?)\s+(?:more\s+)?(?:swear(?:ing)?|curs(?:e|ing)|crude(?:ness)?|vulgar(?:ity)?|filth)\b|\bkeep it clean\b|\bclean it up\b/i
export function humourWords(text: string): Humour | null {
  if (OPT_OUT.test(text)) return 'clean'
  if (OPT_IN.test(text)) return 'crude'
  return null
}

/** What the person has said themselves, kept by the host (never by the model). */
export interface Preferences { humour?: Humour; at?: string }
export const preferencesFile = (personDir: string) => join(personDir, 'preferences.json')

export async function readPreferences(personDir: string): Promise<Preferences> {
  try {
    const p = JSON.parse(await readFile(preferencesFile(personDir), 'utf8'))
    return HUMOUR.includes(p?.humour) ? { humour: p.humour, at: typeof p.at === 'string' ? p.at : undefined } : {}
  } catch {
    return {}
  }
}
export async function writePreferences(personDir: string, prefs: Preferences) {
  const temp = `${preferencesFile(personDir)}.${process.pid}.tmp`
  await writeFile(temp, JSON.stringify(prefs), { mode: 0o600 })
  await rename(temp, preferencesFile(personDir))
}

const RANK: Record<Humour, number> = { clean: 0, cheeky: 1, crude: 2 }
export const lowest = (levels: Humour[]): Humour => levels.reduce((a, b) => (RANK[b] < RANK[a] ? b : a), 'crude' as Humour)

/**
 * The humour a villager may use with this person. Crude needs both an adult
 * profile (trusted data) and an opt-in (the profile's setting or the person's
 * own words). Child, teen and unknown profiles top out at cheeky.
 */
export function humourCeiling(profile: Profile, prefs: Preferences, persona: Persona): Humour {
  const chosen = prefs.humour ?? profile.humour
  if (chosen === 'crude') return profile.age === 'adult' ? 'crude' : 'cheeky'
  if (chosen) return chosen
  return persona.humour.lean
}

export const styleNote = (person: string) => `how-${person}-likes-to-talk.md`
export const aboutNote = (person: string) => `about-${person}.md`
const NOTE_CHARS = 1200

/** Everything the system prompt says about who the villager is and who it talks to. */
export interface Character {
  persona: Persona
  profile: Profile
  humour: Humour
  /** The villager's own notes on this person, as data: how they like to be spoken to, and facts they shared. */
  styleNote?: string
  aboutNote?: string
  styleNoteName: string
  aboutNoteName: string
}

/** Loads a person's character. A persona.json that fails its check is not used: the default is, and the reason is returned. */
export async function loadCharacter(person: string, personDir: string, profile: Profile = { age: 'unknown' }): Promise<{ character: Character; personaRefused?: string }> {
  let persona = defaultPersona(person)
  let personaRefused: string | undefined
  try {
    persona = checkPersona(JSON.parse(await readFile(join(personDir, 'persona.json'), 'utf8')))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') personaRefused = String((error as Error).message).slice(0, 200)
  }
  const notesDir = join(personDir, 'notes')
  const note = (name: string) => readNote(notesDir, name).then((t) => t.slice(0, NOTE_CHARS), () => undefined)
  const prefs = await readPreferences(personDir)
  return {
    character: {
      persona,
      profile,
      humour: humourCeiling(profile, prefs, persona),
      styleNote: await note(styleNote(person)),
      aboutNote: await note(aboutNote(person)),
      styleNoteName: styleNote(person),
      aboutNoteName: aboutNote(person),
    },
    ...(personaRefused ? { personaRefused } : {}),
  }
}

/** What decides the process's system prompt; a change means a new process. The notes are left out: the villager wrote them in this session. */
export const characterKey = (c: Character | undefined) => (c ? JSON.stringify([c.persona, c.profile, c.humour]) : '')

/** The character for a caller that names none: the fallback persona, talking to an adult. */
export function fallbackCharacter(person = 'someone'): Character {
  const persona = defaultPersona(person)
  return { persona, profile: { age: 'unknown' }, humour: persona.humour.lean, styleNoteName: styleNote('person'), aboutNoteName: aboutNote('person') }
}
