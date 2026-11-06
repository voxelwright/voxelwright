import * as THREE from 'three/webgpu'
import { float, length, mix, pass, smoothstep, uniform, uv, vec3 } from 'three/tsl'
import { bloom } from 'three/addons/tsl/display/BloomNode.js'
import { film } from 'three/addons/tsl/display/FilmNode.js'
import type { Context } from 'cordis'
import { replace } from '../kernel'

/** Bloom, a warm vignette and fine film grain, written as TSL nodes. */
export default {
  name: 'postfx',
  inject: ['stage'],
  apply(ctx: Context) {
    const stage = ctx.stage
    const low = stage.quality === 'low'
    const scenePass = pass(stage.scene, stage.camera)
    const color = scenePass.getTextureNode()
    const glow = bloom(color, low ? 0.25 : 0.42, 0.55, 0.78)
    const lit = color.add(glow)

    const d = length(uv().sub(0.5).mul(vec3(1.25, 1.0, 1).xy))
    const vignette = mix(float(1), float(0.6), smoothstep(0.38, 0.95, d))
    const warm = vec3(1.03, 0.99, 0.93)
    const graded = lit.rgb.mul(vignette).mul(warm)
    const grain = uniform(low ? 0 : 0.14)
    const output = film(graded, grain)

    const pipeline = new THREE.RenderPipeline(stage.renderer, output)
    ctx.effect(() => {
      const previous = stage.draw
      stage.draw = () => pipeline.render()
      return () => {
        stage.draw = previous
        pipeline.dispose()
        glow.dispose()
        scenePass.dispose()
      }
    }, 'post-processing')
  },
}

if (import.meta.hot) import.meta.hot.accept((m) => m && replace(m.default))
