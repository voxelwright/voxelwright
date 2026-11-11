// Things that break (#107). A brittle loose thing (glazed pottery, glass: hard, and not metal) hit
// hard enough for its weight comes apart: its own drawn triangles are dealt into shards, wedges
// round its upright axis and, for a tall thing, an upper and a lower band, each shard a body of
// the same material that flies, lands and can be picked up like anything else. The thing itself
// steps out of the world while it lies in pieces (`userData.body = false`, src/physics/home.ts).
// Tidying mends it: the shards go, and the thing stands where it was made, whole.
//
// A shard is the thing's own surface, so it is a shell with no thickness of its own: right for
// a plate or a jar's wall, and what a broken pot looks like from across the room.
import * as THREE from 'three/webgpu'
import type { Context } from 'cordis'
import type { PhysicsEvent } from '../engine/events'
import type { World } from '../engine/world'
import type { LooseParts } from '../kit'
import { voiceOf } from '../sound/palette/impact'

/**
 * m/s a blow must change a thing's speed by to break it, for glass; pottery takes a third as much again. A fall from
 * the table or a shelf breaks either; a plate let go half a metre up does not.
 */
const BREAKS_AT = 3.4
/** Shards a thing breaks into, at most (per band). */
const WEDGES = 5
/** Things that may break in one step: a shelf coming down is not thirty new sets of bodies at once. */
const PER_STEP = 2

interface Broken { holder: THREE.Object3D; body: unknown; shards: THREE.Group }

export function breaks(ctx: Context, world: World, emit: (e: PhysicsEvent) => void, rescan: () => void) {
  const group = new THREE.Group()
  group.name = 'broken things'
  const broken = new Map<string, Broken>()
  /** Puts every broken thing together again: its shards go, and it is a thing of the house once more. */
  function mend() {
    const keys = [...broken.keys()]
    for (const [key, b] of broken) {
      b.shards.removeFromParent()
      b.shards.traverse((o) => (o as THREE.Mesh).geometry?.dispose())
      b.holder.userData.body = b.body
      b.holder.visible = true
      broken.delete(key)
    }
    return keys
  }
  // Not `own`: a shard is drawn with the kit's shared material, which is not this plugin's to release,
  // and a thing left in pieces when the plugin unloads would stay hidden with no body. Unloading mends.
  ctx.effect(() => {
    group.userData.villagePlugin = ctx.fiber.name
    ctx.stage.scene.add(group)
    ctx.emit('village/owned', group, ctx.fiber.name)
    return () => {
      mend()
      group.removeFromParent()
    }
  }, 'broken things')
  let thisStep = 0

  /** Whether a material shatters: hard enough to ring, and not metal (the sound's own reading of its facts). */
  const brittle = (name: string) => {
    const v = voiceOf(name)
    return v.hard >= 0.8 && v.modes.length === 4 ? (v.hard >= 0.9 ? BREAKS_AT : BREAKS_AT * 1.35) : null
  }

  function shatter(key: string, at: THREE.Vector3) {
    const holder = world.boundObject(key)
    const loose = holder?.userData.loose as LooseParts | undefined
    const thing = world.thing(key)
    if (!holder || !loose || !thing || broken.has(key)) return false
    loose.cut()
    holder.updateWorldMatrix(true, true)
    const meshes = holder.children.filter((c): c is THREE.Mesh => (c as THREE.Mesh).isMesh)
    if (!meshes.length) return false
    // Its size, to choose the cut: a tall thing breaks in two bands.
    const size = new THREE.Box3()
    for (const m of meshes) {
      m.geometry.computeBoundingBox()
      size.union(m.geometry.boundingBox!)
    }
    const tall = size.max.y - size.min.y > 1.3 * Math.max(size.max.x - size.min.x, size.max.z - size.min.z)
    const mid = (size.max.y + size.min.y) / 2 + (Math.random() - 0.5) * 0.2 * (size.max.y - size.min.y)
    // Wedge edges at uneven angles, so no two things break alike.
    const edges = Array.from({ length: WEDGES }, (_, i) => ((i + Math.random() * 0.7) / WEDGES) * Math.PI * 2).sort((a, b) => a - b)
    const wedge = (x: number, z: number) => {
      const a = (Math.atan2(z, x) + Math.PI * 2) % (Math.PI * 2)
      let w = edges.findIndex((e) => a < e)
      if (w < 0) w = 0
      return w
    }
    const shards = new THREE.Group()
    shards.name = `${holder.name} shards`
    const parts = new Map<number, THREE.Group>()
    const centre = new THREE.Vector3()
    for (const mesh of meshes) {
      const g = mesh.geometry
      const pos = g.attributes.position as THREE.BufferAttribute
      const buckets = new Map<number, number[]>()
      for (let t = 0; t < pos.count; t += 3) {
        centre.set((pos.getX(t) + pos.getX(t + 1) + pos.getX(t + 2)) / 3, (pos.getY(t) + pos.getY(t + 1) + pos.getY(t + 2)) / 3, (pos.getZ(t) + pos.getZ(t + 1) + pos.getZ(t + 2)) / 3)
        const id = wedge(centre.x, centre.z) + (tall && centre.y > mid ? WEDGES : 0)
        let list = buckets.get(id)
        if (!list) buckets.set(id, (list = []))
        list.push(t)
      }
      for (const [id, tris] of buckets) {
        const piece = new THREE.BufferGeometry()
        for (const [name, a] of Object.entries(g.attributes) as [string, THREE.BufferAttribute][]) {
          const out = new Float32Array(tris.length * 3 * a.itemSize)
          tris.forEach((t, i) => out.set((a.array as Float32Array).subarray(t * a.itemSize, (t + 3) * a.itemSize), i * 3 * a.itemSize))
          piece.setAttribute(name, new THREE.BufferAttribute(out, a.itemSize))
        }
        let part = parts.get(id)
        if (!part) {
          parts.set(id, (part = new THREE.Group()))
          part.name = `${holder.name} shard`
        }
        const m = new THREE.Mesh(piece, mesh.material)
        m.castShadow = m.receiveShadow = true
        part.add(m)
      }
    }
    if (parts.size < 2) {
      for (const part of parts.values()) for (const m of part.children as THREE.Mesh[]) m.geometry.dispose()
      return false
    }
    // Each shard's frame is its own middle, so it tumbles about itself; all start where the thing was.
    const box = new THREE.Box3(), mid3 = new THREE.Vector3(), out = new THREE.Vector3()
    const share = thing.mass / parts.size
    const v = thing.velocity
    for (const part of parts.values()) {
      box.makeEmpty()
      for (const m of part.children as THREE.Mesh[]) {
        m.geometry.computeBoundingBox()
        box.union(m.geometry.boundingBox!)
      }
      box.getCenter(mid3)
      for (const m of part.children as THREE.Mesh[]) m.geometry.translate(-mid3.x, -mid3.y, -mid3.z)
      part.position.copy(mid3).applyMatrix4(holder.matrixWorld)
      holder.getWorldQuaternion(part.quaternion)
      part.userData.body = { motion: 'dynamic', material: thing.material, mass: Math.max(0.02, share) }
      // Thrown outward from where it was hit, on top of the speed the thing had.
      out.copy(part.position).sub(at)
      out.y = Math.abs(out.y) + 0.05
      out.normalize().multiplyScalar(0.6 + Math.random() * 0.9)
      part.userData.fling = [v[0] * 0.6 + out.x, v[1] * 0.3 + out.y, v[2] * 0.6 + out.z]
      shards.add(part)
    }
    // The thing itself leaves the world while it lies in pieces.
    broken.set(key, { holder, body: holder.userData.body, shards })
    holder.userData.body = false
    holder.visible = false
    group.add(shards)
    // Their bodies, and the thing's leaving, at the next read of the scene (not now: this runs inside a step).
    rescan()
    emit({ kind: 'broke', thing: key, material: thing.material, at: { x: at.x, y: at.y, z: at.z }, pieces: parts.size })
    return true
  }

  // Once the shards have their bodies, each is sent on its way.
  const send = () => {
    for (const b of broken.values()) for (const part of b.shards.children) {
      const fling = part.userData.fling as [number, number, number] | undefined
      if (!fling) continue
      const key = world.keyOf(part)
      if (!key) continue
      delete part.userData.fling
      world.setVelocity(key, fling)
    }
  }

  const hit = new THREE.Vector3()
  ctx.on('village/physics', (e) => {
    if (e.kind !== 'impact' || thisStep >= PER_STEP) return
    for (const [key, material] of [[e.a, e.materials[0]], [e.b, e.materials[1]]] as const) {
      const limit = brittle(material)
      // In the hand a thing is safe: carrying a plate into the table edge does not cost the plate.
      if (limit === null || broken.has(key) || world.isHeld(key)) continue
      const mass = world.thing(key)?.mass
      if (!mass || !Number.isFinite(mass) || (e.impulse * e.impact) / mass < limit) continue
      if (shatter(key, hit.set(e.at.x, e.at.y, e.at.z))) thisStep++
    }
  })
  ctx.on('village/frame', () => {
    thisStep = 0
    send()
  })

  return {
    /** Keys of the things lying in pieces. */
    broken: () => [...broken.keys()],
    /** Breaks a thing now, as if struck at its middle (checks, and later a gadget or an ask). */
    shatter: (key: string) => {
      const p = world.thing(key)?.position
      return Boolean(p && shatter(key, hit.set(p[0], p[1], p[2])))
    },
    mend,
  }
}
