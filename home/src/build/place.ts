// Placing things (#48): one placement system for build mode and #42's furnishing.
//
// A new thing, or a placed one being moved, shows at a proposed pose with a stitched
// outline under it. Drag it (mouse, or one finger) and it follows within its mount:
// the floor, a surface, a wall or the ceiling (src/build/mount.ts has the rules). It
// snaps to 5 cm and, near a spot it cannot take, to the nearest one it can; where
// nothing fits it turns red and says why. Q/E turn it 15° (Shift 45°, Alt 1°); the
// round handle beside it turns it freely in 15° steps (Alt: no steps), and two
// fingers twist it. Alt while dragging is free: no grid and no pull. Enter or the
// tag's "Place it" confirms; Escape or "Not now" cancels.
//
// Confirming is one house plan version (placeItem or moveItem) through house().
// A thing still being made can be confirmed: the session waits for swap() to name
// its library item, then keeps that item on the host (so drafts pruning leaves it)
// and commits. Until the store has accepted the version the thing still looks
// unplaced (the ghost stays and says it could not be placed); nothing is retried.
// When someone else changed the house first, the history has already taken their
// version; the ghost stays and one line asks the person to place it again.
import * as THREE from 'three/webgpu'
import type { Stage } from '../kernel'
import { ReadOnly, StaleHead, type PlanHistory } from './history'
import { roomAt, type Anchor, type Furniture, type ItemRef, type Mount, type Plan } from './plan'
import {
  CORD, KINDS, SURFACE_MIN, cord, alongOf, ceilingOf, faceOf, fit, floorOf, obstacles, poseOf, roomsOf, seat, setPose, supports, wallHeight,
  type Fit, type Obstacle, type Pose, type Size,
} from './mount'
import { canvas, toTexture } from '../paint'

export type { Mount } from './plan'
export type { Pose } from './mount'

export interface PlaceItem {
  object: THREE.Object3D
  size: [w: number, h: number, d: number]
  mount: Mount
  label?: string
  /** A library item needs the person whose library holds it. */
  item?: { library?: string; kind?: string; person?: string }
}

export type Done = { status: 'confirmed'; pose: Pose; furnitureId: string } | { status: 'cancelled' }

export interface Placing {
  /** Resolves when the person confirms or cancels. */
  readonly done: Promise<Done>
  /**
   * Swap the ghost for the made prop in place, keeping the current pose and the
   * session. `item` names what it is once it exists (the library item the maker saved).
   */
  swap(object: THREE.Object3D, size?: [number, number, number], item?: PlaceItem['item']): void
  /** End from outside (e.g. making the prop failed): resolves done as cancelled and removes the ghost. */
  cancel(): void
}

export interface Placement {
  begin(item: PlaceItem, pose?: Pose): Placing
  move(furnitureId: string): Placing
  readonly active: Placing | null
}

/** The plugin's drawn furniture, which a session borrows from and hands back to. */
export interface Shelf {
  /** Take a placed thing's holder out of the plan's control while it moves. */
  hold(id: string): { holder: THREE.Group; size: Size; label: string } | null
  /** Give it back; the plan poses it again. */
  release(id: string): void
  /** Show this holder as furniture `id` from now on (before the commit that adds it). */
  adopt(id: string, holder: THREE.Group, size: Size, label: string): void
  /** Undo adopt after a failed commit; the holder stays with the session. */
  forget(id: string): void
}

export interface PlaceDeps {
  stage: Stage
  /** Where ghosts and outlines are drawn. */
  group: THREE.Group
  history: () => Promise<PlanHistory>
  /** The plan as drawn now. */
  plan: () => Plan
  shelf: Shelf
  /** Mark a library item kept so the host does not prune it; true when it is. */
  keep: (person: string, item: string) => Promise<boolean>
}

const HAND = '"Bradley Hand", "Segoe Print", "Comic Sans MS", cursive'
const GRID = 0.05
const PULL = 0.3
const STEP = Math.PI / 12
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)')

const snap = (v: number, s: number) => Math.round(v / s) * s
const round = (v: number) => Math.round(v * 1e4) / 1e4
const newId = () => `f.${Array.from(crypto.getRandomValues(new Uint8Array(5)), (b) => b.toString(16).padStart(2, '0')).join('')}`
const labelOf = (item: PlaceItem) => (item.label ?? (item.item?.kind && KINDS[item.item.kind]?.label) ?? 'thing').replace(/[\p{Cc}\p{Cf}]/gu, ' ').trim().slice(0, 60) || 'thing'
const refOf = (item: PlaceItem['item']): ItemRef | null =>
  item?.library && item.person ? { library: item.library, person: item.person } : item?.kind ? { kind: item.kind } : null

interface Session {
  placing: Placing
  item: PlaceItem
  label: string
  mount: Mount
  holder: THREE.Group
  object: THREE.Object3D
  size: Size
  at: Anchor
  fit: Fit
  moving: string | null
  ref: ItemRef | null
  waiting: ((ref: ItemRef | null) => void) | null
  state: 'placing' | 'confirming' | 'done'
  looks: Map<THREE.Mesh, { original: THREE.Material | THREE.Material[]; ok: THREE.Material[]; bad: THREE.Material[] }>
  obstacles: Obstacle[]
  supports: THREE.Mesh[]
  lift: number
  lifted: number
  message: string
  resolve: (d: Done) => void
  dom: { tag: HTMLDivElement; hint: HTMLSpanElement; place: HTMLButtonElement; turn: HTMLButtonElement }
}

export function placement(deps: PlaceDeps): Placement & {
  frame(dt: number): void
  dispose(): void
  /** For checks: the session as data and where its parts are on screen. */
  state(): unknown
  /** For checks: a world point on screen, in CSS px. */
  project(x: number, y: number, z: number): [number, number]
} {
  const { stage, group } = deps
  const { scene, camera, renderer } = stage
  const raycaster = new THREE.Raycaster()
  const down = new THREE.Raycaster()
  const ndc = new THREE.Vector2()
  let session: Session | null = null

  // ── Shared drawing pieces: made once, shown while a session runs ──────────
  const [padCanvas, pg] = canvas(256, 256)
  pg.fillStyle = 'rgba(255, 255, 255, 0.4)'
  pg.beginPath()
  pg.roundRect(14, 14, 228, 228, 36)
  pg.fill()
  pg.setLineDash([16, 12])
  pg.lineWidth = 10
  pg.strokeStyle = 'rgba(255, 255, 255, 0.95)'
  pg.beginPath()
  pg.roundRect(18, 18, 220, 220, 32)
  pg.stroke()
  const padTex = toTexture(padCanvas)
  const padMat = new THREE.MeshBasicMaterial({ map: padTex, color: '#fff1d6', transparent: true, depthWrite: false, fog: false, polygonOffset: true, polygonOffsetFactor: -4 })
  const padGeo = new THREE.PlaneGeometry(1, 1)
  const pad = new THREE.Mesh(padGeo, padMat)
  pad.name = 'placement outline'
  pad.renderOrder = 2
  const [glowCanvas, gg] = canvas(128, 128)
  const glow = gg.createRadialGradient(64, 64, 0, 64, 64, 64)
  glow.addColorStop(0, 'rgba(255, 244, 222, 0.75)')
  glow.addColorStop(0.18, 'rgba(255, 236, 205, 0.5)')
  glow.addColorStop(0.2, 'rgba(160, 120, 90, 0.55)')
  glow.addColorStop(0.24, 'rgba(255, 236, 205, 0.32)')
  glow.addColorStop(1, 'rgba(255, 232, 200, 0)')
  gg.fillStyle = glow
  gg.fillRect(0, 0, 128, 128)
  const glowTex = toTexture(glowCanvas)
  const ceilingMat = new THREE.MeshBasicMaterial({ map: glowTex, transparent: true, depthWrite: false, fog: false, side: THREE.DoubleSide })
  const ceiling = new THREE.Mesh(padGeo, ceilingMat)
  ceiling.name = 'placement ceiling'
  ceiling.rotation.x = -Math.PI / 2
  ceiling.scale.set(1.6, 1.6, 1)
  ceiling.renderOrder = 2
  const OK = new THREE.Color('#fff1d6'), BAD = new THREE.Color('#e0644f')
  const RED = new THREE.Color('#d9574a')

  const style = document.createElement('style')
  style.textContent = css()
  document.head.append(style)

  // ── Pointer to world ───────────────────────────────────────────────────────
  const aim = (x: number, y: number) => {
    const rect = renderer.domElement.getBoundingClientRect()
    ndc.set(((x - rect.left) / rect.width) * 2 - 1, -((y - rect.top) / rect.height) * 2 + 1)
    raycaster.setFromCamera(ndc, camera)
    return raycaster
  }
  const project = (x: number, y: number, z: number): [number, number] => {
    const v = new THREE.Vector3(x, y, z).project(camera)
    const rect = renderer.domElement.getBoundingClientRect()
    return [rect.left + ((v.x + 1) / 2) * rect.width, rect.top + ((1 - v.y) / 2) * rect.height]
  }
  const onPlane = (x: number, y: number, h: number) => aim(x, y).ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -h), new THREE.Vector3())
  const upward = (hit: THREE.Intersection) => {
    if (!hit.face) return 0
    return hit.face.normal.clone().transformDirection(hit.object.matrixWorld).y
  }
  /** The placed thing whose top the anchor stands on, if the top is one (plugins/place.ts tags each holder with its id). */
  const supportUnder = (s: Session, at: Extract<Anchor, { mount: 'surface' }>): string | undefined => {
    down.set(new THREE.Vector3(at.x, at.y + 0.08, at.z), new THREE.Vector3(0, -1, 0))
    down.far = 0.2
    const hit = down.intersectObjects(s.supports, false).find((h) => upward(h) > 0.7)
    for (let o: THREE.Object3D | null = hit?.object ?? null; o; o = o.parent) {
      const id = o.userData.furniture
      if (typeof id === 'string' && id !== s.moving && deps.plan().furniture.some((f) => f.id === id)) return id
    }
    return undefined
  }
  /** The top under (x, z), looking down from just above y. */
  const supportAt = (s: Session) => (x: number, y: number, z: number) => {
    down.set(new THREE.Vector3(x, y + 0.08, z), new THREE.Vector3(0, -1, 0))
    down.far = 0.2
    const hit = down.intersectObjects(s.supports, false)[0]
    return hit && upward(hit) > 0.7 ? hit.point.y : null
  }
  const wallMeshes = () => {
    const out: THREE.Object3D[] = []
    scene.getObjectByName('build')?.traverse((o) => {
      if ((o as THREE.Mesh).isMesh && o.userData.wall && !o.userData.cutaway) out.push(o)
    })
    return out
  }
  /** The wall face under a screen point, and where on it. Cut-away walls are not on the camera's layer, so rays pass them. */
  const wallAt = (x: number, y: number) => {
    const hit = aim(x, y).intersectObjects(wallMeshes(), false).find((h) => {
      for (let p: THREE.Object3D | null = h.object; p; p = p.parent) if (!p.visible) return false
      return true
    })
    if (!hit) return null
    const plan = deps.plan()
    const wall = plan.walls.find((w) => w.id === hit.object.userData.wall)
    if (!wall) return null
    const along = alongOf(plan, wall, hit.point.x, hit.point.z)
    const eye = camera.getWorldPosition(new THREE.Vector3())
    const room = roomsOf(plan, wall.id).find((r) => {
      const f = faceOf(plan, wall.id, r.id, along)!
      return (eye.x - f.point[0]) * f.inward[0] + (eye.z - f.point[1]) * f.inward[1] > 0
    })
    return room ? { wallId: wall.id, roomId: room.id, along, height: hit.point.y } : null
  }
  /** Over a door or window hole there is no wall to hit: stay on the face the thing is on. */
  const alongFace = (at: Extract<Anchor, { mount: 'wall' }>, x: number, y: number) => {
    const plan = deps.plan()
    const f = faceOf(plan, at.wallId, at.roomId, at.along)
    if (!f) return null
    const normal = new THREE.Vector3(f.inward[0], 0, f.inward[1])
    const hit = aim(x, y).ray.intersectPlane(new THREE.Plane().setFromNormalAndCoplanarPoint(normal, new THREE.Vector3(f.point[0], 0, f.point[1])), new THREE.Vector3())
    return hit ? { wallId: at.wallId, roomId: at.roomId, along: alongOf(plan, f.wall, hit.x, hit.z), height: hit.y } : null
  }
  const surfaceAt = (s: Session, x: number, y: number) => {
    const hit = aim(x, y).intersectObjects(s.supports, false)[0]
    return hit && upward(hit) > 0.7 && hit.point.y >= SURFACE_MIN ? hit.point : null
  }

  // ── Fit and the nearest place that fits ───────────────────────────────────
  const fitAt = (s: Session, at: Anchor) => fit({ plan: deps.plan(), size: s.size, obstacles: s.obstacles, supportAt: supportAt(s) }, at)
  const moved = (at: Anchor, du: number, dv: number): Anchor =>
    at.mount === 'wall' ? { ...at, along: round(at.along + du), height: round(at.height + dv) } : { ...at, x: round(at.x + du), z: round(at.z + dv) }
  /** The fitting anchor nearest `at` within `reach` metres, nearest first, or null. */
  const nearestFit = (s: Session, at: Anchor, reach: number, step = GRID): Anchor | null => {
    if (fitAt(s, at).ok) return at
    for (let r = step; r <= reach + 1e-9; r += step) {
      const n = Math.max(8, Math.round((2 * Math.PI * r) / step))
      let best: Anchor | null = null
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2
        const c = moved(at, snap(Math.cos(a) * r, 1e-3), snap(Math.sin(a) * r, 1e-3))
        if (fitAt(s, c).ok) {
          best = c
          break
        }
      }
      if (best) return best
    }
    return null
  }

  // ── Looks: the thing's own materials, see-through, and a red one where it can't go ──
  const ghost = (s: Session) => {
    s.holder.traverse((o) => {
      const m = o as THREE.Mesh
      if (!m.isMesh || s.looks.has(m)) return
      const list = Array.isArray(m.material) ? m.material : [m.material]
      const ok = list.map((mat) => {
        const c = mat.clone()
        c.transparent = true
        c.opacity = Math.min(mat.opacity, 0.86)
        c.depthWrite = true
        return c
      })
      const bad = list.map((mat) => {
        const c = mat.clone() as THREE.MeshStandardMaterial
        c.transparent = true
        c.opacity = Math.min(mat.opacity, 0.8)
        if (c.color) c.color = c.color.clone().lerp(RED, 0.6)
        if (c.emissive) {
          c.emissive = RED.clone()
          c.emissiveIntensity = 0.35
        }
        if (c.map && c.color) c.color.lerp(RED, 0.2)
        // Where it can't go it is often inside something: show it through.
        c.depthTest = false
        c.depthWrite = false
        return c
      })
      s.looks.set(m, { original: m.material, ok, bad })
    })
    paint(s)
  }
  const unghost = (s: Session) => {
    for (const [m, look] of s.looks) {
      m.material = look.original
      m.renderOrder = 0
      for (const c of [...look.ok, ...look.bad]) c.dispose()
    }
    s.looks.clear()
  }
  const paint = (s: Session) => {
    const good = s.fit.ok
    for (const [m, look] of s.looks) {
      const want = good ? look.ok : look.bad
      m.material = Array.isArray(look.original) ? want : want[0]
      m.renderOrder = good ? 0 : 3
    }
    padMat.color.copy(good ? OK : BAD)
    s.dom.tag.classList.toggle('bad', !good)
    s.dom.place.setAttribute('aria-disabled', String(!good || s.state !== 'placing'))
    hint(s)
  }
  const hint = (s: Session) => {
    const coarse = matchMedia('(pointer: coarse)').matches
    const text = s.message || (s.state === 'confirming'
      ? s.ref ? 'Placing it…' : 'It will go here as soon as it’s made'
      : s.fit.ok ? coarse ? 'Drag to move · twist to turn' : 'Drag to move · Q E to turn' : s.fit.why ?? "It can't go there")
    if (s.dom.hint.textContent !== text) s.dom.hint.textContent = text
  }

  // ── The pose on stage ─────────────────────────────────────────────────────
  const pose = (s: Session) => poseOf(deps.plan(), s.at, s.size)
  const place = (s: Session, at: Anchor) => {
    s.at = at
    s.fit = fitAt(s, at)
    s.message = ''
    paint(s)
    stagePose(s)
  }
  const stagePose = (s: Session) => {
    const p = pose(s)
    if (!p) return
    setPose(s.holder, p)
    const [w, h, d] = s.size
    if (s.mount === 'wall') {
      // Lifted off the wall toward the room while held.
      const f = faceOf(deps.plan(), s.at.mount === 'wall' ? s.at.wallId : '', s.at.mount === 'wall' ? s.at.roomId : '', s.at.mount === 'wall' ? s.at.along : 0)
      if (f) s.holder.position.add(new THREE.Vector3(f.inward[0], 0, f.inward[1]).multiplyScalar(s.lifted * 0.6))
      setPose(pad, { ...p, x: p.x + (f?.inward[0] ?? 0) * 0.002, z: p.z + (f?.inward[1] ?? 0) * 0.002 })
      pad.scale.set(w + 0.1, h + 0.1, 1)
    } else {
      const y = s.mount === 'ceiling' ? 0.006 : p.y + 0.004
      s.holder.position.y += s.mount === 'ceiling' ? -s.lifted * 0.5 : s.lifted
      pad.position.set(p.x, y, p.z)
      pad.rotation.set(0, p.yaw, 0, 'YXZ')
      pad.rotateX(-Math.PI / 2)
      pad.scale.set(w + 0.18, d + 0.18, 1)
      if (s.mount === 'ceiling') {
        const room = roomAt(deps.plan(), p.x, p.z)
        ceiling.position.set(p.x, (room ? ceilingOf(deps.plan(), room) : 3) - 0.01, p.z)
      }
    }
  }

  // ── Input ─────────────────────────────────────────────────────────────────
  type Drag = { id: number; grab: { du: number; dv: number; y: number }; alt: boolean }
  let drag: Drag | null = null
  let twist: { a: number; b: number; angle: number; yaw: number } | null = null
  let turning: { id: number; angle: number; yaw: number; moved: boolean } | null = null
  const touches = new Map<number, { x: number; y: number }>()
  const stop = (e: Event) => {
    e.stopImmediatePropagation()
    e.preventDefault()
  }
  const yawOf = (at: Anchor) => (at.mount === 'wall' ? at.spin : at.yaw)
  const withYaw = (at: Anchor, yaw: number): Anchor => (at.mount === 'wall' ? { ...at, spin: round(yaw) } : { ...at, yaw: round(yaw) })
  const turn = (s: Session, yaw: number) => place(s, withYaw(s.at, yaw))

  /** Where the anchor would be for a pointer at (x, y), keeping the grab offset. */
  const follow = (s: Session, x: number, y: number, d: Drag): Anchor | null => {
    const at = s.at
    if (at.mount === 'wall') {
      const w = wallAt(x, y) ?? alongFace(at, x, y)
      if (!w) return null
      return { ...at, wallId: w.wallId, roomId: w.roomId, along: w.along + d.grab.du, height: w.height + d.grab.dv }
    }
    if (at.mount === 'surface') {
      const p = surfaceAt(s, x, y)
      if (p) return { ...at, x: p.x + d.grab.du, z: p.z + d.grab.dv, y: round(p.y) }
      const q = onPlane(x, y, at.y)
      return q ? { ...at, x: q.x + d.grab.du, z: q.z + d.grab.dv } : null
    }
    const q = onPlane(x, y, d.grab.y)
    return q ? { ...at, x: q.x + d.grab.du, z: q.z + d.grab.dv } : null
  }
  /** Snap to the grid, then to the nearest place that fits; Alt does neither. */
  const settle = (s: Session, at: Anchor, alt: boolean): Anchor => {
    if (alt) return at
    let a: Anchor = at.mount === 'wall'
      ? { ...at, along: round(snap(at.along, GRID)), height: round(snap(at.height, GRID)) }
      : { ...at, x: round(snap(at.x, GRID)), z: round(snap(at.z, GRID)) }
    if (a.mount === 'wall') {
      // A gentle pull to the height such a thing usually hangs at.
      const usual = wallHeight(s.label, s.size[1])
      if (Math.abs(a.height - usual) < 0.12) a = { ...a, height: usual }
    }
    return nearestFit(s, a, PULL) ?? a
  }
  /** The grab offset for a pointer pressed at (x, y). */
  const grabAt = (s: Session, x: number, y: number): Drag['grab'] | null => {
    const at = s.at
    if (at.mount === 'wall') {
      const w = wallAt(x, y)
      return w ? { du: at.along - w.along, dv: at.height - w.height, y: 0 } : { du: 0, dv: 0, y: 0 }
    }
    if (at.mount === 'surface') {
      const p = surfaceAt(s, x, y) ?? onPlane(x, y, at.y)
      return p ? { du: at.x - p.x, dv: at.z - p.z, y: at.y } : null
    }
    const hit = aim(x, y).intersectObject(s.holder, true)[0]
    const gy = hit ? hit.point.y : pose(s)?.y ?? 0
    const q = onPlane(x, y, gy)
    return q ? { du: at.x - q.x, dv: at.z - q.z, y: gy } : null
  }
  const onItem = (s: Session, x: number, y: number, coarse: boolean) => {
    if (aim(x, y).intersectObjects([s.holder, pad], true).length) return true
    if (!coarse) return false
    // A finger is wide: anywhere within 36 px of the thing's middle counts.
    const b = new THREE.Box3().setFromObject(s.holder)
    const c = b.getCenter(new THREE.Vector3())
    const [sx, sy] = project(c.x, c.y, c.z)
    return Math.hypot(sx - x, sy - y) < 36
  }

  const onDown = (e: PointerEvent) => {
    const s = session
    if (!s || s.state !== 'placing') return
    if (e.pointerType === 'touch') touches.set(e.pointerId, { x: e.clientX, y: e.clientY })
    // A second finger while the first holds the thing: twist.
    if (e.pointerType === 'touch' && drag && touches.size === 2 && !twist) {
      stop(e)
      const [a, b] = [...touches.keys()]
      const [pa, pb] = [touches.get(a)!, touches.get(b)!]
      twist = { a, b, angle: Math.atan2(pb.y - pa.y, pb.x - pa.x), yaw: yawOf(s.at) }
      return
    }
    if (e.target !== renderer.domElement || (e.pointerType === 'mouse' && e.button !== 0)) return
    if (!onItem(s, e.clientX, e.clientY, e.pointerType === 'touch')) return
    stop(e)
    const grab = grabAt(s, e.clientX, e.clientY)
    if (!grab) return
    drag = { id: e.pointerId, grab, alt: e.altKey }
    s.lift = 1
    renderer.domElement.style.cursor = 'grabbing'
  }
  const onMove = (e: PointerEvent) => {
    const s = session
    if (!s) return
    if (touches.has(e.pointerId)) touches.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (turning && e.pointerId === turning.id) {
      stop(e)
      const c = centre(s)
      const angle = Math.atan2(e.clientY - c[1], e.clientX - c[0])
      const d = angle - turning.angle
      if (Math.abs(d) > 0.02) turning.moved = true
      const yaw = turning.yaw - d
      turn(s, e.altKey ? yaw : snap(yaw, STEP))
      return
    }
    if (twist && (e.pointerId === twist.a || e.pointerId === twist.b)) {
      stop(e)
      const pa = touches.get(twist.a), pb = touches.get(twist.b)
      if (!pa || !pb) return
      const angle = Math.atan2(pb.y - pa.y, pb.x - pa.x)
      turn(s, snap(twist.yaw - (angle - twist.angle), STEP))
      return
    }
    if (drag && e.pointerId === drag.id) {
      stop(e)
      if (s.state !== 'placing') return
      const at = follow(s, e.clientX, e.clientY, drag)
      if (at) place(s, settle(s, at, e.altKey))
      return
    }
    if (e.pointerType === 'mouse' && e.buttons === 0 && e.target === renderer.domElement) {
      const over = onItem(s, e.clientX, e.clientY, false)
      renderer.domElement.style.cursor = over ? 'grab' : ''
      // Over the thing it owns the pointer, so nothing behind it lights up.
      if (over) e.stopImmediatePropagation()
    }
  }
  const onUp = (e: PointerEvent) => {
    touches.delete(e.pointerId)
    const s = session
    if (turning && e.pointerId === turning.id) {
      stop(e)
      // A tap on the handle without turning steps 15°.
      if (s && !turning.moved) turn(s, snap(yawOf(s.at) - STEP, STEP))
      turning = null
      return
    }
    if (twist && (e.pointerId === twist.a || e.pointerId === twist.b)) {
      stop(e)
      twist = null
      if (drag && e.pointerId === drag.id) drag = null
      return
    }
    if (drag && e.pointerId === drag.id) {
      stop(e)
      drag = null
      if (s) s.lift = 0
      renderer.domElement.style.cursor = s ? 'grab' : ''
    }
  }
  const typing = () => {
    const a = document.activeElement as HTMLInputElement | HTMLTextAreaElement | HTMLElement | null
    if (a instanceof HTMLInputElement || a instanceof HTMLTextAreaElement) return a.value.length > 0
    return Boolean(a?.isContentEditable)
  }
  const onKey = (e: KeyboardEvent) => {
    const s = session
    if (!s || typing() || e.metaKey || e.ctrlKey) return
    if (e.key === 'Escape') {
      stop(e)
      return end(s, { status: 'cancelled' })
    }
    if (s.state !== 'placing') return
    if (e.key === 'Enter') {
      stop(e)
      return void confirm(s)
    }
    const dir = e.code === 'KeyQ' ? 1 : e.code === 'KeyE' ? -1 : 0
    if (!dir) return
    stop(e)
    const step = e.altKey ? Math.PI / 180 : e.shiftKey ? Math.PI / 4 : STEP
    turn(s, e.altKey ? yawOf(s.at) + dir * step : snap(yawOf(s.at) + dir * step, step))
  }
  const centre = (s: Session): [number, number] => {
    const c = new THREE.Box3().setFromObject(s.holder).getCenter(new THREE.Vector3())
    return project(c.x, c.y, c.z)
  }

  // ── The tag: what it is, a hint or why not, Place it and Not now; the turn handle ──
  const makeDom = (label: string): Session['dom'] => {
    const tag = document.createElement('div')
    tag.className = 'place-tag'
    tag.setAttribute('role', 'group')
    tag.setAttribute('aria-label', `Placing the ${label}`)
    const name = document.createElement('strong')
    name.textContent = label.charAt(0).toUpperCase() + label.slice(1)
    const hintEl = document.createElement('span')
    hintEl.className = 'hint'
    hintEl.setAttribute('aria-live', 'polite')
    const row = document.createElement('div')
    row.className = 'row'
    const button = (text: string, kind: string, act: () => void) => {
      const b = document.createElement('button')
      b.type = 'button'
      b.textContent = text
      b.dataset.place = kind
      b.addEventListener('click', (e) => {
        e.stopPropagation()
        act()
      })
      return b
    }
    const placeBtn = button('Place it', 'confirm', () => session && void confirm(session))
    row.append(button('Not now', 'cancel', () => session && end(session, { status: 'cancelled' })), placeBtn)
    tag.append(name, hintEl, row)
    const turnBtn = document.createElement('button')
    turnBtn.type = 'button'
    turnBtn.className = 'place-turn'
    turnBtn.dataset.place = 'turn'
    turnBtn.setAttribute('aria-label', `Turn the ${label}`)
    turnBtn.innerHTML = '<svg viewBox="0 0 40 40" aria-hidden="true"><path d="M29.5 14.5a11 11 0 1 0 1.6 9.2" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round"/><path d="M31.8 7.6l-.4 8.4-8.2-1.6" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/></svg>'
    turnBtn.addEventListener('pointerdown', (e) => {
      const s = session
      if (!s || s.state !== 'placing') return
      stop(e)
      try {
        turnBtn.setPointerCapture(e.pointerId)
      } catch {
        // Synthetic pointers (checks) cannot be captured; the window listener follows them anyway.
      }
      const c = centre(s)
      turning = { id: e.pointerId, angle: Math.atan2(e.clientY - c[1], e.clientX - c[0]), yaw: yawOf(s.at), moved: false }
    })
    turnBtn.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return
      stop(e)
      if (session) turn(session, snap(yawOf(session.at) - STEP, STEP))
    })
    document.body.append(tag, turnBtn)
    return { tag, hint: hintEl, place: placeBtn, turn: turnBtn }
  }

  const layoutDom = (s: Session) => {
    const b = new THREE.Box3().setFromObject(s.holder)
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity
    for (const x of [b.min.x, b.max.x]) for (const y of [b.min.y, b.max.y]) for (const z of [b.min.z, b.max.z]) {
      const [sx, sy] = project(x, y, z)
      x0 = Math.min(x0, sx); x1 = Math.max(x1, sx); y0 = Math.min(y0, sy); y1 = Math.max(y1, sy)
    }
    const vw = innerWidth, vh = innerHeight
    const tag = s.dom.tag
    const tw = tag.offsetWidth, th = tag.offsetHeight
    // Above the thing when there is room, else below it; always on screen.
    let ty = y0 - th - 18
    if (ty < 12) ty = Math.min(vh - th - 12, y1 + 18)
    const tx = Math.min(Math.max((x0 + x1) / 2 - tw / 2, 12), vw - tw - 12)
    tag.style.transform = `translate(${Math.round(tx)}px, ${Math.round(ty)}px) rotate(-1.2deg)`
    const hx = Math.min(Math.max(x1 + 14, 8), vw - 64), hy = Math.min(Math.max((y0 + y1) / 2 - 28, 8), vh - 64)
    s.dom.turn.style.transform = `translate(${Math.round(hx)}px, ${Math.round(hy)}px)`
  }

  // ── Sessions ──────────────────────────────────────────────────────────────
  let touchAction = ''
  const open = (item: PlaceItem, moving: string | null, holder: THREE.Group, object: THREE.Object3D, size: Size, at: Anchor | null): Placing => {
    if (session) end(session, { status: 'cancelled' })
    let resolve!: (d: Done) => void
    const done = new Promise<Done>((r) => (resolve = r))
    const label = labelOf(item)
    const s: Session = {
      placing: null as unknown as Placing, item, label, mount: item.mount, holder, object, size, moving,
      at: at ?? { mount: 'floor', x: 0, z: 0, yaw: 0 }, fit: { ok: false }, ref: refOf(item.item), waiting: null, state: 'placing',
      looks: new Map(), obstacles: [], supports: [], lift: 0, lifted: 0, message: '', resolve, dom: makeDom(label),
    }
    s.placing = {
      done,
      swap: (next, size, ref) => swap(s, next, size, ref),
      cancel: () => end(s, { status: 'cancelled' }),
    }
    session = s
    // A hung thing hangs from its cord while it is placed, as it will once placed.
    if (s.mount === 'ceiling' && !holder.getObjectByName('cord')) holder.add(cord(CORD))
    if (!holder.parent) group.add(holder)
    group.add(pad)
    if (s.mount === 'ceiling') group.add(ceiling)
    s.obstacles = obstacles(scene, [holder, group])
    s.supports = supports(scene, [holder, group])
    s.at = at ?? start(s)
    if (at) s.at = nearestFit(s, at, 0.5) ?? at
    ghost(s)
    place(s, s.at)
    touchAction = renderer.domElement.style.touchAction
    renderer.domElement.style.touchAction = 'none'
    layoutDom(s)
    return s.placing
  }

  /** A first place for a new thing: near the middle of the view, where it fits. */
  const start = (s: Session): Anchor => {
    const plan = deps.plan()
    const view = onPlane(innerWidth / 2, innerHeight / 2, 0) ?? new THREE.Vector3()
    const room = roomAt(plan, view.x, view.z) ?? plan.rooms[0]
    const ring = floorOf(plan, room)
    const cx = ring.reduce((a, p) => a + p[0], 0) / ring.length, cz = ring.reduce((a, p) => a + p[1], 0) / ring.length
    const [vx, vz] = roomAt(plan, view.x, view.z) ? [view.x, view.z] : [cx, cz]
    const x = round(snap(vx, GRID)), z = round(snap(vz, GRID))
    if (s.mount === 'floor') return nearestFit(s, { mount: 'floor', x, z, yaw: 0 }, 3, 0.1) ?? { mount: 'floor', x, z, yaw: 0 }
    if (s.mount === 'ceiling') return nearestFit(s, { mount: 'ceiling', x, z, yaw: 0 }, 3, 0.1) ?? { mount: 'ceiling', x, z, yaw: 0 }
    if (s.mount === 'surface') {
      // Tops in the room, nearest the middle of the view first.
      const tops: Anchor[] = []
      const xs = ring.map((p) => p[0]), zs = ring.map((p) => p[1])
      for (let px = Math.min(...xs); px <= Math.max(...xs); px += 0.2) for (let pz = Math.min(...zs); pz <= Math.max(...zs); pz += 0.2) {
        down.set(new THREE.Vector3(px, 2.4, pz), new THREE.Vector3(0, -1, 0))
        down.far = 2.4 - SURFACE_MIN
        const hit = down.intersectObjects(s.supports, false).find((h) => upward(h) > 0.7)
        if (hit) tops.push({ mount: 'surface', x: round(snap(px, GRID)), y: round(hit.point.y), z: round(snap(pz, GRID)), yaw: 0 })
      }
      tops.sort((a, b) => Math.hypot((a as { x: number }).x - vx, (a as { z: number }).z - vz) - Math.hypot((b as { x: number }).x - vx, (b as { z: number }).z - vz))
      for (const t of tops) {
        const f = nearestFit(s, t, 0.15)
        if (f) return f
      }
      return { mount: 'surface', x, y: SURFACE_MIN, z, yaw: 0 }
    }
    // Wall: the visible face nearest the middle of the view, where it fits.
    const faces = wallMeshes().map((m) => m.userData.wall as string).filter((id, i, all) => all.indexOf(id) === i)
    const candidates: Anchor[] = []
    for (const wallId of faces) for (const r of roomsOf(plan, wallId)) {
      const f0 = faceOf(plan, wallId, r.id, 0)!
      for (let t = 0.3; t < f0.length - 0.3; t += 0.1) {
        const f = faceOf(plan, wallId, r.id, t)!
        const [sx, sy] = project(f.point[0], 1.5, f.point[1])
        const w = wallAt(sx, sy)
        if (!w || w.wallId !== wallId || w.roomId !== r.id) continue
        candidates.push({ mount: 'wall', wallId, roomId: r.id, along: round(snap(t, GRID)), height: wallHeight(s.label, s.size[1]), spin: 0 })
      }
    }
    candidates.sort((a, b) => dist(a) - dist(b))
    function dist(a: Anchor) {
      const p = poseOf(plan, a)!
      return Math.hypot(p.x - vx, p.z - vz)
    }
    return candidates.find((c) => fitAt(s, c).ok) ?? candidates[0] ?? { mount: 'wall', wallId: plan.walls[0].id, roomId: room.id, along: 1, height: 1.5, spin: 0 }
  }

  const swap = (s: Session, next: THREE.Object3D, size?: Size, item?: PlaceItem['item']) => {
    if (s.state === 'done') return
    unghost(s)
    s.holder.remove(s.object)
    const seated = seat(next, s.mount)
    const inner = seated.holder.children[0]
    seated.holder.remove(inner)
    s.holder.add(inner)
    s.object = next
    s.size = size ?? seated.size
    if (item) {
      s.item = { ...s.item, item }
      s.ref = refOf(item) ?? s.ref
    }
    ghost(s)
    place(s, s.at)
    if (s.ref && s.waiting) s.waiting(s.ref)
  }

  const noteOf = (s: Session) => `${s.moving ? 'Moved' : 'Placed'} the ${s.label}`

  const confirm = async (s: Session) => {
    if (s.state !== 'placing') return
    s.fit = fitAt(s, s.at)
    if (!s.fit.ok) {
      paint(s)
      s.dom.tag.classList.remove('shake')
      void s.dom.tag.offsetWidth
      s.dom.tag.classList.add('shake')
      return
    }
    s.state = 'confirming'
    s.message = ''
    paint(s)
    let at = s.at
    // A thing still being made: wait for swap() to name it (or cancel()).
    const ref = s.ref ?? (await new Promise<ItemRef | null>((r) => (s.waiting = r)))
    s.waiting = null
    if (!ref || session !== s || s.state !== 'confirming') return
    paint(s)
    const id = s.moving ?? newId()
    let adopted = false
    try {
      if ('library' in ref && !s.moving && !(await deps.keep(ref.person, ref.library))) throw new Error('the library item could not be kept')
      if (session !== s || s.state !== 'confirming') return
      const history = await deps.history()
      const support = at.mount === 'surface' ? supportUnder(s, at) : undefined
      if (at.mount === 'surface') at = { mount: at.mount, x: at.x, y: at.y, z: at.z, yaw: at.yaw, ...(support ? { on: support } : {}) }
      const edit = s.moving
        ? { op: 'moveItem' as const, furnitureId: id, at }
        : { op: 'placeItem' as const, furniture: { id, item: ref, at } satisfies Furniture }
      const unchanged = s.moving && JSON.stringify(history.plan.furniture.find((f) => f.id === id)?.at) === JSON.stringify(at)
      if (!unchanged) {
        // Drawn as furniture from the moment the plan has it, so the commit's own change does not build it twice.
        unghost(s)
        if (!s.moving) {
          deps.shelf.adopt(id, s.holder, s.size, s.label)
          adopted = true
        }
        await history.commit([edit], noteOf(s))
      }
      finish(s, { status: 'confirmed', pose: poseOf(history.plan, at, s.size)!, furnitureId: id })
    } catch (error) {
      console.warn('placing did not save', error)
      if (adopted) deps.shelf.forget(id)
      if (session !== s) return
      // Still a ghost: nothing looks placed that the house does not have.
      s.state = 'placing'
      ghost(s)
      s.message = error instanceof StaleHead
        ? 'The house changed while you were placing this. Place it again?'
        : error instanceof ReadOnly ? error.reasons[0] : "Couldn't place it just now. Try again?"
      paint(s)
    }
  }

  /** A confirmed session: the thing is furniture now; the ghost's parts go. */
  const finish = (s: Session, d: Done) => close(s, d, true)
  const end = (s: Session, d: Done) => {
    if (s.state === 'done') return
    if (s.waiting) s.waiting(null)
    close(s, d, false)
  }
  const close = (s: Session, d: Done, confirmed: boolean) => {
    s.state = 'done'
    unghost(s)
    s.dom.tag.remove()
    s.dom.turn.remove()
    pad.removeFromParent()
    ceiling.removeFromParent()
    drag = null
    twist = null
    turning = null
    touches.clear()
    renderer.domElement.style.touchAction = touchAction
    renderer.domElement.style.cursor = ''
    if (s.moving) deps.shelf.release(s.moving)
    else if (!confirmed) {
      s.holder.removeFromParent()
      const c = s.holder.getObjectByName('cord')
      if (c) {
        c.removeFromParent()
        c.traverse((o) => {
          const m = o as THREE.Mesh
          if (m.isMesh) {
            m.geometry.dispose()
            ;(m.material as THREE.Material).dispose()
          }
        })
      }
    }
    if (session === s) session = null
    s.resolve(d)
  }

  addEventListener('pointerdown', onDown, true)
  addEventListener('pointermove', onMove, true)
  addEventListener('pointerup', onUp, true)
  addEventListener('pointercancel', onUp, true)
  addEventListener('keydown', onKey, true)

  return {
    begin(item, at) {
      const seated = seat(item.object, item.mount)
      const size: Size = item.size ?? seated.size
      return open(item, null, seated.holder, item.object, size, at ? anchorFor(item.mount, at, size) : null)
    },
    move(furnitureId) {
      const plan = deps.plan()
      const f = plan.furniture.find((k) => k.id === furnitureId)
      const held = f && deps.shelf.hold(furnitureId)
      if (!f || !held) throw new Error(`furniture ${furnitureId} is not in the house`)
      const object = held.holder.children.find((c) => c.name !== 'cord') ?? held.holder
      const item: PlaceItem = { object, size: held.size, mount: f.at.mount, label: held.label, item: 'library' in f.item ? { library: f.item.library, person: f.item.person } : { kind: f.item.kind } }
      return open(item, furnitureId, held.holder, object, held.size, f.at)
    },
    get active() {
      return session?.placing ?? null
    },
    frame(dt: number) {
      const s = session
      if (!s) return
      const k = reducedMotion.matches ? 1 : 1 - Math.exp(-dt * 14)
      // It floats a little while placed and a little more while held.
      const goal = s.lift ? 0.07 : 0.025
      if (Math.abs(s.lifted - goal) > 1e-4) {
        s.lifted += (goal - s.lifted) * k
        stagePose(s)
      }
      layoutDom(s)
    },
    dispose() {
      if (session) end(session, { status: 'cancelled' })
      removeEventListener('pointerdown', onDown, true)
      removeEventListener('pointermove', onMove, true)
      removeEventListener('pointerup', onUp, true)
      removeEventListener('pointercancel', onUp, true)
      removeEventListener('keydown', onKey, true)
      style.remove()
      padGeo.dispose()
      padMat.dispose()
      padTex.dispose()
      ceilingMat.dispose()
      glowTex.dispose()
    },
    state() {
      const s = session
      if (!s) return null
      const c = centre(s)
      const r = (el: Element) => {
        const b = el.getBoundingClientRect()
        return { x: b.x + b.width / 2, y: b.y + b.height / 2, w: b.width, h: b.height }
      }
      return {
        mount: s.mount, label: s.label, at: s.at, ok: s.fit.ok, why: s.fit.why ?? null, state: s.state, moving: s.moving, ref: s.ref, size: s.size,
        pose: pose(s), centre: c, hint: s.dom.hint.textContent, tint: s.fit.ok ? 'ok' : 'bad',
        turn: r(s.dom.turn), confirm: r(s.dom.place), cancel: r(s.dom.tag.querySelector('[data-place=cancel]')!), tag: r(s.dom.tag),
      }
    },
    project,
  }

  /** An anchor for a pose a caller passed. */
  function anchorFor(mount: Mount, p: Pose, size: Size): Anchor {
    const plan = deps.plan()
    if (mount === 'wall') {
      const wall = plan.walls.find((w) => w.id === p.wallId) ?? plan.walls[0]
      const along = alongOf(plan, wall, p.x, p.z)
      const roomId = p.roomId ?? roomsOf(plan, wall.id)[0]?.id ?? plan.rooms[0].id
      return { mount, wallId: wall.id, roomId, along: round(along), height: round(p.y), spin: p.spin ?? 0 }
    }
    if (mount === 'surface') return { mount, x: round(p.x), y: round(p.y), z: round(p.z), yaw: p.yaw }
    void size
    return { mount, x: round(p.x), z: round(p.z), yaw: p.yaw }
  }
}

function css() {
  return `
  .place-tag { position: fixed; left: 0; top: 0; z-index: 40; display: grid; gap: 6px; min-width: 220px; max-width: min(320px, calc(100vw - 24px));
    padding: 14px 18px 12px 20px; background: #fbf3e2; color: #4a3428; border-radius: 14px; font: 600 15px/1.25 ${HAND};
    box-shadow: 0 12px 26px rgba(70, 40, 20, 0.22), 0 2px 0 rgba(255, 255, 255, 0.7) inset; transform-origin: 50% 0; will-change: transform; }
  .place-tag::after { content: ''; position: absolute; inset: 5px; border: 1.5px dashed rgba(150, 110, 80, 0.35); border-radius: 10px; pointer-events: none; }
  .place-tag strong { font: 700 20px/1.1 ${HAND}; letter-spacing: 0.01em; }
  .place-tag .hint { font: italic 600 17px/1.3 ${HAND}; color: #5e4434; min-height: 1.3em; }
  .place-tag.bad .hint { color: #a63c2c; }
  .place-tag .row { display: flex; gap: 8px; justify-content: flex-end; margin-top: 2px; position: relative; z-index: 1; }
  .place-tag button { min-height: 44px; min-width: 44px; padding: 0 16px; border-radius: 22px; font: 700 16px ${HAND}; cursor: pointer;
    border: 1.5px solid rgba(122, 82, 54, 0.45); background: transparent; color: #5b3d2b; }
  .place-tag button[data-place=confirm] { background: #7a5236; border-color: #6a4630; color: #fff6e6; box-shadow: 0 2px 0 rgba(60, 34, 18, 0.35); }
  .place-tag button[data-place=confirm][aria-disabled=true] { background: #eadbc2; border: 1.5px dashed #a07a5c; color: #6a4630; box-shadow: none; cursor: not-allowed; }
  .place-tag button:focus-visible, .place-turn:focus-visible { outline: 3px solid #e7a35c; outline-offset: 2px; }
  .place-tag.shake { animation: place-shake 0.36s ease; }
  @keyframes place-shake { 20% { translate: -6px 0; } 40% { translate: 5px 0; } 60% { translate: -3px 0; } 80% { translate: 2px 0; } }
  .place-turn { position: fixed; left: 0; top: 0; z-index: 40; width: 56px; height: 56px; padding: 6px; border: 0; background: transparent; cursor: grab;
    touch-action: none; color: #6a4630; will-change: transform; }
  .place-turn svg { width: 44px; height: 44px; display: block; border-radius: 50%; background: #fbf3e2; padding: 6px; box-sizing: border-box;
    box-shadow: 0 6px 14px rgba(70, 40, 20, 0.25), 0 0 0 2px rgba(255, 255, 255, 0.8) inset; outline: 1.5px dashed rgba(150, 110, 80, 0.5); outline-offset: -5px; }
  .place-turn:active svg { cursor: grabbing; scale: 0.96; }
  @media (prefers-reduced-motion: reduce) { .place-tag.shake { animation: none; } }
  `
}
