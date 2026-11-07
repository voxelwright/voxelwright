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
  /** The held prop must come this close to a hand's own box (in the hand's axes): round 3's heron holds its slate 1.5 mm in front of its mitten; round 4's owl's book stands 2 cm off. */
  grip: 0.005,
  /** The held prop's longest side over the villager's height: below this it reads as a speck at dollhouse distance. */
  held: [0.3, 1.1],
  /** The dollhouse camera looks down about this far (radians, load.ts silhouettes); the face must show from there too. */
  pitch: 0.58,
  /** Every marked part must come this close, surface to surface, to the part it sits on (round 6: floating pom-poms and boards). */
  attach: 0.005,
  /** Where a marked part meets what holds it, the meeting must be at least this share of the thinner part's thinnest side wide: round 5's sound joints are 0.9 or more, its pom-poms on a cone's needle point 0.20 to 0.22, and the old prompt recipe's 0.30. */
  joint: 0.5,
  /** Round 7: the eyes must also show past the role's mark from this much steeper than the dollhouse camera (radians, 20 degrees): round 6's hippo's sun hat cleared them only to 15 degrees steeper, and read as a slab over the head. */
  faceMargin: 0.345,
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
  /** Round 7: per eye, how much steeper than the dollhouse view (radians) the eye still shows past the role's mark, checked in 5-degree steps up to 80 degrees. */
  faceMargin: number[]
  /** Species features against the round template (./speciesFeatures); null without a head or body part. */
  species: Species | null
  /** How far the role mark breaks the outline (./markBreak); null when nothing is tagged with villager.mark(). */
  mark: MarkBreak | null
  /** Pixels of the role mark (dyed in the owner's colour) that show in the 128 px dollhouse render (./ownerArea). */
  ownerPx: number
  /** Whether the held prop touches a hand; null when nothing is held. */
  heldInHand: boolean | null
  /** Marked parts not joined, surface to surface within LIMITS.attach and through other marked parts, to an unmarked part (./markAttachment). */
  loose: Loose[]
  /** Where the role's mark sits against the head (./markPlace); null without a mark or a head. */
  place: MarkPlace | null
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
export function inspect(root: THREE.Object3D, eyes: THREE.Object3D[], held: THREE.Object3D | null, { head = null, hands = [], species = true, mark = true, role = '' }: { head?: THREE.Object3D | null; hands?: THREE.Object3D[]; species?: boolean; mark?: boolean; role?: string } = {}): { failures: string[]; measures: Measures } {
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
  const faceMargin: number[] = []
  const views = [
    { name: 'the front', dir: new THREE.Vector3(0, 0, -1), up: new THREE.Vector3(0, 1, 0), fix: 'keep everything at the neck, below the head' },
    { name: 'the dollhouse view (in front and above)', dir: new THREE.Vector3(0, -Math.sin(LIMITS.pitch), -Math.cos(LIMITS.pitch)), up: new THREE.Vector3(0, Math.cos(LIMITS.pitch), -Math.sin(LIMITS.pitch)), fix: 'raise or tilt back any brim or hood so the eyes show from above' },
  ]
  eyes.forEach((eye, i) => {
    const own = new Set<THREE.Object3D>()
    eye.traverse((o) => own.add(o))
    const box = new THREE.Box3().setFromObject(eye, true)
    if (box.isEmpty()) {
      eyeRays.push(0)
      faceMargin.push(0)
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
    // The margin: the steepest view, from the dollhouse pitch up in 5-degree steps, at which at least 3 of 5 rays reach
    // the eye past every part of the mark. Only the mark counts as a blocker here (a snout or a tuft is the species' own business).
    let steepest = 0
    for (let pitch = LIMITS.pitch; pitch <= 1.4; pitch += Math.PI / 36) {
      const dir = new THREE.Vector3(0, -Math.sin(pitch), -Math.cos(pitch)), up = new THREE.Vector3(0, Math.cos(pitch), -Math.sin(pitch))
      let clear = 0
      for (const [dx, dy] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const at = c.clone().add(new THREE.Vector3(dx * r.x, 0, 0)).addScaledVector(up, dy * r.y)
        ray.set(at.addScaledVector(dir, -2), dir)
        const hit = ray.intersectObjects(meshes, false)[0]
        if (!hit || own.has(hit.object) || hit.object.userData.mark !== true) clear++
      }
      if (clear < 3) break
      steepest = pitch
    }
    faceMargin.push(+(steepest - LIMITS.pitch).toFixed(3))
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
    // Against the villager without its role mark: the felt kit's toque or plume is sewn on after the model sized its prop.
    const bare = new THREE.Box3()
    for (const m of meshes) if (!inHeld.has(m) && !m.userData.mark) bare.expandByObject(m, true)
    const tall = bare.isEmpty() ? height : bare.max.y
    heldRatio = Math.max(hb.x, hb.y, hb.z) / Math.max(tall, 1e-6)
    if (heldRatio < LIMITS.held[0]) failures.push(`the held prop is ${Math.max(hb.x, hb.y, hb.z).toFixed(2)} long, too small to read at a distance; make its longest side at least ${(LIMITS.held[0] * tall).toFixed(2)} (a third of the villager's height)`)
    if (heldRatio > LIMITS.held[1]) failures.push(`the held prop is longer than the villager is tall; keep it under ${(LIMITS.held[1] * tall).toFixed(2)}`)
  }
  // The held prop in a hand, not beside it: touching the body is not enough (Opus and Sol saw tools floating beside villagers).
  const handMeshes: THREE.Mesh[] = []
  // The held group hangs under hand 0 (assemble.ts), so its meshes are left out of the hand's own.
  for (const g of hands) g.traverse((o) => { if ((o as THREE.Mesh).isMesh && !inHeld.has(o as THREE.Mesh)) handMeshes.push(o as THREE.Mesh) })
  const heldInHand = held && inHeld.size && handMeshes.length ? [...inHeld].some((h) => handMeshes.some((k) => touching(h, k, LIMITS.grip))) : null
  if (heldInHand === false) {
    const hb = new THREE.Box3().setFromObject(held!, true).getCenter(new THREE.Vector3())
    failures.push(`the held prop near (${hb.x.toFixed(2)}, ${hb.y.toFixed(2)}, ${hb.z.toFixed(2)}) does not touch either hand; put it in the hand so the mitten overlaps its handle, not beside the hand or against the body`)
  }

  // Species: is it more than the default round body with a head on top and a hat?
  const features = speciesFeatures(meshes, inHeld, eyes, head, hands, height)
  const reads = features && (Object.keys(SPECIES) as (keyof Species)[]).filter((k) => features[k] >= SPECIES[k])
  if (species && features && !reads?.length) failures.push(`it is the default round body with a head on top and a hat, not its species: ${(Object.keys(SPECIES) as (keyof Species)[]).map((k) => FEATURE_WORDS[k]).join('; ')}. Start from the species' own body plan and give it the 2 or 3 features that say what animal it is, big enough to read from across the room`)

  // Role mark (round 4): tagged with villager.mark(), and it must change the outline seen from the dollhouse.
  const broke = markBreak(meshes, inHeld, eyes, head, hands, height)
  // Owner colour (the look regroup's C): assemble.ts dyes the marked parts in the owner's felt.
  const ownerPx = ownerArea(meshes, (m) => m.userData.mark === true)
  const markFailures = failures.length
  if (mark) {
    const name = `the ${role && MARK_NAMES[role] ? `${role}'s ${MARK_NAMES[role]}` : 'role mark'}`
    if (!broke) failures.push(`nothing is tagged as ${name}; build it as the role table says and pass it to villager.mark() so the home can check it`)
    else if (broke.core) failures.push(`the ${broke.core} itself is tagged with villager.mark(); tag only ${name}, not the ${broke.core} it sits on`)
    else if (broke.share > MARK_SHARE) failures.push(`the parts tagged with villager.mark() are ${Math.round(broke.share * 100)}% of the villager; tag only ${name}, at most ${Math.round(MARK_SHARE * 100)}% of it`)
    else if (Math.max(broke.above, broke.side) < MARK) failures.push(`${name} stays inside the outline seen from in front and above: it rises ${Math.max(0, broke.above * height).toFixed(2)} above the head and reaches ${Math.max(0, broke.side * height).toFixed(2)} past the body's side; make it rise at least ${(MARK * height).toFixed(2)} above the top of the head, or reach that far past the side of the head or body, so it changes the outline`)
    else if (ownerPx < OWNER_PX) failures.push(`${name} shows only ${ownerPx} pixels of the owner's colour from the dollhouse view (at least ${OWNER_PX}): the home dyes the mark in the owner's colour, so a thin mark says too little about whose villager it is. Make it bigger or thicker, ${THICKER[role] ?? 'with more felt in it'}`)
  }
  // Round 6: the mark sits on what holds it (no gap), and the round marks are told apart by place as well as shape.
  const loose = broke && !broke.core ? markAttachment(meshes, root) : []
  const place = broke && !broke.core ? markPlace(meshes, inHeld, eyes, head, hands, role, height) : null
  // Only once the mark itself passes, so a model gets one mark problem at a time.
  if (mark && broke && !broke.core && failures.length === markFailures) {
    const name = `the ${role && MARK_NAMES[role] ? `${role}'s ${MARK_NAMES[role]}` : 'role mark'}`
    for (const l of loose.slice(0, 2)) {
      const where = `a ${l.colour} ${l.slot} part near (${l.at.map((x) => x.toFixed(2)).join(', ')})`
      failures.push(l.gap > LIMITS.attach
        ? `${name} has ${where} standing ${l.gap.toFixed(3)} clear of everything it could sit on (at most ${LIMITS.attach}, surface to surface), so it floats; ${ATTACH[role] ?? 'make each of its parts touch or overlap the part it hangs from'}`
        : `${name} has ${where} that meets what holds it only at a point (${Math.round(l.joint * 100)}% of its thickness, at least ${Math.round(LIMITS.joint * 100)}%), so it reads as floating; ${ATTACH[role] ?? 'make each of its parts overlap the part it hangs from where that part is thick'}`)
    }
    if (place?.toque) {
      const { offset, ratio } = place.toque
      if (offset > TOQUE.offset) failures.push(`${name} sits ${Math.round(offset * 100)}% of the head's width off the head's centre (at most ${Math.round(TOQUE.offset * 100)}%); centre it on top of the head, so it is not read as a feather duster held to one side`)
      if (ratio < TOQUE.ratio) failures.push(`${name} rises only ${ratio.toFixed(2)} times its own width above the top of the head (at least ${TOQUE.ratio}); make it a tall column on a snug band with a billowy puff of balls on top, taller than it is wide, so it is not read as a round puff like a duster's plume`)
    }
    if (place?.board && place.board.lift > BOARD.lift) failures.push(`${name}'s board stands ${(place.board.lift * height).toFixed(3)} above the top of the head (at most ${(BOARD.lift * height).toFixed(3)}, a twentieth of the height), so it reads as a sign held overhead; make the cap a shallow skullcap that hugs the top of the head and lay the board right on it, with no gap or stalk`)
    if (place?.board && place.board.width < BOARD.width[0]) failures.push(`${name}'s board is only ${place.board.width.toFixed(2)} times the head's width across (at least ${BOARD.width[0]}); make it a square about 1.2 times the head's width so it reads as a mortarboard, not a cap`)
    if (place?.board && place.board.width > BOARD.width[1]) failures.push(`${name}'s board is ${place.board.width.toFixed(2)} times the head's width across (at most ${BOARD.width[1]}), a flat slab that hides the head from above; make it a square about 1.2 times the head's width, on a skullcap that shows under it`)
    if (place?.brim && place.brim.width < BRIM.width[0]) failures.push(`${name}'s brim is only ${place.brim.width.toFixed(2)} times the head's width across (at least ${BRIM.width[0]}); make it about 1.75 times the head's width so it reads as a sun hat`)
    if (place?.brim && place.brim.width > BRIM.width[1]) failures.push(`${name}'s brim is ${place.brim.width.toFixed(2)} times the head's width across (at most ${BRIM.width[1]}), a flat slab that hides the head from above; make it about 1.75 times the head's width, worn on the back of the head and tilted back`)
    const margin = Math.min(...faceMargin)
    if (eyes.length && margin < LIMITS.faceMargin) failures.push(`${name} clears the eyes only up to ${Math.round((Math.max(0, margin) * 180) / Math.PI)} degrees steeper than the dollhouse view (at least ${Math.round((LIMITS.faceMargin * 180) / Math.PI)}), so it covers the face as the camera looks down; ${MARGIN_FIX[role] ?? 'keep it on the top or the back of the head, clear of the face from above'}`)
    if (place?.plume && place.plume.parts < PLUME.tufts) failures.push(`${name} is ${place.plume.parts === 1 ? 'one piece' : `only ${place.plume.parts} pieces`}, so it reads as a lollipop; make it 5 to 7 feathers (long tufts) fanned up and out from a felt knot on the handle's top, each feather's base sunk in the knot, and mark them all`)
    if (place?.plume && place.plume.offset < PLUME.offset) failures.push(`${name}'s centre is only ${Math.round(place.plume.offset * 100)}% of the head's width out from the head's centre (at least ${Math.round(PLUME.offset * 100)}%); hold the duster up beside the head on a long handle, its plume clear of the head's side and never over the top of the head, so it is not read as a chef's toque`)
  }

  return { failures, measures: { height, width: size.x, depth: size.z, held: heldRatio, pieces, eyeRays, faceMargin, species: features, mark: broke, ownerPx, heldInHand, loose, place } }
}

/** What to do when the mark covers the face from a little above the dollhouse view. */
const MARGIN_FIX: Record<string, string> = {
  gardener: 'make the brim smaller, about 1.75 times the head\'s width, set it on the back of the head and tilt it back so its front edge lifts clear of the eyes',
  tutor: 'make the board smaller, about 1.2 times the head\'s width, and sit the skullcap on the crown, behind and above the eye line',
}

/** A marked part that does not sit on anything: its slot, the colour it was made in, its centre, how far its surface stands from the nearest part that could hold it, and how wide they meet over the thinner one's thinnest side. */
export interface Loose { slot: string; colour: string; at: [number, number, number]; gap: number; joint: number }

/** What to do when a role's mark has a part standing clear of what should hold it. */
const ATTACH: Record<string, string> = {
  cook: 'stand the toque\'s band on the top of the head and the puff on the band, overlapping a little',
  tutor: 'rest the board\'s underside on the cap band and the band on the top of the head, with no gap and no stalk between them',
  carer: 'end the cap before its point, where it is still thick, and set the pom-pom over that end so it swallows the tip, and the cap\'s rim on the head',
  tidier: 'put the plume on the top of the duster\'s handle so they overlap',
  messenger: 'fix the pole to the back and the flag to the pole, overlapping',
  keeper: 'tuck the pencil against the head or the ear so they overlap',
  maker: 'join the lens ring to its arm and the arm to the headband or the head, overlapping',
  gardener: 'set the hat\'s crown on the head and the brim on the crown, overlapping',
}

/**
 * Marked parts that sit on nothing. A marked part is held when its surface comes within LIMITS.attach of an
 * unmarked part (the head, the duster's handle, the body), or of a marked part that is held (a pom-pom on a cap on
 * a head, a board on a cap band on a head), and they meet across at least LIMITS.joint of the thinner part's
 * thinnest side. Measured on the parts' own triangles (./surfaceContact), not their boxes: a bent cap's box covers
 * the air around its tip, and a pom-pom on the cap's needle-thin tip touches it but reads as floating.
 */
export function markAttachment(meshes: THREE.Mesh[], root: THREE.Object3D): Loose[] {
  const marked = meshes.filter((m) => m.userData.mark)
  const anchors = meshes.filter((m) => !m.userData.mark)
  const cache = new Map<THREE.Mesh, Surface>()
  const contacts = new Map<string, Contact>()
  const contact = (a: THREE.Mesh, b: THREE.Mesh) => {
    const k = `${a.id}:${b.id}`
    if (!contacts.has(k)) contacts.set(k, surfaceContact(a, b, LIMITS.attach, cache))
    return contacts.get(k)!
  }
  const joined = (a: THREE.Mesh, b: THREE.Mesh) => {
    const c = contact(a, b)
    return c.gap <= LIMITS.attach && c.width >= LIMITS.joint * Math.min(thinnest(a), thinnest(b))
  }
  const held = new Set<THREE.Mesh>()
  let grew = true
  while (grew) {
    grew = false
    for (const m of marked) {
      if (held.has(m)) continue
      if (anchors.some((o) => joined(m, o)) || [...held].some((o) => joined(m, o))) {
        held.add(m)
        grew = true
      }
    }
  }
  return marked.filter((m) => !held.has(m)).map((m) => {
    const c = new THREE.Box3().setFromObject(m, true).getCenter(new THREE.Vector3())
    // The closest it comes to anything that could hold it, and how wide that meeting is.
    let best = { gap: Infinity, joint: 0 }
    for (const o of meshes) {
      if (o === m || (o.userData.mark && !held.has(o))) continue
      const k = contact(m, o), joint = k.width / Math.max(1e-6, Math.min(thinnest(m), thinnest(o)))
      if (k.gap < best.gap || (k.gap === best.gap && joint > best.joint)) best = { gap: k.gap, joint }
    }
    return { slot: slotOf(m, root), colour: hexOf(m), at: [+c.x.toFixed(3), +c.y.toFixed(3), +c.z.toFixed(3)] as [number, number, number], gap: +best.gap.toFixed(4), joint: +best.joint.toFixed(3) }
  })
}

/** A mesh's triangles in world space (nine numbers each) and their box. */
interface Surface { tris: Float32Array; box: THREE.Box3 }
function surfaceOf(m: THREE.Mesh, cache: Map<THREE.Mesh, Surface>): Surface {
  const had = cache.get(m)
  if (had) return had
  const pos = m.geometry.attributes.position, index = m.geometry.index
  const n = Math.floor((index ? index.count : pos.count) / 3) * 3
  const tris = new Float32Array(n * 3)
  const box = new THREE.Box3()
  const v = new THREE.Vector3()
  for (let k = 0; k < n; k++) {
    v.fromBufferAttribute(pos, index ? index.getX(k) : k).applyMatrix4(m.matrixWorld)
    tris[k * 3] = v.x; tris[k * 3 + 1] = v.y; tris[k * 3 + 2] = v.z
    box.expandByPoint(v)
  }
  const s = { tris, box }
  cache.set(m, s)
  return s
}

/** Where two meshes meet: the smallest distance between their surfaces (0 when they cross or one holds the other), and how wide the meeting is. */
export interface Contact { gap: number; width: number }

/**
 * Two meshes' surfaces against each other, on their own triangles: vertices measured against the other's
 * triangles, edges tested for crossing them, and a part wholly inside a closed part (a band sunk in a head)
 * counted as joined across its whole size. `width` is the largest side of the box around the points where they
 * meet (crossings and vertices within `limit`): a pom-pom on a cone's needle tip meets it across a few
 * millimetres, a band sunk in a head across its whole rim. A gap beyond `limit` comes back as `limit` or more.
 */
export function surfaceContact(a: THREE.Mesh, b: THREE.Mesh, limit: number, cache = new Map<THREE.Mesh, Surface>()): Contact {
  const { tris: ta, box: ba } = surfaceOf(a, cache), { tris: tb, box: bb } = surfaceOf(b, cache)
  if (!ba.clone().expandByScalar(limit).intersectsBox(bb)) {
    const d = (i: 'x' | 'y' | 'z') => Math.max(0, bb.min[i] - ba.max[i], ba.min[i] - bb.max[i])
    return { gap: Math.max(limit, Math.hypot(d('x'), d('y'), d('z'))), width: 0 }
  }
  const tri = new THREE.Triangle(), box = new THREE.Box3(), p = new THREE.Vector3(), q = new THREE.Vector3(), c = new THREE.Vector3()
  const ray = new THREE.Ray()
  const setTri = (t: Float32Array, i: number) => {
    tri.a.set(t[i], t[i + 1], t[i + 2]); tri.b.set(t[i + 3], t[i + 4], t[i + 5]); tri.c.set(t[i + 6], t[i + 7], t[i + 8])
  }
  // One inside the other: a ray from a vertex crosses the closed outer part an odd number of times.
  for (const [inner, ib, outer, ob] of [[ta, ba, tb, bb], [tb, bb, ta, ba]] as const) {
    if (!ob.containsBox(ib) || inner.length < 3) continue
    ray.set(p.set(inner[0], inner[1], inner[2]), new THREE.Vector3(0.577, 0.578, 0.577).normalize())
    let crossings = 0
    for (let j = 0; j < outer.length; j += 9) {
      setTri(outer, j)
      if (ray.intersectTriangle(tri.a, tri.b, tri.c, false, c)) crossings++
    }
    if (crossings % 2 === 1) {
      const s = ib.getSize(new THREE.Vector3())
      return { gap: 0, width: Math.max(s.x, s.y, s.z) }
    }
  }
  const region = ba.clone().expandByScalar(limit).intersect(bb.clone().expandByScalar(limit))
  const near = (t: Float32Array) => {
    const list: number[] = []
    for (let i = 0; i < t.length; i += 9) {
      setTri(t, i)
      if (box.setFromPoints([tri.a, tri.b, tri.c]).intersectsBox(region)) list.push(i)
    }
    return list
  }
  const na = near(ta), nb = near(tb)
  let gap = Infinity
  const met = new THREE.Box3()
  for (const [from, fl, into, il] of [[ta, na, tb, nb], [tb, nb, ta, na]] as const) {
    for (const i of fl) {
      for (let e = 0; e < 3; e++) {
        p.set(from[i + e * 3], from[i + e * 3 + 1], from[i + e * 3 + 2])
        q.set(from[i + ((e + 1) % 3) * 3], from[i + ((e + 1) % 3) * 3 + 1], from[i + ((e + 1) % 3) * 3 + 2])
        const len = p.distanceTo(q)
        const inRegion = region.containsPoint(p)
        for (const j of il) {
          setTri(into, j)
          // Edges crossing the other's triangles: a handle through a plume, a band through a head.
          if (len > 1e-9) {
            ray.set(p, q.clone().sub(p).divideScalar(len))
            if (ray.intersectTriangle(tri.a, tri.b, tri.c, false, c) && c.distanceTo(p) <= len) {
              gap = 0
              met.expandByPoint(c)
            }
          }
          // The edge's first vertex against the triangle (every vertex starts some edge).
          if (inRegion) {
            const d = tri.closestPointToPoint(p, c).distanceTo(p)
            if (d < gap) gap = d
            if (d <= limit) met.expandByPoint(p)
          }
        }
      }
    }
  }
  const s = met.isEmpty() ? new THREE.Vector3() : met.getSize(new THREE.Vector3())
  return { gap: Math.max(0, Math.min(gap, Math.max(limit, gap))), width: Math.max(s.x, s.y, s.z) }
}

/** A part's thinnest side in its own axes (a pole's thickness, a board's thickness, a ball's diameter). */
function thinnest(m: THREE.Mesh) {
  m.geometry.computeBoundingBox()
  const s = m.geometry.boundingBox!.getSize(new THREE.Vector3()).multiply(new THREE.Vector3().setFromMatrixScale(m.matrixWorld))
  return Math.min(Math.abs(s.x), Math.abs(s.y), Math.abs(s.z))
}

/** The longest side, in its own axes, of the widest marked part: a board's side or a brim's diameter, however it is turned or tilted. */
function widest(marked: THREE.Mesh[]) {
  return Math.max(...marked.map((m) => {
    m.geometry.computeBoundingBox()
    const s = m.geometry.boundingBox!.getSize(new THREE.Vector3()).multiply(new THREE.Vector3().setFromMatrixScale(m.matrixWorld))
    return Math.max(Math.abs(s.x), Math.abs(s.y), Math.abs(s.z))
  }))
}

/** The cook's toque: its centre within this share of the head's width of the head's centre, and rising above the head's top at least `ratio` times its own width. */
export const TOQUE = { offset: 0.15, ratio: 1 }
/** The tidier's plume: made of at least `tufts` marked parts (round 6's two were one ball each, read as lollipops), its centre at least `offset` of the head's width out to the side from the head's centre (round 5's two: 1.11 and 1.54). */
export const PLUME = { offset: 0.75, tufts: 4 }
/** The tutor's board: its underside at most `lift` of the villager's height above the head's top (round 5's two stood 0.097 and 0.115 up on their cap bands, read as signboards held overhead), and across (its longest side in its own axes) `width` times the head's width (round 6's elephant: 1.47, a slab hiding the head; the prompt asks for 1.1 to 1.3). */
export const BOARD = { lift: 0.05, width: [1.0, 1.4] as const }
/** Round 7: the gardener's brim across, over the head's width. Round 6's three were 2.10 to 2.71, flat slabs hiding the head; the prompt asks for 1.6 to 1.9. */
export const BRIM = { width: [1.45, 2.0] as const }

/** Where the mark sits against the head core: the two round marks Sol confused in round 5 (the toque's puff and the duster's plume), and the board Opus read as a sign. */
export interface MarkPlace {
  /** The cook's toque: centre off the head's centre in x over the head's width, and height above the head's top over its own width. */
  toque?: { offset: number; ratio: number }
  /** The tidier's plume: centre off the head's centre in x over the head's width. */
  plume?: { offset: number; parts: number }
  /** The tutor's board (its widest marked part): its underside over the head's top, over the villager's height. */
  board?: { lift: number; width: number }
  /** The gardener's brim (its widest marked part): across, in its own axes, over the head's width. */
  brim?: { width: number }
}

/** Measured on the standing figure in world x (it faces +z), against the largest unmarked head part. */
export function markPlace(meshes: THREE.Mesh[], inHeld: Set<THREE.Mesh>, eyes: THREE.Object3D[], headGroup: THREE.Object3D | null, handGroups: THREE.Object3D[], role: string, height: number): MarkPlace | null {
  const marked = meshes.filter((m) => m.userData.mark)
  const { head } = coresOf(meshes.filter((m) => !inHeld.has(m) && !m.userData.mark), eyes, headGroup, handGroups)
  if (!marked.length || !head) return null
  const hb = new THREE.Box3().setFromObject(head, true)
  const hc = hb.getCenter(new THREE.Vector3()), hw = Math.max(1e-6, hb.max.x - hb.min.x)
  const mb = new THREE.Box3()
  for (const m of marked) mb.expandByObject(m, true)
  const mc = mb.getCenter(new THREE.Vector3()), ms = mb.getSize(new THREE.Vector3())
  const offset = +(Math.abs(mc.x - hc.x) / hw).toFixed(3)
  if (role === 'cook') return { toque: { offset, ratio: +((mb.max.y - hb.max.y) / Math.max(1e-6, ms.x, ms.z)).toFixed(3) } }
  if (role === 'tidier') return { plume: { offset, parts: marked.length } }
  if (role === 'tutor') {
    const boxes = marked.map((m) => new THREE.Box3().setFromObject(m, true))
    const board = boxes.reduce((a, b) => ((b.max.x - b.min.x) * (b.max.z - b.min.z) > (a.max.x - a.min.x) * (a.max.z - a.min.z) ? b : a))
    return { board: { lift: +((board.min.y - hb.max.y) / Math.max(1e-6, height)).toFixed(3), width: +(widest(marked) / hw).toFixed(3) } }
  }
  if (role === 'gardener') return { brim: { width: +(widest(marked) / hw).toFixed(3) } }
  return {}
}

/**
 * Two meshes touch when a point on either one's triangle edges lies inside the other's box in its own axes,
 * grown by `gap`. Edges are sampled, not only corners: a one-segment handle through a mitten has no vertex inside it.
 */
function touching(a: THREE.Mesh, b: THREE.Mesh, gap: number) {
  const inside = (from: THREE.Mesh, into: THREE.Mesh) => {
    into.geometry.computeBoundingBox()
    const s = new THREE.Vector3().setFromMatrixScale(into.matrixWorld)
    const box = into.geometry.boundingBox!.clone().expandByScalar(gap / Math.max(1e-6, Math.min(Math.abs(s.x), Math.abs(s.y), Math.abs(s.z))))
    const m = into.matrixWorld.clone().invert().multiply(from.matrixWorld)
    const pos = from.geometry.attributes.position
    const index = from.geometry.index
    const n = index ? index.count : pos.count
    const p = new THREE.Vector3(), q = new THREE.Vector3(), x = new THREE.Vector3()
    const at = (k: number, v: THREE.Vector3) => v.fromBufferAttribute(pos, index ? index.getX(k) : k).applyMatrix4(m)
    for (let t = 0; t + 2 < n; t += 3) {
      for (let e = 0; e < 3; e++) {
        at(t + e, p)
        at(t + ((e + 1) % 3), q)
        for (let k = 0; k <= 8; k++) if (box.containsPoint(x.lerpVectors(p, q, k / 8))) return true
      }
    }
    return false
  }
  return inside(a, b) || inside(b, a)
}

/** The owner's colour must cover at least this many pixels of the 128 px dollhouse render (readability.mjs): the round-4 regroup's badges read at 100 to 121. */
export const OWNER_PX = 100

/** What to ask for when a role's mark carries too little colour. */
const THICKER: Record<string, string> = {
  keeper: 'for example a fat felt pencil as thick as an ear, with a big round eraser on its end',
  maker: 'for example a lens ring with a rim as thick as a finger (tube radius at least 0.03 of the height) and a solid arm',
  messenger: 'for example a bigger flag, at least 0.25 by 0.15 of the height, on a thicker pole',
  tidier: 'for example a fuller plume, at least 0.3 of the height across',
}

/**
 * The camera of load.ts silhouettes(), which readability.mjs counts on: the figure turned FACE_YAW 0.25 and scaled
 * by the room's 1.3, the camera at the dollhouse heading (CAMERA_YAW 0.6, so 0.35 from the figure's front) and
 * pitch, looking at 0.62 m from 3.97 m with a 20 degree field of view, 128 px square.
 */
const DOLLHOUSE = { yaw: 0.35, pitch: LIMITS.pitch, scale: 1.3, look: 0.62, fov: 20, size: 128 }

/**
 * Pixels of `owned` parts that show from the dollhouse view: every triangle projected as that camera does and
 * drawn into a small depth buffer on the CPU, counting the pixels an owned part wins.
 */
export function ownerArea(meshes: THREE.Mesh[], owned: (m: THREE.Mesh) => boolean): number {
  if (!meshes.some(owned)) return 0
  const { yaw, pitch, scale, look, fov, size } = DOLLHOUSE
  const t = Math.tan(THREE.MathUtils.degToRad(fov / 2))
  const toCam = new THREE.Vector3(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch))
  const eye = toCam.clone().multiplyScalar(0.7 / t).add(new THREE.Vector3(0, look, 0))
  const right = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), toCam).normalize()
  const up = new THREE.Vector3().crossVectors(toCam, right)
  const f = size / 2 / t
  const tris: { xs: number[]; ys: number[]; zs: number[]; own: boolean }[] = []
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  const v = new THREE.Vector3()
  for (const m of meshes) {
    const pos = m.geometry.attributes.position, index = m.geometry.index
    const n = index ? index.count : pos.count
    const own = owned(m)
    for (let k = 0; k + 2 < n; k += 3) {
      const tri = { xs: [] as number[], ys: [] as number[], zs: [] as number[], own }
      for (let e = 0; e < 3; e++) {
        v.fromBufferAttribute(pos, index ? index.getX(k + e) : k + e).applyMatrix4(m.matrixWorld).multiplyScalar(scale).sub(eye)
        const z = -v.dot(toCam)
        const x = (v.dot(right) / z) * f, y = (v.dot(up) / z) * f
        tri.xs.push(x); tri.ys.push(y); tri.zs.push(-z)
        x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y)
      }
      tris.push(tri)
    }
  }
  const w = Math.ceil(x1 - x0) + 2, h = Math.ceil(y1 - y0) + 2
  const depth = new Float32Array(w * h).fill(-Infinity)
  const ownBuf = new Uint8Array(w * h)
  for (const { xs, ys, zs, own } of tris) {
    const ax = xs[0] - x0, ay = ys[0] - y0, bx = xs[1] - x0, by = ys[1] - y0, cx = xs[2] - x0, cy = ys[2] - y0
    const area = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax)
    if (Math.abs(area) < 1e-9) continue
    for (let py = Math.max(0, Math.floor(Math.min(ay, by, cy))); py <= Math.min(h - 1, Math.ceil(Math.max(ay, by, cy))); py++) {
      for (let px = Math.max(0, Math.floor(Math.min(ax, bx, cx))); px <= Math.min(w - 1, Math.ceil(Math.max(ax, bx, cx))); px++) {
        const sx = px + 0.5, sy = py + 0.5
        const w0 = ((bx - sx) * (cy - sy) - (by - sy) * (cx - sx)) / area
        const w1 = ((cx - sx) * (ay - sy) - (cy - sy) * (ax - sx)) / area
        const w2 = 1 - w0 - w1
        if (w0 < 0 || w1 < 0 || w2 < 0) continue
        const z = w0 * zs[0] + w1 * zs[1] + w2 * zs[2]
        const k = py * w + px
        if (z > depth[k]) { depth[k] = z; ownBuf[k] = own ? 1 : 0 }
      }
    }
  }
  let count = 0
  for (const o of ownBuf) count += o
  return count
}

/**
 * The family's owner accents (synthetic: scripts/villagers/descriptions.json uses these four). Body felt is
 * kept off all of them, and off the villager's own accent, so the dyed role mark is the only owner colour.
 */
export const OWNER_ACCENTS: Record<string, string> = { Alex: '#c8553d', Sam: '#3d7cc8', Mia: '#e0b53a', Robin: '#6a9a4a' }
/**
 * A felt colour competes with an owner's accent when it is at least this colourful (OKLCh chroma; tans and
 * oatmeal are 0.04 to 0.065, the accents 0.12 to 0.15) and within this many degrees of the accent's hue.
 */
export const OWNER_CLASH = { chroma: 0.085, hue: 30 }
/** Where clashing felt is pulled: its hue and chroma move towards oatmeal, keeping its lightness. */
const OATMEAL = '#d9c8a9'

/** OKLab of a #rrggbb colour (THREE.Color holds linear sRGB). */
function oklab(hex: string): [number, number, number] {
  const c = new THREE.Color(hex)
  const l = Math.cbrt(0.4122214708 * c.r + 0.5363325363 * c.g + 0.0514459929 * c.b)
  const m = Math.cbrt(0.2119034982 * c.r + 0.6806995451 * c.g + 0.1073969566 * c.b)
  const s = Math.cbrt(0.0883024619 * c.r + 0.2817188376 * c.g + 0.6299787005 * c.b)
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s]
}
function fromOklab([L, a, b]: number[]): string {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3, m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3, s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3
  const clamp = (x: number) => Math.min(1, Math.max(0, x))
  return '#' + new THREE.Color().setRGB(clamp(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s), clamp(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s), clamp(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s)).getHexString()
}

/** The accents (name and colour) a felt colour competes with, by OWNER_CLASH. */
export function ownerClash(hex: string, accents: Record<string, string>): string[] {
  const [, a, b] = oklab(hex)
  if (Math.hypot(a, b) < OWNER_CLASH.chroma) return []
  const hue = Math.atan2(b, a)
  return Object.entries(accents).filter(([, c]) => {
    const [, ca, cb] = oklab(c)
    const d = Math.abs(hue - Math.atan2(cb, ca)) * (180 / Math.PI)
    return Math.min(d, 360 - d) <= OWNER_CLASH.hue
  }).map(([name]) => name)
}

/** A felt colour moved off every owner hue: its hue and chroma pulled towards oatmeal's until nothing clashes. */
export function awayFromOwners(hex: string, accents: Record<string, string>): string {
  if (!ownerClash(hex, accents).length) return hex
  const [L, a, b] = oklab(hex), [, oa, ob] = oklab(OATMEAL)
  for (let t = 0.05; t < 1; t += 0.05) {
    const out = fromOklab([L, a + (oa - a) * t, b + (ob - b) * t])
    if (!ownerClash(out, accents).length) return out
  }
  return fromOklab([L, oa, ob])
}

/** A role mark must reach this far (over the height) above the head or past the side, seen from the dollhouse. */
export const MARK = 0.1
/** The marked parts may be at most this share of the villager's volume (held prop left out): a mark, not the villager. */
export const MARK_SHARE = 0.4

/** Each role's mark, as scripts/villagers/style.md describes it, for failure reasons. */
export const MARK_NAMES: Record<string, string> = {
  cook: 'toque', gardener: 'sun hat', tidier: 'feather duster plume', keeper: 'pencil behind the ear',
  tutor: 'mortarboard', messenger: 'post flag', maker: 'swung-up lens', carer: 'stocking cap',
}

/** How far the parts tagged with villager.mark() stand out of the outline, over the height. */
export interface MarkBreak {
  /** Above the top of the head (its largest unmarked part). */
  above: number
  /** Past the sides of the head and body (their largest unmarked parts). */
  side: number
  /** 'head' or 'body' when the core part itself is tagged, a dodge refused by inspect(). */
  core: 'head' | 'body' | null
  /** The marked parts' share of the villager's volume, held prop left out. */
  share: number
}

/**
 * Measured from the dollhouse view (in front and LIMITS.pitch above, the eye check's view), on every
 * vertex: a tilted brim or a board reaching back rises on screen, as it does in the silhouette sheet.
 * The marked parts include the held prop (the tidier's plume is its duster).
 *
 * The head and body it measures against are the largest unmarked parts, so a big stocking cap on a
 * small head is a hat, not the head. The head itself counts as marked when no unmarked head part is
 * left or a marked part holds an eye's centre; the body when a marked body part outweighs every
 * unmarked one.
 */
export function markBreak(meshes: THREE.Mesh[], inHeld: Set<THREE.Mesh>, eyes: THREE.Object3D[], headGroup: THREE.Object3D | null, handGroups: THREE.Object3D[], height: number): MarkBreak | null {
  const marked = meshes.filter((m) => m.userData.mark)
  if (!marked.length) return null
  const figure = meshes.filter((m) => !inHeld.has(m))
  const total = figure.reduce((a, m) => a + volumeOf(m), 0)
  const share = +(marked.filter((m) => !inHeld.has(m)).reduce((a, m) => a + volumeOf(m), 0) / Math.max(total, 1e-9)).toFixed(3)
  const all = coresOf(figure, eyes, headGroup, handGroups)
  const cores = coresOf(figure.filter((m) => !m.userData.mark), eyes, headGroup, handGroups)
  const eyeAt = eyes.map((e) => e.getWorldPosition(new THREE.Vector3()))
  // In the part's own axes: a sun-hat brim tilted back, as the role table asks, has a world box that swallows the face.
  const holdsEye = (m: THREE.Mesh) => {
    if (!all.inHead.has(m) || all.inEye.has(m)) return false
    m.geometry.computeBoundingBox()
    const local = m.geometry.boundingBox!.clone().expandByScalar(0.005)
    const inv = m.matrixWorld.clone().invert()
    return eyeAt.some((p) => local.containsPoint(p.clone().applyMatrix4(inv)))
  }
  const unmarkedBody = cores.body
  const headMarked = !cores.head || marked.some(holdsEye)
  const bodyMarked = !unmarkedBody || marked.some((m) => !all.inHead.has(m) && !all.inHand.has(m) && !all.inEye.has(m) && !inHeld.has(m) && volumeOf(m) > volumeOf(unmarkedBody))
  if (headMarked || bodyMarked || !cores.head || !cores.body) return { above: 0, side: 0, core: headMarked ? 'head' : 'body', share }
  const up = new THREE.Vector3(0, Math.cos(LIMITS.pitch), -Math.sin(LIMITS.pitch))
  const v = new THREE.Vector3()
  const span = (list: THREE.Mesh[]) => {
    let top = -Infinity, left = Infinity, right = -Infinity
    for (const m of list) {
      const pos = m.geometry.attributes.position
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld)
        top = Math.max(top, v.dot(up))
        left = Math.min(left, v.x)
        right = Math.max(right, v.x)
      }
    }
    return { top, left, right }
  }
  const h = span([cores.head]), outline = span([cores.head, cores.body]), mk = span(marked)
  return {
    above: +((mk.top - h.top) / height).toFixed(3),
    side: +(Math.max(mk.right - outline.right, outline.left - mk.left) / height).toFixed(3),
    core: null,
    share,
  }
}

/** A part's size in its own axes, so a tilted flat brim does not outweigh the head it sits on. */
function volumeOf(m: THREE.Mesh) {
  m.geometry.computeBoundingBox()
  const s = m.geometry.boundingBox!.getSize(new THREE.Vector3()).multiply(new THREE.Vector3().setFromMatrixScale(m.matrixWorld))
  return Math.abs(s.x * s.y * s.z)
}

/** The largest head part and the largest body part among `meshes` (null when there is none), leaving out the eyes and the hands. */
function coresOf(meshes: THREE.Mesh[], eyes: THREE.Object3D[], headGroup: THREE.Object3D | null, handGroups: THREE.Object3D[]) {
  const under = (groups: THREE.Object3D[]) => {
    const set = new Set<THREE.Object3D>()
    for (const g of groups) g.traverse((o) => set.add(o))
    return set
  }
  const inEye = under(eyes), inHead = under(headGroup ? [headGroup] : []), inHand = under(handGroups)
  const largest = (list: THREE.Mesh[]) => list.reduce<THREE.Mesh | null>((a, m) => (!a || volumeOf(m) > volumeOf(a) ? m : a), null)
  const parts = meshes.filter((m) => !inHand.has(m) && !inEye.has(m))
  const body = largest(parts.filter((m) => !inHead.has(m)))
  const head = largest(parts.filter((m) => inHead.has(m)))
  return { body, head, inHead, inEye, inHand }
}

/**
 * How far a villager departs from the default round template: a body part with a head part
 * straight on top. Each feature is a plain length over the core it grows from, from the
 * model's own geometry. Not counted: the held prop, any owner-colour part,
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
  // The role mark (villager.mark()) never counts: wherever it sits, a mark alone must not pass.
  const cores = coresOf(meshes.filter((m) => !inHeld.has(m) && !m.userData.accent && !m.userData.mark), eyes, headGroup, handGroups)
  const { body, head, inHead, inEye, inHand } = cores
  if (!body || !head) return null
  const boxOf = new Map(meshes.map((m) => [m, new THREE.Box3().setFromObject(m, true)]))
  // Eyes count here: a frog's sit on top of its head.
  const parts = meshes.filter((m) => !inHeld.has(m) && !m.userData.accent && !m.userData.mark && !inHand.has(m))
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
