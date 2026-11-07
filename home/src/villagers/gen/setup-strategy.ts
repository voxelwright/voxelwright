// #47 setup, dev only: how a made villager is tuned. &setup=1 (or d) is the default, the cheval mirror in
// the room (setup-d.ts); &setup=b is regroup 1's mirror panel and &setup=bench the round-6 bench (no
// strategy), both kept for the record. A strategy shares everything
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
import type { Workshop } from './workshop'
import { mirror } from './setup-b'
import { fitting } from './setup-d'

export type SetupState = 'empty' | 'waiting' | 'stitching' | 'tuning' | 'leaving' | 'failed'
export interface Rect { left: number; top: number; right: number; bottom: number }

/** What setup.ts lends a strategy. */
export interface Scene {
  stage: Stage
  group: THREE.Group
  tools: Controls
  /** The workshop on the table (the mat, the cutting and the needle). */
  shop: Workshop
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
  /** Put a strategy's controls in the page's tab order, after the name tag and before the save and send-off tags. */
  mount(e: HTMLElement): void
}

export interface Strategy {
  id: 'b' | 'd'
  /** Null from any of these: the bench's own answer. */
  pose?(state: SetupState): Pose | null
  standAt?(): THREE.Vector3 | null
  turn?(): number | null
  toolsVisible?(): boolean | null
  /**
   * How much smaller to show a villager (its bounds in its own space, at scale 1) while it is being fitted, or null for
   * the bench's own fit. Its tuned size is unchanged; it grows to it as it hops down.
   */
  fit?(body: THREE.Box3): number | null
  /** Tuning begins (the villager is stitched): show this strategy's surface. */
  tuning?(): void
  /** The send-off begins: hide it. */
  leaving?(): void
  /** Where the slip's middle goes, or null for the bench's place. */
  slip?(w: number, h: number): { x: number; y: number } | null
  /** Top-left of the name tag, speech note, save or send-off tag, or null for the bench's place. */
  place?(what: 'name' | 'card' | 'save' | 'done', w: number, h: number): { x: number; y: number } | null
  frame?(dt: number, t: number): void
  /** Extra entries on window.villagerSetup, for the checks. */
  api?: Record<string, unknown>
  dispose(): void
}

/** The strategy for &setup=: 1 (the default) and d are the cheval mirror, b the mirror panel; bench (null) the bench. */
export function strategyFor(id: string, scene: Scene): Strategy | null {
  if (id === '1' || id === 'd') return fitting(scene)
  if (id === 'b') return mirror(scene)
  return null
}
