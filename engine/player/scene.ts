// A scene (#419): what the player is given to show. The world itself is not in it: the core makes the same land and
// town from its rules wherever it runs, so a scene is a place in that world, where the eye starts, and what was done
// to the world there, in the words the engine already keeps such things in (page/edits.ts; a shared world's log
// keeps each as an echo's `edit` and `box`, serve.mjs). It is numbers and a name, and is read as data: nothing in
// it is run, and nothing in it says where anything else is to be fetched from.

export interface Scene {
  village: 'scene'
  version: 1
  /** What the scene is called: shown nowhere yet, told to the page that holds the player. */
  name: string
  /** What the eye turns about: cells of 10 cm, x east, y up, z south. */
  centre: [number, number, number]
  /** Where the eye starts: how far from the centre (cells), its turn from north towards east and its tilt (degrees, down is under zero); and how near and how far it may come. */
  eye: { far: number; yaw: number; pitch: number; nearest?: number; farthest?: number }
  /** What was done to the world, in order: each the core's own words for an edit (a ball, rows of cells) and the box of cells it can change (high corner not included). */
  edits: { edit: number[]; box: [number, number, number, number, number, number] }[]
}

/** The most words of edits a scene may hold: 16 MB of them. */
const WORDS_MOST = 4 << 20

const whole = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n) && Math.abs(n) < 2 ** 31
const real = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n)

/** A scene from what was read, or an error that says what is wrong with it. */
export function sceneOf(read: unknown): Scene {
  const s = read as Partial<Scene> | null
  if (!s || typeof s !== 'object' || s.village !== 'scene' || s.version !== 1) throw new Error('not a scene this player reads')
  if (!Array.isArray(s.centre) || s.centre.length !== 3 || !s.centre.every(whole)) throw new Error('a scene says where its middle is: three whole numbers')
  const eye = s.eye
  if (!eye || ![eye.far, eye.yaw, eye.pitch].every(real) || eye.far <= 0 || ![eye.nearest, eye.farthest].every((n) => n === undefined || (real(n) && n > 0))) throw new Error('a scene says where the eye starts: far, yaw, pitch')
  if (!Array.isArray(s.edits)) throw new Error('a scene lists what was done to the world')
  let words = 0
  for (const e of s.edits) {
    if (!e || !Array.isArray(e.edit) || !e.edit.every(whole) || !Array.isArray(e.box) || e.box.length !== 6 || !e.box.every(whole)) throw new Error('an edit is whole numbers and a box of six')
    // Balls and rows of the world's own cells: what the player's world, as it is set up, can hold.
    if (e.edit[0] !== 0 && e.edit[0] !== 1) throw new Error('a scene holds balls and rows of cells')
    words += e.edit.length
  }
  if (words > WORDS_MOST) throw new Error('the scene is too big')
  return { village: 'scene', version: 1, name: typeof s.name === 'string' ? s.name.slice(0, 80) : '', centre: s.centre as Scene['centre'], eye: { far: eye.far, yaw: eye.yaw, pitch: eye.pitch, nearest: eye.nearest, farthest: eye.farthest }, edits: s.edits }
}
