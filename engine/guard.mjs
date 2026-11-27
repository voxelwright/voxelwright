// Who may ask a server on this machine for anything, and who may act on it: one place for the page server
// (serve.mjs) and the servers beside it (blocks/serve.mjs).

/** Whether a request names this server as this machine or as a machine of a tailnet (`tailscale serve`): a name someone else points at 127.0.0.1 is neither. */
export const tailnet = (name) => /^[a-z0-9-]+(?:\.[a-z0-9-]+)*\.ts\.net$/i.test(name)
export const named = (host) => { const name = String(host ?? '').replace(/:\d+$/, ''); return name === '127.0.0.1' || name === 'localhost' || tailnet(name) }
/** A page from somewhere else may not act here through the browser of someone who can reach this. */
export const foreign = (req) => !!req.headers.origin && URL.parse(req.headers.origin)?.host !== req.headers.host
