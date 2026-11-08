import * as THREE from 'three/webgpu'
import type { Context } from 'cordis'
import { own, releaseGpu, replace } from '../kernel'
import { canvas, paintGlow, toTexture } from '../paint'
import { HOUSE_PLAN, apply, curveOf, floorOf, roomAt, roomsOf, runsForward, normalAt, outline as ringOf, pointAt, polygonArea, roomWalls, wallOf, type Edit, type P, type Plan } from '../build/plan'
import { BASE_ROOMS, JAMB_WALL, build, makeKit, type Built } from '../build/walls'
import { ReadOnly, StaleHead, type PlanHistory } from '../build/history'
import { HAND, tagCss } from '../build/sketch'
import { alongOf } from '../build/mount'
import { house } from '../build/house'
import { checkIntent } from '../build/intent'
import { OPENING_HEAD, draftEdits, draftGeometry, fit, freshId, freshLabel, resolve, type Draft } from '../build/resolve'
import { makeOutline } from '../build/outline'
import { makeFixtures } from '../build/fixtures'
import { makeYard } from '../build/yard'
import { makeLot } from '../build/lot'
import { makeMoveIn } from '../build/movein'
import { fitFrame, lift, type Box } from '../build/frame'
import { MODE, OVERVIEW, type Frame } from './camera'

declare module 'cordis' {
  interface Events {
    /**
     * A change to the house, as the person's villager routed it (#48). `intent` is the
     * router's data, checked again here; `reply` speaks one line as that villager.
     * The listener sets `handled` when build mode took it.
     */
    'village/build-intent'(request: BuildRequest): void
  }
}
export interface BuildRequest { intent: unknown; say?: string; reply: (text: string) => void; handled?: boolean; /** Whose villager asked: they move into the room. */ person?: string }

/**
 * #48 experiment, ?build=1 only: the kitchen's walls and floor come from a floor
 * plan (src/build/plan.ts) instead of room.ts and diorama.ts, and in ?cam=iso the
 * right wall can be dragged (moves it) or pulled at its middle (bends it).
 * The house is a versioned plan (src/build/history.ts): a drag, a bend or an added
 * room is one committed version, and Ctrl/Cmd+Z and Shift+Ctrl/Cmd+Z step through
 * them. Saying "add a room…" on the notepad, or clicking a wall and saying "open a
 * door here into a new room", draws the room's outline to adjust, then build or
 * let go (src/build/outline.ts). While the outline shows, the dollhouse view frames it with the
 * shared wall and the door; once built, the villager who asked walks in (src/build/movein.ts).
 * Without the flag this plugin does nothing.
 */
const ENABLED = new URLSearchParams(location.search).get('build') === '1'
/** The wall that drags and bends: the house's right wall, where the Workshop will go. */
const WALL = 'living.right'
/** Screen boxes (NDC) the proposal fills: the top is left for its card, the bottom for the notepad. */
const PROPOSAL_BOX: Box = { x: [-0.84, 0.84], y: [-0.7, 0.46] }
/** What lounge.ts builds that the plan's walls and floor stand in for. */
const LOUNGE_PARTS = new Set(['lounge floor', 'lounge wall', 'lounge skirting'])
const STUB = 0.42

export default {
  name: 'build',
  inject: ['stage', 'view'],
  apply(ctx: Context) {
    if (!ENABLED) return
    const { scene, camera, renderer } = ctx.stage
    /** The villager who drew the room walks into it and the view follows them in (the dollhouse only). */
    const movein = MODE === 'iso' ? makeMoveIn(ctx.view, camera) : null
    // "Back to the house": a quiet paper tag while the reveal holds the view; it (or Escape) glides out to the whole house.
    const backEl = document.createElement('button')
    backEl.type = 'button'
    backEl.className = 'build-back'
    backEl.textContent = 'Back to the house'
    const backToHouse = () => {
      if (!movein?.holding()) return false
      movein.letGo()
      void ctx.view.glide(OVERVIEW, 1.2)
      return true
    }
    backEl.addEventListener('click', backToHouse)
    if (movein) ctx.effect(() => {
      // Taking the camera (a drag, the wheel, an arrow key) ends the reveal's hold on the view; the villager stays a while.
      // A held WASD key lets go too, once camera.ts turns it into a pan (movein.ts sees the view move off its frame).
      const el = renderer.domElement
      const onKeyTake = (e: KeyboardEvent) => e.key.startsWith('Arrow') && !typing() && movein.letGo()
      el.addEventListener('pointerdown', movein.letGo)
      el.addEventListener('wheel', movein.letGo, { passive: true })
      addEventListener('keydown', onKeyTake, true)
      document.body.append(backEl)
      return () => {
        el.removeEventListener('pointerdown', movein.letGo)
        el.removeEventListener('wheel', movein.letGo)
        removeEventListener('keydown', onKeyTake, true)
        backEl.remove()
        movein.release()
      }
    }, 'build move-in')
    const kit = makeKit()
    const group = own(ctx, new THREE.Group())
    group.name = 'build'
    /** What is drawn: the history's head, or a drag's live preview on top of it. */
    let plan: Plan = HOUSE_PLAN
    let history: PlanHistory | null = null
    let offHistory = () => {}
    let committing = false
    const opened = house().then((h) => {
      history = h
      plan = h.plan
      // The host is there but the house could not be opened, or no host keeps it: say so once, on screen.
      const line = h.readOnly ?? h.unsaved
      if (line) note(line)
      offHistory = h.onChange((p) => {
        fixtures.invalidate()
        if (!drag) plan = p
        // The outline's own commit is not a change under it.
        if (!committing) outline.refit()
      })
      return h
    })
    let builtPlan: Plan | null = null
    let built: Built | null = null
    const rebuildMs: number[] = []

    // What room.ts and diorama.ts built, set aside while the plan's version stands in.
    let stash: Array<{ object: THREE.Object3D; parent: THREE.Object3D; order: THREE.Object3D[] }> = []
    let roomGroup: THREE.Object3D | null = null
    let swapped: () => void = () => {}
    const ready = new Promise<void>((done) => (swapped = done))

    const meshes = (b: Built) => [...b.seat.children, ...(b.shell?.children ?? []), ...(b.floor ? [b.floor] : []), ...(b.rooms?.children ?? [])] as THREE.Mesh[]
    const copyState = (from: THREE.Object3D[], to: THREE.Object3D[]) => {
      if (from.length !== to.length) return
      from.forEach((o, i) => {
        to[i].visible = o.visible
        to[i].layers.mask = o.layers.mask
      })
    }

    // The lot answers the plan: the lawn and fence grow to hold every room and the one being staked out,
    // and the yard's flowers, stones and shrubs step aside from the rooms and the lawn round them.
    const yard = makeYard(scene)
    const lot = makeLot(scene, group)
    let paper: P[] | null = null
    const tidyYard = () => {
      const p = builtPlan
      const areas = p ? p.rooms.filter((r) => !BASE_ROOMS.has(r.id)).map((r) => ringOf(p, r, -Math.max(...roomWalls(p, r).map(({ wall }) => wall.thickness)) / 2 - 0.08)) : []
      const all = paper ? [...areas, paper] : areas
      lot.grow(all)
      yard.hide([...all, ...lot.clearings(all)])
    }
    /** A room just built rises from the paper: its new walls grow up from the floor (instant with reduced motion). */
    const RISE_MS = 700
    let rising: { room: string; at: number } | null = null
    const raise = () => {
      if (!rising || !built?.rooms) return
      const t = matchMedia('(prefers-reduced-motion: reduce)').matches ? 1 : Math.min(1, (performance.now() - rising.at) / RISE_MS)
      // Ease out with a little settle at the top.
      const e = t >= 1 ? 1 : 1 - Math.pow(1 - t, 3) * Math.cos(t * Math.PI * 0.5)
      const walls = new Set(builtPlan ? roomWalls(builtPlan, builtPlan.rooms.find((r) => r.id === rising!.room) ?? builtPlan.rooms[0]).map(({ wall }) => wall.id) : [])
      for (const m of built.rooms.children) {
        if (!walls.has(m.userData.wall)) continue
        m.userData.restY ??= m.position.y
        m.scale.y = Math.max(0.02, e)
        m.position.y = (m.userData.restY as number) * Math.max(0.02, e)
      }
      if (t >= 1) {
        for (const m of built.rooms.children) delete m.userData.restY
        rising = null
      }
    }
    // The sun's shadow box covers the dollhouse kitchen (window.ts); a room built past it would be lit
    // as if nothing stood in the sun, so the box grows to hold every room, and goes back on unload.
    let sunWas: { left: number; right: number; top: number; bottom: number } | null = null
    // Found once and kept while it stays in the scene, so the frame loop does not search the scene for it.
    let sunLight: THREE.DirectionalLight | undefined
    const theSun = () => (sunLight?.parent ? sunLight : (sunLight = scene.getObjectByName('sun') as THREE.DirectionalLight | undefined))
    const builtBeyondBase = (p: Plan) => p.rooms.some((r) => !BASE_ROOMS.has(r.id))
    const fitSun = (p: Plan) => {
      const sun = theSun()
      if (MODE === 'seat' || !sun?.isDirectionalLight || !sun.castShadow) return
      const cam = sun.shadow.camera
      sunWas ??= { left: cam.left, right: cam.right, top: cam.top, bottom: cam.bottom }
      const box = { ...sunWas }
      if (builtBeyondBase(p)) {
        sun.updateMatrixWorld()
        sun.target.updateMatrixWorld()
        cam.position.setFromMatrixPosition(sun.matrixWorld)
        cam.lookAt(new THREE.Vector3().setFromMatrixPosition(sun.target.matrixWorld))
        cam.updateMatrixWorld()
        const v = new THREE.Vector3()
        for (const r of p.rooms) for (const [x, z] of ringOf(p, r, -0.6)) for (const y of [-0.1, 3.2]) {
          v.set(x, y, z).applyMatrix4(cam.matrixWorldInverse)
          box.left = Math.min(box.left, v.x - 0.3)
          box.right = Math.max(box.right, v.x + 0.3)
          box.bottom = Math.min(box.bottom, v.y - 0.3)
          box.top = Math.max(box.top, v.y + 0.3)
        }
      }
      if (cam.left === box.left && cam.right === box.right && cam.top === box.top && cam.bottom === box.bottom) return
      Object.assign(cam, box)
      cam.updateProjectionMatrix()
    }
    /** The new room's first pieces (placed things) grow in once its walls are up, with a small overshoot as if set down. */
    const PIECES_AT = 600, PIECES_MS = 450
    let settling: { room: string; at: number } | null = null
    const settle = () => {
      if (!settling) return
      const things = scene.getObjectByName('placed things')
      const t = matchMedia('(prefers-reduced-motion: reduce)').matches ? 1 : Math.max(0, Math.min(1, (performance.now() - settling.at - PIECES_AT) / PIECES_MS))
      const e = t >= 1 ? 1 : Math.max(0.0001, 1 + 2.2 * Math.pow(t - 1, 3) + 1.2 * Math.pow(t - 1, 2))
      for (const o of things?.children ?? []) if (String(o.userData.furniture ?? '').startsWith(`${settling.room}.`)) o.scale.setScalar(e)
      if (t >= 1) settling = null
    }
    const rebuild = (next: Plan, final: boolean) => {
      const start = performance.now()
      const fresh = build(next, kit, { iso: MODE === 'iso', handle: WALL, final })
      if (built && meshes(built).length === meshes(fresh).length) {
        // Same pieces: move the new geometry into the meshes the camera already tracks, so cutaway state holds.
        const old = meshes(built)
        meshes(fresh).forEach((m, i) => {
          old[i].geometry.dispose()
          old[i].geometry = m.geometry
          old[i].position.copy(m.position)
          old[i].rotation.copy(m.rotation)
          // As built: shareWalls decides again which pieces are interior.
          old[i].userData.inward = m.userData.inward
          old[i].userData.interior = m.userData.interior
        })
      } else {
        const before = built ? meshes(built) : null
        if (built) for (const part of [built.seat, built.shell, built.floor, built.rooms]) if (part) {
          part.removeFromParent()
          part.traverse((o) => (o as THREE.Mesh).geometry?.dispose())
        }
        built = fresh
        for (const part of [fresh.seat, fresh.shell, fresh.floor, fresh.rooms]) if (part) group.add(part)
        if (before) copyState(before, meshes(fresh))
      }
      builtPlan = next
      shareWalls(next)
      tidyYard()
      fitSun(next)
      highlight()
      rebuildMs.push(performance.now() - start)
    }

    /**
     * A house wall a new room now backs (the kitchen's left wall, say) is still built as an outer wall, so camera.ts keeps
     * it standing whenever the camera is on the house's side and the new room hides behind it. It becomes an interior
     * wall, as kitchendoor.ts's is: cut down to its stub unless the view is close in and looking across it.
     * Only walls that run along z (camera.ts's interior rule compares x).
     */
    const shareWalls = (p: Plan) => {
      if (!built) return
      // Per shared wall: its x, and where the jamb wall in front of its door ends (z; walls.ts cuts the wall there). From
      // there back, the wall stands as the kitchen's own side does (the camera on the house's side keeps it): full wall
      // either side of the door, its frame and the wall over it, and the stretch behind it to the back corner, so the
      // doorway is an opening cut into a wall and the back wall turns one corner, not two. In front it is knee high.
      const shared = new Map<string, { x: number; front: number; z0: number; z1: number }>()
      for (const w of p.walls) {
        const rooms = roomsOf(p, w.id)
        if (rooms.length < 2 || rooms.every((r) => BASE_ROOMS.has(r.id))) continue
        const c = curveOf(p, w)
        if (Math.abs(c.dir[0]) > 0.2) continue
        const doors = w.openings.filter((o) => o.kind === 'door').map((o) => Math.max(pointAt(c, o.from)[1], pointAt(c, o.to)[1]))
        shared.set(w.id, { x: (c.a[0] + c.b[0]) / 2, front: doors.length ? Math.max(...doors) + JAMB_WALL : -Infinity, z0: Math.min(c.a[1], c.b[1]), z1: Math.max(c.a[1], c.b[1]) })
      }
      // A short leftover of the same house wall in front of the new room (under a metre) goes low with it, or it stands
      // alone as a pillar; one behind it stands, joining the new room's back wall to the house's.
      const lines = [...shared.values()]
      for (const w of p.walls) {
        const c = curveOf(p, w)
        const x = (c.a[0] + c.b[0]) / 2, z = (c.a[1] + c.b[1]) / 2
        const line = lines.find((s) => Math.abs(s.x - x) < 0.02)
        if (shared.has(w.id) || Math.abs(c.dir[0]) > 0.2 || c.length > 1 || !line || z < line.z0) continue
        shared.set(w.id, { x, front: -Infinity, z0: Math.min(c.a[1], c.b[1]), z1: Math.max(c.a[1], c.b[1]) })
      }
      const box = new THREE.Box3()
      for (const m of meshes(built)) {
        const at = shared.get(m.userData.wall)
        if (!at || !m.userData.inward) continue
        box.setFromObject(m)
        if (box.min.z < at.front - 1e-3) continue
        delete m.userData.inward
        m.userData.interior = { x: at.x }
      }
      hangLow([...shared.values()].filter((s) => s.z1 > s.front))
    }
    /**
     * Things the house's plugins hung on a wall that is now cut low (furnish.ts's shelf and coat pegs on the kitchen's
     * left wall) would float over the stub. They follow the wall: the low stretch's interior rule hides them with it and
     * brings them back when it stands. What they were tagged with is put back when the wall changes again or on unload.
     */
    const hung = new Map<THREE.Object3D, THREE.Vector3>()
    const hangLow = (low: Array<{ x: number; front: number; z0: number; z1: number }>) => {
      for (const [o, inward] of hung) {
        delete o.userData.interior
        o.userData.inward = inward
      }
      hung.clear()
      if (!low.length) return
      const box = new THREE.Box3()
      scene.traverse((o) => {
        if (!o.userData.inward || o.userData.wall || hung.has(o) || o.parent === null) return
        for (let q: THREE.Object3D | null = o; q; q = q.parent) if (q === group) return
        box.setFromObject(o)
        if (box.isEmpty() || box.min.y < 0.3) return
        const cx = (box.min.x + box.max.x) / 2
        const at = low.find((s) => Math.abs(cx - s.x) < 0.6 && box.max.z > Math.max(s.front, s.z0) && box.min.z < s.z1)
        if (!at) return
        hung.set(o, o.userData.inward as THREE.Vector3)
        delete o.userData.inward
        o.userData.interior = { x: at.x }
      })
    }
    const inScene = (o: THREE.Object3D) => {
      for (let p: THREE.Object3D | null = o; p; p = p.parent) if (p === scene) return true
      return false
    }
    const setAside = (object: THREE.Object3D) => {
      const parent = object.parent!
      stash.push({ object, parent, order: [...parent.children] })
      object.removeFromParent()
    }
    const restore = () => {
      for (const { object, parent, order } of stash.reverse()) {
        if (!inScene(parent)) {
          releaseGpu(object)
          continue
        }
        parent.add(object)
        parent.children.sort((a, b) => order.indexOf(a) - order.indexOf(b))
      }
      stash = []
    }
    const trySwap = () => {
      // The house's walls and floors: room.ts's, the shared wall (kitchendoor.ts), lounge.ts's and, in iso, diorama.ts's shell and floor.
      const r = scene.getObjectByName('room')
      const shared = scene.getObjectByName('shared wall')
      const lounge = scene.getObjectByName('lounge')
      const d = MODE === 'iso' ? scene.getObjectByName('diorama') : null
      if (!r || !shared || !lounge || (MODE === 'iso' && !d)) return
      const oldShell = d?.children.find((o) => o.name === 'diorama shell')
      const oldFloor = d?.children.find((o) => o.name === 'diorama floor')
      if (MODE === 'iso' && (!oldShell || !oldFloor)) return
      rebuild(plan, true)
      for (const o of [...r.children, shared, ...lounge.children.filter((o) => LOUNGE_PARTS.has(o.name))]) setAside(o)
      if (oldShell) setAside(oldShell)
      if (oldFloor) setAside(oldFloor)
      roomGroup = r
      swapped()
      // The house's own materials are this kit's, not the plugins' that rooms.ts compiled at load: compile them now,
      // so the first walk into the living room does not stall on new pipelines.
      void renderer.compileAsync(group, camera, scene).catch(() => {})
    }

    // Handles: the right wall glows on hover; a glowing dot at its middle bends it.
    kit.handleWall.emissive.set('#ffb15e')
    kit.handleWall.emissiveIntensity = 0
    const dot = new THREE.Mesh(
      new THREE.CircleGeometry(0.34, 40),
      new THREE.MeshBasicMaterial({ map: paintGlow(), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }),
    )
    dot.rotation.x = -Math.PI / 2
    dot.name = 'build bend handle'
    dot.renderOrder = 2
    group.add(dot)

    // The size, handwritten on a paper tag that hangs in the room while a wall moves.
    const [tagCanvas, g] = canvas(512, 224)
    const tagMap = toTexture(tagCanvas)
    const tag = new THREE.Sprite(new THREE.SpriteNodeMaterial({ map: tagMap, transparent: true, depthTest: false, fog: false, toneMapped: false }))
    tag.scale.set(1.9, 1.9 * 224 / 512, 1)
    tag.renderOrder = 3
    tag.visible = false
    tag.name = 'build size tag'
    group.add(tag)
    let tagText = ''
    const paintTag = (p: Plan) => {
      const ring = floorOf(p, roomsOf(p, WALL)[0] ?? p.rooms[0])
      const xs = ring.map((q) => q[0]), zs = ring.map((q) => q[1])
      const w = Math.max(...xs) - Math.min(...xs), d = Math.max(...zs) - Math.min(...zs)
      const bent = Math.abs(wallOf(p, WALL).sagitta) > 0
      const text = `${w.toFixed(1)} × ${d.toFixed(1)} m|${polygonArea(ring).toFixed(1)} m²${bent ? ', with a bay' : ''}`
      if (text === tagText) return
      tagText = text
      const [top, bottom] = text.split('|')
      g.clearRect(0, 0, 512, 224)
      g.save()
      g.translate(256, 112)
      g.rotate(-0.035)
      g.shadowColor = 'rgba(70, 40, 20, 0.35)'
      g.shadowBlur = 14
      g.shadowOffsetY = 5
      g.fillStyle = '#fbf3e2'
      g.beginPath()
      g.roundRect(-230, -88, 460, 176, 18)
      g.fill()
      g.shadowColor = 'transparent'
      g.strokeStyle = 'rgba(150, 110, 80, 0.5)'
      g.lineWidth = 3
      g.beginPath()
      g.arc(-196, -54, 10, 0, Math.PI * 2)
      g.stroke()
      g.fillStyle = '#4a3428'
      g.textAlign = 'center'
      g.font = `700 64px ${HAND}`
      g.fillText(top, 10, -2)
      g.fillStyle = 'rgba(74, 52, 40, 0.75)'
      g.font = `italic 40px ${HAND}`
      g.fillText(bottom, 10, 56)
      g.restore()
      tagMap.needsUpdate = true
    }

    // Picking: where the pointer meets a level plane, and how close that is to the wall.
    const raycaster = new THREE.Raycaster()
    const ndc = new THREE.Vector2()
    const hitPoint = new THREE.Vector3()
    const cut = () => meshes(built!).some((m) => m.userData.wall === WALL && m.userData.cutaway && m.visible)
    const onPlane = (e: PointerEvent, y: number) => {
      const rect = renderer.domElement.getBoundingClientRect()
      ndc.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1)
      raycaster.setFromCamera(ndc, camera)
      return raycaster.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -y), hitPoint) ? hitPoint.clone() : null
    }
    type Hit = { kind: 'move' | 'bend'; y: number; at: THREE.Vector3 }
    /** The right wall drags only while it is still the kitchen's own whole side. */
    const rightFree = () => {
      const w = plan.walls.find((k) => k.id === WALL)
      return Boolean(w && w.a === 'living.back-right' && w.b === 'living.front-right' && roomsOf(plan, WALL).length === 1)
    }
    const pick = (e: PointerEvent): Hit | null => {
      if (!built?.shell || outline.draft() || !rightFree() || history?.readOnly) return null
      const c = curveOf(plan, wallOf(plan, WALL))
      for (const y of cut() ? [STUB] : [STUB, 1.2, 2.0, 2.8]) {
        const p = onPlane(e, y)
        if (!p) continue
        const t = alongOf(plan, wallOf(plan, WALL), p.x, p.z)
        const [x, z] = pointAt(c, t)
        if (Math.hypot(p.x - x, p.z - z) > 0.32) continue
        // A door in the wall stays the door's to point at (the Workshop's is an entry), so the handle keeps clear of it.
        if (wallOf(plan, WALL).openings.some((o) => y < o.head && t > o.from - 0.1 && t < o.to + 0.1)) return null
        return { kind: Math.abs(t - c.length / 2) < 0.6 ? 'bend' : 'move', y, at: p }
      }
      return null
    }

    let hover: Hit['kind'] | null = null
    let drag: (Hit & { from: Plan; edit: Edit | null }) | null = null
    const show = () => {
      const kind = drag?.kind ?? hover
      kit.handleWall.emissiveIntensity = drag?.kind === 'move' ? 0.3 : kind === 'move' ? 0.16 : kind ? 0.06 : 0
      ;(dot.material as THREE.MeshBasicMaterial).opacity = drag?.kind === 'bend' ? 1 : kind === 'bend' ? 0.85 : kind ? 0.45 : 0
      renderer.domElement.style.cursor = drag ? 'grabbing' : kind ? 'grab' : ''
      tag.visible = Boolean(drag)
    }
    const stop = (e: Event) => {
      e.stopImmediatePropagation()
      e.preventDefault()
    }
    const onDown = (e: PointerEvent) => {
      if (e.button !== 0 || e.target !== renderer.domElement) return
      const hit = pick(e)
      if (!hit) return
      stop(e)
      drag = { ...hit, from: plan, edit: null }
      paintTag(plan)
      show()
    }
    const onMove = (e: PointerEvent) => {
      if (!drag) {
        const was = hover
        hover = e.target === renderer.domElement ? pick(e)?.kind ?? null : null
        if (hover !== was) show()
        // Over a handle the wall owns the pointer, so nothing behind it lights up; an orbit drag passes through.
        if (hover && e.buttons === 0) e.stopImmediatePropagation()
        return
      }
      stop(e)
      const p = onPlane(e, drag.y)
      if (!p) return
      const { normal } = curveOf(drag.from, wallOf(drag.from, WALL))
      const along = (p.x - drag.at.x) * normal[0] + (p.z - drag.at.z) * normal[1]
      drag.edit = drag.kind === 'move'
        ? { op: 'moveWall', wallId: WALL, by: along }
        : { op: 'bendWall', wallId: WALL, sagitta: wallOf(drag.from, WALL).sagitta + along }
      plan = apply(drag.from, drag.edit)
      paintTag(plan)
    }
    /** A drag ends as one committed version; a cancelled or failed one leaves the head as it was. */
    const end = (cancel: boolean) => {
      if (!drag) return
      const d = drag
      drag = null
      const h = history
      if (cancel || !d.edit || plan === d.from || !h) plan = h?.plan ?? d.from
      else {
        const edit = { ...d.edit, ...(d.edit.op === 'moveWall' ? { by: moveAmount(d.from, plan) } : { sagitta: wallOf(plan, WALL).sagitta }) } as Edit
        void h.commit([edit], d.kind === 'move' ? 'Moved the wall' : 'Bent the wall').catch((e) => {
          plan = h.plan
          rebuild(plan, true)
          note(e instanceof ReadOnly ? e.reasons[0] : "That wall wouldn't stay put, so I put it back.")
        })
      }
      rebuild(plan, true)
      show()
    }
    const onUp = (e: PointerEvent) => {
      if (!drag) return
      stop(e)
      const still = !drag.edit
      end(false)
      // A press on the wall that did not move it picks the wall.
      if (still) selectWall(wallAt(e))
    }
    const typing = () => {
      const a = document.activeElement
      return a instanceof HTMLInputElement || a instanceof HTMLTextAreaElement || (a as HTMLElement | null)?.isContentEditable
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && drag) {
        stop(e)
        return end(true)
      }
      // Undo and redo step through the house's versions; while a room is being drawn, its outline has the keys.
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z' && !drag && !outline.draft() && !typing()) {
        stop(e)
        void (e.shiftKey ? history?.redo() : history?.undo())
        return
      }
      if (e.key === 'Escape' && !outline.draft() && !typing() && backToHouse()) return stop(e)
      if (e.key === 'Escape' && selected && !outline.draft() && !typing()) selectWall(null)
    }

    // ── Selecting a wall: a click on it remembers the wall and the point ──────
    let selected: { wallId: string; t: number; point: THREE.Vector3 } | null = null
    const glowOf = new Map<THREE.Material, THREE.MeshStandardMaterial>()
    const glow = (m: THREE.Material) => {
      let lit = glowOf.get(m)
      if (!lit) {
        lit = (m as THREE.MeshStandardMaterial).clone()
        lit.emissive.set('#ffc27a')
        lit.emissiveIntensity = 0.22
        glowOf.set(m, lit)
      }
      return lit
    }
    const highlight = () => {
      if (!built) return
      for (const m of meshes(built)) {
        const base = (m.userData.material as THREE.Material | undefined) ?? m.material as THREE.Material
        const want = selected && m.userData.wall === selected.wallId ? glow(base) : base
        if (want !== base) m.userData.material = base
        if (m.material !== want) m.material = want
      }
    }
    const mark = new THREE.Mesh(
      new THREE.RingGeometry(0.1, 0.16, 32),
      new THREE.MeshBasicMaterial({ color: '#fff6e4', transparent: true, opacity: 0.9, depthWrite: false, fog: false }),
    )
    mark.rotation.x = -Math.PI / 2
    mark.renderOrder = 3
    mark.name = 'build selected point'
    const selectWall = (next: typeof selected) => {
      selected = next
      if (next) {
        // The mark sits on the floor just inside the room, at the clicked point.
        const c = curveOf(plan, wallOf(plan, next.wallId))
        const [x, z] = pointAt(c, next.t)
        const [nx, nz] = normalAt(c, next.t)
        const owner = roomsOf(plan, next.wallId)[0]
        const forward = owner ? runsForward(plan, owner, next.wallId) : true
        const k = (forward ? -1 : 1) * 0.35
        mark.position.set(x + nx * k, 0.02, z + nz * k)
        group.add(mark)
      } else mark.removeFromParent()
      highlight()
    }
    const wallHits = new THREE.Raycaster()
    const shown = (o: THREE.Object3D) => {
      for (let p: THREE.Object3D | null = o; p; p = p.parent) if (!p.visible) return false
      return true
    }
    /** The wall under the pointer, if any, and where along it. */
    const wallAt = (e: PointerEvent) => {
      if (!built) return null
      const rect = renderer.domElement.getBoundingClientRect()
      ndc.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1)
      wallHits.setFromCamera(ndc, camera)
      const hit = wallHits.intersectObjects(meshes(built).filter((m) => m.userData.wall), false).find((h) => shown(h.object))
      if (!hit) return null
      const wallId = hit.object.userData.wall as string
      const t = alongOf(plan, wallOf(plan, wallId), hit.point.x, hit.point.z)
      return { wallId, t: Math.round(t * 100) / 100, point: hit.point.clone() }
    }
    let pressed: { x: number; y: number } | null = null
    const onPress = (e: PointerEvent) => {
      pressed = e.button === 0 && e.target === renderer.domElement ? { x: e.clientX, y: e.clientY } : null
    }
    const onRelease = (e: PointerEvent) => {
      const p = pressed
      pressed = null
      if (!p || drag || outline.draft() || Math.hypot(e.clientX - p.x, e.clientY - p.y) > 6) return
      const w = wallAt(e)
      if (w || selected) selectWall(w)
    }

    // ── Adding a room: an intent from the notepad becomes an outline to adjust ─
    let reply: (text: string) => void = () => {}
    /** Whose villager asked for the room being drawn: they move into it once it is built. */
    let asker: string | null = null
    const said: string[] = []
    const say = (text: string) => {
      said.push(text)
      reply(text)
    }
    // A line about the house itself (unsaved, read-only, a save that failed), on a paper note at the top:
    // build mode has no villager to speak through until someone writes on the notepad.
    const noteEl = document.createElement('div')
    noteEl.className = 'build-note'
    noteEl.setAttribute('role', 'status')
    let noteTimer = 0
    const note = (text: string) => {
      said.push(text)
      noteEl.textContent = text
      noteEl.classList.add('shown')
      clearTimeout(noteTimer)
      noteTimer = window.setTimeout(() => noteEl.classList.remove('shown'), 9000)
    }
    noteEl.addEventListener('click', () => noteEl.classList.remove('shown'))
    ctx.effect(() => {
      const style = document.createElement('style')
      style.textContent = `
        .build-note { position: fixed; top: max(16px, env(safe-area-inset-top)); left: 50%; translate: -50% -8px; max-width: min(440px, calc(100vw - 32px));
          padding: 14px 20px 15px; font-size: 17px; line-height: 1.35; opacity: 0; pointer-events: none; transition: opacity 220ms ease, translate 220ms ease; z-index: 20; }
        .build-note.shown { opacity: 1; translate: -50% 0; pointer-events: auto; cursor: pointer; }
        @media (prefers-reduced-motion: reduce) { .build-note { transition: none; } }
        ${tagCss('.build-note', '.build-note-x', '.build-note-y', '.build-note-z')}
        ${tagCss('.build-back-card', '.build-back-x', '.build-back', '.build-back-z')}
        .build-back { position: fixed; top: max(16px, env(safe-area-inset-top)); left: max(16px, env(safe-area-inset-left)); translate: 0 -8px; z-index: 20; rotate: -1.5deg;
          box-shadow: 0 6px 14px rgba(70, 40, 20, 0.18); opacity: 0; pointer-events: none; transition: opacity 260ms ease, translate 260ms ease; }
        .build-back.shown { opacity: 1; translate: 0 0; pointer-events: auto; }
        @media (prefers-reduced-motion: reduce) { .build-back { transition: none; } }
      `
      document.head.append(style)
      document.body.append(noteEl)
      return () => {
        clearTimeout(noteTimer)
        noteEl.remove()
        style.remove()
      }
    }, 'build note')
    const view = (): P => {
      const f = camera.getWorldDirection(new THREE.Vector3())
      return Math.hypot(f.x, f.z) > 1e-3 ? [f.x, f.z] : [0, -1]
    }
    /** The room the camera looks at: where its centre ray meets the floor. */
    const inView = () => {
      raycaster.setFromCamera(new THREE.Vector2(0, 0), camera)
      const p = raycaster.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), new THREE.Vector3())
      if (!p) return null
      return roomAt(plan, p.x, p.z)?.id ?? null
    }
    // What the plugins' built-in furniture holds against each wall: placed things are in the plan, and the outline is ours.
    const fixtures = makeFixtures(scene, () => [scene.getObjectByName('placed things'), scene.getObjectByName('build outline')].filter((o): o is THREE.Object3D => Boolean(o)))
    /** Where a door on this wall must not go: built-ins against either face, below a door's head. */
    const occupied = (wallId: string) => {
      // One stretch per built-in: its parts' stretches merged where they meet.
      const out: Array<{ from: number; to: number; name: string }> = []
      for (const f of fixtures.on(history?.plan ?? plan, wallId).filter((k) => k.y0 < OPENING_HEAD).sort((p, q) => p.from - q.from)) {
        const same = out.find((o) => o.name === f.name && f.from <= o.to + 0.02)
        if (same) same.to = Math.max(same.to, f.to)
        else out.push({ from: f.from, to: f.to, name: f.name })
      }
      return out.map((o) => ({ ...o, from: Math.round(o.from * 1000) / 1000, to: Math.round(o.to * 1000) / 1000 }))
    }
    const outline = makeOutline(ctx.stage, {
      base: () => history?.plan ?? plan,
      say,
      view,
      yard: (p) => {
        paper = p
        tidyYard()
      },
      apply: (d: Draft) => {
        const h = history
        if (!h) return
        // The head can move after the outline was fitted (another page saved first): fit again on the house as it stands, under an id still free in it.
        const draft = { ...d, roomId: freshId(h.plan, d.roomId), label: freshLabel(h.plan, d.label) }
        const fitted = fit(h.plan, draft)
        if ('ask' in fitted) {
          outline.close()
          return say(fitted.ask)
        }
        const what = /^New room( \d+)?$/.test(draft.label) ? 'Added a room' : `Added the ${draft.label.toLowerCase()}`
        committing = true
        const base = h.plan
        // The room arrives with its first pieces, in the same version: one undo takes both away. They are laid against the
        // same scan of the house the ghosts were, so what is built stands exactly where the ghosts stood.
        const pieces = outline.piecesFor(h.plan, fitted.plan, draft)
        h.commit([...draftEdits(h.plan, draft), ...pieces.map((furniture): Edit => ({ op: 'placeItem', furniture }))], what).then(() => {
          rising = settling = { room: draft.roomId, at: performance.now() }
          movein?.start(base, fitted.plan, draft, pieces, RISE_MS, asker)
          committing = false
          outline.close()
          selectWall(null)
        }, (e) => {
          committing = false
          // Only a stale head means something moved; anything else is the house not being kept right now.
          say(e instanceof ReadOnly ? e.reasons[0] : e instanceof StaleHead ? 'Something moved while I was drawing that. Shall we try again?' : "I couldn't save that just now. Shall we try again in a moment?")
        })
      },
    })
    /** Resolve an intent now; the outline is up before this returns, or one line says why not. */
    const take = (raw: unknown, ack?: string, person?: string) => {
      asker = person ?? null
      const checked = checkIntent(raw)
      if ('reason' in checked) return say("I didn't quite catch where the room should go. Could you say it another way?")
      const r = resolve(history?.plan ?? plan, checked.intent, { view: view(), selected: selected && { wallId: selected.wallId, t: selected.t }, current: inView(), occupied })
      if ('ask' in r) return say(r.ask)
      movein?.release()
      if (!outline.open(r.draft)) return
      say(r.note ?? ack ?? 'Like this?')
    }
    ctx.on('village/build-intent', (request) => {
      request.handled = true
      reply = request.reply
      if (history) take(request.intent, request.say, request.person)
      else void opened.then(() => take(request.intent, request.say, request.person))
    })
    if (MODE === 'iso') {
      ctx.effect(() => {
        const listening = new AbortController()
        const opts = { capture: true, signal: listening.signal }
        addEventListener('pointerdown', onDown, opts)
        addEventListener('pointermove', onMove, opts)
        addEventListener('pointerup', onUp, opts)
        addEventListener('keydown', onKey, opts)
        addEventListener('pointerdown', onPress, opts)
        addEventListener('pointerup', onRelease, opts)
        return () => {
          listening.abort()
          renderer.domElement.style.cursor = ''
        }
      }, 'build handles')
    }

    // In iso the dollhouse view framed the kitchen; once the house reaches past it, the view eases back and over so
    // all of it is in the picture. While a room is proposed, the view glides (keeping its turn) to frame the outline,
    // the shared wall and the door mark in the proposal box, again after each change but never while a grip is held,
    // and Not now glides back to where it was. A pure slide on top of camera.ts's pose: the camera keeps its angle.
    const framing = { right: 0, up: 0, back: 0 }
    let goal = { ...framing }, held = goal
    const fwd = new THREE.Vector3(), right = new THREE.Vector3(), up = new THREE.Vector3(), q = new THREE.Vector3()
    /** The slide that puts these points inside a screen box (NDC), in the camera as camera.ts posed it this frame. */
    const holdIn = (pts: THREE.Vector3[], box: Box, closer = 0) => {
      camera.updateMatrixWorld()
      const tan = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, depth = 0
      for (const p of pts) {
        q.copy(p).applyMatrix4(camera.matrixWorldInverse)
        x0 = Math.min(x0, q.x); x1 = Math.max(x1, q.x); y0 = Math.min(y0, q.y); y1 = Math.max(y1, q.y)
        depth += -q.z
      }
      depth /= pts.length
      const bw = (box.x[1] - box.x[0]) / 2, bh = (box.y[1] - box.y[0]) / 2
      const need = Math.max((x1 - x0) / 2 / (tan * camera.aspect * bw), (y1 - y0) / 2 / (tan * bh))
      // At most 10 m further: on a narrow phone the whole house would put the camera past the far plane.
      const back = Math.min(10, Math.max(-closer, need - depth))
      const D = depth + back
      return {
        right: (x0 + x1) / 2 - ((box.x[0] + box.x[1]) / 2) * tan * camera.aspect * D,
        up: (y0 + y1) / 2 - ((box.y[0] + box.y[1]) / 2) * tan * D,
        back,
      }
    }
    /** What the proposal frames: the staked-out floor, the shared wall's ends at full height, and the door mark. */
    const proposalPoints = () => {
      const d = outline.draft(), made = outline.made()
      const room = d && made?.rooms.find((r) => r.id === d.roomId)
      if (!d || !made || !room) return null
      const geo = draftGeometry(history?.plan ?? plan, d)
      return [...lift(ringOf(made, room, -0.35), 0.02), ...lift([geo.p, geo.q], geo.height), ...lift([geo.at((d.door.from + d.door.to) / 2, 0)], 2.3)]
    }
    let before: Required<Frame> | null = null
    let wasStill = false
    let shaped = ''
    let hadDraft = false
    const proposalGlide = () => {
      const d = outline.draft()
      if (d && !hadDraft) {
        before = { ...ctx.view.frame }
        shaped = ''
      }
      if (d && !outline.dragging()) {
        const key = JSON.stringify([d.from, d.to, d.depth, d.bend, d.door])
        const pts = key !== shaped ? proposalPoints() : null
        if (pts) {
          shaped = key
          void ctx.view.glide(fitFrame(pts, ctx.view.frame.yaw, PROPOSAL_BOX, camera.aspect, 0.55).frame, hadDraft ? 0.7 : 1.0)
        }
      }
      // Not now (the outline went away without a room): back to where the view was.
      if (!d && hadDraft && !committing && before && !movein?.holding()) void ctx.view.glide(before, 0.9)
      if (!d) before = null
      hadDraft = Boolean(d)
    }
    const frameHouse = (dt: number) => {
      const shown = outline.made() ?? plan
      proposalGlide()
      const reveal = movein?.framing(dt)
      const pts = outline.draft() ? proposalPoints() : null
      // The view holds still while something is being dragged, so the floor stays under the pointer.
      if (outline.dragging() || drag) goal = held
      else if (reveal) goal = reveal
      else if (pts) goal = holdIn(pts, PROPOSAL_BOX, 1.5)
      else if (shown.rooms.some((r) => !BASE_ROOMS.has(r.id))) {
        // Fit every room's footprint, floor to wall top.
        const all = shown.rooms.flatMap((r) => [...lift(ringOf(shown, r, -0.6), 0), ...lift(ringOf(shown, r, -0.6), 3)])
        const h = holdIn(all, { x: [-1 / 1.12, 1 / 1.12], y: [-1 / 1.12, 1 / 1.12] })
        goal = { ...h, back: Math.max(0, h.back) }
      } else goal = { right: 0, up: 0, back: 0 }
      held = goal
      // Never mid-drag: the slide stands still too, so the floor stays under the pointer.
      const still = outline.dragging() || Boolean(drag)
      if (still && !wasStill) void ctx.view.glide({ ...ctx.view.frame }, 0)
      wasStill = still
      const e = still ? 0 : 1 - Math.exp(-dt * 3)
      framing.right += (goal.right - framing.right) * e
      framing.up += (goal.up - framing.up) * e
      framing.back += (goal.back - framing.back) * e
      backEl.classList.toggle('shown', Boolean(movein?.holding()) && !outline.draft())
      if (Math.abs(framing.right) + Math.abs(framing.up) + Math.abs(framing.back) < 1e-4) return
      camera.getWorldDirection(fwd)
      right.setFromMatrixColumn(camera.matrixWorld, 0)
      up.setFromMatrixColumn(camera.matrixWorld, 1)
      camera.position.addScaledVector(right, framing.right).addScaledVector(up, framing.up).addScaledVector(fwd, -framing.back)
      camera.updateMatrixWorld()
      // The camera slid the fog back for its own distance this frame; slide it back by ours too.
      if (scene.fog instanceof THREE.Fog) {
        scene.fog.near += framing.back
        scene.fog.far += framing.back
      }
    }

    let sun = 0
    const DAYLIGHT = kit.daylight.color.clone(), SUN_POOL = new THREE.Color('#ffc46e')
    ctx.on('village/frame', (dt: number) => {
      if (MODE === 'iso' && built) frameHouse(dt)
      if (roomGroup && !inScene(roomGroup)) {
        // room.ts went away (unload or hot reload): give back what was set aside and wait for the new one.
        restore()
        roomGroup = null
      }
      if (!roomGroup) return trySwap()
      if (plan !== builtPlan) rebuild(plan, false)
      // The sun may come after the first rebuild on a page that opens with rooms already built: until it is
      // found, look for it, but only when a room beyond the base house needs a bigger shadow box.
      if (!sunWas && MODE !== 'seat' && !sunLight?.parent && builtPlan && builtBeyondBase(builtPlan)) fitSun(builtPlan)
      raise()
      settle()
      if (movein) {
        const m = movein.state()
        // The room was undone or reshaped: the villager goes back to their chores if it is gone, and the spot's floor follows it.
        if (m.room) movein.sync(plan)
        movein.frame()
      }
      // While the reveal holds the view, from the moment the villager steps in, the new room is the lit subject: its
      // window's patch of sun warms up, and cools back once the view lets go.
      const m = movein?.state()
      const lit = m && m.held && (m.phase === 'crossing' || m.phase === 'settled') ? 1 : 0
      sun += (lit - sun) * (1 - Math.exp(-dt * 1.6))
      kit.daylight.opacity = 0.55 + 0.4 * sun
      kit.daylight.color.copy(DAYLIGHT).lerp(SUN_POOL, sun)
      lot.frame(dt)
      if (built?.shell) {
        const c = curveOf(plan, wallOf(plan, WALL))
        const [x, z] = pointAt(c, c.length / 2)
        const [nx, nz] = normalAt(c, c.length / 2)
        if (cut()) dot.position.set(x, STUB + 0.025, z)
        else dot.position.set(x - nx * 0.45, 0.02, z - nz * 0.45)
        tag.position.set(x - nx * 1.6, 1.5, z - nz * 1.6)
        dot.visible = rightFree() && !outline.draft() && !history?.readOnly
      }
      outline.frame()
    })

    ctx.effect(() => {
      const api = {
        ready,
        /** Resolves with the plan history once it is open. */
        history: () => opened,
        plan: () => plan,
        /** The last line build mode put on screen by itself (not through the notepad). */
        noted: () => noteEl.textContent,
        /** The lawn's outline as the lot draws it (world x, z), or null while the old board stands. */
        lawn: () => lot.lawn(),
        /** The room being drawn: its draft, grips on screen, typed sizes, build or let go. */
        outline: {
          draft: () => outline.draft(),
          pieces: () => outline.pieces(),
          shownAt: () => outline.shownAt(),
          grips: () => outline.grips(),
          setNumber: (dim: 'w' | 'd', v: number) => outline.setNumber(dim, v, false),
          confirm: () => outline.confirm(),
          cancel: () => outline.cancel(),
        },
        /** An intent as the notepad would deliver it, without the notepad. */
        intent: (raw: unknown, person?: string) => take(raw, undefined, person),
        said: () => said.slice(),
        /** Built-ins against a wall's faces in the house as it stands, and how long each scan took (ms). */
        fixtures: (wallId: string) => fixtures.on(history?.plan ?? plan, wallId),
        fixtureScans: () => fixtures.times(),
        selected: () => selected && { wallId: selected.wallId, t: selected.t },
        /** A wall point on screen (CSS px), y metres up, d metres off the centreline toward the room it bounds first. */
        wallPoint: (wallId: string, t: number, y = 1.2, d = 0) => {
          const c = curveOf(plan, wallOf(plan, wallId))
          const [x, z] = pointAt(c, t)
          const [nx, nz] = normalAt(c, t)
          const owner = roomsOf(plan, wallId)[0]
          const k = (owner && !runsForward(plan, owner, wallId) ? 1 : -1) * d
          const v = new THREE.Vector3(x + nx * k, y, z + nz * k).project(camera)
          const rect = renderer.domElement.getBoundingClientRect()
          return [rect.left + ((v.x + 1) / 2) * rect.width, rect.top + ((1 - v.y) / 2) * rect.height]
        },
        /** The first generated wall piece a level ray meets within `far` metres, whatever the cutaway shows (full walls only). */
        wallHit: (from: [number, number, number], dir: [number, number, number], far = 3) => {
          if (!built) return null
          const ray = new THREE.Raycaster(new THREE.Vector3(...from), new THREE.Vector3(...dir).normalize(), 0, far)
          ray.layers.enableAll()
          const hit = ray.intersectObjects(meshes(built).filter((m) => m.userData.wall && !m.userData.cutaway), false)[0]
          return hit ? { wall: hit.object.userData.wall as string, distance: +hit.distance.toFixed(3), part: hit.object.parent?.name ?? '' } : null
        },
        /** Floors drawn, one per room. */
        floors: () => (built ? meshes(built).filter((m) => m.name === 'build floor' || m.name === 'build room floor').length : 0),
        rebuildMs: () => rebuildMs,
        /** Screen points (CSS px) of the right wall's move and bend handles. */
        handles: () => {
          const c = curveOf(plan, wallOf(plan, WALL))
          const y = cut() ? STUB : 1.2
          const at = (t: number) => {
            const [x, z] = pointAt(c, t)
            const v = new THREE.Vector3(x, y, z).project(camera)
            const rect = renderer.domElement.getBoundingClientRect()
            return [rect.left + ((v.x + 1) / 2) * rect.width, rect.top + ((1 - v.y) / 2) * rect.height]
          }
          return { move: at(c.length * 0.2), bend: at(c.length / 2) }
        },
        /** A world point on screen, in CSS px. */
        project: (x: number, y: number, z: number) => {
          const v = new THREE.Vector3(x, y, z).project(camera)
          const rect = renderer.domElement.getBoundingClientRect()
          return [rect.left + ((v.x + 1) / 2) * rect.width, rect.top + ((1 - v.y) / 2) * rect.height]
        },
        /** Area of the generated dollhouse floor mesh, in square metres. */
        floorArea: () => {
          let a = 0
          const [p0, p1, p2] = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()]
          for (const m of built ? meshes(built).filter((k) => k.name === 'build floor') : []) {
            m.updateWorldMatrix(true, false)
            const p = m.geometry.attributes.position as THREE.BufferAttribute
            const idx = m.geometry.index!.array
            for (let i = 0; i < idx.length; i += 3) {
              p0.fromBufferAttribute(p, idx[i]).applyMatrix4(m.matrixWorld)
              p1.fromBufferAttribute(p, idx[i + 1]).applyMatrix4(m.matrixWorld)
              p2.fromBufferAttribute(p, idx[i + 2]).applyMatrix4(m.matrixWorld)
              a += Math.abs((p1.x - p0.x) * (p2.z - p0.z) - (p2.x - p0.x) * (p1.z - p0.z)) / 2
            }
          }
          return a
        },
        /** Every generated wall piece as drawn now: its wall, timber (a door's frame), a door's threshold or plaster, its box, and whether it shows. */
        walls: () => {
          const box = new THREE.Box3()
          const seen = (o: THREE.Object3D) => shown(o) && o.layers.isEnabled(0)
          return (built ? meshes(built) : []).filter((m) => m.userData.wall).map((m) => {
            box.setFromObject(m)
            return { wall: m.userData.wall as string, timber: m.material === kit.timber, threshold: m.name === 'build door threshold', stub: Boolean(m.userData.cutaway), x: +((box.min.x + box.max.x) / 2).toFixed(3), z0: +box.min.z.toFixed(3), z1: +box.max.z.toFixed(3), y0: +box.min.y.toFixed(3), y1: +box.max.y.toFixed(3), shown: seen(m) }
          })
        },
        /** The house's things hung on a wall now cut low, which go and come back with it: their box and whether they show. */
        hung: () => [...hung.keys()].map((o) => {
          const box = new THREE.Box3().setFromObject(o)
          return { name: o.name || o.parent?.name || '', z0: +box.min.z.toFixed(3), z1: +box.max.z.toFixed(3), y0: +box.min.y.toFixed(3), shown: shown(o) && o.layers.isEnabled(0) }
        }),
        wallX: () => {
          const m = built && meshes(built).find((o) => o.userData.wall === WALL && !o.userData.cutaway && o.material === kit.handleWall)
          return m?.position.x ?? null
        },
      }
      // How far the move-in has got, and the way back out, for the checks.
      if (movein) Object.assign(api, { reveal: () => movein.state(), back: () => backToHouse(), backShown: () => backEl.classList.contains('shown') })
      Object.assign(window, { villageBuild: api })
      return () => {
        delete (window as unknown as { villageBuild?: unknown }).villageBuild
        offHistory()
        outline.dispose()
        mark.removeFromParent()
        mark.geometry.dispose()
        ;(mark.material as THREE.Material).dispose()
        for (const m of glowOf.values()) m.dispose()
        hangLow([])
        yard.restore()
        lot.dispose()
        const sun = scene.getObjectByName('sun') as THREE.DirectionalLight | undefined
        if (sunWas && sun?.isDirectionalLight) {
          Object.assign(sun.shadow.camera, sunWas)
          sun.shadow.camera.updateProjectionMatrix()
        }
        restore()
        for (const m of [kit.seatWall, kit.shellWall, kit.loungeWall, kit.handleWall, kit.trim, kit.loungeTrim, kit.timber, kit.threshold, kit.cut, kit.seatFloor, kit.isoFloor, kit.loungeFloor, kit.shadow, kit.glass, kit.daylight]) {
          m.map?.dispose()
          m.dispose()
        }
      }
    }, 'build swap')
  },
}

/** How far a wall moved between two plans, along its normal. */
function moveAmount(from: Plan, to: Plan): number {
  const a = curveOf(from, wallOf(from, WALL)), b = curveOf(to, wallOf(to, WALL))
  return Math.round(((b.a[0] - a.a[0]) * a.normal[0] + (b.a[1] - a.a[1]) * a.normal[1]) * 1e6) / 1e6
}

if (import.meta.hot) import.meta.hot.accept((m) => m && replace(m.default))
