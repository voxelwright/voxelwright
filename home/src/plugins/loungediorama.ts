import * as THREE from 'three/webgpu'
import type { Context } from 'cordis'
import { own, replace } from '../kernel'
import { LIVING_X } from '../layout'
import { paintPlaster } from '../paint'
import { shell } from '../diorama'
import { LOUNGE } from './lounge'

/**
 * The living room as a dollhouse for ?cam=iso (#42). The lounge's own walls are
 * one-sided planes, so this gives every side a thick wall just behind them, a
 * base, and cut stubs where the camera stands outside. Only the iso plan loads it.
 */
export default {
  name: 'loungediorama',
  inject: ['stage'],
  apply(ctx: Context) {
    const { back, right, left, height, door } = LOUNGE
    // 3 mm behind the lounge's planes, so they keep the inner face without fighting it.
    const gap = 0.003
    const group = shell({
      x0: LIVING_X + left - gap, x1: LIVING_X + right + gap, z0: back - gap, z1: back + 6 + gap,
      height, thickness: 0.18,
      wall: new THREE.MeshStandardMaterial({ map: paintPlaster(41, [240, 236, 229], 1536, 768, 0.3), roughness: 0.95 }),
      existing: [],
      casts: false,
      openings: { back: [[LIVING_X + door.x0, LIVING_X + door.x1, door.top]] },
    })
    group.name = 'lounge diorama'
    own(ctx, group)
  },
}

if (import.meta.hot) import.meta.hot.accept((m) => m && replace(m.default))
