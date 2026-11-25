// The door's wire (#526), one copy for both ends: engine/door.mjs on node-datachannel's polyfill, and door.ts in the
// browser (the lobby-transport skill: the same code on the W3C API at both ends).

export const PROTO = 1
/** The most one data channel message carries, a stream's four-byte number among them: what both ends take (`maxMessageSize`), and never over 64 KiB, libdatachannel's own default. */
export const CHUNK = 64 << 10
/** The least: a peer whose `maxMessageSize` is under this is refused, or every frame would go a few bytes at a time. */
export const CHUNK_LEAST = 16 << 10
/** What a page signs to say who it is: these words and the DTLS fingerprint of the connection it is on, so a signature is good on that one connection alone. */
export const signed = (fingerprint: string) => `village-door-1 ${fingerprint.toUpperCase()}`
/** A connection's DTLS fingerprint, as its SDP says it. */
export const fingerprintOf = (sdp: string): string | null => /a=fingerprint:sha-256 ([0-9A-Fa-f:]+)/.exec(sdp)?.[1]?.toUpperCase() ?? null

/**
 * The gathering deadline (lobby-transport skill): ICE gathering complete, or a server-reflexive candidate and 300 ms
 * of quiet after it, or 3 s. With no STUN server there is no server-reflexive candidate to wait for: 600 ms of quiet
 * after the last host candidate is enough.
 */
export function gathered(pc: RTCPeerConnection, stun: boolean): Promise<void> {
  if (pc.iceGatheringState === 'complete') return Promise.resolve()
  return new Promise((done) => {
    let srflx = false, quiet: ReturnType<typeof setTimeout> | undefined
    const end = () => { clearTimeout(cap); clearTimeout(quiet); done() }
    const cap = setTimeout(end, 3000)
    pc.addEventListener('icegatheringstatechange', () => { if (pc.iceGatheringState === 'complete') end() })
    pc.addEventListener('icecandidate', (e) => {
      if (!e.candidate) return end()
      if (/ typ srflx/.test(e.candidate.candidate)) srflx = true
      if (srflx || !stun) { clearTimeout(quiet); quiet = setTimeout(end, srflx ? 300 : 600) }
    })
  })
}
