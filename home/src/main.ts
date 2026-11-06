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
import panelling from './plugins/panelling'
import glass from './plugins/glass'
import sunbeam from './plugins/sunbeam'
import hearth from './plugins/hearth'
import shelf from './plugins/shelf'
import plant from './plugins/plant'
import drawing from './plugins/drawing'
import calendar from './plugins/calendar'
import rimlight from './plugins/rimlight'

const plugins = {
  renderer, room, panelling, window: windowView, glass, sunbeam, table, fridge, hearth,
  shelf, plant, drawing, calendar, motes, lamp, rimlight, camera, postfx,
}
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
  load: (name: keyof typeof plugins) => load(plugins[name]),
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
