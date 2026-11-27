// What test/launch-perf/host.mjs has every worker import first (#83): when the worker's own script began, how long
// its core took to come (as the page asks for it, or with `SPLIT` in three parts: the bytes, the compile, the
// instance), each thing it fetched, when it first answered, and what its core's memory holds every two seconds.
// Said to the page on a BroadcastChannel, which no handler of the page's or the worker's listens to. Times are ms
// since 1970, as page-probe.js's are.
const SPLIT = /*SPLIT*/false
const abs = () => performance.timeOrigin + performance.now()
const who = `${location.pathname.split('/').pop()}#${Math.random().toString(36).slice(2, 7)}`
const channel = new BroadcastChannel('__launch')
const say = (what, more) => channel.postMessage({ who, what, at: abs(), ...more })
say('began', { origin: performance.timeOrigin })

const cores = []
const W = WebAssembly, streaming = W.instantiateStreaming.bind(W), Instance = W.Instance
W.instantiateStreaming = async (source, imports) => {
  const start = abs()
  if (!SPLIT) {
    const got = await streaming(source, imports)
    cores.push(got.instance)
    say('core', { kind: 'instantiateStreaming', start, end: abs() })
    return got
  }
  const answer = await source, bytes = await answer.arrayBuffer(), fetched = abs()
  const module = await W.compile(bytes), compiled = abs()
  const instance = new Instance(module, imports)
  cores.push(instance)
  say('core', { kind: 'split', start, fetched, compiled, end: abs(), bytes: bytes.byteLength })
  return { module, instance }
}
// A core made from a module the page compiled once and sent (the prototype, bay.ts `open`).
W.Instance = function (module, imports) { const start = abs(); const made = new Instance(module, imports); cores.push(made); say('core', { kind: 'instance', start, end: abs() }); return made }
W.Instance.prototype = Instance.prototype

const get = self.fetch.bind(self)
self.fetch = async (...a) => {
  const start = abs(), url = String(a[0]?.url ?? a[0]).replace(location.origin, '')
  try { return await get(...a) } finally { say('fetch', { url, start, end: abs() }) }
}
const post = self.postMessage.bind(self)
let answered = 0
self.postMessage = (...a) => { if (!answered++) say('first answer'); return post(...a) }
setInterval(() => say('memory', { wasm: cores.reduce((n, c) => n + (c.exports.memory?.buffer.byteLength ?? 0), 0), heap: performance.memory?.usedJSHeapSize ?? null, answered }), 2000)
