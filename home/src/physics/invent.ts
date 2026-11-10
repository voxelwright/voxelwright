// A mechanic invented from a sentence (#106): a toy with one new kind of gadget in it, whose
// behaviour is code a model wrote. The answer is data until the last step: its kind is checked
// (engine/invent.ts checkKind), its code goes into a sandbox and nowhere else (src/invent), its
// toy passes every check a made toy does (engine/made.ts) with the new kind allowed, and then it
// is built and goes on trial like any made toy (./made.ts): Keep, Undo, Try another.
//
// Undo does not ask the sandbox for anything. The toy comes out of the world, the frame is
// removed (which ends the worker whatever it is doing), the kind leaves the registry, and the
// things the mechanic moved go back where they were when it arrived. A mechanic that stops by
// itself (it kept failing, or its sandbox died) says so on its tag and stays as inert parts.
import type { Snapshot } from '../engine/api'
import type { Vec3 } from '../engine/core'
import { registerGadget, unregisterGadget } from '../engine/gadgets'
import { checkKind, Mechanic } from '../engine/invent'
import type { World } from '../engine/world'
import { LIMITS } from '../invent/limits'
import type { MadeToys, Spirit } from './made'

/** The name a mechanic's toy uses for its new kind; the page gives the kind its real name. */
export const INVENTED = 'invented'
/** Gadgets of the new kind in one toy at most: each is one more call per step in the sandbox. */
const MAX_GADGETS = 4

const obj = (x: unknown): x is Record<string, unknown> => Boolean(x) && typeof x === 'object' && !Array.isArray(x)
let count = 0
const running = new Map<string, { mechanic: Mechanic; code: string }>()

/** The mechanics built this visit that are still in the world: each kind, its code as written, whether it stopped, and its counts and timings (for the checks and the panel). */
export const mechanics = () => [...running].map(([kind, m]) => ({ kind, code: m.code, stopped: m.mechanic.stopped, stats: m.mechanic.stats }))

/** A mechanic ready to be built into a toy: its kind is registered and its sandbox runs. */
export interface Ready { kind: string; hooks: string[]; loadMs: number; toy: Record<string, unknown>; spirit(id: string, made: MadeToys): Spirit }

/**
 * Checks a mechanic's kind and code, starts its sandbox and registers its kind. Returns the toy to
 * check and build (its gadgets renamed to the registered kind) and the spirit to give it, or why
 * not. When the toy is then refused, call `spirit(...).end(false)`: nothing else is left behind.
 */
export async function prepare(world: World, raw: unknown, places: () => Record<string, Vec3>): Promise<Ready | string> {
  if (!obj(raw) || !obj(raw.toy)) return 'there was no mechanic in the answer'
  const code = raw.code
  if (typeof code !== 'string' || !code.trim()) return 'the mechanic had no code'
  if (code.length > LIMITS.code) return 'its code is too long'
  const decl = checkKind(raw.kind)
  if ('reason' in decl) return decl.reason
  const rawGadgets = Array.isArray(raw.toy.gadgets) ? raw.toy.gadgets : []
  const mine = rawGadgets.filter((g) => obj(g) && g.kind === INVENTED).length
  if (!mine) return 'nothing in it used the new mechanic'
  if (mine > MAX_GADGETS) return `it used the new mechanic ${mine} times and a toy may ${MAX_GADGETS} times`
  // The sandbox is its own chunk (the interpreter is half a megabyte): fetched at the first invention.
  const { MechanicBox } = await import('../invent/sandbox')
  const opened = await MechanicBox.open(code)
  if (!opened.ok) return opened.reason
  if (world.disposed) {
    opened.box.dispose()
    return 'the world stopped while it was being made'
  }
  if (!opened.hooks.length) {
    opened.box.dispose()
    return 'its code defined no step, touch or receive'
  }
  const kind = `inv-${++count}`
  const mechanic = new Mechanic(kind, decl, opened.hooks, places)
  mechanic.attach(opened.box)
  opened.box.onTock = (reply) => mechanic.tock(reply)
  opened.box.onDead = (reason) => mechanic.stop(`its sandbox closed (${reason})`)
  const refused = registerGadget(mechanic.gadgetKind())
  if (refused) {
    opened.box.dispose()
    return refused
  }
  running.set(kind, { mechanic, code })
  const before: Snapshot = world.snapshot()
  const moved = new Set<string>()
  mechanic.onMoved = (key) => moved.add(key)
  return {
    kind, hooks: opened.hooks, loadMs: Math.round(opened.ms),
    toy: { ...raw.toy, gadgets: rawGadgets.map((g) => (obj(g) && g.kind === INVENTED ? { ...g, kind } : g)) },
    spirit(id, made) {
      mechanic.onStop = (reason) => made.say(id, `It stopped: ${reason}. Undo takes it away.`)
      let ended = false
      return {
        end(undone) {
          if (ended) return
          ended = true
          // The frame first, and nothing asked of it: whatever the code is doing ends here.
          opened.box.dispose()
          mechanic.onStop = () => {}
          mechanic.stop('it was taken away')
          unregisterGadget(kind)
          running.delete(kind)
          if (!undone || world.disposed) return
          // What it moved goes back where it was when the mechanic arrived (things since removed are skipped).
          for (const key of moved) {
            const was = before.things[key]
            if (was) world.moveTo(key, was.p, was.v, was.q)
          }
        },
      }
    },
  }
}
