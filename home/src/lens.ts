// The lens: a miniature's shallow focus. What the view looks at is sharp; the lawn's far
// edge, the island's rim and the clouds below fall softly out of focus, the way a real
// small thing photographs. The camera says where it looks (focusOn); postfx blurs by depth.
import * as THREE from 'three/webgpu'
import { Fn, If, float, perspectiveDepthToViewZ, screenSize, smoothstep, step, uniform, uv, vec2, vec4 } from 'three/tsl'

/** The lens's numbers, as uniforms: the camera moves them every frame without a rebuild. */
export const lens = {
  /** Distance along the view to what is in focus, in metres. */
  focus: uniform(30),
  /** Either side of the focus stays sharp this far. */
  band: uniform(5),
  /** Past the band the blur grows to full over this far. */
  range: uniform(16),
  /** The largest blur, as a share of the screen's height. */
  radius: uniform(0.011),
  /** Nearer than this nothing blurs: what you hold (the notepad, the journal) stays crisp. */
  hold: uniform(3),
  /** How far ambient occlusion reaches, in metres: a metre's corner from across the lot, a hand's width close in. */
  occlusion: uniform(0.55),
}

/**
 * Point the lens: `distance` to what the view looks at, and how tight the framing is
 * (0 the whole lot, 1 close in on one thing). A close view keeps a shallower sharp band.
 * `amount` scales the blur (0 leaves everything sharp).
 */
export function focusOn(distance: number, closeness: number, amount = 1): void {
  lens.focus.value = distance
  lens.band.value = distance * THREE.MathUtils.lerp(0.16, 0.1, closeness)
  lens.range.value = distance * THREE.MathUtils.lerp(0.55, 0.4, closeness)
  lens.hold.value = Math.min(3, distance * 0.4)
  lens.radius.value = 0.011 * amount
  // Close in, a wide reach covers half the screen: it costs milliseconds and smothers small things.
  lens.occlusion.value = THREE.MathUtils.clamp(distance * 0.03, 0.12, 0.55)
}

// Twelve points spread evenly over a disc (a golden-angle spiral).
const TAPS = Array.from({ length: 12 }, (_, i) => {
  const r = Math.sqrt((i + 0.5) / 12), a = i * 2.399963
  return [Math.cos(a) * r, Math.sin(a) * r, r] as const
})

/**
 * Blur `color` by distance from the focus. Each pixel gathers from a disc as wide as its
 * own blur, and takes a neighbour only as far as that neighbour is blurred itself, so the
 * sharp house never smears into the soft sky behind it. Pixels in focus skip the gather.
 */
export function shallowFocus(color: THREE.TextureNode, depth: THREE.TextureNode, camera: THREE.PerspectiveCamera): THREE.Node<'vec4'> {
  const near = uniform(camera.near).onRenderUpdate(() => camera.near)
  const far = uniform(camera.far).onRenderUpdate(() => camera.far)
  const blurAt = (at: THREE.Node<'vec2'>) => {
    const z = perspectiveDepthToViewZ(depth.sample(at).x, near, far).negate()
    return smoothstep(lens.band, lens.band.add(lens.range), z.sub(lens.focus).abs()).mul(step(lens.hold, z))
  }
  return Fn(() => {
    const at = uv()
    const here = blurAt(at)
    const out = vec4(color.sample(at)).toVar()
    // Nothing to gather where the blur is under a fifth of a pixel: in focus, or the lens stopped right down.
    If(here.mul(lens.radius).mul(screenSize.y).greaterThan(0.2), () => {
      const reach = vec2(screenSize.y.div(screenSize.x), 1).mul(lens.radius).mul(here)
      const sum = out.mul(0.5).toVar()
      const weight = float(0.5).toVar()
      for (const [x, y, r] of TAPS) {
        const tap = at.add(reach.mul(vec2(x, y)))
        const w = blurAt(tap).div(here.mul(r)).clamp(0, 1)
        sum.addAssign(vec4(color.sample(tap)).mul(w))
        weight.addAssign(w)
      }
      out.assign(sum.div(weight))
    })
    return out
  })() as unknown as THREE.Node<'vec4'>
}
