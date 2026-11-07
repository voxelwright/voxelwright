// #47 regroup, strategy C: tuning by talking. Trusted code maps a phrase ("a bit taller",
// "lower voice", "keep the jokes clean") to the same nine values the tools set. Data only: no
// model call per tweak. A phrase it can't read changes nothing and says so.
import type { Key } from './sliders'

export interface Change { key: Key; to: number; word: string }
export interface Parsed { changes: Change[]; undo: boolean; reset: boolean; unread: string[] }

const SMALL = /\b(a (?:tiny|little|wee) bit|a touch|a tad|slightly|a little|a bit|somewhat|just a bit)\b/g
const BIG = /\b(much|a lot|lots|way|far|very|really|loads|heaps)\b/
const MAX = /\b(as \w+ as (?:possible|can be|it gets|it goes)|max(?:imum)?|the most|all the way)\b/
/** "less chatty", "not so blunt", "too tall": the word after it counts the other way. */
const NEG = /\b(?:less|not (?:so|as|too)|too|no longer)\s+(?:\w+\s+)?$/

interface Rule { key: Key; up: RegExp; down: RegExp; words: [string, string]; when?: RegExp }
/** In order: the first rule that reads a word takes it, so "warmer colour" is the felt and plain "warmer" the manner. */
const RULES: Rule[] = [
  { key: 'chatty', words: ['briefer', 'chattier'],
    up: /\b(chattier|chatty|talkative|wordier|say more|talk more|longer (?:answers|replies)|ramble|rambling)\b/,
    down: /\b(briefer|brief|terse|terser|concise|succinct|shorter (?:answers|replies)|short (?:answers|replies)|fewer words|talk less|say less|quieter|quiet)\b/ },
  { key: 'pace', words: ['talks slower', 'talks quicker'],
    up: /\b(faster|quicker|speed up|hurry up|brisker|snappier)\b/,
    down: /\b(slower|slow down|unhurried|leisurely|take (?:their|its|his|her) time|slow)\b/ },
  { key: 'energy', words: ['calmer', 'livelier'],
    up: /\b(livelier|lively|bouncier|bouncy|energetic|more energy|higher energy|perkier|perky|peppier|zippier|springier|spry)\b/,
    down: /\b(calmer|calm|sleepier|sleepy|relaxed|mellower|mellow|chiller|chill|lazier|lazy|less energy|lower energy|stiller)\b/ },
  { key: 'pitch', words: ['lower voice', 'higher voice'],
    up: /\b(higher|squeakier|squeaky|high-pitched|high voice|lighter voice)\b/,
    down: /\b(lower|deeper|deep|gruffer|gravelly|bassier|low voice)\b/ },
  { key: 'size', words: ['smaller', 'bigger'],
    up: /\b(taller|bigger|larger|huger|grow|tall|big|large)\b/,
    down: /\b(shorter|smaller|tinier|littler|shrink|short|small|tiny|little)\b/ },
  { key: 'warmth', words: ['blunter', 'warmer'],
    up: /\b(warmer|warm|kinder|kind|gentler|gentle|friendlier|friendly|softer|soft|sweeter|nicer|nice|cosier)\b/,
    down: /\b(blunter|blunt|more direct|direct|franker|frank|sharper|sterner|stern|colder|cold|cooler|tougher|harsher|no-nonsense)\b/ },
  { key: 'playful', words: ['more serious', 'more playful'],
    up: /\b(more playful|playful|funnier|funny|sillier|silly|goofier|goofy|whimsical|jokier|lighter|light-hearted|cheerier|fun)\b/,
    down: /\b(more serious|serious|sober|earnest|solemn|straight-faced|drier|dry)\b/ },
]

/** Colours by hue, in degrees. */
const HUES: [RegExp, number, string][] = [
  [/\b(redder|red)\b/, 4, 'redder'],
  [/\b(oranger|orange)\b/, 28, 'more orange'],
  [/\b(yellower|yellow|golden|gold)\b/, 50, 'more golden'],
  [/\b(greener|green)\b/, 115, 'greener'],
  [/\b(teal|turquoise)\b/, 175, 'more teal'],
  [/\b(bluer|blue)\b/, 220, 'bluer'],
  [/\b(purpler|purple|violet|lilac)\b/, 275, 'more purple'],
  [/\b(pinker|pink|rosier|rosy)\b/, 335, 'pinker'],
]
const COLOUR = /\b(colou?rs?|felt|fur|shade|tone|hue|coat)\b/

const clamp = (v: number) => Math.min(1, Math.max(0, v))
const near = (a: number, b: number) => Math.min(Math.abs(a - b), 360 - Math.abs(a - b))

/**
 * Read one message. `values` are the nine now; `hueOf(v)` is the felt's hue in degrees at a colour value (null before
 * there is a villager), so "greener" moves toward green whichever way that is for this felt.
 */
export function parseTweak(text: string, values: Record<Key, number>, hueOf: (v: number) => number | null): Parsed {
  const out: Parsed = { changes: [], undo: false, reset: false, unread: [] }
  const said = text.toLowerCase().replace(/[’']/g, "'").trim()
  if (/^\s*(undo|take (?:that|it) back|go back|never ?mind|scratch that)\b/.test(said)) return { ...out, undo: true }
  if (/\b(as (?:made|you were|before|it was)|reset|start over|back to (?:normal|how (?:it|they) w(?:as|ere)))\b/.test(said)) return { ...out, reset: true }
  const seen = new Set<Key>()
  const add = (c: Change) => {
    if (seen.has(c.key)) return
    seen.add(c.key)
    out.changes.push(c)
  }
  for (const raw of said.split(/[,;.!?]|\band\b|\bbut\b|\bthen\b|\balso\b|\bplus\b/)) {
    let clause = ` ${raw.trim()} `
    if (!clause.trim()) continue
    const amount = MAX.test(clause) ? 'max' : clause.match(SMALL) ? 0.12 : BIG.test(clause) ? 0.32 : 0.2
    clause = clause.replace(SMALL, ' ').replace(MAX, ' ')
    const before = out.changes.length
    // Jokes first: clean, then cheeky, then crude (which the tools refuse unless the household's admin set it).
    if (/\b(keep (?:it|the jokes|them|jokes) clean|clean jokes|no (?:rude|crude|dirty|cheeky) jokes|nothing rude|not (?:rude|crude|cheeky)|less cheeky|family[- ]friendly|polite|clean)\b/.test(clause)) {
      add({ key: 'humour', to: 0, word: 'clean jokes' })
      clause = clause.replace(/\b(jokes?|clean|cheeky|rude|crude)\b/g, ' ')
    } else if (/\bcheek\w*\b/.test(clause)) {
      add({ key: 'humour', to: 0.5, word: 'cheeky jokes' })
      clause = clause.replace(/\b(jokes?|cheek\w*)\b/g, ' ')
    } else if (/\b(crude|rude|ruder|filthy|dirty|raunchy|risqu\w*|bawdy|naughty)\b/.test(clause)) {
      add({ key: 'humour', to: 1, word: 'crude jokes' })
      clause = clause.replace(/\b(jokes?|crude|rude|ruder|filthy|dirty|raunchy|risqu\w*|bawdy|naughty)\b/g, ' ')
    }
    // The felt: a named colour, or warmer and cooler when the colour is named.
    const named = HUES.find(([re]) => re.test(clause))
    const coloured = COLOUR.test(clause)
    if (named || (coloured && /\b(warmer|cooler|original|as made)\b/.test(clause))) {
      const target = named ? named[1] : /\bwarmer\b/.test(clause) ? 25 : /\bcooler\b/.test(clause) ? 215 : null
      let to = 0.5
      if (target !== null && hueOf(0.5) !== null) {
        // As near the colour as the rail goes; a smaller step for "a bit".
        let best = values.hue, gap = Infinity
        for (let v = 0; v <= 1.0001; v += 0.025) {
          const h = hueOf(v)!
          if (near(h, target) < gap) { gap = near(h, target); best = v }
        }
        to = amount === 'max' || named ? best : clamp(values.hue + Math.sign(best - values.hue) * amount)
        if (amount !== 'max' && named && typeof amount === 'number' && amount < 0.2) to = values.hue + (best - values.hue) * 0.5
      }
      add({ key: 'hue', to: clamp(to), word: target === null ? 'colour as made' : named ? named[2] : target === 25 ? 'warmer colour' : 'cooler colour' })
      clause = clause.replace(/\b(warmer|cooler|original|colou?rs?|felt|fur|shade|tone|hue|coat)\b/g, ' ')
      if (named) clause = clause.replace(named[0], ' ')
    }
    for (const rule of RULES) {
      const up = rule.up.exec(clause), down = rule.down.exec(clause)
      const m = up && down ? (up.index <= down.index ? up : down) : up ?? down
      if (!m) continue
      let dir = m === up ? 1 : -1
      if (NEG.test(clause.slice(0, m.index))) dir = -dir
      const now = values[rule.key]
      const to = amount === 'max' ? (dir > 0 ? 1 : 0) : clamp(now + dir * amount)
      // Their own word when it is already a comparative ("taller", "deeper"), else the rule's.
      const own = m === (dir > 0 ? up : down) && /^[a-z]+er$/.test(m[0]) && !rule.words[dir > 0 ? 1 : 0].includes(' ') ? m[0] : rule.words[dir > 0 ? 1 : 0]
      const word = (typeof amount === 'number' && amount < 0.2 ? 'a bit ' : '') + own
      add({ key: rule.key, to, word })
      clause = clause.replace(m[0], ' ')
    }
    if (out.changes.length === before) out.unread.push(raw.trim())
  }
  return out
}

/** A #rrggbb colour's hue in degrees. */
export function hueOfHex(hex: string): number {
  const n = parseInt(hex.slice(1), 16)
  const r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min
  if (!d) return 0
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4
  return (h * 60 + 360) % 360
}
