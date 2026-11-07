// #47 regroup, dev only: &setup=a|b|c swaps how a made villager is tuned, sharing everything
// else in setup.ts (the slip, the patterns, the waiting, the stitching, the persona, the host,
// the voice and the send-off). A strategy only answers the questions setup.ts asks it: where the
// camera goes, where the villager stands, which tools show, where the page's paper goes, and what
// happens when tuning starts. Every value still changes through the tools' set(), so the jokes
// dial's lock and the host's pin hold whatever the surface.
import type * as THREE from 'three/webgpu'
import type { Stage } from '../../kernel'
import type { Pose } from '../../plugins/camera'
import type { Persona } from './setup-persona'
import type { rack, RackCard } from './setup-rack'
import type { Controls, Key, Layout } from './sliders'
import { mirror } from './setup-b'
import { tin } from './setup-a'
import { talk } from './setup-c'

export type SetupState = 'empty' | 'waiting' | 'stitching' | 'tuning' | 'leaving' | 'failed'
export interface Rect { left: number; top: number; right: number; bottom: number }

/** What setup.ts lends a strategy. */
export interface Scene {
  stage: Stage
  group: THREE.Group
  tools: Controls
  patterns: ReturnType<typeof rack>
  slip: HTMLFormElement
  line: HTMLTextAreaElement
  sew: HTMLButtonElement
  state(): SetupState
  layout(): Layout
  made(): { name: string; persona: Persona; tuning: Record<Key, number> } | null
  /** The villager's projected bounds on the page, or null. */
  villager(): Rect | null
  /** A camera at the pose the view is easing to, so things placed by it do not slide while it eases. */
  target(): THREE.PerspectiveCamera
  /** Frame the villager (at its biggest size) between these page rows and columns. */
  front(o: { top: number; bottom: number; left?: number; right?: number; slope: number; fov?: number }): Pose
  /** Set the camera's lens (the seat's when not given); returns the field of view. */
  lens(fov?: number): number
  /** Close over the mat, for the waiting. */
  overMat(): Pose
  /** Ask the camera for its pose again. */
  reflow(): void
  say(text: string, short?: boolean): void
  /** Say a short tuned line, chosen by its persona dials. */
  tuned(): void
  note(text: string): void
  /** The felt's main colour at a colour value, as #rrggbb, or null before there is a villager. */
  hueAt(v: number): string | null
  cards(): RackCard[]
  watching(): boolean
}

export interface Strategy {
  id: 'a' | 'b' | 'c'
  pose?(state: SetupState): Pose | null
  standAt?(): THREE.Vector3
  turn?(): number
  toolsVisible?(): boolean
  /** Tuning begins (the villager is stitched): show this strategy's surface. */
  tuning?(): void
  /** The send-off begins: hide it. */
  leaving?(): void
  /** Where the slip's middle goes, or null for the bench's place. */
  slip?(w: number, h: number): { x: number; y: number } | null
  /** Top-left of the name tag, speech note, save or send-off tag, or null for the bench's place. */
  place?(what: 'name' | 'card' | 'save' | 'done', w: number, h: number): { x: number; y: number } | null
  frame?(dt: number, t: number): void
  /** A tool on the table was pressed: true when the strategy took it (picked it up) instead of a drag. */
  grab?(key: Key): boolean
  /** Extra entries on window.villagerSetup, for the checks. */
  api?: Record<string, unknown>
  dispose(): void
}

export function strategyFor(id: string, scene: Scene): Strategy | null {
  if (id === 'a') return tin(scene)
  if (id === 'b') return mirror(scene)
  if (id === 'c') return talk(scene)
  return null
}
