// Unpacks a far-model tile off the page thread (#83): decodes the JSON header and transposes
// grouped 20-byte face columns into interleaved vertices without stalling frames during boot or flight.
const decoder = new TextDecoder()

self.onmessage = (e: MessageEvent<{ id: number; buf: ArrayBuffer }>) => {
  const { id, buf } = e.data
  try {
    const bytes = new Uint8Array(buf)
    const length = new DataView(buf).getUint32(4, true)
    const head = JSON.parse(decoder.decode(bytes.subarray(8, 8 + length))) as { grouped?: boolean }
    const raw = bytes.subarray(8 + length)
    if (head.grouped) {
      const n = raw.length / 20
      const flat = new Uint8Array(raw.length)
      for (let j = 0; j < 20; j++) {
        const from = j * n
        for (let i = 0; i < n; i++) flat[i * 20 + j] = raw[from + i]
      }
      self.postMessage({ id, head, buf: flat.buffer, offset: 0, length: flat.byteLength }, { transfer: [flat.buffer] })
    } else {
      self.postMessage({ id, head, buf, offset: 8 + length, length: raw.byteLength }, { transfer: [buf] })
    }
  } catch (err) {
    self.postMessage({ id, error: String((err as Error)?.message ?? err) })
  }
}
