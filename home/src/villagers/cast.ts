// What every group of villagers in the kitchen shares: a contact shadow under
// each one, and walkers that yield to whoever is just ahead.
import * as THREE from 'three/webgpu'
import { canvas, toTexture } from '../paint'
import { SEAT_Y } from './world'
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
    blob.name = `${v.fig.root.name} shadow`
    blob.renderOrder = -1
    return blob
  })
}

/** One frame for a group: yielding, the rig, and the shadows following. */
export function stepCrowd(villagers: Villager[], blobs: THREE.Mesh[], dt: number, t: number, eye: THREE.Vector3, scale: number) {
  // Walkers wait for whoever is just ahead; of two facing each other, the first goes.
  villagers.forEach((v, i) => {
    v.blocked = villagers.some((o, j) => {
      if (o === v || o.seated > 0.5) return false
      const dx = o.pos.x - v.pos.x, dz = o.pos.z - v.pos.z
      const d = Math.hypot(dx, dz)
      const ahead = (dx * Math.sin(v.yaw) + dz * Math.cos(v.yaw)) / (d || 1)
      const mutual = (-dx * Math.sin(o.yaw) - dz * Math.cos(o.yaw)) / (d || 1) > 0.4 && o.walk > 0.1
      return d < 0.5 * scale && ahead > 0.4 && !(mutual && i < j)
    })
  })
  villagers.forEach((v, i) => {
    v.update(dt, t, eye)
    const blob = blobs[i]
    const sitting = v.seated > 0.5
    const r = v.fig.side * 3.0 * scale + 0.12
    const lift = v.fig.floats ? 0.12 + v.fig.hip : 0
    const air = Math.max(0, v.pos.y - (sitting ? SEAT_Y : 0)) + lift
    blob.position.set(v.pos.x, (sitting ? SEAT_Y + 0.045 : 0) + 0.004, v.pos.z)
    blob.scale.setScalar(r * (1 + air * 1.5) * (sitting ? 0.8 : 1))
    ;(blob.material as THREE.MeshBasicMaterial).opacity = Math.max(0.15, 1 - air * 3)
  })
}
