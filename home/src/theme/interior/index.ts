// The theme owns the interior (#50, regroup 3). Prototypes behind flags, side by side:
//   &pools=1    I1, a motivated light hierarchy: warm pools at the focal points (./pools.ts)
//   &isofit=1   I2, pixel styling sized for the dollhouse view (./isofit.ts, ../fx/pixel.ts)
//   &repaint=1  I3, the room repainted by material class (./repaint.ts, through ../shade)
// and, on whenever a theme world stands, the sun's shadow fitted to the house (./sun.ts;
// `&sunfit=0` turns it off). Called by the theme plugin after every walk.
import type { Context } from 'cordis'
import type { Theme } from '../tokens'
import type { House } from '../world'
import type * as THREE from 'three/webgpu'
import { pools } from './pools'
import { isofit } from './isofit'
import { sunFit } from './sun'

const query = new URLSearchParams(location.search)
// Regroup 3 (#50): pools and isofit won the council (neon +1.25, 16-bit +0.65); &pools=0 and &isofit=0 turn them off for comparison.
const POOLS_ON = query.get('pools') !== '0'
const ISOFIT_ON = query.get('isofit') !== '0'

export function interior(ctx: Context) {
  const { scene } = ctx.stage
  const sun = sunFit(scene)
  const lights = POOLS_ON ? pools(scene) : null
  const fit = ISOFIT_ON ? isofit(ctx.stage) : null
  return {
    place(t: Theme, stood: { house: House; group: THREE.Group } | null) {
      sun.place(stood)
      lights?.place(t.id)
      fit?.update(t, stood?.house ?? null)
    },
    drop() {
      sun.drop()
      lights?.drop()
      fit?.drop()
    },
  }
}
