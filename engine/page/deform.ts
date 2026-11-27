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
  return { dents: Array.from({ length: MAX_DENTS }, () => ({ center: new Float64Array(3), radius: 0, dir: new Float64Array(3), depth: 0 })), dentCount: 0, health: 1, hoodDamage: 0, glassCrack: new Float64Array(4), scuff: 0, cabin: new Float64Array(6), maxCrushCells: 0 }
}
function distanceToCabin(p: ArrayLike<number>, box: Float64Array) {
  return Math.hypot(Math.max(box[0] - p[0], 0, p[0] - box[3]), Math.max(box[1] - p[1], 0, p[1] - box[4]), Math.max(box[2] - p[2], 0, p[2] - box[5]))
}
/** No moving support ball, even after displacement, can enter the survival box:
 * radius <= .8 * distance, depth <= .2 * radius, ripple <= 1.18. Thus
 * radius + 1.18 * depth < distance. Composition preserves this for all six dents.
 * |gradient(field)| < 4.6 / radius, so depth/radius <= .2 also keeps every Jacobian positive.
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
    s.dentCount = 0; s.health = 1; s.hoodDamage = 0; s.scuff = 0; s.maxCrushCells = 0
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
    const along = ((axis === 0 ? px : pz) / size[axis] - 0.5) * 2 * sign
    const across = ((axis === 0 ? pz / size[2] : -px / size[0]) - (axis === 0 ? 0.5 : -0.5)) * 2 * sign
    s.hoodDamage = clamp(s.hoodDamage + severity * severity * 0.45 * clamp((along + 0.1) / 0.8))
    const glass = clamp((severity - 0.2) / 0.8) * clamp(py / size[1] * 2) * 0.55
    const zone = Math.abs(along) >= Math.abs(across) ? (along >= 0 ? 0 : 1) : (across >= 0 ? 3 : 2)
    s.glassCrack[zone] = clamp(s.glassCrack[zone] + glass)
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
  const count = Math.min(state.dentCount, MAX_DENTS)
  for (let i = 0; i < count; i++) {
    const d = state.dents[i]
    if (d.radius <= 0.0001) continue
    const dx = px - d.center[0], dy = py - d.center[1], dz = pz - d.center[2]
    const dist = Math.hypot(dx, dy, dz)
    if (dist >= d.radius) continue
    const t = dist / d.radius
    const s = 1 - t * t * (3 - 2 * t)
    const ds = -6 * t * (1 - t)
    const core = s * (1.55 - 0.55 * s)
    const dcore = (1.55 - 1.10 * s) * ds
    const env = 16 * t * t * (1 - t) * (1 - t)
    const denv = 32 * t * (1 - t) * (1 - 2 * t)
    const invD = 1 / Math.max(dist, 0.00001)
    const rx = dx * invD, ry = dy * invD, rz = dz * invD
    const ux = dx / d.radius, uy = dy / d.radius, uz = dz / d.radius
    const p1 = 3.2 * t + ux * 2.4 + uy * 1.2 + uz * 3.0
    const p2 = 2.0 * t + ux * -2.8 + uy * 1.8 + uz * 1.6
    const wave = 0.62 * Math.sin(p1) + 0.38 * Math.sin(p2)
    const c1 = 0.62 * Math.cos(p1), c2 = 0.38 * Math.cos(p2)
    const buckle = 1 + 0.16 * env * wave
    const field = core * buckle
    const radScale = dcore * buckle + core * 0.16 * denv * wave
    const waveScale = core * 0.16 * env
    const gScale = d.depth / d.radius
    const gx = (rx * radScale + waveScale * (c1 * (rx * 3.2 + 2.4) + c2 * (rx * 2.0 - 2.8))) * gScale
    const gy = (ry * radScale + waveScale * (c1 * (ry * 3.2 + 1.2) + c2 * (ry * 2.0 + 1.8))) * gScale
    const gz = (rz * radScale + waveScale * (c1 * (rz * 3.2 + 3.0) + c2 * (rz * 2.0 + 1.6))) * gScale
    const cDotN = d.dir[0] * nx + d.dir[1] * ny + d.dir[2] * nz
    const denom = 1 + d.dir[0] * gx + d.dir[1] * gy + d.dir[2] * gz
    if (Math.abs(denom) > 1e-6) {
      const k = cDotN / denom
      nx -= gx * k; ny -= gy * k; nz -= gz * k
      const nl = Math.hypot(nx, ny, nz) || 1
      nx /= nl; ny /= nl; nz /= nl
    }
    const move = d.depth * field
    px += d.dir[0] * move; py += d.dir[1] * move; pz += d.dir[2] * move
  }
  return { pos: [px, py, pz], norm: [nx, ny, nz] }
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
fn deformPoint(p: vec3f, n: vec3f, def: Deform) -> DeformResult {
  var result = DeformResult(p, n, 0.0, 0.0);
  // No dent arithmetic on healthy cars; the branch itself still has a cost.
  if (def.status.x < 0.5) { return result; }
  for (var i = 0u; i < min(u32(def.status.x), 6u); i++) {
    let zone = def.posR[i]; let crush = def.dirD[i];
    let delta = result.pos - zone.xyz;
    let dist = length(delta);
    if (zone.w <= 0.0001 || dist >= zone.w) { continue; }
    let t = dist / zone.w;
    let u = delta / zone.w;
    // Broad flat-crushed core (1.55*s - 0.55*s^2) with low-frequency architectural sheet-metal folds
    // (no high-frequency ripples that spike thin voxel silhouettes): C1-smooth, buckle in [0.84, 1.16], Jacobian > 0.
    let s = 1.0 - t * t * (3.0 - 2.0 * t);
    let ds = -6.0 * t * (1.0 - t);
    let core = s * (1.55 - 0.55 * s);
    let dcore = (1.55 - 1.10 * s) * ds;
    let env = 16.0 * t * t * (1.0 - t) * (1.0 - t);
    let denv = 32.0 * t * (1.0 - t) * (1.0 - 2.0 * t);
    let radial = delta / max(dist, 0.00001);
    let g1 = vec3f(2.4, 1.2, 3.0);
    let g2 = vec3f(-2.8, 1.8, 1.6);
    let p1 = 3.2 * t + dot(u, g1);
    let p2 = 2.0 * t + dot(u, g2);
    let wave = 0.62 * sin(p1) + 0.38 * sin(p2);
    let dwave = 0.62 * cos(p1) * (radial * 3.2 + g1) + 0.38 * cos(p2) * (radial * 2.0 + g2);
    let buckle = 1.0 + 0.16 * env * wave;
    let field = core * buckle;
    let derivative = radial * (dcore * buckle + core * 0.16 * denv * wave) + (core * 0.16 * env) * dwave;
    let gradient = derivative * (crush.w / zone.w);
    // Exact inverse-transpose of I + dir * gradient^T, composed per dent.
    // CPU depth/radius limits (<= 0.2) keep 1 + dot(dir, gradient) > 0; no flipped normals.
    result.norm = normalize(result.norm - gradient * dot(crush.xyz, result.norm) / (1.0 + dot(crush.xyz, gradient)));
    result.pos += crush.xyz * (crush.w * field);
    // Zero-depth cabin dents still carry scuffs and cracks. The 208-byte format
    // has no per-zone cosmetic scalar, so these use the vehicle wear aggregate.
    let strength = select(clamp(crush.w / zone.w * 7.5, 0.0, 1.0), clamp((1.0 - def.status.y) * 3.0, 0.0, 1.0), crush.w <= 0.0);
    // Concentrate paint chipping tightly around the actual contact core (s^2.7) so wear never
    // bleeds across the whole hood or opposite fender; keep crease broader (s^2) for fold shading & hood lift.
    let tight = s * s * (0.25 + 0.75 * s);
    let rim = 4.0 * t * (1.0 - t);
    let bend = clamp(length(derivative) * 0.45, 0.0, 1.0);
    result.scuff = max(result.scuff, strength * tight);
    result.crease = max(result.crease, strength * s * s * (0.22 + 0.78 * max(bend * rim, env * abs(wave))));
  }
  return result;
}
fn deformPaint(albedo: vec3f, scuff: f32, crease: f32, p: vec3f) -> DeformPaint { return deformPaintSeen(albedo, scuff, crease, p, 1.0); }
// Crumpled painted sheet metal (#62): preserves the vehicle's own paint colour across most of each
// dented panel so dents read as folded steel rather than flat grey primer smears. Breaks showroom
// clear coat over the bent panel and limits exposed brushed bare metal to thin, crisp directional
// scratches and narrow chipped fold-ridge scars (zero broad grey halos, zero periodic zebra stripes).
fn deformPaintSeen(albedo: vec3f, scuff: f32, crease: f32, p: vec3f, detail: f32) -> DeformPaint {
  if (scuff <= 0.0 && crease <= 0.0) { return DeformPaint(albedo, 0.0, 1.0); }
  let wear = clamp(scuff, 0.0, 1.0);
  let fold = clamp(crease, 0.0, 1.0);
  // Organic domain warp along the drag axis p.x so individual scratches sweep naturally without repeating.
  let w1 = deformNoise(vec3f(p.x * 0.20, p.y * 0.90, p.z * 0.30) + vec3f(2.1, 7.3, 4.9)) - 0.5;
  let w2 = deformNoise(vec3f(p.x * 0.38, p.y * 1.75, p.z * 0.35) + vec3f(9.4, 1.7, 6.2)) - 0.5;
  let py = p.y + w1 * 0.55;
  // Non-periodic multi-octave elongated scratch noise (thresholded strictly at sparse high peaks, NOT periodic ridges).
  let sMacro = deformNoise(vec3f(p.x * 0.16, py * 2.1, p.z * 0.25) + vec3f(3.7, 1.2, 6.4));
  let sLong = deformNoise(vec3f(p.x * 0.24, (py + w2 * 0.35) * 5.6, p.z * 0.28) + vec3f(14.2, 3.8, 7.1));
  let sFine = deformNoise(vec3f(p.x * 0.42, (py + w1 * 0.25) * 11.5, p.z * 0.32) + vec3f(4.6, 12.1, 9.5));
  let sBreak = deformNoise(vec3f(p.x * 0.65, py * 1.6, p.z * 0.50) + vec3f(8.1, 5.4, 2.3));
  // Thin, sparse, crisp directional bare-steel gouges along the contact scar & sharpest fold ridge (~12-18% coverage, 82%+ red paint).
  let scratchField = sLong * 0.58 + sFine * 0.27 + sMacro * 0.15;
  let coreScratch = smoothstep(0.56, 0.67, scratchField + (wear - 0.48) * 0.16) * smoothstep(0.32, 0.62, sBreak) * smoothstep(0.14, 0.46, wear + fold * 0.34);
  let fineScratch = smoothstep(0.62, 0.74, sFine * 0.65 + sLong * 0.35) * smoothstep(0.38, 0.68, sMacro) * smoothstep(0.12, 0.42, wear + fold * 0.30) * detail;
  // Crisp chipped bare-metal flecks right along the sharpest bent crease crest (e.g. pinched wheel-arch lip & hood fold).
  let ridgeChip = smoothstep(0.54, 0.68, sLong * 0.55 + sBreak * 0.45) * smoothstep(0.42, 0.74, fold) * smoothstep(0.12, 0.38, wear + fold * 0.26);
  let bareSteel = clamp(max(max(coreScratch, fineScratch * 0.88), ridgeChip * 0.94), 0.0, 1.0);
  // Crisp narrow dark primer / rubbed-paint border right beside bare scratches (never a broad soot smudge!).
  let scuffEdge = smoothstep(0.50, 0.63, scratchField + (wear - 0.44) * 0.14) * smoothstep(0.32, 0.60, sBreak) * smoothstep(0.14, 0.44, wear + fold * 0.28) * (1.0 - bareSteel);
  // Keep rich painted colour across the panel; show dents via bent clearcoat highlights, not darkened soot.
  var col = mix(albedo, albedo * 0.34 + vec3f(0.038, 0.040, 0.044), clamp(scuffEdge * 0.75, 0.0, 0.75));
  // Thin bright brushed bare-steel scratches with fine metallic contrast.
  let steelCol = vec3f(0.34, 0.345, 0.342) * (0.76 + 0.44 * sFine);
  col = mix(col, steelCol, bareSteel);
  // Only minimal fold tinting (0.05) so curved dents read via bent highlights rather than dirt blotches.
  col *= 1.0 - smoothstep(0.50, 0.95, fold) * 0.05;
  // Break showroom clearcoat across the bent panel while keeping the paint rich red; bare steel is satin-metallic.
  let roughBoost = clamp(max(wear * 0.30 + fold * 0.28, mix(scuffEdge * 0.65, 0.26, bareSteel)), 0.0, 1.0);
  let coatKeep = clamp(1.0 - clamp(wear * 0.70 + fold * 0.54 + bareSteel * 0.85 + scuffEdge * 0.55, 0.0, 0.92), 0.08, 1.0);
  return DeformPaint(col, roughBoost, coatKeep);
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
