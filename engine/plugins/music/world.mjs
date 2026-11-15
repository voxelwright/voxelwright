// A realm's music (#264, the sound lane #247; asked for by "calm to hunted, the last lap, the final round").
// `world.music({like, pace, mode, drive, now})`: a rule says what the realm's music is like, for everyone in it,
// and changes it as its own numbers change. It is a mood as data, not a track: the page's own music (page/sound/
// music) takes it in place of the place's and composes it as it plays. A realm whose rules say nothing of music
// keeps the place's.
//
// One realm has one music: the rule that changed it last has it, and when that rule is taken out the place's own
// comes back. Every field is a stranger's: what is wrong is left and said to the rule.
//
// A lean (`world.music({lean, for})`): any rule may push the music's tension up or down for a while without having
// the music. It lies on top of whatever the music is (the realm's rule's, or the place's own) and falls away by
// itself. Each rule has one; the leans of several rules are added, so two that agree push further and two that
// pull apart cancel, and none takes another's away.
import { MODES, MOODS, PACE } from '../../page/sound/music/compose.ts'

const FIELDS = ['do', 'id', 'like', 'pace', 'mode', 'drive', 'now', 'lean', 'for']
/** How long a lean lasts, seconds: the least, the most, and when it is not said. */
export const LEAN_FOR = [1, 120, 20]
const num = (v, lo, hi) => typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi

export default ({ pages, was }) => {
  /** What the realm's music is, if a rule has said: {rule, like, pace, mode, drive, now}. A version before this one hands it on. */
  const old = was && typeof was === 'object' ? (was.tune !== undefined || was.leans !== undefined ? was : { tune: was }) : {}
  let tune = old.tune && typeof old.tune.like === 'string' && Object.hasOwn(MOODS, old.tune.like) ? old.tune : null
  /** The leans there are, by rule: {lean, until (ms), timer}. */
  const leans = new Map()
  const lean = () => { let sum = 0; for (const l of leans.values()) sum += l.lean; return Math.round(Math.max(-1, Math.min(1, sum)) * 20) / 20 }
  let told = 0
  const tell = () => { told = lean(); pages.state(tune || told ? { like: tune ? tune.like : null, pace: tune ? tune.pace : 0, mode: tune ? tune.mode : '', drive: tune ? tune.drive : null, now: tune ? tune.now : false, lean: told } : null) }
  const unlean = (ruleId) => { const l = leans.get(ruleId); if (!l) return; clearTimeout(l.timer); leans.delete(ruleId); if (lean() !== told) tell() }
  const leaning = (ruleId, amount, until) => {
    const had = leans.get(ruleId)
    if (had) clearTimeout(had.timer)
    leans.set(ruleId, { lean: amount, until, timer: setTimeout(() => unlean(ruleId), Math.max(0, until - Date.now())) })
    if (lean() !== told) tell()
  }
  if (Array.isArray(old.leans)) for (const l of old.leans) if (l && typeof l.rule === 'string' && num(l.lean, -1, 1) && num(l.until, Date.now(), Date.now() + LEAN_FOR[1] * 1000)) leaning(l.rule, l.lean, l.until)
  if (tune || leans.size) tell()
  return {
    does: {
      music(rule, w, _now, wrong) {
        const odd = Object.keys(w).find((k) => !FIELDS.includes(k))
        if (odd) return wrong(`music has no "${String(odd).slice(0, 24)}": ${FIELDS.slice(2).join(', ')}`)
        // A lean is said by itself: it is not the music, and the rule that says it does not take the music.
        if (w.lean !== undefined || w.for !== undefined) {
          const more = ['like', 'pace', 'mode', 'drive', 'now'].find((k) => w[k] !== undefined)
          if (more) return wrong(`a lean is said by itself, world.music({lean, for}): "${more}" is for the rule whose music it is`)
          if (w.lean === null || w.lean === 0) return unlean(rule.id)
          if (!num(w.lean, -1, 1)) return wrong('lean is -1 to 1: above 0 pushes the music up (more of it in, a little faster), below 0 lets it down; 0 or null takes this rule\'s lean away')
          let secs = LEAN_FOR[2]
          if (w.for !== undefined) { if (num(w.for, LEAN_FOR[0], LEAN_FOR[1])) secs = w.for; else wrong(`for is ${LEAN_FOR[0]} to ${LEAN_FOR[1]} seconds (${LEAN_FOR[2]} unless said)`) }
          return leaning(rule.id, Math.round(w.lean * 20) / 20, Date.now() + secs * 1000)
        }
        if (w.like === null) { if (tune) { tune = null; tell() } return }
        const next = tune ? { ...tune, rule: rule.id, now: false } : { rule: rule.id, like: '', pace: 0, mode: '', drive: null, now: false }
        if (w.like !== undefined) { if (typeof w.like === 'string' && Object.hasOwn(MOODS, w.like)) next.like = w.like; else wrong(`music is like one of ${Object.keys(MOODS).join(', ')}, or null for the place's own`) }
        if (!next.like) return wrong(`music needs what it is like first: like, one of ${Object.keys(MOODS).join(', ')}`)
        if (w.pace !== undefined) { if (w.pace === null) next.pace = 0; else if (num(w.pace, PACE[0], PACE[1])) next.pace = Math.round(w.pace); else wrong(`pace is ${PACE[0]} to ${PACE[1]} beats a minute, or null for the mood's own`) }
        if (w.mode !== undefined) { if (w.mode === null) next.mode = ''; else if (typeof w.mode === 'string' && Object.hasOwn(MODES, w.mode)) next.mode = w.mode; else wrong(`mode is one of ${Object.keys(MODES).join(', ')}, or null for the mood's own`) }
        if (w.drive !== undefined) { if (w.drive === null) next.drive = null; else if (num(w.drive, 0, 1)) next.drive = Math.round(w.drive * 20) / 20; else wrong('drive is 0 to 1, or null to let the music build by itself') }
        if (w.now !== undefined) next.now = w.now === true
        // Said only when it has changed: a rule may say what the music is on every tick. One that changes nothing (all
        // it said was refused, or it said what is already so) does not make the music its own.
        if (tune && tune.like === next.like && tune.pace === next.pace && tune.mode === next.mode && tune.drive === next.drive) return
        tune = next
        tell()
      },
    },
    dropped: (ruleId) => { unlean(ruleId); if (tune?.rule === ruleId) { tune = null; tell() } },
    state: () => ({ tune, leans: [...leans].map(([rule, l]) => ({ rule, lean: l.lean, until: l.until })) }),
    close: () => { for (const l of leans.values()) clearTimeout(l.timer) },
  }
}
