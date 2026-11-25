// Does this platform's prebuilt node-datachannel load, gather a srflx candidate
// and open a channel to itself? Prints platform, versions and timings only.
import ndc from 'node-datachannel';
import { RTCPeerConnection } from 'node-datachannel/polyfill';
import { lookup } from 'node:dns/promises';
import * as L from './lib/rtc-load.mjs';

const g = (await lookup('stun.l.google.com', { family: 4 })).address;
const cfg = { iceServers: [{ urls: `stun:${g}:19302` }] };
const c = await L.clientOffer(RTCPeerConnection, cfg);
const h = await L.hostAnswer(RTCPeerConnection, c.offer, cfg);
const r = await L.clientConnect(c, h.answer);
console.log(JSON.stringify({ platform: `${process.platform}-${process.arch}`, node: process.version, libdatachannel: ndc.getLibraryVersion?.(), gatherMs: c.gatherMs, gatherComplete: c.gatherComplete, offerCandidates: c.offerCandidates, open: r.open, openMs: r.openMs }));
c.pc.close(); h.pc.close();
setTimeout(() => process.exit(r.open ? 0 : 1), 300);
