// A small custom rigid-body solver after Müller et al. 2020, "Detailed Rigid Body
// Simulation with Extended Position Based Dynamics": substeps, one position
// iteration, contacts with static/dynamic friction and restitution, a hinge with
// limits and a velocity motor. Bench-grade: spheres, boxes (vertex-face only, no
// edge-edge), capsules (as spheres along the segment against boxes), heightfields.
import { DEFAULT_RULES, type BodyId, type BodySpec, type Contact, type HingeSpec, type Material, type PhysicsCore, type Quat, type Rules, type Vec3 } from './core.ts'

type V = Vec3
const add = (a: V, b: V): V => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
const sub = (a: V, b: V): V => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const scale = (a: V, s: number): V => [a[0] * s, a[1] * s, a[2] * s]
const dot = (a: V, b: V) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const cross = (a: V, b: V): V => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
const length = (a: V) => Math.hypot(a[0], a[1], a[2])
function rot(q: Quat, v: V): V {
  const [x, y, z, w] = q
  const t = scale(cross([x, y, z], v), 2)
  return add(add(v, scale(t, w)), cross([x, y, z], t))
}
const inv = (q: Quat): Quat => [-q[0], -q[1], -q[2], q[3]]
function qmul(a: Quat, b: Quat): Quat {
  return [
    a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
    a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
    a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
  ]
}
function normalizeQ(q: Quat): Quat {
  const l = Math.hypot(q[0], q[1], q[2], q[3])
  return [q[0] / l, q[1] / l, q[2] / l, q[3] / l]
}

interface Body {
  spec: BodySpec
  dynamic: boolean
  x: V; q: Quat; v: V; w: V
  px: V; pq: Quat
  invMass: number
  invI: V // local diagonal
  target?: V
  sleepTimer: number
  sleeping: boolean
  radius: number // bounding sphere
  removed: boolean
}

interface Manifold { a: number; b: number; n: V; depth: number; pa: V; pb: V }
interface Solved { a: number; b: number; ra: V; rb: V; n: V; vnPre: number; lambdaN: number; friction: number; restitution: number; point: V }
interface Hinge { body: number; anchor: V; axis: V; normal: V; rB: V; aB: V; nB: V; limits?: [number, number]; motor?: { velocity: number; maxTorque: number } }

/** Village owns the per-pair combine. Overridable: this is the "per-contact hook". */
export type Combine = (a: Material, b: Material, contact: { a: BodyId; b: BodyId; n: V }) => { friction: number; restitution: number }
const defaultCombine: Combine = (a, b) => ({ friction: Math.sqrt(a.friction * b.friction), restitution: (a.restitution + b.restitution) / 2 })

export function createXpbd(opts: { combine?: Combine } = {}): PhysicsCore & { combine: Combine } {
  const rules: Rules = { ...DEFAULT_RULES, substeps: 8 }
  const bodies: Body[] = []
  const hinges: Hinge[] = []
  let fresh: Contact[] = []
  let touching = new Set<string>()

  function invInertia(spec: BodySpec, m: number): V {
    const s = spec.shape
    if (s.kind === 'sphere') { const i = 0.4 * m * s.radius ** 2; return [1 / i, 1 / i, 1 / i] }
    const h: V = s.kind === 'box' ? s.half : s.kind === 'capsule' ? [s.radius, s.halfHeight + s.radius, s.radius] : [1, 1, 1]
    return [3 / (m * (h[1] ** 2 + h[2] ** 2)), 3 / (m * (h[0] ** 2 + h[2] ** 2)), 3 / (m * (h[0] ** 2 + h[1] ** 2))]
  }
  function volume(spec: BodySpec) {
    const s = spec.shape
    if (s.kind === 'sphere') return (4 / 3) * Math.PI * s.radius ** 3
    if (s.kind === 'box') return 8 * s.half[0] * s.half[1] * s.half[2]
    if (s.kind === 'capsule') return Math.PI * s.radius ** 2 * (2 * s.halfHeight + (4 / 3) * s.radius)
    return 0
  }

  // World-space inverse inertia applied to a vector.
  function applyInvI(b: Body, v: V): V {
    const l = rot(inv(b.q), v)
    return rot(b.q, [l[0] * b.invI[0], l[1] * b.invI[1], l[2] * b.invI[2]])
  }
  function genInvMass(b: Body, r: V, n: V) {
    if (!b.dynamic) return 0
    const rn = cross(r, n)
    return b.invMass + dot(rn, applyInvI(b, rn))
  }
  function applyPosImpulse(b: Body, p: V, r: V, sign: number) {
    if (!b.dynamic) return
    b.x = add(b.x, scale(p, sign * b.invMass))
    const dw = applyInvI(b, scale(cross(r, p), sign))
    b.q = normalizeQ(add4(b.q, scale4(qmul([dw[0], dw[1], dw[2], 0], b.q), 0.5)))
  }
  function applyVelImpulse(b: Body, p: V, r: V, sign: number) {
    if (!b.dynamic) return
    b.v = add(b.v, scale(p, sign * b.invMass))
    b.w = add(b.w, applyInvI(b, scale(cross(r, p), sign)))
  }
  const add4 = (a: Quat, b: Quat): Quat => [a[0] + b[0], a[1] + b[1], a[2] + b[2], a[3] + b[3]]
  const scale4 = (a: Quat, s: number): Quat => [a[0] * s, a[1] * s, a[2] * s, a[3] * s]

  // ---------- narrow phase ----------
  function boxClosest(b: Body, half: V, p: V): { point: V; n: V; depth: number; inside: boolean } {
    const l = rot(inv(b.q), sub(p, b.x))
    const c: V = [Math.max(-half[0], Math.min(half[0], l[0])), Math.max(-half[1], Math.min(half[1], l[1])), Math.max(-half[2], Math.min(half[2], l[2]))]
    const inside = c[0] === l[0] && c[1] === l[1] && c[2] === l[2]
    if (!inside) return { point: add(b.x, rot(b.q, c)), n: [0, 0, 0], depth: 0, inside }
    // Inside: push out through the nearest face.
    let axis = 0, best = Infinity, sgn = 1
    for (let i = 0; i < 3; i++) {
      const d = half[i] - Math.abs(l[i])
      if (d < best) { best = d; axis = i; sgn = l[i] >= 0 ? 1 : -1 }
    }
    const fl: V = [0, 0, 0]; fl[axis] = sgn
    const face = [...l] as V; face[axis] = sgn * half[axis]
    return { point: add(b.x, rot(b.q, face)), n: rot(b.q, fl), depth: best, inside }
  }

  function sphereVs(sa: Body, center: V, r: number, ob: Body, oi: number, ai: number, out: Manifold[]) {
    const s = ob.spec.shape
    if (s.kind === 'sphere' || s.kind === 'capsule') {
      let c = ob.x
      if (s.kind === 'capsule') {
        const ax = rot(ob.q, [0, 1, 0])
        const t = Math.max(-s.halfHeight, Math.min(s.halfHeight, dot(sub(center, ob.x), ax)))
        c = add(ob.x, scale(ax, t))
      }
      const d = sub(c, center), dist = length(d), depth = r + s.radius - dist
      if (depth <= 0) return
      const n = dist > 1e-9 ? scale(d, 1 / dist) : [0, 1, 0] as V
      out.push({ a: ai, b: oi, n, depth, pa: add(center, scale(n, r)), pb: sub(c, scale(n, s.radius)) })
    } else if (s.kind === 'box') {
      const cl = boxClosest(ob, s.half, center)
      if (cl.inside) {
        // n from a (sphere) to b (box) is into the box: minus the face normal.
        const n = scale(cl.n, -1)
        out.push({ a: ai, b: oi, n, depth: cl.depth + r, pa: add(center, scale(n, r)), pb: cl.point })
      } else {
        const d = sub(cl.point, center), dist = length(d), depth = r - dist
        if (depth <= 0) return
        const n = scale(d, 1 / dist)
        out.push({ a: ai, b: oi, n, depth, pa: add(center, scale(n, r)), pb: cl.point })
      }
    } else if (s.kind === 'heightfield') {
      const hc = hfSample(ob, s, center)
      if (!hc) return
      const depth = hc.h + r - center[1]
      if (depth <= 0) return
      const n = scale(hc.n, -1)
      out.push({ a: ai, b: oi, n, depth: depth * hc.n[1], pa: add(center, scale(n, r)), pb: [center[0], hc.h, center[2]] })
    }
    void sa
  }

  function hfSample(ob: Body, s: Extract<BodySpec['shape'], { kind: 'heightfield' }>, p: V) {
    const cell = s.size / (s.n - 1)
    const fx = (p[0] - ob.x[0] + s.size / 2) / cell, fz = (p[2] - ob.x[2] + s.size / 2) / cell
    if (fx < 0 || fz < 0 || fx >= s.n - 1 || fz >= s.n - 1) return null
    const x0 = Math.floor(fx), z0 = Math.floor(fz), tx = fx - x0, tz = fz - z0
    const H = (x: number, z: number) => s.heights[z * s.n + x]
    const h00 = H(x0, z0), h10 = H(x0 + 1, z0), h01 = H(x0, z0 + 1), h11 = H(x0 + 1, z0 + 1)
    const h = (h00 * (1 - tx) + h10 * tx) * (1 - tz) + (h01 * (1 - tx) + h11 * tx) * tz + ob.x[1]
    const dx = ((h10 - h00) * (1 - tz) + (h11 - h01) * tz) / cell, dz = ((h01 - h00) * (1 - tx) + (h11 - h10) * tx) / cell
    const n: V = [-dx, 1, -dz]
    return { h, n: scale(n, 1 / length(n)) }
  }

  const corners = (b: Body, half: V): V[] => {
    const out: V[] = []
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) out.push(add(b.x, rot(b.q, [sx * half[0], sy * half[1], sz * half[2]])))
    return out
  }

  function collide(ai: number, bi: number, out: Manifold[]) {
    const A = bodies[ai], B = bodies[bi]
    const sa = A.spec.shape, sb = B.spec.shape
    if (sa.kind === 'sphere') return sphereVs(A, A.x, sa.radius, B, bi, ai, out)
    if (sb.kind === 'sphere') { const m: Manifold[] = []; sphereVs(B, B.x, sb.radius, A, ai, bi, m); for (const c of m) out.push(flip(c)); return }
    if (sa.kind === 'capsule' || sb.kind === 'capsule') {
      const [C, ci, O, oi, flipIt] = sa.kind === 'capsule' ? [A, ai, B, bi, false] : [B, bi, A, ai, true]
      const s = C.spec.shape as Extract<BodySpec['shape'], { kind: 'capsule' }>
      const ax = rot(C.q, [0, 1, 0])
      const m: Manifold[] = []
      for (const t of [-1, 0, 1]) sphereVs(C, add(C.x, scale(ax, t * s.halfHeight)), s.radius, O, oi, ci, m)
      for (const c of m) out.push(flipIt ? flip(c) : c)
      return
    }
    if (sa.kind === 'box' && sb.kind === 'box') {
      for (const p of corners(A, sa.half)) {
        const cl = boxClosest(B, sb.half, p)
        if (cl.inside) out.push({ a: ai, b: bi, n: scale(cl.n, -1), depth: cl.depth, pa: p, pb: cl.point })
      }
      for (const p of corners(B, sb.half)) {
        const cl = boxClosest(A, sa.half, p)
        if (cl.inside) out.push({ a: ai, b: bi, n: cl.n, depth: cl.depth, pa: cl.point, pb: p })
      }
      return
    }
    if (sa.kind === 'box' && sb.kind === 'heightfield') {
      for (const p of corners(A, sa.half)) {
        const hc = hfSample(B, sb, p)
        if (!hc || p[1] >= hc.h) continue
        out.push({ a: ai, b: bi, n: scale(hc.n, -1), depth: (hc.h - p[1]) * hc.n[1], pa: p, pb: [p[0], hc.h, p[2]] })
      }
      return
    }
    if (sb.kind === 'box' && sa.kind === 'heightfield') { const m: Manifold[] = []; collide(bi, ai, m); for (const c of m) out.push(flip(c)) }
  }
  const flip = (c: Manifold): Manifold => ({ a: c.b, b: c.a, n: scale(c.n, -1), depth: c.depth, pa: c.pb, pb: c.pa })

  // ---------- broad phase: sort and sweep on x, once per frame ----------
  function aabb(b: Body, dt: number): [V, V] {
    const s = b.spec.shape
    if (s.kind === 'heightfield') return [[b.x[0] - s.size / 2, -1e9, b.x[2] - s.size / 2], [b.x[0] + s.size / 2, 1e9, b.x[2] + s.size / 2]]
    const e = b.radius + length(b.v) * dt + 0.01
    return [sub(b.x, [e, e, e]), add(b.x, [e, e, e])]
  }
  function candidatePairs(dt: number) {
    const boxes = bodies.map((b, i) => ({ i, box: aabb(b, dt) })).filter(o => !bodies[o.i].removed)
    boxes.sort((p, q) => p.box[0][0] - q.box[0][0])
    const pairs: [number, number][] = []
    for (let i = 0; i < boxes.length; i++) {
      const A = boxes[i], ba = bodies[A.i]
      for (let j = i + 1; j < boxes.length && boxes[j].box[0][0] <= A.box[1][0]; j++) {
        const B = boxes[j], bb = bodies[B.i]
        if (!ba.dynamic && !bb.dynamic) continue
        if ((!ba.dynamic || ba.sleeping) && (!bb.dynamic || bb.sleeping)) continue
        if (A.box[0][1] > B.box[1][1] || B.box[0][1] > A.box[1][1] || A.box[0][2] > B.box[1][2] || B.box[0][2] > A.box[1][2]) continue
        pairs.push([A.i, B.i])
      }
    }
    return pairs
  }

  function wake(b: Body) { if (b.dynamic && b.sleeping) { b.sleeping = false; b.sleepTimer = 0 } }

  function substep(h: number, pairs: [number, number][], gravity: V, impulses: Map<string, Solved>) {
    for (const b of bodies) {
      if (b.removed) continue
      b.px = b.x; b.pq = b.q
      if (b.target) {
        const f = 1 / Math.max(1, stepsLeft)
        b.x = add(b.x, scale(sub(b.target, b.x), f))
        continue
      }
      if (!b.dynamic || b.sleeping) continue
      b.v = add(b.v, scale(gravity, h * (b.spec.gravityScale ?? 1)))
      b.x = add(b.x, scale(b.v, h))
      b.q = normalizeQ(add4(b.q, scale4(qmul([b.w[0], b.w[1], b.w[2], 0], b.q), 0.5 * h)))
    }
    // Contacts.
    const manifolds: Manifold[] = []
    for (const [i, j] of pairs) collide(i, j, manifolds)
    const solved: Solved[] = []
    // Contact points as body-local anchors, so each correction sees the earlier ones.
    const anchors = manifolds.map(m => [rot(inv(bodies[m.a].q), sub(m.pa, bodies[m.a].x)), rot(inv(bodies[m.b].q), sub(m.pb, bodies[m.b].x))])
    for (let k = 0; k < manifolds.length; k++) {
      const m = manifolds[k]
      const A = bodies[m.a], B = bodies[m.b]
      m.pa = add(A.x, rot(A.q, anchors[k][0]))
      m.pb = add(B.x, rot(B.q, anchors[k][1]))
      m.depth = dot(sub(m.pa, m.pb), m.n)
      if (m.depth <= 0) continue
      if (A.sleeping && B.dynamic && !B.sleeping) wake(A)
      if (B.sleeping && A.dynamic && !A.sleeping) wake(B)
      if (A.target && B.sleeping) wake(B)
      if (B.target && A.sleeping) wake(A)
      const ra = sub(m.pa, A.x), rb = sub(m.pb, B.x)
      const wsum = genInvMass(A, ra, m.n) + genInvMass(B, rb, m.n)
      if (wsum === 0) continue
      const vrel = sub(add(A.v, cross(A.w, ra)), add(B.v, cross(B.w, rb)))
      const mat = combine(A.spec.material, B.spec.material, { a: m.a, b: m.b, n: m.n })
      // Resolve this substep's approach fully, but push out older penetration (an
      // edited terrain under a box) at no more than 2 m/s, or it explodes.
      const vnPre = dot(vrel, m.n)
      const dl = Math.min(m.depth, Math.max(0, vnPre) * h + 2 * h) / wsum
      const p = scale(m.n, dl)
      applyPosImpulse(A, p, ra, -1)
      applyPosImpulse(B, p, rb, 1)
      // Static friction: undo tangential drift of the contact points this substep.
      const pa1 = add(A.x, rot(A.q, rot(inv(A.pq), sub(m.pa, A.px)))), pb1 = add(B.x, rot(B.q, rot(inv(B.pq), sub(m.pb, B.px))))
      const dp = sub(sub(pa1, m.pa), sub(pb1, m.pb))
      const dpt = sub(dp, scale(m.n, dot(dp, m.n)))
      const lt = length(dpt)
      if (lt > 1e-9) {
        const t = scale(dpt, 1 / lt)
        const wt = genInvMass(A, ra, t) + genInvMass(B, rb, t)
        const dlt = lt / wt
        if (dlt < mat.friction * dl) { const pt = scale(t, dlt); applyPosImpulse(A, pt, ra, -1); applyPosImpulse(B, pt, rb, 1) }
      }
      solved.push({ a: m.a, b: m.b, ra, rb, n: m.n, vnPre, lambdaN: dl, friction: mat.friction, restitution: mat.restitution, point: m.pa })
    }
    // Hinges (body to world).
    for (const j of hinges) solveHingePos(j)
    // Velocities from positions.
    for (const b of bodies) {
      if (b.removed || !b.dynamic || b.sleeping) { if (b.target) b.v = scale(sub(b.x, b.px), 1 / h); continue }
      b.v = scale(sub(b.x, b.px), 1 / h)
      const dq = qmul(b.q, inv(b.pq))
      b.w = scale([dq[0], dq[1], dq[2]], (2 / h) * (dq[3] >= 0 ? 1 : -1))
    }
    // Velocity pass: dynamic friction and restitution.
    const gh = 2 * length(gravity) * h
    for (const c of solved) {
      const A = bodies[c.a], B = bodies[c.b]
      const vrel = sub(add(A.v, cross(A.w, c.ra)), add(B.v, cross(B.w, c.rb)))
      const vn = dot(vrel, c.n)
      const vt = sub(vrel, scale(c.n, vn))
      let dv: V = [0, 0, 0]
      const lvt = length(vt)
      if (lvt > 1e-9) dv = scale(vt, -Math.min(c.friction * (c.lambdaN / h), lvt) / lvt)
      // vn > 0 means approaching (n points a -> b). Restitution targets -e * vnPre.
      const e = Math.abs(c.vnPre) <= gh ? 0 : c.restitution
      const target = -e * Math.max(c.vnPre, 0)
      if (vn > target) dv = add(dv, scale(c.n, target - vn))
      // Separation the position pass invented (pushing out of old penetration) is not
      // kept as velocity: no faster apart than restitution or the pre-contact motion.
      const floor = Math.min(target, c.vnPre)
      if (vn < floor) dv = add(dv, scale(c.n, floor - vn))
      const ld = length(dv)
      if (ld < 1e-12) continue
      const dir = scale(dv, 1 / ld)
      const wsum = genInvMass(A, c.ra, dir) + genInvMass(B, c.rb, dir)
      if (wsum === 0) continue
      const p = scale(dv, 1 / wsum)
      applyVelImpulse(A, p, c.ra, 1)
      applyVelImpulse(B, p, c.rb, -1)
      const key = `${c.a}:${c.b}`
      const prev = impulses.get(key)
      const total = c.lambdaN / h + Math.abs(dot(p, c.n))
      if (!prev) impulses.set(key, { ...c, lambdaN: total })
      else prev.lambdaN = Math.max(prev.lambdaN, total)
    }
    for (const j of hinges) solveHingeMotor(j, h)
  }

  function rotateBody(b: Body, axisAngle: V) {
    // Apply a full angular correction to a single dynamic body (the world side is fixed).
    const th = length(axisAngle)
    if (th < 1e-12) return
    const n = scale(axisAngle, 1 / th)
    const In = applyInvI(b, n)
    const dw = scale(In, th / dot(n, In))
    b.q = normalizeQ(add4(b.q, scale4(qmul([dw[0], dw[1], dw[2], 0], b.q), 0.5)))
  }
  function solveHingePos(j: Hinge) {
    const b = bodies[j.body]
    rotateBody(b, cross(rot(b.q, j.aB), j.axis))
    if (j.limits) {
      const n = rot(b.q, j.nB)
      const th = Math.atan2(dot(cross(j.normal, n), j.axis), dot(j.normal, n))
      const clamped = Math.max(j.limits[0], Math.min(j.limits[1], th))
      if (clamped !== th) rotateBody(b, scale(j.axis, clamped - th))
    }
    const r = rot(b.q, j.rB)
    const c = sub(add(b.x, r), j.anchor)
    const lc = length(c)
    if (lc > 1e-12) {
      const n = scale(c, 1 / lc)
      applyPosImpulse(b, scale(n, lc / genInvMass(b, r, n)), r, -1)
    }
  }
  function solveHingeMotor(j: Hinge, h: number) {
    if (!j.motor) return
    const b = bodies[j.body]
    const wAxis = dot(b.w, j.axis)
    const Ia = applyInvI(b, j.axis)
    let L = (j.motor.velocity - wAxis) / dot(j.axis, Ia)
    const max = j.motor.maxTorque * h
    L = Math.max(-max, Math.min(max, L))
    b.w = add(b.w, scale(Ia, L))
  }

  let stepsLeft = 1
  let combine: Combine = opts.combine ?? defaultCombine

  const core: PhysicsCore & { combine: Combine } = {
    name: 'xpbd',
    get combine() { return combine },
    set combine(c: Combine) { combine = c },
    setRules(next) { Object.assign(rules, next) },
    addBody(spec) {
      const m = spec.motion === 'dynamic' ? volume(spec) * spec.material.density : 0
      const s = spec.shape
      const radius = s.kind === 'sphere' ? s.radius : s.kind === 'box' ? length(s.half) : s.kind === 'capsule' ? s.halfHeight + s.radius : s.size
      bodies.push({
        spec, dynamic: spec.motion === 'dynamic', x: [...spec.position], q: spec.rotation ? [...spec.rotation] : [0, 0, 0, 1], v: spec.velocity ? [...spec.velocity] : [0, 0, 0], w: [0, 0, 0],
        px: [...spec.position], pq: [0, 0, 0, 1], invMass: m ? 1 / m : 0, invI: m ? invInertia(spec, m) : [0, 0, 0], sleepTimer: 0, sleeping: false, radius, removed: false,
      })
      return bodies.length - 1
    },
    removeBody(id) { bodies[id].removed = true },
    addHinge(spec: HingeSpec) {
      const b = bodies[spec.body]
      const normal: V = Math.abs(spec.axis[0]) < 0.9 ? [1, 0, 0] : [0, 0, 1]
      const iq = inv(b.q)
      hinges.push({ body: spec.body, anchor: spec.anchor, axis: spec.axis, normal, rB: rot(iq, sub(spec.anchor, b.x)), aB: rot(iq, spec.axis), nB: rot(iq, normal), limits: spec.limits, motor: spec.motor && { ...spec.motor } })
      return hinges.length - 1
    },
    setMotorVelocity(joint, velocity) {
      const j = hinges[joint]
      if (j.motor) j.motor.velocity = velocity
      wake(bodies[j.body])
    },
    step(dt) {
      const n = rules.substeps, h = dt / n
      const pairs = candidatePairs(dt)
      const impulses = new Map<string, Solved>()
      for (let i = 0; i < n; i++) { stepsLeft = n - i; substep(h, pairs, rules.gravity, impulses) }
      for (const b of bodies) {
        if (b.target) { b.target = undefined; continue }
        if (!b.dynamic || b.sleeping) continue
        if (length(b.v) < 0.05 && length(b.w) < 0.1) { b.sleepTimer += dt; if (b.sleepTimer > 0.5) { b.sleeping = true; b.v = [0, 0, 0]; b.w = [0, 0, 0] } }
        else b.sleepTimer = 0
      }
      const now = new Set<string>()
      for (const [key, c] of impulses) {
        now.add(key)
        if (!touching.has(key)) fresh.push({ a: c.a, b: c.b, point: c.point, normal: c.n, impulse: c.lambdaN })
      }
      touching = now
    },
    contacts() { const out = fresh; fresh = []; return out },
    applyImpulse(id, i) { const b = bodies[id]; wake(b); b.v = add(b.v, scale(i, b.invMass)) },
    position(id) { return [...bodies[id].x] },
    velocity(id) { return [...bodies[id].v] },
    setState(id, p, vel, r) {
      const b = bodies[id]
      b.x = [...p]; b.v = [...vel]; b.w = [0, 0, 0]
      if (r) b.q = [...r]
      wake(b)
    },
    setKinematicTarget(id, p) { bodies[id].target = [...p] },
    sleeping(id) { return bodies[id].sleeping },
    editHeights(id, x0, z0, w, hgt, values) {
      const b = bodies[id], s = b.spec.shape
      if (s.kind !== 'heightfield') throw new Error('not a heightfield')
      for (let z = 0; z < hgt; z++) for (let x = 0; x < w; x++) s.heights[(z0 + z) * s.n + x0 + x] = values[z * w + x]
      const cell = s.size / (s.n - 1)
      const lo = [b.x[0] - s.size / 2 + x0 * cell, b.x[2] - s.size / 2 + z0 * cell], hi = [lo[0] + w * cell, lo[1] + hgt * cell]
      for (const o of bodies) if (o.dynamic && o.x[0] + o.radius >= lo[0] && o.x[0] - o.radius <= hi[0] && o.x[2] + o.radius >= lo[1] && o.x[2] - o.radius <= hi[1]) wake(o)
    },
    overlapSphere(c, r) {
      const out: BodyId[] = []
      const probe: Body = { ...bodies[0], spec: { shape: { kind: 'sphere', radius: r }, material: bodies[0].spec.material, motion: 'static', position: c }, x: c, q: [0, 0, 0, 1], radius: r, dynamic: false }
      bodies.forEach((b, i) => {
        if (b.removed || length(sub(b.x, c)) > r + b.radius) return
        const m: Manifold[] = []
        sphereVs(probe, c, r, b, i, -1, m)
        if (m.length) out.push(i)
      })
      return out
    },
    dispose() {},
  }
  return core
}
