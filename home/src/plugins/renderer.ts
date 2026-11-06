import * as THREE from 'three/webgpu'
import type { Context } from 'cordis'
import { replace, type Quality, type Stage } from '../kernel'

export const quality: Quality = new URLSearchParams(location.search).get('q') === 'low' ? 'low' : 'high'

export default {
  name: 'renderer',
  async apply(ctx: Context) {
    const renderer = new THREE.WebGPURenderer({ antialias: quality === 'high', powerPreference: 'high-performance' })
    await renderer.init()
    renderer.setPixelRatio(quality === 'low' ? 1 : Math.min(devicePixelRatio, 2))
    renderer.setSize(innerWidth, innerHeight)
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = 1.25
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = THREE.PCFSoftShadowMap

    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(38, innerWidth / innerHeight, 0.1, 60)
    const backend = (renderer.backend as { isWebGPUBackend?: boolean }).isWebGPUBackend ? 'WebGPU' : 'WebGL2'

    const passes: Array<() => void> = []
    const stage: Stage = {
      renderer,
      scene,
      camera,
      quality,
      backend,
      draw: () => (passes.at(-1) ?? (() => renderer.render(scene, camera)))(),
      addDrawPass: (pass) => {
        passes.push(pass)
        return () => {
          const i = passes.lastIndexOf(pass)
          if (i >= 0) passes.splice(i, 1)
        }
      },
      drawPasses: () => passes.length,
    }

    const canvas = renderer.domElement
    canvas.dataset.backend = backend
    document.body.prepend(canvas)

    const resize = () => {
      camera.aspect = innerWidth / innerHeight
      camera.updateProjectionMatrix()
      renderer.setSize(innerWidth, innerHeight)
    }
    addEventListener('resize', resize)

    const clock = new THREE.Timer()
    renderer.setAnimationLoop((time) => {
      clock.update(time)
      ctx.emit('village/frame', Math.min(clock.getDelta(), 0.1), clock.getElapsed())
      stage.draw()
    })

    ctx.effect(() => () => {
      renderer.setAnimationLoop(null)
      removeEventListener('resize', resize)
      canvas.remove()
      renderer.dispose()
    }, 'renderer')
    ctx.provide('stage', stage)
  },
}

if (import.meta.hot) import.meta.hot.accept((m) => m && replace(m.default))
