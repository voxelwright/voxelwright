import * as THREE from 'three/webgpu'
import type { Context } from 'cordis'
import { own, releaseGpu, replace } from '../kernel'
import { canvas, paintGlow, toTexture } from '../paint'
import { MODE } from './camera'
import { KITCHEN, apply, curveOf, normalAt, outline as ringOf, pointAt, polygonArea, roomWalls, wallOf, type Edit, type P, type Plan } from '../build/plan'
import { build, innerOutline, makeKit, type Built } from '../build/walls'
import type { PlanHistory } from '../build/history'
import { house } from '../build/house'
import { checkIntent } from '../build/intent'
import { draftEdits, resolve, type Draft } from '../build/resolve'
import { makeOutline } from '../build/outline'

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
export interface BuildRequest { intent: unknown; say?: string; reply: (text: string) => void; handled?: boolean }

/**
 * #48 experiment, ?build=1 only: the kitchen's walls and floor come from a floor
 * plan (src/build/plan.ts) instead of room.ts and diorama.ts, and in ?cam=iso the
 * right wall can be dragged (moves it) or pulled at its middle (bends it).
 * The house is a versioned plan (src/build/history.ts): a drag, a bend or an added
 * room is one committed version, and Ctrl/Cmd+Z and Shift+Ctrl/Cmd+Z step through
 * them. Saying "add a room…" on the notepad, or clicking a wall and saying "open a
 * door here into a new room", draws the room's outline to adjust, then build or
 * let go (src/build/outline.ts). Without the flag this plugin does nothing.
 */
const ENABLED = new URLSearchParams(location.search).get('build') === '1'
const WALL = 'kitchen.right'
const STUB = 0.42
const HAND = '"Bradley Hand", "Segoe Print", "Comic Sans MS", cursive'

export default {
  name: 'build',
  inject: ['stage'],
  apply(ctx: Context) {
    if (!ENABLED) return
    const { scene, camera, renderer } = ctx.stage
    const kit = makeKit()
    const group = own(ctx, new THREE.Group())
    group.name = 'build'
    const room = KITCHEN.rooms[0].id
    /** What is drawn: the history's head, or a drag's live preview on top of it. */
    let plan: Plan = KITCHEN
    let history: PlanHistory | null = null
    let offHistory = () => {}
    let committing = false
    const opened = house().then((h) => {
      history = h
      plan = h.plan
      offHistory = h.onChange((p) => {
        if (!drag) plan = p
        // The outline's own commit is not a change under it.
        if (!committing) outline.refit()
      })
      return h
    })
    let builtPlan: Plan | null = null
    let built: Built | null = null
    const rebuildMs: number[] = []
    const edits: Edit[] = []

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

    const rebuild = (next: Plan, final: boolean) => {
      const start = performance.now()
      const fresh = build(next, next.rooms.find((r) => r.id === room)!, kit, { iso: MODE === 'iso', handle: WALL, final })
      if (built && meshes(built).length === meshes(fresh).length) {
        // Same pieces: move the new geometry into the meshes the camera already tracks, so cutaway state holds.
        const old = meshes(built)
        meshes(fresh).forEach((m, i) => {
          old[i].geometry.dispose()
          old[i].geometry = m.geometry
          old[i].position.copy(m.position)
          old[i].rotation.copy(m.rotation)
          old[i].userData.inward = m.userData.inward
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
      highlight()
      rebuildMs.push(performance.now() - start)
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
      const r = scene.getObjectByName('room')
      const d = MODE === 'iso' ? scene.getObjectByName('diorama') : null
      if (!r || (MODE === 'iso' && !d)) return
      const oldShell = d?.children.find((o) => o.name === 'diorama shell')
      const oldFloor = d?.children.find((o) => o.name === 'diorama floor')
      if (MODE === 'iso' && (!oldShell || !oldFloor)) return
      rebuild(plan, true)
      copyState(r.children, built!.seat.children)
      if (oldShell) copyState(oldShell.children, built!.shell!.children)
      for (const o of [...r.children]) setAside(o)
      if (oldShell) setAside(oldShell)
      if (oldFloor) setAside(oldFloor)
      roomGroup = r
      swapped()
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
      const ring = innerOutline(p, p.rooms[0])
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
      return Boolean(w && w.a === 'kitchen.back-right' && w.b === 'kitchen.front-right' && !plan.rooms.slice(1).some((r) => roomWalls(plan, r).some(({ wall }) => wall.id === WALL)))
    }
    const pick = (e: PointerEvent): Hit | null => {
      if (!built?.shell || outline.draft() || !rightFree()) return null
      const c = curveOf(plan, wallOf(plan, WALL))
      for (const y of cut() ? [STUB] : [STUB, 1.2, 2.0, 2.8]) {
        const p = onPlane(e, y)
        if (!p) continue
        let best = Infinity, bestT = 0
        for (let i = 0; i <= 64; i++) {
          const t = (c.length * i) / 64
          const [x, z] = pointAt(c, t)
          const dist = Math.hypot(p.x - x, p.z - z)
          if (dist < best) [best, bestT] = [dist, t]
        }
        if (best > 0.32) continue
        return { kind: Math.abs(bestT - c.length / 2) < 0.6 ? 'bend' : 'move', y, at: p }
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
        edits.push(edit)
        void h.commit([edit], d.kind === 'move' ? 'Moved the wall' : 'Bent the wall').catch(() => {
          edits.pop()
          plan = h.plan
        })
      }
      rebuild(plan, true)
      show()
    }
    const onUp = (e: PointerEvent) => {
      if (!drag) return
      stop(e)
      const still = !drag.edit
      const at = drag.at
      end(false)
      // A press on the wall that did not move it picks the wall.
      if (still) selectAt(e, at)
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
        const owner = plan.rooms.find((r) => roomWalls(plan, r).some(({ wall }) => wall.id === next.wallId))
        const forward = owner ? roomWalls(plan, owner).find(({ wall }) => wall.id === next.wallId)!.forward : true
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
      const c = curveOf(plan, wallOf(plan, wallId))
      let best = Infinity, t = 0
      for (let i = 0; i <= 128; i++) {
        const u = (c.length * i) / 128
        const [x, z] = pointAt(c, u)
        const dist = Math.hypot(hit.point.x - x, hit.point.z - z)
        if (dist < best) [best, t] = [dist, u]
      }
      return { wallId, t: Math.round(t * 100) / 100, point: hit.point.clone() }
    }
    const selectAt = (e: PointerEvent, _at?: THREE.Vector3) => {
      const w = wallAt(e)
      selectWall(w)
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
    const said: string[] = []
    const say = (text: string) => {
      said.push(text)
      reply(text)
    }
    const view = (): P => {
      const f = camera.getWorldDirection(new THREE.Vector3())
      return Math.hypot(f.x, f.z) > 1e-3 ? [f.x, f.z] : [0, -1]
    }
    /** The room the camera looks at: where its centre ray meets the floor. */
    const inView = () => {
      raycaster.setFromCamera(new THREE.Vector2(0, 0), camera)
      const p = raycaster.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), new THREE.Vector3())
      if (!p) return null
      return plan.rooms.find((r) => contains(ringOf(plan, r), [p.x, p.z]))?.id ?? null
    }
    const outline = makeOutline(ctx.stage, {
      base: () => history?.plan ?? plan,
      say,
      view,
      cancel: () => {},
      apply: (d: Draft) => {
        const h = history
        if (!h) return
        const note = d.label === 'New room' ? 'Added a room' : `Added the ${d.label.toLowerCase()}`
        committing = true
        h.commit(draftEdits(h.plan, d), note).then(() => {
          committing = false
          outline.close()
          selectWall(null)
        }, () => {
          committing = false
          say('Something moved while I was drawing that. Shall we try again?')
        })
      },
    })
    /** Resolve an intent now; the outline is up before this returns, or one line says why not. */
    const take = (raw: unknown, ack?: string) => {
      const checked = checkIntent(raw)
      if ('reason' in checked) return say("I didn't quite catch where the room should go. Could you say it another way?")
      const r = resolve(history?.plan ?? plan, checked.intent, { view: view(), selected: selected && { wallId: selected.wallId, t: selected.t }, current: inView() })
      if ('ask' in r) return say(r.ask)
      if (!outline.open(r.draft)) return
      say(ack ?? 'Like this?')
    }
    ctx.on('village/build-intent', (request) => {
      request.handled = true
      reply = request.reply
      if (history) take(request.intent, request.say)
      else void opened.then(() => take(request.intent, request.say))
    })
    if (MODE === 'iso') {
      ctx.effect(() => {
        addEventListener('pointerdown', onDown, true)
        addEventListener('pointermove', onMove, true)
        addEventListener('pointerup', onUp, true)
        addEventListener('keydown', onKey, true)
        addEventListener('pointerdown', onPress, true)
        addEventListener('pointerup', onRelease, true)
        return () => {
          removeEventListener('pointerdown', onPress, true)
          removeEventListener('pointerup', onRelease, true)
          removeEventListener('pointerdown', onDown, true)
          removeEventListener('pointermove', onMove, true)
          removeEventListener('pointerup', onUp, true)
          removeEventListener('keydown', onKey, true)
          renderer.domElement.style.cursor = ''
        }
      }, 'build handles')
    }

    // In iso the dollhouse view framed the kitchen; once the house (or a room being drawn) reaches past it,
    // the view eases back and over so all of it is in the picture. A pure move: the camera keeps its angle.
    const framing = { right: 0, up: 0, back: 0 }
    let goal = { ...framing }, held = goal
    const fwd = new THREE.Vector3(), right = new THREE.Vector3(), up = new THREE.Vector3(), q = new THREE.Vector3()
    const frameHouse = (dt: number) => {
      const shown = outline.made() ?? plan
      // The view holds still while something is being dragged, so the floor stays under the pointer.
      if (outline.dragging() || drag) goal = held
      else if (shown.rooms.length > 1) {
        // Fit every room's footprint, floor to wall top, in the camera as camera.ts posed it this frame.
        camera.updateMatrixWorld()
        const tan = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))
        let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, depth = 0, n = 0
        // While a room is drawn, the view centres on it (a phone cannot take in the whole house); after, on the house.
        const drafted = outline.draft()
        const fitted = drafted ? shown.rooms.filter((r) => r.id === drafted.roomId) : shown.rooms
        for (const r of fitted) for (const [x, z] of ringOf(shown, r, drafted ? -1.4 : -0.6)) for (const y of [0, 3]) {
          q.set(x, y, z).applyMatrix4(camera.matrixWorldInverse)
          x0 = Math.min(x0, q.x); x1 = Math.max(x1, q.x); y0 = Math.min(y0, q.y); y1 = Math.max(y1, q.y)
          depth += -q.z
          n++
        }
        depth /= n
        const need = Math.max((x1 - x0) / 2 / (tan * camera.aspect), (y1 - y0) / 2 / tan) * 1.12
        // At most 10 m further: on a narrow phone the whole house would put the camera past the far plane.
        goal = { right: (x0 + x1) / 2, up: (y0 + y1) / 2, back: Math.min(10, Math.max(0, need - depth)) }
      } else goal = { right: 0, up: 0, back: 0 }
      held = goal
      const e = 1 - Math.exp(-dt * 3)
      framing.right += (goal.right - framing.right) * e
      framing.up += (goal.up - framing.up) * e
      framing.back += (goal.back - framing.back) * e
      if (Math.abs(framing.right) + Math.abs(framing.up) + framing.back < 1e-4) return
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

    ctx.on('village/frame', (dt: number) => {
      if (MODE === 'iso' && built) frameHouse(dt)
      if (roomGroup && !inScene(roomGroup)) {
        // room.ts went away (unload or hot reload): give back what was set aside and wait for the new one.
        restore()
        roomGroup = null
      }
      if (!roomGroup) return trySwap()
      if (plan !== builtPlan) rebuild(plan, false)
      if (built?.shell) {
        const c = curveOf(plan, wallOf(plan, WALL))
        const [x, z] = pointAt(c, c.length / 2)
        const [nx, nz] = normalAt(c, c.length / 2)
        dot.position.set(x, (cut() ? STUB + 0.025 : 0.02), z)
        if (!cut()) dot.position.set(x - nx * 0.45, 0.02, z - nz * 0.45)
        tag.position.set(x - nx * 1.6, 1.5, z - nz * 1.6)
        dot.visible = rightFree() && !outline.draft()
      }
      outline.frame()
    })

    ctx.effect(() => {
      const api = {
        ready,
        /** Resolves with the plan history once it is open. */
        history: () => opened,
        plan: () => plan,
        edits: () => edits,
        /** The room being drawn: its draft, grips on screen, typed sizes, build or let go. */
        outline: {
          draft: () => outline.draft(),
          shownAt: () => outline.shownAt(),
          grips: () => outline.grips(),
          setNumber: (dim: 'w' | 'd', v: number) => outline.setNumber(dim, v, false),
          confirm: () => outline.confirm(),
          cancel: () => outline.cancel(),
        },
        /** An intent as the notepad would deliver it, without the notepad. */
        intent: (raw: unknown) => take(raw),
        said: () => said.slice(),
        selected: () => selected && { wallId: selected.wallId, t: selected.t },
        /** A wall point on screen (CSS px), y metres up, d metres off the centreline toward the room it bounds first. */
        wallPoint: (wallId: string, t: number, y = 1.2, d = 0) => {
          const c = curveOf(plan, wallOf(plan, wallId))
          const [x, z] = pointAt(c, t)
          const [nx, nz] = normalAt(c, t)
          const owner = plan.rooms.find((r) => roomWalls(plan, r).some(({ wall }) => wall.id === wallId))
          const k = (owner && !roomWalls(plan, owner).find(({ wall }) => wall.id === wallId)!.forward ? 1 : -1) * d
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
          const geo = built?.floor?.geometry
          if (!geo) return 0
          const p = geo.attributes.position as THREE.BufferAttribute
          const idx = geo.index!.array
          let a = 0
          for (let i = 0; i < idx.length; i += 3) {
            const [i0, i1, i2] = [idx[i], idx[i + 1], idx[i + 2]]
            a += Math.abs((p.getX(i1) - p.getX(i0)) * (p.getZ(i2) - p.getZ(i0)) - (p.getX(i2) - p.getX(i0)) * (p.getZ(i1) - p.getZ(i0))) / 2
          }
          return a
        },
        wallX: () => {
          const m = built?.shell?.children.find((o) => o.userData.wall === WALL && !o.userData.cutaway && (o as THREE.Mesh).material === kit.handleWall)
          return m?.position.x ?? null
        },
      }
      Object.assign(window, { villageBuild: api })
      return () => {
        delete (window as unknown as { villageBuild?: unknown }).villageBuild
        offHistory()
        outline.dispose()
        mark.removeFromParent()
        mark.geometry.dispose()
        ;(mark.material as THREE.Material).dispose()
        for (const m of glowOf.values()) m.dispose()
        restore()
        for (const m of [kit.seatWall, kit.shellWall, kit.handleWall, kit.trim, kit.cut, kit.seatFloor, kit.isoFloor, kit.shadow]) {
          m.map?.dispose()
          m.dispose()
        }
      }
    }, 'build swap')
  },
}

const contains = (poly: P[], p: P) => {
  let hit = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i], [xj, zj] = poly[j]
    if (zi > p[1] !== zj > p[1] && p[0] < ((xj - xi) * (p[1] - zi)) / (zj - zi) + xi) hit = !hit
  }
  return hit
}

/** How far a wall moved between two plans, along its normal. */
function moveAmount(from: Plan, to: Plan): number {
  const a = curveOf(from, wallOf(from, WALL)), b = curveOf(to, wallOf(to, WALL))
  return Math.round(((b.a[0] - a.a[0]) * a.normal[0] + (b.a[1] - a.a[1]) * a.normal[1]) * 1e6) / 1e6
}

if (import.meta.hot) import.meta.hot.accept((m) => m && replace(m.default))
