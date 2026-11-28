// The last pass (#163, #165): Linear HDR bloom (Karis-averaged luminance extraction into persistent
// quarter/sixteenth float targets) + Troy Sobotka AgX post-tonemapping + lens vignette, grade, tint, and rain.
// Backing bloom targets grow-only so dynamic resolution (`steer`) causes zero GPU texture reallocations.
//
// The spells' own finishing (#226, after Small Magic's page.js, MIT): what the Cleave, a blast, a singularity and
// stopped time do to the whole picture (`PostFx`). It is a second shader module and pipeline, used only in a frame
// some effect is on: with none, or with no `fx` given, the plain pass below draws exactly as it always has.
import { shader, type Gpu, type Offscreen, GLOWS_OVER, NEAR, FAR } from '../probe/gpu.ts'
import type { View } from './march.ts'

/** Diagnostic tonemap override: `?tonemap=aces` selects Narkowicz ACES; default is AgX. */
const TONEMAP_ACES = typeof location !== 'undefined' && new URLSearchParams(location.search).get('tonemap') === 'aces'
/** Base scene exposure before AgX tonemapping: keeps midday asphalt/shadows deep while holding sunlit whites & clouds crisp. */
const DAY_EXPOSURE = 1.08
const NIGHT_EXPOSURE = 0.70

/** What every pass of this file starts with: the picture, the uniforms, the triangle that covers the view. */
const HEAD = /* wgsl */ `@group(0) @binding(0) var picture: texture_2d<f32>;
@group(0) @binding(1) var smooth_: sampler;
@group(0) @binding(2) var spread: texture_2d<f32>;
struct U {
  step: vec2f,      // texel step (in bright/blur/down), or grade (sat, contrast) in last
  strength: f32,    // night factor in bright, bloom gain in plain/last
  pad: f32,         // drive energy (0..1) in last
  tint: vec4f,      // rgb realm tint, a = drift (-1..1) in last
  uvMax: vec2f,     // active sub-rect UV extent of picture
  uvClamp: vec2f,   // max safe sample UV inside picture's active sub-rect
  spreadMax: vec2f, // active sub-rect UV extent of spread (last)
  extra: vec2f,     // x = tonemap mode (0=AgX, 1=ACES), y = exposure
}
@group(0) @binding(3) var<uniform> u: U;
struct Out { @builtin(position) pos: vec4f, @location(0) uv: vec2f }
@vertex fn vs(@builtin(vertex_index) i: u32) -> Out {
  let p = vec2f(f32((i << 1u) & 2u), f32(i & 2u));
  var out: Out;
  out.pos = vec4f(p * 2.0 - 1.0, 0.5, 1.0);
  out.uv = vec2f(p.x, 1.0 - p.y);
  return out;
}

fn luma(c: vec3f) -> f32 { return dot(c, vec3f(0.2126, 0.7152, 0.0722)); }

`

/** From linear light to what a screen shows. */
const TONE = /* wgsl */ `// Troy Sobotka's AgX (fast 6th-order polynomial sigmoid with inset/outset matrices and subtle punchy look).
// Output is already sRGB display-encoded [0..1] (ready for bgra8unorm swapchain).
const AGX_INSET = mat3x3f(
  vec3f(0.842479062253094,  0.0423282422610123, 0.0423756549057051),
  vec3f(0.0784335999999992, 0.878468636469772,  0.0784336),
  vec3f(0.0792237451477643, 0.0791661274605434, 0.879142973793104)
);
const AGX_OUTSET = mat3x3f(
  vec3f( 1.19687900512017,   -0.0528968517574562, -0.0529716355144438),
  vec3f(-0.0980208811401368,  1.15190312990417,   -0.0980434501171241),
  vec3f(-0.0990297440797205, -0.0989611768448433,  1.15107367264116)
);
fn agxDefaultContrastApprox(x: vec3f) -> vec3f {
  let x2 = x * x;
  let x4 = x2 * x2;
  return 15.5 * x4 * x2
    - 40.14 * x4 * x
    + 31.96 * x4
    - 6.868 * x2 * x
    + 0.4298 * x2
    + 0.1191 * x
    - 0.00232;
}
fn agxLook(val: vec3f) -> vec3f {
  // Neutral-saturation AgX CDL look (slope 1.015, power 1.56, sat 1.00): deepens the dark shadow toe and asphalt
  // while leaving hour-dependent grade as the single saturation control (no double-saturation).
  return pow(max(val * 1.015, vec3f(0.0)), vec3f(1.56));
}
fn tonemapAgX(color: vec3f) -> vec3f {
  let minEv = -12.47393;
  let maxEv = 4.026069;
  var val = AGX_INSET * max(color, vec3f(0.0));
  val = clamp(log2(max(val, vec3f(1e-10))), vec3f(minEv), vec3f(maxEv));
  val = (val - minEv) / (maxEv - minEv);
  val = agxDefaultContrastApprox(val);
  val = agxLook(val);
  val = AGX_OUTSET * val;
  return clamp(val, vec3f(0.0), vec3f(1.0));
}
fn tonemapAces(color: vec3f) -> vec3f {
  let x = max(color, vec3f(0.0));
  let y = clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), vec3f(0.0), vec3f(1.0));
  return pow(y, vec3f(0.4545));
}

`

const codeOf = (useF16: boolean) => /* wgsl */ `${useF16 ? 'enable f16;\n' : ''}
${HEAD}// Soft-knee bloom extraction in exposed linear HDR space.
fn softBloom(c: vec3f, threshold: f32, knee: f32) -> vec3f {
  let br = max(c.r, max(c.g, c.b));
  let soft = clamp(br - threshold + knee, 0.0, 2.0 * knee);
  let rq = (soft * soft) / max(4.0 * knee, 1e-5);
  let contrib = max(rq, br - threshold) / max(br, 1e-5);
  return c * contrib;
}

// Karis-averaged 4-tap downsample from Linear HDR scene: extracts luminance > threshold with 1 / (1 + luma)
// weighting to suppress sub-pixel specular/lamp firefly flicker.
@fragment fn bright(in: Out) -> @location(0) vec4f {
  let base = in.uv * u.uvMax;
  let lo = u.step * 0.5;
  let hi = max(lo, u.uvClamp);
  let exposure = u.extra.y;
  let nightMask = min(u.strength * 1.45, 1.0);
  let threshold = mix(${GLOWS_OVER.toFixed(2)} * 2.35, 1.10, nightMask);
  let knee = 0.35;
  var sum = vec3f(0.0);
  var wSum = 0.0;
  for (var k = 0; k < 4; k++) {
    let suv = clamp(base + (vec2f(f32(k & 1), f32(k >> 1)) - 0.5) * u.step * 2.0, lo, hi);
    let raw = max(textureSampleLevel(picture, smooth_, suv, 0.0).rgb, vec3f(0.0));
    let exposed = min(raw * exposure, vec3f(20.0));
    let rawBloom = softBloom(exposed, threshold, knee);
    let b = rawBloom / (1.0 + luma(rawBloom) * 0.05);
    let w = 1.0 / (1.0 + luma(b) * 0.08);
    sum += b * w;
    wSum += w;
  }
  return vec4f(sum / max(wSum, 1e-5), 1.0);
}

// Quarter-size downsample of the bloom pyramid (clamped inside active sub-rect).
@fragment fn down(in: Out) -> @location(0) vec4f {
  let base = in.uv * u.uvMax;
  let lo = u.step * 0.5;
  let hi = max(lo, u.uvClamp);
  ${useF16 ? 'var sum = vec3<f16>(0.0h);' : 'var sum = vec3f(0.0);'}
  for (var k = 0; k < 4; k++) {
    let suv = clamp(base + (vec2f(f32(k & 1), f32(k >> 1)) - 0.5) * u.step * 2.0, lo, hi);
    let c = min(max(textureSampleLevel(picture, smooth_, suv, 0.0).rgb, vec3f(0.0)), vec3f(60000.0));
    ${useF16 ? 'sum += vec3<f16>(c);' : 'sum += c;'}
  }
  return vec4f(vec3f(sum) * 0.25, 1.0);
}

// Upsample/add wide bloom onto near bloom.
@fragment fn plain(in: Out) -> @location(0) vec4f {
  let suv = clamp(in.uv * u.uvMax, vec2f(0.0), u.uvClamp);
  return vec4f(textureSampleLevel(picture, smooth_, suv, 0.0).rgb * u.strength, 1.0);
}

// Separable 9-tap Gaussian blur (5 bilinear taps), clamped inside the active sub-rect so unused texels never bleed.
@fragment fn blur(in: Out) -> @location(0) vec4f {
  let base = in.uv * u.uvMax;
  let lo = abs(u.step) * 0.5;
  let hi = max(lo, u.uvClamp);
  ${useF16
    ? `var sum = vec3<f16>(min(max(textureSampleLevel(picture, smooth_, clamp(base, lo, hi), 0.0).rgb, vec3f(0.0)), vec3f(60000.0))) * 0.227h;
  for (var k = 1; k < 3; k++) {
    let off = u.step * select(3.2308, 1.3846, k == 1);
    let w = select(0.07h, 0.316h, k == 1);
    let a = vec3<f16>(min(max(textureSampleLevel(picture, smooth_, clamp(base + off, lo, hi), 0.0).rgb, vec3f(0.0)), vec3f(60000.0)));
    let b = vec3<f16>(min(max(textureSampleLevel(picture, smooth_, clamp(base - off, lo, hi), 0.0).rgb, vec3f(0.0)), vec3f(60000.0)));
    sum += (a + b) * w;
  }
  return vec4f(vec3f(sum), 1.0);`
    : `var sum = textureSampleLevel(picture, smooth_, clamp(base, lo, hi), 0.0).rgb * 0.227;
  for (var k = 1; k < 3; k++) {
    let off = u.step * select(3.2308, 1.3846, k == 1);
    let w = select(0.07, 0.316, k == 1);
    sum += (textureSampleLevel(picture, smooth_, clamp(base + off, lo, hi), 0.0).rgb + textureSampleLevel(picture, smooth_, clamp(base - off, lo, hi), 0.0).rgb) * w;
  }
  return vec4f(sum, 1.0);`}
}

${TONE}@fragment fn last(in: Out) -> @location(0) vec4f {
  let d = in.uv - 0.5;
  let srcLo = vec2f(0.0005);
  let srcHi = max(srcLo, u.uvClamp);
  let sprHi = max(srcLo, u.spreadMax - vec2f(0.001));
  let baseUv = clamp(in.uv * u.uvMax, srcLo, srcHi);
  var c = max(textureSampleLevel(picture, smooth_, baseUv, 0.0).rgb, vec3f(0.0));

  // High-speed driving lens energy (u.pad = 0..1) and rotational/lateral drift blur (u.tint.a = -1..1).
  let energy = u.pad;
  let drift = u.tint.a;
  let driftMag = abs(drift);
  var blurVec = vec2f(0.0);
  if (energy > 0.001 || driftMag > 0.001) {
    let vp = vec2f(0.5, 0.44);
    let rd = in.uv - vp;
    let carD = (in.uv - vec2f(0.5, 0.72)) / vec2f(0.18, 0.20);
    let carMask = smoothstep(0.52, 1.38, dot(carD, carD));
    let sideRoad = smoothstep(0.45, 0.96, in.uv.y) * smoothstep(0.09, 0.28, abs(in.uv.x - 0.5));
    let radAmt = clamp((smoothstep(0.022, 0.34, dot(rd, rd)) + sideRoad * 0.72) * carMask * energy, 0.0, 1.35);
    let radVec = rd * radAmt * 0.052;
    let driftSign = select(-1.0, 1.0, drift >= 0.0);
    let driftBg = mix(0.65, 1.22, smoothstep(0.84, 0.18, in.uv.y)) * carMask * driftMag;
    let driftDir = vec2f(driftSign, rd.x * 0.14 * driftSign);
    let driftVec = driftDir * driftBg * 0.030;
    blurVec = radVec + driftVec;
    if (dot(blurVec, blurVec) > 1e-7) {
      var acc = c * 0.22;
      var wSum = 0.22;
      for (var k = 1; k <= 8; k++) {
        let t = f32(k) / 8.0;
        let w = (1.0 - t * 0.65) * 0.20;
        let off = blurVec * (t * 1.25 - 0.14);
        let suv = clamp((in.uv - off) * u.uvMax, srcLo, srcHi);
        acc += max(textureSampleLevel(picture, smooth_, suv, 0.0).rgb, vec3f(0.0)) * w;
        wSum += w;
      }
      c = acc / wSum;
      let ca = rd * radAmt * (1.0 - driftMag * 0.85) * 0.0022;
      c.r = mix(c.r, max(textureSampleLevel(picture, smooth_, clamp((in.uv + ca) * u.uvMax, srcLo, srcHi), 0.0).r, 0.0), 0.35);
      c.b = mix(c.b, max(textureSampleLevel(picture, smooth_, clamp((in.uv - ca) * u.uvMax, srcLo, srcHi), 0.0).b, 0.0), 0.35);
    }
  }

  // Expose scene into working HDR space, add linear HDR bloom, then vignette before tonemapping.
  var exposed = c * u.extra.y;
  var bloom = max(textureSampleLevel(spread, smooth_, clamp(in.uv * u.spreadMax, srcLo, sprHi), 0.0).rgb, vec3f(0.0));
  if (driftMag > 0.04 || energy > 0.15) {
    let b1 = max(textureSampleLevel(spread, smooth_, clamp((in.uv - blurVec * 0.55) * u.spreadMax, srcLo, sprHi), 0.0).rgb, vec3f(0.0));
    let b2 = max(textureSampleLevel(spread, smooth_, clamp((in.uv - blurVec * 1.10) * u.spreadMax, srcLo, sprHi), 0.0).rgb, vec3f(0.0));
    bloom = bloom * 0.50 + b1 * 0.32 + b2 * 0.18;
  }
  exposed += bloom * u.strength;
  // Lens vignette in linear space (tightens subtly at high speed/drift).
  exposed *= max(0.0, 1.0 - dot(d, d) * (0.42 + max(energy, driftMag * 0.85) * 0.20));

  // Tonemap linear HDR -> sRGB display space (AgX default, ACES optional via ?tonemap=aces).
  var outCol = select(tonemapAgX(exposed), tonemapAces(exposed), u.extra.x > 0.5);

  // Hour-dependent subtle colour/contrast grade and realm tint.
  outCol = mix(vec3f(dot(outCol, vec3f(0.3, 0.59, 0.11))), outCol, u.step.x);
  outCol = mix(outCol, outCol * outCol * (3.0 - 2.0 * outCol), u.step.y);
  return vec4f(clamp(outCol * u.tint.rgb, vec3f(0.0), vec3f(1.0)), 1.0);
}
`

const FX = /* wgsl */ `
// ── The spells' own finishing (#226): what the Cleave, a blast and stopped time do to the whole picture ──
// Ported from Small Magic (MIT): page.js and sigil.js. Its picture is measured with y up; this pass's uv has y down:
// vUv below is turned once, at the top, and every sample goes through scene().
struct Fx {
  size: vec4f,     // the picture's size in pixels; the depth's active part as a share of its texture
  camF: vec4f,     // forward; tan of half the view's height
  camR: vec4f,     // right; width over height
  camU: vec4f,     // up; 1 if there is depth to read
  cutLine: vec4f,  // the Cleave's line on the picture: its two ends (0 to 1, y up)
  cutFx: vec4f,    // which beat of the instant (0 none, 1 to 4); how far into it; how much of the circle is written; colours parting
  cutDraw: vec4f,  // focus (aimed and drawn); which side of the line is above the cut (1 or -1); the 30 Hz frame; the circle round the view (0 none, 1 written, 2 gold, 3 indigo)
  cutStep: vec4f,  // how far the picture is parted; the pale day after; the rings' size (cells); their age (s, 0 none)
  cutC: vec4f,     // the middle of the cut from the eye (cells); 1 if the ball of glass is wanted
  cutN: vec4f,     // the cut's own sheet (which way it faces)
  cutM: vec4f,     // the way from the eye to the cut's middle
  dome: vec4f,     // where that middle is on the picture
  seamO: vec4f,    // the eye the cut was made from, from this eye (cells); how hot the seam still is
  seamN: vec4f,    // the cut's sheet; the seam's half breadth (cells)
  seamA: vec4f,    // where the stroke began; the angle it spans
  seamB: vec4f,    // across it, in the sheet; how far it reaches (cells)
  doom: vec4f,     // how far the colour is drained; how much what is warm keeps its own; time wound back; how far out the wave of it has gone (9: all)
  doomCol: vec4f,  // what it is drained to; how much of its own colour is kept
  ink: vec4f,      // ink (1, -1, 0); white; a blast's light; unused
  shock: vec4f,    // a blast's ring on the picture: where, how far out (heights of the view), how strong
  hole: vec4f,     // a singularity on the picture: where, how wide its bending, how strongly there
  holeB: vec4f,    // its disc on the picture; how far off it is (cells along the eye's forward); how hard the view is drawn to it; its radius (cells)
}
@group(1) @binding(0) var<uniform> fx: Fx;
@group(1) @binding(1) var depths: texture_depth_2d;
@group(1) @binding(2) var runes: texture_2d<f32>;

const FX_NEAR = ${NEAR.toFixed(1)};
const FX_FAR = ${FAR.toFixed(1)};
const INDIGO = vec3f(0.055, 0.04, 0.12);
const VIOLET = vec3f(0.3, 0.22, 0.5);
const GOLD = vec3f(0.96, 0.84, 0.56);
const LIGHT = vec3f(1.0, 0.97, 0.88);

fn gmod(x: f32, y: f32) -> f32 { return x - y * floor(x / y); }
fn hash2(p: vec2f) -> f32 { return fract(sin(dot(p, vec2f(12.9898, 78.233))) * 43758.5453); }
fn vnoise(x: f32) -> f32 {
  let i = floor(x);
  var f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(hash2(vec2f(i, 1.7)), hash2(vec2f(i + 1.0, 1.7)), f);
}
// The picture at a place (0 to 1, y up), exposed: never off its edge, never off its active part.
fn scene(uv: vec2f) -> vec3f {
  let lo = vec2f(0.0005);
  let q = clamp(vec2f(uv.x, 1.0 - uv.y) * u.uvMax, lo, max(lo, u.uvClamp));
  return max(textureSampleLevel(picture, smooth_, q, 0.0).rgb, vec3f(0.0)) * u.extra.y;
}
// The same, softened by so many levels (the picture has one level only: a few taps round the place stand in for the rest).
fn sceneSoft(uv: vec2f, lod: f32) -> vec3f {
  let c = scene(uv);
  if (lod < 0.05) { return c; }
  let r = (exp2(lod) - 1.0) * 1.3 / fx.size.xy;
  return c * 0.28 + (scene(uv + r) + scene(uv - r) + scene(uv + vec2f(r.x, -r.y)) + scene(uv + vec2f(-r.x, r.y))) * 0.18;
}
// How far off what is seen at a place is, along the eye's forward (cells). With no depth to read, far.
fn depthAt(uv: vec2f) -> f32 {
  if (fx.camU.w < 0.5) { return 1.0e9; }
  let dims = vec2f(textureDimensions(depths)) * fx.size.zw;
  let p = vec2i(clamp(vec2f(uv.x, 1.0 - uv.y) * dims, vec2f(0.0), dims - vec2f(1.0)));
  let d = textureLoad(depths, p, 0);
  return FX_NEAR / max(1.0e-7, 1.0 - d * (FX_FAR - FX_NEAR) / FX_FAR);
}
// The way the eye looks through a place of the picture.
fn rayAt(uv: vec2f) -> vec3f {
  let n = uv * 2.0 - 1.0;
  return normalize(fx.camF.xyz + fx.camR.xyz * (n.x * fx.camF.w * fx.camR.w) + fx.camU.xyz * (n.y * fx.camF.w));
}

// The circle a spell draws (Small Magic's sigil.js): one design, used wherever a spell writes itself. A rune from
// the atlas (8 by 4), a stroke never thinner than can be drawn, and the whole circle written from its rim inward.
fn sgGlyph(id: f32, uv: vec2f) -> f32 {
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) { return 0.0; }
  let g = gmod(floor(id), 32.0);
  return textureSampleLevel(runes, smooth_, (vec2f(gmod(g, 8.0), floor(g / 8.0)) + vec2f(uv.x, 1.0 - uv.y)) / vec2f(8.0, 4.0), 0.0).r;
}
fn sgLine(d: f32, w: f32, px0: f32) -> f32 {
  let px = max(px0, 1.0e-6);
  let ww = max(w, px * 0.75);
  return (1.0 - smoothstep(ww - px * 0.75, ww + px * 0.75, d)) * min(1.0, w / ww);
}
// c: -1 to 1 across the circle. sides: the corners of its figure. turn: how far its parts have turned. written: 0 to 1.
fn sigil(c: vec2f, sides: f32, turn: f32, written: f32, px: f32) -> f32 {
  let r = length(c);
  if (r > 1.0 || written <= 0.0) { return 0.0; }
  let a = atan2(c.y, c.x);
  let seg = 6.2832 / sides;
  var I = sgLine(abs(r - 0.972), 0.02, px) + sgLine(abs(r - 0.9), 0.006, px);
  let ta = (a + turn * 0.3) / 6.2832 * 96.0;
  I += sgLine(abs(fract(ta) - 0.5) / 96.0 * 6.2832 * r, 0.004, px) * step(0.908, r) * step(r, 0.927 + 0.022 * step(gmod(floor(ta), 8.0), 0.5));
  let k1 = (a + turn) / 6.2832 * 22.0;
  I += sgGlyph(floor(k1) * 5.0 + 3.0, vec2f(fract(k1) * 1.16 - 0.08, (r - 0.757) / 0.13));
  I += sgLine(abs(r - 0.742), 0.006, px);
  I += sgLine(abs(r - 0.705), 0.005, px) * step(0.36, fract((a - turn * 0.6) / 6.2832 * 30.0));
  let a2 = a - turn * 0.7;
  let f = floor(a2 / seg + 0.5);
  let al = a2 - f * seg;
  var am = a2 + seg * 0.5;
  am -= floor(am / seg + 0.5) * seg;
  let dR = length(r * vec2f(cos(al), sin(al)) - vec2f(0.66, 0.0));
  let clear = smoothstep(0.088, 0.1, dR) * step(r, 0.672);
  I += sgLine(abs(r * cos(am) - 0.66 * cos(seg * 0.5)), 0.006, px) * clear;
  var star = 9.0;
  var rose = 9.0;
  for (var j = -1; j <= 1; j++) {
    let aj = al + f32(j) * seg;
    let p = r * vec2f(cos(aj), sin(aj));
    if (sides > 3.5) { star = min(star, abs(p.x - 0.66 * cos(seg)) + step(seg, abs(aj)) * 9.0); }
    rose = min(rose, abs(length(p - vec2f(0.33, 0.0)) - 0.33));
  }
  if (sides < 3.5) { star = abs(r * cos(al) - 0.66 * cos(seg * 0.5)); }
  I += sgLine(star, 0.005, px) * clear * 0.9 + sgLine(rose, 0.004, px) * clear * step(0.37, r) * 0.55;
  let q = r * vec2f(cos(al), sin(al)) - vec2f(0.66, 0.0);
  I += sgLine(abs(dR - 0.088), 0.006, px) + sgGlyph(f * 7.0 + 11.0, vec2f(q.y, q.x) / 0.125 + 0.5) * step(dR, 0.08);
  I += sgLine(abs(r - 0.36), 0.007, px) + sgLine(abs(r - 0.335), 0.004, px) + sgLine(abs(r - 0.225), 0.005, px);
  let k2 = (a - turn * 1.3) / 6.2832 * 12.0;
  I += sgGlyph(floor(k2) * 3.0 + 17.0, vec2f(fract(k2) * 1.2 - 0.1, (r - 0.238) / 0.088));
  var a3 = a + turn * 1.1 + seg * 0.5;
  a3 -= floor(a3 / seg + 0.5) * seg;
  I += sgLine(abs(r * cos(a3) - 0.2 * cos(seg * 0.5)), 0.005, px) * step(r, 0.205);
  I += (1.0 - smoothstep(0.035, 0.05, r)) * 1.5 + sgLine(abs(r - 0.085), 0.004, px);
  var zone = 3.0;
  if (r > 0.89) { zone = 0.0; } else if (r > 0.69) { zone = 1.0; } else if (r > 0.345) { zone = 2.0; }
  let pz = clamp(written * 4.6 - zone, 0.0, 1.0);
  let af = fract(a / 6.2832 + 0.27 * zone + 0.5);
  return I * (step(af, pz) + (1.0 - step(1.0, pz)) * step(0.001, pz) * exp(-(af - pz) * (af - pz) * 1600.0) * 2.5);
}
// The rim of that circle alone: its two rings with the marks of a dial between them, its band of runes, and its
// broken ring. c: across the circle; r: how far out (it lies from 0.69 to 1).
fn sgBand(c: vec2f, r: f32, turn: f32, px: f32, rim: f32) -> f32 {
  let a = atan2(c.y, c.x);
  var I = sgLine(abs(r - 0.972), rim, px) + sgLine(abs(r - 0.9), 0.006, px);
  let ta = (a + turn * 0.3) / 6.2832 * 96.0;
  I += sgLine(abs(fract(ta) - 0.5) / 96.0 * 6.2832 * r, 0.004, px) * step(0.908, r) * step(r, 0.927 + 0.022 * step(gmod(floor(ta), 8.0), 0.5));
  let k1 = (a + turn) / 6.2832 * 22.0;
  I += sgGlyph(floor(k1) * 5.0 + 3.0, vec2f(fract(k1) * 1.16 - 0.08, (r - 0.757) / 0.13));
  I += sgLine(abs(r - 0.742), 0.006, px);
  I += sgLine(abs(r - 0.705), 0.005, px) * step(0.36, fract((a - turn * 0.6) / 6.2832 * 30.0));
  return I;
}
// The Cleave's rings lie in the world, round the middle of the cut, each in a sheet of its own (n: which way that
// sheet faces): where the eye's ray through a place of the picture meets it, from the eye, and how far that is from
// the middle (1e4: it does not).
struct Met { r: f32, p: vec3f }
fn cutR(uv: vec2f, n: vec3f) -> Met {
  let dir = rayAt(uv);
  let dn = dot(dir, n);
  if (abs(dn) < 1.0e-5) { return Met(1.0e4, vec3f(0.0)); }
  let t = dot(fx.cutC.xyz, n) / dn;
  if (t <= 0.0) { return Met(1.0e4, vec3f(0.0)); }
  let p = dir * t;
  return Met(length(p - fx.cutC.xyz), p);
}
// How bright a place of the picture is, brought into 0 to 1.5 or so, for finding its edges.
fn tone1(uv: vec2f) -> f32 { let l = luma(scene(uv)); return 1.5 * l / (1.0 + l); }

@fragment fn lastFx(in: Out) -> @location(0) vec4f {
  let vUv = vec2f(in.uv.x, 1.0 - in.uv.y);
  let asp0 = vec2f(fx.camR.w, 1.0);
  let res = fx.size.xy;
  let hasDepth = fx.camU.w > 0.5;
  let zHere = depthAt(vUv);
  let fwd = fx.camF.xyz;
  var at = vUv;

  // A blast's ring in the air bends what is seen through it, and splits its colours a little.
  let sd = (vUv - fx.shock.xy) * asp0;
  let sl = length(sd);
  var bend = 0.0;
  if (fx.shock.w > 0.0) {
    let so = (sl - fx.shock.z) / (0.02 + fx.shock.z * 0.08);
    bend = exp(-so * so) * fx.shock.w;
    at -= (sd / max(sl, 1.0e-4)) / asp0 * bend * 0.035;
  }
  // A singularity has no light of its own: it is seen by what it does to the light from behind it, which is bent
  // round it. What stands nearer the eye than it does is left alone, and from there back the bending comes on by degrees.
  let hd = (vUv - fx.hole.xy) * asp0;
  let hl = length(hd);
  let holeOn = fx.hole.w > 0.0;
  let hback = select(0.0, step(fx.holeB.y, zHere), holeOn);
  if (holeOn && hl > fx.holeB.x) {
    let fall = 1.0 - smoothstep(fx.hole.z * 1.5, fx.hole.z * 6.0, hl);
    let hw = smoothstep(fx.holeB.y - 2.4 * fx.holeB.w, fx.holeB.y + 0.3 * fx.holeB.w, zHere);
    at = clamp(fx.hole.xy + hd * (1.0 - (fx.hole.z * fx.hole.z) / (hl * hl) * fall * fx.hole.w * hw) / asp0, vec2f(0.001), vec2f(0.999));
  }

  // The Cleave's line on the picture, and this place from its first end.
  let cAB = (fx.cutLine.zw - fx.cutLine.xy) * asp0;
  let cP = (vUv - fx.cutLine.xy) * asp0;
  let beat = fx.cutFx.x;
  let frame = fx.cutDraw.z;

  // After the cut: rings go out in the cut's own sheet, round its middle, each turned a little about the line of
  // the cut (as rings round a planet seen nearly from their own level); through them a ball of glass that bends all
  // that is seen through it and splits its colours. They are out in the world: whatever stands nearer hides them.
  var cutGold = 0.0;
  var cutBand = 0.0;
  var cutWave = 0.0;
  var cGap = 0.0;
  var domeRim = 0.0;
  var domeIn = 0.0;
  var cutSplitK = 0.16;
  var cutDisp = vec2f(0.0);
  let age = fx.cutStep.w;
  if (age > 0.0) {
    let ce = 0.003;
    let Dd = max(fx.cutStep.z, 60.0);
    // (they are there all at once, and for three frames all but still: only then do they burst outward, the glass with them)
    let cHold = 0.1;
    let bu = max(age - cHold, 0.0);
    let pop = 1.0 + 0.07 * min(age / cHold, 1.0);
    let kN = fx.cutN.xyz;
    let kM = fx.cutM.xyz;
    let kA = normalize(cross(kN, kM));
    if (bu > 0.0001 && fx.cutC.w > 0.5) {
      let dist = max(length(fx.cutC.xyz), 5.0);
      let dC = fx.cutC.xyz / dist;
      let dir = rayAt(vUv);
      let Rs = Dd * (0.3 + 7.5 * bu);
      let dv = (vUv - fx.dome.xy) * asp0;
      let dl = max(length(dv), 1.0e-4);
      let dn = dv / dl / asp0;
      if (Rs < dist) {
        let sa = Rs / dist;
        let ct = dot(dir, dC);
        var rho = 9.0;
        if (ct > 0.0) { rho = sqrt(max(1.0 - ct * ct, 0.0)) / sa; }
        if (rho < 1.0) {
          // (as it comes to fill the view its middle is drawn less large, or the whole picture would leap)
          let m0 = mix(0.58, 0.86, smoothstep(0.45, 1.0, sa));
          let m = m0 + (1.0 - m0) * rho * rho;
          let facet = (vnoise(atan2(dv.y, dv.x) * 9.0 + 3.0) - 0.5) * 0.36 * rho * (1.0 - rho);
          let rim = smoothstep(0.76, 0.96, rho) * (1.0 - smoothstep(0.96, 1.0, rho));
          cutDisp = (vUv - fx.dome.xy) * (1.0 - m) + dn * (facet * 0.12 - rim * 0.05);
          cutWave = 0.3 + 0.7 * rim;
          cutSplitK = 0.05 + 0.3 * rim;
          domeRim = smoothstep(0.93, 0.985, rho) * (1.0 - smoothstep(0.985, 1.0, rho)) * 0.5;
          domeIn = 1.0 - rho * rho;
        } else { cutDisp = -dn * 0.012 * exp(-(rho - 1.0) * 9.0); }
      } else {
        // (it has passed over the eye: the whole picture shudders, its colours parting toward its edges, and is still)
        let tw = bu - max((dist / Dd - 0.3) / 7.5, 0.0);
        let k = exp(-tw * 15.0);
        if (k > 0.01) {
          cutDisp = dn * 0.022 * k * sin(dl * 24.0 - tw * 90.0);
          cutWave = k * (0.35 + 1.3 * smoothstep(0.15, 0.9, dl));
          cutSplitK = 0.1 + 0.5 * smoothstep(0.25, 0.9, dl);
        }
      }
      // (never so far as to look off the edge of the picture: there it is turned back, as in a mirror)
      at -= cutDisp;
      at = 1.0 - abs(1.0 - abs(at));
    }
    // three of the circle's rims, one inside another, turning against each other, each at its own slant about the cut
    for (var i = 0; i < 3; i++) {
      let fi = f32(i);
      var tip = 0.06;
      if (i == 0) { tip = 0.2; } else if (i == 1) { tip = -0.13; }
      let Ni = normalize(kN * cos(tip) - kM * sin(tip));
      let h0 = cutR(vUv, Ni);
      let h1 = cutR(vUv + vec2f(ce, 0.0), Ni);
      let h2 = cutR(vUv + vec2f(0.0, ce), Ni);
      if (h0.r > 1.0e3 || h1.r > 1.0e3 || h2.r > 1.0e3) { continue; }
      let Ri = Dd * ((0.52 - 0.12 * fi) * pop + (7.4 - 2.2 * fi) * bu);
      let rn = h0.r / Ri;
      if (rn < 0.6 || rn > 1.03) { continue; }
      let gl = max(length(vec2f(h1.r - h0.r, h2.r - h0.r)) / ce, 1.0e-4);
      let rz = dot(h0.p, fwd);
      let seen = smoothstep(rz - 9.0, rz - 1.5, zHere);
      let rel = h0.p - fx.cutC.xyz;
      let cc = vec2f(dot(rel, kA), dot(rel, cross(Ni, kA)));
      let fadeI = smoothstep(0.0, 0.012, age) * (1.0 - smoothstep(0.85, 2.3, Ri / Dd)) * (1.0 - smoothstep(0.2, 0.4, bu)) * seen;
      let turn = (age * 5.0 + fi * 2.1) * select(1.0, -1.0, i == 1);
      cutGold = max(cutGold, sgBand(cc / Ri, rn, turn, gl / (res.y * Ri), 0.008) * fadeI * 0.92);
      // (a band of shade under each, broad, and broader for the outermost: ink laid on with the flat of the brush)
      cutBand = max(cutBand, smoothstep(0.6, 0.7, rn) * (1.0 - smoothstep(0.99, 1.03, rn)) * fadeI * select(0.7, 0.95, i == 0));
    }
    // and thin rings of light after them, broken, close about the cut on either side of it: far out they lie along it
    for (var i = 0; i < 5; i++) {
      let fi = f32(i);
      let h1r = hash2(vec2f(fi, 9.0));
      let h2r = hash2(vec2f(fi, 4.0));
      var tip = 0.15;
      if (i == 0) { tip = 0.035; } else if (i == 1) { tip = -0.06; } else if (i == 2) { tip = 0.095; } else if (i == 3) { tip = -0.028; }
      let Ni = normalize(kN * cos(tip) - kM * sin(tip));
      let h0 = cutR(vUv, Ni);
      let h1 = cutR(vUv + vec2f(ce, 0.0), Ni);
      let h2 = cutR(vUv + vec2f(0.0, ce), Ni);
      if (h0.r > 1.0e3 || h1.r > 1.0e3 || h2.r > 1.0e3) { continue; }
      let gl = max(length(vec2f(h1.r - h0.r, h2.r - h0.r)) / ce, 1.0e-4);
      let rz = dot(h0.p, fwd);
      let seen = smoothstep(rz - 9.0, rz - 1.5, zHere);
      let rel = h0.p - fx.cutC.xyz;
      let ang = atan2(dot(rel, cross(Ni, kA)), dot(rel, kA));
      let Ri = Dd * ((0.2 + 0.085 * fi) * pop + (8.6 - 1.5 * fi) * (0.85 + 0.3 * h1r) * bu);
      let px = abs(h0.r - Ri) / gl;
      let wpx = (0.001 + 0.0018 * h2r) * (0.5 + 1.0 * vnoise(ang * (3.0 + fi) + fi * 13.0));
      let gate = smoothstep(0.3, 0.5, vnoise(ang * (1.3 + 0.45 * fi) + fi * 7.3 + age * 2.0));
      let fadeI = smoothstep(0.0, 0.012, age) * (1.0 - smoothstep(1.5, 3.4, Ri / Dd)) * (1.0 - smoothstep(0.2, 0.42, bu)) * seen;
      cutGold = max(cutGold, exp(-(px * px) / (wpx * wpx)) * gate * fadeI * 0.8);
    }
  }

  // While it is aimed and drawn the eye is held on the middle of the view: the view opens wide, as through a wide
  // lens, and toward its edges goes dark and soft, its colours parting. (Dark, not pale: it is the dark that makes the middle shine.)
  let cFocus = fx.cutDraw.x;
  let cEdge = smoothstep(0.26, 0.92, length((vUv - 0.5) * asp0));
  let cLens = cFocus * 0.3;
  if (abs(cLens) > 0.001) {
    let lq = (at - 0.5) * asp0;
    at = 0.5 + lq * (1.0 - cLens * dot(lq, lq)) / (1.0 + cLens * 0.25) / asp0;
  }
  // The instant: the picture itself is cut. What is above the cut is lifted off it, by about as much as it will
  // really have risen by then, and what is below stays; only within the stroke's own length; and only what the cut
  // can reach, so the sky, and whatever stands right before the eye, are left whole.
  let parted = fx.cutStep.x;
  if (parted > 0.0) {
    let ld = normalize(cAB + vec2f(1.0e-5));
    let ln = vec2f(-ld.y, ld.x) * fx.cutDraw.y;
    let side = dot(cP, ln);
    let hh = dot(cP, ld) / max(length(cAB), 1.0e-4);
    let win = 1.0 - smoothstep(0.0, 0.1, max(-hh, hh - 1.0));
    var within = 1.0;
    if (hasDepth) { within = smoothstep(45.0, 65.0, zHere) * (1.0 - smoothstep(850.0, 950.0, zHere)); }
    let lift = 0.024 * parted * win * within;
    if (side > 0.0 && lift > 0.0002) {
      at -= (ln * lift + ld * lift * 0.15) / asp0;
      cGap = 1.0 - smoothstep(lift * 0.7, lift, side);
    }
  }
  // (in the dark of the instant the picture itself is knocked about: each beat it is somewhere else, and a little nearer or further)
  if (beat > 2.5 && beat < 3.5) {
    let jf = floor(frame);
    at += (vec2f(hash2(vec2f(jf, 1.0)), hash2(vec2f(jf, 2.0))) - 0.5) * vec2f(0.016, 0.012);
    at = 0.5 + (at - 0.5) * (1.0 - 0.03 * hash2(vec2f(jf, 3.0)));
  }
  at = clamp(at, vec2f(0.002), vec2f(0.998));
  let cLod = cEdge * cFocus * 2.4;
  var c = sceneSoft(at, cLod);

  // Driving fast, as the plain pass has it: the road drawn out from where it vanishes, and across as the car slides.
  let energy = u.pad;
  let drift = u.tint.a;
  let driftMag = abs(drift);
  var blurVec = vec2f(0.0);
  if (energy > 0.001 || driftMag > 0.001) {
    let rd = in.uv - vec2f(0.5, 0.44);
    let carD = (in.uv - vec2f(0.5, 0.72)) / vec2f(0.18, 0.20);
    let carMask = smoothstep(0.52, 1.38, dot(carD, carD));
    let sideRoad = smoothstep(0.45, 0.96, in.uv.y) * smoothstep(0.09, 0.28, abs(in.uv.x - 0.5));
    let radAmt = clamp((smoothstep(0.022, 0.34, dot(rd, rd)) + sideRoad * 0.72) * carMask * energy, 0.0, 1.35);
    let driftSign = select(-1.0, 1.0, drift >= 0.0);
    let driftBg = mix(0.65, 1.22, 1.0 - smoothstep(0.18, 0.84, in.uv.y)) * carMask * driftMag;
    blurVec = rd * radAmt * 0.052 + vec2f(driftSign, rd.x * 0.14 * driftSign) * driftBg * 0.030;
    if (dot(blurVec, blurVec) > 1.0e-7) {
      // (this pass's own measure has y up: the same smear, turned)
      let bv = vec2f(blurVec.x, -blurVec.y);
      var acc = c * 0.22;
      var wSum = 0.22;
      for (var k = 1; k <= 8; k++) {
        let t = f32(k) / 8.0;
        let w = (1.0 - t * 0.65) * 0.20;
        acc += scene(at - bv * (t * 1.25 - 0.14)) * w;
        wSum += w;
      }
      c = acc / wSum;
    }
  }

  // (the colours part toward the edge of the view: as it is aimed, and as it comes back from the instant)
  let cSplit = fx.cutFx.w + cFocus * cEdge * 2.6;
  if (cSplit > 0.0) {
    let fo = (vUv - 0.5) * min(cSplit, 2.6) * 0.009;
    c.r = sceneSoft(clamp(at + fo, vec2f(0.002), vec2f(0.998)), cLod).r;
    c.b = sceneSoft(clamp(at - fo, vec2f(0.002), vec2f(0.998)), cLod).b;
  }
  if (cFocus > 0.0) {
    c = mix(c, vec3f(luma(c)), cEdge * cFocus * 0.35) * (1.0 - cFocus * 0.86 * pow(cEdge, 1.25));
    c *= 1.0 + 0.1 * cFocus * (1.0 - cEdge);
  }
  if (abs(cutWave) > 0.002) {
    c.r = scene(clamp(1.0 - abs(1.0 - abs(at - cutDisp * cutSplitK)), vec2f(0.002), vec2f(0.998))).r;
    c.b = scene(clamp(1.0 - abs(1.0 - abs(at + cutDisp * cutSplitK)), vec2f(0.002), vec2f(0.998))).b;
    c += (0.5 + 0.5 * cos(6.2832 * (cutWave * 1.6 + vec3f(0.0, 0.33, 0.67)))) * abs(cutWave) * 0.07;
  }
  // (the ball of glass: a little light held in it, and a bright line round its edge)
  if (domeIn + domeRim > 0.0) { c = c * (1.0 + 0.1 * domeIn) + vec3f(1.0, 0.96, 0.86) * domeRim; }
  // (and for a moment after, the day is pale, as if the light had been knocked out of it)
  if (fx.cutStep.y > 0.0) { c = mix(c, vec3f(luma(c)) * 1.1 + vec3f(0.24, 0.2, 0.12), fx.cutStep.y * 0.3); }
  // Time wound back: the colours part, more toward the edge of the view, and the picture is drawn out along the way to its middle.
  if (fx.doom.z > 0.0) {
    let rd = at - 0.5;
    let off = rd * length(rd * asp0) * 0.03 * fx.doom.z;
    var acc = vec3f(0.0);
    for (var i = 0; i < 4; i++) {
      let k = f32(i) / 3.0;
      acc += vec3f(scene(at - off * (0.5 + k)).r, scene(at - off * k * 0.5).g, scene(at + off * (0.4 + k)).b);
    }
    c = mix(c, acc * 0.25, min(1.0, fx.doom.z * 1.4));
  }
  // (a singularity: all that is seen is drawn out toward it)
  if (fx.holeB.z > 0.0 && holeOn) {
    let toward = (fx.hole.xy - at) * fx.holeB.z;
    var acc = c;
    let hj = hash2(in.pos.xy + 3.0);
    for (var i = 0; i < 10; i++) { acc += scene(at + toward * (f32(i) + hj) * 0.1); }
    c = acc / 11.0;
  }
  if (bend > 0.01) { c.r = scene(at - (sd / max(sl, 1.0e-4)) / asp0 * bend * 0.012).r; }

  // The glow of bright things, as the plain pass adds it.
  let srcLo = vec2f(0.0005);
  let sprHi = max(srcLo, u.spreadMax - vec2f(0.001));
  let glowAt = vec2f(at.x, 1.0 - at.y);
  var bloom = max(textureSampleLevel(spread, smooth_, clamp(glowAt * u.spreadMax, srcLo, sprHi), 0.0).rgb, vec3f(0.0));
  if (driftMag > 0.04 || energy > 0.15) {
    let b1 = max(textureSampleLevel(spread, smooth_, clamp((glowAt - blurVec * 0.55) * u.spreadMax, srcLo, sprHi), 0.0).rgb, vec3f(0.0));
    let b2 = max(textureSampleLevel(spread, smooth_, clamp((glowAt - blurVec * 1.10) * u.spreadMax, srcLo, sprHi), 0.0).rgb, vec3f(0.0));
    bloom = bloom * 0.50 + b1 * 0.32 + b2 * 0.18;
  }
  c += bloom * u.strength;

  // The cut's seam, where the sheet of it meets whatever is there: white hot, then gold, cooling. Found from the
  // depth of what is seen: the world's own place, measured from the eye the cut was made from.
  if (fx.seamO.w > 0.001 && hasDepth && zHere < FX_FAR * 0.5) {
    let dir = rayAt(vUv);
    let t = zHere / max(dot(dir, fwd), 1.0e-4);
    let p = dir * t - fx.seamO.xyz;
    let off = abs(dot(p, fx.seamN.xyz));
    let pa = dot(p, fx.seamA.xyz);
    let pb = dot(p, fx.seamB.xyz);
    let ang = atan2(pb, pa);
    let out = length(vec2f(pa, pb));
    // (never thinner than a pixel and a half, however far off)
    let w = max(fx.seamN.w, t * fx.camF.w * 3.0 / res.y);
    let wedge = smoothstep(-0.012, 0.012, ang) * (1.0 - smoothstep(fx.seamA.w - 0.012, fx.seamA.w + 0.012, ang)) * (1.0 - smoothstep(fx.seamB.w * 0.94, fx.seamB.w, out)) * smoothstep(8.0, 30.0, out);
    let hot = exp(-(off * off) / (w * w)) * wedge * fx.seamO.w;
    let halo = exp(-off / (w * 3.5)) * wedge * fx.seamO.w;
    c += vec3f(1.0, 0.66, 0.24) * (2.4 * hot + 0.35 * halo) + vec3f(1.0, 0.96, 0.84) * 2.2 * hot * hot;
  }
  // the hole itself: nothing; with the last light that gets round it as a thin bright ring at its edge
  if (hback > 0.5) {
    let hpx = 1.5 / res.y;
    let ho = (hl - fx.holeB.x * 1.07) / (fx.holeB.x * 0.04 + hpx);
    c *= smoothstep(fx.holeB.x - hpx, fx.holeB.x + hpx, hl);
    c += (vec3f(3.4, 2.9, 2.4) * exp(-ho * ho) + vec3f(0.45, 0.25, 1.0) * exp(-max(hl - fx.holeB.x, 0.0) / (fx.holeB.x * 0.7)) * 0.3 * step(fx.holeB.x, hl)) * fx.hole.w;
  }
  // A great spell being gathered, or time stopped: the colour is drained from everything but what is warm (fire,
  // embers and red flowers keep theirs), out from the middle of the view as a wave when it is new.
  let dl = luma(c);
  let warm = fx.doom.y * smoothstep(0.25, 0.6, (c.r - c.b) / max(c.r, 0.001)) * smoothstep(0.0, 0.25, (c.r - c.g) / max(c.r, 0.001)) * smoothstep(0.015, 0.06, c.r);
  let fromMid = length((vUv - 0.5) * asp0);
  var reached = 1.0;
  if (fx.doom.w < 8.0) { reached = 1.0 - smoothstep(fx.doom.w - 0.2, fx.doom.w, fromMid); }
  c = mix(c, dl * fx.doomCol.rgb + c * fx.doomCol.w, fx.doom.x * (1.0 - smoothstep(1.5, 3.0, dl)) * (1.0 - 0.9 * warm) * reached);
  // (time stopping: the edge of that wave, as it goes out from the middle of the view)
  if (fx.doom.w < 8.0) {
    let wd = (fromMid - fx.doom.w) / 0.018;
    c += vec3f(1.0, 0.85, 0.55) * exp(-wd * wd) * 0.5 * (1.0 - fx.doom.w / 1.5);
  }
  // a blast's light is on everything: shade goes red-brown and the whole of what is seen is lifted toward its orange
  if (fx.ink.z > 0.0) { c = mix(c, c * vec3f(0.55, 0.25, 0.16), min(1.0, fx.ink.z * 1.2) * (1.0 - smoothstep(1.2, 2.6, dl))) + vec3f(1.0, 0.33, 0.08) * min(fx.ink.z, 1.2) * 0.6; }

  // Seen: the lens, the screen's range and the hour's grade, as the plain pass has them.
  let d = in.uv - 0.5;
  c *= max(0.0, 1.0 - dot(d, d) * (0.42 + max(energy, driftMag * 0.85) * 0.20));
  var o = select(tonemapAgX(c), tonemapAces(c), u.extra.x > 0.5);
  o = mix(vec3f(dot(o, vec3f(0.3, 0.59, 0.11))), o, u.step.x);
  o = mix(o, o * o * (3.0 - 2.0 * o), u.step.y);

  // The instant a blast lands: ink. Black and white and nothing between, with rays from the place, then the same turned about.
  if (fx.ink.x != 0.0) {
    var k = smoothstep(0.3, 0.36, dot(o, vec3f(0.299, 0.587, 0.114)));
    let cell = floor(atan2(sd.y, sd.x) * 44.0);
    let ray = step(0.74, hash2(vec2f(cell, 3.0))) * smoothstep(0.3, 0.42, sl - 0.3 * hash2(vec2f(cell, 9.0)));
    // (and the burst itself: a hard disc of light at the place)
    k = max(k, 1.0 - smoothstep(0.0, 0.006, sl - select(0.13, 0.07, fx.ink.x > 0.0)));
    k = mix(k, 1.0 - k, ray);
    o = select(vec3f(1.0 - k), vec3f(k), fx.ink.x > 0.0);
  } else { o = mix(o, vec3f(1.0, 0.97, 0.9), fx.ink.y); }
  o *= 1.0 - 0.25 * fx.doom.x * pow(length(vUv - 0.5) * 1.25, 3.0);

  // (after the cut: the rings, written in gold, on a shade of their own so that they are read against a bright day)
  if (cutBand > 0.0) { o = mix(o, o * 0.42 + INDIGO * 0.5, min(cutBand * 0.72, 0.8)); }
  if (cutGold > 0.0) { o = mix(o, GOLD, min(cutGold, 1.0)); o += LIGHT * max(cutGold - 1.0, 0.0) * 0.5; }

  // The Cleave's instant, in its own beats (cleave.ts): (1) the day in two colours, indigo and gold, and light
  // spilling from the line; (2) a blink of light, all that is dark in indigo; (3) the dark: the world in indigo, its
  // edges drawn in gold, parted along the line with light in the gap and slivers of gold thrown from it; (4) the day
  // coming back through gold.
  if (beat > 0.5) {
    let lum = dot(o, vec3f(0.299, 0.587, 0.114));
    let ky = fx.cutFx.y;
    let fs = frame;
    let ff = floor(frame);
    // (what the view holds, as lines: where its light changes sharply)
    let px = 1.6 / res;
    let l1 = tone1(at + vec2f(px.x, 0.0));
    let l2 = tone1(at - vec2f(px.x, 0.0));
    let l3 = tone1(at + vec2f(0.0, px.y));
    let l4 = tone1(at - vec2f(0.0, px.y));
    let sobel = abs(l1 - l2) + abs(l3 - l4);
    let lines = smoothstep(0.3, 0.6, sobel);
    let ld = normalize(cAB + vec2f(1.0e-5));
    let ln = vec2f(-ld.y, ld.x);
    let side = dot(cP, ln);
    let hh = dot(cP, ld) / max(length(cAB), 1.0e-4);
    let win = 1.0 - smoothstep(0.0, 0.45, max(-hh, hh - 1.0));
    let core = (1.0 - smoothstep(0.0022, 0.006, abs(side))) * win;
    // (slivers: long thin splinters of light thrown off the line to both sides, lying mostly along it, further off
    // each frame; and here and there a four-pointed glint)
    var sliver = 0.0;
    for (var i = 0; i < 22; i++) {
      let fi = f32(i);
      let re = select(0.0, ff * 1.7, gmod(fi, 2.0) > 0.5);
      let h1 = hash2(vec2f(fi, 3.3 + re));
      let h2 = hash2(vec2f(fi, 8.1 + re));
      let sgn = select(1.0, -1.0, h2 < 0.5);
      let pc = cAB * (0.04 + 0.92 * h1) + ln * sgn * (0.006 + (0.02 + 0.2 * fract(h2 * 7.0) * fract(h2 * 7.0)) * ky) + ld * (hash2(vec2f(fi, 12.7)) - 0.5) * 0.05 * ky;
      let tilt = (hash2(vec2f(fi, 5.5)) - 0.5) * 1.1 + sgn * 0.3 * ky + (hash2(vec2f(fi, fs)) - 0.5) * 0.25;
      let dr = ld * cos(tilt) + ln * sin(tilt);
      let q = cP - pc;
      let x = dot(q, dr);
      let y = dot(q, vec2f(-dr.y, dr.x));
      let len = 0.02 + 0.075 * hash2(vec2f(fi, 6.6));
      let wid = 0.002 + 0.0042 * hash2(vec2f(fi, 7.7));
      if (gmod(fi, 5.0) > 3.5) { sliver = max(sliver, max(step(abs(x) / (len * 0.55) + abs(y) / (wid * 0.7), 1.0), step(abs(y) / (len * 0.55) + abs(x) / (wid * 0.7), 1.0))); }
      else { sliver = max(sliver, step(abs(x) / len + abs(y) / wid, 1.0)); }
    }
    // (a burst of rays from the middle of the cut, long along it and short across, every ray new each beat)
    let bq = cP - cAB * 0.5;
    let br = length(bq);
    let ba = atan2(dot(bq, ln), dot(bq, ld));
    let bt = ba / 6.2832 * 120.0 + hash2(vec2f(ff, 7.0));
    let rid = floor(bt);
    let rh = hash2(vec2f(rid, ff + 9.0));
    let rr = (0.04 + 0.62 * rh * rh) * (0.22 + 0.78 * abs(cos(ba))) * (0.75 + 0.45 * ky);
    var burst = step(0.004, br) * step(br, rr) * step(0.3, rh) * step(abs(fract(bt) - 0.5) * 2.0, (0.25 + 0.6 * hash2(vec2f(rid, 3.0))) * (1.0 - br / rr));
    burst = max(burst, exp(-br / 0.016));
    if (beat < 1.5) {
      let tone = smoothstep(0.2, 0.26, lum) + smoothstep(0.55, 0.62, lum);
      if (tone < 1.0) { o = mix(INDIGO, VIOLET, tone); } else { o = mix(VIOLET, GOLD, tone - 1.0); }
      o = mix(o, INDIGO * 0.7, lines * 0.45);
      // light from the line: a sheet of it to both sides, in rays, wider at the second beat
      let ray = 0.75 + 0.25 * step(0.5, hash2(vec2f(floor(hh * 70.0), 2.0 + fs)));
      o = mix(o, LIGHT, exp(-abs(side) / ((0.012 + 0.07 * ky) * ray)) * win * 0.9);
      o = mix(o, vec3f(1.0), core);
    } else if (beat < 2.5) {
      // A blink of light, and the world is still there in it: what is dark in the view stays, as flat shapes of
      // indigo; what is half dark, as indigo hatched across; and the edges of things as thin lines. The blink after
      // the dark keeps less, and has the burst in it, dark on light.
      let after = step(0.6, ky);
      let d0 = select(0.31, 0.23, after > 0.5);
      let d1 = select(0.47, 0.36, after > 0.5);
      let fha = 0.9 + 1.4 * hash2(vec2f(ff, 6.0));
      let fhatch = step(0.5, fract((in.pos.x * cos(fha) + in.pos.y * sin(fha)) * (1080.0 / res.y) / 6.0));
      let shade = 1.0 - smoothstep(d0, d0 + 0.03, lum);
      let halfTone = (1.0 - smoothstep(d1, d1 + 0.03, lum)) * fhatch;
      o = mix(LIGHT, INDIGO, max(shade, halfTone * 0.85));
      o = mix(o, mix(INDIGO, VIOLET, 0.35), lines * select(0.6, 0.35, after > 0.5) * (1.0 - shade));
      o = mix(o, INDIGO, max(max(sliver, core), after * burst * 0.9));
    } else if (beat < 3.5) {
      // The dark, and no two beats of it alike. One beat the world is its edges, drawn in gold; the next it is what
      // was bright in it, as shards of gold hatched across, the hatching laid a new way; and so on by turns, the
      // dark itself deeper or paler.
      let odd = gmod(ff, 2.0);
      let edges = smoothstep(0.15, 0.4, sobel);
      o = mix(vec3f(0.02, 0.014, 0.05), VIOLET * (0.48 + 0.26 * hash2(vec2f(ff, 4.0))), smoothstep(0.1, 0.8, lum));
      if (odd < 0.5) { o = mix(o, GOLD * 0.9, edges * 0.8); }
      else {
        let th = 0.36 + 0.2 * hash2(vec2f(ff, 5.0));
        let ha = 0.5 + 2.2 * hash2(vec2f(ff, 6.0));
        let hatch = step(0.4, fract((in.pos.x * cos(ha) + in.pos.y * sin(ha)) * (1080.0 / res.y) / 5.5));
        // (in long splinters lying the way of the hatching, here and there: the frame stays dark)
        let hu = vUv * asp0;
        let hv = vec2f(dot(hu, vec2f(cos(ha), sin(ha))), dot(hu, vec2f(-sin(ha), cos(ha))));
        let srow = floor(hv.y * 30.0 + ff * 2.7);
        let along = hv.x * 2.4 + hash2(vec2f(srow, ff)) * 7.0;
        let sx = fract(along);
        // (each splinter thin, and pointed at both ends)
        let strip = step(0.68, hash2(vec2f(floor(along), srow) + ff)) * step(abs(fract(hv.y * 30.0 + ff * 2.7) - 0.5) * 2.0, 4.0 * sx * (1.0 - sx));
        o = mix(o, GOLD * 0.88, smoothstep(th, th + 0.03, lum) * hatch * strip * 0.85);
        o = mix(o, GOLD * 0.9, edges * 0.3);
      }
      o += GOLD * exp(-abs(side) / (0.018 + 0.03 * hash2(vec2f(ff, 8.0)))) * win * 0.35;
      o = mix(o, LIGHT, max(max(max(sliver, core), cGap), burst));
    } else {
      o = mix(LIGHT, mix(o, GOLD, 0.35 * (1.0 - ky)), smoothstep(0.0, 1.0, ky));
      o = mix(o, LIGHT, cGap);
    }
  }
  // The circle round the view, from the instant it is let go: written round in two frames, turning a notch each
  // beat; gold, and indigo over the blinks of light.
  let circle = fx.cutDraw.w;
  if (circle > 0.5) {
    let qc = (vUv - 0.5) * asp0 / 0.47;
    let rn = length(qc);
    if (rn > 0.66 && rn < 1.03) {
      let written = select(1.0, fx.cutFx.z, circle < 1.5);
      let aa = fract(atan2(qc.x, qc.y) / 6.2832);
      let I = sgBand(qc, rn, floor(frame) * 0.26, (1.0 / res.y) / 0.47, 0.013) * step(aa, written);
      o = mix(o, select(mix(GOLD, LIGHT, 0.4), INDIGO, circle > 2.5), min(I, 1.0));
    }
  }
  return vec4f(clamp(o * u.tint.rgb, vec3f(0.0), vec3f(1.0)), 1.0);
}
`

const RAIN = /* wgsl */ `
struct Out { @builtin(position) pos: vec4f, @location(0) uv: vec2f }
@vertex fn vs(@builtin(vertex_index) i: u32) -> Out {
  let p = vec2f(f32((i << 1u) & 2u), f32(i & 2u));
  var out: Out;
  out.pos = vec4f(p * 2.0 - 1.0, 0.5, 1.0);
  out.uv = vec2f(p.x, 1.0 - p.y);
  return out;
}
struct Rain { size: vec2f, time: f32, strength: f32 }
@group(0) @binding(0) var<uniform> rain: Rain;
fn chance(c: vec2i) -> f32 {
  var h = (u32(c.x) * 73856093u) ^ (u32(c.y) * 83492791u);
  h = (h ^ (h >> 13u)) * 0x5bd1e995u;
  return f32((h ^ (h >> 15u)) >> 8u) / 16777216.0;
}
@fragment fn falling(in: Out) -> @location(0) vec4f {
  let uv = in.uv * vec2f(rain.size.x / rain.size.y, 1.0);
  var fall = 0.0;
  for (var layer = 0; layer < 2; layer++) {
    let across = (uv.x + uv.y * 0.07) * (110.0 + 90.0 * f32(layer));
    let h = chance(vec2i(i32(floor(across)), layer + 3));
    let along = fract(uv.y * (1.1 + 0.6 * h) - rain.time * (2.4 + 1.6 * h) + h * 9.0);
    fall += step(0.55, fract(h * 13.0)) * smoothstep(0.1, 0.0, along) * smoothstep(0.5, 0.2, abs(fract(across) - 0.5));
  }
  return vec4f(vec3f(0.55, 0.62, 0.72) * fall * rain.strength, 0.0);
}
`

const UNIFORM_BYTES = 64

/** Minimal Linear HDR source accepted by `glow`: satisfied by both `Offscreen` and TAA's native-res resolved output. */
export type GlowSource = Pick<Offscreen, 'texture' | 'color' | 'size'> & {
  readonly allocSize?: readonly [number, number]
}

type V3 = [number, number, number]

/**
 * What the spells do to the whole picture this frame (#226). Whoever casts fills its own part each frame (cleave.ts
 * `postFx`, rewind.ts `postFx`, a blast its own) and leaves the rest. Everything is nothing until set: `postFx()`
 * gives one with no effect on, and with none on the plain pass draws. Places are the world's finest cells.
 */
export interface PostFx {
  /** The camera the picture was drawn with, and its width over its height (0: the picture's own). What lies in the world (rings, dome, seam, shock, hole) needs it; with none, those are left out. */
  view: View | null
  aspect: number
  /** The depth's active part as a share of its texture ([1, 1] unless it was drawn into the corner of a bigger one). */
  depthUv: [number, number]
  // ── The Cleave ──
  /** Aimed and being drawn, 0 to 1: the view opens as through a wide lens, dark and soft at its edges, its colours parting there. */
  focus: number
  /** Which beat of the instant: 0 none; 1 the day in indigo, violet and gold with its edges and light from the line; 2 a blink of light, the dark in ink and hatching; 3 the dark, parted, with slivers and a burst; 4 the day coming back through gold. */
  mode: number
  /** How far into that beat (what it means is the beat's own: cleave.ts). */
  beat: number
  /** The instant's frame, of 30 a second: what changes each beat is new each frame. */
  frame: number
  /** The circle round the view: 0 none, 1 being written (`written` 0 to 1 of the way round), 2 whole and gold, 3 whole and indigo. */
  circle: number
  written: number
  /** How far the picture is parted along the line (what is above the cut lifted off it), 0 to 1 and beyond. */
  split: number
  /** The colours parting toward the edge of the view. */
  fringe: number
  /** Which side of the line on the picture is above the cut: 1 or -1. */
  up: number
  /** The cut's line on the picture: its two ends, 0 to 1 with y up (ax, ay, bx, by). */
  line: [number, number, number, number]
  /** The rings that go out in the cut's own sheet: how long since (s; 0 none), the middle of the cut, the way the sheet faces, the way from the eye to its middle, and their size (cells: how far off the cut's middle was struck). */
  rings: { age: number; at: V3; normal: V3; mid: V3; size: number }
  /** Whether the ball of glass that swells from the cut's middle with the rings is drawn (1) or left out (0). */
  dome: number
  /** The day pale for a moment after, 0 to 1. */
  haze: number
  /** The seam left where the cut's sheet meets the world, cooling: how hot (0 none), its half breadth (cells), the eye the cut was made from, the sheet, where the stroke began (`e1`) and across it (`e2`), the angle it spans, and its reach (cells). It needs the picture's depth. */
  seam: { glow: number; width: number; eye: V3; normal: V3; e1: V3; e2: V3; theta: number; reach: number }
  // ── A blast, a singularity ──
  /** A frame of ink as a blast lands: 1, then -1 (the same turned about), else 0. Its rays come from the shock's place. */
  ink: number
  /** White-blind, 0 to 1. */
  white: number
  /** A blast's light on everything, 0 to 1 and a little over. */
  blaze: number
  /** A blast's ring in the air: round a place, so far out (cells), so strong (0 none). It bends what is seen through it. */
  shock: { at: V3; radius: number; power: number }
  /** A singularity: at a place, of so great a radius (cells), so strongly there (0 none), and how hard the view is drawn to it. What is nearer the eye than it is left alone (by depth). */
  hole: { at: V3; radius: number; power: number; pull: number }
  // ── Time ──
  /** How far the colour is drained (0 to 1), to `doomTint` times its brightness with `doomKeep` of its own colour kept. Stopped time: a cold silver. */
  doom: number
  /** How much what is warm (fire, embers, red flowers) keeps its colour through that, 0 to 1. */
  doomWarm: number
  doomTint: V3
  doomKeep: number
  /** Time wound back, 0 to 1: the picture drawn out along the way to its middle, its colours parting. */
  rewind: number
  /** How far out from the middle of the view the draining has gone, in heights of the view (9 or more: all of it). */
  wave: number
}

/** A `PostFx` with nothing on. */
export function postFx(): PostFx {
  return {
    view: null, aspect: 0, depthUv: [1, 1],
    focus: 0, mode: 0, beat: 0, frame: 0, circle: 0, written: 0, split: 0, fringe: 0, up: 1, line: [0, 0, 0, 0],
    rings: { age: 0, at: [0, 0, 0], normal: [0, 1, 0], mid: [0, 0, 1], size: 200 }, dome: 1, haze: 0,
    seam: { glow: 0, width: 0.7, eye: [0, 0, 0], normal: [0, 1, 0], e1: [1, 0, 0], e2: [0, 0, 1], theta: 0, reach: 0 },
    ink: 0, white: 0, blaze: 0, shock: { at: [0, 0, 0], radius: 0, power: 0 }, hole: { at: [0, 0, 0], radius: 0, power: 0, pull: 0 },
    doom: 0, doomWarm: 0, doomTint: [0.5, 0.06, 0.05], doomKeep: 0.05, rewind: 0, wave: 9,
  }
}
/** Whether anything in it would change the picture: with nothing on, the plain pass draws. */
export function fxLive(fx: PostFx): boolean {
  return fx.focus > 0 || fx.mode > 0 || fx.circle > 0 || fx.split > 0 || fx.fringe > 0 || fx.rings.age > 0 || fx.haze > 0 || fx.seam.glow > 0.001
    || fx.ink !== 0 || fx.white > 0 || fx.blaze > 0 || fx.shock.power > 0 || fx.hole.power > 0 || fx.doom > 0 || fx.rewind > 0 || fx.wave < 8
}

/** The runes (32: eight across, four down), each as strokes on a grid 4 wide and 6 tall with y up: lines of points, parted by '|'. Staves and slants, as cut with a knife. */
const RUNES = [
  '1,0 1,6|1,2.5 3.5,4.5|1,4 3,6', '0.5,0 0.5,6 3.5,4 3.5,0', '1,0 1,6|1,4.5 3,3 1,1.5', '1,0 1,6|1,6 3.5,4.5|1,4 3.5,2.5', '1,0 1,6 3.2,4.6 1,3.2 3.4,0', '3.2,5 1,3 3.2,1', '0.5,0.5 3.5,5.5|0.5,5.5 3.5,0.5', '1,0 1,6 3.2,4.5 1,3',
  '0.7,0 0.7,6|3.3,0 3.3,6|0.7,4 3.3,2', '2,0 2,6|0.7,4 3.3,2', '2,0 2,6', '2.4,6 0.9,4.4 2.4,2.8|1.6,3.2 3.1,1.6 1.6,0', '2,0 2,6|2,6 3.4,4.6|2,0 0.6,1.4', '1,0 1,6 2.2,4.8 3.4,6|1,0 2.2,1.2 3.4,0', '2,0 2,6|2,3.2 0.5,5.6|2,3.2 3.5,5.6', '3.2,6 1,4.2 3,2.4 0.8,0',
  '2,0 2,6|0.5,4.2 2,6 3.5,4.2', '1,0 1,6 3.2,4.6 1,3 3.2,1.4 1,0', '0.7,0 0.7,6 2,4.2 3.3,6 3.3,0', '0.7,0 0.7,6 3.3,3.4|3.3,0 3.3,6 0.7,3.4', '1.2,0 1.2,6 3.2,4', '2,5.2 3.6,3 2,0.8 0.4,3 2,5.2', '0.6,0.6 0.6,5.4 3.4,0.6 3.4,5.4 0.6,0.6', '0.6,0 3.2,3.6 2,5.6 0.8,3.6 3.4,0',
  '2,0 2,6|0.6,5 3.4,5|0.6,1 3.4,1', '0.7,6 0.7,0 3.3,0|0.7,3 2.6,3', '2,0 2,6|0.6,4.6 2,3.2 3.4,4.6|0.6,0.4 2,1.8 3.4,0.4', '0.6,0 2,6 3.4,0|1.2,2.4 2.8,2.4', '0.6,6 3.4,6 0.6,0 3.4,0 0.6,6', '1,0 1,6|1,5 3.2,3.5|1,3.2 3.2,1.7|1,1.5 2.4,0.5', '2,6 2,2.4|2,2.4 0.6,0.6|2,2.4 3.4,0.6|0.8,4.4 3.2,4.4', '0.6,3 2,6 3.4,3 2,0 0.6,3|2,0 2,6',
] as const
/**
 * The rune atlas every circle is written with, drawn here from the strokes above (no picture is fetched, and no
 * canvas is needed: it is the same in a worker and in a headless browser): one byte a pixel, 8 runes across and 4
 * down, each in a square of `cell` pixels, the first at the top left.
 */
export function runeAtlas(cell = 64): { width: number; height: number; data: Uint8Array<ArrayBuffer> } {
  const width = cell * 8, height = cell * 4, data = new Uint8Array(width * height)
  const wide = 0.05, soft = 0.9 / cell
  RUNES.forEach((rune, g) => {
    const segs: number[] = []
    for (const line of rune.split('|')) {
      const pts = line.split(' ').map((p) => p.split(',').map(Number))
      for (let i = 0; i + 1 < pts.length; i++) segs.push(0.22 + pts[i][0] * 0.14, 0.13 + pts[i][1] * 0.123, 0.22 + pts[i + 1][0] * 0.14, 0.13 + pts[i + 1][1] * 0.123)
    }
    const ox = (g % 8) * cell, oy = Math.floor(g / 8) * cell
    for (let py = 0; py < cell; py++) for (let px = 0; px < cell; px++) {
      const x = (px + 0.5) / cell, y = 1 - (py + 0.5) / cell
      let d = 9
      for (let k = 0; k < segs.length; k += 4) {
        const ax = segs[k], ay = segs[k + 1], bx = segs[k + 2] - ax, by = segs[k + 3] - ay
        const t = Math.min(1, Math.max(0, ((x - ax) * bx + (y - ay) * by) / (bx * bx + by * by || 1)))
        d = Math.min(d, Math.hypot(x - ax - bx * t, y - ay - by * t))
      }
      const a = 1 - Math.min(1, Math.max(0, (d - wide + soft) / (2 * soft)))
      data[(oy + py) * width + ox + px] = Math.round(255 * a * a * (3 - 2 * a))
    }
  })
  return { width, height, data }
}

/** Vec4s in the spells' uniform block (the `Fx` struct). */
const FX_VEC4S = 22
const dot3 = (a: readonly number[], b: readonly number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]

/** The last pass: draws the picture to the screen. */
type GlowDraw = (encoder: GPUCommandEncoder, from: GlowSource, to: GPUTextureView, rain?: number, time?: number, grade?: readonly [number, number], night?: number, tint?: readonly [number, number, number], drive?: number, drift?: number, /** What the spells do to the picture this frame; left out, or with nothing on, the plain pass draws. */ fx?: PostFx | null, /** The picture's depth (a texture that can be read: gpu.ts `depthFor`), for what must know how far off things are; left out, nothing is hidden and the seam is not drawn. */ depth?: GPUTextureView | null) => void
/** The last pass, and `warmFx`: builds the spells' pass ahead of its first use and says whether it could be built. */
export type GlowPass = GlowDraw & { warmFx(): Promise<boolean> }

/** Draws Linear HDR `from` to swapchain `to` with Karis-averaged luminance bloom, AgX tonemapping, and optional rain. */
export async function glow(gpu: Gpu): Promise<GlowPass> {
  const { device } = gpu
  const module = await shader(device, 'glow', codeOf(gpu.canF16)), rainModule = await shader(device, 'rain', RAIN)
  const layout = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: {} },
      { binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: {} },
      { binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: {} },
      { binding: 3, visibility: GPUShaderStage.FRAGMENT, buffer: {} },
    ],
  })
  const make = (entryPoint: string, format: GPUTextureFormat) => device.createRenderPipelineAsync({ label: `glow ${entryPoint}`, layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }), vertex: { module, entryPoint: 'vs' }, fragment: { module, entryPoint, targets: [{ format }] } })
  const small: GPUTextureFormat = 'rgba16float'
  const [bright, blur, last, down] = await Promise.all([make('bright', small), make('blur', small), make('last', gpu.format), make('down', small)])
  const add = await device.createRenderPipelineAsync({ label: 'glow add', layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }), vertex: { module, entryPoint: 'vs' }, fragment: { module, entryPoint: 'plain', targets: [{ format: small, blend: { color: { srcFactor: 'one', dstFactor: 'one' }, alpha: { srcFactor: 'zero', dstFactor: 'one' } } }] }, primitive: { topology: 'triangle-list' } })
  const sampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear', addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge' })
  const wet = device.createBindGroupLayout({ entries: [{ binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: {} }] })
  const falling = await device.createRenderPipelineAsync({
    label: 'rain', layout: device.createPipelineLayout({ bindGroupLayouts: [wet] }), vertex: { module: rainModule, entryPoint: 'vs' },
    fragment: { module: rainModule, entryPoint: 'falling', targets: [{ format: gpu.format, blend: { color: { srcFactor: 'one', dstFactor: 'one' }, alpha: { srcFactor: 'zero', dstFactor: 'one' } } }] },
  })
  const rainBlock = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST })
  const rainBind = device.createBindGroup({ layout: wet, entries: [{ binding: 0, resource: { buffer: rainBlock } }] })

  const blocks = Array.from({ length: 8 }, () => device.createBuffer({ size: UNIFORM_BYTES, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST }))
  const scratch = new Float32Array(16)
  const writeU = (
    idx: number,
    stepX: number, stepY: number, strength: number, pad: number,
    tr: number, tg: number, tb: number, ta: number,
    uvMaxX: number, uvMaxY: number, uvClampX: number, uvClampY: number,
    spreadMaxX = 1, spreadMaxY = 1, extraX = 0, extraY = DAY_EXPOSURE,
  ) => {
    scratch[0] = stepX; scratch[1] = stepY; scratch[2] = strength; scratch[3] = pad
    scratch[4] = tr; scratch[5] = tg; scratch[6] = tb; scratch[7] = ta
    scratch[8] = uvMaxX; scratch[9] = uvMaxY; scratch[10] = uvClampX; scratch[11] = uvClampY
    scratch[12] = spreadMaxX; scratch[13] = spreadMaxY; scratch[14] = extraX; scratch[15] = extraY
    device.queue.writeBuffer(blocks[idx], 0, scratch)
  }

  // Persistent grow-only bloom pyramid: caches per-source bind groups in a WeakMap so switching between
  // `Offscreen` and TAA's native-res output (or dynamic resolution `steer`) causes zero GPU texture or bind group churn.
  interface Kept {
    alloc: readonly [number, number]
    quarter: readonly [number, number]
    sixteenth: readonly [number, number]
    textures: GPUTexture[]
    views: GPUTextureView[]
    bindsByTex: WeakMap<GPUTexture, GPUBindGroup[]>
  }
  let kept: Kept | null = null
  const bind = (picture: GPUTextureView, spread: GPUTextureView, uniforms: GPUBuffer) =>
    device.createBindGroup({ layout, entries: [{ binding: 0, resource: picture }, { binding: 1, resource: sampler }, { binding: 2, resource: spread }, { binding: 3, resource: { buffer: uniforms } }] })

  const keep = (from: GlowSource): { k: Kept; binds: GPUBindGroup[] } => {
    const alloc = from.allocSize ?? from.size
    const needGrow = !kept || alloc[0] > kept.alloc[0] || alloc[1] > kept.alloc[1]
    if (needGrow) {
      const nextAlloc: readonly [number, number] = kept
        ? [Math.max(alloc[0], kept.alloc[0]), Math.max(alloc[1], kept.alloc[1])]
        : [alloc[0], alloc[1]]
      const quarter: readonly [number, number] = [Math.max(1, Math.ceil(nextAlloc[0] / 4)), Math.max(1, Math.ceil(nextAlloc[1] / 4))]
      const sixteenth: readonly [number, number] = [Math.max(1, Math.ceil(quarter[0] / 4)), Math.max(1, Math.ceil(quarter[1] / 4))]
      for (const t of kept?.textures ?? []) t.destroy()
      const makeTex = (size: readonly [number, number]) =>
        device.createTexture({ size: [size[0], size[1]], format: small, usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING })
      const textures = [makeTex(quarter), makeTex(quarter), makeTex(sixteenth), makeTex(sixteenth)]
      const views = textures.map((t) => t.createView())
      kept = { alloc: nextAlloc, quarter, sixteenth, textures, views, bindsByTex: new WeakMap() }
    }
    const k = kept!
    let binds = k.bindsByTex.get(from.texture)
    if (!binds) {
      const views = k.views
      binds = [
        bind(from.color, views[1], blocks[0]),
        bind(views[0], views[0], blocks[1]),
        bind(views[1], views[1], blocks[2]),
        bind(from.color, views[0], blocks[3]),
        bind(views[0], views[0], blocks[4]),
        bind(views[2], views[2], blocks[5]),
        bind(views[3], views[3], blocks[6]),
        bind(views[2], views[2], blocks[7]),
      ]
      k.bindsByTex.set(from.texture, binds)
    }
    return { k, binds }
  }

  // The spells' pass (#226): its own module, pipeline, uniforms, rune atlas and a depth of one pixel for when none is
  // given. Built the first time effects are handed in (or by `warmFx`), off the frame; until it is there, and if it
  // cannot be built on this device, the plain pass draws and nothing else changes.
  interface FxPass { pipeline: GPURenderPipeline; layout: GPUBindGroupLayout; block: GPUBuffer; runes: GPUTextureView; none: GPUTextureView; binds: WeakMap<GPUTextureView, GPUBindGroup> }
  let fxPass: FxPass | null = null, fxBuilding: Promise<boolean> | null = null
  const fxData = new Float32Array(FX_VEC4S * 4)
  const buildFx = async (): Promise<boolean> => {
    const fxModule = await shader(device, 'glow fx', `${HEAD}${TONE}${FX}`)
    const fxLayout = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: {} },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'depth' } },
        { binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: {} },
      ],
    })
    const pipeline = await device.createRenderPipelineAsync({ label: 'glow lastFx', layout: device.createPipelineLayout({ bindGroupLayouts: [layout, fxLayout] }), vertex: { module: fxModule, entryPoint: 'vs' }, fragment: { module: fxModule, entryPoint: 'lastFx', targets: [{ format: gpu.format }] } })
    const atlas = runeAtlas()
    const runeTex = device.createTexture({ label: 'runes', size: [atlas.width, atlas.height], format: 'r8unorm', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST })
    device.queue.writeTexture({ texture: runeTex }, atlas.data, { bytesPerRow: atlas.width }, [atlas.width, atlas.height])
    const none = device.createTexture({ label: 'no depth', size: [1, 1], format: 'depth24plus', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT })
    fxPass = { pipeline, layout: fxLayout, block: device.createBuffer({ label: 'glow fx', size: fxData.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST }), runes: runeTex.createView(), none: none.createView(), binds: new WeakMap() }
    return true
  }
  const warmFx = () => (fxBuilding ??= buildFx().catch((e) => { console.warn('glow: the spells’ pass could not be built; the plain pass draws', e); return false }))
  /** Where a place in the world is on the picture (0 to 1, y up) and how far off along the eye's forward (cells; under 1: behind). */
  const seenAt = (view: View, aspect: number, p: readonly number[], out: V3) => {
    const rel = [p[0] - view.eye[0], p[1] - view.eye[1], p[2] - view.eye[2]], z = dot3(rel, view.forward), k = 1 / (Math.max(z, 1e-3) * view.tanHalf)
    out[0] = (dot3(rel, view.right) * k) / aspect * 0.5 + 0.5; out[1] = dot3(rel, view.up) * k * 0.5 + 0.5; out[2] = z
    return out
  }
  const spot: V3 = [0, 0, 0]
  /** The spells' uniforms for this frame (the `Fx` struct, in order). */
  const writeFx = (pass: FxPass, fx: PostFx, srcW: number, srcH: number, hasDepth: boolean) => {
    const d = fxData, v = fx.view, aspect = fx.aspect > 0 ? fx.aspect : srcW / srcH
    const put = (i: number, x: number, y: number, z: number, w: number) => { d[i * 4] = x; d[i * 4 + 1] = y; d[i * 4 + 2] = z; d[i * 4 + 3] = w }
    const rel = (i: number, p: readonly number[], w: number) => put(i, p[0] - (v ? v.eye[0] : 0), p[1] - (v ? v.eye[1] : 0), p[2] - (v ? v.eye[2] : 0), w)
    put(0, srcW, srcH, fx.depthUv[0], fx.depthUv[1])
    if (v) { put(1, v.forward[0], v.forward[1], v.forward[2], v.tanHalf); put(2, v.right[0], v.right[1], v.right[2], aspect); put(3, v.up[0], v.up[1], v.up[2], hasDepth ? 1 : 0) }
    else { put(1, 0, 0, -1, 0.7); put(2, 1, 0, 0, aspect); put(3, 0, 1, 0, 0) }
    put(4, fx.line[0], fx.line[1], fx.line[2], fx.line[3])
    put(5, fx.mode, fx.beat, fx.written, fx.fringe)
    put(6, fx.focus, fx.up < 0 ? -1 : 1, fx.frame, fx.circle)
    put(7, fx.split, fx.haze, fx.rings.size, v ? Math.max(0, fx.rings.age) : 0)
    rel(8, fx.rings.at, fx.dome > 0 ? 1 : 0)
    put(9, fx.rings.normal[0], fx.rings.normal[1], fx.rings.normal[2], 0)
    put(10, fx.rings.mid[0], fx.rings.mid[1], fx.rings.mid[2], 0)
    if (v) { seenAt(v, aspect, fx.rings.at, spot); put(11, spot[0], spot[1], 0, 0) } else put(11, 0.5, 0.5, 0, 0)
    rel(12, fx.seam.eye, v ? fx.seam.glow : 0)
    put(13, fx.seam.normal[0], fx.seam.normal[1], fx.seam.normal[2], Math.max(0.05, fx.seam.width))
    put(14, fx.seam.e1[0], fx.seam.e1[1], fx.seam.e1[2], fx.seam.theta)
    put(15, fx.seam.e2[0], fx.seam.e2[1], fx.seam.e2[2], fx.seam.reach)
    put(16, fx.doom, fx.doomWarm, fx.rewind, fx.wave)
    put(17, fx.doomTint[0], fx.doomTint[1], fx.doomTint[2], fx.doomKeep)
    put(18, fx.ink, fx.white, fx.blaze, 0)
    // A blast's ring and a singularity as the eye sees them: nothing of either when it is behind the eye.
    put(19, 0.5, 0.5, 0, 0); put(20, 0.5, 0.5, 0, 0); put(21, 0, 0, 0, 0)
    if (v && fx.shock.power > 0 && seenAt(v, aspect, fx.shock.at, spot)[2] > 1) {
      const far = Math.hypot(fx.shock.at[0] - v.eye[0], fx.shock.at[1] - v.eye[1], fx.shock.at[2] - v.eye[2])
      put(19, spot[0], spot[1], fx.shock.radius / (2 * v.tanHalf * Math.max(far, 10)), fx.shock.power)
    }
    if (v && fx.hole.power > 0 && seenAt(v, aspect, fx.hole.at, spot)[2] > 1) {
      const k = 1 / (2 * v.tanHalf * Math.max(Math.hypot(fx.hole.at[0] - v.eye[0], fx.hole.at[1] - v.eye[1], fx.hole.at[2] - v.eye[2]), 10))
      put(20, spot[0], spot[1], fx.hole.radius * 1.6 * k, fx.hole.power); put(21, fx.hole.radius * k, spot[2], fx.hole.pull, fx.hole.radius)
    }
    device.queue.writeBuffer(pass.block, 0, d)
  }

  const pass = (encoder: GPUCommandEncoder, pipeline: GPURenderPipeline, bg: GPUBindGroup, to: GPUTextureView, onto = false, viewport?: readonly [number, number]) => {
    const p = encoder.beginRenderPass({ colorAttachments: [{ view: to, loadOp: onto ? 'load' : 'clear', storeOp: 'store', clearValue: [0, 0, 0, 1] }] })
    if (viewport) {
      p.setViewport(0, 0, viewport[0], viewport[1], 0, 1)
      p.setScissorRect(0, 0, viewport[0], viewport[1])
    }
    p.setPipeline(pipeline)
    p.setBindGroup(0, bg)
    p.draw(3)
    p.end()
  }

  const draw: GlowDraw = (encoder, from, to, rain = 0, time = 0, grade = [1.25, 0.35], night = 0, tint = [1, 1, 1], drive = 0, drift = 0, fx = null, depth = null) => {
    const { k, binds } = keep(from)
    const alloc = from.allocSize ?? from.size
    const srcW = from.size[0], srcH = from.size[1]
    const srcUvX = srcW / alloc[0], srcUvY = srcH / alloc[1]
    const srcStepX = 1 / alloc[0], srcStepY = 1 / alloc[1]

    const qW = Math.max(1, Math.min(k.quarter[0], Math.ceil(srcW / 4)))
    const qH = Math.max(1, Math.min(k.quarter[1], Math.ceil(srcH / 4)))
    const qUvX = qW / k.quarter[0], qUvY = qH / k.quarter[1]
    const qStepX = 1 / k.quarter[0], qStepY = 1 / k.quarter[1]
    const qActive: readonly [number, number] = [qW, qH]

    const dayCurve = Math.pow(Math.max(0, 1 - night), 1.8)
    const exposure = TONEMAP_ACES ? 0.43 : NIGHT_EXPOSURE + (DAY_EXPOSURE - NIGHT_EXPOSURE) * dayCurve
    const nightBloom = Math.min(1, night * 1.45)
    const bloomGain = 0.42 + nightBloom * 1.45

    // 0: bright extraction (Karis average) from active HDR scene sub-rect -> quarter[0]
    writeU(0, srcStepX, srcStepY, night, 0, 1, 1, 1, 1, srcUvX, srcUvY, Math.max(srcStepX * 0.5, srcUvX - srcStepX * 0.5), Math.max(srcStepY * 0.5, srcUvY - srcStepY * 0.5), 1, 1, 0, exposure)
    // 1, 2: separable blur on quarter[0] <-> quarter[1]
    writeU(1, qStepX, 0, 0, 0, 1, 1, 1, 1, qUvX, qUvY, Math.max(qStepX * 0.5, qUvX - qStepX * 0.5), Math.max(qStepY * 0.5, qUvY - qStepY * 0.5))
    writeU(2, 0, qStepY, 0, 0, 1, 1, 1, 1, qUvX, qUvY, Math.max(qStepX * 0.5, qUvX - qStepX * 0.5), Math.max(qStepY * 0.5, qUvY - qStepY * 0.5))
    // 3: final composite + AgX tonemap -> swapchain
    writeU(3, grade[0], grade[1], bloomGain, Math.max(0, Math.min(1, drive)), tint[0], tint[1], tint[2], Math.max(-1, Math.min(1, drift)), srcUvX, srcUvY, Math.max(srcStepX * 0.5, srcUvX - srcStepX * 0.5), Math.max(srcStepY * 0.5, srcUvY - srcStepY * 0.5), qUvX, qUvY, TONEMAP_ACES ? 1 : 0, exposure)

    pass(encoder, bright, binds[0], k.views[0], false, qActive)
    for (let twice = 0; twice < 2; twice++) {
      pass(encoder, blur, binds[1], k.views[1], false, qActive)
      pass(encoder, blur, binds[2], k.views[0], false, qActive)
    }
    if (night > 0) {
      const sW = Math.max(1, Math.min(k.sixteenth[0], Math.ceil(qW / 4)))
      const sH = Math.max(1, Math.min(k.sixteenth[1], Math.ceil(qH / 4)))
      const sUvX = sW / k.sixteenth[0], sUvY = sH / k.sixteenth[1]
      const sStepX = 1 / k.sixteenth[0], sStepY = 1 / k.sixteenth[1]
      const sActive: readonly [number, number] = [sW, sH]
      writeU(4, qStepX, qStepY, 0, 0, 1, 1, 1, 1, qUvX, qUvY, Math.max(qStepX * 0.5, qUvX - qStepX * 0.5), Math.max(qStepY * 0.5, qUvY - qStepY * 0.5))
      writeU(5, sStepX, 0, 0, 0, 1, 1, 1, 1, sUvX, sUvY, Math.max(sStepX * 0.5, sUvX - sStepX * 0.5), Math.max(sStepY * 0.5, sUvY - sStepY * 0.5))
      writeU(6, 0, sStepY, 0, 0, 1, 1, 1, 1, sUvX, sUvY, Math.max(sStepX * 0.5, sUvX - sStepX * 0.5), Math.max(sStepY * 0.5, sUvY - sStepY * 0.5))
      writeU(7, 0, 0, 0.85, 0, 1, 1, 1, 1, sUvX, sUvY, Math.max(sStepX * 0.5, sUvX - sStepX * 0.5), Math.max(sStepY * 0.5, sUvY - sStepY * 0.5))
      pass(encoder, down, binds[4], k.views[2], false, sActive)
      pass(encoder, blur, binds[5], k.views[3], false, sActive)
      pass(encoder, blur, binds[6], k.views[2], false, sActive)
      pass(encoder, add, binds[7], k.views[0], true, qActive)
    }
    // The spells' pass in place of the plain one, in a frame some effect is on and once it is built.
    if (fx && !fxBuilding) void warmFx()
    if (fx && fxPass && fxLive(fx)) {
      const view = depth ?? fxPass.none
      let bg = fxPass.binds.get(view)
      if (!bg) { bg = device.createBindGroup({ layout: fxPass.layout, entries: [{ binding: 0, resource: { buffer: fxPass.block } }, { binding: 1, resource: view }, { binding: 2, resource: fxPass.runes }] }); fxPass.binds.set(view, bg) }
      writeFx(fxPass, fx, srcW, srcH, !!depth)
      const p = encoder.beginRenderPass({ colorAttachments: [{ view: to, loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 1] }] })
      p.setPipeline(fxPass.pipeline)
      p.setBindGroup(0, binds[3])
      p.setBindGroup(1, bg)
      p.draw(3)
      p.end()
    } else pass(encoder, last, binds[3], to)
    if (rain > 0) {
      device.queue.writeBuffer(rainBlock, 0, new Float32Array([srcW, srcH, time, rain * 0.4]))
      const p = encoder.beginRenderPass({ colorAttachments: [{ view: to, loadOp: 'load', storeOp: 'store' }] })
      p.setPipeline(falling)
      p.setBindGroup(0, rainBind)
      p.draw(3)
      p.end()
    }
  }
  return Object.assign(draw, { warmFx })
}
