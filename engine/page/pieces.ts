// A body on its way (#140, #146). While it moves it is not cells of the world, so the rays do
// not see it: it is drawn as its outside faces, rows of them merged in the core, over the
// marched picture and tested against its depth. The faces are sent to the GPU once; each frame
// only says where the body is and how it is turned. It is lit as the world is and stands in the
// world's shadows (the sun's maps); it casts none of its own. Its glass is seen through (#163): drawn after what is
// solid, it lets what is behind it show, tinted, with what it mirrors on it. Its glass faces are kept apart from the
// solid ones when it is made, so the solid faces are drawn as they were and the glass passes draw only glass. With
// mirrors off it is still seen through, tinted, and mirrors nothing (#74: a pale face there, as the world's glass
// is, made every window of a car opaque from its own seat on the Low and Medium presets). A thing of finer cells may carry a smooth word a face (#38,
// fine.ts `facesWithSmooth`): its outside is then lit by a normal from the shape round it, darkened in its hollows,
// and its paint and glass mirror as a car's do, where a face lit by its square normal showed each step of a curve.
// A vehicle that has been struck (#37, deform.ts) is drawn bent: up to six dents move its corners and turn its normals,
// its paint is scuffed to primer and bare steel in them, and its glass cracks near them. Only rows whose bounding box
// overlaps an active dent sphere or torn opening are split into 1-cell unit faces so bent faces meet without exploding
// undamaged regions; pieces are frustum- and backface-culled so off-screen and back-facing quads pay nothing.
import type { CrashOpening } from './crash-opening.ts'
import { shader, type Target } from '../probe/gpu.ts'
import { DEFORM_BYTES, DEFORM_STRUCT, DEFORM_WGSL, packDeformUniforms, type DeformState } from './deform.ts'
import { GLASS, GLOBALS, LIGHT, PAINT, SUNLIT, palette, type Marcher, type View } from './march.ts'
import { LIGHT_EXTRA, LOCAL_LIGHTS_STRUCT, localLightsEval, type LocalLightSink } from './lights.ts'
import type { Born } from './told.ts'

const CODE = /* wgsl */ `
${DEFORM_STRUCT}
struct U {
  eye: vec3f, tanHalf: f32,
  right: vec3f, aspect: f32,
  up: vec3f, midX: f32,
  forward: vec3f, midY: f32,
  sun: vec3f, midZ: f32,
  // The body's middle of mass from the anchor, and in its own cells; where its low corner was in the world when
  // it came loose (its cells keep their shades); and how it is turned, as the three columns of a matrix.
  // cell: how big one of the body's cells is, in the world's (1 for what came loose from it; less for a thing made finer).
  pos: vec3f, cell: f32,
  // ghost: not 0 for a thing not yet made, drawn pale and seen through (the ask bar's ghost, #220).
  cells: vec3i, ghost: i32,
  com: vec3f, lampBrake: f32,
  c0: vec3f, lampRev: f32,
  c1: vec3f, lampHead: f32,
  c2: vec3f, lampAxis: f32,
  // Whether smooth words are heeded (#38): 0 draws every face by its square normal, as before them. mirrors: 0 is
  // the M key's mirrors off, under which glass is seen through, tinted, and mirrors nothing (#74).
  smoothOn: f32, mirrors: f32, frontZ: f32, pad2: f32,
  // Its dents (#37): none for a piece that was never struck, and then nothing of them is worked out.
  deform: Deform,
  // Per-window crack origins (#61): front, rear, left, right; each (originX, originY, originZ, strength).
  cracks: array<vec4f, 4>,
}
struct Material { colour: vec3f, wander: f32, rough: f32, mirror: f32, glow: f32, pad: f32 }
struct Looks { palette: array<vec4f, 256>, material: array<Material, 16> }
@group(0) @binding(0) var<uniform> u: U;
@group(0) @binding(1) var<uniform> looks: Looks;
${GLOBALS}
${LOCAL_LIGHTS_STRUCT}
@group(1) @binding(0) var<uniform> g: Globals;
@group(1) @binding(1) var sunMap: texture_2d_array<f32>;
// Where the march looked through a pane of the world's glass: what it lets through, and how far off it is (march.ts panes).
@group(1) @binding(2) var panes: texture_2d<f32>;
@group(1) @binding(3) var<uniform> localLights: LocalLights;
${SUNLIT}
${LIGHT}
${localLightsEval()}
// Procedural-town street lamps (city.rs 1280x800 block grid, within 3.5 km of HOME); in San Francisco real lamps arrive via localLights.
fn pieceTownLamps(at: vec3f, n: vec3f) -> f32 {
  let worldXZ = at.xz + vec2f(g.fog.w, g.fogTint.a);
  let out = (floor(worldXZ / vec2f(1280.0, 800.0)) + 0.5) * vec2f(1280.0, 800.0) - vec2f(700.0, 4070.0);
  if (dot(out, out) >= 35000.0 * 35000.0) { return 0.0; }
  let block = worldXZ - floor(worldXZ / vec2f(1280.0, 800.0)) * vec2f(1280.0, 800.0);
  var pool = 0.0;
  for (var k = 0; k < 9; k++) {
    let lamp = array<vec2f, 9>(vec2f(23.0, 9.0), vec2f(131.0, 23.0), vec2f(9.0, 117.0), vec2f(117.0, 131.0), vec2f(369.0, 35.0), vec2f(673.0, 105.0), vec2f(977.0, 35.0), vec2f(35.0, 361.0), vec2f(105.0, 581.0))[k];
    var to = lamp - block;
    to -= round(to / vec2f(1280.0, 800.0)) * vec2f(1280.0, 800.0);
    let line = vec3f(to.x, 60.0, to.y);
    pool += (0.25 + 0.75 * max(dot(n, normalize(line)), 0.0)) / (1.0 + dot(to, to) / 6400.0);
  }
  return min(pool, 1.3);
}
${GLASS}
${DEFORM_WGSL}
struct Out {
  @builtin(position) pos: vec4f,
  @location(0) at: vec3f,
  // The face's own square normal, in the piece's cells (n) and in the world (facing): what its cell is, which end of
  // a vehicle it is at, which side of a pane is seen, and how the sun's maps are read.
  @location(1) @interpolate(flat) n: vec3f,
  @location(2) @interpolate(flat) kind: u32,
  @location(3) @interpolate(flat) facing: vec3f,
  @location(4) seen: vec3f,
  // What it is lit by (#38): its smooth normal in the world (its square one where it has none), how open it is
  // (1 where it has none), each blended across it from its corners; and whether it has them.
  @location(5) lit: vec3f,
  @location(6) open: f32,
  @location(7) @interpolate(flat) hasSmooth: u32,
  // How scuffed and how creased it is here by its dents (#37): 0 on a piece never struck.
  @location(8) wear: vec2f,
}
const NEAR = 1.0;
const FAR = 100000.0;
// A smooth word's normal (fine.ts fold): folded flat onto an octahedron, ten bits each way, 0..1022 for -1..1.
fn unfold(word: u32) -> vec3f {
  let f = vec2f(f32(word & 1023u), f32((word >> 10u) & 1023u)) / 1022.0 * 2.0 - 1.0;
  var n = vec3f(f, 1.0 - abs(f.x) - abs(f.y));
  let t = max(-n.z, 0.0);
  n.x += select(t, -t, n.x >= 0.0);
  n.y += select(t, -t, n.y >= 0.0);
  return normalize(n);
}
// A face is six words: where its row starts in the piece; how long it is, which way it looks and its kind; and its
// four corners' smooth words (along its row and across it: 0 0, 1 0, 0 1, 1 1; 0: none, lit by its square normal).
@vertex fn vs(@builtin(vertex_index) v: u32, @location(0) a: u32, @location(1) b: u32, @location(2) words: vec4u) -> Out {
  let start = vec3f(f32(a & 1023u), f32((a >> 10u) & 1023u), f32((a >> 20u) & 1023u));
  let long = f32(b & 255u);
  let axis = (b >> 8u) & 3u;
  let side = f32((b >> 10u) & 1u);
  // Orient all six face directions consistently CCW outward so hardware backface culling drops back-facing quads.
  let flip = select(side > 0.5, side < 0.5, axis == 2u);
  let vi = select(v, v ^ 1u, flip);
  let cu = f32(vi & 1u);
  let cv = f32((vi >> 1u) & 1u);
  var p = start;
  var n = vec3f(0.0);
  if (axis == 1u) { p += vec3f(cu * long, side, cv); n = vec3f(0.0, side * 2.0 - 1.0, 0.0); }
  else if (axis == 2u) { p += vec3f(cu * long, cv, side); n = vec3f(0.0, 0.0, side * 2.0 - 1.0); }
  else { p += vec3f(side, cv, cu * long); n = vec3f(side * 2.0 - 1.0, 0.0, 0.0); }
  let turned = mat3x3f(u.c0, u.c1, u.c2);
  var out: Out;
  out.open = 1.0;
  // (Only on things finer than the world's cells: the core's bodies, a held block of the world, stay as they were.)
  let word = words[vi & 3u];
  out.hasSmooth = select(0u, word >> 31u, u.smoothOn != 0.0 && u.cell < 1.0);
  var lit = n;
  if (out.hasSmooth != 0u) {
    // Taken over the square normal as far as its blend says (7 of 7: all the way). How open it is lights it from
    // 0.38 shut in to 1 in the open.
    lit = normalize(mix(n, unfold(word), f32((word >> 28u) & 7u) / 7.0));
    out.open = mix(0.38, 1.0, f32((word >> 20u) & 255u) / 255.0);
  }
  // Bent by its dents (#37, #62; at once back for a piece never struck). Where the cell is, for its paint and its lamps,
  // stays where it was made: a bent panel keeps its own paint.
  let bent = deformPoint(p, lit, u.deform, u.frontZ > 0.5);
  let world = u.pos + turned * ((bent.pos - u.com) * u.cell) - u.eye;
  let d = dot(world, u.forward);
  out.pos = vec4f(dot(world, u.right) / (u.tanHalf * u.aspect), dot(world, u.up) / u.tanHalf, FAR / (FAR - NEAR) * (d - NEAR), d);
  out.at = p;
  out.n = n;
  out.seen = world;
  out.kind = b >> 16u;
  out.lit = turned * bent.norm;
  // A face lit by its square normal is lit by it bent.
  out.facing = select(out.lit, turned * n, out.hasSmooth != 0u);
  out.wear = vec2f(bent.scuff, bent.crease);
  return out;
}
// Whether a face is lit smooth: it has smooth words, and its smooth normal looks at the eye. One that looks away is a
// face seen from behind its curve: the outside of a pillar or of the windscreen's stair seen through the glass from the
// seat, which lit smooth mirrored the sky and glowed; or the very rim of a curve. Those are drawn as they always were.
fn smoothSeen(in: Out, rd: vec3f) -> bool { return in.hasSmooth != 0u && dot(in.lit, -rd) > 0.0; }
// The normal a smooth face is lit by: its smooth one, eased to its square one as it turns side-on to the eye.
fn litBy(in: Out, rd: vec3f) -> vec3f {
  let n = normalize(in.lit);
  return normalize(mix(in.facing, n, smoothstep(0.0, 0.3, dot(n, -rd))));
}
${PAINT}
// A vehicle's paint (#450: the library's paint role, marked polished by street.ts; kinds.rs POLISHED): a clear coat
// over the colour. It mirrors the sky as the hour colours it, a little face on and more at a glance (Schlick, from
// 0.04), the street where it looks down, and the sun in it is a sheen. Only this body's own faces are asked: nothing
// of the world, so it costs a few multiplies a pixel. Hubs, poles and brass are not paint, and stay as they were.
// In cells finer than the world's a curved panel is a stair of small faces, half of them seen nearly along: the
// glance counts for no more than at 57 degrees, as a pane's does, or a door would be bands of sky.
fn carPaint(col: vec3f, n: vec3f, rd: vec3f, direct: f32) -> vec3f {
  let glance = min(1.0 - clamp(dot(-rd, n), 0.0, 1.0), select(1.0, 0.45, u.cell < 1.0));
  let f = 0.04 + 0.96 * pow(glance, 5.0);
  let back = reflect(rd, n);
  let sky = mix(g.skyHorizon.rgb, g.skyZenith.rgb, pow(clamp(back.y, 0.0, 1.0), g.skyZenith.a));
  let seen = select(sky, sky * 0.2, back.y < 0.0);
  let sheen = pow(max(dot(back, u.sun), 0.0), 60.0) * direct * 1.2;
  return col * (1.0 - f) + seen * f + vec3f(sheen);
}
// What a smooth panel of glass or clear coat mirrors (#38): the sky as the hour colours it, a bright band along the
// horizon (the line down a car's flank), and below it the street: warm with light thrown up from the road near the
// horizon, dark asphalt beneath. Only this body's own faces are asked, as above.
fn street(back: vec3f, open: f32) -> vec3f {
  let up = clamp(back.y, 0.0, 1.0);
  // (The sky's blue a third of the way to grey: at full strength a red bonnet mirrored purple and a dark one royal blue.)
  var sky = mix(g.skyHorizon.rgb, g.skyZenith.rgb, pow(up, g.skyZenith.a));
  sky = mix(sky, vec3f(dot(sky, vec3f(0.2126, 0.7152, 0.0722))), 0.35);
  sky += g.skyHorizon.rgb * 0.4 * smoothstep(0.0, 0.025, back.y) * (1.0 - smoothstep(0.05, 0.14, back.y));
  let near = g.skyHorizon.rgb * vec3f(0.42, 0.37, 0.31);
  let road = g.skyHorizon.rgb * vec3f(0.07, 0.068, 0.066);
  let ground = mix(road, near, smoothstep(-0.2, 0.0, back.y)) * mix(0.65, 1.0, open);
  return mix(ground, sky, smoothstep(-0.006, 0.006, back.y));
}
// A smooth car's paint: the clear coat mirrors as Schlick says, whatever the angle, the colour under it has a metal's
// sheen, and the sun is a hard small spot in the coat.
fn clearCoat(col: vec3f, albedo: vec3f, n: vec3f, rd: vec3f, direct: f32, open: f32) -> vec3f {
  let f = 0.04 + 0.92 * pow(1.0 - clamp(dot(-rd, n), 0.0, 1.0), 5.0);
  let back = reflect(rd, n);
  let toSun = max(dot(back, u.sun), 0.0);
  let sheen = pow(toSun, 22.0) * direct * 0.35 * mix(vec3f(1.0), albedo, 0.55);
  let coat = pow(toSun, 150.0) * direct * 1.8;
  return col * (1.0 - f) + street(back, open) * f * mix(0.7, 1.0, open) + sheen + vec3f(coat);
}
// The colour of a smooth car's paint: as made, with a flake in it a fine cell across, not the town's blotches of wear.
fn factoryPaint(kind: u32, fine: vec3f) -> vec3f {
  let ci = (kind >> 8u) & 255u;
  var base = looks.material[kind & 15u].colour;
  if (ci != 0u) { base = looks.palette[ci].rgb; }
  return base * (1.0 + (hash3i(vec3i(floor(fine)), 17u) - 0.5) * 0.04);
}
// What is behind a pane of the world's glass that the march looked through is seen through it, tinted as the pane tints.
fn behindPane(in: Out) -> vec3f {
  let pane = textureLoad(panes, vec2i(in.pos.xy), 0);
  return select(vec3f(1.0), pow(pane.rgb, vec3f(0.4545)), pane.a > 0.0 && length(in.seen) > pane.a);
}
// Dynamic vehicle lamp emissive (#26): front headlights (warm white, low/high beam), rear tail/brake lamps (crimson,
// blazing >1.0 HDR into glow.ts when braking/handbraking), and crisp white reverse lamps when gear == -1.
fn vehicleLamp(in: Out, albedo: vec3f) -> vec3f {
  let ax = i32(round(u.lampAxis));
  var fwd = vec3f(1.0, 0.0, 0.0);
  if (ax == 2) { fwd = vec3f(-1.0, 0.0, 0.0); }
  else if (ax == 3) { fwd = vec3f(0.0, 0.0, 1.0); }
  else if (ax == 4) { fwd = vec3f(0.0, 0.0, -1.0); }
  let lat = vec3f(-fwd.z, 0.0, fwd.x);
  let mid = vec3f(u.midX, u.midY, u.midZ);
  let rel = (in.at - in.n * 0.5) - mid;
  let halfLen = max(abs(dot(mid, fwd)), 1.0);
  let halfWide = max(abs(dot(mid, lat)), 1.0);
  let along = dot(rel, fwd) / halfLen;
  let across = abs(dot(rel, lat)) / halfWide;
  let faceFwd = dot(in.n, fwd);
  let head = max(u.lampHead, 0.0);
  let brake = max(u.lampBrake, 0.0);
  let rev = max(u.lampRev, 0.0);
  // Negative u.lampRev drives 4-way amber hazard blinkers (works in broad daylight even when headlights are off).
  let hazard = max(-u.lampRev, 0.0);
  // Autonomous sensor status cyan/mint LEDs stay crisply lit regardless of headlight mode.
  let cyan = albedo.b > albedo.r * 1.4 && albedo.g > albedo.r * 1.3;
  if (cyan) { return albedo * (1.45 + min(head, 1.0) * 0.6); }
  // Front lamps: rich signal-orange amber hazard blinkers + warm intense white headlights (crisper & hotter on high beam > 1.0).
  if (along > 0.35 && faceFwd > -0.5) {
    let amber = albedo.r > albedo.g * 1.4 && albedo.g > albedo.b * 2.2;
    if (amber) {
      let amp = max(min(head, 0.7), hazard * 4.5);
      if (amp <= 0.01) { return vec3f(0.0); }
      return vec3f(1.3, 0.10, 0.002) * amp;
    }
    if (head <= 0.01) { return vec3f(0.0); }
    let hi = clamp(head - 1.0, 0.0, 1.0);
    let tint = mix(vec3f(1.0, 0.88, 0.66), vec3f(1.0, 0.97, 0.90), hi);
    return tint * (min(head, 1.0) * 2.8 + hi * 6.5);
  }
  // Rear lamps: dedicated white reverse lenses, deep orange-amber hazard blinkers, inner reverse zone on red clusters when reversing, steady crimson tails, blazing crimson brakes.
  if (along < -0.35 && faceFwd < 0.5) {
    let whiteLens = albedo.g > albedo.r * 0.65 && albedo.b > albedo.r * 0.55;
    if (whiteLens) { return vec3f(0.95, 0.98, 1.0) * (rev * 7.6); }
    let amber = albedo.g > albedo.r * 0.25 && albedo.b < albedo.r * 0.25;
    if (amber) {
      let amp = max(min(head, 0.65), hazard * 4.8);
      if (amp <= 0.01) { return vec3f(0.0); }
      return vec3f(1.3, 0.10, 0.002) * amp;
    }
    if (rev > 0.05 && across < 0.62) { return vec3f(0.95, 0.98, 1.0) * (rev * 7.6); }
    let tail = min(head, 1.0) * 1.9;
    let stop = brake * 9.5;
    let redPower = max(tail, stop);
    if (redPower <= 0.01) { return vec3f(0.0); }
    let hot = clamp(brake, 0.0, 1.0);
    return vec3f(1.0, 0.004 + hot * 0.003, 0.001 + hot * 0.001) * redPower;
  }
  // Side-mirror amber hazard repeaters & side/roof marker lamps.
  if (hazard > 0.05 && albedo.r > albedo.g * 1.4 && albedo.g > albedo.b * 2.2) {
    return vec3f(1.3, 0.10, 0.002) * (hazard * 4.5);
  }
  if (head > 0.05) { return albedo * (1.8 * min(head, 1.0)); }
  return vec3f(0.0);
}
@fragment fn fs(in: Out) -> @location(0) vec4f {
  let stuff = in.kind & 15u;
  let m = looks.material[stuff];
  // The cell as it was in the world when the body came loose, and the face as it then looked.
  // Paint goes by the world's cells: a finer thing's boards and bricks are the size the town's are.
  let inside = (in.at - in.n * 0.5) * u.cell;
  let rd = normalize(in.seen);
  let polished = (in.kind & 128u) != 0u;
  let soft = smoothSeen(in, rd);
  var albedo: vec3f;
  if (polished && soft) { albedo = factoryPaint(in.kind, in.at - in.n * 0.5); }
  else { albedo = paint(in.kind, vec3i(floor(inside)) + u.cells, in.n, 1.0, fract(inside), 1.0 / (max(length(in.seen), 1.0) * u.tanHalf * 0.0022)); }
  let n = select(in.facing, litBy(in, rd), soft);
  var rough = m.rough;
  let open = in.open;
  var coat = 1.0;
  var brokenLamp = 0.0;
  if (in.hasSmooth != 0u && in.wear.x > 0.001) {
    if (stuff == 15u) {
      brokenLamp = deformLamp(in.wear.x);
      albedo = mix(albedo, vec3f(0.026, 0.029, 0.034), brokenLamp);
      rough = mix(rough, 0.68, brokenLamp);
    } else if (polished) {
      // Only the closest contact leaves a transfer mark. The strike direction and
      // its sideways tangent give a bent panel the same scar from every camera.
      var nearest = 2.0;
      var contact = 0u;
      for (var i = 0u; i < min(u32(u.deform.status.x), 6u); i++) {
        let zone = u.deform.posR[i];
        let q = (in.at - zone.xyz) / max(zone.w, 0.001);
        let gap = dot(q, q);
        if (gap < nearest) { nearest = gap; contact = i; }
      }
      let rel = (in.at - u.deform.posR[contact].xyz) * u.cell;
      let dir = u.deform.dirD[contact].xyz;
      let side = normalize(select(vec3f(dir.z, 0.0, -dir.x), vec3f(1,0,0), abs(dir.y) > 0.95));
      let across = dot(rel, side);
      let inward = dot(rel, dir);
      // The horizontal bumper crosses the vertical door and rolls over the shoulders.
      let frontZ = u.frontZ > 0.5;
      let lateral = abs(select(dir.z, dir.x, frontZ));
      // Across a quarter panel the bumper rubs the upper flank of the crease.
      // At a low hit the contact centre can be in the empty wheel opening.
      let sideHit = smoothstep(0.55, 0.85, lateral);
      let radius = u.deform.posR[contact].w * u.cell;
      let markHeight = mix(1.55, 0.44 * radius, sideHit);
      let materialAt = vec3f(across, rel.y + inward * 0.50 + across * mix(0.16,-0.28,sideHit) - markHeight, inward);
      let detail = 1.0 - smoothstep(40.0, 95.0, length(in.seen));
      let worn = deformPaintSeen(albedo, in.wear.x, in.wear.y, materialAt, detail);
      albedo = worn.albedo;
      rough = min(1.0, rough + worn.roughBoost);
      coat = worn.clearcoatKeep;
      // On a hard side strike, render a clean, anti-aliased torn sheet-metal split along
      // the buckled arch shoulder instead of carving a stepped voxel staircase (#92).
      let depthRatio = u.deform.dirD[contact].w / max(u.deform.posR[contact].w, 0.001);
      let splitStrength = sideHit * smoothstep(0.11, 0.17, depthRatio) * smoothstep(0.15, 0.45, in.wear.x) * detail;
      if (splitStrength > 0.01) {
        let sx = (across - 0.15) / 2.25;
        let span = max(0.0, 1.0 - sx * sx);
        let curve = 0.09 * sin(across * 1.8) + 0.06 * (deformNoise(vec3f(across * 1.6, 2.0, 1.0)) - 0.5);
        let sd = materialAt.y - curve;
        let aa = max(length(in.seen) * u.tanHalf * 0.0032, 0.012);
        let halfGap = 0.068 * span * splitStrength;
        let seam = (1.0 - smoothstep(halfGap - aa, halfGap + aa, abs(sd))) * span * splitStrength;
        let lipBand = (smoothstep(halfGap - aa, halfGap + aa, abs(sd)) * (1.0 - smoothstep(halfGap + 0.08 * span, halfGap + 0.08 * span + aa, abs(sd)))) * span * splitStrength;
        let upperLip = smoothstep(-aa, aa, sd);
        let lipCol = mix(vec3f(0.14, 0.13, 0.12), vec3f(0.46, 0.47, 0.50), upperLip);
        albedo = mix(albedo, lipCol, lipBand * 0.85);
        albedo = mix(albedo, vec3f(0.016, 0.017, 0.020), seam * 0.96);
        rough = mix(rough, mix(0.62, 0.34, upperLip), lipBand * 0.85);
        rough = mix(rough, 0.94, seam);
        coat *= (1.0 - lipBand * 0.82) * (1.0 - seam);
      }
    }
  }
  let worldP = in.seen + u.eye;
  var direct = max(dot(n, u.sun), 0.0);
  if (direct > 0.0) {
    // In the world's shadow where the sun's maps say so; where they cannot say, in the sun. (Read by the square normal:
    // the maps are offset along it, and a smooth one along a stair would read them inside the step.)
    let sunny = sunlit(worldP, in.facing, 0u);
    if (sunny >= 0.0) { direct *= sunny; }
  }
  let dynLamp = stuff == 15u && u.lampAxis != 0.0;
  var col = shade(albedo, n, rd, u.sun, direct, open, select(rough, 0.18, dynLamp), select(m.glow * (1.0 - brokenLamp), 0.0, dynLamp));
  if (dynLamp) { col += vehicleLamp(in, albedo) * (1.0 - brokenLamp); }
  if (polished) { col = mix(col, select(carPaint(col, in.facing, rd, direct), clearCoat(col, albedo, n, rd, direct, open), soft), coat); }
  if (g.weather.z > 0.0) {
    let townPool = pieceTownLamps(worldP, n);
    if (townPool > 0.0) { col += albedo * vec3f(1.0, 0.78, 0.48) * townPool * g.weather.z * 1.5; }
  }
  if (localLights.info.x > 0u && !dynLamp) {
    col += evalLocalLights(worldP, n, rd, albedo, rough, select(0.0, coat, polished), 0.0);
  }
  let lit = tone(col);
  // Blazing vehicle lamps output reduced alpha (as march.ts lamps do) so glow.ts spreads lush halos at night.
  let glowAlpha = select(1.0, 1.0 - clamp((max(col.r, max(col.g, col.b)) - 1.2) / 3.0, 0.0, 1.0), dynLamp);
  if (u.ghost != 0) {
    // Every other pixel, in a grain that drifts upward, and paler: the world shows through.
    let p = vec2u(in.pos.xy);
    if (((p.x + p.y + u32(in.at.y * u.cell * 4.0)) & 1u) == 0u) { discard; }
    return vec4f(mix(lit, vec3f(0.75, 0.88, 1.0), 0.45) * behindPane(in), 1.0);
  }
  return vec4f(lit * behindPane(in), glowAlpha);
}
// A pane of a body's glass, the face of it that looks at the eye (one face a pane, from inside or out). Two passes,
// so that panes need no order among themselves: what is already drawn behind is multiplied by what comes through
// (fs_tint), then what the pane adds of itself goes on top (fs_glint). Both in the picture's own terms, after tone().
fn pane(in: Out) -> bool { return (in.kind & 15u) == 11u && dot(in.facing, in.seen) < 0.0; }
// How much a pane mirrors. In cells finer than the world's a sloping pane is a stair of small faces, half of them seen
// nearly along: each mirrored the sky hard and a windscreen was bands of blue. There the look along a face counts for
// no more than a look at 53 degrees, so every step of the stair mirrors alike.
// A smooth pane (#38) has no stair: it mirrors as glass does, but for at most a little over half at a glance (its
// corners still turn cell by cell, and every turn of a mirror at a glance was a bright fleck).
fn paneMirror(rd: vec3f, n: vec3f, soft: bool) -> f32 {
  if (soft) { return min(glassMirror(rd, n), 0.55 * looks.material[11].mirror); }
  if (u.cell >= 1.0) { return glassMirror(rd, n); }
  let facing = min(1.0 - clamp(dot(-rd, n), 0.0, 1.0), 0.4);
  return looks.material[11].mirror * (0.08 + 0.92 * pow(facing, 5.0));
}
// Glass broken into pieces (#37, #62): Voronoi cell edges near the impact bullseye, with
// distance-adaptive anti-aliasing (px) and a per-shard facet seed for crystalline sky glints.
fn crackNet(p: vec2f, px: f32) -> vec2f {
  let q = p / 2.2;
  let c = floor(q);
  let f = fract(q);
  var d1 = 8.0;
  var d2 = 8.0;
  var cellId = 0.0;
  for (var j = -1; j <= 1; j++) {
    for (var i = -1; i <= 1; i++) {
      let o = vec2f(f32(i), f32(j));
      let h = vec2f(deformHash(vec3f(c + o, 3.0)), deformHash(vec3f(c + o, 9.0)));
      let d = length(o + h - f);
      if (d < d1) { d2 = d1; d1 = d; cellId = h.x - 0.5; } else if (d < d2) { d2 = d; }
    }
  }
  let w = 0.035;
  let edge = (1.0 - smoothstep(w, w + max(0.055, px * 0.55), d2 - d1)) * (0.09 / (0.09 + px * 0.45));
  return vec2f(edge, cellId);
}
// Shattered laminated auto-glass (#37, #61, #62): evaluates each struck window (front, rear, left,
// right) from its own per-window origin u.cracks[w], returning (crackIntensity, facetTilt).
// Compact crushed impact bullseye + piecewise-straight jagged radial rays + straight-chord cobweb
// arcs + tight shatter mosaic near the core, clipped to each window plane and distance anti-aliased.
// The camera and window share the same local coordinate frame.
fn eyeInsidePiece() -> bool {
  let eye = u.com + transpose(mat3x3f(u.c0,u.c1,u.c2)) * (u.eye-u.pos) / u.cell;
  let mid = vec3f(u.midX,u.midY,u.midZ);
  return all(abs(eye-mid) < mid);
}
fn paneCrack(in: Out) -> vec2f {
  if (u.deform.status.w <= 0.01) { return vec2f(0.0); }
  let viewDist = length(in.seen);
  let px = max(viewDist * u.tanHalf * 0.022, 0.018);
  var bestTotal = 0.0;
  var bestTilt = 0.0;
  for (var w = 0u; w < 4u; w++) {
    let cr = u.cracks[w];
    let crack = cr.w;
    if (crack <= 0.01) { continue; }
    let origin = cr.xyz;
    // In cells of 2.5 cm, whatever the piece's own: a web is as fine on a cabin of 1.25 cm cells.
    let p = (in.at - origin) * u.cell * 4.0;
    let maxReach = 19.2 + 30.4 * crack;
    if (length(p) >= maxReach) { continue; }
    // Unwrap around the cabin. A side blow can crack the edge of the windshield:
    // projecting that pane along the impact direction collapsed the web into horizontal lines.
    let mid = max(vec2f(u.midX, u.midZ), vec2f(1.0));
    let radial = (origin.xz - mid) / mid;
    let here = (in.at.xz - mid) / mid;
    let arc = atan2(radial.x * here.y - radial.y * here.x, dot(radial, here));
    let span = max(1.0, length(radial.yx * mid));
    let across = vec2f(arc * span * u.cell * 4.0, p.y * 1.22);
    let dist = length(across);
    if (dist >= maxReach) { continue; }
    let angle = atan2(across.y, across.x);
    let rayCount = 11.0;
    let sectorSpan = 6.2831853 / rayCount;
    let uAngle = angle + 3.14159265;
    let sector = floor(uAngle / sectorSpan);
    let rayReach = maxReach * (0.58 + 0.42 * deformHash(vec3f(sector, 2.0 + f32(w), 5.0)));
    let amount = clamp(crack * 1.40, 0.30, 1.0) * (1.0 - smoothstep(rayReach * 0.38, rayReach, dist));
    if (amount <= 0.005) { continue; }
    // 1. Compact crushed laminated impact bullseye core (smaller inside cabin -> no lens-flare starburst).
    let bullNoise = (deformHash(vec3f(sector, 9.0, 3.0 + f32(w))) - 0.5) * 0.9;
    let bullRadius = (1.3 + 1.8 * crack) * select(0.75, 1.0, in.hasSmooth != 0u);
    let bullseye = (1.0 - smoothstep(bullRadius * 0.42, bullRadius + px * 1.2, dist + bullNoise)) * clamp(crack * 1.45, 0.38, 0.88);
    // 2. Piecewise-straight jagged radial fracture rays tapering finely so nearby cars stay legible.
    let seg = floor(dist / 4.2);
    let segF = fract(dist / 4.2);
    let k0 = (deformHash(vec3f(sector, seg, 7.0 + f32(w))) - 0.5) * 0.19;
    let k1 = (deformHash(vec3f(sector, seg + 1.0, 7.0 + f32(w))) - 0.5) * 0.19;
    let jag = mix(k0, k1, segF);
    let localA = fract(uAngle / sectorSpan + jag) - 0.5;
    let rayDist = abs(localA) * max(dist, 1.5) * sectorSpan;
    let fineScale = select(0.78, 1.0, in.hasSmooth != 0u);
    let rayWidth = mix(0.15, 0.025, clamp(dist / rayReach, 0.0, 1.0)) * fineScale;
    let rayVis = max(rayWidth / (rayWidth + px * 0.28), 0.36);
    let rays = (1.0 - smoothstep(rayWidth, rayWidth + px * 0.90, rayDist)) * rayVis * clamp(amount * 1.40, 0.0, 0.92);
    // 3. Straight-chord staggered cobweb cross-cracks between adjacent radial rays.
    let chordDist = dist * cos(localA * sectorSpan);
    let ringOffset = deformHash(vec3f(sector, 6.0, 1.0 + f32(w))) * 2.8;
    let ringSpace = 3.5 + 0.14 * dist;
    let ringDist = abs(fract((chordDist + ringOffset) / ringSpace) - 0.5) * ringSpace;
    let ringWidth = 0.060 * fineScale;
    let ringEnv = smoothstep(bullRadius * 0.7, bullRadius * 1.5, dist) * (1.0 - smoothstep(rayReach * 0.35, rayReach * 0.84, dist));
    let ringVis = max(ringWidth / (ringWidth + px * 0.34), 0.34);
    let rings = (1.0 - smoothstep(ringWidth, ringWidth + px * 0.95, ringDist)) * ringVis * ringEnv * clamp(amount * 1.30, 0.0, 0.84);
    // 4. Fine Voronoi shatter mosaic concentrated tightly near the impact core.
    let netMask = 1.0 - smoothstep(bullRadius * 1.1, bullRadius * 3.6, dist);
    var net = vec2f(0.0);
    if (netMask > 0.01) { net = crackNet(across * 1.20, px); }
    let mosaic = net.x * netMask * clamp(crack * 1.35, 0.0, 0.84);
    var total = max(max(bullseye, rays), max(rings, mosaic));
    total = max(total, bullseye * 0.65 + netMask * crack * 0.10);
    if (total > bestTotal) {
      bestTotal = total;
      bestTilt = net.y * netMask * clamp(crack * 1.2, 0.0, 1.0);
    }
  }
  // Seen from inside, keep the narrow forward road corridor clear of glare.
  if (bestTotal > 0.0 && eyeInsidePiece()) {
    let rd = normalize(in.seen);
    let centerCone = smoothstep(0.955, 0.992, dot(rd, u.forward));
    bestTotal *= mix(1.0, 0.28, centerCone);
  }
  return vec2f(clamp(bestTotal, 0.0, 1.0), bestTilt);
}
@fragment fn fs_tint(in: Out) -> @location(0) vec4f {
  if (!pane(in)) { discard; }
  let rd = normalize(in.seen);
  // (A picture already toned: what lets a share through of the light lets about that share's root through of the picture.)
  let soft = smoothSeen(in, rd);
  let n = select(in.facing, litBy(in, rd), soft);
  // A crack scatters light and lets less through; interior cabin glass keeps dark fracture contrast while staying drivable.
  let cracked = paneCrack(in).x;
  let block = select(0.74, 0.48, cracked > 0.0 && eyeInsidePiece());
  let through = 1.0 - block * cracked;
  let mirrored = select(0.0, paneMirror(rd, n, soft), u.mirrors > 0.5);
  return vec4f(pow(glassTint(in.kind, u.cell + 0.5) * 0.94 * (1.0 - mirrored) * through, vec3f(0.4545)), 1.0);
}
@fragment fn fs_glint(in: Out) -> @location(0) vec4f {
  if (!pane(in)) { discard; }
  let rd = normalize(in.seen);
  let m = looks.material[11];
  let soft = smoothSeen(in, rd);
  var n = select(in.facing, litBy(in, rd), soft);
  let crackInfo = paneCrack(in);
  let cracked = crackInfo.x;
  let tilt = crackInfo.y;
  // Slightly tilt reflected sky on shattered exterior glass facets for crystalline broken-glass sparkle.
  if (in.hasSmooth != 0u && abs(tilt) > 0.01) {
    let side = normalize(cross(n, select(vec3f(0.0, 1.0, 0.0), vec3f(1.0, 0.0, 0.0), abs(n.y) > 0.9)));
    n = normalize(n + side * (tilt * 0.22));
  }
  // What it mirrors: the sky as the hour colours it, lighter towards the horizon (a body's glass does not ask the
  // world); a smooth pane, the street below the horizon too.
  let back = reflect(rd, n);
  let sky = select(mix(g.skyHorizon.rgb, g.skyZenith.rgb, pow(clamp(back.y, 0.0, 1.0), g.skyZenith.a)), street(back, in.open), soft);
  var direct = max(dot(n, u.sun), 0.0);
  if (direct > 0.0) { let sunny = sunlit(in.seen + u.eye, in.facing, 0u); if (sunny >= 0.0) { direct *= sunny; } }
  // Its own faint film, and the sun's glint off it.
  let own = shade(m.colour, n, rd, u.sun, direct, in.open, m.rough, 0.0);
  // Crisp white-silver internal reflection along laminated fracture planes; interior faces are
  // strictly capped below glow.ts's bloom threshold so cracks never bloom into a lens-flare starburst.
  let crackStrength = select(0.85, 0.38, cracked > 0.0 && eyeInsidePiece());
  let litCrack = shade(vec3f(0.60, 0.64, 0.68), n, rd, u.sun, max(direct, 0.34), max(in.open, 0.74), 0.38, 0.0);
  let transmitted = vec3f(0.68, 0.72, 0.76) * max(g.lightSun.a, 0.32);
  let crackLight = select(min(max(litCrack, transmitted), vec3f(0.76)), min(litCrack, vec3f(1.25)), in.hasSmooth != 0u);
  let add = own * 0.1 + sky * paneMirror(rd, n, soft) + crackLight * cracked * crackStrength;
  return vec4f(tone(add + 0.3) - tone(vec3f(0.3)), 0.0);
}
`

/** One body as the GPU holds it. */
export interface Piece {
  born: Born
  /** A living look keeps its intact fine skin for a local break and repair. */
  skin?: Uint16Array
  opening?: CrashOpening
  /** Its middle of mass in the world's finest cells, and its turn (x, y, z, w). */
  pos: [number, number, number]
  rot: [number, number, number, number]
  /** How big one of its cells is, in the world's cells. */
  cell: number
  /** A thing not yet made, drawn pale and seen through. */
  ghost?: boolean
  /**
   * Dynamic vehicle lamp state (#26): `[brake, reverse, headlight, frontAxis]`.
   * `brake` 0..1.5 (1 braking, >1 handbrake), `reverse` 0..1, `headlight` 0..2 (1 low beam, >1 high beam),
   * `frontAxis` 1:+x, 2:-x, 3:+z, 4:-z (0 or omitted: inactive static lamp material).
   */
  lamps?: [number, number, number, number]
  /** Its dents, scuffs and cracks (#37, deform.ts), kept by whoever records what struck it; none or no dents draws it as made. */
  deform?: DeformState
  /** Per-window crack origins `[front, rear, left, right]` in this piece's own cells (#61). None: glass is whole. */
  cracks?: (readonly [number, number, number] | null)[]
  destroy(): void
}

export interface Pieces {
  /** share: its faces may be drawn from one buffer with every other piece made from the same `born.faces`. */
  add(born: Born, share?: boolean): Piece
  /** Gives a piece made unshared new faces (and smooth words) for the same look: its square faces once its smooth ones are made (#38). Nothing for one destroyed. */
  refit(piece: Piece, faces: Uint32Array<ArrayBuffer>, smooth?: Uint32Array<ArrayBuffer>): void
  /** mirrors: false is the M key's mirrors off, under which glass is seen through, tinted, mirroring nothing. */
  draw(encoder: GPUCommandEncoder, to: Target, view: View, sun: readonly [number, number, number], timing?: GPURenderPassTimestampWrites, mirrors?: boolean): void
  /** Automatically emits local lights for every non-vehicle piece containing LAMP (material 15) voxels (robotaxi LiDAR domes, traffic signals, depot canopies, conjured lamps). */
  emitLights(sink: LocalLightSink): void
  readonly count: number
  /** How many faces are drawn a frame. */
  readonly faces: number
  /** Whether faces with smooth words are lit by them (#38); off draws every face by its square normal. */
  smooth: boolean
}

/** One local-space light cluster automatically extracted from a Born's LAMP (material 15) faces. */
interface PieceEmitter {
  lx: number; ly: number; lz: number
  nx: number; ny: number; nz: number
  directional: boolean
  r: number; g: number; b: number
  area: number
  vivid: boolean
}
let cachedPalette: Float32Array | null = null
const lampRgb = (ci: number): [number, number, number, boolean] => {
  if (ci === 0 || ci === 46) return [1.0, 0.78, 0.48, false]
  const pal = (cachedPalette ??= palette())
  const o = (ci & 255) * 4
  let r = pal[o], g = pal[o + 1], b = pal[o + 2]
  const avg = (r + g + b) / 3
  const sat = Math.max(r, g, b) - Math.min(r, g, b)
  // Boost chromatic LEDs/signals/signs gently just as march.ts does, keeping white/warm lamps natural.
  if (sat > 0.06) {
    r = Math.max(r + (r - avg) * 1.35, 0)
    g = Math.max(g + (g - avg) * 1.35, 0)
    b = Math.max(b + (b - avg) * 1.35, 0)
  }
  const peak = Math.max(r, g, b, 0.001)
  return [r / peak, g / peak, b / peak, sat > 0.08]
}
const bornEmitters = new WeakMap<Born, readonly PieceEmitter[]>()
const EMPTY_EMITTERS: readonly PieceEmitter[] = []
/** Scans a Born's exterior faces once and clusters any LAMP (material 15) faces into up to 4 local-light emitters. */
function emittersOf(born: Born): readonly PieceEmitter[] {
  const hit = bornEmitters.get(born)
  if (hit) return hit
  const faces = born.faces
  const total = faces.length >>> 1
  const clusters: { ci: number; sx: number; sy: number; sz: number; nx: number; ny: number; nz: number; area: number }[] = []
  const span = Math.max(born.size[0], born.size[1], born.size[2])
  const mergeR = Math.max(12, span * 0.24)
  const mergeR2 = mergeR * mergeR
  for (let i = 0; i < total; i++) {
    const b = faces[i * 2 + 1]
    const kind = b >>> 16
    if ((kind & 15) !== 15) continue
    const a = faces[i * 2]
    const sx = a & 1023, sy = (a >>> 10) & 1023, sz = (a >>> 20) & 1023
    const long = (b & 255) || 1
    const axis = (b >>> 8) & 3
    const side = (b >>> 10) & 1
    const sign = side * 2 - 1
    let fx = sx, fy = sy, fz = sz, nx = 0, ny = 0, nz = 0
    if (axis === 1) { fx += long * 0.5; fy += side; fz += 0.5; ny = sign }
    else if (axis === 2) { fx += long * 0.5; fy += 0.5; fz += side; nz = sign }
    else { fx += side; fy += 0.5; fz += long * 0.5; nx = sign }
    const ci = (kind >>> 8) & 255
    let merged = false
    for (let c = 0; c < clusters.length; c++) {
      const cl = clusters[c]
      if (cl.ci !== ci) continue
      const inv = 1 / cl.area
      const dx = fx - cl.sx * inv, dy = fy - cl.sy * inv, dz = fz - cl.sz * inv
      if (dx * dx + dy * dy + dz * dz <= mergeR2) {
        cl.sx += fx * long; cl.sy += fy * long; cl.sz += fz * long
        cl.nx += nx * long; cl.ny += ny * long; cl.nz += nz * long
        cl.area += long
        merged = true
        break
      }
    }
    if (!merged && clusters.length < 16) {
      clusters.push({ ci, sx: fx * long, sy: fy * long, sz: fz * long, nx: nx * long, ny: ny * long, nz: nz * long, area: long })
    }
  }
  if (!clusters.length) {
    bornEmitters.set(born, EMPTY_EMITTERS)
    return EMPTY_EMITTERS
  }
  if (clusters.length > 4) {
    clusters.sort((a, b) => b.area - a.area)
    clusters.length = 4
  }
  const out: PieceEmitter[] = []
  for (let i = 0; i < clusters.length; i++) {
    const cl = clusters[i]
    const inv = 1 / cl.area
    const nLen = Math.hypot(cl.nx, cl.ny, cl.nz)
    const dirCoherence = nLen * inv
    const directional = dirCoherence > 0.58
    const dnx = nLen > 1e-4 ? cl.nx / nLen : 0
    const dny = nLen > 1e-4 ? cl.ny / nLen : -1
    const dnz = nLen > 1e-4 ? cl.nz / nLen : 0
    const push = directional ? 1.2 : 0
    const [r, g, b, vivid] = lampRgb(cl.ci)
    out.push({
      lx: cl.sx * inv + dnx * push,
      ly: cl.sy * inv + dny * push,
      lz: cl.sz * inv + dnz * push,
      nx: dnx, ny: dny, nz: dnz,
      directional,
      r, g, b,
      area: cl.area,
      vivid,
    })
  }
  bornEmitters.set(born, out)
  return out
}

/** A piece's own numbers (struct U): twelve rows of four, its dents, then four per-window crack origins. */
const OWN = 192, DEFORM_AT = OWN / 4, CRACKS_BYTES = 16 * 4, CRACKS_AT = (OWN + DEFORM_BYTES) / 4, UNIFORMS = OWN + DEFORM_BYTES + CRACKS_BYTES

/**
 * A look's faces as the GPU takes them, six words a face: the solid ones first, then the glass, each with its corners'
 * smooth words (#38), 0 where it has none. When `deform` is supplied, only merged rows whose bounding box overlaps an
 * active dent sphere (with conservative displacement margin) or a torn opening are split into 1-cell unit faces (#37);
 * undamaged regions stay merged, cutting dented-vehicle vertex load several-fold with identical geometry.
 */
function sortFaces(born: Born, deform: DeformState | undefined, openings: readonly CrashOpening[]) {
  const all = born.faces, smooth = born.smooth, total = all.length / 2
  const spheres: number[] = []
  if (deform?.dentCount) {
    const n = Math.min(deform.dentCount, deform.dents.length)
    for (let i = 0; i < n; i++) {
      const d = deform.dents[i]
      if (d.radius <= 0.0001) continue
      const r = d.radius + 1.2 * d.depth + 2.0
      spheres.push(d.center[0], d.center[1], d.center[2], r * r)
    }
  }
  const boxes: number[] = []
  for (const op of openings) {
    if (!op.removed.size) continue
    let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity
    for (const where of op.removed) {
      const x = where & 1023, y = (where >>> 10) & 1023, z = (where >>> 20) & 1023
      if (x < x0) x0 = x; if (x > x1) x1 = x
      if (y < y0) y0 = y; if (y > y1) y1 = y
      if (z < z0) z0 = z; if (z > z1) z1 = z
    }
    boxes.push(x0, y0, z0, x1, y1, z1)
  }
  const hasSplit = spheres.length > 0 || boxes.length > 0
  const needsSplit = (a: number, b: number): boolean => {
    const long = (b & 255) || 1
    if (long <= 1 && !boxes.length) return false
    const sx = a & 1023, sy = (a >>> 10) & 1023, sz = (a >>> 20) & 1023
    const axis = (b >>> 8) & 3
    // Cell-coordinate bounding box of the row's cells [x0..x1] x [y0..y1] x [z0..z1] (inclusive cell indices).
    const x1 = axis === 0 ? sx : sx + long - 1
    const z1 = axis === 0 ? sz + long - 1 : sz
    for (let i = 0; i < boxes.length; i += 6) {
      if (x1 >= boxes[i] && sx <= boxes[i + 3] && sy >= boxes[i + 1] && sy <= boxes[i + 4] && z1 >= boxes[i + 2] && sz <= boxes[i + 5]) return true
    }
    if (long <= 1) return false
    // Vertex-coordinate AABB of the quad row for dent sphere overlap test.
    const vx1 = x1 + 1, vy1 = sy + 1, vz1 = z1 + 1
    for (let i = 0; i < spheres.length; i += 4) {
      const cx = spheres[i], cy = spheres[i + 1], cz = spheres[i + 2], r2 = spheres[i + 3]
      const dx = cx < sx ? sx - cx : cx > vx1 ? cx - vx1 : 0
      const dy = cy < sy ? sy - cy : cy > vy1 ? cy - vy1 : 0
      const dz = cz < sz ? sz - cz : cz > vz1 ? cz - vz1 : 0
      if (dx * dx + dy * dy + dz * dz <= r2) return true
    }
    return false
  }
  let splitMask: Uint8Array | null = null
  let size = total
  if (hasSplit) {
    splitMask = new Uint8Array(total)
    size = 0
    for (let f = 0; f < total; f++) {
      const a = all[f * 2], b = all[f * 2 + 1]
      if (needsSplit(a, b)) {
        splitMask[f] = 1
        size += (b & 255) || 1
      } else {
        size++
      }
    }
  }
  const sorted = new Uint32Array((size + openings.reduce((sum, opening) => sum + opening.walls.length / 2, 0)) * 6)
  let at = 0, glass = 0
  for (const glassy of [false, true]) {
    // Interior walls are solid and draw before the glass. Their square normals
    // catch light on the recessed edge of the broken lamp surround.
    if (glassy) for (const opening of openings) for (let w = 0; w < opening.walls.length; w += 2) {
      sorted[at * 6] = opening.walls[w]
      sorted[at * 6 + 1] = opening.walls[w + 1]
      at++
    }
    for (let f = 0; f < total; f++) {
      const a = all[f * 2], b = all[f * 2 + 1]
      if ((((b >>> 16) & 15) === 11) !== glassy) continue
      const split = splitMask !== null && splitMask[f] === 1
      if (!split) {
        sorted[at * 6] = a; sorted[at * 6 + 1] = b
        if (smooth) {
          sorted[at * 6 + 2] = smooth[f * 4]; sorted[at * 6 + 3] = smooth[f * 4 + 1]
          sorted[at * 6 + 4] = smooth[f * 4 + 2]; sorted[at * 6 + 5] = smooth[f * 4 + 3]
        }
        at++
        if (glassy) glass++
        continue
      }
      const long = (b & 255) || 1, axis = (b >>> 8) & 3
      for (let k = 0; k < long; k++) {
        // Along x for faces that look along y or z, along z for those that look along x (pieces.ts `vs`).
        const start = axis === 0 ? a + (k << 20) : a + k
        if (openings[0]?.removed.has(start) || openings[1]?.removed.has(start)) continue
        sorted[at * 6] = start >>> 0; sorted[at * 6 + 1] = ((b & ~255) | 1) >>> 0
        if (smooth) {
          sorted[at * 6 + 2] = smooth[f * 4]; sorted[at * 6 + 4] = smooth[f * 4 + 2]
          const last = k === long - 1
          sorted[at * 6 + 3] = smooth[f * 4 + (last ? 1 : 0)]; sorted[at * 6 + 5] = smooth[f * 4 + (last ? 3 : 2)]
        }
        at++
        if (glassy) glass++
      }
    }
  }
  return { sorted: at * 6 < sorted.length ? sorted.subarray(0, at * 6) : sorted, count: at, glass }
}

export async function pieces(device: GPUDevice, format: GPUTextureFormat, march: Marcher): Promise<Pieces> {
  const looks = march.looks
  const module = await shader(device, 'pieces', CODE)
  // One layout for the solid faces and the glass, so a piece's bindings serve all three pipelines.
  const both = GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT
  const own = device.createBindGroupLayout({ entries: [{ binding: 0, visibility: both, buffer: {} }, { binding: 1, visibility: both, buffer: {} }] })
  const shared = device.createBindGroupLayout({ entries: [{ binding: 0, visibility: both, buffer: {} }, { binding: 1, visibility: both, texture: { sampleType: 'unfilterable-float', viewDimension: '2d-array' } }, { binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'unfilterable-float' } }, { binding: 3, visibility: GPUShaderStage.FRAGMENT, buffer: {} }] })
  const layout = device.createPipelineLayout({ bindGroupLayouts: [own, shared] })
  const drawn = (entryPoint: string, glass?: GPUBlendComponent) => device.createRenderPipelineAsync({
    label: `pieces ${entryPoint}`, layout,
    vertex: { module, entryPoint: 'vs', buffers: [{ arrayStride: 24, stepMode: 'instance', attributes: [{ shaderLocation: 0, offset: 0, format: 'uint32' }, { shaderLocation: 1, offset: 4, format: 'uint32' }, { shaderLocation: 2, offset: 8, format: 'uint32x4' }] }] },
    fragment: { module, entryPoint, targets: [{ format, ...(glass ? { blend: { color: glass, alpha: { srcFactor: 'zero', dstFactor: 'one', operation: 'add' } } } : {}) }] },
    primitive: { topology: 'triangle-strip', cullMode: 'back' },
    // The glass after everything solid, read against its depth and not written to it.
    depthStencil: { format: 'depth24plus', depthWriteEnabled: !glass, depthCompare: 'less' },
  })
  const [pipeline, tint, glint] = await Promise.all([drawn('fs'), drawn('fs_tint', { srcFactor: 'zero', dstFactor: 'src', operation: 'add' }), drawn('fs_glint', { srcFactor: 'one', dstFactor: 'one', operation: 'add' })])
  let lit: { panes: GPUTextureView; group: GPUBindGroup } | null = null
  const litFor = (panes: GPUTextureView) => {
    if (lit?.panes !== panes) lit = { panes, group: device.createBindGroup({ layout: shared, entries: [{ binding: 0, resource: { buffer: march.globals } }, { binding: 1, resource: march.sun.all }, { binding: 2, resource: panes }, { binding: 3, resource: { buffer: march.localLights.buffer } }] }) }
    return lit.group
  }
  /** count: all its faces; glass: how many of them, the last ones, are glass; held: its faces' buffer, and how many pieces draw from it. */
  interface Faces { faces: GPUBuffer; count: number; glass: number }
  interface Shared extends Faces { users: number }
  interface Held extends Piece {
    bent?: { state: DeformState; revision: number; nose?: CrashOpening; mesh: Faces }
    faces: GPUBuffer
    uniforms: GPUBuffer
    bind: GPUBindGroup
    count: number
    glass: number
    held: Shared
  }
  /** A look's faces on the GPU: the solid ones first, then the glass, each with its corners' smooth words. */
  const upload = (born: Born, deform?: DeformState, openings: readonly CrashOpening[] = []): Faces => {
    const { sorted, count, glass } = sortFaces(born, deform, openings)
    const faces = device.createBuffer({ label: openings.length ? 'torn body mesh' : 'piece faces', size: Math.max(24, sorted.byteLength), usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST })
    device.queue.writeBuffer(faces, 0, sorted)
    return { faces, count, glass }
  }
  const release = (held: Shared) => { held.faces.destroy() }
  /** The faces a piece is drawn from now: rows overlapping active dents or torn openings are split to 1 cell, undamaged rows stay merged. */
  const facesOf = (piece: Held): Faces => {
    const state = piece.deform
    if (!state?.dentCount) {
      if (piece.bent) { piece.bent.mesh.faces.destroy(); piece.bent = undefined }
      return piece
    }
    const nose = state.hoodDamage >= 0.35 ? piece.opening : undefined
    if (piece.bent && (piece.bent.state !== state || piece.bent.revision !== state.revision || piece.bent.nose !== nose)) {
      piece.bent.mesh.faces.destroy()
      piece.bent = undefined
    }
    if (!piece.bent) {
      piece.bent = { state, revision: state.revision, nose, mesh: upload(piece.born, state, nose ? [nose] : []) }
    }
    return piece.bent.mesh
  }

  const live = new Set<Held>()
  /** Faces already on the GPU, by the array they came from: many pieces of one look (the street's cars, #450) draw from one buffer. */
  const common = new WeakMap<Uint32Array, Shared>()
  const block = new ArrayBuffer(UNIFORMS), f = new Float32Array(block), i32 = new Int32Array(block)
  const visible: { piece: Held; faces: Faces }[] = []
  let smooth = true
  return {
    get smooth() { return smooth },
    set smooth(on: boolean) { smooth = on },
    get count() { return live.size },
    get faces() { let n = 0; for (const p of live) n += (p.deform?.dentCount ? p.bent?.mesh ?? p : p).count; return n },
    add(born, share = false) {
      let made = share ? common.get(born.faces) : undefined
      if (!made) {
        made = { ...upload(born), users: 0 }
        if (share) common.set(born.faces, made)
      }
      made.users++
      const held = made, uniforms = device.createBuffer({ size: UNIFORMS, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST })
      const bind = device.createBindGroup({ layout: own, entries: [{ binding: 0, resource: { buffer: uniforms } }, { binding: 1, resource: { buffer: looks } }] })
      const piece: Held = { born, pos: [born.low[0] + born.com[0], born.low[1] + born.com[1], born.low[2] + born.com[2]], rot: [0, 0, 0, 1], cell: 1, faces: held.faces, uniforms, bind, count: held.count, glass: held.glass, held, destroy() { if (!live.delete(piece)) return; uniforms.destroy(); piece.bent?.mesh.faces.destroy(); if (--piece.held.users === 0) { release(piece.held); if (common.get(piece.born.faces) === piece.held) common.delete(piece.born.faces) } } }
      live.add(piece)
      return piece
    },
    refit(p, faces, smooth) {
      const piece = p as Held
      if (!live.has(piece) || piece.held.users !== 1 || common.get(piece.born.faces) === piece.held) return
      release(piece.held)
      piece.bent?.mesh.faces.destroy(); piece.bent = undefined
      piece.born.faces = faces
      piece.born.smooth = smooth
      piece.held = { ...upload(piece.born), users: 1 }
      piece.faces = piece.held.faces; piece.count = piece.held.count; piece.glass = piece.held.glass
    },
    draw(encoder, to, view, sun, timing, mirrors = true) {
      if (!live.size) return
      const aspect = to.size[0] / to.size[1]
      const tanV = view.tanHalf, tanH = tanV * aspect
      const secV = Math.hypot(1, tanV), secH = Math.hypot(1, tanH)
      const ex = view.eye[0], ey = view.eye[1], ez = view.eye[2]
      const anchorX = Math.floor(ex / 64) * 64, anchorY = Math.floor(ey / 64) * 64, anchorZ = Math.floor(ez / 64) * 64
      const rx = view.right[0], ry = view.right[1], rz = view.right[2]
      const ux = view.up[0], uy = view.up[1], uz = view.up[2]
      const fx = view.forward[0], fy = view.forward[1], fz = view.forward[2]
      f.set([ex - anchorX, ey - anchorY, ez - anchorZ, tanV, rx, ry, rz, aspect, ux, uy, uz, 0, fx, fy, fz, 0, sun[0], sun[1], sun[2], 0])
      visible.length = 0
      const pass = encoder.beginRenderPass({
        colorAttachments: [{ view: to.color, loadOp: 'load', storeOp: 'store' }],
        depthStencilAttachment: { view: to.depth, depthLoadOp: 'load', depthStoreOp: 'store' },
        ...(timing ? { timestampWrites: timing } : {}),
      })
      pass.setPipeline(pipeline)
      pass.setBindGroup(1, litFor(march.panes(to.size)))
      for (const piece of live) {
        // A piece of no size or no faces is not drawn: a living thing's own cells while it wears a finer look (living.ts), or what is held out of sight.
        if (!piece.cell || !piece.count) continue
        const [x, y, z, w] = piece.rot, b = piece.born, cell = piece.cell
        const m00 = 1 - 2 * (y * y + z * z), m10 = 2 * (x * y + z * w), m20 = 2 * (x * z - y * w)
        const m01 = 2 * (x * y - z * w), m11 = 1 - 2 * (x * x + z * z), m21 = 2 * (y * z + x * w)
        const m02 = 2 * (x * z + y * w), m12 = 2 * (y * z - x * w), m22 = 1 - 2 * (x * x + y * y)
        // Conservative world-space bounding sphere frustum cull: skips behind-camera & off-screen vehicles before uniform upload or draw.
        const midX = b.size[0] * 0.5, midY = b.size[1] * 0.5, midZ = b.size[2] * 0.5
        const ox = (midX - b.com[0]) * cell, oy = (midY - b.com[1]) * cell, oz = (midZ - b.com[2]) * cell
        const dx = piece.pos[0] + m00 * ox + m01 * oy + m02 * oz - ex
        const dy = piece.pos[1] + m10 * ox + m11 * oy + m12 * oz - ey
        const dz = piece.pos[2] + m20 * ox + m21 * oy + m22 * oz - ez
        const rad = Math.hypot(midX, midY, midZ) * cell + (piece.deform?.dentCount ? 2.0 : 0.0)
        const dist = dx * fx + dy * fy + dz * fz
        if (dist + rad < 1.0) continue
        const upD = Math.abs(dx * ux + dy * uy + dz * uz)
        if (upD > Math.max(0, dist) * tanV + rad * secV) continue
        const rightD = Math.abs(dx * rx + dy * ry + dz * rz)
        if (rightD > Math.max(0, dist) * tanH + rad * secH) continue
        const lamps = piece.lamps
        f[11] = midX
        f[15] = midY
        f[19] = midZ
        f.set([piece.pos[0] - anchorX, piece.pos[1] - anchorY, piece.pos[2] - anchorZ, cell], 20)
        i32.set(b.low, 24)
        i32[27] = piece.ghost ? 1 : 0
        f.set(b.com, 28)
        f[31] = lamps ? lamps[0] : 0
        // The turn as a matrix, a column at a time.
        f[32] = m00; f[33] = m10; f[34] = m20; f[35] = lamps ? lamps[1] : 0
        f[36] = m01; f[37] = m11; f[38] = m21; f[39] = lamps ? lamps[2] : 0
        f[40] = m02; f[41] = m12; f[42] = m22; f[43] = lamps ? lamps[3] : 0
        f[44] = smooth ? 1 : 0
        f[45] = mirrors ? 1 : 0
        f[46] = (piece.deform?.front ?? 0) >= 2 ? 1 : 0
        f[47] = 0
        packDeformUniforms(piece.deform, f, DEFORM_AT)
        const cracks = piece.cracks, gc = piece.deform?.glassCrack
        for (let k = 0; k < 4; k++) {
          const c = cracks?.[k], strength = gc ? gc[k] : 0, o = CRACKS_AT + k * 4
          if (c && strength > 0) { f[o] = c[0]; f[o + 1] = c[1]; f[o + 2] = c[2]; f[o + 3] = strength }
          else { f[o] = 0; f[o + 1] = 0; f[o + 2] = 0; f[o + 3] = 0 }
        }
        // (Copied when called: one block serves every piece.)
        device.queue.writeBuffer(piece.uniforms, 0, block)
        const faces = facesOf(piece)
        visible.push({ piece, faces })
        pass.setBindGroup(0, piece.bind)
        pass.setVertexBuffer(0, faces.faces)
        // The solid faces.
        if (faces.count > faces.glass) pass.draw(4, faces.count - faces.glass)
      }
      // The glass of those that have any: what is behind it tinted, then what it adds of itself. With mirrors off
      // it is still seen through (#74): a pale face there was a car's every window opaque from its own seat.
      for (const panes of mirrors ? [tint, glint] : [tint]) {
        pass.setPipeline(panes)
        for (let i = 0; i < visible.length; i++) {
          const { piece, faces } = visible[i]
          if (!faces.glass) continue
          pass.setBindGroup(0, piece.bind)
          pass.setVertexBuffer(0, faces.faces)
          pass.draw(4, faces.glass, 0, faces.count - faces.glass)
        }
      }
      pass.end()
    },
    emitLights(sink) {
      if (!live.size || sink.dark <= 0.02) return
      const darkScale = Math.min(1, sink.dark * 1.35)
      const isLow = sink.quality === 'low'
      const maxReach = sink.quality === 'high' ? 1050 : sink.quality === 'medium' ? 750 : 450
      const maxReach2 = maxReach * maxReach
      for (const piece of live) {
        if (!piece.cell || !piece.count || piece.ghost) continue
        // Vehicles with dynamic `piece.lamps` are emitted explicitly with full dual-lobe optics by street.ts / living.ts.
        if (piece.lamps && piece.lamps[3] !== 0) continue
        const emitters = emittersOf(piece.born)
        if (!emitters.length) continue
        const dx0 = piece.pos[0] - sink.eyeX, dy0 = piece.pos[1] - sink.eyeY, dz0 = piece.pos[2] - sink.eyeZ
        if (dx0 * dx0 + dy0 * dy0 + dz0 * dz0 > maxReach2) continue
        const [x, y, z, w] = piece.rot, b = piece.born, cell = piece.cell
        const m00 = 1 - 2 * (y * y + z * z), m10 = 2 * (x * y + z * w), m20 = 2 * (x * z - y * w)
        const m01 = 2 * (x * y - z * w), m11 = 1 - 2 * (x * x + z * z), m21 = 2 * (y * z + x * w)
        const m02 = 2 * (x * z + y * w), m12 = 2 * (y * z - x * w), m22 = 1 - 2 * (x * x + y * y)
        const cell2 = cell * cell
        const px0 = piece.pos[0], py0 = piece.pos[1], pz0 = piece.pos[2]
        const com0 = b.com[0], com1 = b.com[1], com2 = b.com[2]
        for (let i = 0; i < emitters.length; i++) {
          const e = emitters[i]
          const areaW = e.area * cell2
          // On Low preset, skip small accent beacons (e.g. spinning LiDAR domes) to preserve budget for headlights/street lamps.
          if (isLow && areaW < 12) continue
          const ox = (e.lx - com0) * cell, oy = (e.ly - com1) * cell, oz = (e.lz - com2) * cell
          const wx = px0 + m00 * ox + m01 * oy + m02 * oz
          const wy = py0 + m10 * ox + m11 * oy + m12 * oz
          const wz = pz0 + m20 * ox + m21 * oy + m22 * oz
          const rad = Math.sqrt(Math.max(areaW, 0.5))
          const power = Math.min(2.35, Math.max(1.45, 1.35 + Math.log2(1 + areaW) * 0.26)) * darkScale
          const cr = e.r * power, cg = e.g * power, cb = e.b * power
          if (e.directional) {
            let dnx = m00 * e.nx + m01 * e.ny + m02 * e.nz
            let dny = m10 * e.nx + m11 * e.ny + m12 * e.nz
            let dnz = m20 * e.nx + m21 * e.ny + m22 * e.nz
            // Horizontally aimed directional lamps (traffic signals, rotating LiDAR apertures, signs) tilt gently downward so
            // their cone splashes naturally onto crosswalks, car hoods, and pedestrians below.
            const horiz = Math.abs(dny) < 0.35
            if (horiz) dny -= 0.22
            const range = Math.min(210, Math.max(78, (horiz && e.vivid ? 95 : 58) + rad * 24))
            const dHalf = range * 0.34
            const cosOuter = horiz ? (areaW < 3 ? 0.42 : 0.14) : -0.05
            const cosInner = horiz ? (areaW < 3 ? 0.88 : 0.72) : 0.58
            const prio = areaW >= 18 ? 60 : e.vivid ? 52 : 46
            sink.addSpot(wx, wy, wz, dnx, dny, dnz, cr, cg, cb, range, dHalf, cosOuter, cosInner, 0.25, 0.0, 1.05, prio, LIGHT_EXTRA)
          } else {
            // Omnidirectional emitters (spinning robotaxi LiDAR dome rings, active charging bay halos, glowing orbs/lanterns).
            const range = Math.min(145, Math.max(68, 52 + rad * 18))
            const dHalf = range * 0.33
            const prio = e.vivid ? 54 : 48
            sink.addPoint(wx, wy, wz, cr, cg, cb, range, dHalf, 1.0, prio, LIGHT_EXTRA)
          }
        }
      }
    },
  }
}
