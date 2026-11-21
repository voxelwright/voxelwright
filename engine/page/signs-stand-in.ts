// STAND-IN for the realm's signs (#450, feature/450-boards' page/signs.ts): the banner the plane tows ("banner"), the
// digital billboards and the lettering boards, each by its own id. That branch owns the real registry and draws the
// signs in the world; this file has its content API in the same shape (`set`, `list`, the same `Content` and `Sign`),
// so the eggs (eggs.ts) are written against it. Until it lands, what a sign is set to show is put on a strip at the top
// of the page instead. When the two are merged: delete this file, give eggs.ts the boards' `signs` in main.ts, and
// take eggs.ts's types from the boards' signs module.
export type Content = { text: string } | { image: string } | { video: HTMLVideoElement }
export interface Sign { id: string; kind: 'banner' | 'digital' | 'lettering'; name: string; content: Content | null; own: boolean }
export interface Signs {
  /** Shows `content` on a sign; `null` puts back its own. */
  set(id: string, content: Content | null): void
  list(): Sign[]
}

/** The stand-in: the banner and one digital board, each a line at the top of the page while something is set on it. */
export function standInSigns(): Signs {
  const signs: Sign[] = [
    { id: 'banner', kind: 'banner', name: 'The banner a plane tows', content: null, own: true },
    { id: 'support', kind: 'digital', name: 'Support', content: null, own: true },
  ]
  const strip = document.createElement('div')
  strip.id = 'signs-stand-in'
  strip.setAttribute('aria-hidden', 'true')
  strip.style.cssText = 'position:fixed;left:50%;top:96px;transform:translateX(-50%);z-index:6;display:grid;gap:6px;justify-items:center;pointer-events:none;font:600 15px/1.2 "IBM Plex Mono",ui-monospace,monospace;letter-spacing:.06em;text-transform:uppercase'
  document.body.append(strip)
  const draw = () => {
    strip.replaceChildren()
    for (const s of signs) {
      if (s.own || !s.content) continue
      const line = document.createElement('div')
      line.dataset.sign = s.id
      line.style.cssText = s.kind === 'banner'
        ? 'padding:5px 14px;background:#f3ead8;color:#2a2219;border:1px solid #c9b996;box-shadow:0 2px 0 #0004'
        : 'padding:6px 12px;background:#050a07;color:#7dff9e;border:2px solid #1a2a1f;box-shadow:0 0 18px #2dff6a33;min-width:16ch;text-align:left'
      const c = s.content
      line.textContent = 'text' in c ? c.text : 'image' in c ? `[image ${c.image}]` : '▶ now playing'
      strip.append(line)
    }
  }
  return {
    set(id, content) { const s = signs.find((x) => x.id === id); if (!s) return; s.content = content; s.own = content === null; draw() },
    list: () => signs.map((s) => ({ ...s })),
  }
}
