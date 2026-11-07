import * as THREE from 'three/webgpu'
import type { Context, Plugin } from 'cordis'
import { load, loadedNames, unload } from '../kernel'
import { DOORWAY, KITCHEN, LIVING_X, WALL_T } from '../layout'
import { MODE, OVERVIEW, type Frame, type Pose } from './camera'

export interface RoomPlan {
  /** Plugins that make up the room. Every room's plugins load at the start and stay. */
  plugins: string[]
  /** Where the seated view rests in the room. */
  home: Pose
  /** Where the dollhouse view frames the room: a floor point, a zoom (0 the whole house, 1 close) and a turn. */
  frame: Frame
}

export interface Rooms {
  /** The room the view is looking into. */
  readonly current: string
  /** True while the view glides to a room. */
  readonly moving: boolean
  /** Glide the view through the house to a room. No fade: the whole house is always there. */
  go(name: string): Promise<void>
  /** Duration of the last glide in ms, for measurement. */
  readonly lastMove: { glide: number } | null
}

declare module 'cordis' {
  interface Context {
    rooms: Rooms
  }
}

const pose = (p: [number, number, number], l: [number, number, number]): Pose => ({
  position: new THREE.Vector3(...p),
  look: new THREE.Vector3(...l),
})
/** The shared wall's centre line: looking left of it is the kitchen, right of it the living room. */
const SHARED_X = KITCHEN.x1 + WALL_T / 2
const GLIDE = 1.3 // seconds, dollhouse
const STEP = 0.9 // seconds per leg, seated view

export const PLANS: Record<string, RoomPlan> = {
  kitchen: {
    plugins: ['room', 'window', 'glass', 'sunbeam', 'cabinets', 'table', 'chairs', 'highchair', 'fridge',
      'toyshelf', 'botanical', 'plant', 'motes', 'lamp', 'rimlight', 'notebook', 'kitchendoor', 'furnish',
      ...(MODE === 'iso' ? ['diorama'] : [])],
    home: pose([0.1, 1.45, 2.7], [0.12, 1.05, -0.9]),
    frame: { x: 0.05, z: 0.75, zoom: 0.62 },
  },
  living: {
    plugins: ['lounge', 'sideboard', 'growshelves', 'plantstand', 'loungedoors', 'loungefurnish'],
    // The plants and shelves are the subject; the workshop door is a quiet right edge.
    home: pose([LIVING_X + 0.6, 1.4, 2.35], [LIVING_X - 0.12, 1.28, -2.2]),
    frame: { x: LIVING_X - 0.75, z: 0.75, zoom: 0.62 },
  },
}

/** A step either side of the doorway, for the seated view's walk between rooms. */
const DOOR_Z = (DOORWAY.z0 + DOORWAY.z1) / 2
const SIDES: Record<string, Pose> = {
  kitchen: pose([KITCHEN.x1 - 1.2, 1.5, DOOR_Z], [KITCHEN.x1 + 2, 1.35, DOOR_Z]),
  living: pose([KITCHEN.x1 + WALL_T + 1.2, 1.5, DOOR_Z], [KITCHEN.x1 - 2, 1.35, DOOR_Z]),
}

/**
 * The house's rooms are groups of plugins, all loaded for the whole visit and all
 * drawn: one connected house. Moving between rooms is a camera glide, never a swap.
 */
export function rooms(catalog: Record<string, Plugin & { name: string }>, start: string): Plugin & { name: string } {
  return {
    name: 'rooms',
    inject: ['stage', 'view', 'entries'],
    apply(ctx: Context) {
      const view = ctx.view
      const { scene } = ctx.stage
      let seated = PLANS[start] ? start : 'kitchen'
      let moving = false
      let lastMove: Rooms['lastMove'] = null

      ctx.effect(() => {
        const atmosphere = { fog: scene.fog, background: scene.background }
        scene.background = new THREE.Color('#2a1d16')
        scene.fog = new THREE.Fog('#e8c49a', 6, 22)
        return () => {
          scene.fog = atmosphere.fog
          scene.background = atmosphere.background
          // The rooms this service loaded leave with it.
          const mine = new Set(Object.values(PLANS).flatMap((p) => p.plugins))
          for (const n of loadedNames()) if (mine.has(n)) void unload(n)
        }
      }, 'rooms')

      const current = () => MODE === 'iso' ? (view.looking.x < SHARED_X ? 'kitchen' : 'living') : seated

      ctx.provide('rooms', {
        get current() {
          return current()
        },
        get moving() {
          return moving
        },
        get lastMove() {
          return lastMove
        },
        async go(name: string) {
          if (moving || !PLANS[name]) return
          if (MODE !== 'iso' && name === seated) return
          moving = true
          const t0 = performance.now()
          ctx.entries.back()
          ctx.entries.say(null)
          if (MODE === 'iso') await view.glide(PLANS[name].frame, GLIDE)
          else {
            // Through the real doorway: to this side of it, across, then into the room.
            await view.travel(SIDES[seated], STEP)
            await view.travel(SIDES[seated === 'kitchen' ? 'living' : 'kitchen'], STEP * 0.7)
            seated = name
            await view.travel(PLANS[name].home, STEP)
          }
          lastMove = { glide: Math.round(performance.now() - t0) }
          ctx.entries.sort()
          moving = false
        },
      })

      // Door plugins inject this service, which Cordis offers once apply returns,
      // so the rooms load after it, without apply waiting on them.
      // The dollhouse opens on the whole house; ?room= opens framed on that room.
      const asked = new URLSearchParams(location.search).get('room')
      if (MODE === 'iso') void view.glide(asked && PLANS[asked] ? PLANS[asked].frame : OVERVIEW, 0)
      else void view.travel(PLANS[seated].home, 0)
      for (const name of [seated, ...Object.keys(PLANS).filter((n) => n !== seated)]) for (const n of PLANS[name].plugins) load(catalog[n])
    },
  }
}
