// The paint and rails on a Bay world's roads (#450), drawn by the march as lines and not as cells: sf/marks.mjs writes
// them from the street graph as segments (marks.bin), `grid` files them by the square of 25.6 m they reach into, and
// MARKS (WGSL) lays them over the asphalt a ray meets.
//
// Drawn in 10 cm cells, a line that runs at an angle to the cells was a staircase (the rails up Powell and California),
// and a dash far off was a dot or nothing as each pixel met paint or missed it. Here every line is a band of its real
// width round the segment, and each pixel takes the share of its footprint on the road that the band covers: the
// footprint is a pixel wide across the look and longer along it by how glancing the look is, as a texture's mip
// level filters it. Near, the edge is a pixel's blur; far, a line fades into the road as its share of it.

/** A style's low four bits (sf/marks.mjs STYLE), and its colour in the next two (0 white, 1 yellow, 2 rainbow). */
export const STYLES = { whiteLine: 1, whiteDash: 2, yellowDouble: 3, crossBars: 4, crossLines: 5, railsCable: 6, rails: 7 } as const

/** The squares the segments are filed by: 256 cells (25.6 m). */
const SHIFT = 8
/** How far from its segment a mark reaches (a crossing's bars, 1.5 m) and a little over for a footprint's width. */
const REACH = 24

/**
 * marks.bin as the march reads it: eight words of header (the grid's first square x and z, how many squares across
 * and down, where the offsets, the list and the segments begin, how many segments), then each square's first entry
 * in the list (one more than there are squares), the list of segments by square, and the segments (x0, z0, x1, z1,
 * style, cells). Null where the bytes are not marks.
 */
export function grid(bytes: ArrayBuffer): Uint32Array<ArrayBuffer> | null {
  const w = new Int32Array(bytes)
  if (w.length < 3 || w[0] !== 0x4b52414d) return null
  const nc = w[1], ns = w[2]
  if (w.length !== 3 + nc * 4 + ns * 5) return null
  const segs = w.subarray(3 + nc * 4)
  if (!ns) return new Uint32Array(8)
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity
  for (let i = 0; i < ns; i++) {
    const s = segs.subarray(i * 5, i * 5 + 4)
    x0 = Math.min(x0, s[0], s[2]); x1 = Math.max(x1, s[0], s[2]); z0 = Math.min(z0, s[1], s[3]); z1 = Math.max(z1, s[1], s[3])
  }
  const gx0 = (x0 - REACH) >> SHIFT, gz0 = (z0 - REACH) >> SHIFT, nx = ((x1 + REACH) >> SHIFT) - gx0 + 1, nz = ((z1 + REACH) >> SHIFT) - gz0 + 1
  const count = new Uint32Array(nx * nz + 1)
  const each = (i: number, f: (k: number) => void) => {
    const s = segs.subarray(i * 5, i * 5 + 4)
    const a0 = (Math.min(s[0], s[2]) - REACH) >> SHIFT, a1 = (Math.max(s[0], s[2]) + REACH) >> SHIFT
    const b0 = (Math.min(s[1], s[3]) - REACH) >> SHIFT, b1 = (Math.max(s[1], s[3]) + REACH) >> SHIFT
    // Only the squares the band round the segment reaches into: a long diagonal does not fill its whole box.
    const dx = s[2] - s[0], dz = s[3] - s[1], l = Math.hypot(dx, dz) || 1, half = (1 << SHIFT) / 2
    for (let gz = b0; gz <= b1; gz++) for (let gx = a0; gx <= a1; gx++) {
      const cx = (gx << SHIFT) + half - s[0], cz = (gz << SHIFT) + half - s[1], t = Math.max(0, Math.min(l, (cx * dx + cz * dz) / l))
      if (Math.hypot(cx - (dx * t) / l, cz - (dz * t) / l) <= half * Math.SQRT2 + REACH) f((gz - gz0) * nx + (gx - gx0))
    }
  }
  for (let i = 0; i < ns; i++) each(i, (k) => count[k + 1]++)
  for (let k = 0; k < nx * nz; k++) count[k + 1] += count[k]
  const head = 8, list = head + count.length, at = list + count[nx * nz], out = new Uint32Array(at + ns * 5)
  out.set([gx0 >>> 0, gz0 >>> 0, nx, nz, head, list, at, ns])
  out.set(count, head)
  const fill = count.slice()
  for (let i = 0; i < ns; i++) each(i, (k) => { out[list + fill[k]++] = i })
  out.set(new Uint32Array(segs.buffer, segs.byteOffset, ns * 5), at)
  return out
}

/**
 * The marks over the colour of asphalt a ray met `t` along `rd` from `ro` (WGSL; needs `marks`, `g` and `looks`).
 * Every position is whole cells (the march's corner near the eye and the cell `ro` is in) and a small remainder, so a
 * line keeps its edge to the millimetre half a megametre from the frame's origin, where a float steps by 6 mm.
 */
export const MARKS = /* wgsl */ `
@group(0) @binding(6) var<storage, read> marks: array<u32>;
// The share of [lo, hi] a box of half-width w round x covers.
fn markBand(x: f32, lo: f32, hi: f32, w: f32) -> f32 { return clamp((min(hi, x + w) - max(lo, x - w)) / (2.0 * w), 0.0, 1.0); }
// The same for a band either side of a line, lo to hi from it.
fn markBoth(d: f32, lo: f32, hi: f32, w: f32) -> f32 { return select(markBand(d, lo, hi, w) + markBand(d, -hi, -lo, w), markBand(d, -hi, hi, w), lo <= 0.0); }
// How much of the run to x falls on the first \`on\` of each \`period\`, and the share of [x - w, x + w] that does.
fn markOn(x: f32, period: f32, on: f32) -> f32 { let n = floor(x / period); return n * on + clamp(x - n * period, 0.0, on); }
fn markPeriodic(x: f32, period: f32, on: f32, w: f32) -> f32 { return clamp((markOn(x + w, period, on) - markOn(x - w, period, on)) / (2.0 * w), 0.0, 1.0); }
// The bands of a line drawn round its nearest segment, d from it with a footprint w across: white, yellow, a cable car's
// rails, a streetcar's. Rails: the worn top of each rail 6 cm wide, the groove inside it 3 cm, 1067 mm between their
// inner faces for a cable car with the cable's slot between them (2 cm, in steel lips), 1435 mm for a streetcar. Steel
// worn bright where wheels run, the groove and the slot dark with the road's grime.
fn markLines(col: vec3f, slot: u32, d: f32, w: f32) -> vec3f {
  let steel = vec3f(0.26, 0.26, 0.27);
  let dark = vec3f(0.03, 0.028, 0.026);
  var c = col;
  switch slot {
    case 0u: { c = mix(c, looks.palette[2].rgb, markBoth(d, 0.0, 0.5, w)); }
    case 1u: { c = mix(c, looks.palette[59].rgb, markBoth(d, 0.5, 1.5, w)); }
    case 2u: {
      c = mix(c, steel, markBoth(d, 0.1, 0.4, w) + markBoth(d, 5.335, 5.935, w));
      c = mix(c, dark, markBoth(d, 0.0, 0.1, w) + markBoth(d, 5.035, 5.335, w));
    }
    default: {
      c = mix(c, steel, markBoth(d, 7.175, 7.775, w));
      c = mix(c, dark, markBoth(d, 6.875, 7.175, w));
    }
  }
  return c;
}
fn marked(col: vec3f, ro: vec3f, rd: vec3f, t: f32) -> vec3f {
  let nx = marks[2];
  if (nx == 0u || t > 4000.0) { return col; }
  // The march's numbers are measured from a corner near the eye (march.ts \`tell\`), which the fog's terms carry.
  let o = floor(ro);
  let oi = vec2i(i32(g.fog.w), i32(g.fogTint.a)) + vec2i(i32(o.x), i32(o.z));
  let lp = (ro - o) + rd * t;
  let p = vec2f(lp.x, lp.z);
  let at = oi + vec2i(floor(p));
  let gx = (at.x >> ${SHIFT}u) - i32(marks[0]);
  let gz = (at.y >> ${SHIFT}u) - i32(marks[1]);
  if (gx < 0 || gz < 0 || gx >= i32(nx) || gz >= i32(marks[3])) { return col; }
  let k = marks[4] + u32(gz) * nx + u32(gx);
  let first = marks[k];
  let last = marks[k + 1u];
  if (first == last) { return col; }
  // The pixel's footprint on the road: a pixel across the look, longer along it as the look glances (a mip's filter).
  let across = g.pixel * max(t, 1.0);
  let along = across / max(abs(rd.y), 0.03);
  let flat = length(rd.xz);
  let v = select(vec2f(1.0, 0.0), rd.xz / flat, flat > 1e-4);
  let white = looks.palette[2].rgb;
  let yellow = looks.palette[59].rgb;
  var c = col;
  // Lines whose bands are drawn round the nearest of their segments (so that a track's rails bend with it): white,
  // yellow, a cable car's, a streetcar's; how far, and the footprint's half-width across that segment.
  var near = array<f32, 4>(1e9, 1e9, 1e9, 1e9);
  var wide = array<f32, 4>(1.0, 1.0, 1.0, 1.0);
  var heading = array<vec2f, 4>(vec2f(0.0), vec2f(0.0), vec2f(0.0), vec2f(0.0));
  // And the nearest that crosses that one (more than 30 degrees off it): where two tracks cross, each keeps its rails
  // in the square their gauges share. A gentle bend's next segment is not one, or its round end would be a spur.
  var cross = array<f32, 4>(1e9, 1e9, 1e9, 1e9);
  var crossWide = array<f32, 4>(1.0, 1.0, 1.0, 1.0);
  let segs = marks[6];
  for (var i = first; i < last; i++) {
    let s = segs + marks[marks[5] + i] * 5u;
    let a = vec2f(vec2i(i32(marks[s]), i32(marks[s + 1u])) - oi);
    let b = vec2f(vec2i(i32(marks[s + 2u]), i32(marks[s + 3u])) - oi);
    let style = marks[s + 4u];
    let d = b - a;
    let l = length(d);
    if (l < 0.5) { continue; }
    let u = d / l;
    let r = p - a;
    let tt = dot(r, u);
    let side = r.x * u.y - r.y * u.x;
    // The footprint's half-width across the segment and along it.
    let q = vec2f(-u.y, u.x);
    let wq = max(0.5 * length(vec2f(along * dot(q, v), across * (q.x * v.y - q.y * v.x))), 0.01);
    let wu = max(0.5 * length(vec2f(along * dot(u, v), across * (u.x * v.y - u.y * v.x))), 0.01);
    let kind = style & 15u;
    let colour = (style >> 4u) & 3u;
    var paint = select(white, yellow, colour == 1u);
    var cover = 0.0;
    switch kind {
      // A dash of 3 m in every 9 m, 10 cm wide.
      case 2u: { cover = markBoth(side, 0.0, 0.5, wq) * markBand(tt, 0.0, l, wu) * markPeriodic(tt, 90.0, 30.0, wu); }
      // Continental bars: 60 cm wide and 60 cm apart along the crossing, 3 m long across it.
      case 4u: {
        cover = markBoth(side, 0.0, 15.0, wq) * markBand(tt, 2.0, l - 2.0, wu) * markPeriodic(tt - 2.0, 12.0, 6.0, wu);
        if (colour == 2u) {
          let bar = min(u32(max(floor(((tt - 2.0) / max(l - 4.0, 12.0)) * 6.0), 0.0)), 5u);
          let bow = array<vec3f, 6>(vec3f(0.62, 0.03, 0.03), vec3f(0.8, 0.25, 0.02), vec3f(0.85, 0.66, 0.05), vec3f(0.05, 0.4, 0.08), vec3f(0.03, 0.12, 0.55), vec3f(0.3, 0.04, 0.4));
          paint = bow[bar];
        }
      }
      // Two lines either side of the crossing.
      case 5u: { cover = markBoth(side, 13.0, 15.0, wq) * markBand(tt, 0.0, l, wu); }
      default: {
        var slot = -1;
        if (kind == 1u) { slot = 0; } else if (kind == 3u) { slot = 1; } else if (kind == 6u) { slot = 2; } else if (kind == 7u) { slot = 3; }
        if (slot >= 0) {
          let dist = length(r - u * clamp(tt, 0.0, l));
          if (dist < near[slot]) { near[slot] = dist; wide[slot] = wq; heading[slot] = u; }
        }
      }
    }
    c = mix(c, paint, cover);
  }
  if (min(min(near[0], near[1]), min(near[2], near[3])) < 12.0) {
    for (var i = first; i < last; i++) {
      let s = segs + marks[marks[5] + i] * 5u;
      let kind = marks[s + 4u] & 15u;
      var slot = -1;
      if (kind == 1u) { slot = 0; } else if (kind == 3u) { slot = 1; } else if (kind == 6u) { slot = 2; } else if (kind == 7u) { slot = 3; }
      if (slot < 0 || near[slot] > 12.0) { continue; }
      let a = vec2f(vec2i(i32(marks[s]), i32(marks[s + 1u])) - oi);
      let d = vec2f(vec2i(i32(marks[s + 2u]), i32(marks[s + 3u])) - oi) - a;
      let l = length(d);
      if (l < 0.5) { continue; }
      let u = d / l;
      if (abs(dot(u, heading[slot])) > 0.866) { continue; }
      // Only beside it, not round its ends: a branch's or a tight curve's clamped end drew a ring of rail.
      let ta = dot(p - a, u);
      if (ta < 0.0 || ta > l) { continue; }
      let dist = abs((p - a).x * u.y - (p - a).y * u.x);
      if (dist < cross[slot]) { cross[slot] = dist; crossWide[slot] = max(0.5 * length(vec2f(along * dot(vec2f(-u.y, u.x), v), across * (-u.y * v.y - u.x * v.x))), 0.01); }
    }
  }
  for (var k = 0u; k < 4u; k++) {
    c = markLines(c, k, near[k], wide[k]);
    if (cross[k] < 12.0) { c = markLines(c, k, cross[k], crossWide[k]); }
  }
  return c;
}
`
