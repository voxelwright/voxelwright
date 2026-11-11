// A sealed frame for code the home did not write (#42 props, #106 mechanics): an opaque origin,
// its own policy, no network. The frame loads a relay document the home's servers serve under
// that policy (vite.config.ts); the relay starts a worker from script text the page hands it.
// The two relays differ (src/props/relay.ts, src/invent/relay.ts); what they share is here.
// No imports: the servers read it too.

/**
 * A relay document's policy: its own nonced script and the blob worker it starts, nothing else, no network. `scriptExtra` adds script
 * sources. `sandbox` makes the origin opaque however the document is loaded: a site that opens the address in a tab of its own gets
 * no more than the home's frame does.
 */
export const sealedPolicy = (nonce: string, scriptExtra = '') => `sandbox allow-scripts; default-src 'none'; script-src 'nonce-${nonce}' blob:${scriptExtra}; worker-src blob:; frame-ancestors 'self'`
/** A relay document, its script carrying this response's nonce. */
export const sealedDocument = (nonce: string, relay: string) => `<!doctype html><meta charset="utf-8"><script nonce="${nonce}">${relay}</script>`

/** Frames `path` sealed and, once it loads, posts it the worker `source` with one end of a channel. Set `port.onmessage` at once. */
export function sealedFrame(path: string, source: string) {
  const frame = document.createElement('iframe')
  frame.setAttribute('sandbox', 'allow-scripts')
  frame.setAttribute('referrerpolicy', 'no-referrer')
  frame.style.display = 'none'
  // A document of its own, not srcdoc: a srcdoc frame inherits the home's policy, which (rightly) refuses inline scripts and blob workers.
  frame.src = path
  const { port1, port2 } = new MessageChannel()
  // The frame's origin is opaque, so there is no origin to name; the message carries only the port and the public worker script.
  frame.addEventListener('load', () => frame.contentWindow?.postMessage({ type: 'init', source }, '*', [port2]), { once: true })
  document.body.append(frame)
  return { frame, port: port1 }
}
