// How a resident is drawn (#118). One function owns it, because the look is expected to change:
// today it is one of the home's felt plush villagers (home/src/villagers/kinds.ts), grown to a
// person's height, wearing a scarf in its seat's colour, and walked by where its body goes. The
// page knows only the body's place each frame; which way it faces, its gait and its hop are
// worked out from how that place moves.
import * as THREE from 'three/webgpu'
import { KINDS, PLUSH } from '../../home/src/villagers/kinds'
import { HALF_H, RADIUS } from '../src/walk.ts'

export interface Resident {
  root: THREE.Object3D
  /** Once a frame: the middle of its body (the capsule's), seconds since the last frame, and whether it stands on something. */
  update(at: THREE.Vector3, dt: number): void
  dispose(): void
}

/** A walker's height from sole to crown, and how far a step carries it. */
const TALL = (HALF_H + RADIUS) * 2 - 0.06, STEP = 0.62
const turnTo = (from: number, to: number, share: number) => from + Math.atan2(Math.sin(to - from), Math.cos(to - from)) * share

/** A resident for seat number `n` (which plush it is) in the seat's colour. `phys` is whether the page draws felt with its sheen. */
export function resident(n: number, accent: string, phys: boolean): Resident {
  const fig = KINDS.b.build(n % PLUSH.length, phys, { accent })
  const grow = TALL / fig.height
  const root = new THREE.Group()
  root.add(fig.root)
  fig.root.scale.setScalar(grow)
  fig.root.traverse((o) => { if ((o as THREE.Mesh).isMesh) { o.castShadow = true; o.receiveShadow = true } })
  const rest = { feet: fig.feet.map((f) => f.position.clone()), hands: fig.hands.map((h) => h.position.clone()) }
  const last = new THREE.Vector3()
  let seen = false, facing = 0, phase = 0, walking = 0, air = 0, blink = 2 + Math.random() * 3, breath = Math.random() * 6
  return {
    root,
    update(at, dt) {
      if (!seen) { last.copy(at); seen = true }
      const h = Math.max(dt, 1e-3)
      const vx = (at.x - last.x) / h, vy = (at.y - last.y) / h, vz = (at.z - last.z) / h, speed = Math.hypot(vx, vz)
      last.copy(at)
      // It faces the way it goes, turning over a fifth of a second; standing, it keeps looking where it was going.
      if (speed > 0.4) facing = turnTo(facing, Math.atan2(vx, vz), 1 - Math.exp(-dt * 12))
      walking += ((speed > 0.3 ? Math.min(1, speed / 3) : 0) - walking) * (1 - Math.exp(-dt * 10))
      // Off the ground it rises or falls faster than any slope it could walk.
      air += ((Math.abs(vy) > 1.6 ? 1 : 0) - air) * (1 - Math.exp(-dt * 14))
      phase += (speed * dt) / (STEP * 2)
      breath += dt
      const swing = Math.sin(phase * Math.PI * 2), stride = (STEP / grow) * 0.5 * walking * (1 - air)
      root.position.set(at.x, at.y - HALF_H - RADIUS, at.z)
      root.rotation.y = facing
      // The body bobs twice a cycle, leans into its speed, and stretches a little in the air.
      fig.pose.position.y = fig.bob * Math.abs(Math.cos(phase * Math.PI * 2)) * walking * (1 - air) + 0.006 * Math.sin(breath * 1.7)
      fig.pose.rotation.x = 0.1 * walking + 0.12 * air
      fig.pose.scale.set(1 - 0.05 * air, 1 + 0.08 * air, 1 - 0.05 * air)
      fig.feet.forEach((foot, i) => {
        const side = i ? 1 : -1
        foot.position.set(rest.feet[i].x, rest.feet[i].y + Math.max(0, side * Math.cos(phase * Math.PI * 2)) * stride * 0.45 + 0.03 * air, rest.feet[i].z + side * swing * stride)
      })
      fig.hands.forEach((hand, i) => {
        const side = i ? -1 : 1
        hand.position.set(rest.hands[i].x, rest.hands[i].y + 0.04 * air, rest.hands[i].z + side * swing * stride * 0.7)
      })
      if (fig.soft) {
        fig.soft.waist.rotation.set(0.05 * walking, swing * 0.08 * walking, 0)
        fig.soft.chest.rotation.set(0.04 * walking, -swing * 0.1 * walking, 0)
      }
      blink -= dt
      const shut = blink < 0.12
      for (const eye of fig.eyes) eye.scale.y = shut ? 0.12 : 1
      if (blink < 0) blink = 2.5 + Math.random() * 3.5
    },
    dispose() {
      root.removeFromParent()
      const done = new Set<object>()
      root.traverse((o) => {
        const mesh = o as THREE.Mesh
        if (!mesh.isMesh) return
        for (const x of [mesh.geometry, ...([] as THREE.Material[]).concat(mesh.material)]) if (!done.has(x)) { done.add(x); x.dispose() }
      })
    },
  }
}
