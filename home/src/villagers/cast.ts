// What every group of villagers in the kitchen shares: a contact shadow under
// each one, and walkers that yield to whoever is just ahead.
import * as THREE from 'three/webgpu'
import { canvas, toTexture } from '../paint'
import type { Villager } from './rig'

/** A soft contact shadow per villager: a dark core where it touches and a wide falloff. */
export function contactShadows(villagers: Villager[]): THREE.Mesh[] {
  const [blobCanvas, b] = canvas(128, 128)
  const grad = b.createRadialGradient(64, 64, 2, 64, 64, 62)
  grad.addColorStop(0, 'rgba(46, 24, 10, 0.92)')
  grad.addColorStop(0.22, 'rgba(52, 28, 12, 0.72)')
  grad.addColorStop(0.5, 'rgba(60, 32, 14, 0.3)')
  grad.addColorStop(1, 'rgba(70, 40, 20, 0)')
  b.fillStyle = grad
  b.fillRect(0, 0, 128, 128)
  const map = toTexture(blobCanvas)
  const geo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2)
  return villagers.map((v) => {
    const blob = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map, transparent: true, depthWrite: false }))
    blob.material.userData.themeRole = 'contact'
    blob.name = `${v.fig.root.name} shadow`
    blob.renderOrder = -1
    return blob
  })
}

/** Takes contactShadows' blobs out of the scene and frees what they hold: each material, and the geometry and texture they share. */
export function disposeShadows(blobs: THREE.Mesh[]) {
  const shared = new Set<{ dispose(): void }>()
  for (const b of blobs) {
    b.removeFromParent()
    const m = b.material as THREE.MeshBasicMaterial
    if (m.map) shared.add(m.map)
    shared.add(b.geometry)
    m.dispose()
  }
  for (const d of shared) d.dispose()
}

/** One frame for a group: yielding, the rig, and the shadows following. */
export function stepCrowd(villagers: Villager[], blobs: THREE.Mesh[], dt: number, t: number, eye: THREE.Vector3, scale: number) {
  // Walkers wait for whoever is just ahead.
  villagers.forEach((v, i) => {
    v.blocked = villagers.some((o, j) => {
      // Someone busy at a chore is walked past (and may be clipped), not waited for.
      if (o === v || o.seated > 0.5 || o.state === 'work') return false
      const dx = o.pos.x - v.pos.x, dz = o.pos.z - v.pos.z
      const d = Math.hypot(dx, dz)
      const ahead = (dx * Math.sin(v.yaw) + dz * Math.cos(v.yaw)) / (d || 1)
      // Two walkers facing each other: the first goes, even when both have already stopped.
      const mutual = (-dx * Math.sin(o.yaw) - dz * Math.cos(o.yaw)) / (d || 1) > 0.4 && o.state === 'walk'
      return d < 0.5 * scale && ahead > 0.4 && !(mutual && i < j)
    })
  })
  // Walkers step around anyone standing still (at a chore, chosen, seated), then rejoin their path.
  for (const v of villagers) {
    let x = 0, z = 0
    if (v.state === 'walk') {
      const keep = 0.42 * scale
      for (const o of villagers) {
        if (o === v || o.state === 'walk') continue
        const dx = v.onPath.x - o.pos.x, dz = v.onPath.z - o.pos.z
        const d = Math.hypot(dx, dz)
        if (d >= keep) continue
        // Out sideways, across the walker's heading, on the side it already is.
        const sx = Math.cos(v.yaw), sz = -Math.sin(v.yaw)
        const side = dx * sx + dz * sz >= 0 ? 1 : -1
        x += sx * side * (keep - d)
        z += sz * side * (keep - d)
      }
    }
    const k = 1 - Math.exp(-dt * 5)
    v.sidestep.x += (x - v.sidestep.x) * k
    v.sidestep.z += (z - v.sidestep.z) * k
  }
  villagers.forEach((v, i) => {
    v.update(dt, t, eye)
    const blob = blobs[i]
    const sitting = v.seated > 0.5
    // At least as wide as the body, when its maker measured it (root.userData.footprint, metres): a shell or a skirt hides a small one.
    const r = Math.max(v.fig.side * 3.0 * scale + 0.12, (v.fig.root.userData.footprint as number | undefined) ?? 0)
    const lift = v.fig.floats ? 0.12 + v.fig.hip : 0
    const air = Math.max(0, v.pos.y - (sitting ? v.seatY : 0)) + lift
    blob.position.set(v.pos.x, (sitting ? v.seatY + 0.045 : 0) + 0.004, v.pos.z)
    blob.scale.setScalar(r * (1 + air * 1.5) * (sitting ? 0.8 : 1))
    ;(blob.material as THREE.MeshBasicMaterial).opacity = Math.max(0.15, 1 - air * 3)
  })
}
