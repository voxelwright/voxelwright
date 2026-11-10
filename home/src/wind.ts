// One wind for everything that grows: the grass, the trees, the clouds. A slow field of
// gusts drifts across the island; each plant reads the gust over the spot where it stands.
import * as THREE from 'three/webgpu'
import { texture, time, uniform, vec2 } from 'three/tsl'
import { makeNoise } from './paint'

/** Where the wind blows towards, on the ground (x, z), and how hard (1 is a fair breeze). */
export const wind = {
  direction: uniform(new THREE.Vector2(0.86, 0.5)),
  // ?wind=0 stills the air, for checks that compare frames of a still camera (scripts/check-navigation.mjs).
  // With prefers-reduced-motion the air is still too.
  strength: uniform(new URLSearchParams(location.search).get('wind') === '0' || matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 1),
}

let noise: THREE.DataTexture | null = null
/** Two tiling value noises in one small texture (red and green), shared by every reader and kept for the visit. */
export function windNoise(): THREE.DataTexture {
  if (noise) return noise
  const size = 256
  const a = makeNoise(11, 8), b = makeNoise(29, 8)
  const data = new Uint8Array(size * size * 4)
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = (y * size + x) * 4
    data[i] = a(x / 32, y / 32, 5) * 255
    data[i + 1] = b(x / 32, y / 32, 5) * 255
    data[i + 3] = 255
  }
  noise = new THREE.DataTexture(data, size, size, THREE.RGBAFormat)
  noise.wrapS = noise.wrapT = THREE.RepeatWrapping
  noise.minFilter = THREE.LinearMipmapLinearFilter
  noise.magFilter = THREE.LinearFilter
  noise.generateMipmaps = true
  noise.needsUpdate = true
  return noise
}

/** The gust over a ground point (world x, z), 0 calm to 1 full: broad bands that travel with the wind. */
export function gustAt(xz: THREE.Node<'vec2'>): THREE.Node<'float'> {
  const travel = vec2(wind.direction).mul(time.mul(0.055)).mul(wind.strength)
  const broad = texture(windNoise(), xz.mul(0.045).sub(travel)).r
  const fine = texture(windNoise(), xz.mul(0.16).sub(travel.mul(2.3))).g
  return broad.mul(0.75).add(fine.mul(0.25)).smoothstep(0.3, 0.75) as unknown as THREE.Node<'float'>
}
