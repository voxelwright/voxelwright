// What the realm's signs say (#450): one way in for whoever changes it, the site, an easter egg or an announcement.
//
//   realm.signs.set(id, { text } | { image: url } | { video: HTMLVideoElement } | null)
//   realm.signs.list()
//
// A sign is the banner the plane tows (id "banner"), a digital billboard (its own id) or a lettering board (its own
// id, `{ text }` only: its letters are cells of the world). `null` gives a sign back what its record says. What is
// set for an id no sign has yet is kept and shown when that sign comes, so a caller need not wait for the realm.
// This module draws nothing and knows no board: whoever shows a sign brings it here (`add`), and is told what to show.

export type Content = { text: string } | { image: string } | { video: HTMLVideoElement }
export type Accepts = 'text' | 'image' | 'video'
export interface Sign {
  id: string
  kind: 'banner' | 'digital' | 'lettering'
  /** What a person would call it: its accessible name. */
  name: string
  accepts: readonly Accepts[]
  /** What it shows now, and whether that is its record's own. */
  content: Content | null
  own: boolean
}
/** A sign as whoever shows it brings it: what its record says, and how it is shown. */
export interface Shown { id: string; kind: Sign['kind']; name: string; accepts: readonly Accepts[]; own: Content | null; show(content: Content | null): void }
export interface Signs {
  /** Shows `content` on a sign; `null` puts back its own. Throws a TypeError for content the sign cannot show. */
  set(id: string, content: Content | null): void
  list(): Sign[]
  /** For whoever shows a sign. Returns what takes it away again. */
  add(sign: Shown): () => void
}

// (A video by its tag: one made in the host page's document is no instance of this page's HTMLVideoElement.)
const kindOf = (content: Content): Accepts | null => (typeof (content as { text?: unknown }).text === 'string' ? 'text' : typeof (content as { image?: unknown }).image === 'string' ? 'image' : (content as { video?: { tagName?: unknown } }).video?.tagName === 'VIDEO' ? 'video' : null)

function make(): Signs {
  const shown = new Map<string, Shown>(), set = new Map<string, Content>()
  return {
    set(id, content) {
      if (content === null) { set.delete(id); const s = shown.get(id); s?.show(s.own); return }
      const kind = kindOf(content), s = shown.get(id)
      if (!kind) throw new TypeError('a sign shows { text }, { image: url }, { video: element } or null')
      if (s && !s.accepts.includes(kind)) throw new TypeError(`the sign "${id}" shows ${s.accepts.join(' or ')} only`)
      set.set(id, content)
      s?.show(content)
    },
    list: () => [...shown.values()].map((s) => ({ id: s.id, kind: s.kind, name: s.name, accepts: s.accepts, content: set.get(s.id) ?? s.own, own: !set.has(s.id) })),
    add(sign) {
      shown.set(sign.id, sign)
      // What was set before it came, if it can show that; else its own.
      const early = set.get(sign.id), kind = early && kindOf(early)
      if (early && kind && sign.accepts.includes(kind)) sign.show(early)
      else { set.delete(sign.id); sign.show(sign.own) }
      return () => { if (shown.get(sign.id) === sign) shown.delete(sign.id) }
    },
  }
}

/** The page's signs: one registry, also at `realm.signs` for scripts that are not modules of this page. */
export const signs: Signs = make()
// (Until this module has run, `window.realm` is the page's record, the script element of that id: a caller waits for the host's `ready`.)
if (typeof window !== 'undefined') { const g = window as unknown as { realm?: object }; g.realm = { ...(g.realm && !(g.realm instanceof Element) ? g.realm : {}), signs } }
