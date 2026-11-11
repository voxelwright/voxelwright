// The street's sky and its sun (#136). The sky is three's own scattering dome with a layer of
// cloud; the sun is one light whose shadow is drawn in three boxes that follow the camera, small
// and sharp near it and wide far off. What is not in the sun is lit by the sky and by the street
// itself: a picture of both taken from the middle of the block once it stands (`probe`), which
// every surface is lit by and glass reflects.
import * as THREE from 'three/webgpu'
import { cameraPosition, float, mix, positionWorld, smoothstep, texture, time, vec2, vec3, vec4 } from 'three/tsl'
import { CSMShadowNode } from 'three/addons/csm/CSMShadowNode.js'
import { SkyMesh } from 'three/addons/objects/SkyMesh.js'
import type { Stage } from '../../../home/src/kernel'
import { SUN } from '../../src/sun.ts'
import { NOISE } from './surfaces.ts'

/** How far each shadow box reaches from the camera (m): the first holds you and what you stand by. */
const REACH = [12, 40, 160]
/** The sun's light on a surface that faces it, and the sky's own brightness against three's dome. */
const q = new URLSearchParams(location.search)
const SUNLIGHT = Number(q.get('sun') ?? 5.2), SKYLIGHT = Number(q.get('skylight') ?? 0.12), AMBIENT = Number(q.get('ambient') ?? 1.1), BOUNCE = Number(q.get('bounce') ?? 0.5)

/** The clouds: a layer this high over the bay (m), drifting this fast (m/s), covering about this share of the sky. */
const CLOUDS = { high: 950, drift: [5.5, 2.2] as const, cover: 0.34 }
type F = THREE.Node<'float'>
type V2 = THREE.Node<'vec2'>
/** How thick the cloud is over a place on the ground (m, at the layer's height), 0 to 1. */
function thickness(at: V2): F {
  const p = at.add(vec2(time.mul(CLOUDS.drift[0]), time.mul(CLOUDS.drift[1])))
  const read = (size: number, shift: number) => texture(NOISE, p.mul(1 / size).add(shift))
  return read(5100, 0).r.mul(0.56).add(read(1900, 0.37).a.mul(0.3)).add(read(640, 0.71).a.mul(0.14))
}
const covered = (d: F): F => smoothstep(0.62 - CLOUDS.cover * 0.36, 0.72 - CLOUDS.cover * 0.36, d)
/** Where the line from a point towards the sun meets the cloud layer, and so whose shadow lies on that point. */
const overhead = (): V2 => positionWorld.xz.add(vec2(SUN[0], SUN[2]).mul(float(CLOUDS.high).sub(positionWorld.y).div(SUN[1])))

export interface Sky {
  /** The page's tier changed: the sun's shadows are laid out again for it. */
  tier(): void
  /** Lights the scene by what is seen from `at`, with `hidden` left out of the picture (what moves). */
  probe(at: THREE.Vector3, hidden?: THREE.Object3D[]): void
  /** The camera's shape changed: the shadow boxes are laid out again. */
  resize(): void
  /** Whether the sun's shadow is drawn in boxes that follow the camera now (every tier but the light one). */
  boxed(): boolean
}

export function sky(stage: Stage): Sky {
  const { renderer, scene, camera } = stage
  const towards = new THREE.Vector3(...SUN)

  const dome = new SkyMesh()
  dome.name = 'the sky'
  dome.scale.setScalar(900)
  dome.sunPosition.value.copy(towards)
  dome.turbidity.value = 3.2
  dome.rayleigh.value = 1.35
  dome.mieCoefficient.value = 0.004
  dome.mieDirectionalG.value = 0.82
  // Its own clouds are thin streaks; the street's are heaped ones painted over it: where the eye's line meets their layer, white on
  // the side the sun is on and blue-grey on the other, paling into the sky's own colour towards the horizon.
  dome.cloudCoverage.value = 0
  const air = (dome.material.colorNode as THREE.Node<'vec4'>).mul(SKYLIGHT)
  const line = positionWorld.sub(cameraPosition).normalize(), climb = line.y.max(0.015)
  const over = cameraPosition.xz.add(line.xz.div(climb).mul(float(CLOUDS.high).sub(cameraPosition.y)))
  const here = thickness(over), sunward = thickness(over.add(vec2(SUN[0], SUN[2]).normalize().mul(260)))
  const lit = here.sub(sunward).mul(7).add(0.62).clamp(0, 1)
  const cloud = mix(vec3(0.34, 0.4, 0.52), vec3(1.05, 1.02, 0.96), lit.mul(smoothstep(0.3, 0.8, here).mul(0.4).add(0.6)))
  const seen = covered(here).mul(smoothstep(0.015, 0.2, line.y))
  dome.material.colorNode = vec4(mix(air.rgb, mix(air.rgb, cloud, smoothstep(0.02, 0.32, line.y).mul(0.75).add(0.25)), seen), 1)
  dome.frustumCulled = false
  scene.add(dome)

  // The sun and its shadows, for the tier the page is at now: three boxes that follow the camera, or on the light tier one map over the whole block.
  let sun: THREE.DirectionalLight, boxes: CSMShadowNode | null = null
  const rise = () => {
    const low = stage.quality === 'low'
    sun = new THREE.DirectionalLight('#fff1dc', SUNLIGHT)
    sun.position.copy(towards).multiplyScalar(120)
    // A cloud between a place and the sun dims the sun there: their shadows cross the street and the hills as they drift.
    const bright = new THREE.Color('#fff1dc').multiplyScalar(SUNLIGHT)
    ;(sun as THREE.DirectionalLight & { colorNode?: THREE.Node }).colorNode = vec3(bright.r, bright.g, bright.b).mul(float(1).sub(covered(thickness(overhead())).mul(0.5)))
    // `?shadows=0` leaves the sun's shadows out, to see what they cost.
    sun.castShadow = q.get('shadows') !== '0'
    const size = low ? 1024 : 2048
    sun.shadow.mapSize.set(size, size)
    sun.shadow.bias = -0.00018
    sun.shadow.normalBias = 0.02
    sun.shadow.radius = 1.2
    boxes = null
    if (!sun.castShadow) {
      // No shadows asked for: nothing to lay out.
    } else if (low) {
      Object.assign(sun.shadow.camera, { left: -40, right: 40, top: 40, bottom: -40, near: 1, far: 260 })
    } else {
      Object.assign(sun.shadow.camera, { near: 1, far: 420 })
      boxes = new CSMShadowNode(sun, { cascades: REACH.length, maxFar: REACH.at(-1), mode: 'custom', lightMargin: 160, customSplitsCallback: (_n: number, _near: number, far: number, breaks: number[]) => { for (const r of REACH) breaks.push(Math.min(1, r / far)) } })
      boxes.fade = true
      // The boxes are laid round the camera that draws the street, whichever camera draws first (the probe has six of its own).
      ;(boxes as unknown as { _init(b: { camera: THREE.Camera; renderer: THREE.Renderer }): void })._init({ camera, renderer })
      sun.shadow.shadowNode = boxes
    }
    scene.add(sun, sun.target)
  }
  rise()

  // What the sun strikes throws some of it back: a warm, shadowless light from the lit side of the street and from the ground, up into
  // the shade, under cornices and bays. (The picture the street is lit by has this too, but only as seen from one place.)
  const back = new THREE.DirectionalLight('#ffd2a1', BOUNCE)
  back.position.set(-towards.x, -0.55, -towards.z).multiplyScalar(100)
  scene.add(back, back.target)

  // The probe's own sun: one map over the block, since the boxes follow the page's camera and no other.
  const still = new THREE.DirectionalLight('#fff1dc', SUNLIGHT)
  still.position.copy(towards).multiplyScalar(120)
  still.castShadow = true
  still.shadow.mapSize.set(2048, 2048)
  still.shadow.bias = -0.0004
  still.shadow.normalBias = 0.04
  Object.assign(still.shadow.camera, { left: -70, right: 70, top: 70, bottom: -70, near: 1, far: 320 })
  still.visible = false
  scene.add(still, still.target)

  let held: THREE.RenderTarget | null = null
  return {
    tier() {
      boxes?.dispose()
      scene.remove(sun, sun.target)
      sun.dispose()
      rise()
    },
    probe(at, hidden = []) {
      const pmrem = new THREE.PMREMGenerator(renderer)
      const shown = hidden.map((o) => o.visible)
      hidden.forEach((o) => { o.visible = false })
      dome.showSunDisc.value = 0
      // First the sky alone, so the street is lit by something when its own picture is taken.
      const above = new THREE.Scene()
      above.add(dome)
      const first = pmrem.fromScene(above, 0, 0.5, 1000)
      scene.add(dome)
      scene.environment = first.texture
      scene.environmentIntensity = AMBIENT
      sun.visible = false
      still.visible = true
      const second = pmrem.fromScene(scene, 0, 0.3, 1100, { position: at })
      still.visible = false
      sun.visible = true
      scene.environment = second.texture
      first.dispose()
      held?.dispose()
      held = second
      dome.showSunDisc.value = 1
      hidden.forEach((o, i) => { o.visible = shown[i] })
      pmrem.dispose()
    },
    resize() {
      boxes?.updateFrustums()
    },
    boxed: () => boxes !== null,
  }
}
