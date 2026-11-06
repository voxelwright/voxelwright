import * as THREE from 'three/webgpu'
import type { Context } from 'cordis'
import { own, replace } from '../kernel'
import { canvas, toTexture } from '../paint'
import { KINDS } from '../villagers/kinds'
import { SEAT_Y } from '../villagers/world'
import { Villager, type Task } from '../villagers/rig'

// Prototype for #42: villager art directions in the kitchen, only with ?villager=a|b|c|d|lineup.
const params = new URLSearchParams(location.search)
const flag = params.get('villager')
const shot = params.get('shot')

/** Synthetic routines: the cook starts at the table, the tidier crosses the room, the gardener tends the window side. */
const ROUTINES: { start: string; seated?: boolean; wait?: number; tasks: Task[] }[] = [
  { start: 'seatMid', seated: true, tasks: [{ spot: 'seatMid', stay: 24 }, { spot: 'fridge', stay: 5 }, { spot: 'sink', stay: 6 }] },
  { start: 'sink', wait: 0.5, tasks: [{ spot: 'fridge', stay: 3 }, { spot: 'seatRight', stay: 12 }, { spot: 'sink', stay: 5 }, { spot: 'shelf', stay: 5 }, { spot: 'counter', stay: 3 }] },
  { start: 'window', wait: 6, tasks: [{ spot: 'plant', stay: 6 }, { spot: 'fridge', stay: 4 }, { spot: 'counter', stay: 4 }, { spot: 'window', stay: 6 }] },
]
/** Villagers are modelled at toy size and placed at about child height, so they read across the room. */
const SCALE = 1.3
const HAND = '"Bradley Hand", "Segoe Print", "Comic Sans MS", cursive'
const POSES: Record<string, { position: THREE.Vector3; look: THREE.Vector3 }> = {
  near: { position: new THREE.Vector3(1.95, 1.08, 1.8), look: new THREE.Vector3(0.75, 0.62, -0.45) },
  lineup: { position: new THREE.Vector3(0.22, 1.0, 3.05), look: new THREE.Vector3(0.22, 0.58, 0.6) },
}

export default {
  name: 'villagers',
  inject: ['stage', 'entries', 'view'],
  apply(ctx: Context) {
    const lineup = flag === 'lineup'
    if (!flag || !(lineup || Object.hasOwn(KINDS, flag))) return
    const { stage, entries, view } = ctx
    const phys = stage.features().has('phys')
    const group = new THREE.Group()
    group.name = 'villagers'
    const villagers: { v: Villager; id: string; name: string; bark: string }[] = []

    if (lineup) {
      Object.entries(KINDS).forEach(([key, kind], k) => {
        const fig = kind.build(0, phys)
        fig.root.scale.setScalar(SCALE)
        const x = -0.72 + k * 0.62
        villagers.push({ v: new Villager(fig, [], { start: 'counter', idle: true, at: [x, 1.0], yaw: Math.atan2(0.22 - x, 1.75) }), id: `villager-${key}`, ...kind.specs[0] })
      })
    } else {
      const kind = KINDS[flag]
      ROUTINES.forEach((r, i) => {
        const fig = kind.build(i, phys)
        fig.root.scale.setScalar(SCALE)
        const v = new Villager(fig, r.tasks, { start: r.start, seated: r.seated, wait: r.wait })
        villagers.push({ v, id: `villager-${flag}-${i}`, ...kind.specs[i] })
      })
    }
    // A soft contact shadow under each one keeps them on the floor or the seat.
    const [blobCanvas, b] = canvas(128, 128)
    const grad = b.createRadialGradient(64, 64, 4, 64, 64, 62)
    grad.addColorStop(0, 'rgba(60, 32, 14, 0.8)')
    grad.addColorStop(0.45, 'rgba(60, 32, 14, 0.4)')
    grad.addColorStop(1, 'rgba(70, 40, 20, 0)')
    b.fillStyle = grad
    b.fillRect(0, 0, 128, 128)
    const blobMap = toTexture(blobCanvas)
    const blobGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2)
    const blobs = villagers.map(({ v }) => {
      group.add(v.fig.root)
      const blob = new THREE.Mesh(blobGeo, new THREE.MeshBasicMaterial({ map: blobMap, transparent: true, depthWrite: false }))
      blob.renderOrder = -1
      group.add(blob)
      return blob
    })
    own(ctx, group)

    // A speech bubble over the chosen villager's head.
    const bubble = document.createElement('div')
    bubble.className = 'village-bubble'
    bubble.setAttribute('role', 'status')
    bubble.setAttribute('aria-live', 'polite')
    const who = document.createElement('div')
    who.className = 'who'
    const line = document.createElement('div')
    line.className = 'line'
    bubble.append(who, line)
    const style = document.createElement('style')
    style.textContent = `
      .village-bubble { position: fixed; left: 0; top: 0; max-width: 300px; padding: 10px 16px 12px; border-radius: 18px;
        background: #fbf3e2; color: #4a3326; box-shadow: 0 8px 26px rgba(60, 30, 10, 0.28), inset 0 0 0 1.5px rgba(120, 80, 50, 0.18);
        font: 19px/1.25 ${HAND}; pointer-events: none; opacity: 0; transform: translate(-50%, calc(-100% - 14px)) scale(0.92);
        transform-origin: 50% 100%; transition: opacity 180ms ease, transform 220ms cubic-bezier(.2, 1.4, .4, 1); }
      .village-bubble.shown { opacity: 1; transform: translate(-50%, calc(-100% - 14px)) scale(1); }
      .village-bubble::after { content: ''; position: absolute; left: 50%; bottom: -9px; width: 18px; height: 18px; margin-left: -9px;
        background: #fbf3e2; transform: rotate(45deg); border-radius: 0 0 4px 0; box-shadow: 3px 3px 4px rgba(60, 30, 10, 0.12); }
      .village-bubble .who { font-size: 15px; font-weight: 600; color: #9a5a35; letter-spacing: 0.02em; margin-bottom: 2px; }
      @media (prefers-reduced-motion: reduce) { .village-bubble { transition: none; } }
    `
    ctx.effect(() => {
      document.head.append(style)
      document.body.append(bubble)
      return () => {
        bubble.remove()
        style.remove()
      }
    }, 'villager bubble')
    let speaking: Villager | null = null
    const over = new THREE.Vector3()
    const place = () => {
      if (!speaking) return
      const { root, height } = speaking.fig
      over.set(0, height + 0.05 - speaking.fig.hip * speaking.seated, 0)
      root.localToWorld(over)
      over.project(stage.camera)
      const rect = stage.renderer.domElement.getBoundingClientRect()
      bubble.style.left = `${rect.left + ((over.x + 1) / 2) * rect.width}px`
      bubble.style.top = `${rect.top + ((1 - over.y) / 2) * rect.height}px`
    }

    for (const { v, id, name, bark } of villagers) {
      ctx.effect(() => entries.add({
        id,
        label: name,
        object: v.fig.root,
        select() {
          v.chosen = true
          speaking = v
          who.textContent = name.split(',')[0]
          line.textContent = bark
          place()
          bubble.classList.add('shown')
        },
        leave() {
          v.chosen = false
          if (speaking === v) {
            speaking = null
            bubble.classList.remove('shown')
          }
        },
      }), `villager entry ${id}`)
    }

    const pose = lineup ? POSES.lineup : shot ? POSES[shot] : null
    if (pose) ctx.effect(() => {
      view.focus(pose)
      return () => view.focus(null)
    }, 'villager shot')

    const eye = new THREE.Vector3()
    ctx.on('village/frame', (dt, t) => {
      const step = Math.min(dt, 0.05)
      stage.camera.getWorldPosition(eye)
      // Walkers wait for whoever is just ahead; of two facing each other, the first goes.
      villagers.forEach(({ v }, i) => {
        v.blocked = villagers.some(({ v: o }, j) => {
          if (o === v || o.seated > 0.5) return false
          const dx = o.pos.x - v.pos.x, dz = o.pos.z - v.pos.z
          const d = Math.hypot(dx, dz)
          const ahead = (dx * Math.sin(v.yaw) + dz * Math.cos(v.yaw)) / (d || 1)
          const mutual = (-dx * Math.sin(o.yaw) - dz * Math.cos(o.yaw)) / (d || 1) > 0.4 && o.walk > 0.1
          return d < 0.5 * SCALE && ahead > 0.4 && !(mutual && i < j)
        })
      })
      villagers.forEach(({ v }, i) => {
        v.update(step, t, eye)
        const blob = blobs[i]
        const r = v.fig.side * 3.2 * SCALE + 0.16
        const lift = v.fig.floats ? 0.12 + v.fig.hip : 0
        const air = Math.max(0, v.pos.y - (v.seated > 0.5 ? SEAT_Y : 0)) + lift
        blob.position.set(v.pos.x, (v.seated > 0.5 ? SEAT_Y : 0) + 0.004, v.pos.z)
        blob.scale.setScalar(r * (1 + air * 1.5) * (v.seated > 0.5 ? 0.85 : 1))
        ;(blob.material as THREE.MeshBasicMaterial).opacity = Math.max(0.15, 1 - air * 3)
      })
      place()
    })
  },
}

if (import.meta.hot) import.meta.hot.accept((m) => m && replace(m.default))
