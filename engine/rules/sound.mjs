// What a realm sounds like (#264, the sound lane #247): for the world's process. A rule makes a sound at a place,
// on one of its actors or on a person (`world.sound`), and everyone near hears it as the world's own sounds are
// heard: placed, later by its distance, duller far off. The sound is a word from a small kept set (page/sound/
// likes.ts) or a patch the rule wrote itself, which is data in the synthesiser's own form (page/sound/patch.ts)
// and is read here by the same check a page reads it by. Nothing here makes a sample, and nothing knows what a
// sound is for: a bell at the end of a round and a bell on a bicycle are the same bell.
//
// And what the realm's music is like (`world.music`): a mood as data, which the page's own music takes in place of
// the place's and composes as it plays (page/sound/music). A rule changes it as its own numbers change.
//
// Every field is a stranger's. What is wrong is said to the rule and left; what is right is cut to what a page can
// be sent: so many a second from one rule, so many notes, held so long.
import { LIKES } from '../page/sound/likes.ts'
import { patch } from '../page/sound/patch.ts'
import { MODES, MOODS, PACE } from '../page/sound/music/compose.ts'

/** The most sounds a rule may make a second, the most notes in one, how long one may be held (s), and the most a patch of a rule's own may be as JSON. */
export const SOUNDS_A_SECOND = 12, NOTES_MOST = 8, HELD_MOST = 4, PATCH_MOST = 1200
/** How far a sound may carry: the metres at which it is half as loud as close to. */
const REACH = [2, 300]
const MUSIC = ['do', 'id', 'like', 'pace', 'mode', 'drive', 'now']
const FIELDS = ['do', 'id', 'like', 'patch', 'at', 'on', 'force', 'size', 'note', 'notes', 'pitch', 'gap', 'for', 'reach']
const num = (v, lo, hi) => typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi

/**
 * @param folk    everyone with a body, by the name the world knows them by: {at (feet), rule?}
 * @param tall    how tall a body is, cells
 * @param stand   where feet stand at a column, or null: (x, z) => y
 * @param tell    says something to the server (a sound, for whoever is reading now)
 */
export function sounding({ folk, tall, stand, tell }) {
  /** By rule: when its second began and how many it has made in it. */
  const made = new Map()
  /**
   * `world.sound({like | patch, at | on, force, size, note | notes | pitch, gap, for, reach})`: makes a sound.
   * What is told to pages: {at: [x, y, z], like | patch, force, size, hz: [...], gap (ms), for (s), reach (m)}.
   */
  const sound = (rule, w, now, wrong) => {
    const odd = Object.keys(w).find((k) => !FIELDS.includes(k))
    if (odd) return wrong(`a sound has no "${String(odd).slice(0, 24)}": ${FIELDS.slice(2).join(', ')}`)
    const out = { force: 0.7, size: 1, hz: [], gap: 0, for: 0, reach: 10 }
    // What it is: a word of the kept set, or a patch of the rule's own.
    if (w.patch !== undefined) {
      if (w.like !== undefined) return wrong('a sound is like something kept or has a patch of its own: one of the two')
      let size = Infinity
      try { size = JSON.stringify(w.patch).length } catch { /* not data */ }
      if (!(size <= PATCH_MOST)) return wrong(`a patch is at most ${PATCH_MOST} characters as JSON`)
      const read = patch(w.patch)
      if ('refused' in read) return wrong(`the patch was refused: ${read.refused}`)
      out.patch = read.patch
    } else if (typeof w.like === 'string' && Object.hasOwn(LIKES, w.like)) { out.like = w.like; out.reach = LIKES[w.like].reach }
    else return wrong(`a sound is like one of ${Object.keys(LIKES).join(', ')}, or has a patch of its own`)
    // Where: on someone (the rule's own actor by its name, anyone else as world.people names them), or at a place.
    if (w.on !== undefined) {
      const p = typeof w.on === 'string' && w.on.length <= 64 ? folk.get(`${rule.id}/${w.on}`) ?? folk.get(w.on) : undefined
      if (!p) return wrong(`nobody called "${String(w.on).slice(0, 24)}" is there to sound on`)
      out.at = [Math.round(p.at[0]), Math.round(p.at[1] + tall * 0.7), Math.round(p.at[2])]
    } else if (Array.isArray(w.at) && (w.at.length === 2 || w.at.length === 3) && w.at.every((v) => num(v, -(2 ** 30), 2 ** 30))) {
      const x = Math.round(w.at[0]), z = Math.round(w.at[w.at.length - 1])
      out.at = [x, w.at.length === 3 ? Math.round(w.at[1]) : (stand(x, z) ?? 0) + Math.round(tall * 0.7), z]
    } else return wrong('a sound is at a place, at: [x, z] or [x, y, z], or on someone, on: an actor of this rule or an id of world.people')
    if (w.force !== undefined) { if (num(w.force, 0, 1)) out.force = Math.max(0.02, w.force); else wrong('force is 0 to 1') }
    if (w.size !== undefined) { if (num(w.size, 0.25, 4)) out.size = w.size; else wrong('size is 0.25 to 4 (1 is its own size; bigger is lower and rings longer)') }
    if (w.reach !== undefined) { if (num(w.reach, REACH[0], REACH[1])) out.reach = w.reach; else wrong(`reach is ${REACH[0]} to ${REACH[1]} metres`) }
    // Its pitch: its own, or a note, or several notes one after another.
    const hz = (note) => 440 * 2 ** ((note - 69) / 12)
    if (w.notes !== undefined) {
      if (Array.isArray(w.notes) && w.notes.length >= 1 && w.notes.length <= NOTES_MOST && w.notes.every((n) => num(n, 12, 120))) out.hz = w.notes.map(hz)
      else wrong(`notes is 1 to ${NOTES_MOST} notes, each 12 to 120 (60 is middle C)`)
    } else if (w.note !== undefined) { if (num(w.note, 12, 120)) out.hz = [hz(w.note)]; else wrong('note is 12 to 120 (60 is middle C)') }
    else if (w.pitch !== undefined) { if (num(w.pitch, 20, 8000)) out.hz = [w.pitch]; else wrong('pitch is 20 to 8000 Hz') }
    if (w.gap !== undefined) { if (num(w.gap, 0, 1000)) out.gap = w.gap; else wrong('gap is 0 to 1000 ms between notes') }
    if (w.for !== undefined) { if (num(w.for, 0.05, HELD_MOST)) out.for = w.for; else wrong(`for is 0.05 to ${HELD_MOST} seconds`) }
    // So many a second from one rule: the rest are left, and the rule is told once a second that they were.
    let m = made.get(rule.id)
    if (!m || now - m.since >= 1000) made.set(rule.id, m = { since: now, n: 0 })
    if (++m.n > SOUNDS_A_SECOND) { if (m.n === SOUNDS_A_SECOND + 1) wrong(`a rule may make ${SOUNDS_A_SECOND} sounds a second: the rest were left`); return }
    tell({ sound: out })
  }
  /** What the realm's music is, if a rule has said: {rule, like, pace, mode, drive, now}. One realm, one music: who spoke last has it. */
  let tune = null
  const tuned = () => tell({ music: tune ? { like: tune.like, pace: tune.pace, mode: tune.mode, drive: tune.drive, now: tune.now } : null })
  /**
   * `world.music({like, pace, mode, drive, now})`: what the realm's music is like. Only the fields given change;
   * `like: null` gives the music back to the place. It is a mood, not a track: the page composes it as it plays.
   */
  const music = (rule, w, _now, wrong) => {
    const odd = Object.keys(w).find((k) => !MUSIC.includes(k))
    if (odd) return wrong(`music has no "${String(odd).slice(0, 24)}": ${MUSIC.slice(2).join(', ')}`)
    if (w.like === null) { if (tune) { tune = null; tuned() } return }
    const next = tune ? { ...tune, rule: rule.id, now: false } : { rule: rule.id, like: '', pace: 0, mode: '', drive: null, now: false }
    if (w.like !== undefined) { if (typeof w.like === 'string' && Object.hasOwn(MOODS, w.like)) next.like = w.like; else wrong(`music is like one of ${Object.keys(MOODS).join(', ')}, or null for the place's own`) }
    if (!next.like) return wrong(`music needs what it is like first: like, one of ${Object.keys(MOODS).join(', ')}`)
    if (w.pace !== undefined) { if (w.pace === null) next.pace = 0; else if (num(w.pace, PACE[0], PACE[1])) next.pace = Math.round(w.pace); else wrong(`pace is ${PACE[0]} to ${PACE[1]} beats a minute, or null for the mood's own`) }
    if (w.mode !== undefined) { if (w.mode === null) next.mode = ''; else if (typeof w.mode === 'string' && Object.hasOwn(MODES, w.mode)) next.mode = w.mode; else wrong(`mode is one of ${Object.keys(MODES).join(', ')}, or null for the mood's own`) }
    if (w.drive !== undefined) { if (w.drive === null) next.drive = null; else if (num(w.drive, 0, 1)) next.drive = Math.round(w.drive * 20) / 20; else wrong('drive is 0 to 1, or null to let the music build by itself') }
    if (w.now !== undefined) next.now = w.now === true
    // Said only when it has changed: a rule may say what the music is on every tick. One that changes nothing (all it
    // said was refused, or it said what is already so) does not make the music its own.
    if (tune && tune.like === next.like && tune.pace === next.pace && tune.mode === next.mode && tune.drive === next.drive) return
    tune = next
    tuned()
  }
  return { sound, music, dropped: (id) => { made.delete(id); if (tune?.rule === id) { tune = null; tuned() } } }
}
