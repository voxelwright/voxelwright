// A house front as the page draws it (#136). The world holds a house as a few boxes (src/houses.ts):
// enough to stand against and to tell an agent what is there. What is seen is built here from the
// same `House`: a wall of boards with its windows let into it, each with a casing, a sill, two
// sashes and glass; a bay whose sides slant back to the wall; a door up two steps in an alcove; a
// garage door under a lintel; a belt, a frieze, brackets and a cornice; and on the tall flat
// fronts a fire escape. Everything stays inside the boxes the world has, so what is seen is what
// is stood against.
import * as THREE from 'three/webgpu'
import { GRADE } from '../../src/ground.ts'
import { BELOW, DEPTH, GARAGE, HOME, LOT, LOTS, STOREY, TRIM, houseFrame, type House } from '../../src/houses.ts'
import { Mesher, rgb, type P3 } from './mesher.ts'
import { CURB } from './street.ts'
import { fronts } from './surfaces.ts'

/** One mesher a material, for a whole block of houses. */
export interface Kit { boards: Mesher; plaster: Mesher; trim: Mesher; glass: Mesher; stone: Mesher; roof: Mesher; iron: Mesher; glow: Mesher; shingle: Mesher; leaf: Mesher }
export const kit = (): Kit => ({ boards: new Mesher(), plaster: new Mesher(), trim: new Mesher(), glass: new Mesher(), stone: new Mesher(), roof: new Mesher(), iron: new Mesher(), glow: new Mesher(), shingle: new Mesher(), leaf: new Mesher() })

interface Hole { z0: number; z1: number; y0: number; y1: number; depth: number }
const IRON = rgb('#23292d'), BRASS = rgb('#c9a455'), ROOFING = rgb('#4f4a50'), STONE = rgb('#b3aca1'), POT = rgb('#b5673f')
const FLOWERS = ['#e0457b', '#f2b233', '#f4f1ea', '#d94a3a', '#8d6fd1', '#f08a5d'].map(rgb), LEAF = rgb('#4f8a45')
/** A repeatable number from 0 to 1 for a house and a thing on it. */
const chance = (a: number, b: number) => { const x = Math.sin(a * 91.7 + b * 47.3) * 43758.5453; return x - Math.floor(x) }
const shade = (c: P3, k: number): P3 => [c[0] * k, c[1] * k, c[2] * k]
const blend = (a: P3, b: P3, t: number): P3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]

/** A cornice's outline, (out, up) from the wall: a bed, a cove, a face and a cap. `s` is its size. */
const cornice = (s: number): [number, number][] => [[0, 0], [0.3 * s, 0], [0.3 * s, 0.1 * s], [0.42 * s, 0.16 * s], [0.62 * s, 0.34 * s], [0.9 * s, 0.44 * s], [1.0 * s, 0.5 * s], [1.0 * s, 0.66 * s], [0, 0.66 * s]]
/** A band's outline: a board with a bead over it. */
const band = (out: number, high: number): [number, number][] => [[0, 0], [out * 0.7, 0], [out * 0.7, high * 0.65], [out, high * 0.72], [out, high], [0, high]]

/** Lays one house into the kit. `fine` leaves out what only shows near (for the rows of other streets). */
export function facade(k: Kit, h: House, fine = true, frame = houseFrame(h)): void {
  const base = new THREE.Matrix4().compose(new THREE.Vector3(frame.at[0], frame.at[1], frame.at[2]), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), frame.yaw), new THREE.Vector3(1, 1, 1))
  const all = Object.values(k) as Mesher[]
  /** What is laid from here on is on a face: `m` puts the face's own frame (x out of it, z along it) in the house's. */
  const on = (m?: THREE.Matrix4) => { const to = m ? base.clone().multiply(m) : base; for (const mesher of all) mesher.place(to) }
  on()

  const down = h.side > 0 ? -1 : 1, half = LOT / 2, top = GARAGE + STOREY * h.storeys, crown = top + 0.5
  const ground = (z: number) => -GRADE * (down * z + LOT / 2) + CURB
  const body = rgb(h.wall), trim = rgb(TRIM), accent = rgb(h.door), foot = shade(body, 0.86)
  const dark = chance(h.number, 1) > 0.55, sash = dark ? blend(accent, [0.02, 0.02, 0.025], 0.55) : trim
  const garageZ = down * (half - 0.57 - 1.25), doorZ = -down * (half - 0.82 - 0.5)
  let windows = 0

  /** A flat wall at `x`, facing out, with holes in it; each hole's sides go back to `depth` behind the face's own plane. */
  const wall = (mesher: Mesher, x: number, z0: number, z1: number, y0: number, y1: number, holes: Hole[], color: P3, sides = color) => {
    const inside = holes.map((o) => ({ ...o, z0: Math.max(z0, o.z0), z1: Math.min(z1, o.z1), y0: Math.max(y0, o.y0), y1: Math.min(y1, o.y1), whole: o })).filter((o) => o.z1 > o.z0 + 1e-4 && o.y1 > o.y0 + 1e-4)
    const cuts = (lo: number, hi: number, of: number[]) => [...new Set([lo, hi, ...of].map((v) => Math.round(v * 1e4) / 1e4))].sort((a, b) => a - b)
    const zs = cuts(z0, z1, inside.flatMap((o) => [o.z0, o.z1])), ys = cuts(y0, y1, inside.flatMap((o) => [o.y0, o.y1]))
    for (let i = 0; i < zs.length - 1; i++) for (let j = 0; j < ys.length - 1; j++) {
      const z = (zs[i] + zs[i + 1]) / 2, y = (ys[j] + ys[j + 1]) / 2
      if (inside.some((o) => z > o.z0 && z < o.z1 && y > o.y0 && y < o.y1)) continue
      mesher.quad([x, ys[j], zs[i + 1]], [x, ys[j], zs[i]], [x, ys[j + 1], zs[i]], [x, ys[j + 1], zs[i + 1]], color)
    }
    // A hole's sides, where they are its own: a hole that runs on past this wall's edge is open there.
    for (const o of inside) {
      if (!o.depth) continue
      const b = -o.depth
      if (o.y0 === o.whole.y0) mesher.quad([x, o.y0, o.z1], [x, o.y0, o.z0], [b, o.y0, o.z0], [b, o.y0, o.z1], sides)
      if (o.y1 === o.whole.y1) mesher.quad([x, o.y1, o.z0], [x, o.y1, o.z1], [b, o.y1, o.z1], [b, o.y1, o.z0], sides)
      if (o.z0 === o.whole.z0) mesher.quad([b, o.y0, o.z0], [x, o.y0, o.z0], [x, o.y1, o.z0], [b, o.y1, o.z0], sides)
      if (o.z1 === o.whole.z1) mesher.quad([x, o.y0, o.z1], [b, o.y0, o.z1], [b, o.y1, o.z1], [x, o.y1, o.z1], sides)
    }
  }

  /** A window let into a face at `x`: its hole is the caller's; this is what fills and frames it. */
  const window = (x: number, zc: number, yc: number, wide: number, tall: number, depth = 0.11): Hole => {
    const z0 = zc - wide / 2, z1 = zc + wide / 2, y0 = yc - tall / 2, y1 = yc + tall / 2, b = x - depth, id = windows++
    // Two sashes, the upper a little in front of the lower, each a frame round a pane.
    const bar = 0.045
    for (const [lo, hi, out] of [[yc - bar / 2, y1, 0.05], [y0, yc + bar / 2, 0.025]]) {
      const f = b + out
      k.trim.box([f - 0.012, (lo + hi) / 2, z0 + bar / 2], [0.012, (hi - lo) / 2, bar / 2], sash, '-x')
      k.trim.box([f - 0.012, (lo + hi) / 2, z1 - bar / 2], [0.012, (hi - lo) / 2, bar / 2], sash, '-x')
      k.trim.box([f - 0.012, lo + bar / 2, zc], [0.012, bar / 2, wide / 2 - bar], sash, '-x')
      k.trim.box([f - 0.012, hi - bar / 2, zc], [0.012, bar / 2, wide / 2 - bar], sash, '-x')
      // The glass carries which window it is (so each has its own curtains) and where on the window a point is.
      const g = f - 0.02, u = (z: number) => (z - z0) / wide, v = (y: number) => (y - y0) / tall
      k.glass.quad([g, lo + bar, z1 - bar], [g, lo + bar, z0 + bar], [g, hi - bar, z0 + bar], [g, hi - bar, z1 - bar], [chance(h.number, id + 3), chance(h.number, id + 41), out], [u(z1 - bar), v(lo + bar), u(z0 + bar), v(hi - bar)])
    }
    // Its casing on the wall: a board up each side, a wider one over the top with a cap, a sill on an apron.
    const board = 0.105, proud = 0.03
    for (const z of [z0 - board / 2, z1 + board / 2]) k.trim.box([x + proud / 2, yc, z], [proud / 2, tall / 2, board / 2], trim, '-x')
    k.trim.box([x + proud / 2, y1 + 0.08, zc], [proud / 2, 0.08, wide / 2 + board], trim, '-x')
    if (fine) k.trim.sweep(cornice(0.13), [[x, z0 - board - 0.03], [x, z1 + board + 0.03]], y1 + 0.16, trim)
    k.trim.box([x + 0.05, y0 - 0.028, zc], [0.075, 0.028, wide / 2 + board + 0.04], trim, '-x')
    if (fine) k.trim.box([x + 0.012, y0 - 0.12, zc], [0.012, 0.065, wide / 2 + board - 0.02], trim, '-x')
    // On some sills a box of flowers.
    if (fine && chance(h.number, id + 17) > 0.72) {
      const pot = chance(h.number, id + 5) > 0.5 ? accent : POT
      k.trim.box([x + 0.2, y0 + 0.03, zc], [0.085, 0.07, wide / 2 - 0.04], shade(pot, 0.8))
      for (let i = 0; i < 7; i++) {
        const z = z0 + 0.1 + ((wide - 0.2) * (i + 0.5)) / 7
        k.leaf.ball([x + 0.2 + (chance(id, i) - 0.5) * 0.05, y0 + 0.13, z], 0.085, LEAF, 0.8, 3, 6)
        k.leaf.ball([x + 0.21 + (chance(id, i + 9) - 0.5) * 0.1, y0 + 0.19 + chance(id, i + 3) * 0.05, z + (chance(id, i + 5) - 0.5) * 0.06], 0.045, FLOWERS[Math.floor(chance(h.number, id + 23) * FLOWERS.length)], 0.8, 3, 6)
      }
    }
    return { z0, z1, y0, y1, depth }
  }

  // ---- the front below the belt: a foot of stone, then plaster, with the garage and the door's alcove let into it
  const garage: Hole = { z0: garageZ - 1.25, z1: garageZ + 1.25, y0: ground(garageZ + down * 1.25) - 0.08, y1: ground(garageZ) + 2.28, depth: 0.24 }
  const entryFoot = ground(doorZ + down * 0.62) - 0.08, step = 0.16, landing = ground(doorZ) + 2 * step
  const entry: Hole = { z0: doorZ - 0.62, z1: doorZ + 0.62, y0: entryFoot, y1: landing + 2.48, depth: 0.9 }
  wall(k.stone, 0.035, -half, half, -BELOW, 0.5, [garage, entry], STONE)
  k.stone.quad([0, 0.5, half], [0.035, 0.5, half], [0.035, 0.5, -half], [0, 0.5, -half], STONE)
  wall(k.plaster, 0, -half, half, 0.5, GARAGE, [garage, entry], foot)

  // The garage door, in four sections, under a lintel.
  const gz = garage.z1 - garage.z0, gy = garage.y1 - garage.y0
  const door = blend(trim, body, 0.18), sill = ground(garageZ) - 0.02
  k.trim.quad([-garage.depth, garage.y0, garage.z1], [-garage.depth, garage.y0, garage.z0], [-garage.depth, garage.y1, garage.z0], [-garage.depth, garage.y1, garage.z1], shade(door, 0.9))
  for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) {
    const hy = (garage.y1 - sill) / 8, hz = gz / 8
    // Each panel is only its face, a hair proud: with sides they catch the low sun as bright lines.
    k.trim.box([-garage.depth + 0.004, sill + hy * (2 * r + 1), garage.z0 + hz * (2 * c + 1)], [0.004, hy - 0.05, hz - 0.05], door, '-x +y -y +z -z')
  }
  for (const z of [garage.z0 - 0.07, garage.z1 + 0.07]) k.trim.box([0.02, garage.y0 + gy / 2, z], [0.02, gy / 2, 0.07], trim, '-x')
  k.trim.box([0.025, garage.y1 + 0.1, garageZ], [0.025, 0.1, gz / 2 + 0.14], trim, '-x')
  if (fine) k.trim.sweep(cornice(0.16), [[0, garage.z0 - 0.18], [0, garage.z1 + 0.18]], garage.y1 + 0.2, trim)

  // The door: two steps up in an alcove, a panelled leaf with a light over it, pilasters and a hood on the wall.
  const back = -entry.depth
  k.plaster.quad([back, landing, entry.z1], [back, landing, entry.z0], [back, entry.y1, entry.z0], [back, entry.y1, entry.z1], shade(foot, 0.96))
  k.stone.box([-0.2, (entryFoot + landing - step) / 2, doorZ], [0.2, (landing - step - entryFoot) / 2, 0.62], STONE, '-x -y -z +z')
  k.stone.box([(-0.4 + back) / 2, (entryFoot + landing) / 2, doorZ], [(-0.4 - back) / 2, (landing - entryFoot) / 2, 0.62], STONE, '-x -y -z +z')
  const leafTop = landing + 2.04, leaf = 0.46
  k.trim.box([back + 0.03, (landing + leafTop) / 2, doorZ], [0.03, (leafTop - landing) / 2, leaf], accent, '-x')
  if (fine) {
    // Four panels, a knob and a slot for letters.
    for (const [y0, y1] of [[0.18, 0.86], [1.0, 1.86]]) for (const z of [-0.215, 0.215]) k.trim.box([back + 0.066, landing + (y0 + y1) / 2, doorZ + z], [0.008, (y1 - y0) / 2, 0.165], shade(accent, 1.12), '-x')
    k.trim.ball([back + 0.1, landing + 0.98, doorZ + down * 0.37], 0.035, BRASS, 1, 4, 8)
    k.trim.box([back + 0.066, landing + 0.93, doorZ], [0.006, 0.02, 0.11], BRASS, '-x')
  }
  for (const z of [-leaf - 0.05, leaf + 0.05]) k.trim.box([back + 0.035, (landing + entry.y1) / 2, doorZ + z], [0.035, (entry.y1 - landing) / 2, 0.05], trim, '-x')
  k.trim.box([back + 0.035, leafTop + 0.035, doorZ], [0.035, 0.035, leaf], trim, '-x')
  k.glass.quad([back + 0.02, leafTop + 0.07, doorZ + leaf], [back + 0.02, leafTop + 0.07, doorZ - leaf], [back + 0.02, entry.y1 - 0.04, doorZ - leaf], [back + 0.02, entry.y1 - 0.04, doorZ + leaf], [0.01, 0.9, 0], [0.3, 0.3, 0.7, 0.5])
  k.glow.box([-0.45, entry.y1 - 0.03, doorZ], [0.07, 0.025, 0.07], [1, 0.86, 0.6])
  for (const z of [entry.z0 - 0.09, entry.z1 + 0.09]) {
    k.trim.box([0.03, (entryFoot + entry.y1) / 2 + 0.06, z], [0.03, (entry.y1 - entryFoot) / 2 - 0.06, 0.09], trim, '-x')
    if (fine) k.trim.box([0.045, entry.y1 + 0.02, z], [0.045, 0.05, 0.105], trim, '-x')
  }
  k.trim.box([0.03, entry.y1 + 0.2, doorZ], [0.03, 0.13, 0.62 + 0.18], blend(trim, accent, 0.12), '-x')
  k.trim.sweep(cornice(0.24), [[0, entry.z0 - 0.24], [0, entry.z1 + 0.24]], entry.y1 + 0.33, trim)
  if (fine) k.trim.box([0.02, landing + 1.6, doorZ - down * 0.95], [0.012, 0.06, 0.09], BRASS, '-x')
  // By some doors, a plant in a pot against the wall.
  if (fine && chance(h.number, 31) > 0.35) {
    const z = doorZ + down * 1.0, y = ground(z), tall = chance(h.number, 32) > 0.5
    k.trim.post([0.2, y, z], 0.13, 0.3, chance(h.number, 33) > 0.5 ? POT : shade(accent, 0.7), 8, 0.17)
    k.leaf.ball([0.2, y + 0.5, z], 0.24, LEAF, 0.9, 4, 7)
    k.leaf.ball([0.24, y + (tall ? 0.85 : 0.6), z + 0.08], tall ? 0.2 : 0.16, shade(LEAF, 1.15), 1, 4, 7)
    if (tall) k.leaf.ball([0.18, y + 1.12, z - 0.03], 0.14, LEAF, 1.1, 3, 6)
    else for (let i = 0; i < 4; i++) k.leaf.ball([0.2 + (chance(h.number, 40 + i) - 0.5) * 0.3, y + 0.62 + chance(h.number, 44 + i) * 0.1, z + (chance(h.number, 48 + i) - 0.5) * 0.3], 0.05, FLOWERS[Math.floor(chance(h.number, 34) * FLOWERS.length)], 1, 3, 5)
  }
  // The home's own door has a lantern beside it and a mat before it.
  if (fine && h.number === HOME) {
    k.glow.box([0.14, landing + 1.72, doorZ - down * 0.98], [0.065, 0.1, 0.065], [1, 0.8, 0.45])
    k.iron.box([0.14, landing + 1.85, doorZ - down * 0.98], [0.09, 0.025, 0.09], IRON)
    k.iron.box([0.07, landing + 1.6, doorZ - down * 0.98], [0.07, 0.015, 0.015], IRON)
    k.trim.box([0.42, ground(doorZ) + 0.012, doorZ], [0.3, 0.012, 0.45], rgb('#8c5a3c'))
  }

  // ---- the belt over the garage storey
  k.trim.sweep(band(0.11, 0.2), [[0, -half], [0, half]], GARAGE - 0.1, trim)

  // ---- the storeys above: boards, with windows; a bay over the garage on two of the three styles
  const floorY = (s: number) => GARAGE + STOREY * s + 1.55
  const holes: Hole[] = []
  const bay = h.style === 'flat' ? null : { z: garageZ, back: 1.45, front: 0.75, out: 0.75, foot: GARAGE + 0.2, top: h.style === 'gable' ? top + 0.1 : top - 0.45 }
  if (!bay) for (let s = 0; s < h.storeys; s++) for (const z of [-half * 0.58, 0, half * 0.58]) holes.push(window(0, z, floorY(s), 1.0, 1.75))
  else for (let s = 0; s < h.storeys; s++) holes.push(window(0, doorZ, floorY(s), 1.05, 1.75))
  // Behind a bay the wall is not seen: left out, so the bay's own windows look into the house.
  const behind: Hole[] = bay ? [{ z0: bay.z - bay.back, z1: bay.z + bay.back, y0: bay.foot, y1: bay.top, depth: 0 }] : []
  wall(k.boards, 0, -half, half, GARAGE, top, [...holes, ...behind], body)

  if (bay) {
    const plan: [number, number][] = [[0, bay.z - bay.back], [bay.out, bay.z - bay.front], [bay.out, bay.z + bay.front], [0, bay.z + bay.back]]
    for (let i = 0; i < 3; i++) {
      const [ax, az] = plan[i], [bx, bz] = plan[i + 1], long = Math.hypot(bx - ax, bz - az), dx = (bx - ax) / long, dz = (bz - az) / long
      const face = new THREE.Matrix4().makeBasis(new THREE.Vector3(dz, 0, -dx), new THREE.Vector3(0, 1, 0), new THREE.Vector3(dx, 0, dz)).setPosition((ax + bx) / 2, 0, (az + bz) / 2)
      on(face)
      const lights: Hole[] = []
      for (let s = 0; s < h.storeys; s++) {
        lights.push(window(0, 0, floorY(s), i === 1 ? 1.0 : 0.56, 1.75, 0.09))
        // A panel under each window.
        if (fine) {
          const y = GARAGE + STOREY * s + (s ? 0.42 : 0.47), w = (i === 1 ? 1.0 : 0.56) / 2 + 0.06
          k.trim.box([0.012, y, 0], [0.012, 0.19, w], trim, '-x')
          k.trim.box([0.026, y, 0], [0.004, 0.13, w - 0.06], blend(body, accent, 0.3), '-x')
        }
      }
      wall(k.boards, 0, -long / 2, long / 2, bay.foot, bay.top, lights, body)
    }
    on()
    // Under it, over it, and a band at each floor.
    k.plaster.tri([plan[0][0], bay.foot, plan[0][1]], [plan[1][0], bay.foot, plan[1][1]], [plan[2][0], bay.foot, plan[2][1]], foot)
    k.plaster.tri([plan[0][0], bay.foot, plan[0][1]], [plan[2][0], bay.foot, plan[2][1]], [plan[3][0], bay.foot, plan[3][1]], foot)
    k.trim.sweep(band(0.07, 0.24), plan, bay.foot - 0.02, trim)
    for (let s = 1; s < h.storeys; s++) k.trim.sweep(band(0.05, 0.14), plan, GARAGE + STOREY * s + 0.03, trim)
    if (fine) for (const z of [bay.z - bay.front + 0.12, bay.z + bay.front - 0.12]) k.trim.sweep([[0, 0], [0.12, 0], [0.5, 0.22], [0.62, 0.34], [0.62, 0.4], [0, 0.4]], [[0, z - 0.06], [0, z + 0.06]], bay.foot - 0.42, trim)
    if (h.style === 'bay') {
      k.trim.sweep(cornice(0.3), plan, bay.top - 0.02, trim)
      k.roof.tri([0, bay.top + 0.18, plan[0][1] - 0.2], [bay.out + 0.28, bay.top + 0.18, plan[2][1] + 0.1], [bay.out + 0.28, bay.top + 0.18, plan[1][1] - 0.1], ROOFING)
      k.roof.tri([0, bay.top + 0.18, plan[0][1] - 0.2], [0, bay.top + 0.18, plan[3][1] + 0.2], [bay.out + 0.28, bay.top + 0.18, plan[2][1] + 0.1], ROOFING)
    } else {
      // A gable over the bay: a face of shingles with a small light in it, boards along its edges, and a roof back to the house.
      const wide = bay.back + 0.3, eave = bay.top, ridge = eave + wide * 0.82, x = bay.out + 0.04, deep = -1.6
      k.trim.sweep(band(0.09, 0.2), plan, eave - 0.2, trim)
      k.shingle.tri([x, eave, bay.z + wide], [x, eave, bay.z - wide], [x, ridge, bay.z], blend(body, trim, 0.25))
      k.shingle.quad([0, eave, bay.z - wide], [x, eave, bay.z - wide], [x, eave, bay.z + wide], [0, eave, bay.z + wide], foot)
      k.trim.box([x + 0.02, eave + 0.52, bay.z], [0.02, 0.26, 0.2], trim, '-x')
      k.glass.quad([x + 0.045, eave + 0.32, bay.z + 0.14], [x + 0.045, eave + 0.32, bay.z - 0.14], [x + 0.045, eave + 0.72, bay.z - 0.14], [x + 0.045, eave + 0.72, bay.z + 0.14], [0.02, 0.95, 0])
      for (const way of [-1, 1]) {
        const lean = Math.atan2(ridge - eave, wide), run = Math.hypot(ridge - eave, wide)
        const rake = new THREE.Matrix4().makeRotationX(way * lean).setPosition(0, (eave + ridge) / 2, bay.z + (way * wide) / 2)
        on(rake)
        k.trim.box([x + 0.05, 0.06, 0], [0.05, 0.09, run / 2 + 0.06], trim)
        k.roof.box([(x + 0.14 + deep) / 2, 0.17, 0], [(x + 0.14 - deep) / 2, 0.03, run / 2 + 0.1], ROOFING)
        on()
      }
    }
  }

  // ---- the top: a frieze in the door's colour, brackets, a cornice, and a low wall round the roof
  const breaks: [number, number][] = bay && h.style === 'gable' ? [[-half, bay.z - bay.back - 0.34], [bay.z + bay.back + 0.34, half]] : [[-half, half]]
  for (const [z0, z1] of breaks) {
    if (z1 - z0 < 0.3) continue
    k.trim.box([0.02, top - 0.36, (z0 + z1) / 2], [0.02, 0.24, (z1 - z0) / 2], blend(accent, body, 0.62), '-x')
    k.trim.sweep(band(0.06, 0.08), [[0, z0], [0, z1]], top - 0.66, trim)
    k.trim.sweep(cornice(0.46), [[0, z0], [0, z1]], top - 0.1, trim)
    k.trim.box([0.1, crown - 0.07, (z0 + z1) / 2], [0.1, 0.07, (z1 - z0) / 2], trim, '-x -y')
    const count = Math.max(1, Math.round((z1 - z0) / 0.62))
    if (fine) for (let i = 0; i < count; i++) {
      const z = z0 + ((i + 0.5) * (z1 - z0)) / count
      if (bay && h.style === 'bay' && Math.abs(z - bay.z) < bay.back) continue
      k.trim.sweep([[0, 0], [0.07, 0.03], [0.16, 0.16], [0.3, 0.3], [0.34, 0.42], [0, 0.42]], [[0.02, z - 0.05], [0.02, z + 0.05]], top - 0.54, trim)
    }
  }

  // ---- the rest of the house: its sides and back in plain plaster, a roof inside a low wall, a chimney
  const side = shade(body, 0.93)
  // The end of a row shows a whole side wall to the street across it: that wall has windows (below); the others are plain.
  const lot = Math.floor((h.number - 101) / 2), open = lot === 0 ? -down : lot === LOTS - 1 ? down : 0
  if (open !== 1) k.plaster.quad([-DEPTH, -BELOW, half], [0, -BELOW, half], [0, crown, half], [-DEPTH, crown, half], side)
  if (open !== -1) k.plaster.quad([0, -BELOW, -half], [-DEPTH, -BELOW, -half], [-DEPTH, crown, -half], [0, crown, -half], side)
  k.plaster.quad([-DEPTH, -BELOW, -half], [-DEPTH, -BELOW, half], [-DEPTH, crown, half], [-DEPTH, crown, -half], side)
  k.roof.quad([-DEPTH, top + 0.32, half], [0, top + 0.32, half], [0, top + 0.32, -half], [-DEPTH, top + 0.32, -half], ROOFING)
  for (const z of [-half + 0.07, half - 0.07]) k.plaster.box([-DEPTH / 2, crown - 0.09, z], [DEPTH / 2, 0.09, 0.07], side, '-y')
  k.plaster.box([0.06 - 0.12, crown - 0.09, 0], [0.06, 0.09, half], side, '-y +x')
  if (chance(h.number, 7) > 0.35) {
    const z = (chance(h.number, 8) > 0.5 ? 1 : -1) * (half - 0.55), x = -2.2 - chance(h.number, 9) * 3
    k.plaster.box([x, top + 0.95, z], [0.3, 0.65, 0.42], blend(side, rgb('#9a6a55'), 0.6), '-y')
    k.trim.box([x, top + 1.63, z], [0.34, 0.035, 0.46], trim)
    for (const dz of [-0.2, 0.2]) k.trim.post([x, top + 1.66, z + dz], 0.09, 0.3, rgb('#b5673f'), 8, 0.07)
  }
  // What stands on a roof: a vent pipe or two, a hatch, on some a skylight, on some a water tank.
  const roofY = top + 0.32, on_ = (a: number) => chance(h.number, a)
  for (let i = 0; i < 2; i++) k.iron.post([-2.5 - on_(11 + i) * 6, roofY, (on_(13 + i) - 0.5) * (LOT - 1.6)], 0.06, 0.45 + on_(15 + i) * 0.4, IRON, 6)
  k.plaster.box([-1.6 - on_(17) * 1.5, roofY + 0.22, -down * (half - 1.3)], [0.5, 0.22, 0.5], shade(side, 0.9), '-y')
  k.trim.box([-1.6 - on_(17) * 1.5, roofY + 0.46, -down * (half - 1.3)], [0.54, 0.025, 0.54], rgb('#8d9297'))
  if (on_(18) > 0.45) {
    const x = -5.6 - on_(19) * 2.2, z = (on_(20) - 0.5) * 2.4
    k.trim.box([x, roofY + 0.11, z], [0.85, 0.11, 0.6], trim, '-y +y')
    k.glass.quad([x - 0.8, roofY + 0.2, z + 0.55], [x + 0.8, roofY + 0.2, z + 0.55], [x + 0.8, roofY + 0.2, z - 0.55], [x - 0.8, roofY + 0.2, z - 0.55], [0.02, 0.9, 0], [0.3, 0.3, 0.7, 0.5])
  }
  if (on_(21) > 0.7) k.iron.post([-7.4, roofY, down * (half - 1.5)], 0.55, 1.1, rgb('#9aa0a6'), 12)
  if (open) {
    const e = open
    on(new THREE.Matrix4().makeBasis(new THREE.Vector3(0, 0, e), new THREE.Vector3(0, 1, 0), new THREE.Vector3(-e, 0, 0)).setPosition(0, 0, e * half))
    const lights: Hole[] = []
    for (let f = 0; f < h.storeys; f++) for (const along of [2.3, 5.1, 7.9]) lights.push(window(0, e * along, floorY(f), 0.95, 1.7))
    wall(k.plaster, 0, Math.min(0, e * DEPTH), Math.max(0, e * DEPTH), -BELOW, crown, lights, side)
    on()
  }

  // A pipe down the front from the gutter, at the garage's end.
  if (fine) {
    const z = down * (half - 0.14)
    k.plaster.bar([0.07, ground(z) + 0.15, z], [0.07, top - 0.12, z], 0.038, shade(body, 0.8), 8)
    k.plaster.bar([0.07, top - 0.12, z], [0.34, top + 0.04, z], 0.038, shade(body, 0.8), 8)
  }

  // On the tall flat fronts, a fire escape: a landing of iron bars at each floor, a rail round it, a ladder between.
  if (fine && h.style === 'flat' && h.storeys === 3) {
    const z0 = -half * 0.58 - 0.75, z1 = 0.75, out = 0.82
    for (let s = 1; s < h.storeys; s++) {
      const y = GARAGE + STOREY * s + 0.5
      k.iron.box([out / 2, y, (z0 + z1) / 2], [out / 2, 0.02, (z1 - z0) / 2], IRON)
      for (const z of [z0, z1]) for (const x of [0.03, out - 0.02]) k.iron.box([x, y + 0.5, z], [0.015, 0.5, 0.015], IRON)
      for (const up of [0.5, 1.0]) {
        k.iron.box([out - 0.02, y + up, (z0 + z1) / 2], [0.013, 0.013, (z1 - z0) / 2], IRON)
        for (const z of [z0, z1]) k.iron.box([out / 2, y + up, z], [out / 2, 0.013, 0.013], IRON)
      }
      for (let i = 1; i < 16; i++) k.iron.box([out - 0.02, y + 0.5, z0 + ((z1 - z0) * i) / 16], [0.007, 0.5, 0.007], IRON)
      for (const x of [0.2, out - 0.15]) k.iron.bar([x, y - 0.02, z0 + 0.3], [x + 0.25, y - 0.45, z0 + 0.3], 0.012, IRON, 4)
      // The ladder down to the landing below, or hanging short of the street.
      const drop = s > 1 ? STOREY : 1.5, lz = z1 - 0.45
      for (const dz of [-0.19, 0.19]) k.iron.box([out - 0.1, y - drop / 2, lz + dz], [0.012, drop / 2, 0.012], IRON)
      for (let r = 1; r < Math.floor(drop / 0.3); r++) k.iron.box([out - 0.1, y - r * 0.3, lz], [0.008, 0.008, 0.19], IRON)
    }
  }
}

/** The block's houses as a few meshes, one a material. */
export function houses(list: House[]): THREE.Group {
  const k = kit()
  for (const h of list) facade(k, h)
  const group = new THREE.Group()
  group.name = 'the houses'
  const looks = fronts()
  for (const [name, mesher] of Object.entries(k) as [keyof Kit, Mesher][]) {
    if (!mesher.triangles) continue
    const mesh = new THREE.Mesh(mesher.geometry(), looks[name])
    mesh.name = `houses ${name}`
    mesh.castShadow = name !== 'glass' && name !== 'glow'
    mesh.receiveShadow = true
    group.add(mesh)
  }
  return group
}
