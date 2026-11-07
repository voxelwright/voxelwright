// #47 regroup 2, strategy E: a hybrid. On a wide screen or a tablet it is the round-6 bench as it
// is (the council scored its belonging 9 there); on a phone held upright, where the bench collapses,
// it is B's fitting mirror, grounded: a thin arched frame with the kitchen showing round it. Both keep
// the brass marker on the head (on the bench, a short tape stands by its head; on the phone, the tape up the glass).
import { HAND } from './workshop'
import { mirror, sizeAt } from './setup-b'
import type { Scene, Strategy } from './setup-strategy'

export function hybrid(scene: Scene): Strategy {
  const { tools } = scene
  const m = mirror(scene, { grounded: true })
  /** The phone's mirror; the bench's own layout switch (narrow below an aspect of 0.9), so the two never disagree. */
  const phone = () => scene.layout() === 'narrow'
  let was: boolean | null = null

  // On the bench: a short brass-ended tape stood beside the villager's head; its marker sits at the head and
  // dragging it sets their height (the bench's own tape measure on the table still works too).
  const head = document.createElement('div')
  head.className = 'vs-headtape'
  head.tabIndex = 0
  head.setAttribute('role', 'slider')
  head.setAttribute('aria-label', 'Height: drag the marker to their head')
  head.setAttribute('aria-valuemin', '0')
  head.setAttribute('aria-valuemax', '100')
  head.dataset.key = 'size'
  const marker = document.createElement('i')
  head.append(marker)
  const word = document.createElement('b')
  word.textContent = 'height'
  head.append(word)
  const style = document.createElement('style')
  style.textContent = css()
  document.head.append(style)
  document.body.append(head)
  const done = () => {
    scene.tuned()
    scene.reflow()
  }
  head.addEventListener('pointerdown', (ev) => {
    if (ev.button !== 0) return
    ev.preventDefault()
    head.focus({ preventScroll: true })
    head.setPointerCapture(ev.pointerId)
    const to = (e: PointerEvent) => tools.set('size', Math.min(1, Math.max(0, sizeAt(scene, e.clientY))))
    to(ev)
    const up = () => {
      head.removeEventListener('pointermove', to)
      head.removeEventListener('pointerup', up)
      head.removeEventListener('pointercancel', up)
      done()
    }
    head.addEventListener('pointermove', to)
    head.addEventListener('pointerup', up)
    head.addEventListener('pointercancel', up)
  })
  head.addEventListener('keydown', (ev) => {
    const step = { ArrowUp: 0.05, ArrowRight: 0.05, ArrowDown: -0.05, ArrowLeft: -0.05 }[ev.key]
    if (step === undefined) return
    ev.preventDefault()
    tools.set('size', Math.min(1, Math.max(0, tools.values.size + step)))
    done()
  })
  /** Beside the villager's head, on its left (the bench's ribbons are on its right). */
  const placeHead = () => {
    const r = scene.villager()
    const on = !phone() && scene.state() === 'tuning' && r !== null
    head.classList.toggle('shown', on)
    if (!on) return
    const h = Math.max(70, Math.min(150, (r.bottom - r.top) * 0.45))
    const x = Math.round(r.left - 40), y = Math.round(r.top)
    const at = `${x}px ${y}px`
    if (head.style.translate !== at) head.style.translate = at
    head.style.height = `${Math.round(h)}px`
    head.setAttribute('aria-valuenow', String(Math.round(tools.values.size * 100)))
  }
  /** The surface for tuning, for the screen's current shape. */
  const surface = () => {
    if (phone()) {
      tools.mode('off')
      m.tuning?.()
    } else {
      m.leaving?.()
      tools.mode('on')
      tools.focus('size')
    }
  }
  return {
    id: 'e',
    bench: () => !phone(),
    pose: (state) => (phone() ? m.pose!(state) : null),
    standAt: () => (phone() ? m.standAt!() : null),
    turn: () => (phone() ? m.turn!() : null),
    toolsVisible: () => (phone() ? false : null),
    tuning: surface,
    leaving: () => m.leaving?.(),
    slip: (w, h) => (phone() ? m.slip!(w, h) : null),
    place: (what, w, h) => (phone() ? m.place!(what, w, h) : null),
    frame(dt, t) {
      const now = phone()
      // Turned between a phone and a wider screen: put one surface away and bring the other out.
      if (was !== null && was !== now && scene.state() === 'tuning') surface()
      was = now
      if (now) m.frame!(dt, t)
      else m.park()
      placeHead()
    },
    api: {
      ...m.api,
      surface: () => (phone() ? 'mirror' : 'bench'),
      /** The bench's head tape, on the page, or null when it isn't out. */
      headTape: () => (head.classList.contains('shown') ? head.getBoundingClientRect().toJSON() : null),
    },
    dispose() {
      m.dispose()
      head.remove()
      style.remove()
    },
  }
}

function css() {
  return `
  .vs-headtape { position: fixed; z-index: 4; left: 0; top: 0; width: 26px; border-radius: 3px; cursor: ns-resize; touch-action: none; opacity: 0; visibility: hidden;
    transition: opacity 260ms ease, visibility 0s linear 260ms;
    background: repeating-linear-gradient(180deg, #5a3f22 0 1.5px, transparent 1.5px 8px) right / 8px 100% no-repeat, #e9c45a;
    box-shadow: 0 2px 6px rgba(40, 20, 5, 0.35), inset 0 0 0 1px rgba(90, 60, 30, 0.4);
    -webkit-mask-image: linear-gradient(180deg, #000 70%, transparent); mask-image: linear-gradient(180deg, #000 70%, transparent); }
  .vs-headtape.shown { opacity: 1; visibility: visible; transition: opacity 260ms ease; }
  .vs-headtape i { position: absolute; left: -12px; top: -9px; width: 50px; height: 18px; border-radius: 3px 9px 9px 3px; background: linear-gradient(180deg, #e2bd6a, #b88a3a);
    box-shadow: 0 2px 5px rgba(0,0,0,0.4), inset 0 0 0 1px rgba(255, 240, 200, 0.6); }
  .vs-headtape i::after { content: '↕'; position: absolute; right: 5px; top: -1px; font: 700 14px/18px ${HAND}; color: #3d2a1c; }
  .vs-headtape b { position: absolute; left: 50%; top: 22px; translate: -50% 0; rotate: -90deg; transform-origin: 50% 50%; font: 700 14px/1 ${HAND}; color: #4a3220; white-space: nowrap; }
  .vs-headtape:focus-visible { outline: 3px dashed #fffaf0; outline-offset: 3px; }
  `
}
