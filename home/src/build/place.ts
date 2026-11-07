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
import { CHALK, CHALK_RED, HAND, paintDrop, paintNoGo, paintRing, paintShadow, rimMaterial, rimOf, tagCss } from './sketch'

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
  looks: Map<THREE.Mesh, { original: THREE.Material | THREE.Material[]; ok: THREE.Material[]; bad: THREE.Material[]; rim: THREE.Mesh | null; xray: THREE.Mesh | null }>
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

  // ── Shared drawing pieces (src/build/sketch.ts): made once, shown while a session runs ──
  const plane = new THREE.PlaneGeometry(1, 1)
  const decal = (name: string, map: THREE.Texture, order: number, color = '#ffffff') => {
    const m = new THREE.Mesh(plane, new THREE.MeshBasicMaterial({ map, color, transparent: true, depthWrite: false, fog: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }))
    m.name = name
    m.renderOrder = order
    m.raycast = () => {}
    return m
  }
  /** A soft contact shadow under (or behind) the held thing. */
  const shadow = decal('placement shadow', paintShadow(), 1)
  /** Where it can't go: a red wash on its footprint, seen through whatever it is inside. */
  const noGo = decal('placement no-go', paintNoGo(), 5)
  ;(noGo.material as THREE.Material).depthTest = false
  /** The turn ring around the footprint, with the handle on it. */
  const ring = decal('placement ring', paintRing(), 2, CHALK)
  /** Under a hung thing: its spot on the floor. */
  const drop = decal('placement drop', paintDrop(), 1, CHALK)
  const decals = [shadow, noGo, ring, drop]
  const xrayMat = new THREE.MeshBasicMaterial({ color: CHALK, transparent: true, opacity: 0.3, depthWrite: false, depthFunc: THREE.GreaterDepth, fog: false })
  const ringMat = ring.material as THREE.MeshBasicMaterial
  const OK = new THREE.Color(CHALK), BAD = new THREE.Color(CHALK_RED)
  /** The phone view eases sideways and up so the thing sits above the docked tag; held while dragging. */
  const pan = { right: 0, up: 0, goal: { right: 0, up: 0 }, fresh: false }

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

  // ── Looks: the thing's own materials, see-through, with a chalk rim; red rim and footprint where it can't go ──
  const RIM = 0.012
  const ghost = (s: Session) => {
    const meshes: THREE.Mesh[] = []
    s.holder.traverse((o) => {
      const m = o as THREE.Mesh
      if (m.isMesh && !s.looks.has(m) && m.name !== 'placement rim' && m.name !== 'placement xray') meshes.push(m)
    })
    s.holder.updateMatrixWorld(true)
    for (const m of meshes) {
      const list = Array.isArray(m.material) ? m.material : [m.material]
      const ok = list.map((mat) => {
        const c = mat.clone()
        c.transparent = true
        c.opacity = Math.min(mat.opacity, 0.58)
        c.depthWrite = true
        return c
      })
      const bad = list.map((mat) => {
        const c = mat.clone()
        c.transparent = true
        c.opacity = Math.min(mat.opacity, 0.5)
        // Where it can't go it is often inside something: show it through, and keep its depth so the rim stays an edge.
        c.depthTest = false
        c.depthWrite = true
        return c
      })
      let rim: THREE.Mesh | null = null
      // Behind a chair or the table it still shows, faintly: drawn only where the house stands in front of it.
      const xray = new THREE.Mesh(m.geometry, xrayMat)
      xray.name = 'placement xray'
      xray.renderOrder = 1
      xray.raycast = () => {}
      m.add(xray)
      let cordPart = false
      for (let p: THREE.Object3D | null = m; p && p !== s.holder; p = p.parent) if (p.name === 'cord') cordPart = true
      if (!cordPart && !(m as THREE.InstancedMesh).isInstancedMesh && m.geometry?.attributes.position) {
        const scale = m.getWorldScale(new THREE.Vector3())
        rim = rimOf(m, RIM, rimMaterial(CHALK, 0.85, RIM / Math.max(1e-3, (scale.x + scale.y + scale.z) / 3)))
        m.add(rim)
      }
      s.looks.set(m, { original: m.material, ok, bad, rim, xray })
    }
    paint(s)
  }
  const unghost = (s: Session) => {
    for (const [m, look] of s.looks) {
      m.material = look.original
      m.renderOrder = 0
      for (const c of [...look.ok, ...look.bad]) c.dispose()
      look.xray?.removeFromParent()
      if (look.rim) {
        look.rim.removeFromParent()
        look.rim.geometry.dispose()
        ;(look.rim.material as THREE.Material).dispose()
      }
    }
    s.looks.clear()
  }
  const paint = (s: Session) => {
    const good = s.fit.ok
    for (const [m, look] of s.looks) {
      const want = good ? look.ok : look.bad
      m.material = Array.isArray(look.original) ? want : want[0]
      m.renderOrder = good ? 2 : 3
      if (look.xray) look.xray.visible = good
      if (look.rim) {
        const r = look.rim.material as THREE.MeshBasicNodeMaterial
        r.color.copy(good ? OK : BAD)
        r.opacity = good ? 0.8 : 0.95
      }
    }
    ringMat.color.copy(good ? OK : BAD)
    ringMat.opacity = good ? 0.85 : 0.7
    noGo.visible = !good
    shadow.visible = good && s.mount !== 'ceiling'
    s.dom.tag.classList.toggle('bad', !good)
    s.dom.turn.classList.toggle('bad', !good)
    s.dom.place.setAttribute('aria-disabled', String(!good || s.state !== 'placing'))
    hint(s)
  }
  const hint = (s: Session) => {
    const coarse = matchMedia('(pointer: coarse)').matches
    const text = s.message || (s.state === 'confirming'
      ? s.ref ? 'Placing it…' : 'It will go here as soon as it’s made'
      : s.fit.ok ? coarse ? 'Drag to move · turn the ring' : 'Drag to move · Q E or the ring to turn' : s.fit.why ?? "It can't go there")
    if (s.dom.hint.dataset.text === text) return
    s.dom.hint.dataset.text = text
    // The keys as little keycaps, so Q and E read as keys in a hand that blurs letters.
    const keys = /^Drag to move · Q E /.exec(text)
    if (keys) s.dom.hint.replaceChildren('Drag to move · ', kbd('Q'), kbd('E'), text.slice(keys[0].length - 1))
    else s.dom.hint.textContent = text
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
  const kbd = (key: string) => {
    const k = document.createElement('kbd')
    k.textContent = key
    return k
  }
  /** Where the turn ring sits and which way it faces, for the handle. */
  const ringAt = { centre: new THREE.Vector3(), normal: new THREE.Vector3(0, 1, 0), radius: 0.5 }
  const stagePose = (s: Session) => {
    const p = pose(s)
    if (!p) return
    setPose(s.holder, p)
    const [w, h, d] = s.size
    if (s.mount === 'wall') {
      // Lifted off the wall toward the room while held; its shadow stays on the wall, a little below.
      const at = s.at.mount === 'wall' ? s.at : null
      const f = at && faceOf(deps.plan(), at.wallId, at.roomId, at.along)
      const inward = new THREE.Vector3(f?.inward[0] ?? 0, 0, f?.inward[1] ?? 1)
      s.holder.position.addScaledVector(inward, 0.008 + s.lifted * 0.6)
      const lay = (m: THREE.Mesh, out: number, down: number, sx: number, sy: number, spin: number) => {
        m.position.set(p.x + inward.x * out, p.y - down, p.z + inward.z * out)
        m.rotation.set(0, Math.atan2(inward.x, inward.z), 0, 'YXZ')
        m.rotateZ(spin)
        m.scale.set(sx, sy, 1)
      }
      const spin = s.at.mount === 'wall' ? s.at.spin : 0
      lay(shadow, 0.003, 0.025 + s.lifted * 0.3, w + 0.16 + s.lifted, h + 0.16 + s.lifted, spin)
      lay(noGo, 0.004, 0, w + 0.12, h + 0.12, spin)
      const R = Math.hypot(w, h) / 2 + 0.1
      lay(ring, 0.005, 0, R * 2, R * 2, spin)
      ringAt.centre.set(p.x + inward.x * 0.005, p.y, p.z + inward.z * 0.005)
      ringAt.normal.copy(inward)
      ringAt.radius = R
    } else {
      const flat = (m: THREE.Mesh, y: number, sx: number, sz: number, yaw = p.yaw, x = p.x, z = p.z) => {
        m.position.set(x, y, z)
        m.rotation.set(0, yaw, 0, 'YXZ')
        m.rotateX(-Math.PI / 2)
        m.scale.set(sx, sz, 1)
      }
      if (s.mount === 'ceiling') {
        s.holder.position.y -= s.lifted * 0.5
        // A hung thing: its spot on the floor below, and the ring around its widest part.
        const b = new THREE.Box3().setFromObject(s.object)
        const y = (b.min.y + b.max.y) / 2
        const R = Math.hypot(w, d) / 2 + 0.12
        flat(drop, 0.006, w + 0.2, w + 0.2, 0)
        flat(noGo, 0.007, w + 0.2, d + 0.2)
        flat(ring, y, R * 2, R * 2)
        ringAt.centre.set(p.x, y, p.z)
      } else {
        s.holder.position.y += s.lifted
        // Higher is softer: the shadow spreads and pales as it lifts.
        const spread = 0.22 + s.lifted * 2
        flat(shadow, p.y + 0.003, w + spread, d + spread)
        ;(shadow.material as THREE.MeshBasicMaterial).opacity = Math.max(0.45, 1 - s.lifted * 5)
        flat(noGo, p.y + 0.004, w + 0.14, d + 0.14)
        const R = Math.hypot(w, d) / 2 + 0.1
        flat(ring, p.y + 0.005, R * 2, R * 2)
        ringAt.centre.set(p.x, p.y + 0.005, p.z)
        ringAt.radius = R
      }
      if (s.mount === 'ceiling') ringAt.radius = Math.hypot(w, d) / 2 + 0.12
      ringAt.normal.set(0, 1, 0)
    }
  }
  /** The ring's point toward the screen's right: where the turn handle sits. */
  const handleAt = () => {
    const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0)
    right.addScaledVector(ringAt.normal, -right.dot(ringAt.normal)).normalize()
    // A little toward the viewer too, so the handle is in front of the thing rather than behind it.
    const toward = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 2)
    toward.addScaledVector(ringAt.normal, -toward.dot(ringAt.normal)).normalize()
    const dir = right.multiplyScalar(0.8).addScaledVector(toward, 0.6).normalize()
    return ringAt.centre.clone().addScaledVector(dir, ringAt.radius * 0.94)
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
    if (aim(x, y).intersectObjects([s.holder], true).length) return true
    // Inside the turn ring counts as the thing: the ring is where it can be picked up.
    const inRing = aim(x, y).ray.intersectPlane(new THREE.Plane().setFromNormalAndCoplanarPoint(ringAt.normal, ringAt.centre), new THREE.Vector3())
    if (inRing && inRing.distanceTo(ringAt.centre) < ringAt.radius * 0.85) return true
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
    turnBtn.innerHTML = '<span class="knob"><svg viewBox="0 0 40 40" aria-hidden="true"><path d="M29.5 14.5a11 11 0 1 0 1.6 9.2" fill="none" stroke="currentColor" stroke-width="3.6" stroke-linecap="round"/><path d="M31.8 7.6l-.4 8.4-8.2-1.6" fill="none" stroke="currentColor" stroke-width="3.6" stroke-linecap="round" stroke-linejoin="round"/></svg></span>'
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

  /** On a phone the tag docks to the bottom, in reach of a thumb, and the view frames the thing above it. */
  const narrow = () => innerWidth < 700 && innerHeight > innerWidth
  const layoutDom = (s: Session) => {
    const b = new THREE.Box3().setFromObject(s.holder)
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity
    for (const x of [b.min.x, b.max.x]) for (const y of [b.min.y, b.max.y]) for (const z of [b.min.z, b.max.z]) {
      const [sx, sy] = project(x, y, z)
      x0 = Math.min(x0, sx); x1 = Math.max(x1, sx); y0 = Math.min(y0, sy); y1 = Math.max(y1, sy)
    }
    const vw = innerWidth, vh = innerHeight
    const tag = s.dom.tag
    const docked = narrow()
    tag.classList.toggle('docked', docked)
    if (docked) {
      if (tag.style.transform) tag.style.transform = ''
    } else {
      const tw = tag.offsetWidth, th = tag.offsetHeight
      // Above the thing when there is room, else below it; always on screen. The tail points at it.
      let ty = y0 - th - 22
      const below = ty < 12
      if (below) ty = Math.min(vh - th - 12, y1 + 22)
      const cx = (x0 + x1) / 2
      const tx = Math.min(Math.max(cx - tw / 2, 12), vw - tw - 12)
      tag.classList.toggle('below', below)
      tag.style.setProperty('--tail', `${Math.round(Math.min(Math.max(cx - tx, 24), tw - 24))}px`)
      tag.style.transform = `translate(${Math.round(tx)}px, ${Math.round(ty)}px) rotate(-1.2deg)`
    }
    // The turn handle rides the ring, on the side toward the screen's right.
    const h = handleAt()
    let [hx, hy] = project(h.x, h.y, h.z)
    // A small thing's ring is small on screen: the handle stays clear of the thing, never on it.
    const [rx, ry] = project(ringAt.centre.x, ringAt.centre.y, ringAt.centre.z)
    const away = Math.hypot(hx - rx, hy - ry) || 1
    const clear = Math.max(x1 - x0, y1 - y0) / 2 + 28
    if (away < clear) [hx, hy] = [rx + ((hx - rx) / away) * clear, ry + ((hy - ry) / away) * clear]
    const half = s.dom.turn.offsetWidth / 2 || 24
    s.dom.turn.style.transform = `translate(${Math.round(Math.min(Math.max(hx - half, 4), vw - 2 * half - 4))}px, ${Math.round(Math.min(Math.max(hy - half, 4), vh - 2 * half - 4))}px)`
  }

  /**
   * Phone framing: a sideways-and-up shift of the camera as camera.ts (and build's framing) posed it this
   * frame, like build.ts's frameHouse. It eases in when a session opens or the thing leaves the clear
   * band above the tag, holds still while something is held, and eases out when the session ends.
   */
  const frameView = (s: Session | null, dt: number) => {
    camera.updateMatrixWorld()
    const busy = drag || twist || turning
    if (!s || !narrow()) pan.goal = { right: 0, up: 0 }
    else if (!busy) {
      const c = new THREE.Box3().setFromObject(s.holder).getCenter(new THREE.Vector3())
      const q = c.clone().applyMatrix4(camera.matrixWorldInverse)
      const tan = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))
      const depth = -q.z
      // Where it is on screen now, with the current shift: 0..1 across and down.
      const sx = 0.5 + (q.x - pan.right) / (2 * tan * camera.aspect * depth)
      const sy = 0.5 - (q.y - pan.up) / (2 * tan * depth)
      if (pan.fresh || sx < 0.18 || sx > 0.82 || sy < 0.12 || sy > 0.58) {
        // The middle across, a little above the middle of the band above the tag.
        pan.goal = { right: q.x, up: q.y - 0.24 * tan * depth }
        pan.fresh = false
      }
    }
    const e = reducedMotion.matches ? 1 : 1 - Math.exp(-dt * 5)
    if (!busy) {
      pan.right += (pan.goal.right - pan.right) * e
      pan.up += (pan.goal.up - pan.up) * e
    }
    if (Math.abs(pan.right) + Math.abs(pan.up) < 1e-4) return
    const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0)
    const up = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1)
    camera.position.addScaledVector(right, pan.right).addScaledVector(up, pan.up)
    camera.updateMatrixWorld()
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
    group.add(noGo, ring, s.mount === 'ceiling' ? drop : shadow)
    pan.fresh = true
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
    for (const m of decals) m.removeFromParent()
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
      frameView(s, dt)
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
      plane.dispose()
      xrayMat.dispose()
      for (const m of decals) {
        const mat = m.material as THREE.MeshBasicMaterial
        mat.map?.dispose()
        mat.dispose()
      }
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
    padding: 14px 18px 12px 20px; font: 600 15px/1.25 ${HAND}; transform-origin: 50% 0; will-change: transform; }
  ${tagCss('.place-tag', '.place-tag button[data-place=confirm]', '.place-tag button[data-place=cancel]', '[aria-disabled=true]')}
  .place-tag::after { content: ''; position: absolute; left: var(--tail, 50%); bottom: -8px; width: 16px; height: 16px; margin-left: -8px; rotate: 45deg;
    background: #f4e6cb; border-radius: 0 0 4px 0; box-shadow: 3px 3px 5px rgba(60, 30, 10, 0.12); }
  .place-tag.below::after { bottom: auto; top: -8px; background: #fffaf0; border-radius: 4px 0 0 0; box-shadow: -2px -2px 4px rgba(60, 30, 10, 0.06); }
  .place-tag strong { font: 700 20px/1.1 ${HAND}; letter-spacing: 0.01em; }
  .place-tag .hint { font: italic 600 17px/1.3 ${HAND}; color: #5e4434; min-height: 1.3em; }
  .place-tag.bad .hint { color: #a63c2c; }
  .place-tag kbd { display: inline-block; min-width: 1.35em; margin: 0 2px; padding: 0 4px 1px; border-radius: 5px; font: 700 14px/1.35 ui-rounded, system-ui, sans-serif;
    text-align: center; color: #4a3428; background: #fffaf0; border: 1px solid rgba(122, 82, 54, 0.45); box-shadow: 0 1.5px 0 rgba(122, 82, 54, 0.45); font-style: normal; }
  .place-tag .row { display: flex; gap: 8px; justify-content: flex-end; margin-top: 2px; position: relative; z-index: 1; }
  .place-tag.docked { left: 12px; right: 12px; top: auto; bottom: calc(14px + env(safe-area-inset-bottom)); max-width: none; transform: none; rotate: -0.6deg;
    grid-template-columns: 1fr auto; align-items: center; column-gap: 12px; padding: 14px 16px 14px 20px; }
  .place-tag.docked::after { display: none; }
  .place-tag.docked strong { grid-column: 1; }
  .place-tag.docked .hint { grid-column: 1; font-size: 16px; }
  .place-tag.docked .row { grid-column: 1 / -1; justify-content: stretch; }
  .place-tag.docked .row button { flex: 1; min-height: 48px; font-size: 18px; }
  .place-tag.shake { animation: place-shake 0.36s ease; }
  @keyframes place-shake { 20% { translate: -6px 0; } 40% { translate: 5px 0; } 60% { translate: -3px 0; } 80% { translate: 2px 0; } }
  .place-turn { position: fixed; left: 0; top: 0; z-index: 40; width: 48px; height: 48px; padding: 0; border: 0; background: transparent; cursor: grab;
    touch-action: none; color: #6a4630; will-change: transform; display: grid; place-items: center; }
  .place-turn .knob { width: 34px; height: 34px; display: grid; place-items: center; border-radius: 50%; background: #fbf3e2;
    box-shadow: 0 4px 10px rgba(70, 40, 20, 0.28), 0 0 0 2.5px rgba(106, 70, 48, 0.85), 0 1px 0 rgba(255, 255, 255, 0.8) inset; transition: scale 140ms ease; }
  .place-turn svg { width: 20px; height: 20px; display: block; }
  .place-turn:hover .knob { scale: 1.08; }
  .place-turn.bad { color: #a63c2c; }
  .place-turn.bad .knob { box-shadow: 0 4px 10px rgba(70, 40, 20, 0.28), 0 0 0 2.5px rgba(196, 72, 52, 0.85); }
  .place-turn:active .knob { cursor: grabbing; scale: 0.94; }
  .place-turn:focus-visible { outline: 3px solid #e7a35c; outline-offset: 2px; border-radius: 50%; }
  @media (prefers-reduced-motion: reduce) { .place-tag.shake { animation: none; } }
  `
}
