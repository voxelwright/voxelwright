import * as THREE from 'three/webgpu'
import type { Context } from 'cordis'
import { own, replace } from '../kernel'
import { LIVING_X, WORKSHOP_DOOR } from '../layout'
import { closedDoor } from '../doorway'
import { LOUNGE } from './lounge'

/**
 * The Workshop's door in the living room's right wall, closed until that room is
 * built next door. An entry. (The doorway to the kitchen is kitchendoor.ts's.)
 */
export default {
  name: 'loungedoors',
  inject: ['stage', 'view', 'entries'],
  apply(ctx: Context) {
    const { view, entries } = ctx
    const workshop = closedDoor(WORKSHOP_DOOR.w, WORKSHOP_DOOR.h)
    workshop.name = 'workshop door'
    workshop.rotation.y = -Math.PI / 2
    workshop.position.set(LIVING_X + LOUNGE.right, 0, WORKSHOP_DOOR.z)
    workshop.userData.inward = new THREE.Vector3(-1, 0, 0) // leaves with its wall when a wider view cuts it away (#42)
    own(ctx, workshop)

    const atDoor = {
      position: new THREE.Vector3(LIVING_X - 0.3, 1.45, LOUNGE.back + 1.95),
      look: new THREE.Vector3(LIVING_X + LOUNGE.right, 1.15, WORKSHOP_DOOR.z),
    }
    ctx.effect(() => entries.add({
      id: 'workshop',
      label: 'Workshop',
      object: workshop,
      select() {
        view.focus(atDoor)
        entries.say('The workshop door is closed for now. It opens later')
      },
      leave: () => view.focus(null),
    }), 'workshop entry')
  },
}

if (import.meta.hot) import.meta.hot.accept((m) => m && replace(m.default))
