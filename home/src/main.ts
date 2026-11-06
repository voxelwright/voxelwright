import { load, loadedNames, root, unload } from './kernel'
import renderer from './plugins/renderer'
import room from './plugins/room'
import windowView from './plugins/window'
import table from './plugins/table'
import fridge from './plugins/fridge'
import motes from './plugins/motes'
import camera from './plugins/camera'
import lamp from './plugins/lamp'
import postfx from './plugins/postfx'

const plugins = { renderer, room, window: windowView, table, fridge, motes, lamp, camera, postfx }
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
  return {
    plugins: loadedNames().sort(),
    services: { stage: Boolean(stage) },
    sceneObjects: objects.length,
    objects: objects.sort(),
    frameHooks: hooks.length,
    drawSwapped: stage ? !String(stage.draw).includes('renderer.render') : false,
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
  ready: () => new Promise<void>((resolve) => {
    const check = () => (root.get('stage') && loadedNames().length === (only ?? Object.keys(plugins)).length ? resolve() : setTimeout(check, 50))
    check()
  }),
}
Object.assign(window, { village })
