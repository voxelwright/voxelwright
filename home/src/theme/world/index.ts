// Regroup S1 (#50): the theme owns the world outside. A world hides the default exterior
// (objects tagged `userData.exterior`: the yard, its fence and stones, the trees, the garden
// plot, the worktable and the window's painted card) and stands its own, built in code around
// the house's measured bounds. Prototype: on only with `&world=1`.
import * as THREE from 'three/webgpu'
import type { Theme } from '../tokens'
import { neonCity } from './neon'
import { comicPage } from './comic'

/** The house's outer bounds in world metres, measured from its walls. */
export interface House { x0: number; x1: number; z0: number; z1: number; top: number }

/** A stood world: its group (added by the manager) and what to free. */
export interface World { group: THREE.Group; dispose(): void }

const WORLDS: Record<string, (house: House) => World> = { 'neon-city': neonCity, 'comic-page': comicPage }
/** Until presets carry `world` (and check.ts knows it), the flag picks each look's world by id. */
const BY_THEME: Record<string, string> = { 'neon-night': 'neon-city', comic: 'comic-page' }
const ON = new URLSearchParams(location.search).get('world') === '1'

const box = new THREE.Box3()
const part = new THREE.Box3()
/** The union of every wall's bounds (the role lives on the material). Null before a room has walls. */
function measure(scene: THREE.Scene): House | null {
  box.makeEmpty()
  scene.traverse((o) => {
    const mesh = o as THREE.Mesh
    if (!mesh.isMesh || (mesh.material as THREE.Material).userData?.themeRole !== 'wall') return
    mesh.geometry.computeBoundingBox()
    box.union(part.copy(mesh.geometry.boundingBox!).applyMatrix4(mesh.matrixWorld))
  })
  if (box.isEmpty()) return null
  const r = (v: number) => Math.round(v * 100) / 100
  return { x0: r(box.min.x), x1: r(box.max.x), z0: r(box.min.z), z1: r(box.max.z), top: r(box.max.y) }
}

/** The theme plugin's hook: `place(t)` on every walk, `drop()` on unload. */
export function worlds(scene: THREE.Scene) {
  let stood: { key: string; world: World } | null = null
  const hidden = new Set<THREE.Object3D>()
  const unstand = () => {
    if (!stood) return
    stood.world.group.removeFromParent()
    stood.world.dispose()
    stood = null
  }
  const drop = () => {
    unstand()
    for (const o of hidden) o.visible = true
    hidden.clear()
  }
  const place = (t: Theme) => {
    const name = ON ? t.world ?? BY_THEME[t.id] : undefined
    const house = name && Object.hasOwn(WORLDS, name) ? measure(scene) : null
    if (!name || !house) return drop()
    const key = JSON.stringify([name, house])
    if (stood?.key !== key) {
      unstand()
      const world = WORLDS[name](house)
      world.group.name = `theme world ${name}`
      world.group.userData.themeOwned = true
      scene.add(world.group)
      stood = { key, world }
    }
    scene.traverse((o) => {
      if (o.userData.exterior && o.visible) {
        o.visible = false
        hidden.add(o)
      }
    })
  }
  return { place, drop }
}
