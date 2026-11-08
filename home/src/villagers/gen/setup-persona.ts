// #47 setup, dev only: the villager's adult persona in the workshop. The persona is #42's
// persona.json shape; the host owns it, its check (checkPersona), the patterns (TEMPLATES) and the
// humour rule (humourCeiling). The page shows what the host checked and sends the dials back as
// data; it never decides humour. This file only writes the scene's own lines. The felt is an art
// style, not a mental age.
import { personaShape } from './build'
import { ENUMS, type Persona, type Role } from './spec'

export type { Persona }

/** A persona of the host's shape, for display; null when there is none. */
export const checked = (raw: unknown): Persona | null => personaShape(raw)

/**
 * Saved round-1 results carry no persona in this shape: a plain one for display from the name, the role
 * and the description's "who ..." clause. It never leaves the page: only a host-checked persona is sent off.
 */
export function fallbackPersona(description: string, role: string, name: string): Persona {
  const who = (/\bwho\s+(.+)$/i.exec(description)?.[1] ?? description).split(/\band\b/)[0].trim()
  const plain = (s: string, max: number) => s.replace(/[^\p{L}\p{N} ,.;:!?'’()&/+-]/gu, '').slice(0, max).trim()
  return {
    name: /^[A-Z][A-Za-z' -]{0,23}$/.test(name) ? name : 'Hazel',
    role: plain(role, 24) || 'helper',
    speciality: plain(who, 160) || plain(role, 160) || 'the household',
    temperament: 'steady, capable',
    register: 'plain and friendly',
    humour: { style: 'light and dry', lean: 'clean' },
    quirks: [],
    cares: [],
    lengths: { card: 2, table: 1, long: 10 },
  }
}

/** Where the sliders start for a persona when the host sent none: the middle for warmth and play, chatty from its cards, jokes from its lean. */
export const dialsOf = (p: Persona) => ({ warmth: 0.5, playful: 0.5, chatty: (p.lengths.card - 1) / 2, humour: p.humour.lean === 'cheeky' ? 0.5 : 0 })

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
export function personaNotes(p: Persona, pattern: string | null): string[] {
  const out: string[] = []
  out.push([p.role, p.speciality].filter(Boolean).join(': '))
  out.push(`${p.temperament}; ${p.humour.style}${p.humour.lean === 'cheeky' ? ', cheeky' : ''}`)
  if (pattern) out.push(`pattern: ${pattern}`)
  for (const q of p.quirks.slice(0, pattern ? 1 : 2)) out.push(q)
  return out
}

/**
 * The role the person's words ask for, one of the home's roles (spec.ts ENUMS.role), or undefined so the model's
 * about() decides. Only role nouns and unambiguous chores count ("makes the best tea" is not a maker), because a role
 * sent decides the mark for good. The first role named in the description wins; a built-in pattern's role is used only
 * when the words name none. The host checks it against the same list; the felt kit sews that role's mark.
 */
const ROLE_WORDS: [Role, RegExp][] = [
  ['cook', /\b(cook|cooks|cooking|chef|baker|bakes?|baking|bread|recipes?)\b/i],
  ['gardener', /\b(garden\w*|plants?|seeds?|seedlings?|compost)\b/i],
  ['tidier', /\b(tidy|tidies|tidier|tidying|laundry|dust\w*|sweeps?|declutter\w*)\b/i],
  ['keeper', /\b(keeper|calendar|diary|schedules?|appointments?|organi[sz]er|bills|budget)\b/i],
  ['tutor', /\b(tutor\w*|teach\w*|homework|lessons?)\b/i],
  ['messenger', /\b(messenger|messages?|letters?|reminders?|errands?)\b/i],
  ['maker', /\b(maker|builds?|builder|fix|fixes|fixing|mends?|repairs?|crafts?|knits?|sews?|woodwork)\b/i],
  ['carer', /\b(carer|nurse|nursing|looks? after|wellbeing)\b/i],
]
const PATTERN_ROLE: Record<string, Role> = { organiser: 'keeper', coach: 'tutor', grandparent: 'carer', craftsperson: 'maker' }
export function roleFor(description: string, pattern?: string | null): Role | undefined {
  let best: { role: Role; at: number } | null = null
  for (const [role, words] of ROLE_WORDS) {
    const at = description.search(words)
    if (at >= 0 && (!best || at < best.at)) best = { role, at }
  }
  const role = best?.role ?? (pattern ? PATTERN_ROLE[pattern] : undefined)
  return role && ENUMS.role.includes(role) ? role : undefined
}
