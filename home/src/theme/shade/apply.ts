// Regroup S2 (#50): the theme owns the shading. Every lit material is sorted by what it is
// (./classify.ts) and rendered through a twin the theme's shading model makes (./models.ts).
// The scene keeps the plugins' own materials: the twin is swapped in per draw through the
// renderer's render-object hook, so picking, the hover glow and the theme plugin's role
// shifts all still act on the original, and the twin copies its live values every frame.
//
//   ?theme=comic&shade=1    the theme's model (comic: toon; neon-night: wet PBR)
//   ?theme=comic&shade=class  every class one flat colour, for a screenshot
//
// Without ?shade nothing here runs. Twins are released when their material leaves the
// scene, when the model changes, and on unload.
import * as THREE from 'three/webgpu'
import type { Context } from 'cordis'
import { theme } from '../index'
import { CLASSES, classify, type MaterialClass } from './classify'
import { keyDirection, makeTwin, type Model, type Twin } from './models'

const FLAG = new URLSearchParams(location.search).get('shade')

/** Each theme's model when its tokens don't name one. */
const DEFAULT_MODEL: Record<string, Model> = { comic: 'toon', 'neon-night': 'wet' }

const RESCAN = 15

export function shade(ctx: Context) {
  if (!FLAG || FLAG === '0') return
  const { scene, renderer } = ctx.stage
  const classes = new Map<THREE.Material, MaterialClass | null>()
  const where = new Map<THREE.Material, string>()
  const twins = new Map<THREE.Material, Twin>()
  let model: Model | null = null
  let frame = 0
  let key: THREE.DirectionalLight | null = null

  const modelFor = (): Model | null => {
    if (FLAG === 'class') return 'class'
    const t = theme()
    return t.shade ?? DEFAULT_MODEL[t.id] ?? null
  }
  const drop = (m: THREE.Material) => {
    twins.get(m)?.dispose()
    twins.delete(m)
  }
  const dropAll = () => {
    for (const t of twins.values()) t.dispose()
    twins.clear()
  }

  const walk = (sweep: boolean) => {
    const seen = new Set<THREE.Material>()
    scene.traverse((o) => {
      if ((o as THREE.DirectionalLight).isDirectionalLight && (o as THREE.DirectionalLight).castShadow) key = o as THREE.DirectionalLight
      const mats = (o as THREE.Mesh).material
      if (!mats || !(o as THREE.Mesh).isMesh) return
      if (o.userData.themeOwned) return
      for (const m of ([] as THREE.Material[]).concat(mats)) {
        seen.add(m)
        if (!classes.has(m)) {
          classes.set(m, kept(o) ? null : classify(m as never, o))
          where.set(m, `${o.parent?.name ?? ''}/${o.name}`)
        }
        const cls = classes.get(m)
        const old = twins.get(m)
        const map = (m as THREE.MeshStandardMaterial).map
        if (old && old.map !== map) drop(m)
        if (!cls || !model || twins.has(m)) continue
        const twin = makeTwin(model, m, cls)
        if (twin) twins.set(m, twin)
      }
    })
    if (!sweep) return
    for (const m of [...twins.keys()]) if (!seen.has(m)) drop(m)
    for (const m of [...classes.keys()]) if (!seen.has(m)) {
      classes.delete(m)
      where.delete(m)
    }
  }

  const swap = (object: THREE.Object3D, s: THREE.Scene, camera: THREE.Camera, geometry: THREE.BufferGeometry, material: THREE.Material, group: unknown, lightsNode: unknown, clip: unknown, passId: unknown) =>
    (renderer as unknown as { renderObject: (...a: unknown[]) => void }).renderObject(object, s, camera, geometry, twins.get(material)?.material ?? material, group, lightsNode, clip, passId)
  renderer.setRenderObjectFunction(swap as never)

  const direction = new THREE.Vector3()
  ctx.on('village/frame', () => {
    const next = modelFor()
    const changed = next !== model
    if (changed) {
      dropAll()
      model = next
    }
    // Every frame, before the theme plugin's walk in the same frame, so a new material is
    // classified from its plugin's own values, not the theme's overrides.
    walk(changed || ++frame % RESCAN === 0)
    for (const t of twins.values()) t.sync()
    if (key) {
      direction.copy(key.position).sub(key.target.position).normalize()
      keyDirection.value.copy(direction)
    }
  })

  // How the home sorts, for the prototype's report: window.villageShade.counts().
  const counts = () => {
    const out: Record<string, number> = Object.fromEntries([...CLASSES, 'unshaded'].map((c) => [c, 0]))
    for (const c of classes.values()) out[c ?? 'unshaded']++
    return out
  }
  const list = () => [...classes].map(([m, c]) => `${c ?? 'unshaded'}\t${m.type}\t${where.get(m)}\t${(m as THREE.MeshStandardMaterial).roughness ?? ''}`)
  ;(window as unknown as { villageShade?: unknown }).villageShade = { counts, list, twins: () => twins.size, twinOf: (m: THREE.Material) => twins.get(m)?.material, materials: () => [...classes.keys()], frames: () => frame }

  ctx.effect(() => () => {
    if (renderer.getRenderObjectFunction() === (swap as never)) renderer.setRenderObjectFunction(null)
    dropAll()
    classes.clear()
    where.clear()
    delete (window as unknown as { villageShade?: unknown }).villageShade
  }, 'shade')
}

/** A villager who keeps their own costume keeps their own shading too. */
function kept(o: THREE.Object3D): boolean {
  for (let p: THREE.Object3D | null = o; p; p = p.parent) if (p.userData.keepCostume === true) return true
  return false
}
