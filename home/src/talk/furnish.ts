// Furnishing through the always-on input (#42 prototype, #56). Trusted code decides
// where each piece first stands (place.ts: named anchors, or "here", the last thing
// you pointed at) and hands it to the house's one placement (src/build/place.ts):
// a ghost of the right size at once, the real prop swapped in when it arrives, and
// from then on placement owns the pose (drag, snap, collision, turn) and the tag:
// Keep confirms it as plan furniture, Undo cancels it, Try another swaps a new prop
// into the same placement. Several pieces are placed one after another. Props the
// model writes are module text from the host; they run only in the prop sandbox (dev
// builds), and only checked data reaches the home. A failure leaves nothing placed.
// Too-big things become projects: a wrapped parcel with a stitched "being made" tag
// where they will go.
import * as THREE from 'three/webgpu'
import type { Context } from 'cordis'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'
import { releaseGpu, type Stage } from '../kernel'
import type { Entries } from '../plugins/entries'
import type { PlacementService } from '../plugins/place'
import type { Placing } from '../build/place'
import type { ItemRef } from '../build/plan'
import { canvas, toTexture } from '../paint'
import { ANCHORS, placeFor, sizeOf, TABLE, type Mount, type Pose } from './place'
import { libraryItem, makeProp, startProject, type Routed } from '../villager'

const HAND = '"Bradley Hand", "Segoe Print", "Comic Sans MS", cursive'

/** A line that looks like furnishing, for the ghost before the villager has decided. Only a guess: the route decides. */
const FURNISH_GUESS = /^(?:(?:please|ok|let'?s|can (?:we|you)|could you|i'?d like to|i want to)\s+)*(?:add|put|place|bring|get|replace|swap|another|wallpaper)\b/i

export interface Timing { text: string; route?: string; ghostMs?: number; finalMs?: number; makeMs?: number; boxMs?: number; source?: string; ok: boolean; why?: string; costUsd?: number | null }

/** One furnishing request: its pieces, placed one after another through placement. */
interface Job {
  text: string
  t0: number
  routed: Routed | null
  /** Each piece's first pose (place.ts). */
  places: Pose[]
  size: [number, number, number]
  mount: Mount
  /** The piece being placed now. */
  index: number
  placing: Placing | null
  /** What the open placement holds now: the ghost, then the made prop (or a later piece's copy). */
  object: THREE.Object3D | null
  /** The box shown while the prop is made. */
  ghost: THREE.Mesh | null
  /** The made prop; later pieces are clones of it. */
  made: THREE.Object3D | null
  /** Built by us (sandbox rebuild): release its GPU data when nothing kept it. Clones of scene objects share theirs. */
  owned: boolean
  ref: ItemRef | null
  item?: string
  /** Furniture ids this job's pieces became. */
  kept: string[]
  hidden: THREE.Object3D[]
  variant: number
  state: 'ghost' | 'placed' | 'kept' | 'gone'
  timing: Timing
  /** The "it won't fit" line is said once per job. */
  told: boolean
  /** Told when keeping failed, so a line waiting on this job goes ahead. */
  unstick?: () => void
  /** Sketching (#42, sketch.ts): this job's maker, in place of makeProp (a drawing's maker). */
  make?: Make
}
/** A maker for one job: module text for the sandbox and its library id. */
export type Make = (variant: number) => ReturnType<typeof makeProp>

export interface FurnishHooks {
  /** Your own villager says a short line in the room. */
  say(text: string): void
  /** The person the input belongs to: whose library and projects. */
  person: string
  /** Your villager's name, who makes things. */
  maker: string
  /** The house's placement (plugins/place.ts), when it is loaded. */
  placement: () => PlacementService | null
  /** Announce what happened (sound/contract.ts). */
  emit: Context['emit']
}

const NO_ROOM = "It won't fit there. Drag it somewhere it does, or Undo."
const NOT_SAVED = "I couldn't keep that in the house just now, so it isn't saved. Try Keep again?"

export function furnisher(stage: Stage, entries: Entries, hooks: FurnishHooks) {
  const announce = (state: 'ghost' | 'placed' | 'kept' | 'undone' | 'failed', at?: Pose) => hooks.emit('village/furnish', { state, at })
  /** Jobs whose first ghost has been announced: a routed re-begin of a guessed ghost is the same ghost. */
  const ghosted = new WeakSet<Job>()
  const group = new THREE.Group()
  group.name = 'talk furnishing'
  stage.scene.add(group)
  const ghostMat = new THREE.MeshStandardMaterial({ color: '#fff3dc', emissive: '#ffd9a6', emissiveIntensity: 0.35, roughness: 1, transparent: true, opacity: 0.4 })
  const timings: Timing[] = []
  let job: Job | null = null
  /** Furniture ids furnishing placed on this page, newest last. */
  const placed: string[] = []
  let picked: { point: THREE.Vector3; normal: THREE.Vector3; object: THREE.Object3D | null; at: number } | null = null
  /** How many placements furnishing has begun (for the checks). */
  let begun = 0
  /** A job waiting to begin goes after the one before it has settled. */
  let queue: Promise<unknown> = Promise.resolve()
  // The sandbox and the checks live in dev builds only, as the prop experiment does.
  let box: import('../props/sandbox').PropBox | null = null
  const tools = import.meta.env.DEV ? Promise.all([import('../props/sandbox'), import('../props/rebuild')]) : null

  // ── Where ────────────────────────────────────────────────────────────────
  const camPos = new THREE.Vector3()
  const facing = (x: number, z: number) => {
    stage.camera.getWorldPosition(camPos)
    return Math.atan2(camPos.x - x, camPos.z - z)
  }
  /** The house's placed things (plugins/place.ts), each a holder tagged with its furniture id. */
  const holders = () => (stage.scene.getObjectByName('placed things')?.children ?? []).filter((o) => typeof o.userData.furniture === 'string')
  /** Base points of what already stands, so a new piece's first pose keeps clear of them. */
  const taken = () => holders().map((o) => ({ x: o.position.x, y: o.position.y, z: o.position.z }))
  /** Trusted first poses from the words the person used (place.ts), with "here" the last surface pointed at. */
  const places = (where: string, what: string, count: number, replacing: boolean, mount?: unknown, size?: number[]) => {
    if (replacing) return { list: [{ x: TABLE.x, y: 0, z: TABLE.z, ry: 0, mount: 'floor', anchor: 'table' } as Pose], size: sizeOf(what, size), mount: 'floor' as Mount }
    const here = picked && performance.now() - picked.at < 5 * 60_000 ? picked : null
    const placedNow = placeFor(what, where, mount, { count, size, here, taken: taken(), face: facing })
    return { list: placedNow.poses, size: placedNow.size, mount: placedNow.mount, note: placedNow.note }
  }

  // ── Placing, one piece at a time ─────────────────────────────────────────
  const boxGhost = (j: Job) => {
    const [w, h, d] = j.size
    const round = /\bround|circular|stool|lamp|plant|pot\b/i.test(j.routed?.what ?? j.text)
    const g = new THREE.Mesh(round ? new THREE.CylinderGeometry(w / 2, w / 2, h, 40) : new RoundedBoxGeometry(w, h, Math.max(d, 0.03), 3, Math.min(0.06, Math.min(w, h, d) / 3)), ghostMat)
    g.name = 'talk furnishing ghost'
    return g
  }
  const dropGhost = (j: Job) => {
    j.ghost?.geometry.dispose()
    j.ghost = null
  }
  const measure = (o: THREE.Object3D): [number, number, number] => {
    o.updateMatrixWorld(true)
    const v = new THREE.Box3().setFromObject(o).getSize(new THREE.Vector3())
    return [v.x, v.y, v.z]
  }
  const label = (j: Job) => (j.routed?.what ?? 'new piece').replace(/^(a|an|the|some) /i, '')
  /** Begin placing piece j.index with `object` at its first pose. */
  const begin = (j: Job, object: THREE.Object3D) => {
    const service = hooks.placement()
    if (!service) return fail(j, 'no placement', "I can't set anything down just now. Nothing's been moved.")
    const p = j.places[j.index]
    const size = measure(object)
    let placing: Placing
    try {
      placing = service.begin({
        object, size, mount: j.mount, label: label(j), item: j.ref ?? undefined,
        words: { confirm: 'Keep', cancel: 'Undo', more: { label: 'Try another', act: () => void again(), shown: () => j.state === 'placed' && j.index === 0 && j.timing.source === 'made' } },
        failed: (why) => {
          if (why === 'save') {
            j.unstick?.()
            return hooks.say(NOT_SAVED)
          }
          if (!j.told) hooks.say(NO_ROOM)
          j.told = true
        },
      }, { x: p.x, y: p.mount === 'wall' ? p.y + size[1] / 2 : p.y, z: p.z, yaw: p.ry })
    } catch (error) {
      return fail(j, `placement ${String(error)}`.slice(0, 200), "I couldn't find a place for that one, so I've put nothing down.")
    }
    j.placing = placing
    j.object = object
    begun++
    if (j.state === 'ghost' && !ghosted.has(j)) {
      ghosted.add(j)
      announce('ghost', p)
    }
    void placing.done.then((d) => {
      if (j.placing !== placing) return
      j.placing = null
      if (d.status === 'cancelled') {
        // A failed job announced 'failed' already; a dismissed guess never showed anything.
        if (!j.timing.why) announce('undone', p)
        return letGo(j)
      }
      announce('kept', p)
      j.kept.push(d.furnitureId)
      placed.push(d.furnitureId)
      if (j.index + 1 < j.places.length && j.made && j.ref) {
        j.index++
        return begin(j, j.made.clone(true))
      }
      j.state = 'kept'
      if (job === j) job = null
    })
    return placing
  }
  /** Placement ended without keeping this piece: Undo, Escape, "Undo" on the tag, or a dismissed guess. */
  const letGo = (j: Job) => {
    if (j.state === 'gone' || j.state === 'kept') return
    // Pieces kept before this one stay; with none kept, the job leaves no trace.
    j.state = j.kept.length ? 'kept' : 'gone'
    dropGhost(j)
    if (!j.kept.length) {
      if (j.owned && j.made) releaseGpu(j.made)
      for (const o of j.hidden) {
        o.visible = true
        delete o.userData.replacedByTalk
      }
      j.hidden = []
    }
    j.made = null
    if (job === j) job = null
  }
  const end = (j: Job) => {
    const p = j.placing
    j.placing = null
    p?.cancel()
    letGo(j)
  }
  /** The table being replaced steps out of the way while its replacement is placed. */
  const hideTable = (j: Job) => {
    const table = stage.scene.getObjectByName('table')
    if (!table?.visible) return
    table.visible = false
    table.userData.replacedByTalk = true
    j.hidden.push(table)
  }
  /** A piece still open from an earlier line is kept if it can be (as Keep would), else let go; then `next` begins. */
  const after = (j: Job, next: () => void) => {
    const prev = job
    if (prev && prev !== j && prev.placing) {
      prev.places = prev.places.slice(0, prev.index + 1)
      const p = prev.placing
      if (prev.state === 'placed' && p.fits) p.confirm()
      else end(prev)
      // A failed save leaves it open; the next line goes ahead (and its placement ends this one).
      queue = Promise.race([p.done, new Promise<void>((r) => (prev.unstick = r))])
    }
    const run = queue.then(next)
    queue = run
    return run
  }

  /**
   * The line looks like furnishing: show a ghost now, before the villager has
   * even decided. If the route turns out to be something else, it is cancelled.
   */
  const hint = (text: string, t0: number) => {
    if (!FURNISH_GUESS.test(text.trim())) return null
    const lower = text.toLowerCase()
    const replacing = /\breplace (?:the |our )?table\b/.test(lower)
    const where = /\b(around|by|near|in|on|at) (the )?[a-z ]+$/.exec(lower)?.[0] ?? (/\bhere\b/.test(lower) ? 'here' : '')
    const count = /\b(couple|two|pair)\b/.test(lower) ? 2 : /\bthree\b/.test(lower) ? 3 : 1
    const what = replacing ? 'table' : lower
    const { list, size, mount } = places(where, what, count, replacing)
    const j: Job = { text, t0, routed: null, places: list, size, mount, index: 0, placing: null, object: null, ghost: null, made: null, owned: false, ref: null, kept: [], hidden: [], variant: 0, state: 'ghost', timing: { text, ok: false }, told: false }
    void after(j, () => {
      // Routed before its ghost began: furnish() begins it at the routed place instead.
      if (j.state !== 'ghost' || j.routed) return
      job = j
      if (replacing) hideTable(j)
      j.ghost = boxGhost(j)
      begin(j, j.ghost)
      j.placing?.note(`${hooks.maker} is thinking…`)
      j.timing.ghostMs = performance.now() - t0
    })
    return j
  }

  /** The guess was wrong: its placement is cancelled and nothing of it is left. */
  const dismiss = (j: Job | null) => {
    if (!j || j.state !== 'ghost' || j.routed) return
    j.timing.why = 'not furnishing'
    end(j)
  }

  // ── Making ───────────────────────────────────────────────────────────────
  /** Module text through the sandbox to a checked, rebuilt object. Throws a reason. */
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
  /**
   * A wall piece the maker built lying flat (its thinnest side up, as a TV on its back)
   * is stood up so its face looks out of the wall.
   */
  const upright = (object: THREE.Object3D, mount: Mount) => {
    if (mount !== 'wall') return object
    const s = new THREE.Box3().setFromObject(object).getSize(new THREE.Vector3())
    if (s.y < s.z && s.y < s.x * 0.5) {
      const holder = new THREE.Group()
      holder.add(object)
      object.rotation.x -= Math.PI / 2
      return holder
    }
    return object
  }
  const shadows = (o: THREE.Object3D) => o.traverse((m) => {
    if ((m as THREE.Mesh).isMesh) m.castShadow = m.receiveShadow = true
  })

  const fail = (j: Job, why: string, line: string) => {
    j.timing.ok = false
    j.timing.why = why
    announce('failed', j.places[0])
    end(j)
    hooks.say(line)
  }

  /**
   * The furnish route: the ghost at the routed pose, then the real thing from the
   * library, a copy, or the maker through the sandbox, swapped into the placement.
   */
  const furnish = async (routed: Routed, text: string, t0: number, guess: Job | null, make?: Make) => {
    const what = routed.what ?? 'thing'
    const replacing = Boolean(routed.replace && /table/i.test(routed.replace))
    // Where, from the router's words and the person's own: trusted code picks the place either way.
    // Only the person's "here" counts: the router says "here" for anything unplaced.
    const where = `${(routed.where ?? '').replace(/\b(here|there)\b/gi, '')} | ${text}`
    const { list, size, mount, note } = places(where, what, routed.count ?? 1, replacing, routed.mount, routed.size)
    let j = guess && guess.state === 'ghost' ? guess : null
    if (j) {
      // The route knows better than the guess: its ghost goes, and the piece begins again at the routed place and size.
      const p = j.placing
      j.placing = null
      p?.cancel()
      dropGhost(j)
    } else j = { text, t0, routed, places: list, size, mount, index: 0, placing: null, object: null, ghost: null, made: null, owned: false, ref: null, kept: [], hidden: [], variant: 0, state: 'ghost', timing: { text, ok: false }, told: false }
    const k = j
    k.routed = routed
    k.make = make
    k.places = list
    k.size = size
    k.mount = mount
    k.timing.route = 'furnish'
    if (note) hooks.say(note)
    await after(k, () => {
      if (k.state !== 'ghost') return
      job = k
      if (replacing) hideTable(k)
      k.ghost = boxGhost(k)
      if (!begin(k, k.ghost)) return
      showMaking(k)
      k.timing.ghostMs ??= performance.now() - t0
      if (k.placing && !k.placing.fits) {
        hooks.say(NO_ROOM)
        k.told = true
      }
    })
    if (k.state === 'ghost' && k.placing) await realise(k)
  }

  /** While it is being made, the tag over the ghost says who is making what. */
  const showMaking = (j: Job) => {
    const what = (j.routed?.what ?? '').replace(/^(a|an|the|some) /i, '')
    j.placing?.note(what ? `${hooks.maker} is making ${what.length > 30 ? `${what.slice(0, 29)}…` : what}…` : `${hooks.maker} is thinking…`)
  }

  const realise = async (j: Job) => {
    const routed = j.routed!
    const what = routed.what ?? 'thing'
    const tm = performance.now()
    const variant = j.variant
    let made: THREE.Object3D
    let ref: ItemRef | null
    try {
      if (routed.copy) {
        // Only plan furniture can be copied: it is what the house can keep again.
        const service = hooks.placement()
        const from = (picked?.object && service?.itemOf(picked.object)) || (placed.length ? service?.itemOf(holders().find((o) => o.userData.furniture === placed.at(-1)) ?? new THREE.Object3D()) : null)
        const source = from && holders().find((o) => o.userData.furniture === from.furnitureId)
        const inner = source?.children.find((c) => c.name !== 'cord')
        if (!from || !inner) return fail(j, 'nothing to copy', "Point at one of the things we've placed first, then I'll copy it.")
        made = inner.clone(true)
        ref = from.item
        j.owned = false
        j.timing.source = 'copy'
        if ('library' in from.item) j.item = from.item.library
      } else {
        let module: string
        if (routed.library) {
          const item = await libraryItem(hooks.person, routed.library)
          if (!item.ok) return fail(j, `library ${item.why}`, "I couldn't find that one in your things. Nothing's been moved.")
          module = item.module
          j.item = routed.library
          j.timing.source = 'library'
        } else {
          const res = await (j.make ? j.make(j.variant) : makeProp(hooks.person, what, j.size, j.variant))
          j.timing.makeMs = res.ms
          if (!res.ok) return fail(j, `maker ${res.why}`, res.why === 'away' ? "I'm out for a moment, so nothing's been made or moved." : res.why === 'busy' ? "I'm still making the last thing. One at a time!" : "I couldn't make that one, sorry. Nothing's been moved.")
          module = res.module
          j.item = res.item
          j.timing.costUsd = res.costUsd
          j.timing.source = 'made'
        }
        if (j.state !== 'ghost' || j.variant !== variant) return
        const tb = performance.now()
        made = upright(await fromModule(module), j.mount)
        ref = { library: j.item!, person: hooks.person }
        j.timing.boxMs = performance.now() - tb
        j.owned = true
      }
    } catch (error) {
      console.warn('furnishing failed:', error)
      return fail(j, String(error instanceof Error ? error.message : error).slice(0, 200), "That one didn't come out right, so I've put nothing down.")
    }
    if (j.state !== 'ghost' || !j.placing || j.variant !== variant) {
      if (j.owned) releaseGpu(made)
      return
    }
    shadows(made)
    j.made = made
    j.ref = ref
    // Placed before the swap repaints the tag, so it offers Try another.
    j.state = 'placed'
    announce('placed', j.places[j.index])
    j.placing.swap(made, undefined, ref)
    j.object = made
    j.placing.note('')
    dropGhost(j)
    j.timing.ok = true
    j.timing.finalMs = performance.now() - j.t0
    j.timing.makeMs ??= performance.now() - tm
    timings.push(j.timing)
    if (!j.placing.fits && !j.told) {
      hooks.say(NO_ROOM)
      j.told = true
    }
  }

  const keep = () => {
    const j = job
    if (j?.placing && (j.state === 'placed' || j.state === 'ghost')) j.placing.confirm()
  }
  const undo = () => {
    const j = job
    if (j?.placing) j.placing.cancel()
  }
  const again = async () => {
    const j = job
    if (!j || j.state !== 'placed' || !j.routed || !j.placing || j.index !== 0) return
    // The same placement, a new prop: the ghost while it is made, and nothing to keep until it is.
    const old = j.made
    j.variant++
    j.state = 'ghost'
    announce('ghost', j.places[0])
    j.t0 = performance.now()
    j.timing = { text: `${j.text} (take ${j.variant + 1})`, ok: false, route: 'furnish' }
    j.ghost = boxGhost(j)
    j.placing.swap(j.ghost, j.size, null)
    j.object = j.ghost
    j.made = null
    if (j.owned && old) releaseGpu(old)
    showMaking(j)
    j.timing.ghostMs = performance.now() - j.t0
    await realise(j)
  }

  // ── Projects: a parcel where it will go ──────────────────────────────────
  const parcels: THREE.Object3D[] = []
  const removers: (() => void)[] = []
  const parcel = (what: string, where: string | undefined) => {
    const lower = (where ?? '').toLowerCase()
    const at = /living ?room|lounge/.test(lower) ? ANCHORS.livingFloor : /corner/.test(lower) ? ANCHORS.corner : /window/.test(lower) ? ANCHORS.window : ANCHORS.floor
    const p = makeParcel(what)
    p.scale.setScalar(1.25)
    p.position.set(at.x + parcels.length * 0.8, 0, at.z + parcels.length * 0.3)
    p.rotation.y = at.ry
    p.name = `talk project ${what}`
    group.add(p)
    parcels.push(p)
    removers.push(entries.add({
      id: `project-${parcels.length}`,
      label: `${what}, being made`,
      object: p,
      select() {
        hooks.say(`The ${what.replace(/^(a|an|the) /i, '')} is still being made. I'll tell you when it's ready.`)
        queueMicrotask(() => entries.back())
      },
    }))
    return p
  }
  const project = async (routed: Routed, text: string) => {
    const what = routed.what ?? 'something'
    const saved = await startProject(hooks.person, what, routed.where, text)
    if (!saved.ok) {
      hooks.say(saved.why === 'away' ? "I'm out for a moment, so I couldn't write that project down. Say it again soon?" : "I couldn't write that project down just now. Nothing's started.")
      return false
    }
    parcel(what, routed.where)
    return true
  }

  // ── Pointing: "here" and "that" ──────────────────────────────────────────
  const raycaster = new THREE.Raycaster()
  const ndc = new THREE.Vector2()
  const onDown = (e: PointerEvent) => {
    const r = stage.renderer.domElement.getBoundingClientRect()
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1)
    raycaster.setFromCamera(ndc, stage.camera)
    for (const hit of raycaster.intersectObject(stage.scene, true)) {
      const mesh = hit.object as THREE.Mesh
      if (!mesh.isMesh || mesh.userData.hud) continue
      let hidden = false
      for (let o: THREE.Object3D | null = mesh; o; o = o.parent) if (!o.visible || o.userData.hud) hidden = true
      if (hidden || !([] as THREE.Material[]).concat(mesh.material).some((m) => m.visible && m.depthWrite)) continue
      const normal = hit.face ? hit.face.normal.clone().transformDirection(mesh.matrixWorld) : new THREE.Vector3(0, 1, 0)
      picked = { point: hit.point.clone(), normal, object: mesh, at: performance.now() }
      return
    }
  }
  stage.renderer.domElement.addEventListener('pointerdown', onDown)

  const dispose = () => {
    stage.renderer.domElement.removeEventListener('pointerdown', onDown)
    for (const remove of removers) remove()
    if (job) end(job)
    for (const o of stage.scene.children) if (o.userData.replacedByTalk) o.visible = true
    group.removeFromParent()
    releaseGpu(group)
    ghostMat.dispose()
    box?.dispose()
    box = null
  }

  return {
    hint,
    dismiss,
    furnish,
    project,
    parcel,
    keep,
    undo,
    again,
    dispose,
    /** The piece being placed now and what it holds, for sketching's pinned page. */
    placing: () => (job?.placing && job.object ? { placing: job.placing, object: job.object } : null),
    /** For the checks and the timing runs. */
    state: () => ({
      job: job ? { state: job.state, open: Boolean(job.placing), piece: job.index, places: job.places, source: job.timing.source, item: job.item, kept: job.kept.slice() } : null,
      timings: timings.slice(),
      parcels: parcels.map((p) => p.name),
      tableVisible: stage.scene.getObjectByName('table')?.visible ?? null,
      /** Furniture ids furnishing placed on this page. */
      placed: placed.slice(),
      begun,
      picked: picked ? { x: picked.point.x, y: picked.point.y, z: picked.point.z, object: picked.object?.name ?? null } : null,
    }),
    pickAt: (x: number, y: number, z: number, name?: string) => {
      const object = name ? stage.scene.getObjectByName(name) ?? null : null
      picked = { point: new THREE.Vector3(x, y, z), normal: new THREE.Vector3(0, 1, 0), object, at: performance.now() }
    },
  }
}

/** A parcel in kraft paper tied with twine, wearing a stitched cloth tag that says "being made". */
function makeParcel(what: string) {
  const g = new THREE.Group()
  const [kc, k] = canvas(256, 256)
  k.fillStyle = '#c49a66'
  k.fillRect(0, 0, 256, 256)
  for (let i = 0; i < 1400; i++) {
    k.fillStyle = Math.random() > 0.5 ? 'rgba(255,240,210,0.10)' : 'rgba(90,55,25,0.10)'
    k.fillRect(Math.random() * 256, Math.random() * 256, 1 + Math.random() * 6, 1)
  }
  k.strokeStyle = 'rgba(110, 70, 35, 0.25)'
  for (let i = 0; i < 6; i++) {
    k.beginPath()
    k.moveTo(Math.random() * 256, 0)
    k.lineTo(Math.random() * 256, 256)
    k.stroke()
  }
  const kraft = new THREE.MeshStandardMaterial({ map: toTexture(kc), roughness: 0.9 })
  const twine = new THREE.MeshStandardMaterial({ color: '#efe1c0', roughness: 1 })
  const W = 0.62, H = 0.5, D = 0.52
  const body = new THREE.Mesh(new RoundedBoxGeometry(W, H, D, 3, 0.035), kraft)
  body.position.y = H / 2
  g.add(body)
  for (const [w, d] of [[W + 0.012, 0.022], [0.022, D + 0.012]] as const) {
    const band = new THREE.Mesh(new THREE.BoxGeometry(w, H + 0.012, d), twine)
    band.position.y = H / 2
    g.add(band)
    const over = new THREE.Mesh(new THREE.BoxGeometry(w, 0.012, d), twine)
    over.position.y = H + 0.004
    g.add(over)
  }
  const bow = new THREE.Mesh(new THREE.TorusGeometry(0.045, 0.011, 8, 20), twine)
  for (const s of [-1, 1]) {
    const loop = bow.clone()
    loop.position.set(s * 0.045, H + 0.03, 0)
    loop.rotation.set(Math.PI / 2, 0, s * 0.5)
    g.add(loop)
  }
  // The tag: felt, stitched round the edge, hanging off the twine at the front.
  const [tc, t] = canvas(512, 300)
  t.fillStyle = '#f4ead4'
  t.beginPath()
  t.roundRect(8, 8, 496, 284, 34)
  t.fill()
  t.strokeStyle = 'rgba(150, 90, 50, 0.7)'
  t.lineWidth = 5
  t.setLineDash([16, 12])
  t.beginPath()
  t.roundRect(26, 26, 460, 248, 24)
  t.stroke()
  t.setLineDash([])
  t.fillStyle = '#8a4b2c'
  t.font = `700 64px ${HAND}`
  t.textAlign = 'center'
  t.fillText('being made', 256, 140)
  t.fillStyle = '#6a4a34'
  t.font = `40px ${HAND}`
  const label = what.replace(/^(a|an|the) /i, '')
  t.fillText(label.length > 22 ? `${label.slice(0, 21)}…` : label, 256, 214)
  const tag = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.246), new THREE.MeshStandardMaterial({ map: toTexture(tc), roughness: 0.95, transparent: true, alphaTest: 0.5, side: THREE.DoubleSide }))
  tag.position.set(0.1, H * 0.62, D / 2 + 0.03)
  tag.rotation.set(-0.12, 0.08, 0.06)
  g.add(tag)
  g.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) o.castShadow = o.receiveShadow = true
  })
  return g
}

export type Furnisher = ReturnType<typeof furnisher>
