// Dollhouse frames that hold a set of world points (#48): the proposal's outline with its shared
// wall and door, and the move-in's new room. A frame is camera.ts's own (a floor point, a zoom and
// a turn) so `view.glide` reaches it and the person's next drag or key moves on from it.
// camera.ts keeps its dollhouse rig constants private, so they are mirrored here (from the glide
// look prototype); a probe camera posed like the rig measures where the points land on screen.
import * as THREE from 'three/webgpu'
import type { Frame } from '../plugins/camera'
import { HOUSE } from '../layout'

const RIG = { fov: 20, far: 36, near: 5.6, pitchFar: 0.74, pitchNear: 0.5 }
/** camera.ts's BOUNDS: the rig's floor point stays within these; a frame past them is clamped. */
const LIMIT = { x0: HOUSE.x0 - 1, x1: HOUSE.x1 + 1, z0: HOUSE.z0 - 1.5, z1: HOUSE.z1 + 1.5 }

/** A screen box in NDC (-1..1) the points should fill. */
export interface Box { x: [number, number]; y: [number, number] }

const probe = new THREE.PerspectiveCamera(RIG.fov, 1, 0.1, 400)
const v = new THREE.Vector3()

function pose(x: number, z: number, zoom: number, yaw: number, aspect: number) {
  const d = RIG.far * Math.pow(RIG.near / RIG.far, zoom)
  const p = THREE.MathUtils.lerp(RIG.pitchFar, RIG.pitchNear, zoom)
  const ly = THREE.MathUtils.lerp(0.9, 0.75, zoom)
  probe.aspect = aspect
  probe.updateProjectionMatrix()
  probe.position.set(x + Math.sin(yaw) * Math.cos(p) * d, ly + Math.sin(p) * d, z + Math.cos(yaw) * Math.cos(p) * d)
  probe.lookAt(x, ly, z)
  probe.updateMatrixWorld()
  return { d, p }
}

function extent(pts: THREE.Vector3[]) {
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity
  for (const pt of pts) {
    v.copy(pt).project(probe)
    x0 = Math.min(x0, v.x); x1 = Math.max(x1, v.x); y0 = Math.min(y0, v.y); y1 = Math.max(y1, v.y)
  }
  return { x0, x1, y0, y1 }
}

/**
 * The frame at this turn that holds every point inside the box, as close in as it can (zoom at most `most`),
 * clamped to where camera.ts lets the view rest; `look` is the look point before clamping, for a caller that
 * slides the camera the rest of the way (put `look` at the screen's middle).
 */
export function fitFrame(pts: THREE.Vector3[], yaw: number, box: Box, aspect: number, most = 1, lean = 0): { frame: Required<Frame>; look: THREE.Vector3 } {
  let x = pts.reduce((a, q) => a + q.x, 0) / pts.length, z = pts.reduce((a, q) => a + q.z, 0) / pts.length, zoom = 0
  for (let i = 0; i < 4; i++) {
    let lo = 0, hi = most
    for (let k = 0; k < 14; k++) {
      const mid = (lo + hi) / 2
      pose(x, z, mid, yaw, aspect)
      const e = extent(pts)
      if (e.x1 - e.x0 <= box.x[1] - box.x[0] && e.y1 - e.y0 <= box.y[1] - box.y[0]) lo = mid
      else hi = mid
    }
    zoom = lo
    const { d, p } = pose(x, z, zoom, yaw, aspect)
    const e = extent(pts)
    const half = d * Math.tan(THREE.MathUtils.degToRad(RIG.fov) / 2)
    // With room to spare across, `lean` pins the points to the box's left (-1) or right (1) edge instead of its middle.
    const w = e.x1 - e.x0
    const cx = lean < 0 ? box.x[0] + w / 2 : lean > 0 ? box.x[1] - w / 2 : (box.x[0] + box.x[1]) / 2
    const right = ((e.x0 + e.x1) / 2 - cx) * half * aspect
    const away = ((e.y0 + e.y1) / 2 - (box.y[0] + box.y[1]) / 2) * half / Math.sin(p)
    x += right * Math.cos(yaw) - away * Math.sin(yaw)
    z += -right * Math.sin(yaw) - away * Math.cos(yaw)
  }
  return {
    frame: { x: THREE.MathUtils.clamp(x, LIMIT.x0, LIMIT.x1), z: THREE.MathUtils.clamp(z, LIMIT.z0, LIMIT.z1), zoom, yaw },
    look: new THREE.Vector3(x, THREE.MathUtils.lerp(0.9, 0.75, zoom), z),
  }
}

/** Whether the view has moved off a frame it was sent to (someone took the camera). */
export function movedOff(now: Required<Frame>, to: Required<Frame>) {
  const turn = THREE.MathUtils.euclideanModulo(now.yaw - to.yaw + Math.PI, Math.PI * 2) - Math.PI
  return Math.abs(now.x - to.x) > 0.02 || Math.abs(now.z - to.z) > 0.02 || Math.abs(now.zoom - to.zoom) > 0.004 || Math.abs(turn) > 0.004
}

export const lift = (pts: Array<[number, number]>, y: number) => pts.map(([x, z]) => new THREE.Vector3(x, y, z))
