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
import type { Figure, Villager } from '../rig'
import { check } from './build'
import { accentTails, inspect, MARK, type Measures } from './checks'
import type { VillagerSpec } from './spec'

/**
 * #47 regroup on the owner colour and the role mark (screenshots/villager-gen/LEARNING-look.md). Unset is today's look.
 * - a: a tidy owner band (collar or armband); trusted code trims any owner-colour part hanging in front of the
 *   face (./checks.ts accentTails), and the mark must break the outline by MARK_A rather than MARK.
 * - b: an owner badge on the chest, no scarf; the mark is recoloured to the CONTRAST tone farthest from the body.
 * - c: the mark is the owner colour: trusted code recolours every villager.mark() part to the owner's felt.
 */
export type Strategy = 'a' | 'b' | 'c'
const MARK_A = 0.15
/** Strategy b's mark tones: kept clear of the owners' accent hues (rust, blue, mustard, green). */
const CONTRAST = ['#f4ede0', '#3a302c', '#7d4b6a']

/** OKLab distance between two #rrggbb colours (about 0 to 1; 0.1 is a clear step). */
function oklabDistance(a: string, b: string) {
  const lab = (h: string) => {
    const c = new THREE.Color(h) // linear sRGB
    const l = Math.cbrt(0.4122214708 * c.r + 0.5363325363 * c.g + 0.0514459929 * c.b)
    const m = Math.cbrt(0.2119034982 * c.r + 0.6806995451 * c.g + 0.1073969566 * c.b)
    const s = Math.cbrt(0.0883024619 * c.r + 0.2817188376 * c.g + 0.6299787005 * c.b)
    return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s]
  }
  const x = lab(a), y = lab(b)
  return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2])
}

const REQUIRED: Role[] = ['head', 'eye-left', 'eye-right', 'hand-left', 'hand-right', 'foot-left', 'foot-right']
/** Model units: a villager stands 0.25 to 1.1 tall (Dumpling about 0.45, before the room's 1.3 scale). */
const HEIGHT: [number, number] = [0.25, 1.1]

export interface Assembled {
  fig: Figure
  /** Name, role, bark, gait and voice, clamped by the spec checker. */
  about: Pick<VillagerSpec, 'name' | 'role' | 'bark' | 'gait' | 'voice' | 'persona'>
  fixes: string[]
  /** What ./checks.ts measured; the figure is refused before this when a check fails. */
  measures: Measures
}

/** Two #rrggbb colours within a few steps of 255 on every channel. */
function near(a: string, b: string, tol = 8) {
  const x = new THREE.Color(a), y = new THREE.Color(b)
  return Math.max(Math.abs(x.r - y.r), Math.abs(x.g - y.g), Math.abs(x.b - y.b)) * 255 <= tol
}

const own = (o: unknown, k: string): unknown => (o !== null && typeof o === 'object' && !Array.isArray(o) && Object.hasOwn(o, k) ? (o as Record<string, unknown>)[k] : undefined)
const hex = (c: number[]) => '#' + new THREE.Color().setRGB(c[0], c[1], c[2]).getHexString()

/** Checked wire data (with roles) and the raw `villager` block to a Figure, or a thrown reason. */
export function assemble(prop: PropData, raw: unknown, phys: boolean, accent: string, seed = 1, enforce = true, species = true, mark = true, strategy?: Strategy): Assembled {
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

  // Trusted rebuild of the geometry; its materials are replaced below.
  const group = rebuild(prop)
  const meshes = group.children as THREE.Mesh[]
  meshes.forEach((mesh, i) => slots.get((prop.meshes[i].role ?? 'body') as Role)!.push(mesh))

  // Stand it on the floor.
  group.updateMatrixWorld(true)
  const all = new THREE.Box3().setFromObject(group)
  const height = all.max.y - all.min.y
  if (!(height >= HEIGHT[0] && height <= HEIGHT[1])) throw new Error(`the villager is ${height.toFixed(2)} tall; make it ${HEIGHT[0]} to ${HEIGHT[1]} model units`)
  for (const mesh of meshes) mesh.position.y -= all.min.y
  group.updateMatrixWorld(true)
  // Every slot's bounds, measured once before anything is moved.
  const boxes = new Map<Role, THREE.Box3>()
  for (const [role, list] of slots) {
    const b = new THREE.Box3()
    for (const m of list) b.expandByObject(m)
    boxes.set(role, b)
  }
  const box = (role: Role) => boxes.get(role) ?? new THREE.Box3()

  // The felt look, from trusted code. Matte parts become felt; glossy or metal ones stay smooth beads.
  const bodyColour = hex(prop.materials[prop.meshes[meshes.indexOf(slots.get('body')![0])].material].color)
  const lum = new THREE.Color(bodyColour).convertLinearToSRGB()
  const rimStrength = THREE.MathUtils.clamp(0.28 + (0.75 - (0.299 * lum.r + 0.587 * lum.g + 0.114 * lum.b)) * 1.8, 0.22, 0.6)
  const { felt, outline } = feltKit(phys, rimStrength, accent, seed + 25)
  const made = new Map<number, THREE.Material>()
  const replaced = new Set<THREE.Material>()
  meshes.forEach((mesh, i) => {
    const k = prop.meshes[i].material
    const old = mesh.material as THREE.MeshStandardMaterial
    if (!made.has(k)) {
      const w = prop.materials[k]
      const c = hex(w.color)
      const matte = w.roughness >= 0.5 && w.metalness < 0.5
      made.set(k, matte ? felt(c, old.map ?? feltTexture(c, seed + k, { band: false })) : new THREE.MeshStandardMaterial({ color: c, roughness: Math.max(0.2, w.roughness), metalness: w.metalness, map: old.map }))
    }
    replaced.add(old)
    mesh.material = made.get(k)!
    // The made colour, for check reasons, and the owner's accent, for measuring how much of it shows (load.ts silhouettes).
    mesh.userData.colour = hex(prop.materials[k].color)
    if (near(mesh.userData.colour, accent)) mesh.userData.accent = true
    // The role mark (villager.mark()), for the check that it breaks the outline.
    if (prop.meshes[i].mark) mesh.userData.mark = true
  })
  for (const m of replaced) m.dispose()

  // Regroup strategies b and c: the mark's colour is decided here, never by the model. Each marked part gets
  // its own material, so a mark that shared a colour with the body does not recolour the body too.
  const marked = meshes.filter((m) => m.userData.mark)
  if (strategy === 'c') {
    for (const m of marked) {
      m.material = felt(accent, feltTexture(accent, seed + 7, { band: false }))
      m.userData.colour = accent
      m.userData.accent = true
    }
    if (marked.length) fixes.push(`mark: ${marked.length} part(s) in the owner's colour`)
  } else if (strategy === 'b' && marked.length) {
    // Against the two colours that cover most of the villager (the body and a shell, spines or wool).
    const area = new Map<string, number>()
    meshes.forEach((m, i) => {
      if (m.userData.mark || m.userData.accent || prop.meshes[i].role === 'held') return
      const s = new THREE.Box3().setFromObject(m).getSize(new THREE.Vector3())
      area.set(m.userData.colour, (area.get(m.userData.colour) ?? 0) + s.x * s.y * s.z)
    })
    const busy = [...area.entries()].sort((a, b) => b[1] - a[1]).slice(0, 2).map(([c]) => c)
    const tone = CONTRAST.map((c) => ({ c, d: Math.min(...busy.map((b) => oklabDistance(c, b))) })).sort((a, b) => b.d - a.d)[0].c
    for (const m of marked) {
      if (m.userData.accent) continue // the owner's one trim on the mark stays
      m.material = felt(tone, feltTexture(tone, seed + 7, { band: false }))
      m.userData.colour = tone
    }
    fixes.push(`mark: recoloured ${tone} against ${busy.join(', ')}`)
  }

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
  // Strategy a: no owner-colour part may hang in front of the face; trim it rather than ask again.
  if (strategy === 'a') {
    root.updateMatrixWorld(true)
    const all: THREE.Mesh[] = []
    root.traverse((o) => { if ((o as THREE.Mesh).isMesh) all.push(o as THREE.Mesh) })
    const inHeld = new Set<THREE.Mesh>()
    held?.traverse((o) => { if ((o as THREE.Mesh).isMesh) inHeld.add(o as THREE.Mesh) })
    const tails = accentTails(all, inHeld, eyes, head, hands)
    for (const t of tails) t.removeFromParent()
    if (tails.length) fixes.push(`owner band: trimmed ${tails.length} hanging part(s) in front of the face`)
  }
  // Caught here rather than shown: a hidden face, a floating part, a speck of a prop, odd proportions,
  // the default round body instead of the species, a role mark inside the outline (`species` and `mark`
  // false only for plumbing probes and results that predate them).
  const { failures, measures } = inspect(root, eyes, held, { head, hands, species, mark, role: checked.spec.role, markMin: strategy === 'a' ? MARK_A : MARK })
  if (enforce && failures.length) throw new Error(`check: ${failures.join('; ')}`)

  const g = checked.spec.gait
  const touch = g.fidget > 0.02 ? (v: Villager) => {
    const t = g.stepped ? Math.floor(v.t * 12) / 12 : v.t
    head.rotation.z = v.seated * 0.08 * Math.sin(t * 0.4 + 1) + g.fidget * 0.12 * Math.sin(t * (1.2 + g.fidget * 3.5)) * (1 - v.walk * 0.6)
  } : undefined
  const fig: Figure = {
    root, pose, head, eyes, feet, hands, height: box('head').max.y, hip, side,
    stride: g.stride, speed: g.speed, bob: g.bob, stepped: g.stepped, outline, touch,
  }
  const { name, role, bark, voice } = checked.spec
  return { fig, about: { name, role, bark, gait: g, voice, persona: checked.spec.persona }, fixes, measures }
}
