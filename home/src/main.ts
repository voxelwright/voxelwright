import { load, pluginStates, replace, root, unload } from './kernel'
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
import entries from './plugins/entries'
import kitchendoor from './plugins/kitchendoor'
import lounge from './plugins/lounge'
import sideboard from './plugins/sideboard'
import growshelves from './plugins/growshelves'
import plantstand from './plugins/plantstand'
import loungedoors from './plugins/loungedoors'
import diorama from './plugins/diorama'
import loungediorama from './plugins/loungediorama'
import furnish from './plugins/furnish'
import loungefurnish from './plugins/loungefurnish'
import { PLANS, rooms } from './plugins/rooms'
import themePlugin from './theme/plugin'
import { THEMED, themes } from './theme'
import { attachAsk } from './theme/ask'
import { ease } from './theme/switch'
import type { Theme } from './theme/tokens'

const params = new URLSearchParams(location.search)
const listed = {
  renderer, camera, entries, postfx,
  room, window: windowView, glass, sunbeam, cabinets, table, chairs, highchair, fridge,
  toyshelf, botanical, plant, motes, lamp, rimlight, notebook, kitchendoor,
  lounge, sideboard, growshelves, plantstand, loungedoors, diorama, loungediorama, furnish, loungefurnish,
}
// Any other file in plugins/ joins the catalog under its declared name, so adding a plugin
// never means editing this file. The Elder relies on that: candidates may change only plugins/.
// A discovered plugin no room plan claims is placed in the kitchen, the room that opens first.
type Loadable = Parameters<typeof load>[0]
const discovered = import.meta.glob<Loadable>(['./plugins/*.ts', '!./plugins/rooms.ts'], { eager: true, import: 'default' })
const known = new Set<Loadable>(Object.values(listed))
const extra = Object.fromEntries(
  Object.values(discovered).filter((p) => p && !known.has(p) && !(p.name in listed)).map((p) => [p.name, p]),
)
PLANS.kitchen.plugins.push(...Object.keys(extra))
const catalog: Record<string, Loadable> = { ...listed, ...extra }
// ?room=living starts in another room.
const start = PLANS[params.get('room') ?? ''] ? params.get('room')! : 'kitchen'
const plugins: Record<string, Loadable> = { ...catalog, rooms: rooms(catalog, start), theme: themePlugin }
/** Loaded for the whole visit; the rooms service loads and unloads the rest. */
const GLOBAL = ['renderer', 'camera', 'entries', 'rooms', 'postfx', ...(THEMED ? ['theme'] : [])]
// ?plugins=renderer,room loads exactly the named plugins and no rooms, used to measure baselines.
const only = params.get('plugins')?.split(',')
// With rooms listed too, each room brings only its listed plugins, so the Elder's
// lifecycle baseline (every active plugin but one) really leaves that one out.
if (only) for (const plan of Object.values(PLANS)) plan.plugins = plan.plugins.filter((n) => only.includes(n))
for (const [name, plugin] of Object.entries(plugins)) if (only ? only.includes(name) : GLOBAL.includes(name)) load(plugin)
// #42 experiment: ?props=<run-id> places generated props in the kitchen, in dev builds only.
if (import.meta.env.DEV && params.has('props')) void import('./props/load').then((m) => load(m.default))
const keepRooms = params.get('rooms') !== 'unload'
// When calibration steps the tier down, the renderer has already lowered the pixel
// ratio; post-processing is rebuilt with the new tier's features. Scene content keeps
// its load-time detail, so ?q=low remains the way to get the light scene everywhere.
root.on('village/tier', () => void replace(postfx))
// A live theme change (src/theme setTheme): the theme plugin shifts the scene; postfx blends
// its uniforms, or compiles the next chain ahead and swaps it in when the chain changes shape.
root.on('village/theme', (previous, next) => {
  load(themePlugin)
  void ease(root.get('stage'), previous as Theme, next as Theme)
})

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
    room: root.get('rooms')?.current ?? null,
    entries: root.get('entries')?.list() ?? [],
    dom: document.body.querySelectorAll('*').length,
    sceneObjects: objects.length,
    objects: objects.sort(),
    frameHooks: hooks.length,
    drawPasses: stage?.drawPasses() ?? 0,
    geometries: memory?.geometries ?? 0,
    textures: memory?.textures ?? 0,
    fog: Boolean(stage?.scene.fog),
    backend: stage?.backend,
    quality: stage?.quality,
    features: stage ? [...stage.features()] : [],
    tierReason: stage?.timing.tierReason,
    render: stage ? { drawCalls: stage.renderer.info.render.drawCalls, triangles: stage.renderer.info.render.triangles } : null,
  }
}

const village = {
  snapshot,
  /** GPU pass and CPU frame times recorded so far (see the renderer's timing notes). */
  timing: () => root.get('stage')?.timing,
  /** Looks: list, current, set, save, rename, remove, keepCostume (src/theme). */
  theme: themes,
  load: (name: string) => load(plugins[name]),
  unload,
  /**
   * Resolves once every requested plugin is active or has failed, or after
   * timeoutMs with whatever is still loading or waiting. ok is true only when
   * every requested plugin is active.
   */
  ready: (timeoutMs = 15000) => new Promise<Readiness>((resolve) => {
    const current = root.get('rooms')?.current ?? start
    const wanted = only ?? [...GLOBAL, ...(keepRooms ? Object.values(PLANS).flatMap((p) => p.plugins) : PLANS[current].plugins)]
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
attachAsk()
