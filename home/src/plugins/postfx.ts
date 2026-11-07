import * as THREE from 'three/webgpu'
import {
  diffuseColor, float, length, mix, mrt, normalView, output, packNormalToRGB, pass, sample,
  smoothstep, uniform, unpackRGBToNormal, uv, vec3, vec4, velocity,
} from 'three/tsl'
import { bloom } from 'three/addons/tsl/display/BloomNode.js'
import { film } from 'three/addons/tsl/display/FilmNode.js'
import { ao } from 'three/addons/tsl/display/GTAONode.js'
import { traa } from 'three/addons/tsl/display/TRAANode.js'
import { ssgi } from 'three/addons/tsl/display/SSGINode.js'
import type { Context } from 'cordis'
import { replace } from '../kernel'

/**
 * Bloom, a warm vignette and fine film grain, written as TSL nodes. The tier's
 * features add ambient occlusion (gtao), temporal anti-aliasing in place of MSAA
 * (traa) and screen-space global illumination (ssgi), each measurable alone.
 */
export default {
  name: 'postfx',
  inject: ['stage'],
  apply(ctx: Context) {
    const stage = ctx.stage
    const low = stage.quality === 'low'
    const fx = stage.features()
    const gtao = fx.has('gtao')
    const gi = fx.has('ssgi')
    // TRAA reprojects jittered frames and needs MSAA off; SSGI's denoising is temporal too.
    const temporal = fx.has('traa') || gi
    const scenePass = pass(stage.scene, stage.camera, temporal ? { samples: 0 } : {})
    if (gtao || temporal) {
      scenePass.setMRT(mrt({
        output,
        ...(gi ? { diffuseColor } : {}),
        ...(gtao || gi ? { normal: packNormalToRGB(normalView) } : {}),
        ...(temporal ? { velocity } : {}),
      }))
    }
    const disposables: Array<{ dispose(): void }> = [scenePass]
    const depth = scenePass.getTextureNode('depth')
    const normalTexture = gtao || gi ? scenePass.getTextureNode('normal') : null
    const normal = normalTexture && sample((at) => unpackRGBToNormal(normalTexture.sample(at)))

    let color: THREE.Node<'vec4'> = scenePass.getTextureNode()
    if (gi && normal) {
      const giPass = ssgi(scenePass.getTextureNode(), depth, normal, stage.camera)
      giPass.sliceCount.value = 2
      giPass.stepCount.value = 8
      disposables.push(giPass)
      const diffuse = scenePass.getTextureNode('diffuseColor')
      color = vec4(scenePass.getTextureNode().rgb.mul(giPass.a).add(diffuse.rgb.mul(giPass.rgb)), 1)
    } else if (gtao && normal) {
      const aoPass = ao(depth, normal, stage.camera)
      aoPass.resolutionScale = 0.5
      disposables.push(aoPass)
      // Soften the occlusion so creases darken without dirtying the painted textures.
      color = scenePass.getTextureNode().mul(mix(float(1), aoPass.getTextureNode().r, 0.75))
    }
    if (temporal) {
      const resolved = traa(color, depth, scenePass.getTextureNode('velocity'), stage.camera)
      disposables.push(resolved)
      color = resolved
    }

    const glow = bloom(color, low ? 0.25 : 0.42, 0.55, 0.78)
    disposables.push(glow)
    const lit = color.add(glow)

    const d = length(uv().sub(0.5).mul(vec3(1.25, 1.0, 1).xy))
    const vignette = mix(float(1), float(0.6), smoothstep(0.38, 0.95, d))
    const warm = vec3(1.03, 0.99, 0.93)
    const graded = lit.rgb.mul(vignette).mul(warm)
    const grain = uniform(low ? 0 : 0.14)
    const finalNode = film(graded, grain)

    const pipeline = new THREE.RenderPipeline(stage.renderer, finalNode)
    ctx.effect(() => {
      const remove = stage.addDrawPass(() => pipeline.render())
      return () => {
        remove()
        pipeline.dispose()
        for (const d of disposables.reverse()) d.dispose()
      }
    }, 'post-processing')
  },
}

if (import.meta.hot) import.meta.hot.accept((m) => m && replace(m.default))
