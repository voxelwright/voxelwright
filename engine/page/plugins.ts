// The page side of the engine's plugins (#264, the WORKSHOP lane; ../plugins.mjs says what a plugin is). The world
// says which plugins have something for a page; each is a module this page imports when it is told of it, while
// it runs: nothing is loaded again. A plugin's module is the engine's own code, served from the checkout the server
// runs from, at an address that changes with its text (`?v=`), so a changed one is new to the browser.
//
//   export default (page) => ({ state(v) {}, once(v) {}, close() {} })
//
// `page.engine` is what the page's own modules share (`globalThis.engine`: the hud, the sound, the picture, and
// `engine.draws`, below, to draw with);
// `state` is given what the plugin's world side last said is so (and again to a page that joins later, and to a
// new version of the module), or null when that is so no longer (the page stepped to another realm); `once` is given something that happens now; `close` is called when the module is
// replaced or the plugin is gone, and must take away whatever it put on the page.
import type { Link, Plugged } from './link.ts'
import type { Target } from '../probe/gpu.ts'
import type { View } from './march.ts'

export interface PagePlugin { state?(v: unknown): void; once?(v: unknown): void; close?(): void }
export interface Plugins {
  /** The page sides that are in, by name: the version of each. */
  readonly loaded: Record<string, string>
  /** How long each import took, ms, by name: the last one. */
  readonly took: Record<string, number>
  /** What went wrong bringing one in, by name. */
  readonly errors: Record<string, string>
  /** What a plugin's module answered with, if it is in: for the checks. */
  of(name: string): PagePlugin | null
}

/**
 * A door for a page plugin to draw with (#264; on the page it is `engine.draws`): a pass of its own in every frame, after the world, its people,
 * crumbs and smoke are drawn and before the wand's marker. `draw` is given the frame's commands, what is being
 * drawn to (its colour and its depth, to read what is in front) and the view. A plugin adds its pass when its
 * module is made and removes it on `close`. A pass that throws is taken out and said: the frame goes on.
 */
export type Pass = (encoder: GPUCommandEncoder, to: Target, view: View, time: number) => void
export interface Passes {
  add(name: string, draw: Pass): void
  remove(name: string): void
  /** Once a frame, from the page's own loop. */
  draw(encoder: GPUCommandEncoder, to: Target, view: View, time: number): void
  readonly names: string[]
}
export function passes(): Passes {
  const all = new Map<string, Pass>()
  return {
    add(name, draw) { all.set(name, draw) },
    remove(name) { all.delete(name) },
    draw(encoder, to, view, time) { for (const [name, draw] of all) try { draw(encoder, to, view, time) } catch (e) { all.delete(name); console.warn(`the pass "${name}" failed and was taken out: ${e}`) } },
    get names() { return [...all.keys()] },
  }
}

export function plugins(far: Link): Plugins {
  /** By name: the version wanted, the module's answer once it is in, and what it was last told is so. */
  const all = new Map<string, { v: string; api: PagePlugin | null; state?: unknown; coming: Promise<void> }>()
  const took: Record<string, number> = {}, errors: Record<string, string> = {}
  const close = (name: string) => { const p = all.get(name); try { p?.api?.close?.() } catch (e) { console.warn(`plugin ${name}: ${e}`) } if (p) p.api = null }
  const bring = (name: string, v: string) => {
    const p = all.get(name) ?? { v: '', api: null, coming: Promise.resolve() }
    all.set(name, p)
    if (p.v === v) return
    p.v = v
    // One after another for a name: a version that is slow to come is not put in over a later one.
    p.coming = p.coming.then(async () => {
      if (p.v !== v) return
      const began = performance.now()
      try {
        const made = (await import(`/plugins/${name}/page.ts?v=${v}`)).default as (page: { engine: unknown; link: Link }) => PagePlugin
        if (p.v !== v) return
        close(name)
        p.api = made({ engine: (globalThis as unknown as { engine: unknown }).engine, link: far }) ?? {}
        if (p.state !== undefined) p.api.state?.(p.state)
        took[name] = performance.now() - began
        delete errors[name]
      } catch (e) { errors[name] = String(e); console.warn(`plugin ${name} did not load: ${e}`) }
    })
  }
  far.onplugged = (m: Plugged) => {
    // The core was built again and the world's process has taken it: this page takes it too (main.ts `recore`).
    if ('core' in m) { if (/^[0-9a-f]+$/.test(m.core)) void (globalThis as unknown as { engine: { recore(url: string): Promise<number> } }).engine.recore(`/page/core.wasm?v=${m.core}`).then((ms) => { took['the core'] = ms }, (e) => { errors['the core'] = String(e) }); return }
    if ('list' in m) {
      for (const name of [...all.keys()]) if (!m.list.some((p) => p.name === name)) { close(name); all.delete(name) }
      for (const p of m.list) if (/^[a-z0-9-]+$/.test(p.name) && /^[0-9a-f]+$/.test(p.v)) bring(p.name, p.v)
      return
    }
    const p = all.get(m.plugin)
    // Gone from this world, or this world left for another: what it showed is so no longer.
    if ('gone' in m) { if (p && p.state !== undefined) { p.state = undefined; try { p.api?.state?.(null) } catch (e) { console.warn(`plugin ${m.plugin}: ${e}`) } } return }
    try {
      if ('state' in m) { if (p) { p.state = m.state; p.api?.state?.(m.state) } else all.set(m.plugin, { v: '', api: null, state: m.state, coming: Promise.resolve() }) }
      else p?.api?.once?.(m.once)
    } catch (e) { console.warn(`plugin ${m.plugin}: ${e}`) }
  }
  return { get loaded() { return Object.fromEntries([...all].filter(([, p]) => p.api).map(([name, p]) => [name, p.v])) }, took, errors, of: (name) => all.get(name)?.api ?? null }
}
