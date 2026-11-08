import * as THREE from 'three/webgpu'
import type { Context } from 'cordis'
import { own, releaseGpu, replace } from '../kernel'
import { house } from '../build/house'
import type { PlanHistory } from '../build/history'
import { HOUSE_PLAN, type Furniture, type ItemRef, type Plan } from '../build/plan'
import { CORD, KINDS, cord, poseOf, seat, setPose, faceOf, type Size } from '../build/mount'
import { placement, type Placement, type PlaceItem, type Shelf } from '../build/place'
import { keepItem, libraryItem } from '../villager'

/** The service: placing plus, for furnishing's "another one like that", what a placed thing is. */
export interface PlacementService extends Placement {
  /** The plan item of the placed thing `object` is part of, or null when it is not plan furniture. */
  itemOf(object: THREE.Object3D): { furnitureId: string; item: ItemRef } | null
}

declare module 'cordis' {
  interface Context {
    placement: PlacementService
  }
}

/**
 * #48, #56: placing things, in every house. Provides the `placement` service
 * (src/build/place.ts) that build mode and #42's furnishing both use, and draws the
 * furniture in the house plan: built-in kinds at once, library items rebuilt from their
 * module text through the prop sandbox (dev builds). The placer itself (its decals,
 * styles and listeners) is made on the first begin or move, so an idle house pays only
 * for opening the plan and drawing what it holds. Wall editing stays behind build mode
 * (plugins/build.ts; on by default, ?build=0 turns it off).
 */

interface Drawn { holder: THREE.Group; size: Size; label: string; key: string; held: boolean }

export default {
  name: 'place',
  inject: ['stage'],
  apply(ctx: Context) {
    const ghosts = own(ctx, new THREE.Group())
    ghosts.name = 'placement'
    ghosts.userData.body = false // ghosts, not things (src/physics/home.ts)
    const things = own(ctx, new THREE.Group())
    things.name = 'placed things'
    let plan: Plan = HOUSE_PLAN
    let history: PlanHistory | null = null
    const opened = house()
    const drawn = new Map<string, Drawn>()
    /** Things undo took away, kept for redo. */
    const shelved = new Map<string, Drawn>()
    const building = new Set<string>()
    const failures: string[] = []

    // The prop sandbox and checks, as talk/furnish.ts uses them (dev builds only).
    let box: import('../props/sandbox').PropBox | null = null
    const tools = import.meta.env.DEV ? Promise.all([import('../props/sandbox'), import('../props/rebuild')]) : null
    const fromModule = async (module: string) => {
      if (!tools) throw new Error('the prop sandbox is only in dev builds')
      const [{ PropBox }, { validate, rebuild }] = await tools
      box ??= new PropBox()
      const result = await box.run(module)
      if (!result.ok) throw new Error(`sandbox: ${result.reason}`)
      const checked = validate(result.data)
      if ('reason' in checked) throw new Error(`rejected: ${checked.reason}`)
      return rebuild(checked.prop)
    }
    const shadows = (o: THREE.Object3D) => o.traverse((m) => {
      if ((m as THREE.Mesh).isMesh) m.castShadow = m.receiveShadow = true
    })
    const keyOf = (f: Furniture) => JSON.stringify(f.item)
    const withCord = (holder: THREE.Group, mount: string) => {
      if (mount === 'ceiling' && !holder.getObjectByName('cord')) holder.add(cord(CORD))
    }

    /** Pose a drawn thing from its anchor; a wall thing is hidden with its wall when the camera cuts it away. */
    const pose = (d: Drawn, f: Furniture) => {
      const p = poseOf(plan, f.at, d.size)
      if (!p) return
      setPose(d.holder, p)
      if (f.at.mount === 'wall') {
        const face = faceOf(plan, f.at.wallId, f.at.roomId, f.at.along)
        if (face) d.holder.userData.inward = new THREE.Vector3(face.inward[0], 0, face.inward[1])
      } else delete d.holder.userData.inward
    }
    const show = (f: Furniture, d: Drawn) => {
      // Placing reads this to know which placed thing a top belongs to (a surface anchor's `on`).
      d.holder.userData.furniture = f.id
      // A body of its own, static where the plan puts it: the plan is the record of where it stands (src/physics/home.ts).
      d.holder.userData.body = { material: 'walnut' }
      withCord(d.holder, f.at.mount)
      things.add(d.holder)
      drawn.set(f.id, d)
      pose(d, f)
    }
    const make = async (f: Furniture) => {
      if (building.has(f.id)) return
      building.add(f.id)
      try {
        let object: THREE.Object3D
        let label: string
        if ('kind' in f.item) {
          const kind = KINDS[f.item.kind]
          if (!kind) throw new Error(`no kind ${f.item.kind}`)
          object = kind.build()
          label = kind.label
        } else {
          const got = await libraryItem(f.item.person, f.item.library)
          if (!got.ok) throw new Error(`library item ${f.item.library}: ${got.why}`)
          object = await fromModule(got.module)
          label = got.name
        }
        shadows(object)
        const { holder, size } = seat(object, f.at.mount)
        const now = plan.furniture.find((k) => k.id === f.id)
        if (!now || drawn.has(f.id)) return releaseGpu(holder)
        show(now, { holder, size, label, key: keyOf(now), held: false })
      } catch (error) {
        failures.push(`${f.id}: ${String(error)}`)
        console.warn(`placed thing ${f.id} could not be drawn`, error)
      } finally {
        building.delete(f.id)
      }
    }
    const sync = () => {
      const ids = new Set(plan.furniture.map((f) => f.id))
      for (const [id, d] of drawn) {
        if (ids.has(id) || d.held) continue
        d.holder.removeFromParent()
        drawn.delete(id)
        shelved.set(id, d)
      }
      for (const f of plan.furniture) {
        const d = drawn.get(f.id)
        if (d) {
          if (!d.held) pose(d, f)
          continue
        }
        const back = shelved.get(f.id)
        if (back && back.key === keyOf(f)) {
          shelved.delete(f.id)
          show(f, back)
        } else void make(f)
      }
    }
    void opened.then((h) => {
      history = h
      plan = h.plan
      sync()
      ctx.effect(() => h.onChange((p) => {
        plan = p
        sync()
      }), 'placed things follow the plan')
    })

    const shelf: Shelf = {
      hold(id) {
        const d = drawn.get(id)
        if (!d) return null
        d.held = true
        return { holder: d.holder, size: d.size, label: d.label }
      },
      release(id) {
        const d = drawn.get(id)
        if (!d) return
        d.held = false
        const f = plan.furniture.find((k) => k.id === id)
        if (f) pose(d, f)
      },
      adopt(id, holder, size, label) {
        shadows(holder)
        // Held (not posed from the plan) and unkeyed until the session ends; settleAdopted takes it from there.
        things.add(holder)
        holder.userData.furniture = id
        holder.userData.body = { material: 'walnut' }
        drawn.set(id, { holder, size, label, key: '', held: true })
      },
      forget(id) {
        const d = drawn.get(id)
        if (!d) return
        drawn.delete(id)
        ghosts.add(d.holder)
      },
    }
    // A confirmed thing is held until the commit lands, then posed and keyed from the plan like the rest.
    const settleAdopted = () => {
      for (const [id, d] of drawn) {
        const f = plan.furniture.find((k) => k.id === id)
        if (d.held && !d.key && f) {
          d.key = keyOf(f)
          d.held = false
          withCord(d.holder, f.at.mount)
          pose(d, f)
        }
      }
    }

    const keep = async (person: string, item: string) => (await keepItem(person, item)).ok
    let placer: ReturnType<typeof placement> | null = null
    const placerNow = () => (placer ??= placement({ stage: ctx.stage, group: ghosts, history: () => opened, plan: () => plan, shelf, keep }))
    const service: PlacementService = {
      begin: (item, at) => {
        const p = placerNow().begin(item, at)
        void p.done.then(settleAdopted)
        return p
      },
      move: (id) => {
        const p = placerNow().move(id)
        void p.done.then(settleAdopted)
        return p
      },
      get active() {
        return placer?.active ?? null
      },
      itemOf(object) {
        for (let o: THREE.Object3D | null = object; o; o = o.parent) {
          const id = o.userData.furniture
          if (typeof id !== 'string') continue
          const f = plan.furniture.find((k) => k.id === id)
          return f ? { furnitureId: id, item: f.item } : null
        }
        return null
      },
    }
    ctx.provide('placement', service)
    ctx.on('village/frame', (dt: number) => placer?.frame(dt))

    // Dev and checks: begin placing a built-in thing of each mount without #42.
    ctx.effect(() => {
      const demo = {
        /** Begin placing a built-in kind (crate, vase, picture, pendant). */
        begin(kind: string, at?: Parameters<Placement['begin']>[1]) {
          const k = KINDS[kind]
          if (!k) throw new Error(`no kind ${kind}`)
          const object = k.build()
          shadows(object)
          const size = new THREE.Box3().setFromObject(object).getSize(new THREE.Vector3())
          const item: PlaceItem = { object, size: [size.x, size.y, size.z], mount: k.mount, label: k.label, item: { kind } }
          const placing = service.begin(item, at)
          void placing.done.then((d) => d.status === 'cancelled' && releaseGpu(object))
          return placing
        },
        /** Begin placing a thing whose prop is still being made: a box ghost now, the prop on swap. */
        beginMaking(mount: PlaceItem['mount'], label: string, size: [number, number, number]) {
          const ghost = new THREE.Mesh(new THREE.BoxGeometry(...size), new THREE.MeshStandardMaterial({ color: '#fff3dc', emissive: '#ffd9a6', emissiveIntensity: 0.35, transparent: true, opacity: 0.4 }))
          const placing = service.begin({ object: ghost, size, mount, label })
          void placing.done.then(() => releaseGpu(ghost))
          return placing
        },
        /** A prop built from library module text, for swap(). */
        fromModule,
        move: (id: string) => service.move(id),
        active: () => placer?.active ?? null,
        state: () => placer?.state() ?? null,
        project: (x: number, y: number, z: number) => placerNow().project(x, y, z),
        plan: () => plan,
        history: () => history,
        drawn: () => [...drawn].map(([id, d]) => ({ id, label: d.label, held: d.held, at: d.holder.position.toArray().map((v) => Math.round(v * 1000) / 1000), yaw: Math.round(d.holder.rotation.y * 1000) / 1000 })),
        building: () => building.size,
        failures: () => failures.slice(),
      }
      Object.assign(window, { villagePlace: demo })
      return () => {
        delete (window as unknown as { villagePlace?: unknown }).villagePlace
        placer?.dispose()
        placer = null
        box?.dispose()
        box = null
        for (const d of shelved.values()) releaseGpu(d.holder)
        shelved.clear()
        drawn.clear()
      }
    }, 'placement')
  },
}

if (import.meta.hot) import.meta.hot.accept((m) => m && replace(m.default))
