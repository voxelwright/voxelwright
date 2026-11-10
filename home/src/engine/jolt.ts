// The Jolt adapter (jolt-physics 1.1.1, single-thread wasm), promoted from the #74 bench.
// Recipes and limits: .agents/skills/jolt-physics/SKILL.md. Every `new J.X()` lives on the
// wasm heap until J.destroy: temporaries are destroyed where made, per-frame calls reuse
// one scratch Vec3/RVec3/Quat, and dispose() frees the whole world.
import initJolt from 'jolt-physics/wasm'
import wasmUrl from 'jolt-physics/jolt-physics.wasm.wasm?url'
import type { BodyId, BodySpec, Combine, Contact, HingeSpec, PhysicsCore, Quat, SliderSpec, Vec3 } from './core'

type J = Awaited<ReturnType<typeof initJolt>>
let J: J
let loading: Promise<void> | undefined
/** Fetches and compiles the wasm once per page (needs 'wasm-unsafe-eval' in the page's CSP). */
export function loadJolt(): Promise<void> {
  return (loading ??= initJolt({ locateFile: () => wasmUrl } as object).then((j) => void (J = j)))
}

/** Statics; things that move; and things that touch nothing for now (a person sitting down). */
const NON_MOVING = 0, MOVING = 1, GHOST = 2

export function createJolt(): PhysicsCore {
  if (!J) throw new Error('loadJolt() first')
  const settings = new J.JoltSettings()
  settings.mMaxWorkerThreads = 0
  const pairs = new J.ObjectLayerPairFilterTable(3)
  pairs.EnableCollision(NON_MOVING, MOVING)
  pairs.EnableCollision(MOVING, MOVING)
  const bpStatic = new J.BroadPhaseLayer(0), bpMoving = new J.BroadPhaseLayer(1)
  const bpi = new J.BroadPhaseLayerInterfaceTable(3, 2)
  bpi.MapObjectToBroadPhaseLayer(NON_MOVING, bpStatic)
  bpi.MapObjectToBroadPhaseLayer(MOVING, bpMoving)
  bpi.MapObjectToBroadPhaseLayer(GHOST, bpMoving)
  settings.mObjectLayerPairFilter = pairs
  settings.mBroadPhaseLayerInterface = bpi
  settings.mObjectVsBroadPhaseLayerFilter = new J.ObjectVsBroadPhaseLayerFilterTable(bpi, 2, pairs, 3)
  const jolt = new J.JoltInterface(settings)
  J.destroy(settings)
  J.destroy(bpStatic)
  J.destroy(bpMoving)
  const system = jolt.GetPhysicsSystem()
  const bi = system.GetBodyInterface()
  // Village's things are toy-sized (a 27 mm ball beside 1 cm walls). Jolt's defaults (2 cm
  // speculative contacts, 2 cm penetration slop) are for metre-sized things: a speculative
  // contact with a wall corner the ball only passes stopped it dead (#74). Scale them down.
  const ps = system.GetPhysicsSettings()
  ps.mSpeculativeContactDistance = 0.004
  ps.mPenetrationSlop = 0.001
  system.SetPhysicsSettings(ps)

  const ids: (InstanceType<J['BodyID']> | null)[] = []
  const bodies: (InstanceType<J['Body']> | null)[] = []
  const sensors: boolean[] = []
  const byIndex = new Map<number, BodyId>()
  const jointList: (({ kind: 'hinge'; c: InstanceType<J['HingeConstraint']> } | { kind: 'slider'; c: InstanceType<J['SliderConstraint']> }) | null)[] = []
  let fresh: Contact[] = []
  let combine: Combine = () => [0.5, 0.3]
  let optimized = false

  const tmpV = new J.Vec3(0, 0, 0), tmpR = new J.RVec3(0, 0, 0), tmpQ = new J.Quat(0, 0, 0, 1)
  const setV = (a: Vec3) => { tmpV.Set(a[0], a[1], a[2]); return tmpV }
  const setR = (a: Vec3) => { tmpR.Set(a[0], a[1], a[2]); return tmpR }
  const setQ = (q: Quat) => { tmpQ.Set(q[0], q[1], q[2], q[3]); return tmpQ }
  const body = (id: BodyId) => {
    const b = bodies[id]
    if (!b) throw new Error(`no body ${id}`)
    return b
  }
  /** Any unit vector perpendicular to a unit axis. */
  const normalTo = (ax: Vec3): Vec3 => {
    const n: Vec3 = Math.abs(ax[1]) < 0.9 ? [-ax[2], 0, ax[0]] : [0, ax[2], -ax[1]]
    const len = Math.hypot(...n)
    if (!(len > 1e-9)) throw new Error('a joint axis needs a direction')
    return [n[0] / len, n[1] / len, n[2] / len]
  }
  const joint = (id: number) => {
    const j = jointList[id]
    if (!j) throw new Error(`no joint ${id}`)
    return j
  }
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

  // Waking and sleeping, as they happen (inside Step, or when a body is moved or pushed from outside).
  let stirred: { id: BodyId; awake: boolean }[] = []
  const activation = new J.BodyActivationListenerJS()
  const stir = (awake: boolean) => (ptr: number) => {
    const id = byIndex.get(J.wrapPointer(ptr, J.BodyID).GetIndexAndSequenceNumber())
    if (id !== undefined) stirred.push({ id, awake })
  }
  activation.OnBodyActivated = stir(true)
  activation.OnBodyDeactivated = stir(false)
  system.SetBodyActivationListener(activation)

  // Ray casts: one ray, settings, collector and set of filters, reused.
  const ray = new J.RRayCast(), raySettings = new J.RayCastSettings(), rayHit = new J.CastRayClosestHitCollisionCollector()
  // A ray that starts inside a shape leaves it without a hit: a caller steps on from a hit to look past it.
  raySettings.mTreatConvexAsSolid = false
  const anyBroad = new J.BroadPhaseLayerFilter(), anyLayer = new J.ObjectLayerFilter(), anyShape = new J.ShapeFilter(), notThese = new J.IgnoreMultipleBodiesFilter()

  /** Convex radius must not exceed the smallest half extent (thin walls, flippers). */
  const boxShape = (half: Vec3) => {
    const he = new J.Vec3(...half)
    const shape = new J.BoxShape(he, Math.min(0.05, 0.5 * Math.min(...half)))
    J.destroy(he)
    return shape
  }

  function makeShape(spec: BodySpec) {
    const s = spec.shape
    let shape
    if (s.kind === 'compound') {
      const settings = new J.StaticCompoundShapeSettings()
      for (const b of s.boxes) {
        // A ball is as wide as the box's middle side (a stripe round it does not make it bigger); a can stands on local y.
        const [hx, hy, hz] = b.half
        const part = b.round === 'ball' ? new J.SphereShape([hx, hy, hz].sort((p, q) => p - q)[1])
          : b.round === 'can' ? new J.CylinderShape(hy, Math.min(hx, hz), Math.min(0.006, 0.4 * Math.min(hx, hy, hz)))
          : boxShape(b.half)
        part.SetDensity(spec.density)
        settings.AddShapeShape(setV(b.at), setQ(b.rotation), part, 0)
      }
      const result = settings.Create()
      if (result.HasError()) {
        const why = result.GetError().c_str()
        J.destroy(settings)
        throw new Error(`a compound shape could not be built: ${why}`)
      }
      shape = result.Get()
      // The body takes its own reference below; the settings let go of theirs.
      shape.AddRef()
      J.destroy(settings)
      return shape
    }
    if (s.kind === 'sphere') shape = new J.SphereShape(s.radius)
    else if (s.kind === 'box') shape = boxShape(s.half)
    else if (s.kind === 'capsule') shape = new J.CapsuleShape(s.halfHeight, s.radius)
    // A small rounding: a large one curves the side's lower edge, and a person's body would press a ball into the floor.
    else shape = new J.CylinderShape(s.halfHeight, s.radius, Math.min(0.01, 0.5 * Math.min(s.halfHeight, s.radius)))
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
      if (spec.shape.kind === 'compound') shape.Release()
      if (spec.mass !== undefined && spec.motion === 'dynamic') {
        cs.mOverrideMassProperties = J.EOverrideMassProperties_CalculateInertia
        cs.mMassPropertiesOverride.mMass = spec.mass
      }
      if (spec.upright) cs.mAllowedDOFs = J.EAllowedDOFs_TranslationX | J.EAllowedDOFs_TranslationY | J.EAllowedDOFs_TranslationZ
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
      bi.AddBody(b, spec.asleep ? J.EActivation_DontActivate : J.EActivation_Activate)
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
      const normal = normalTo(spec.axis)
      const hs = new J.HingeConstraintSettings()
      hs.mPoint1 = hs.mPoint2 = setR(spec.anchor)
      hs.mHingeAxis1 = hs.mHingeAxis2 = setV(spec.axis)
      hs.mNormalAxis1 = hs.mNormalAxis2 = setV(normal)
      hs.mLimitsMin = spec.limits[0]
      hs.mLimitsMax = spec.limits[1]
      const c = J.castObject(hs.Create(jolt.sGetFixedToWorldBody(), body(spec.body)), J.HingeConstraint)
      J.destroy(hs)
      system.AddConstraint(c)
      c.SetMotorState(J.EMotorState_Velocity)
      jointList.push({ kind: 'hinge', c })
      return jointList.length - 1
    },
    addSlider(spec: SliderSpec) {
      const normal = normalTo(spec.axis)
      const ss = new J.SliderConstraintSettings()
      ss.mAutoDetectPoint = true
      ss.mSliderAxis1 = ss.mSliderAxis2 = setV(spec.axis)
      ss.mNormalAxis1 = ss.mNormalAxis2 = setV(normal)
      ss.mLimitsMin = spec.limits[0]
      ss.mLimitsMax = spec.limits[1]
      const c = J.castObject(ss.Create(jolt.sGetFixedToWorldBody(), body(spec.body)), J.SliderConstraint)
      J.destroy(ss)
      system.AddConstraint(c)
      c.SetMotorState(J.EMotorState_Velocity)
      jointList.push({ kind: 'slider', c })
      return jointList.length - 1
    },
    setLimits(id, limits) {
      joint(id).c.SetLimits(limits[0], limits[1])
      bi.ActivateBody(joint(id).c.GetBody2().GetID())
    },
    removeJoint(id) {
      system.RemoveConstraint(joint(id).c)
      jointList[id] = null
    },
    setMotor(id, velocity, limit) {
      const j = joint(id)
      const ms = j.c.GetMotorSettings()
      if (j.kind === 'hinge') {
        ms.mMaxTorqueLimit = limit
        ms.mMinTorqueLimit = -limit
        j.c.SetTargetAngularVelocity(velocity)
      } else {
        ms.mMaxForceLimit = limit
        ms.mMinForceLimit = -limit
        j.c.SetTargetVelocity(velocity)
      }
      bi.ActivateBody(j.c.GetBody2().GetID())
    },
    jointPosition(id) {
      const j = joint(id)
      return j.kind === 'hinge' ? j.c.GetCurrentAngle() : j.c.GetCurrentPosition()
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
    setSolid(id, solid) {
      bi.SetObjectLayer(bid(id), solid ? MOVING : GHOST)
    },
    setPose(id, p, rot) {
      bi.SetPositionAndRotation(bid(id), setR(p), setQ(rot), J.EActivation_DontActivate)
    },
    mass(id) {
      const mp = body(id).GetMotionProperties()
      const inv = mp ? mp.GetInverseMass() : 0
      return inv > 0 ? 1 / inv : Infinity
    },
    sleeping(id) {
      return !bi.IsActive(bid(id))
    },
    wake(id) {
      bi.ActivateBody(bid(id))
    },
    activity() {
      const out = stirred
      stirred = []
      return out
    },
    angularVelocity(id) {
      const v = bi.GetAngularVelocity(bid(id))
      return [v.GetX(), v.GetY(), v.GetZ()]
    },
    setAngularVelocity(id, v) {
      bi.SetAngularVelocity(bid(id), setV(v))
    },
    rest(id, p, rot) {
      const b = bid(id)
      bi.SetPositionAndRotation(b, setR(p), setQ(rot), J.EActivation_DontActivate)
      bi.SetLinearAndAngularVelocity(b, setV([0, 0, 0]), setV([0, 0, 0]))
      bi.DeactivateBody(b)
    },
    castRay(origin, direction, ignore = []) {
      ray.mOrigin = setR(origin)
      ray.mDirection = setV(direction)
      notThese.Clear()
      for (const id of ignore) if (ids[id]) notThese.IgnoreBody(ids[id]!)
      // A trigger volume is not in the way: the ray is cast again without it.
      let id: BodyId | undefined
      for (let tries = 0; ; tries++) {
        rayHit.Reset()
        system.GetNarrowPhaseQuery().CastRay(ray, raySettings, rayHit, anyBroad, anyLayer, notThese, anyShape)
        if (!rayHit.HadHit()) return null
        id = byIndex.get(rayHit.mHit.mBodyID.GetIndexAndSequenceNumber())
        if (id === undefined) return null
        if (!sensors[id]) break
        if (tries >= 8) return null
        notThese.IgnoreBody(ids[id]!)
      }
      const hit = rayHit.mHit
      const fraction = hit.mFraction
      const point: Vec3 = [origin[0] + direction[0] * fraction, origin[1] + direction[1] * fraction, origin[2] + direction[2] * fraction]
      const n = bodies[id]!.GetWorldSpaceSurfaceNormal(hit.mSubShapeID2, setR(point))
      return { body: id, point, normal: [n.GetX(), n.GetY(), n.GetZ()], fraction }
    },
    dispose() {
      // The three layer tables are JoltInterface's: measured on 1.1.1, destroying them after
      // it corrupts the heap (a double free), so they are not freed here.
      J.destroy(jolt)
      for (const o of [listener, activation, est, tmpV, tmpR, tmpQ, ray, raySettings, rayHit, anyBroad, anyLayer, anyShape, notThese]) J.destroy(o)
      ids.length = bodies.length = jointList.length = 0
      byIndex.clear()
    },
  }
  return core
}
