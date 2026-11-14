// The interpreter a rule runs in (#264): QuickJS, as wasm, with nothing bound into it. A rule is text that a person
// or their model wrote, so it is given nothing: no host function, no timers, no files, no network, no way to post
// anything. One string goes in (what happened and who is there) and one string comes out (what the rule wants
// done). What comes out is data: the world checks every field of it (world.mjs `obey`), and nothing in here is
// trusted to have done so.
//
// This runs in a thread of the rule's own (thread.mjs), never in the world's. What holds a rule, in the order a
// hostile one meets them:
//   - Its memory is a WebAssembly memory of its own with a maximum, so the platform refuses to grow it: 32 MB.
//     QuickJS's own setMemoryLimit is NOT what holds it: with that alone a rule that pushed arrays for ever grew
//     the interpreter to 2 GB in three seconds (measured November 13, 2026, quickjs-emscripten 0.32.0); with a
//     memory of its own it is told "out of memory" after 29 ms at 31 MB, and runs on.
//   - How long a call may run, counted in the interpreter's own steps: after about ten milliseconds of ordinary
//     code it is stopped ("interrupted"). Counted in steps and not in time so that a busy machine does not stop a
//     rule that a quiet one lets run.
//   - The clock, kept by the world (run.mjs): what the count does not see (a regex that backtracks, a native sort)
//     is ended with the rule's whole thread.
// Why QuickJS and not V8 in the thread itself: .agents/skills/quickjs-sandbox/SKILL.md.
import { newQuickJSWASMModuleFromVariant, newVariant } from 'quickjs-emscripten-core'
import variant from '@jitl/quickjs-wasmfile-release-sync'

/** A rule's memory, in pages of 64 KB: what the interpreter starts with (it is built to), and the most it may grow to. */
const PAGES = 256, PAGES_MOST = 512
/** How deep a rule may call. */
const STACK = 96 << 10
/** How long one call may run: the interpreter asks every 10,000 jumps and calls, and after this many asks it is stopped. */
const ASKS = 200
/** The most text a rule may answer with. */
export const ANSWER_MOST = 256 << 10

/**
 * What a rule sees. `on(name, fn)` says what it listens for; when that happens `fn(world, e)` is called. The world
 * it is handed is a copy: reading it asks nobody, and what it calls on it (`actor`, `gone`, whatever the world
 * says may be asked for) is only written down, to
 * be sent back when the handler returns. `world.keep` is the rule's own memory, carried from call to call.
 * A rule can replace anything here (it shares the interpreter): no check lives in this text.
 */
const GUEST = `(() => {
  const handlers = {}
  globalThis.on = (name, fn) => { if (typeof fn === 'function') handlers[String(name)] = fn }
  globalThis.__listens = () => JSON.stringify(Object.keys(handlers))
  globalThis.__call = (json) => {
    const m = JSON.parse(json), out = []
    const flat = (a, b) => Math.hypot(a.at[0] - b[0], a.at[2] - b[b.length - 1])
    const world = {
      now: m.now, people: m.people, residents: m.residents || [], keep: m.keep,
      near: (at, within) => m.people.filter((p) => flat(p, at) <= within),
      // Anyone by their id; and whoever this is about (who spoke, who did something, who came near): theirs, or null.
      who: (id) => m.people.find((p) => p.id === id) || null,
      them: m.e && typeof (m.e.by || m.e.who) === 'string' ? m.people.find((p) => p.id === (m.e.by || m.e.who)) || null : null,
    }
    // What may be asked for here, by name (the world says which): world.actor('guide', {...}), world.gone('guide').
    // With one argument that is an object, there is no id: world.something({...}).
    for (const name of m.does) world[name] = (id, fields) => { out.push(id !== null && typeof id === 'object' ? Object.assign({}, id, { do: name }) : Object.assign({}, fields, { do: name, id: String(id) })) }
    const fn = handlers[m.event]
    if (fn) fn(world, m.e)
    return JSON.stringify({ out, keep: world.keep })
  }
})()`

/**
 * A rule's own interpreter, with its text run in it. Resolves to what it listens for and how to call it, or to why
 * its text would not run. `call` answers `{ value }` (the rule's answer, as text) or `{ error }`; `broken` says the
 * interpreter itself failed, and must not be used again.
 * @returns {Promise<{ listens: string[], call(json: string): { value: string } | { error: string, broken?: boolean } } | { error: string }>}
 */
export async function open(source) {
  try {
    const QuickJS = await newQuickJSWASMModuleFromVariant(newVariant(variant, { wasmMemory: new WebAssembly.Memory({ initial: PAGES, maximum: PAGES_MOST }) }))
    const runtime = QuickJS.newRuntime()
    runtime.setMaxStackSize(STACK)
    let asks = 0
    runtime.setInterruptHandler(() => ++asks > ASKS)
    const vm = runtime.newContext()
    /** What went wrong, as a sentence: a stopped call says `interrupted`, a full memory `out of memory`. */
    const why = (handle) => { const e = vm.dump(handle); handle.dispose(); return (typeof e === 'object' && e ? `${e.name ?? 'Error'}: ${e.message ?? ''}` : String(e)).slice(0, 300) }
    const run = (text, name) => { asks = 0; const r = vm.evalCode(text, name); if (r.error) return why(r.error); r.value.dispose(); return null }
    const call = (name, arg) => {
      asks = 0
      const fn = vm.getProp(vm.global, name), s = arg === undefined ? null : vm.newString(arg)
      const r = s ? vm.callFunction(fn, vm.undefined, s) : vm.callFunction(fn, vm.undefined)
      fn.dispose(); s?.dispose()
      if (r.error) return { error: why(r.error) }
      const value = vm.typeof(r.value) === 'string' ? vm.getString(r.value) : null
      r.value.dispose()
      return value === null ? { error: 'the rule answered with something that is not text' } : value.length > ANSWER_MOST ? { error: `the rule answered with more than ${ANSWER_MOST} characters` } : { value }
    }
    const failed = run(GUEST, 'guest.js') ?? run(source, 'rule.js')
    if (failed) return { error: failed }
    const listens = call('__listens')
    if (listens.error) return { error: listens.error }
    let names = []
    try { names = JSON.parse(listens.value).filter((n) => typeof n === 'string').slice(0, 32) } catch { /* a rule that broke the list listens for nothing */ }
    return { listens: names, call(json) { try { return call('__call', json) } catch (e) { return { error: `the interpreter broke: ${String(e).slice(0, 200)}`, broken: true } } } }
  } catch (e) { return { error: `the interpreter broke: ${String(e).slice(0, 200)}` } }
}
