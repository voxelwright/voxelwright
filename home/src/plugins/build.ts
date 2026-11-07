import * as THREE from 'three/webgpu'
import type { Context } from 'cordis'
import { own, releaseGpu, replace } from '../kernel'
import { canvas, paintGlow, toTexture } from '../paint'
import { MODE } from './camera'
import { KITCHEN, apply, curveOf, normalAt, pointAt, polygonArea, wallOf, type Edit, type Plan } from '../build/plan'
import { build, innerOutline, makeKit, type Built } from '../build/walls'

/**
 * #48 experiment, ?build=1 only: the kitchen's walls and floor come from a floor
 * plan (src/build/plan.ts) instead of room.ts and diorama.ts, and in ?cam=iso the
 * right wall can be dragged (moves it) or pulled at its middle (bends it).
 * Without the flag this plugin does nothing.
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
    let plan: Plan = KITCHEN
    let builtPlan: Plan | null = null
    let built: Built | null = null
    const rebuildMs: number[] = []
    const edits: Edit[] = []

    // What room.ts and diorama.ts built, set aside while the plan's version stands in.
    let stash: Array<{ object: THREE.Object3D; parent: THREE.Object3D; order: THREE.Object3D[] }> = []
    let roomGroup: THREE.Object3D | null = null
    let swapped: () => void = () => {}
    const ready = new Promise<void>((done) => (swapped = done))

    const meshes = (b: Built) => [...b.seat.children, ...(b.shell?.children ?? []), ...(b.floor ? [b.floor] : [])] as THREE.Mesh[]
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
        if (built) for (const part of [built.seat, built.shell, built.floor]) if (part) {
          part.removeFromParent()
          part.traverse((o) => (o as THREE.Mesh).geometry?.dispose())
        }
        built = fresh
        for (const part of [fresh.seat, fresh.shell, fresh.floor]) if (part) group.add(part)
        if (before) copyState(before, meshes(fresh))
      }
      builtPlan = next
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
    const tag = new THREE.Sprite(new THREE.SpriteNodeMaterial({ map: tagMap, transparent: true, depthTest: false, fog: false }))
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
    const pick = (e: PointerEvent): Hit | null => {
      if (!built?.shell) return null
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
    const end = (cancel: boolean) => {
      if (!drag) return
      if (cancel) plan = drag.from
      else if (drag.edit && plan !== drag.from) edits.push({ ...drag.edit, ...(drag.edit.op === 'moveWall' ? { by: moveAmount(drag.from, plan) } : { sagitta: wallOf(plan, WALL).sagitta }) } as Edit)
      drag = null
      rebuild(plan, true)
      show()
    }
    const onUp = (e: PointerEvent) => {
      if (!drag) return
      stop(e)
      end(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || !drag) return
      stop(e)
      end(true)
    }
    if (MODE === 'iso') {
      ctx.effect(() => {
        addEventListener('pointerdown', onDown, true)
        addEventListener('pointermove', onMove, true)
        addEventListener('pointerup', onUp, true)
        addEventListener('keydown', onKey, true)
        return () => {
          removeEventListener('pointerdown', onDown, true)
          removeEventListener('pointermove', onMove, true)
          removeEventListener('pointerup', onUp, true)
          removeEventListener('keydown', onKey, true)
          renderer.domElement.style.cursor = ''
        }
      }, 'build handles')
    }

    ctx.on('village/frame', () => {
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
      }
    })

    ctx.effect(() => {
      const api = {
        ready,
        plan: () => plan,
        edits: () => edits,
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
        restore()
        for (const m of [kit.seatWall, kit.shellWall, kit.handleWall, kit.trim, kit.cut, kit.seatFloor, kit.isoFloor, kit.shadow]) {
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
