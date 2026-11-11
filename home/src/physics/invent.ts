// A mechanic invented from a sentence (#106): a toy with one new kind of gadget in it, whose
// behaviour is code a model wrote. The answer is data until the last step: its kind is checked
// (engine/invent.ts checkKind), its code goes into a sandbox and nowhere else (src/invent), its
// toy passes every check a made toy does (engine/made.ts) with the new kind allowed, and then it
// is built and goes on trial like any made toy (./made.ts): Keep, Undo, Try another.
//
// Undo does not ask the sandbox for anything. The toy comes out of the world, the frame is
// removed (which ends the worker whatever it is doing), the kind leaves the registry, and the
// things the mechanic moved itself go back where they were when it arrived (not what those knocked into). A mechanic that stops by
// itself (it kept failing, or its sandbox died) says so on its tag and stays as inert parts.
import type { Snapshot } from '../engine/api'
import type { Vec3 } from '../engine/core'
import { registerGadget, unregisterGadget } from '../engine/gadgets'
import { checkKind, Mechanic } from '../engine/invent'
import { obj } from '../engine/made'
import { INVENT } from '../engine/invent-caps'
import { INVENTED } from '../engine/made-kinds'
import type { World } from '../engine/world'
import type { MadeToys, Spirit } from './made'


let count = 0
const running = new Map<string, Mechanic>()

/** The mechanics built this visit that are still in the world: each kind, why it stopped if it did, and its counts and timings. */
export const mechanics = () => [...running].map(([kind, m]) => ({ kind, stopped: m.stopped, stats: m.stats }))

/** A mechanic ready to be built into a toy: its kind is registered and its sandbox runs. */
interface Ready { kind: string; hooks: string[]; loadMs: number; toy: Record<string, unknown>; spirit(id: string, made: MadeToys): Spirit; end: Spirit['end'] }

/**
 * Checks a mechanic's kind and code, starts its sandbox and registers its kind. Returns the toy to
 * check and build (its gadgets renamed to the registered kind) and the spirit to give it, or why
 * not. When the toy is then refused, call `end(false)`: nothing else is left behind.
 */
export async function prepare(world: World, raw: unknown, places: () => Record<string, Vec3>): Promise<Ready | string> {
  if (!obj(raw) || !obj(raw.toy)) return 'there was no mechanic in the answer'
  const code = raw.code
  if (typeof code !== 'string' || !code.trim()) return 'the mechanic had no code'
  const decl = checkKind(raw.kind)
  if ('reason' in decl) return decl.reason
  const rawGadgets = Array.isArray(raw.toy.gadgets) ? raw.toy.gadgets : []
  const mine = rawGadgets.filter((g) => obj(g) && g.kind === INVENTED).length
  if (!mine) return 'nothing in it used the new mechanic'
  if (mine > INVENT.gadgets) return `it used the new mechanic ${mine} times, and a toy can use it ${INVENT.gadgets} times at most`
  // The sandbox is its own chunk, and the interpreter half a megabyte of WebAssembly: both are fetched at the first invention.
  const { MechanicBox } = await import('../invent/sandbox')
  const opened = await MechanicBox.open(code)
  if (!opened.ok) return opened.reason
  if (world.disposed) {
    opened.box.dispose()
    return 'the world stopped while it was being made'
  }
  if (!opened.hooks.length) {
    opened.box.dispose()
    return 'what was written for it has no step to run'
  }
  const kind = `inv-${++count}`
  const mechanic = new Mechanic(kind, decl, opened.hooks, places, opened.box)
  opened.box.onTock = (reply) => mechanic.tock(reply)
  opened.box.onDead = (reason) => mechanic.stop(`its sandbox closed (${reason})`)
  // The world as the mechanic finds it, taken at its first step: by then a toy it replaced is out and what that one moved is back.
  let before: Snapshot | null = null
  const own = mechanic.gadgetKind()
  const refused = registerGadget({ ...own, step: (g, w, h) => {
    before ??= world.snapshot()
    own.step?.(g, w, h)
  } })
  if (refused) {
    opened.box.dispose()
    return refused
  }
  running.set(kind, mechanic)
  const moved = new Set<string>()
  mechanic.onMoved = (key) => moved.add(key)
  let ended = false
  const end = (undone: boolean) => {
    if (ended) return
    ended = true
    // The frame first, and nothing asked of it: whatever the code is doing ends here.
    opened.box.dispose()
    mechanic.onStop = () => {}
    mechanic.stop('it was taken away')
    unregisterGadget(kind)
    running.delete(kind)
    if (!undone || world.disposed || !before) return
    // What it moved itself goes back where it was when the mechanic arrived (things since removed are skipped). What those knocked into stays.

    for (const key of moved) {
      const was = before.things[key]
      if (was) world.moveTo(key, was.p, was.v, was.q)
    }
  }
  return {
    kind, hooks: opened.hooks, loadMs: Math.round(opened.ms), end,
    toy: { ...raw.toy, gadgets: rawGadgets.map((g) => (obj(g) && g.kind === INVENTED ? { ...g, kind } : g)) },
    spirit(id, made) {
      // The reason stays in mechanics() for whoever debugs it: it may be the code's own words, which are not the home's to say.
      mechanic.onStop = () => made.say(id, 'It stopped working. Undo takes it away.')
      return { end }
    },
  }
}
