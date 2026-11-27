// Map data model, MAP1 binary parser, spatial road/building indexing, and procedural town fallback.
// Coordinates throughout are in metres relative to the world frame (cells / 10: x east, z south).
export const MAP_MAGIC = 0x3150414d // 'MAP1'

export interface MapPlace {
  name: string
  /** World metres (x east, z south). */
  x: number
  z: number
  kind: 'landmark' | 'hood' | 'park' | 'hospital'
}

export interface MapData {
  /** World bounds in metres (x east, z south). */
  x0: number
  z0: number
  spanX: number
  spanZ: number
  /** Terrain/coastline/park/elevation raster (2 bytes/px: [class|shoreDist, elev]). */
  rw: number
  rh: number
  raster: Uint8Array
  /** Road graph vertices in world metres: length = nNodes * 2 ([x0, z0, x1, z1, ...]). */
  nNodes: number
  nodes: Float32Array
  /** Road graph edges: endpoints a, b (node indices), street name index (0xffff = unnamed), flags. */
  nEdges: number
  edgeA: Uint32Array
  edgeB: Uint32Array
  edgeName: Uint16Array
  edgeFlags: Uint8Array
  /** Adjacency list in CSR form for O(1) A* neighbor iteration (undirected traversal with direction flags). */
  adjOff: Uint32Array
  adjTo: Uint32Array
  adjEdge: Uint32Array
  adjDir: Uint8Array // 1 if traveling with legal traffic direction, 0 if against one-way
  names: string[]
  /** Spatial grid over road edges for sub-millisecond nearest-road snapping & street lookup. */
  roadGrid: { cell: number; gx0: number; gz0: number; nx: number; nz: number; off: Uint32Array; list: Uint32Array }
  /** 3D extruded buildings (outer polygon ring, base elevation m, height m, palette index, flags). */
  nBldgs: number
  bldgFirst: Uint32Array
  bldgCount: Uint8Array
  bldgColor: Uint8Array
  bldgFlags: Uint16Array
  bldgBase: Float32Array
  bldgHeight: Float32Array
  bldgVerts: Float32Array // world metres [x, z, ...]
  /** Notable landmarks, parks, neighborhoods. */
  places: MapPlace[]
  /** City/realm label shown in the fullscreen map header. */
  title: string
}

/** Samples ground elevation (metres) smoothly from the raster at world metres (x, z). */
export function sampleElevation(map: MapData, x: number, z: number): number {
  const fx = ((x - map.x0) / map.spanX) * map.rw - 0.5
  const fz = ((z - map.z0) / map.spanZ) * map.rh - 0.5
  const ix = Math.max(0, Math.min(map.rw - 2, Math.floor(fx)))
  const iz = Math.max(0, Math.min(map.rh - 2, Math.floor(fz)))
  const tx = Math.max(0, Math.min(1, fx - ix)), tz = Math.max(0, Math.min(1, fz - iz))
  const at = (cx: number, cz: number) => map.raster[(cz * map.rw + cx) * 2 + 1] - 5
  const a = at(ix, iz) * (1 - tx) + at(ix + 1, iz) * tx
  const b = at(ix, iz + 1) * (1 - tx) + at(ix + 1, iz + 1) * tx
  return Math.max(0, a * (1 - tz) + b * tz)
}

/** Builds CSR adjacency + spatial edge hash grid from parsed nodes/edges. */
function buildIndices(
  x0: number, z0: number, spanX: number, spanZ: number,
  nNodes: number, nodes: Float32Array,
  nEdges: number, edgeA: Uint32Array, edgeB: Uint32Array, edgeFlags: Uint8Array,
) {
  // Adjacency (every edge added both ways, marking whether it follows the legal direction).
  const deg = new Uint32Array(nNodes)
  for (let i = 0; i < nEdges; i++) { deg[edgeA[i]]++; deg[edgeB[i]]++ }
  const adjOff = new Uint32Array(nNodes + 1)
  for (let i = 0; i < nNodes; i++) adjOff[i + 1] = adjOff[i] + deg[i]
  const total = adjOff[nNodes]
  const adjTo = new Uint32Array(total)
  const adjEdge = new Uint32Array(total)
  const adjDir = new Uint8Array(total)
  const cur = adjOff.slice()
  for (let i = 0; i < nEdges; i++) {
    const a = edgeA[i], b = edgeB[i], f = edgeFlags[i]
    const pa = cur[a]++
    adjTo[pa] = b; adjEdge[pa] = i; adjDir[pa] = (f & 1) ? 1 : 0
    const pb = cur[b]++
    adjTo[pb] = a; adjEdge[pb] = i; adjDir[pb] = (f & 2) ? 1 : 0
  }

  // Spatial grid of 80 m buckets for instant nearest-road lookup.
  const cell = 80
  const gx0 = Math.floor(x0 / cell), gz0 = Math.floor(z0 / cell)
  const nx = Math.max(1, Math.ceil((x0 + spanX) / cell) - gx0 + 1)
  const nz = Math.max(1, Math.ceil((z0 + spanZ) / cell) - gz0 + 1)
  const count = new Uint32Array(nx * nz + 1)
  const visit = (i: number, cb: (k: number) => void) => {
    const a = edgeA[i], b = edgeB[i]
    const ax = nodes[a * 2], az = nodes[a * 2 + 1], bx = nodes[b * 2], bz = nodes[b * 2 + 1]
    const c0x = Math.max(0, Math.min(nx - 1, Math.floor(Math.min(ax, bx) / cell) - gx0))
    const c1x = Math.max(0, Math.min(nx - 1, Math.floor(Math.max(ax, bx) / cell) - gx0))
    const c0z = Math.max(0, Math.min(nz - 1, Math.floor(Math.min(az, bz) / cell) - gz0))
    const c1z = Math.max(0, Math.min(nz - 1, Math.floor(Math.max(az, bz) / cell) - gz0))
    for (let gz = c0z; gz <= c1z; gz++) for (let gx = c0x; gx <= c1x; gx++) cb(gz * nx + gx)
  }
  for (let i = 0; i < nEdges; i++) visit(i, (k) => { count[k + 1]++ })
  for (let k = 0; k < nx * nz; k++) count[k + 1] += count[k]
  const list = new Uint32Array(count[nx * nz])
  const fill = count.slice()
  for (let i = 0; i < nEdges; i++) visit(i, (k) => { list[fill[k]++] = i })
  return { adjOff, adjTo, adjEdge, adjDir, roadGrid: { cell, gx0, gz0, nx, nz, off: count, list } }
}

/** Parses a `MAP1` binary buffer (`bay/map.bin`, v1 u16 edges or v2 u32 edges) into `MapData`. Returns null if invalid. */
export function parseMap(buf: ArrayBuffer, title = 'San Francisco'): MapData | null {
  if (buf.byteLength < 64) return null
  const dv = new DataView(buf)
  const ver = dv.getInt32(4, true)
  if (dv.getInt32(0, true) !== MAP_MAGIC || (ver !== 1 && ver !== 2)) return null
  const edgeStride = ver === 2 ? 12 : 8
  const x0 = dv.getInt32(8, true) * 0.1, z0 = dv.getInt32(12, true) * 0.1
  const spanX = dv.getInt32(16, true) * 0.1, spanZ = dv.getInt32(20, true) * 0.1
  const rw = dv.getInt32(24, true), rh = dv.getInt32(28, true)
  const nNodes = dv.getUint32(32, true), nEdges = dv.getUint32(36, true)
  const namesBytes = dv.getUint32(44, true)
  const nBldgs = dv.getUint32(48, true), nBldgVerts = dv.getUint32(52, true)
  const landmarksBytes = dv.getUint32(60, true)

  const rasterLen = rw * rh * 2, rasterPad = (rasterLen + 3) & ~3
  const namesPad = (namesBytes + 3) & ~3
  const landmarksPad = (landmarksBytes + 3) & ~3
  const need = 64 + rasterPad + nNodes * 4 + nEdges * edgeStride + namesPad + nBldgs * 12 + nBldgVerts * 4 + landmarksPad
  if (buf.byteLength < need) return null

  let off = 64
  const raster = new Uint8Array(buf, off, rasterLen).slice(); off += rasterPad
  const nodes = new Float32Array(nNodes * 2)
  const sx = spanX / 65535, sz = spanZ / 65535
  for (let i = 0; i < nNodes; i++) {
    nodes[i * 2] = x0 + dv.getUint16(off, true) * sx
    nodes[i * 2 + 1] = z0 + dv.getUint16(off + 2, true) * sz
    off += 4
  }
  const edgeA = new Uint32Array(nEdges), edgeB = new Uint32Array(nEdges)
  const edgeName = new Uint16Array(nEdges), edgeFlags = new Uint8Array(nEdges)
  if (ver === 2) {
    for (let i = 0; i < nEdges; i++) {
      edgeA[i] = dv.getUint32(off, true)
      edgeB[i] = dv.getUint32(off + 4, true)
      edgeName[i] = dv.getUint16(off + 8, true)
      edgeFlags[i] = dv.getUint8(off + 10)
      off += 12
    }
  } else {
    for (let i = 0; i < nEdges; i++) {
      edgeA[i] = dv.getUint16(off, true)
      edgeB[i] = dv.getUint16(off + 2, true)
      edgeName[i] = dv.getUint16(off + 4, true)
      edgeFlags[i] = dv.getUint8(off + 6)
      off += 8
    }
  }
  const namesText = namesBytes > 0 ? new TextDecoder().decode(new Uint8Array(buf, off, namesBytes)) : ''
  const names = namesText ? namesText.split('\0') : []
  off += namesPad

  const bldgFirst = new Uint32Array(nBldgs), bldgCount = new Uint8Array(nBldgs)
  const bldgColor = new Uint8Array(nBldgs), bldgFlags = new Uint16Array(nBldgs)
  const bldgBase = new Float32Array(nBldgs), bldgHeight = new Float32Array(nBldgs)
  for (let i = 0; i < nBldgs; i++) {
    bldgFirst[i] = dv.getUint32(off, true)
    const w1 = dv.getUint32(off + 4, true), w2 = dv.getUint32(off + 8, true)
    bldgCount[i] = w1 & 0xff
    bldgColor[i] = (w1 >>> 8) & 0xff
    bldgFlags[i] = (w1 >>> 16) & 0xffff
    bldgBase[i] = (w2 & 0xffff) * 0.25 - 10
    bldgHeight[i] = ((w2 >>> 16) & 0xffff) * 0.25
    off += 12
  }
  const bldgVerts = new Float32Array(nBldgVerts * 2)
  for (let i = 0; i < nBldgVerts; i++) {
    bldgVerts[i * 2] = x0 + dv.getUint16(off, true) * sx
    bldgVerts[i * 2 + 1] = z0 + dv.getUint16(off + 2, true) * sz
    off += 4
  }
  let places: MapPlace[] = []
  if (landmarksBytes > 0) {
    try {
      const raw = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, off, landmarksBytes))) as { name: string; x: number; z: number; kind: MapPlace['kind'] }[]
      places = raw.map((p) => ({ name: p.name, x: p.x * 0.1, z: p.z * 0.1, kind: p.kind }))
    } catch { /* ignore */ }
  }
  const idx = buildIndices(x0, z0, spanX, spanZ, nNodes, nodes, nEdges, edgeA, edgeB, edgeFlags)
  return {
    x0, z0, spanX, spanZ, rw, rh, raster,
    nNodes, nodes, nEdges, edgeA, edgeB, edgeName, edgeFlags,
    ...idx, names,
    nBldgs, bldgFirst, bldgCount, bldgColor, bldgFlags, bldgBase, bldgHeight, bldgVerts,
    places, title,
  }
}

/**
 * Synthesizes a `MapData` for the procedural generated town (`city.rs`: blocks of 128 m x 80 m, 14 m streets)
 * around `(cx, cz)` in world metres by querying the page's core (`ground_at`, `feet_at`, `top_at`).
 */
export function buildTownMap(
  core: { ground_at(x: number, z: number): number; feet_at(x: number, z: number): number; top_at(x: number, z: number): number; paving_at?(x: number, z: number): number },
  cx: number,
  cz: number,
): MapData {
  // Block dimensions in metres (city.rs: BLOCK_X=1280, BLOCK_Z=800, STREET=140 cells).
  const BX = 128, BZ = 80, ST = 14
  const spanX = 2048, spanZ = 1600
  const x0 = Math.floor((cx - spanX * 0.5) / BX) * BX
  const z0 = Math.floor((cz - spanZ * 0.5) / BZ) * BZ
  const rw = 256, rh = 200
  const rasterClass = new Uint8Array(rw * rh)
  const rasterElev = new Float32Array(rw * rh)
  for (let rz = 0; rz < rh; rz++) {
    const wz = z0 + ((rz + 0.5) / rh) * spanZ
    for (let rx = 0; rx < rw; rx++) {
      const wx = x0 + ((rx + 0.5) / rw) * spanX
      const gx = Math.round(wx * 10), gz = Math.round(wz * 10)
      const g = core.ground_at(gx, gz) * 0.1
      const topMat = core.top_at(gx, gz) & 15
      const sort = core.paving_at ? core.paving_at(gx, gz) & 7 : 0
      let cls = 1
      if (g < 0 || topMat === 5) cls = 0
      else if (sort === 2 || topMat === 3 || topMat === 13) cls = 2
      else if (topMat === 6 || topMat === 7) cls = 3
      else if (sort === 1 || topMat === 4) cls = 4
      rasterClass[rz * rw + rx] = cls
      rasterElev[rz * rw + rx] = cls === 0 ? -3 : g
    }
  }
  // Shore distance for coastal shallows.
  const dist = new Uint16Array(rw * rh).fill(65535), q = new Int32Array(rw * rh)
  let qh = 0, qt = 0
  for (let i = 0; i < rw * rh; i++) if (rasterClass[i] !== 0) { dist[i] = 0; q[qt++] = i }
  while (qh < qt) {
    const cur = q[qh++], d = dist[cur]
    if (d >= 18) continue
    const ix = cur % rw, iz = (cur - ix) / rw
    for (const [dx, dz] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
      const nx = ix + dx, nz = iz + dz
      if (nx < 0 || nx >= rw || nz < 0 || nz >= rh) continue
      const ni = nz * rw + nx
      if (dist[ni] > d + 1) { dist[ni] = d + 1; q[qt++] = ni }
    }
  }
  const raster = new Uint8Array(rw * rh * 2)
  for (let i = 0; i < rw * rh; i++) {
    const c = rasterClass[i]
    const hi = c === 0 ? Math.min(15, Math.round((Math.min(18, dist[i]) / 18) * 15)) : c === 2 ? 10 : 4
    raster[i * 2] = (c & 15) | (hi << 4)
    raster[i * 2 + 1] = Math.max(0, Math.min(255, Math.round(rasterElev[i] + 5)))
  }

  // Street grid + sampled 3D buildings.
  const cols = Math.floor(spanX / BX), rows = Math.floor(spanZ / BZ)
  const nodeOf = (ix: number, iz: number) => iz * (cols + 1) + ix
  const nNodes = (cols + 1) * (rows + 1)
  const nodes = new Float32Array(nNodes * 2)
  for (let iz = 0; iz <= rows; iz++) {
    for (let ix = 0; ix <= cols; ix++) {
      const id = nodeOf(ix, iz)
      nodes[id * 2] = x0 + ix * BX + ST * 0.5
      nodes[id * 2 + 1] = z0 + iz * BZ + ST * 0.5
    }
  }
  const eA: number[] = [], eB: number[] = [], eN: number[] = [], eF: number[] = []
  const names: string[] = []
  const addName = (s: string) => { const i = names.indexOf(s); if (i >= 0) return i; names.push(s); return names.length - 1 }
  const onLand = (x: number, z: number) => core.ground_at(Math.round(x * 10), Math.round(z * 10)) >= 12
  for (let iz = 0; iz <= rows; iz++) {
    const nm = addName(`${Math.abs(Math.round((z0 + iz * BZ) / BZ)) + 1}th St`)
    for (let ix = 0; ix < cols; ix++) {
      const a = nodeOf(ix, iz), b = nodeOf(ix + 1, iz)
      if (!onLand((nodes[a * 2] + nodes[b * 2]) * 0.5, nodes[a * 2 + 1])) continue
      const major = iz % 4 === 0 ? 3 : iz % 2 === 0 ? 2 : 1
      eA.push(a); eB.push(b); eN.push(nm); eF.push(3 | (major << 2) | (1 << 4))
    }
  }
  for (let ix = 0; ix <= cols; ix++) {
    const nm = addName(`${String.fromCharCode(65 + (Math.abs(Math.round((x0 + ix * BX) / BX)) % 26))} Ave`)
    for (let iz = 0; iz < rows; iz++) {
      const a = nodeOf(ix, iz), b = nodeOf(ix, iz + 1)
      if (!onLand(nodes[a * 2], (nodes[a * 2 + 1] + nodes[b * 2 + 1]) * 0.5)) continue
      const major = ix % 4 === 0 ? 3 : ix % 2 === 0 ? 2 : 1
      eA.push(a); eB.push(b); eN.push(nm); eF.push(3 | (major << 2) | (1 << 4))
    }
  }

  // Sample buildings inside each block (two rows x 3 footprints per block).
  const bFirst: number[] = [], bCount: number[] = [], bColor: number[] = [], bFlags: number[] = [], bBase: number[] = [], bHeight: number[] = [], bVerts: number[] = []
  for (let iz = 0; iz < rows; iz++) {
    for (let ix = 0; ix < cols; ix++) {
      const bx = x0 + ix * BX + ST + 2, bz = z0 + iz * BZ + ST + 2
      const bw = BX - ST - 4, bd = BZ - ST - 4
      const midX = Math.round((bx + bw * 0.5) * 10), midZ = Math.round((bz + bd * 0.5) * 10)
      if (core.ground_at(midX, midZ) < 15) continue
      const sort = core.paving_at ? core.paving_at(midX, midZ) & 7 : 3
      if (sort !== 3 && sort !== 4 && sort !== 5) continue
      for (let r = 0; r < 2; r++) {
        for (let c = 0; c < 3; c++) {
          const sx0 = bx + (bw / 3) * c + 2, sx1 = bx + (bw / 3) * (c + 1) - 2
          const sz0 = bz + (bd / 2) * r + 2, sz1 = bz + (bd / 2) * (r + 1) - 2
          const mx = Math.round(((sx0 + sx1) * 0.5) * 10), mz = Math.round(((sz0 + sz1) * 0.5) * 10)
          const g = core.ground_at(mx, mz) * 0.1
          const h = Math.abs(Math.imul(ix * 73856093 ^ iz * 19349663 ^ (c * 83492791 + r * 2971215073), 2654435761)) % 100
          const tall = sort === 4 ? 26 + (h % 58) : sort === 5 ? 7 + (h % 9) : 8 + (h % 11)
          bFirst.push(bVerts.length / 2)
          bCount.push(4)
          bColor.push(((ix * 37 + iz * 17 + c * 7 + r * 3) % 24) * 10 + 17)
          bFlags.push(sort === 4 ? 1 : 0)
          bBase.push(Math.max(0, g))
          bHeight.push(tall)
          // Positive area CCW in (x, z) matching SF map compiler
          bVerts.push(sx0, sz0, sx1, sz0, sx1, sz1, sx0, sz1)
        }
      }
    }
  }

  const edgeA = Uint32Array.from(eA), edgeB = Uint32Array.from(eB)
  const edgeName = Uint16Array.from(eN), edgeFlags = Uint8Array.from(eF)
  const idx = buildIndices(x0, z0, spanX, spanZ, nNodes, nodes, edgeA.length, edgeA, edgeB, edgeFlags)
  const places: MapPlace[] = [
    { name: 'Start Street', x: 70, z: 407, kind: 'landmark' },
    { name: 'Works Yard', x: 64, z: 440, kind: 'landmark' },
  ]
  return {
    x0, z0, spanX, spanZ, rw, rh, raster,
    nNodes, nodes, nEdges: edgeA.length, edgeA, edgeB, edgeName, edgeFlags,
    ...idx, names,
    nBldgs: bFirst.length,
    bldgFirst: Uint32Array.from(bFirst),
    bldgCount: Uint8Array.from(bCount),
    bldgColor: Uint8Array.from(bColor),
    bldgFlags: Uint16Array.from(bFlags),
    bldgBase: Float32Array.from(bBase),
    bldgHeight: Float32Array.from(bHeight),
    bldgVerts: Float32Array.from(bVerts),
    places, title: 'Voxelwright Town',
  }
}
