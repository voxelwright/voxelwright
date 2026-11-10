// Pairing for the checks (#85): the host keeps sessions, not tokens, so a check mints a
// one-time link the way `npm run village -- link` does and lets the page trade it.
import { cookieName, pairingStore, pairLink as linkFor } from '../../host/src/pairing.ts'

/** A new pairing code for `person` in the host's `root`, keeping their other devices paired. */
export const mintCode = (root, person = 'alex') => pairingStore(root).mint(person, { keep: true })

/** `url` with a new pairing link's fragment for `person`. */
export const pairLink = async (url, root, person = 'alex') => linkFor(url.split('#')[0], await mintCode(root, person))

/** A session secret for requests from node, paired through `base` (the home's origin, ending in /). */
export async function pairSecret(base, root, person = 'alex') {
  const res = await fetch(`${base}villager/api/pair`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code: await mintCode(root, person) }) })
  const secret = new RegExp(`${cookieName(new URL(base).host)}=([0-9a-f]{64})`).exec(res.headers.get('set-cookie') ?? '')?.[1]
  if (!secret) throw new Error(`pairing ${person} failed: ${res.status}`)
  return secret
}

/** The Cookie header for a session secret of the home at `base`. */
export const sessionCookie = (secret, base) => ({ cookie: `${cookieName(new URL(base).host)}=${secret}` })
