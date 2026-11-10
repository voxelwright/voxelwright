// #47 code arm, trusted side: a villager made by model code in the prop sandbox comes
// back as checked wire data (rebuild.ts validate()) whose meshes carry a slot from the
// closed ROLES list. This groups them into the rig's Figure slots, refuses a villager
// missing any required slot, derives height, hip and side from the geometry, and
// replaces every material with the home's own felt (or a glossy bead for shiny parts),
// so no model code decides how anything is shaded.
import * as THREE from 'three/webgpu'
import { rebuild } from '../../props/rebuild'
import type { PropData, Role } from '../../props/wire'
import { feltKit, feltTexture } from '../kinds'
import { BLUSH, feltKit as makeKit, wrapCap, type Wrap } from './kit'
import type { Figure, Villager } from '../rig'
import { soften } from '../soft'
import { check } from './build'
import { awayFromOwners, faceViews, inspect, LIMITS, markAttachment, OWNER_ACCENTS, surfaceContact, type Measures } from './checks'
import { sewSkin, type surfaceStats } from './skin'
import { ENUMS, type VillagerSpec } from './spec'

/**
 * Owner colour (#47 look regroup, screenshots/villager-gen/LEARNING-look.md, strategy C): shape says the role,
 * colour says whose villager it is. Trusted code dyes every villager.mark() part in the owner's felt, and pulls
 * any other felt that competes with an owner's hue towards oatmeal (./checks.ts OWNER_CLASH), so the mark wins.
 * The model never wears the accent itself.
 */
const REQUIRED: Role[] = ['head', 'eye-left', 'eye-right', 'hand-left', 'hand-right', 'foot-left', 'foot-right']
/**
 * The sewn skin's grid: cells per head height for the head and for the other slots, the blend over the height, the most
 * triangles over the parts as built, and how far over the height a fitted skullcap stands off the skin and sinks its rim.
 */
const SKIN = { head: 42, body: 32, blend: 0.03, budget: 1.5, capLift: 0.006, capSink: 0.004 }
/** Model units: a villager stands 0.25 to 1.1 tall (Dumpling about 0.45, before the room's 1.3 scale). */
const HEIGHT: [number, number] = [0.25, 1.1]

export interface Assembled {
  fig: Figure
  /** Name, role, bark, gait and voice, clamped by the spec checker. */
  about: Pick<VillagerSpec, 'name' | 'role' | 'bark' | 'gait' | 'voice' | 'persona'>
  fixes: string[]
  /** What ./checks.ts measured; the figure is refused before this when a check fails. */
  measures: Measures
  /** Look regroup 3: milliseconds the sewn skin took (./skin.ts), when it ran. */
  skinMs?: number
}

/** Two #rrggbb colours within a few steps of 255 on every channel. */
function near(a: string, b: string, tol = 8) {
  const x = new THREE.Color(a), y = new THREE.Color(b)
  return Math.max(Math.abs(x.r - y.r), Math.abs(x.g - y.g), Math.abs(x.b - y.b)) * 255 <= tol
}

const own = (o: unknown, k: string): unknown => (o !== null && typeof o === 'object' && !Array.isArray(o) && Object.hasOwn(o, k) ? (o as Record<string, unknown>)[k] : undefined)
const hex = (c: number[]) => '#' + new THREE.Color().setRGB(c[0], c[1], c[2]).getHexString()

/**
 * Checked wire data (with roles) and the raw `villager` block to a Figure, or a thrown reason.
 * `kit` (the default since the kit council): trusted code makes the face and the role's mark (./kit.ts).
 * `requested`: the role the runner or the host asked for. It is trusted data, so it decides the kit's mark and the
 * checks over the model's own `villager.about({ role })`, which only says what the model thought it was making.
 * `skin` (the default since the skin council): each slot's felt is sewn into one surface (./skin.ts); false only to debug.
 * `attachOnSkin`: measure the mark's attachment again on the skin (scripts only; see below).
 */
export function assemble(prop: PropData, raw: unknown, phys: boolean, accent: string, seed = 1, enforce = true, species = true, mark = true, kit = true, requested?: string, skin = true, attachOnSkin = false): Assembled {
  const slots = new Map<Role, THREE.Mesh[]>()
  for (const m of prop.meshes) {
    const role = (m.role ?? 'body') as Role
    if (!slots.has(role)) slots.set(role, [])
  }
  for (const role of REQUIRED) if (!slots.has(role)) throw new Error(`the villager has no "${role}" part (tag one with villager.tag(object, '${role}'))`)
  if (!slots.has('body')) throw new Error('the villager has no body part (untagged meshes are the body)')

  // Gait and about: plain data through the spec checker, so the same ranges clamp both arms.
  const meta = own(raw, 'villager')
  const about = own(meta, 'about')
  const persona = own(about, 'persona')
  const checked = check({ name: own(about, 'name'), role: own(about, 'role'), bark: own(about, 'bark'), voice: own(about, 'voice'), gait: own(meta, 'gait'), ...(persona === undefined ? {} : { persona }) })
  const fixes = checked.fixes.filter((f) => /^(name|role|bark|gait|voice|persona)/.test(f))
  const asked = (ENUMS.role as readonly string[]).includes(requested ?? '') ? requested as VillagerSpec['role'] : null
  if (requested !== undefined && !asked) fixes.push(`role: the requested role "${String(requested).slice(0, 24)}" is not a role; the model's "${checked.spec.role}" is used`)
  if (asked && asked !== checked.spec.role) fixes.push(`role: the model declared "${checked.spec.role}"; the requested "${asked}" is used`)
  const role = asked ?? checked.spec.role

  // Trusted rebuild of the geometry; its materials are replaced below.
  const group = rebuild(prop)
  // The model's meshes with their wire entries; the kit (./kit.ts) may drop some and add its own.
  let model = (group.children as THREE.Mesh[]).map((mesh, i) => ({ mesh, w: prop.meshes[i] }))

  // Stand it on the floor.
  group.updateMatrixWorld(true)
  const all = new THREE.Box3().setFromObject(group)
  const height = all.max.y - all.min.y
  if (!(height >= HEIGHT[0] && height <= HEIGHT[1])) throw new Error(`the villager is ${height.toFixed(2)} tall; make it ${HEIGHT[0]} to ${HEIGHT[1]} model units`)
  for (const { mesh } of model) mesh.position.y -= all.min.y
  group.updateMatrixWorld(true)

  // The felt look, from trusted code. Matte parts become felt; glossy or metal ones stay smooth beads.
  const bodyMesh = model.find((m) => (m.w.role ?? 'body') === 'body')!
  const bodyColour = hex(prop.materials[bodyMesh.w.material].color)
  const lum = new THREE.Color(bodyColour).convertLinearToSRGB()
  const rimStrength = THREE.MathUtils.clamp(0.28 + (0.75 - (0.299 * lum.r + 0.587 * lum.g + 0.114 * lum.b)) * 1.8, 0.22, 0.6)
  const { felt, outline } = feltKit(phys, rimStrength, accent, seed + 25)
  // Every owner's accent and this villager's own: body felt keeps off all of them.
  const accents = { ...OWNER_ACCENTS, 'this owner': accent }

  // Regroup 2: the trusted felt kit makes the face and the role's mark; the model's eyes and marked parts go.
  const added: { mesh: THREE.Mesh; slot: Role }[] = []
  if (kit) {
    // Each part's felt as it will show (off the owners' hues), so the kit's mitten wrap matches the hand it closes.
    const shownColour = (w: PropData['meshes'][number]) => {
      const m = prop.materials[w.material], c = hex(m.color)
      return m.roughness >= 0.5 && m.metalness < 0.5 && w.role !== 'held' ? awayFromOwners(c, accents) : c
    }
    const k = makeKit({ meshes: model.map(({ mesh, w }) => ({ mesh, slot: (w.role ?? 'body') as Role, mark: w.mark === true, colour: shownColour(w) })), role, accent, felt: (c, map) => felt(c, map ?? feltTexture(c, seed + 29, { band: false })), seed, blush: awayFromOwners(BLUSH, accents), around: skin })
    for (const m of k.remove) m.removeFromParent()
    model = model.filter(({ mesh }) => !k.remove.has(mesh))
    for (const part of k.add) group.add(part.mesh)
    added.push(...k.add)
    fixes.push(...k.notes)
  }
  const meshes = [...model.map((m) => m.mesh), ...added.map((m) => m.mesh)]
  for (const { mesh, w } of model) slots.get((w.role ?? 'body') as Role)!.push(mesh)
  for (const { mesh, slot } of added) {
    if (!slots.has(slot)) slots.set(slot, [])
    slots.get(slot)!.push(mesh)
  }
  group.updateMatrixWorld(true)
  // Every slot's bounds, measured once before anything is moved.
  const boxes = new Map<Role, THREE.Box3>()
  for (const [role, list] of slots) {
    const b = new THREE.Box3()
    for (const m of list) b.expandByObject(m)
    boxes.set(role, b)
  }
  const box = (role: Role) => boxes.get(role) ?? new THREE.Box3()

  const made = new Map<string, THREE.Material>()
  const nudged = new Map<string, string>()
  const replaced = new Set<THREE.Material>()
  /** Felt the skin may sew (matte, not marked, not the held prop or an eye), with its colour as shown. */
  const sewable = new Map<THREE.Mesh, string>()
  model.forEach(({ mesh, w: wire }) => {
    const k = wire.material
    const old = mesh.material as THREE.MeshStandardMaterial
    const w = prop.materials[k]
    const c = hex(w.color)
    const matte = w.roughness >= 0.5 && w.metalness < 0.5
    const role = wire.role
    const marked = wire.mark === true
    // The mark in the owner's felt; other felt off the owners' hues (not the eyes or the held prop: a wooden spoon stays wood).
    const shown = marked ? accent : matte && role !== 'held' && role !== 'eye-left' && role !== 'eye-right' ? awayFromOwners(c, accents) : c
    if (shown !== c && !marked) nudged.set(c, shown)
    const key = `${k}|${shown}`
    if (!made.has(key)) {
      made.set(key, marked ? felt(accent, feltTexture(accent, seed + 7, { band: false })) : matte ? felt(shown, shown === c && old.map ? old.map : feltTexture(shown, seed + k, { band: false })) : new THREE.MeshStandardMaterial({ color: c, roughness: Math.max(0.2, w.roughness), metalness: w.metalness, map: old.map }))
    }
    replaced.add(old)
    mesh.material = made.get(key)!
    // The colour the model wrote, for check reasons; the owner's colour, for measuring how much of it shows (load.ts silhouettes).
    mesh.userData.colour = c
    if (marked || near(shown, accent)) mesh.userData.accent = true
    // The role mark (villager.mark()), for the check that it breaks the outline and carries enough colour.
    if (marked) mesh.userData.mark = true
    if (matte && !marked && role !== 'held' && role !== 'eye-left' && role !== 'eye-right') sewable.set(mesh, shown)
  })
  for (const m of replaced) m.dispose()
  const marks = meshes.filter((m) => m.userData.mark).length
  if (marks) fixes.push(`mark: ${marks} part(s) in the owner's colour`)
  for (const [from, to] of nudged) fixes.push(`felt: ${from} moved to ${to}, off the owners' colours`)

  // Slots: pose (body, hands), head under pose, eyes under head, feet under root, held under hand 0.
  const root = new THREE.Group()
  root.name = `villager ${checked.spec.name}`
  const pose = new THREE.Group()
  root.add(pose)
  const into = (parent: THREE.Object3D, role: Role, pivot: THREE.Vector3, parentPivot = new THREE.Vector3()) => {
    const g = new THREE.Group()
    g.name = role
    g.position.copy(pivot).sub(parentPivot)
    for (const m of slots.get(role) ?? []) {
      m.position.sub(pivot)
      g.add(m)
    }
    parent.add(g)
    return g
  }
  for (const m of slots.get('body')!) pose.add(m)
  const headPivot = box('head').getCenter(new THREE.Vector3())
  const head = into(pose, 'head', headPivot)
  const eyes = (['eye-left', 'eye-right'] as const).map((r) => into(head, r, box(r).getCenter(new THREE.Vector3()), headPivot))
  const handPivots = (['hand-left', 'hand-right'] as const).map((r) => ({ r, p: box(r).getCenter(new THREE.Vector3()) }))
  // Hand 0 holds the prop and waves: the one nearest the held prop, else the one on -x (as the plush).
  const heldBox = box('held')
  const heldAt = heldBox.isEmpty() ? null : heldBox.getCenter(new THREE.Vector3())
  handPivots.sort((a, b) => (heldAt ? a.p.distanceTo(heldAt) - b.p.distanceTo(heldAt) : a.p.x - b.p.x))
  const hands = handPivots.map(({ r, p }) => {
    const h = into(pose, r, p)
    h.userData.rest = p.clone()
    return h
  })
  const held = heldAt ? into(hands[0], 'held', handPivots[0].p, handPivots[0].p) : null
  // Feet: pivot under each foot on the floor; the rig places foot 0 on +x.
  const footPivots = (['foot-left', 'foot-right'] as const).map((r) => ({ r, c: box(r).getCenter(new THREE.Vector3()) }))
  footPivots.sort((a, b) => b.c.x - a.c.x)
  const feet = footPivots.map(({ r, c }) => into(root, r, new THREE.Vector3(c.x, 0, 0)))
  const side = THREE.MathUtils.clamp((Math.abs(footPivots[0].c.x) + Math.abs(footPivots[1].c.x)) / 2, 0.02, 0.25)
  const hip = THREE.MathUtils.clamp(box('body').min.y, 0, 0.4)
  root.traverse((n) => { n.castShadow = n.receiveShadow = true })
  // Caught here rather than shown: a hidden face, a floating part, a speck of a prop, odd proportions,
  // the default round body instead of the species, a role mark inside the outline (`species` and `mark`
  // false only for plumbing probes and results that predate them).
  const { failures, measures } = inspect(root, eyes, held, { head, hands, species, mark, role })
  if (enforce && failures.length) throw new Error(`check: ${failures.join('; ')}`)

  // Look regroup 3: the sewn skin. The checks above ran on the model's own parts (they measure its ears, head core
  // and marks one by one); the skin then replaces each slot's felt with one surface, and the face, the pieces and the
  // grip are checked again on what is shown.
  let skinMs: number | undefined
  if (skin) {
    const t0 = performance.now()
    root.updateMatrixWorld(true)
    const H = Math.max(box('head').max.y, 1e-3)
    const bySlot = new Map<THREE.Object3D, { mesh: THREE.Mesh; colour: string }[]>()
    for (const [mesh, colour] of sewable) {
      if (!mesh.parent) continue
      if (!bySlot.has(mesh.parent)) bySlot.set(mesh.parent, [])
      bySlot.get(mesh.parent)!.push({ mesh, colour })
    }
    const tris = (m: THREE.Mesh) => (m.geometry.index ? m.geometry.index.count : m.geometry.attributes.position.count) / 3
    let before = 0
    root.traverse((o) => { if ((o as THREE.Mesh).isMesh) before += tris(o as THREE.Mesh) })
    // Sews every slot with cells `scale` times the base size; nothing is attached yet.
    const sewAll = (scale: number) => {
      let n = 0
      return [...bySlot].map(([slot, parts]) => {
        // The face is the head's: a finer grid there.
        const cell = (scale * H) / (slot === head ? SKIN.head : SKIN.body)
        return { slot, s: sewSkin(parts, { cell, blend: SKIN.blend * H, felt, seed: seed + 41 + n++ }) }
      }).filter((x) => x.s !== null) as { slot: THREE.Object3D; s: NonNullable<ReturnType<typeof sewSkin>> }[]
    }
    const total = (list: ReturnType<typeof sewAll>) => before + list.reduce((t, { s }) => t + s.triangles - [...s.fused].reduce((u, m) => u + tris(m), 0), 0)
    let sewnSlots = sewAll(1)
    // At most SKIN.budget times the triangles of the parts as built: one retry on a coarser grid (a hedgehog's spines).
    if (total(sewnSlots) > SKIN.budget * before) {
      const over = total(sewnSlots) - SKIN.budget * before, skinTris = sewnSlots.reduce((t, { s }) => t + s.triangles, 0)
      const scale = Math.sqrt(skinTris / Math.max(skinTris - over, skinTris * 0.25)) * 1.05
      for (const { s } of sewnSlots) for (const m of s.meshes) { m.geometry.dispose(); (m.material as THREE.MeshStandardMaterial).map?.dispose(); (m.material as THREE.Material).dispose() }
      sewnSlots = sewAll(scale)
      fixes.push(`skin: over ${SKIN.budget} times the parts' triangles; sewn again on cells ${scale.toFixed(2)} times larger`)
    }
    const sewn: THREE.Mesh[] = []
    const dropped: THREE.Mesh[] = []
    let triangles = 0
    for (const { slot, s } of sewnSlots) {
      for (const m of s.fused) {
        m.removeFromParent()
        dropped.push(m)
      }
      for (const m of s.meshes) {
        m.castShadow = m.receiveShadow = true
        slot.attach(m)
        sewn.push(m)
      }
      triangles += s.triangles
      fixes.push(`skin: ${slot.name || 'body'}: ${s.notes.join('; ')}`)
    }
    // The kit's buttons and cheeks were set on the model's felt; the skin swells a little where parts join, so each is
    // moved along its own facing by the difference between the two surfaces under it.
    root.updateMatrixWorld(true)
    const ray = new THREE.Raycaster()
    const q = new THREE.Quaternion(), at = new THREE.Vector3(), n3 = new THREE.Vector3()
    let reseated = 0
    for (const { mesh } of added) {
      if (!mesh.userData.onFelt) continue
      mesh.getWorldPosition(at)
      n3.set(0, 0, 1).applyQuaternion(mesh.getWorldQuaternion(q))
      ray.set(at.clone().addScaledVector(n3, 0.05), n3.clone().negate())
      ray.far = 0.1
      const was = ray.intersectObjects(dropped, false)[0], now = ray.intersectObjects(sewn, false)[0]
      if (!was || !now) continue
      const lift = was.distance - now.distance
      if (Math.abs(lift) < 1e-5 || Math.abs(lift) > 0.03) continue
      mesh.position.addScaledVector(n3, lift)
      mesh.updateMatrixWorld(true)
      reseated++
    }
    // The kit's mark was set on the model's felt too: the whole mark moves along its seat's direction by the
    // difference between the two surfaces at the seat (./kit.ts seat), so a hat sits on the skin shown.
    const seats = new Map<{ at: THREE.Vector3; dir: THREE.Vector3 }, THREE.Mesh[]>()
    for (const { mesh } of added) {
      const s = mesh.userData.seat
      if (!s) continue
      if (!seats.has(s)) seats.set(s, [])
      seats.get(s)!.push(mesh)
    }
    let seatedMarks = 0
    for (const [{ at: a, dir }, parts] of seats) {
      ray.set(a.clone().addScaledVector(dir, 0.05), dir.clone().negate())
      ray.far = 0.1
      const was = ray.intersectObjects(dropped, false)[0], now = ray.intersectObjects(sewn, false)[0]
      if (!was || !now) continue
      const lift = was.distance - now.distance
      if (Math.abs(lift) < 1e-5 || Math.abs(lift) > 0.03) continue
      for (const m of parts) {
        m.position.addScaledVector(dir, lift)
        m.updateMatrixWorld(true)
      }
      seatedMarks++
    }
    // A skullcap fits the skin under it, its rim sunk, its top up to the board (./kit.ts wrapCap).
    const headSkin = sewnSlots.find(({ slot }) => slot === head)?.s
    const wrapped = headSkin ? added.filter(({ mesh }) => mesh.userData.wrap).map(({ mesh }) => wrapCap(mesh, headSkin.reach, SKIN.capLift * H, SKIN.capSink * H)).filter((n) => n > 0).length : 0
    if (seatedMarks || wrapped) fixes.push(`skin: the mark seated on the skin${wrapped ? ', the skullcap fitted to it' : ''}`)
    for (const m of dropped) m.geometry.dispose()
    // The face again, on the skin: a swelling where a snout joins must not cover a button.
    const shown: THREE.Mesh[] = []
    root.traverse((o) => { if ((o as THREE.Mesh).isMesh) shown.push(o as THREE.Mesh) })
    const faces = eyes.map((e, i) => faceViews(root, shown, e, i))
    const hidden = faces.flatMap((f) => f.failures)
    if (enforce && hidden.length) throw new Error(`check (skin): ${hidden.join('; ')}`)
    measures.eyeRays = faces.map((f) => f.least)
    // The mark on the skin: every part still sits on what holds it (the round-6 rule, on the surfaces shown). The
    // kit and the skin are trusted code, so a miss here is ours, not the model's: it is measured and noted (the
    // scripts hold it at zero), never sent back as a repair. Measured on the skin's triangles it costs 0.5 to 1.5 s,
    // so only the scripts ask for it (`attachOnSkin`).
    if (mark && attachOnSkin) {
      measures.loose = markAttachment(shown, root)
      for (const l of measures.loose) fixes.push(`skin: a ${l.colour} mark part near (${l.at.map((x) => x.toFixed(2)).join(', ')}) stands ${l.gap.toFixed(3)} clear of the skin`)
      const cap = added.find(({ mesh }) => mesh.userData.wrap)?.mesh
      if (cap && measures.place?.board) {
        const { board, half } = cap.userData.wrap as Wrap
        measures.place.board.rest = +(surfaceContact(board, cap, LIMITS.attach).width / (2 * half)).toFixed(3)
      }
    }
    // The skin itself: no specks the grid caught alone, no triangle facing inwards (it shows as a hole).
    const stats = sewn.filter((m) => m.name === 'skin').map((m) => m.userData.stats as ReturnType<typeof surfaceStats>)
    measures.skin = { meshes: stats.length, pieces: stats.reduce((t, s) => t + s.pieces, 0), specks: stats.reduce((t, s) => t + s.specks, 0), inward: stats.reduce((t, s) => t + s.inward, 0) }
    skinMs = performance.now() - t0
    fixes.push(`skin: ${triangles} triangles in ${skinMs.toFixed(0)} ms with the face check; ${reseated} kit part(s) reseated on it`)
  }

  const g = checked.spec.gait
  const touch = g.fidget > 0.02 ? (v: Villager) => {
    const t = g.stepped ? Math.floor(v.t * 12) / 12 : v.t
    head.rotation.z = v.seated * 0.08 * Math.sin(t * 0.4 + 1) + g.fidget * 0.12 * Math.sin(t * (1.2 + g.fidget * 3.5)) * (1 - v.walk * 0.6)
  } : undefined
  const fig: Figure = {
    root, pose, head, eyes, feet, hands, height: box('head').max.y, hip, side,
    stride: g.stride, speed: g.speed, bob: g.bob, stepped: g.stepped, outline, touch,
  }
  // Last, once every check has measured the rigid parts: the felt is skinned to a spine and flop bones (#104).
  fig.soft = soften(fig)
  const { name, bark, voice } = checked.spec
  return { fig, about: { name, role, bark, gait: g, voice, persona: checked.spec.persona }, fixes, measures, skinMs }
}
