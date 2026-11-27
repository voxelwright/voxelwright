// The far model (#450): the city past the cell tiles' reach, as faces. Past a kilometre the world's cells are boxes
// of 6.4 m and more, and a tower is a plain mass; so the city is also baked outside the page as the outside faces
// of the lidar's columns, half a metre a cell (sf/far/bake.py, and #423's place matte.py for the Ina wedge), packed
// into tiles of 500 m on the frame's grid (sf/far/pack.mjs). This draws them past `reach` from the eye, where the
// march leaves what its cells met in a tile this holds (march.ts `farCover`): cells near, faces far, never both.
//
// A tile comes in three bands by the size of its faces (4 m and over, 1 to 4 m, under 1 m): a far tile needs only
// the first, and the rest are fetched as the eye comes near. Inside a band a section's faces are biggest first, so
// each frame draws a prefix of them: those at least `detail` pixels across at that distance. A face that looks away
// from the eye is dropped in the vertex shader. Faces are #423's (page/matte.ts on PR 433): 20 bytes each.
//
// A listing may also have the landing's own cut (`landing`, sf/far/landing.mjs): of every band, only the faces seen
// from the landing's eye, one object a tile, about a hundredth of them. From that eye they draw the same skyline as
// every band together. While the eye is there and until `shown` (the page says it once the visitor leaves the first
// view: main.ts, #523), only they are fetched for the tiles in the view, the biggest on the screen first, and a tile
// they cover is whole; a tile draws them until every band it needs is here, and then lets them go. Away from that eye
// they are not used.
//
// In #423's wedge (`wedge`, sf/far/pack.mjs) the faces are a quarter of a metre (half a metre past 700 m from its apex)
// and laid out with the streets, finer than the cells of 40 cm and more past 100 m: there they begin at `farnear`
// through a lens narrower than 50 degrees (NARROW). A cell of the march's boxes is a 512th to a 256th of its distance
// (world.ts: 16 sectors of 64 cells across, each box twice the last), so through the landing's 25 degree lens every
// cell is 3 to 7 pixels across and the foreground stood in steps against the streets; at 70 degrees they are one or
// two, and the cells (with their painted walls) are kept.
//
//   ?farreach=500        metres from the eye where faces begin (0: no far model)
//   ?farnear=100         metres from the eye where they begin in the wedge
//   ?farlight=3.44,1.23  the faces' light, fill and gain (the listing's `light`: #423's, which their colours were fitted under)
//   ?fardetail=0.75      how many pixels across a face must be to be drawn
//   ?farlanding=<url>    a landing cut's landing.json (sf/far/landing.mjs), for a release that does not list one
//   ?farcutfit=1.6       how many times taller than the cut's tallest picture it is still trusted as the whole of the landing's
import { DEPTH, FAR, NEAR, shader, type Target } from '../probe/gpu.ts'
import { AIR, EDITED, EDITS, FOG, GLOBALS, HANDOVER, LANDMARK_LIGHT, LEAF_NIGHT, LIGHT, NIGHT_WALL, NOISE, PANE_LIGHT, SCREEN, bounded, type Marcher, type View } from './march.ts'
import { BUDGET as HELD } from './bay.ts'
import { LOCKERS, SLOTS } from './lockers.ts'

const query = new URLSearchParams(globalThis.location?.search ?? '')

/**
 * A path an address names for the far model or its landing cut (`?far=`, `?farlanding=`), where it is one of this
 * site's own: a path from here with no scheme, no `//`, no `..` and no backslash, that stays on this origin. Else null
 * (#81): a link must not swap the skyline for someone else's, or have the page tell another server who is looking.
 */
export function samePath(said: string | null | undefined, here: string = globalThis.location?.href ?? 'https://invalid/'): string | null {
  if (typeof said !== 'string' || !said || said.length > 512) return null
  let plain: string
  try { plain = decodeURIComponent(said) } catch { return null }
  for (const s of [said, plain]) if (/^[a-z][a-z0-9+.-]*:/i.test(s) || s.includes('//') || s.includes('\\') || /(^|\/)\.\.(\/|$)/.test(s) || /[\u0000-\u001f]/.test(s)) return null
  try { const u = new URL(said, here); return u.origin === new URL(here).origin ? u.href : null } catch { return null }
}

const CODE = /* wgsl */ `
struct V {
  eye: vec3f, tanHalf: f32,
  right: vec3f, aspect: f32,
  up: vec3f, reach: f32,
  forward: vec3f, shaded: f32,
  sun: vec3f, pixel: f32,
  wedge: vec4f, bear: vec4f,
  light: vec4f,
  keep0: vec4f, keep1: vec4f,
  edits: array<vec4f, ${2 * EDITS}>,
}
// A section: where its low corner is (from the anchor) and its cell; where it is in its own frame (for windows that
// run on from one to the next); its turn, a column at a time.
// A landmark's section (whole 1) has every face drawn, each at least a pixel across. A tree's crown (whole 2) is
// leaf: by night it takes the city's glow and the street's lamps (LEAF_NIGHT).
struct B { pos: vec3f, cell: f32, nth: u32, u0: f32, w0: f32, whole: u32, c0: vec3f, pad3: f32, c2: vec3f, pad4: f32 }
struct Style { size: vec4f, glass: vec4f }
struct Styles { s: array<Style, 16> }
@group(0) @binding(0) var<uniform> v: V;
${GLOBALS}
@group(0) @binding(1) var<uniform> g: Globals;
@group(0) @binding(2) var<uniform> styles: Styles;
@group(0) @binding(3) var marched: texture_depth_2d;
@group(0) @binding(4) var screen: texture_2d<f32>;
// The eggs' lockers (lockers.ts): which windows hold an egg, as a table looked up by the window.
@group(0) @binding(5) var<storage, read> lockers: array<vec4u>;
@group(1) @binding(0) var<uniform> b: B;
${LIGHT}
${AIR}
${HANDOVER}
${EDITED('v.edits')}
${NOISE}
${FOG}
${SCREEN}
${NIGHT_WALL}
${LOCKERS}
${LANDMARK_LIGHT}
${LEAF_NIGHT}
struct Out {
  @builtin(position) pos: vec4f,
  @location(0) seen: vec3f,
  @location(1) @interpolate(flat) n: vec3f,
  @location(2) @interpolate(flat) rgb: vec3f,
  @location(3) @interpolate(flat) shade: f32,
  @location(4) high: f32,
  @location(5) @interpolate(flat) id: u32,
  @location(6) @interpolate(flat) style: u32,
  @location(7) along: f32,
  @location(8) @interpolate(flat) way: u32,
}
// The march's depth (march.ts fs), to leave what its cells hide.
const NEAR = 1.0;
const FAR = 100000.0;
@vertex fn vs(@builtin(vertex_index) vi: u32, @location(0) w0: u32, @location(1) w1: u32, @location(2) w2: u32, @location(3) w3: u32, @location(4) w4: u32) -> Out {
  let x = f32(w0 & 0x7ffu);
  let z = f32((w0 >> 11u) & 0x7ffu);
  let lu = f32(w0 >> 22u);
  let y0 = f32(w1 & 0xffffu);
  let y1 = f32(w1 >> 16u);
  let lw = f32(w2 & 0x3ffu);
  let axis = (w2 >> 10u) & 3u;
  let side = f32((w2 >> 12u) & 1u);
  let cu = f32(vi & 1u);
  let cv = f32((vi >> 1u) & 1u);
  var p: vec3f;
  var n: vec3f;
  // A landmark's faces are a cell high and its grid's breadth across: from far they are under a pixel and fall
  // between pixels, and the sky shows through the tower. Each is grown about its middle to a pixel each way.
  var grow = vec2f(0.0);
  if (b.whole == 1u) {
    let mid = b.pos + b.c0 * ((x + lu * 0.5) * b.cell) + vec3f(0.0, (y0 + y1) * 0.5, 0.0) + b.c2 * ((z + lw * 0.5) * b.cell) - v.eye;
    let least = max(dot(mid, v.forward), 1.0) * v.pixel;
    let across = select(select(vec2f(lu * b.cell, y1 - y0), vec2f(lw * b.cell, y1 - y0), axis == 1u), vec2f(lu * b.cell, lw * b.cell), axis == 0u);
    grow = max(vec2f(least) - across, vec2f(0.0)) * (vec2f(cu, cv) - 0.5);
  }
  if (axis == 0u) { p = vec3f(x + cu * lu + grow.x / b.cell, y1, z + cv * lw + grow.y / b.cell); n = vec3f(0.0, 1.0, 0.0); }
  else if (axis == 1u) { p = vec3f(x + side, mix(y0, y1, cv) + grow.y, z + cu * lw + grow.x / b.cell); n = b.c0 * (side * 2.0 - 1.0); }
  else { p = vec3f(x + cu * lu + grow.x / b.cell, mix(y0, y1, cv) + grow.y, z + side); n = b.c2 * (side * 2.0 - 1.0); }
  let world = b.pos + b.c0 * (p.x * b.cell) + vec3f(0.0, p.y, 0.0) + b.c2 * (p.z * b.cell) - v.eye;
  var out: Out;
  out.seen = world;
  out.n = n;
  out.rgb = pow(vec3f(f32((w3 >> 16u) & 255u), f32((w3 >> 8u) & 255u), f32(w3 & 255u)) / 255.0, vec3f(2.2));
  out.shade = f32((w2 >> 13u) & 0xffffu);
  out.high = p.y;
  out.id = w4;
  out.way = select(2u + (axis - 1u) * 2u + u32(side), 1u, axis == 0u);
  out.style = w3 >> 24u;
  out.along = select(select(b.u0 + p.x * b.cell * 0.1, b.w0 + p.z * b.cell * 0.1, axis == 1u), 0.0, axis == 0u);
  // Depth as one over the distance along the look: what is nearer wins (greater), and a tower 10 km off keeps as
  // much of it as a wall 500 m off. A face that looks away from the eye is put behind it, and drawn by no pixel.
  let d = dot(world, v.forward);
  out.pos = vec4f(dot(world, v.right) / (v.tanHalf * v.aspect), dot(world, v.up) / v.tanHalf, 1.0, d);
  if (dot(n, world) >= 0.0) { out.pos = vec4f(0.0, 0.0, -1.0, 1.0); }
  return out;
}
// Whether this point is the far model's to draw: not behind what the march met, and past the reach; or a tenth nearer
// at most, on a look where the march met the ground or the sea only past the reach (the cells' coarse boxes and the faces do
// not agree to the metre where they meet, and a look the march hands over must find the far model's faces). Never
// nearer than the reach against the sky: what stands near the eye is the cells' to say.
fn ours(in: Out) -> bool {
  // Where the world was changed, the cells hold the change, however far off.
  if (edited(in.seen)) { return false; }
  let dist = length(in.seen);
  let reach = reachAt(in.seen, v.reach, v.wedge, v.bear, v.keep0, v.keep1);
  let z = textureLoad(marched, vec2i(in.pos.xy), 0);
  if (z >= 1.0) { return dist >= reach; }
  let along = dot(in.seen, v.forward);
  let met = NEAR / max(1.0 - z * (FAR - NEAR) / FAR, 1e-9);
  // Nearer than the reach, only a tenth short of it, and only on a look the march met nothing on before the reach where
  // it met something (a look it hands over meets the sea, kilometres off). Nearer, what the cells lack is not the far
  // model's to add: up Grant Ave, past where the far model begins 100 m off, the march had handed the street over and
  // the far model drew a building's columns 15 m off across it.
  let metAt = in.seen * (met / max(along, 1e-3));
  if (dist < reach && (dist < reach * 0.9 || length(metAt) < reachAt(metAt, v.reach, v.wedge, v.bear, v.keep0, v.keep1))) { return false; }
  return along < met;
}
struct Drawn { @location(0) colour: vec4f }
@fragment fn fs(in: Out) -> Drawn {
  if (!ours(in)) { discard; }
  // Windows: a pane in each bay of each storey. Where a bay is less than two pixels wide the wall is the two mixed.
  let st = styles.s[min(in.style, 15u)];
  let fx = in.along / max(st.size.y, 0.01);
  let fy = in.high * 0.1 / max(st.size.x, 0.01);
  let ax = max(fwidth(fx), 0.0001);
  let ay = max(fwidth(fy), 0.0001);
  // (How much of a metre along the wall and up it a pixel covers: for a landmark's glass, whose grid is its own.)
  let along1 = fwidth(in.along);
  let high1 = fwidth(in.high * 0.1);
  var pane = within(fract(fx), 0.5 - st.size.z * 0.5, 0.5 + st.size.z * 0.5, ax) * within(fract(fy), 0.26, 0.26 + st.size.w, ay);
  let blur = smoothstep(0.3, 0.8, max(ax, ay));
  // (Its glass as drawn sharp: a locker's light fills it, lockers.ts.)
  let sharp = pane;
  pane = mix(pane, st.size.z * st.size.w, blur) * f32(in.style != 0u && in.style < 14u);
  let dist = max(length(in.seen), 1.0);
  let rd = in.seen / dist;
  // The bake's shadows are for its own sun: used only while the sun stands there (v.shaded), else a face is lit by
  // which way it looks.
  let lit = select(1.0, step(in.shade, in.high + 0.5), v.shaded > 0.5);
  let direct = max(dot(in.n, v.sun), 0.0) * lit;
  var paint = mix(in.rgb, st.glass.rgb, pane);
  var rough = mix(0.9, 0.35, pane);
  var col = shade(paint, in.n, rd, v.sun, direct, 1.0, rough, 0.0);
  // The light the faces' colours were fitted under (#423's light.json): the sky's and the ground's light fill times the
  // engine's, the whole gain times brighter. Drawn in the engine's own, the wedge's walls were a third darker than
  // the photograph, and its foreground (100 m on, through the park's lens) darker still. Only in the wedge, where the
  // faces take over at 100 m (HANDOVER): the photograph vouches for no more. Out of it (or through a wider lens),
  // downtown's faces lit so stood at 150 against the cells' 89 beside them.
  if (v.light.x != 1.0 || v.light.y != 1.0) {
    if (inWedge(in.seen, v.wedge, v.bear)) {
      col = (col + (v.light.x - 1.0) * shade(paint, in.n, rd, v.sun, 0.0, 1.0, rough, 0.0)) * v.light.y;
    }
  }
  if (in.style == 15u) {
    // A landmark's glass shows what is across from it, which from far is the sky a little darker.
    let facing = 1.0 - max(dot(-rd, in.n), 0.0);
    col = mix(col, skyBase(reflect(rd, in.n)) * 0.8, clamp(0.25 + 0.75 * (0.04 + 0.96 * pow(facing, 5.0)), 0.0, 1.0));
  }
  // A window that is one of the eggs' lockers (lockers.ts, eggs-lockers.ts) has its own light in its pane, by day as by
  // night, in place of its room's and of its glass; while the window screen is up it is one of the screen's panes.
  // Where its pane is under two pixels across, the pixel its bay falls in is lit whole: a point of light, not a smear.
  var locker = 0.0;
  let lockersShown = bitcast<f32>(lockers[0].z);
  if (lockersShown > 0.0 && in.style != 0u && in.style < 14u && abs(in.n.y) < 0.5) {
    let found = lockerAt(in.id & 0xffffffu, in.way, i32(floor(fx)), i32(floor(fy)));
    if (found.x > 0u) {
      let glass = mix(sharp, 1.0, blur);
      let hot = select(0.0, 1.0, lockers[0].y == found.y + 1u);
      // (Its pane is its light, lockers.ts; under the pointer the light spills onto the wall round the pane, an eighth as
      // bright. It stays lit while the window screen is up only under the pointer: the rest are the screen's then.)
      let light = lockerLight(found, g.time, clamp(g.weather.z * 3.0, 0.0, 1.0));
      locker = glass * lockersShown * (1.0 - g.air.z * (1.0 - hot));
      col = mix(col, light, locker) + light * (1.0 - glass) * 0.12 * hot * lockersShown;
    }
  }
  if (g.weather.z > 0.0) {
    let dark = clamp(g.weather.z * 3.0, 0.0, 1.0);
    // Where the point is as the march measures (from its corner near the eye), and how many metres a pixel is there.
    let at = in.seen + g.eye;
    let wide = max(dot(in.seen, v.forward), 1.0) * v.pixel * 0.1;
    // The wall's windows: a styled face's by its style. A landmark's glass has none (its faces come from its rule, which
    // draws its own), and while windows' light and the window screen were for styled faces alone, Salesforce Tower
    // stood dark over a lit city and took no part in what the city's windows show (the Matrix's rain, eggs.ts). So a
    // landmark's glass is given a grid of windows here and then goes the one way every wall goes, below: where its
    // rule says a storey and a bay (heroes.rs night: a wall of glass from floor to floor) by those, under its own
    // lit part; where it says none, its glass is its windows already, each face of it a room's.
    var lit = in.style != 0u && in.style < 14u;
    var wx = fx; var wy = fy; var bx = ax; var by = ay;
    var pw = st.size.z; var y0 = 0.26; var ph = st.size.w;
    var panes = pane;
    var least = 0.0;
    // How much of the window screen its panes show: all of it, but a wall of glass from floor to floor is twice the
    // pane a wall with windows is, and showed the Matrix's rain two and a half times as strong as the towers round it.
    var shows = 1.0;
    if (in.style == 15u && abs(in.n.y) < 0.5) {
      var storey = 3.5;
      var bay = 3.0;
      var up = in.high * 0.1;
      var under = 1e9;
      pw = 1.0; y0 = 0.0; ph = 1.0;
      for (var i = 0u; i < 8u; i++) {
        let h = g.beacon[i];
        if (h.more.w <= 0.0) { break; }
        let q = (at - h.at.xyz) * 0.1;
        if (length(q.xz) > h.more.w) { continue; }
        up = q.y;
        // (A tower of glass from floor to floor is let to firms that work late: two fifths of it are lit, where a building's share falls out a sixth to a half. Left to that chance, Salesforce Tower drew a fifth and stood dim among brighter towers.)
        if (h.more.y > 0.0) { storey = h.more.y; bay = h.more.z; pw = 0.86; y0 = 0.2; ph = 0.62; least = 0.42; shows = 0.6; }
        if (h.colour.a > 0.0) { under = h.span.x; }
        break;
      }
      lit = up < under;
      wx = in.along / bay; wy = up / storey; bx = max(along1 / bay, 0.0001); by = max(high1 / storey, 0.0001);
      panes = mix(within(fract(wx), 0.5 - pw * 0.5, 0.5 + pw * 0.5, bx) * within(fract(wy), y0, y0 + ph, by), pw * ph, smoothstep(0.3, 0.8, max(bx, by)));
    }
    // At night a room with someone home is lit (as the march's windows): rows of panes, a floor and a run of bays at
    // a time, which fade into the wall's own glow as they go under two pixels (march.ts NIGHT_WALL).
    if (lit) {
      let wall = nightWall(wx, wy, bx, by, pw, y0, ph, in.id + in.way * 7919u, least);
      // The window screen (march.ts SCREEN, eggs.ts): the panes show the picture where they are in the view, and their
      // own lamps as much as it leaves on.
      let pic = screenAt(in.pos.xy / vec2f(textureDimensions(marched)));
      // (A pane some pixels across is a lit room and no lamp, march.ts PANE_LIGHT: from a pixel and a half wide to four.)
      let near = smoothstep(1.5, 4.0, pw / bx);
      col += wall.rgb * wall.a * dark * mix(mix(2.4, ${PANE_LIGHT}, near), 1.5, smoothstep(0.3, 0.8, bx)) * (1.0 - pic.a) * (1.0 - locker) + pic.rgb * panes * shows * 2.4;
    }
    // A tree's crown in a city at night is not black (march.ts LEAF_NIGHT).
    if (b.whole == 2u) { col += leafNight(in.rgb, in.n, at) * dark; }
    // A landmark's own light (heroes.rs night, march.ts LANDMARK_LIGHT): its crown, its spire. Its lamps are the city's
    // too: what the windows show, the crown's screen shows, and its own light as much as that leaves on.
    let own = landmarkLight(at, wide);
    if (own.r + own.g + own.b > 0.0) {
      let shown = screenAt(in.pos.xy / vec2f(textureDimensions(marched)));
      // (As much of it as its own windows show, measured: half, where every pixel of a lit part is lamp and a wall is one
      // part in four pane. Whole, the crown was the brightest thing in the Matrix; a sixth was measured under its fog,
      // which lay over the shaft and not the crown, and under the cloud that replaced it the crown was a dark cap, #450.)
      col += own * dark * (1.0 - shown.a) + shown.rgb * min(own.g, 1.0) * 0.5;
    }
    col += landmarkLamp(at) * dark;
  }
  col = air(col, rd, dist);
  // The march's fog (FOG), as over the cells: the faces begin 100 m off in the wedge, and the bank had stopped there.
  if (g.fog.x > 0.0) { col = inFog(col, rd, dist); }
  // Beside the colour, how far brighter than any lit surface the pixel is, as the march writes it (glow.ts reads it).
  return Drawn(vec4f(tone(col), 1.0 - clamp((max(col.r, max(col.g, col.b)) - 1.2) / 3.0, 0.0, 1.0)));
}
// Each pixel's window as the lockers know it (lockers.ts, Key): its building's number, its way, whether it is a
// wall with windows (flag 1) and in a pane's glass (flag 2); its bay; its storey; its style. Beside it, where the
// point is from the eye (cells). For placing the lockers where the landing's eye sees them (main.ts lockerWindows).
struct Keys { @location(0) key: vec4u, @location(1) at: vec4f }
@fragment fn fsKeys(in: Out) -> Keys {
  if (!ours(in)) { discard; }
  let st = styles.s[min(in.style, 15u)];
  let fx = in.along / max(st.size.y, 0.01);
  let fy = in.high * 0.1 / max(st.size.x, 0.01);
  let ax = max(fwidth(fx), 0.0001);
  let ay = max(fwidth(fy), 0.0001);
  let pane = within(fract(fx), 0.5 - st.size.z * 0.5, 0.5 + st.size.z * 0.5, ax) * within(fract(fy), 0.26, 0.26 + st.size.w, ay);
  let flags = select(0u, 1u, in.style != 0u && in.style < 14u && abs(in.n.y) < 0.5) | select(0u, 2u, pane > 0.5);
  return Keys(vec4u((in.id & 0xffffffu) | (in.way << 24u) | (flags << 28u), bitcast<u32>(i32(floor(fx))), bitcast<u32>(i32(floor(fy))), in.style), vec4f(in.seen, 1.0));
}
// Each pixel's building, and which way its face looks (1 up, 2 to 5 the walls): for measuring.
@fragment fn fsIds(in: Out) -> @location(0) vec4f {
  if (!ours(in)) { discard; }
  return vec4f(f32(in.id & 255u) / 255.0, f32((in.id >> 8u) & 255u) / 255.0, f32((in.id >> 16u) & 255u) / 255.0, f32(in.way) / 255.0);
}
`

// What the far model drew, into the picture's depth as the march writes it (one over the distance along the look,
// to the march's 0 to 1): what is drawn among the cells after it (cars, people, crumbs) is hidden by its faces. Its
// faces begin 100 m off in the wedge, where the street's cars had shown through them.
const MERGE = /* wgsl */ `
@group(0) @binding(0) var faces: texture_depth_2d;
@vertex fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
  let uv = vec2f(f32((i << 1u) & 2u), f32(i & 2u));
  return vec4f(uv * 2.0 - 1.0, 0.0, 1.0);
}
@fragment fn fs(@builtin(position) at: vec4f) -> @builtin(frag_depth) f32 {
  let z = textureLoad(faces, vec2i(at.xy), 0);
  if (z <= 0.0) { discard; }
  return clamp(${FAR.toFixed(1)} / (${FAR.toFixed(1)} - ${NEAR.toFixed(1)}) * (1.0 - ${NEAR.toFixed(1)} * z), 0.0, 1.0);
}
`

/** The far model's listing (pack.mjs `far.json`, the release manifest's `far` asked for on #450). */
export interface Listing {
  size: number
  bands: number[]
  lods: number[]
  tiles: Record<string, (Rec | null)[]>
  credit?: string
  /** The landing's cut: where its eye is (cells), and one object a tile, its paths from the manifest as the bands' are. */
  landing?: Landing
  /** #423's wedge, whose faces are finer: its apex (cells, x and z), the compass bearings it lies between and how far it reaches (metres). */
  wedge?: { at: [number, number]; from: number; to: number; far: number }
  /** The light the faces' colours were fitted under (#423's light.json): the sky's and the ground's light `fill` times the engine's, the whole `gain` times brighter. */
  light?: { fill: number; gain: number }
}
type Rec = { path: string; bytes: number; sha256: string }
interface Landing { eye: [number, number, number]; tiles: Record<string, Rec>; reach?: number; fov?: number; size?: [number, number]; yaw?: number; pitch?: number; heights?: number[] }
interface Section { layer: string; pos: [number, number, number]; cell: number; c0: number[]; c2: number[]; uw: [number, number]; start: number; count: number; runs: { way: number; start: number; count: number; lods: number[] }[]; lo: number[]; hi: number[] }
interface Head { sections: Section[]; styles: { storey: number; bay: number; wide: number; tall: number; glass: number[] }[]; sun: { vector: [number, number, number] } | null; grouped: boolean }

export interface Far {
  readonly listing: Listing | null
  /** Draws the far model into `to`, after the march (whose depth it reads) and before what is drawn among the cells. */
  draw(encoder: GPUCommandEncoder, to: Target, view: View): void
  /** Each pixel's building number and way as the far model draws it over `to`'s depth, into `ids` (cleared): for measuring. */
  drawIds(encoder: GPUCommandEncoder, ids: GPUTextureView, depth: GPUTextureView, size: readonly [number, number], view: View): void
  /** Each pixel's window (fsKeys) into `keys` (rgba32uint) and where it is from the eye into `at` (rgba32float), both cleared: for placing the eggs' lockers. Resolves once it is in `encoder`. */
  drawKeys(encoder: GPUCommandEncoder, keys: GPUTextureView, at: GPUTextureView, depth: GPUTextureView, size: readonly [number, number], view: View): Promise<void>
  /** The eggs' lockers (lockers.ts `table`): every window that holds one, laid in the table the faces look windows up in. */
  lockers(words: Uint32Array<ArrayBuffer>): void
  /** The lockers' header after its mask (lockers.ts `header`): the one under the pointer, how far they are shown, the flash. */
  lockerHeader(words: Uint32Array<ArrayBuffer>): void
  /** Metres from the eye where faces begin. */
  reach: number
  /** Metres from the eye where faces begin in the listing's wedge. */
  near: number
  /** Pixels across a face must be to be drawn. */
  detail: number
  /** What the last frame drew, and what is held. */
  readonly stats: { faces: number; sections: number; tiles: number; held: number; heldBytes: number; fetched: number; fetchedBytes: number; coming: number; covered: number; failed: number; error: string }
  /** Whether every band the view needs is here. */
  readonly whole: boolean
  /** Whether the first picture's share is here: at the landing, its cut of every tile in the view (each held, or asked and failed). */
  readonly ready: boolean
  /** The place was shown: from now each tile in the view has every band it needs where the landing's cut is not its whole picture. */
  shown(): void
  /** The first view was left (main.ts, #523): from now the rest is fetched (finer bands, the tiles out of the view). */
  left(): void
  /** The objects held now, by their addresses (the listing's paths from where it is): for counting what a view costs to send. */
  held(): string[]
  /**
   * The world changed in this box (finest cells, high corner exclusive): the far model leaves the box (a little wider)
   * to the cells, which hold the change, however far off; the rest of its tiles it draws as before. Boxes near one
   * another are one; past EDITS of them, the tiles a further box reaches are the cells' whole, as before #450's X tower
   * (a cell broken on the EXPLORE roof had taken the tower beside it out of the first view). `forget` (a reset) takes them back.
   */
  edited(box: readonly [number, number, number, number, number, number]): void
  forget(): void
  /** A box (finest cells, low and high corners) that stays the cells' out to the reach in the wedge, or null: a lettering board's (boards.ts). */
  keep(box: readonly number[] | null): void
  /**
   * How far from the eye faces take over from cells for what stands at a point (finest cells, x and z), as the last
   * draw had it: the reach, or in the wedge through a narrow lens the nearer one. Cells; Infinity where nothing is drawn as faces.
   */
  handover(x: number, z: number): number
  /** The far model's own depth as the last draw left it (one over the distance along the look; 0 where nothing), for the fog (fog.ts). */
  readonly depth: GPUTextureView | null
}

/** The far model whose listing is at `base`far.json (a folder beside the page) or in the release manifest `base` names, or one that draws nothing. */
export async function far(device: GPUDevice, format: GPUTextureFormat, march: Marcher, base: string | null): Promise<Far> {
  const stats = { faces: 0, sections: 0, tiles: 0, held: 0, heldBytes: 0, fetched: 0, fetchedBytes: 0, coming: 0, covered: 0, failed: 0, error: '' }
  const none: Far = { listing: null, draw() {}, drawIds() {}, drawKeys: async () => {}, lockers() {}, lockerHeader() {}, reach: 0, near: 0, detail: 1, stats, whole: true, ready: true, shown() {}, left() {}, depth: null, held: () => [], edited() {}, forget() {}, keep() {}, handover: () => Infinity }
  const reachAsked = bounded(query.get('farreach'), 500, 0, 20_000)
  if (!base || reachAsked <= 0) return none
  // A folder with far.json in it, or a release's manifest (engine/sf/release.md), whose `far` is the same listing.
  const file = base.endsWith('.json') ? base : `${base}far.json`
  base = file.slice(0, file.lastIndexOf('/') + 1)
  const listing = await fetch(file).then((r) => (r.ok ? (r.json() as Promise<Listing & { far?: Listing }>) : null)).then((l) => l?.far ?? l).catch(() => null)
  if (!listing || !Object.keys(listing.tiles).length) return none
  // The landing's cut: the release's, or one asked for by address (its own landing.json, its paths from there).
  const landingAt = samePath(query.get('farlanding'))
  const landing: (Landing & { base: string }) | null = landingAt
    ? await fetch(landingAt).then((r) => (r.ok ? (r.json() as Promise<Landing>) : null)).then((l) => (l ? { ...l, base: new URL('.', new URL(landingAt, location.href)).href } : null)).catch(() => null)
    : listing.landing ? { ...listing.landing, base } : null

  const module = await shader(device, 'far', CODE)
  const vertex: GPUVertexState = { module, entryPoint: 'vs', buffers: [{ arrayStride: 20, stepMode: 'instance', attributes: [0, 1, 2, 3, 4].map((n) => ({ shaderLocation: n, offset: n * 4, format: 'uint32' as const })) }] }
  const F = GPUShaderStage.FRAGMENT, VF = GPUShaderStage.VERTEX | F
  const viewLayout = device.createBindGroupLayout({ entries: [{ binding: 0, visibility: VF, buffer: {} }, { binding: 1, visibility: VF, buffer: {} }, { binding: 2, visibility: F, buffer: {} }, { binding: 3, visibility: F, texture: { sampleType: 'depth' } }, { binding: 4, visibility: F, texture: {} }, { binding: 5, visibility: F, buffer: { type: 'read-only-storage' } }] })
  const blockLayout = device.createBindGroupLayout({ entries: [{ binding: 0, visibility: VF, buffer: { hasDynamicOffset: true, minBindingSize: 64 } }] })
  const layout = device.createPipelineLayout({ bindGroupLayouts: [viewLayout, blockLayout] })
  const pipelineFor = (entry: string, ...targets: GPUTextureFormat[]) => device.createRenderPipelineAsync({
    label: `far ${entry}`, layout, vertex, fragment: { module, entryPoint: entry, targets: targets.map((format) => ({ format })) },
    primitive: { topology: 'triangle-strip', cullMode: 'none' },
    depthStencil: { format: 'depth32float', depthWriteEnabled: true, depthCompare: 'greater' },
  })
  const [picture, numbers] = await Promise.all([pipelineFor('fs', format), pipelineFor('fsIds', format)])
  // (The windows' keys are for placing the eggs' lockers, by the tools: made the first time they are asked for.)
  let keyed: Promise<GPURenderPipeline> | null = null
  const mergeModule = await shader(device, 'far depth', MERGE)
  const merging = await device.createRenderPipelineAsync({
    label: 'far depth', layout: 'auto', vertex: { module: mergeModule, entryPoint: 'vs' }, fragment: { module: mergeModule, entryPoint: 'fs', targets: [] },
    depthStencil: { format: DEPTH, depthWriteEnabled: true, depthCompare: 'less' },
  })
  const mergeBinds = new WeakMap<GPUTextureView, GPUBindGroup>()
  const uniforms = device.createBuffer({ size: 160 + EDITS * 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST })
  const windows = device.createBuffer({ size: 16 * 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST })
  // The lockers' table (lockers.ts): empty (mask 0) until the eggs lay theirs in it.
  const lockerTable = device.createBuffer({ label: 'lockers', size: (SLOTS + 1) * 16, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST })
  let styled = false
  let sunBaked: [number, number, number] | null = null

  // ── Shared dynamic-offset uniform buffer for all section blocks (#83) ──
  // Replaces thousands of per-section 64 B GPUBuffers and GPUBindGroups with one aligned slab and a slot free-list.
  const blockStride = Math.max(64, device.limits.minUniformBufferOffsetAlignment)
  let blockCap = 512, blockUsed = 0
  const blockFree: number[] = []
  let blockMirror = new Uint8Array(blockCap * blockStride)
  let blockBuf = device.createBuffer({ label: 'far sections', size: blockCap * blockStride, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST })
  let blockBind = device.createBindGroup({ layout: blockLayout, entries: [{ binding: 0, resource: { buffer: blockBuf, size: 64 } }] })
  const secBytes = new Uint8Array(64)
  const secF32 = new Float32Array(secBytes.buffer)
  const secU32 = new Uint32Array(secBytes.buffer)
  const allocBlock = (data: Uint8Array<ArrayBuffer>): number => {
    const slot = blockFree.length ? blockFree.pop()! : blockUsed++
    if (slot >= blockCap) {
      while (slot >= blockCap) blockCap *= 2
      const next = new Uint8Array(blockCap * blockStride)
      next.set(blockMirror)
      blockMirror = next
      blockBuf.destroy()
      blockBuf = device.createBuffer({ label: 'far sections', size: blockCap * blockStride, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST })
      device.queue.writeBuffer(blockBuf, 0, blockMirror, 0, blockUsed * blockStride)
      blockBind = device.createBindGroup({ layout: blockLayout, entries: [{ binding: 0, resource: { buffer: blockBuf, size: 64 } }] })
    }
    blockMirror.set(data, slot * blockStride)
    device.queue.writeBuffer(blockBuf, slot * blockStride, data)
    return slot
  }

  // ── Tiles ──
  const size = listing.size, bands = listing.bands, lods = listing.lods
  interface Held { band: number; buffer: GPUBuffer; bytes: number; sections: { s: Section; slot: number; mid: number[] }[]; used: number }
  /** Lets a band's buffers go: destroys its face buffer and recycles its sections' uniform slots. */
  const drop = (h: Held) => { h.buffer.destroy(); for (const s of h.sections) blockFree.push(s.slot) }
  // A tile's slots: its bands, then (last) the landing's cut of it.
  interface Tile { key: string; x: number; z: number; lo: number[]; hi: number[]; bounded: boolean; listed: boolean[]; recs: (Rec | null)[]; held: (Held | null | 'coming')[]; retry: number[]; fails: number[]; full: boolean }
  const C = bands.length
  const tiles: Tile[] = Object.entries(listing.tiles).map(([key, listed]) => {
    const [x, z] = key.split('_').map(Number)
    const cut = landing?.tiles[key]
    const recs = [...listed, cut ? { ...cut, path: new URL(cut.path, new URL(landing!.base, location.href)).href } : null]
    return { key, x, z, lo: [x * size, -2000, z * size], hi: [(x + 1) * size, 6000, (z + 1) * size], bounded: false, listed: recs.map(Boolean), recs, held: recs.map(() => null), retry: recs.map(() => 0), fails: recs.map(() => 0), full: false }
  })
  const keys = tiles.map((t) => [t.x, t.z])
  const corner: [number, number] = [Math.min(...keys.map((k) => k[0])), Math.min(...keys.map((k) => k[1]))]
  const anchor = [corner[0] * size, 0, corner[1] * size]
  const cover = new Uint32Array(128)
  let covered = ''

  // Offload header JSON parsing and 20-byte grouped face de-interleaving to a worker (#83) so tile loads never hitch frames.
  type Unpacked = { head: Head; faces: Uint8Array<ArrayBuffer> }
  let unpacker: Worker | null = null
  let unpackSeq = 0
  const unpacking = new Map<number, { resolve: (u: Unpacked) => void; reject: (e: Error) => void }>()
  const unpackLocal = (buf: ArrayBuffer): Unpacked => {
    const bytes = new Uint8Array(buf)
    const length = new DataView(buf).getUint32(4, true)
    const head = JSON.parse(new TextDecoder().decode(bytes.subarray(8, 8 + length))) as Head
    let faces = bytes.subarray(8 + length)
    const n = faces.length / 20
    if (head.grouped) {
      const flat = new Uint8Array(faces.length)
      for (let j = 0; j < 20; j++) { const from = j * n; for (let i = 0; i < n; i++) flat[i * 20 + j] = faces[from + i] }
      faces = flat
    }
    return { head, faces }
  }
  const unpack = (buf: ArrayBuffer): Promise<Unpacked> => {
    if (typeof Worker === 'undefined') return Promise.resolve(unpackLocal(buf))
    if (!unpacker) {
      unpacker = new Worker(new URL('./far-unpack.ts', import.meta.url), { type: 'module' })
      unpacker.onmessage = (e: MessageEvent<{ id: number; head?: Head; buf?: ArrayBuffer; offset?: number; length?: number; error?: string }>) => {
        const job = unpacking.get(e.data.id)
        if (!job) return
        unpacking.delete(e.data.id)
        if (e.data.error || !e.data.head || !e.data.buf) job.reject(new Error(e.data.error ?? 'far unpack failed'))
        else job.resolve({ head: e.data.head, faces: new Uint8Array(e.data.buf, e.data.offset ?? 0, e.data.length) })
      }
      unpacker.onerror = () => {
        for (const job of unpacking.values()) job.reject(new Error('far unpack worker failed'))
        unpacking.clear()
        unpacker?.terminate()
        unpacker = null
      }
    }
    const id = ++unpackSeq
    return new Promise<Unpacked>((resolve, reject) => {
      unpacking.set(id, { resolve, reject })
      unpacker!.postMessage({ id, buf }, [buf])
    })
  }

  const load = async (t: Tile, band: number) => {
    const rec = t.recs[band]!
    t.held[band] = 'coming'
    stats.coming++
    try {
      const answer = await fetch(new URL(rec.path, new URL(base, location.href)))
      if (!answer.ok) throw new Error(`${answer.status}`)
      const raw = await answer.arrayBuffer()
      const wireBytes = raw.byteLength
      const { head, faces } = await unpack(raw)
      // The windows' styles from the first object that has them (a cut's are its bands').
      if (!styled && head.styles?.length) {
        const s = new Float32Array(16 * 8)
        for (const [k, st] of head.styles.slice(0, 16).entries()) s.set([st.storey, st.bay, st.wide, st.tall, ...st.glass.map((c) => (c / 255) ** 2.2), 0], k * 8)
        device.queue.writeBuffer(windows, 0, s)
        styled = true
      }
      if (head.sun && !sunBaked) sunBaked = head.sun.vector
      const buffer = device.createBuffer({ label: `far ${t.key}/${band}`, size: Math.max(20, faces.byteLength), usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST })
      device.queue.writeBuffer(buffer, 0, faces)
      const sections = head.sections.map((s) => {
        secF32[0] = s.pos[0] - anchor[0]; secF32[1] = s.pos[1] - anchor[1]; secF32[2] = s.pos[2] - anchor[2]; secF32[3] = s.cell
        secU32[4] = 0
        secF32[5] = s.uw?.[0] ?? 0; secF32[6] = s.uw?.[1] ?? 0
        secU32[7] = s.layer === 'hero' ? 1 : s.layer.includes('crown') ? 2 : 0
        secF32[8] = s.c0[0]; secF32[9] = s.c0[1]; secF32[10] = s.c0[2]; secF32[11] = 0
        secF32[12] = s.c2[0]; secF32[13] = s.c2[1]; secF32[14] = s.c2[2]; secF32[15] = 0
        const slot = allocBlock(secBytes)
        // The tile's box is what its faces fill, once any are here (a face may reach past its tile).
        if (!t.bounded) { t.lo = [...s.lo]; t.hi = [...s.hi]; t.bounded = true }
        for (let a = 0; a < 3; a++) { t.lo[a] = Math.min(t.lo[a], s.lo[a]); t.hi[a] = Math.max(t.hi[a], s.hi[a]) }
        return { s, slot, mid: [0, 1, 2].map((a) => (s.lo[a] + s.hi[a]) / 2) }
      })
      t.held[band] = { band, buffer, bytes: faces.byteLength, sections, used: frame }
      stats.fetched++
      t.fails[band] = 0
      stats.fetchedBytes += wireBytes
    } catch (e) {
      // A listed object that does not come is a load error (release.md): said, left out, and tried again later.
      stats.failed++
      stats.error = String((e as Error)?.message ?? e).slice(0, 200)
      t.held[band] = null
      // Tried again, but not before a while: twice as long after each failure, to a minute.
      t.retry[band] = performance.now() + Math.min(60_000, 1000 * 2 ** Math.min(6, (t.fails[band] = (t.fails[band] ?? 0) + 1)))
    }
    stats.coming--
  }

  /** How far a box is from a point, cells. */
  const away = (eye: readonly number[], lo: readonly number[], hi: readonly number[]) => Math.hypot(...[0, 1, 2].map((a) => Math.max(lo[a] - eye[a], 0, eye[a] - hi[a])))
  /** Whether a box is anywhere in the view. */
  const inView = (view: View, aspect: number, lo: readonly number[], hi: readonly number[]) => {
    const tx = view.tanHalf * aspect * 1.05, ty = view.tanHalf * 1.05, f = view.forward, r = view.right, u = view.up
    for (const n of [[0, 1, 2].map((i) => f[i] * tx - r[i]), [0, 1, 2].map((i) => f[i] * tx + r[i]), [0, 1, 2].map((i) => f[i] * ty - u[i]), [0, 1, 2].map((i) => f[i] * ty + u[i])]) {
      let most = 0
      for (let i = 0; i < 3; i++) most += n[i] * ((n[i] > 0 ? hi[i] : lo[i]) - view.eye[i])
      if (most < 0) return false
    }
    return true
  }
  /**
   * How much of the screen a box covers, 0 to 1: the rectangle round its corners as the eye sees them, cut to the
   * screen. A box the eye is in or beside counts as the whole screen.
   */
  const coverage = (view: View, aspect: number, lo: readonly number[], hi: readonly number[]) => {
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity
    for (const x of [lo[0], hi[0]]) for (const y of [lo[1], hi[1]]) for (const z of [lo[2], hi[2]]) {
      const d = [x - view.eye[0], y - view.eye[1], z - view.eye[2]]
      const along = d[0] * view.forward[0] + d[1] * view.forward[1] + d[2] * view.forward[2]
      if (along < 10) return 1
      const sx = (d[0] * view.right[0] + d[1] * view.right[1] + d[2] * view.right[2]) / (along * view.tanHalf * aspect)
      const sy = (d[0] * view.up[0] + d[1] * view.up[1] + d[2] * view.up[2]) / (along * view.tanHalf)
      x0 = Math.min(x0, sx); x1 = Math.max(x1, sx); y0 = Math.min(y0, sy); y1 = Math.max(y1, sy)
    }
    return (Math.max(0, Math.min(1, x1) - Math.max(-1, x0)) * Math.max(0, Math.min(1, y1) - Math.max(-1, y0))) / 4
  }
  /** Whether any face of a run that looks `way` (1 up, 2 to 5 the walls) could face the eye: its plane is in front of the eye at some corner of the section's box. */
  const facing = (way: number, s: Section, eye: readonly number[]) => {
    if (way === 1) return eye[1] > s.lo[1]
    const axis = way < 4 ? s.c0 : s.c2, sign = way % 2 ? 1 : -1
    let most = -Infinity
    for (const x of [s.lo[0], s.hi[0]]) for (const y of [s.lo[1], s.hi[1]]) for (const z of [s.lo[2], s.hi[2]]) most = Math.max(most, sign * (axis[0] * (eye[0] - x) + axis[1] * (eye[1] - y) + axis[2] * (eye[2] - z)))
    return most > 0
  }
  /** The bands a tile `d` cells off needs: band k holds faces from bands[k] metres, which are `detail` pixels across out to bands[k] * focal / detail. */
  const needs = (d: number, focal: number, detail: number) => bands.map((least, k) => k === 0 || (d / 10) * detail < bands[k - 1] * focal)
  /** Faces held at most, by device class (bay.ts `BUDGETS`: 20 bytes each, 60 MiB on a phone): past this the furthest tiles' finer bands are let go. */
  const BUDGET = bounded(query.get('farfaces'), HELD.faces, 100_000, 20_000_000, true)
  /** The lens (half its height's tangent) the wedge's faces begin nearer through: under 50 degrees, where at 720 pixels tall a cell of the march is over 3 pixels across (the realm's is 25). Not by the picture's own pixels: the page's scale moves with its load, and the foreground would flip between cells and faces. */
  const NARROW = Math.tan((50 * Math.PI) / 360)
  /** The faces' light (Listing `light`, or `?farlight=fill,gain`): the engine's own where neither says. */
  const lit = query.get('farlight')?.split(',').map(Number)
  const light = lit?.length === 2 && lit.every(Number.isFinite) ? { fill: lit[0], gain: lit[1] } : listing.light ?? { fill: 1, gain: 1 }
  /** How near the landing's eye the eye must be for its cut to be used, cells. */
  const LANDED = 200
  /** How wide the view the landing's cut was made for is, up and across (the tangents of their halves, a hair over): any view if it does not say. */
  const cutTan = landing?.fov && landing.size ? { y: Math.tan((landing.fov * Math.PI) / 360) * 1.001, x: Math.tan((landing.fov * Math.PI) / 360) * (landing.size[0] / landing.size[1]) * 1.001 } : { y: Infinity, x: Infinity }
  /** Which way the eye the cut was made for looks, if it says. */
  const cutLook = landing?.yaw !== undefined && landing.pitch !== undefined ? [Math.sin(landing.yaw) * Math.cos(landing.pitch), Math.sin(landing.pitch), -Math.cos(landing.yaw) * Math.cos(landing.pitch)] : null
  /** The tallest picture the cut is trusted for, pixels: its own tallest (sf/far/landing.mjs `--heights`) and some, `?farcutfit` times (a 1350 px picture of the cut was the bands' but for slivers at the edges, #523); a taller one draws finer faces than it kept. */
  const cutTall = landing?.heights?.length ? Math.max(...landing.heights) * Number(query.get('farcutfit') ?? 1.6) : 0
  /** How far past the reach a tile is still drawn, metres. */
  const FURTHEST = bounded(query.get('farthest'), 16_000, 100, 50_000)
  let frame = 0
  let whole = true
  /** Until `shown` only the landing's cut of the view is fetched (`ready` says when it is here); then what the view needs; after `left`, the rest. */
  let first = true, landed = true
  let ready = false
  /** Boxes the world was changed in since the last reset, a little wider (low and high corners, finest cells): the cells' (edited). */
  const edits: number[][] = []
  /** Tiles the world was changed in past EDITS boxes: the cells' whole (edited). */
  const changed = new Set<string>()
  /** How much wider than what changed a box is left to the cells, and how near two boxes are to be one, finest cells. */
  const PAD = 10, JOIN = 200
  let kept: readonly number[] | null = null

  const self: Far = {
    listing, reach: reachAsked, near: bounded(query.get('farnear'), 100, 0, 5_000), detail: bounded(query.get('fardetail'), 0.75, 0.05, 16), stats,
    get whole() { return whole },
    get ready() { return ready },
    shown() { first = false },
    left() { first = false; landed = false },
    edited(box) {
      const b = [box[0] - PAD, box[1] - PAD, box[2] - PAD, box[3] + PAD, box[4] + PAD, box[5] + PAD]
      const gap = (e: readonly number[]) => Math.max(0, ...[0, 1, 2].map((a) => Math.max(e[a] - b[a + 3], b[a] - e[a + 3])))
      const near = edits.find((e) => gap(e) <= JOIN)
      if (near) { for (let a = 0; a < 3; a++) { near[a] = Math.min(near[a], b[a]); near[a + 3] = Math.max(near[a + 3], b[a + 3]) } return }
      if (edits.length < EDITS) { edits.push(b); return }
      for (let x = Math.floor(box[0] / size); x <= Math.floor((box[3] - 1) / size); x++) for (let z = Math.floor(box[2] / size); z <= Math.floor((box[5] - 1) / size); z++) changed.add(`${x}_${z}`)
    },
    forget() { edits.length = 0; changed.clear() },
    keep(box) { kept = box },
    handover(x, z) {
      if (!handed) return Infinity
      const w = handed.wedge, dx = w ? x - w[0] : 0, dz = w ? z - w[1] : 0, b = Math.atan2(dx, -dz), bearing = b < 0 ? b + 2 * Math.PI : b
      return w && bearing > w[4] && bearing < w[5] && dx * dx + dz * dz < w[2] * w[2] ? Math.min(handed.reach, w[3]) : handed.reach
    },
    held: () => tiles.flatMap((t) => t.held.flatMap((h, k) => (h && h !== 'coming' ? [t.recs[k]!.path] : []))),
    get depth() { return own?.view ?? null },
    draw(encoder, to, view) {
      pass(encoder, [to.color], to.depth, to.size, view, picture, false)
      if (!stats.faces || !own) return
      let bind = mergeBinds.get(own.view)
      if (!bind) { bind = device.createBindGroup({ layout: merging.getBindGroupLayout(0), entries: [{ binding: 0, resource: own.view }] }); mergeBinds.set(own.view, bind) }
      const merge = encoder.beginRenderPass({ label: 'far depth', colorAttachments: [], depthStencilAttachment: { view: to.depth, depthLoadOp: 'load', depthStoreOp: 'store' } })
      merge.setPipeline(merging)
      merge.setBindGroup(0, bind)
      merge.draw(3)
      merge.end()
    },
    drawIds(encoder, ids, depth, size, view) { pass(encoder, [ids], depth, size, view, numbers, true) },
    async drawKeys(encoder, keys, at, depth, size, view) { pass(encoder, [keys, at], depth, size, view, await (keyed ??= pipelineFor('fsKeys', 'rgba32uint', 'rgba32float')), true) },
    lockers(words) { device.queue.writeBuffer(lockerTable, 0, words) },
    lockerHeader(words) { device.queue.writeBuffer(lockerTable, 4, words) },
  }
  /** The reach and the wedge of the last draw (pass): what `handover` answers from. */
  let handed: { reach: number; wedge: number[] | null } | null = null
  const viewBinds = new WeakMap<GPUTextureView, GPUBindGroup>()
  let own: { texture: GPUTexture; view: GPUTextureView; size: readonly [number, number] } | null = null
  const ownDepth = (s: readonly [number, number]) => {
    if (own && own.size[0] === s[0] && own.size[1] === s[1]) return own.view
    own?.texture.destroy()
    const texture = device.createTexture({ label: 'far depth', size: [s[0], s[1]], format: 'depth32float', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING })
    own = { texture, view: texture.createView(), size: [s[0], s[1]] }
    return own.view
  }

  const pass = (encoder: GPUCommandEncoder, colours: GPUTextureView[], depth: GPUTextureView, sz: readonly [number, number], view: View, pipeline: GPURenderPipeline, clear: boolean) => {
    frame++
    const reach = self.reach * 10, aspect = sz[0] / sz[1], focal = sz[1] / (2 * view.tanHalf), eye = view.eye
    // The march's map of held tiles is 64 a side round the eye's tile (the city is wider than that: 32 km).
    const map: [number, number] = [Math.floor(eye[0] / size) - 32, Math.floor(eye[2] / size) - 32]
    const shaded = sunBaked && march.sun.s ? sunBaked[0] * march.sun.s[0] + sunBaked[1] * march.sun.s[1] + sunBaked[2] * march.sun.s[2] > 0.999 : false
    // What is fetched: for each tile in the view, the landing's cut of it while the eye is there, then every band it
    // needs, the tiles that cover most of the screen first; then what the tiles out of the view need, nearest first.
    // Which tiles are whole, for the march. Until the place is first shown, only the landing's cut of the view (or,
    // away from it or where the listing has none, the first band of the view): on an ordinary link the finer bands
    // near the eye had taken the wire for seconds while the skyline was still the cells' boxes.
    const there = !!landing && Math.hypot(eye[0] - landing.eye[0], eye[1] - landing.eye[1], eye[2] - landing.eye[2]) < LANDED
    // The very view the cut was made for (its eye, its look, its lens or a narrower one, a picture no taller): there it
    // is the whole picture (#523), and a tile draws it whatever bands it holds, a twentieth of their faces; a tile it has
    // nothing of shows nothing, and is neither fetched nor left to the cells. Any other view (a wider screen sees past
    // the faces it kept, a turned eye others, a taller picture finer ones) has every band it needs fetched as well.
    const exact = there && !!cutLook && sz[1] <= cutTall && view.tanHalf <= cutTan.y && view.tanHalf * aspect <= cutTan.x && Math.hypot(eye[0] - landing!.eye[0], eye[1] - landing!.eye[1], eye[2] - landing!.eye[2]) < 10 && view.forward[0] * cutLook[0] + view.forward[1] * cutLook[1] + view.forward[2] * cutLook[2] > 0.99999
    const want: { t: Tile; band: number; d: number; seen: number }[] = []
    cover.fill(0)
    whole = true
    let short = false
    let held = 0, heldBytes = 0
    /** Whether a tile draws the landing's cut, which holds no face nearer than the reach it was cut for. */
    let onCut = false
    for (const t of tiles) {
      const d = away(eye, t.lo, t.hi)
      const seen = d < FURTHEST * 10 && inView(view, aspect, t.lo, t.hi) ? coverage(view, aspect, t.lo, t.hi) : 0
      // Out of sight and over a kilometre off, a tile holds only its biggest faces, until the eye turns to it (the
      // march's cells stand in meanwhile): the park's narrow lens had fetched the whole circle round it.
      const need = d >= FURTHEST * 10 ? bands.map(() => false) : d > 10_000 && !seen ? bands.map((_, k) => k === 0) : needs(d, focal, self.detail)
      let all = true
      for (const [k, h] of t.held.entries()) {
        if (k === C || !t.listed[k]) continue
        if (need[k] && (h === null || h === 'coming')) all = false
        if (h && h !== 'coming') { held += h.bytes / 20; heldBytes += h.bytes; if (need[k]) h.used = frame }
      }
      t.full = all
      // The landing's cut is let go once every band the tile needs is here and the view is not the cut's own, or the eye has left the landing.
      const cut = t.held[C]
      if (((all && !exact) || !there) && cut && cut !== 'coming') { drop(cut); t.held[C] = null }
      const cutHeld = (!all || exact) && there && !!cut && cut !== 'coming'
      if (cutHeld) { held += (cut as Held).bytes / 20; heldBytes += (cut as Held).bytes; onCut = true }
      const cutting = there && t.listed[C]
      // What it is fetched for now: until `shown`, the cut if the tile is in the view, or else its first band (none of
      // a tile the cut has nothing of, through its own view); until `left`, every band a tile in the view needs where
      // the cut is not its whole picture (any view but the cut's own, or a cut that did not come); after, every band it
      // needs. And the cut while the tile is in the view and not whole.
      const enough = exact && !t.fails[C]
      const fetch = [...(first ? bands.map((_, k) => k === 0 && !!seen && !cutting && !exact) : landed ? need.map((n) => n && !!seen && (cutting ? !enough : !exact)) : need), !all && !!seen && cutting]
      for (const [k, h] of t.held.entries()) {
        if (!fetch[k] || !t.listed[k] || (h !== null && h !== 'coming')) continue
        if (h === null && performance.now() >= t.retry[k]) want.push({ t, band: k === C ? -1 : k, d, seen })
        // What the first picture waits on: the cut of the view, each held or asked once and failed.
        if (k === C && first && (h === 'coming' || !t.fails[k])) short = true
      }
      // (Through the cut's own view, the cut is a tile's whole, and a tile it has nothing of shows nothing.)
      const hidden = exact && !t.listed[C]
      if (!all && !(exact && cutHeld) && !hidden && seen) whole = false
      // The march hands a tile over once what it needs is here, or the landing's cut of it while the eye is there (or,
      // through the cut's own view, a tile it has nothing of): until then its cells stand in. Nor one the world was changed in.
      if ((all || cutHeld || hidden) && d < FURTHEST * 10 && !changed.has(t.key)) {
        const bx = t.x - map[0], bz = t.z - map[1]
        if (bx >= 0 && bx < 64 && bz >= 0 && bz < 64) { const bit = bz * 64 + bx; cover[bit >> 5] |= 1 << (bit & 31) }
      }
    }
    // Ready once every object of the cut the first picture asks is held, or was asked and failed (a load error is said, not waited on).
    ready = !first || !short
    stats.held = held; stats.heldBytes = heldBytes
    // What the view holds before what it does not; in it the cut, then the coarse band before the finer, the biggest on the screen first.
    want.sort((a, b) => Number(!a.seen) - Number(!b.seen) || (a.seen && b.seen ? a.band - b.band || b.seen - a.seen : 0) || a.d - b.d || a.band - b.band)
    for (const w of want) {
      if (stats.coming >= 6) break
      if (w.band > 0 && held >= BUDGET) continue
      void load(w.t, w.band < 0 ? C : w.band)
    }
    // Over the budget: drop stale bands first, then finest out-of-view / furthest bands so phone/tablet stay within tier VRAM (#83).
    if (held > BUDGET) {
      const loose = tiles.flatMap((t) => t.held.map((h, k) => ({ t, h, k }))).filter((e) => e.k < C && e.h && e.h !== 'coming' && e.h.used < frame - 120) as { t: Tile; h: Held; k: number }[]
      loose.sort((a, b) => a.h.used - b.h.used || b.k - a.k)
      for (const e of loose) { if (held <= BUDGET * 0.9) break; drop(e.h); e.t.held[e.k] = null; held -= e.h.bytes / 20; heldBytes -= e.h.bytes }
      if (held > BUDGET * 1.05) {
        const finer = tiles.flatMap((t) => {
          const d = away(eye, t.lo, t.hi), vis = d < FURTHEST * 10 && inView(view, aspect, t.lo, t.hi) ? 1 : 0
          return t.held.map((h, k) => ({ t, h, k, d, vis }))
        }).filter((e) => e.k > 0 && e.k < C && e.h && e.h !== 'coming') as { t: Tile; h: Held; k: number; d: number; vis: number }[]
        finer.sort((a, b) => a.vis - b.vis || b.k - a.k || b.d - a.d)
        for (const e of finer) { if (held <= BUDGET) break; drop(e.h); e.t.held[e.k] = null; held -= e.h.bytes / 20; heldBytes -= e.h.bytes }
      }
    }
    stats.held = held; stats.heldBytes = heldBytes
    // The faces' light was read off a clear afternoon: it is theirs as far as the day is clear (the march's own overcast).
    const fair = Math.max(0, Math.min(1, march.day)) * (1 - Math.max(march.rain, march.cloud, 0.2 * march.fog))
    // The wedge (HANDOVER): for the march from the frame's corner, here from the eye (where a face is measured from).
    // While a tile draws the landing's cut, no nearer than the reach the cut was made for: nearer it has no faces.
    const w = listing.wedge && view.tanHalf < NARROW ? listing.wedge : null
    const near = Math.min(reach, 10 * Math.max(self.near, onCut || exact ? landing?.reach ?? self.reach : 0))
    const wedge = w ? [w.at[0], w.at[1], w.far * 10, near, (w.from * Math.PI) / 180, (w.to * Math.PI) / 180] : null
    if (!clear) handed = { reach, wedge }
    device.queue.writeBuffer(uniforms, 0, new Float32Array([eye[0] - anchor[0], eye[1] - anchor[1], eye[2] - anchor[2], view.tanHalf, ...view.right, aspect, ...view.up, reach, ...view.forward, shaded ? 1 : 0, ...march.sun.s, (2 * view.tanHalf) / sz[1], ...(wedge ? [wedge[0] - eye[0], wedge[1] - eye[2], wedge[2], wedge[3], wedge[4], wedge[5], 0, 0] : [0, 0, 0, 0, 0, 0, 0, 0]), 1 + (light.fill - 1) * fair, 1 + (light.gain - 1) * fair, 0, 0, ...(kept && wedge ? [kept[0] - eye[0], kept[1] - eye[1], kept[2] - eye[2], 0, kept[3] - eye[0], kept[4] - eye[1], kept[5] - eye[2], 1] : [0, 0, 0, 0, 0, 0, 0, 0])]))
    const boxes = new Float32Array(EDITS * 8)
    for (const [i, e] of edits.entries()) boxes.set([e[0] - eye[0], e[1] - eye[1], e[2] - eye[2], 0, e[3] - eye[0], e[4] - eye[1], e[5] - eye[2], 1], i * 8)
    device.queue.writeBuffer(uniforms, 160, boxes)
    const coverKey = `${cover.join(',')}:${reach}:${wedge ? near : 0}:${map}:${kept}:${edits.join(';')}`
    if (coverKey !== covered) { covered = coverKey; march.farCover(map, size, reach, cover, wedge, kept, edits.map((e) => [...e])); stats.covered = cover.reduce((n, w) => { let c = 0; for (let v = w; v; v &= v - 1) c++; return n + c }, 0) }

    let bind = viewBinds.get(depth)
    if (!bind) { bind = device.createBindGroup({ layout: viewLayout, entries: [{ binding: 0, resource: { buffer: uniforms } }, { binding: 1, resource: { buffer: march.globals } }, { binding: 2, resource: { buffer: windows } }, { binding: 3, resource: depth }, { binding: 4, resource: march.screen.view }, { binding: 5, resource: { buffer: lockerTable } }] }); viewBinds.set(depth, bind) }
    const out = encoder.beginRenderPass({
      label: 'far',
      colorAttachments: colours.map((view) => ({ view, loadOp: clear ? 'clear' as const : 'load' as const, storeOp: 'store' as const, clearValue: [0, 0, 0, 0] })),
      depthStencilAttachment: { view: ownDepth(sz), depthClearValue: 0, depthLoadOp: 'clear', depthStoreOp: 'store' },
    })
    out.setPipeline(pipeline)
    out.setBindGroup(0, bind)
    let faces = 0, sections = 0, drawn = 0
    for (const t of tiles) {
      if (!t.held.some((h) => h && h !== 'coming') || changed.has(t.key)) continue
      const d = away(eye, t.lo, t.hi)
      if (d > FURTHEST * 10 || !inView(view, aspect, t.lo, t.hi)) continue
      // A tile wholly within the reach (the wedge's, where there is one) is the cells'.
      const furthest = Math.hypot(...[0, 1, 2].map((a) => Math.max(Math.abs(t.lo[a] - eye[a]), Math.abs(t.hi[a] - eye[a]))))
      if (furthest < (wedge ? near : reach)) continue
      // A tile not yet whole, or seen through the cut's own view, draws the landing's cut where it has it, else what
      // bands it has; seen through the cut's own view, a tile the cut has nothing of draws nothing.
      const cut = t.held[C]
      if (exact && !t.listed[C]) continue
      drawn++
      for (const h of (!t.full || exact) && cut && cut !== 'coming' ? [cut] : t.held.slice(0, C)) {
        if (!h || h === 'coming') continue
        out.setVertexBuffer(0, h.buffer)
        for (const { s, slot } of h.sections) {
          const sf = Math.hypot(Math.max(Math.abs(s.lo[0] - eye[0]), Math.abs(s.hi[0] - eye[0])), Math.max(Math.abs(s.lo[1] - eye[1]), Math.abs(s.hi[1] - eye[1])), Math.max(Math.abs(s.lo[2] - eye[2]), Math.abs(s.hi[2] - eye[2])))
          if (sf < (wedge ? near : reach)) continue
          const ds = away(eye, s.lo, s.hi)
          if (!inView(view, aspect, s.lo, s.hi)) continue
          const least = (self.detail * ds) / 10 / focal
          // lods run from big to small: every face at least the first of them under `least` metres.
          const k = s.layer === 'hero' ? -1 : lods.findIndex((l) => l <= least)
          let bound = false
          for (const run of s.runs) {
            // A run of faces all looking away from the eye (it is behind their plane at every corner of the section) is not drawn.
            if (!facing(run.way, s, eye)) continue
            const count = k < 0 ? run.count : run.lods[k]
            if (!count) continue
            if (!bound) { out.setBindGroup(1, blockBind, [slot * blockStride]); bound = true }
            out.draw(4, count, 0, run.start)
            faces += count
          }
          if (bound) sections++
        }
      }
    }
    out.end()
    stats.faces = faces; stats.sections = sections; stats.tiles = drawn
  }
  return self
}
