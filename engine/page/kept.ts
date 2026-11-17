// What is kept, shown as it is typed (#220). While words are typed on the ask bar, the helper is asked what of the
// kept library they mean so far (its own shelf and what came with the engine) and where it would stand; the page
// draws it there as a ghost, pale and seen through, from the first key that makes it clear, and takes it away when
// the words stop meaning it. Enter makes that very thing, from what was kept, with no model. The ghost stays until
// the thing stands, or until it is known that it will not.
import type { Asker, Guess } from './ask.ts'
import type { Hud } from './hud.ts'
import type { Making } from './making.ts'
import type { Piece, Pieces } from './pieces.ts'

/** How long words that were sent may wait for their ask before the ghost is let go (ms): an ask that was said, or a rule, never comes. */
const SENT_WAIT = 3000

export interface Kept {
  /** The ghost shown now: the kept thing's id and name, and the words it was shown for. */
  readonly shown: { id: string; name: string; words: string } | null
  /** From each key to the frame that shows its ghost (ms), newest last: for the check (test/kept.mjs). */
  readonly laps: { words: string; ms: number; id: string | null }[]
}

export function kept(hud: Hud, asker: Asker, pieces: Pieces, making: Making): Kept {
  let shown: { guess: Guess; placed: NonNullable<Guess['placed']>; piece: Piece; words: string; sent: boolean; asked: boolean } | null = null
  /** Faces by thing and facing, asked for once each. */
  const faces = new Map<string, Promise<Uint32Array<ArrayBuffer> | null>>()
  /** The newest words: an answer to older ones is dropped. */
  let latest = 0
  const laps: { words: string; ms: number; id: string | null }[] = []
  const gone = () => { shown?.piece.destroy(); shown = null }
  const show = async (words: string, began: number) => {
    const n = ++latest
    // Only words that Enter would make a thing of: in a world with rules "I want a car" is said, not made, and a line that begins a realm or a rule is no thing.
    const guess = words.trim() && (await making.makes(words)) ? await asker.guess(words) : null
    if (n !== latest || shown?.sent) return
    // Words that mean a kept thing with no place for it where the eye is draw nothing: Enter makes it all the same (held, if no place will take it).
    const placed = guess?.placed
    if (!guess || !placed) { gone(); laps.push({ words, ms: performance.now() - began, id: null }); return }
    // The same thing at the same place and facing: it stays as it is.
    if (shown && shown.guess.id === guess.id && shown.placed.facing === placed.facing && shown.placed.at.every((v, a) => v === placed.at[a])) { shown.words = words; return }
    const key = `${guess.id} ${placed.facing}`
    if (!faces.has(key)) faces.set(key, asker.faces(guess.id, placed.facing))
    const got = await faces.get(key)!
    if (n !== latest || shown?.sent) return
    if (!got) { faces.delete(key); gone(); return }
    gone()
    // Its lowest corner where its cells will be, in cells of its own size, with no turn: the helper made its faces facing the way it will.
    const piece = pieces.add({ id: 0, cells: 0, size: placed.size, com: [0, 0, 0], low: [0, 0, 0], faces: got })
    Object.assign(piece, { pos: placed.at, rot: [0, 0, 0, 1], cell: 1 / placed.grain, ghost: true })
    shown = { guess, placed, piece, words, sent: false, asked: false }
    requestAnimationFrame(() => laps.push({ words, ms: performance.now() - began, id: guess.id }))
  }
  hud.line.ontyped = (text, sent) => {
    if (!sent) { void show(text, performance.now()); return }
    // Sent: the ghost waits for its ask (below), which says which thing to make.
    if (!shown || shown.words.trim() !== text.trim()) { gone(); return }
    const was = shown
    was.sent = true
    setTimeout(() => { if (shown === was && !was.asked) gone() }, SENT_WAIT)
  }
  asker.kept = (wish) => {
    if (!shown?.sent || shown.asked || shown.words.trim() !== wish.trim()) return undefined
    shown.asked = true
    return shown.guess.id
  }
  // It goes when the thing it stood for has come, or will not: the world has the thing by then.
  making.on((stage, ask) => { if (stage.stage === 'done' && shown?.asked && ask.wish?.trim() === shown.words.trim()) gone() })
  return {
    get shown() { return shown ? { id: shown.guess.id, name: shown.guess.name, words: shown.words } : null },
    laps,
  }
}
