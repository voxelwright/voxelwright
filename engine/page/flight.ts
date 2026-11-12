// The flight that measures (#140). It takes the camera to a few places over one street, the
// worst ones on purpose (standing in the street, among the roofs, high enough to see the whole
// town), times the march at each three ways (the rays a pixel sends, then with the sun's
// shadows, then with mirrors too) at the device's own pace, then flies between them for a
// while to see whether frames hold as the device warms. Each part is posted as it finishes.
import { offscreen, pace, type Gpu } from '../probe/gpu.ts'
import { nextFrame, round, type Report } from '../probe/tell.ts'
import { MIRRORS, SHADOWS, type Marcher, type View } from './march.ts'
import type { World } from './world.ts'

export interface Pose { x: number; y: number; z: number; yaw: number; pitch: number }

export interface Flown {
  gpu: Gpu
  world: World
  march: Marcher
  pose: Pose
  view(): View
  /** The street the flight is over: a point in the middle of it, metres, y at the ground. */
  street: { x: number; y: number; z: number }
  /** The canvas in pixels. */
  canvas(): [number, number]
  /** Stops and starts the page's own drawing, so nothing else is on the GPU while a place is timed. */
  pause(on: boolean): void
  /** What the page is doing now: frames a second, the march's GPU time, pixels marched for each shown. */
  now(): { frameMs: number; gpuMs: number; scale: number }
  /** Calls `each` with every gap between frames until the returned function is called. */
  watch(each: (gap: number) => void): () => void
  report: Report
  post(stage: string): Promise<boolean>
  say(text: string): void
  /** How long to fly between the places at the end, seconds. */
  seconds: number
  /** Breaks what is straight ahead, as a hand would; null for sky. */
  blast(radius: number): Promise<{ t: number; material: number } | null>
  /** What is loose: whether a blast is still being worked out, bodies not yet part of the town again, all that has come loose so far, the longest the solver took over a frame and the most bodies it moved at once. */
  falling(): { settling: boolean; dropping: number; pieces: number; cells: number; ms: number; stepMs: number; most: number }
  /** Whether to break things at the end. */
  breaks: boolean
}

const DEG = Math.PI / 180

export async function flight(f: Flown) {
  const { gpu, world, march, pose, street, report } = f
  const places: [string, Pose][] = [
    ['street', { x: street.x, y: street.y + 1.8, z: street.z, yaw: 90 * DEG, pitch: -2 * DEG }],
    ['fronts', { x: street.x, y: street.y + 1.8, z: street.z, yaw: 60 * DEG, pitch: 5 * DEG }],
    ['roofs', { x: street.x, y: street.y + 12, z: street.z, yaw: 20 * DEG, pitch: -8 * DEG }],
    ['high', { x: street.x, y: street.y + 130, z: street.z, yaw: 30 * DEG, pitch: -22 * DEG }],
    ['far', { x: street.x, y: street.y + 730, z: street.z, yaw: 200 * DEG, pitch: -30 * DEG }],
  ]
  const made = async () => { const t0 = performance.now(); while (world.stats.wanted > 0 || world.stats.ready === 0) await nextFrame(); return performance.now() - t0 }

  f.say('Making the town')
  const first = await made()
  const s = world.stats
  report.world = { ms: Math.round(first), grid: world.options.grid, levels: world.options.levels, workers: world.options.workers, sectors: s.ready, made: s.made, makeMs: round(s.makeMs / Math.max(1, s.made)), poolMb: Math.round(s.poolUsed / 262144), poolOfMb: Math.round(s.poolWords / 262144), full: s.full, whole: s.wholeLevels }
  await f.post('made')

  // Each place at the device's own pace, at a size that does not depend on what the page is showing.
  // A desk's screen is timed whole; a phone at half size each way, which is about what it will be shown.
  const canvas = f.canvas(), small = navigator.maxTouchPoints === 0 ? 1 : 0.5
  const size: [number, number] = [Math.round(canvas[0] * small), Math.round(canvas[1] * small)]
  const to = offscreen(gpu, size)
  const timed: Record<string, unknown>[] = report.places = []
  for (const [i, [name, at]] of places.entries()) {
    f.say(`Looking from ${name} (${i + 1} of ${places.length})`)
    Object.assign(pose, at)
    await nextFrame()
    await nextFrame()
    const wait = await made()
    // A moment of the page's own drawing: what it holds here by itself. Then until the sun's maps round here are drawn, or ten seconds.
    await new Promise((r) => setTimeout(r, 1200))
    const live = f.now(), t0 = performance.now()
    while (march.sun.undrawn > 0 && performance.now() - t0 < 10_000) await nextFrame()
    const mapsMs = Math.round(performance.now() - t0), undrawn = march.sun.undrawn
    f.pause(true)
    const view = f.view(), row: Record<string, unknown> = { name, madeMs: Math.round(wait), size, mp: round((size[0] * size[1]) / 1e6), fps: Math.round(1000 / live.frameMs), scale: live.scale, liveGpuMs: round(live.gpuMs), mapsMs, undrawn }
    // The rays a pixel sends; then with the sun's shadows from its maps; then with mirrors too; then with every shadow traced, as it was before the maps.
    for (const [key, flags, maps] of [['rays', 0, true], ['shadows', SHADOWS, true], ['all', SHADOWS | MIRRORS, true], ['traced', SHADOWS | MIRRORS, false]] as const) {
      march.maps = maps
      const p = await pace(gpu, to, (encoder, target) => march.draw(encoder, target, view, flags, 0), 120)
      row[key] = round(p.ms)
    }
    march.maps = true
    f.pause(false)
    timed.push(row)
    await f.post('places')
  }
  to.destroy()

  if (f.seconds > 0) {
    // Between the places and back, steadily, the picture's size left to follow the GPU.
    const route = [...places.map((p) => p[1]), ...places.map((p) => p[1]).reverse().slice(1)]
    const seconds: Record<string, number>[] = [], told: { seconds: Record<string, number>[]; shortest: number } = { seconds, shortest: Infinity }
    report.flight = told
    let gaps: number[] = []
    // The shortest gap between two frames is the screen's own rate, whatever the page was doing when it was first asked.
    const stop = f.watch((gap) => { gaps.push(gap); told.shortest = Math.min(told.shortest, round(gap, 1)) })
    const start = performance.now(), leg = (f.seconds * 1000) / (route.length - 1)
    let mark = start
    for (;;) {
      // A frame's time is when it began, which can be before `start` was read: never before the first leg.
      const now = await nextFrame(), along = Math.max(0, (now - start) / leg)
      if (along >= route.length - 1) break
      const a = route[Math.floor(along)], b = route[Math.floor(along) + 1], u = along - Math.floor(along), k = u * u * (3 - 2 * u)
      for (const key of ['x', 'y', 'z', 'yaw', 'pitch'] as const) pose[key] = a[key] + (b[key] - a[key]) * k
      if (now - mark < 1000 || !gaps.length) continue
      gaps.sort((p, q) => p - q)
      const live = f.now(), t = Math.round((now - start) / 1000)
      seconds.push({ t, frames: gaps.length, p50: round(gaps[gaps.length >> 1], 1), p95: round(gaps[Math.floor(gaps.length * 0.95)], 1), max: round(gaps[gaps.length - 1], 1), scale: live.scale, gpuMs: round(live.gpuMs), wanted: world.stats.wanted })
      f.say(`Flying: ${Math.max(0, Math.round(f.seconds - t))} s left`)
      gaps = []
      mark = now
    }
    stop()
    report.full = world.stats.full
    await f.post('flight')
  }
  if (f.breaks) {
    // Last, so that nothing above is timed in a broken town: a street tree's trunk is cut, then five charges go
    // across a house front. Each is watched until what it left unheld has landed and the town is made again.
    const front = { x: street.x, y: street.y + 3.5, z: street.z + 4, pitch: 0.22 }
    const aims: [string, Pose, number][] = [
      ['tree', { x: street.x - 1, y: street.y + 1.8, z: street.z - 0.83, yaw: -0.88, pitch: -0.086 }, 6],
      ...[-0.22, 0, 0.22, -0.11, 0.11].map((turn): [string, Pose, number] => ['front', { ...front, yaw: 0.16 + turn }, 16]),
    ]
    const still = () => world.stats.wanted === 0 && world.stats.stale === 0
    const broken: Record<string, unknown>[] = report.breaks = []
    for (const [i, [name, at, radius]] of aims.entries()) {
      f.say(`Breaking a ${name === 'tree' ? 'tree' : 'house front'} (${i + 1} of ${aims.length})`)
      Object.assign(pose, at)
      let t0 = performance.now()
      for (;;) { const now = await nextFrame(); if ((still() && march.sun.undrawn === 0 && march.sun.spoiled === 0 && now - t0 > 400) || now - t0 > 10_000) break }
      const before = f.falling(), gaps: number[] = []
      const stop = f.watch((gap) => gaps.push(gap))
      t0 = performance.now()
      const hit = await f.blast(radius)
      let answered = 0, late = false
      for (;;) {
        const now = await nextFrame(), s = f.falling()
        if (!answered && !s.settling) answered = now - t0
        if (!s.settling && s.dropping === 0 && still()) break
        if (now - t0 > 15_000) { late = true; break }
      }
      stop()
      gaps.sort((p, q) => p - q)
      const after = f.falling(), live = f.now()
      broken.push({
        name, hit: hit !== null, off: hit ? round(hit.t / 10, 1) : null, pieces: after.pieces - before.pieces, cells: after.cells - before.cells, workedMs: Math.round(after.ms), answeredMs: Math.round(answered), allMs: Math.round(performance.now() - t0), late, stepMs: round(after.stepMs, 1), most: after.most,
        frames: gaps.length, p50: round(gaps[gaps.length >> 1] ?? 0, 1), p95: round(gaps[Math.floor(gaps.length * 0.95)] ?? 0, 1), max: round(gaps[gaps.length - 1] ?? 0, 1), long: gaps.filter((g) => g > 25).length, scale: live.scale,
      })
    }
    await f.post('breaks')
  }
  Object.assign(pose, places[0][1])
  f.say('')
}
