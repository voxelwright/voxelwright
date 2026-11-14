// Realms on the page (#264): the server keeps many worlds (serve.mjs "The realms"), and a page steps from the one
// it is in to another without being loaded again. The line to the world (link.ts) is made ready for the other
// while this one goes on, and then goes over at once: what this page holds of the old world is put away, the
// sectors that either world's edits reach are made again (world.ts `swap`), one arrives where the realm says and
// it looks as the realm says. Nothing here names a realm: each is data the server lists.
import type { Link, Realm } from './link.ts'

/** A realm as the server lists it. */
export interface Listed extends Realm { id: string; home: boolean; awake: boolean; pages: number }
/** Where the eye is and how it faces: metres and radians, as the page keeps it. */
export interface Pose { x: number; y: number; z: number; yaw: number; pitch: number }
/** How long a step took, ms from the asking: until the other realm's kept history had been read (`ready`: with the page still in the world it was in), until the picture was of it with the three nearest boxes whole (`near`), and until everything was made (`whole`). And how many sectors were made for it. */
export interface Stepped { id: string; ready: number; /** What the going over itself took: putting the old world away and hearing all that was held of the other. */ went: number; /** Until every box was whole over half its width: a picture of the place with nothing missing, drawn at worst at half its sharpness. */ shown: number; near: number; whole: number; sectors: number; edits: number }

export interface Realms {
  /** The realm this page is in. */
  readonly here: string
  /** The realm it was loaded in: where the helper that makes things was started for, if one was. */
  readonly first: string
  /** The realm the portal's key leads to from home: picked on the wheel, kept by this browser. Empty when none is. */
  selected: string
  /** Every realm the server keeps. */
  list(): Promise<Listed[]>
  /** Steps into a realm, by its id, with no loading of the page: to `at` if given, else where the realm says one arrives, else where this page began. `trade` is for a world that already holds the other realm's sectors (the portal): it is called to put them in place of this world's, and then none are made. `body` is where a person on foot is set down, when that is not where the eye is (the eye rides behind them). Resolves when everything there is made, with how long it took. */
  step(id: string, at?: Pose, trade?: () => void, body?: Pose): Promise<Stepped>
}

const HOME = 'home'
export const baseOf = (id: string) => (id === HOME ? '/world' : `/realm/${encodeURIComponent(id)}/world`)

export function realms(o: {
  far: Link
  /** Puts away what the page holds of the world it is leaving, and makes its sectors ready to be another's: called at the moment of the step. */
  leave(trade?: () => void): void
  /** Called when everything held of the other world has been said. */
  came(): void
  /** Puts the eye somewhere. */
  place(at: Pose, body?: Pose): void
  /** Where a realm's arrival is, as a pose: its feet on the ground there, its eyes over them. */
  arrival(arrive: NonNullable<Realm['arrive']>): Pose
  /** Where this page began. */
  began: Pose
  /** How a realm looks, or undefined for the page's own look. */
  look(look: Realm['look']): void
  /** How the making of the world stands: whether every box is whole over half its width, whether the three nearest boxes are whole, whether everything is, how many sectors have been made so far, how many edits the world holds. */
  made(): { shown: boolean; near: boolean; whole: boolean; sectors: number; edits: number }
}): Realms {
  const at = /^\/realm\/([^/]+)\/world$/.exec(o.far.base)
  const first = at ? decodeURIComponent(at[1]) : HOME
  let here = first, arrived = false, selected = ''
  try { selected = localStorage.getItem('village.realm') ?? '' } catch { /* a page that may keep nothing */ }
  // What a realm says of how it looks is shown when it is first read and whenever someone changes it. A page loaded
  // straight into a realm arrives where the realm says, unless its address said where.
  o.far.onrealm = (realm) => {
    o.look(realm.look)
    if (!arrived && realm.arrive && !new URLSearchParams(location.search).has('at')) o.place(o.arrival(realm.arrive))
    arrived = true
  }
  const frame = () => new Promise<void>((done) => requestAnimationFrame(() => done()))
  return {
    get here() { return here },
    get selected() { return selected },
    set selected(id: string) { selected = id; try { localStorage.setItem('village.realm', id) } catch { /* the same */ } },
    first,
    list: () => fetch('/realms').then((r) => r.json()).then((all: { realms: Listed[] }) => all.realms),
    async step(id, to, trade, body) {
      const began = performance.now(), before = o.made().sectors
      const realm = await o.far.ready(baseOf(id))
      const ready = performance.now() - began
      // From here to the first picture nothing waits on anything: the page is in the other world when this returns.
      arrived = true
      o.far.go(() => o.leave(trade))
      o.came()
      here = id
      o.place(to ?? (realm.arrive ? o.arrival(realm.arrive) : o.began), body)
      // The address says where the page is, so that loaded again it is there.
      const url = new URL(location.href)
      url.searchParams.delete('shared'); url.searchParams.delete('realm'); url.searchParams.delete('at'); url.searchParams.delete('look')
      url.searchParams.set(id === HOME ? 'shared' : 'realm', id === HOME ? '1' : id)
      history.replaceState(null, '', url)
      const went = performance.now() - began - ready
      let near = 0, shown = 0
      // Two frames at the least: the first asks for what is wanted, and only then does "nothing is wanted" mean it is made.
      await frame(); await frame()
      for (;;) {
        const m = o.made()
        if (!shown && m.shown) shown = performance.now() - began
        if (!near && m.near) near = performance.now() - began
        if (m.whole) return { id, ready, went, shown: shown || performance.now() - began, near: near || performance.now() - began, whole: performance.now() - began, sectors: m.sectors - before, edits: m.edits }
        await frame()
      }
    },
  }
}
