import initJolt from 'jolt-physics/wasm-compat'
import { DEFAULT_RULES, type BodyId, type BodySpec, type Contact, type HingeSpec, type PhysicsCore, type Rules, type Vec3 } from './core.ts'

type J = Awaited<ReturnType<typeof initJolt>>
let J: J
export async function loadJolt() {
  J ??= await initJolt()
}

const NON_MOVING = 0, MOVING = 1

/**
 * Options the bench toggles: `listener` installs the JS contact listener (contact
 * events, per-pair material combine, impulse estimates). It is what Village's
 * gadget layer needs, and it costs a JS call per contact.
 */
export function createJolt(opts: { listener?: boolean; wakeOnEdit?: boolean } = {}): PhysicsCore {
  const listen = opts.listener ?? true
  const rules: Rules = { ...DEFAULT_RULES }
  const settings = new J.JoltSettings()
  settings.mMaxWorkerThreads = 0
  const pairs = new J.ObjectLayerPairFilterTable(2)
  pairs.EnableCollision(NON_MOVING, MOVING)
  pairs.EnableCollision(MOVING, MOVING)
  const bpStatic = new J.BroadPhaseLayer(0), bpMoving = new J.BroadPhaseLayer(1)
  const bpi = new J.BroadPhaseLayerInterfaceTable(2, 2)
  bpi.MapObjectToBroadPhaseLayer(NON_MOVING, bpStatic)
  bpi.MapObjectToBroadPhaseLayer(MOVING, bpMoving)
  settings.mObjectLayerPairFilter = pairs
  settings.mBroadPhaseLayerInterface = bpi
  settings.mObjectVsBroadPhaseLayerFilter = new J.ObjectVsBroadPhaseLayerFilterTable(bpi, 2, pairs, 2)
  const jolt = new J.JoltInterface(settings)
  J.destroy(settings)
  const system = jolt.GetPhysicsSystem()
  const bi = system.GetBodyInterface()

  const ids: InstanceType<J['BodyID']>[] = []
  const bodies: InstanceType<J['Body']>[] = []
  const specs: BodySpec[] = []
  const byIndex = new Map<number, BodyId>()
  const hinges: InstanceType<J['HingeConstraint']>[] = []
  let fresh: Contact[] = []
  let optimized = false

  const vec = (a: Vec3) => new J.Vec3(a[0], a[1], a[2])
  const rvec = (a: Vec3) => new J.RVec3(a[0], a[1], a[2])
  const tmpV = new J.Vec3(0, 0, 0), tmpR = new J.RVec3(0, 0, 0), tmpQ = new J.Quat(0, 0, 0, 1)
  const setV = (a: Vec3) => { tmpV.Set(a[0], a[1], a[2]); return tmpV }
  const setR = (a: Vec3) => { tmpR.Set(a[0], a[1], a[2]); return tmpR }

  if (listen) {
    const listener = new J.ContactListenerJS()
    const est = new J.CollisionEstimationResult()
    listener.OnContactValidate = () => J.ValidateResult_AcceptAllContactsForThisBodyPair
    listener.OnContactAdded = (p1: number, p2: number, pm: number, ps: number) => {
      const b1 = J.wrapPointer(p1, J.Body), b2 = J.wrapPointer(p2, J.Body)
      const m = J.wrapPointer(pm, J.ContactManifold), cs = J.wrapPointer(ps, J.ContactSettings)
      const a = byIndex.get(b1.GetID().GetIndexAndSequenceNumber())!, b = byIndex.get(b2.GetID().GetIndexAndSequenceNumber())!
      // Village owns the combine rule per pair (here: average restitution, geometric friction).
      const ma = specs[a].material, mb = specs[b].material
      cs.mCombinedFriction = Math.sqrt(ma.friction * mb.friction)
      cs.mCombinedRestitution = (ma.restitution + mb.restitution) / 2
      J.JoltInterface.prototype.sEstimateCollisionResponse(b1, b2, m, est, cs, 1, 10)
      let impulse = 0
      const ci = est.mContactImpulse
      for (let i = 0; i < ci.size(); i++) impulse += ci.at(i)
      const n = m.mWorldSpaceNormal, p = m.GetWorldSpaceContactPointOn1(0)
      fresh.push({ a, b, point: [p.GetX(), p.GetY(), p.GetZ()], normal: [n.GetX(), n.GetY(), n.GetZ()], impulse })
    }
    listener.OnContactPersisted = (p1: number, p2: number, _pm: number, ps: number) => {
      const a = byIndex.get(J.wrapPointer(p1, J.Body).GetID().GetIndexAndSequenceNumber())!
      const b = byIndex.get(J.wrapPointer(p2, J.Body).GetID().GetIndexAndSequenceNumber())!
      const cs = J.wrapPointer(ps, J.ContactSettings)
      const ma = specs[a].material, mb = specs[b].material
      cs.mCombinedFriction = Math.sqrt(ma.friction * mb.friction)
      cs.mCombinedRestitution = (ma.restitution + mb.restitution) / 2
    }
    listener.OnContactRemoved = () => {}
    system.SetContactListener(listener)
  }

  function makeShape(spec: BodySpec) {
    const s = spec.shape
    if (s.kind === 'sphere') { const sh = new J.SphereShape(s.radius); sh.SetDensity(spec.material.density); return sh }
    if (s.kind === 'box') {
      const he = vec(s.half)
      const sh = new J.BoxShape(he, Math.min(0.05, 0.5 * Math.min(...s.half)))
      J.destroy(he)
      sh.SetDensity(spec.material.density)
      return sh
    }
    if (s.kind === 'capsule') { const sh = new J.CapsuleShape(s.halfHeight, s.radius); sh.SetDensity(spec.material.density); return sh }
    const hs = new J.HeightFieldShapeSettings()
    hs.mSampleCount = s.n
    hs.mBlockSize = 4
    const cell = s.size / (s.n - 1)
    hs.mScale.Set(cell, 1, cell)
    hs.mOffset.Set(-s.size / 2, 0, -s.size / 2)
    // Reserve a height range so later edits (craters, hills) fit without a rebuild.
    hs.mMinHeightValue = -20
    hs.mMaxHeightValue = 20
    hs.mHeightSamples.resize(s.n * s.n)
    const base = J.getPointer(hs.mHeightSamples.data()) >> 2
    J.HEAPF32.set(s.heights, base)
    const sh = hs.Create().Get()
    J.destroy(hs)
    return sh
  }

  const core: PhysicsCore = {
    name: 'jolt',
    setRules(next) {
      Object.assign(rules, next)
      system.SetGravity(setV(rules.gravity))
      for (const id of ids) if (id && bi.GetMotionType(id) === J.EMotionType_Dynamic) bi.SetMotionQuality(id, rules.ccd ? J.EMotionQuality_LinearCast : J.EMotionQuality_Discrete)
    },
    addBody(spec) {
      const shape = makeShape(spec)
      const motion = spec.motion === 'static' ? J.EMotionType_Static : spec.motion === 'kinematic' ? J.EMotionType_Kinematic : J.EMotionType_Dynamic
      const q = spec.rotation ? new J.Quat(...spec.rotation) : new J.Quat(0, 0, 0, 1)
      const p = rvec(spec.position)
      const cs = new J.BodyCreationSettings(shape, p, q, motion, spec.motion === 'static' ? NON_MOVING : MOVING)
      J.destroy(p); J.destroy(q)
      cs.mFriction = spec.material.friction
      cs.mRestitution = spec.material.restitution
      if (spec.gravityScale !== undefined) cs.mGravityFactor = spec.gravityScale
      if (spec.motion === 'dynamic' && rules.ccd) cs.mMotionQuality = J.EMotionQuality_LinearCast
      const body = bi.CreateBody(cs)
      J.destroy(cs)
      const bid = body.GetID()
      bi.AddBody(bid, J.EActivation_Activate)
      if (spec.velocity) bi.SetLinearVelocity(bid, setV(spec.velocity))
      const id = ids.length
      ids.push(bid)
      bodies.push(body)
      specs.push(spec)
      byIndex.set(bid.GetIndexAndSequenceNumber(), id)
      optimized = false
      return id
    },
    removeBody(id) {
      bi.RemoveBody(ids[id])
      bi.DestroyBody(ids[id])
    },
    addHinge(spec: HingeSpec) {
      const hs = new J.HingeConstraintSettings()
      hs.mPoint1 = hs.mPoint2 = setR(spec.anchor)
      hs.mHingeAxis1 = hs.mHingeAxis2 = setV(spec.axis)
      const n: Vec3 = Math.abs(spec.axis[0]) < 0.9 ? [1, 0, 0] : [0, 0, 1]
      hs.mNormalAxis1 = hs.mNormalAxis2 = setV(n)
      if (spec.limits) { hs.mLimitsMin = spec.limits[0]; hs.mLimitsMax = spec.limits[1] }
      if (spec.motor) {
        hs.mMotorSettings.mMaxTorqueLimit = spec.motor.maxTorque
        hs.mMotorSettings.mMinTorqueLimit = -spec.motor.maxTorque
      }
      const c = J.castObject(hs.Create(jolt.sGetFixedToWorldBody(), bodies[spec.body]), J.HingeConstraint)
      J.destroy(hs)
      system.AddConstraint(c)
      if (spec.motor) { c.SetMotorState(J.EMotorState_Velocity); c.SetTargetAngularVelocity(spec.motor.velocity) }
      hinges.push(c)
      return hinges.length - 1
    },
    setMotorVelocity(joint, velocity) {
      hinges[joint].SetTargetAngularVelocity(velocity)
      bi.ActivateBody(hinges[joint].GetBody2().GetID())
    },
    step(dt) {
      if (!optimized) { system.OptimizeBroadPhase(); optimized = true }
      jolt.Step(dt, rules.substeps)
    },
    contacts() {
      const out = fresh
      fresh = []
      return out
    },
    applyImpulse(id, i) {
      bi.AddImpulse(ids[id], setV(i))
    },
    position(id) {
      const p = bi.GetPosition(ids[id])
      return [p.GetX(), p.GetY(), p.GetZ()]
    },
    velocity(id) {
      const p = bi.GetLinearVelocity(ids[id])
      return [p.GetX(), p.GetY(), p.GetZ()]
    },
    setState(id, p, vel, rot) {
      if (rot) { tmpQ.Set(...rot); bi.SetPositionAndRotation(ids[id], setR(p), tmpQ, J.EActivation_Activate) }
      else bi.SetPosition(ids[id], setR(p), J.EActivation_Activate)
      bi.SetLinearVelocity(ids[id], setV(vel))
      bi.SetAngularVelocity(ids[id], setV([0, 0, 0]))
    },
    setKinematicTarget(id, p) {
      bi.MoveKinematic(ids[id], setR(p), bi.GetRotation(ids[id]), 1 / 60)
    },
    sleeping(id) {
      return !bi.IsActive(ids[id])
    },
    editHeights(id, x0, z0, w, h, values) {
      const shape = J.castObject(bodies[id].GetShape(), J.HeightFieldShape)
      const buf = new J.ArrayFloat()
      buf.resize(w * h)
      J.HEAPF32.set(values, J.getPointer(buf.data()) >> 2)
      shape.SetHeights(x0, z0, w, h, buf.data(), w, jolt.GetTempAllocator())
      J.destroy(buf)
      const com = vec([0, 0, 0])
      bi.NotifyShapeChanged(ids[id], com, false, J.EActivation_DontActivate)
      J.destroy(com)
      // Jolt does not wake bodies on a height edit; the caller must. Wake the edited box.
      const s = specs[id].shape
      if (s.kind === 'heightfield' && wakeOnEdit) {
        const cell = s.size / (s.n - 1)
        const lo = vec([-s.size / 2 + x0 * cell, -20, -s.size / 2 + z0 * cell]), hi = vec([-s.size / 2 + (x0 + w) * cell, 20, -s.size / 2 + (z0 + h) * cell])
        const box = new J.AABox(lo, hi)
        const bpf = new J.DefaultBroadPhaseLayerFilter(jolt.GetObjectVsBroadPhaseLayerFilter(), MOVING)
        const olf = new J.DefaultObjectLayerFilter(jolt.GetObjectLayerPairFilter(), MOVING)
        bi.ActivateBodiesInAABox(box, bpf, olf)
        for (const o of [lo, hi, box, bpf, olf]) J.destroy(o)
      }
    },
    overlapSphere(c, r) {
      const out: BodyId[] = []
      const col = new J.CollideShapeBodyCollectorJS()
      col.Reset = () => {}
      col.AddHit = (ptr: number) => {
        const id = byIndex.get(J.wrapPointer(ptr, J.BodyID).GetIndexAndSequenceNumber())
        if (id !== undefined) out.push(id)
      }
      system.GetBroadPhaseQuery().CollideSphere(setV(c), r, col, bpfAll, olfAll)
      J.destroy(col)
      return out
    },
    dispose() {
      J.destroy(jolt)
    },
  }
  const wakeOnEdit = opts.wakeOnEdit ?? true
  const bpfAll = new J.BroadPhaseLayerFilter(), olfAll = new J.ObjectLayerFilter()
  return core
}
