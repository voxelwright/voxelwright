// Village's adapter over the physics engine (src/engine, #74), for the `physics` plugin and
// loaded on demand after the first frame: the solver, every thing in the home as a body
// (./home.ts), a few light things on the floor, the pinball table, villagers as bodies that push
// with finite strength, keys while a toy is being played, the rules (kept for the visit in this
// browser), asks from the notepad, and the `village.physics` handle the checks and the panel use.
import * as THREE from 'three/webgpu'
import type { Context } from 'cordis'
import { own } from '../kernel'
import { canvas, paintWood, toTexture } from '../paint'
import { PHYSICS_PANEL } from '../features'
import { createJolt, loadJolt } from '../engine/jolt'
import { World, type Grain } from '../engine/world'
import { Modes, type GameMode } from '../engine/mode'
import { Fire } from '../engine/fire'
import { GpuHeatField } from '../engine/heat'
import { Flames } from '../engine/flames'
import { PRESETS, registerPreset, registerRule, resetRules, type Rules } from '../engine/rules'
import { registerMaterial, resetMaterials } from '../engine/materials'
import { gadgetKinds, registerGadget, resetGadgets } from '../engine/gadgets'
import { ask, askedSoFar, type Making } from './ask'
import { MadeToys } from './made'
import { surfacesFor } from './surfaces'
import { homeBodies } from './home'
import { house } from '../build/house'
import type { PhysicsEvent } from '../engine/events'
import type { Vec3 } from '../engine/core'
import type { WorldApi } from '../engine/api'
import type { ToySpec } from '../engine/toy'
import { touch } from './touch'
import { feel } from './feel'
import { HOUSE } from './toys/house'
import { PINBALL, PINBALL_MODE, PINBALL_STAND } from './toys/pinball-table'
import { CANDLE } from './toys/candle'

const STORED = 'village.physics.rules'
const TOYS = [HOUSE, PINBALL, PINBALL_STAND, CANDLE]
/** Where the view stands to play the table: at its low end, looking down the playfield. */
/** A turn of the event loop: the page draws and takes input between the steps of starting. */
const nextTask = () => new Promise<void>((resolve) => setTimeout(resolve, 0))
const PLAY_POSE = { position: new THREE.Vector3(PINBALL.frame.at[0], 1.78, PINBALL.frame.at[2] + 1.4), look: new THREE.Vector3(PINBALL.frame.at[0], 0.86, PINBALL.frame.at[2] - 0.12), sharp: true }

/** Runs tasks in order, one per turn of the event loop, until `gone`; one that throws is logged and the rest still run. */
export function oneByOne(gone: () => boolean) {
  const tasks: (() => void)[] = []
  const next = () => {
    if (gone()) return
    try {
      tasks.shift()?.()
    } catch (error) {
      // One task failing leaves the rest to run: a wood whose grain did not paint stays its middle tone.
      console.error('physics: a task failed', error)
    }
    if (tasks.length) setTimeout(next, 0)
  }
  return (task: () => void) => {
    if (tasks.push(task) === 1) setTimeout(next, 0)
  }
}

export async function start(ctx: Context, gone: () => boolean) {
  const t0 = performance.now()
  await loadJolt()
  if (gone()) return
  const loadMs = performance.now() - t0
  const log: PhysicsEvent[] = []
  // Wood grain is painted after starting, one texture per task (each is a few ms; all of them in
  // the task that builds the toys made it a 160 ms long task). Until its grain is in, a wood is
  // drawn in its middle tone, on the canvas the grain is then copied onto, so the material and
  // texture stay the same objects and nothing is compiled again.
  const paint = oneByOne(gone)
  const grain: Grain = (seed, light, dark, knots, planks) => {
    const [c, g] = canvas(256, 256)
    g.fillStyle = `rgb(${light.map((v, i) => Math.round((v + dark[i]) / 2)).join(',')})`
    g.fillRect(0, 0, 256, 256)
    const texture = toTexture(c)
    paint(() => {
      const painted = paintWood({ seed, w: 256, h: 256, planks, light, dark, knots })
      g.drawImage(painted.image as HTMLCanvasElement, 0, 0)
      painted.dispose()
      texture.needsUpdate = true
    })
    return texture
  }
  const tell = (e: PhysicsEvent) => {
    log.push(e)
    if (log.length > 500) log.splice(0, 250)
    ctx.emit('village/physics', e)
  }
  const world = new World(createJolt(), tell, grain)
  // Game modes (#108): a game's own rules and toys, on loan while it is played.
  const modes = new Modes(world, tell)
  ctx.effect(() => () => world.dispose(), 'physics solver')
  // The registries are module-level and outlive this plugin (reload, HMR): what was added at runtime goes with the world.
  ctx.effect(() => () => {
    resetRules()
    resetMaterials()
    resetGadgets()
  }, 'physics registries')
  // One toy per task, then the home: no step of starting holds the page for long.
  for (const toy of TOYS) {
    world.addToy(toy)
    await nextTask()
    if (gone()) return
  }
  own(ctx, world.group)
  // Every thing in the home a body, read from the scene now; again after every plan change (a
  // placed thing, undo), every time the build mode builds the walls again (it does so in its next
  // frame, after the plan changed) and every thing added to or taken from the scene, in the next
  // task, once however many changes came together; and every few seconds for a thing whose parts
  // changed in place with none of these (a scan that finds nothing changed costs about 1 ms).
  const home = homeBodies(world, ctx.stage.scene, [world.group, ctx.stage.camera])
  const t1 = performance.now()
  home.scan()
  const homeMs = performance.now() - t1
  ctx.effect(() => () => home.dispose(), 'home bodies')
  ctx.effect(() => {
    let queued: ReturnType<typeof setTimeout> | undefined
    const soon = () => void (queued ??= setTimeout(() => {
      queued = undefined
      home.scan()
    }, 0))
    const scene = ctx.stage.scene
    scene.addEventListener('childadded', soon)
    scene.addEventListener('childremoved', soon)
    const offBuilt = ctx.on('village/built', soon)
    const id = setInterval(soon, 3000)
    let off = () => {}
    let closed = false
    void house().then((h) => {
      if (!closed) off = h.onChange(soon)
    })
    return () => {
      closed = true
      clearTimeout(queued)
      clearInterval(id)
      scene.removeEventListener('childadded', soon)
      scene.removeEventListener('childremoved', soon)
      offBuilt()
      off()
    }
  }, 'home bodies follow the scene')

  // Tuning kept in this browser for the visit and the next (a per-viewer convenience, checked like any rules).
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(STORED) ?? 'null')
    if (stored) world.setRules(stored, 'code')
  } catch {
    // No storage or not JSON: the normal rules.
  }
  ctx.on('village/physics', (e) => {
    // A game mode's rules are on loan, not the home's tuning: nothing is kept while one runs. When it
    // ends, what is in force then is kept (the home's own rules, with whatever was tuned meanwhile).
    if (e.kind === 'mode' ? e.state !== 'ended' : e.kind !== 'rules' || e.by === 'mode' || modes.active) return
    try {
      localStorage.setItem(STORED, JSON.stringify(world.rules))
    } catch {
      // Storage refused: the rules still hold for this visit.
    }
  })

  // Playing a toy: choosing it frames the view on it and hands it the keys it names.
  let playing: (typeof TOYS)[number] | null = null
  const keyInput = (code: string) => (playing ? Object.entries(playing.inputs).find(([, codes]) => codes.includes(code))?.[0] : undefined)
  const typing = (e: KeyboardEvent) => {
    const t = e.target as HTMLElement | null
    return Boolean(t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)))
  }
  const onKey = (e: KeyboardEvent) => {
    if (typing(e) || e.metaKey || e.ctrlKey || e.altKey) return
    const name = keyInput(e.code)
    if (!name) return
    e.preventDefault()
    e.stopImmediatePropagation()
    if (!e.repeat) world.input(name, e.type === 'keydown')
  }
  const play = (on: boolean) => {
    playing = on ? PINBALL : null
    if (on) modes.start(PINBALL_MODE)
    else if (modes.active === PINBALL_MODE.id) modes.end()
    ctx.view.focus(on ? PLAY_POSE : null)
    if (!on) for (const name of Object.keys(PINBALL.inputs)) world.input(name, false)
    hands.table(on)
  }
  // Fingers and the mouse: the same inputs as the keys while the table is chosen, and pokes and flings otherwise.
  const hands = touch(ctx, world, (name, down) => world.input(name, down), () => playing?.id ?? null)
  // The view answers the toy being played (a shake gadget's `shook`).
  const felt = feel(ctx, () => playing?.id ?? null)
  ctx.effect(() => {
    addEventListener('keydown', onKey, true)
    addEventListener('keyup', onKey, true)
    return () => {
      removeEventListener('keydown', onKey, true)
      removeEventListener('keyup', onKey, true)
    }
  }, 'physics keys')
  const handle = PINBALL.handle ? world.mesh(`${PINBALL.id}/${PINBALL.handle}`) : undefined
  if (handle) ctx.effect(() => ctx.entries.add({ id: PINBALL.id, label: PINBALL.label, object: handle, select: () => {
    play(true)
    ctx.entries.say('Tap left or right to flip')
  }, leave: () => play(false) }), 'pinball entry')

  // Villagers join as followers when they appear (talk places them after load), checked each second.
  const syncVillagers = () => {
    const seen = new Set<string>()
    ctx.stage.scene.traverse((o) => {
      if (typeof o.userData.villagerId !== 'string') return
      const key = `villager/${o.userData.villagerId}`
      seen.add(key)
      world.follow(key, o)
    })
    for (const key of world.followerKeys()) if (key.startsWith('villager/') && !seen.has(key)) world.unfollow(key)
  }
  ctx.effect(() => {
    syncVillagers()
    const id = setInterval(syncVillagers, 1000)
    return () => clearInterval(id)
  }, 'physics villagers')

  // Heat and fire (#74): the field on the GPU over the home as it stands now (its things' boxes, a
  // little past them), each part's fire state here, and the flames drawn over what burns.
  const span = world.burnables().filter((b) => !b.thing.startsWith('house/'))
  const lo: Vec3 = [Infinity, 0, Infinity], hi: Vec3 = [-Infinity, 2.6, -Infinity]
  for (const b of span) for (const i of [0, 2] as const) {
    lo[i] = Math.min(lo[i], b.center[i] - b.half[i])
    hi[i] = Math.max(hi[i], b.center[i] + b.half[i])
  }
  for (const i of [0, 2] as const) if (!Number.isFinite(lo[i]) || hi[i] - lo[i] > 40) [lo[i], hi[i]] = [-8, 8]
  const field = new GpuHeatField(ctx.stage.renderer, { min: [lo[0] - 0.3, -0.05, lo[2] - 0.3], max: [hi[0] + 0.3, Math.max(hi[1], 3), hi[2] + 0.3] })
  const fire = new Fire(world, field, (e) => {
    log.push(e)
    ctx.emit('village/physics', e)
  })
  ctx.effect(() => () => fire.dispose(), 'fire')
  const flames = new Flames()
  own(ctx, flames.group)
  ctx.effect(() => () => flames.dispose(), 'flames')
  let flamesAt = -1
  ctx.on('village/frame', (dt) => {
    world.frame(dt)
    fire.frame(dt)
    // Flames follow the fire state a few times a second; their motion is their shaders'.
    const now = performance.now()
    if (now - flamesAt > 120 && (fire.lit || flames.group.visible)) {
      flamesAt = now
      flames.update(fire.flames())
    }
  })

  // Toys made from a sentence (#88): built on a surface offered for the person, on trial until kept.
  const made = new MadeToys(ctx, world)
  const making: Making = { surfaces: (person) => surfacesFor(ctx.stage.scene, person), made }
  made.again = async (text, person) => {
    const r = await ask(world, text, person, making, { retry: true })
    return { ok: r.ok && Boolean(r.toy) }
  }

  // A notepad line about how things move (src/plugins/talk.ts routes it): asked here, said back there.
  ctx.on('village/physics-ask', (request) => {
    request.answer = ask(world, request.text, request.person, making, { toy: request.toy })
  })

  const api = {
    loadMs: Math.round(loadMs),
    /** ms to read the home into bodies the first time. */
    homeMs: Math.round(homeMs),
    rules: (): Rules => world.rules,
    setRules: (raw: unknown) => world.setRules(raw, 'code'),
    preset: (name: string) => world.preset(name),
    presets: Object.fromEntries(Object.entries(PRESETS).map(([k, p]) => [k, p.label])),
    ask: (text: string, as?: { toy?: boolean }) => ask(world, text, undefined, making, as),
    /** Toys made from a sentence: the one on trial and the kept ones, and the tag's three choices. */
    made: { state: () => made.state(), keep: () => made.keep(), undo: () => made.undo(), another: () => made.another(), blocked: (on: string) => made.blocked(on), surfaces: (person?: string) => making.surfaces(person ?? 'alex') },
    asked: askedSoFar,
    play,
    playing: () => playing?.id ?? null,
    /** How much of a view shake is still dying away, 0 to 1. */
    shaking: () => felt.strength(),
    /** Game modes: a game's rules and toys started and ended as one (engine/mode.ts). */
    modes: { start: (mode: GameMode) => modes.start(mode), end: () => modes.end(), active: () => modes.active },
    /** The view from `position` toward `look` (world space), or back to the person's own with null: for the checks' pictures. */
    look: (position: Vec3 | null, look: Vec3 = [0, 0, 0]) => ctx.view.focus(position ? { position: new THREE.Vector3(...position), look: new THREE.Vector3(...look) } : null),
    input: (name: string, down: boolean) => world.input(name, down),
    /**
     * Simulated seconds stepped at once. `watch` names things whose position in their toy's frame
     * is tracked over every step: the lowest and highest x, y, z each reached.
     */
    advance(seconds: number, watch: string[] = []) {
      const range: Record<string, { min: Vec3; max: Vec3 }> = {}
      world.advance(seconds, () => {
        for (const key of watch) {
          const l = world.thing(key)?.local
          if (!l) continue
          const r = (range[key] ??= { min: [...l], max: [...l] })
          for (let i = 0; i < 3; i++) {
            r.min[i] = Math.min(r.min[i], l[i])
            r.max[i] = Math.max(r.max[i], l[i])
          }
        }
      })
      return range
    },
    thing: (key: string) => world.thing(key),
    /** The home's things with bodies, the thing a mesh belongs to (or why none), and scan stats. */
    home: { list: home.list, bodyOf: home.bodyOf, scan: home.scan, stats: home.stats },
    /** A follower for any scene object (checks walk one into things); `held` says it is held back. */
    follow: (key: string, object: THREE.Object3D) => world.follow(key, object),
    unfollow: (key: string) => world.unfollow(key),
    held: (key: string) => world.heldBack(key),
    place: (key: string, local: Vec3) => world.place(key, local),
    counters: () => world.counters(),
    census: () => world.census(),
    /** The renderer's geometry and texture counts. */
    memory: () => ({ ...(ctx.stage.renderer.info.memory as unknown as Record<string, number>) }),
    signals: () => world.signals(),
    knobs: () => world.knobs(),
    setKnob: (gadget: string, knob: string, value: number) => world.setKnob(gadget, knob, value),
    reset: () => world.reset(),
    stats: () => world.stats(),
    clearStats: () => world.clearStats(),
    events: () => log.slice(),
    /** Fire and heat: each part's state, what burns, and acts (the checks, the notepad, agents). */
    fire: {
      list: () => fire.list(),
      stats: () => fire.stats(),
      clearStats: () => fire.clearStats(),
      ignite: (key: string, part?: string) => world.ignite(key, part, 'code'),
      douse: (key: string, part?: string) => world.douse(key, part, 'code'),
      rain: (seconds: number) => fire.rain(seconds),
      burning: (key: string) => world.burning(key),
      /** Steps fire and heat this many simulated seconds at once, reading the field back as it goes. */
      run: (seconds: number) => fire.run(seconds),
      bounds: field.bounds,
      backend: (ctx.stage.renderer.backend as unknown as { isWebGPUBackend?: boolean }).isWebGPUBackend ? 'WebGPU' : 'WebGL2',
    },
    snapshot: () => world.snapshot(),
    restore: (s: Parameters<World['restore']>[0]) => world.restore(s),
    /**
     * The engine itself (src/engine/api.ts): the world as a WorldApi, the open registries, and
     * addToy. On window.village on every build, like the rest of this handle; the checks and the
     * panel use it now, and a later branch hands agents exactly this, sandboxed.
     */
    engine: { world: world as WorldApi, addToy: (toy: ToySpec) => world.addToy(toy), removeToy: (id: string) => world.removeToy(id), hasToy: (id: string) => world.hasToy(id), registerMaterial, registerGadget, registerRule, registerPreset, gadgetKinds },
  }
  ctx.effect(() => {
    const village = (window as unknown as { village?: Record<string, unknown> }).village
    if (village) village.physics = api
    return () => {
      if (village?.physics === api) delete village.physics
    }
  }, 'physics handle')

  if (PHYSICS_PANEL) {
    const { panel } = await import('../engine/panel')
    if (!gone()) ctx.effect(() => panel(world, api.ask, () => api.stats()), 'physics panel')
  }
}
