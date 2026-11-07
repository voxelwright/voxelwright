import * as THREE from 'three/webgpu'
import {
  color as color3, diffuseColor, float, length, luminance, metalness, mix, mrt, normalView, output, packNormalToRGB, pass, pow,
  renderOutput, roughness, sample, select, smoothstep, step, uniform, unpackRGBToNormal, uv, vec2, vec3, vec4, velocity,
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
import type { Post, Theme } from '../theme/tokens'
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
    let synced: Theme = theme()
    const look = synced.post
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
    /** Write a theme's post numbers into the chain's uniforms. */
    const syncs: Array<(p: Post) => void> = []
    const depth = scenePass.getTextureNode('depth')
    const stages = look.stages.map(makeFx)
    const fxContext: FxContext = { stage, scenePass, depth }
    for (const s of stages) s.scene?.(fxContext)
    const quiet = (key: 'bloom' | 'grain' | 'vignette' | 'fxaa') => stages.some((s) => s.quiet?.[key])
    const normalTexture = gtao || gi || reflect ? scenePass.getTextureNode('normal') : null
    const normal = normalTexture && sample((at) => unpackRGBToNormal(normalTexture.sample(at)))

    // Every number below is a uniform, synced from theme() before each frame, so a theme
    // blend that keeps the chain's shape (src/theme/blend.ts) never rebuilds it.
    const sky = uniform(new THREE.Color(look.sky ?? '#000000'))
    syncs.push((p) => p.sky && sky.value.set(p.sky))
    let color: THREE.Node<'vec4'> = scenePass.getTextureNode()
    if (look.sky) color = mix(color, vec4(color3(sky), 1), step(0.99999, depth.x))
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
      const mirrorStrength = uniform(reflect.strength)
      syncs.push((p) => {
        if (!p.reflect) return
        mirror.resolutionScale = p.reflect.resolutionScale
        mirror.maxDistance.value = p.reflect.maxDistance
        mirror.thickness.value = p.reflect.thickness
        mirrorStrength.value = p.reflect.strength
      })
      color = vec4(color.rgb.add(mirror.getTextureNode().rgb.mul(mirrorStrength)), 1)
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
      const scale = low ? 0.25 / 0.42 : 1
      const glow = bloom(color, look.bloom.strength * scale, look.bloom.radius, look.bloom.threshold)
      disposables.push(glow)
      syncs.push((p) => {
        glow.strength.value = p.bloom.strength * scale
        glow.radius.value = p.bloom.radius
        glow.threshold.value = p.bloom.threshold
      })
      lit = color.add(glow)
    }

    const d = length(uv().sub(0.5).mul(vec3(1.25, 1.0, 1).xy))
    const darken = uniform(1 - (quiet('vignette') ? 0 : look.vignette.amount))
    const inner = uniform(look.vignette.inner), outer = uniform(look.vignette.outer)
    const vignette = mix(float(1), darken, smoothstep(inner, outer, d))
    const warm = uniform(new THREE.Vector3(...look.warm))
    let graded: THREE.Node<'vec3'> = lit.rgb.mul(vignette).mul(warm)
    // The grade is always in the chain, written so its identity (saturation 1, contrast 1,
    // no lift) leaves every value exactly as it was: x + (x - l) * 0, a select, + 0.
    const saturation = uniform(look.grade.saturation)
    const contrast = uniform(look.grade.contrast)
    const lift = uniform(new THREE.Vector3(...look.grade.lift))
    graded = graded.add(graded.sub(vec3(luminance(graded))).mul(saturation.sub(1)))
    graded = select(contrast.equal(1), graded, pow(graded.div(0.18).max(0), vec3(contrast)).mul(0.18))
    graded = graded.add(lift)
    const grain = uniform(low || quiet('grain') ? 0 : look.grain)
    syncs.push((p) => {
      darken.value = 1 - (quiet('vignette') ? 0 : p.vignette.amount)
      inner.value = p.vignette.inner
      outer.value = p.vignette.outer
      warm.value.set(...p.warm)
      saturation.value = p.grade.saturation
      contrast.value = p.grade.contrast
      lift.value.set(...p.grade.lift)
      grain.value = low || quiet('grain') ? 0 : p.grain
    })
    const filmed = film(graded, grain)
    // The low tier has no MSAA, so FXAA softens stair-stepping on wall caps and silhouettes.
    // It reads display colours, so the tone mapping and colour space are applied before it.
    // Theme stages that work in display space (palettes, dithering) take the same route.
    // A pixel-art stage quiets FXAA: it would smear every art-pixel boundary.
    const displayStages = stages.filter((s) => s.display)
    const smooth = low && !quiet('fxaa')
    let finalNode = (smooth ? fxaa(renderOutput(filmed)) : filmed) as unknown as THREE.Node<'vec4'>
    if (displayStages.length) {
      finalNode = smooth ? finalNode : renderOutput(filmed)
      for (const s of displayStages) finalNode = s.display!(finalNode, fxContext)
    }

    const pipeline = new THREE.RenderPipeline(stage.renderer, finalNode)
    if (smooth || displayStages.length) pipeline.outputColorTransform = false
    ctx.effect(() => {
      const remove = stage.addDrawPass(() => {
        const now = theme()
        if (now !== synced) for (const sync of syncs) sync((synced = now).post)
        pipeline.render()
      })
      return () => {
        remove()
        pipeline.dispose()
        for (const d of disposables.reverse()) d.dispose()
        // Render-to-texture nodes made inside other nodes (FXAA's input, a stage's) own a
        // render target nothing else releases: each rebuild left two GPU textures behind.
        const seen = new Set<THREE.Node>()
        const walk = (n: THREE.Node) => {
          if (seen.has(n)) return
          seen.add(n)
          if ((n as THREE.Node & { isRTTNode?: boolean }).isRTTNode) n.dispose()
          for (const c of n.getChildren()) walk(c)
        }
        walk(finalNode)
        for (const s of stages) s.dispose?.()
      }
    }, 'post-processing')
  },
}

if (import.meta.hot) import.meta.hot.accept((m) => m && replace(m.default))
