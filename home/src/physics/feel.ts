// How the view answers a game (#108): a `shake` gadget in the toy being played fires `shook`, and
// the camera jumps by that much and settles within a quarter of a second. Nothing in the world
// moves: the offset is added after the camera has taken its pose for the frame and taken away
// before the next, so the camera's own easing never sees it. Not with reduced motion.
import * as THREE from 'three/webgpu'
import type { Context } from 'cordis'

/** The camera's travel (m) at strength 1: about a centimetre, a dozen pixels of a table seen from 1.4 m. */
const TRAVEL = 0.012
/** How fast a jump dies away (1/s) and how fast it trembles (rad/s). */
const SETTLE = 14
const TREMBLE = 70
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)')

export function feel(ctx: Context, played: () => string | null) {
  const { camera } = ctx.stage
  const offset = new THREE.Vector3(), up = new THREE.Vector3(), right = new THREE.Vector3()
  let strength = 0, t = 0
  ctx.on('village/physics', (e) => {
    if (e.kind !== 'signal' || e.port !== 'shook' || reducedMotion.matches) return
    const toy = played()
    if (!toy || !e.gadget.startsWith(`${toy}/`) || !Number.isFinite(e.value)) return
    // Hits close together add up, to the strength of one big one.
    strength = Math.min(1, strength + Math.max(0, e.value))
  })
  ctx.on('village/frame', (dt) => {
    camera.position.sub(offset)
    offset.set(0, 0, 0)
    if (strength < 0.004) return void (strength = 0)
    t += dt
    strength *= Math.exp(-dt * SETTLE)
    // Across and up the picture, a quarter turn apart, so it reads as a knock and not a slide.
    camera.matrixWorld.extractBasis(right, up, offset)
    offset.copy(up).multiplyScalar(Math.sin(t * TREMBLE)).addScaledVector(right, 0.6 * Math.cos(t * TREMBLE * 0.83)).multiplyScalar(TRAVEL * strength)
    camera.position.add(offset)
  })
  ctx.effect(() => () => void camera.position.sub(offset), 'physics feel')
  return { /** The jump still to die away, 0 to 1 (the checks read it). */ strength: () => strength }
}
