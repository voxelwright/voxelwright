// The mechanic sandbox, worker side (#106). Bundled on its own by the `mechanic-box` Vite plugin
// and started from a blob inside the sealed frame (../relay.ts), so it has that frame's policy:
// no network, no storage, no page. It hosts one QuickJS interpreter (WebAssembly) and runs one
// mechanic's code in it. The interpreter gives that code no way out: no host function is bound
// into it at all. Each call hands it one JSON text and takes one JSON text back.
//
// Limits, all enforced here, outside the code they limit: memory (the interpreter refuses to
// grow past MEMORY), stack depth, work per call in bytecode (the interpreter asks its interrupt
// handler every so often; past `budget` asks the call is stopped), and the size of an answer.
// Native built-ins (JSON.stringify, fill) never ask: the page's watchdog (LIMITS.late) is what
// ends such a call, by removing the frame.
// A call that fails inside the interpreter (an exception, a limit) answers with the reason and
// the interpreter lives on. Anything that fails outside it (a trap in the WebAssembly, the
// worker's own stack) is not survivable: the worker says `broken` and takes no more calls.
import { newQuickJSWASMModuleFromVariant, newVariant, type QuickJSContext, type QuickJSHandle } from 'quickjs-emscripten-core'
import variant from '@jitl/quickjs-wasmfile-release-sync'
import { PRELUDE } from '../prelude'
import { LIMITS } from '../limits'

// The DOM lib types self as a window; in a dedicated worker postMessage takes one message.
const post = self.postMessage.bind(self) as (message: unknown) => void

let vm: QuickJSContext | null = null
let tick: QuickJSHandle | null = null
let asks = 0
let budget = 0
let broken = false

/** One call into the interpreter under the budget: its text answer, or why it has none. */
function call(fn: QuickJSHandle, arg?: string): { text: string } | { error: string } {
  asks = 0
  const handle = arg === undefined ? undefined : vm!.newString(arg)
  const r = handle ? vm!.callFunction(fn, vm!.undefined, handle) : vm!.callFunction(fn, vm!.undefined)
  handle?.dispose()
  if (r.error) {
    const dumped: unknown = r.error.consume((e) => vm!.dump(e))
    const message = dumped && typeof dumped === 'object' && 'message' in dumped ? String(dumped.message) : String(dumped)
    return { error: (asks > budget ? 'it ran too long' : message || 'it failed').slice(0, LIMITS.reason) }
  }
  const text = vm!.typeof(r.value) === 'string' ? vm!.getString(r.value) : null
  r.value.dispose()
  if (text === null) return { error: 'it answered with something that is not text' }
  if (text.length > LIMITS.answer) return { error: 'it answered with too much' }
  return { text }
}

self.onmessage = async (event: MessageEvent<{ type?: unknown; wasm?: unknown; code?: unknown; view?: unknown }>) => {
  const m = event.data
  if (broken) return post({ type: 'broken', reason: 'the sandbox broke earlier' })
  try {
    if (m.type === 'load') {
      const quickjs = await newQuickJSWASMModuleFromVariant(newVariant(variant, { wasmBinary: m.wasm as ArrayBuffer }))
      const runtime = quickjs.newRuntime()
      runtime.setMemoryLimit(LIMITS.memory)
      runtime.setMaxStackSize(LIMITS.stack)
      budget = LIMITS.loadBudget
      runtime.setInterruptHandler(() => ++asks > budget)
      vm = runtime.newContext()
      const prelude = vm.evalCode(PRELUDE, 'prelude.js')
      if (prelude.error) throw new Error('it could not get started')
      prelude.value.dispose()
      asks = 0
      const loaded = vm.evalCode(String(m.code), 'mechanic.js')
      if (loaded.error) {
        loaded.error.dispose()
        // Said to the person as it is, so not the interpreter's own words (a syntax error names a line of code).
        return post({ type: 'refused', reason: asks > budget ? 'it ran too long' : 'what was written for it did not load' })
      }
      loaded.value.dispose()
      const hooks = vm.getProp(vm.global, '__hooks')
      const said = call(hooks)
      hooks.dispose()
      if ('error' in said) return post({ type: 'refused', reason: said.error })
      tick = vm.getProp(vm.global, '__tick')
      budget = LIMITS.budget
      return post({ type: 'loaded', hooks: said.text })
    }
    if (m.type === 'tick') {
      if (!vm || !tick) return post({ type: 'tock', error: 'nothing is loaded', asks: 0, ms: 0 })
      const t0 = performance.now()
      const r = call(tick, String(m.view))
      return post('error' in r ? { type: 'tock', error: r.error, asks, ms: performance.now() - t0 } : { type: 'tock', out: r.text, asks, ms: performance.now() - t0 })
    }
  } catch (error) {
    broken = true
    post({ type: 'broken', reason: String(error instanceof Error ? error.message : error).slice(0, LIMITS.reason) })
  }
}
post({ type: 'ready' })
