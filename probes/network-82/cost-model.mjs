// SPIKE PROTOTYPE (#82, network optimizations). Not a check, not part of `npm run check`.
//
// What a month of visitors costs on Cloudflare, by how the release is delivered. A MODEL: the requests a visitor makes
// are measured (measure.mjs), the prices are Cloudflare's published ones (read November 26, 2026), the rest is
// arithmetic. Nothing here was billed.
//
//   node probes/network-82/cost-model.mjs [--bounce 240] [--explore 1100] [--explorers 0.3] [--after-bounce 60] [--after-explore 250] [--cpu 1]
//
// Prices:
//   Workers  https://developers.cloudflare.com/workers/platform/pricing/
//            Free: 100,000 requests a day. Standard: $5 a month, 10 million requests a month included, $0.30 a million
//            after; 30 million CPU ms included, $0.02 a million after. "Requests to static assets are free and
//            unlimited." "Since Cloudflare Workers runs before the Cloudflare cache, the caching of a request still incurs costs."
//   R2       https://developers.cloudflare.com/r2/pricing/
//            $0.015 a GB-month, Class B (GetObject) $0.36 a million, egress free; free each month: 10 GB, 10 million Class B.
const arg = (name, fallback) => { const at = process.argv.indexOf(`--${name}`); return Number(at > 0 ? process.argv[at + 1] : fallback) }
// Worker-first requests one visitor makes on a cold cache (measure.mjs, live): a landing that leaves, and one that
// goes on to explore. `explorers` is the share who explore: an assumption, not a measurement.
const now = { bounce: arg('bounce', 240), explore: arg('explore', 1100) }
// The same after packing, deduplication and a nearer far radius (the phases' estimate), still through the Worker.
const after = { bounce: arg('after-bounce', 60), explore: arg('after-explore', 250) }
const explorers = arg('explorers', 0.3), cpuMs = arg('cpu', 1), GB = arg('gb', 0.9)
const per = (p) => p.bounce * (1 - explorers) + p.explore * explorers

const usd = (n) => (n === 0 ? '$0' : n < 10 ? `$${n.toFixed(2)}` : `$${Math.round(n).toLocaleString('en-US')}`)
const M = 1e6, DAYS = 30
/** Workers Standard for a month of `requests`, each `cpuMs` of CPU. */
const workersPaid = (requests) => 5 + (Math.max(0, requests - 10 * M) / M) * 0.3 + (Math.max(0, requests * cpuMs - 30 * M) / M) * 0.02
/** R2 behind its custom domain: only what the edge cache misses reaches the bucket (a Class B read). */
const r2 = (requests, hit) => Math.max(0, GB - 10) * 0.015 + (Math.max(0, requests * (1 - hit) - 10 * M) / M) * 0.36

console.log(`a visitor's Worker-first requests: now ${now.bounce} (lands and leaves) / ${now.explore} (explores); after phases 1-2 ${after.bounce} / ${after.explore}; ${explorers * 100}% explore (assumed) => ${Math.round(per(now))} now, ${Math.round(per(after))} after`)
console.log(`Workers Free carries ${Math.floor(100_000 / per(now)).toLocaleString('en-US')} visitors a day now, ${Math.floor(100_000 / per(after)).toLocaleString('en-US')} after phases 1-2; past that the city stops loading until the daily reset`)
const rows = [1_000, 10_000, 100_000, 1_000_000].map((daily) => {
  const reqNow = daily * DAYS * per(now), reqAfter = daily * DAYS * per(after), weather = daily * DAYS
  return {
    'visitors/day': daily.toLocaleString('en-US'),
    'Worker req/month now': `${(reqNow / M).toFixed(1)} M`,
    'now, Free': daily * per(now) <= 100_000 ? '$0' : 'over the cap',
    'now, Workers Paid': usd(workersPaid(reqNow)),
    'phases 1-2, Free': daily * per(after) <= 100_000 ? '$0' : 'over the cap',
    'phases 1-2, Paid': usd(workersPaid(reqAfter)),
    'static assets only (weather alone runs code)': daily <= 100_000 ? '$0' : usd(workersPaid(weather)),
    'R2 domain, edge hits 0%': usd(r2(reqAfter, 0)),
    'R2 domain, edge hits 95%': usd(r2(reqAfter, 0.95)),
  }
})
console.table(rows)
console.log(`(per day: divide by ${DAYS}. CPU: ${cpuMs} ms a request assumed. R2 holds ${GB} GB, inside its free 10 GB. "Edge hits" is the share of requests Cloudflare's cache answers without reading the bucket; the docs do not say a hit is free of a Class B read, it follows from the bucket not being asked.)`)
