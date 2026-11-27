// VXPK release pack reader (#82): fetches a packed bundle once, decodes its JSON directory, and hands out member
// slices. Callers fall back to fetching individual release objects whenever packing is disabled (`?packs=0`),
// unconfigured, or a pack cannot be read.
//
// Binary layout ("VXPK"):
//   [0..4]    "VXPK" (4 ASCII bytes)
//   [4..8]    u32 little-endian: byte length L of the UTF-8 JSON directory
//   [8..8+L]  JSON object mapping relative member path -> [byteOffset, byteLength]
//   [8+L..]   concatenated raw member payloads

export interface PackConfig {
  /** Base folder relative to the release manifest (default "packs/"). */
  dir?: string
  /** Single pack holding all landing cut .far tiles (e.g. "packs/landing.pack"). */
  landing?: string
  /** Band-0 far tiles grouped in squares x squares tiles (e.g. 4 = 2 km). */
  far0?: number
  /** Single pack holding cars/index.json and all cars/<id>.json objects. */
  cars?: string
  /** Single pack holding life/index.json and life/transit.json. */
  lifeMeta?: string
  /** Street life squares grouped in km x km UTM squares (e.g. 4 = 4 km). */
  life?: number
  /** Street names squares grouped in km x km UTM squares (e.g. 4 = 4 km). */
  names?: number
}

const query = new URLSearchParams(globalThis.location?.search ?? '')
/** `?packs=0` disables reading release packs so callers fetch individual objects directly. */
export const PACKS_ENABLED = query.get('packs') !== '0'

const decoder = new TextDecoder()
const packCache = new Map<string, Promise<Map<string, Uint8Array<ArrayBuffer>> | null>>()
const MAX_CACHED_PACKS = 24

/** Decodes a VXPK binary buffer into a map of member path -> byte view. Throws on malformed input. */
export function unpack(bytes: Uint8Array<ArrayBuffer>): Map<string, Uint8Array<ArrayBuffer>> {
  if (bytes.byteLength < 8 || bytes[0] !== 0x56 || bytes[1] !== 0x58 || bytes[2] !== 0x50 || bytes[3] !== 0x4b) {
    throw new Error('not a VXPK pack')
  }
  const headLen = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(4, true)
  const from = 8 + headLen
  if (from > bytes.byteLength) throw new Error('VXPK header truncated')
  const dir = JSON.parse(decoder.decode(bytes.subarray(8, from))) as Record<string, [number, number]>
  const out = new Map<string, Uint8Array<ArrayBuffer>>()
  for (const [name, entry] of Object.entries(dir)) {
    if (!Array.isArray(entry) || entry.length !== 2) continue
    const [offset, length] = entry
    if (offset < 0 || length < 0 || from + offset + length > bytes.byteLength) throw new Error(`VXPK member out of range: ${name}`)
    out.set(name, bytes.subarray(from + offset, from + offset + length))
  }
  return out
}

/** Fetches and caches a pack by URL (bounded LRU; evicted packs remain in browser/SW cache). Returns null on error. */
export function fetchPack(url: string): Promise<Map<string, Uint8Array<ArrayBuffer>> | null> {
  if (!PACKS_ENABLED) return Promise.resolve(null)
  let p = packCache.get(url)
  if (p) {
    // Refresh LRU order.
    packCache.delete(url)
    packCache.set(url, p)
    return p
  }
  p = fetch(url).then(async (r) => {
    if (!r.ok) return null
    const bytes = new Uint8Array(await r.arrayBuffer())
    return unpack(bytes)
  }).catch(() => null)
  packCache.set(url, p)
  p.then((m) => { if (!m && packCache.get(url) === p) packCache.delete(url) })
  if (packCache.size > MAX_CACHED_PACKS) {
    const oldest = packCache.keys().next().value
    if (oldest !== undefined) packCache.delete(oldest)
  }
  return p
}

/** Reads one member's bytes (copied so callers can transfer/mutate safely) from a pack URL, or null on miss/failure. */
export async function readPackedBytes(packUrl: string, member: string): Promise<Uint8Array<ArrayBuffer> | null> {
  const m = await fetchPack(packUrl)
  const slice = m?.get(member)
  return slice ? slice.slice() : null
}

/** Reads and parses one JSON member from a pack URL, or null on miss/failure. */
export async function readPackedJson<T>(packUrl: string, member: string): Promise<T | null> {
  const m = await fetchPack(packUrl)
  const slice = m?.get(member)
  if (!slice) return null
  try { return JSON.parse(decoder.decode(slice)) as T } catch { return null }
}

/** UTM square pack name (`<prefix>-<gx>_<gz>.pack`) for a `<e>_<n>` square grouped into `km` km squares. */
export function squarePackName(prefix: string, square: string, km: number): string | null {
  const parts = square.split('_')
  if (parts.length !== 2) return null
  const e = Number(parts[0]), n = Number(parts[1])
  if (!Number.isFinite(e) || !Number.isFinite(n)) return null
  return `${prefix}-${Math.floor(e / km)}_${Math.floor(n / km)}.pack`
}
