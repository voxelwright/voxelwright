// Plan geometry shared by the renderer (browser), validator and scorer (node).
// Convention: x grows to the right of the image, z grows downward, metres.
// Sagitta s: the arc midpoint is chordMid + s * n, with n = (dz, -dx) for the
// unit chord direction d = (dx, dz) from a to b (so walking a -> b on the image,
// positive s bulges to the walker's left).

export const sub = (p, q) => ({ x: p.x - q.x, z: p.z - q.z })
export const dist = (p, q) => Math.hypot(p.x - q.x, p.z - q.z)

export function arcInfo(a, b, s) {
  const c = dist(a, b)
  const d = { x: (b.x - a.x) / c, z: (b.z - a.z) / c }
  const n = { x: d.z, z: -d.x }
  const mid = { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 }
  const top = { x: mid.x + n.x * s, z: mid.z + n.z * s }
  if (Math.abs(s) < 1e-6) return { straight: true, c, length: c, mid, top, n }
  const R = (c * c / 4 + s * s) / (2 * Math.abs(s))
  const k = Math.sign(s) * (Math.abs(s) - R)
  const center = { x: mid.x + n.x * k, z: mid.z + n.z * k }
  const a0 = Math.atan2(a.z - center.z, a.x - center.x)
  const a1 = Math.atan2(b.z - center.z, b.x - center.x)
  const am = Math.atan2(top.z - center.z, top.x - center.x)
  const norm = (t) => ((t % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)
  let sweep = norm(a1 - a0)
  const close = (t, u) => Math.abs(Math.atan2(Math.sin(t - u), Math.cos(t - u))) < 1e-3
  if (!close(a0 + sweep / 2, am)) sweep -= 2 * Math.PI
  return { straight: false, c, R, center, a0, sweep, length: Math.abs(sweep) * R, mid, top, n }
}

// Point at arc length t (metres from a) along the wall, plus the unit tangent.
export function pointAlong(a, b, s, t) {
  const g = arcInfo(a, b, s)
  if (g.straight) {
    const u = t / g.c
    return { x: a.x + (b.x - a.x) * u, z: a.z + (b.z - a.z) * u, tx: (b.x - a.x) / g.c, tz: (b.z - a.z) / g.c }
  }
  const ang = g.a0 + g.sweep * (t / g.length)
  const dir = Math.sign(g.sweep)
  return {
    x: g.center.x + g.R * Math.cos(ang), z: g.center.z + g.R * Math.sin(ang),
    tx: -Math.sin(ang) * dir, tz: Math.cos(ang) * dir,
  }
}

export function wallPolyline(a, b, s, step = 0.1) {
  const L = arcInfo(a, b, s).length
  const n = Math.max(1, Math.ceil(L / step))
  const pts = []
  for (let i = 0; i <= n; i++) pts.push(pointAlong(a, b, s, (L * i) / n))
  return pts
}

export const wallLength = (a, b, s) => arcInfo(a, b, s).length

export function indexPlan(plan) {
  const corner = new Map(plan.corners.map((c) => [c.id, c]))
  const wall = new Map(plan.walls.map((w) => [w.id, w]))
  return { corner, wall }
}

// World-space endpoints of an opening.
export function openingEnds(plan, o, idx = indexPlan(plan)) {
  const w = idx.wall.get(o.wall)
  const a = idx.corner.get(w.a), b = idx.corner.get(w.b)
  return [pointAlong(a, b, w.sagitta || 0, o.from), pointAlong(a, b, w.sagitta || 0, o.to)]
}

if (typeof window !== 'undefined') window.geom = { arcInfo, pointAlong, wallPolyline, wallLength, indexPlan, openingEnds, dist }
