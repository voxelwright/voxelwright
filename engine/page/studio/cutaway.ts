// Studio review views use the marcher's finest-cell coordinates (10 cm) and
// the wand's box convention [lowX, lowY, lowZ, highX, highY, highZ), high exclusive.
import type { Box } from '../wand.ts'
import type { View } from '../march.ts'
import { raster } from '../../kit/src/core/fonts/index.js'
import { sign } from '../../kit/src/core/fonts/sign.js'

type Vec3 = [number, number, number]
export interface CutawayState {
  enabled: boolean
  planeY: number
  backfaceDarken: number
  sliceHighlight: Vec3
}

function interiorY(box: Box) {
  const height = box[4] - box[1]
  return box[1] + (height > 14 ? 14 : height / 2)
}

export function createCutawayController() {
  const state: CutawayState = { enabled: false, planeY: 0, backfaceDarken: 0.42, sliceHighlight: [1, 0.8, 0.5] }
  return {
    state,
    setY(y: number) { state.planeY = y },
    toggle(enabled = !state.enabled) { state.enabled = enabled },
    autoInteriorY(box: Box) { return state.planeY = interiorY(box) },
  }
}

export const CUTAWAY_WGSL = /* wgsl */`
fn cutawayClip(worldPos: vec3f, planeY: f32, enabled: bool) -> bool {
  return enabled && worldPos.y > planeY;
}
fn cutawayShade(color: vec3f, isBackface: bool, darken: f32) -> vec3f {
  return select(color, color * darken, isBackface);
}
`

type ViewName = 'hero34' | 'front' | 'side' | 'interiorCutaway'
export interface ReviewCamera extends View { name: ViewName; cutawayY?: number }
const dot = (a: Vec3, b: Vec3) => a[0]*b[0] + a[1]*b[1] + a[2]*b[2]
const unit = (x: number, y: number, z: number): Vec3 => {
  const length = Math.hypot(x, y, z)
  return [x / length, y / length, z / length]
}

/** Fit each of the eight corners in perspective with a 10% framing margin. */
export function computeReviewCameras(box: Box, aspect: number): ReviewCamera[] {
  if (!(aspect > 0 && Number.isFinite(aspect))) throw new RangeError('Invalid review aspect')
  const [x, y, z, X, Y, Z] = box
  if (!box.every(Number.isFinite) || X <= x || Y <= y || Z <= z) throw new RangeError('Empty review box')
  const cx = (x + X)/2, cy = (y + Y)/2, cz = (z + Z)/2
  const tanHalf = Math.tan(Math.PI / 8)
  function view(name: ViewName, forward: Vec3): ReviewCamera {
    const [fx, fy, fz] = forward
    const right = unit(-fz, 0, fx)
    const up: Vec3 = [-right[2]*fy, right[2]*fx - right[0]*fz, right[0]*fy]
    let distance = 1
    for (const px of [x, X]) for (const py of [y, Y]) for (const pz of [z, Z]) {
      const corner: Vec3 = [px - cx, py - cy, pz - cz]
      const extent = Math.max(Math.abs(dot(corner, up)), Math.abs(dot(corner, right)) / aspect)
      distance = Math.max(distance, Math.max(1, 1.1 * extent / tanHalf) - dot(corner, forward))
    }
    return { name, eye: [cx - distance*fx, cy - distance*fy, cz - distance*fz], forward, right, up, tanHalf }
  }
  return [
    view('hero34', unit(-1, -.8, -1)), view('front', [0, 0, -1]), view('side', [-1, 0, 0]),
    { ...view('interiorCutaway', unit(-1, -1.65, -1)), cutawayY: interiorY(box) },
  ]
}

interface Frame { width: number; height: number; data: Uint8Array | Uint8ClampedArray }

/** Four equal-sized RGBA frames in camera order. Captions occupy their own
 * strip below each image. Small frames get enough column width for the caption. */
export function composeContactSheet(tiles: readonly Frame[], { labels = ['Hero 3/4', 'Front', 'Side', 'Interior cutaway'], gap = 2 } = {}) {
  if (tiles.length !== 4 || labels.length !== 4) throw new RangeError('Expected four review tiles and captions')
  const { width: w, height: h } = tiles[0]
  if (![w, h].every(n => Number.isSafeInteger(n) && n > 0) || !Number.isSafeInteger(gap) || gap < 0 ||
    !tiles.every(tile => tile.width === w && tile.height === h && tile.data.length === 4*w*h)) throw new RangeError('Invalid review tile dimensions')
  const captions = labels.map(label => raster(sign, label))
  const column = Math.max(w, ...captions.map(c => c.width + 4))
  const top = Math.min(...captions.map(c => c.top))
  const row = h + 4 + Math.max(...captions.map(c => c.bottom)) - top
  const width = column*2 + gap, height = row*2 + gap
  const data = new Uint8Array(4*width*height)
  for (let i = 3; i < data.length; i += 4) data[i] = 255
  tiles.forEach((tile, i) => {
    const left = (i % 2) * (column + gap), y = (i >> 1) * (row + gap)
    const x = left + Math.floor((column - w)/2)
    for (let r = 0; r < h; r++) data.set(tile.data.subarray(4*w*r, 4*w*(r+1)), 4*((y+r)*width+x))
    for (const [dx, dy] of captions[i].cells) {
      const pixel = 4*((y+h+2+dy-top)*width + left+2+dx)
      data.fill(255, pixel, pixel+4)
    }
  })
  return { width, height, data }
}
