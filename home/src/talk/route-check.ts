// Which path a line written to your own villager takes (#42). A cheap, trusted
// check on the page, before any model: a line that may change the room, talk to
// someone else or open the journal goes to the router; anything else is plain
// chat, one call to the villager. It is generous on purpose: a false positive
// costs one router call (about 2 s), a false negative breaks furnishing.

const ROOM_VERBS = /\b(add|put|place|plac|replace|swap|move|remove|take away|get rid of|hang|paint|build|make|bring|install|mount|set up|decorate|redecorate|furnish|wallpaper|change|fill|stick|pin|stand|lay|drop|turn .* into)\b/
const WANTS = /\b(get|want|wanna|need|like|have|fancy|how about|what about|could use|give)\b[^.?!]{0,24}\b(a|an|some|another|more|new|two|three|couple)\b/
const ROOM_WORDS = /\b(on|by|near|above|below|under|beside|next to|in|from|onto|against|over) (the|a|our|my|that|this) (table|wall|window|windowsill|sill|counter|worktop|corner|ceiling|floor|sofa|couch|shelf|room|kitchen|living ?room|lounge|door|fridge|lamp)\b/
const THINGS = /\b(furniture|decor|chair|table|sofa|couch|rug|lamp|lantern|plant|picture|painting|poster|shelf|tv|television|clock|mirror|cabinet|wallpaper|curtains?|vase|pinball|machine|cow|toy)s?\b/
const JOURNAL = /\b(journal|notebook|tasks|to-?do|conversations?|what (did|has) \w+ (say|said|tell|told))\b/
const ANOTHER = /\b(another|one more|like that|like this|again)\b/
/** Asking for the whole home's look (#50 themes): style, mood, season, "go back to normal". */
const LOOK = /\b(theme|style|look of|mood|cozier|cosier|redecorate|go back to normal|back to (the )?normal)\b/

export interface Line { text: string; /** Names of other villagers in the room. */ others: string[] }

/** True when the line may change the room, talk to another villager or open the journal. */
export function mayRoute({ text, others }: Line): boolean {
  const t = text.toLowerCase()
  if (others.some((name) => new RegExp(`\\b${name.toLowerCase()}\\b`).test(t))) return true
  if (JOURNAL.test(t) || ROOM_WORDS.test(t) || LOOK.test(t)) return true
  if (ROOM_VERBS.test(t) && (THINGS.test(t) || /\b(a|an|the|some|another|it|that|this|them)\b/.test(t))) return true
  if (WANTS.test(t) && THINGS.test(t)) return true
  return /\b(another one|one more|one like (that|this)|copy (it|that|this))\b/.test(t) || (ANOTHER.test(t) && THINGS.test(t))
}
