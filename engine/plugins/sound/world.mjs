// What a realm sounds like (#264, the sound lane #247), as an engine plugin. A rule makes a sound at a place, on
// one of its actors or on a person (`world.sound`), and everyone near hears it as the world's own sounds are
// heard: placed, later by its distance, duller far off. The sound is a word from a small kept set (page/sound/
// likes.ts) or a patch the rule wrote itself, which is data in the synthesiser's own form (page/sound/patch.ts)
// and is read here by the same check a page reads it by. Nothing here makes a sample, and nothing knows what a
// sound is for: a bell at the end of a round and a bell on a bicycle are the same bell.
//
// Every field is a stranger's. What is wrong is said to the rule and left; what is right is cut to what a page can
// be sent: so many a second from one rule, so many notes, held so long. A sound is told to the pages there now
// (`pages.once`): it is heard when it is made or not at all.
//
// A sound that follows (`as`): a rule names a sound and puts it on someone or on a living thing, and it stays on
// them, heard moving as they move, until the rule stops it or they or the rule go. It is said once, not each tick;
// said again by the same name it changes in the sound that is playing. Those are what is so, not what happens
// (`pages.state`): a page that comes later hears them too. The world keeps who each is on; each page places it by
// where it shows them.
import { LIKES } from '../../page/sound/likes.ts'
import { patch, toned } from '../../page/sound/patch.ts'

/** The most sounds a rule may make a second, the most notes in one, how long one may be held (s), and the most a patch of a rule's own may be as JSON. */
export const SOUNDS_A_SECOND = 12, NOTES_MOST = 8, HELD_MOST = 4, PATCH_MOST = 1200
/** How far a sound may carry: the metres at which it is half as loud as close to. */
const REACH = [2, 300]
/** The most sounds of one rule that follow someone at a time, and of a whole realm; how often one that is struck may be made again (ms). */
export const FOLLOW_MOST = 6, FOLLOW_ALL = 24, EVERY = [80, 2000]
const FIELDS = ['do', 'id', 'like', 'patch', 'at', 'on', 'force', 'size', 'note', 'notes', 'pitch', 'gap', 'for', 'reach', 'as', 'stop', 'every']
const num = (v, lo, hi) => typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi

export default ({ folk, living, tall, stand, pages, was }) => {
  /** By rule: when its second began and how many it has made in it. */
  const made = new Map()
  const hz = (note) => 440 * 2 ** ((note - 69) / 12)
  /** What it is: a word of the kept set, or a patch of the rule's own. False if it is neither (the rule has been told). */
  const what = (w, out, wrong) => {
    if (w.patch !== undefined) {
      if (w.like !== undefined) { wrong('a sound is like something kept or has a patch of its own: one of the two'); return false }
      let size = Infinity
      try { size = JSON.stringify(w.patch).length } catch { /* not data */ }
      if (!(size <= PATCH_MOST)) { wrong(`a patch is at most ${PATCH_MOST} characters as JSON`); return false }
      const read = patch(w.patch)
      if ('refused' in read) { wrong(`the patch was refused: ${read.refused}`); return false }
      out.patch = read.patch; delete out.like; out.reach = 10
    } else if (typeof w.like === 'string' && Object.hasOwn(LIKES, w.like)) { out.like = w.like; delete out.patch; out.reach = LIKES[w.like].reach }
    else { wrong(`a sound is like one of ${Object.keys(LIKES).join(', ')}, or has a patch of its own`); return false }
    return true
  }
  /** Who a sound is on: the rule's own actor by its name, anyone else as world.people names them. */
  const body = (rule, on) => (typeof on === 'string' && on.length <= 64 ? folk.get(`${rule.id}/${on}`) ?? folk.get(on) : undefined)
  /** How hard, how big, how far: each left as it was if it is wrong, and the rule told. */
  const shape = (w, out, wrong) => {
    if (w.force !== undefined) { if (num(w.force, 0, 1)) out.force = Math.max(0.02, w.force); else wrong('force is 0 to 1') }
    if (w.size !== undefined) { if (num(w.size, 0.25, 4)) out.size = w.size; else wrong('size is 0.25 to 4 (1 is its own size; bigger is lower and rings longer)') }
    if (w.reach !== undefined) { if (num(w.reach, REACH[0], REACH[1])) out.reach = w.reach; else wrong(`reach is ${REACH[0]} to ${REACH[1]} metres`) }
  }
  /** So many a second from one rule: the rest are left, and the rule is told once a second that they were. */
  const spare = (rule, now, wrong) => {
    let m = made.get(rule.id)
    if (!m || now - m.since >= 1000) made.set(rule.id, m = { since: now, n: 0 })
    if (++m.n > SOUNDS_A_SECOND) { if (m.n === SOUNDS_A_SECOND + 1) wrong(`a rule may make ${SOUNDS_A_SECOND} sounds a second: the rest were left`); return false }
    return true
  }

  /** The sounds that follow someone, by rule and name: {rule, key, on, like | patch, hz, force, size, reach, every}. A version before this one hands them on. */
  const follows = new Map(Array.isArray(was) ? was.filter((f) => f && typeof f.key === 'string' && typeof f.rule === 'string' && typeof f.on === 'string').map((f) => [f.key, f]) : [])
  const tell = () => pages.state({ follows: [...follows.values()].map(({ rule: _rule, ...f }) => f) })
  const there = (on) => folk.has(on) || !!living?.(on)
  if (follows.size) tell()
  // Whoever a sound is on has gone: it goes with them. Nothing tells a plugin of that, so it looks twice a second.
  const looking = setInterval(() => { let gone = false; for (const [key, f] of follows) if (!there(f.on)) { follows.delete(key); gone = true } if (gone) tell() }, 500)
  /**
   * `world.sound({as, on, like | patch, note | pitch, force, size, reach, every})`: a sound that stays on someone.
   * `world.sound({as, stop: true})` ends it. What pages are told is every one there is: {follows: [{key, on, ...}]}.
   */
  const follow = (rule, w, now, wrong) => {
    if (typeof w.as !== 'string' || !/^[A-Za-z0-9_-]{1,24}$/.test(w.as)) return wrong('as is a name of your own for a sound that follows: 1 to 24 letters, digits, - or _')
    const key = `${rule.id}/${w.as}`, had = follows.get(key)
    if (w.stop !== undefined) { if (w.stop !== true) return wrong('stop is true'); if (follows.delete(key)) tell(); return }
    const not = ['at', 'notes', 'gap', 'for'].find((k) => w[k] !== undefined)
    if (not) return wrong(`a sound that follows (as) has no "${not}": it is on someone, has one pitch, and lasts until it is stopped`)
    const next = had ? { ...had } : { rule: rule.id, key, on: '', hz: 0, force: 0.7, size: 1, reach: 10, every: 0 }
    // Said again as the same thing, it keeps the reach it had.
    if (w.like !== undefined || w.patch !== undefined) { const reach = next.reach, same = JSON.stringify([next.like, next.patch]); if (!what(w, next, wrong)) return; if (had && same === JSON.stringify([next.like, next.patch])) next.reach = reach }
    else if (!had) return wrong(`a sound is like one of ${Object.keys(LIKES).join(', ')}, or has a patch of its own`)
    if (w.on !== undefined) {
      const p = body(rule, w.on)
      if (p) next.on = p.by
      else if (typeof w.on === 'string' && w.on.length <= 64 && living?.(w.on)) next.on = w.on
      else return wrong(`nobody and no living thing called "${String(w.on).slice(0, 24)}" is there to sound on`)
    } else if (!had) return wrong('a sound that follows is on someone: on, an actor of this rule, an id of world.people, or the id of a thing that lives')
    shape(w, next, wrong)
    if (w.note !== undefined) { if (num(w.note, 12, 120)) next.hz = hz(w.note); else wrong('note is 12 to 120 (60 is middle C)') }
    else if (w.pitch !== undefined) { if (num(w.pitch, 20, 8000)) next.hz = w.pitch; else wrong('pitch is 20 to 8000 Hz') }
    if (w.every !== undefined) { if (w.every === null) next.every = 0; else if (num(w.every, EVERY[0], EVERY[1])) next.every = Math.round(w.every); else wrong(`every is ${EVERY[0]} to ${EVERY[1]} ms between one and the next`) }
    // One long tone is held (what is blown, or a string or pipe that is rubbed); anything else follows by being made again.
    const held = next.like ? !!LIKES[next.like].held : toned(next.patch)
    if (!held && !next.every) return wrong(`only one long tone follows as it is (pipe, horn, whistle, engine, or a patch that is blown, or a string, tube, pipe or hollow that is rubbed): this one follows by being made again, so say every, ${EVERY[0]} to ${EVERY[1]} ms`)
    if (held) next.every = 0
    // Said only when it has changed: a rule may say what its sound is on every tick.
    if (had && JSON.stringify(had) === JSON.stringify(next)) return
    if (!had && [...follows.values()].filter((f) => f.rule === rule.id).length >= FOLLOW_MOST) return wrong(`a rule has at most ${FOLLOW_MOST} sounds that follow at a time: stop one first`)
    if (!had && follows.size >= FOLLOW_ALL) return wrong(`a realm has at most ${FOLLOW_ALL} sounds that follow at a time`)
    if (!spare(rule, now, wrong)) return
    follows.set(key, next)
    tell()
  }

  /**
   * `world.sound({like | patch, at | on, force, size, note | notes | pitch, gap, for, reach})`: makes a sound.
   * What is told to pages: {at: [x, y, z], like | patch, force, size, hz: [...], gap (ms), for (s), reach (m)}.
   */
  const sound = (rule, w, now, wrong) => {
    const odd = Object.keys(w).find((k) => !FIELDS.includes(k))
    if (odd) return wrong(`a sound has no "${String(odd).slice(0, 24)}": ${FIELDS.slice(2).join(', ')}`)
    if (w.as !== undefined) return follow(rule, w, now, wrong)
    if (w.stop !== undefined || w.every !== undefined) return wrong('stop and every are for a sound that follows: give it a name with as')
    const out = { force: 0.7, size: 1, hz: [], gap: 0, for: 0, reach: 10 }
    if (!what(w, out, wrong)) return
    // Where: on someone, or at a place.
    if (w.on !== undefined) {
      const p = body(rule, w.on)
      if (!p) return wrong(`nobody called "${String(w.on).slice(0, 24)}" is there to sound on`)
      out.at = [Math.round(p.at[0]), Math.round(p.at[1] + tall * 0.7), Math.round(p.at[2])]
    } else if (Array.isArray(w.at) && (w.at.length === 2 || w.at.length === 3) && w.at.every((v) => num(v, -(2 ** 30), 2 ** 30))) {
      const x = Math.round(w.at[0]), z = Math.round(w.at[w.at.length - 1])
      out.at = [x, w.at.length === 3 ? Math.round(w.at[1]) : (stand(x, z) ?? 0) + Math.round(tall * 0.7), z]
    } else return wrong('a sound is at a place, at: [x, z] or [x, y, z], or on someone, on: an actor of this rule or an id of world.people')
    shape(w, out, wrong)
    // Its pitch: its own, or a note, or several notes one after another.
    if (w.notes !== undefined) {
      if (Array.isArray(w.notes) && w.notes.length >= 1 && w.notes.length <= NOTES_MOST && w.notes.every((n) => num(n, 12, 120))) out.hz = w.notes.map(hz)
      else wrong(`notes is 1 to ${NOTES_MOST} notes, each 12 to 120 (60 is middle C)`)
    } else if (w.note !== undefined) { if (num(w.note, 12, 120)) out.hz = [hz(w.note)]; else wrong('note is 12 to 120 (60 is middle C)') }
    else if (w.pitch !== undefined) { if (num(w.pitch, 20, 8000)) out.hz = [w.pitch]; else wrong('pitch is 20 to 8000 Hz') }
    if (w.gap !== undefined) { if (num(w.gap, 0, 1000)) out.gap = w.gap; else wrong('gap is 0 to 1000 ms between notes') }
    if (w.for !== undefined) { if (num(w.for, 0.05, HELD_MOST)) out.for = w.for; else wrong(`for is 0.05 to ${HELD_MOST} seconds`) }
    if (!spare(rule, now, wrong)) return
    pages.once(out)
  }
  return {
    does: { sound },
    dropped: (id) => { made.delete(id); let gone = false; for (const [key, f] of follows) if (f.rule === id) { follows.delete(key); gone = true } if (gone) tell() },
    state: () => [...follows.values()],
    close: () => clearInterval(looking),
  }
}
