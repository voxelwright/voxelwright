// Animated 3D mechanical wheels for driven vehicles (#27): raw WebGPU instanced pass.
// Draws stylized voxel-aesthetic treaded tires, recessed 5-spoke alloy rims, fixed brake calipers,
// and rotating brake rotors that glow orange-red under sustained hard braking.
// Zero GPU work when no drivable wheeled vehicle is visible.
import { shader, type Target } from '../probe/gpu.ts'
import { deformPointCpu, type DeformState } from './deform.ts'
import type { Foot, Motor } from './living.ts'
import type { View } from './march.ts'
import { LOCAL_LIGHTS_STRUCT, localLightsEval } from './lights.ts'

const MAX_WHEELS = 64
const VERT_FLOATS = 13 // pos(3), normal(3), color(3), meta(4: spins, glowWeight, metallic, rough)
const INST_FLOATS = 16 // centerR(4), axisXW(4), axisYRoll(4), axisZHeat(4)

const CODE = /* wgsl */ `
struct U {
  eye: vec3f, tanHalf: f32,
  right: vec3f, aspect: f32,
  up: vec3f, pad0: f32,
  forward: vec3f, pad1: f32,
  sun: vec3f, day: f32,
}
@group(0) @binding(0) var<uniform> u: U;
${LOCAL_LIGHTS_STRUCT}
@group(0) @binding(1) var<uniform> localLights: LocalLights;
${localLightsEval()}

struct Out {
  @builtin(position) pos: vec4f,
  @location(0) colour: vec3f,
  @location(1) n: vec3f,
  @location(2) seen: vec3f,
  @location(3) @interpolate(flat) fx: vec4f, // heat, glowWeight, metallic, rough
}

const NEAR = 1.0;
const FAR = 100000.0;

@vertex fn vs(
  @location(0) pos: vec3f,
  @location(1) normal: vec3f,
  @location(2) colour: vec3f,
  @location(3) props: vec4f,
  @location(4) centerR: vec4f,
  @location(5) axisXW: vec4f,
  @location(6) axisYRoll: vec4f,
  @location(7) axisZHeat: vec4f,
) -> Out {
  let spinAngle = axisYRoll.w * props.x;
  let cr = cos(spinAngle);
  let sr = sin(spinAngle);
  let rx = pos.x * cr + pos.y * sr;
  let ry = -pos.x * sr + pos.y * cr;
  let rnx = normal.x * cr + normal.y * sr;
  let rny = -normal.x * sr + normal.y * cr;

  let ax = axisXW.xyz;
  let ay = axisYRoll.xyz;
  let az = axisZHeat.xyz;
  let rad = centerR.w;
  let wid = axisXW.w;

  let localPos = ax * (rx * rad) + ay * (ry * rad) + az * (pos.z * wid);
  let world = centerR.xyz + localPos - u.eye;
  let wn = normalize(ax * (rnx / rad) + ay * (rny / rad) + az * (normal.z / wid));

  let d = dot(world, u.forward);
  var out: Out;
  out.pos = vec4f(
    dot(world, u.right) / (u.tanHalf * u.aspect),
    dot(world, u.up) / u.tanHalf,
    FAR / (FAR - NEAR) * (d - NEAR),
    d,
  );
  out.colour = colour;
  out.n = wn;
  out.seen = world;
  out.fx = vec4f(axisZHeat.w, props.y, props.z, props.w);
  return out;
}

@fragment fn fs(in: Out) -> @location(0) vec4f {
  let n = normalize(in.n);
  let rd = normalize(in.seen);
  let above = 0.5 + 0.5 * n.y;
  let ndl = max(dot(n, u.sun), 0.0);
  let sunCol = vec3f(1.0, 0.94, 0.84) * ndl * 2.4 * u.day;
  let skyAmb = mix(vec3f(0.10, 0.095, 0.09), vec3f(0.30, 0.38, 0.50), above) * mix(0.08, 1.0, u.day);
  var col = in.colour * (sunCol + skyAmb);

  // Subtle rim/alloy specular highlight and sky reflection so spokes read crisply while spinning.
  let metal = in.fx.z;
  let rough = in.fx.w;
  if (metal > 0.05) {
    let halfV = normalize(u.sun - rd);
    let shininess = mix(12.0, 56.0, 1.0 - rough);
    let spec = pow(max(dot(n, halfV), 0.0), shininess) * ndl * u.day * (0.45 + 0.75 * metal);
    let refl = reflect(rd, n);
    let envSky = mix(vec3f(0.16, 0.17, 0.20), vec3f(0.55, 0.68, 0.88), clamp(refl.y * 0.5 + 0.5, 0.0, 1.0)) * mix(0.10, 0.55, u.day);
    let fres = pow(1.0 - clamp(dot(-rd, n), 0.0, 1.0), 3.0);
    col += vec3f(1.0, 0.96, 0.90) * spec + envSky * metal * (0.14 + 0.32 * fres);
  }

  // Thermal blackbody glow on brake rotors (and faint bounce inside the rim barrel) under hard braking.
  let heat = clamp(in.fx.x, 0.0, 1.0);
  let glowW = in.fx.y;
  if (heat > 0.02 && glowW > 0.01) {
    let h2 = heat * heat;
    let glowCol = mix(vec3f(1.45, 0.14, 0.015), vec3f(5.8, 1.55, 0.22), h2);
    col += glowCol * heat * glowW;
  }

  if (localLights.info.x > 0u) {
    col += evalLocalLights(in.seen + u.eye, n, rd, in.colour, rough, metal * 0.65, 0.0);
  }

  return vec4f(max(col, vec3f(0.0)), 1.0);
}
`

const FRONTS: readonly (readonly [number, number, number])[] = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 0, 1],
  [0, 0, -1],
]

/** Measured wheel-well dimensions for a vehicle's fine look so 3D wheels sit flush without z-fighting. */
export interface FootProfile {
  centerLat: number
  restHubY: number
  minY: number
  maxBump: number
  radius: number
  width: number
}

export interface WheelProfile {
  feet: FootProfile[]
}

/** Input snapshot for one wheeled vehicle in the current frame. */
export interface WheelVehicle {
  id: number
  pos: readonly [number, number, number]
  rot: readonly [number, number, number, number]
  size: readonly [number, number, number]
  low: readonly [number, number, number]
  bornLow: readonly [number, number, number]
  bornCom: readonly [number, number, number]
  front: number
  steerLimit: number
  topSpeed: number
  feet: readonly Foot[]
  hasFine: boolean
  profile?: WheelProfile
  /** Live body deformation on part 0 (#61), so wheels move and bend with a crushed corner. */
  deform?: DeformState
  fineLow?: readonly [number, number, number]
  finePer?: number
  /** Live driver controls when this vehicle is actively ridden. */
  steerInput?: number
  throttle?: number
  brake?: number
  handbrake?: boolean
  fwdSpeed?: number
  latSpeed?: number
  slip?: number
  drifting?: boolean
  burnout?: number
  decel?: number
  /** Bitmask (`0..15`) of detached wheels (`1 << footIndex`); omitted or 0 keeps all wheels rendered. */
  detachedWheels?: number
}

export interface WheelDebug {
  roll: number
  susp: number
  heat: number
  steer: number
  /** Local hub displacement in coarse body cells from vehicle deformation (#61). */
  offset: readonly [number, number, number]
  /** Combined camber/toe tilt magnitude in radians from vehicle deformation (#61). */
  tilt: number
  /** Whether this wheel has been detached and skipped from rendering (#166). */
  detached: boolean
}

/** Pure helper checking whether wheel `footIndex` is marked detached in a `0..15` bitmask. */
export function isWheelDetached(detachedWheels: number | undefined, footIndex: number): boolean {
  if (!detachedWheels || footIndex < 0 || footIndex >= 8) return false
  return ((detachedWheels | 0) & (1 << footIndex)) !== 0
}

export interface Wheels {
  /** Updates wheel spin, steering, independent suspension compression, and brake rotor heat. */
  step(
    dt: number,
    vehicles: readonly WheelVehicle[],
    groundUnder: (x: number, y: number, z: number) => number,
    detachedByVehicle?: ReadonlyMap<number, number>,
  ): void
  /** Draws all visible active vehicle wheels. No GPU work when none are active/visible. */
  draw(encoder: GPUCommandEncoder, to: Target, view: View): void
  /** Sets sun direction and day factor to match the scene's lighting. */
  light(sun: readonly number[], day: number): void
  /** Clears cached per-vehicle wheel state (e.g. on world reset). */
  clear(): void
  /** Number of wheel instances drawn on the last draw call. */
  readonly count: number
  /** Per-vehicle runtime wheel states for checks and debugging. */
  readonly state: ReadonlyMap<number, { steer: number; wheels: readonly WheelDebug[] }>
}

const turned = (q: readonly number[], v: readonly number[]): [number, number, number] => {
  const [x, y, z, w] = q
  const tx = 2 * (y * v[2] - z * v[1])
  const ty = 2 * (z * v[0] - x * v[2])
  const tz = 2 * (x * v[1] - y * v[0])
  return [
    v[0] + w * tx + (y * tz - z * ty),
    v[1] + w * ty + (z * tx - x * tz),
    v[2] + w * tz + (x * ty - y * tx),
  ]
}

// ── Procedural Voxel-Aesthetic 3D Wheel Mesh ────────────────────────────────

interface MeshBuilder {
  tri(
    a: readonly [number, number, number],
    b: readonly [number, number, number],
    c: readonly [number, number, number],
    col: readonly [number, number, number],
    meta: readonly [number, number, number, number],
  ): void
  quad(
    a: readonly [number, number, number],
    b: readonly [number, number, number],
    c: readonly [number, number, number],
    d: readonly [number, number, number],
    col: readonly [number, number, number],
    meta: readonly [number, number, number, number],
  ): void
  box(
    x0: number, x1: number,
    y0: number, y1: number,
    z0: number, z1: number,
    angle: number,
    col: readonly [number, number, number],
    meta: readonly [number, number, number, number],
  ): void
  build(): Float32Array<ArrayBuffer>
}

function makeMeshBuilder(): MeshBuilder {
  const verts: number[] = []
  const push = (
    p: readonly [number, number, number],
    n: readonly [number, number, number],
    col: readonly [number, number, number],
    meta: readonly [number, number, number, number],
  ) => {
    verts.push(p[0], p[1], p[2], n[0], n[1], n[2], col[0], col[1], col[2], meta[0], meta[1], meta[2], meta[3])
  }
  const tri: MeshBuilder['tri'] = (a, b, c, col, meta) => {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2]
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2]
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx
    const l = Math.hypot(nx, ny, nz) || 1
    nx /= l; ny /= l; nz /= l
    const n: [number, number, number] = [nx, ny, nz]
    push(a, n, col, meta)
    push(b, n, col, meta)
    push(c, n, col, meta)
  }
  const quad: MeshBuilder['quad'] = (a, b, c, d, col, meta) => {
    tri(a, b, c, col, meta)
    tri(a, c, d, col, meta)
  }
  const rotXY = (x: number, y: number, z: number, c: number, s: number): [number, number, number] => [x * c - y * s, x * s + y * c, z]
  const box: MeshBuilder['box'] = (x0, x1, y0, y1, z0, z1, angle, col, meta) => {
    const c = Math.cos(angle), s = Math.sin(angle)
    const p = (x: number, y: number, z: number) => rotXY(x, y, z, c, s)
    // +Z (outer)
    quad(p(x0, y0, z1), p(x1, y0, z1), p(x1, y1, z1), p(x0, y1, z1), col, meta)
    // -Z (inner)
    quad(p(x1, y0, z0), p(x0, y0, z0), p(x0, y1, z0), p(x1, y1, z0), col, meta)
    // +Y
    quad(p(x0, y1, z1), p(x1, y1, z1), p(x1, y1, z0), p(x0, y1, z0), col, meta)
    // -Y
    quad(p(x0, y0, z0), p(x1, y0, z0), p(x1, y0, z1), p(x0, y0, z1), col, meta)
    // +X
    quad(p(x1, y0, z1), p(x1, y0, z0), p(x1, y1, z0), p(x1, y1, z1), col, meta)
    // -X
    quad(p(x0, y0, z0), p(x0, y0, z1), p(x0, y1, z1), p(x0, y1, z0), col, meta)
  }
  return {
    tri,
    quad,
    box,
    build() {
      const out = new Float32Array(new ArrayBuffer(verts.length * 4))
      out.set(verts)
      return out
    },
  }
}

/**
 * Builds one stylized voxel-mechanical unit wheel mesh:
 * - X: forward (-1..1), Y: up (-1..1), Z: axle (-0.5 inner .. +0.5 outer).
 * - 16-sided faceted rubber tire with beveled shoulders and alternating chunky tread lugs.
 * - Deep recessed alloy rim barrel + 5 sculpted silver spokes + center hub cap + 5 lug nuts.
 * - Slotted steel brake rotor disc (glows orange-red when hot) + stationary red brake caliper.
 */
function buildWheelMesh(): Float32Array<ArrayBuffer> {
  const m = makeMeshBuilder()
  const N = 16
  const TAU = Math.PI * 2
  const pt = (r: number, a: number, z: number): [number, number, number] => [Math.cos(a) * r, Math.sin(a) * r, z]

  // Linear colors tuned to match Voxelwright's palette & tone curve (deep matte rubber, crisp metallic alloy).
  const RUBBER_TREAD_A: [number, number, number] = [0.011, 0.012, 0.014]
  const RUBBER_TREAD_B: [number, number, number] = [0.022, 0.024, 0.028]
  const RUBBER_SIDE: [number, number, number] = [0.017, 0.018, 0.021]
  const RUBBER_BEAD: [number, number, number] = [0.008, 0.009, 0.011]
  const ALLOY_BRIGHT: [number, number, number] = [0.50, 0.53, 0.58]
  const ALLOY_SPOKE: [number, number, number] = [0.40, 0.44, 0.49]
  const ALLOY_DARK: [number, number, number] = [0.032, 0.035, 0.042]
  const HUB_CAP: [number, number, number] = [0.09, 0.10, 0.12]
  const LUG_BOLT: [number, number, number] = [0.68, 0.71, 0.76]
  const ROTOR_STEEL: [number, number, number] = [0.24, 0.26, 0.30]
  const CALIPER_RED: [number, number, number] = [0.55, 0.045, 0.035]

  const M_RUBBER: [number, number, number, number] = [1, 0.0, 0.0, 0.94]
  const M_ALLOY: [number, number, number, number] = [1, 0.0, 0.85, 0.28]
  const M_BARREL: [number, number, number, number] = [1, 0.28, 0.32, 0.55]
  const M_ROTOR: [number, number, number, number] = [1, 1.0, 0.72, 0.36]
  const M_CALIPER: [number, number, number, number] = [0, 0.14, 0.25, 0.42]

  // 1. Tire carcass, beveled shoulders, outer/inner sidewalls, rim bead, and recessed inner barrel.
  // Winding convention: (b - a) x (c - a) points strictly OUTWARD on every face.
  const zOut = 0.50, zShOut = 0.38, zShIn = -0.38, zIn = -0.50
  const rCrown = 0.985, rShoulder = 0.89, rBead = 0.64, rLip = 0.585, rBarrel = 0.54
  const zRimLip = 0.45, zBarrelBack = -0.32

  for (let i = 0; i < N; i++) {
    const a0 = (i / N) * TAU
    const a1 = ((i + 1) / N) * TAU
    const treadCol = (i & 1) === 0 ? RUBBER_TREAD_A : RUBBER_TREAD_B

    // Main tread crown band (outward radial normal)
    m.quad(pt(rCrown, a0, zShOut), pt(rCrown, a0, zShIn), pt(rCrown, a1, zShIn), pt(rCrown, a1, zShOut), treadCol, M_RUBBER)
    // Outer beveled tire shoulder (outward radial + +Z normal)
    m.quad(pt(rShoulder, a0, zOut), pt(rCrown, a0, zShOut), pt(rCrown, a1, zShOut), pt(rShoulder, a1, zOut), RUBBER_SIDE, M_RUBBER)
    // Inner beveled tire shoulder (outward radial + -Z normal)
    m.quad(pt(rCrown, a0, zShIn), pt(rShoulder, a0, zIn), pt(rShoulder, a1, zIn), pt(rCrown, a1, zShIn), RUBBER_SIDE, M_RUBBER)

    // Raised chunky voxel tread lugs (split across a subtle center groove so tire rotation reads from behind too)
    const am0 = a0 + (a1 - a0) * 0.18
    const am1 = a0 + (a1 - a0) * 0.82
    const rLug = 1.022
    const lugSide = (i & 1) === 0 ? [0.05, 0.35] : [-0.35, -0.05]
    const lugCol = (i & 1) === 0 ? RUBBER_TREAD_B : RUBBER_TREAD_A
    m.quad(pt(rLug, am0, lugSide[1]), pt(rLug, am0, lugSide[0]), pt(rLug, am1, lugSide[0]), pt(rLug, am1, lugSide[1]), lugCol, M_RUBBER)
    m.quad(pt(rCrown, am0, lugSide[1]), pt(rLug, am0, lugSide[1]), pt(rLug, am0, lugSide[0]), pt(rCrown, am0, lugSide[0]), RUBBER_BEAD, M_RUBBER)
    m.quad(pt(rLug, am1, lugSide[1]), pt(rCrown, am1, lugSide[1]), pt(rCrown, am1, lugSide[0]), pt(rLug, am1, lugSide[0]), RUBBER_BEAD, M_RUBBER)

    // Outer tire sidewall (rShoulder -> rBead, +Z normal)
    m.quad(pt(rBead, a0, zOut), pt(rShoulder, a0, zOut), pt(rShoulder, a1, zOut), pt(rBead, a1, zOut), RUBBER_SIDE, M_RUBBER)
    // Bead step into alloy rim lip (inward radial normal facing hub)
    m.quad(pt(rBead, a0, zRimLip), pt(rBead, a0, zOut), pt(rBead, a1, zOut), pt(rBead, a1, zRimLip), RUBBER_BEAD, M_RUBBER)

    // Bright machined alloy outer rim lip ring (+Z normal)
    m.quad(pt(rLip, a0, zRimLip), pt(rBead, a0, zRimLip), pt(rBead, a1, zRimLip), pt(rLip, a1, zRimLip), ALLOY_BRIGHT, M_ALLOY)
    // Deep recessed dark wheel barrel (faces inward toward hub / +Z, catches subtle warm glow bounce)
    m.quad(pt(rBarrel, a0, zBarrelBack), pt(rLip, a0, zRimLip), pt(rLip, a1, zRimLip), pt(rBarrel, a1, zBarrelBack), ALLOY_DARK, M_BARREL)

    // Inner tire sidewall (-Z normal) & solid inner backing plate
    m.quad(pt(rShoulder, a0, zIn), pt(rBead, a0, zIn), pt(rBead, a1, zIn), pt(rShoulder, a1, zIn), RUBBER_SIDE, M_RUBBER)
    m.quad(pt(rBead, a0, zIn), pt(rBarrel, a0, zBarrelBack), pt(rBarrel, a1, zBarrelBack), pt(rBead, a1, zIn), ALLOY_DARK, M_RUBBER)
    m.tri([0, 0, zBarrelBack], pt(rBarrel, a0, zBarrelBack), pt(rBarrel, a1, zBarrelBack), ALLOY_DARK, M_BARREL)
  }

  // 2. Rotating brake disc (rotor) behind the spokes: glows orange-red under sustained hard braking.
  const zRotorF = 0.21, zRotorB = 0.12, rRotorOut = 0.525, rRotorIn = 0.20
  for (let i = 0; i < N; i++) {
    const a0 = (i / N) * TAU
    const a1 = ((i + 1) / N) * TAU
    const rCol: [number, number, number] = (i & 1) === 0 ? ROTOR_STEEL : [0.19, 0.21, 0.25]
    m.quad(pt(rRotorIn, a0, zRotorF), pt(rRotorOut, a0, zRotorF), pt(rRotorOut, a1, zRotorF), pt(rRotorIn, a1, zRotorF), rCol, M_ROTOR)
    m.quad(pt(rRotorOut, a0, zRotorF), pt(rRotorOut, a0, zRotorB), pt(rRotorOut, a1, zRotorB), pt(rRotorOut, a1, zRotorF), rCol, M_ROTOR)
  }

  // 3. Stationary motorsport brake caliper straddling the upper-rear rotor arc (props.x = 0 -> never spins!).
  for (const ang of [2.42, 2.74, 3.06]) {
    m.box(0.35, 0.54, -0.08, 0.08, 0.08, 0.265, ang, CALIPER_RED, M_CALIPER)
  }

  // 4. Five bold sculpted 3D alloy spokes + recessed center hub + 5 bright lug bolts (unmistakable rotation!).
  const SPOKES = 5
  for (let s = 0; s < SPOKES; s++) {
    const ang = (s / SPOKES) * TAU
    // Primary chunky spoke bar from hub to rim lip
    m.box(0.18, 0.585, -0.064, 0.064, 0.28, 0.415, ang, ALLOY_SPOKE, M_ALLOY)
    // Secondary crisp silver edge rib on the outer face of each spoke
    m.box(0.20, 0.57, -0.028, 0.028, 0.415, 0.436, ang, ALLOY_BRIGHT, M_ALLOY)
    // Bright chrome lug bolt between spokes
    const lugAng = ang + Math.PI / SPOKES
    m.box(0.115, 0.165, -0.026, 0.026, 0.36, 0.425, lugAng, LUG_BOLT, M_ALLOY)
  }

  // Center hub cylinder & dark center cap (outward radial + +Z normals)
  const HUB_N = 10
  for (let i = 0; i < HUB_N; i++) {
    const a0 = (i / HUB_N) * TAU
    const a1 = ((i + 1) / HUB_N) * TAU
    m.quad(pt(0.22, a0, 0.41), pt(0.22, a0, 0.22), pt(0.22, a1, 0.22), pt(0.22, a1, 0.41), ALLOY_BRIGHT, M_ALLOY)
    m.quad(pt(0.11, a0, 0.41), pt(0.22, a0, 0.41), pt(0.22, a1, 0.41), pt(0.11, a1, 0.41), ALLOY_SPOKE, M_ALLOY)
    m.tri([0, 0, 0.436], pt(0.11, a0, 0.436), pt(0.11, a1, 0.436), HUB_CAP, M_ALLOY)
    m.quad(pt(0.11, a0, 0.436), pt(0.11, a0, 0.41), pt(0.11, a1, 0.41), pt(0.11, a1, 0.436), HUB_CAP, M_ALLOY)
  }

  return m.build()
}

// ── Static Wheel-Well Carving for Fine Looks ────────────────────────────────

const carvedCache = new WeakMap<Uint16Array, { kinds: Uint16Array; profile: WheelProfile }>()

/**
 * Carves static baked wheel voxels out of a drivable vehicle's outer `fine` look so animated 3D wheels
 * steer, spin, and compress cleanly inside the wheel arches with zero z-fighting or double-wheel clipping.
 * Returns a cached copy (never mutates the source buffer used by parked street cars or ghosts).
 */
export function carveWheelWells(
  kinds: Uint16Array,
  size: readonly [number, number, number],
  per: number,
  low: readonly [number, number, number],
  motor: Motor,
  thingSize: readonly [number, number, number],
): { kinds: Uint16Array; profile: WheelProfile } | null {
  if (motor.feet.length < 2) return null
  // Only carve the full outside shell part, never an interior cabin sub-part.
  const spanX = size[0] / per, spanZ = size[2] / per
  if (spanX < thingSize[0] * 0.72 || spanZ < thingSize[2] * 0.72) return null

  const hit = carvedCache.get(kinds)
  if (hit) return hit

  const [w, h, d] = size
  const alongX = motor.front < 2
  const out = kinds.slice()
  const minReach = Math.min(...motor.feet.map((f) => f.reach))

  // Detect dominant saturated hue of painted body panels so carving never bites into painted fenders.
  const hueCounts = new Int32Array(24)
  for (let i = 0; i < kinds.length; i += 4) {
    const k = kinds[i]
    const col = (k >> 8) & 255
    if (k && (k & 15) === 12 && col >= 16) hueCounts[Math.floor((col - 16) / 10) % 24]++
  }
  let bodyHue = -1, bestHueCount = 20
  for (let hu = 0; hu < 24; hu++) if (hueCounts[hu] > bestHueCount) { bestHueCount = hueCounts[hu]; bodyHue = hu }
  const isPaint = (k: number) => {
    if (bodyHue < 0) return false
    const col = (k >> 8) & 255
    if (col < 16) return false
    const hu = Math.floor((col - 16) / 10) % 24
    const diff = Math.abs(hu - bodyHue)
    return Math.min(diff, 24 - diff) <= 1
  }

  const feetProfile: FootProfile[] = []

  for (const foot of motor.feet) {
    const fAlong = alongX ? foot.at[0] : foot.at[2]
    const fLat = alongX ? foot.at[2] : foot.at[0]
    const latSpan = alongX ? thingSize[2] : thingSize[0]
    const sideLow = fLat < latSpan * 0.5

    // 1. Measure lowest occupied voxel (bottom of baked tire) and outermost lateral face near this foot.
    let minY = Infinity
    const aMin = Math.max(0, Math.floor((fAlong - 2.2 - (alongX ? low[0] : low[2])) * per))
    const aMax = Math.min((alongX ? w : d) - 1, Math.ceil((fAlong + 2.2 - (alongX ? low[0] : low[2])) * per))
    const lMin = Math.max(0, Math.floor((fLat - 3.0 - (alongX ? low[2] : low[0])) * per))
    const lMax = Math.min((alongX ? d : w) - 1, Math.ceil((fLat + 3.0 - (alongX ? low[2] : low[0])) * per))

    for (let y = 0; y < h; y++) {
      let found = false
      for (let l = lMin; l <= lMax && !found; l++) {
        for (let a = aMin; a <= aMax; a++) {
          const x = alongX ? a : l, z = alongX ? l : a
          if (kinds[(y * d + z) * w + x]) {
            minY = y / per + low[1]
            found = true
            break
          }
        }
      }
      if (found) break
    }
    if (!Number.isFinite(minY)) minY = low[1]

    // Outermost lateral face in the lower tire band [minY, minY + 3.0].
    let outerLat = sideLow ? Infinity : -Infinity
    const yScanHi = Math.min(h - 1, Math.ceil((minY + 3.0 - low[1]) * per))
    const yScanLo = Math.max(0, Math.floor((minY - low[1]) * per))
    for (let y = yScanLo; y <= yScanHi; y++) {
      for (let l = lMin; l <= lMax; l++) {
        for (let a = aMin; a <= aMax; a++) {
          const x = alongX ? a : l, z = alongX ? l : a
          if (!kinds[(y * d + z) * w + x]) continue
          const latPos = (l + (sideLow ? 0 : 1)) / per + (alongX ? low[2] : low[0])
          if (sideLow) outerLat = Math.min(outerLat, latPos)
          else outerLat = Math.max(outerLat, latPos)
        }
      }
    }
    if (!Number.isFinite(outerLat)) outerLat = sideLow ? 0 : latSpan

    // 2. Derive universal wheel radius & width matching fineCar, SF saloons, SUVs, vans, and trucks.
    const baseMinY = Math.floor(minY)
    const radius = thingSize[1] >= 22
      ? Math.min(4.7, Math.max(3.2, thingSize[1] * 0.135))
      : Math.max(2.9, Math.min(3.2, Math.min(foot.at[1] - baseMinY + 0.12, minReach * 0.56)))
    const width = Math.max(2.2, Math.min(3.2, radius * 0.74))
    const centerLat = sideLow ? outerLat + width * 0.5 - 0.06 : outerLat - width * 0.5 + 0.06
    const restHubY = baseMinY + radius

    // 3. Carve the static tire & hub cylinder cleanly out of the outside look.
    const carveR = radius + 0.20
    const carveDepth = width + 0.25
    const latLo = sideLow ? outerLat - 0.25 : outerLat - carveDepth
    const latHi = sideLow ? outerLat + carveDepth : outerLat + 0.25
    const cx = fAlong
    const cy = restHubY

    const ca0 = Math.max(0, Math.floor((cx - carveR - 0.4 - (alongX ? low[0] : low[2])) * per))
    const ca1 = Math.min((alongX ? w : d) - 1, Math.ceil((cx + carveR + 0.4 - (alongX ? low[0] : low[2])) * per))
    const cl0 = Math.max(0, Math.floor((latLo - (alongX ? low[2] : low[0])) * per))
    const cl1 = Math.min((alongX ? d : w) - 1, Math.ceil((latHi - (alongX ? low[2] : low[0])) * per))
    const cy0 = Math.max(0, Math.floor((baseMinY - 0.2 - low[1]) * per))
    const cy1 = Math.min(h - 1, Math.ceil((cy + carveR + 0.25 - low[1]) * per))

    for (let y = cy0; y <= cy1; y++) {
      const by = (y + 0.5) / per + low[1]
      const dy = by - cy
      for (let l = cl0; l <= cl1; l++) {
        for (let a = ca0; a <= ca1; a++) {
          const ba = (a + 0.5) / per + (alongX ? low[0] : low[2])
          const r = Math.hypot(ba - cx, dy)
          // On painted cars (bodyHue >= 0), carve non-paint tire voxels generously so no jagged crescent remains in the arch;
          // on greyscale cars (bodyHue < 0), keep a tight top boundary so dark fender flares remain intact.
          const lim = dy > radius * 0.45 ? (bodyHue >= 0 ? carveR : radius + 0.05) : dy > 0 ? carveR : carveR + 0.14
          if (r > lim) continue
          const x = alongX ? a : l, z = alongX ? l : a
          const idx = (y * d + z) * w + x
          const k = out[idx]
          if (!k) continue
          // Preserve painted fender skin all around the arch so carving never bites a stair-step into the body (#61).
          if (r > radius - 0.15 && isPaint(k)) continue
          out[idx] = 0
        }
      }
    }

    // Line exposed recessed wheel-well walls with dark matte liner (#61) so no bright painted inner bulkhead peeks out behind the bent fender.
    const LINER = 14 | ((1 + 13) << 8)
    const linerDepth = width + 1.0
    const ll0 = Math.max(0, Math.floor(((sideLow ? outerLat + width * 0.65 : outerLat - linerDepth) - (alongX ? low[2] : low[0])) * per))
    const ll1 = Math.min((alongX ? d : w) - 1, Math.ceil(((sideLow ? outerLat + linerDepth : outerLat - width * 0.65) - (alongX ? low[2] : low[0])) * per))
    const outStep = sideLow ? -1 : 1
    for (let y = cy0; y <= cy1; y++) {
      const by = (y + 0.5) / per + low[1]
      const dy = by - cy
      for (let l = ll0; l <= ll1; l++) {
        const bLat = (l + 0.5) / per + (alongX ? low[2] : low[0])
        const distIn = sideLow ? bLat - outerLat : outerLat - bLat
        if (distIn < width * 0.65) continue
        const lOut = l + outStep
        if (lOut < 0 || lOut >= (alongX ? d : w)) continue
        for (let a = ca0; a <= ca1; a++) {
          const ba = (a + 0.5) / per + (alongX ? low[0] : low[2])
          if (Math.hypot(ba - cx, dy) > carveR + 0.2) continue
          const x = alongX ? a : l, z = alongX ? l : a
          const idx = (y * d + z) * w + x
          const k = out[idx]
          if (!k || !isPaint(k)) continue
          const ox = alongX ? a : lOut, oz = alongX ? lOut : a
          if (!out[(y * d + oz) * w + ox]) out[idx] = LINER
        }
      }
    }

    feetProfile.push({
      centerLat,
      restHubY,
      minY,
      maxBump: Math.min(0.85, radius * 0.24),
      radius,
      width,
    })
  }

  const result = { kinds: out, profile: { feet: feetProfile } }
  carvedCache.set(kinds, result)
  return result
}

// ── Runtime Per-Vehicle Wheel State & Instanced WebGPU Pass ─────────────────

interface VehicleState {
  steerSm: number
  prevPos: [number, number, number] | null
  deformState?: DeformState
  deformRev: number
  wheels: {
    roll: number
    susp: number
    heat: number
    steer: number
    offset: [number, number, number]
    camber: number
    toe: number
    tilt: number
    detached: boolean
    init: boolean
  }[]
  lastSeen: number
}

interface ActiveWheel {
  world: [number, number, number]
  radius: number
  width: number
  ax: [number, number, number]
  ay: [number, number, number]
  az: [number, number, number]
  roll: number
  heat: number
}

export async function wheels(device: GPUDevice, format: GPUTextureFormat, localLightsBuffer: GPUBuffer): Promise<Wheels> {
  const module = await shader(device, 'wheels', CODE)
  const mesh = buildWheelMesh()
  const vertCount = mesh.length / VERT_FLOATS

  const bindLayout = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: {} },
      { binding: 1, visibility: GPUShaderStage.FRAGMENT, buffer: {} },
    ],
  })
  const pipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [bindLayout] })
  const pipeline = await device.createRenderPipelineAsync({
    label: 'wheels',
    layout: pipelineLayout,
    vertex: {
      module,
      entryPoint: 'vs',
      buffers: [
        {
          arrayStride: VERT_FLOATS * 4,
          stepMode: 'vertex',
          attributes: [
            { shaderLocation: 0, offset: 0, format: 'float32x3' },
            { shaderLocation: 1, offset: 12, format: 'float32x3' },
            { shaderLocation: 2, offset: 24, format: 'float32x3' },
            { shaderLocation: 3, offset: 36, format: 'float32x4' },
          ],
        },
        {
          arrayStride: INST_FLOATS * 4,
          stepMode: 'instance',
          attributes: [
            { shaderLocation: 4, offset: 0, format: 'float32x4' },
            { shaderLocation: 5, offset: 16, format: 'float32x4' },
            { shaderLocation: 6, offset: 32, format: 'float32x4' },
            { shaderLocation: 7, offset: 48, format: 'float32x4' },
          ],
        },
      ],
    },
    fragment: { module, entryPoint: 'fs', targets: [{ format }] },
    primitive: { topology: 'triangle-list', cullMode: 'none' },
    depthStencil: { format: 'depth24plus', depthWriteEnabled: true, depthCompare: 'less' },
  })

  const vertBuf = device.createBuffer({ size: mesh.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST })
  device.queue.writeBuffer(vertBuf, 0, mesh)
  const instBuf = device.createBuffer({ size: MAX_WHEELS * INST_FLOATS * 4, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST })
  const uniforms = device.createBuffer({ size: 80, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST })
  const bind = device.createBindGroup({ layout: bindLayout, entries: [{ binding: 0, resource: { buffer: uniforms } }, { binding: 1, resource: { buffer: localLightsBuffer } }] })

  const instData = new Float32Array(new ArrayBuffer(MAX_WHEELS * INST_FLOATS * 4))
  const uniformData = new Float32Array(new ArrayBuffer(80))
  const reducedMotion = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null

  const states = new Map<number, VehicleState>()
  const debugView = new Map<number, { steer: number; wheels: readonly WheelDebug[] }>()
  const active: ActiveWheel[] = []
  let sun: [number, number, number] = [0.52, 0.62, 0.59]
  let sunLen = Math.hypot(sun[0], sun[1], sun[2])
  let day = 1
  let tick = 0
  let lastCount = 0

  return {
    get count() { return lastCount },
    get state() { return debugView },
    light(from, isDay) {
      sun = [from[0], from[1], from[2]]
      sunLen = Math.hypot(sun[0], sun[1], sun[2]) || 1
      day = isDay
    },
    clear() {
      states.clear()
      debugView.clear()
      active.length = 0
      lastCount = 0
    },
    step(dt, vehicles, groundUnder, detachedByVehicle) {
      tick++
      active.length = 0
      if (!vehicles.length) {
        if (states.size) { states.clear(); debugView.clear() }
        return
      }
      const clampedDt = Math.max(0, Math.min(0.1, dt))
      const calm = reducedMotion?.matches === true

      for (const v of vehicles) {
        if (v.feet.length < 2) continue
        const detachedMask = ((v.detachedWheels ?? detachedByVehicle?.get(v.id) ?? 0) | 0) & 0x0f
        let st = states.get(v.id)
        if (!st || st.wheels.length !== v.feet.length) {
          st = {
            steerSm: 0,
            prevPos: [v.pos[0], v.pos[1], v.pos[2]],
            deformState: undefined,
            deformRev: -1,
            wheels: v.feet.map(() => ({ roll: 0, susp: 0, heat: 0, steer: 0, offset: [0, 0, 0] as [number, number, number], camber: 0, toe: 0, tilt: 0, detached: false, init: false })),
            lastSeen: tick,
          }
          states.set(v.id, st)
          debugView.set(v.id, { steer: 0, wheels: st.wheels })
        }
        st.lastSeen = tick

        const localFwd = FRONTS[v.front & 3]
        const localRight: [number, number, number] = [-localFwd[2], 0, localFwd[0]]
        const alongX = (v.front & 3) < 2
        const latSpan = alongX ? v.size[2] : v.size[0]
        const bodyFwd = turned(v.rot, localFwd)
        const bodyRight = turned(v.rot, localRight)
        const bodyUp = turned(v.rot, [0, 1, 0])

        // Estimate forward speed from live telemetry when driven, or from frame-to-frame motion when coasting/parked.
        const movedDist = st.prevPos ? Math.hypot(v.pos[0] - st.prevPos[0], v.pos[1] - st.prevPos[1], v.pos[2] - st.prevPos[2]) : 0
        if (movedDist > 50) for (const ws of st.wheels) ws.init = false
        let fwdSpeed = v.fwdSpeed
        if (fwdSpeed === undefined) {
          if (st.prevPos && movedDist <= 50 && clampedDt > 0.001) {
            const dx = v.pos[0] - st.prevPos[0], dy = v.pos[1] - st.prevPos[1], dz = v.pos[2] - st.prevPos[2]
            const raw = (dx * bodyFwd[0] + dy * bodyFwd[1] + dz * bodyFwd[2]) / clampedDt
            fwdSpeed = Math.abs(raw) < 1500 ? raw : 0
          } else {
            fwdSpeed = 0
          }
        }
        st.prevPos = [v.pos[0], v.pos[1], v.pos[2]]

        const latSpeed = v.latSpeed ?? 0
        const throttle = v.throttle ?? 0
        const brake = v.brake ?? 0
        const handbrake = v.handbrake ?? false
        const slip = v.slip ?? 0
        const burnout = v.burnout ?? 0
        const decel = v.decel ?? 0

        // Smooth front steering yaw matching input + counter-steer into drifts.
        const steerIn = v.steerInput ?? 0
        const steerRate = steerIn === 0 ? 10 : steerIn * st.steerSm < 0 ? 15 : 8.5
        st.steerSm += (steerIn - st.steerSm) * Math.min(1, clampedDt * steerRate)
        if (steerIn === 0 && Math.abs(st.steerSm) < 0.002) st.steerSm = 0

        const top = Math.max(120, v.topSpeed || 200)
        const speedRatio = Math.min(1.4, Math.abs(fwdSpeed) / top)
        const speedFalloff = 1 / (1 + speedRatio * 0.72 + speedRatio * speedRatio * 0.25)
        const maxSteer = Math.min(0.60, Math.max(0.35, v.steerLimit || 0.55))
        let counter = 0
        if (fwdSpeed > 18) {
          const slipAng = Math.atan2(latSpeed, Math.max(15, fwdSpeed))
          if (v.drifting || Math.abs(slipAng) > 0.15) {
            counter = Math.max(-0.34, Math.min(0.34, slipAng * 0.58))
          }
        }
        const steerScale = calm ? 0.55 : 1.0
        const targetSteer = Math.max(-0.58, Math.min(0.58, (st.steerSm * maxSteer * speedFalloff + counter) * steerScale))
        const dbg = debugView.get(v.id)
        if (dbg) dbg.steer = targetSteer

        const minReach = Math.min(...v.feet.map((f) => f.reach))
        const offX = (v.bornLow[0] - v.low[0]) + v.bornCom[0]
        const offY = (v.bornLow[1] - v.low[1]) + v.bornCom[1]
        const offZ = (v.bornLow[2] - v.low[2]) + v.bornCom[2]

        for (let i = 0; i < v.feet.length; i++) {
          if (active.length >= MAX_WHEELS) break
          const foot = v.feet[i]
          const ws = st.wheels[i]
          if (isWheelDetached(detachedMask, i)) {
            ws.detached = true
            ws.susp = 0
            ws.heat = 0
            ws.steer = 0
            ws.init = false
            continue
          }
          ws.detached = false
          const prof = v.profile?.feet[i]

          const fLat = alongX ? foot.at[2] : foot.at[0]
          const sideLow = fLat < latSpan * 0.5
          // Right side in vehicle frame (+bodyRight): check dot of outward direction with localRight.
          const outLocalLat = sideLow ? -1 : 1
          const latDotRight = alongX ? localRight[2] : localRight[0]
          const sideSign = outLocalLat * latDotRight >= 0 ? 1 : -1

          // Radius, width, lateral placement, and rest hub height (from carved fine profile or coarse body fallback).
          let radius: number
          let width: number
          let wheelLat: number
          let restHubY: number
          let maxBump: number
          if (prof) {
            radius = prof.radius
            width = prof.width
            wheelLat = prof.centerLat
            restHubY = prof.restHubY
            maxBump = prof.maxBump
          } else {
            // Coarse `car` body (no fine look): proud outside the 1-cell static wheel to prevent z-fighting.
            radius = Math.max(3.05, Math.min(3.45, minReach * 0.55))
            width = Math.max(2.3, radius * 0.72)
            wheelLat = sideLow ? 0.8 : latSpan - 0.8
            restHubY = foot.at[1]
            maxBump = 0.85
          }

          // Wheel hub displacement and axle camber/toe tilt from vehicle body dents (#61), cached per deform revision so undamaged frames pay zero CPU.
          const hx = alongX ? foot.at[0] : wheelLat
          const hz = alongX ? wheelLat : foot.at[2]
          const hasDeform = !!(v.deform && v.deform.dentCount > 0 && v.fineLow && v.finePer)
          const deformDirty = hasDeform ? (st.deformState !== v.deform || st.deformRev !== v.deform!.revision) : (st.deformRev !== -1)
          let bendX = 0, bendY = 0, bendZ = 0, camber = 0, toe = 0
          if (hasDeform && deformDirty) {
            const per = v.finePer!
            const flx = (hx - v.fineLow![0]) * per
            const fly = (restHubY - v.fineLow![1]) * per
            const flz = (hz - v.fineLow![2]) * per
            const longSign = (v.front & 1) === 0 ? 1 : -1
            const latAxis = alongX ? 2 : 0
            const longAxis = alongX ? 0 : 2
            const latOff = outLocalLat * width * 0.45 * per
            const longOff = longSign * radius * 0.70 * per
            const sample = (dLong: number, dUp: number, dLat: number): [number, number, number] => {
              const px = flx + (alongX ? dLong : dLat)
              const py = fly + dUp
              const pz = flz + (alongX ? dLat : dLong)
              const res = deformPointCpu([px, py, pz], [0, 1, 0], v.deform)
              return [(res.pos[0] - px) / per, (res.pos[1] - py) / per, (res.pos[2] - pz) / per]
            }
            const dHub = sample(0, 0, 0)
            const dOut = sample(0, 0, latOff)
            const dTop = sample(0, radius * 0.85 * per, latOff)
            const dBot = sample(0, -radius * 0.55 * per, latOff)
            const dFwd = sample(longOff, 0, latOff * 0.9)
            const dAft = sample(-longOff, 0, latOff * 0.9)
            const dFwdTop = sample(longOff, radius * 0.85 * per, latOff)
            const dAftTop = sample(-longOff, radius * 0.85 * per, latOff)
            // Signed displacement along outward lateral axis (negative = pushed inward toward car centerline).
            const latHub = dHub[latAxis] * outLocalLat
            const latOut = dOut[latAxis] * outLocalLat
            const latTop = dTop[latAxis] * outLocalLat
            const latBot = dBot[latAxis] * outLocalLat
            const latFwd = dFwd[latAxis] * outLocalLat
            const latAft = dAft[latAxis] * outLocalLat
            const latFwdTop = dFwdTop[latAxis] * outLocalLat
            const latAftTop = dAftTop[latAxis] * outLocalLat
            // Track the crushed fender/arch inward (including leading & trailing arch edges) so a crushed corner never leaves a wheel standing outside its fender.
            const rawLat = Math.min(latHub, latOut, latTop, latFwd, latAft, latFwdTop, latAftTop)
            const latShift = Math.max(-width * 1.25, Math.min(width * 0.25, rawLat))
            let longShiftRaw = dHub[longAxis]
            for (const d of [dOut, dTop, dFwd, dAft, dFwdTop, dAftTop]) {
              if (Math.abs(d[longAxis]) > Math.abs(longShiftRaw)) longShiftRaw = d[longAxis]
            }
            const longShift = Math.max(-radius * 0.75, Math.min(radius * 0.75, longShiftRaw * 0.85))
            const vertShift = Math.max(-0.3, Math.min(0.45, dHub[1]))
            bendX = alongX ? longShift : latShift * outLocalLat
            bendY = vertShift
            bendZ = alongX ? latShift * outLocalLat : longShift
            // Bent control arm camber (top tilts inward when pushed in) + vertical dent gradient, and impact toe-in/out.
            const rawCamber = ((latBot - Math.min(latTop, latFwdTop, latAftTop)) / Math.max(1, radius * 1.4)) * 0.85 + Math.max(0, -latShift) * 0.14
            camber = Math.max(-0.38, Math.min(0.38, rawCamber))
            toe = Math.max(-0.38, Math.min(0.38, (((latFwd - latAft) * sideSign) / Math.max(1, radius * 1.4)) * 1.1))
            ws.offset[0] = bendX; ws.offset[1] = bendY; ws.offset[2] = bendZ
            ws.camber = camber; ws.toe = toe
            ws.tilt = Math.hypot(camber, toe)
          } else if (hasDeform) {
            bendX = ws.offset[0]; bendY = ws.offset[1]; bendZ = ws.offset[2]
            camber = ws.camber; toe = ws.toe
          } else if (deformDirty) {
            ws.offset[0] = 0; ws.offset[1] = 0; ws.offset[2] = 0
            ws.camber = 0; ws.toe = 0; ws.tilt = 0
          }

          const restOff = turned(v.rot, [hx + bendX - offX, restHubY + bendY - offY, hz + bendZ - offZ])
          const restW: [number, number, number] = [v.pos[0] + restOff[0], v.pos[1] + restOff[1], v.pos[2] + restOff[2]]

          // Independent per-wheel suspension compression sampled from groundUnder relative to hub height.
          const rayY = restW[1] + Math.max(2.5, radius * 0.9)
          const groundY = groundUnder(restW[0], rayY, restW[2])
          const minDroop = -Math.min(1.8, foot.reach * 0.28)
          const rawDelta = (groundY + radius - 0.14 - restW[1]) / Math.max(0.35, bodyUp[1])
          const clampedDelta = Math.max(minDroop, Math.min(maxBump, rawDelta))
          if (!ws.init) {
            ws.susp = clampedDelta
            ws.init = true
          } else if (calm) {
            ws.susp += (Math.max(-0.85, Math.min(0.45, clampedDelta)) - ws.susp) * Math.min(1, clampedDt * 6)
          } else {
            const dampRate = clampedDelta > ws.susp ? 24 : 14
            ws.susp += (clampedDelta - ws.susp) * Math.min(1, clampedDt * dampRate)
          }

          // Roll integration: road speed + rear burnout/drift wheelspin + handbrake rear lockup.
          let omega = fwdSpeed / Math.max(1.5, radius)
          if (foot.drives && burnout > 0.05) {
            omega = Math.max(omega, 18 + burnout * 20)
          } else if (foot.drives && slip > 0.25 && throttle > 0.35) {
            omega += slip * 12 * Math.sign(throttle)
          } else if (!foot.steers && handbrake && throttle <= 0.15) {
            omega *= 0.08
          } else if (brake > 0.7 && Math.abs(fwdSpeed) > 35) {
            omega *= 0.45
          }
          if (calm) omega *= 0.45
          ws.roll = (ws.roll + omega * clampedDt) % (Math.PI * 2)

          // Brake rotor thermal heating under sustained hard braking (front biased; rear also heats on handbrake).
          const absSpd = Math.abs(fwdSpeed)
          const spdFactor = Math.max(0, Math.min(1, (absSpd - 8) / 55))
          const hardDecel = decel > 22 ? Math.min(1, (decel - 18) / 80) : 0
          const serviceBrake = Math.max(brake, hardDecel) * spdFactor * (foot.steers ? 1.0 : 0.8)
          const rearDrag = !foot.steers && handbrake ? spdFactor * 0.95 : 0
          const heatInput = Math.max(serviceBrake, rearDrag)
          if (heatInput > 0.06) {
            const heatRate = (calm ? 0.75 : 1.55) * heatInput
            ws.heat = Math.min(1, ws.heat + heatRate * clampedDt)
          } else {
            const coolRate = 0.14 + Math.min(0.18, absSpd * 0.001)
            ws.heat = Math.max(0, ws.heat - coolRate * clampedDt)
          }

          // Wheel steering yaw (front steerable wheels only) + impact toe/camber tilt (#61).
          const wheelSteer = (foot.steers ? targetSteer : 0) + toe
          ws.steer = wheelSteer
          const cs = Math.cos(wheelSteer), sn = Math.sin(wheelSteer)
          const ax: [number, number, number] = [
            bodyFwd[0] * cs + bodyRight[0] * sn,
            bodyFwd[1] * cs + bodyRight[1] * sn,
            bodyFwd[2] * cs + bodyRight[2] * sn,
          ]
          const srX = bodyRight[0] * cs - bodyFwd[0] * sn
          const srY = bodyRight[1] * cs - bodyFwd[1] * sn
          const srZ = bodyRight[2] * cs - bodyFwd[2] * sn
          const az0: [number, number, number] = [srX * sideSign, srY * sideSign, srZ * sideSign]
          const cc = Math.cos(camber), sc = Math.sin(camber)
          const ay: [number, number, number] = [
            bodyUp[0] * cc - az0[0] * sc,
            bodyUp[1] * cc - az0[1] * sc,
            bodyUp[2] * cc - az0[2] * sc,
          ]
          const az: [number, number, number] = [
            az0[0] * cc + bodyUp[0] * sc,
            az0[1] * cc + bodyUp[1] * sc,
            az0[2] * cc + bodyUp[2] * sc,
          ]

          active.push({
            world: [restW[0] + bodyUp[0] * ws.susp, restW[1] + bodyUp[1] * ws.susp, restW[2] + bodyUp[2] * ws.susp],
            radius,
            width,
            ax,
            ay,
            az,
            roll: ws.roll,
            heat: ws.heat,
          })
        }
        const hasDeform = !!(v.deform && v.deform.dentCount > 0 && v.fineLow && v.finePer)
        st.deformState = hasDeform ? v.deform : undefined
        st.deformRev = hasDeform ? v.deform!.revision : -1
      }

      // Drop stale vehicle state entries once a vehicle breaks or vanishes.
      for (const [id, st] of states) {
        if (st.lastSeen !== tick) {
          states.delete(id)
          debugView.delete(id)
        }
      }
    },
    draw(encoder, to, view) {
      if (!active.length) {
        lastCount = 0
        return
      }
      const ex = view.eye[0], ey = view.eye[1], ez = view.eye[2]
      const fx = view.forward[0], fy = view.forward[1], fz = view.forward[2]
      const ax0 = Math.floor(ex / 64) * 64
      const ay0 = Math.floor(ey / 64) * 64
      const az0 = Math.floor(ez / 64) * 64

      let n = 0
      for (let i = 0; i < active.length; i++) {
        const w = active[i]
        const dx = w.world[0] - ex, dy = w.world[1] - ey, dz = w.world[2] - ez
        // Distance & behind-camera frustum cull: zero GPU work when no drivable vehicle is in view.
        const dist2 = dx * dx + dy * dy + dz * dz
        if (dist2 > 2600 * 2600) continue
        if (dx * fx + dy * fy + dz * fz < -w.radius * 3) continue

        const o = n * INST_FLOATS
        instData[o + 0] = w.world[0] - ax0
        instData[o + 1] = w.world[1] - ay0
        instData[o + 2] = w.world[2] - az0
        instData[o + 3] = w.radius
        instData[o + 4] = w.ax[0]
        instData[o + 5] = w.ax[1]
        instData[o + 6] = w.ax[2]
        instData[o + 7] = w.width
        instData[o + 8] = w.ay[0]
        instData[o + 9] = w.ay[1]
        instData[o + 10] = w.ay[2]
        instData[o + 11] = w.roll
        instData[o + 12] = w.az[0]
        instData[o + 13] = w.az[1]
        instData[o + 14] = w.az[2]
        instData[o + 15] = w.heat
        n++
      }

      lastCount = n
      if (!n) return

      uniformData.set([
        ex - ax0, ey - ay0, ez - az0, view.tanHalf,
        view.right[0], view.right[1], view.right[2], to.size[0] / to.size[1],
        view.up[0], view.up[1], view.up[2], 0,
        fx, fy, fz, 0,
        sun[0] / sunLen, sun[1] / sunLen, sun[2] / sunLen, day,
      ])
      device.queue.writeBuffer(uniforms, 0, uniformData)
      device.queue.writeBuffer(instBuf, 0, instData, 0, n * INST_FLOATS)

      const pass = encoder.beginRenderPass({
        colorAttachments: [{ view: to.color, loadOp: 'load', storeOp: 'store' }],
        depthStencilAttachment: { view: to.depth, depthLoadOp: 'load', depthStoreOp: 'store' },
      })
      pass.setViewport(0, 0, to.size[0], to.size[1], 0, 1)
      pass.setScissorRect(0, 0, to.size[0], to.size[1])
      pass.setPipeline(pipeline)
      pass.setBindGroup(0, bind)
      pass.setVertexBuffer(0, vertBuf)
      pass.setVertexBuffer(1, instBuf)
      pass.draw(vertCount, n)
      pass.end()
    },
  }
}
