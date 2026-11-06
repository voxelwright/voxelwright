import * as THREE from 'three/webgpu'
import type { Context } from 'cordis'
import { own, replace } from '../kernel'
import { KINDS } from '../villagers/kinds'
import { Villager, type Task } from '../villagers/rig'

// Prototype for #42: villager art directions in the kitchen, only with ?villager=a|b|c|d|lineup.
const params = new URLSearchParams(location.search)
const flag = params.get('villager')
const shot = params.get('shot')

/** Synthetic routines: the cook starts at the table, the tidier crosses the room, the gardener tends the window side. */
const ROUTINES: { start: string; seated?: boolean; wait?: number; tasks: Task[] }[] = [
  { start: 'seatMid', seated: true, tasks: [{ spot: 'seatMid', stay: 24 }, { spot: 'fridge', stay: 5 }, { spot: 'sink', stay: 6 }] },
  { start: 'sink', wait: 0.5, tasks: [{ spot: 'fridge', stay: 3 }, { spot: 'seatRight', stay: 12 }, { spot: 'sink', stay: 5 }, { spot: 'shelf', stay: 5 }, { spot: 'counter', stay: 3 }] },
  { start: 'counter', wait: 5, tasks: [{ spot: 'plant', stay: 6 }, { spot: 'window', stay: 6 }, { spot: 'fridge', stay: 4 }, { spot: 'counter', stay: 4 }] },
]
const HAND = '"Bradley Hand", "Segoe Print", "Comic Sans MS", cursive'
const POSES: Record<string, { position: THREE.Vector3; look: THREE.Vector3 }> = {
  near: { position: new THREE.Vector3(1.95, 1.08, 1.8), look: new THREE.Vector3(0.75, 0.62, -0.45) },
  lineup: { position: new THREE.Vector3(0.22, 0.92, 2.75), look: new THREE.Vector3(0.22, 0.5, 0.6) },
}

export default {
  name: 'villagers',
  inject: ['stage', 'entries', 'view'],
  apply(ctx: Context) {
    const lineup = flag === 'lineup'
    if (!flag || !(lineup || flag in KINDS)) return
    const { stage, entries, view } = ctx
    const phys = stage.features().has('phys')
    const group = new THREE.Group()
    group.name = 'villagers'
    const villagers: { v: Villager; id: string; name: string; bark: string }[] = []

    if (lineup) {
      Object.entries(KINDS).forEach(([key, kind], k) => {
        const fig = kind.build(0, phys)
        const x = -0.55 + k * 0.52
        villagers.push({ v: new Villager(fig, [], { start: 'counter', idle: true, at: [x, 1.0], yaw: Math.atan2(0.22 - x, 1.75) }), id: `villager-${key}`, ...kind.specs[0] })
      })
    } else {
      const kind = KINDS[flag]
      ROUTINES.forEach((r, i) => {
        const v = new Villager(kind.build(i, phys), r.tasks, { start: r.start, seated: r.seated, wait: r.wait })
        villagers.push({ v, id: `villager-${flag}-${i}`, ...kind.specs[i] })
      })
    }
    for (const { v } of villagers) group.add(v.fig.root)
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
      over.set(0, height + 0.06 - speaking.fig.hip * speaking.seated, 0)
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
      for (const { v } of villagers) v.update(step, t, eye)
      place()
    })
  },
}

if (import.meta.hot) import.meta.hot.accept((m) => m && replace(m.default))
