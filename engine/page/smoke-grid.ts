// Coarse 32 x 32 x 32 local Eulerian smoke advection grid (#166): tracks smoke density,
// temperature and 3D MAC face velocities at 0.8 m (8 world-cell) resolution around active fires
// and the camera. Queries voxel solidity to pool hot smoke beneath solid ceilings, deflect
// laterally along rooms, and vent cleanly through broken windows and openings.

/** Cells along each axis of the local smoke volume. */
export const SMOKE_GRID_SIZE = 32
/** Finest world cells (10 cm each) spanned by one smoke cell (8 cells = 0.8 m; 32 cells = 25.6 m). */
export const SMOKE_CELL_SIZE = 8

const N = SMOKE_GRID_SIZE
const NN = N * N
const TOTAL = N * N * N
const HALF_SPAN = (N >> 1) * SMOKE_CELL_SIZE

/** Thermal buoyancy acceleration in grid cells/s^2 per unit temperature. */
const BUOYANCY = 8.0
/** Max velocity component in grid cells/s (clamped so backtraces stay local). */
const MAX_VEL = 14.0
/** Pressure projection Gauss-Seidel SOR iterations (warm-started across steps) and relaxation factor. */
const PRESSURE_ITERS = 3
const SOR_OMEGA = 1.5
/** Exponential decay rates (1/s) for smoke density, temperature and momentum. */
const DENSITY_DECAY = 0.06
const TEMP_DECAY = 0.32
const VEL_DAMP = 0.35
/** Minimum visible density returned by `samplePuffs`. */
const MIN_VISIBLE_DENSITY = 0.02

export type SolidSampler = (wx: number, wy: number, wz: number) => boolean

export interface SmokePuffSample {
  x: number
  y: number
  z: number
  density: number
  temp: number
  vx: number
  vy: number
  vz: number
  size: number
}

export interface SmokeBounds {
  minX: number
  minY: number
  minZ: number
  maxX: number
  maxY: number
  maxZ: number
}

export class SmokeGrid {
  readonly size = N
  readonly cellSize = SMOKE_CELL_SIZE

  density: Float32Array<ArrayBuffer> = new Float32Array(TOTAL)
  temp: Float32Array<ArrayBuffer> = new Float32Array(TOTAL)
  // Staggered MAC face velocities (grid cells/s):
  // vx[i] lies on the -x face of cell i (between x-1 and x),
  // vy[i] lies on the -y face of cell i (between y-1 and y),
  // vz[i] lies on the -z face of cell i (between z-1 and z).
  vx: Float32Array<ArrayBuffer> = new Float32Array(TOTAL)
  vy: Float32Array<ArrayBuffer> = new Float32Array(TOTAL)
  vz: Float32Array<ArrayBuffer> = new Float32Array(TOTAL)
  solid: Uint8Array<ArrayBuffer> = new Uint8Array(TOTAL)

  private densityNext: Float32Array<ArrayBuffer> = new Float32Array(TOTAL)
  private tempNext: Float32Array<ArrayBuffer> = new Float32Array(TOTAL)
  private vxNext: Float32Array<ArrayBuffer> = new Float32Array(TOTAL)
  private vyNext: Float32Array<ArrayBuffer> = new Float32Array(TOTAL)
  private vzNext: Float32Array<ArrayBuffer> = new Float32Array(TOTAL)
  private solidNext: Uint8Array<ArrayBuffer> = new Uint8Array(TOTAL)
  private div: Float32Array<ArrayBuffer> = new Float32Array(TOTAL)
  private pressure: Float32Array<ArrayBuffer> = new Float32Array(TOTAL)
  private invOpen: Float32Array<ArrayBuffer> = new Float32Array(TOTAL)
  private sampleIdx: Int32Array<ArrayBuffer> = new Int32Array(TOTAL)

  // Two root words, then two words per brick. Both levels use X, Z, Y bit order.
  // Each leaf covers 2x2x2 smoke cells.
  private occupancy = new Uint32Array(130)
  private maskDirty = false

  private markOccupied(x: number, y: number, z: number): void {
    const brick = (x >> 3) + ((z >> 3) << 2) + ((y >> 3) << 4)
    const leaf = ((x >> 1) & 3) + (((z >> 1) & 3) << 2) + (((y >> 1) & 3) << 4)
    this.occupancy[brick >> 5] |= 1 << (brick & 31)
    this.occupancy[2 + brick * 2 + (leaf >> 5)] |= 1 << (leaf & 31)
  }

  private syncOccupancy(): void {
    if (!this.maskDirty) return
    this.occupancy.fill(0)
    for (let i = 0; i < TOTAL; i++) {
      if (this.density[i] >= MIN_VISIBLE_DENSITY && !this.solid[i]) {
        this.markOccupied(i & 31, i >> 10, (i >> 5) & 31)
      }
    }
    this.maskDirty = false
  }

  /** Snapshot in GPU upload order, root first and then 64 leaf masks. */
  exportBitmask(): Uint32Array<ArrayBuffer> {
    this.syncOccupancy()
    return this.occupancy.slice()
  }

  /** Conservative plume interval in ray parameter units (world cells for a unit direction). */
  rayInterval(origin: readonly number[], dir: readonly number[], tMax: number) {
    this.syncOccupancy()
    const result = { hit: false, tEnter: 0, tExit: 0, visitedBricks: 0 }
    if (!(this.occupancy[0] | this.occupancy[1]) || !(tMax > 0)) return result
    const local = [origin[0] - this.originX, origin[1] - this.originY, origin[2] - this.originZ]
    let start = 0, end = tMax
    const bounds = [this.actMinX, this.actMinY, this.actMinZ]
    const upper = [this.actMaxX, this.actMaxY, this.actMaxZ]
    for (let a = 0; a < 3; a++) {
      const lo = bounds[a] * SMOKE_CELL_SIZE
      const hi = (upper[a] + 1) * SMOKE_CELL_SIZE
      if (dir[a] === 0) {
        if (local[a] < lo || local[a] >= hi) return result
      } else {
        const u = (lo - local[a]) / dir[a], v = (hi - local[a]) / dir[a]
        start = Math.max(start, Math.min(u, v))
        end = Math.min(end, Math.max(u, v))
      }
    }
    if (!(start < end) || !dir.some(v => v !== 0)) return result

    // Traverse one aligned lattice at a time. Advancing integer coordinates on ties
    // also handles axis-aligned rays and starts exactly on a negative-going face.
    const walk = (size: number, t: number, limit: number, parent: number) => {
      const cellAt = (a: number) => {
        const pos = (local[a] + dir[a] * t) / size
        const cell = dir[a] < 0 ? Math.ceil(pos) - 1 : Math.floor(pos)
        return Math.max(0, Math.min(N * SMOKE_CELL_SIZE / size - 1, cell))
      }
      const faceTime = (c: number, a: number) => dir[a] === 0 ? Infinity :
        ((c + Number(dir[a] > 0)) * size - local[a]) / dir[a]
      let x = cellAt(0), y = cellAt(1), z = cellAt(2)
      let tx = faceTime(x, 0), ty = faceTime(y, 1), tz = faceTime(z, 2)
      while (t < limit) {
        const stop = Math.min(limit, tx, ty, tz)
        const bit = (x & 3) + ((z & 3) << 2) + ((y & 3) << 4)
        const word = parent < 0 ? 0 : 2 + parent * 2
        if (parent < 0) result.visitedBricks++
        if (stop > t && (this.occupancy[word + (bit >> 5)] & (1 << (bit & 31)))) {
          if (parent < 0) walk(size / 4, t, stop, bit)
          else {
            if (!result.hit) result.tEnter = t
            result.hit = true
            result.tExit = stop
          }
        }
        if (stop === limit) break
        if (tx === stop) { x += Math.sign(dir[0]); tx = faceTime(x, 0) }
        if (ty === stop) { y += Math.sign(dir[1]); ty = faceTime(y, 1) }
        if (tz === stop) { z += Math.sign(dir[2]); tz = faceTime(z, 2) }
        t = Math.max(t, stop)
      }
    }
    walk(8 * SMOKE_CELL_SIZE, start, end, -1)
    return result
  }

  originX = 0
  originY = 0
  originZ = 0
  private initialized = false
  private active = false
  private _activeCount = 0
  // Tight active grid-cell bounds (inclusive) so empty parts of the 25.6 m^3 volume cost 0 ms.
  private actMinX = N
  private actMaxX = -1
  private actMinY = N
  private actMaxY = -1
  private actMinZ = N
  private actMaxZ = -1

  get isInitialized(): boolean { return this.initialized }
  get activeCount(): number { return this._activeCount }

  /** Resets all smoke, temperature, velocity and pressure (keeps obstacle map). */
  clear(): void {
    this.maskDirty = false
    this.occupancy.fill(0)
    this.density.fill(0)
    this.temp.fill(0)
    this.vx.fill(0)
    this.vy.fill(0)
    this.vz.fill(0)
    this.pressure.fill(0)
    this.active = false
    this._activeCount = 0
    this.actMinX = N; this.actMaxX = -1
    this.actMinY = N; this.actMaxY = -1
    this.actMinZ = N; this.actMaxZ = -1
  }

  /** Converts a finest world-cell coordinate to a flat grid index, or -1 if outside. */
  cellIndex(wx: number, wy: number, wz: number): number {
    const ix = Math.floor((wx - this.originX) / SMOKE_CELL_SIZE)
    const iy = Math.floor((wy - this.originY) / SMOKE_CELL_SIZE)
    const iz = Math.floor((wz - this.originZ) / SMOKE_CELL_SIZE)
    if (ix < 0 || ix >= N || iy < 0 || iy >= N || iz < 0 || iz >= N) return -1
    return ix + (iz << 5) + (iy << 10)
  }

  /** Reads smoke density at a finest world-cell coordinate (0 if outside or solid). */
  sampleAt(wx: number, wy: number, wz: number): number {
    const idx = this.cellIndex(wx, wy, wz)
    if (idx < 0 || this.solid[idx]) return 0
    return this.density[idx]
  }

  /** Directly toggles one grid cell's obstacle bit at finest world-cell coordinates. */
  setSolid(wx: number, wy: number, wz: number, isSolid: boolean): void {
    const idx = this.cellIndex(wx, wy, wz)
    if (idx < 0) return
    const v = isSolid ? 1 : 0
    if (this.solid[idx] === v) return
    this.maskDirty = true
    this.solid[idx] = v
    if (v) {
      this.density[idx] = 0
      this.temp[idx] = 0
      this.pressure[idx] = 0
      this.zeroSolidFaces()
    }
    this.rebuildInvOpen()
  }

  /** Resamples obstacle solidity for the whole grid or a world-cell bounding box (e.g. after a blast opens a wall). */
  refreshSolids(isSolid: SolidSampler, bounds?: SmokeBounds): void {
    this.maskDirty = true
    const x0 = bounds ? Math.max(0, Math.floor((bounds.minX - this.originX) / SMOKE_CELL_SIZE)) : 0
    const x1 = bounds ? Math.min(N - 1, Math.floor((bounds.maxX - this.originX) / SMOKE_CELL_SIZE)) : N - 1
    const y0 = bounds ? Math.max(0, Math.floor((bounds.minY - this.originY) / SMOKE_CELL_SIZE)) : 0
    const y1 = bounds ? Math.min(N - 1, Math.floor((bounds.maxY - this.originY) / SMOKE_CELL_SIZE)) : N - 1
    const z0 = bounds ? Math.max(0, Math.floor((bounds.minZ - this.originZ) / SMOKE_CELL_SIZE)) : 0
    const z1 = bounds ? Math.min(N - 1, Math.floor((bounds.maxZ - this.originZ) / SMOKE_CELL_SIZE)) : N - 1
    const solid = this.solid
    const ox = this.originX, oy = this.originY, oz = this.originZ
    for (let y = y0; y <= y1; y++) {
      const wy = oy + (y + 0.5) * SMOKE_CELL_SIZE
      const yOff = y << 10
      for (let z = z0; z <= z1; z++) {
        const wz = oz + (z + 0.5) * SMOKE_CELL_SIZE
        const row = yOff + (z << 5)
        for (let x = x0; x <= x1; x++) {
          const idx = row + x
          const s = isSolid(ox + (x + 0.5) * SMOKE_CELL_SIZE, wy, wz) ? 1 : 0
          solid[idx] = s
          if (s) {
            this.density[idx] = 0
            this.temp[idx] = 0
            this.pressure[idx] = 0
          }
        }
      }
    }
    this.zeroSolidFaces()
    this.rebuildInvOpen()
  }

  /**
   * Recenters the grid around `(worldX, worldY, worldZ)` snapped to an 8-cell boundary.
   * Overlapping smoke cells are preserved in place; only newly entered cells query `isSolid`.
   */
  recenter(worldX: number, worldY: number, worldZ: number, isSolid: SolidSampler): void {
    const newOx = Math.floor((worldX - HALF_SPAN) / SMOKE_CELL_SIZE) * SMOKE_CELL_SIZE
    const newOy = Math.floor((worldY - HALF_SPAN) / SMOKE_CELL_SIZE) * SMOKE_CELL_SIZE
    const newOz = Math.floor((worldZ - HALF_SPAN) / SMOKE_CELL_SIZE) * SMOKE_CELL_SIZE

    if (!this.initialized) {
      this.originX = newOx
      this.originY = newOy
      this.originZ = newOz
      this.initialized = true
      this.clear()
      this.refreshSolids(isSolid)
      return
    }

    const dx = (newOx - this.originX) / SMOKE_CELL_SIZE
    const dy = (newOy - this.originY) / SMOKE_CELL_SIZE
    const dz = (newOz - this.originZ) / SMOKE_CELL_SIZE
    if (dx === 0 && dy === 0 && dz === 0) return

    this.originX = newOx
    this.originY = newOy
    this.originZ = newOz

    if (Math.abs(dx) >= N || Math.abs(dy) >= N || Math.abs(dz) >= N) {
      this.clear()
      this.refreshSolids(isSolid)
      return
    }

    this.maskDirty = true
    const dSrc = this.density, tSrc = this.temp
    const vxSrc = this.vx, vySrc = this.vy, vzSrc = this.vz
    const sSrc = this.solid
    const dDst = this.densityNext, tDst = this.tempNext
    const vxDst = this.vxNext, vyDst = this.vyNext, vzDst = this.vzNext
    const sDst = this.solidNext

    let activeCount = 0
    let minX = N, maxX = -1, minY = N, maxY = -1, minZ = N, maxZ = -1
    for (let y = 0; y < N; y++) {
      const oy = y + dy
      const wy = newOy + (y + 0.5) * SMOKE_CELL_SIZE
      const dstY = y << 10
      const yIn = oy >= 0 && oy < N
      const srcY = oy << 10
      for (let z = 0; z < N; z++) {
        const oz = z + dz
        const wz = newOz + (z + 0.5) * SMOKE_CELL_SIZE
        const dstRow = dstY + (z << 5)
        const yzIn = yIn && oz >= 0 && oz < N
        const srcRow = srcY + (oz << 5)
        for (let x = 0; x < N; x++) {
          const dst = dstRow + x
          const ox = x + dx
          if (yzIn && ox >= 0 && ox < N) {
            const src = srcRow + ox
            const d = dSrc[src]
            const t = tSrc[src]
            dDst[dst] = d
            tDst[dst] = t
            vxDst[dst] = vxSrc[src]
            vyDst[dst] = vySrc[src]
            vzDst[dst] = vzSrc[src]
            sDst[dst] = sSrc[src]
            if (d > 0.005) activeCount++
            if (d > 1e-4 || t > 1e-4) {
              if (x < minX) minX = x; if (x > maxX) maxX = x
              if (y < minY) minY = y; if (y > maxY) maxY = y
              if (z < minZ) minZ = z; if (z > maxZ) maxZ = z
            }
          } else {
            dDst[dst] = 0
            tDst[dst] = 0
            vxDst[dst] = 0
            vyDst[dst] = 0
            vzDst[dst] = 0
            sDst[dst] = isSolid(newOx + (x + 0.5) * SMOKE_CELL_SIZE, wy, wz) ? 1 : 0
          }
        }
      }
    }

    this.density = dDst; this.densityNext = dSrc
    this.temp = tDst; this.tempNext = tSrc
    this.vx = vxDst; this.vxNext = vxSrc
    this.vy = vyDst; this.vyNext = vySrc
    this.vz = vzDst; this.vzNext = vzSrc
    this.solid = sDst; this.solidNext = sSrc
    this.pressure.fill(0)
    this._activeCount = activeCount
    this.actMinX = minX; this.actMaxX = maxX
    this.actMinY = minY; this.actMaxY = maxY
    this.actMinZ = minZ; this.actMaxZ = maxZ
    this.active = maxX >= minX
    this.zeroSolidFaces()
    this.rebuildInvOpen()
  }

  /** Injects smoke density and heat (and optional velocity in world cells/s) at a finest world-cell coordinate. */
  inject(worldX: number, worldY: number, worldZ: number, density: number, temp: number, vx = 0, vy = 0, vz = 0): void {
    const idx = this.cellIndex(worldX, worldY, worldZ)
    if (idx < 0 || this.solid[idx]) return
    const nextD = Math.min(4.0, this.density[idx] + density)
    if (nextD > 0.005 && this.density[idx] <= 0.005) this._activeCount++
    if (density < 0) this.maskDirty = true
    this.density[idx] = nextD
    this.temp[idx] = Math.min(6.0, Math.max(this.temp[idx], temp) + temp * 0.25)
    const x = idx & 31, z = (idx >> 5) & 31, y = idx >> 10
    if (this.density[idx] >= MIN_VISIBLE_DENSITY) this.markOccupied(x, y, z)
    if (x < this.actMinX) this.actMinX = x; if (x > this.actMaxX) this.actMaxX = x
    if (y < this.actMinY) this.actMinY = y; if (y > this.actMaxY) this.actMaxY = y
    if (z < this.actMinZ) this.actMinZ = z; if (z > this.actMaxZ) this.actMaxZ = z
    if (vx !== 0) {
      const gx = vx / SMOKE_CELL_SIZE
      if (x > 0 && !this.solid[idx - 1]) this.vx[idx] += gx
      if (x < N - 1 && !this.solid[idx + 1]) this.vx[idx + 1] += gx
    }
    if (vy !== 0) {
      const gy = vy / SMOKE_CELL_SIZE
      if (y > 0 && !this.solid[idx - NN]) this.vy[idx] += gy
      if (y < N - 1 && !this.solid[idx + NN]) this.vy[idx + NN] += gy
    }
    if (vz !== 0) {
      const gz = vz / SMOKE_CELL_SIZE
      if (z > 0 && !this.solid[idx - N]) this.vz[idx] += gz
      if (z < N - 1 && !this.solid[idx + N]) this.vz[idx + N] += gz
    }
    this.active = true
  }

  /** Advances the 32^3 MAC grid by `dt` seconds with buoyancy, incompressible wall/ceiling deflection, semi-Lagrangian advection and dissipation. */
  step(dt: number, windX = 0, windZ = 0): void {
    if (!this.active || dt <= 0 || this.actMaxX < this.actMinX) return
    const h = Math.min(dt, 0.1)
    const solid = this.solid
    const density = this.density
    const temp = this.temp
    const vx = this.vx
    const vy = this.vy
    const vz = this.vz
    const div = this.div
    const pressure = this.pressure
    const invOpen = this.invOpen

    // Active simulation sub-volume expanded by a 2-cell halo for buoyancy, advection & pressure propagation.
    const x0 = Math.max(1, this.actMinX - 2)
    const x1 = Math.min(N - 2, this.actMaxX + 2)
    const y0 = Math.max(1, this.actMinY - 2)
    const y1 = Math.min(N - 2, this.actMaxY + 2)
    const z0 = Math.max(1, this.actMinZ - 2)
    const z1 = Math.min(N - 2, this.actMaxZ + 2)
    // Include +1 trailing faces for MAC divergence on the high side of the active box.
    const fx1 = Math.min(N - 1, x1 + 1)
    const fy1 = Math.min(N - 1, y1 + 1)
    const fz1 = Math.min(N - 1, z1 + 1)

    const wxGrid = windX / SMOKE_CELL_SIZE
    const wzGrid = windZ / SMOKE_CELL_SIZE
    const windBlend = Math.min(0.25, h * 0.45)
    const velKeep = Math.max(0, 1 - VEL_DAMP * h)
    const halfBuoyDt = 0.5 * BUOYANCY * h

    // 1. Apply thermal buoyancy, ambient wind and damping on open MAC faces; zero faces touching solid cells.
    for (let y = y0; y <= fy1; y++) {
      const yOff = y << 10
      for (let z = z0; z <= fz1; z++) {
        const row = yOff + (z << 5)
        for (let x = x0; x <= fx1; x++) {
          const i = row + x
          const si = solid[i]
          if (si || solid[i - 1]) {
            vx[i] = 0
          } else {
            let u = vx[i] * velKeep + (wxGrid - vx[i]) * windBlend
            if (u > MAX_VEL) u = MAX_VEL; else if (u < -MAX_VEL) u = -MAX_VEL
            vx[i] = u
          }
          if (si || solid[i - NN]) {
            vy[i] = 0
          } else {
            let v = vy[i] * velKeep + (temp[i] + temp[i - NN]) * halfBuoyDt
            if (v > MAX_VEL) v = MAX_VEL; else if (v < -MAX_VEL) v = -MAX_VEL
            vy[i] = v
          }
          if (si || solid[i - N]) {
            vz[i] = 0
          } else {
            let w = vz[i] * velKeep + (wzGrid - vz[i]) * windBlend
            if (w > MAX_VEL) w = MAX_VEL; else if (w < -MAX_VEL) w = -MAX_VEL
            vz[i] = w
          }
        }
      }
    }

    // 2. Exact MAC divergence on interior cells (solid faces already hold 0 flux).
    for (let y = y0; y <= y1; y++) {
      const yOff = y << 10
      for (let z = z0; z <= z1; z++) {
        let i = yOff + (z << 5) + x0
        const end = yOff + (z << 5) + x1
        for (; i <= end; i++) {
          if (solid[i]) {
            div[i] = 0
            pressure[i] = 0
          } else {
            div[i] = (vx[i + 1] - vx[i]) + (vy[i + NN] - vy[i]) + (vz[i + N] - vz[i])
            const pWarm = pressure[i] * 0.72
            pressure[i] = (pWarm > 1e-6 || pWarm < -1e-6) ? pWarm : 0
          }
        }
      }
    }

    // 3. Branchless Gauss-Seidel SOR pressure solve: solid cells keep pressure === 0 and invOpen === 0,
    //    so solid neighbors drop out without per-neighbor branches (Neumann BC on walls, Dirichlet on exterior).
    for (let iter = 0; iter < PRESSURE_ITERS; iter++) {
      for (let y = y0; y <= y1; y++) {
        const yOff = y << 10
        for (let z = z0; z <= z1; z++) {
          let i = yOff + (z << 5) + x0
          const end = yOff + (z << 5) + x1
          for (; i <= end; i++) {
            const inv = invOpen[i]
            if (inv === 0) continue
            const sumP = pressure[i + 1] + pressure[i - 1] + pressure[i + NN] + pressure[i - NN] + pressure[i + N] + pressure[i - N]
            pressure[i] += SOR_OMEGA * ((sumP - div[i]) * inv - pressure[i])
          }
        }
      }
    }

    // 4. Project MAC face velocities using 1-cell pressure differences (zero checkerboard decoupling).
    for (let y = y0; y <= fy1; y++) {
      const yOff = y << 10
      for (let z = z0; z <= fz1; z++) {
        let i = yOff + (z << 5) + x0
        const end = yOff + (z << 5) + fx1
        for (; i <= end; i++) {
          const si = solid[i]
          const pi = pressure[i]
          if (!si && !solid[i - 1]) vx[i] -= pi - pressure[i - 1]
          else vx[i] = 0
          if (!si && !solid[i - NN]) vy[i] -= pi - pressure[i - NN]
          else vy[i] = 0
          if (!si && !solid[i - N]) vz[i] -= pi - pressure[i - N]
          else vz[i] = 0
        }
      }
    }

    // 5. Wall-safe semi-Lagrangian advection of density and temperature + passive dissipation.
    //    Momentum stays in MAC faces (driven by buoyancy + pressure projection + viscous damping),
    //    avoiding 3x redundant velocity trilinear interpolations and cutting numerical dissipation.
    const dDst = this.densityNext
    const tDst = this.tempNext
    this.occupancy.fill(0)
    this.maskDirty = false
    dDst.fill(0)
    tDst.fill(0)

    const dDecay = Math.exp(-DENSITY_DECAY * h)
    const tDecay = Math.exp(-TEMP_DECAY * h)
    const maxStep = 0.95
    let activeCount = 0
    let minX = N, maxX = -1, minY = N, maxY = -1, minZ = N, maxZ = -1

    for (let y = y0; y <= y1; y++) {
      const yOff = y << 10
      for (let z = z0; z <= z1; z++) {
        const row = yOff + (z << 5)
        for (let x = x0; x <= x1; x++) {
          const i = row + x
          if (solid[i]) continue

          let dx = -0.5 * (vx[i] + vx[i + 1]) * h
          let dy = -0.5 * (vy[i] + vy[i + NN]) * h
          let dz = -0.5 * (vz[i] + vz[i + N]) * h

          // Fast path for stationary cells: decay in place with zero trilinear loads.
          if (dx > -1e-5 && dx < 1e-5 && dy > -1e-5 && dy < 1e-5 && dz > -1e-5 && dz < 1e-5) {
            const d = density[i] * dDecay
            const t = temp[i] * tDecay
            if (d > 1e-4) {
              dDst[i] = d
              if (dDst[i] >= MIN_VISIBLE_DENSITY) this.markOccupied(x, y, z)
              if (d > 0.005) activeCount++
              if (x < minX) minX = x; if (x > maxX) maxX = x
              if (y < minY) minY = y; if (y > maxY) maxY = y
              if (z < minZ) minZ = z; if (z > maxZ) maxZ = z
            }
            if (t > 1e-4) {
              tDst[i] = t
              if (x < minX) minX = x; if (x > maxX) maxX = x
              if (y < minY) minY = y; if (y > maxY) maxY = y
              if (z < minZ) minZ = z; if (z > maxZ) maxZ = z
            }
            continue
          }

          // Clamp backtrace < 1 cell and block against adjacent solid faces so smoke never tunnels
          // across a 1-cell-thick ceiling or wall.
          if (dx > maxStep) dx = maxStep; else if (dx < -maxStep) dx = -maxStep
          if (dy > maxStep) dy = maxStep; else if (dy < -maxStep) dy = -maxStep
          if (dz > maxStep) dz = maxStep; else if (dz < -maxStep) dz = -maxStep
          if (dx > 0 && solid[i + 1]) dx = 0
          else if (dx < 0 && solid[i - 1]) dx = 0
          if (dy > 0 && solid[i + NN]) dy = 0
          else if (dy < 0 && solid[i - NN]) dy = 0
          if (dz > 0 && solid[i + N]) dz = 0
          else if (dz < 0 && solid[i - N]) dz = 0

          const sx = x + dx
          const sy = y + dy
          const sz = z + dz
          const cx = sx | 0
          const cy = sy | 0
          const cz = sz | 0
          const fx = sx - cx
          const fy = sy - cy
          const fz = sz - cz
          const ix0 = 1 - fx, iy0 = 1 - fy, iz0 = 1 - fz

          const c000 = cx + (cz << 5) + (cy << 10)
          const c100 = c000 + 1
          const c001 = c000 + N
          const c101 = c001 + 1
          const c010 = c000 + NN
          const c110 = c010 + 1
          const c011 = c010 + N
          const c111 = c011 + 1

          const w000 = ix0 * iy0 * iz0
          const w100 = fx * iy0 * iz0
          const w001 = ix0 * iy0 * fz
          const w101 = fx * iy0 * fz
          const w010 = ix0 * fy * iz0
          const w110 = fx * fy * iz0
          const w011 = ix0 * fy * fz
          const w111 = fx * fy * fz

          const d = (
            density[c000] * w000 + density[c100] * w100 + density[c001] * w001 + density[c101] * w101 +
            density[c010] * w010 + density[c110] * w110 + density[c011] * w011 + density[c111] * w111
          ) * dDecay
          const t = (
            temp[c000] * w000 + temp[c100] * w100 + temp[c001] * w001 + temp[c101] * w101 +
            temp[c010] * w010 + temp[c110] * w110 + temp[c011] * w011 + temp[c111] * w111
          ) * tDecay

          if (d > 1e-4) {
            dDst[i] = d
            if (dDst[i] >= MIN_VISIBLE_DENSITY) this.markOccupied(x, y, z)
            if (d > 0.005) activeCount++
            if (x < minX) minX = x; if (x > maxX) maxX = x
            if (y < minY) minY = y; if (y > maxY) maxY = y
            if (z < minZ) minZ = z; if (z > maxZ) maxZ = z
          }
          if (t > 1e-4) {
            tDst[i] = t
            if (x < minX) minX = x; if (x > maxX) maxX = x
            if (y < minY) minY = y; if (y > maxY) maxY = y
            if (z < minZ) minZ = z; if (z > maxZ) maxZ = z
          }
        }
      }
    }

    this.density = dDst; this.densityNext = density
    this.temp = tDst; this.tempNext = temp
    this._activeCount = activeCount
    this.actMinX = minX; this.actMaxX = maxX
    this.actMinY = minY; this.actMaxY = maxY
    this.actMinZ = minZ; this.actMaxZ = maxZ
    this.active = maxX >= minX
  }

  /** Extracts up to `maxOut` densest visible smoke cells in finest world-cell coordinates for `puffs.ts`. */
  samplePuffs(maxOut: number): SmokePuffSample[] {
    if (!this.active || maxOut <= 0 || this.actMaxX < this.actMinX) return []
    const density = this.density
    const solid = this.solid
    const idxBuf = this.sampleIdx
    let found = 0
    for (let y = this.actMinY; y <= this.actMaxY; y++) {
      const yOff = y << 10
      for (let z = this.actMinZ; z <= this.actMaxZ; z++) {
        let i = yOff + (z << 5) + this.actMinX
        const end = yOff + (z << 5) + this.actMaxX
        for (; i <= end; i++) {
          if (!solid[i] && density[i] >= MIN_VISIBLE_DENSITY) idxBuf[found++] = i
        }
      }
    }
    if (found === 0) return []
    const slice = idxBuf.subarray(0, found)
    if (found > maxOut) {
      slice.sort((a, b) => density[b] - density[a])
      found = maxOut
    }
    const out: SmokePuffSample[] = new Array(found)
    const ox = this.originX, oy = this.originY, oz = this.originZ
    const temp = this.temp, vx = this.vx, vy = this.vy, vz = this.vz
    for (let k = 0; k < found; k++) {
      const idx = slice[k]
      const x = idx & 31
      const z = (idx >> 5) & 31
      const y = idx >> 10
      const d = density[idx]
      const uc = x < N - 1 ? 0.5 * (vx[idx] + vx[idx + 1]) : vx[idx]
      const vc = y < N - 1 ? 0.5 * (vy[idx] + vy[idx + NN]) : vy[idx]
      const wc = z < N - 1 ? 0.5 * (vz[idx] + vz[idx + N]) : vz[idx]
      out[k] = {
        x: ox + (x + 0.5) * SMOKE_CELL_SIZE,
        y: oy + (y + 0.5) * SMOKE_CELL_SIZE,
        z: oz + (z + 0.5) * SMOKE_CELL_SIZE,
        density: d,
        temp: temp[idx],
        vx: uc * SMOKE_CELL_SIZE,
        vy: vc * SMOKE_CELL_SIZE,
        vz: wc * SMOKE_CELL_SIZE,
        size: SMOKE_CELL_SIZE * (0.72 + 0.36 * Math.min(1, d)),
      }
    }
    return out
  }

  private zeroSolidFaces(): void {
    const solid = this.solid
    const vx = this.vx, vy = this.vy, vz = this.vz
    for (let y = 1; y < N; y++) {
      const yOff = y << 10
      for (let z = 1; z < N; z++) {
        const row = yOff + (z << 5)
        for (let x = 1; x < N; x++) {
          const i = row + x
          const si = solid[i]
          if (si || solid[i - 1]) vx[i] = 0
          if (si || solid[i - NN]) vy[i] = 0
          if (si || solid[i - N]) vz[i] = 0
        }
      }
    }
  }

  private rebuildInvOpen(): void {
    const solid = this.solid
    const invOpen = this.invOpen
    invOpen.fill(0)
    for (let y = 1; y < N - 1; y++) {
      const yOff = y << 10
      for (let z = 1; z < N - 1; z++) {
        const row = yOff + (z << 5)
        for (let x = 1; x < N - 1; x++) {
          const i = row + x
          if (solid[i]) continue
          const open = 6 - solid[i + 1] - solid[i - 1] - solid[i + NN] - solid[i - NN] - solid[i + N] - solid[i - N]
          invOpen[i] = open > 0 ? 1 / open : 0
        }
      }
    }
  }
}
