// The three bench scenes, written only against core.ts.
import type { BodyId, Material, PhysicsCore, Quat, Vec3 } from './core.ts'

export const STEEL: Material = { name: 'steel', friction: 0.2, restitution: 0.5, density: 7762 } // 27 mm ball = 80 g
export const WOOD: Material = { name: 'wood', friction: 0.4, restitution: 0.5, density: 600 }
export const RUBBER: Material = { name: 'rubber', friction: 0.8, restitution: 0.8, density: 1100 }
export const GLASS: Material = { name: 'glass', friction: 0.1, restitution: 0.5, density: 2500 }
export const CLOTH: Material = { name: 'cloth', friction: 0.6, restitution: 0.1, density: 400 }
export const SOIL: Material = { name: 'soil', friction: 0.8, restitution: 0.1, density: 1500 }

export function rng(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 4294967296
  }
}

const DT = 1 / 60
const len = (a: Vec3) => Math.hypot(a[0], a[1], a[2])
const yRot = (t: number): Quat => [0, Math.sin(t / 2), 0, Math.cos(t / 2)]

export function percentile(xs: number[], p: number) {
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.min(s.length - 1, Math.floor(p * s.length))]
}

// ---------- Pinball ----------
const BALL_R = 0.0135
const HALF_W = 0.25, HALF_L = 0.5, WALL_HALF = 0.0025, PLAY_H = 0.05
const TILT = (6.5 * Math.PI) / 180

interface Wall { id: BodyId; c: Vec3; angle: number; halfLen: number }

export function buildTable(core: PhysicsCore) {
  core.setRules({ gravity: [0, -9.81 * Math.cos(TILT), 9.81 * Math.sin(TILT)], lengthUnit: 0.05 })
  core.addBody({ shape: { kind: 'box', half: [0.3, 0.01, 0.6] }, material: WOOD, motion: 'static', position: [0, -0.01, 0] })
  core.addBody({ shape: { kind: 'box', half: [0.3, 0.005, 0.6] }, material: GLASS, motion: 'static', position: [0, PLAY_H + 0.005, 0] })
  const walls: Wall[] = []
  const wall = (c: Vec3, angle: number, halfLen: number) => {
    const id = core.addBody({ shape: { kind: 'box', half: [halfLen, PLAY_H / 2, WALL_HALF] }, material: WOOD, motion: 'static', position: c, rotation: yRot(angle) })
    walls.push({ id, c, angle, halfLen })
  }
  wall([0, PLAY_H / 2, -HALF_L], 0, HALF_W + WALL_HALF)
  wall([0, PLAY_H / 2, HALF_L], 0, HALF_W + WALL_HALF)
  wall([-HALF_W, PLAY_H / 2, 0], Math.PI / 2, HALF_L + WALL_HALF)
  wall([HALF_W, PLAY_H / 2, 0], Math.PI / 2, HALF_L + WALL_HALF)
  // Three thin interior guide walls at odd angles.
  wall([-0.12, PLAY_H / 2, 0.15], 0.6, 0.06)
  wall([0.12, PLAY_H / 2, 0.15], -0.6, 0.06)
  wall([0.1, PLAY_H / 2, -0.3], 1.1, 0.05)
  const bumper = core.addBody({ shape: { kind: 'capsule', halfHeight: 0.01, radius: 0.02 }, material: RUBBER, motion: 'static', position: [-0.08, PLAY_H / 2, -0.15] })
  return { walls, bumper }
}

/** Signed distance of p from a wall's mid plane, and whether p is within its length. */
function wallSide(w: Wall, p: Vec3): [number, boolean] {
  const dx = p[0] - w.c[0], dz = p[2] - w.c[2]
  const along = dx * Math.cos(w.angle) - dz * Math.sin(w.angle)
  const across = dx * Math.sin(w.angle) + dz * Math.cos(w.angle)
  return [across, Math.abs(along) < w.halfLen - BALL_R]
}

/** Whether the straight path prev -> q crosses the wall's mid plane within its length. */
function crossesWall(w: Wall, prev: Vec3, q: Vec3) {
  const [a0] = wallSide(w, prev), [a1] = wallSide(w, q)
  if (Math.sign(a0) === Math.sign(a1)) return false
  const t = a0 / (a0 - a1)
  const x: Vec3 = [prev[0] + (q[0] - prev[0]) * t, 0, prev[2] + (q[2] - prev[2]) * t]
  return wallSide(w, x)[1]
}

function escaped(p: Vec3) {
  return Math.abs(p[0]) > HALF_W + WALL_HALF || Math.abs(p[2]) > HALF_L + WALL_HALF || p[1] < -0.002 || p[1] > PLAY_H + 0.002 || !Number.isFinite(p[0])
}

export function pinballShots(core: PhysicsCore, shots: number, speed: number, seed = 1) {
  const { walls } = buildTable(core)
  const ball = core.addBody({ shape: { kind: 'sphere', radius: BALL_R }, material: STEEL, motion: 'dynamic', position: [0, BALL_R, 0] })
  const r = rng(seed)
  let tunneled = 0
  const t0 = performance.now()
  let frames = 0
  for (let s = 0; s < shots; s++) {
    let p: Vec3
    do p = [(r() * 2 - 1) * (HALF_W - 0.03), BALL_R + 0.0005, (r() * 2 - 1) * (HALF_L - 0.03)]
    while (walls.slice(4).some(w => { const [a, inside] = wallSide(w, p); return Math.abs(a) < 0.03 && inside }) || Math.hypot(p[0] + 0.08, p[2] + 0.15) < 0.05)
    const h = r() * Math.PI * 2
    core.setState(ball, p, [Math.cos(h) * speed, 0, Math.sin(h) * speed])
    let prev = p
    let bad = false
    for (let f = 0; f < 45 && !bad; f++) {
      core.step(DT)
      frames++
      const q = core.position(ball)
      if (escaped(q)) bad = true
      for (const w of walls.slice(4)) if (crossesWall(w, prev, q)) bad = true
      prev = q
    }
    core.contacts()
    if (bad) tunneled++
  }
  const final = core.position(ball)
  return { tunneled, msPerFrame: (performance.now() - t0) / frames, final }
}

/** Bumper gadget: on a ball/bumper contact, kick the ball 2.5 m/s along the normal. */
export function bumperShots(core: PhysicsCore, shots: number, seed = 2) {
  const { bumper } = buildTable(core)
  const ball = core.addBody({ shape: { kind: 'sphere', radius: BALL_R }, material: STEEL, motion: 'dynamic', position: [0, BALL_R, 0] })
  const r = rng(seed)
  const bc: Vec3 = [-0.08, 0, -0.15]
  let detected = 0
  const outSpeed: number[] = [], impulses: number[] = []
  for (let s = 0; s < shots; s++) {
    // Start 12 cm from the bumper and aim at it with a small offset.
    const h = r() * Math.PI * 2, off = (r() * 2 - 1) * 0.02
    const p: Vec3 = [bc[0] + Math.cos(h) * 0.12, BALL_R + 0.0005, bc[2] + Math.sin(h) * 0.12]
    if (escaped(p) || Math.abs(p[0]) > HALF_W - 0.02 || Math.abs(p[2]) > HALF_L - 0.02) { s--; continue }
    const d: Vec3 = [-Math.cos(h) - Math.sin(h) * off * 10, 0, -Math.sin(h) + Math.cos(h) * off * 10]
    const n = len(d)
    core.setState(ball, p, [(d[0] / n) * 3, 0, (d[2] / n) * 3])
    core.contacts()
    let kicked = false
    for (let f = 0; f < 15; f++) {
      core.step(DT)
      for (const c of core.contacts()) {
        if (kicked) continue
        const other = c.a === ball ? c.b : c.b === ball ? c.a : -1
        if (other !== bumper) continue
        const sign = c.a === ball ? -1 : 1 // normal points from a to b; we want bumper -> ball
        const m = STEEL.density * (4 / 3) * Math.PI * BALL_R ** 3
        core.applyImpulse(ball, [c.normal[0] * sign * 2.5 * m, 0, c.normal[2] * sign * 2.5 * m])
        impulses.push(c.impulse)
        kicked = true
        detected++
        core.step(DT)
        outSpeed.push(len(core.velocity(ball)))
      }
    }
  }
  const mean = outSpeed.reduce((a, b) => a + b, 0) / Math.max(1, outSpeed.length)
  const sd = Math.sqrt(outSpeed.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, outSpeed.length))
  return { shots, detected, outMean: mean, outSd: sd, impulseMedian: impulses.length ? percentile(impulses, 0.5) : 0 }
}

/** A 70 mm flipper on a motorised hinge swinging at ~1500 deg/s hits a ball resting against it. */
export function flipperShots(core: PhysicsCore, shots: number, seed = 3) {
  buildTable(core)
  const omega = (1500 * Math.PI) / 180
  const pivot: Vec3 = [-0.06, 0.012, 0.38]
  const half = 0.035
  const flipper = core.addBody({ shape: { kind: 'box', half: [half, 0.01, 0.006] }, material: RUBBER, motion: 'dynamic', position: [pivot[0] + half, pivot[1], pivot[2]] })
  const joint = core.addHinge({ body: flipper, anchor: pivot, axis: [0, 1, 0], limits: [-0.5, 0.5], motor: { velocity: -omega, maxTorque: 50 } })
  const ball = core.addBody({ shape: { kind: 'sphere', radius: BALL_R }, material: STEEL, motion: 'dynamic', position: [0.15, BALL_R, -0.3] })
  const r = rng(seed)
  let tunneled = 0
  const speeds: number[] = []
  for (let s = 0; s < shots; s++) {
    core.setMotorVelocity(joint, -omega)
    core.setState(ball, [0.15, BALL_R + 0.0005, -0.3], [0, 0, 0])
    for (let f = 0; f < 30; f++) core.step(DT)
    const th = -0.5
    const along = 0.01 + r() * 0.055
    const ax: Vec3 = [Math.cos(th), 0, -Math.sin(th)]
    const nrm: Vec3 = [-Math.sin(th), 0, -Math.cos(th)] // the flipper's up-table face
    const gap = 0.006 + BALL_R + 0.0005
    const p: Vec3 = [pivot[0] + ax[0] * along + nrm[0] * gap, BALL_R + 0.0005, pivot[2] + ax[2] * along + nrm[2] * gap]
    core.setState(ball, p, [0, 0, 0])
    core.step(DT)
    core.setMotorVelocity(joint, omega)
    let top = 0, bad = false
    for (let f = 0; f < 20; f++) {
      core.step(DT)
      const q = core.position(ball)
      top = Math.max(top, len(core.velocity(ball)))
      if (escaped(q)) bad = true
    }
    // Tunnelled if the ball ended behind the flipper's line, between pivot and tip.
    const q = core.position(ball)
    const dx = q[0] - pivot[0], dz = q[2] - pivot[2]
    const t = dx * ax[0] + dz * ax[2], across = dx * nrm[0] + dz * nrm[2]
    if (bad || (t > 0 && t < 2 * half && across < 0)) tunneled++
    speeds.push(top)
    core.contacts()
  }
  return { tunneled, speedMedian: percentile(speeds, 0.5), speedMin: percentile(speeds, 0) }
}

// ---------- Scale ----------
export function scaleScene(core: PhysicsCore, opts: { warm: number; frames: number; overlapQueries: number }) {
  core.setRules({ gravity: [0, -9.81, 0], lengthUnit: 1 })
  core.addBody({ shape: { kind: 'box', half: [25, 0.5, 25] }, material: WOOD, motion: 'static', position: [0, -0.5, 0] })
  const r = rng(7)
  const boxes: BodyId[] = []
  for (let i = 0; i < 180; i++) {
    const half: Vec3 = [0.2 + r() * 0.3, 0.2 + r() * 0.3, 0.2 + r() * 0.3]
    const x = ((i % 15) - 7) * 1.6, z = (Math.floor(i / 15) - 6) * 1.6
    boxes.push(core.addBody({ shape: { kind: 'box', half }, material: WOOD, motion: 'dynamic', position: [x, half[1] + 0.02, z], rotation: yRot(r() * 3) }))
  }
  const villagers: { id: BodyId; cx: number; cz: number; ph: number }[] = []
  for (let i = 0; i < 20; i++) {
    const cx = (r() * 2 - 1) * 9, cz = (r() * 2 - 1) * 8, ph = r() * 6
    villagers.push({ id: core.addBody({ shape: { kind: 'capsule', halfHeight: 0.5, radius: 0.25 }, material: CLOTH, motion: 'kinematic', position: [cx + 3 * Math.cos(ph), 0.75, cz + 3 * Math.sin(ph)] }), cx, cz, ph })
  }
  const times: number[] = []
  const queryTimes: number[] = []
  let t = 0, contactsSeen = 0
  for (let f = 0; f < opts.warm + opts.frames; f++) {
    t += DT
    for (const v of villagers) {
      const a = v.ph + t * 0.4 // 1.2 m/s on a 3 m circle
      core.setKinematicTarget(v.id, [v.cx + 3 * Math.cos(a), 0.75, v.cz + 3 * Math.sin(a)])
    }
    const t0 = performance.now()
    core.step(DT)
    contactsSeen += core.contacts().length
    const t1 = performance.now()
    if (f >= opts.warm) times.push(t1 - t0)
    if (opts.overlapQueries && f >= opts.warm) {
      const q0 = performance.now()
      let n = 0
      for (let i = 0; i < opts.overlapQueries; i++) n += core.overlapSphere([((i % 10) - 5) * 2, 0.5, (Math.floor(i / 10) - 2.5) * 3], 1).length
      queryTimes.push(performance.now() - q0)
      if (n < 0) throw new Error()
    }
  }
  const fallen = boxes.filter(b => !Number.isFinite(core.position(b)[1]) || core.position(b)[1] < -0.1).length
  return { median: percentile(times, 0.5), p95: percentile(times, 0.95), fallen, contactsSeen, queryMedian: queryTimes.length ? percentile(queryTimes, 0.5) : NaN }
}

// ---------- Heightfield ----------
export function heightfieldScene(core: PhysicsCore) {
  core.setRules({ gravity: [0, -9.81, 0], lengthUnit: 1 })
  const n = 128, size = 32, cell = size / (n - 1)
  const heights = new Float32Array(n * n)
  const worldX = (i: number) => -size / 2 + i * cell
  for (let z = 0; z < n; z++) for (let x = 0; x < n; x++) heights[z * n + x] = 0.5 * Math.sin(worldX(x) / 3) * Math.cos(worldX(z) / 4)
  const terrain = core.addBody({ shape: { kind: 'heightfield', n, size, heights: heights.slice() }, material: SOIL, motion: 'static', position: [0, 0, 0] })
  const surface = (px: number, pz: number) => {
    const fx = (px + size / 2) / cell, fz = (pz + size / 2) / cell
    const x0 = Math.floor(fx), z0 = Math.floor(fz), tx = fx - x0, tz = fz - z0
    const h = (x: number, z: number) => heights[z * n + x]
    return (h(x0, z0) * (1 - tx) + h(x0 + 1, z0) * tx) * (1 - tz) + (h(x0, z0 + 1) * (1 - tx) + h(x0 + 1, z0 + 1) * tx) * tz
  }
  const HALF = 0.25
  const boxes: BodyId[] = []
  const r = rng(11)
  // 9 boxes on the central patch, 31 elsewhere.
  for (let i = 0; i < 9; i++) {
    const x = ((i % 3) - 1) * 1.1, z = (Math.floor(i / 3) - 1) * 1.1
    boxes.push(core.addBody({ shape: { kind: 'box', half: [HALF, HALF, HALF] }, material: WOOD, motion: 'dynamic', position: [x, surface(x, z) + HALF + 0.05, z] }))
  }
  for (let i = 0; i < 31; i++) {
    let x: number, z: number
    do { x = (r() * 2 - 1) * 13; z = (r() * 2 - 1) * 13 } while (Math.abs(x) < 7 && Math.abs(z) < 7)
    boxes.push(core.addBody({ shape: { kind: 'box', half: [HALF, HALF, HALF] }, material: WOOD, motion: 'dynamic', position: [x, surface(x, z) + HALF + 0.05, z] }))
  }
  const run = (frames: number) => { for (let f = 0; f < frames; f++) core.step(DT); core.contacts() }
  const correct = (ids: BodyId[]) => ids.filter(b => { const p = core.position(b); return Math.abs(p[1] - (surface(p[0], p[2]) + HALF)) < 0.12 }).length
  run(360)
  const sleptBefore = boxes.filter(b => core.sleeping(b)).length
  const mappingOk = correct(boxes)

  const edit = (x0: number, z0: number, w: number, h: number, f: (x: number, z: number) => number) => {
    const vals = new Float32Array(w * h)
    for (let z = 0; z < h; z++) for (let x = 0; x < w; x++) {
      const i = (z0 + z) * n + x0 + x
      heights[i] = f(x0 + x, z0 + z)
      vals[z * w + x] = heights[i]
    }
    const t0 = performance.now()
    core.editHeights(terrain, x0, z0, w, h, vals)
    return performance.now() - t0
  }
  const patch = boxes.slice(0, 9)
  // Edit 1: raise a 16x16 patch under the 9 resting boxes by 0.15 m (under half a box, so the centre stays above).
  const c = n / 2 - 8
  const raiseMs = edit(c, c, 16, 16, (x, z) => heights[z * n + x] + 0.15)
  const awakeAfterRaise = patch.filter(b => !core.sleeping(b)).length
  run(120)
  const raiseOk = correct(patch)
  // Edit 2: a 48x48 crater 2 m deep under them.
  const cc = n / 2 - 24
  const craterMs = edit(cc, cc, 48, 48, (x, z) => {
    const dx = worldX(x), dz = worldX(z), d = Math.hypot(dx, dz) / (24 * cell)
    return d < 1 ? heights[z * n + x] - 2 * (1 - d * d) : heights[z * n + x]
  })
  const awakeAfterCrater = patch.filter(b => !core.sleeping(b)).length
  run(300)
  const craterOk = correct(patch)
  const outsideOk = correct(boxes.slice(9))
  return { sleptBefore, total: boxes.length, mappingOk, raiseMs, awakeAfterRaise, raiseOk, craterMs, awakeAfterCrater, craterOk, outsideOk }
}

/** Restitution fidelity: a 10 m/s ball square into a wall (steel 0.5, wood 0.5, average combine) should leave at ~5 m/s. */
export function bounceShots(core: PhysicsCore, shots: number, speed = 10, seed = 4) {
  buildTable(core)
  core.setRules({ gravity: [0, -9.81, 0] })
  const ball = core.addBody({ shape: { kind: 'sphere', radius: BALL_R }, material: STEEL, motion: 'dynamic', position: [0, BALL_R, 0] })
  const r = rng(seed)
  const ratios: number[] = []
  for (let s = 0; s < shots; s++) {
    const d = 0.05 + r() * 0.15
    core.setState(ball, [HALF_W - WALL_HALF - BALL_R - d, BALL_R + 0.0002, 0.3], [speed, 0, 0])
    let out = 0
    for (let f = 0; f < 10; f++) {
      core.step(DT)
      const vx = core.velocity(ball)[0]
      if (vx < 0) { core.step(DT); out = -core.velocity(ball)[0]; break }
    }
    ratios.push(out / speed)
    core.contacts()
  }
  return { median: percentile(ratios, 0.5), min: percentile(ratios, 0), max: percentile(ratios, 1) }
}
