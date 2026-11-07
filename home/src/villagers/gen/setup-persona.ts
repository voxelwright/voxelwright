// #47 setup, dev only: the villager's adult persona in the workshop. The shape and its
// checks are builder A's (./spec.ts Persona, ./build.ts check()), templates and the one
// crude-humour rule are A's too (./templates.ts applyTemplate, gatePersona). This file
// only puts them together for the scene and writes the scene's own lines. The felt is an
// art style, not a mental age. The profile these take is the host's, read from GET
// persona-templates (setup.ts); until it answers, it is null and crude stays locked. The host
// gates every persona and tuning it stores or serves with the same rule, so the page cannot
// unlock anything there either.
import { check } from './build'
import type { Persona } from './spec'
import { applyTemplate, gatePersona, type PersonaProfile, type PersonaTemplate } from './templates'

export type { Persona, PersonaProfile, PersonaTemplate }

/** Untrusted persona data through A's checker; null when there is none. */
export function checked(raw: unknown): Persona | null {
  if (raw === null || typeof raw !== 'object') return null
  return check({ persona: raw }).spec.persona ?? null
}

/** Saved round-1 results have no persona: a plain one from the role and the description's "who ..." clause. */
export function fallbackPersona(description: string, role: string): Persona {
  const who = /\bwho\s+(.+)$/i.exec(description)?.[1] ?? description
  return checked({ role, speciality: who.split(/\band\b/)[0].trim() || role, temperament: 'calm', register: 'plain', humour: 'dry', quirks: [], topics: [] })!
}

/** Description persona, then the template over it, then the gate. Returns whether the gate changed anything. */
export function personaFor(base: Persona, template: PersonaTemplate | null, profile: PersonaProfile): { persona: Persona; gated: boolean } {
  // A template may come from a stored or shared file: the merge goes back through the checker before the gate.
  const merged = template ? checked(applyTemplate(base, template)) ?? base : base
  const persona = gatePersona(merged, profile)
  return { persona, gated: persona.dials.humour !== merged.dials.humour }
}

/** May this profile have crude humour? Asked of gatePersona, the rule's only owner. */
export function crudeAllowed(profile: PersonaProfile): boolean {
  const p = fallbackPersona('', 'helper')
  return gatePersona({ ...p, dials: { ...p.dials, humour: 'crude' } }, profile).dials.humour === 'crude'
}

export const HUMOUR_STEPS = ['clean', 'cheeky', 'crude'] as const

/** The lines it says when tuned, chosen by its dials: competent adults, dry or warm, never baby talk. */
const LINES = {
  blunt: ['Fine.', 'That works.', 'Leave it there.', 'Good enough. Next?'],
  warm: ['That suits me, I think.', 'Better. Thank you.', 'Oh, that feels right.', "Yes. That's me."],
  wry: ['Bold. I approve.', 'Well, now I look the part.', 'I could get used to this.', 'Very distinguished.'],
  plain: ["That'll do nicely.", 'Better. Leave it there?', 'Hm. I could live with that.', 'Noted.'],
}
export function tunedLine(dials: { warmth: number; playful: number; chatty: number }, n: number): string {
  const pool = dials.warmth < 0.35 ? LINES.blunt : dials.playful > 0.65 ? LINES.wry : dials.warmth > 0.65 ? LINES.warm : LINES.plain
  // Brief villagers keep to the shortest; chatty ones may take the longer lines.
  const sorted = [...pool].sort((a, b) => a.length - b.length)
  const span = Math.max(1, Math.round(sorted.length * (0.4 + dials.chatty * 0.6)))
  return sorted[n % span]
}

/** Short lines for the pattern sheet's pinned note, in plain grown-up words. */
export function personaNotes(p: Persona, template: PersonaTemplate | null): string[] {
  const out: string[] = []
  if (p.role || p.speciality) out.push([p.role, p.speciality].filter(Boolean).join(': '))
  const humour = p.humour === 'none' ? 'no jokes' : `${p.humour} humour`
  out.push(`${p.temperament}, ${p.register}, ${humour}${p.dials.humour === 'clean' ? '' : `, ${p.dials.humour}`}`)
  if (template) out.push(`pattern: ${template.name}`)
  for (const q of p.quirks.slice(0, template ? 1 : 2)) out.push(q)
  return out
}
