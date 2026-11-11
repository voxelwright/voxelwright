// A way to lay faces into one mesh (#136): flat faces, boxes, mouldings swept along a wall, and
// round posts, each in a colour, all through whatever placing is set. What the page draws of the
// street's still things is built with it, a few meshes for a whole block.
import * as THREE from 'three/webgpu'

export type P3 = [number, number, number]
const WHITE: P3 = [1, 1, 1]
const tint = new THREE.Color()
/** A colour as the three numbers a mesh carries at each corner. */
export const rgb = (hex: string): P3 => { tint.set(hex); return [tint.r, tint.g, tint.b] }

export class Mesher {
  private at: number[] = []
  private normal: number[] = []
  private color: number[] = []
  private uv: number[] = []
  private m = new THREE.Matrix4()
  private a = new THREE.Vector3()
  private b = new THREE.Vector3()
  private c = new THREE.Vector3()
  private n = new THREE.Vector3()

  /** What is laid from now on stands where `m` puts it. */
  place(m: THREE.Matrix4): this {
    this.m.copy(m)
    return this
  }

  /** Where things are being laid now. */
  get placed(): THREE.Matrix4 {
    return this.m.clone()
  }

  get triangles() {
    return this.at.length / 9
  }

  /** One triangle, facing whoever sees its corners turn anticlockwise. */
  tri(p: P3, q: P3, r: P3, color: P3 = WHITE, uvs: [number, number][] = [[0, 0], [1, 0], [1, 1]]): this {
    this.a.set(...p).applyMatrix4(this.m)
    this.b.set(...q).applyMatrix4(this.m)
    this.c.set(...r).applyMatrix4(this.m)
    this.n.subVectors(this.b, this.a).cross(this.c.clone().sub(this.a)).normalize()
    for (const [v, t] of [[this.a, uvs[0]], [this.b, uvs[1]], [this.c, uvs[2]]] as const) {
      this.at.push(v.x, v.y, v.z)
      this.normal.push(this.n.x, this.n.y, this.n.z)
      this.color.push(...color)
      this.uv.push(...t)
    }
    return this
  }

  /** A flat face with four corners, anticlockwise as seen from its front. Its uv runs 0 to 1 from the first corner along the first edge, and up the last. */
  quad(p: P3, q: P3, r: P3, s: P3, color: P3 = WHITE, uv: [number, number, number, number] = [0, 0, 1, 1]): this {
    const [u0, v0, u1, v1] = uv
    this.tri(p, q, r, color, [[u0, v0], [u1, v0], [u1, v1]])
    return this.tri(p, r, s, color, [[u0, v0], [u1, v1], [u0, v1]])
  }

  /** A face with four corners and its own normal at each: for round things, lit smoothly from one face to the next. */
  smooth(points: [P3, P3, P3, P3], normals: [P3, P3, P3, P3], color: P3 = WHITE): this {
    for (const i of [0, 1, 2, 0, 2, 3]) {
      this.a.set(...points[i]).applyMatrix4(this.m)
      this.n.set(...normals[i]).transformDirection(this.m)
      this.at.push(this.a.x, this.a.y, this.a.z)
      this.normal.push(this.n.x, this.n.y, this.n.z)
      this.color.push(...color)
      this.uv.push(0, 0)
    }
    return this
  }

  /** A box by its middle and half sizes. `skip` names faces left out: any of `+x -x +y -y +z -z`. */
  box(at: P3, half: P3, color: P3 = WHITE, skip = ''): this {
    const [x, y, z] = at, [a, b, c] = half
    const p = (i: number, j: number, k: number): P3 => [x + i * a, y + j * b, z + k * c]
    if (!skip.includes('+x')) this.quad(p(1, -1, 1), p(1, -1, -1), p(1, 1, -1), p(1, 1, 1), color)
    if (!skip.includes('-x')) this.quad(p(-1, -1, -1), p(-1, -1, 1), p(-1, 1, 1), p(-1, 1, -1), color)
    if (!skip.includes('+y')) this.quad(p(-1, 1, 1), p(1, 1, 1), p(1, 1, -1), p(-1, 1, -1), color)
    if (!skip.includes('-y')) this.quad(p(-1, -1, -1), p(1, -1, -1), p(1, -1, 1), p(-1, -1, 1), color)
    if (!skip.includes('+z')) this.quad(p(-1, -1, 1), p(1, -1, 1), p(1, 1, 1), p(-1, 1, 1), color)
    if (!skip.includes('-z')) this.quad(p(1, -1, -1), p(-1, -1, -1), p(-1, 1, -1), p(1, 1, -1), color)
    return this
  }

  /**
   * A moulding along a path on the ground plan. `profile` is its outline as (out, up) pairs, from where it leaves
   * the wall at the bottom to where it meets it at the top; `path` is the wall's line as (x, z) points, the wall's
   * outside on the left as you walk it. Corners are mitred, and the two ends are closed.
   */
  sweep(profile: [number, number][], path: [number, number][], y: number, color: P3 = WHITE): this {
    // At each point of the path, the way out from the wall, stretched so the faces either side meet.
    const outs = path.map((_, i) => {
      const before = path[Math.max(0, i - 1)], here = path[i], after = path[Math.min(path.length - 1, i + 1)]
      const leg = (from: [number, number], to: [number, number]) => { const dx = to[0] - from[0], dz = to[1] - from[1], l = Math.hypot(dx, dz) || 1; return [dz / l, -dx / l] }
      const n0 = i > 0 ? leg(before, here) : leg(here, after), n1 = i < path.length - 1 ? leg(here, after) : n0
      const mx = n0[0] + n1[0], mz = n0[1] + n1[1], k = 2 / (mx * mx + mz * mz)
      return [mx * k, mz * k] as [number, number]
    })
    const at = (i: number, j: number): P3 => [path[i][0] + outs[i][0] * profile[j][0], y + profile[j][1], path[i][1] + outs[i][1] * profile[j][0]]
    for (let i = 0; i < path.length - 1; i++) for (let j = 0; j < profile.length - 1; j++) this.quad(at(i + 1, j), at(i, j), at(i, j + 1), at(i + 1, j + 1), color)
    // The ends: a fan over the outline.
    for (const [i, flip] of [[0, false], [path.length - 1, true]] as const) for (let j = 1; j < profile.length - 1; j++) {
      if (flip) this.tri(at(i, 0), at(i, j), at(i, j + 1), color)
      else this.tri(at(i, 0), at(i, j + 1), at(i, j), color)
    }
    return this
  }

  /** A round post from `foot` straight up, `sides` faces round. */
  post(foot: P3, radius: number, height: number, color: P3 = WHITE, sides = 10, top = radius): this {
    const ring = (r: number, y: number, i: number): P3 => { const a = (i / sides) * Math.PI * 2; return [foot[0] + Math.cos(a) * r, foot[1] + y, foot[2] + Math.sin(a) * r] }
    for (let i = 0; i < sides; i++) {
      this.quad(ring(radius, 0, i + 1), ring(radius, 0, i), ring(top, height, i), ring(top, height, i + 1), color)
      this.tri([foot[0], foot[1] + height, foot[2]], ring(top, height, i + 1), ring(top, height, i), color)
    }
    return this
  }

  /** A round bar from one point to another. */
  bar(from: P3, to: P3, radius: number, color: P3 = WHITE, sides = 6): this {
    const axis = new THREE.Vector3(to[0] - from[0], to[1] - from[1], to[2] - from[2]), length = axis.length()
    const turn = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), axis.normalize())
    const keep = this.m.clone()
    this.m.multiply(new THREE.Matrix4().compose(new THREE.Vector3(...from), turn, new THREE.Vector3(1, 1, 1)))
    this.post([0, 0, 0], radius, length, color, sides)
    this.m.copy(keep)
    return this
  }

  /** A ball, smooth all round. */
  ball(at: P3, radius: number, color: P3 = WHITE, squash = 1, bands = 5, around = 8): this {
    const centre = new THREE.Vector3(...at).applyMatrix4(this.m), q = new THREE.Vector3()
    const corner = (i: number, j: number) => {
      const up = (j / bands) * Math.PI, round = (i / around) * Math.PI * 2
      return new THREE.Vector3(Math.sin(up) * Math.cos(round), Math.cos(up), Math.sin(up) * Math.sin(round))
    }
    const push = (d: THREE.Vector3) => {
      q.set(at[0] + d.x * radius, at[1] + d.y * radius * squash, at[2] + d.z * radius).applyMatrix4(this.m)
      this.at.push(q.x, q.y, q.z)
      q.sub(centre).normalize()
      this.normal.push(q.x, q.y, q.z)
      this.color.push(...color)
      this.uv.push(0.5, d.y * 0.5 + 0.5)
    }
    for (let j = 0; j < bands; j++) for (let i = 0; i < around; i++) {
      const a = corner(i, j), b = corner(i + 1, j), c = corner(i + 1, j + 1), d = corner(i, j + 1)
      if (j > 0) for (const v of [a, b, c]) push(v)
      if (j < bands - 1) for (const v of [a, c, d]) push(v)
    }
    return this
  }

  /** Everything laid so far as one geometry. */
  geometry(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.at, 3))
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.normal, 3))
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.color, 3))
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2))
    return g
  }
}
