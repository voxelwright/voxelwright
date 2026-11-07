// Doorways between rooms, shared by each room's door plugin.
import * as THREE from 'three/webgpu'
import { canvas, toTexture } from './paint'

const TRIM = 0.07

/** Casing around an opening w wide and h tall, its bottom centre at the origin, facing +z. */
export function casing(w: number, h: number, color = '#efe6d6'): THREE.Group {
  const group = new THREE.Group()
  const material = new THREE.MeshStandardMaterial({ color, roughness: 0.55 })
  const bar = (bw: number, bh: number, x: number, y: number) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(bw, bh, 0.04), material)
    m.position.set(x, y, 0.02)
    m.castShadow = true
    group.add(m)
  }
  bar(TRIM, h + TRIM, -w / 2 - TRIM / 2, (h + TRIM) / 2)
  bar(TRIM, h + TRIM, w / 2 + TRIM / 2, (h + TRIM) / 2)
  bar(w + TRIM * 2, TRIM, 0, h + TRIM / 2)
  return group
}

/** A warm glow on the far wall of a short passage: light from the next room. */
function paintPassage(warm: string): THREE.Texture {
  const [c, g] = canvas(256, 512)
  const grad = g.createLinearGradient(0, 0, 0, 512)
  grad.addColorStop(0, '#7a5c44')
  grad.addColorStop(0.55, '#c49a6c')
  grad.addColorStop(1, '#8a6a4c')
  g.fillStyle = grad
  g.fillRect(0, 0, 256, 512)
  const pool = g.createRadialGradient(150, 300, 10, 150, 300, 220)
  pool.addColorStop(0, warm)
  pool.addColorStop(1, 'rgba(0,0,0,0)')
  g.fillStyle = pool
  g.fillRect(0, 0, 256, 512)
  return toTexture(c)
}

/** An open doorway: casing plus a short passage that glows with the next room's light. */
export function openDoorway(w: number, h: number, depth: number, warm = 'rgba(255, 214, 150, 0.85)'): THREE.Group {
  const group = casing(w, h)
  group.name = 'doorway'
  const dim = new THREE.MeshStandardMaterial({ color: '#b8987a', roughness: 0.9 })
  const far = new THREE.Mesh(new THREE.PlaneGeometry(w + 0.6, h + 0.3), new THREE.MeshBasicMaterial({ map: paintPassage(warm) }))
  far.position.set(0.15, (h + 0.3) / 2, -depth)
  group.add(far)
  for (const side of [-1, 1]) {
    const wall = new THREE.Mesh(new THREE.PlaneGeometry(depth, h), dim)
    wall.rotation.y = side * -Math.PI / 2
    wall.position.set(side * w / 2, h / 2, -depth / 2)
    group.add(wall)
  }
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(w, depth), new THREE.MeshStandardMaterial({ color: '#a8835c', roughness: 0.7 }))
  floor.rotation.x = -Math.PI / 2
  floor.position.set(0, 0.002, -depth / 2)
  group.add(floor)
  return group
}

/** A closed panelled door in its casing, with a round brass knob. */
export function closedDoor(w: number, h: number, color = '#d9c8ad'): THREE.Group {
  const group = casing(w, h)
  group.name = 'closed door'
  const wood = new THREE.MeshStandardMaterial({ color, roughness: 0.6 })
  const leaf = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.04), wood)
  leaf.position.set(0, h / 2, -0.01)
  leaf.castShadow = leaf.receiveShadow = true
  group.add(leaf)
  const inset = new THREE.MeshStandardMaterial({ color: new THREE.Color(color).multiplyScalar(0.93), roughness: 0.65 })
  for (const [y, ph] of [[h * 0.72, h * 0.36], [h * 0.26, h * 0.34]]) {
    const panel = new THREE.Mesh(new THREE.BoxGeometry(w * 0.7, ph, 0.012), inset)
    panel.position.set(0, y, 0.014)
    group.add(panel)
  }
  const knob = new THREE.Mesh(new THREE.SphereGeometry(0.03, 16, 12), new THREE.MeshStandardMaterial({ color: '#c79a52', metalness: 0.9, roughness: 0.3 }))
  knob.position.set(w / 2 - 0.08, h * 0.48, 0.05)
  group.add(knob)
  return group
}
