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
    const limit = Math.min(body.maxCrushCells ?? Infinity, Math.min(size[0], size[1], size[2]) * 0.3)
    s.maxCrushCells = initial ? limit : Math.min(s.maxCrushCells, limit)
    for (let i = 0; i < s.dentCount; i++) protect(s.dents[i], s)
    // Impulse is mass-dependent, so it modulates rather than overrides closing speed.
    const severity = clamp((closingSpeed - 18) / 110) * (0.85 + 0.15 * push / (push + 8000))
    // Local and deep enough to read: 25 cm round for a knock, 1.25 m for a crash at speed. Wider and shallower, a
    // crash bent a whole front by a few centimetres and nobody could see it.
    const radius = Math.min((2.5 + 10 * Math.sqrt(severity)) / body.cell, Math.max(size[0], size[2]) * 0.45)
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
    else d.radius = Math.min(Math.max(radius, d.radius) + nearest * 0.25, Math.max(size[0], size[2]) * 0.45)
    // Fixed center/direction on merge avoids moving old damage through the protected box.
    d.depth += (0.05 + 3 * severity) / body.cell
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
    // Equivalent to reversed smoothstep, with defined ascending-edge semantics.
    let s = 1.0 - t * t * (3.0 - 2.0 * t);
    let ds = -6.0 * t * (1.0 - t);
    let radial = delta / max(dist, 0.00001);
    let grain = vec3f(7.0, 3.0, 11.0);
    let phase = 36.0 * t + dot(delta / zone.w, grain);
    let wave = sin(phase); let slope = cos(phase);
    let buckle = 1.0 + 0.18 * t * t * wave;
    let field = s * s * buckle;
    let derivative = radial * (2.0 * s * ds * buckle + s * s * 0.36 * t * wave)
      + s * s * 0.18 * t * t * slope * (radial * 36.0 + grain);
    let gradient = derivative * (crush.w / zone.w);
    // Exact inverse-transpose of I + dir * gradient^T, composed per dent.
    // CPU depth/radius limits keep the denominator positive; no flipped normals.
    result.norm = normalize(result.norm - gradient * dot(crush.xyz, result.norm) / (1.0 + dot(crush.xyz, gradient)));
    result.pos += crush.xyz * (crush.w * field);
    // Zero-depth cabin dents still carry scuffs and cracks. The 208-byte format
    // has no per-zone cosmetic scalar, so these use the vehicle wear aggregate.
    let strength = select(clamp(crush.w / zone.w * 8.0, 0.0, 1.0), clamp((1.0 - def.status.y) * 3.0, 0.0, 1.0), crush.w <= 0.0);
    let rim = 4.0 * t * (1.0 - t);
    result.scuff = max(result.scuff, strength * s * (0.55 + 0.45 * rim));
    result.crease = max(result.crease, strength * s * (0.15 + 0.85 * rim * abs(wave)));
  }
  return result;
}
fn deformHash(p: vec3f) -> f32 { return fract(sin(dot(p, vec3f(127.1, 311.7, 74.7))) * 43758.5453); }
fn deformPaint(albedo: vec3f, scuff: f32, crease: f32, p: vec3f) -> DeformPaint { return deformPaintSeen(albedo, scuff, crease, p, 1.0); }
// detail: how much of its fine scratches show (1 near; toward 0 where they are finer than a pixel and would sparkle).
fn deformPaintSeen(albedo: vec3f, scuff: f32, crease: f32, p: vec3f, detail: f32) -> DeformPaint {
  if (scuff <= 0.0 && crease <= 0.0) { return DeformPaint(albedo, 0.0, 1.0); }
  let wear = clamp(scuff, 0.0, 1.0);
  let lane = p.z * 6.0 + p.y * 4.0 + sin(p.x * 0.21) * 0.6;
  let along = p.x * 0.4;
  let seed = vec3f(floor(along), floor(lane), 7.0);
  let streak = mix(deformHash(seed), deformHash(seed + vec3f(1.0, 0.0, 0.0)), smoothstep(0.0, 1.0, fract(along)));
  let jitter = 0.15 + deformHash(vec3f(floor(lane), 1.0, 4.0)) * 0.7;
  let thin = 1.0 - smoothstep(0.025, 0.12, abs(fract(lane) - jitter));
  let scratch = smoothstep(0.65, 0.9, streak) * thin * wear * detail;
  let steel = vec3f(0.31, 0.33, 0.35) + vec3f(streak * 0.12);
  let primer = mix(albedo, vec3f(0.065, 0.07, 0.075), wear * 0.35);
  let col = mix(primer, steel, scratch * 0.9);
  return DeformPaint(col * (1.0 - clamp(crease, 0.0, 1.0) * 0.28), wear * 0.65, 1.0 - wear * 0.95);
}
// p is window-local, relative to the impact center, in the same fine cells as scuff.
fn deformGlass(crack: f32, scuff: f32, p: vec3f) -> f32 {
  if (crack <= 0.0 || scuff <= 0.0) { return 0.0; }
  let radial = length(p);
  let angle = atan2(p.y + p.z * 0.37, p.x + 0.0001);
  let spokes = 1.0 - smoothstep(0.015, 0.10, abs(sin(angle * 9.0 + sin(radial * 0.6) * 0.18)));
  let rings = 1.0 - smoothstep(0.02, 0.13, abs(sin(radial * 1.7 + sin(angle * 7.0) * 0.4)));
  return clamp(crack, 0.0, 1.0) * clamp(scuff, 0.0, 1.0) * clamp(max(spokes, rings * 0.75) + crack * 0.15, 0.0, 1.0);
}
`
