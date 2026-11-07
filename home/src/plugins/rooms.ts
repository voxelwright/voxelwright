import * as THREE from 'three/webgpu'
import type { Context, Plugin } from 'cordis'
import { load, loadedNames, ownerOf, pluginStates, unload } from '../kernel'
import { LIVING_X } from '../layout'
import type { Pose } from './camera'

export interface RoomPlan {
  /** Plugins that make up the room, loaded on entering and unloaded on leaving. */
  plugins: string[]
  /** Where the camera rests in the room. */
  home: Pose
  /** Where the camera starts when someone walks in, a step behind home. */
  arrive: Pose
  /** Fog colour, near and far, applied while the room is the current one. */
  fog: [string, number, number]
}

export interface Rooms {
  readonly current: string
  readonly moving: boolean
  /** Walk to another room: ease towards the doorway pose, fade, swap rooms, ease in. */
  go(name: string, doorway: Pose): Promise<void>
  /** Durations of the last move, for measurement. */
  readonly lastMove: { walkOut: number; swap: number; walkIn: number } | null
}

declare module 'cordis' {
  interface Context {
    rooms: Rooms
  }
}

const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)')
const WALK = 0.95 // seconds each way
const SETTLE_QUIET_MS = 400

const pose = (p: [number, number, number], l: [number, number, number]): Pose => ({
  position: new THREE.Vector3(...p),
  look: new THREE.Vector3(...l),
})


export const PLANS: Record<string, RoomPlan> = {
  kitchen: {
    plugins: ['room', 'window', 'glass', 'sunbeam', 'cabinets', 'table', 'chairs', 'highchair', 'fridge',
      'toyshelf', 'botanical', 'plant', 'motes', 'lamp', 'rimlight', 'notebook', 'kitchendoor'],
    home: pose([0.1, 1.45, 2.7], [0.12, 1.05, -0.9]),
    arrive: pose([-0.9, 1.5, 0.6], [-0.4, 1.2, -1.6]),
    fog: ['#e8c49a', 6, 22],
  },
  living: {
    plugins: ['lounge', 'sideboard', 'growshelves', 'plantstand', 'loungedoors'],
    // The plants and shelves are the subject; the workshop door is a quiet right edge.
    home: pose([LIVING_X + 0.6, 1.4, 2.35], [LIVING_X - 0.12, 1.28, -2.2]),
    arrive: pose([LIVING_X - 0.3, 1.45, 3.0], [LIVING_X - 0.6, 1.3, -2.2]),
    fog: ['#d8c4ac', 9, 30],
  },
}

/**
 * Rooms are groups of plugins. By default every room next to the current one
 * stays loaded: walking between them then holds 60 fps, where loading on entry
 * stalls one frame for 0.5 to 1 s behind the fade (README, November 6, 2026).
 * With ?rooms=unload the service loads the room someone walks into and unloads
 * the one they leave.
 */
export function rooms(catalog: Record<string, Plugin & { name: string }>, start: string): Plugin & { name: string } {
  return {
    name: 'rooms',
    inject: ['stage', 'view', 'entries'],
    apply(ctx: Context) {
      const keep = new URLSearchParams(location.search).get('rooms') !== 'unload'
      const view = ctx.view
      let current = PLANS[start] ? start : 'kitchen'
      let moving = false
      let lastMove: Rooms['lastMove'] = null
      let disposed = false

      const veil = document.createElement('div')
      veil.className = 'village-veil'
      const style = document.createElement('style')
      style.textContent = `
        .village-veil { position: fixed; inset: 0; background: #2a1d16; opacity: 0; pointer-events: none; transition: opacity 320ms ease; }
        .village-veil.shown { opacity: 1; }
        @media (prefers-reduced-motion: reduce) { .village-veil { transition-duration: 120ms; } }
      `
      const fade = (on: boolean) =>
        new Promise<void>((done) => {
          veil.classList.toggle('shown', on)
          setTimeout(done, reducedMotion.matches ? 130 : 330)
        })

      // Done when every plugin is active or failed. A plugin still waiting for a
      // service, with nothing else loading and no change for SETTLE_QUIET_MS, will
      // not be rescued by waiting longer: report it and let the room open without it.
      const settle = (names: string[], timeoutMs = 15000) =>
        new Promise<string[]>((done) => {
          const deadline = performance.now() + timeoutMs
          let quiet = { key: '', since: performance.now() }
          const check = () => {
            if (disposed) return done([])
            const states = pluginStates()
            const stuck = names.filter((n) => states[n]?.state !== 'active' && states[n]?.state !== 'failed')
            const key = stuck.map((n) => `${n}:${states[n]?.state}`).join()
            if (key !== quiet.key) quiet = { key, since: performance.now() }
            const onlyWaiting = stuck.every((n) => states[n]?.state === 'waiting')
            if (!stuck.length || (onlyWaiting && performance.now() - quiet.since > SETTLE_QUIET_MS) || performance.now() > deadline) done(stuck)
            else setTimeout(check, 30)
          }
          check()
        })
      const frames = (n: number) => new Promise<void>((done) => {
        const step = () => (--n <= 0 ? done() : requestAnimationFrame(step))
        requestAnimationFrame(step)
      })
      const { scene } = ctx.stage
      const roomOf = (plugin: string | undefined) => Object.keys(PLANS).find((r) => plugin && PLANS[r].plugins.includes(plugin))
      // Each room loads once (or once per visit with ?rooms=unload); a walk awaits it.
      const prepared = new Map<string, Promise<void>>()
      const prepare = (name: string) => {
        let p = prepared.get(name)
        if (!p) {
          const release = ctx.stage.hold()
          p = (async () => {
            for (const n of PLANS[name].plugins) if (!disposed) load(catalog[n])
            const stuck = await settle(PLANS[name].plugins)
            if (stuck.length && !disposed) console.warn(`Village room "${name}" opened without: ${stuck.map((n) => `${n} (${pluginStates()[n]?.state ?? 'missing'})`).join(', ')}`)
          })().finally(release)
          prepared.set(name, p)
        }
        return p
      }
      const leave = async (name: string) => {
        prepared.delete(name)
        for (const n of [...PLANS[name].plugins].reverse()) await unload(n)
      }
      // Lights reach every object in the scene, so a room kept loaded next door
      // is hidden: its objects, lights and shadows are skipped until someone walks in.
      // Objects are matched to rooms by the plugin that owns them, so one a plugin
      // adds later is hidden too.
      const place = (object: THREE.Object3D, plugin: string | undefined) => {
        const room = roomOf(plugin)
        if (room && object.parent === scene) object.visible = room === current
      }
      const show = (name: string) => {
        current = name
        for (const o of scene.children) place(o, ownerOf(o))
        const [colour, near, far] = PLANS[name].fog
        scene.fog = new THREE.Fog(colour, near, far)
      }
      ctx.on('village/owned', (object, plugin) => place(object, plugin))

      ctx.effect(() => {
        const atmosphere = { fog: scene.fog, background: scene.background }
        scene.background = new THREE.Color('#2a1d16')
        document.head.append(style)
        document.body.append(veil)
        return () => {
          // Pending loads and walks stop here, so none resumes after disposal.
          disposed = true
          scene.fog = atmosphere.fog
          scene.background = atmosphere.background
          for (const o of scene.children) if (roomOf(ownerOf(o))) o.visible = true
          veil.remove()
          style.remove()
          // The rooms this service loaded leave with it.
          const mine = new Set(Object.values(PLANS).flatMap((p) => p.plugins))
          for (const n of loadedNames()) if (mine.has(n)) void unload(n)
        }
      }, 'rooms')

      ctx.provide('rooms', {
        get current() {
          return current
        },
        get moving() {
          return moving
        },
        get lastMove() {
          return lastMove
        },
        async go(name: string, doorway: Pose) {
          if (moving || name === current || !PLANS[name] || disposed) return
          moving = true
          const release = ctx.stage.hold()
          try {
            const from = current
            const t0 = performance.now()
            ctx.entries.back()
            ctx.entries.say(null)
            // Walk towards the door; the fade starts on the last part of the walk.
            const walk = view.travel(doorway, WALK)
            if (!reducedMotion.matches) await new Promise((r) => setTimeout(r, WALK * 600))
            await fade(true)
            await walk
            const t1 = performance.now()
            await prepare(name)
            if (disposed) return
            show(name)
            await frames(2) // first frames compile the new room's shaders, still behind the veil
            if (!keep) await leave(from)
            if (disposed) return
            await view.travel(PLANS[name].arrive, 0)
            await frames(1)
            ctx.entries.sort()
            const t2 = performance.now()
            const walkIn = view.travel(PLANS[name].home, WALK)
            await fade(false)
            await walkIn
            lastMove = { walkOut: Math.round(t1 - t0), swap: Math.round(t2 - t1), walkIn: Math.round(performance.now() - t2) }
            ctx.entries.sort()
          } finally {
            moving = false
            release()
          }
        },
      })

      // Door plugins inject this service, which Cordis offers once apply returns,
      // so the first rooms load after it, without apply waiting on them.
      void view.travel(PLANS[current].home, 0)
      show(current)
      void (async () => {
        for (const name of keep ? [current, ...Object.keys(PLANS).filter((n) => n !== current)] : [current]) {
          if (disposed) return
          await prepare(name)
        }
      })()
    },
  }
}
