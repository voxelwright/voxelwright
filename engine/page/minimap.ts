// GTA VI-style 3D Minimap HUD + Full-Screen Interactive 2D/3D Map + GPS Navigation System.
// Renders on the engine's existing GPUDevice via MapGpu (4x MSAA WebGPU) with a razor-sharp 2D Canvas
// overlay for border-gliding compass & destination pips, directional player arrow, street/landmark labels,
// and interactive click-to-route GPS navigation.
import { MapGpu, cameraMatrices, projectMapPoint, unprojectToGround, type MapCamera } from './map-gpu.ts'
import { computeRoute, describeSpot, formatDistance, snapToRoad, trackRoute, type GpsRoute, type RouteProgress } from './gps.ts'
import type { MapData, MapPlace } from './nav-data.ts'
import type { Input } from './input.ts'
import type { Hud } from './hud.ts'

export interface MapDiveState {
  cam: MapCamera
  /** Overlay opacity (0..1): 1 = full stylized 3D map, 0 = fully dissolved into live voxel world. */
  opacity: number
  /** Optional target marker drawn cleanly over the diving 3D map. */
  target?: { x: number; z: number; name?: string }
}

export interface MapCameraSnapshot {
  cx: number
  cz: number
  yaw: number
  tilt: number
  span: number
  extrude: number
}

export interface EntryPickTarget {
  /** World metres (x east, z south). */
  x: number
  z: number
  /** Display name shown on the pin and Start card. */
  name: string
  /** Optional subtitle shown under the name in the Start card. */
  subtitle?: string
  /** Optional preferred street facing yaw (radians). */
  yaw?: number
}

export interface EntryPickOptions {
  initial: EntryPickTarget
  /** Called whenever the visitor selects a different spot on the map (to pre-warm that location). */
  onSelect?(target: EntryPickTarget): void
  /** Called when the visitor confirms Start from the map. */
  onStart(target: EntryPickTarget, cam: MapCameraSnapshot): void
  /** Called if the visitor closes/cancels the map back to the first view. */
  onCancel(): void
}

export interface MapSystemOptions {
  device: GPUDevice
  format: GPUTextureFormat
  input: Input
  hud: Hud
  /** Current player position & heading in world metres / radians (0 = North/-z, +pi/2 = East/+x), plus horizontal speed (m/s) and optional live driving state. */
  player(): { x: number; y: number; z: number; yaw: number; speed: number; driving: boolean; flying: boolean; drifting?: boolean; slip?: number }
  /** Current daylight level (0 = night, 1 = day). */
  day(): number
  /** Whether the visitor has entered the world (false during first-view landing screen). */
  engaged(): boolean
  /** Whether main engine rendering is paused (e.g. during GPU benchmarks). */
  paused(): boolean
  /** Called once when the visitor first engages (triggers lazy MAP1 load with zero cold-load bytes). */
  onEngage?(): void
  /** Called right before the fullscreen map opens (lets an active optical dive cancel cleanly). */
  onOpen?(): void
  /** Optional fast-travel handler: lets the visitor dive straight to the chosen destination from the map camera. */
  onVisit?(x: number, z: number, name: string, cam: MapCameraSnapshot): Promise<boolean | void> | boolean | void
}

export interface MapSystem {
  readonly open: boolean
  /** True when the fullscreen map is open in pre-entry starting-location picker mode. */
  readonly picking: boolean
  /** True when the fullscreen map completely covers the viewport (lets main loop skip world raymarch). */
  readonly opaque: boolean
  readonly ready: boolean
  readonly mode: '2d' | '3d'
  readonly destination: { x: number; z: number; name: string } | null
  readonly route: GpsRoute | null
  readonly progress: RouteProgress | null
  readonly places: readonly MapPlace[]
  readonly stats: { nodes: number; edges: number; buildings: number; places: number; renderMs: number; span: number; zoom: number; lookAhead: number }
  /** Current parsed map data (null until MAP1 has loaded). */
  readonly data: MapData | null
  /** Current fullscreen map camera state (for seamless Map-to-Reality dives). */
  camera(): MapCameraSnapshot
  /** Drives `#world-map` directly during an optical 3D Map-to-Reality dive (pass `null` to end). */
  setDive(state: MapDiveState | null): void
  /** Opens the fullscreen map immediately in pre-entry picker mode with a default scenic spot selected. */
  openForEntry(options: EntryPickOptions): void
  /** Closes pre-entry picker mode programmatically without firing onCancel. */
  closeEntry(): void
  toggle(open?: boolean): void
  setMode(mode: '2d' | '3d'): void
  setDestination(x: number, z: number, name?: string): GpsRoute | null
  clearDestination(): void
  centerOnPlayer(): void
  setMapData(map: MapData): void
  frame(dt: number): void
}

const STYLE = /* css */ `
/* ── GTA VI-style 3D Minimap HUD ── */
#minimap {
  position: fixed;
  left: max(18px, env(safe-area-inset-left));
  bottom: max(18px, env(safe-area-inset-bottom));
  width: 244px;
  height: 150px;
  z-index: 6;
  cursor: pointer;
  pointer-events: auto;
  user-select: none;
  -webkit-user-select: none;
  touch-action: manipulation;
  transition: opacity 0.28s ease-out, transform 0.2s cubic-bezier(0.2, 0.85, 0.25, 1);
}
#minimap[hidden] { display: none !important; }
html.first #minimap { display: none !important; }
html.map-open #minimap { opacity: 0; pointer-events: none; }
html[data-hud="quiet"].away #minimap { opacity: 0 !important; pointer-events: none !important; }

#minimap .mm-clip {
  position: absolute;
  inset: 0;
  border-radius: 4px;
  overflow: hidden;
  background: #173642;
  box-shadow: 0 8px 26px rgba(0, 0, 0, 0.5), 0 1px 0 rgba(255, 255, 255, 0.14);
}
#minimap .mm-rim {
  position: absolute;
  inset: 0;
  border-radius: 4px;
  border: 2px solid rgba(94, 114, 146, 0.45);
  box-shadow: inset 1px 1px 0 rgba(255, 255, 255, 0.18), inset -1px -1px 0 rgba(6, 10, 18, 0.65);
  pointer-events: none;
}
#minimap canvas, #world-map canvas {
  position: absolute !important;
  inset: 0 !important;
  width: 100% !important;
  height: 100% !important;
  display: block;
}
/* Overlay extends 8 px past the rounded clip so border-gliding N and pink destination pips sit cleanly on the edge. */
#minimap .mm-ov {
  inset: -8px !important;
  width: calc(100% + 16px) !important;
  height: calc(100% + 16px) !important;
  pointer-events: none;
}
#minimap .mm-key {
  position: absolute;
  right: 8px;
  bottom: 7px;
  padding: 2px 6px;
  border-radius: 5px;
  background: rgba(12, 16, 22, 0.68);
  border: 1px solid rgba(255, 255, 255, 0.2);
  color: rgba(242, 246, 250, 0.88);
  font: 600 10px/1.2 ui-monospace, SFMono-Regular, Menlo, monospace;
  letter-spacing: 0.04em;
  pointer-events: none;
  opacity: 0.55;
  transition: opacity 0.18s ease-out;
}
#minimap .mm-mly {
  position: absolute;
  left: 7px;
  bottom: 6px;
  width: 16px;
  height: 16px;
  display: none;
  align-items: center;
  justify-content: center;
  border-radius: 4px;
  background: rgba(12, 16, 22, 0.52);
  opacity: 0.72;
  z-index: 2;
  transition: opacity 0.16s ease-out;
}
html.has-mapillary #minimap .mm-mly { display: inline-flex; }
#minimap .mm-mly:hover { opacity: 1; }
#minimap .mm-mly svg { width: 11px; height: 11px; display: block; }
#minimap:hover { transform: translateY(-1px); }
#minimap:hover .mm-rim { border-color: rgba(255, 255, 255, 0.42); }
#minimap:hover .mm-key { opacity: 1; }
#minimap:focus-visible .mm-rim { border-color: #ff4fa0; box-shadow: 0 0 0 2px rgba(255, 42, 133, 0.55); }

/* Touch layouts: keep bottom-left completely free for the floating thumb stick and place minimap cleanly in top-left. */
@media (pointer: coarse) {
  #minimap .mm-key { display: none; }
  html.drawer #minimap,
  html:has(#realm.choosing, #realm .egg-line:not([hidden]), #ask.open, #choice:not([hidden])) #minimap {
    opacity: 0 !important;
    visibility: hidden !important;
    pointer-events: none !important;
  }
}
@media (pointer: coarse) and (orientation: portrait) {
  #minimap {
    top: calc(env(safe-area-inset-top, 0px) + 14px);
    bottom: auto;
    left: max(14px, calc(env(safe-area-inset-left) + 14px));
    width: 124px;
    height: 74px;
  }
  #minimap .mm-clip, #minimap .mm-rim { border-radius: 3px; }
  #minimap .mm-ov {
    inset: -6px !important;
    width: calc(100% + 12px) !important;
    height: calc(100% + 12px) !important;
  }
}
@media (pointer: coarse) and (orientation: landscape) {
  #minimap {
    top: calc(env(safe-area-inset-top, 0px) + 14px);
    bottom: auto;
    left: max(14px, calc(env(safe-area-inset-left) + 14px));
    width: 136px;
    height: 78px;
  }
  #minimap .mm-clip, #minimap .mm-rim { border-radius: 3px; }
}

/* ── Full-Screen Interactive Map & GPS Navigator ── */
#world-map {
  position: fixed;
  inset: 0;
  z-index: 40;
  background: #0d4b82;
  opacity: 0;
  transform: scale(0.985);
  pointer-events: none;
  transition: opacity 0.18s ease-out, transform 0.2s cubic-bezier(0.2, 0.9, 0.25, 1);
  user-select: none;
  -webkit-user-select: none;
  font: 500 13px/1.35 -apple-system, BlinkMacSystemFont, "SF Pro Text", "IBM Plex Sans", system-ui, sans-serif;
  color: #eef3f8;
}
@keyframes wm-open {
  from { opacity: 0.04; transform: scale(0.988); }
  to { opacity: 1; transform: scale(1); }
}
#world-map[hidden] { display: none !important; }
#world-map.open {
  opacity: 1;
  transform: scale(1);
  pointer-events: auto;
  transition: none;
  animation: wm-open 0.16s cubic-bezier(0.2, 0.9, 0.25, 1) both;
}
#world-map.dive {
  background: transparent;
  transform: none;
  transition: none;
  pointer-events: none;
}
#world-map.dive .wm-head,
#world-map.dive .wm-tools,
#world-map.dive .wm-dock {
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.14s ease-out;
}
#world-map .wm-stage {
  position: absolute;
  inset: 0;
  cursor: crosshair;
  touch-action: none;
}
#world-map .wm-stage.dragging { cursor: grabbing; }
#world-map .wm-ov { pointer-events: none; }

/* Floating dark-glass cartographic HUD chrome */
#world-map .wm-head {
  position: absolute;
  top: max(16px, calc(env(safe-area-inset-top) + 10px));
  left: max(16px, calc(env(safe-area-inset-left) + 10px));
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-width: min(360px, calc(100vw - 180px));
  pointer-events: none;
}
#world-map .wm-title-card {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 10px 14px;
  border-radius: 13px;
  background: rgba(11, 17, 25, 0.78);
  border: 1px solid rgba(255, 255, 255, 0.14);
  backdrop-filter: blur(14px);
  -webkit-backdrop-filter: blur(14px);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.34);
}
#world-map .wm-city {
  font: 700 13px/1.1 -apple-system, BlinkMacSystemFont, "SF Pro Display", system-ui, sans-serif;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: #ffffff;
}
#world-map .wm-sub {
  font-size: 12px;
  color: rgba(214, 226, 238, 0.78);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

#world-map .wm-route-card {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px 10px 9px 12px;
  border-radius: 13px;
  background: rgba(14, 16, 24, 0.84);
  border: 1px solid rgba(255, 45, 136, 0.45);
  backdrop-filter: blur(14px);
  -webkit-backdrop-filter: blur(14px);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.36), 0 0 18px rgba(255, 42, 133, 0.16);
  pointer-events: auto;
}
#world-map .wm-route-card[hidden] { display: none; }
#world-map .wm-route-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  flex: none;
  background: #ff2a85;
  box-shadow: 0 0 0 3px rgba(255, 42, 133, 0.25), 0 0 10px #ff2a85;
}
#world-map .wm-route-info {
  display: flex;
  flex-direction: column;
  min-width: 0;
  flex: 1;
}
#world-map .wm-route-name {
  font-weight: 650;
  font-size: 13px;
  color: #ffffff;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
#world-map .wm-route-meta {
  font-size: 11.5px;
  color: rgba(255, 186, 218, 0.92);
  font-variant-numeric: tabular-nums;
}
#world-map .wm-visit {
  flex: none;
  height: 28px;
  padding: 0 10px;
  border-radius: 8px;
  border: 0;
  background: #ff2a85;
  color: #ffffff;
  font: 600 12px/1 -apple-system, system-ui, sans-serif;
  cursor: pointer;
  white-space: nowrap;
  box-shadow: 0 2px 10px rgba(255, 42, 133, 0.35);
}
#world-map .wm-visit:hover { background: #ff4496; }
#world-map .wm-visit[hidden] { display: none; }
#world-map.entry-pick .wm-clear { display: none; }
#world-map.entry-pick .wm-visit {
  height: 32px;
  padding: 0 15px;
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.015em;
  box-shadow: 0 3px 14px rgba(255, 42, 133, 0.45);
}
#world-map .wm-loading {
  position: absolute;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  display: inline-flex;
  align-items: center;
  gap: 10px;
  padding: 10px 16px;
  border-radius: 999px;
  background: rgba(11, 17, 25, 0.82);
  border: 1px solid rgba(255, 255, 255, 0.16);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  color: #eef4fa;
  font: 600 13px/1.2 -apple-system, BlinkMacSystemFont, system-ui, sans-serif;
  box-shadow: 0 10px 28px rgba(0, 0, 0, 0.36);
  pointer-events: none;
}
#world-map .wm-loading[hidden] { display: none; }
#world-map .wm-spin {
  width: 14px;
  height: 14px;
  border-radius: 50%;
  border: 2px solid rgba(255, 255, 255, 0.24);
  border-top-color: #ff2a85;
  animation: wm-spin 0.75s linear infinite;
}
@keyframes wm-spin { to { transform: rotate(360deg); } }
#world-map .wm-clear {
  flex: none;
  width: 28px;
  height: 28px;
  border-radius: 8px;
  border: 1px solid rgba(255, 255, 255, 0.14);
  background: rgba(255, 255, 255, 0.08);
  color: #eef3f8;
  font: 600 15px/1 system-ui, sans-serif;
  cursor: pointer;
  display: grid;
  place-items: center;
}
#world-map .wm-clear:hover { background: rgba(255, 42, 133, 0.28); border-color: rgba(255, 42, 133, 0.55); }

#world-map .wm-tools {
  position: absolute;
  top: max(16px, calc(env(safe-area-inset-top) + 10px));
  right: max(16px, calc(env(safe-area-inset-right) + 10px));
  display: flex;
  align-items: center;
  gap: 6px;
  pointer-events: auto;
}
#world-map .wm-group {
  display: flex;
  padding: 3px;
  gap: 2px;
  border-radius: 12px;
  background: rgba(11, 17, 25, 0.78);
  border: 1px solid rgba(255, 255, 255, 0.14);
  backdrop-filter: blur(14px);
  -webkit-backdrop-filter: blur(14px);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.32);
}
#world-map .wm-btn {
  border: 0;
  border-radius: 9px;
  min-width: 34px;
  height: 34px;
  padding: 0 10px;
  background: transparent;
  color: rgba(232, 239, 246, 0.86);
  font: 600 12.5px/1 -apple-system, system-ui, sans-serif;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  touch-action: manipulation;
  transition: background 0.14s, color 0.14s;
}
#world-map .wm-btn:hover { background: rgba(255, 255, 255, 0.12); color: #ffffff; }
#world-map .wm-btn.on { background: #ff2a85; color: #ffffff; box-shadow: 0 2px 10px rgba(255, 42, 133, 0.42); }
#world-map .wm-btn kbd {
  padding: 1px 5px;
  border-radius: 4px;
  background: rgba(255, 255, 255, 0.14);
  font: 600 10.5px/1.3 ui-monospace, SFMono-Regular, monospace;
  color: rgba(255, 255, 255, 0.88);
}

#world-map .wm-dock {
  position: absolute;
  left: 50%;
  bottom: max(16px, calc(env(safe-area-inset-bottom) + 10px));
  transform: translateX(-50%);
  max-width: calc(100vw - 32px);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 7px;
  pointer-events: none;
}
#world-map .wm-places {
  display: flex;
  gap: 6px;
  padding: 5px;
  border-radius: 14px;
  background: rgba(11, 17, 25, 0.76);
  border: 1px solid rgba(255, 255, 255, 0.14);
  backdrop-filter: blur(14px);
  -webkit-backdrop-filter: blur(14px);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.34);
  max-width: 100%;
  overflow-x: auto;
  scrollbar-width: none;
  pointer-events: auto;
}
#world-map .wm-places::-webkit-scrollbar { display: none; }
#world-map .wm-chip {
  flex: none;
  border: 0;
  border-radius: 9px;
  padding: 6px 11px;
  background: rgba(255, 255, 255, 0.08);
  color: rgba(235, 242, 248, 0.9);
  font: 600 12px/1.2 -apple-system, system-ui, sans-serif;
  white-space: nowrap;
  cursor: pointer;
  touch-action: manipulation;
  transition: background 0.14s, color 0.14s;
}
#world-map .wm-chip:hover { background: rgba(255, 255, 255, 0.18); color: #ffffff; }
#world-map .wm-chip.on { background: #ff2a85; color: #ffffff; }

#world-map .wm-hint {
  padding: 4px 11px;
  border-radius: 999px;
  background: rgba(11, 17, 25, 0.66);
  border: 1px solid rgba(255, 255, 255, 0.1);
  color: rgba(220, 232, 244, 0.78);
  font-size: 11.5px;
  white-space: nowrap;
}

@media (pointer: coarse) {
  #world-map .wm-btn { min-width: 38px; height: 38px; }
  #world-map .wm-btn kbd { display: none; }
  #world-map .wm-chip { padding: 8px 13px; font-size: 13px; }
  #world-map .wm-hint { font-size: 11px; }
}
/* Narrow viewports (portrait phone): put toolbar cleanly across the top row and place title/route card underneath so they never collide. */
@media (max-width: 680px) {
  #world-map .wm-tools {
    left: max(12px, env(safe-area-inset-left));
    right: max(12px, env(safe-area-inset-right));
    top: max(12px, calc(env(safe-area-inset-top) + 8px));
    justify-content: space-between;
  }
  #world-map .wm-head {
    top: calc(max(12px, calc(env(safe-area-inset-top) + 8px)) + 52px);
    left: max(12px, env(safe-area-inset-left));
    right: max(12px, env(safe-area-inset-right));
    max-width: none;
  }
  #world-map .wm-title-card { display: none; }
}
@media (prefers-reduced-motion: reduce) {
  #minimap, #world-map { transition: none !important; animation: none !important; }
}
`

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v)
const wrapAngle = (a: number) => {
  let d = ((a + Math.PI) % (Math.PI * 2))
  if (d < 0) d += Math.PI * 2
  return d - Math.PI
}

/**
 * Intersects a ray starting at `(ox, oy)` in unit direction `(dx, dy)` with the perimeter of a rounded rectangle
 * `[0..w] x [0..h]` with corner radius `r`. Used so the N compass badge and pink destination pip glide seamlessly
 * along the rounded-rect minimap border (exact GTA VI look!).
 */
function rayOnRoundedRect(ox: number, oy: number, dx: number, dy: number, w: number, h: number, r: number): [number, number] {
  const rr = Math.min(r, w * 0.45, h * 0.45)
  // First intersect axis-aligned outer box.
  const tx = dx > 1e-6 ? (w - ox) / dx : dx < -1e-6 ? -ox / dx : Infinity
  const ty = dy > 1e-6 ? (h - oy) / dy : dy < -1e-6 ? -oy / dy : Infinity
  let t = Math.min(tx, ty)
  if (!Number.isFinite(t) || t < 0) return [w * 0.5, 0]
  let px = ox + dx * t, py = oy + dy * t

  // If the hit falls inside one of the 4 corner cut-out squares, intersect with that corner's quarter circle!
  const cx = px < rr ? rr : px > w - rr ? w - rr : -1
  const cy = py < rr ? rr : py > h - rr ? h - rr : -1
  if (cx >= 0 && cy >= 0) {
    const mx = ox - cx, my = oy - cy
    const b = mx * dx + my * dy
    const c = mx * mx + my * my - rr * rr
    const disc = b * b - c
    if (disc >= 0) {
      const tc = -b + Math.sqrt(disc)
      if (tc > 0) { px = ox + dx * tc; py = oy + dy * tc }
    }
  }
  return [px, py]
}

interface StreetLabel {
  name: string
  ax: number
  az: number
  bx: number
  bz: number
  mx: number
  mz: number
  tier: number
}

/** Picks clean representative mid-block segments for each named street so fullscreen street labels stay sharp & readable. */
function buildStreetLabels(map: MapData): StreetLabel[] {
  const { nEdges, edgeA, edgeB, edgeName, edgeFlags, nodes, names } = map
  // Group candidate segments by street name, spacing labels ~380 m apart along long arterials.
  const byName = new Map<number, { ei: number; tier: number; len: number; mx: number; mz: number; ax: number; az: number; bx: number; bz: number }[]>()
  for (let i = 0; i < nEdges; i++) {
    const ni = edgeName[i]
    if (ni >= names.length || !names[ni]) continue
    const tier = (edgeFlags[i] >> 2) & 3
    if (tier < 1) continue
    const a = edgeA[i], b = edgeB[i]
    const ax = nodes[a * 2], az = nodes[a * 2 + 1], bx = nodes[b * 2], bz = nodes[b * 2 + 1]
    const len = Math.hypot(bx - ax, bz - az)
    if (len < 22) continue
    let arr = byName.get(ni)
    if (!arr) byName.set(ni, (arr = []))
    arr.push({ ei: i, tier, len, mx: (ax + bx) * 0.5, mz: (az + bz) * 0.5, ax, az, bx, bz })
  }
  const out: StreetLabel[] = []
  for (const [ni, segs] of byName) {
    // Prefer higher-tier, longer straight segments.
    segs.sort((p, q) => (q.tier - p.tier) || (q.len - p.len))
    const chosen: typeof segs = []
    for (const s of segs) {
      const minGap = s.tier >= 2 ? 420 : 520
      if (chosen.some((c) => Math.hypot(c.mx - s.mx, c.mz - s.mz) < minGap)) continue
      chosen.push(s)
      out.push({ name: names[ni], ax: s.ax, az: s.az, bx: s.bx, bz: s.bz, mx: s.mx, mz: s.mz, tier: s.tier })
      if (chosen.length >= 6) break
    }
  }
  // Major roads first so collision culling keeps highways & avenues over side streets.
  out.sort((a, b) => b.tier - a.tier)
  return out
}

export function createMapSystem(opts: MapSystemOptions): MapSystem {
  const styleEl = document.createElement('style')
  styleEl.textContent = STYLE
  document.head.append(styleEl)

  const gpu = new MapGpu(opts.device, opts.format)
  const coarse = matchMedia('(pointer: coarse)')
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)')
  const html = document.documentElement

  // ── Minimap HUD DOM ──
  const mmRoot = document.createElement('div')
  mmRoot.id = 'minimap'
  mmRoot.setAttribute('role', 'button')
  mmRoot.setAttribute('tabindex', '0')
  mmRoot.setAttribute('aria-label', 'Open interactive map (M)')
  mmRoot.hidden = true
  mmRoot.innerHTML = /* html */ `
    <div class="mm-clip">
      <canvas class="mm-gpu"></canvas>
      <div class="mm-rim"></div>
    </div>
    <canvas class="mm-ov"></canvas>
    <a class="mm-mly" href="https://www.mapillary.com/" target="_blank" rel="noopener noreferrer" aria-label="Mapillary street imagery" title="Mapillary street imagery"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 35 35" fill="none" aria-hidden="true"><path fill="#05cb63" fill-rule="evenodd" d="M16.468 25.735c.624.327 15.734 8.542 16.21 8.807.954.528 1.963-.494 1.444-1.45-.261-.48-8.446-15.977-8.722-16.451-.276-.475-.956-.714-1.467-.396-.5.312-1.077.663-1.4.832-.651.34-.731.851-.439 1.42.643 1.248 2.664 5.038 2.896 5.435.484.831-.596 1.78-1.329 1.366-.31-.176-5.107-2.768-5.446-2.971-.339-.203-.94-.201-1.351.484a53.63 53.63 0 00-.837 1.425c-.334.61-.182 1.172.441 1.499zM.517 17.069c-.805-.448-.658-1.613.357-1.91.86-.252 7.844-2.657 9.957-3.386.382-.131.679-.434.807-.82L15.032.724c.317-.957 1.466-.96 1.935-.034.166.33 6.49 12.106 6.71 12.606.22.5.078 1.053-.42 1.372-.5.319-1.312.796-1.596.977-.513.328-1.004.1-1.238-.408-.234-.507-2.038-3.78-2.774-5.169-.368-.694-1.476-.96-1.848.162l-1.224 3.689a1.343 1.343 0 01-.812.827l-3.683 1.254c-.727.247-1.08 1.392-.099 1.874.205.1 4.626 2.538 5.082 2.76.457.224.71.867.443 1.323-.364.622-.83 1.411-1 1.668-.293.444-.87.591-1.353.33C12.671 23.69.804 17.228.517 17.068z" clip-rule="evenodd"/></svg></a>
    <span class="mm-key" aria-hidden="true">M</span>
  `
  mmRoot.querySelector('.mm-mly')?.addEventListener('click', (e) => e.stopPropagation())
  document.body.append(mmRoot)
  const mmGpu = mmRoot.querySelector<HTMLCanvasElement>('.mm-gpu')!
  const mmOv = mmRoot.querySelector<HTMLCanvasElement>('.mm-ov')!
  const mmCtx = mmOv.getContext('2d')!

  // ── Fullscreen Interactive Map DOM ──
  const wmRoot = document.createElement('div')
  wmRoot.id = 'world-map'
  wmRoot.setAttribute('role', 'dialog')
  wmRoot.setAttribute('aria-modal', 'true')
  wmRoot.setAttribute('aria-label', 'City map and GPS navigation')
  wmRoot.hidden = true
  wmRoot.innerHTML = /* html */ `
    <div class="wm-stage">
      <canvas class="wm-gpu"></canvas>
      <canvas class="wm-ov"></canvas>
      <div class="wm-loading" hidden><span class="wm-spin" aria-hidden="true"></span><span>Loading San Francisco map…</span></div>
    </div>
    <div class="wm-head">
      <div class="wm-title-card">
        <div class="wm-city">SAN FRANCISCO</div>
        <div class="wm-sub">Click anywhere to set a GPS route</div>
      </div>
      <div class="wm-route-card" hidden>
        <span class="wm-route-dot" aria-hidden="true"></span>
        <div class="wm-route-info">
          <div class="wm-route-name"></div>
          <div class="wm-route-meta"></div>
        </div>
        <button class="wm-visit" type="button" title="Fast travel to destination">Visit</button>
        <button class="wm-clear" type="button" title="Clear GPS route (Backspace)" aria-label="Clear GPS route">&times;</button>
      </div>
    </div>
    <div class="wm-tools">
      <div class="wm-group" role="group" aria-label="Map view">
        <button class="wm-btn wm-2d on" type="button" aria-pressed="true">2D</button>
        <button class="wm-btn wm-3d" type="button" aria-pressed="false">3D</button>
      </div>
      <div class="wm-group">
        <button class="wm-btn wm-zoom-in" type="button" title="Zoom in (+)" aria-label="Zoom in">+</button>
        <button class="wm-btn wm-zoom-out" type="button" title="Zoom out (-)" aria-label="Zoom out">&minus;</button>
        <button class="wm-btn wm-center" type="button" title="Center on player" aria-label="Center on player">&#9678;</button>
      </div>
      <div class="wm-group">
        <button class="wm-btn wm-close" type="button" aria-label="Close map">Close <kbd>M</kbd></button>
      </div>
    </div>
    <div class="wm-dock">
      <div class="wm-places"></div>
      <div class="wm-hint"></div>
    </div>
  `
  document.body.append(wmRoot)
  const wmStage = wmRoot.querySelector<HTMLElement>('.wm-stage')!
  const wmGpu = wmRoot.querySelector<HTMLCanvasElement>('.wm-gpu')!
  const wmOv = wmRoot.querySelector<HTMLCanvasElement>('.wm-ov')!
  const wmLoading = wmRoot.querySelector<HTMLElement>('.wm-loading')!
  const wmCtx = wmOv.getContext('2d')!
  const wmCity = wmRoot.querySelector<HTMLElement>('.wm-city')!
  const wmSub = wmRoot.querySelector<HTMLElement>('.wm-sub')!
  const wmRouteCard = wmRoot.querySelector<HTMLElement>('.wm-route-card')!
  const wmRouteName = wmRoot.querySelector<HTMLElement>('.wm-route-name')!
  const wmRouteMeta = wmRoot.querySelector<HTMLElement>('.wm-route-meta')!
  const wmVisitBtn = wmRoot.querySelector<HTMLButtonElement>('.wm-visit')!
  const wmClearBtn = wmRoot.querySelector<HTMLButtonElement>('.wm-clear')!
  wmVisitBtn.hidden = !opts.onVisit
  const wmBtn2d = wmRoot.querySelector<HTMLButtonElement>('.wm-2d')!
  const wmBtn3d = wmRoot.querySelector<HTMLButtonElement>('.wm-3d')!
  const wmZoomIn = wmRoot.querySelector<HTMLButtonElement>('.wm-zoom-in')!
  const wmZoomOut = wmRoot.querySelector<HTMLButtonElement>('.wm-zoom-out')!
  const wmCenterBtn = wmRoot.querySelector<HTMLButtonElement>('.wm-center')!
  const wmCloseBtn = wmRoot.querySelector<HTMLButtonElement>('.wm-close')!
  const wmPlacesEl = wmRoot.querySelector<HTMLElement>('.wm-places')!
  const wmHintEl = wmRoot.querySelector<HTMLElement>('.wm-hint')!

  // ── State ──
  let map: MapData | null = null
  let streetLabels: StreetLabel[] = []
  let engagedOnce = false
  let isOpen = false
  let entrySession: EntryPickOptions | null = null
  let entryTarget: EntryPickTarget | null = null
  let diveState: MapDiveState | null = null
  let diveDrawn = false
  let openedAt = 0
  let hideTimer: ReturnType<typeof setTimeout> | null = null
  let leaveInput: (() => void) | null = null
  let viewMode: '2d' | '3d' = '2d'
  let time = 0
  let renderMs = 0

  const updateHint = () => {
    if (entrySession) {
      wmHintEl.textContent = coarse.matches
        ? 'Tap anywhere to pick your start · Drag to pan · Pinch to zoom'
        : 'Click anywhere to pick your start · Drag to pan · Scroll to zoom · Enter to start · Esc to go back'
      return
    }
    wmHintEl.textContent = coarse.matches
      ? 'Tap anywhere to set GPS route · Drag to pan · Pinch to zoom'
      : 'Click anywhere to set GPS route · Drag to pan · Scroll to zoom · Right-drag to tilt · M to close'
  }
  updateHint()
  coarse.addEventListener('change', updateHint)

  // Active GPS state
  let destination: { x: number; z: number; name: string } | null = null
  let route: GpsRoute | null = null
  let progress: RouteProgress | null = null
  let lastRerouteAt = 0
  let pinDropAt = -10

  // Smooth speed-reactive 3D minimap chase camera state
  const BASE_SPAN = 132
  const MAX_DRIVE_ZOOM = 1.85
  let mmYaw = 0
  let mmSpan = BASE_SPAN
  let mmLookAhead = 0
  let mmTilt = 0.88
  let mmSpeedNorm = 0
  let mmDriftNorm = 0
  let mmYawInit = false

  // Smooth fullscreen interactive camera state (current + target + pan velocity)
  const wmCam = {
    cx: 0, cz: 0, yaw: 0, tilt: 0.002, span: 900, extrude: 0.08,
    tCx: 0, tCz: 0, tYaw: 0, tTilt: 0.002, tSpan: 900, tExtrude: 0.08,
    vx: 0, vz: 0,
    init: false,
  }
  const wmHeld = new Set<string>()
  let hoveredPlace: MapPlace | null = null
  let hoveredText = ''
  let lastHoverAt = 0
  let lastWmVP: Float32Array | null = null
  const projectedPlaces: { place: MapPlace; x: number; y: number }[] = []
  let northBtnPos: { x: number; y: number; r: number } | null = null

  const syncRouteCard = () => {
    if (entrySession && entryTarget) {
      wmRouteName.textContent = entryTarget.name
      wmRouteMeta.textContent = entryTarget.subtitle ?? 'Selected start · click anywhere to change'
      wmVisitBtn.textContent = 'Start'
      wmVisitBtn.title = 'Start exploring here (Enter)'
      wmVisitBtn.setAttribute('aria-label', `Start exploring at ${entryTarget.name}`)
      wmVisitBtn.hidden = false
      wmRouteCard.hidden = false
      for (const b of wmPlacesEl.querySelectorAll<HTMLButtonElement>('.wm-chip')) {
        b.classList.toggle('on', b.dataset.name === entryTarget.name)
      }
      return
    }
    wmVisitBtn.textContent = 'Visit'
    wmVisitBtn.title = 'Fast travel to destination'
    wmVisitBtn.removeAttribute('aria-label')
    wmVisitBtn.hidden = !opts.onVisit
    if (!destination || !route) {
      wmRouteCard.hidden = true
      for (const b of wmPlacesEl.querySelectorAll('.wm-chip')) b.classList.remove('on')
      return
    }
    const rem = progress ? progress.remainingM : route.totalM
    const driveMin = Math.max(1, Math.round(rem / 420)) // ~25 km/h city pace
    const walkMin = Math.max(1, Math.round(rem / 85))
    wmRouteName.textContent = destination.name
    wmRouteMeta.textContent = `${formatDistance(rem)} · ~${driveMin} min drive · ${walkMin} min walk`
    wmRouteCard.hidden = false
    for (const b of wmPlacesEl.querySelectorAll<HTMLButtonElement>('.wm-chip')) {
      b.classList.toggle('on', b.dataset.name === destination.name)
    }
  }

  const selectEntrySpot = (next: EntryPickTarget, pan = false) => {
    if (!entrySession) return
    entryTarget = { ...next }
    pinDropAt = time
    if (pan) {
      wmCam.tCx = next.x
      wmCam.tCz = next.z
      wmCam.tSpan = clamp(wmCam.tSpan, 360, 820)
      wmCam.vx = 0; wmCam.vz = 0
      clampTargetToMap()
    }
    syncRouteCard()
    entrySession.onSelect?.(entryTarget)
  }

  const rebuildChips = () => {
    wmPlacesEl.replaceChildren()
    const items: { name: string; x: number; z: number; subtitle?: string; yaw?: number }[] = []
    const seen = new Set<string>()
    if (entrySession) {
      const init = entrySession.initial
      items.push({ name: init.name, x: init.x, z: init.z, subtitle: init.subtitle, yaw: init.yaw })
      seen.add(init.name)
    }
    if (map) {
      const featured = map.places.filter((p) => p.kind === 'landmark' || p.kind === 'park')
      for (const p of featured) {
        if (seen.has(p.name)) continue
        seen.add(p.name)
        items.push({ name: p.name, x: p.x, z: p.z })
      }
    }
    for (const p of items) {
      const btn = document.createElement('button')
      btn.type = 'button'
      btn.className = 'wm-chip'
      btn.dataset.name = p.name
      btn.textContent = p.name
      btn.addEventListener('click', () => {
        if (entrySession) {
          selectEntrySpot({ x: p.x, z: p.z, name: p.name, subtitle: p.subtitle, yaw: p.yaw }, true)
        } else {
          setDestination(p.x, p.z, p.name)
          frameRouteOrPoint(p.x, p.z)
        }
      })
      wmPlacesEl.append(btn)
    }
    syncRouteCard()
  }

  const clampTargetToMap = () => {
    if (!map) return
    const padX = map.spanX * 0.12, padZ = map.spanZ * 0.12
    wmCam.tCx = clamp(wmCam.tCx, map.x0 - padX, map.x0 + map.spanX + padX)
    wmCam.tCz = clamp(wmCam.tCz, map.z0 - padZ, map.z0 + map.spanZ + padZ)
    const maxSpan = Math.max(map.spanX, map.spanZ) * 0.65
    wmCam.tSpan = clamp(wmCam.tSpan, 110, Math.max(1800, maxSpan))
  }

  const frameRouteOrPoint = (dx: number, dz: number) => {
    const p = opts.player()
    const mx = (p.x + dx) * 0.5, mz = (p.z + dz) * 0.5
    const sw = wmStage.clientWidth || innerWidth, sh = wmStage.clientHeight || innerHeight
    const aspect = Math.max(0.4, sw / Math.max(1, sh))
    const needV = Math.abs(dz - p.z) * 0.85 + 220
    const needH = (Math.abs(dx - p.x) * 0.85 + 200) / aspect
    wmCam.tCx = mx
    wmCam.tCz = mz
    wmCam.tSpan = clamp(Math.max(needV, needH), 260, 2800)
    wmCam.vx = 0; wmCam.vz = 0
    clampTargetToMap()
  }

  const setDestination = (x: number, z: number, name?: string): GpsRoute | null => {
    if (!map) return null
    const p = opts.player()
    const computed = computeRoute(map, p.x, p.z, x, z, name)
    destination = { x, z, name: computed.destName }
    route = computed
    progress = trackRoute(map, computed, p.x, p.z)
    lastRerouteAt = performance.now()
    pinDropAt = time
    gpu.setRoute(computed)
    syncRouteCard()
    return computed
  }

  const clearDestination = () => {
    destination = null
    route = null
    progress = null
    gpu.setRoute(null)
    syncRouteCard()
  }

  const centerOnPlayer = () => {
    if (entrySession && entryTarget) {
      wmCam.tCx = entryTarget.x
      wmCam.tCz = entryTarget.z
      wmCam.tSpan = clamp(wmCam.tSpan, 360, 820)
      wmCam.vx = 0; wmCam.vz = 0
      clampTargetToMap()
      return
    }
    const p = opts.player()
    wmCam.tCx = p.x
    wmCam.tCz = p.z
    wmCam.tSpan = clamp(wmCam.tSpan, 240, 1100)
    wmCam.vx = 0; wmCam.vz = 0
    clampTargetToMap()
  }

  const setMode = (mode: '2d' | '3d') => {
    viewMode = mode
    wmBtn2d.classList.toggle('on', mode === '2d')
    wmBtn3d.classList.toggle('on', mode === '3d')
    wmBtn2d.setAttribute('aria-pressed', String(mode === '2d'))
    wmBtn3d.setAttribute('aria-pressed', String(mode === '3d'))
    if (mode === '3d') {
      wmCam.tTilt = 0.84
      wmCam.tExtrude = 1.0
      if (wmCam.tSpan > 1400) wmCam.tSpan = 950
    } else {
      wmCam.tTilt = 0.002
      wmCam.tExtrude = 0.07
      wmCam.tYaw = 0
    }
  }

  const snapEntryCamera = (target: EntryPickTarget) => {
    viewMode = '3d'
    wmBtn2d.classList.remove('on')
    wmBtn3d.classList.add('on')
    wmBtn2d.setAttribute('aria-pressed', 'false')
    wmBtn3d.setAttribute('aria-pressed', 'true')
    wmCam.tCx = wmCam.cx = target.x
    wmCam.tCz = wmCam.cz = target.z
    wmCam.tYaw = wmCam.yaw = 0.35
    wmCam.tTilt = wmCam.tilt = 0.78
    wmCam.tExtrude = wmCam.extrude = 1.0
    wmCam.tSpan = wmCam.span = 680
    wmCam.vx = 0; wmCam.vz = 0
    wmCam.init = true
    clampTargetToMap()
  }

  const releaseWm = () => {
    gpu.release(wmGpu)
    wmOv.width = 0
    wmOv.height = 0
  }

  const teardownEntryDom = () => {
    isOpen = false
    entrySession = null
    entryTarget = null
    wmHeld.clear()
    wmRoot.classList.remove('open', 'entry-pick')
    html.classList.remove('map-open')
    wmLoading.hidden = true
    wmCloseBtn.innerHTML = 'Close <kbd>M</kbd>'
    wmCloseBtn.setAttribute('aria-label', 'Close map')
    wmCenterBtn.title = 'Center on player'
    wmCenterBtn.setAttribute('aria-label', 'Center on player')
    wmSub.textContent = 'Click anywhere to set a GPS route'
    leaveInput?.(); leaveInput = null
    updateHint()
    rebuildChips()
    if (!diveState) hideTimer = setTimeout(() => { if (!isOpen && !diveState) { wmRoot.hidden = true; releaseWm() } }, 200)
  }

  const confirmEntryStart = () => {
    if (!entrySession || !entryTarget) return
    const session = entrySession
    const chosen = { ...entryTarget }
    const snap: MapCameraSnapshot = { cx: wmCam.cx, cz: wmCam.cz, yaw: wmCam.yaw, tilt: wmCam.tilt, span: wmCam.span, extrude: wmCam.extrude }
    teardownEntryDom()
    session.onStart(chosen, snap)
  }

  const cancelEntry = () => {
    if (!entrySession) return
    const session = entrySession
    teardownEntryDom()
    session.onCancel()
  }

  const closeEntry = () => {
    if (!entrySession) return
    teardownEntryDom()
  }

  const openForEntry = (options: EntryPickOptions) => {
    if (hideTimer) { clearTimeout(hideTimer); hideTimer = null }
    diveState = null
    wmRoot.classList.remove('dive')
    html.classList.remove('map-dive')
    wmRoot.style.removeProperty('opacity')
    entrySession = options
    entryTarget = { ...options.initial }
    isOpen = true
    openedAt = performance.now()
    pinDropAt = time
    document.exitPointerLock?.()
    html.classList.add('map-open')
    wmRoot.classList.add('entry-pick')
    wmRoot.hidden = false
    wmLoading.hidden = !!map
    wmSub.textContent = 'Choose where to start · click anywhere on the map'
    wmCloseBtn.innerHTML = 'Back <kbd>Esc</kbd>'
    wmCloseBtn.setAttribute('aria-label', 'Back to first view')
    wmCenterBtn.title = 'Center on selected spot'
    wmCenterBtn.setAttribute('aria-label', 'Center on selected spot')
    snapEntryCamera(entryTarget)
    updateHint()
    rebuildChips()
    syncRouteCard()
    void wmRoot.offsetWidth
    wmRoot.classList.add('open')
    wmHeld.clear()
    leaveInput?.()
    leaveInput = opts.input.push({
      name: 'map',
      solid: true,
      every: true,
      key(code, e) {
        if (code === 'Escape' || (code === 'KeyM' && !e.shiftKey && !e.repeat)) {
          e.preventDefault()
          cancelEntry()
          return true
        }
        if ((code === 'Enter' || code === 'NumpadEnter') && !e.repeat) {
          e.preventDefault()
          confirmEntryStart()
          return true
        }
        if (code === 'Equal' || code === 'NumpadAdd') { wmCam.tSpan *= 0.78; clampTargetToMap(); return true }
        if (code === 'Minus' || code === 'NumpadSubtract') { wmCam.tSpan *= 1.28; clampTargetToMap(); return true }
        if (code === 'Digit2') { setMode('2d'); return true }
        if (code === 'Digit3') { setMode('3d'); return true }
        if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(code)) {
          wmHeld.add(code)
          return true
        }
        return true
      },
      wheel() { return true },
      use() { return true },
    })
  }

  const toggle = (next?: boolean) => {
    if (entrySession) {
      if (next === false || next === undefined) cancelEntry()
      return
    }
    const want = next ?? !isOpen
    if (want === isOpen) return
    if (want && !opts.engaged()) return
    if (want) opts.onOpen?.()
    isOpen = want
    if (hideTimer) { clearTimeout(hideTimer); hideTimer = null }
    if (isOpen) {
      diveState = null
      wmRoot.classList.remove('dive', 'entry-pick')
      html.classList.remove('map-dive')
      wmRoot.style.removeProperty('opacity')
      wmLoading.hidden = !!map
      openedAt = performance.now()
      document.exitPointerLock?.()
      html.classList.add('map-open')
      wmRoot.hidden = false
      const p = opts.player()
      if (destination && route) {
        frameRouteOrPoint(destination.x, destination.z)
      } else {
        wmCam.tCx = p.x
        wmCam.tCz = p.z
        wmCam.tSpan = map ? clamp(Math.min(map.spanX, map.spanZ) * 0.24, 380, 1050) : 750
      }
      if (!wmCam.init) {
        wmCam.cx = wmCam.tCx; wmCam.cz = wmCam.tCz; wmCam.span = wmCam.tSpan
        wmCam.yaw = wmCam.tYaw; wmCam.tilt = wmCam.tTilt; wmCam.extrude = wmCam.tExtrude
        wmCam.init = true
      } else {
        // Snap gently close so opening feels instantaneous yet fluid.
        wmCam.cx = wmCam.cx + (wmCam.tCx - wmCam.cx) * 0.65
        wmCam.cz = wmCam.cz + (wmCam.tCz - wmCam.cz) * 0.65
        wmCam.span = wmCam.span + (wmCam.tSpan - wmCam.span) * 0.65
      }
      wmCam.vx = 0; wmCam.vz = 0
      syncRouteCard()
      void wmRoot.offsetWidth
      wmRoot.classList.add('open')
      wmHeld.clear()
      leaveInput = opts.input.push({
        name: 'map',
        solid: true,
        every: true,
        key(code, e) {
          if (code === 'Escape' || (code === 'KeyM' && !e.shiftKey && !e.repeat)) {
            e.preventDefault()
            toggle(false)
            return true
          }
          if ((code === 'Backspace' || code === 'Delete') && !e.repeat) {
            if (destination) { clearDestination(); opts.hud.notice('GPS route cleared', 2200) }
            return true
          }
          if (code === 'Equal' || code === 'NumpadAdd') { wmCam.tSpan *= 0.78; clampTargetToMap(); return true }
          if (code === 'Minus' || code === 'NumpadSubtract') { wmCam.tSpan *= 1.28; clampTargetToMap(); return true }
          if (code === 'Digit2') { setMode('2d'); return true }
          if (code === 'Digit3') { setMode('3d'); return true }
          if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(code)) {
            wmHeld.add(code)
            return true
          }
          return true
        },
        wheel() { return true },
        use() { return true },
      })
    } else {
      wmHeld.clear()
      wmRoot.classList.remove('open')
      html.classList.remove('map-open')
      leaveInput?.(); leaveInput = null
      if (!diveState) hideTimer = setTimeout(() => { if (!isOpen && !diveState) { wmRoot.hidden = true; releaseWm() } }, 200)
    }
  }

  addEventListener('keyup', (e) => wmHeld.delete(e.code))
  addEventListener('blur', () => wmHeld.clear())

  // ── Minimap HUD click / tap to open fullscreen map ──
  mmRoot.addEventListener('pointerdown', (e) => { e.stopPropagation() })
  mmRoot.addEventListener('click', (e) => {
    e.stopPropagation()
    e.preventDefault()
    toggle(true)
  })
  mmRoot.addEventListener('keydown', (e) => {
    if (e.code === 'Enter' || e.code === 'Space') { e.preventDefault(); toggle(true) }
  })

  // ── Toolbar buttons ──
  wmBtn2d.addEventListener('click', () => setMode('2d'))
  wmBtn3d.addEventListener('click', () => setMode('3d'))
  wmZoomIn.addEventListener('click', () => { wmCam.tSpan *= 0.72; clampTargetToMap() })
  wmZoomOut.addEventListener('click', () => { wmCam.tSpan *= 1.38; clampTargetToMap() })
  wmCenterBtn.addEventListener('click', () => centerOnPlayer())
  wmVisitBtn.addEventListener('click', () => {
    if (entrySession) {
      confirmEntryStart()
      return
    }
    if (!destination || !opts.onVisit) return
    const { x, z, name } = destination
    const snap: MapCameraSnapshot = { cx: wmCam.cx, cz: wmCam.cz, yaw: wmCam.yaw, tilt: wmCam.tilt, span: wmCam.span, extrude: wmCam.extrude }
    clearDestination()
    // Close interactive map controls cleanly (if onVisit initiates an optical dive, setDive keeps wmRoot live without a flash).
    toggle(false)
    void opts.onVisit(x, z, name, snap)
  })
  wmClearBtn.addEventListener('click', () => clearDestination())
  wmCloseBtn.addEventListener('click', () => { if (entrySession) cancelEntry(); else toggle(false) })

  // ── Fullscreen Interactive Pan / Zoom / Tilt / Pinch / Click-to-Navigate ──
  const buildWmCamera = (): MapCamera => {
    const p = opts.player()
    const pin = entrySession ? entryTarget : destination
    return {
      cx: wmCam.cx,
      cz: wmCam.cz,
      yaw: wmCam.yaw,
      tilt: wmCam.tilt,
      span: wmCam.span,
      style: 1,
      extrude: wmCam.extrude,
      targetOffsetY: 0,
      playerX: p.x,
      playerZ: p.z,
      routeAlong: entrySession ? 0 : (progress?.alongM ?? 0),
      routeFadeLen: 0,
      time,
      destActive: !!pin,
      destX: pin?.x ?? 0,
      destZ: pin?.z ?? 0,
      night: clamp(1 - opts.day(), 0, 1),
    }
  }

  const activePointers = new Map<number, { x: number; y: number }>()
  let drag: {
    id: number
    startX: number
    startY: number
    lastX: number
    lastY: number
    lastT: number
    moved: boolean
    orbit: boolean
  } | null = null
  let pinch: { dist: number; cx: number; cy: number; span0: number } | null = null

  const handleMapClick = (clientX: number, clientY: number) => {
    if (!map) return
    const r = wmStage.getBoundingClientRect()
    const px = clientX - r.left, py = clientY - r.top
    // Click on rotated compass rose snaps North-up cleanly!
    if (northBtnPos && Math.hypot(px - northBtnPos.x, py - northBtnPos.y) <= northBtnPos.r + 6) {
      wmCam.tYaw = 0
      return
    }
    // Check if user clicked near a rendered landmark pin (24 px hit radius) for crisp landmark snapping!
    let pickedPlace: MapPlace | null = null, bestD = 24
    for (const pp of projectedPlaces) {
      const d = Math.hypot(pp.x - px, pp.y - py)
      if (d < bestD) { bestD = d; pickedPlace = pp.place }
    }
    if (pickedPlace) {
      if (entrySession) {
        selectEntrySpot({ x: pickedPlace.x, z: pickedPlace.z, name: pickedPlace.name })
      } else {
        setDestination(pickedPlace.x, pickedPlace.z, pickedPlace.name)
      }
      return
    }
    // If clicking right on the active destination pin (within 18 px), toggle-clear it cleanly (in-game GPS only).
    if (!entrySession && destination && lastWmVP) {
      const dp = projectMapPoint(lastWmVP, destination.x, 1, destination.z, r.width, r.height)
      if (dp && Math.hypot(dp[0] - px, dp[1] - py) < 18) {
        clearDestination()
        return
      }
    }
    const ground = unprojectToGround(buildWmCamera(), px, py, r.width, r.height)
    if (!ground) return
    const [wx, wz] = ground
    // Clamp clicks inside the map area + slight shore margin.
    const cx = clamp(wx, map.x0, map.x0 + map.spanX)
    const cz = clamp(wz, map.z0, map.z0 + map.spanZ)
    if (entrySession) {
      const snap = snapToRoad(map, cx, cz, 120)
      const label = snap?.street || describeSpot(map, cx, cz)
      const sub = snap?.street ? describeSpot(map, cx, cz) : 'Custom starting spot'
      selectEntrySpot({ x: cx, z: cz, name: label, subtitle: sub !== label ? sub : 'Custom starting spot' })
    } else {
      setDestination(cx, cz)
    }
  }

  wmStage.addEventListener('contextmenu', (e) => e.preventDefault())

  wmStage.addEventListener('pointerdown', (e) => {
    e.stopPropagation()
    wmStage.setPointerCapture(e.pointerId)
    activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (activePointers.size === 2) {
      const [a, b] = [...activePointers.values()]
      pinch = { dist: Math.hypot(b.x - a.x, b.y - a.y) || 1, cx: (a.x + b.x) * 0.5, cy: (a.y + b.y) * 0.5, span0: wmCam.tSpan }
      drag = null
      wmCam.vx = 0; wmCam.vz = 0
      return
    }
    if (activePointers.size === 1) {
      const orbit = e.button === 2 || e.shiftKey
      drag = { id: e.pointerId, startX: e.clientX, startY: e.clientY, lastX: e.clientX, lastY: e.clientY, lastT: performance.now(), moved: false, orbit }
      wmCam.vx = 0; wmCam.vz = 0
    }
  })

  wmStage.addEventListener('pointermove', (e) => {
    e.stopPropagation()
    if (activePointers.has(e.pointerId)) activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY })

    // Two-finger pinch zoom & pan on touchscreens.
    if (pinch && activePointers.size === 2) {
      const [a, b] = [...activePointers.values()]
      const dist = Math.hypot(b.x - a.x, b.y - a.y) || 1
      const cx = (a.x + b.x) * 0.5, cy = (a.y + b.y) * 0.5
      const r = wmStage.getBoundingClientRect()
      const ratio = pinch.dist / dist
      wmCam.tSpan = pinch.span0 * ratio
      const mPerPx = (wmCam.tSpan * 2) / Math.max(1, r.height)
      const dx = cx - pinch.cx, dy = cy - pinch.cy
      const cosY = Math.cos(wmCam.yaw), sinY = Math.sin(wmCam.yaw)
      wmCam.tCx -= (dx * cosY - dy * sinY) * mPerPx
      wmCam.tCz -= (dx * sinY + dy * cosY) * mPerPx
      pinch.cx = cx; pinch.cy = cy
      clampTargetToMap()
      return
    }

    if (drag && drag.id === e.pointerId) {
      const dx = e.clientX - drag.lastX, dy = e.clientY - drag.lastY
      if (!drag.moved && Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) > 6) {
        drag.moved = true
        wmStage.classList.add('dragging')
      }
      if (drag.moved) {
        if (drag.orbit) {
          wmCam.tYaw = wrapAngle(wmCam.tYaw + dx * 0.006)
          wmCam.tTilt = clamp(wmCam.tTilt - dy * 0.005, 0.002, 1.02)
          wmCam.tExtrude = wmCam.tTilt > 0.14 ? clamp((wmCam.tTilt - 0.1) / 0.55, 0.08, 1.0) : 0.07
          const is3d = wmCam.tTilt > 0.25
          if ((is3d ? '3d' : '2d') !== viewMode) {
            viewMode = is3d ? '3d' : '2d'
            wmBtn2d.classList.toggle('on', !is3d); wmBtn3d.classList.toggle('on', is3d)
          }
        } else {
          const r = wmStage.getBoundingClientRect()
          // Exact ground-plane drag: project previous & current cursor positions onto y=0 for 1:1 grab even in 3D!
          const camNow = buildWmCamera()
          const g0 = unprojectToGround(camNow, drag.lastX - r.left, drag.lastY - r.top, r.width, r.height)
          const g1 = unprojectToGround(camNow, e.clientX - r.left, e.clientY - r.top, r.width, r.height)
          const now = performance.now()
          const dtDrag = Math.max(0.008, (now - drag.lastT) / 1000)
          if (g0 && g1) {
            const moveX = clamp(g0[0] - g1[0], -wmCam.span * 1.2, wmCam.span * 1.2)
            const moveZ = clamp(g0[1] - g1[1], -wmCam.span * 1.2, wmCam.span * 1.2)
            wmCam.tCx += moveX; wmCam.tCz += moveZ
            wmCam.cx += moveX; wmCam.cz += moveZ
            wmCam.vx = wmCam.vx * 0.55 + (moveX / dtDrag) * 0.45
            wmCam.vz = wmCam.vz * 0.55 + (moveZ / dtDrag) * 0.45
          }
          drag.lastT = now
          clampTargetToMap()
        }
      }
      drag.lastX = e.clientX; drag.lastY = e.clientY
      return
    }

    // Hover feedback (throttled to ~20 Hz): highlight landmarks and show street/place name in header.
    if (e.pointerType === 'mouse' && map && performance.now() - lastHoverAt > 45) {
      lastHoverAt = performance.now()
      const r = wmStage.getBoundingClientRect()
      const px = e.clientX - r.left, py = e.clientY - r.top
      let hit: MapPlace | null = null, best = 24
      for (const pp of projectedPlaces) {
        const d = Math.hypot(pp.x - px, pp.y - py)
        if (d < best) { best = d; hit = pp.place }
      }
      hoveredPlace = hit
      if (hit) {
        hoveredText = entrySession ? `${hit.name} · Click to start here` : `${hit.name} · Click to route`
      } else {
        const g = unprojectToGround(buildWmCamera(), px, py, r.width, r.height)
        if (g && g[0] >= map.x0 && g[0] <= map.x0 + map.spanX && g[1] >= map.z0 && g[1] <= map.z0 + map.spanZ) {
          const snap = snapToRoad(map, g[0], g[1], 90)
          hoveredText = snap?.street
            ? `${snap.street} · ${entrySession ? 'Click to start here' : 'Click to set waypoint'}`
            : describeSpot(map, g[0], g[1])
        } else {
          hoveredText = 'San Francisco Bay'
        }
      }
      wmSub.textContent = hoveredText
    }
  })

  const endPointer = (e: PointerEvent) => {
    activePointers.delete(e.pointerId)
    if (activePointers.size < 2) pinch = null
    if (drag && drag.id === e.pointerId) {
      const wasMoved = drag.moved, wasOrbit = drag.orbit
      drag = null
      wmStage.classList.remove('dragging')
      if (!wasMoved && !wasOrbit && e.button === 0) handleMapClick(e.clientX, e.clientY)
      else if (!wasMoved && e.button === 2 && destination) clearDestination()
    }
  }
  wmStage.addEventListener('pointerup', endPointer)
  wmStage.addEventListener('pointercancel', endPointer)

  wmStage.addEventListener('wheel', (e) => {
    e.preventDefault()
    e.stopPropagation()
    const r = wmStage.getBoundingClientRect()
    const px = e.clientX - r.left, py = e.clientY - r.top
    const camBefore = buildWmCamera()
    const before = unprojectToGround(camBefore, px, py, r.width, r.height)
    const factor = Math.pow(1.0018, clamp(e.deltaY, -240, 240))
    const nextSpan = clamp(wmCam.tSpan * factor, 110, Math.max(1800, map ? Math.max(map.spanX, map.spanZ) * 0.65 : 4000))
    wmCam.tSpan = nextSpan
    if (before) {
      const camAfter: MapCamera = { ...camBefore, span: nextSpan }
      const after = unprojectToGround(camAfter, px, py, r.width, r.height)
      if (after) {
        wmCam.tCx += before[0] - after[0]
        wmCam.tCz += before[1] - after[1]
      }
    }
    clampTargetToMap()
  }, { passive: false })

  // ── 2D Overlay Drawing: GTA VI Minimap ──
  const drawMinimapOverlay = (vp: Float32Array, cam: MapCamera, playerYaw: number, speedGlow: number, driftGlow: number) => {
    const cssW = mmRoot.clientWidth, cssH = mmRoot.clientHeight
    if (cssW < 10 || cssH < 10) return
    const pad = cssW < 134 ? 6 : 8
    const ovW = cssW + pad * 2, ovH = cssH + pad * 2
    const dpr = Math.min(2.5, devicePixelRatio || 1)
    const pw = Math.round(ovW * dpr), ph = Math.round(ovH * dpr)
    if (mmOv.width !== pw || mmOv.height !== ph) { mmOv.width = pw; mmOv.height = ph }

    const ctx = mmCtx
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, ovW, ovH)

    const radius = cssW < 160 ? 12 : 14
    const pProj = projectMapPoint(vp, cam.playerX, 0.8, cam.playerZ, cssW, cssH)
    const px = pProj ? clamp(pProj[0], 18, cssW - 18) : cssW * 0.5
    const py = pProj ? clamp(pProj[1], 18, cssH - 18) : cssH * 0.74

    // 1. Active destination: in-frame pin OR GTA VI neon-pink border pip gliding smoothly around the rounded rim!
    if (destination) {
      const dProj = projectMapPoint(vp, destination.x, 1.0, destination.z, cssW, cssH)
      const inFrame = dProj && dProj[0] > 10 && dProj[0] < cssW - 10 && dProj[1] > 10 && dProj[1] < cssH - 10
      if (inFrame && dProj) {
        const dx = dProj[0] + pad, dy = dProj[1] + pad
        const pulse = (time * 1.1) % 1
        ctx.save()
        ctx.beginPath()
        ctx.arc(dx, dy, 6 + pulse * 11, 0, Math.PI * 2)
        ctx.strokeStyle = `rgba(255, 42, 133, ${(1 - pulse) * 0.85})`
        ctx.lineWidth = 2
        ctx.stroke()
        ctx.shadowColor = 'rgba(255, 42, 133, 0.85)'
        ctx.shadowBlur = 10
        ctx.beginPath()
        ctx.arc(dx, dy, 5.5, 0, Math.PI * 2)
        ctx.fillStyle = '#ff2a85'
        ctx.fill()
        ctx.lineWidth = 1.8
        ctx.strokeStyle = '#ffffff'
        ctx.stroke()
        ctx.restore()
      } else {
        // Compute exact screen-space direction toward destination from player's position & camera yaw!
        const bearing = Math.atan2(destination.x - cam.playerX, -(destination.z - cam.playerZ)) - cam.yaw
        const dirX = Math.sin(bearing), dirY = -Math.cos(bearing)
        const [bx, by] = rayOnRoundedRect(px, py, dirX, dirY, cssW, cssH, radius)
        ctx.save()
        ctx.shadowColor = 'rgba(255, 42, 133, 0.9)'
        ctx.shadowBlur = 10
        ctx.beginPath()
        ctx.arc(bx + pad, by + pad, cssW < 160 ? 5.5 : 6.5, 0, Math.PI * 2)
        ctx.fillStyle = '#ff2d88'
        ctx.fill()
        ctx.lineWidth = 1.4
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.92)'
        ctx.stroke()
        ctx.restore()
      }
    }

    // 2. GTA VI circular black 'N' North compass badge gliding along the rounded border!
    {
      const northRel = -cam.yaw // North is world bearing 0
      const ndx = Math.sin(northRel), ndy = -Math.cos(northRel)
      const [nx, ny] = rayOnRoundedRect(cssW * 0.5, cssH * 0.5, ndx, ndy, cssW, cssH, radius)
      const nr = cssW < 160 ? 7.2 : 8.5
      ctx.save()
      ctx.shadowColor = 'rgba(0, 0, 0, 0.65)'
      ctx.shadowBlur = 5
      ctx.beginPath()
      ctx.arc(nx + pad, ny + pad, nr, 0, Math.PI * 2)
      ctx.fillStyle = '#0d1117'
      ctx.fill()
      ctx.lineWidth = 1.4
      ctx.strokeStyle = 'rgba(232, 238, 245, 0.85)'
      ctx.stroke()
      ctx.shadowBlur = 0
      ctx.fillStyle = '#ffffff'
      ctx.font = `700 ${cssW < 160 ? 8.5 : 10}px -apple-system, BlinkMacSystemFont, system-ui, sans-serif`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText('N', nx + pad, ny + pad + 0.5)
      ctx.restore()
    }

    // 3. GTA VI circular dark-disc + white-ring + white directional chevron player badge,
    //    with a sleek speed-adaptive / drift-reactive glow & pulse while driving fast!
    {
      const cx = px + pad, cy = py + pad
      const relYaw = wrapAngle(playerYaw - cam.yaw)
      const r = cssW < 160 ? 7.5 : 9.5
      const activeGlow = Math.max(speedGlow, driftGlow)
      ctx.save()
      ctx.translate(cx, cy)

      if (activeGlow > 0.02) {
        // Blend smoothly from electric cyan-white at high speed to hot neon-pink/amber while drifting.
        const dMix = clamp(driftGlow * 1.15, 0, 1)
        const gr = Math.round(108 + (255 - 108) * dMix)
        const gg = Math.round(224 + (62 - 224) * dMix)
        const gb = Math.round(255 + (148 - 255) * dMix)

        // Subtle ambient aura tight to the player badge (always inside minimap bounds).
        const auraR = r * (1.75 + activeGlow * 0.45)
        const aura = ctx.createRadialGradient(0, 0, r * 0.75, 0, 0, auraR)
        aura.addColorStop(0, `rgba(${gr}, ${gg}, ${gb}, ${(0.22 + activeGlow * 0.34).toFixed(3)})`)
        aura.addColorStop(1, `rgba(${gr}, ${gg}, ${gb}, 0)`)
        ctx.beginPath()
        ctx.arc(0, 0, auraR, 0, Math.PI * 2)
        ctx.fillStyle = aura
        ctx.fill()

        // Smooth speed/drift expanding pulse ring (static subtle accent ring under prefers-reduced-motion).
        if (!reducedMotion.matches) {
          const pulseFreq = 1.15 + speedGlow * 0.75 + driftGlow * 0.55
          const pT = (time * pulseFreq) % 1
          const ringR = r + 1 + pT * (r * (0.95 + activeGlow * 0.45))
          const ringAlpha = (1 - pT) * (1 - pT) * (0.35 + activeGlow * 0.48)
          ctx.beginPath()
          ctx.arc(0, 0, ringR, 0, Math.PI * 2)
          ctx.strokeStyle = `rgba(${gr}, ${gg}, ${gb}, ${ringAlpha.toFixed(3)})`
          ctx.lineWidth = 1.5 + driftGlow * 0.5
          ctx.stroke()
        } else {
          ctx.beginPath()
          ctx.arc(0, 0, r + 2.5, 0, Math.PI * 2)
          ctx.strokeStyle = `rgba(${gr}, ${gg}, ${gb}, ${(0.28 + activeGlow * 0.32).toFixed(3)})`
          ctx.lineWidth = 1.4
          ctx.stroke()
        }
      }

      ctx.shadowColor = activeGlow > 0.05
        ? (driftGlow > 0.2 ? `rgba(255, 58, 146, ${(0.55 + driftGlow * 0.35).toFixed(2)})` : `rgba(108, 224, 255, ${(0.45 + speedGlow * 0.35).toFixed(2)})`)
        : 'rgba(0, 0, 0, 0.65)'
      ctx.shadowBlur = activeGlow > 0.05 ? 8 + activeGlow * 4 : 6
      ctx.beginPath()
      ctx.arc(0, 0, r, 0, Math.PI * 2)
      ctx.fillStyle = '#11161d'
      ctx.fill()
      ctx.lineWidth = 1.75
      ctx.strokeStyle = driftGlow > 0.25 ? '#ff72b2' : speedGlow > 0.45 ? '#ccf4ff' : '#ffffff'
      ctx.stroke()
      ctx.shadowBlur = 0
      ctx.rotate(relYaw)
      ctx.beginPath()
      ctx.moveTo(0, -r * 0.56)
      ctx.lineTo(r * 0.44, r * 0.42)
      ctx.lineTo(0, r * 0.16)
      ctx.lineTo(-r * 0.44, r * 0.42)
      ctx.closePath()
      ctx.fillStyle = '#ffffff'
      ctx.fill()
      ctx.restore()
    }

    // 4. Top-left crisp GTA VI distance readout (`0.78 mi` / `240 ft`) when navigating!
    if (destination && route) {
      const rem = progress ? progress.remainingM : route.totalM
      const distStr = formatDistance(rem)
      ctx.save()
      ctx.font = `700 ${cssW < 160 ? 11.5 : 13.5}px -apple-system, BlinkMacSystemFont, "SF Pro Display", system-ui, sans-serif`
      ctx.textAlign = 'left'
      ctx.textBaseline = 'top'
      ctx.lineJoin = 'round'
      ctx.lineWidth = 3.2
      ctx.strokeStyle = 'rgba(8, 12, 18, 0.85)'
      ctx.strokeText(distStr, pad + 11, pad + 10)
      ctx.fillStyle = '#ffffff'
      ctx.fillText(distStr, pad + 11, pad + 10)
      if (cssW >= 180) {
        const sub = destination.name.length > 22 ? `${destination.name.slice(0, 21)}…` : destination.name
        ctx.font = '600 10.5px -apple-system, BlinkMacSystemFont, system-ui, sans-serif'
        ctx.lineWidth = 2.8
        ctx.strokeStyle = 'rgba(8, 12, 18, 0.82)'
        ctx.strokeText(sub, pad + 11, pad + 27)
        ctx.fillStyle = 'rgba(255, 198, 226, 0.96)'
        ctx.fillText(sub, pad + 11, pad + 27)
      }
      ctx.restore()
    }
  }

  // ── 2D Overlay Drawing: Full-Screen Interactive Map ──
  const drawFullscreenOverlay = (vp: Float32Array, cam: MapCamera, playerYaw: number) => {
    const cssW = wmStage.clientWidth, cssH = wmStage.clientHeight
    if (cssW < 10 || cssH < 10 || !map) return
    const dpr = Math.min(2, devicePixelRatio || 1)
    const pw = Math.round(cssW * dpr), ph = Math.round(cssH * dpr)
    if (wmOv.width !== pw || wmOv.height !== ph) { wmOv.width = pw; wmOv.height = ph }

    const ctx = wmCtx
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, cssW, cssH)

    // Simple screen-space bounding-box occupancy list to keep labels 100% crisp and collision-free.
    // Pre-seed with floating UI chrome cards AND the active destination/entry pin tag so labels never collide with them!
    const used: [number, number, number, number][] = []
    const stageR = wmStage.getBoundingClientRect()
    for (const el of wmRoot.querySelectorAll<HTMLElement>('.wm-title-card, .wm-route-card, .wm-tools, .wm-dock')) {
      if (el.hidden || !el.offsetParent) continue
      const r = el.getBoundingClientRect()
      if (r.width > 2 && r.height > 2) {
        used.push([r.left - stageR.left - 8, r.top - stageR.top - 8, r.right - stageR.left + 8, r.bottom - stageR.top + 8])
      }
    }
    const activePinForOcc = entrySession ? entryTarget : (destination && route ? destination : null)
    if (activePinForOcc) {
      const dp = projectMapPoint(vp, activePinForOcc.x, 1.5, activePinForOcc.z, cssW, cssH)
      if (dp) {
        ctx.font = '600 12px -apple-system, BlinkMacSystemFont, system-ui, sans-serif'
        const rem = !entrySession && route ? (progress ? progress.remainingM : route.totalM) : 0
        const tag = entrySession ? activePinForOcc.name : `${activePinForOcc.name} · ${formatDistance(rem)}`
        const tw = ctx.measureText(tag).width + 24
        used.push([dp[0] - tw * 0.5 - 6, dp[1] - 62, dp[0] + tw * 0.5 + 6, dp[1] + 10])
      }
    }
    const fits = (x0: number, y0: number, x1: number, y1: number) => {
      if (x0 < 12 || y0 < 16 || x1 > cssW - 12 || y1 > cssH - 16) return false
      for (const b of used) if (x0 < b[2] && x1 > b[0] && y0 < b[3] && y1 > b[1]) return false
      used.push([x0, y0, x1, y1])
      return true
    }

    // 1. Road street names when zoomed in (< 1050 m span), aligned along street angles!
    if (cam.span < 1050 && streetLabels.length > 0) {
      ctx.save()
      ctx.font = '600 10.5px -apple-system, BlinkMacSystemFont, system-ui, sans-serif'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.lineJoin = 'round'
      let drawn = 0
      for (const s of streetLabels) {
        if (cam.span > 620 && s.tier < 2) continue
        const pM = projectMapPoint(vp, s.mx, 0.5, s.mz, cssW, cssH)
        if (!pM || pM[0] < 40 || pM[0] > cssW - 40 || pM[1] < 80 || pM[1] > cssH - 96) continue
        const pA = projectMapPoint(vp, s.ax, 0.5, s.az, cssW, cssH)
        const pB = projectMapPoint(vp, s.bx, 0.5, s.bz, cssW, cssH)
        if (!pA || !pB) continue
        const segPx = Math.hypot(pB[0] - pA[0], pB[1] - pA[1])
        if (segPx < 36) continue
        const tw = ctx.measureText(s.name).width + 10
        if (!fits(pM[0] - tw * 0.5, pM[1] - 9, pM[0] + tw * 0.5, pM[1] + 9)) continue
        let ang = Math.atan2(pB[1] - pA[1], pB[0] - pA[0])
        if (ang > Math.PI * 0.5) ang -= Math.PI
        if (ang < -Math.PI * 0.5) ang += Math.PI
        ctx.save()
        ctx.translate(pM[0], pM[1])
        ctx.rotate(ang)
        ctx.lineWidth = 3.2
        ctx.strokeStyle = cam.night > 0.5 ? 'rgba(12, 18, 26, 0.88)' : 'rgba(245, 247, 250, 0.92)'
        ctx.strokeText(s.name, 0, 0)
        ctx.fillStyle = cam.night > 0.5 ? 'rgba(222, 232, 242, 0.92)' : 'rgba(28, 36, 46, 0.9)'
        ctx.fillText(s.name, 0, 0)
        ctx.restore()
        if (++drawn >= 26) break
      }
      ctx.restore()
    }

    // 2. Neighborhood headers (subtle cartographic uppercase)
    ctx.save()
    ctx.font = '700 10.5px -apple-system, BlinkMacSystemFont, system-ui, sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.lineJoin = 'round'
    for (const p of map.places) {
      if (p.kind !== 'hood') continue
      const pr = projectMapPoint(vp, p.x, 4, p.z, cssW, cssH)
      if (!pr) continue
      const label = p.name.toUpperCase()
      const tw = ctx.measureText(label).width + 12
      if (!fits(pr[0] - tw * 0.5, pr[1] - 10, pr[0] + tw * 0.5, pr[1] + 10)) continue
      ctx.lineWidth = 3.5
      ctx.strokeStyle = 'rgba(10, 20, 32, 0.72)'
      ctx.strokeText(label, pr[0], pr[1])
      ctx.fillStyle = 'rgba(244, 248, 252, 0.92)'
      ctx.fillText(label, pr[0], pr[1])
    }
    ctx.restore()

    // 3. Clickable Landmark & Park pins
    projectedPlaces.length = 0
    ctx.save()
    ctx.font = '600 11.5px -apple-system, BlinkMacSystemFont, system-ui, sans-serif'
    ctx.textAlign = 'left'
    ctx.textBaseline = 'middle'
    for (const p of map.places) {
      if (p.kind === 'hood') continue
      const elev = cam.extrude > 0.3 ? 18 : 2
      const pr = projectMapPoint(vp, p.x, elev, p.z, cssW, cssH)
      if (!pr || pr[0] < 14 || pr[0] > cssW - 14 || pr[1] < 60 || pr[1] > cssH - 76) continue
      projectedPlaces.push({ place: p, x: pr[0], y: pr[1] })
      const activePin = entrySession ? entryTarget : destination
      const isDest = activePin?.name === p.name
      const isHover = hoveredPlace === p
      const tw = ctx.measureText(p.name).width
      const pillW = tw + 22, pillH = 22
      const bx = pr[0] - 8, by = pr[1] - pillH * 0.5
      const showLabel = isDest || isHover || fits(bx, by, bx + pillW, by + pillH)
      // Dot marker
      ctx.beginPath()
      ctx.arc(pr[0], pr[1], isHover || isDest ? 5.2 : 4, 0, Math.PI * 2)
      ctx.fillStyle = isDest ? '#ff2a85' : p.kind === 'park' ? '#49c683' : '#f7b955'
      ctx.fill()
      ctx.lineWidth = 1.6
      ctx.strokeStyle = '#0e141c'
      ctx.stroke()
      if (showLabel && !isDest) {
        const lx = pr[0] + 9, ly = pr[1]
        ctx.fillStyle = isHover ? 'rgba(14, 20, 30, 0.92)' : 'rgba(12, 18, 28, 0.76)'
        ctx.beginPath()
        ctx.roundRect(lx - 4, ly - 10, tw + 10, 20, 6)
        ctx.fill()
        ctx.strokeStyle = isHover ? 'rgba(255, 110, 174, 0.75)' : 'rgba(255, 255, 255, 0.16)'
        ctx.lineWidth = 1
        ctx.stroke()
        ctx.fillStyle = '#f3f7fb'
        ctx.fillText(p.name, lx + 1, ly + 0.5)
      }
    }
    ctx.restore()

    // 4. Player sight cone + GTA VI circular directional arrow badge (hidden in pre-entry picker before player lands)
    if (!entrySession) {
      const pProj = projectMapPoint(vp, cam.playerX, 2, cam.playerZ, cssW, cssH)
      if (pProj) {
        const px = pProj[0], py = pProj[1]
        const relYaw = wrapAngle(playerYaw - cam.yaw)
        ctx.save()
        ctx.translate(px, py)
        ctx.rotate(relYaw)
        // Soft directional FOV cone
        const grad = ctx.createRadialGradient(0, 0, 4, 0, 0, 44)
        grad.addColorStop(0, 'rgba(255, 255, 255, 0.36)')
        grad.addColorStop(1, 'rgba(255, 255, 255, 0.0)')
        ctx.beginPath()
        ctx.moveTo(0, 0)
        ctx.arc(0, 0, 44, -Math.PI * 0.5 - 0.45, -Math.PI * 0.5 + 0.45)
        ctx.closePath()
        ctx.fillStyle = grad
        ctx.fill()
        // Outer white-bordered dark circle
        ctx.shadowColor = 'rgba(0, 0, 0, 0.55)'
        ctx.shadowBlur = 8
        ctx.beginPath()
        ctx.arc(0, 0, 11.5, 0, Math.PI * 2)
        ctx.fillStyle = '#0f141b'
        ctx.fill()
        ctx.lineWidth = 2.2
        ctx.strokeStyle = '#ffffff'
        ctx.stroke()
        // Crisp white arrow chevron
        ctx.shadowBlur = 0
        ctx.beginPath()
        ctx.moveTo(0, -6.5)
        ctx.lineTo(5, 4.8)
        ctx.lineTo(0, 2)
        ctx.lineTo(-5, 4.8)
        ctx.closePath()
        ctx.fillStyle = '#ffffff'
        ctx.fill()
        ctx.restore()
      }
    }

    // 5. Active Neon-Pink GPS Destination Pin (or Entry Start Pin) + Drop Ripple + Floating Tag
    const pinTarget = entrySession ? entryTarget : (destination && route ? destination : null)
    if (pinTarget) {
      const dProj = projectMapPoint(vp, pinTarget.x, 1.5, pinTarget.z, cssW, cssH)
      if (dProj) {
        const dx = dProj[0], dy = dProj[1]
        ctx.save()
        // Drop ripple burst when freshly placed
        const age = time - pinDropAt
        if (age >= 0 && age < 0.85) {
          const k = age / 0.85
          ctx.beginPath()
          ctx.arc(dx, dy, 8 + k * 34, 0, Math.PI * 2)
          ctx.strokeStyle = `rgba(255, 45, 136, ${(1 - k) * 0.9})`
          ctx.lineWidth = 2.5 * (1 - k * 0.5)
          ctx.stroke()
        }
        // Teardrop neon-pink waypoint pin with glowing shadow
        const bounce = age >= 0 && age < 0.35 ? -Math.sin((age / 0.35) * Math.PI) * 10 : 0
        ctx.translate(dx, dy + bounce)
        ctx.shadowColor = 'rgba(255, 42, 133, 0.72)'
        ctx.shadowBlur = 14
        ctx.beginPath()
        ctx.moveTo(0, 0)
        ctx.bezierCurveTo(-11, -12, -13, -24, 0, -28)
        ctx.bezierCurveTo(13, -24, 11, -12, 0, 0)
        ctx.closePath()
        ctx.fillStyle = '#ff2a85'
        ctx.fill()
        ctx.lineWidth = 2
        ctx.strokeStyle = '#ffffff'
        ctx.stroke()
        // Inner hot dot
        ctx.shadowBlur = 0
        ctx.beginPath()
        ctx.arc(0, -17.5, 4.2, 0, Math.PI * 2)
        ctx.fillStyle = '#ffffff'
        ctx.fill()

        // Crisp floating destination tag above pin
        const rem = !entrySession && route ? (progress ? progress.remainingM : route.totalM) : 0
        const tag = entrySession ? pinTarget.name : `${pinTarget.name} · ${formatDistance(rem)}`
        ctx.font = '600 12px -apple-system, BlinkMacSystemFont, system-ui, sans-serif'
        const tw = ctx.measureText(tag).width + 18
        ctx.fillStyle = 'rgba(13, 17, 25, 0.88)'
        ctx.beginPath()
        ctx.roundRect(-tw * 0.5, -56, tw, 23, 8)
        ctx.fill()
        ctx.strokeStyle = 'rgba(255, 42, 133, 0.7)'
        ctx.lineWidth = 1.2
        ctx.stroke()
        ctx.fillStyle = '#ffffff'
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText(tag, 0, -44.2)
        ctx.restore()
      }
    }

    // 6. Clickable North Compass Rose when map is rotated away from North
    if (Math.abs(wrapAngle(cam.yaw)) > 0.03) {
      const cx = cssW - 36, cy = 84, r = 18
      northBtnPos = { x: cx, y: cy, r }
      ctx.save()
      ctx.translate(cx, cy)
      ctx.beginPath()
      ctx.arc(0, 0, r, 0, Math.PI * 2)
      ctx.fillStyle = 'rgba(11, 17, 25, 0.82)'
      ctx.fill()
      ctx.lineWidth = 1.4
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.28)'
      ctx.stroke()
      ctx.rotate(-cam.yaw)
      ctx.beginPath()
      ctx.moveTo(0, -12)
      ctx.lineTo(4.5, 2)
      ctx.lineTo(-4.5, 2)
      ctx.closePath()
      ctx.fillStyle = '#ff2a85'
      ctx.fill()
      ctx.beginPath()
      ctx.moveTo(0, 12)
      ctx.lineTo(4.5, 2)
      ctx.lineTo(-4.5, 2)
      ctx.closePath()
      ctx.fillStyle = 'rgba(255, 255, 255, 0.45)'
      ctx.fill()
      ctx.restore()
    } else {
      northBtnPos = null
    }
  }

  const drawDiveOverlay = (vp: Float32Array, state: MapDiveState) => {
    const cssW = wmStage.clientWidth, cssH = wmStage.clientHeight
    if (cssW < 10 || cssH < 10) return
    const dpr = Math.min(2, devicePixelRatio || 1)
    const pw = Math.round(cssW * dpr), ph = Math.round(cssH * dpr)
    if (wmOv.width !== pw || wmOv.height !== ph) { wmOv.width = pw; wmOv.height = ph }
    const ctx = wmCtx
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, cssW, cssH)
    const target = state.target
    if (!target || state.opacity < 0.08) return
    const proj = projectMapPoint(vp, target.x, 4, target.z, cssW, cssH)
    if (!proj) return
    const [dx, dy] = proj
    const alpha = Math.min(1, state.opacity * 1.15)
    ctx.save()
    ctx.globalAlpha = alpha
    const pulse = (time * 1.6) % 1
    ctx.beginPath()
    ctx.arc(dx, dy, 12 + pulse * 26, 0, Math.PI * 2)
    ctx.strokeStyle = `rgba(255, 45, 136, ${(1 - pulse) * 0.85})`
    ctx.lineWidth = 2.2
    ctx.stroke()
    ctx.beginPath()
    ctx.arc(dx, dy, 6.5, 0, Math.PI * 2)
    ctx.fillStyle = '#ff2a85'
    ctx.fill()
    ctx.lineWidth = 2
    ctx.strokeStyle = '#ffffff'
    ctx.stroke()
    if (target.name) {
      ctx.font = '700 12px -apple-system, BlinkMacSystemFont, "SF Pro Display", system-ui, sans-serif'
      const label = target.name.toUpperCase()
      const tw = ctx.measureText(label).width + 20
      ctx.fillStyle = 'rgba(10, 15, 22, 0.82)'
      ctx.beginPath()
      ctx.roundRect(dx - tw * 0.5, dy - 38, tw, 23, 8)
      ctx.fill()
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.22)'
      ctx.lineWidth = 1
      ctx.stroke()
      ctx.fillStyle = '#ffffff'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(label, dx, dy - 26.2)
    }
    ctx.restore()
  }

  const renderDive = (state: MapDiveState) => {
    if (!mmRoot.hidden) mmRoot.hidden = true
    if (!map || opts.paused()) return
    const gpuDpr = Math.min(1.5, devicePixelRatio || 1)
    const w = Math.round((wmStage.clientWidth || innerWidth) * gpuDpr)
    const h = Math.round((wmStage.clientHeight || innerHeight) * gpuDpr)
    const t0 = performance.now()
    const vp = gpu.render(wmGpu, w, h, state.cam)
    renderMs = renderMs * 0.85 + (performance.now() - t0) * 0.15
    if (vp) {
      lastWmVP = vp
      drawDiveOverlay(vp, state)
    }
  }

  // ── Per-Frame Update & Render ──
  const frame = (dtRaw: number) => {
    const dt = clamp(dtRaw || 0.016, 0.001, 0.05)
    time += dt
    const engaged = opts.engaged()

    if (engaged && !engagedOnce) {
      engagedOnce = true
      opts.onEngage?.()
    }

    // 0. Optical Map-to-Reality Dive Mode (rendered synchronously in setDive for 0-frame parallax lag; fallback here if idle).
    if (diveState) {
      if (!diveDrawn) renderDive(diveState)
      diveDrawn = false
      return
    }

    if (!engaged) {
      if (!mmRoot.hidden) { mmRoot.hidden = true; gpu.release(mmGpu); mmOv.width = 0; mmOv.height = 0 }
      if (!entrySession) {
        if (isOpen) toggle(false)
        return
      }
    }
    if (engaged && mmRoot.hidden && map) mmRoot.hidden = false
    if (!map || opts.paused()) return

    const p = opts.player()
    const night = clamp(1 - opts.day(), 0, 1)

    // 1. Live GPS route tracking, progress trimming, off-route auto-reroute, and arrival detection!
    if (engaged && destination && route) {
      progress = trackRoute(map, route, p.x, p.z)
      if (progress.arrived) {
        const reached = destination.name
        clearDestination()
        opts.hud.notice(`Arrived at ${reached}`, 3500)
      } else if (progress.offRouteM > 48 && performance.now() - lastRerouteAt > 1400) {
        lastRerouteAt = performance.now()
        route = computeRoute(map, p.x, p.z, destination.x, destination.z, destination.name)
        progress = trackRoute(map, route, p.x, p.z)
        gpu.setRoute(route)
      }
      if (isOpen) syncRouteCard()
    }

    // 2. Fullscreen Map Mode (interactive pan/zoom/tilt + crisp 4x MSAA full-viewport render)
    if (isOpen) {
      // Smooth keyboard WASD / Arrow panning
      const moveFwd = (wmHeld.has('KeyW') || wmHeld.has('ArrowUp') ? 1 : 0) - (wmHeld.has('KeyS') || wmHeld.has('ArrowDown') ? 1 : 0)
      const moveSide = (wmHeld.has('KeyD') || wmHeld.has('ArrowRight') ? 1 : 0) - (wmHeld.has('KeyA') || wmHeld.has('ArrowLeft') ? 1 : 0)
      if (moveFwd || moveSide) {
        const panSpeed = wmCam.tSpan * 1.35 * dt
        const fx = Math.sin(wmCam.yaw), fz = -Math.cos(wmCam.yaw)
        const rx = Math.cos(wmCam.yaw), rz = Math.sin(wmCam.yaw)
        wmCam.tCx += (fx * moveFwd + rx * moveSide) * panSpeed
        wmCam.tCz += (fz * moveFwd + rz * moveSide) * panSpeed
        wmCam.vx = 0; wmCam.vz = 0
        clampTargetToMap()
      }
      // Inertial glide after mouse/touch drag release
      if (!drag && !pinch && (Math.abs(wmCam.vx) > 2 || Math.abs(wmCam.vz) > 2)) {
        wmCam.tCx += wmCam.vx * dt
        wmCam.tCz += wmCam.vz * dt
        const decay = Math.exp(-dt * 7.5)
        wmCam.vx *= decay; wmCam.vz *= decay
        clampTargetToMap()
      }
      const ease = 1 - Math.exp(-dt * 14)
      wmCam.cx += (wmCam.tCx - wmCam.cx) * ease
      wmCam.cz += (wmCam.tCz - wmCam.cz) * ease
      wmCam.span += (wmCam.tSpan - wmCam.span) * ease
      wmCam.yaw = wrapAngle(wmCam.yaw + wrapAngle(wmCam.tYaw - wmCam.yaw) * ease)
      wmCam.tilt += (wmCam.tTilt - wmCam.tilt) * ease
      wmCam.extrude += (wmCam.tExtrude - wmCam.extrude) * ease

      // 4x MSAA at up to 1.5x DPR stays razor-sharp while cutting GPU fillrate nearly in half on HiDPI displays.
      const gpuDpr = Math.min(1.5, devicePixelRatio || 1)
      const w = Math.round(wmStage.clientWidth * gpuDpr)
      const h = Math.round(wmStage.clientHeight * gpuDpr)
      const cam = buildWmCamera()
      const t0 = performance.now()
      const vp = gpu.render(wmGpu, w, h, cam)
      renderMs = renderMs * 0.85 + (performance.now() - t0) * 0.15
      if (vp) {
        lastWmVP = vp
        drawFullscreenOverlay(vp, cam, p.yaw)
      }
      return
    }

    // 3. GTA VI 3D Minimap HUD Mode (only renders when actually visible!)
    if (mmRoot.clientWidth < 10 || mmRoot.clientHeight < 10) return
    const cs = getComputedStyle(mmRoot)
    if (cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.opacity) < 0.02) return

    if (!mmYawInit) { mmYaw = p.yaw; mmYawInit = true }
    else mmYaw = wrapAngle(mmYaw + wrapAngle(p.yaw - mmYaw) * (1 - Math.exp(-dt * (p.driving ? 8.5 : 10))))

    // Speed-reactive 3D driving camera: smoothly zooms out 1.0x -> 1.85x from 0..180 km/h and shifts look-ahead forward
    // along the car's heading so intersections, turns, and GPS routes read 2-3 SF blocks ahead. Zero work when on foot.
    let targetSpan = BASE_SPAN
    let targetAhead = 0
    let targetTilt = 0.88
    let targetSpeedGlow = 0
    let targetDriftGlow = 0
    if (p.driving) {
      const kmh = p.speed * 3.6
      const driveT = clamp(kmh / 180, 0, 1)
      const speedEase = driveT * (0.45 + 0.55 * driveT)
      targetSpan = BASE_SPAN * (1 + (MAX_DRIVE_ZOOM - 1) * speedEase)
      targetAhead = speedEase * 52
      targetTilt = 0.88 - speedEase * 0.08
      targetSpeedGlow = clamp((kmh - 45) / 135, 0, 1)
      targetDriftGlow = p.drifting ? clamp(0.65 + (p.slip ?? 0) * 0.35, 0, 1) : clamp(((p.slip ?? 0) - 0.25) * 1.4, 0, 0.55)
    } else if (p.flying) {
      targetSpan = clamp(BASE_SPAN + p.speed * 2.2 + 32, BASE_SPAN, BASE_SPAN * MAX_DRIVE_ZOOM)
    }

    // Asymmetric zoom damping: brisk zoom-out under acceleration, calmer zoom-in on braking so corner taps don't jerk the radar.
    const spanRate = targetSpan > mmSpan ? 4.2 : 2.6
    mmSpan += (targetSpan - mmSpan) * (1 - Math.exp(-dt * spanRate))
    if (p.driving || mmLookAhead > 0.05) {
      mmLookAhead += (targetAhead - mmLookAhead) * (1 - Math.exp(-dt * 3.6))
      if (!p.driving && mmLookAhead < 0.05) mmLookAhead = 0
    }
    if (p.driving || Math.abs(mmTilt - 0.88) > 0.001) {
      mmTilt += (targetTilt - mmTilt) * (1 - Math.exp(-dt * 3.2))
      if (!p.driving && Math.abs(mmTilt - 0.88) < 0.001) mmTilt = 0.88
    }
    if (p.driving || mmSpeedNorm > 0.005 || mmDriftNorm > 0.005) {
      mmSpeedNorm += (targetSpeedGlow - mmSpeedNorm) * (1 - Math.exp(-dt * 5.0))
      mmDriftNorm += (targetDriftGlow - mmDriftNorm) * (1 - Math.exp(-dt * (targetDriftGlow > mmDriftNorm ? 11.0 : 4.5)))
      if (!p.driving && mmSpeedNorm < 0.005) mmSpeedNorm = 0
      if (!p.driving && mmDriftNorm < 0.005) mmDriftNorm = 0
    }

    const fwdX = Math.sin(mmYaw), fwdZ = -Math.cos(mmYaw)
    const dpr = Math.min(2, devicePixelRatio || 1)
    const w = Math.round(mmRoot.clientWidth * dpr)
    const h = Math.round(mmRoot.clientHeight * dpr)
    const mmCam: MapCamera = {
      cx: p.x + fwdX * mmLookAhead,
      cz: p.z + fwdZ * mmLookAhead,
      yaw: mmYaw,
      tilt: mmTilt,
      span: mmSpan,
      style: 0,
      extrude: 0.92,
      targetOffsetY: -0.24,
      playerX: p.x,
      playerZ: p.z,
      routeAlong: progress?.alongM ?? 0,
      routeFadeLen: 18,
      time,
      destActive: !!destination,
      destX: destination?.x ?? 0,
      destZ: destination?.z ?? 0,
      night,
    }
    const t0 = performance.now()
    const vp = gpu.render(mmGpu, w, h, mmCam)
    renderMs = renderMs * 0.85 + (performance.now() - t0) * 0.15
    if (vp) drawMinimapOverlay(vp, mmCam, p.yaw, mmSpeedNorm, mmDriftNorm)
  }

  const setDive = (state: MapDiveState | null) => {
    if (hideTimer) { clearTimeout(hideTimer); hideTimer = null }
    diveState = state
    if (state) {
      if (isOpen) {
        isOpen = false
        wmHeld.clear()
        wmRoot.classList.remove('open')
        html.classList.remove('map-open')
        leaveInput?.(); leaveInput = null
      }
      wmRoot.hidden = false
      wmRoot.classList.add('dive')
      html.classList.add('map-dive')
      wmRoot.style.opacity = String(clamp(state.opacity, 0, 1))
      renderDive(state)
      diveDrawn = true
    } else {
      diveDrawn = false
      wmRoot.classList.remove('dive')
      html.classList.remove('map-dive')
      wmRoot.style.removeProperty('opacity')
      if (!isOpen) { wmRoot.hidden = true; releaseWm() }
    }
  }

  return {
    get open() { return isOpen },
    get picking() { return isOpen && !!entrySession },
    get opaque() {
      if (diveState) return false
      return isOpen && !!map && performance.now() - openedAt > 220
    },
    get ready() { return !!map },
    get data() { return map },
    get mode() { return viewMode },
    get destination() { return destination ? { ...destination } : null },
    get route() { return route },
    get progress() { return progress },
    get places() { return map?.places ?? [] },
    get stats() {
      return {
        nodes: map?.nNodes ?? 0,
        edges: map?.nEdges ?? 0,
        buildings: map?.nBldgs ?? 0,
        places: map?.places.length ?? 0,
        renderMs: Math.round(renderMs * 100) / 100,
        span: Math.round(mmSpan * 10) / 10,
        zoom: Math.round((mmSpan / BASE_SPAN) * 100) / 100,
        lookAhead: Math.round(mmLookAhead * 10) / 10,
      }
    },
    camera(): MapCameraSnapshot {
      return { cx: wmCam.cx, cz: wmCam.cz, yaw: wmCam.yaw, tilt: wmCam.tilt, span: wmCam.span, extrude: wmCam.extrude }
    },
    setDive,
    openForEntry,
    closeEntry,
    toggle,
    setMode,
    setDestination,
    clearDestination,
    centerOnPlayer,
    setMapData(next: MapData) {
      map = next
      streetLabels = buildStreetLabels(next)
      wmCity.textContent = next.title.toUpperCase()
      gpu.setMap(next)
      wmLoading.hidden = true
      rebuildChips()
      if (entrySession && entryTarget) {
        snapEntryCamera(entryTarget)
        pinDropAt = time
      }
      if (opts.engaged()) mmRoot.hidden = false
      // If a destination was active before a map refresh, re-route on the new graph.
      if (destination) setDestination(destination.x, destination.z, destination.name)
    },
    frame,
  }
}
