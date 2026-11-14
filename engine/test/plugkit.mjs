// What a plugin's check needs (#264, plugins.mjs): the real server keeping one world in a file of its own, asked
// as anyone asks it, and the world's stream read as a page reads it. No browser: what a plugin's world side says
// to pages is frame 11 of the stream.
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { serve } from './kit.mjs'

export const wait = (ms) => new Promise((r) => setTimeout(r, ms))
/** Asks until something is so, or throws saying it never was. */
export const until = async (what, ask, ms = 8000) => { for (const began = Date.now(); Date.now() - began < ms; await wait(50)) { const v = await ask(); if (v) return v } throw new Error(`never: ${what}`) }

/** A server with a world of its own. `more` is further arguments for it (`--plugins dir` to look somewhere else). */
export async function world(more = []) {
  const file = join(mkdtempSync(join(tmpdir(), 'engine-plugin-')), 'world.log')
  let server = await serve('/dev/null', ['--world', file, ...more])
  const failures = []
  const check = (ok, what) => { console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) failures.push(what) }
  const send = async (path, init) => { for (;;) { const r = await fetch(`${server.url}${path}`, init); if (r.status === 429) { await wait(400); continue } return r.ok ? r.json() : { refused: r.status, why: await r.text() } } }
  const get = (path) => send(`/world/${path}`), post = (path, body) => send(`/world/${path}`, { method: 'POST', body: JSON.stringify(body) })
  /** What the world says to plugins' page sides from now on: every frame 11, as it comes. */
  const said = []
  const listen = async () => {
    const reader = (await fetch(`${server.url}/world/stream?from=0`)).body.getReader()
    let held = Buffer.alloc(0)
    for (;;) {
      const { done, value } = await reader.read().catch(() => ({ done: true }))
      if (done) return
      held = Buffer.concat([held, value])
      while (held.length >= 12 && held.length >= 12 + held.readUInt32LE(8)) {
        const size = held.readUInt32LE(8)
        if (held.readUInt32LE(0) === 11) said.push({ ...JSON.parse(held.subarray(12, 12 + size).toString('utf8')), t: performance.now() })
        held = held.subarray(12 + size)
      }
    }
  }
  void listen()
  // The world's process takes its plugins in as it starts: a check begins when they are in (or said not to be).
  const settled = () => until('the plugins are in', async () => (await send('/plugins')).plugins.every((p) => !p.world || p.does.length || p.error))
  await settled()
  return {
    get url() { return server.url }, file, check, failures, get, post, send, said,
    rule: (id, source) => post('ask', { by: 'tester', rule: { id, name: id, source } }),
    how: async (id) => (await get('rules')).find((r) => r.id === id),
    /** Tells the server to look at its plugins again. */
    look: () => send('/plugins/look', { method: 'POST' }),
    /** Stops the server and starts it again on the same world. */
    async again() { server.stop(); await wait(300); server = await serve('/dev/null', ['--world', file, ...more]); void listen(); await settled() },
    finish(name) { server.stop(); if (failures.length) { console.error(`FAILED\n  ${failures.join('\n  ')}`); process.exit(1) } console.log(`${name}: ok`); process.exit(0) },
  }
}
