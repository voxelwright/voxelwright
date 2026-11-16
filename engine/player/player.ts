// The player (#419): one scene of the engine, from static files, turned and poked. It is the stage (stage.ts: the
// world drawn, and what comes loose moved) with an eye that turns about the scene's middle and a finger that throws.
//
//   ?scene=scenes/sample.json   the scene (scene.ts says what one holds), an address beside index.html or anywhere that lets it be read
//   ?grid=8,8,8  ?levels=6  ?pool=64  ?workers=4   how much of the world round the scene is held: small, for a picture in a page
//   ?scale=0.75  pixels drawn for each pixel shown, each way: unsaid, it follows the GPU as main.ts does
//
// The eye turns about the scene's middle: drag to turn it, pinch or the wheel to come nearer. A tap throws a ball of
// wood at what is under the finger; held longer it is thrown harder, and what is brittle breaks.
import type { View } from '../page/march.ts'
import { stage } from './stage.ts'

/** What the page that holds the player is told (index.html): the scene is seen, or something failed after WebGPU was found. */
export type Tell = (type: 'ready' | 'error', more: Record<string, unknown>) => void

/** How long the longest hold is, ms: a throw is as hard as its hold was long. */
const HOLD = 700

export async function play(tell: Tell): Promise<void> {
  const failed = (e: unknown) => tell('error', { message: e instanceof Error ? e.message : String(e) })
  const on = await stage(failed)
  const { canvas, scene, core, query } = on
  /** Whether another page holds this one: there the wheel and an upward swipe are the holder's, to scroll by. */
  const held = parent !== window

  // ── The eye ─────────────────────────────────────────────────────────────
  const rad = Math.PI / 180
  const eye = { far: scene.eye.far, yaw: scene.eye.yaw * rad, pitch: scene.eye.pitch * rad }
  const nearest = scene.eye.nearest ?? scene.eye.far / 3, farthest = scene.eye.farthest ?? scene.eye.far * 3
  /** How far from the middle the eye is drawn: what was asked for, or less where something stands between, come to over a few frames. */
  let shown = eye.far, clear = eye.far, clearFor = ''
  /**
   * How far out from the middle along a way the world is open, up to `far`: the eye is never put in a wall or behind
   * one. Leaves and water are looked through, and so is what is thin (a lamp's post, a trunk): only what is met
   * again and again over the next two metres stops the eye.
   */
  const stands = (away: readonly number[], d: number) => { const k = core.world_kind(Math.floor(scene.centre[0] + away[0] * d), Math.floor(scene.centre[1] + away[1] * d), Math.floor(scene.centre[2] + away[2] * d)) & 15; return k !== 0 && k !== 5 && k !== 13 }
  const openTo = (away: readonly number[], far: number) => {
    for (let d = 2; d <= far; d += 2) {
      if (!stands(away, d)) continue
      let more = 0
      for (let on = 2; on <= 20; on += 2) if (stands(away, d + on)) more++
      if (more >= 3) return Math.max(2, d - 6)
    }
    return far
  }
  const view = (): View => {
    const cp = Math.cos(eye.pitch), forward = [Math.sin(eye.yaw) * cp, Math.sin(eye.pitch), -Math.cos(eye.yaw) * cp] as const
    const right = [Math.cos(eye.yaw), 0, Math.sin(eye.yaw)] as const
    const up = [right[1] * forward[2] - right[2] * forward[1], right[2] * forward[0] - right[0] * forward[2], right[0] * forward[1] - right[1] * forward[0]] as const
    // Asked again only when the eye was moved: the world it is asked of is the one the rules make, which does not change.
    const key = `${eye.yaw},${eye.pitch},${eye.far}`
    if (key !== clearFor) { clearFor = key; clear = openTo([-forward[0], -forward[1], -forward[2]], eye.far) }
    return { eye: [scene.centre[0] - forward[0] * shown, scene.centre[1] - forward[1] * shown, scene.centre[2] - forward[2] * shown], forward, right, up, tanHalf: on.tanHalf }
  }
  on.view = view
  // In quickly when something comes between, out again more slowly.
  on.each = (dt) => { shown += (clear - shown) * Math.min(1, dt * (clear < shown ? 14 : 5)) }
  // The holder is told once the scene is seen.
  on.seenNear = (ms, firstFrame) => tell('ready', { ms, firstFrame, scene: scene.name })

  /** Throws the ball at what is under a place on the picture: `hard` is 0 for a tap to 1 for the longest hold. Returns what it was thrown at. */
  const poke = async (px: number, py: number, hard: number) => {
    const v = on.through(px, py), hit = await on.march.pick(v)
    on.toss(v, hit ? hit.t : eye.far, hard)
    return hit
  }

  // ── Mouse and touch ─────────────────────────────────────────────────────
  // One finger or the mouse held and moved turns the eye; two fingers, or the wheel, bring it nearer or further.
  // A press that did not move is a poke when it ends, harder the longer it was held. In another page the wheel alone
  // is that page's (it scrolls by it): there the eye comes nearer with the wheel and Ctrl, which is also how a
  // trackpad's pinch arrives.
  const down = new Map<number, { x: number; y: number; x0: number; y0: number; t: number; moved: boolean }>()
  const hint = document.querySelector<HTMLElement>('#hint')
  const zoom = (by: number) => { eye.far = Math.max(nearest, Math.min(farthest, eye.far * by)) }
  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture(e.pointerId)
    down.set(e.pointerId, { x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY, t: performance.now(), moved: false })
    // A second finger down: neither is a poke.
    if (down.size > 1) for (const p of down.values()) p.moved = true
  })
  canvas.addEventListener('pointermove', (e) => {
    const p = down.get(e.pointerId)
    if (!p) return
    const dx = e.clientX - p.x, dy = e.clientY - p.y
    if (!p.moved && Math.hypot(e.clientX - p.x0, e.clientY - p.y0) > 6) p.moved = true
    if (down.size === 2) {
      const [a, b] = [...down.values()], before = Math.hypot(a.x - b.x, a.y - b.y)
      p.x = e.clientX; p.y = e.clientY
      zoom(before / Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)))
      return
    }
    p.x = e.clientX; p.y = e.clientY
    if (!p.moved) return
    eye.yaw += dx * 0.006
    eye.pitch = Math.max(-1.45, Math.min(-0.03, eye.pitch - dy * 0.006))
  })
  const lift = (e: PointerEvent, ended: boolean) => {
    const p = down.get(e.pointerId)
    down.delete(e.pointerId)
    if (!p || p.moved || !ended) return
    const box = canvas.getBoundingClientRect()
    if (hint) hint.hidden = true
    void poke(p.x - box.left, p.y - box.top, (performance.now() - p.t - 150) / (HOLD - 150)).catch(failed)
  }
  canvas.addEventListener('pointerup', (e) => lift(e, true))
  canvas.addEventListener('pointercancel', (e) => lift(e, false))
  canvas.addEventListener('wheel', (e) => { if (held && !e.ctrlKey) return; e.preventDefault(); zoom(Math.exp(e.deltaY * 0.0015)) }, { passive: false })
  canvas.addEventListener('contextmenu', (e) => e.preventDefault())

  // For whoever measures and for the console: nothing of the page's own reads it.
  Object.assign(globalThis, { player: { scene, world: on.world, eye, view, poke, gaps: on.gaps, seen: on.seen, get frameMs() { return on.frameMs }, get gpuMs() { return on.gpuMs }, get cpuMs() { return on.cpuMs }, get scale() { return on.scale }, get bodies() { return on.bodies }, get pieces() { return on.pieces }, get thrown() { return on.thrown }, get broken() { return on.broken }, get faults() { return on.gpu.faults } } })
  on.start()
}
