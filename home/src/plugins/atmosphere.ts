// The air the home stands in: a sky that lights every surface (an environment map, so
// glazes, lacquer and floors reflect something and every edge picks up a soft sky sheen),
// and, round the dollhouse, a sky to float in with a slow sea of cloud far below.
import * as THREE from 'three/webgpu'
import { cameraPosition, mix, positionWorld, positionWorldDirection, smoothstep, texture, time, uniform, vec2 } from 'three/tsl'
import type { Context } from 'cordis'
import { own, replace } from '../kernel'
import { wind, windNoise } from '../wind'
import { theme } from '../theme'
import { MODE } from './camera'
import { SKY, SUN_DIRECTION } from '../sky'

/** How far below the lawn the clouds drift. */
const CLOUD_Y = -9

/** A small equirectangular sky in linear light: gradient, a soft sun far brighter than the sky, warm ground. */
function skyLight(): THREE.DataTexture {
  const w = 64, h = 32
  const data = new Float32Array(w * h * 4)
  const zenith = new THREE.Color(SKY.zenith), horizon = new THREE.Color(SKY.horizon), bounce = new THREE.Color(SKY.bounce)
  const c = new THREE.Color(), dir = new THREE.Vector3()
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    // Row 0 is straight down, as three reads an equirectangular DataTexture (flipY off).
    const lat = ((y + 0.5) / h - 0.5) * Math.PI, lon = ((x + 0.5) / w) * Math.PI * 2 - Math.PI
    dir.set(Math.cos(lat) * Math.cos(lon), Math.sin(lat), Math.cos(lat) * Math.sin(lon))
    if (dir.y >= 0) c.copy(horizon).lerp(zenith, Math.pow(dir.y, 0.6)).multiplyScalar(1.15)
    else c.copy(horizon).lerp(bounce, Math.min(1, -dir.y * 4)).multiplyScalar(1.1)
    const sun = Math.max(0, dir.dot(SUN_DIRECTION))
    const glow = Math.pow(sun, 24) * 6 + Math.pow(sun, 4) * 0.5
    const i = (y * w + x) * 4
    data[i] = c.r + glow * 1.0
    data[i + 1] = c.g + glow * 0.9
    data[i + 2] = c.b + glow * 0.72
    data[i + 3] = 1
  }
  const t = new THREE.DataTexture(data, w, h, THREE.RGBAFormat, THREE.FloatType)
  t.mapping = THREE.EquirectangularReflectionMapping
  t.colorSpace = THREE.LinearSRGBColorSpace
  t.minFilter = t.magFilter = THREE.LinearFilter
  t.wrapS = THREE.RepeatWrapping
  t.needsUpdate = true
  return t
}

export default {
  name: 'atmosphere',
  inject: ['stage'],
  apply(ctx: Context) {
    const { scene } = ctx.stage
    const light = skyLight()
    ctx.effect(() => {
      const before = { environment: scene.environment, intensity: scene.environmentIntensity, backgroundNode: scene.backgroundNode }
      scene.environment = light
      // The seated rooms are closed boxes lit by their window; the sky reaches them only as a gloss.
      scene.environmentIntensity = MODE === 'seat' ? 0.25 : 0.24
      return () => {
        scene.environment = before.environment
        scene.environmentIntensity = before.intensity
        scene.backgroundNode = before.backgroundNode
        light.dispose()
      }
    }, 'sky light')
    if (MODE === 'seat') {
      // Seated there is no sky to see, but a night theme must not be lit by the day's: the gloss dims with the theme's air.
      let applied: unknown = null
      ctx.on('village/frame', () => {
        const t = theme()
        if (t === applied) return
        applied = t
        scene.environmentIntensity = 0.25 * (1 - 0.8 * (t.fog.color ? t.fog.tint ?? 0 : 0))
      })
      return
    }

    // The sky's colours as uniforms: a theme's fog token pulls them towards its own air (dusk, night) with no rebuild.
    const tones = Object.fromEntries(Object.entries(SKY).map(([k, hex]) => [k, uniform(new THREE.Color(hex))])) as Record<keyof typeof SKY, THREE.UniformNode<'color', THREE.Color>>
    // The sky itself: a gradient by view direction, hazier and paler towards the horizon and below it.
    const up = positionWorldDirection.y
    const above = mix(tones.horizon, tones.zenith, up.max(0).pow(0.6))
    scene.backgroundNode = mix(tones.deep, above, smoothstep(-0.25, 0.02, up))

    // The sea of cloud under the island. Two layers of one noise drift at different speeds;
    // each cloud's sunward side is white and its far side falls to a cool shade.
    const noise = windNoise()
    const drift = wind.strength
    const at = positionWorld.xz
    const density = (offset: THREE.Node<'vec2'>) => {
      const p = at.add(offset)
      const broad = texture(noise, p.mul(0.011).add(vec2(time.mul(0.0035), time.mul(0.0012)).mul(drift))).r
      const fine = texture(noise, p.mul(0.031).add(vec2(time.mul(-0.005), time.mul(0.0028)).mul(drift))).g
      return broad.mul(0.68).add(fine.mul(0.32))
    }
    const here = density(vec2(0, 0))
    const sunward = density(vec2(SUN_DIRECTION.x, SUN_DIRECTION.z).normalize().mul(3))
    const cover = smoothstep(0.47, 0.6, here)
    const lit = here.sub(sunward).mul(7).add(0.62).clamp(0, 1)
    const body = mix(tones.cloudShade, tones.cloud, lit.mul(smoothstep(0.47, 0.7, here).mul(0.5).add(0.5)))
    // Far out the clouds thin into the sky's haze, so the plane has no edge.
    const far = smoothstep(70, 170, positionWorld.sub(cameraPosition).length())
    const material = new THREE.MeshBasicNodeMaterial({ fog: false })
    material.colorNode = mix(mix(tones.deep, body, cover.mul(0.96)), tones.deep, far)
    material.userData.themeRole = 'backdrop'
    const sea = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), material)
    sea.rotation.x = -Math.PI / 2
    sea.position.set(2, CLOUD_Y, 0)
    sea.name = 'cloud sea'
    sea.userData.exterior = true // a theme's world stands in its own sky (src/theme/world)
    sea.userData.body = false
    sea.raycast = () => {}
    own(ctx, sea)
    // The sky follows the look. A theme's fog token is its air: the sky is pulled towards it and the light the sky
    // gives dims as far, so a night theme stands under a night sky. A theme's world hides the home's exterior
    // and stands its own sky (src/theme/world): then this one steps back altogether.
    const sky = scene.backgroundNode
    const air = new THREE.Color()
    let applied: unknown = null, open = true
    ctx.on('village/frame', () => {
      const t = theme()
      if (t === applied && open === sea.visible) return
      applied = t
      open = sea.visible
      const tint = t.fog.color ? t.fog.tint ?? 0 : 0
      air.set(t.fog.color ?? '#000000')
      for (const [k, hex] of Object.entries(SKY) as Array<[keyof typeof SKY, string]>) {
        // Clouds keep a little of their own light, so they still read against the air.
        tones[k].value.set(hex).lerp(air, tint * (k === 'cloud' ? 0.8 : k === 'cloudShade' ? 0.9 : 1)).multiplyScalar(t.fog.gain ?? 1)
      }
      scene.backgroundNode = open ? sky : null
      scene.environmentIntensity = (open ? 0.24 : 0.1) * (1 - 0.8 * tint)
    })
  },
}

if (import.meta.hot) import.meta.hot.accept((m) => m && replace(m.default))
