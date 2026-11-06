// The plugin kernel is Cordis. This file only adds what Village needs on top:
// a typed stage service, scene-object ownership that reverses on unload, and
// Vite hot replacement that disposes the old fiber before loading the new one.
import { Context, type Fiber, type Plugin } from 'cordis'
import type * as THREE from 'three/webgpu'

export type Quality = 'high' | 'low'

export interface Stage {
  renderer: THREE.WebGPURenderer
  scene: THREE.Scene
  camera: THREE.PerspectiveCamera
  quality: Quality
  backend: 'WebGPU' | 'WebGL2'
  /** The function that draws one frame. Post-processing swaps it and restores it on unload. */
  draw: () => void
}

declare module 'cordis' {
  interface Context {
    stage: Stage
  }
  interface Events {
    'village/frame'(dt: number, elapsed: number): void
  }
}

export const root = new Context()
const fibers = new Map<string, Fiber>()

export function load(plugin: Plugin & { name: string }): Fiber {
  const existing = fibers.get(plugin.name)
  if (existing) return existing
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
