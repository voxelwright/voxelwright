// Engine plugins (#264, the WORKSHOP lane): something new a rule can hear or do, as a folder that a running game
// picks up. A rule is text from anyone and runs in a box; a plugin is the engine's own code, from this checkout's
// `plugins/` folder and from nowhere else: no request carries one, and no model's or person's text becomes one.
//
//   plugins/<name>/world.mjs   what the world's process needs: one file, `export default (world) => ({does, ...})`
//   plugins/<name>/page.ts     what a page needs, if anything: `export default (page) => ({state, once, close})`
//   plugins/<name>/guide.txt   its lines of the guide (the RULES part): what a model writes rules from
//   plugins/<name>/check.mjs   its check: `node plugins/<name>/check.mjs`, run by `node test/all.mjs --only plugins`
//
// The world's side (`world.mjs`). The function is given the world's doors and answers with any of:
//   does      {name: (rule, want, now, wrong) => {}}   what a rule may ask for: `world.<name>({fields})` in a rule
//             comes here as `want`. Check every field as if it came from a stranger: it did.
//   dropped   (ruleId) => {}   a rule was taken out: forget what was its
//   state     () => any        what to hand the next version of this plugin when it is picked up again (`world.was`)
//   close     () => {}         it is being replaced or taken away: stop timers
//   recored   () => {}         the core was swapped for another build (serve.mjs `coreLook`): set again what was set in it
// The doors (`world`): builds (rules/built.mjs), core() (the core's exports, as they are now: ask each time, never keep it), folk (everyone with a body, by name), living(id) (a living thing's current position, or null), text (cleans what someone wrote), tell (says where a
// body is to pages), release (lets a taken resident go), look and stand (the world's cells), tall, happen(event, e)
// (every rule that listens hears it), hear(ruleId, event, e) (one rule hears it), pages.state(any) (this plugin's
// page side on every page is given it, late joiners too: latest wins) and pages.once(any) (given to pages there now,
// kept for nobody), and was (what the last version handed on).
//
// Picked up while the game runs: the server reads the folder again when told (`POST /plugins/look`, which carries
// nothing), each world's process imports what changed (by the hash of its text, so the module is new to Node) and
// swaps its entries in, and each page imports the page side when the world's stream says so. A plugin that does
// not load leaves the version that was there in place, and says why (`GET /plugins`).
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const NAME = /^[a-z0-9][a-z0-9-]{0,23}$/, DOES = /^[a-z][a-zA-Z0-9]{0,23}$/
/** The most plugins a server looks at, and the most guide text one may add (characters). */
const PLUGINS_MOST = 64, GUIDE_MOST = 4000
const hash = (text) => createHash('sha256').update(text).digest('hex').slice(0, 12)

/** For the server: the plugins in a folder as they are on disk now: [{name, world, page, guide}], world and page the hash of each side's text ('' if it has none). */
export function found(dir) {
  const out = []
  if (!existsSync(dir)) return out
  for (const name of readdirSync(dir).sort()) {
    if (!NAME.test(name) || out.length >= PLUGINS_MOST || !statSync(join(dir, name)).isDirectory()) continue
    const read = (file) => { try { return readFileSync(join(dir, name, file), 'utf8') } catch { return null } }
    const world = read('world.mjs'), page = read('page.ts'), guide = (read('guide.txt') ?? '').replace(/\s+$/, '')
    if (world === null && page === null) continue
    const p = { name, world: world === null ? '' : hash(world), page: page === null ? '' : hash(page), guide: guide.slice(0, GUIDE_MOST), error: '' }
    // One file a side: a helper beside it would not be new to Node when the plugin is picked up again.
    if (world !== null && /(from|import)\s*\(?\s*['"]\.\//.test(world)) p.error = 'world.mjs imports a file from its own folder: a plugin\'s world side is one file (it may import from the engine: ../../)'
    // The guide's reader (make/rules.mjs) drops lines that begin POST or GET, and ends RULES at a line of capitals.
    else if (guide && guide.split('\n').some((l) => /^\s*(POST|GET) /.test(l) || /^[A-Z][A-Z ]*[A-Z]$/.test(l) || !l.trim())) p.error = 'guide.txt has a blank line, a heading in capitals or a line that begins POST or GET: a model writing rules would not be shown it'
    out.push(p)
  }
  return out
}

/**
 * For a world's process: what loads plugins into it and swaps them while it runs.
 * @param does   the table of what a rule may ask for (world.mjs): plugins add to it, and may not take a name that is there
 * @param dir    the plugins folder
 * @param doors  what a plugin is given of the world (above), but for `pages` and `was`
 * @param post   says something to the server
 */
export function plugger({ does, dir, doors, post }) {
  /** By name: the version, how it was made, what it answered with, and the names it added to `does`. */
  const loaded = new Map()
  const builtin = new Set(does.keys())
  const make = (name, factory, was) => {
    const api = factory({ ...doors, was, pages: { state: (state) => post({ page: { plugin: name, state } }), once: (once) => post({ page: { plugin: name, once } }) } }) ?? {}
    const names = Object.keys(api.does ?? {})
    for (const n of names) {
      if (!DOES.test(n) || typeof api.does[n] !== 'function') throw new Error(`"${String(n).slice(0, 24)}" is not a name and a function: does is {name: (rule, want, now, wrong) => {}}`)
      if (builtin.has(n) || [...loaded].some(([other, l]) => other !== name && l.names.includes(n))) throw new Error(`"${n}" is already something a rule can do here`)
    }
    return { api, names }
  }
  const put = (name, v, factory, made) => { for (const n of made.names) does.set(n, made.api.does[n]); loaded.set(name, { v, factory, ...made }) }
  const take = (name) => { const old = loaded.get(name); if (!old) return undefined; let was; try { was = old.api.state?.(); old.api.close?.() } catch { /* its own trouble */ } for (const n of old.names) does.delete(n); loaded.delete(name); return was }
  return {
    /** The plugins as they should now be: [{name, v}]. What changed is imported and swapped in, what is gone is taken out. Answers how each went: [{name, v, does, ms, error}]. */
    async load(list) {
      const out = []
      for (const name of [...loaded.keys()]) if (!list.some((p) => p.name === name)) { take(name); post({ page: { plugin: name, gone: true } }) }
      for (const { name, v } of list) {
        const old = loaded.get(name), began = performance.now()
        if (old?.v === v) { out.push({ name, v, does: old.names, ms: 0, error: '' }); continue }
        let error = ''
        try {
          const factory = (await import(`${pathToFileURL(join(dir, name, 'world.mjs')).href}?v=${v}`)).default
          if (typeof factory !== 'function') throw new Error('world.mjs has no default export that is a function')
          // The old one hands on what it has and makes way; if the new one cannot be made, the old one is made again.
          const was = take(name)
          try { put(name, v, factory, make(name, factory, was)) } catch (e) { if (old) put(name, old.v, old.factory, make(name, old.factory, was)); throw e }
        } catch (e) { error = String(e?.message ?? e).slice(0, 300) }
        const now = loaded.get(name)
        out.push({ name, v: now?.v ?? '', does: now?.names ?? [], ms: Number((performance.now() - began).toFixed(1)), error })
      }
      return out
    },
    /** The core was swapped for another build: each plugin that set something in the old one sets it in the new. */
    recored() { for (const l of loaded.values()) try { l.api.recored?.() } catch { /* its own trouble */ } },
    /** A rule was taken out: each plugin forgets what was its. */
    dropped(ruleId) { for (const l of loaded.values()) try { l.api.dropped?.(ruleId) } catch { /* its own trouble */ } },
  }
}
