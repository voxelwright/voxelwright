// What a visitor says to the city (eggs.ts), and the meme clips' phrases (sf/memes.json): in one place, so that
// sf/add-egg.mjs, which writes a meme's phrases, compares them as the page does.
import type { Weather } from './weather.ts'

/** The words of a phrase as they are compared: lower case, curly quotes straight, nothing but letters, digits, apostrophes and single spaces. */
export const words = (text: string) => text.toLowerCase().replace(/[‘’]/g, "'").replace(/[^a-z0-9' ]+/g, ' ').replace(/'/g, '').replace(/\s+/g, ' ').trim()

/** How an egg dresses the sky: the hour it goes to, the weather, and the last pass's grade (colour, contrast) and tint. */
export type Look = { hour: number; weather: Weather; grade?: readonly [number, number]; tint: readonly [number, number, number] }

/**
 * A meme egg (sf/memes.json, written by sf/add-egg.mjs): a short clip on every window, with its sound, started by any
 * of its phrases (as `words` gives them back) and, with the others, by “meme”. Its file is eggs/<id>.mp4. Without a
 * `look`, a clear evening. `youtube`, `source`, `by` and `crop` are the build's and the encoder's.
 */
export interface Meme { id: string; title: string; says: readonly string[]; look?: Look; youtube: string; source: string; by: string; crop?: string }

/** What a phrase does, by its words: the eggs' own, before any meme's. */
export const PHRASES: ReadonlyMap<string, string> = new Map([
  ['wake up', 'matrix'], ['wake up neo', 'matrix'], ['neo', 'matrix'], ['red pill', 'red'], ['follow the white rabbit', 'matrix'], ['the matrix', 'matrix'],
  ['blue pill', 'unplug'], ['rickroll', 'rickroll'], ['never gonna give you up', 'rickroll'], ['bad apple', 'apple'],
  ['iddqd', 'god'], ['moon', 'moon'], ['shoot the moon', 'moon'], ['do a barrel roll', 'roll'],
  ['stop', 'stop'], ['help', 'help'], ['hint', 'help'],
  ['meme', 'meme'], ['memes', 'meme'], ['another', 'meme'], ['another one', 'meme'], ['surprise me', 'meme'], ['random', 'meme'], ['tv', 'meme'],
])

/** Every phrase and what it does, the memes' after the eggs' own; and what is wrong with any (a phrase said twice would be only the first one's). */
export function phrases(memes: readonly Meme[]) {
  const all = new Map(PHRASES), wrong: string[] = []
  for (const m of memes) for (const p of m.says) {
    if (words(p) !== p) wrong.push(`“${p}” (${m.id}) is not as words() gives it back: “${words(p)}”`)
    else if (all.has(p)) wrong.push(`“${p}” is both ${all.get(p)}’s and ${m.id}’s`)
    else all.set(p, m.id)
  }
  return { all, wrong }
}
