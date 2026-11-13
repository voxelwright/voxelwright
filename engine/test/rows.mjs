// The rows of the board against the reference (#144): one for each thing a viewer sees in the
// two films of the review the owner linked, and how to set up our shot of the same thing on the
// city page. `node test/versus.mjs` draws the board; `node test/clip.mjs` films a row;
// `node test/aims.mjs` checks that every shot still faces its thing.
//
// `state` is a judgement, changed only when a judge who did not make ours has seen both pictures
// with the sides unnamed (`versus --blind`, test/judge.md) and the row showed its thing:
//   none    we have nothing to show        behind  we show it, theirs is better
//   level   as good to look at             ahead   ours is better
// The judge's scores are out of ten: two or more apart is ahead or behind, one apart is level.
// Judged November 13 (dispatch log): fire 7 v 4, glass 5 v 4, tools 6 v 5 to us. Tumble's 7 v 5 was void: their
// frame was not the film's best wall, and is now.
// Shown live and measured counts for nothing until a row is level to look at.
import { still } from './kit.mjs'

export const DEG = Math.PI / 180
/** The core's materials a shot may be asked to face (kinds.rs). */
const ROCK = 2, SAND = 4, WATER = 5, ASPHALT = 6, CONCRETE = 7, BRICK = 8, PLASTER = 9, WOOD = 10, GLASS = 11, STEEL = 12, LEAVES = 13, LAMP = 15
const HOUSE = [BRICK, PLASTER, WOOD, GLASS, CONCRETE]

/** Where the page starts: over the middle of a street, houses on its -z side, the works yard on the other. Shots are given from there, metres and degrees. */
export const from = (page, dx, up, dz, yaw, pitch) => page.evaluate(([dx, up, dz, yaw, pitch]) => {
  const e = globalThis.engine
  e.home ??= { ...e.pose }
  Object.assign(e.pose, { x: e.home.x + dx, y: e.home.y - 12 + up, z: e.home.z + dz, yaw, pitch })
}, [dx, up, dz, yaw * DEG, pitch * DEG])

/** The works yard's things, metres from the world's corner (city.rs: the yard is block 0, 5; a block is 128 m by 80 m). */
const YARD = { tower: [40, 425], chimney: [70, 419], office: [100, 460] }

/** Stands the eye `up` metres over the ground at a place and turns it to look at a point `high` metres over the ground at another. */
export const lookFrom = (page, [x, z], up, [tx, tz], high) => page.evaluate(([x, z, up, tx, tz, high]) => {
  const e = globalThis.engine, y = e.ground(x, z) + up, ty = e.ground(tx, tz) + high
  Object.assign(e.pose, { x, y, z, yaw: Math.atan2(tx - x, -(tz - z)), pitch: Math.atan2(ty - y, Math.hypot(tx - x, tz - z)) })
}, [x, z, up, tx, tz, high])

/** A blast at a point `high` metres over the ground at a place. */
export const strikeAt = (page, [x, z], high, radius, spark = true) => page.evaluate(([x, z, high, radius, spark]) => {
  const e = globalThis.engine
  e.strike([Math.round(x * 10), Math.round((e.ground(x, z) + high) * 10), Math.round(z * 10)], radius, spark)
}, [x, z, high, radius, spark])

/** Puts the eye where a row's shot is taken from, and waits until what is there is made and lit. */
export async function place(page, row) {
  await still(page)
  await page.evaluate(() => { globalThis.engine.home ??= { ...globalThis.engine.pose } })
  if (Array.isArray(row.stand)) await from(page, ...row.stand)
  else await lookFrom(page, row.stand.from, row.stand.up, row.stand.to, row.stand.high)
  // The hour and the rain the row is of, if it names them: the sun's maps are drawn again for the hour before the picture.
  await page.evaluate(([hour, rain]) => Object.assign(globalThis.engine, { hour, rain }), [row.hour ?? null, row.rain ?? 0])
  await page.waitForTimeout(400)
  await still(page, { sun: true })
}

/**
 * Whether a row's shot faces its thing: null, or what is wrong. `near` is metres and the materials one of which
 * must be that close, straight ahead or a little to a side of it (a tower's legs have gaps).
 */
export async function aimed(page, row) {
  if (!row.near) return null
  const [within, ...materials] = row.near, seen = [], [aside, above] = row.aim ?? [0, 0]
  for (const right of [0, -0.04, 0.04]) for (const up of [0, -0.04, 0.04]) {
    const hit = await page.evaluate(([r, u]) => globalThis.engine.pick(r, u), [aside + right, above + up])
    if (hit && hit.t / 10 <= within && materials.includes(hit.material)) return null
    seen.push(hit ? `${hit.material} at ${(hit.t / 10).toFixed(0)} m` : 'sky')
  }
  return `${row.key}: the shot does not face its thing (wanted one of materials ${materials.join(' ')} within ${within} m; ahead: ${[...new Set(seen)].join(', ')})`
}

/** Whether a row's act did what its picture is of, asked just after the picture: null, or what is wrong. */
export async function showed(page, row, was) {
  const now = await page.evaluate(() => ({ pieces: globalThis.engine.fell.pieces, bodies: globalThis.engine.bodies, burning: globalThis.engine.burning, wet: globalThis.engine.water.columns }))
  if (row.falls && now.pieces - was < row.falls) return `${row.key}: ${now.pieces - was} bodies came of the act, ${row.falls} were to`
  if (row.inAir && now.bodies === 0) return `${row.key}: the picture was to be of things in the air, and nothing was moving`
  if (row.burns && now.burning === 0) return `${row.key}: the picture was to be of fire, and nothing was burning`
  if (row.flows && now.wet < row.flows) return `${row.key}: the picture was to be of water over ${row.flows} columns, and it lay over ${now.wet}`
  return null
}

const blast = (page, radius) => page.evaluate((r) => globalThis.engine.blast(r), radius)
/** The house fronts across the street from the start, from the road: the kerbs are parked up. */
const FRONT = [-2, 3.2, 1.5, 9, 15]
/** Turns the head `turn` radians from where it looks, breaks what is ahead, and turns it back. */
const charge = async (page, turn, radius, pitch) => {
  const was = await page.evaluate(([turn, pitch]) => { const p = globalThis.engine.pose, was = [p.yaw, p.pitch]; p.yaw += turn; if (pitch !== null) p.pitch = pitch; return was }, [turn, pitch ?? null])
  await page.waitForTimeout(60)
  await blast(page, radius)
  await page.evaluate(([yaw, pitch]) => Object.assign(globalThis.engine.pose, { yaw, pitch }), was)
}

/**
 * The rows. `theirs` is a film and the second to take the frame at. `stand` is where our shot is taken from: metres
 * from the start along x, over the street, along z, then degrees turned and tilted; or a place to stand and a point
 * to look at. `hour` is the time of day, if not the page's own, and `rain` how hard it rains (0 to 1). `near` is what must be ahead there (see `aimed`),
 * or, with `aim`, that far right of and above the middle of the picture (radians). `act` is what is done, and may return a picture
 * taken mid-way (things in the air), else the picture is taken when all is still again. `falls`, `inAir`, `burns` and `flows`
 * say what the act must have done for the picture to be of the row's thing (see `showed`).
 */
// States as the fifth blind judge left them (November 12, main 6bd6d317, logged), after material finer than a cell,
// the wall paints and rubble in heaps: ours first, theirs second. town 5 v 7, light 6 v 7, topple 6 v 7, fire 6 v 4,
// glass 6 v 5, frame 5 v 7, tools 5 v 4, sunset 7 v 8, under 6 v 8, snow 5 v 7, rain 5 v 8, road 6 v 7, whole 5 v 8,
// signs 3 v 8, dusk 6 v 7, there 6 v 5. Tumble (5 v 7) and blast (5 v 7) had dropped: with the inner part of a blast
// poured as rubble, less of it flew. Lumps are thrown as before again, and a second judge saw those two and the two
// rows of heaps as they now are: tumble 5 v 6, blast 5 v 6, rubble 5 v 6 (7 v 6 from the first of the two), ruin
// 5 v 7 (6 v 7). Two or more apart is ahead or behind, one apart or the same is level. Light, topple, rubble, tumble
// and blast are level; ruin is behind. What both judges say is still between the two: theirs has grey stuff that
// reads as concrete, fire that lights what is round it, and dust and haze between the eye and the break; ours is
// crisp, and its pale painted pieces read as toys.
// After smoke that climbs over fires, dust that hangs where a blast was and fire's glow on what is near, a third
// judge of four rows (logged): blast 5 v 6, fire 6 v 3, rubble 6 v 5, ruin 5 v 6. Ruin is level. Its words for what
// is left: ours is bright, toy-coloured and evenly lit, a diorama; theirs has grey mass, haze and light.
// The sixth full judge (logged, main 91cb6a20, 21 rows, water among them for the first time): town 5 v 7, light 6 v 7,
// tumble 5 v 7, topple 7 v 6, blast 6 v 5, fire 6 v 4, water 4 v 6, rubble 7 v 6, glass 5 v 4, frame 4 v 7, tools 6 v 5,
// ruin 7 v 6, sunset 6 v 8, under 6 v 8, snow 5 v 7, rain 5 v 8, road 6 v 5, whole 5 v 7, signs 4 v 8, dusk 6 v 7,
// there 6 v 5. The states below are that judge's. Tumble and sunset went back to behind on scores that have moved a
// point either way from pass to pass (tumble's six passes: ours 6, 6.5, 6, 5, 5, 5 to theirs 5, 5.5, 5, 7, 6, 7).
// Water's lack: the falling water is "an opaque white pillar", with no foam and nothing seen through it. The grade
// by day was softened after this pass (glow.ts) and no judge has seen that yet.
// The fourth judge's scores, for the noise between passes: town 5 v 7, light 5 v 7, tumble 6 v 5, topple 5 v 7,
// blast 6 v 5, fire 6 v 4, rubble 5 v 7, glass 6 v 4, frame 5 v 7, tools 6 v 4, ruin 5 v 7, sunset 7 v 8, under 6 v 8,
// snow 5 v 7, rain 5 v 8, road 6 v 7, whole 5 v 8, signs 3 v 8, dusk 6 v 7, there 6 v 5. Glass is kept level, not
// ahead: their film has a better glass frame than the one that judge was given (19.6 s), and it is the frame now.
// Tools is level, not ahead: that judge could not read their bar's labels, but was handed their frame at 960 wide
// from a compressed film. At the film's own size the bar reads plainly, twelve named tools to our seven.
export const ROWS = [
  // The town of cells being broken.
  { key: 'town', what: 'A town of things worth breaking: towers on legs, a fuel station, shops with signs', theirs: ['engine', 0.6], state: 'behind',
    // From in the works yard: its water tower on its legs close by, and across the street five shops with their
    // names over the doors, cars at the kerb.
    stand: { from: [54, 437], up: 1.8, to: [33, 400], high: 7 }, near: [200, STEEL, WOOD, BRICK, GLASS, PLASTER] },
  { key: 'light', what: 'Daylight: clouds, soft shadows, darker corners, haze with distance', theirs: ['engine', 13.2], state: 'level',
    stand: [-9, 1.8, 2.2, 62, 5] },
  { key: 'tumble', what: 'A wall that is hit comes apart in pieces that turn as they fall', theirs: ['engine', 43.6], state: 'behind',
    stand: FRONT, near: [16, ...HOUSE], inAir: true, falls: 20,
    act: async (page) => {
      await blast(page, 16)
      await page.waitForFunction(() => globalThis.engine.bodies > 20, null, { timeout: 4000 })
      await page.waitForTimeout(450)
      return page.screenshot()
    } },
  { key: 'topple', what: 'A tall thing leans over and comes down whole', theirs: ['engine', 3.4], state: 'level',
    // The water tower in the yard, from the street beside it: its two legs on one side are cut near the ground, and
    // it goes over across the picture. Seen from in front of its fall it looked upright.
    stand: { from: [YARD.tower[0] - 5, YARD.tower[1] - 23], up: 2.5, to: YARD.tower, high: 12.5 }, near: [45, STEEL, WOOD], inAir: true, falls: 1,
    act: async (page) => {
      const [x, z] = YARD.tower
      for (const dz of [-1.9, 1.9]) await strikeAt(page, [x - 1.9, z + dz], 1.2, 14, false)
      await page.waitForFunction(() => globalThis.engine.leaning > 42, null, { timeout: 12_000 })
      return page.screenshot()
    } },
  { key: 'blast', what: 'An explosion: a ball of fire, smoke, pieces flung', theirs: ['engine', 38.6], state: 'level',
    stand: FRONT, near: [16, ...HOUSE], inAir: true,
    act: async (page) => {
      await blast(page, 16)
      await page.waitForFunction(() => globalThis.engine.bodies > 0, null, { timeout: 4000 })
      await page.waitForTimeout(200)
      return page.screenshot()
    } },
  { key: 'fire', what: 'Fire that keeps burning, with smoke rising from it', theirs: ['engine', 53.6], state: 'ahead',
    stand: [-1, 1.8, -0.83, -0.88 / DEG, 0.5 / DEG], near: [12, LEAVES], burns: true,
    act: async (page) => {
      // A street tree's crown set alight, and watched from under it.
      await page.evaluate(() => globalThis.engine.ignite(4))
      await page.evaluate(() => { globalThis.engine.pose.pitch = 0.3 })
      await page.waitForTimeout(2600)
      return page.screenshot()
    } },
  { key: 'water', what: 'Water that flows and foams', theirs: ['engine', 21.6], state: 'behind',
    // The yard's water tower from beside it: a charge low on its tank, and the forty cubic metres in it come down
    // the tower and out over the yard. Flowing water is not cells (the core's water.rs): it is a surface.
    stand: { from: [32.5, 415.5], up: 1.3, to: YARD.tower, high: 4.2 }, near: [40, STEEL, WOOD], aim: [0, 0.6], flows: 2500,
    act: async (page) => {
      await strikeAt(page, [YARD.tower[0] - 1.25, YARD.tower[1] - 1.43], 12.6, 8, false)
      await page.waitForFunction(() => globalThis.engine.water.columns > 2500, null, { timeout: 12_000 })
      await page.waitForTimeout(500)
      return page.screenshot()
    } },
  { key: 'rubble', what: 'What came down lies in heaps', theirs: ['engine', 51.8], state: 'level',
    // From the road, low: three big charges at the feet of the houses across it, and what they bring down. The
    // houses burn and are still letting things go forty seconds on, when the picture is taken. Before rubble lay in
    // heaps that picture was of things in the air (the fourth judge: "frozen in mid-air").
    stand: [-2, 2.2, 3.5, 9, 6], near: [18, ...HOUSE], falls: 600,
    act: async (page) => {
      for (const turn of [-0.3, 0, 0.3]) { await charge(page, turn, 32, 0.02); await page.waitForTimeout(700) }
    } },
  { key: 'glass', what: 'Glass fronts that break by the pane', theirs: ['engine', 19.6], state: 'level',
    // The near wall of the yard's office of glass, struck a little above the eye.
    stand: { from: [YARD.office[0] - 3, YARD.office[1] - 14], up: 2.2, to: [YARD.office[0], YARD.office[1] - 5], high: 3 }, near: [14, GLASS], inAir: true,
    act: async (page) => {
      await blast(page, 8)
      await page.waitForFunction(() => globalThis.engine.bodies > 0, null, { timeout: 4000 })
      await page.waitForTimeout(250)
      return page.screenshot()
    } },
  { key: 'frame', what: 'A building stripped to its frame', theirs: ['engine', 41.6], state: 'behind',
    // The yard's office, six storeys of glass: charges along its near side and inside it take the glass and leave
    // the steel and the floors.
    stand: { from: [YARD.office[0] - 21, YARD.office[1] - 20], up: 7, to: YARD.office, high: 9 }, near: [40, GLASS, STEEL, CONCRETE], falls: 100,
    act: async (page) => {
      const [x, z] = YARD.office
      for (const [dx, dz, high] of [[-5, -4, 2], [0, -4, 6], [4, -3, 3], [-2, 2, 5], [3, 3, 8], [-4, -3, 11], [2, -4, 14], [4, 2, 12], [-3, 3, 16], [0, 0, 9]]) {
        await strikeAt(page, [x + dx, z + dz], high, 26, false)
        await page.waitForTimeout(500)
      }
    } },
  { key: 'tools', what: 'A bar of tools to pick from', theirs: ['engine', 26.4], state: 'level',
    stand: FRONT, near: [16, ...HOUSE],
    act: async (page) => {
      // The bar, the cannon picked, and its ball on the way to a house front.
      await page.addStyleTag({ content: '#tools { display: flex !important }' })
      await page.evaluate(() => { globalThis.engine.pickTool(3); globalThis.engine.shoot() })
      await page.waitForTimeout(330)
      return page.screenshot()
    } },
  { key: 'ruin', what: 'A whole district brought down', theirs: ['engine', 55.4], state: 'level',
    // From over the yard, the row of houses across the street: big charges at their feet, one after another.
    stand: [8, 17, 13, 0, -0.5 / DEG], near: [60, ...HOUSE, 14], falls: 1000,
    act: async (page) => {
      // The biggest charge on the bar, ten times, along as much of the row as the picture holds.
      for (const turn of [-0.9, -0.7, -0.5, -0.3, -0.1, 0.1, 0.3, 0.5, 0.7, 0.9]) { await charge(page, turn, 32, -0.62); await page.waitForTimeout(700) }
    } },
  // The same engine as the Earth.
  { key: 'sunset', what: 'A coast at sunset: a low sun, its path on the water, lit clouds', theirs: ['earth', 1.2], state: 'behind',
    // From the town's shore over its lake to where the sun goes down over the mountains beyond it, towers either side.
    stand: { from: [-1200, 407], up: 4, to: [-2000, -193], high: 30 }, hour: 17.35, near: [400, WATER] },
  { key: 'under', what: 'Under water: shafts of light, weed', theirs: ['earth', 5.6], state: 'behind',
    // On the floor of the town's lake, 11 m down, at a clearing in a grove of ribbon weed, looking up the slope to
    // where the light comes in. (`up` is over the floor: where there is sea, `engine.ground` is its floor.)
    stand: { from: [-1276, 398], up: 2.5, to: [-1262, 412], high: 5.5 }, near: [60, 2, 4, LEAVES] },
  { key: 'snow', what: 'Mountains under snow, seen from far', theirs: ['earth', 8.2], state: 'behind',
    // The range north of the town from the hills before it: pines below, rock, snow on the tops and in the gullies.
    stand: { from: [300, -5200], up: 60, to: [-300, -9000], high: 1700 }, near: [8000, ROCK] },
  { key: 'rain', what: 'A street at night in rain: lamps, lit windows, wet stone', theirs: ['earth', 11.6], state: 'behind',
    // Down the street by the start from low over the wet road: a record shop's sign and the lit windows in it.
    stand: [30, 1.5, 2.2, 300, 5], hour: 21, rain: 1, near: [80, LAMP] },
  { key: 'road', what: 'Open land to the horizon', theirs: ['earth', 17.6], state: 'level',
    // The road out of town across the dry plain, 6 km east of the start, at sunrise: poles down one side of it.
    stand: { from: [6100, 407], up: 1.8, to: [9000, 407], high: 25 }, hour: 6.45, near: [300, SAND, ASPHALT] },
  { key: 'whole', what: 'A real city seen whole from far off', theirs: ['earth', 21.8], state: 'behind',
    // The town across its lake, from over the land west of it. It is an invented town: the row is of a real one.
    stand: [-1500, 160, -300, 80, -7], near: [3000, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14] },
  { key: 'signs', what: 'A square of lit signs at night, people and cars in it', theirs: ['earth', 27.2], state: 'behind',
    // The five shops across from the yard's water tower, on a wet night: a sign over every door. No square, no people.
    stand: { from: [46, 411], up: 1.7, to: [30, 399.8], high: 3.4 }, hour: 21, rain: 0.35, near: [80, LAMP] },
  { key: 'dusk', what: 'A real city from the air at dusk, its windows lit', theirs: ['earth', 34.2], state: 'level',
    // The towers from 200 m up as the sun goes. It is an invented town: the row is of a real one.
    stand: [300, 200, 0, 250, -18], hour: 17.95, near: [3000, CONCRETE, BRICK, PLASTER, WOOD, GLASS, STEEL] },
  { key: 'space', what: 'From space down to the ground', theirs: ['earth', 39.2], state: 'none' },
  { key: 'there', what: 'Anything broken there too', theirs: ['earth', 43.6], state: 'level',
    // In the pine woods before the mountains, 5 km north of the town: a charge among the trees.
    stand: { from: [-145, -4970], up: 2.2, to: [-145, -5070], high: 14 }, near: [16, LEAVES, WOOD], inAir: true,
    act: async (page) => {
      await blast(page, 20)
      await page.waitForFunction(() => globalThis.engine.bodies > 0, null, { timeout: 6000 })
      await page.waitForTimeout(350)
      return page.screenshot()
    } },
  // What their films do not show. These count only on top of the rows above.
  { key: 'live', what: 'Shown live, 60 frames a second on an M1 Pro (their film was captured frame by frame)', state: 'ahead', note: 'node test/flight.mjs; node test/bench.mjs' },
  { key: 'phone', what: '60 frames a second on a real iPhone, things falling', state: 'ahead', note: 'the owner\'s iPhone, November 11: node test/read.mjs' },
  { key: 'shared', what: 'People and agents in one world that is kept', state: 'none' },
]
