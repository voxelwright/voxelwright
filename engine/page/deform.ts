/** #37: visual vehicle damage; no physics, renderer or lifetime side effects.
 *
 * Integration: keep one tracker per world, call recordImpact once per STRUCK/body, then
 * pack into reused storage only when changed. STRUCK has NO normal: the caller supplies
 * the outward contact normal for this body (opposite for the other body).
 * BodyState matches Piece plus motor.front. World coordinates/speed are 10 cm cells;
 * born.com/size, cabinBox, dent coordinates and maxCrushCells are this mesh's fine cells.
 * local = inverse(rot) * (world - pos) / cell + born.com. Fine parts need their own
 * frame (living.ts places each part by its low corner); never reuse coarse uniforms.
 *
 * Append DEFORM_STRUCT then DEFORM_WGSL; bind Deform separately or append at a 16-byte
 * struct offset. Dynamic binding offsets still obey device.minUniformBufferOffsetAlignment.
 * Deform vertices BEFORE subtracting com/scaling/rotation, and rotate the returned norm.
 * Smooth normals must be interpolated, unlike pieces.ts's current flat voxel normal.
 * Long merged faces need subdivision to represent a dent between their endpoints.
 * Use original local p for paint patterns. Per-window cracks stay on the CPU;
 * status.w is their maximum. Pass the chosen window's crack to deformGlass if available.
 * Clear on GONE/BROKE/respawn; repair resets existing state in place.
 */
export const MAX_DENTS = 6
export const DEFORM_BYTES = 16 * 13
export type DeformVec3 = readonly [number, number, number]
export interface BodyState {
  pos: DeformVec3
  rot: readonly [number, number, number, number]
  cell: number
  born: { com: DeformVec3; size: DeformVec3 }
  /** motor.front: +x, -x, +z, -z; defaults to +x, NOT the lamp's one-based axis. */
  front?: 0 | 1 | 2 | 3
  maxCrushCells?: number
}
export interface CabinBox { min: DeformVec3; max: DeformVec3 }
export interface Dent { center: Float64Array; radius: number; dir: Float64Array; depth: number }
export interface DeformState {
  readonly dents: readonly Dent[]
  dentCount: number
  /** Changes on impact or repair so attached effects can reuse a point on the bent skin. */
  revision: number
  front: 0 | 1 | 2 | 3
  health: number
  hoodDamage: number
  /** Front, rear, left, right (relative to motor.front). */
  readonly glassCrack: Float64Array
  scuff: number
  /** Persistent union of supplied survival boxes; do not modify externally. */
  readonly cabin: Float64Array
  maxCrushCells: number
}
const clamp = (v: number, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, v))
const finite3 = (v: ArrayLike<number>) => Number.isFinite(v[0]) && Number.isFinite(v[1]) && Number.isFinite(v[2])
function fresh(): DeformState {
  return { dents: Array.from({ length: MAX_DENTS }, () => ({ center: new Float64Array(3), radius: 0, dir: new Float64Array(3), depth: 0 })), dentCount: 0, revision: 0, front: 0, health: 1, hoodDamage: 0, glassCrack: new Float64Array(4), scuff: 0, cabin: new Float64Array(6), maxCrushCells: 0 }
}
function distanceToCabin(p: ArrayLike<number>, box: Float64Array) {
  return Math.hypot(Math.max(box[0] - p[0], 0, p[0] - box[3]), Math.max(box[1] - p[1], 0, p[1] - box[4]), Math.max(box[2] - p[2], 0, p[2] - box[5]))
}
/** No moving support ball, even after displacement, can enter the survival box:
 * radius <= .8 * distance, depth <= .2 * radius, displacement <= depth (the 1.18 factor is conservative). Thus
 * radius + 1.18 * depth < distance. Composition preserves this for all six dents.
 * At this depth the compression and the lower-panel drop both preserve orientation.
 * This deliberately gives up crumpling right against/inside the cabin, without
 * needing extra uniform fields. Supply the seat/head envelope INCLUDING camera travel.
 * The fallback protects the central upper body; custom seating MUST supply its box.
 */
function protect(d: Dent, s: DeformState) {
  const distance = distanceToCabin(d.center, s.cabin)
  // Cosmetic-only impacts keep their footprint: a windshield can crack without
  // moving any glass/metal into the seat. status supplies aggregate wear intensity.
  if (distance < 0.0001) { d.depth = 0; return }
  d.radius = Math.min(d.radius, distance * 0.8)
  d.depth = Math.min(d.depth, d.radius * 0.2)
}
/** Budget only connected swept supports. Disjoint panels retain their full budget.
 * If a new dent joins two damaged regions, redistribute their depth to preserve the
 * combined limit. At most six nodes; bitsets avoid allocations even on impacts.
 */
function limitConnected(s: DeformState) {
  let remaining = (1 << s.dentCount) - 1
  while (remaining) {
    let group = remaining & -remaining, previous = 0
    while (group !== previous) {
      previous = group
      for (let i = 0; i < s.dentCount; i++) if (group & (1 << i)) {
        const a = s.dents[i]
        for (let j = 0; j < s.dentCount; j++) if (!(group & (1 << j))) {
          const b = s.dents[j]
          if (a.depth > 0 && b.depth > 0 && Math.hypot(a.center[0]-b.center[0], a.center[1]-b.center[1], a.center[2]-b.center[2]) < a.radius + b.radius + 1.18 * (a.depth + b.depth)) group |= 1 << j
        }
      }
    }
    let total = 0
    for (let i = 0; i < s.dentCount; i++) if (group & (1 << i)) total += s.dents[i].depth
    const scale = total > 0 ? Math.min(1, s.maxCrushCells / (1.18 * total)) : 1
    for (let i = 0; i < s.dentCount; i++) if (group & (1 << i)) s.dents[i].depth *= scale
    remaining &= ~group
  }
}
export class VehicleDeformation {
  private readonly vehicles = new Map<number, DeformState>()
  get(id: number): DeformState | undefined { return this.vehicles.get(id) }
  clearVehicle(id: number): void { this.vehicles.delete(id) }
  repairVehicle(id: number): void {
    const s = this.vehicles.get(id)
    if (!s) return
    s.revision++; s.dentCount = 0; s.health = 1; s.hoodDamage = 0; s.scuff = 0; s.maxCrushCells = 0
    s.glassCrack.fill(0); s.cabin.fill(0)
    for (let i = 0; i < MAX_DENTS; i++) { const d = s.dents[i]; d.center.fill(0); d.dir.fill(0); d.radius = 0; d.depth = 0 }
  }
  /** Allocates only on the first accepted impact for an ID. Bounded six-slot work;
   * no frame/update method, timers, arrays or garbage in repeated impacts/packing.
   * Invalid input is rejected without changing damage; gentle rubs create no state.
   * Geometry/frame must stay fixed for an ID until repair/clear (pose may change).
   */
  recordImpact(id: number, body: BodyState, worldHit: DeformVec3, worldNormal: DeformVec3, closingSpeed: number, push: number, cabinBox?: CabinBox): DeformState | undefined {
    const old = this.vehicles.get(id), size = body.born.size, q = body.rot
    if (!Number.isFinite(closingSpeed) || closingSpeed < 18 || !Number.isFinite(push) || push < 0 ||
        !Number.isSafeInteger(id) || id < 0 || !finite3(body.pos) || !finite3(body.born.com) || !finite3(size) ||
        Math.min(size[0], size[1], size[2]) <= 0 || !finite3(worldHit) || !finite3(worldNormal) ||
        !finite3(q) || !Number.isFinite(q[3]) || !Number.isFinite(body.cell) || body.cell <= 0 ||
        (body.maxCrushCells !== undefined && (!Number.isFinite(body.maxCrushCells) || body.maxCrushCells < 0)) ||
        (body.front !== undefined && (!Number.isInteger(body.front) || body.front < 0 || body.front > 3))) return old
    if (cabinBox && (!finite3(cabinBox.min) || !finite3(cabinBox.max) || cabinBox.min[0] > cabinBox.max[0] || cabinBox.min[1] > cabinBox.max[1] || cabinBox.min[2] > cabinBox.max[2])) return old
    const qlen = Math.hypot(q[0], q[1], q[2], q[3]), nlen = Math.hypot(worldNormal[0], worldNormal[1], worldNormal[2])
    if (qlen < 1e-8 || nlen < 1e-8) return old
    const x = -q[0] / qlen, y = -q[1] / qlen, z = -q[2] / qlen, w = q[3] / qlen
    const hx = worldHit[0] - body.pos[0], hy = worldHit[1] - body.pos[1], hz = worldHit[2] - body.pos[2]
    const tx = 2 * (y * hz - z * hy), ty = 2 * (z * hx - x * hz), tz = 2 * (x * hy - y * hx)
    const px = (hx + w * tx + y * tz - z * ty) / body.cell + body.born.com[0]
    const py = (hy + w * ty + z * tx - x * tz) / body.cell + body.born.com[1]
    const pz = (hz + w * tz + x * ty - y * tx) / body.cell + body.born.com[2]
    const nx = -worldNormal[0] / nlen, ny = -worldNormal[1] / nlen, nz = -worldNormal[2] / nlen
    const ux = 2 * (y * nz - z * ny), uy = 2 * (z * nx - x * nz), uz = 2 * (x * ny - y * nx)
    const dx = nx + w * ux + y * uz - z * uy, dy = ny + w * uy + z * ux - x * uz, dz = nz + w * uz + x * uy - y * ux
    if (!Number.isFinite(px + py + pz + dx + dy + dz)) return old
    const s = old ?? fresh(), initial = s.dentCount === 0
    // Keep any previous protection if a caller enlarges/moves the camera envelope.
    for (let a = 0; a < 3; a++) {
      const lo = cabinBox ? cabinBox.min[a] : size[a] * (a === 1 ? 0.35 : 0.15)
      const hi = cabinBox ? cabinBox.max[a] : size[a] * (a === 1 ? 1.5 : 0.85)
      s.cabin[a] = initial ? lo : Math.min(s.cabin[a], lo)
      s.cabin[a + 3] = initial ? hi : Math.max(s.cabin[a + 3], hi)
    }
    const limit = Math.min(body.maxCrushCells ?? Infinity, Math.min(size[0], size[1], size[2]) * 0.55)
    s.maxCrushCells = initial ? limit : Math.min(s.maxCrushCells, limit)
    for (let i = 0; i < s.dentCount; i++) protect(s.dents[i], s)
    // Impulse is mass-dependent, so it modulates rather than overrides closing speed.
    const severity = clamp((closingSpeed - 18) / 110) * (0.85 + 0.15 * push / (push + 8000))
    // Local and deep enough to read without over-stretching fender stairs: 25 cm for a knock, up to 1.3 m for a heavy hit.
    const radius = Math.min((2.5 + 10.5 * Math.sqrt(severity)) / body.cell, Math.max(size[0], size[2]) * 0.45)
    let slot = -1, smallest = 0, nearest = Infinity
    for (let i = 0; i < s.dentCount; i++) {
      const d = s.dents[i], distance = Math.hypot(px - d.center[0], py - d.center[1], pz - d.center[2])
      if (d.depth < s.dents[smallest].depth) smallest = i
      if (distance < Math.max(radius, d.radius) * 0.45 && distance < nearest && dx * d.dir[0] + dy * d.dir[1] + dz * d.dir[2] > 0.5) { slot = i; nearest = distance }
    }
    const merged = slot >= 0
    if (!merged) slot = s.dentCount < MAX_DENTS ? s.dentCount++ : smallest
    const d = s.dents[slot]
    if (!merged) { d.center[0] = px; d.center[1] = py; d.center[2] = pz; d.dir[0] = dx; d.dir[1] = dy; d.dir[2] = dz; d.depth = 0; d.radius = radius }
    else d.radius = Math.min(Math.max(radius, d.radius) + nearest * 0.3, Math.max(size[0], size[2]) * 0.45)
    // Fixed center/direction on merge avoids moving old damage through the protected box.
    d.depth += (0.08 + 2.5 * severity) / body.cell
    protect(d, s)
    limitConnected(s)
    s.health = Math.max(0, s.health - (0.002 + severity * severity * 0.3))
    s.scuff = clamp(s.scuff + 0.04 + severity * 0.5)
    const front = body.front ?? 0, axis = front < 2 ? 0 : 2, sign = front % 2 === 0 ? 1 : -1
    s.front = front
    const along = ((axis === 0 ? px : pz) / size[axis] - 0.5) * 2 * sign
    const across = ((axis === 0 ? pz / size[2] : -px / size[0]) - (axis === 0 ? 0.5 : -0.5)) * 2 * sign
    s.hoodDamage = clamp(s.hoodDamage + severity * severity * 0.45 * clamp((along + 0.1) / 0.8))
    const glass = clamp((severity - 0.2) / 0.8) * clamp(py / size[1] * 2) * 0.55
    const zone = Math.abs(along) >= Math.abs(across) ? (along >= 0 ? 0 : 1) : (across >= 0 ? 3 : 2)
    s.glassCrack[zone] = clamp(s.glassCrack[zone] + glass)
    s.revision++
    if (!old) this.vehicles.set(id, s)
    return s
  }
}
const defaultTracker = new VehicleDeformation()
export const recordImpact = defaultTracker.recordImpact.bind(defaultTracker)
export const clearVehicle = defaultTracker.clearVehicle.bind(defaultTracker)
export const repairVehicle = defaultTracker.repairVehicle.bind(defaultTracker)
export const getVehicleDamage = defaultTracker.get.bind(defaultTracker)

/** CPU mirror of WGSL `deformPoint` (#61): bends a fine-part local point and normal by the same dent field, so 3D wheels track their crushed fender. */
export function deformPointCpu(
  p: readonly [number, number, number],
  n: readonly [number, number, number],
  state: DeformState | undefined,
): { pos: [number, number, number]; norm: [number, number, number] } {
  let px = p[0], py = p[1], pz = p[2]
  let nx = n[0], ny = n[1], nz = n[2]
  if (!state || state.dentCount < 1) return { pos: [px, py, pz], norm: [nx, ny, nz] }
  // Each map pushes in a single direction. Its inverse-transpose updates the wheel normal too.
  const push = (ax: number, ay: number, az: number, amount: number, gx: number, gy: number, gz: number) => {
    const k = (ax * nx + ay * ny + az * nz) / (1 + ax * gx + ay * gy + az * gz)
    nx -= k * gx; ny -= k * gy; nz -= k * gz
    px += ax * amount; py += ay * amount; pz += az * amount
  }
  const count = Math.min(state.dentCount, MAX_DENTS)
  for (let i = 0; i < count; i++) {
    const d = state.dents[i]
    if (d.radius <= 0.0001) continue
    const [dx, dy, dz] = d.dir, inv = 1 / d.radius
    let x = (px - d.center[0]) * inv, y = (py - d.center[1]) * inv, z = (pz - d.center[2]) * inv
    let support = 1 - x * x - y * y - z * z
    if (support <= 0 || d.depth <= 0) continue
    const depth = d.depth, horizontal = 1 - dy * dy
    // Two flanks meet along a line in the impact plane. The flank can be steep
    // while the displacement along the blow stays monotonic (axis dot dir = 0).
    const upX = -dy * dx, upY = horizontal, upZ = -dy * dz
    const ax = 3.7 * dz + 1.85 * upX, ay = 1.85 * upY, az = -3.7 * dx + 1.85 * upZ
    const along = ax * x + ay * y + az * z - 0.89
    const t = clamp(Math.abs(along) / 0.89), rib = 1 - t * t * (3 - 2 * t)
    // A bumper catches the sheet above the point of contact. Its raised shoulder
    // cuts across the oblique fold, including on the metal over a wheel opening.
    const acrossX = 6.8 * upX - 1.9 * dz, acrossY = 6.8 * upY, acrossZ = 6.8 * upZ + 1.9 * dx
    const line = acrossX * x + acrossY * y + acrossZ * z - 3.0, edgeT = clamp(Math.abs(line))
    const shoulder = 1 - 0.63 * horizontal * (1 - edgeT * edgeT * (3 - 2 * edgeT))
    const shoulderSlope = 0.63 * horizontal * 6 * edgeT * (1 - edgeT) * Math.sign(line)
    const inward = depth * (1 - 0.10 * horizontal), oblique = 1 - 0.66 * horizontal * rib
    const compression = oblique * shoulder
    // Broadside contact presses a face into the door between its two shoulders.
    // At the perimeter this still goes to zero with zero slope.
    const lateral = state.front >= 2 ? dx : dz, sideWeight = lateral * lateral
    const core = support * support
    const plate = support * (2 - support)
    const pressed = core + sideWeight * (plate * plate - core)
    const slope = -4 * inward * inv * compression * (support + sideWeight * (2 * plate * (1 - support) - support))
    const baseSlope = inward * inv * pressed
    const flank = baseSlope * shoulder * 0.66 * horizontal * 6 * t * (1 - t) * Math.sign(along) / 0.89
    const transverse = baseSlope * oblique * shoulderSlope
    push(dx, dy, dz, inward * pressed * compression,
      slope * x + flank * ax + transverse * acrossX,
      slope * y + flank * ay + transverse * acrossY,
      slope * z + flank * az + transverse * acrossZ)

    // The end of the folded sheet tucks down under the adjoining panel.
    // The bottom edge stays level while the grille pinches closed.
    x = (px - d.center[0]) * inv; y = (py - d.center[1]) * inv; z = (pz - d.center[2]) * inv
    support = 1 - x * x - y * y - z * z
    if (support <= 0 || horizontal <= 0) continue
    const bx = 3.4 * dz + 2.25 * dx, by = 2.25 * dy, bz = -3.4 * dx + 2.25 * dz
    const cut = bx * x + by * y + bz * z - 0.65
    const f = clamp(Math.abs(cut))
    // The sheet turns back up just behind the tuck. The narrow lip is visible from the seat.
    const back = 3.4 * (x * dx + y * dy + z * dz) - 1.60, k = clamp(Math.abs(back))
    const seam = 1 - f * f * (3 - 2 * f) - 0.80 * (1 - k * k * (3 - 2 * k))
    const h = clamp((upX * x + upY * y + upZ * z + 0.45) / 0.72), top = h * h * (3 - 2 * h)
    const drop = 0.42 * depth, base = drop * inv * support * support
    const radial = -4 * drop * inv * support * seam * top
    const edge = -base * top * 6 * f * (1 - f) * Math.sign(cut), height = base * seam * 6 * h * (1 - h) / 0.72
    const curl = base * top * 0.80 * 6 * k * (1 - k) * Math.sign(back) * 3.4
    push(-upX, -upY, -upZ, drop * support * support * seam * top,
      radial * x + edge * bx + curl * dx + height * upX, radial * y + edge * by + curl * dy + height * upY, radial * z + edge * bz + curl * dz + height * upZ)

  }
  const norm = Math.hypot(nx, ny, nz) || 1
  return { pos: [px, py, pz], norm: [nx / norm, ny / norm, nz / norm] }
}

/** Offset in floats, 16-byte aligned within out. Exactly 52 floats: meta, six posR,
 * then six dirD (NOT interleaved). Missing/healthy state is ALL zero on the GPU;
 * health=1 remains on CPU and is irrelevant to the shader's undamaged branch.
 */
export function packDeformUniforms(state: DeformState | undefined, out: Float32Array, offset = 0): void {
  if (!Number.isInteger(offset) || offset < 0 || (out.byteOffset + offset * 4) % 16 || offset + DEFORM_BYTES / 4 > out.length) throw new RangeError('Deform needs 52 floats at a 16-byte aligned offset')
  out.fill(0, offset, offset + DEFORM_BYTES / 4)
  if (!state || !state.dentCount) return
  out[offset] = state.dentCount; out[offset + 1] = state.health; out[offset + 2] = state.hoodDamage
  out[offset + 3] = Math.max(state.glassCrack[0], state.glassCrack[1], state.glassCrack[2], state.glassCrack[3])
  for (let i = 0; i < state.dentCount; i++) {
    const d = state.dents[i], p = offset + 4 + i * 4, v = offset + 28 + i * 4
    out[p] = d.center[0]; out[p + 1] = d.center[1]; out[p + 2] = d.center[2]; out[p + 3] = d.radius
    out[v] = d.dir[0]; out[v + 1] = d.dir[1]; out[v + 2] = d.dir[2]; out[v + 3] = d.depth
  }
}
export const DEFORM_STRUCT = /* wgsl */ `
// WGSL reserves meta; status has the requested [count, health, hood, glass] bytes.
struct Deform { status: vec4f, posR: array<vec4f, 6>, dirD: array<vec4f, 6> }
`
export const DEFORM_WGSL = /* wgsl */ `
struct DeformResult { pos: vec3f, norm: vec3f, scuff: f32, crease: f32 }
struct DeformPaint { albedo: vec3f, roughBoost: f32, clearcoatKeep: f32 }
fn deformHash(p: vec3f) -> f32 { return fract(sin(dot(p, vec3f(127.1, 311.7, 74.7))) * 43758.5453); }
fn deformNoise(p: vec3f) -> f32 {
  let c = floor(p);
  let f = fract(p);
  let e = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(deformHash(c), deformHash(c + vec3f(1.0, 0.0, 0.0)), e.x),
        mix(deformHash(c + vec3f(0.0, 1.0, 0.0)), deformHash(c + vec3f(1.0, 1.0, 0.0)), e.x), e.y),
    mix(mix(deformHash(c + vec3f(0.0, 0.0, 1.0)), deformHash(c + vec3f(1.0, 0.0, 1.0)), e.x),
        mix(deformHash(c + vec3f(0.0, 1.0, 1.0)), deformHash(c + vec3f(1.0, 1.0, 1.0)), e.x), e.y),
    e.z,
  );
}
fn deformPoint(p: vec3f, n: vec3f, def: Deform, frontZ: bool) -> DeformResult {
  var result = DeformResult(p, n, 0.0, 0.0);
  // No dent arithmetic on healthy cars; the branch itself still has a cost.
  if (def.status.x < 0.5) { return result; }
  for (var i = 0u; i < min(u32(def.status.x), 6u); i++) {
    let zone = def.posR[i]; let crush = def.dirD[i];
    if (zone.w <= 0.0001) { continue; }
    let u = (result.pos - zone.xyz) / zone.w;
    let support = 1.0 - dot(u, u);
    if (support <= 0.0) { continue; }
    let core = support * support;
    let dir = crush.xyz;
    let depth = crush.w;
    // The sharp fold runs across the impact plane. Its slope has zero component
    // along the blow, so only the compact radial envelope can reduce the Jacobian.
    let horizontal = 1.0 - dir.y * dir.y;
    let up = vec3f(0, 1, 0) - dir.y * dir;
    let side = vec3f(dir.z, 0, -dir.x);
    let axis = 3.7 * side + 1.85 * up;
    let along = dot(u, axis) - 0.89;
    let t = clamp(abs(along) / 0.89, 0.0, 1.0);
    let ridge = 1.0 - t * t * (3.0 - 2.0 * t);
    let inward = depth * (1.0 - 0.10 * horizontal);
    let across = 6.8 * up - 1.9 * side;
    let line = dot(across, u) - 3.0;
    let k = min(abs(line), 1.0);
    let shoulder = 1.0 - 0.63 * horizontal * (1.0 - k*k*(3.0-2.0*k));
    let shoulderSlope = 0.63 * horizontal * 6.0*k*(1.0-k) * sign(line);
    let oblique = 1.0 - 0.66 * horizontal * ridge;
    let compression = oblique * shoulder;
    let flank = 0.66 * horizontal * 6.0 * t * (1.0 - t) * sign(along) / 0.89;
    let lateral = select(dir.z, dir.x, frontZ);
    let sideWeight = lateral * lateral;
    let plate = support * (2.0 - support);
    let pressed = mix(core, plate * plate, sideWeight);
    let slope = mix(support, 2.0 * plate * (1.0 - support), sideWeight);
    let grad = (inward / zone.w) * (-4.0 * slope * compression * u + pressed * (flank * shoulder * axis + oblique * shoulderSlope * across));
    result.norm -= grad * (dot(dir, result.norm) / (1.0 + dot(dir, grad)));
    result.pos += dir * (inward * pressed * compression);

    // Tuck the upper sheet down along one diagonal seam. Its axis is perpendicular
    // to up; its depth and the inward displacement together fit within crush.w.
    if (horizontal > 0.0 && depth > 0.0) {
      let v = (result.pos - zone.xyz) / zone.w;
      let support2 = max(0.0, 1.0 - dot(v, v));
      let joint = 3.4 * side + 2.25 * dir;
      let cut = dot(v, joint) - 0.65;
      let f = min(abs(cut), 1.0);
      let back = 3.4 * dot(v, dir) - 1.60;
      let curlT = min(abs(back), 1.0);
      let seam = 1.0 - f*f*(3.0-2.0*f) - 0.80 * (1.0 - curlT*curlT*(3.0-2.0*curlT));
      let h = clamp((dot(v, up) + 0.45) / 0.72, 0.0, 1.0);
      let top = h * h * (3.0 - 2.0 * h);
      let drop = 0.42 * depth;
      let gradDrop = (drop / zone.w) * (-4.0 * support2 * seam * top * v + support2 * support2 *
        (-top * 6.0 * f * (1.0 - f) * sign(cut) * joint + top * 0.80 * 6.0*curlT*(1.0-curlT) * sign(back) * 3.4 * dir + seam * 6.0 * h * (1.0 - h) * up / 0.72));
      result.norm += gradDrop * (dot(up, result.norm) / (1.0 - dot(up, gradDrop)));
      result.pos -= up * (drop * support2 * support2 * seam * top);
    }

    // A protected window can still be marked by a zero-depth impact.
    let strength = select(min(crush.w / zone.w * 7.5, 1.0), min((1.0 - def.status.y) * 3.0, 1.0), crush.w <= 0.0);
    result.scuff = max(result.scuff, strength * core);
    result.crease = max(result.crease, strength * core * (0.25 + 0.75 * ridge));

  }
  result.norm = normalize(result.norm);
  return result;
}
fn deformPaint(albedo: vec3f, scuff: f32, crease: f32, p: vec3f) -> DeformPaint { return deformPaintSeen(albedo, scuff, crease, p, 1.0); }
// At the crushed centre a lamp loses its light. A lamp on the shoulder of the dent stays lit.
fn deformLamp(scuff: f32) -> f32 { return smoothstep(0.58, 0.88, scuff); }
// A crushed paint edge lifts in a short, irregular patch. Only its deepest chips expose metal.
fn deformPaintSeen(albedo: vec3f, scuff: f32, crease: f32, p: vec3f, detail: f32) -> DeformPaint {
  if (scuff <= 0.0 && crease <= 0.0) { return DeformPaint(albedo, 0.0, 1.0); }
  let x = (p.x + 0.35) / 3.25;
  let tip = max(0.0, 1.0 - x*x);
  let grain = deformNoise(p * vec3f(2.8,5.3,2.2));
  let flake = deformNoise(p * vec3f(1.1,1.9,1.1) + vec3f(9.4,2.5,0.3));
  let path = 0.11*x - 0.10*x*x + 0.25*(flake - 0.5);
  let edge = abs(p.y - path) - tip * (0.13 + 0.26*(1.0 - smoothstep(-0.65,0.66,x)) + 0.32*(flake - 0.5));
  let scar = tip * (1.0 - smoothstep(-0.06,0.06,edge + 0.15*(grain-0.5)));
  let rubbed = smoothstep(0.12,0.52,scuff) * scar * detail;
  let steel = smoothstep(0.58,0.80,grain) * smoothstep(0.30,0.73,scuff);
  let primer = mix(vec3f(0.18,0.15,0.13), albedo, 0.16);
  let colour = mix(albedo, mix(primer,vec3f(0.32,0.30,0.27),steel), rubbed);
  // A crushed coat crazes on both flanks. Primer and bare chips lose the coat entirely.
  let crazed = smoothstep(0.12, 0.70, scuff) * (0.55 + 0.45 * crease);
  let rough = min(0.91, scuff * 0.02 + crazed * 0.50 + rubbed * 0.66);
  return DeformPaint(colour, rough, (1.0 - crazed * 0.86) * (1.0 - rubbed * 0.98));
}
// p is window-local, relative to the impact center, in the same fine cells as scuff.
fn deformGlass(crack: f32, scuff: f32, p: vec3f) -> f32 {
  if (crack <= 0.0 || scuff <= 0.0) { return 0.0; }
  let radial = length(p);
  let angle = atan2(p.y + p.z * 0.37, p.x + 0.0001);
  let jag = (deformNoise(p * 0.45 + vec3f(2.3, 5.1, 1.7)) - 0.5) * 0.55;
  let spokes = 1.0 - smoothstep(0.015, 0.095, abs(sin(angle * 7.0 + jag + sin(radial * 0.55) * 0.22)));
  let sector = floor((angle + 3.14159) * 2.23);
  let ringShift = deformHash(vec3f(sector, 1.0, 4.0)) * 3.14;
  let rings = 1.0 - smoothstep(0.02, 0.12, abs(sin(radial * 1.45 + ringShift + sin(angle * 5.0) * 0.35)));
  return clamp(crack, 0.0, 1.0) * clamp(scuff, 0.0, 1.0) * clamp(max(spokes, rings * 0.72) + crack * 0.12, 0.0, 1.0);
}
`
