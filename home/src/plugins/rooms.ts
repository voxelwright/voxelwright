import * as THREE from 'three/webgpu'
import type { Context, Plugin } from 'cordis'
import { load, loadedNames, pluginStates, unload } from '../kernel'
import { LIVING_X } from '../layout'
import type { Pose } from './camera'

export interface RoomPlan {
  /** Plugins that make up the room, loaded on entering and unloaded on leaving. */
  plugins: string[]
  /** Where the camera rests in the room. */
  home: Pose
  /** Where the camera starts when someone walks in, a step behind home. */
  arrive: Pose
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
  },
  living: {
    plugins: ['lounge', 'sideboard', 'growshelves', 'plantstand', 'loungedoors'],
    home: pose([LIVING_X - 0.45, 1.45, 3.1], [LIVING_X + 0.1, 1.2, -1.2]),
    arrive: pose([LIVING_X - 1.4, 1.5, 3.6], [LIVING_X - 0.6, 1.25, -1.2]),
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
    async apply(ctx: Context) {
      const keep = new URLSearchParams(location.search).get('rooms') !== 'unload'
      const view = ctx.view
      let current = PLANS[start] ? start : 'kitchen'
      let moving = false
      let lastMove: Rooms['lastMove'] = null

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

      const settle = (names: string[], timeoutMs = 15000) =>
        new Promise<void>((done) => {
          const deadline = performance.now() + timeoutMs
          const check = () => {
            const states = pluginStates()
            if (names.every((n) => states[n]?.state === 'active' || states[n]?.state === 'failed') || performance.now() > deadline) done()
            else setTimeout(check, 30)
          }
          check()
        })
      const frames = (n: number) => new Promise<void>((done) => {
        const step = () => (--n <= 0 ? done() : requestAnimationFrame(step))
        requestAnimationFrame(step)
      })
      const enter = (name: string) => {
        for (const n of PLANS[name].plugins) load(catalog[n])
      }
      const leave = async (name: string) => {
        for (const n of [...PLANS[name].plugins].reverse()) await unload(n)
      }

      ctx.effect(() => {
        document.head.append(style)
        document.body.append(veil)
        return () => {
          veil.remove()
          style.remove()
          // The rooms this service loaded leave with it.
          const mine = new Set(Object.values(PLANS).flatMap((p) => p.plugins))
          for (const n of loadedNames()) if (mine.has(n)) void unload(n)
        }
      }, 'rooms')

      for (const name of keep ? Object.keys(PLANS) : [current]) enter(name)
      await view.travel(PLANS[current].home, 0)

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
          if (moving || name === current || !PLANS[name]) return
          moving = true
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
          if (!keep) enter(name)
          await settle(PLANS[name].plugins)
          await frames(2) // first frames compile the new room's shaders, still behind the veil
          if (!keep) await leave(from)
          current = name
          await view.travel(PLANS[name].arrive, 0)
          await frames(1)
          ctx.entries.sort()
          const t2 = performance.now()
          const walkIn = view.travel(PLANS[name].home, WALK)
          await fade(false)
          await walkIn
          lastMove = { walkOut: Math.round(t1 - t0), swap: Math.round(t2 - t1), walkIn: Math.round(performance.now() - t2) }
          ctx.entries.sort()
          moving = false
        },
      })
    },
  }
}
