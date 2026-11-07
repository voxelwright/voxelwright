// #47 round 2: trusted checks on a finished villager Figure, before anyone sees it. Each
// failure is one plain sentence a model can act on; the runner sends them back as the
// repair request. Model units, the villager standing on y = 0 and facing +z, before the
// room's scale. The thresholds come from the hand-made three and round 1's code results.
import * as THREE from 'three/webgpu'

/** Bounds on the standing figure, without the held prop. */
export const LIMITS = {
  height: [0.3, 1.0],
  /** Width across x over height. Dumpling is the widest hand-made at about 0.9; round 3's heron is 0.38. */
  aspect: [0.25, 1.5],
  /** Parts closer than this (bounding boxes) count as touching. */
  gap: 0.02,
  /** The held prop's longest side over the villager's height: below this it reads as a speck at dollhouse distance. */
  held: [0.3, 1.1],
  /** The dollhouse camera looks down about this far (radians, load.ts silhouettes); the face must show from there too. */
  pitch: 0.58,
} as const

export interface Measures {
  height: number
  width: number
  depth: number
  /** Longest side of the held prop over height; null when nothing is held. */
  held: number | null
  /** Groups of parts that do not touch each other; 1 means one connected plush. */
  pieces: number
  /** Of 5 rays at each eye, how many reach it first, the fewer of the front and dollhouse views. */
  eyeRays: number[]
  /** Species features against the round template (./speciesFeatures); null without a head or body part. */
  species: Species | null
}

/** The colour the part was made in (assemble.ts keeps it; the felt material shades its own). */
const hexOf = (m: THREE.Object3D) => (typeof m.userData.colour === 'string' ? m.userData.colour : 'felt')
/** The slot a mesh hangs in (the rig's group names), or 'body'. */
function slotOf(o: THREE.Object3D, root: THREE.Object3D): string {
  for (let p: THREE.Object3D | null = o.parent; p && p !== root; p = p.parent) {
    if (/^(head|eye-left|eye-right|hand-left|hand-right|foot-left|foot-right|held)$/.test(p.name)) return p.name
  }
  return 'body'
}

/**
 * Looks at a standing figure: the face visible from the front, no part floating free,
 * the held prop big enough to read, sane proportions, and (unless `species` is false) more than
 * the default round template. `held` is the prop's group, if any; `head` and `hands` are the
 * rig's groups, which the species measure needs.
 */
export function inspect(root: THREE.Object3D, eyes: THREE.Object3D[], held: THREE.Object3D | null, { head = null, hands = [], species = true }: { head?: THREE.Object3D | null; hands?: THREE.Object3D[]; species?: boolean } = {}): { failures: string[]; measures: Measures } {
  root.updateMatrixWorld(true)
  const meshes: THREE.Mesh[] = []
  root.traverse((o) => { if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh) })
  const inHeld = new Set<THREE.Mesh>()
  held?.traverse((o) => { if ((o as THREE.Mesh).isMesh) inHeld.add(o as THREE.Mesh) })
  const failures: string[] = []

  // Proportions, without the prop (a long duster should not make a villager "wide").
  const figure = new THREE.Box3()
  for (const m of meshes) if (!inHeld.has(m)) figure.expandByObject(m, true)
  const size = figure.getSize(new THREE.Vector3())
  const height = figure.max.y
  const aspect = size.x / Math.max(height, 1e-6)
  if (height < LIMITS.height[0] || height > LIMITS.height[1]) failures.push(`it stands ${height.toFixed(2)} tall; keep it between ${LIMITS.height[0]} and ${LIMITS.height[1]} model units`)
  if (aspect < LIMITS.aspect[0]) failures.push(`it is ${size.x.toFixed(2)} wide and ${height.toFixed(2)} tall, too thin to read as a plush; widen the body`)
  if (aspect > LIMITS.aspect[1]) failures.push(`it is ${size.x.toFixed(2)} wide and only ${height.toFixed(2)} tall; keep the width under ${LIMITS.aspect[1]} times the height`)

  // Face: rays at each eye's centre and four points around it, from straight in front and from the
  // dollhouse camera's pitch (in front and above); from both, the eye must be hit first.
  const ray = new THREE.Raycaster()
  const eyeRays: number[] = []
  const views = [
    { name: 'the front', dir: new THREE.Vector3(0, 0, -1), up: new THREE.Vector3(0, 1, 0), fix: 'keep the scarf at the neck, below the head' },
    { name: 'the dollhouse view (in front and above)', dir: new THREE.Vector3(0, -Math.sin(LIMITS.pitch), -Math.cos(LIMITS.pitch)), up: new THREE.Vector3(0, Math.cos(LIMITS.pitch), -Math.sin(LIMITS.pitch)), fix: 'raise or tilt back any brim or hood so the eyes show from above' },
  ]
  eyes.forEach((eye, i) => {
    const own = new Set<THREE.Object3D>()
    eye.traverse((o) => own.add(o))
    const box = new THREE.Box3().setFromObject(eye, true)
    if (box.isEmpty()) {
      eyeRays.push(0)
      return
    }
    const c = box.getCenter(new THREE.Vector3())
    const r = box.getSize(new THREE.Vector3()).multiplyScalar(0.3)
    let least = 5
    for (const { name, dir, up, fix } of views) {
      let seen = 0
      const blockers = new Map<string, number>()
      for (const [dx, dy] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const at = c.clone().add(new THREE.Vector3(dx * r.x, 0, 0)).addScaledVector(up, dy * r.y)
        ray.set(at.addScaledVector(dir, -2), dir)
        const hit = ray.intersectObjects(meshes, false)[0]
        if (hit && own.has(hit.object)) seen++
        else if (hit) {
          const what = `a ${hexOf(hit.object)} ${slotOf(hit.object, root)} part`
          blockers.set(what, (blockers.get(what) ?? 0) + 1)
        }
      }
      least = Math.min(least, seen)
      if (seen < 2) {
        const by = [...blockers.entries()].sort((a, b) => b[1] - a[1])[0]?.[0]
        failures.push(`the ${i === 0 ? 'first' : 'second'} eye is hidden from ${name}${by ? ` behind ${by}` : ''}; nothing may cover the face (${fix})`)
      }
    }
    eyeRays.push(least)
  })

  // Detached parts: meshes whose bounds touch (within the gap) are joined; everything must be one piece.
  const boxes = meshes.map((m) => new THREE.Box3().setFromObject(m, true).expandByScalar(LIMITS.gap / 2))
  const up = meshes.map((_, i) => i)
  const find = (i: number): number => (up[i] === i ? i : (up[i] = find(up[i])))
  for (let i = 0; i < meshes.length; i++) for (let j = i + 1; j < meshes.length; j++) if (boxes[i].intersectsBox(boxes[j])) up[find(i)] = find(j)
  const groups = new Map<number, THREE.Mesh[]>()
  meshes.forEach((m, i) => {
    const k = find(i)
    if (!groups.has(k)) groups.set(k, [])
    groups.get(k)!.push(m)
  })
  const pieces = groups.size
  if (pieces > 1) {
    const sorted = [...groups.values()].sort((a, b) => b.length - a.length)
    for (const loose of sorted.slice(1)) {
      const slots = [...new Set(loose.map((m) => slotOf(m, root)))].join(', ')
      const at = new THREE.Box3()
      for (const m of loose) at.expandByObject(m, true)
      const c = at.getCenter(new THREE.Vector3())
      failures.push(`${loose.length === 1 ? 'a' : loose.length} ${slots} part${loose.length === 1 ? '' : 's'} near (${c.x.toFixed(2)}, ${c.y.toFixed(2)}, ${c.z.toFixed(2)}) float${loose.length === 1 ? 's' : ''} free of the rest; every part must touch or overlap another`)
    }
  }

  // The held prop at a size that reads from across the room.
  let heldRatio: number | null = null
  if (held && inHeld.size) {
    const hb = new THREE.Box3().setFromObject(held, true).getSize(new THREE.Vector3())
    heldRatio = Math.max(hb.x, hb.y, hb.z) / Math.max(height, 1e-6)
    if (heldRatio < LIMITS.held[0]) failures.push(`the held prop is ${Math.max(hb.x, hb.y, hb.z).toFixed(2)} long, too small to read at a distance; make its longest side at least ${(LIMITS.held[0] * height).toFixed(2)} (a third of the villager's height)`)
    if (heldRatio > LIMITS.held[1]) failures.push(`the held prop is longer than the villager is tall; keep it under ${(LIMITS.held[1] * height).toFixed(2)}`)
  }

  // Species: is it more than the default round body with a head on top and a hat?
  const features = speciesFeatures(meshes, inHeld, eyes, head, hands, height)
  const reads = features && (Object.keys(SPECIES) as (keyof Species)[]).filter((k) => features[k] >= SPECIES[k])
  if (species && features && !reads?.length) failures.push(`it is the default round body with a head on top and a hat, not its species: ${(Object.keys(SPECIES) as (keyof Species)[]).map((k) => FEATURE_WORDS[k]).join('; ')}. Start from the species' own body plan and give it the 2 or 3 features that say what animal it is, big enough to read from across the room`)

  return { failures, measures: { height, width: size.x, depth: size.z, held: heldRatio, pieces, eyeRays, species: features } }
}

/**
 * How far a villager departs from the default round template: a body part with a head part
 * straight on top. Each feature is a plain length over the core it grows from, from the
 * model's own geometry. Not counted: the held prop, the owner's scarf and trim (accent parts),
 * and the hat (head parts centred over the head and above its middle), so a role mark alone
 * never passes. Eyes count: a frog's sit on top of its head.
 */
export interface Species {
  /** Snout, muzzle, beak or trunk past the face, or the head itself ahead of the body, over the head's half-width. */
  forward: number
  /** The body's lowest point off the floor (legs), over the height. */
  legs: number
  /** The gap between the body's top and the head's bottom (a neck), over the height. */
  neck: number
  /** Paired parts (ears, horns, tufts, eyes on top) rising above the head, over the head's half-height. */
  top: number
  /** Paired head parts out past the head's sides (big flapping ears), over the head's half-width. */
  side: number
}

/** A feature reads at dollhouse distance from these sizes on; one is enough. Calibrated on rounds 1 and 2 (README, Round 3). */
export const SPECIES: Species = { forward: 0.3, legs: 0.14, neck: 0.06, top: 0.25, side: 0.35 }

const FEATURE_WORDS: Record<keyof Species, string> = {
  forward: 'nothing reaches forward past the face (no snout, muzzle or beak, and the head sits on top of the body rather than ahead of it)',
  legs: 'the body sits on the floor (no legs)',
  neck: 'the head sits straight on the body (no neck)',
  top: 'nothing but the hat rises above the head (no tall ears, horns, tufts or eyes on top)',
  side: 'nothing sticks out past the sides of the head (no big ears)',
}

export function speciesFeatures(meshes: THREE.Mesh[], inHeld: Set<THREE.Mesh>, eyes: THREE.Object3D[], headGroup: THREE.Object3D | null, handGroups: THREE.Object3D[], height: number): Species | null {
  const under = (groups: THREE.Object3D[]) => {
    const set = new Set<THREE.Object3D>()
    for (const g of groups) g.traverse((o) => set.add(o))
    return set
  }
  const inEye = under(eyes), inHead = under(headGroup ? [headGroup] : []), inHand = under(handGroups)
  const boxOf = new Map(meshes.map((m) => [m, new THREE.Box3().setFromObject(m, true)]))
  // Size in the part's own axes, so a tilted flat brim does not outweigh the head it sits on.
  const volume = (m: THREE.Mesh) => {
    m.geometry.computeBoundingBox()
    const s = m.geometry.boundingBox!.getSize(new THREE.Vector3()).multiply(new THREE.Vector3().setFromMatrixScale(m.matrixWorld))
    return Math.abs(s.x * s.y * s.z)
  }
  const largest = (list: THREE.Mesh[]) => list.reduce<THREE.Mesh | null>((a, m) => (!a || volume(m) > volume(a) ? m : a), null)
  const parts = meshes.filter((m) => !inHeld.has(m) && !m.userData.accent && !inHand.has(m))
  const body = largest(parts.filter((m) => !inHead.has(m) && !inEye.has(m)))
  const head = largest(parts.filter((m) => inHead.has(m) && !inEye.has(m)))
  if (!body || !head) return null
  const hb = boxOf.get(head)!, bb = boxOf.get(body)!
  const hc = hb.getCenter(new THREE.Vector3()), bc = bb.getCenter(new THREE.Vector3())
  const hw = (hb.max.x - hb.min.x) / 2, hh = (hb.max.y - hb.min.y) / 2
  const centred = (b: THREE.Box3) => Math.abs((b.min.x + b.max.x) / 2 - hc.x) < 0.2 * hw
  // The hat: head parts centred over the head and above its middle (toque, cap, mortarboard, brim, hood top).
  const hat = (m: THREE.Mesh) => inHead.has(m) && !inEye.has(m) && m !== head && centred(boxOf.get(m)!) && boxOf.get(m)!.getCenter(new THREE.Vector3()).y > hc.y
  const rest = parts.filter((m) => m !== head && m !== body && !hat(m))
  // Forward: a head part past the face, or a front-half body part past the chest (a tail or a back strap does not count).
  let reach = hb.max.z - bb.max.z, top = hb.max.y, side = 0
  for (const m of rest) {
    const b = boxOf.get(m)!
    reach = Math.max(reach, inHead.has(m) ? b.max.z - hb.max.z : (b.min.z + b.max.z) / 2 > bc.z ? b.max.z - Math.max(bb.max.z, hb.max.z) : 0)
    if (inHead.has(m) && !centred(b)) {
      top = Math.max(top, b.max.y)
      side = Math.max(side, b.max.x - hb.max.x, hb.min.x - b.min.x)
    }
  }
  return {
    forward: +(Math.max(0, reach) / hw).toFixed(3),
    legs: +(bb.min.y / height).toFixed(3),
    neck: +(Math.max(0, hb.min.y - bb.max.y) / height).toFixed(3),
    top: +((top - hb.max.y) / hh).toFixed(3),
    side: +(Math.max(0, side) / hw).toFixed(3),
  }
}
