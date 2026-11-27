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
// its paint is scuffed to primer and bare steel in them, and its glass cracks near them. Only a struck piece pays for it:
// it draws from a copy of its faces split into rows a cell long, so every corner lies on the cells' lattice and faces
// that meet still meet once bent (a merged row bent at its two ends only would open a gap beside its neighbours).
import type { CrashOpening } from './crash-opening.ts'
import { shader, type Target } from '../probe/gpu.ts'
import { DEFORM_BYTES, DEFORM_STRUCT, DEFORM_WGSL, packDeformUniforms, type DeformState } from './deform.ts'
import { GLASS, GLOBALS, LIGHT, PAINT, SUNLIT, type Marcher, type View } from './march.ts'
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
@group(1) @binding(0) var<uniform> g: Globals;
@group(1) @binding(1) var sunMap: texture_2d_array<f32>;
// Where the march looked through a pane of the world's glass: what it lets through, and how far off it is (march.ts panes).
@group(1) @binding(2) var panes: texture_2d<f32>;
${SUNLIT}
${LIGHT}
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
  let cu = f32(v & 1u);
  let cv = f32((v >> 1u) & 1u);
  var p = start;
  var n = vec3f(0.0);
  if (axis == 1u) { p += vec3f(cu * long, side, cv); n = vec3f(0.0, side * 2.0 - 1.0, 0.0); }
  else if (axis == 2u) { p += vec3f(cu * long, cv, side); n = vec3f(0.0, 0.0, side * 2.0 - 1.0); }
  else { p += vec3f(side, cv, cu * long); n = vec3f(side * 2.0 - 1.0, 0.0, 0.0); }
  let turned = mat3x3f(u.c0, u.c1, u.c2);
  var out: Out;
  out.open = 1.0;
  // (Only on things finer than the world's cells: the core's bodies, a held block of the world, stay as they were.)
  let word = words[v & 3u];
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
  var direct = max(dot(n, u.sun), 0.0);
  if (direct > 0.0) {
    // In the world's shadow where the sun's maps say so; where they cannot say, in the sun. (Read by the square normal:
    // the maps are offset along it, and a smooth one along a stair would read them inside the step.)
    let sunny = sunlit(in.seen + u.eye, in.facing, 0u);
    if (sunny >= 0.0) { direct *= sunny; }
  }
  let dynLamp = stuff == 15u && u.lampAxis != 0.0;
  var col = shade(albedo, n, rd, u.sun, direct, open, select(rough, 0.18, dynLamp), select(m.glow * (1.0 - brokenLamp), 0.0, dynLamp));
  if (dynLamp) { col += vehicleLamp(in, albedo) * (1.0 - brokenLamp); }
  if (polished) { col = mix(col, select(carPaint(col, in.facing, rd, direct), clearCoat(col, albedo, n, rd, direct, open), soft), coat); }
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
  readonly count: number
  /** How many faces are drawn a frame. */
  readonly faces: number
  /** Whether faces with smooth words are lit by them (#38); off draws every face by its square normal. */
  smooth: boolean
}

/** A piece's own numbers (struct U): twelve rows of four, its dents, then four per-window crack origins. */
const OWN = 192, DEFORM_AT = OWN / 4, CRACKS_BYTES = 16 * 4, CRACKS_AT = (OWN + DEFORM_BYTES) / 4, UNIFORMS = OWN + DEFORM_BYTES + CRACKS_BYTES

/**
 * A look's faces as the GPU takes them, six words a face: the solid ones first, then the glass, each with its corners'
 * smooth words (#38), 0 where it has none. `unit`: every row cut into faces a cell long (#37), for a piece that is bent;
 * a row of smooth faces is merged only where its corners' words are alike, so each piece of it keeps its first ones and
 * the last keeps the row's last.
 */
function sortFaces(born: Born, unit: boolean, openings: readonly CrashOpening[]) {
  const all = born.faces, smooth = born.smooth, total = all.length / 2
  let size = total
  if (unit) { size = 0; for (let f = 0; f < total; f++) size += (all[f * 2 + 1] & 255) || 1 }
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
      const long = unit ? (b & 255) || 1 : 1, axis = (b >>> 8) & 3
      for (let k = 0; k < long; k++) {
        // Along x for faces that look along y or z, along z for those that look along x (pieces.ts `vs`).
        const start = axis === 0 ? a + (k << 20) : a + k
        if (openings[0]?.removed.has(start) || openings[1]?.removed.has(start)) continue
        sorted[at * 6] = start >>> 0; sorted[at * 6 + 1] = unit ? ((b & ~255) | 1) >>> 0 : b
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
  return { sorted, count: at, glass }
}

export async function pieces(device: GPUDevice, format: GPUTextureFormat, march: Marcher): Promise<Pieces> {
  const looks = march.looks
  const module = await shader(device, 'pieces', CODE)
  // One layout for the solid faces and the glass, so a piece's bindings serve all three pipelines.
  const both = GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT
  const own = device.createBindGroupLayout({ entries: [{ binding: 0, visibility: both, buffer: {} }, { binding: 1, visibility: both, buffer: {} }] })
  const shared = device.createBindGroupLayout({ entries: [{ binding: 0, visibility: both, buffer: {} }, { binding: 1, visibility: both, texture: { sampleType: 'unfilterable-float', viewDimension: '2d-array' } }, { binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'unfilterable-float' } }] })
  const layout = device.createPipelineLayout({ bindGroupLayouts: [own, shared] })
  const drawn = (entryPoint: string, glass?: GPUBlendComponent) => device.createRenderPipelineAsync({
    label: `pieces ${entryPoint}`, layout,
    vertex: { module, entryPoint: 'vs', buffers: [{ arrayStride: 24, stepMode: 'instance', attributes: [{ shaderLocation: 0, offset: 0, format: 'uint32' }, { shaderLocation: 1, offset: 4, format: 'uint32' }, { shaderLocation: 2, offset: 8, format: 'uint32x4' }] }] },
    fragment: { module, entryPoint, targets: [{ format, ...(glass ? { blend: { color: glass, alpha: { srcFactor: 'zero', dstFactor: 'one', operation: 'add' } } } : {}) }] },
    primitive: { topology: 'triangle-strip', cullMode: 'none' },
    // The glass after everything solid, read against its depth and not written to it.
    depthStencil: { format: 'depth24plus', depthWriteEnabled: !glass, depthCompare: 'less' },
  })
  const [pipeline, tint, glint] = await Promise.all([drawn('fs'), drawn('fs_tint', { srcFactor: 'zero', dstFactor: 'src', operation: 'add' }), drawn('fs_glint', { srcFactor: 'one', dstFactor: 'one', operation: 'add' })])
  let lit: { panes: GPUTextureView; group: GPUBindGroup } | null = null
  const litFor = (panes: GPUTextureView) => {
    if (lit?.panes !== panes) lit = { panes, group: device.createBindGroup({ layout: shared, entries: [{ binding: 0, resource: { buffer: march.globals } }, { binding: 1, resource: march.sun.all }, { binding: 2, resource: panes }] }) }
    return lit.group
  }
  /** count: all its faces; glass: how many of them, the last ones, are glass; held: its faces' buffer, and how many pieces draw from it. */
  interface Faces { faces: GPUBuffer; count: number; glass: number }
  /** unit: the same faces a cell long, made the first time one of its pieces is drawn bent (#37). */
  interface Shared extends Faces { users: number; unit?: Faces }
  interface Held extends Piece {
    tear?: { state: DeformState; revision: number; opening?: CrashOpening }
    pocket?: { nose?: CrashOpening; fender?: CrashOpening; mesh: Faces }
    faces: GPUBuffer
    uniforms: GPUBuffer
    bind: GPUBindGroup
    count: number
    glass: number
    held: Shared
  }
  /** A look's faces on the GPU: the solid ones first, then the glass, each with its corners' smooth words. */
  const upload = (born: Born, unit = false, openings: readonly CrashOpening[] = []): Faces => {
    const { sorted, count, glass } = sortFaces(born, unit, openings)
    const faces = device.createBuffer({ label: openings.length ? 'torn body mesh' : 'piece faces', size: Math.max(24, sorted.byteLength), usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST })
    device.queue.writeBuffer(faces, 0, sorted)
    return { faces, count, glass }
  }
  const release = (held: Shared) => { held.faces.destroy(); held.unit?.faces.destroy() }
  /** The faces a piece is drawn from now: a cell long once it is bent. */
  const facesOf = (piece: Held): Faces => {
    const state = piece.deform
    const nose = state?.dentCount && state.hoodDamage >= 0.35 ? piece.opening : undefined
    if (piece.pocket && piece.pocket.nose !== nose) {
      piece.pocket.mesh.faces.destroy()
      piece.pocket = undefined
    }
    if (!state?.dentCount) { piece.tear = undefined; return piece }
    if (nose) {
      if (!piece.pocket) {
        piece.pocket = { nose, mesh: upload(piece.born, true, [nose]) }
      }
      return piece.pocket.mesh
    }
    return piece.held.unit ??= upload(piece.born, true)
  }

  const live = new Set<Held>()
  /** Faces already on the GPU, by the array they came from: many pieces of one look (the street's cars, #450) draw from one buffer. */
  const common = new WeakMap<Uint32Array, Shared>()
  let smooth = true
  return {
    get smooth() { return smooth },
    set smooth(on: boolean) { smooth = on },
    get count() { return live.size },
    get faces() { let n = 0; for (const p of live) n += (p.deform?.dentCount ? p.pocket?.mesh ?? p.held.unit ?? p : p).count; return n },
    add(born, share = false) {
      let made = share ? common.get(born.faces) : undefined
      if (!made) {
        made = { ...upload(born), users: 0 }
        if (share) common.set(born.faces, made)
      }
      made.users++
      const held = made, uniforms = device.createBuffer({ size: UNIFORMS, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST })
      const bind = device.createBindGroup({ layout: own, entries: [{ binding: 0, resource: { buffer: uniforms } }, { binding: 1, resource: { buffer: looks } }] })
      const piece: Held = { born, pos: [born.low[0] + born.com[0], born.low[1] + born.com[1], born.low[2] + born.com[2]], rot: [0, 0, 0, 1], cell: 1, faces: held.faces, uniforms, bind, count: held.count, glass: held.glass, held, destroy() { if (!live.delete(piece)) return; uniforms.destroy(); piece.pocket?.mesh.faces.destroy(); if (--piece.held.users === 0) { release(piece.held); if (common.get(piece.born.faces) === piece.held) common.delete(piece.born.faces) } } }
      live.add(piece)
      return piece
    },
    refit(p, faces, smooth) {
      const piece = p as Held
      if (!live.has(piece) || piece.held.users !== 1 || common.get(piece.born.faces) === piece.held) return
      release(piece.held)
      piece.pocket?.mesh.faces.destroy(); piece.pocket = undefined
      piece.born.faces = faces
      piece.born.smooth = smooth
      piece.held = { ...upload(piece.born), users: 1 }
      piece.faces = piece.held.faces; piece.count = piece.held.count; piece.glass = piece.held.glass
    },
    draw(encoder, to, view, sun, timing, mirrors = true) {
      if (!live.size) return
      const anchor = view.eye.map((e) => Math.floor(e / 64) * 64)
      const block = new ArrayBuffer(UNIFORMS), f = new Float32Array(block), i32 = new Int32Array(block)
      f.set([view.eye[0] - anchor[0], view.eye[1] - anchor[1], view.eye[2] - anchor[2], view.tanHalf, ...view.right, to.size[0] / to.size[1], ...view.up, 0, ...view.forward, 0, ...sun, 0])
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
        const [x, y, z, w] = piece.rot, b = piece.born, lamps = piece.lamps
        f[11] = b.size[0] * 0.5
        f[15] = b.size[1] * 0.5
        f[19] = b.size[2] * 0.5
        f.set([piece.pos[0] - anchor[0], piece.pos[1] - anchor[1], piece.pos[2] - anchor[2], piece.cell], 20)
        i32.set(b.low, 24)
        i32[27] = piece.ghost ? 1 : 0
        f.set(b.com, 28)
        f[31] = lamps ? lamps[0] : 0
        // The turn as a matrix, a column at a time.
        f.set([1 - 2 * (y * y + z * z), 2 * (x * y + z * w), 2 * (x * z - y * w)], 32)
        f[35] = lamps ? lamps[1] : 0
        f.set([2 * (x * y - z * w), 1 - 2 * (x * x + z * z), 2 * (y * z + x * w)], 36)
        f[39] = lamps ? lamps[2] : 0
        f.set([2 * (x * z + y * w), 2 * (y * z - x * w), 1 - 2 * (x * x + y * y)], 40)
        f[43] = lamps ? lamps[3] : 0
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
        pass.setBindGroup(0, piece.bind)
        pass.setVertexBuffer(0, faces.faces)
        // The solid faces.
        pass.draw(4, faces.count - faces.glass)
      }
      // The glass of those that have any: what is behind it tinted, then what it adds of itself. With mirrors off
      // it is still seen through (#74): a pale face there was a car's every window opaque from its own seat.
      for (const panes of mirrors ? [tint, glint] : [tint]) {
        pass.setPipeline(panes)
        for (const piece of live) {
          if (!piece.glass || !piece.cell) continue
          const faces = facesOf(piece)
          pass.setBindGroup(0, piece.bind)
          pass.setVertexBuffer(0, faces.faces)
          pass.draw(4, faces.glass, 0, faces.count - faces.glass)
        }
      }
      pass.end()
    },
  }
}
