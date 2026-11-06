import { load, pluginStates, root, unload } from './kernel'
import renderer from './plugins/renderer'
import room from './plugins/room'
import windowView from './plugins/window'
import table from './plugins/table'
import fridge from './plugins/fridge'
import motes from './plugins/motes'
import camera from './plugins/camera'
import lamp from './plugins/lamp'
import postfx from './plugins/postfx'
import glass from './plugins/glass'
import sunbeam from './plugins/sunbeam'
import plant from './plugins/plant'
import rimlight from './plugins/rimlight'
import notebook from './plugins/notebook'
import cabinets from './plugins/cabinets'
import chairs from './plugins/chairs'
import highchair from './plugins/highchair'
import toyshelf from './plugins/toyshelf'
import botanical from './plugins/botanical'

const listed = {
  renderer, room, window: windowView, glass, sunbeam, cabinets, table, chairs, highchair, fridge,
  toyshelf, botanical, plant, motes, lamp, rimlight, camera, notebook, postfx,
}
// Any other file in plugins/ loads after the list under its declared name, so
// adding a plugin never means editing this file. The Elder relies on that:
// candidates may change only plugins/.
type Loadable = Parameters<typeof load>[0]
const discovered = import.meta.glob<Loadable>('./plugins/*.ts', { eager: true, import: 'default' })
const known = new Set<Loadable>(Object.values(listed))
const extra = Object.fromEntries(
  Object.values(discovered).filter((p) => p && !known.has(p) && !(p.name in listed)).map((p) => [p.name, p]),
)
const plugins: Record<string, Loadable> = { ...listed, ...extra }
// ?plugins=renderer,room loads a subset, used to measure baselines.
const only = new URLSearchParams(location.search).get('plugins')?.split(',')
for (const [name, plugin] of Object.entries(plugins)) if (!only || only.includes(name)) load(plugin)

/** What is registered right now: used by the unload proof and the perf run. */
function snapshot() {
  const stage = root.get('stage')
  const objects: string[] = []
  stage?.scene.traverse((o: { type: string; name: string }) => objects.push(`${o.type}:${o.name}`))
  const hooks = (root as unknown as { events: { _hooks: Record<string, unknown[]> } }).events._hooks['village/frame'] ?? []
  const memory = stage?.renderer.info.memory
  const states = pluginStates()
  const named = (state: string) => Object.keys(states).filter((n) => states[n].state === state).sort()
  return {
    plugins: {
      registered: Object.keys(states).filter((n) => states[n].state !== 'failed').sort(),
      active: named('active'),
      failed: Object.fromEntries(named('failed').map((n) => [n, states[n].error])),
    },
    services: { stage: Boolean(stage) },
    sceneObjects: objects.length,
    objects: objects.sort(),
    frameHooks: hooks.length,
    drawPasses: stage?.drawPasses() ?? 0,
    geometries: memory?.geometries ?? 0,
    textures: memory?.textures ?? 0,
    fog: Boolean(stage?.scene.fog),
    backend: stage?.backend,
    render: stage ? { drawCalls: stage.renderer.info.render.drawCalls, triangles: stage.renderer.info.render.triangles } : null,
  }
}

const village = {
  snapshot,
  load: (name: string) => load(plugins[name]),
  unload,
  /**
   * Resolves once every requested plugin is active or has failed, or after
   * timeoutMs with whatever is still loading or waiting. ok is true only when
   * every requested plugin is active.
   */
  ready: (timeoutMs = 15000) => new Promise<Readiness>((resolve) => {
    const wanted = only ?? Object.keys(plugins)
    const deadline = performance.now() + timeoutMs
    const check = () => {
      const states = pluginStates()
      const settled = wanted.every((n) => states[n]?.state === 'active' || states[n]?.state === 'failed')
      if (!settled && performance.now() < deadline) return void setTimeout(check, 50)
      const notActive = wanted.filter((n) => states[n]?.state !== 'active')
      resolve({
        ok: notActive.length === 0,
        active: wanted.filter((n) => states[n]?.state === 'active'),
        problems: Object.fromEntries(notActive.map((n) => [n, states[n] ?? { state: 'missing' }])),
      })
    }
    check()
  }),
}

interface Readiness {
  ok: boolean
  active: string[]
  problems: Record<string, { state: string; error?: string }>
}
// Dev builds also expose the kernel so scripts/check-kernel.mjs can load test plugins.
if (import.meta.env.DEV) Object.assign(village, { kernel: { root, load, unload } })
Object.assign(window, { village })
