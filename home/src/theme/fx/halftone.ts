import * as THREE from 'three/webgpu'
import {
  Fn, diffuseColor, dot, exp2, float, floor, fract, length, log2, luminance, max, min, mix, mrt, output, pow, screenCoordinate,
  screenSize, smoothstep, sqrt, step, uniform, unpackRGBToNormal, uv, vec2, vec3, vec4,
} from 'three/tsl'
import type { Fx } from './index'
import type { Stage } from '../tokens'

type Spec = Extract<Stage, { kind: 'halftone' }>
type V3 = THREE.Node<'vec3'>

/** A hex colour's display (sRGB) value as a vec3; THREE.Color holds linear. */
function display(hex: string) {
  const { r, g, b } = new THREE.Color(hex).getRGB({ r: 0, g: 0, b: 0 }, THREE.SRGBColorSpace)
  return vec3(r, g, b)
}

/** The lens the dot screen is sized for; a narrower one sees the room smaller, so its screen is finer. */
const FOV = 40
/** Where the stop bands are cut, so the kitchen's ambient level sits mid-band. */
const PHASE = -0.3
/** Flat-colour taps: two rings of six, radii in pixels at 900 rows, the outer ring turned half a step. */
const RINGS: Array<[number, number]> = [[3, 0], [7, Math.PI / 6]]

/**
 * Only opaque surfaces write an attachment that a stage reads as "the surface here":
 * alpha 1 for them and 0 for anything see-through (steam, the glass's smudges), blended
 * normally, so a puff of steam leaves the wall's colour and normal behind it in place.
 */
export const OPAQUE_ONLY = new THREE.BlendMode(THREE.NormalBlending)
export const opaque = (rgb: THREE.Node<'vec3'>) => vec4(rgb, step(0.999, diffuseColor.a))

/**
 * The frame as print, in display colour, driven by light rather than by how dark
 * a material is. The scene pass gains the surface's own colour (`diffuseColor`),
 * so lit colour over surface colour is the light falling on each pixel.
 *
 * Flat colour: the surface colour is averaged with its neighbours of the same hue
 * and a similar value (wood grain, rug weave, plaster), and the frame is relit with
 * that average, so a material prints as one colour field while its edges stay.
 * Light is snapped to whole stops with a short soft step (shadows become flat
 * shapes), and a screen of round dots, `cell` rows up the screen at `angle`
 * degrees, prints the shade in the ink colour multiplied over the colour beneath,
 * growing as the light falls until the dots merge. Dots print only on broad,
 * flat-facing areas: a mug or a vase turning away from the window stays clean.
 * Highlights print on a paper tint. `strength` scales the dots and the banding.
 */
export function halftone(spec: Spec): Fx {
  const a = (spec.angle * Math.PI) / 180
  const ink = display(spec.ink ?? '#3a2232')
  const paper = display(spec.paper ?? '#fff7e8')
  return {
    // Film grain would muddy the dots.
    quiet: { grain: true },
    scene({ scenePass }) {
      const albedo = mrt({ albedo: opaque(diffuseColor.rgb) })
      const had = scenePass.getMRT()
      if (!had) scenePass.setMRT(mrt({ output }).merge(albedo))
      else if (!had.has('albedo')) scenePass.setMRT(had.merge(albedo))
      scenePass.getMRT()!.setBlendMode('albedo', OPAQUE_ONLY)
      // 8 bits is plenty for a ratio, and keeps the high tier's targets within 32 bytes a sample.
      scenePass.getTexture('albedo').type = THREE.UnsignedByteType
    },
    display(color, { stage, scenePass }) {
      const camera = stage.camera as THREE.PerspectiveCamera
      const rows = uniform(spec.cell).onRenderUpdate(() => spec.cell * Math.min(2, Math.max(1, FOV / camera.fov)))
      const lit = scenePass.getTextureNode()
      const albedo = scenePass.getTextureNode('albedo')
      // The ink stage adds normals; without it every area counts as flat.
      const normals = scenePass.getMRT()?.has('normal') ? scenePass.getTextureNode('normal') : null
      return Fn(() => {
        const c = color.rgb.toVar()
        const at = uv().toVar()
        const a0 = albedo.sample(at).rgb.toVar()
        const l0 = max(luminance(a0), 0.02).toVar()
        // Flat colour: average the taps whose chromaticity matches and whose value is
        // within about a stop; grain and weave merge, a boundary between materials does not.
        const px = vec2(screenSize.y.div(screenSize.x), 1).div(900).toVar()
        const chroma0 = a0.div(l0).toVar()
        const sum = a0.toVar()
        const weight = float(1).toVar()
        for (const [r, turn] of RINGS) {
          for (let k = 0; k < 6; k++) {
            const t = turn + (k * Math.PI) / 3
            const ak = albedo.sample(at.add(px.mul(vec2(Math.cos(t) * r, Math.sin(t) * r)))).rgb
            const lk = max(luminance(ak), 0.02)
            const differs = log2(lk.div(l0)).abs().add(length(ak.div(lk).sub(chroma0)).mul(3))
            const w = smoothstep(1.1, 0.6, differs)
            sum.addAssign(ak.mul(w))
            weight.addAssign(w)
          }
        }
        const flat = sum.div(weight)
        const relit = pow(flat.div(max(a0, vec3(0.02))).clamp(0.4, 2.5), vec3(1 / 2.2))
        c.assign(c.mul(relit).min(1))
        // Light on this pixel in stops: 0 is lit as brightly as the surface's own colour.
        const stops = log2(max(luminance(lit.sample(at).rgb), 1e-4).div(l0)).toVar()
        // Snap to whole stops with a short soft step: light and shade become flat shapes.
        // The steps sit half a stop either side of the room's ambient level (about -1.7
        // stops in the kitchen), so plain walls keep their value and only the sun's edge cuts.
        const phased = stops.add(PHASE)
        const snapped = floor(phased).add(smoothstep(0.35, 0.65, fract(phased))).sub(PHASE)
        const banded = c.mul(pow(exp2(snapped.sub(stops)), float(1 / 2.2))).min(1)
        const separated = mix(c, banded, 0.6 * spec.strength).toVar()
        // Dot screen: rotated cells sized by rows of the screen, so DPR changes nothing.
        const cellPx = screenSize.y.div(rows)
        const p = screenCoordinate.xy
        const rotated = vec2(p.x.mul(Math.cos(a)).sub(p.y.mul(Math.sin(a))), p.x.mul(Math.sin(a)).add(p.y.mul(Math.cos(a)))).div(cellPx)
        const d = length(fract(rotated).sub(0.5))
        // Shade: only light below the room's ambient (faces turned from the sky, the
        // undersides of things) takes dots, merging two stops further down.
        let shade = smoothstep(-2.1, -3.6, stops)
        if (normals) {
          // Broad areas only: where the surface turns within a cell (a mug, a vase, a
          // head) it keeps clean colour, as an inker would leave a small round thing.
          const cell = vec2(cellPx.div(screenSize.x), cellPx.div(screenSize.y))
          const nrm = (dx: number, dy: number): V3 => unpackRGBToNormal(normals.sample(at.add(cell.mul(vec2(dx, dy)))).rgb) as unknown as V3
          const n0 = nrm(0, 0).toVar()
          const turnAcross = min(min(dot(n0, nrm(1, 0)), dot(n0, nrm(-1, 0))), min(dot(n0, nrm(0, 1)), dot(n0, nrm(0, -1))))
          shade = shade.mul(smoothstep(0.985, 0.998, turnAcross))
        }
        const radius = sqrt(shade).mul(0.72)
        const aa = float(1.2).div(cellPx)
        const inked = smoothstep(radius.add(aa), radius.sub(aa), d).mul(shade.greaterThan(0.001).select(1, 0))
        const printed = mix(separated, separated.mul(ink), inked.mul(spec.strength))
        // Bare paper shows in the highlights.
        const bright = smoothstep(0.6, 0.95, luminance(c))
        return vec4(mix(printed, printed.mul(paper), bright), color.a)
      })() as unknown as THREE.Node<'vec4'>
    },
  }
}
