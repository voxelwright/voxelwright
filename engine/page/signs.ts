// STAND-IN for the realm's signs (#450, feature/450-boards): the banner the plane tows ("banner") and the digital
// billboards, each by its own id. That branch owns the real thing and draws it in the world; this file has only its
// content API, the same shape (`set`, `list`), so that the eggs (eggs.ts) are written against it. Until it lands, what
// a sign is set to show is put on a strip of the page instead, plainly marked as a stand-in. When the two are merged,
// this file goes and eggs.ts takes the boards' `signs`.
export type SignContent = { text: string } | { image: string } | { video: HTMLVideoElement } | null
export interface SignInfo { id: string; content: SignContent }
export interface Signs {
  /** Puts something on a sign, or gives it back to its own content (null). */
  set(id: string, content: SignContent): void
  /** Every sign there is, with what it was last set to (null: its own). */
  list(): SignInfo[]
}

/** The stand-in: the banner and one digital board, shown as two lines at the top of the page. */
export function standInSigns(): Signs {
  const shown = new Map<string, SignContent>([['banner', null], ['board', null]])
  const strip = document.createElement('div')
  strip.id = 'signs-stand-in'
  strip.setAttribute('aria-hidden', 'true')
  strip.style.cssText = 'position:fixed;left:50%;top:14px;transform:translateX(-50%);z-index:6;display:grid;gap:6px;justify-items:center;pointer-events:none;font:600 15px/1.2 "IBM Plex Mono",ui-monospace,monospace;letter-spacing:.06em;text-transform:uppercase'
  document.body.append(strip)
  const draw = () => {
    strip.replaceChildren()
    for (const [id, c] of shown) {
      if (!c) continue
      const line = document.createElement('div')
      line.dataset.sign = id
      line.style.cssText = id === 'banner'
        ? 'padding:5px 14px;background:#f3ead8;color:#2a2219;border:1px solid #c9b996;box-shadow:0 2px 0 #0004'
        : 'padding:6px 12px;background:#050a07;color:#7dff9e;border:2px solid #1a2a1f;box-shadow:0 0 18px #2dff6a33;min-width:16ch;text-align:left'
      if ('text' in c) line.textContent = c.text
      else if ('image' in c) line.textContent = `[image ${c.image}]`
      else line.textContent = '▶ video'
      strip.append(line)
    }
  }
  return {
    set(id, content) { shown.set(id, content); draw() },
    list: () => [...shown].map(([id, content]) => ({ id, content })),
  }
}
