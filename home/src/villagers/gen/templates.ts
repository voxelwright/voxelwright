// #47: persona templates and the one rule for crude humour. A villager's persona is set at
// creation from its description, a template, or both; the setup sliders adjust it afterwards.
// Every persona, whether a model wrote it or a template supplied it, passes gatePersona() before
// use. The model never grants crude humour, and neither does a template: only the profile does.
import type { Persona } from './spec'

export type HumourDial = Persona['dials']['humour']

export interface PersonaTemplate {
  id: string
  name: string
  /** What the template sets; anything left out comes from the description. */
  persona: Partial<Omit<Persona, 'dials'>> & { dials?: Partial<Persona['dials']> }
  /** Who may pick it in setup. 'adult' templates are not offered for a child's villager. */
  audience: 'adult' | 'child' | 'any'
}

/** Who the villager is for, as setup knows it. null when unknown. */
export type PersonaProfile = { adult: boolean; crudeOptIn: boolean } | null

/** Original characters, all adult and competent; the felt is an art style, not a mental age. */
export const BUILTIN_TEMPLATES: PersonaTemplate[] = [
  {
    id: 'organiser', name: 'Sharp organiser', audience: 'any',
    persona: {
      temperament: 'blunt', register: 'plain', humour: 'dry',
      quirks: ['Answers a question with the next deadline', 'Keeps lists of the lists'],
      dials: { warmth: 0.35, playful: 0.2, chatty: 0.3, humour: 'clean' },
    },
  },
  {
    id: 'coach', name: 'Calm coach', audience: 'any',
    persona: {
      temperament: 'calm', register: 'plain', humour: 'gentle',
      quirks: ['Asks what you think before saying what it thinks', 'Breaks big jobs into one next step'],
      dials: { warmth: 0.7, playful: 0.3, chatty: 0.45, humour: 'clean' },
    },
  },
  {
    id: 'grandparent', name: 'Warm grandparent type', audience: 'any',
    persona: {
      temperament: 'warm', register: 'casual', humour: 'gentle',
      quirks: ['Remembers what everyone had for dinner last week', 'Has a story for most things, and keeps it short'],
      dials: { warmth: 0.9, playful: 0.4, chatty: 0.65, humour: 'clean' },
    },
  },
  {
    id: 'craftsperson', name: 'Dry-witted craftsperson', audience: 'any',
    persona: {
      temperament: 'dry', register: 'plain', humour: 'deadpan',
      quirks: ['Judges a job by how long it will last', 'Understates everything, including good news'],
      dials: { warmth: 0.45, playful: 0.35, chatty: 0.25, humour: 'cheeky' },
    },
  },
  {
    id: 'buddy', name: 'Irreverent buddy', audience: 'adult',
    persona: {
      temperament: 'wry', register: 'casual', humour: 'wordplay',
      quirks: ['Roasts the plan, then does it properly', 'Swears at the dishwasher, never at people'],
      dials: { warmth: 0.6, playful: 0.8, chatty: 0.6, humour: 'crude' },
    },
  },
  {
    id: 'companion', name: 'Gentle child companion', audience: 'child',
    persona: {
      temperament: 'warm', register: 'plain', humour: 'gentle',
      quirks: ['Explains why, not just what', 'Treats every question as a good one'],
      dials: { warmth: 0.85, playful: 0.55, chatty: 0.5, humour: 'clean' },
    },
  },
]

/** The templates setup may offer for this profile: adult ones only to a known adult, child ones only to a known child. */
export function templatesFor(profile: PersonaProfile): PersonaTemplate[] {
  return BUILTIN_TEMPLATES.filter((t) => t.audience === 'any' || (t.audience === 'adult' ? profile?.adult === true : profile?.adult === false))
}

/**
 * Merge rule: the template wins on temperament, register, humour style and all dials; the
 * description keeps role, speciality and topics; quirks are the description's first, then the
 * template's, three at most. Crude humour is still decided later by gatePersona().
 */
export function applyTemplate(base: Persona, template: PersonaTemplate): Persona {
  const t = template.persona
  return {
    role: base.role,
    speciality: base.speciality,
    topics: base.topics,
    temperament: t.temperament ?? base.temperament,
    register: t.register ?? base.register,
    humour: t.humour ?? base.humour,
    quirks: [...base.quirks, ...(t.quirks ?? [])].slice(0, 3),
    dials: { ...base.dials, ...t.dials },
  }
}

/**
 * The only owner of the crude-humour rule: crude stays only for a known adult who opted in;
 * a child, an adult who did not opt in, or an unknown profile gets cheeky instead.
 */
export function gatePersona<P extends Persona | undefined>(persona: P, profile: PersonaProfile): P {
  if (!persona || persona.dials.humour !== 'crude') return persona
  if (profile?.adult === true && profile.crudeOptIn === true) return persona
  return { ...persona, dials: { ...persona.dials, humour: 'cheeky' } }
}
