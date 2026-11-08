import RAPIER from '@dimforge/rapier3d-compat'
import { DEFAULT_RULES, type BodyId, type BodySpec, type Contact, type HingeSpec, type JointId, type PhysicsCore, type Rules, type Vec3 } from './core.ts'

let ready: Promise<void> | undefined
export function loadRapier(): Promise<void> {
  ready ??= RAPIER.init()
  return ready
}

const v = (a: Vec3) => ({ x: a[0], y: a[1], z: a[2] })

export function createRapier(): PhysicsCore {
  const rules: Rules = { ...DEFAULT_RULES }
  const world = new RAPIER.World(v(rules.gravity))
  const queue = new RAPIER.EventQueue(true)
  const bodies: RAPIER.RigidBody[] = []
  const colliders: RAPIER.Collider[] = []
  const specs: BodySpec[] = []
  const byCollider = new Map<number, BodyId>()
  const joints: RAPIER.RevoluteImpulseJoint[] = []
  let ground: RAPIER.RigidBody | undefined
  let fresh: Contact[] = []
  const pending = new Map<string, [number, number]>()

  function colliderDesc(spec: BodySpec): RAPIER.ColliderDesc {
    const s = spec.shape
    let d: RAPIER.ColliderDesc
    if (s.kind === 'sphere') d = RAPIER.ColliderDesc.ball(s.radius)
    else if (s.kind === 'box') d = RAPIER.ColliderDesc.cuboid(...s.half)
    else if (s.kind === 'capsule') d = RAPIER.ColliderDesc.capsule(s.halfHeight, s.radius)
    else {
      // Rapier wants (nrows+1) x (ncols+1) samples, column-major; rows run along z, columns along x.
      const n = s.n
      const h = new Float32Array(n * n)
      for (let z = 0; z < n; z++) for (let x = 0; x < n; x++) h[x * n + z] = s.heights[z * n + x]
      d = RAPIER.ColliderDesc.heightfield(n - 1, n - 1, h, { x: s.size, y: 1, z: s.size })
    }
    return d
      .setFriction(spec.material.friction)
      .setRestitution(spec.material.restitution)
      .setDensity(spec.material.density)
      .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS | RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS)
      .setContactForceEventThreshold(0)
  }

  function attach(id: BodyId, spec: BodySpec) {
    const c = world.createCollider(colliderDesc(spec), bodies[id])
    colliders[id] = c
    byCollider.set(c.handle, id)
  }

  const core: PhysicsCore = {
    name: 'rapier',
    setRules(next) {
      Object.assign(rules, next)
      world.gravity = v(rules.gravity)
      world.lengthUnit = rules.lengthUnit
      for (const b of bodies) if (b && b.isDynamic()) b.enableCcd(rules.ccd)
    },
    addBody(spec) {
      const d = spec.motion === 'static' ? RAPIER.RigidBodyDesc.fixed() : spec.motion === 'kinematic' ? RAPIER.RigidBodyDesc.kinematicPositionBased() : RAPIER.RigidBodyDesc.dynamic()
      d.setTranslation(...spec.position)
      if (spec.rotation) d.setRotation({ x: spec.rotation[0], y: spec.rotation[1], z: spec.rotation[2], w: spec.rotation[3] })
      if (spec.velocity) d.setLinvel(...spec.velocity)
      if (spec.gravityScale !== undefined) d.setGravityScale(spec.gravityScale)
      if (spec.motion === 'dynamic') d.setCcdEnabled(rules.ccd)
      const id = bodies.length
      bodies.push(world.createRigidBody(d))
      specs.push(spec)
      attach(id, spec)
      return id
    },
    removeBody(id) {
      byCollider.delete(colliders[id].handle)
      world.removeRigidBody(bodies[id])
    },
    addHinge(spec: HingeSpec) {
      ground ??= world.createRigidBody(RAPIER.RigidBodyDesc.fixed())
      const p = bodies[spec.body].translation()
      const local = { x: spec.anchor[0] - p.x, y: spec.anchor[1] - p.y, z: spec.anchor[2] - p.z }
      const j = world.createImpulseJoint(RAPIER.JointData.revolute(v(spec.anchor), local, v(spec.axis)), ground, bodies[spec.body], true) as RAPIER.RevoluteImpulseJoint
      if (spec.limits) j.setLimits(...spec.limits)
      if (spec.motor) {
        j.configureMotorVelocity(spec.motor.velocity, 1e3)
        j.setMotorMaxForce(spec.motor.maxTorque)
      }
      joints.push(j)
      return joints.length - 1
    },
    setMotorVelocity(joint, velocity) {
      joints[joint].configureMotorVelocity(velocity, 1e3)
      joints[joint].body2().wakeUp()
    },
    step(dt) {
      world.timestep = dt / rules.substeps
      for (let i = 0; i < rules.substeps; i++) {
        world.step(queue)
        queue.drainCollisionEvents((h1, h2, started) => {
          const a = byCollider.get(h1), b = byCollider.get(h2)
          if (a === undefined || b === undefined) return
          if (started) pending.set(`${a}:${b}`, [h1, h2])
        })
        queue.drainContactForceEvents(e => {
          const a = byCollider.get(e.collider1()), b = byCollider.get(e.collider2())
          if (a === undefined || b === undefined) return
          const key = `${a}:${b}`
          if (!pending.has(key)) return
          pending.delete(key)
          let normal: Vec3 = [0, 0, 0], point: Vec3 = [0, 0, 0]
          world.contactPair(colliders[a], colliders[b], (m, flipped) => {
            const n = m.normal()
            normal = flipped ? [-n.x, -n.y, -n.z] : [n.x, n.y, n.z]
            const p = m.numSolverContacts() > 0 ? m.solverContactPoint(0) : null
            if (p) point = [p.x, p.y, p.z]
          })
          fresh.push({ a, b, point, normal, impulse: e.totalForceMagnitude() * world.timestep })
        })
      }
    },
    contacts() {
      const out = fresh
      fresh = []
      return out
    },
    applyImpulse(id, i) {
      bodies[id].applyImpulse(v(i), true)
    },
    position(id) {
      const t = bodies[id].translation()
      return [t.x, t.y, t.z]
    },
    velocity(id) {
      const t = bodies[id].linvel()
      return [t.x, t.y, t.z]
    },
    setState(id, p, vel, rot) {
      const b = bodies[id]
      b.setTranslation(v(p), true)
      b.setLinvel(v(vel), true)
      b.setAngvel({ x: 0, y: 0, z: 0 }, true)
      if (rot) b.setRotation({ x: rot[0], y: rot[1], z: rot[2], w: rot[3] }, true)
    },
    setKinematicTarget(id, p) {
      bodies[id].setNextKinematicTranslation(v(p))
    },
    sleeping(id) {
      return bodies[id].isSleeping()
    },
    editHeights(id, x0, z0, w, h, values) {
      // Rapier has no in-place height edit: rebuild the collider.
      const s = specs[id].shape
      if (s.kind !== 'heightfield') throw new Error('not a heightfield')
      for (let z = 0; z < h; z++) for (let x = 0; x < w; x++) s.heights[(z0 + z) * s.n + x0 + x] = values[z * w + x]
      byCollider.delete(colliders[id].handle)
      world.removeCollider(colliders[id], true)
      attach(id, specs[id])
    },
    overlapSphere(c, r) {
      const out: BodyId[] = []
      const ball = new RAPIER.Ball(r)
      world.intersectionsWithShape(v(c), { x: 0, y: 0, z: 0, w: 1 }, ball, col => {
        const id = byCollider.get(col.handle)
        if (id !== undefined) out.push(id)
        return true
      })
      return out
    },
    dispose() {
      queue.free()
      world.free()
    },
  }
  return core
}
