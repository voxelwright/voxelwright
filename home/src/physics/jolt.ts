// The Jolt adapter (jolt-physics 1.1.1, single-thread wasm), promoted from the #74 bench.
// Recipes and limits: .agents/skills/jolt-physics/SKILL.md. Every `new J.X()` lives on the
// wasm heap until J.destroy: temporaries are destroyed where made, per-frame calls reuse
// one scratch Vec3/RVec3/Quat, and dispose() frees the whole world.
import initJolt from 'jolt-physics/wasm'
import wasmUrl from 'jolt-physics/jolt-physics.wasm.wasm?url'
import type { BodyId, BodySpec, Combine, Contact, HingeSpec, PhysicsCore, Quat, Vec3 } from './core'

type J = Awaited<ReturnType<typeof initJolt>>
let J: J
let loading: Promise<void> | undefined
/** Fetches and compiles the wasm once per page (needs 'wasm-unsafe-eval' in the page's CSP). */
export function loadJolt(): Promise<void> {
  return (loading ??= initJolt({ locateFile: () => wasmUrl } as object).then((j) => void (J = j)))
}

const NON_MOVING = 0, MOVING = 1

export function createJolt(): PhysicsCore {
  if (!J) throw new Error('loadJolt() first')
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
  J.destroy(bpStatic)
  J.destroy(bpMoving)
  const system = jolt.GetPhysicsSystem()
  const bi = system.GetBodyInterface()

  const ids: (InstanceType<J['BodyID']> | null)[] = []
  const bodies: (InstanceType<J['Body']> | null)[] = []
  const sensors: boolean[] = []
  const byIndex = new Map<number, BodyId>()
  const hinges: InstanceType<J['HingeConstraint']>[] = []
  let fresh: Contact[] = []
  let combine: Combine = () => [0.5, 0.3]
  let optimized = false

  const tmpV = new J.Vec3(0, 0, 0), tmpR = new J.RVec3(0, 0, 0), tmpQ = new J.Quat(0, 0, 0, 1)
  const setV = (a: Vec3) => { tmpV.Set(a[0], a[1], a[2]); return tmpV }
  const setR = (a: Vec3) => { tmpR.Set(a[0], a[1], a[2]); return tmpR }
  const setQ = (q: Quat) => { tmpQ.Set(q[0], q[1], q[2], q[3]); return tmpQ }
  const bid = (id: BodyId) => {
    const b = ids[id]
    if (!b) throw new Error(`no body ${id}`)
    return b
  }

  // Contacts: Village's combine per pair, and an impulse estimate for sound, dust and sensors.
  // Callbacks run inside Step: nothing here adds, removes or moves a body.
  const listener = new J.ContactListenerJS()
  const est = new J.CollisionEstimationResult()
  const idOf = (ptr: number) => byIndex.get(J.wrapPointer(ptr, J.Body).GetID().GetIndexAndSequenceNumber())
  listener.OnContactValidate = () => J.ValidateResult_AcceptAllContactsForThisBodyPair
  listener.OnContactAdded = (p1: number, p2: number, pm: number, ps: number) => {
    const a = idOf(p1), b = idOf(p2)
    if (a === undefined || b === undefined) return
    const m = J.wrapPointer(pm, J.ContactManifold), cs = J.wrapPointer(ps, J.ContactSettings)
    const sensor = sensors[a] || sensors[b]
    let impulse = 0
    if (!sensor) {
      const [f, r] = combine(a, b)
      cs.mCombinedFriction = f
      cs.mCombinedRestitution = r
      J.JoltInterface.prototype.sEstimateCollisionResponse(J.wrapPointer(p1, J.Body), J.wrapPointer(p2, J.Body), m, est, cs, 1, 10)
      const ci = est.mContactImpulse
      for (let i = 0; i < ci.size(); i++) impulse += ci.at(i)
    }
    const n = m.mWorldSpaceNormal, p = m.GetWorldSpaceContactPointOn1(0)
    fresh.push({ a, b, point: [p.GetX(), p.GetY(), p.GetZ()], normal: [n.GetX(), n.GetY(), n.GetZ()], impulse, sensor })
  }
  listener.OnContactPersisted = (p1: number, p2: number, _pm: number, ps: number) => {
    const a = idOf(p1), b = idOf(p2)
    if (a === undefined || b === undefined || sensors[a] || sensors[b]) return
    const cs = J.wrapPointer(ps, J.ContactSettings)
    const [f, r] = combine(a, b)
    cs.mCombinedFriction = f
    cs.mCombinedRestitution = r
  }
  listener.OnContactRemoved = () => {}
  system.SetContactListener(listener)

  function makeShape(spec: BodySpec) {
    const s = spec.shape
    let shape
    if (s.kind === 'sphere') shape = new J.SphereShape(s.radius)
    else if (s.kind === 'box') {
      const he = new J.Vec3(...s.half)
      // Convex radius must not exceed the smallest half extent (thin walls, flippers).
      shape = new J.BoxShape(he, Math.min(0.05, 0.5 * Math.min(...s.half)))
      J.destroy(he)
    } else if (s.kind === 'capsule') shape = new J.CapsuleShape(s.halfHeight, s.radius)
    else shape = new J.CylinderShape(s.halfHeight, s.radius, Math.min(0.05, 0.5 * Math.min(s.halfHeight, s.radius)))
    shape.SetDensity(spec.density)
    return shape
  }

  const core: PhysicsCore = {
    name: 'jolt',
    setGravity(g) {
      system.SetGravity(setV(g))
      // Sleeping bodies would ignore the new gravity until something touches them.
      for (const id of ids) if (id && bi.GetMotionType(id) === J.EMotionType_Dynamic) bi.ActivateBody(id)
    },
    setCombine(fn) {
      combine = fn
    },
    addBody(spec) {
      const shape = makeShape(spec)
      const motion = spec.motion === 'static' ? J.EMotionType_Static : spec.motion === 'kinematic' ? J.EMotionType_Kinematic : J.EMotionType_Dynamic
      const q = new J.Quat(...(spec.rotation ?? [0, 0, 0, 1]))
      const p = new J.RVec3(...spec.position)
      const cs = new J.BodyCreationSettings(shape, p, q, motion, spec.motion === 'static' ? NON_MOVING : MOVING)
      J.destroy(p)
      J.destroy(q)
      cs.mFriction = spec.friction
      cs.mRestitution = spec.restitution
      cs.mGravityFactor = spec.gravityFactor ?? 1
      cs.mLinearDamping = spec.linearDamping ?? 0.05
      cs.mIsSensor = Boolean(spec.sensor)
      // Every dynamic body is swept (LinearCast): a 27 mm ball through 5 mm walls tunnels 896 in 1000 without it (bench).
      if (spec.motion === 'dynamic') cs.mMotionQuality = J.EMotionQuality_LinearCast
      const body = bi.CreateBody(cs)
      J.destroy(cs)
      const b = body.GetID()
      bi.AddBody(b, J.EActivation_Activate)
      if (spec.velocity) bi.SetLinearVelocity(b, setV(spec.velocity))
      const id = ids.length
      ids.push(b)
      bodies.push(body)
      sensors.push(Boolean(spec.sensor))
      byIndex.set(b.GetIndexAndSequenceNumber(), id)
      optimized = false
      return id
    },
    removeBody(id) {
      const b = bid(id)
      byIndex.delete(b.GetIndexAndSequenceNumber())
      bi.RemoveBody(b)
      bi.DestroyBody(b)
      ids[id] = null
      bodies[id] = null
    },
    addHinge(spec: HingeSpec) {
      const hs = new J.HingeConstraintSettings()
      hs.mPoint1 = hs.mPoint2 = setR(spec.anchor)
      hs.mHingeAxis1 = hs.mHingeAxis2 = setV(spec.axis)
      const ax = spec.axis
      // Any unit vector perpendicular to the axis.
      const n: Vec3 = Math.abs(ax[1]) < 0.9 ? [-ax[2], 0, ax[0]] : [0, ax[2], -ax[1]]
      const len = Math.hypot(...n)
      hs.mNormalAxis1 = hs.mNormalAxis2 = setV([n[0] / len, n[1] / len, n[2] / len])
      if (spec.limits) {
        hs.mLimitsMin = spec.limits[0]
        hs.mLimitsMax = spec.limits[1]
      }
      if (spec.motor) {
        hs.mMotorSettings.mMaxTorqueLimit = spec.motor.maxTorque
        hs.mMotorSettings.mMinTorqueLimit = -spec.motor.maxTorque
      }
      const body = bodies[spec.body]
      if (!body) throw new Error(`no body ${spec.body}`)
      const c = J.castObject(hs.Create(jolt.sGetFixedToWorldBody(), body), J.HingeConstraint)
      J.destroy(hs)
      system.AddConstraint(c)
      if (spec.motor) {
        c.SetMotorState(J.EMotorState_Velocity)
        c.SetTargetAngularVelocity(spec.motor.velocity)
      }
      hinges.push(c)
      return hinges.length - 1
    },
    setMotor(joint, velocity, maxTorque) {
      const c = hinges[joint]
      const ms = c.GetMotorSettings()
      ms.mMaxTorqueLimit = maxTorque
      ms.mMinTorqueLimit = -maxTorque
      c.SetTargetAngularVelocity(velocity)
      bi.ActivateBody(c.GetBody2().GetID())
    },
    hingeAngle(joint) {
      return hinges[joint].GetCurrentAngle()
    },
    step(dt, substeps) {
      if (!optimized) {
        system.OptimizeBroadPhase()
        optimized = true
      }
      jolt.Step(dt, substeps)
    },
    contacts() {
      const out = fresh
      fresh = []
      return out
    },
    applyImpulse(id, i) {
      bi.AddImpulse(bid(id), setV(i))
    },
    position(id) {
      const p = bi.GetPosition(bid(id))
      return [p.GetX(), p.GetY(), p.GetZ()]
    },
    rotation(id) {
      const q = bi.GetRotation(bid(id))
      return [q.GetX(), q.GetY(), q.GetZ(), q.GetW()]
    },
    velocity(id) {
      const v = bi.GetLinearVelocity(bid(id))
      return [v.GetX(), v.GetY(), v.GetZ()]
    },
    setVelocity(id, v) {
      bi.SetLinearVelocity(bid(id), setV(v))
    },
    setState(id, p, v, rot) {
      const b = bid(id)
      if (rot) bi.SetPositionAndRotation(b, setR(p), setQ(rot), J.EActivation_Activate)
      else bi.SetPosition(b, setR(p), J.EActivation_Activate)
      bi.SetLinearVelocity(b, setV(v))
      bi.SetAngularVelocity(b, setV([0, 0, 0]))
    },
    moveKinematic(id, p, rot, dt) {
      bi.MoveKinematic(bid(id), setR(p), setQ(rot), dt)
    },
    setLinearDamping(id, damping) {
      bodies[id]?.GetMotionProperties().SetLinearDamping(damping)
    },
    setGravityFactor(id, factor) {
      bi.SetGravityFactor(bid(id), factor)
    },
    sleeping(id) {
      return !bi.IsActive(bid(id))
    },
    dispose() {
      J.destroy(jolt)
      for (const o of [listener, est, tmpV, tmpR, tmpQ]) J.destroy(o)
      ids.length = bodies.length = hinges.length = 0
      byIndex.clear()
    },
  }
  return core
}
