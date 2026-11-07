import * as THREE from 'three/webgpu'
import {
  color as color3, diffuseColor, float, length, luminance, metalness, mix, mrt, normalView, output, packNormalToRGB, pass, pow,
  renderOutput, roughness, sample, smoothstep, step, uniform, unpackRGBToNormal, uv, vec2, vec3, vec4, velocity,
} from 'three/tsl'
import { bloom } from 'three/addons/tsl/display/BloomNode.js'
import { film } from 'three/addons/tsl/display/FilmNode.js'
import { fxaa } from 'three/addons/tsl/display/FXAANode.js'
import { ao } from 'three/addons/tsl/display/GTAONode.js'
import { traa } from 'three/addons/tsl/display/TRAANode.js'
import { ssgi } from 'three/addons/tsl/display/SSGINode.js'
import { ssr } from 'three/addons/tsl/display/SSRNode.js'
import type { Context } from 'cordis'
import { replace } from '../kernel'
import { theme } from '../theme'
import { makeFx, type FxContext } from '../theme/fx'

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
    // The theme's tokens (src/theme): its default reproduces this chain's old literals exactly.
    const look = theme().post
    const fx = new Set([...stage.features()].filter((f) => !look.veto.includes(f)))
    const gtao = fx.has('gtao')
    const gi = fx.has('ssgi')
    // TRAA reprojects jittered frames and needs MSAA off; SSGI's denoising is temporal too.
    const temporal = fx.has('traa') || gi
    // A theme's reflections (a wet floor) ride on a tier that already renders an MRT
    // without MSAA; the low tier keeps its single colour target and goes without.
    const reflect = temporal && look.reflect ? look.reflect : null
    const scenePass = pass(stage.scene, stage.camera, temporal ? { samples: 0 } : {})
    if (gtao || temporal) {
      scenePass.setMRT(mrt({
        output,
        ...(gi ? { diffuseColor } : {}),
        ...(gtao || gi || reflect ? { normal: packNormalToRGB(normalView) } : {}),
        ...(temporal ? { velocity } : {}),
        ...(reflect ? { metalrough: vec2(metalness, roughness) } : {}),
      }))
      // One 8-bit target for both, so five targets stay within WebGPU's 32 bytes per sample.
      if (reflect) scenePass.getTexture('metalrough').type = THREE.UnsignedByteType
    }
    const disposables: Array<{ dispose(): void }> = [scenePass]
    const depth = scenePass.getTextureNode('depth')
    const stages = look.stages.map(makeFx)
    const fxContext: FxContext = { stage, scenePass, depth }
    for (const s of stages) s.scene?.(fxContext)
    const quiet = (key: 'bloom' | 'grain' | 'vignette') => stages.some((s) => s.quiet?.[key])
    const normalTexture = gtao || gi || reflect ? scenePass.getTextureNode('normal') : null
    const normal = normalTexture && sample((at) => unpackRGBToNormal(normalTexture.sample(at)))

    let color: THREE.Node<'vec4'> = scenePass.getTextureNode()
    if (look.sky) color = mix(color, vec4(color3(look.sky), 1), step(0.99999, depth.x))
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
    if (reflect && normal) {
      const mirror = ssr(scenePass.getTextureNode(), depth, normal, {
        metalnessNode: scenePass.getTextureNode('metalrough').r,
        roughnessNode: scenePass.getTextureNode('metalrough').g,
        camera: stage.camera,
      })
      mirror.resolutionScale = reflect.resolutionScale
      mirror.maxDistance.value = reflect.maxDistance
      mirror.thickness.value = reflect.thickness
      disposables.push(mirror)
      color = vec4(color.rgb.add(mirror.getTextureNode().rgb.mul(reflect.strength)), 1)
    }
    if (temporal) {
      const resolved = traa(color, depth, scenePass.getTextureNode('velocity'), stage.camera)
      disposables.push(resolved)
      color = resolved
    }

    for (const s of stages) if (s.hdr) color = s.hdr(color, fxContext)

    // The low tier keeps its softer bloom (0.25 where the home's is 0.42) in every theme.
    let lit: THREE.Node<'vec4'> = color
    if (!quiet('bloom')) {
      const glow = bloom(color, look.bloom.strength * (low ? 0.25 / 0.42 : 1), look.bloom.radius, look.bloom.threshold)
      disposables.push(glow)
      lit = color.add(glow)
    }

    const d = length(uv().sub(0.5).mul(vec3(1.25, 1.0, 1).xy))
    const v = look.vignette
    const vignette = mix(float(1), float(1 - (quiet('vignette') ? 0 : v.amount)), smoothstep(v.inner, v.outer, d))
    const warm = vec3(...look.warm)
    let graded: THREE.Node<'vec3'> = lit.rgb.mul(vignette).mul(warm)
    const g = look.grade
    if (g.saturation !== 1) graded = mix(vec3(luminance(graded)), graded, g.saturation)
    if (g.contrast !== 1) graded = pow(graded.div(0.18).max(0), vec3(g.contrast)).mul(0.18)
    if (g.lift.some((x) => x !== 0)) graded = graded.add(vec3(...g.lift))
    const grain = uniform(low || quiet('grain') ? 0 : look.grain)
    const filmed = film(graded, grain)
    // The low tier has no MSAA, so FXAA softens stair-stepping on wall caps and silhouettes.
    // It reads display colours, so the tone mapping and colour space are applied before it.
    // Theme stages that work in display space (palettes, dithering) take the same route.
    const displayStages = stages.filter((s) => s.display)
    let finalNode = (low ? fxaa(renderOutput(filmed)) : filmed) as unknown as THREE.Node<'vec4'>
    if (displayStages.length) {
      finalNode = low ? finalNode : renderOutput(filmed)
      for (const s of displayStages) finalNode = s.display!(finalNode, fxContext)
    }

    const pipeline = new THREE.RenderPipeline(stage.renderer, finalNode)
    if (low || displayStages.length) pipeline.outputColorTransform = false
    ctx.effect(() => {
      const remove = stage.addDrawPass(() => pipeline.render())
      return () => {
        remove()
        pipeline.dispose()
        for (const d of disposables.reverse()) d.dispose()
        for (const s of stages) s.dispose?.()
      }
    }, 'post-processing')
  },
}

if (import.meta.hot) import.meta.hot.accept((m) => m && replace(m.default))
