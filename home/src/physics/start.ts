// Village's adapter over the physics engine (src/engine, #74), for the `physics` plugin and
// loaded on demand: the solver, the
// house's colliders and light things, the pinball table, villagers as bodies, keys while a
// toy is being played, the rules (kept for the visit in this browser), and the
// `village.physics` handle the checks and the panel use.
import * as THREE from 'three/webgpu'
import type { Context } from 'cordis'
import { own } from '../kernel'
import { paintWood } from '../paint'
import { PHYSICS_PANEL } from '../features'
import { createJolt, loadJolt } from '../engine/jolt'
import { World } from '../engine/world'
import { PRESETS, type Rules } from '../engine/rules'
import { ask, askedSoFar } from './ask'
import type { PhysicsEvent } from '../engine/events'
import type { Vec3 } from '../engine/core'
import { HOUSE } from './toys/house'
import { PINBALL, PINBALL_STAND } from './toys/pinball-table'

const STORED = 'village.physics.rules'
const TOYS = [HOUSE, PINBALL, PINBALL_STAND]
/** Where the view stands to play the table: at its low end, looking down the playfield. */
const PLAY_POSE = { position: new THREE.Vector3(PINBALL.frame.at[0], 1.78, PINBALL.frame.at[2] + 1.4), look: new THREE.Vector3(PINBALL.frame.at[0], 0.86, PINBALL.frame.at[2] - 0.12) }

export async function start(ctx: Context, gone: () => boolean) {
  const t0 = performance.now()
  await loadJolt()
  if (gone()) return
  const loadMs = performance.now() - t0
  const log: PhysicsEvent[] = []
  const world = new World(createJolt(), (e) => {
    log.push(e)
    if (log.length > 500) log.splice(0, 250)
    ctx.emit('village/physics', e)
  }, (seed, light, dark, knots, planks) => paintWood({ seed, w: 256, h: 256, planks, light, dark, knots }))
  ctx.effect(() => () => world.dispose(), 'physics solver')
  for (const toy of TOYS) world.addToy(toy)
  own(ctx, world.group)

  // Tuning kept in this browser for the visit and the next (a per-viewer convenience, checked like any rules).
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(STORED) ?? 'null')
    if (stored) world.setRules(stored, 'code')
  } catch {
    // No storage or not JSON: the normal rules.
  }
  ctx.on('village/physics', (e) => {
    if (e.kind !== 'rules') return
    try {
      localStorage.setItem(STORED, JSON.stringify(e.rules))
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
    ctx.view.focus(on ? PLAY_POSE : null)
    if (!on) for (const name of Object.keys(PINBALL.inputs)) world.input(name, false)
  }
  ctx.effect(() => {
    addEventListener('keydown', onKey, true)
    addEventListener('keyup', onKey, true)
    return () => {
      removeEventListener('keydown', onKey, true)
      removeEventListener('keyup', onKey, true)
    }
  }, 'physics keys')
  const handle = PINBALL.handle ? world.mesh(`${PINBALL.id}/${PINBALL.handle}`) : undefined
  if (handle) ctx.effect(() => ctx.entries.add({ id: PINBALL.id, label: PINBALL.label, object: handle, select: () => play(true), leave: () => play(false) }), 'pinball entry')

  // Villagers join as bodies when they appear (talk places them after load), checked each second.
  ctx.effect(() => {
    world.syncVillagers(ctx.stage.scene)
    const id = setInterval(() => world.syncVillagers(ctx.stage.scene), 1000)
    return () => clearInterval(id)
  }, 'physics villagers')
  ctx.on('village/frame', (dt) => world.frame(dt))

  const api = {
    loadMs: Math.round(loadMs),
    rules: (): Rules => world.rules,
    setRules: (raw: unknown) => world.setRules(raw, 'code'),
    preset: (name: string) => world.preset(name),
    presets: Object.fromEntries(Object.entries(PRESETS).map(([k, p]) => [k, p.label])),
    ask: (text: string) => ask(world, text),
    asked: askedSoFar,
    play,
    playing: () => playing?.id ?? null,
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
    place: (key: string, local: Vec3) => world.place(key, local),
    counters: () => world.counters(),
    signals: () => world.signals(),
    knobs: () => world.knobs(),
    setKnob: (gadget: string, knob: string, value: number) => world.setKnob(gadget, knob, value),
    reset: () => world.reset(),
    stats: () => world.stats(),
    clearStats: () => world.clearStats(),
    events: () => log.slice(),
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
