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
import { pastoralHills } from './pastoral'
import { pixelLot } from './pixel'

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
  'pastoral-hills': pastoralHills,
  'pixel-lot': pixelLot,
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

/**
 * How long a world that left the scene waits before it is freed. A theme switch compiles the
 * next look's chain with renderer.compileAsync over the scene as it stood when the switch
 * began; freeing a world's geometry while that compile is in flight lets the compile upload
 * it again, and nothing frees it after (check-themes saw exactly one neon world left over).
 */
const RETIRE_MS = 4000

/** The theme plugin's hook: `ahead(t)` while a switch heads to `t`, `place(t)` on every walk, `drop()` on unload. */
export function worlds(scene: THREE.Scene) {
  let stood: { key: string; world: World } | null = null
  let next: { key: string; world: World } | null = null
  const hidden = new Set<THREE.Object3D>()
  const retired: Array<{ world: World; timer: ReturnType<typeof setTimeout> }> = []
  const free = (entry: { world: World; timer: ReturnType<typeof setTimeout> }) => {
    clearTimeout(entry.timer)
    retired.splice(retired.indexOf(entry), 1)
    entry.world.dispose()
  }
  const retire = (world: World) => {
    world.group.removeFromParent()
    const entry = { world, timer: setTimeout(() => free(entry), RETIRE_MS) }
    retired.push(entry)
  }
  const unstand = () => {
    if (!stood) return
    retire(stood.world)
    stood = null
  }
  /**
   * The chosen look came back to the one on screen: a world built ahead for the abandoned
   * switch is not wanted. Retired rather than freed, since that switch's compile may still be
   * running over it; one still stood for a compile (preview) is left to the next ahead() or drop().
   */
  const abandon = () => {
    if (!next || next.world.group.parent) return
    retire(next.world)
    next = null
  }
  /** Is `o` still in the scene? A room that unloaded takes its exterior with it. */
  const inScene = (o: THREE.Object3D) => {
    let p: THREE.Object3D | null = o
    while (p && p !== scene) p = p.parent
    return p === scene
  }
  const clear = () => {
    unstand()
    for (const o of hidden) o.visible = true
    hidden.clear()
  }
  /** On unload: put the yard back and free every world now. */
  const drop = () => {
    clear()
    next?.world.dispose()
    next = null
    while (retired.length) free(retired[0])
  }
  /**
   * The world `t` stands and its key. Keyed on the walls only: the window card sways a
   * couple of centimetres in the wind (../../plugins/window.ts), and keyed on it too the
   * world was rebuilt every few walks, 15 to 40 ms each time. No world reads `view`.
   */
  const wanted = (t: Theme) => {
    const name = OFF ? undefined : t.world
    const house = name && Object.hasOwn(WORLDS, name) ? measure(scene) : null
    if (!name || !house) return null
    return { name, house, key: JSON.stringify([name, house.x0, house.x1, house.z0, house.z1, house.top]) }
  }
  const build = (name: string, house: House) => {
    const world = WORLDS[name](house)
    world.group.name = `theme world ${name}`
    world.group.userData.themeOwned = true
    return world
  }
  /**
   * Build the world a switch is heading to on a frame while the current look still draws,
   * so the frame that swaps the look in does not build it too (30 to 40 ms for the neon city).
   * It was never in the scene, so one no switch takes is freed at once.
   */
  const ahead = (t: Theme) => {
    const want = wanted(t)
    if (want && (stood?.key === want.key || next?.key === want.key)) return
    next?.world.dispose()
    next = want && { key: want.key, world: build(want.name, want.house) }
  }
  /** Stands the theme's world (or puts the yard back) and returns what stands, for ../interior/sun.ts. */
  const place = (t: Theme): { house: House; group: THREE.Group } | null => {
    const want = wanted(t)
    if (!want) {
      clear()
      return null
    }
    if (stood?.key !== want.key) {
      unstand()
      let world = next?.key === want.key ? next.world : null
      if (world) next = null
      else world = build(want.name, want.house)
      scene.add(world.group)
      stood = { key: want.key, world }
    }
    // Forget the exteriors of rooms that unloaded, so the set holds only what is in the scene.
    for (const o of hidden) if (!inScene(o)) hidden.delete(o)
    scene.traverse((o) => {
      if (o.userData.exterior && o.visible) {
        o.visible = false
        hidden.add(o)
      }
    })
    return { house: want.house, group: stood!.world.group }
  }
  /**
   * For the next chain's compile (../ahead.ts): stand the world `t` will stand, ahead, in
   * place of the current one, with the yard shown or hidden as `t` will have it; `on` false
   * puts it all back. Returns the group stood ahead, if any.
   */
  let shown: Array<[THREE.Object3D, boolean]> = []
  const preview = (t: Theme, on: boolean): THREE.Group | null => {
    if (!on) {
      for (const [o, v] of shown) o.visible = v
      shown = []
      next?.world.group.removeFromParent()
      return null
    }
    ahead(t)
    const want = wanted(t)
    const same = want && stood?.key === want.key
    const show = (o: THREE.Object3D, v: boolean) => {
      shown.push([o, o.visible])
      o.visible = v
    }
    if (stood && !same) show(stood.world.group, false)
    if (!want) for (const o of hidden) show(o, true)
    else if (!stood) scene.traverse((o) => { if (o.userData.exterior && o.visible) show(o, false) })
    if (!next || same) return null
    scene.add(next.world.group)
    return next.world.group
  }
  return { ahead, abandon, place, preview, drop }
}
