// The plugin kernel is Cordis. This file only adds what Village needs on top:
// a typed stage service, scene-object ownership that reverses on unload, plugin
// failure handling, and Vite hot replacement that disposes the old fiber first.
import { Context, type Fiber, type Plugin } from 'cordis'
import type * as THREE from 'three/webgpu'

export type Quality = 'high' | 'medium' | 'low'

export interface Stage {
  renderer: THREE.WebGPURenderer
  scene: THREE.Scene
  camera: THREE.PerspectiveCamera
  /** The quality tier. Chosen from measured GPU time unless ?q= names one; may drop once after the first frames. */
  quality: Quality
  /** Rendering features on at the current tier (csm, gtao, traa, phys, ssgi), or exactly ?fx= when given. */
  features: () => Set<string>
  /**
   * Per frame, in ms: gpu is GPU busy time (the union of the frame's pass intervals from
   * timestamp queries, src/gpu-time.js), passSum the summed pass durations (they overlap,
   * so this overcounts), submitToDone the wait from the frame's last submit to
   * onSubmittedWorkDone (includes main-thread delay), cpu the JS frame (hooks and draw).
   * gpu and passSum are recorded while calibrating and under ?gpu=1, submitToDone under
   * ?gpu=1. tracking is whether timestamp queries are available.
   */
  timing: { gpu: number[]; submitToDone: number[]; passSum: number[]; cpu: number[]; tracking: boolean; tierReason: string }
  backend: 'WebGPU' | 'WebGL2'
  /** Draws one frame with the most recently added draw pass, or a plain render. */
  draw: () => void
  /**
   * Add a draw pass that replaces the plain render while it is present. Returns
   * its removal. Passes are removed by identity, so plugins can unload in any order.
   */
  addDrawPass: (pass: () => void) => () => void
  /** How many draw passes are present, for inspection. */
  drawPasses: () => number
}

declare module 'cordis' {
  interface Context {
    stage: Stage
  }
  interface Events {
    'village/frame'(dt: number, elapsed: number): void
    'village/plugin-error'(name: string, error: unknown): void
    'village/tier'(quality: Quality): void
    /** The theme changed (src/theme): previous and next, both checked Theme objects. */
    'village/theme'(previous: unknown, next: unknown): void
    /** Someone is about to change the look (the swatch book opened, a theme was asked for): load the theme plugin now. */
    'village/theme-prepare'(): void
  }
}

export const root = new Context()
const fibers = new Map<string, Fiber>()
/** Plugins whose last load failed, with the error. Cleared by the next load of that name. */
const failures = new Map<string, unknown>()

// Cordis FiberState values (a const enum in its typings, so not importable at runtime).
const FAILED = 3

// A plugin whose apply throws ends in FAILED after Cordis has already run the
// effects it registered. Surface the error and free the name for a fixed version.
// root.plugin() returns a wrapper whose prototype is the fiber, hence the lookup.
root.on('internal/status', (fiber) => {
  if (fiber.state !== FAILED) return
  const name = [...fibers].find(([, f]) => Object.getPrototypeOf(f) === fiber || f === fiber)?.[0]
  if (!name) return
  const error = (fiber as unknown as { _error: unknown })._error
  fibers.delete(name)
  failures.set(name, error)
  console.error(`Village plugin "${name}" failed to load:`, error)
  root.emit('village/plugin-error', name, error)
  void fiber.dispose()
})

export function load(plugin: Plugin & { name: string }): Fiber {
  const existing = fibers.get(plugin.name)
  if (existing) return existing
  failures.delete(plugin.name)
  const fiber = root.plugin(plugin)
  fibers.set(plugin.name, fiber)
  return fiber
}

export async function unload(name: string): Promise<boolean> {
  const fiber = fibers.get(name)
  if (!fiber) return false
  fibers.delete(name)
  await fiber.dispose()
  return true
}

export type PluginState = 'active' | 'loading' | 'waiting' | 'failed'

/** Each registered or failed plugin and its state. Waiting means a service it injects is missing. */
export function pluginStates(): Record<string, { state: PluginState; error?: string }> {
  const states: Record<string, { state: PluginState; error?: string }> = {}
  for (const [name, fiber] of fibers) {
    states[name] = { state: fiber.state === 2 ? 'active' : fiber.state === 0 ? 'waiting' : 'loading' }
  }
  for (const [name, error] of failures) states[name] = { state: 'failed', error: String(error) }
  return states
}

/** Dev hot reload: dispose the running version, then load the edited module. */
export async function replace(plugin: Plugin & { name: string }): Promise<void> {
  await unload(plugin.name)
  load(plugin)
}

export function loadedNames(): string[] {
  return [...fibers.keys()]
}

/**
 * Add an object to a parent for the lifetime of ctx. On unload the object is
 * removed and every geometry, material and texture under it is released.
 */
export function own<T extends THREE.Object3D>(ctx: Context, object: T, parent?: THREE.Object3D): T {
  ctx.effect(() => {
    ;(parent ?? ctx.stage.scene).add(object)
    return () => {
      object.removeFromParent()
      releaseGpu(object)
    }
  }, `own ${object.name || object.type}`)
  return object
}

export function releaseGpu(object: THREE.Object3D): void {
  const seen = new Set<object>()
  object.traverse((node) => {
    const mesh = node as THREE.Mesh
    if (mesh.geometry && !seen.has(mesh.geometry)) {
      seen.add(mesh.geometry)
      mesh.geometry.dispose()
    }
    const materials = mesh.material ? ([] as THREE.Material[]).concat(mesh.material) : []
    for (const material of materials) {
      if (seen.has(material)) continue
      seen.add(material)
      for (const value of Object.values(material)) {
        if (value && (value as THREE.Texture).isTexture && !seen.has(value)) {
          seen.add(value)
          ;(value as THREE.Texture).dispose()
        }
      }
      material.dispose()
    }
    const light = node as THREE.DirectionalLight
    if (light.isLight && light.shadow?.map) light.shadow.dispose()
  })
}
