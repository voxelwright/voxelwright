// Composing off the page's own thread (#247): a section takes tens of milliseconds to find, which is several frames.
import { MOODS, compose, type Section } from './compose.ts'
import type { Line } from './rules.ts'

export interface Want { id: number; mood: string; seed: number; groove: number; figure?: Line }
self.onmessage = (e: MessageEvent<Want>) => {
  const { id, mood, seed, groove, figure } = e.data
  const section: Section = compose(MOODS[mood] ?? MOODS.town, seed, { groove, figure });
  (self as unknown as Worker).postMessage({ id, section })
}
