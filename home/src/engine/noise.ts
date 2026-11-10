// Smooth noise that tiles, as a texture (#105): one read of it costs a fraction of a procedural
// noise, and fire is drawn over itself many times, on every pixel of a burning room.
import * as THREE from 'three/webgpu'
import { float, texture, vec2 } from 'three/tsl'

const seeded = (n: number) => {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453
  return x - Math.floor(x)
}

/** r and g are two unrelated fields, 0 to 1: eight cells across a tile, with a finer octave over them. */
function noiseTexture() {
  const N = 128, CELLS = 8
  const lattice = [0, 1].map((c) => Float32Array.from({ length: CELLS * CELLS * 4 }, (_, i) => seeded(i * 1.37 + c * 91.7)))
  const fade = (t: number) => t * t * (3 - 2 * t)
  const value = (grid: Float32Array, cells: number, x: number, y: number) => {
    const gx = x * cells, gy = y * cells, x0 = Math.floor(gx), y0 = Math.floor(gy), fx = fade(gx - x0), fy = fade(gy - y0)
    const at = (i: number, j: number) => grid[(((j % cells) + cells) % cells) * CELLS * 2 + (((i % cells) + cells) % cells)]
    return (at(x0, y0) * (1 - fx) + at(x0 + 1, y0) * fx) * (1 - fy) + (at(x0, y0 + 1) * (1 - fx) + at(x0 + 1, y0 + 1) * fx) * fy
  }
  const data = new Uint8Array(N * N * 4)
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) for (const c of [0, 1]) {
    data[(j * N + i) * 4 + c] = Math.round((value(lattice[c], CELLS, i / N, j / N) * 0.7 + value(lattice[c], CELLS * 2, i / N, j / N) * 0.3) * 255)
  }
  const t = new THREE.DataTexture(data, N, N, THREE.RGBAFormat)
  t.wrapS = t.wrapT = THREE.RepeatWrapping
  t.minFilter = t.magFilter = THREE.LinearFilter
  t.needsUpdate = true
  return t
}

const noise = texture(noiseTexture())
/**
 * The noise at a point of the plane (one unit is one tile), both fields, each about -1 to 1. Read at
 * level 0 by name, so a read inside a branch is only done when the branch is taken.
 */
export const drift = (x: THREE.Node<'float'>, y: THREE.Node<'float'>) => noise.sample(vec2(x, y)).level(float(0)).xy.sub(0.5).mul(2.6)
