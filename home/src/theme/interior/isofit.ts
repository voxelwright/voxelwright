// I2, styling sized for the dollhouse view (#50, regroup 3, `&isofit=1`). A pixel look's art
// pixel was sized for the seat (225 rows up the screen); from the dollhouse the whole house
// spanned about 140 of them and the furniture dissolved into noisy clusters. In the dollhouse
// view the art pixel is chosen from the house's size on screen (HOUSE_ROWS rows across its
// height), outlines are found by depth jumps in metres, and dither is narrowed to a seam on
// flat midtones and kept wide at silhouettes and shadow edges.
import * as THREE from 'three/webgpu'
import type { Stage } from '../../kernel'
import { MODE } from '../../plugins/camera'
import { pixelFit } from '../fx/pixel'
import type { Theme } from '../tokens'
import type { House } from '../world'

/** Art rows the house's height on screen should span. */
const HOUSE_ROWS = 260
/** A depth jump this many metres reads as a silhouette. */
const EDGE_M = 0.14
/** Dither a flat midtone keeps: 0 drew the lawn's soft light falloff as one hard ring. */
const FLAT = 0.15

export function isofit(stage: Stage) {
  const corner = new THREE.Vector3()
  let on = false
  const off = () => {
    if (!on) return
    on = false
    pixelFit.rows = 0
    pixelFit.edge.value = 0
    pixelFit.flat.value = 0.35
    pixelFit.refit()
  }
  /** On every theme walk (each 15 frames): re-size while a pixel look stands in the dollhouse view. Eight projections. */
  const update = (t: Theme, house: House | null) => {
    if (MODE !== 'iso' || !house || !t.post.stages.some((s) => s.kind === 'pixel')) return off()
    on = true
    pixelFit.edge.value = EDGE_M
    pixelFit.flat.value = FLAT
    let lo = Infinity, hi = -Infinity
    for (const x of [house.x0, house.x1]) for (const y of [0, house.top]) for (const z of [house.z0, house.z1]) {
      const v = corner.set(x, y, z).project(stage.camera).y
      lo = Math.min(lo, v)
      hi = Math.max(hi, v)
    }
    const share = Math.min(1, (hi - lo) / 2)
    const rows = Math.round(HOUSE_ROWS / Math.max(0.2, share))
    if (Math.abs(rows - pixelFit.rows) / rows < 0.04) return
    pixelFit.rows = rows
    pixelFit.refit()
  }
  return { update, drop: off }
}
