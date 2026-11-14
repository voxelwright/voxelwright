// A realm's music (#264, the sound lane #247; asked for by "calm to hunted, the last lap, the final round").
// `world.music({like, pace, mode, drive, now})`: a rule says what the realm's music is like, for everyone in it,
// and changes it as its own numbers change. It is a mood as data, not a track: the page's own music (page/sound/
// music) takes it in place of the place's and composes it as it plays. A realm whose rules say nothing of music
// keeps the place's.
//
// One realm has one music: the rule that changed it last has it, and when that rule is taken out the place's own
// comes back. Every field is a stranger's: what is wrong is left and said to the rule.
import { MODES, MOODS, PACE } from '../../page/sound/music/compose.ts'

const FIELDS = ['do', 'id', 'like', 'pace', 'mode', 'drive', 'now']
const num = (v, lo, hi) => typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi

export default ({ pages, was }) => {
  /** What the realm's music is, if a rule has said: {rule, like, pace, mode, drive, now}. A version before this one hands it on. */
  let tune = was && typeof was === 'object' && typeof was.like === 'string' && Object.hasOwn(MOODS, was.like) ? was : null
  const tell = () => pages.state(tune ? { like: tune.like, pace: tune.pace, mode: tune.mode, drive: tune.drive, now: tune.now } : null)
  if (tune) tell()
  return {
    does: {
      music(rule, w, _now, wrong) {
        const odd = Object.keys(w).find((k) => !FIELDS.includes(k))
        if (odd) return wrong(`music has no "${String(odd).slice(0, 24)}": ${FIELDS.slice(2).join(', ')}`)
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
    dropped: (ruleId) => { if (tune?.rule === ruleId) { tune = null; tell() } },
    state: () => tune,
  }
}
