// The theme owns the world outside (#50, regroup S1). A theme's `world` token names one of
// WORLDS; it hides the default exterior (objects tagged `userData.exterior`: the yard, its
// fence and stones, the trees, the garden plot, the worktable and the window's painted card)
// and stands its own, built in code around the house's measured bounds. `&world=0` turns
// worlds off, for comparisons.
import * as THREE from 'three/webgpu'
import type { Theme } from '../tokens'
import { chosen } from '../index'
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

/** The theme plugin's hook: `ahead(t)` whenever the chosen look changes, `place(t)` on every walk, `drop()` on unload. */
export function worlds(scene: THREE.Scene) {
  let stood: { key: string; world: World } | null = null
  /** Worlds built ahead for the chosen look, by key, not yet stood; only the chosen look's is ever kept. */
  const built = new Map<string, World>()
  const hidden = new Set<THREE.Object3D>()
  const retired: Array<{ world: World; timer: ReturnType<typeof setTimeout> }> = []
  const free = (entry: { world: World; timer: ReturnType<typeof setTimeout> }) => {
    clearTimeout(entry.timer)
    retired.splice(retired.indexOf(entry), 1)
    entry.world.dispose()
  }
  /** Out of the scene now, freed after RETIRE_MS: a compile may still be running over it. */
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
    for (const world of built.values()) world.dispose()
    built.clear()
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
    world.group.userData.body = false // scenery round the house, not things in it (src/physics/home.ts)
    world.group.userData.themeOwned = true
    return world
  }
  /**
   * The chosen look is now `t`. Every world built ahead for another look is retired; the one
   * `t` will stand is built now, on a frame while the current look still draws, so the frame
   * that swaps the look in does not build it too (30 to 40 ms for the neon city).
   */
  const ahead = (t: Theme) => {
    const want = wanted(t)
    for (const [key, world] of built) if (key !== want?.key) {
      built.delete(key)
      retire(world)
    }
    if (want && stood?.key !== want.key && !built.has(want.key)) built.set(want.key, build(want.name, want.house))
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
      const world = built.get(want.key) ?? build(want.name, want.house)
      built.delete(want.key)
      scene.add(world.group)
      stood = { key: want.key, world }
      // The chosen look stands: anything else built ahead (for walls measured before a room changed) is stale.
      if (t === chosen()) {
        for (const w of built.values()) retire(w)
        built.clear()
      }
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
   * puts it all back. Returns the group stood ahead, if any. A compile for a look no longer
   * chosen (a later switch took over) gets nothing: its chain is never shown, and building
   * or replacing worlds for it would throw away the chosen look's.
   */
  let shown: Array<[THREE.Object3D, boolean]> = []
  let added: THREE.Group | null = null
  const preview = (t: Theme, on: boolean): THREE.Group | null => {
    if (!on) {
      for (const [o, v] of shown) o.visible = v
      shown = []
      added?.removeFromParent()
      added = null
      return null
    }
    if (t !== chosen()) return null
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
    const next = want && !same ? built.get(want.key) : undefined
    if (!next) return null
    scene.add(next.group)
    added = next.group
    return added
  }
  /** For the checks: the stood world's key, the keys built ahead, and how many wait to be freed. */
  const state = () => ({ stood: stood?.key ?? null, ahead: [...built.keys()], retired: retired.length })
  return { ahead, place, preview, drop, state }
}
