// The rows of the board against the reference (#144): one for each thing a viewer sees in the
// two films of the review the owner linked, and how to set up our shot of the same thing on the
// city page. `node test/versus.mjs` draws the board; `node test/clip.mjs` films a row.
//
// `state` is a judgement, changed only when a row has been looked at side by side:
//   none    we have nothing to show        behind  we show it, theirs is better
//   level   as good to look at             ahead   ours is better
// Shown live and measured counts for nothing until a row is level to look at.
export const DEG = Math.PI / 180

/** Where the page starts: over the middle of a street. Shots are given from there, metres and degrees. */
export const from = (page, dx, up, dz, yaw, pitch) => page.evaluate(([dx, up, dz, yaw, pitch]) => {
  const e = globalThis.engine
  e.home ??= { ...e.pose }
  Object.assign(e.pose, { x: e.home.x + dx, y: e.home.y - 12 + up, z: e.home.z + dz, yaw, pitch })
}, [dx, up, dz, yaw * DEG, pitch * DEG])

/**
 * The rows. `theirs` is a film and the second to take the frame at. `stand` is where our shot is taken from (metres
 * from the start along x, over the street, along z; then degrees turned and tilted); `act` is what is done there, and
 * may return a picture taken mid-way (things in the air), else the picture is taken when all is still again.
 */
export const ROWS = [
  // The town of cells being broken.
  { key: 'town', what: 'A town of things worth breaking: towers on legs, a fuel station, shops with signs', theirs: ['engine', 0.6], state: 'behind',
    stand: [0, 1.8, 0, 90, -2] },
  { key: 'light', what: 'Daylight: clouds, soft shadows, darker corners, haze with distance', theirs: ['engine', 13.2], state: 'behind',
    stand: [0, 1.8, 0, 60, 5] },
  { key: 'tumble', what: 'A wall that is hit comes apart in pieces that turn as they fall', theirs: ['engine', 30.0], state: 'behind',
    stand: [0, 3.5, -4, 3.3 / DEG, 0.22 / DEG],
    act: async (page) => {
      await page.evaluate(() => globalThis.engine.blast(16))
      await page.waitForFunction(() => globalThis.engine.dropping > 0, null, { timeout: 4000 }).catch(() => {})
      await page.waitForTimeout(450)
      return page.screenshot()
    } },
  { key: 'topple', what: 'A tall thing leans over and comes down whole', theirs: ['engine', 28.8], state: 'behind',
    stand: [-1, 1.8, -0.83, -0.88 / DEG, -0.086 / DEG],
    act: async (page) => {
      // A street tree's trunk cut through; then the head is lifted to watch it go.
      await page.evaluate(() => globalThis.engine.blast(6))
      await page.evaluate(() => { globalThis.engine.pose.pitch += 0.3 })
      await page.waitForFunction(() => globalThis.engine.dropping > 0, null, { timeout: 4000 }).catch(() => {})
      await page.waitForTimeout(900)
      return page.screenshot()
    } },
  { key: 'blast', what: 'An explosion: a ball of fire, smoke, pieces flung', theirs: ['engine', 38.6], state: 'behind',
    stand: [0, 3.5, -4, 3.3 / DEG, 0.22 / DEG],
    act: async (page) => {
      await page.evaluate(() => globalThis.engine.blast(16))
      await page.waitForTimeout(260)
      return page.screenshot()
    } },
  { key: 'fire', what: 'Fire that keeps burning, with smoke rising from it', theirs: ['engine', 48.2], state: 'behind',
    stand: [-1, 1.8, -0.83, -0.88 / DEG, 0.3 / DEG * 1],
    act: async (page) => {
      // A street tree's crown set alight, and watched from under it.
      await page.evaluate(() => { globalThis.engine.pose.pitch = 0.5 })
      await page.waitForTimeout(100)
      await page.evaluate(() => globalThis.engine.ignite(4))
      await page.evaluate(() => { globalThis.engine.pose.pitch = 0.3 })
      await page.waitForTimeout(2600)
      return page.screenshot()
    } },
  { key: 'water', what: 'Water that flows and foams', theirs: ['engine', 21.6], state: 'none' },
  { key: 'rubble', what: 'What came down lies in heaps', theirs: ['engine', 45.8], state: 'behind',
    stand: [0, 3.5, -4, 3.3 / DEG, 0.22 / DEG],
    act: async (page) => {
      // Five charges across the front, half a second apart: each lands in what the last left moving.
      for (const turn of [-0.22, 0, 0.22, -0.11, 0.11]) {
        await page.evaluate((yaw) => { globalThis.engine.pose.yaw = yaw }, 3.3 + turn)
        await page.waitForTimeout(60)
        await page.evaluate(() => globalThis.engine.blast(16))
        await page.evaluate(() => { globalThis.engine.pose.yaw = 3.3 })
        await page.waitForTimeout(500)
      }
    } },
  { key: 'glass', what: 'Glass fronts that break by the pane', theirs: ['engine', 19.4], state: 'behind',
    stand: [0, 1.8, 0, 0, 7],
    act: async (page) => {
      await page.evaluate(() => globalThis.engine.blast(8))
      await page.waitForTimeout(250)
      return page.screenshot()
    } },
  { key: 'frame', what: 'A building stripped to its frame', theirs: ['engine', 40.8], state: 'none' },
  { key: 'tools', what: 'A bar of tools to pick from', theirs: ['engine', 26.4], state: 'none' },
  { key: 'ruin', what: 'A whole district brought down', theirs: ['engine', 55.4], state: 'none' },
  // The same engine as the Earth.
  { key: 'sunset', what: 'A coast at sunset: a low sun, its path on the water, lit clouds', theirs: ['earth', 1.2], state: 'none' },
  { key: 'under', what: 'Under water: shafts of light, weed', theirs: ['earth', 5.6], state: 'none' },
  { key: 'snow', what: 'Mountains under snow, seen from far', theirs: ['earth', 8.2], state: 'none' },
  { key: 'rain', what: 'A street at night in rain: lamps, lit windows, wet stone', theirs: ['earth', 11.6], state: 'none' },
  { key: 'road', what: 'Open land to the horizon', theirs: ['earth', 17.6], state: 'none' },
  { key: 'whole', what: 'A real city seen whole from far off', theirs: ['earth', 22.6], state: 'behind',
    stand: [0, 130, 0, 30, -22] },
  { key: 'signs', what: 'A square of lit signs at night, people and cars in it', theirs: ['earth', 27.2], state: 'none' },
  { key: 'dusk', what: 'A real city from the air at dusk, its windows lit', theirs: ['earth', 34.2], state: 'none' },
  { key: 'space', what: 'From space down to the ground', theirs: ['earth', 39.2], state: 'none' },
  { key: 'there', what: 'Anything broken there too', theirs: ['earth', 43.6], state: 'none' },
  // What their films do not show. These count only on top of the rows above.
  { key: 'live', what: 'Shown live, 60 frames a second on an M1 Pro (their film was captured frame by frame)', state: 'ahead', note: 'node test/flight.mjs; node test/bench.mjs' },
  { key: 'phone', what: '60 frames a second on a real iPhone, things falling', state: 'ahead', note: 'the owner\'s iPhone, November 11: node test/read.mjs' },
  { key: 'shared', what: 'People and agents in one world that is kept', state: 'none' },
]
