// Fast A* GPS navigation router & live route tracker over the road graph (nav-data.ts).
// Finds optimal road routes in < 2 ms across San Francisco, snaps off-road clicks cleanly,
// tracks progress along the polyline, trims passed segments behind the player, and auto-reroutes.
import type { MapData } from './nav-data.ts'

export interface RoadSnap {
  edge: number
  /** Parameter along edge [0..1] from edgeA -> edgeB. */
  t: number
  /** Exact projected point on the road in world metres. */
  x: number
  z: number
  /** Distance from query point to projected point in metres. */
  dist: number
  /** Nearest street name (empty if unnamed). */
  street: string
}

export interface GpsRoute {
  /** Destination in world metres. */
  destX: number
  destZ: number
  destName: string
  /** Flat polyline points in world metres: [x0, z0, x1, z1, ...]. */
  points: Float32Array
  /** Cumulative length at each vertex (metres). */
  cum: Float32Array
  /** Street name index per segment (0xffff = off-road connector or unnamed). */
  segNames: Uint16Array
  /** Total route length in metres. */
  totalM: number
  /** True if route follows road graph (false if pure straight line fallback when no roads nearby). */
  routed: boolean
  /** Compute duration in ms. */
  computeMs: number
}

export interface RouteProgress {
  /** Distance along the route polyline where the player currently projects (metres). */
  alongM: number
  /** Remaining distance to destination (metres). */
  remainingM: number
  /** Lateral distance from player to the nearest point on the active route (metres). */
  offRouteM: number
  /** Nearest upcoming named street or destination label. */
  nextStreet: string
  /** True when the player is within arrival distance of the destination. */
  arrived: boolean
}

/** Snaps world metres (x, z) to the nearest road segment using the spatial bucket grid. */
export function snapToRoad(map: MapData, x: number, z: number, maxRadiusM = 600): RoadSnap | null {
  const { roadGrid: g, nodes, edgeA, edgeB, edgeName, names } = map
  const cx = Math.floor(x / g.cell) - g.gx0
  const cz = Math.floor(z / g.cell) - g.gz0
  const maxRing = Math.ceil(maxRadiusM / g.cell)
  let bestEdge = -1, bestT = 0, bestX = x, bestZ = z, bestD2 = maxRadiusM * maxRadiusM

  for (let ring = 0; ring <= maxRing; ring++) {
    // Once we have a hit closer than the inner edge of the next ring, stop early!
    if (bestEdge >= 0 && ring > 1 && ((ring - 1) * g.cell) ** 2 > bestD2) break
    const xMin = Math.max(0, cx - ring), xMax = Math.min(g.nx - 1, cx + ring)
    const zMin = Math.max(0, cz - ring), zMax = Math.min(g.nz - 1, cz + ring)
    for (let gz = zMin; gz <= zMax; gz++) {
      for (let gx = xMin; gx <= xMax; gx++) {
        if (ring > 0 && gx > cx - ring && gx < cx + ring && gz > cz - ring && gz < cz + ring) continue
        const k = gz * g.nx + gx
        const lo = g.off[k], hi = g.off[k + 1]
        for (let i = lo; i < hi; i++) {
          const ei = g.list[i]
          const a = edgeA[ei], b = edgeB[ei]
          const ax = nodes[a * 2], az = nodes[a * 2 + 1], dx = nodes[b * 2] - ax, dz = nodes[b * 2 + 1] - az
          const l2 = dx * dx + dz * dz
          const t = l2 > 1e-6 ? Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2)) : 0
          const px = ax + dx * t, pz = az + dz * t
          const d2 = (x - px) * (x - px) + (z - pz) * (z - pz)
          if (d2 < bestD2) { bestD2 = d2; bestEdge = ei; bestT = t; bestX = px; bestZ = pz }
        }
      }
    }
  }
  if (bestEdge < 0) return null
  const ni = edgeName[bestEdge]
  return { edge: bestEdge, t: bestT, x: bestX, z: bestZ, dist: Math.sqrt(bestD2), street: ni < names.length ? names[ni] : '' }
}

/** Finds a friendly label for any clicked world coordinate (nearby landmark, street name, or coordinates). */
export function describeSpot(map: MapData, x: number, z: number): string {
  // Check nearby landmarks first (within 65 m).
  let bestPlace: string | null = null, bestD2 = 65 * 65
  for (const p of map.places) {
    if (p.kind === 'hood') continue
    const d2 = (p.x - x) ** 2 + (p.z - z) ** 2
    if (d2 < bestD2) { bestD2 = d2; bestPlace = p.name }
  }
  if (bestPlace) return bestPlace
  const snap = snapToRoad(map, x, z, 180)
  if (snap?.street) return snap.street
  // Fallback to nearest neighborhood if within 500 m.
  let hood: string | null = null, hd2 = 500 * 500
  for (const p of map.places) {
    const d2 = (p.x - x) ** 2 + (p.z - z) ** 2
    if (d2 < hd2) { hd2 = d2; hood = p.name }
  }
  return hood ?? 'Waypoint'
}

// Reusable typed scratch arrays for zero-GC A* execution.
let heapNode = new Int32Array(4096), heapF = new Float32Array(4096)
let gScore = new Float32Array(0), cameNode = new Int32Array(0), cameEdge = new Int32Array(0), stamp = new Uint32Array(0)
let runId = 1

function ensureScratch(n: number) {
  if (gScore.length < n) {
    gScore = new Float32Array(n)
    cameNode = new Int32Array(n)
    cameEdge = new Int32Array(n)
    stamp = new Uint32Array(n)
  }
}

/** Road class speed multiplier: favors arterials and major streets slightly like real car GPS. */
const CLASS_WEIGHT = [1.32, 1.05, 0.92, 0.84] as const

/** Computes an optimal A* GPS route from (sx, sz) to (dx, dz) in world metres. */
export function computeRoute(map: MapData, sx: number, sz: number, dx: number, dz: number, destName?: string): GpsRoute {
  const t0 = performance.now()
  const label = destName || describeSpot(map, dx, dz)
  const straight = (): GpsRoute => {
    const len = Math.hypot(dx - sx, dz - sz)
    return {
      destX: dx, destZ: dz, destName: label,
      points: Float32Array.from([sx, sz, dx, dz]),
      cum: Float32Array.from([0, len]),
      segNames: Uint16Array.from([0xffff]),
      totalM: len, routed: false, computeMs: performance.now() - t0,
    }
  }
  if (map.nEdges === 0 || Math.hypot(dx - sx, dz - sz) < 12) return straight()

  const sSnap = snapToRoad(map, sx, sz, 700)
  const gSnap = snapToRoad(map, dx, dz, 700)
  if (!sSnap || !gSnap) return straight()

  // Same edge shortcut!
  if (sSnap.edge === gSnap.edge) {
    const pts: number[] = []
    if (sSnap.dist > 4) pts.push(sx, sz)
    pts.push(sSnap.x, sSnap.z, gSnap.x, gSnap.z)
    if (gSnap.dist > 4) pts.push(dx, dz)
    return packRoute(pts, [map.edgeName[sSnap.edge]], dx, dz, label, true, t0)
  }

  const { nNodes, nodes, edgeA, edgeB, edgeFlags, edgeName, adjOff, adjTo, adjEdge, adjDir } = map
  ensureScratch(nNodes)
  const curRun = ++runId
  if (curRun >= 0xfffffff0) { stamp.fill(0); runId = 1 }

  const hOf = (u: number) => Math.hypot(nodes[u * 2] - gSnap.x, nodes[u * 2 + 1] - gSnap.z) * 0.82
  let hSize = 0
  const push = (u: number, f: number) => {
    if (hSize >= heapNode.length) {
      const nextN = new Int32Array(heapNode.length * 2), nextF = new Float32Array(heapF.length * 2)
      nextN.set(heapNode); nextF.set(heapF); heapNode = nextN; heapF = nextF
    }
    let i = hSize++
    while (i > 0) {
      const p = (i - 1) >> 1
      if (heapF[p] <= f) break
      heapNode[i] = heapNode[p]; heapF[i] = heapF[p]; i = p
    }
    heapNode[i] = u; heapF[i] = f
  }
  const pop = (): number => {
    const top = heapNode[0]
    const lastN = heapNode[--hSize], lastF = heapF[hSize]
    let i = 0
    while (true) {
      let l = i * 2 + 1, r = l + 1
      if (l >= hSize) break
      let c = r < hSize && heapF[r] < heapF[l] ? r : l
      if (lastF <= heapF[c]) break
      heapNode[i] = heapNode[c]; heapF[i] = heapF[c]; i = c
    }
    if (hSize > 0) { heapNode[i] = lastN; heapF[i] = lastF }
    return top
  }

  // Seed both endpoints of start edge with exact distance from sSnap.
  const sa = edgeA[sSnap.edge], sb = edgeB[sSnap.edge]
  const sLen = Math.hypot(nodes[sb * 2] - nodes[sa * 2], nodes[sb * 2 + 1] - nodes[sa * 2 + 1])
  const ga = edgeA[gSnap.edge], gb = edgeB[gSnap.edge]
  const gLen = Math.hypot(nodes[gb * 2] - nodes[ga * 2], nodes[gb * 2 + 1] - nodes[ga * 2 + 1])

  const seed = (u: number, d: number) => {
    stamp[u] = curRun; gScore[u] = d; cameNode[u] = -1; cameEdge[u] = sSnap.edge
    push(u, d + hOf(u))
  }
  seed(sa, sSnap.t * sLen)
  if (sb !== sa) seed(sb, (1 - sSnap.t) * sLen)

  let bestGoalNode = -1, bestGoalCost = Infinity
  const finishCost = (u: number, baseG: number) => {
    const extra = u === ga ? gSnap.t * gLen : (1 - gSnap.t) * gLen
    if (baseG + extra < bestGoalCost) { bestGoalCost = baseG + extra; bestGoalNode = u }
  }

  let expanded = 0
  while (hSize > 0 && expanded++ < 120_000) {
    const u = pop()
    const gu = gScore[u]
    if (gu > bestGoalCost) break
    if (u === ga || u === gb) {
      finishCost(u, gu)
      if (bestGoalCost <= gu + 20) break
    }
    const ux = nodes[u * 2], uz = nodes[u * 2 + 1]
    const prevE = cameEdge[u]
    const prevName = prevE >= 0 ? edgeName[prevE] : 0xffff
    const lo = adjOff[u], hi = adjOff[u + 1]
    for (let k = lo; k < hi; k++) {
      const v = adjTo[k], ei = adjEdge[k]
      const vx = nodes[v * 2], vz = nodes[v * 2 + 1]
      const dist = Math.hypot(vx - ux, vz - uz)
      const cls = (edgeFlags[ei] >> 2) & 3
      // Prefer major roads slightly, discourage going against one-way without hard-blocking foot/fly players.
      const dirPenalty = adjDir[k] ? 1.0 : 1.38
      // Tiny street-change turn penalty keeps routes clean & natural along straight avenues.
      const turnPenalty = prevName !== 0xffff && edgeName[ei] !== prevName ? 6.0 : 0
      const ng = gu + dist * CLASS_WEIGHT[cls] * dirPenalty + turnPenalty
      if (stamp[v] !== curRun || ng < gScore[v]) {
        stamp[v] = curRun
        gScore[v] = ng
        cameNode[v] = u
        cameEdge[v] = ei
        push(v, ng + hOf(v))
      }
    }
  }

  if (bestGoalNode < 0) return straight()

  // Reconstruct node + edge path backward from bestGoalNode.
  const revNodes: number[] = []
  const revEdges: number[] = []
  for (let u = bestGoalNode; u >= 0; u = cameNode[u]) {
    revNodes.push(u)
    if (cameNode[u] >= 0) revEdges.push(cameEdge[u])
  }
  revNodes.reverse()
  revEdges.reverse()

  const pts: number[] = []
  const segNameList: number[] = []
  const addPt = (px: number, pz: number, nameIdx: number) => {
    const n = pts.length
    if (n >= 2 && Math.hypot(px - pts[n - 2], pz - pts[n - 1]) < 0.75) return
    if (n >= 2) segNameList.push(nameIdx)
    pts.push(px, pz)
  }
  if (sSnap.dist > 5) addPt(sx, sz, 0xffff)
  addPt(sSnap.x, sSnap.z, 0xffff)
  for (let i = 0; i < revNodes.length; i++) {
    const u = revNodes[i]
    const nm = i === 0 ? edgeName[sSnap.edge] : edgeName[revEdges[i - 1]]
    addPt(nodes[u * 2], nodes[u * 2 + 1], nm)
  }
  addPt(gSnap.x, gSnap.z, edgeName[gSnap.edge])
  if (gSnap.dist > 5) addPt(dx, dz, 0xffff)

  return packRoute(pts, segNameList, dx, dz, label, true, t0)
}

function packRoute(pts: number[], segNames: number[], destX: number, destZ: number, destName: string, routed: boolean, t0: number): GpsRoute {
  const nv = pts.length >> 1
  const points = new Float32Array(pts)
  const cum = new Float32Array(nv)
  for (let i = 1; i < nv; i++) {
    cum[i] = cum[i - 1] + Math.hypot(points[i * 2] - points[(i - 1) * 2], points[i * 2 + 1] - points[(i - 1) * 2 + 1])
  }
  const namesArr = new Uint16Array(Math.max(1, nv - 1))
  for (let i = 0; i < namesArr.length; i++) namesArr[i] = segNames[i] ?? 0xffff
  return {
    destX, destZ, destName,
    points, cum, segNames: namesArr,
    totalM: cum[nv - 1] ?? 0,
    routed,
    computeMs: performance.now() - t0,
  }
}

/** Projects player position (px, pz) onto active route to compute remaining distance, trim point, and off-route error. */
export function trackRoute(map: MapData, route: GpsRoute, px: number, pz: number): RouteProgress {
  const { points, cum, segNames, totalM } = route
  const nv = cum.length
  let bestD2 = Infinity, bestAlong = 0, bestSeg = 0
  for (let i = 0; i < nv - 1; i++) {
    const ax = points[i * 2], az = points[i * 2 + 1]
    const dx = points[(i + 1) * 2] - ax, dz = points[(i + 1) * 2 + 1] - az
    const l2 = dx * dx + dz * dz
    const t = l2 > 1e-6 ? Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / l2)) : 0
    const ex = px - (ax + dx * t), ez = pz - (az + dz * t)
    const d2 = ex * ex + ez * ez
    if (d2 < bestD2) {
      bestD2 = d2
      bestSeg = i
      bestAlong = cum[i] + Math.sqrt(l2) * t
    }
  }
  const directDist = Math.hypot(route.destX - px, route.destZ - pz)
  const remainingM = Math.max(0, totalM - bestAlong)
  const offRouteM = Math.sqrt(bestD2)
  // Find current or next upcoming named street along the route.
  let nextStreet = route.destName
  for (let i = bestSeg; i < segNames.length; i++) {
    const ni = segNames[i]
    if (ni < map.names.length && map.names[ni]) { nextStreet = map.names[ni]; break }
  }
  return {
    alongM: bestAlong,
    remainingM: Math.min(remainingM, directDist + offRouteM),
    offRouteM,
    nextStreet,
    arrived: directDist < 16 || remainingM < 12,
  }
}

/** Formats metres in crisp GTA-style imperial distance (`0.78 mi` or `240 ft`). */
export function formatDistance(metres: number): string {
  const feet = metres * 3.28084
  if (feet < 528) return `${Math.max(10, Math.round(feet / 10) * 10)} ft`
  const miles = metres / 1609.344
  return `${miles >= 10 ? miles.toFixed(1) : miles.toFixed(2)} mi`
}

export interface GpsStop {
  id: string
  x: number
  z: number
  name: string
  kind?: 'pickup' | 'dropoff' | 'shop' | 'hangout' | 'custom'
  subtitle?: string
  orderId?: string
  accent?: string
}

export interface MultiStopRoute {
  stops: GpsStop[]
  /** Concatenated route across all stops in order (first leg drives active minimap trim; full polyline renders cleanly). */
  combined: GpsRoute
  /** Individual routed legs (leg[0] = player -> stop[0], leg[i] = stop[i-1] -> stop[i]). */
  legs: GpsRoute[]
  /** Distance per leg in metres. */
  legDistancesM: number[]
  /** Cumulative distance to each stop from the player (metres). */
  cumStopM: number[]
  totalM: number
  computeMs: number
}

/**
 * Computes a chained multi-stop A* GPS route across an ordered list of stops (Apple Maps / Google Maps style).
 * Uses the existing zero-GC A* router leg-by-leg and concatenates the full road polyline.
 */
export function computeMultiStopRoute(map: MapData, sx: number, sz: number, stops: readonly GpsStop[]): MultiStopRoute | null {
  if (!stops.length) return null
  const t0 = performance.now()
  const legs: GpsRoute[] = []
  const legDistancesM: number[] = []
  const cumStopM: number[] = []
  const allPts: number[] = []
  const allSegNames: number[] = []
  let cx = sx, cz = sz, acc = 0

  for (let s = 0; s < stops.length; s++) {
    const st = stops[s]
    const leg = computeRoute(map, cx, cz, st.x, st.z, st.name)
    legs.push(leg)
    legDistancesM.push(leg.totalM)
    acc += leg.totalM
    cumStopM.push(acc)
    const nv = leg.points.length >> 1
    for (let i = 0; i < nv; i++) {
      const px = leg.points[i * 2], pz = leg.points[i * 2 + 1]
      const n = allPts.length
      if (n >= 2 && Math.hypot(px - allPts[n - 2], pz - allPts[n - 1]) < 0.75) continue
      if (n >= 2) allSegNames.push(leg.segNames[Math.max(0, i - 1)] ?? 0xffff)
      allPts.push(px, pz)
    }
    cx = st.x; cz = st.z
  }

  const last = stops[stops.length - 1]
  const first = stops[0]
  const combined = packRoute(allPts, allSegNames, first.x, first.z, first.name, legs.some((l) => l.routed), t0)
  // Keep combined destX/destZ pointed at the NEXT stop (stop[0]) while rendering the full chained polyline!
  // If only 1 stop, dest matches last === first.
  if (stops.length > 1) {
    combined.destName = `${first.name} (+${stops.length - 1} stop${stops.length > 2 ? 's' : ''})`
  } else {
    combined.destX = last.x
    combined.destZ = last.z
  }
  return {
    stops: stops.map((s) => ({ ...s })),
    combined,
    legs,
    legDistancesM,
    cumStopM,
    totalM: acc,
    computeMs: performance.now() - t0,
  }
}
