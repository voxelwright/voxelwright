// The city's windows as lockers for the eggs (#450, eggs-lockers.ts): the rule both sides keep. A window of the far
// model (far.ts) is known by its building's number, the way its wall looks (2 to 5), its bay along the wall and its
// storey, the four the far model's faces give every pixel. A locker is such a window holding an egg; the page lays
// them in a table on the GPU, by that key, and the far model looks each window it draws up in it: one look, not one
// per egg, so a thousand lockers cost what one does.
//
// The table is `array<vec4u>`: its first entry the header (the mask of its size, the slot under the pointer plus one,
// how far the lockers are shown, 0 to 1, and how bright the one just opened flashes), then the entries. An entry is
// the building's number (24 bits), its way (3), the locker's state (2) and a bit saying it is taken; the bay; the
// storey; the locker's slot (which egg, for its own flicker).

/** What a locker shows: something new in it, something already seen, or locked until it is found in the city. */
export const NEW = 0, SEEN = 1, LOCKED = 2
export type State = typeof NEW | typeof SEEN | typeof LOCKED

/** A window: its building's number, its way, its bay along the wall and its storey (far.ts `fsKeys`). */
export type Key = readonly [id: number, way: number, bay: number, storey: number]

/** Entries the table holds (a power of two): a thousand lockers at most, half full. */
export const SLOTS = 2048
/** How far a key is looked for past where it hashes to. */
const PROBES = 16

const hash = (id: number, way: number, bay: number, storey: number) => (Math.imul(id, 73856093) ^ Math.imul(bay, 19349663) ^ Math.imul(storey, 83492791) ^ Math.imul(way, 668265263)) >>> 0

/** The table's words for these lockers (header first), and any that could not be laid in it. */
export function table(lockers: readonly { key: Key; state: State; slot: number }[]) {
  const words = new Uint32Array((SLOTS + 1) * 4), mask = SLOTS - 1, left: number[] = []
  words[0] = mask
  for (const l of lockers) {
    const [id, way, bay, storey] = l.key
    let i = hash(id, way, bay, storey) & mask, k = 0
    while (k < PROBES && words[(1 + i) * 4] >>> 31) { i = (i + 1) & mask; k++ }
    if (k === PROBES) { left.push(l.slot); continue }
    words.set([((id & 0xffffff) | ((way & 7) << 24) | ((l.state & 3) << 28) | (1 << 31)) >>> 0, bay >>> 0, storey >>> 0, l.slot], (1 + i) * 4)
  }
  return { words, left }
}

/**
 * The header's last three words, as the far model reads them: the slot under the pointer (or -1), how far the lockers
 * are shown (0 to 1), how bright the one just opened flashes (0 to 1).
 */
export function header(hot: number, shown: number, flash: number) {
  const h = new Uint32Array(3), f = new Float32Array(h.buffer)
  h[0] = hot + 1
  f[1] = shown
  f[2] = flash
  return h
}

/**
 * The far model's side (WGSL): `lockerAt` finds a window's locker, `lockerLight` is the light in its pane. Needs
 * `wallHash` (march.ts NIGHT_WALL) and a binding `lockers: array<vec4u>`.
 *
 * What each looks like, so that a glance tells them apart by day and by night, among the city's own lit rooms:
 *   new     the flicker of a television left on: blue and cool white, cut now and then to a violet or a magenta
 *           scene, brighter than any room: something is on in there. Never green or warm: green is seen, and a
 *           warm pane is any room with someone home.
 *   seen    a steady soft green, a lamp under a green shade: what was in it has been seen
 *   locked  a dim red, as a darkroom's safelight: something is in there, kept until it is found in the city
 * The pane is the light's colour, not the glass's with light added: by day on a pale wall the added light was white
 * on white (5 of 30 lockers hardly showed). Under the pointer a window's light comes up, and spills onto the wall
 * round its pane; the one just opened flashes white as it is.
 */
export const LOCKERS = /* wgsl */ `
const LOCKER_PROBES = ${PROBES}u;
fn lockerHash(id: u32, way: u32, bay: i32, storey: i32) -> u32 {
  return (id * 73856093u) ^ (bitcast<u32>(bay) * 19349663u) ^ (bitcast<u32>(storey) * 83492791u) ^ (way * 668265263u);
}
// The locker at a window: its state plus one (0: none) and its slot.
fn lockerAt(id: u32, way: u32, bay: i32, storey: i32) -> vec2u {
  let mask = lockers[0].x;
  if (mask == 0u) { return vec2u(0u); }
  var i = lockerHash(id, way, bay, storey) & mask;
  for (var k = 0u; k < LOCKER_PROBES; k++) {
    let e = lockers[1u + i];
    if ((e.x >> 31u) == 0u) { break; }
    if ((e.x & 0xffffffu) == id && ((e.x >> 24u) & 7u) == way && bitcast<i32>(e.y) == bay && bitcast<i32>(e.z) == storey) { return vec2u(((e.x >> 28u) & 3u) + 1u, e.w); }
    i = (i + 1u) & mask;
  }
  return vec2u(0u);
}
// What a television throws through a window: shots of 0.5 to 1.5 s, each its own colour (mostly the blue and cool
// white of a screen, now and then a violet or a magenta scene), wandering a little within the shot and flickering. By
// day (\`night\` 0) the room round the screen is darker than the street, and the screen's colour deep in it: each
// colour squared, so a pale blue screen still shows on a pale blue wall.
fn lockerTv(t: f32, slot: u32, night: f32) -> vec3f {
  let own = wallHash(vec2f(f32(slot), 1.0), 911u);
  let at = t * (0.7 + 0.6 * own) + own * 37.0;
  let shot = floor(at);
  let h = wallHash(vec2f(shot, f32(slot)), 29u);
  var c = vec3f(0.3, 0.5, 1.0);
  if (h > 0.42) { c = vec3f(0.48, 0.64, 1.0); }
  if (h > 0.66) { c = vec3f(0.18, 0.3, 1.0); }
  if (h > 0.82) { c = vec3f(0.55, 0.36, 1.0); }
  if (h > 0.93) { c = vec3f(1.0, 0.36, 0.82); }
  c = mix(c * c, c, night);
  let wander = 0.8 + 0.2 * wallHash(vec2f(shot, f32(slot)), 53u) + 0.1 * sin(t * 27.0 + own * 6.3) * sin(t * 6.1 + own * 2.0);
  // Each cut comes up over a tenth of a second, as a picture does.
  return c * wander * (0.6 + 0.4 * smoothstep(0.0, 0.1, fract(at)));
}
// The light in a locker's pane (\`found\` from lockerAt, at time t; \`night\` 0 by day to 1 once the city's lights are
// on), before the haze. By day a screen is dimmer than it is at night: as bright, its colour was lost to white.
fn lockerLight(found: vec2u, t: f32, night: f32) -> vec3f {
  let state = found.x - 1u;
  let hot = select(0.0, 1.0, lockers[0].y == found.y + 1u);
  var c = vec3f(0.0);
  if (state == ${NEW}u) { c = lockerTv(t, found.y, night) * mix(1.6, 2.4, night); }
  else if (state == ${SEEN}u) { c = vec3f(0.22, 1.0, 0.38) * 1.4; }
  else { c = vec3f(1.0, 0.1, 0.06) * (0.9 + 0.1 * sin(t * 1.3 + f32(found.y))); }
  // Under the pointer: twice as bright, a little whiter. The one just opened: a white flash going.
  c = mix(c, c * 2.2 + vec3f(0.6), hot);
  let flash = bitcast<f32>(lockers[0].w) * hot;
  return c + vec3f(6.0) * flash;
}
`
