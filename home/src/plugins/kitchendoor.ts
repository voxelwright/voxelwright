import * as THREE from 'three/webgpu'
import type { Context } from 'cordis'
import { own, replace } from '../kernel'
import { DOORWAY, WALL_Z } from '../layout'
import { openDoorway } from '../doorway'

/** The doorway at the left of the kitchen's back wall, through to the living room. An entry. */
export default {
  name: 'kitchendoor',
  inject: ['stage', 'entries', 'rooms'],
  apply(ctx: Context) {
    const { x0, x1, top } = DOORWAY
    const door = openDoorway(x1 - x0, top, 1.2)
    door.name = 'kitchen doorway'
    door.position.set((x0 + x1) / 2, 0, WALL_Z)
    own(ctx, door)
    const through = {
      position: new THREE.Vector3((x0 + x1) / 2 + 0.1, 1.5, WALL_Z + 1.1),
      look: new THREE.Vector3((x0 + x1) / 2, 1.35, WALL_Z - 2),
    }
    ctx.effect(() => ctx.entries.add({
      id: 'to-living',
      label: 'Living room',
      object: door,
      select: () => void ctx.rooms.go('living', through),
    }), 'living room entry')
  },
}

if (import.meta.hot) import.meta.hot.accept((m) => m && replace(m.default))
