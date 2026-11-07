import * as THREE from 'three/webgpu'
import {
  Fn, diffuseColor, exp2, float, floor, fract, length, log2, luminance, max, mix, mrt, output, pow, screenCoordinate, screenSize,
  smoothstep, sqrt, uniform, uv, vec2, vec3, vec4,
} from 'three/tsl'
import type { Fx } from './index'
import type { Stage } from '../tokens'

type Spec = Extract<Stage, { kind: 'halftone' }>

/** A hex colour's display (sRGB) value as a vec3; THREE.Color holds linear. */
function display(hex: string) {
  const { r, g, b } = new THREE.Color(hex).getRGB({ r: 0, g: 0, b: 0 }, THREE.SRGBColorSpace)
  return vec3(r, g, b)
}

/** The lens the dot screen is sized for; a narrower one sees the room smaller, so its screen is finer. */
const FOV = 40
/** Where the stop bands are cut, so the kitchen's ambient level sits mid-band. */
const PHASE = -0.3

/**
 * The frame as print, in display colour, driven by light rather than by how dark
 * a material is. The scene pass gains the surface's own colour (`diffuseColor`),
 * so lit colour over surface colour is the light falling on each pixel. That light
 * is snapped to whole stops with a short soft step (shadows become flat shapes,
 * textures and hues stay), and a screen of round dots, `cell` rows up the screen
 * at `angle` degrees, prints the shade in the ink colour multiplied over the colour
 * beneath, growing as the light falls until the dots merge. A dark fridge in the
 * sun stays clean; a cream wall in shadow gets dots. Highlights print on a paper
 * tint. `strength` scales the dots and the banding.
 */
export function halftone(spec: Spec): Fx {
  const a = (spec.angle * Math.PI) / 180
  const ink = display(spec.ink ?? '#3a2232')
  const paper = display(spec.paper ?? '#fff7e8')
  return {
    // Film grain would muddy the dots.
    quiet: { grain: true },
    scene({ scenePass }) {
      const albedo = mrt({ albedo: diffuseColor })
      const had = scenePass.getMRT()
      if (!had) scenePass.setMRT(mrt({ output }).merge(albedo))
      else if (!had.has('albedo')) scenePass.setMRT(had.merge(albedo))
      // 8 bits is plenty for a ratio, and keeps the high tier's targets within 32 bytes a sample.
      scenePass.getTexture('albedo').type = THREE.UnsignedByteType
    },
    display(color, { stage, scenePass }) {
      const camera = stage.camera as THREE.PerspectiveCamera
      const rows = uniform(spec.cell).onRenderUpdate(() => spec.cell * Math.min(2, Math.max(1, FOV / camera.fov)))
      const lit = scenePass.getTextureNode()
      const albedo = scenePass.getTextureNode('albedo')
      return Fn(() => {
        const c = color.rgb.toVar()
        // Light on this pixel in stops: 0 is lit as brightly as the surface's own colour.
        const at = uv()
        const stops = log2(max(luminance(lit.sample(at).rgb), 1e-4).div(max(luminance(albedo.sample(at).rgb), 0.02))).toVar()
        // Snap to whole stops with a short soft step: light and shade become flat shapes.
        // The steps sit half a stop either side of the room's ambient level (about -1.7
        // stops in the kitchen), so plain walls keep their value and only the sun's edge cuts.
        const phased = stops.add(PHASE)
        const snapped = floor(phased).add(smoothstep(0.4, 0.6, fract(phased))).sub(PHASE)
        const banded = c.mul(pow(exp2(snapped.sub(stops)), float(1 / 2.2))).min(1)
        const separated = mix(c, banded, 0.6 * spec.strength).toVar()
        // Dot screen: rotated cells sized by rows of the screen, so DPR changes nothing.
        const cellPx = screenSize.y.div(rows)
        const p = screenCoordinate.xy
        const rotated = vec2(p.x.mul(Math.cos(a)).sub(p.y.mul(Math.sin(a))), p.x.mul(Math.sin(a)).add(p.y.mul(Math.cos(a)))).div(cellPx)
        const d = length(fract(rotated).sub(0.5))
        // Shade: only light below the room's ambient (faces turned from the sky, the
        // undersides of things) takes dots, merging two stops further down.
        const shade = smoothstep(-2.1, -3.6, stops)
        const radius = sqrt(shade).mul(0.72)
        const aa = float(1.2).div(cellPx)
        const dot = smoothstep(radius.add(aa), radius.sub(aa), d).mul(shade.greaterThan(0.001).select(1, 0))
        const printed = mix(separated, separated.mul(ink), dot.mul(spec.strength))
        // Bare paper shows in the highlights.
        const bright = smoothstep(0.6, 0.95, luminance(c))
        return vec4(mix(printed, printed.mul(paper), bright), color.a)
      })() as unknown as THREE.Node<'vec4'>
    },
  }
}
