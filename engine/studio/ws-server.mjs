// Minimal, zero-dependency RFC 6455 WebSocket server over node:http upgrades (#98).
// Supports text and binary frames, fragmented messages, 16-bit and 64-bit payload lengths,
// ping/pong heartbeats, clean close handshakes, and bounded frame size.
import { createHash } from 'node:crypto'

const WS_MAGIC = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11'
const MAX_FRAME_BYTES = 16 << 20 // 16 MiB

function encodeFrame(opcode, payload) {
  const data = typeof payload === 'string' ? Buffer.from(payload, 'utf8') : Buffer.isBuffer(payload) ? payload : Buffer.from(payload)
  const len = data.length
  let header
  if (len < 126) {
    header = Buffer.allocUnsafe(2)
    header[0] = 0x80 | (opcode & 0x0f)
    header[1] = len
  } else if (len < 65536) {
    header = Buffer.allocUnsafe(4)
    header[0] = 0x80 | (opcode & 0x0f)
    header[1] = 126
    header.writeUInt16BE(len, 2)
  } else {
    header = Buffer.allocUnsafe(10)
    header[0] = 0x80 | (opcode & 0x0f)
    header[1] = 127
    header.writeBigUInt64BE(BigInt(len), 2)
  }
  return Buffer.concat([header, data])
}

export class StudioWebSocket {
  #socket
  #buf = Buffer.alloc(0)
  #fragOpcode = null
  #fragChunks = []
  #closed = false
  #listeners = { message: new Set(), close: new Set(), error: new Set(), pong: new Set() }
  #pingTimer = null

  constructor(socket, head = Buffer.alloc(0), { pingMs = 20_000 } = {}) {
    this.#socket = socket
    socket.setNoDelay(true)
    if (head.length) this.#onData(head)
    socket.on('data', (chunk) => this.#onData(chunk))
    socket.on('close', () => this.#finish(1006, ''))
    socket.on('error', (err) => {
      for (const fn of this.#listeners.error) fn(err)
      this.#finish(1006, err.message)
    })
    if (pingMs > 0) {
      this.#pingTimer = setInterval(() => {
        if (!this.#closed) this.ping()
      }, pingMs)
      this.#pingTimer.unref?.()
    }
  }

  get open() { return !this.#closed && !this.#socket.destroyed }

  on(event, fn) {
    this.#listeners[event]?.add(fn)
    return () => this.#listeners[event]?.delete(fn)
  }

  send(data) {
    if (!this.open) return false
    const opcode = typeof data === 'string' ? 0x1 : 0x2
    this.#socket.write(encodeFrame(opcode, data))
    return true
  }

  sendJson(value) {
    return this.send(JSON.stringify(value))
  }

  ping(data = Buffer.alloc(0)) {
    if (!this.open) return
    this.#socket.write(encodeFrame(0x9, data))
  }

  close(code = 1000, reason = '') {
    if (this.#closed) return
    const msg = Buffer.from(String(reason).slice(0, 120), 'utf8')
    const body = Buffer.allocUnsafe(2 + msg.length)
    body.writeUInt16BE(code, 0)
    msg.copy(body, 2)
    try { this.#socket.write(encodeFrame(0x8, body)) } catch { /* ignore */ }
    try { this.#socket.end() } catch { /* ignore */ }
    this.#finish(code, reason)
  }

  #finish(code, reason) {
    if (this.#closed) return
    this.#closed = true
    if (this.#pingTimer) { clearInterval(this.#pingTimer); this.#pingTimer = null }
    for (const fn of this.#listeners.close) fn({ code, reason })
  }

  #onData(chunk) {
    this.#buf = this.#buf.length ? Buffer.concat([this.#buf, chunk]) : chunk
    while (this.#buf.length >= 2 && !this.#closed) {
      const b0 = this.#buf[0], b1 = this.#buf[1]
      const fin = (b0 & 0x80) !== 0
      const opcode = b0 & 0x0f
      const masked = (b1 & 0x80) !== 0
      let len = b1 & 0x7f
      let offset = 2
      if (len === 126) {
        if (this.#buf.length < 4) return
        len = this.#buf.readUInt16BE(2)
        offset = 4
      } else if (len === 127) {
        if (this.#buf.length < 10) return
        const big = this.#buf.readBigUInt64BE(2)
        if (big > BigInt(MAX_FRAME_BYTES)) { this.close(1009, 'message too large'); return }
        len = Number(big)
        offset = 10
      }
      if (len > MAX_FRAME_BYTES) { this.close(1009, 'message too large'); return }
      const total = offset + (masked ? 4 : 0) + len
      if (this.#buf.length < total) return
      let payload
      if (masked) {
        const mask = this.#buf.subarray(offset, offset + 4)
        payload = Buffer.allocUnsafe(len)
        const src = this.#buf.subarray(offset + 4, total)
        for (let i = 0; i < len; i++) payload[i] = src[i] ^ mask[i & 3]
      } else {
        payload = Buffer.from(this.#buf.subarray(offset, total))
      }
      this.#buf = this.#buf.subarray(total)
      this.#handleFrame(fin, opcode, payload)
    }
  }

  #handleFrame(fin, opcode, payload) {
    if (opcode === 0x8) {
      const code = payload.length >= 2 ? payload.readUInt16BE(0) : 1000
      const reason = payload.length > 2 ? payload.subarray(2).toString('utf8') : ''
      this.close(code, reason)
      return
    }
    if (opcode === 0x9) {
      if (this.open) this.#socket.write(encodeFrame(0xa, payload))
      return
    }
    if (opcode === 0xa) {
      for (const fn of this.#listeners.pong) fn(payload)
      return
    }
    if (opcode === 0x0) {
      if (this.#fragOpcode === null) { this.close(1002, 'unexpected continuation'); return }
      this.#fragChunks.push(payload)
      if (!fin) return
      const full = Buffer.concat(this.#fragChunks)
      const kind = this.#fragOpcode
      this.#fragOpcode = null
      this.#fragChunks = []
      this.#deliver(kind, full)
      return
    }
    if (opcode === 0x1 || opcode === 0x2) {
      if (!fin) {
        this.#fragOpcode = opcode
        this.#fragChunks = [payload]
        return
      }
      this.#deliver(opcode, payload)
    }
  }

  #deliver(opcode, payload) {
    const out = opcode === 0x1 ? payload.toString('utf8') : payload
    for (const fn of this.#listeners.message) fn(out, opcode === 0x2)
  }
}

/** Completes an HTTP->WebSocket upgrade handshake and returns a StudioWebSocket, or null if invalid. */
export function acceptWebSocket(req, socket, head, options = {}) {
  const key = req.headers['sec-websocket-key']
  const upgrade = String(req.headers.upgrade ?? '').toLowerCase()
  if (upgrade !== 'websocket' || typeof key !== 'string' || !key.trim()) {
    socket.write('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n')
    socket.destroy()
    return null
  }
  const accept = createHash('sha1').update(key.trim() + WS_MAGIC).digest('base64')
  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\n' +
    'Upgrade: websocket\r\n' +
    'Connection: Upgrade\r\n' +
    `Sec-WebSocket-Accept: ${accept}\r\n\r\n`,
  )
  return new StudioWebSocket(socket, head, options)
}

/** Rejects an HTTP upgrade with a clean status line. */
export function rejectUpgrade(socket, status = 403, text = 'Forbidden') {
  socket.write(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`)
  socket.destroy()
}
