// What is done to the street's picture after it is drawn (#136), in this order: corners and
// creases darken where the sky cannot reach (more in the shade than in the sun), the air
// between the eye and a far thing pales it towards the sky, frames are blended into one
// steady image, what is brighter than white glows a little, and the result is toned for the
// screen, sharpened and graded. The light tier keeps the air and the tone and smooths edges.
import * as THREE from 'three/webgpu'
import { convertToTexture, dot, exp, float, getViewPosition, length, luminance, mix, mrt, output, pass, pow, renderOutput, select, smoothstep, step, uniform, uv, vec3, vec4, velocity } from 'three/tsl'
import { bloom } from 'three/addons/tsl/display/BloomNode.js'
import { fxaa } from 'three/addons/tsl/display/FXAANode.js'
import { ao } from 'three/addons/tsl/display/GTAONode.js'
import { sharpen } from 'three/addons/tsl/display/SharpenNode.js'
import { traa } from 'three/addons/tsl/display/TRAANode.js'
import type { Stage } from '../../../home/src/kernel'
import { SUN } from '../../src/sun.ts'

/** The air: how far a thing at the bay's level is before it is 63% sky (m), and the height over which the air thins to a third. */
export const AIR = { reach: 760, thins: 130, foot: -17 }
/** The colour far things go towards, and the warmer one towards the sun. */
const HAZE = new THREE.Color(0.4, 0.5, 0.66), GLARE = new THREE.Color(0.95, 0.82, 0.62)

export interface Post { render(): void; dispose(): void }

export function post(stage: Stage): Post {
  const { renderer, scene, camera } = stage
  const fx = stage.features(), low = stage.quality === 'low'
  const temporal = fx.has('traa')
  const scenePass = pass(scene, camera, temporal ? { samples: 0 } : {})
  if (temporal) scenePass.setMRT(mrt({ output, velocity }))
  const owned: Array<{ dispose(): void }> = [scenePass]
  const depth = scenePass.getTextureNode('depth')
  let color: THREE.Node<'vec4'> = scenePass.getTextureNode()

  if (fx.has('gtao')) {
    const shade = ao(depth, null as unknown as THREE.Node, camera)
    shade.resolutionScale = 0.4
    shade.radius.value = 0.95
    shade.scale.value = 1.45
    shade.thickness.value = 1
    shade.distanceExponent.value = 1.2
    shade.samples.value = 8
    shade.useTemporalFiltering = temporal
    owned.push(shade)
    const hidden = float(1).sub(shade.getTextureNode().r)
    // The sun reaches into a crease the sky does not: what is brightly lit keeps most of its light.
    const lit = smoothstep(0.25, 1.4, luminance(color.rgb))
    color = vec4(color.rgb.mul(mix(vec3(1), vec3(0.16, 0.19, 0.3), hidden.mul(mix(1, 0.4, lit)).min(1))), 1)
  }

  // The air. A point's place in the world comes from its depth; the haze along the ray to it is thicker low down.
  const inverse = uniform(camera.projectionMatrixInverse), toWorld = uniform(camera.matrixWorld)
  const sunward = uniform(new THREE.Vector3(...SUN))
  const at = uv(), deep = depth.sample(at).x
  const seen = toWorld.mul(vec4(getViewPosition(at, deep, inverse), 1)).xyz
  const eye = toWorld.mul(vec4(0, 0, 0, 1)).xyz
  const ray = seen.sub(eye), far = length(ray), towards = ray.div(far.max(0.001))
  const fall = float(Math.log(3) / AIR.thins)
  const slope = towards.y.mul(fall), steep = select(slope.abs().lessThan(1e-5), float(1e-5), slope)
  const through = exp(eye.y.sub(AIR.foot).mul(fall).negate()).mul(float(1).sub(exp(far.mul(steep).negate())).div(steep))
  const paled = float(1).sub(exp(through.div(AIR.reach).negate()))
  const glare = pow(dot(towards, sunward).max(0), 8)
  const air = mix(vec3(HAZE.r, HAZE.g, HAZE.b), vec3(GLARE.r, GLARE.g, GLARE.b), glare.mul(0.55))
  // The sky is its own air already: the dome is at the far plane.
  color = vec4(mix(color.rgb, air, paled.mul(step(deep, 0.99999))), 1)

  if (temporal) {
    const before = convertToTexture(color)
    owned.push(before as unknown as { dispose(): void })
    const steady = traa(before, depth, scenePass.getTextureNode('velocity'), camera)
    owned.push(steady)
    color = steady as unknown as THREE.Node<'vec4'>
  }

  const glow = bloom(color, low ? 0.1 : 0.16, 0.55, 1.15)
  owned.push(glow)
  const lit = vec4(color.rgb.add(glow.rgb), 1)

  // In the screen's own colours from here: tone, then edges, then the grade.
  let shown = renderOutput(lit) as unknown as THREE.Node<'vec4'>
  if (low) shown = fxaa(shown) as unknown as THREE.Node<'vec4'>
  else {
    const crisp = sharpen(shown, 0.35)
    owned.push(crisp)
    shown = crisp as unknown as THREE.Node<'vec4'>
  }
  const corner = length(uv().sub(0.5).mul(vec3(1.2, 1, 1).xy))
  const graded = shown.rgb.mul(mix(float(1), float(0.86), smoothstep(0.45, 0.95, corner)))
  const pipeline = new THREE.RenderPipeline(renderer, vec4(graded, 1))
  pipeline.outputColorTransform = false
  const remove = stage.addDrawPass(() => pipeline.render())
  return {
    render: () => pipeline.render(),
    dispose() {
      remove()
      pipeline.dispose()
      for (const o of owned.reverse()) o.dispose()
    },
  }
}
