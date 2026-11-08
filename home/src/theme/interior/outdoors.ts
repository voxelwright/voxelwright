// Indoor lights stay indoors (#50). Point and spot lights cast no shadows here, so the house's
// lamps lit a theme world's yard straight through the walls: a faint ring around the house on
// the 16-bit lot. A world's lit materials are given their own light list (the sun, the sky
// fill, the rim, and any light the world stands itself), which also spares them the cost of
// every lamp in the house. Set in the walk that stands the world, before its first draw, so it
// adds no compile of its own.
import * as THREE from 'three/webgpu'
import { lights } from 'three/tsl'

/** A lit material: a node material that says so, or a classic one with an emissive (standard, physical, lambert, phong, toon). */
type Lit = THREE.Material & { lights?: boolean; emissive?: THREE.Color; lightsNode?: THREE.LightsNode | null }

export function outdoors(scene: THREE.Scene) {
  let key = ''
  let node: THREE.LightsNode | null = null
  const list: THREE.Light[] = []
  const inside = (o: THREE.Object3D, group: THREE.Object3D) => {
    for (let p: THREE.Object3D | null = o; p; p = p.parent) if (p === group) return true
    return false
  }
  return (group: THREE.Group | null) => {
    if (!group) return
    list.length = 0
    scene.traverse((o) => {
      const l = o as THREE.Light & { isPointLight?: boolean; isSpotLight?: boolean }
      if (l.isLight && (!(l.isPointLight || l.isSpotLight) || inside(l, group))) list.push(l)
    })
    const now = list.map((l) => l.id).join()
    if (now !== key || !node) {
      key = now
      node = lights([...list])
    }
    group.traverse((o) => {
      const mats = (o as THREE.Mesh).material
      if (!mats) return
      for (const m of ([] as Lit[]).concat(mats as Lit)) {
        if (!(m.lights ?? m.emissive) || m.lightsNode === node) continue
        m.lightsNode = node
        m.needsUpdate = true
      }
    })
  }
}
