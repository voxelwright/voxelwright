// Local telemetry & feedback inbox (#64): persists gameplay session traces and user/playtest feedback
// bundles under ~/.village/engine/inbox/ (or --inbox DIR), keeping screenshots beside their JSON
// payloads so humans and multimodal agents can open them at full size.
//
// Endpoints (same-origin only):
//   POST /api/feedback   stores feedback/<id>.json (+ <id>.webp|.png if screenshot present) & index.jsonl
//   POST /api/session    stores sessions/<id>.json & index.jsonl
//   GET  /api/inbox      lists recent feedback and session summaries (?limit=50)
import { randomBytes } from 'node:crypto'
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export const DEFAULT_INBOX = join(homedir(), '.village', 'engine', 'inbox')
export const INBOX_BODY_MAX = 4 << 20 // 4 MiB

const cleanText = (v, max) => (typeof v === 'string' ? v.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, ' ').trim().slice(0, max) : '')

const stampId = (prefix) => {
  const iso = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z').replace('T', '-')
  return `${prefix}-${iso}-${randomBytes(3).toString('hex')}`
}

async function readJsonBody(req, limit = INBOX_BODY_MAX) {
  const parts = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > limit) return { status: 413, error: 'payload too large' }
    parts.push(chunk)
  }
  let parsed
  try { parsed = JSON.parse(Buffer.concat(parts).toString('utf8')) } catch { return { status: 400, error: 'not JSON' } }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { status: 400, error: 'body must be a JSON object' }
  return { status: 200, body: parsed }
}

/** Extracts a base64 WebP or PNG data URL into raw bytes + extension. */
function decodeScreenshot(raw) {
  if (typeof raw !== 'string') return null
  const m = /^data:image\/(webp|png);base64,([A-Za-z0-9+/=]+)$/.exec(raw)
  if (!m) return null
  const bytes = Buffer.from(m[2], 'base64')
  if (bytes.length < 32 || bytes.length > 3 << 20) return null
  return { ext: m[1] === 'webp' ? '.webp' : '.png', bytes }
}

/** Saves one feedback bundle (and extracted screenshot file) under `<inboxDir>/feedback/`. */
export async function saveFeedback(inboxDir, body, meta = {}) {
  const dir = join(inboxDir, 'feedback')
  await mkdir(dir, { recursive: true })
  const id = stampId('fb')
  const receivedAt = new Date().toISOString()
  const message = cleanText(body?.feedback?.message ?? body?.message, 2000)
  if (!message) throw Object.assign(new Error('feedback message is required'), { status: 400 })

  const shot = decodeScreenshot(body.screenshot)
  let screenshotFile = null
  if (shot) {
    screenshotFile = `${id}${shot.ext}`
    await writeFile(join(dir, screenshotFile), shot.bytes)
  }

  const stored = {
    ...body,
    id,
    receivedAt,
    feedback: {
      ...(body.feedback && typeof body.feedback === 'object' ? body.feedback : {}),
      message,
      category: cleanText(body?.feedback?.category, 40) || undefined,
    },
    ...(screenshotFile ? { screenshotFile } : {}),
    screenshot: undefined, // kept on disk as image file, not duplicated inline in JSON
    ...(meta.userAgent ? { serverMeta: { userAgent: cleanText(meta.userAgent, 200) } } : {}),
  }
  delete stored.screenshot

  const jsonPath = join(dir, `${id}.json`)
  await writeFile(jsonPath, JSON.stringify(stored, null, 2))

  const indexEntry = {
    id,
    kind: 'feedback',
    receivedAt,
    sessionId: cleanText(body.sessionId, 64),
    message: message.slice(0, 240),
    category: stored.feedback.category ?? null,
    file: join('feedback', `${id}.json`),
    screenshot: screenshotFile ? join('feedback', screenshotFile) : null,
    anomalies: Array.isArray(body.anomalies) ? body.anomalies.length : 0,
    tile: cleanText(body?.pick?.geo?.tile, 40) || null,
    street: cleanText(body?.pick?.geo?.street, 100) || null,
  }
  await appendFile(join(dir, 'index.jsonl'), JSON.stringify(indexEntry) + '\n')
  return { id, path: jsonPath, screenshotPath: screenshotFile ? join(dir, screenshotFile) : null, indexEntry }
}

/** Saves one play session black-box trace under `<inboxDir>/sessions/`. */
export async function saveSession(inboxDir, body, meta = {}) {
  const dir = join(inboxDir, 'sessions')
  await mkdir(dir, { recursive: true })
  const id = stampId('sess')
  const receivedAt = new Date().toISOString()

  const stored = {
    ...body,
    id,
    receivedAt,
    ...(meta.userAgent ? { serverMeta: { userAgent: cleanText(meta.userAgent, 200) } } : {}),
  }
  const jsonPath = join(dir, `${id}.json`)
  await writeFile(jsonPath, JSON.stringify(stored, null, 2))

  const anomalies = Array.isArray(body.anomalies) ? body.anomalies : []
  const indexEntry = {
    id,
    kind: 'session',
    receivedAt,
    sessionId: cleanText(body.sessionId, 64),
    reason: cleanText(body.reason, 40) || 'session',
    file: join('sessions', `${id}.json`),
    durationS: Number(body?.summary?.durationS ?? 0),
    frames: Number(body?.summary?.frames ?? 0),
    fpsP50: Number(body?.summary?.fpsP50 ?? 0),
    anomalies: anomalies.length,
    critical: Number(body?.summary?.criticalCount ?? 0),
    high: Number(body?.summary?.highCount ?? 0),
  }
  await appendFile(join(dir, 'index.jsonl'), JSON.stringify(indexEntry) + '\n')
  return { id, path: jsonPath, anomalies: anomalies.length, indexEntry }
}

/** Reads recent feedback and session index entries from `<inboxDir>`. */
export function listInbox(inboxDir, { limit = 50 } = {}) {
  const readIdx = (sub) => {
    const file = join(inboxDir, sub, 'index.jsonl')
    if (!existsSync(file)) return []
    try {
      return readFileSync(file, 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((l) => { try { return JSON.parse(l) } catch { return null } })
        .filter(Boolean)
    } catch {
      return []
    }
  }
  const feedback = readIdx('feedback').reverse().slice(0, limit)
  const sessions = readIdx('sessions').reverse().slice(0, limit)
  return { inbox: inboxDir, feedback, sessions }
}

/**
 * Returns an HTTP request handler for `/api/feedback`, `/api/session`, and `/api/inbox`.
 * Returns `true` if it handled the request, `false` otherwise.
 */
export function createInboxRoutes(inboxDir, { send, foreign }) {
  return (req, res, url) => {
    const path = url.pathname
    if (path !== '/api/feedback' && path !== '/api/session' && path !== '/api/inbox') return false
    if (foreign && foreign(req)) {
      send(res, 403, 'not from another site')
      return true
    }
    if (path === '/api/inbox') {
      if (req.method !== 'GET') { send(res, 405, 'GET'); return true }
      const limit = Math.max(1, Math.min(200, Number(url.searchParams.get('limit') ?? 50) || 50))
      send(res, 200, JSON.stringify(listInbox(inboxDir, { limit })), 'application/json')
      return true
    }
    if (req.method !== 'POST') {
      send(res, 405, 'POST')
      return true
    }
    void (async () => {
      const read = await readJsonBody(req)
      if (read.status !== 200) return send(res, read.status, JSON.stringify({ error: read.error }), 'application/json')
      const meta = { userAgent: req.headers['user-agent'] }
      if (path === '/api/feedback') {
        const saved = await saveFeedback(inboxDir, read.body, meta)
        console.log(`feedback ${saved.id}: "${saved.indexEntry.message.slice(0, 80)}" (${saved.indexEntry.anomalies} anomalies)`)
        return send(res, 201, JSON.stringify({ ok: true, id: saved.id, file: saved.indexEntry.file, screenshot: saved.indexEntry.screenshot }), 'application/json')
      }
      const saved = await saveSession(inboxDir, read.body, meta)
      console.log(`session ${saved.id}: ${saved.indexEntry.durationS}s, ${saved.anomalies} anomalies (${saved.indexEntry.reason})`)
      return send(res, 201, JSON.stringify({ ok: true, id: saved.id, file: saved.indexEntry.file, anomalies: saved.anomalies }), 'application/json')
    })().catch((e) => {
      const code = typeof e?.status === 'number' ? e.status : 500
      if (!res.headersSent) send(res, code, JSON.stringify({ error: String(e?.message ?? e).slice(0, 200) }), 'application/json')
    })
    return true
  }
}

/** Reads a stored JSON bundle by path (helper shared by scan.mjs and replay.mjs). */
export async function readBundle(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'))
}
