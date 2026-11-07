// Doorways and window openings, shared by the plugins that cut them.
import * as THREE from 'three/webgpu'

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

/**
 * The lining of an opening w wide and h tall through a wall `depth` thick: jambs and a
 * head (and a stool when `sill`), its bottom centre at the origin, the wall's room face
 * at z = 0 and its far face at z = -depth. Each piece reaches 2 mm into the wall, so the
 * wall's own reveal faces are buried in solid wood and no two visible faces share a
 * plane (the doorway and window flicker of #42 was exactly that). The casing on the
 * wall's face covers the 2 mm seams.
 */
export function lining(w: number, h: number, depth: number, sill = false, color = '#efe6d6'): THREE.Group {
  const group = new THREE.Group()
  group.name = 'lining'
  const material = new THREE.MeshStandardMaterial({ color, roughness: 0.6 })
  const BURY = 0.002, THICK = 0.03
  const piece = (bw: number, bh: number, x: number, y: number) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(bw, bh, depth), material)
    m.position.set(x, y, -depth / 2)
    m.castShadow = m.receiveShadow = true
    group.add(m)
  }
  const sideW = THICK + BURY
  const bottom = sill ? -BURY : 0
  piece(sideW, h - bottom + BURY, -w / 2 + THICK / 2 - BURY / 2, (h + bottom + BURY) / 2)
  piece(sideW, h - bottom + BURY, w / 2 - THICK / 2 + BURY / 2, (h + bottom + BURY) / 2)
  piece(w - THICK * 2, THICK + BURY, 0, h - THICK / 2 + BURY / 2)
  if (sill) piece(w - THICK * 2, THICK + BURY, 0, THICK / 2 - BURY / 2)
  return group
}

/**
 * An open doorway through a wall `depth` thick: a lining, a threshold and a casing on
 * both faces. `sides[0]` is the room-side casing (facing +z), `sides[1]` the far side's;
 * each holds an unseen pick slab filling its half of the opening, so pointing into the
 * doorway from either room picks that side's entry.
 */
export function openDoorway(w: number, h: number, depth: number): THREE.Group & { sides: [THREE.Group, THREE.Group] } {
  const group = new THREE.Group() as THREE.Group & { sides: [THREE.Group, THREE.Group] }
  group.name = 'doorway'
  const pickMat = new THREE.MeshBasicMaterial({ visible: false })
  const side = (turn: number) => {
    const s = new THREE.Group()
    s.add(casing(w, h))
    const pick = new THREE.Mesh(new THREE.BoxGeometry(w, h, depth / 2), pickMat)
    pick.position.set(0, h / 2, -depth / 4)
    pick.userData.pick = true // seen by the entries' picking, never drawn
    s.add(pick)
    s.rotation.y = turn
    if (turn) s.position.z = -depth
    group.add(s)
    return s
  }
  group.sides = [side(0), side(Math.PI)]
  group.add(lining(w, h, depth))
  const sill = new THREE.Mesh(new THREE.BoxGeometry(w - 0.06, 0.012, depth + 0.02), new THREE.MeshStandardMaterial({ color: '#b8875c', roughness: 0.6 }))
  sill.position.set(0, 0.002, -depth / 2)
  sill.receiveShadow = true
  group.add(sill)
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
