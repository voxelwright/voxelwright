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
import { inspect, type Measures } from './checks'
import type { VillagerSpec } from './spec'

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
export function assemble(prop: PropData, raw: unknown, phys: boolean, accent: string, seed = 1, enforce = true): Assembled {
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
  })
  for (const m of replaced) m.dispose()

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
  // Caught here rather than shown: a hidden face, a floating part, a speck of a prop, odd proportions.
  const { failures, measures } = inspect(root, eyes, held)
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
