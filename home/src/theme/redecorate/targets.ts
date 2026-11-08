// What a theme redecorates (#50 regroup S3): the five most visible kitchen props and
// the felt villagers' heads. Each target names the original's meshes to hide and the
// frame a theme's version stands in, so the new piece keeps the original's place,
// footprint and height. Nothing here changes the plugins that made the originals.
import * as THREE from 'three/webgpu'

/** One place a theme's version stands: hide these, and stand the new piece in `frame` over `box` (frame space). */
export interface Slot { frame: THREE.Object3D; hide: THREE.Object3D[]; box: THREE.Box3 }

export interface Target {
  key: string
  /** What the maker is asked for, before the theme's style guide. Short: the host caps `what` at 200 characters. */
  what: string
  /** A surface others stand on (the table): its widest part's top lands on the original's top, and anything the model stood on it goes. */
  surface?: boolean
  /** The places it stands, or null while the original is not in the scene yet. */
  find(scene: THREE.Scene): Slot[] | null
}

/** The bounding box of `measure`'s meshes in `frame`'s own space. */
export function localBox(frame: THREE.Object3D, measure: THREE.Object3D[]): THREE.Box3 {
  frame.updateWorldMatrix(true, true)
  const inv = frame.matrixWorld.clone().invert()
  const out = new THREE.Box3(), b = new THREE.Box3(), m = new THREE.Matrix4()
  for (const o of measure) o.traverse((n) => {
    const mesh = n as THREE.Mesh
    if (!mesh.isMesh) return
    if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox()
    out.union(b.copy(mesh.geometry.boundingBox!).applyMatrix4(m.multiplyMatrices(inv, mesh.matrixWorld)))
  })
  return out
}

/** Floor pieces stand on the floor even when the original's lowest mesh sits a little above it. */
const grounded = (box: THREE.Box3) => {
  if (box.min.y < 0.1) box.min.y = 0
  return box
}

const named = (scene: THREE.Scene, name: string) => scene.getObjectByName(name) ?? null
const meshes = (o: THREE.Object3D) => o.children.filter((c) => (c as THREE.Mesh).isMesh)

/** The reading chair is merged into the furnish kit by material: its own frame, at the spot furnish.ts builds it. */
const ARMCHAIR = { x: 1.95, z: 2.0, ry: -2.3 }
let armFrame: THREE.Group | null = null

export const PROPS: Target[] = [
  {
    key: 'dining table',
    surface: true,
    what: 'a rectangular dining table for four, top 1.8 m long (along x) and 1.0 m deep, top surface at 0.75 m, a bare top with nothing on it, open underneath',
    find(scene) {
      const table = named(scene, 'table')
      if (!table) return null
      // The notebook, jug and flowers on it stay: only the slab, legs and apron (everything that starts below the top) are the table.
      const hide = meshes(table).filter((m) => localBox(table, [m]).min.y < 0.74)
      return hide.length ? [{ frame: table, hide, box: grounded(localBox(table, hide)) }] : null
    },
  },
  {
    key: 'dining chair',
    what: 'a dining chair, seat top at 0.50 m, a backrest at the back (-z), open under the seat',
    find(scene) {
      const group = named(scene, 'chairs')
      if (!group?.children.length) return null
      // The talk prototype's fourth chair on the near side wears the same theme.
      const chairs = [...group.children, named(scene, 'talk near chair')].filter((c): c is THREE.Object3D => Boolean(c))
      return chairs.map((c) => ({ frame: c, hide: meshes(c), box: grounded(localBox(c, meshes(c))) }))
    },
  },
  {
    key: 'fridge',
    what: 'a tall kitchen fridge with a freezer drawer at the bottom, door handles on the front (+z)',
    find(scene) {
      const fridge = named(scene, 'fridge')
      if (!fridge?.children.length) return null
      // Measured from the body alone: the baskets on top and the photos go with it, but don't stretch it.
      return [{ frame: fridge, hide: [...fridge.children.filter((c) => !(c as THREE.Light).isLight)], box: grounded(localBox(fridge, [fridge.children[0]])) }]
    },
  },
  {
    key: 'pendant lamp',
    what: 'a pendant lamp shade over a dining table with a glowing bulb inside, hanging from its top centre, no cord',
    find(scene) {
      const lamp = named(scene, 'lamp')
      if (!lamp) return null
      // The shade and bulb; the cord above and the light itself stay.
      const hide = meshes(lamp).filter((m) => m.position.y < 2.2)
      if (!hide.length) return null
      const box = localBox(lamp, hide)
      // A little more room than the old enamel cone, so the theme's shape can read.
      box.expandByVector(new THREE.Vector3(0.04, 0.04, 0.04))
      return [{ frame: lamp, hide, box }]
    },
  },
  {
    key: 'reading armchair',
    what: 'a deep reading armchair with arms and a high back (-z), a throw over one arm',
    find(scene) {
      const kit = named(scene, 'furnish')
      if (!kit) return null
      // The chair's velvet and throw are their own merged meshes, the only small ones standing at its spot.
      const at = new THREE.Vector3(ARMCHAIR.x, 0, ARMCHAIR.z), c = new THREE.Vector3(), s = new THREE.Vector3(), b = new THREE.Box3()
      const hide = meshes(kit).filter((m) => {
        b.setFromObject(m).getCenter(c)
        b.getSize(s)
        return Math.hypot(c.x - at.x, c.z - at.z) < 0.5 && Math.max(s.x, s.y, s.z) < 1.15
      })
      if (!hide.length) return null
      if (!armFrame) {
        armFrame = new THREE.Group()
        armFrame.name = 'redecorate armchair frame'
        armFrame.position.copy(at)
        armFrame.rotation.y = ARMCHAIR.ry
      }
      if (armFrame.parent !== scene) scene.add(armFrame)
      return [{ frame: armFrame, hide, box: grounded(localBox(armFrame, hide)) }]
    },
  },
]

/** Accessories, one per felt villager in turn: each sits on the head. */
export const ACCESSORIES = [
  'a small cap or visor',
  'a soft beret or bobble hat',
  'a hood or a wide headband',
].map((kind, i): Omit<Target, 'find'> => ({
  key: `accessory ${i + 1}`,
  what: `${kind} for a round plush toy head about 0.3 m wide; it sits on top of the head, base at y = 0, front +z`,
}))

/** The felt plush cast (kind b): ?villager=b, or the talk prototype's default. */
const params = new URLSearchParams(location.search)
export const FELT = (params.get('villager') ?? (params.get('talk') === 'npc' ? 'b' : '')) === 'b'

/** Each tagged villager's head (every kind's skeleton puts it first under the pose) and its skull, the head's first mesh. */
export function heads(scene: THREE.Scene): { root: THREE.Object3D; head: THREE.Object3D; skull: THREE.Object3D }[] {
  const out: { root: THREE.Object3D; head: THREE.Object3D; skull: THREE.Object3D }[] = []
  scene.traverse((o) => {
    if (typeof o.userData.villagerId !== 'string') return
    const head = o.children[0]?.children[0]
    const skull = head?.children.find((c) => (c as THREE.Mesh).isMesh)
    if (head && skull) out.push({ root: o, head, skull })
  })
  return out
}
