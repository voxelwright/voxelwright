// The page that holds the realm in a frame (#450): what the realm tells it and what it may ask, as the landing's and
// the player's pages do (landing/index.html, player/index.html): messages with `village: 'realm'` and a `type`.
//
//   realm to host   ready { boards, signs }       the place is shown; what boards there are, and what signs can be set
//                   error { message, fatal? }     the realm could not open (or, with fatal false, an ask was refused)
//                   navigate { board, name, to }  a board was opened: the host goes to `to`
//   host to realm   fly { board }                 fly the eye to a board
//                   open { board }                fly to it, then navigate
//                   signs.set { id, content }     realm.signs.set, with { text }, { image: url } or null
//
// A realm run as a page of its own has no host: nothing is sent, and a board opened takes the page there itself.

export const embedded = typeof window !== 'undefined' && window.parent !== window
export const tell = (type: 'ready' | 'error' | 'navigate', more: Record<string, unknown> = {}) => { if (embedded) window.parent.postMessage({ village: 'realm', type, ...more }, '*') }
/** What the host asks: only the page that holds this one is heard. */
export const hear = (each: (message: { type?: unknown; [key: string]: unknown }) => void) => addEventListener('message', (e) => { if (e.source === window.parent && e.data && e.data.village === 'realm') each(e.data) })
