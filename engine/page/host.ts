// The page that holds the realm in a frame (#450): what the realm tells it and what it may ask, as the landing's and
// the player's pages do (landing/index.html, player/index.html): messages with `village: 'realm'` and a `type`.
//
//   realm to host   ready { boards, signs }       the place is shown; what boards there are, and what signs can be set
//                   error { message, fatal? }     the realm could not open (or, with fatal false, an ask was refused)
//                   navigate { board, name, to }  a board was opened: the host goes to `to`
//                   engaged {}                    the visitor is in the realm: its controls are shown (first.ts)
//                   back {}                       the visitor is going back to the first view: its controls are hidden, and the eye
//                                                 is on its way there (first.ts, explore.ts `back`); `explore` meanwhile goes once it is there
//   host to realm   fly { board }                 fly the eye to a board
//                   open { board }                fly to it, then navigate
//                   signs.set { id, content }     realm.signs.set, with { text }, { image: url } or null
//                   explore {}                    take the visitor into the realm, as the EXPLORE board asked twice does (explore.ts): the
//                                                 host's word is meant, and is not asked again. Heard from when the realm's script
//                                                 first runs (by the frame's `load` it has), and kept until it can be done
//
// A realm run as a page of its own has no host: nothing is sent, and a board opened takes the page there itself.

// Only a host on an origin this realm trusts is heard or told (#81): this site itself, zahynailo.dev, and on a page
// served from this machine, this machine's own pages on any port. Anything else framing the realm is neither heard
// nor told what it does.

export const embedded = typeof window !== 'undefined' && window.parent !== window
const LOOPBACK = /^(127\.0\.0\.1|localhost|\[::1\])$/
/** The origins a host may be on, for a realm whose own address is `here`. */
export function allowed(origin: string, here: { origin: string; hostname: string }): boolean {
  if (!origin || origin === 'null') return false
  if (origin === here.origin || origin === 'https://zahynailo.dev') return true
  if (!LOOPBACK.test(here.hostname)) return false
  try { const u = new URL(origin); return u.protocol === 'http:' && LOOPBACK.test(u.hostname) && u.origin === origin } catch { return false }
}
/** The page that holds this one's origin, where it is one this realm trusts: from the browser's own list of them, or the address it came from. */
const parentOrigin = (): string | null => {
  if (!embedded) return null
  const here = { origin: location.origin, hostname: location.hostname }
  const listed = (location as Location & { ancestorOrigins?: DOMStringList }).ancestorOrigins?.[0]
  if (listed) return allowed(listed, here) ? listed : null
  try { const from = document.referrer && new URL(document.referrer).origin; if (from && allowed(from, here)) return from } catch { /* no address */ }
  return null
}
let host = parentOrigin()
/** What was to be told before the host's origin was known (a browser that says neither): told once a trusted host speaks. A few at most. */
const owed: Record<string, unknown>[] = []
export const tell = (type: 'ready' | 'error' | 'navigate' | 'engaged' | 'back', more: Record<string, unknown> = {}) => {
  if (!embedded) return
  const message = { village: 'realm', type, ...more }
  if (host) window.parent.postMessage(message, host)
  else if (owed.length < 16) owed.push(message)
}
/** What the host asks: only the page that holds this one is heard, and only from an origin this realm trusts. */
export const hear = (each: (message: { type?: unknown; [key: string]: unknown }) => void) => addEventListener('message', (e) => {
  if (e.source !== window.parent || !e.data || e.data.village !== 'realm') return
  if (host ? e.origin !== host : !allowed(e.origin, { origin: location.origin, hostname: location.hostname })) return
  if (!host) { host = e.origin; for (const m of owed.splice(0)) window.parent.postMessage(m, host) }
  each(e.data)
})
