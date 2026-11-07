// Post stages a theme can append. Each stage may adjust the scene pass before it
// renders, work on the linear HDR colour before bloom, and work in display space
// (after tone mapping and sRGB), where palettes and dithering belong.
import type * as THREE from 'three/webgpu'
import type { Stage as VillageStage } from '../../kernel'
import type { Stage } from '../tokens'
import { pixel } from './pixel'
import { halftone } from './halftone'
import { ink } from './ink'
import { chroma } from './chroma'
import { brush } from './brush'
import { paper } from './paper'

export interface FxContext {
  stage: VillageStage
  scenePass: THREE.PassNode
  depth: THREE.Node
}

export interface Fx {
  /** Before anything samples the scene pass: resolution, filtering. */
  scene?(ctx: FxContext): void
  /** Linear HDR colour, before bloom and grading. */
  hdr?(color: THREE.Node<'vec4'>, ctx: FxContext): THREE.Node<'vec4'>
  /** Display colour (tone mapped, sRGB) at the end of the chain. */
  display?(color: THREE.Node<'vec4'>, ctx: FxContext): THREE.Node<'vec4'>
  /** Replaces bloom, vignette, grain and the low tier's FXAA where this stage cannot live with them. */
  quiet?: { bloom?: boolean; grain?: boolean; vignette?: boolean; fxaa?: boolean }
  dispose?(): void
}

export function makeFx(stage: Stage): Fx {
  switch (stage.kind) {
    case 'pixel': return pixel(stage)
    case 'halftone': return halftone(stage)
    case 'ink': return ink(stage)
    case 'chroma': return chroma(stage)
    case 'brush': return brush(stage)
    case 'paper': return paper(stage)
  }
}
