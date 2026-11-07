import * as THREE from 'three/webgpu'
import type { Context } from 'cordis'
import { own, replace } from '../kernel'
import { LIVING_X } from '../layout'
import { closedDoor, openDoorway } from '../doorway'
import { LOUNGE } from './lounge'

/**
 * The living room's two doors, both entries: an open doorway back to the
 * kitchen, and the Workshop's door, closed until that room is built.
 */
export default {
  name: 'loungedoors',
  inject: ['stage', 'view', 'entries', 'rooms'],
  apply(ctx: Context) {
    const { view, entries, rooms } = ctx
    const { x0, x1, top } = LOUNGE.door
    const back = openDoorway(x1 - x0, top, 1.1)
    back.name = 'lounge doorway'
    back.position.set(LIVING_X + (x0 + x1) / 2, 0, LOUNGE.back)
    own(ctx, back)

    const workshop = closedDoor(0.82, 2.05)
    workshop.name = 'workshop door'
    workshop.rotation.y = -Math.PI / 2
    workshop.position.set(LIVING_X + LOUNGE.right, 0, LOUNGE.back + 1.75)
    workshop.userData.inward = new THREE.Vector3(-1, 0, 0) // leaves with its wall when a wider view cuts it away (#42)
    own(ctx, workshop)

    const through = {
      position: new THREE.Vector3(LIVING_X - 1.9, 1.5, LOUNGE.back + 1.1),
      look: new THREE.Vector3(LIVING_X - 2.0, 1.35, LOUNGE.back - 2),
    }
    const atDoor = {
      position: new THREE.Vector3(LIVING_X - 0.3, 1.45, LOUNGE.back + 1.95),
      look: new THREE.Vector3(LIVING_X + LOUNGE.right, 1.15, LOUNGE.back + 1.75),
    }
    ctx.effect(() => entries.add({
      id: 'to-kitchen',
      label: 'Kitchen',
      object: back,
      select: () => void rooms.go('kitchen', through),
    }), 'kitchen entry')
    ctx.effect(() => entries.add({
      id: 'workshop',
      label: 'Workshop',
      object: workshop,
      select() {
        ctx.emit('village/refused', { id: 'workshop', at: workshop.getWorldPosition(new THREE.Vector3()) })
        view.focus(atDoor)
        entries.say('The workshop door is closed for now. It opens later')
      },
      leave: () => view.focus(null),
    }), 'workshop entry')
  },
}

if (import.meta.hot) import.meta.hot.accept((m) => m && replace(m.default))
