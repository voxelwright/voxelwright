// The lawn, grown: tufts of chunky blades over every bit of ground the cover map (src/ground.ts)
// calls lawn, leaning with the wind's gusts (src/wind.ts), and daisies scattered among them.
// One draw for the grass and one for the flowers. Tufts stand on a fixed grid of the world,
// each cell's tuft decided by the cell alone, so when the lot grows the grass that was there stays put.
import * as THREE from 'three/webgpu'
import { color, float, materialColor, mix, positionLocal, sin, texture, time, uniform, uv, vec2, vec3, vertexColor } from 'three/tsl'
import type { Context } from 'cordis'
import { own, replace } from '../kernel'
import { YARD_TOP } from '../diorama'
import { cover, coverVersion, extent } from '../ground'
import { gustAt, wind, windNoise } from '../wind'

const hash = (x: number, z: number, k: number) => {
  const s = Math.sin(x * 127.1 + z * 311.7 + k * 74.7) * 43758.5453
  return s - Math.floor(s)
}

/** A tuft: three tapered blades fanned round the root, each leaning out. uv.y is the height along a blade. */
function tuft(): THREE.BufferGeometry {
  const positions: number[] = [], uvs: number[] = [], index: number[] = []
  for (let b = 0; b < 3; b++) {
    const a = (b / 3) * Math.PI * 2 + 0.4, lean = 0.32, w = 0.03
    const ax = Math.cos(a), az = Math.sin(a)
    const at = (side: number, h: number, width: number) => {
      const out = lean * h * h * 0.16
      positions.push(ax * out - az * side * width, h * 0.16, az * out + ax * side * width)
      uvs.push(side * 0.5 + 0.5, h)
    }
    const o = b * 5
    at(-1, 0, w); at(1, 0, w); at(-1, 0.55, w * 0.72); at(1, 0.55, w * 0.72); at(0, 1, 0)
    index.push(o, o + 1, o + 2, o + 1, o + 3, o + 2, o + 2, o + 3, o + 4)
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  g.setAttribute('normal', new THREE.Float32BufferAttribute(positions.map((_, i) => (i % 3 === 1 ? 1 : 0)), 3))
  g.setIndex(index)
  return g
}

/** A daisy on a stem: a flat ring of petals and a raised centre. Vertex colour red is 1 on the centre, green 1 on the stem. */
function daisy(): THREE.BufferGeometry {
  const positions: number[] = [], colors: number[] = [], uvs: number[] = [], index: number[] = []
  const H = 0.17, R = 0.042
  const v = (x: number, y: number, z: number, centre: number, stem: number) => {
    positions.push(x, y, z)
    colors.push(centre, stem, 0)
    uvs.push(0.5, y / H)
    return positions.length / 3 - 1
  }
  const s = [v(-0.004, 0, 0, 0, 1), v(0.004, 0, 0, 0, 1), v(-0.004, H, 0, 0, 1), v(0.004, H, 0, 0, 1)]
  index.push(s[0], s[1], s[2], s[1], s[3], s[2])
  const hub = v(0, H + 0.012, 0, 1, 0)
  const rim: number[] = [], inner: number[] = []
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2
    // Petals scallop: every other rim point sits a little in.
    const r = i % 2 ? R : R * 0.8
    rim.push(v(Math.cos(a) * r, H, Math.sin(a) * r, 0, 0))
    inner.push(v(Math.cos(a) * R * 0.34, H + 0.008, Math.sin(a) * R * 0.34, 1, 0))
  }
  for (let i = 0; i < 10; i++) {
    const j = (i + 1) % 10
    index.push(rim[i], inner[j], inner[i], rim[i], rim[j], inner[j], inner[i], inner[j], hub)
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  g.setAttribute('normal', new THREE.Float32BufferAttribute(positions.map((_, i) => (i % 3 === 1 ? 1 : 0)), 3))
  g.setIndex(index)
  return g
}

export default {
  name: 'grass',
  inject: ['stage'],
  apply(ctx: Context) {
    const low = ctx.stage.quality === 'low'
    /** Metres between tufts. */
    const STEP = low ? 0.17 : 0.105
    const map = cover()
    const frame = uniform(new THREE.Vector3(extent.x0, extent.z0, extent.side))
    const noise = windNoise()
    // Lit as the ground it grows from: every blade's normal is straight up, whichever way it faces.
    const upView = uniform(new THREE.Vector3(0, 1, 0)).onRenderUpdate(({ camera }, self) => (camera ? self.value.set(0, 1, 0).transformDirection(camera.matrixWorldInverse) : undefined))

    /** What every plant on the lawn shares: its place on the cover map, the gust over it, and its lean. */
    const sway = (stiff: number) => {
      const xz = positionLocal.xz
      const h = uv().y
      const grown = texture(map, xz.sub(frame.xy).div(frame.z)).r.smoothstep(0.08, 0.6)
      const gust = gustAt(xz)
      const flutter = sin(time.mul(3.1).add(xz.x.mul(5.3)).add(xz.y.mul(4.1))).mul(0.012)
      const push = gust.mul(0.085).add(0.02).add(flutter).mul(wind.strength).mul(stiff)
      const bend = vec2(wind.direction).mul(push).mul(h.mul(h))
      const position = vec3(positionLocal.x.add(bend.x.mul(grown)), positionLocal.y.mul(grown).mul(float(1).sub(push.mul(h).mul(1.6))), positionLocal.z.add(bend.y.mul(grown)))
      return { xz, h, gust, grown, position }
    }

    const blades = new THREE.MeshLambertNodeMaterial({ side: THREE.DoubleSide })
    blades.userData.themeRole = 'backdrop'
    {
      const { xz, h, gust, position } = sway(1)
      blades.positionNode = position
      blades.normalNode = upView
      // Broad patches of warmer and cooler green, a little change from tuft to tuft, dark at the root and bright at the tip.
      const patch = texture(noise, xz.mul(0.035)).g
      const each = texture(noise, xz.mul(1.3)).r
      const tip = mix(color('#7fbf42'), color('#a9cf55'), patch.smoothstep(0.35, 0.7)).mul(each.mul(0.2).add(0.9))
      const root = mix(color('#3f8a30'), color('#5a9a36'), patch)
      // A gust shows as a band of lighter grass crossing the lawn.
      // The material's own colour is white: a theme's lawn shift (role `backdrop`) tints the whole blade.
      const blade = mix(root, tip, h.pow(1.3)).mul(gust.mul(h).mul(0.22).add(1)).mul(materialColor)
      blades.colorNode = blade
      // A lawn glows a little in shade: light comes through the blades.
      blades.emissiveNode = blade.mul(0.16)
    }
    const petals = new THREE.MeshLambertNodeMaterial({ side: THREE.DoubleSide })
    petals.userData.themeRole = 'foliage'
    {
      const { xz, position } = sway(0.7)
      petals.positionNode = position
      petals.normalNode = upView
      const pick = texture(noise, xz.mul(2.9)).g
      const petal = mix(mix(color('#fffaf0'), color('#ffd94f'), pick.step(0.52)), mix(color('#ff9fb6'), color('#c9a8ff'), pick.step(0.36)), pick.step(0.45).oneMinus())
      const part = vertexColor()
      petals.colorNode = mix(mix(petal, color('#ffb52e'), part.r), color('#4f9a2c'), part.g).mul(materialColor)
    }

    const grass = new THREE.InstancedMesh(tuft(), blades, 1)
    grass.name = 'lawn grass'
    const flowers = new THREE.InstancedMesh(daisy(), petals, 1)
    flowers.name = 'lawn flowers'
    for (const m of [grass, flowers]) {
      m.position.y = YARD_TOP
      m.receiveShadow = true
      m.frustumCulled = false
      m.userData.exterior = true // a theme's world lays its own ground (src/theme/world)
      m.userData.body = false
      m.raycast = () => {}
      own(ctx, m)
    }

    // Stand a tuft in every grid cell the cover map calls lawn. Reading the map back and
    // refilling the instances takes a few milliseconds, so it waits until the cover has been still a moment.
    const probe = document.createElement('canvas').getContext('2d', { willReadFrequently: true })!
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3(), Y = new THREE.Vector3(0, 1, 0)
    const fill = () => {
      const N = 256
      probe.canvas.width = probe.canvas.height = N
      probe.drawImage(map.image as HTMLCanvasElement, 0, 0, N, N)
      const data = probe.getImageData(0, 0, N, N).data
      const lawnAt = (x: number, z: number) => {
        const u = Math.floor(((x - extent.x0) / extent.side) * N), v = Math.floor(((z - extent.z0) / extent.side) * N)
        return u >= 0 && v >= 0 && u < N && v < N ? data[(v * N + u) * 4] : 0
      }
      const tufts: number[] = [], blooms: number[] = []
      const i0 = Math.floor(extent.x0 / STEP), i1 = Math.ceil((extent.x0 + extent.side) / STEP)
      const j0 = Math.floor(extent.z0 / STEP), j1 = Math.ceil((extent.z0 + extent.side) / STEP)
      for (let i = i0; i < i1; i++) for (let j = j0; j < j1; j++) {
        const x = (i + hash(i, j, 1)) * STEP, z = (j + hash(i, j, 2)) * STEP
        if (lawnAt(x, z) < 24) continue
        tufts.push(x, z, hash(i, j, 3), hash(i, j, 4))
        // Daisies gather in drifts: likely where a slow noise is high, rare elsewhere.
        const drift = Math.sin(x * 0.9 + 1.7) * Math.sin(z * 0.8 + 0.6) + Math.sin(x * 0.23 + z * 0.31)
        if (hash(i, j, 5) < (drift > 0.9 ? 0.07 : 0.004) && lawnAt(x, z) > 200) blooms.push(x, z, hash(i, j, 6), hash(i, j, 7))
      }
      const lay = (mesh: THREE.InstancedMesh, list: number[], size: (r: number) => number) => {
        const n = list.length / 4
        if (mesh.instanceMatrix.count < n) {
          mesh.instanceMatrix = new THREE.InstancedBufferAttribute(new Float32Array(Math.ceil(n * 1.2) * 16), 16)
        }
        for (let k = 0; k < n; k++) {
          const sz = size(list[k * 4 + 3])
          mesh.setMatrixAt(k, m4.compose(p.set(list[k * 4], 0, list[k * 4 + 1]), q.setFromAxisAngle(Y, list[k * 4 + 2] * Math.PI * 2), s.set(sz, sz * (0.8 + list[k * 4 + 2] * 0.5), sz)))
        }
        mesh.count = n
        mesh.instanceMatrix.needsUpdate = true
      }
      lay(grass, tufts, (r) => 0.75 + r * 0.6)
      lay(flowers, blooms, (r) => 0.8 + r * 0.5)
    }

    let seen = -1, still = 0
    ctx.on('village/frame', () => {
      cover()
      frame.value.set(extent.x0, extent.z0, extent.side)
      const v = coverVersion()
      if (v !== seen) {
        seen = v
        still = 0
        return
      }
      if (still >= 0 && ++still > 12) {
        still = -1
        fill()
      }
    })
    ctx.effect(() => () => probe.canvas.remove(), 'grass probe')
  },
}

if (import.meta.hot) import.meta.hot.accept((m) => m && replace(m.default))
