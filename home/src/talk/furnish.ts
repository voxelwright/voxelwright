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
import { DOORWAY, KITCHEN, WALL_Z } from '../layout'
import { keepItem, libraryItem, makeProp, startProject, type Routed } from '../villager'

const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)')
const HAND = '"Bradley Hand", "Segoe Print", "Comic Sans MS", cursive'

/** The kitchen table, as table.ts places it. */
const TABLE = { x: -0.25, z: 0.15 }
/** Free places around the table for a chair, nearest the table's open sides first. */
const AROUND_TABLE: [number, number][] = [[-1.4, 0.2], [-0.75, 1.0], [0.85, 0.85], [-1.25, -0.55]]
interface Anchor { x: number; y: number; z: number; ry: number; wall?: boolean; note?: string }
/** Named places, resolved by trusted code. The model only ever names them. */
const ANCHORS: Record<string, Anchor> = {
  floor: { x: -1.55, y: 0, z: 1.85, ry: 0.4 },
  window: { x: -0.85, y: 0, z: -1.72, ry: 0 },
  corner: { x: 1.75, y: 0, z: 2.15, ry: -0.6 },
  counter: { x: 2.75, y: 0.9, z: -1.85, ry: 0 },
  wall: { x: 0.45, y: 0, z: WALL_Z + 0.006, ry: 0, wall: true },
  table: { x: TABLE.x, y: 0, z: TABLE.z, ry: 0 },
  // Until the living room can be furnished from here, its doorway stands in for it (in the kitchen's right wall).
  livingDoor: { x: KITCHEN.x1 - 0.75, y: 0, z: (DOORWAY.z0 + DOORWAY.z1) / 2 - 0.35, ry: -1.0 },
}
/** Rough sizes by kind, for the ghost when the router gave none. */
const SIZES: [RegExp, [number, number, number]][] = [
  [/\btables?\b/, [1.1, 0.76, 1.1]], [/\barm ?chairs?|sofa|couch/, [0.85, 0.9, 0.8]], [/\bchairs?|stools?\b/, [0.46, 0.92, 0.48]],
  [/\blamps?\b/, [0.4, 1.5, 0.4]], [/\bplants?|fern|tree\b/, [0.5, 1.1, 0.5]], [/\brugs?|carpet\b/, [1.6, 0.03, 1.1]],
  [/\bshel(f|ves)|bookcase\b/, [0.9, 1.6, 0.35]], [/\bwallpaper\b/, [1.2, 2.4, 0.02]], [/\bpinball\b/, [0.75, 1.3, 1.35]],
]
/** A line that looks like furnishing, for the ghost before the villager has decided. Only a guess: the route decides. */
const FURNISH_GUESS = /^(?:(?:please|ok|let'?s|can (?:we|you)|could you|i'?d like to|i want to)\s+)*(?:add|put|place|bring|get|replace|swap|another|wallpaper)\b/i

export const sizeOf = (what: string, given?: number[]): [number, number, number] =>
  (given?.length === 3 ? given : SIZES.find(([re]) => re.test(what.toLowerCase()))?.[1] ?? [0.6, 0.6, 0.6]) as [number, number, number]

interface Placement { x: number; y: number; z: number; ry: number; wall?: boolean }
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
  variant: number
  grow: number
  state: 'ghost' | 'placed' | 'kept' | 'gone'
  timing: Timing
}

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
  /** Trusted placement from the words the person used. */
  const places = (where: string, what: string, count: number, replacing: boolean, said = where): { list: Placement[]; note?: string } => {
    const w = where.toLowerCase()
    const n = Math.max(1, Math.min(6, count))
    if (replacing) return { list: [ANCHORS.table] }
    if (/around|at the table|by the table/.test(w)) {
      const free = AROUND_TABLE.filter(([x, z]) => !job?.places.some((p) => Math.hypot(p.x - x, p.z - z) < 0.3))
      return { list: free.slice(0, n).map(([x, z]) => ({ x, y: 0, z, ry: Math.atan2(TABLE.x - x, TABLE.z - z) })) }
    }
    let base: Anchor = ANCHORS.floor
    let note: string | undefined
    if (/wallpaper|on the wall/.test(`${w} ${what.toLowerCase()}`)) base = ANCHORS.wall
    else if (/window/.test(w)) base = ANCHORS.window
    else if (/corner/.test(w)) base = ANCHORS.corner
    else if (/counter|worktop/.test(w)) base = ANCHORS.counter
    else if (/living ?room|lounge/.test(w)) {
      base = ANCHORS.floor
      note = "The living room isn't open from here yet, so it's here in the kitchen for now."
    } else if (/\b(here|there|that spot)\b/i.test(said) && picked && performance.now() - picked.at < 5 * 60_000) {
      // Only when the person said "here": the router says "here" for anything unplaced.
      // A wall or a side was pointed at: stand it on the floor in front of that spot.
      const p = picked.point.clone()
      if (picked.normal.y < 0.7) p.addScaledVector(picked.normal.clone().setY(0).normalize(), Math.max(...sizeOf(what).filter((_, i) => i !== 1)) / 2 + 0.05).setY(0)
      base = { x: p.x, y: Math.max(0, p.y), z: p.z, ry: facing(p.x, p.z) }
    }
    const size = sizeOf(what)
    const list = Array.from({ length: n }, (_, i) => {
      const off = (i - (n - 1) / 2) * (size[0] + 0.15)
      return { ...base, x: base.x + Math.cos(base.ry) * off, z: base.z - Math.sin(base.ry) * off }
    })
    return { list, note }
  }

  // ── Ghosts ───────────────────────────────────────────────────────────────
  const ghost = (size: [number, number, number], at: Placement) => {
    const [w, h, d] = size
    const round = /\bround|circular|stool|lamp|plant|pot\b/i.test(job?.routed?.what ?? job?.text ?? '')
    const g = new THREE.Mesh(round ? new THREE.CylinderGeometry(w / 2, w / 2, h, 40) : new RoundedBoxGeometry(w, h, Math.max(d, 0.03), 3, Math.min(0.06, Math.min(w, h, d) / 3)), ghostMat)
    g.name = 'talk furnishing ghost'
    g.position.set(at.x, at.y + h / 2, at.wall ? at.z + d / 2 : at.z)
    g.rotation.y = at.ry
    g.renderOrder = 3
    g.raycast = () => {}
    group.add(g)
    return g
  }
  const clearGhosts = (j: Job) => {
    for (const g of j.ghosts) {
      g.removeFromParent()
      g.geometry.dispose()
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
    const { list } = places(where, what, count, replacing, text)
    const j: Job = { text, t0, routed: null, ghosts: [], ghostFade: 1, props: [], owned: false, hidden: [], places: list, variant: 0, grow: 0, state: 'ghost', timing: { text, ok: false } }
    job = j
    j.ghosts = list.map((p) => ghost(sizeOf(what), p))
    j.timing.ghostMs = performance.now() - t0
    showMaking(j)
    return j
  }

  /** The guess was wrong: the ghost dissolves. */
  const dismiss = (j: Job | null) => {
    if (!j || j.state !== 'ghost') return
    choice.classList.remove('shown', 'busy')
    j.state = 'gone'
    j.timing.why = 'not furnishing'
    clearGhosts(j)
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
  const furnish = async (routed: Routed, text: string, t0: number, guess: Job | null) => {
    const what = routed.what ?? 'thing'
    const replacing = Boolean(routed.replace && /table/i.test(routed.replace))
    // Where, from the router's words and the person's own: trusted code picks the place either way.
    const { list, note } = places(`${routed.where ?? ''} | ${text}`, what, routed.count ?? 1, replacing, text)
    let j = guess && guess.state === 'ghost' ? guess : null
    if (!j) {
      if (job?.state === 'placed') keep()
      j = { text, t0, routed, ghosts: [], ghostFade: 1, props: [], owned: false, hidden: [], places: list, variant: 0, grow: 0, state: 'ghost', timing: { text, ok: false } }
      job = j
    }
    j.routed = routed
    // The route knows better than the guess: re-place the ghosts at the right size and places.
    clearGhosts(j)
    j.places = list
    j.ghosts = list.map((p) => ghost(sizeOf(what, routed.size), p))
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
          const res = await makeProp(hooks.person, what, sizeOf(what, routed.size), j.variant)
          j.timing.makeMs = res.ms
          if (!res.ok) return fail(j, `maker ${res.why}`, res.why === 'away' ? "I'm out for a moment, so nothing's been made or moved." : res.why === 'busy' ? "I'm still making the last thing. One at a time!" : "I couldn't make that one, sorry. Nothing's been moved.")
          module = res.module
          j.item = res.item
          j.timing.costUsd = res.costUsd
          j.timing.source = 'made'
        }
        if (j.state !== 'ghost') return
        const tb = performance.now()
        made = ground(await fromModule(module), j.places[0]?.wall)
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
    j.ghosts = j.places.map((p) => ghost(sizeOf(j.routed!.what ?? '', j.routed!.size), p))
    j.ghostFade = 1
    j.timing.ghostMs = performance.now() - j.t0
    await realise(j)
  }

  // ── Projects: a parcel where it will go ──────────────────────────────────
  const parcels: THREE.Object3D[] = []
  const removers: (() => void)[] = []
  const parcel = (what: string, where: string | undefined) => {
    const lower = (where ?? '').toLowerCase()
    const at = /living ?room|lounge/.test(lower) ? ANCHORS.livingDoor : /corner/.test(lower) ? ANCHORS.corner : /window/.test(lower) ? ANCHORS.window : ANCHORS.floor
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
      tableVisible: stage.scene.getObjectByName('table')?.visible ?? null,
      placed: group.children.filter((o) => o.name.startsWith('talk furnishing ') && o.name !== 'talk furnishing ghost').length,
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
