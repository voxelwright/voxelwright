// Furnishing through the always-on input (#42 prototype). Trusted code decides
// where things go (named anchors, or "here", the last thing you pointed at), shows
// a translucent ghost of the right size at once, and swaps in the real prop when
// it arrives. Props the model writes are module text from the host; they run only
// in the prop sandbox (dev builds), and only checked data reaches the home. A
// failure leaves nothing placed. Too-big things become projects: a wrapped parcel
// with a stitched "being made" tag where they will go.
import * as THREE from 'three/webgpu'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'
import { releaseGpu, type Stage } from '../kernel'
import type { Entries } from '../plugins/entries'
import { canvas, toTexture } from '../paint'
import { ANCHORS, CEILING, placeFor, sizeOf, TABLE, type Pose } from './place'
import { keepItem, libraryItem, makeProp, startProject, type Routed } from '../villager'

const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)')
const HAND = '"Bradley Hand", "Segoe Print", "Comic Sans MS", cursive'

/** A line that looks like furnishing, for the ghost before the villager has decided. Only a guess: the route decides. */
const FURNISH_GUESS = /^(?:(?:please|ok|let'?s|can (?:we|you)|could you|i'?d like to|i want to)\s+)*(?:add|put|place|bring|get|replace|swap|another|wallpaper)\b/i

type Placement = Pose
export interface Timing { text: string; route?: string; ghostMs?: number; finalMs?: number; makeMs?: number; boxMs?: number; source?: string; ok: boolean; why?: string; costUsd?: number | null }

/** One furnishing request on stage: its ghosts, then its props, then a keep or undo. */
interface Job {
  text: string
  t0: number
  routed: Routed | null
  ghosts: THREE.Mesh[]
  ghostFade: number
  props: THREE.Object3D[]
  /** Built by us (sandbox rebuild): release its GPU data on undo. Clones of scene objects share theirs. */
  owned: boolean
  item?: string
  hidden: THREE.Object3D[]
  places: Placement[]
  /** The ghost's size, as placed (a wall piece faces out of the wall). */
  size: [number, number, number]
  variant: number
  grow: number
  state: 'ghost' | 'placed' | 'kept' | 'gone'
  timing: Timing
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
}

export function furnisher(stage: Stage, entries: Entries, hooks: FurnishHooks) {
  const group = new THREE.Group()
  group.name = 'talk furnishing'
  stage.scene.add(group)
  const ghostMat = new THREE.MeshStandardMaterial({ color: '#fff3dc', emissive: '#ffd9a6', emissiveIntensity: 0.35, roughness: 1, transparent: true, opacity: 0.32, depthWrite: false })
  const timings: Timing[] = []
  let job: Job | null = null
  let picked: { point: THREE.Vector3; normal: THREE.Vector3; object: THREE.Object3D | null; at: number } | null = null
  let lastPlaced: THREE.Object3D | null = null
  // The sandbox and the checks live in dev builds only, as the prop experiment does.
  let box: import('../props/sandbox').PropBox | null = null
  const tools = import.meta.env.DEV ? Promise.all([import('../props/sandbox'), import('../props/rebuild')]) : null

  // ── The choice: keep, undo, try another, on a stitched tag over the new thing ──
  const choice = document.createElement('div')
  choice.className = 'furnish-choice'
  choice.setAttribute('role', 'group')
  choice.setAttribute('aria-label', 'The new piece')
  const button = (label: string, act: () => void, kind: string) => {
    const b = document.createElement('button')
    b.type = 'button'
    b.textContent = label
    b.dataset.choice = kind
    b.addEventListener('click', (e) => {
      e.stopPropagation()
      act()
    })
    return b
  }
  const making = document.createElement('span')
  making.className = 'making'
  choice.append(making, button('Keep', () => keep(), 'keep'), button('Undo', () => undo(), 'undo'), button('Try another', () => void again(), 'again'))
  const style = document.createElement('style')
  style.textContent = css()
  document.head.append(style)
  document.body.append(choice)

  // ── Where ────────────────────────────────────────────────────────────────
  const camPos = new THREE.Vector3()
  const facing = (x: number, z: number) => {
    stage.camera.getWorldPosition(camPos)
    return Math.atan2(camPos.x - x, camPos.z - z)
  }
  /** Base points of what already stands in the room, so a new piece keeps clear of them. */
  const taken = () => {
    const out: { x: number; y: number; z: number }[] = []
    for (const o of group.children) if (o.name.startsWith('talk furnishing ') && o.name !== 'talk furnishing ghost' && o.name !== 'talk furnishing cord') out.push({ x: o.position.x, y: o.position.y, z: o.position.z })
    return out
  }
  /** Trusted placement from the words the person used (place.ts), with "here" the last surface pointed at. */
  const places = (where: string, what: string, count: number, replacing: boolean, mount?: unknown, size?: number[]) => {
    if (replacing) return { list: [{ x: TABLE.x, y: 0, z: TABLE.z, ry: 0, mount: 'floor', anchor: 'table' } as Placement], size: sizeOf(what, size) }
    const here = picked && performance.now() - picked.at < 5 * 60_000 ? picked : null
    const placed = placeFor(what, where, mount, { count, size, here, taken: taken(), face: facing })
    return { list: placed.poses, size: placed.size, note: placed.note }
  }

  // ── Ghosts ───────────────────────────────────────────────────────────────
  const ghost = (size: [number, number, number], at: Placement) => {
    const [w, h, d] = size
    const round = /\bround|circular|stool|lamp|plant|pot\b/i.test(job?.routed?.what ?? job?.text ?? '')
    const g = new THREE.Mesh(round ? new THREE.CylinderGeometry(w / 2, w / 2, h, 40) : new RoundedBoxGeometry(w, h, Math.max(d, 0.03), 3, Math.min(0.06, Math.min(w, h, d) / 3)), ghostMat)
    g.name = 'talk furnishing ghost'
    // A wall piece's back is on the wall: its centre is half its depth out along the way it faces.
    const out = at.wall ? Math.max(d, 0.03) / 2 : 0
    g.position.set(at.x + Math.sin(at.ry) * out, at.y + h / 2, at.z + Math.cos(at.ry) * out)
    g.rotation.y = at.ry
    // A hanging piece hangs on a cord from the ceiling line.
    if (at.mount === 'ceiling') {
      const len = Math.max(0.05, CEILING - at.y - h)
      const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, len, 6), ghostMat)
      cord.name = 'talk furnishing cord'
      cord.position.y = h / 2 + len / 2
      g.add(cord)
    }
    g.renderOrder = 3
    g.raycast = () => {}
    group.add(g)
    return g
  }
  const clearGhosts = (j: Job) => {
    for (const g of j.ghosts) {
      g.removeFromParent()
      g.traverse((o) => (o as THREE.Mesh).geometry?.dispose())
    }
    j.ghosts = []
  }

  /**
   * The line looks like furnishing: show a ghost now, before the villager has
   * even decided. If the route turns out to be something else, it dissolves.
   */
  const hint = (text: string, t0: number) => {
    if (!FURNISH_GUESS.test(text.trim())) return null
    if (job?.state === 'placed') keep()
    const lower = text.toLowerCase()
    const replacing = /\breplace (?:the |our )?table\b/.test(lower)
    const where = /\b(around|by|near|in|on|at) (the )?[a-z ]+$/.exec(lower)?.[0] ?? (/\bhere\b/.test(lower) ? 'here' : '')
    const count = /\b(couple|two|pair)\b/.test(lower) ? 2 : /\bthree\b/.test(lower) ? 3 : 1
    const what = replacing ? 'table' : lower
    const { list, size } = places(where, what, count, replacing)
    const j: Job = { text, t0, routed: null, ghosts: [], ghostFade: 1, props: [], owned: false, hidden: [], places: list, size, variant: 0, grow: 0, state: 'ghost', timing: { text, ok: false } }
    job = j
    j.ghosts = list.map((p) => ghost(size, p))
    j.timing.ghostMs = performance.now() - t0
    showMaking(j)
    return j
  }

  /** Ghosts on their way out: they fade over half a second rather than blink away. */
  const fading: { ghosts: THREE.Mesh[]; mat: THREE.MeshStandardMaterial; t: number }[] = []
  /** The guess was wrong: the ghost dissolves, slowly enough to see it go. */
  const dismiss = (j: Job | null) => {
    if (!j || j.state !== 'ghost') return
    choice.classList.remove('shown', 'busy')
    j.state = 'gone'
    j.timing.why = 'not furnishing'
    if (j.ghosts.length && !reducedMotion.matches) {
      const mat = ghostMat.clone()
      for (const g of j.ghosts) g.traverse((o) => ((o as THREE.Mesh).material &&= mat))
      fading.push({ ghosts: j.ghosts, mat, t: 0 })
      j.ghosts = []
    } else clearGhosts(j)
    if (job === j) job = null
  }

  // ── Making and placing ───────────────────────────────────────────────────
  /** Module text through the sandbox to a checked, rebuilt, grounded object. Throws a reason. */
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
  /** Ground the object on y = 0 and centre it (a wall piece keeps its back on the wall). */
  /**
   * A wall piece the maker built lying flat (its thinnest side up, as a TV on its back)
   * is stood up so its face looks out of the wall.
   */
  const upright = (object: THREE.Object3D, at?: Placement) => {
    if (at?.mount !== 'wall') return object
    const s = new THREE.Box3().setFromObject(object).getSize(new THREE.Vector3())
    if (s.y < s.z && s.y < s.x * 0.5) {
      const holder = new THREE.Group()
      holder.add(object)
      object.rotation.x -= Math.PI / 2
      return holder
    }
    return object
  }
  const ground = (object: THREE.Object3D, wall?: boolean) => {
    const holder = new THREE.Group()
    holder.add(object)
    const b = new THREE.Box3().setFromObject(object)
    const size = b.getSize(new THREE.Vector3())
    if (!Number.isFinite(size.x + size.y + size.z) || size.length() === 0) throw new Error('it came out with no size')
    const c = b.getCenter(new THREE.Vector3())
    object.position.sub(new THREE.Vector3(c.x, b.min.y, wall ? b.min.z : c.z))
    holder.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) o.castShadow = o.receiveShadow = true
    })
    return holder
  }
  /** "That": the largest piece of furniture under what was pointed at, not a whole room or a villager. */
  const thingAt = (object: THREE.Object3D) => {
    let best: THREE.Object3D | null = null
    const size = new THREE.Vector3()
    for (let o: THREE.Object3D | null = object; o && o !== stage.scene; o = o.parent) {
      if (o.name === 'talk' || o === group) return null
      new THREE.Box3().setFromObject(o).getSize(size)
      if (Math.max(size.x, size.y, size.z) > 2.2) break
      best = o
    }
    return best
  }

  const fail = (j: Job, why: string, line: string) => {
    choice.classList.remove('shown', 'busy')
    j.state = 'gone'
    j.timing.ok = false
    j.timing.why = why
    clearGhosts(j)
    for (const o of j.hidden) o.visible = true
    if (job === j) job = null
    hooks.say(line)
  }

  /**
   * The furnish route: ghost (kept from the guess, or now), then the real thing
   * from the library, a copy, or the maker through the sandbox; then keep or undo.
   */
  const furnish = async (routed: Routed, text: string, t0: number, guess: Job | null, make?: Make) => {
    const what = routed.what ?? 'thing'
    const replacing = Boolean(routed.replace && /table/i.test(routed.replace))
    // Where, from the router's words and the person's own: trusted code picks the place either way.
    // Only the person's "here" counts: the router says "here" for anything unplaced.
    const where = `${(routed.where ?? '').replace(/\b(here|there)\b/gi, '')} | ${text}`
    const { list, size, note } = places(where, what, routed.count ?? 1, replacing, routed.mount, routed.size)
    let j = guess && guess.state === 'ghost' ? guess : null
    if (!j) {
      if (job?.state === 'placed') keep()
      j = { text, t0, routed, ghosts: [], ghostFade: 1, props: [], owned: false, hidden: [], places: list, size, variant: 0, grow: 0, state: 'ghost', timing: { text, ok: false } }
      job = j
    }
    j.routed = routed
    j.make = make
    // The route knows better than the guess: re-place the ghosts at the right size and places.
    clearGhosts(j)
    j.places = list
    j.size = size
    j.ghosts = list.map((p) => ghost(size, p))
    j.timing.ghostMs ??= performance.now() - t0
    showMaking(j)
    j.timing.route = 'furnish'
    if (note) hooks.say(note)
    await realise(j)
  }

  const realise = async (j: Job) => {
    const routed = j.routed!
    const what = routed.what ?? 'thing'
    const tm = performance.now()
    let made: THREE.Object3D
    try {
      if (routed.copy) {
        const source = (picked?.object && thingAt(picked.object)) ?? lastPlaced
        if (!source) return fail(j, 'nothing to copy', "Point at the one you mean first, then I'll copy it.")
        made = source.clone(true)
        made.position.set(0, 0, 0)
        made.rotation.set(0, 0, 0)
        made = ground(made)
        j.owned = false
        j.timing.source = 'copy'
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
        if (j.state !== 'ghost') return
        const tb = performance.now()
        made = ground(upright(await fromModule(module), j.places[0]), j.places[0]?.wall)
        j.timing.boxMs = performance.now() - tb
        j.owned = true
      }
    } catch (error) {
      console.warn('furnishing failed:', error)
      return fail(j, String(error instanceof Error ? error.message : error).slice(0, 200), "That one didn't come out right, so I've put nothing down.")
    }
    if (j.state !== 'ghost') {
      if (j.owned) releaseGpu(made)
      return
    }
    // Swap: the ghosts fade as the real pieces settle in, all in one frame.
    if (routed.replace && /table/i.test(routed.replace)) {
      const table = stage.scene.getObjectByName('table')
      if (table?.visible) {
        table.visible = false
        table.userData.replacedByTalk = true
        j.hidden.push(table)
      }
    }
    j.props = j.places.map((p, i) => {
      const o = i === 0 ? made : made.clone(true)
      o.name = `talk furnishing ${what}`
      o.position.set(p.x, p.y, p.z)
      o.rotation.y = p.ry
      if (p.mount === 'ceiling' && i === 0) {
        // Its cord to the ceiling line, in the house's dark flex, like the lamp's (measured at full size; clones share it).
        const top = new THREE.Box3().setFromObject(o).max.y
        const len = Math.max(0.05, CEILING - top)
        const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, len, 6), new THREE.MeshStandardMaterial({ color: '#2b2420' }))
        cord.name = 'talk furnishing hanging cord'
        cord.position.y = top - p.y + len / 2
        o.add(cord)
      }
      o.scale.setScalar(reducedMotion.matches ? 1 : 0.86)
      group.add(o)
      return o
    })
    j.grow = reducedMotion.matches ? 1 : 0
    j.state = 'placed'
    lastPlaced = j.props[0]
    j.timing.ok = true
    j.timing.finalMs = performance.now() - j.t0
    j.timing.makeMs ??= performance.now() - tm
    timings.push(j.timing)
    choice.classList.remove('busy')
    choice.classList.add('shown')
    choice.dataset.again = String(j.timing.source === 'made')
  }

  /** While it is being made, the tag over the ghost says what, in pencil. */
  const showMaking = (j: Job) => {
    const what = (j.routed?.what ?? '').replace(/^(a|an|the|some) /i, '')
    making.textContent = what ? `${hooks.maker} is making ${what.length > 30 ? `${what.slice(0, 29)}…` : what}…` : `${hooks.maker} is thinking…`
    choice.classList.add('shown', 'busy')
  }
  const removeProps = (j: Job) => {
    for (const o of j.props) o.removeFromParent()
    if (j.owned && j.props[0]) releaseGpu(j.props[0])
    if (lastPlaced && j.props.includes(lastPlaced)) lastPlaced = null
    j.props = []
  }
  const keep = () => {
    const j = job
    if (!j || j.state !== 'placed') return
    j.state = 'kept'
    choice.classList.remove('shown')
    if (j.item && j.timing.source === 'made') void keepItem(hooks.person, j.item)
    job = null
  }
  const undo = () => {
    const j = job
    if (!j || j.state !== 'placed') return
    removeProps(j)
    for (const o of j.hidden) {
      o.visible = true
      delete o.userData.replacedByTalk
    }
    j.hidden = []
    j.state = 'gone'
    choice.classList.remove('shown')
    job = null
  }
  const again = async () => {
    const j = job
    if (!j || j.state !== 'placed' || !j.routed) return
    removeProps(j)
    for (const o of j.hidden) o.visible = true
    j.hidden = []
    choice.classList.remove('shown')
    j.variant++
    j.state = 'ghost'
    j.t0 = performance.now()
    j.timing = { text: `${j.text} (take ${j.variant + 1})`, ok: false, route: 'furnish' }
    j.ghosts = j.places.map((p) => ghost(j.size, p))
    j.ghostFade = 1
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

  // ── Each frame ───────────────────────────────────────────────────────────
  const top = new THREE.Vector3()
  const frame = (dt: number, t: number) => {
    for (const f of [...fading]) {
      f.t += dt / 0.5
      f.mat.opacity = 0.3 * Math.max(0, 1 - f.t)
      if (f.t < 1) continue
      for (const g of f.ghosts) {
        g.removeFromParent()
        g.traverse((o) => (o as THREE.Mesh).geometry?.dispose())
      }
      f.mat.dispose()
      fading.splice(fading.indexOf(f), 1)
    }
    const j = job
    if (j?.state === 'ghost') {
      ghostMat.opacity = 0.24 + 0.12 * (0.5 + 0.5 * Math.sin(t * 3.2))
    }
    if (j && j.state === 'placed' && j.grow < 1) {
      j.grow = Math.min(1, j.grow + dt / 0.45)
      const k = j.grow
      // A soft settle with a little overshoot, like setting something down.
      const s = 0.86 + 0.14 * (1 + 2.2 * (k - 1) ** 3 + 1.2 * (k - 1) ** 2)
      for (const o of j.props) o.scale.setScalar(k >= 1 ? 1 : s)
      ghostMat.opacity = 0.3 * (1 - k)
      if (k >= 1) clearGhosts(j)
    } else if (j?.state === 'placed' && j.ghosts.length) clearGhosts(j)
    if ((j?.state === 'placed' && j.props[0]) || (j?.state === 'ghost' && j.ghosts[0])) {
      const b = new THREE.Box3()
      for (const o of j.state === 'placed' ? j.props : j.ghosts) b.expandByObject(o)
      top.set((b.min.x + b.max.x) / 2, b.max.y + 0.08, (b.min.z + b.max.z) / 2).project(stage.camera)
      const r = stage.renderer.domElement.getBoundingClientRect()
      const x = THREE.MathUtils.clamp(r.left + ((top.x + 1) / 2) * r.width, 120, innerWidth - 120)
      const y = THREE.MathUtils.clamp(r.top + ((1 - top.y) / 2) * r.height, 70, innerHeight - 200)
      // Whole pixels, and only when it has really moved, so the buttons hold still under a pointer.
      const at = `calc(${Math.round(x)}px - 50%) calc(${Math.round(y)}px - 100%)`
      if (choice.style.translate !== at) choice.style.translate = at
    }
  }

  const dispose = () => {
    stage.renderer.domElement.removeEventListener('pointerdown', onDown)
    for (const f of fading.splice(0)) f.mat.dispose()
    for (const remove of removers) remove()
    if (job) {
      for (const o of job.hidden) o.visible = true
    }
    for (const o of stage.scene.children) if (o.userData.replacedByTalk) o.visible = true
    group.removeFromParent()
    releaseGpu(group)
    ghostMat.dispose()
    choice.remove()
    style.remove()
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
    frame,
    dispose,
    /** For the checks and the timing runs. */
    state: () => ({
      job: job ? { state: job.state, ghosts: job.ghosts.length, props: job.props.length, places: job.places, source: job.timing.source, item: job.item } : null,
      timings: timings.slice(),
      parcels: parcels.map((p) => p.name),
      choice: choice.classList.contains('shown'),
      fading: fading.length,
      tableVisible: stage.scene.getObjectByName('table')?.visible ?? null,
      placed: group.children.filter((o) => o.name.startsWith('talk furnishing ') && o.name !== 'talk furnishing ghost').length,
      /** Ghosts standing in the room, fading ones included. */
      ghostsInRoom: group.children.filter((o) => o.name === 'talk furnishing ghost').length,
      /** Each placed piece's scale, to two places. */
      scales: group.children.filter((o) => o.name.startsWith('talk furnishing ') && o.name !== 'talk furnishing ghost').map((o) => Math.round(o.scale.x * 100) / 100),
      /** Each parcel's footprint in the room, and the Tab entries that stand for them. */
      parcelBoxes: parcels.filter((p) => p.parent).map((p) => {
        const b = new THREE.Box3().setFromObject(p)
        return { x0: b.min.x, x1: b.max.x, z0: b.min.z, z1: b.max.z, y1: b.max.y }
      }),
      parcelEntries: entries.list().filter((e) => e.id.startsWith('project-')).length,
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

function css() {
  return `
  .furnish-choice { position: fixed; z-index: 6; left: 0; top: 0; display: flex; gap: 6px; padding: 9px 10px 10px; border-radius: 14px;
    background: radial-gradient(120% 90% at 20% 0%, #fffaf0 0%, #fbf1dd 60%, #f3e3c4 100%); color: #46301f;
    box-shadow: 0 10px 24px rgba(60, 30, 10, 0.24), 0 2px 0 rgba(255, 255, 255, 0.7) inset; opacity: 0; scale: 0.92; pointer-events: none;
    transition: opacity 180ms ease, scale 220ms cubic-bezier(.2, 1.4, .4, 1); transform-origin: 50% 100%; }
  .furnish-choice::before { content: ''; position: absolute; inset: 5px; border: 1.5px dashed rgba(150, 100, 60, 0.36); border-radius: 10px; pointer-events: none; }
  .furnish-choice::after { content: ''; position: absolute; left: 50%; bottom: -8px; width: 16px; height: 16px; margin-left: -8px; rotate: 45deg;
    background: #f5e7cb; border-radius: 0 0 4px 0; box-shadow: 3px 3px 5px rgba(60, 30, 10, 0.12); }
  .furnish-choice.shown { opacity: 1; scale: 1; pointer-events: auto; }
  .furnish-choice button { position: relative; padding: 2px 8px 4px; border: 0; background: none; cursor: pointer;
    color: #6a4a34; font: 700 21px ${HAND}; transition: translate 120ms ease, color 120ms ease; }
  .furnish-choice button + button::before { content: '·'; position: absolute; left: -7px; color: rgba(120, 80, 50, 0.5); }
  .furnish-choice button[data-choice='keep'] { color: #3f6a35; }
  .furnish-choice button:hover, .furnish-choice button:focus-visible { translate: 0 -1px; outline: none; text-decoration: underline wavy rgba(120, 80, 50, 0.5); }
  .furnish-choice[data-again='false'] button[data-choice='again'] { display: none; }
  .furnish-choice .making { display: none; padding: 2px 8px 4px; font: italic 20px ${HAND}; color: #6a4a34; }
  .furnish-choice.busy .making { display: inline; }
  .furnish-choice.busy button { display: none; }
  .furnish-choice.busy { pointer-events: none; }
  @media (prefers-reduced-motion: reduce) { .furnish-choice { transition: none; } }
  `
}

export type Furnisher = ReturnType<typeof furnisher>
