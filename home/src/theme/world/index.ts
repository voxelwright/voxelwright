// The theme owns the world outside (#50, regroup S1). A theme's `world` token names one of
// WORLDS; it hides the default exterior (objects tagged `userData.exterior`: the yard, its
// fence and stones, the trees, the garden plot, the worktable and the window's painted card)
// and stands its own, built in code around the house's measured bounds. `&world=0` turns
// worlds off, for comparisons.
import * as THREE from 'three/webgpu'
import type { Theme } from '../tokens'
import { neonCity } from './neon'
import { comicPage } from './comic'
import { twilightStreet } from './twilight'

/** Where the window's own painted card hung: its centre and size, so a world can hang its own there. */
export interface View { x: number; y: number; z: number; w: number; h: number }
/** The house's outer bounds in world metres, measured from its walls, and the window card. */
export interface House { x0: number; x1: number; z0: number; z1: number; top: number; view: View | null }

/** A stood world: its group (added by the manager) and what to free. */
export interface World { group: THREE.Group; dispose(): void }

/** Every world a theme may name. check.ts accepts exactly these keys. One line per world. */
export const WORLDS: Record<string, (house: House) => World> = {
  'neon-city': neonCity,
  'comic-page': comicPage,
  'twilight-street': twilightStreet,
}
const OFF = new URLSearchParams(location.search).get('world') === '0'

const box = new THREE.Box3()
const part = new THREE.Box3()
const card = new THREE.Box3()
/** The union of every wall's bounds (the role lives on the material), and the window card's. Null before a room has walls. */
function measure(scene: THREE.Scene): House | null {
  box.makeEmpty()
  card.makeEmpty()
  scene.traverse((o) => {
    const mesh = o as THREE.Mesh
    const role = mesh.isMesh ? (mesh.material as THREE.Material).userData?.themeRole : undefined
    if (role !== 'wall' && !(role === 'view' && o.userData.exterior)) return
    mesh.geometry.computeBoundingBox()
    part.copy(mesh.geometry.boundingBox!).applyMatrix4(mesh.matrixWorld)
    ;(role === 'wall' ? box : card).union(part)
  })
  if (box.isEmpty()) return null
  const r = (v: number) => Math.round(v * 100) / 100
  const view = card.isEmpty() ? null : {
    x: r((card.min.x + card.max.x) / 2), y: r((card.min.y + card.max.y) / 2), z: r((card.min.z + card.max.z) / 2),
    w: r(card.max.x - card.min.x), h: r(card.max.y - card.min.y),
  }
  return { x0: r(box.min.x), x1: r(box.max.x), z0: r(box.min.z), z1: r(box.max.z), top: r(box.max.y), view }
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
    const name = OFF ? undefined : t.world
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
