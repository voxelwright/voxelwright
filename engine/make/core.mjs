// The engine's core (page/core.wasm) for what the maker asks of it with no page: whether a thing would stand
// (place.mjs `stands`) and how a body drives (drivable.mjs). It is handed in, so the same maker runs in Node and in a
// page: compiled once, and a fresh instance taken for each question.

/** Where the core is beside this folder: a file in Node, an address beside the page in a browser. */
export const CORE = new URL('../page/core.wasm', import.meta.url)
const made = new Map()
/**
 * The core compiled, from a module, its bytes, or where it is (a path or a URL: read from disk in Node each time, fetched
 * in a page and compiled once for each address).
 */
export function compiled(core = CORE) {
  if (core instanceof WebAssembly.Module) return Promise.resolve(core)
  if (core instanceof ArrayBuffer || ArrayBuffer.isView(core)) return WebAssembly.compile(core)
  const key = String(core)
  // A file is read again each time (a helper that runs for days judges by the core as it is built now); a page's address once.
  if (typeof process !== 'undefined' && process.versions?.node && !/^https?:/.test(key)) return import('node:fs/promises').then((fs) => fs.readFile(core)).then((b) => WebAssembly.compile(b))
  if (!made.has(key)) {
    const one = fetch(core).then((r) => { if (!r.ok) throw new Error(`the core could not be fetched (${r.status})`); return r.arrayBuffer() }).then((b) => WebAssembly.compile(b))
    made.set(key, one)
    one.catch(() => made.delete(key))
  }
  return made.get(key)
}
