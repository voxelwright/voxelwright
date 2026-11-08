/**
 * The one rule for which features a page has (#72). Talk, villagers, the dollhouse view, babble,
 * music and build mode are on by default. Opt-outs: ?talk=off returns the quiet seated kitchen
 * (no villagers, music or babble, and build mode only with ?build=1), ?build=0 turns
 * build mode off, ?cam=seat keeps the seated view. ?talk=npc and ?build=1 still work as before.
 * ?talk=notebook (or any other value) is the separate notebook prototype: talk is off for it.
 */
const query = new URLSearchParams(location.search)
const talk = query.get('talk')
const build = query.get('build')

/** Villagers, talk, the held notepad and journal, babble, music, furnishing and the iso view. */
export const TALK = talk === null || talk === 'npc'
/**
 * Build mode: on by default, off with ?build=0, and ?build=1 turns it on with any talk setting.
 * An explicit ?talk= (npc or notebook) keeps its old meaning, so build mode stays off there unless ?build=1.
 */
export const BUILD = build === '1' || (build === null && talk === null)
/**
 * The physics world (#74): off unless ?physics is given, so the default page and the perf gate
 * load no solver. ?physics=panel also shows the world-rules panel in dev builds.
 */
export const PHYSICS = query.has('physics')
export const PHYSICS_PANEL = import.meta.env.DEV && query.get('physics') === 'panel'
