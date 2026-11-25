// A visitor's own AI (#526, page/models.ts): each provider's request and the reading of its stream, against a
// stand-in for `fetch`. No provider is asked anything and no model is run: this proves what the page sends and how
// it reads what comes back, never that a provider takes it. That needs a real key.
//
//   node test/models.mjs
import assert from 'node:assert/strict'
import { ABOUT, AT, Unanswered, keep, kept, models, reply } from '../page/models.ts'

let steps = 0
const step = async (name, run) => { await run(); steps++; console.log(`ok  ${name}`) }
/** A stream of server-sent events, in pieces that cut lines in two as a network does. */
const sse = (events, status = 200) => {
  const text = events.map((e) => `event: x\ndata: ${typeof e === 'string' ? e : JSON.stringify(e)}\n\n`).join('')
  const bytes = new TextEncoder().encode(text), parts = []
  for (let at = 0; at < bytes.length; at += 37) parts.push(bytes.slice(at, at + 37))
  return new Response(new ReadableStream({ start(c) { for (const p of parts) c.enqueue(p); c.close() } }), { status, headers: { 'content-type': 'text/event-stream' } })
}
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
/** A `fetch` that keeps what it was asked and answers as told. */
const stand = (answer) => { const seen = []; const f = async (url, init = {}) => { seen.push({ url: String(url), headers: init.headers ?? {}, body: init.body ? JSON.parse(init.body) : null }); return answer() }; f.seen = seen; return f }
const Q = { system: 'the brief', prompt: 'a red telephone box', pictures: [{ type: 'image/png', data: 'AAAA' }] }
const KEY = 'sk-made-up-for-the-check'
const fails = async (run, why) => { try { await run() } catch (e) { assert.ok(e instanceof Unanswered, `threw ${e}`); assert.equal(e.why, why, e.message); assert.ok(!e.message.includes(KEY), 'the key is in what is shown'); return e } assert.fail(`was answered; wanted ${why}`) }

await step('anthropic: the request, and its stream read', async () => {
  const f = stand(() => sse([
    { type: 'message_start', message: { model: 'claude-opus-5-5', usage: { input_tokens: 900, cache_read_input_tokens: 100 } } },
    { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'not for the page' } },
    { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: '{"name": "a box", ' } },
    { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: '"size": [9, 24, 9]}' } },
    { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 42 } },
    { type: 'message_stop' },
  ]))
  const heard = []
  const r = await reply({ route: 'anthropic', key: KEY, model: 'claude-opus-5-5' }, Q, { fetch: f, each: (t) => heard.push(t) })
  assert.equal(r.text, '{"name": "a box", "size": [9, 24, 9]}')
  assert.deepEqual([r.model, r.cut, r.tokens], ['claude-opus-5-5', false, { in: 1000, out: 42 }])
  assert.equal(heard.length, 2)
  const [{ url, headers, body }] = f.seen
  assert.equal(url, 'https://api.anthropic.com/v1/messages')
  assert.equal(headers['x-api-key'], KEY)
  assert.equal(headers['anthropic-dangerous-direct-browser-access'], 'true')
  assert.equal(headers['anthropic-beta'], 'server-side-fallback-2026-07-01')
  assert.equal(body.fallbacks, 'default')
  assert.equal(body.system, 'the brief')
  assert.deepEqual(body.messages[0].content.map((b) => b.type), ['image', 'text'])
  assert.deepEqual(body.messages[0].content[0].source, { type: 'base64', media_type: 'image/png', data: 'AAAA' })
  // No tools, nothing to remember, no thinking set by hand (the newer models refuse that).
  assert.deepEqual(Object.keys(body).sort(), ['fallbacks', 'max_tokens', 'messages', 'model', 'stream', 'system'])
})

await step('anthropic: an older model is not told to fall back', async () => {
  const f = stand(() => sse([{ type: 'content_block_delta', delta: { type: 'text_delta', text: 'x' } }]))
  await reply({ route: 'anthropic', key: KEY, model: 'claude-haiku-5-5' }, Q, { fetch: f })
  assert.equal(f.seen[0].headers['anthropic-beta'], undefined)
  assert.equal(f.seen[0].body.fallbacks, undefined)
})

await step('anthropic: declined, cut short, and an error part way', async () => {
  await fails(() => reply({ route: 'anthropic', key: KEY, model: 'claude-opus-5-5' }, Q, { fetch: stand(() => sse([{ type: 'message_delta', delta: { stop_reason: 'refusal' }, usage: { output_tokens: 0 } }])) }), 'declined')
  const cut = await reply({ route: 'anthropic', key: KEY, model: 'claude-opus-5-5' }, Q, { fetch: stand(() => sse([{ type: 'content_block_delta', delta: { type: 'text_delta', text: '{"name": "half' } }, { type: 'message_delta', delta: { stop_reason: 'max_tokens' }, usage: { output_tokens: 32000 } }])) })
  assert.equal(cut.cut, true)
  await fails(() => reply({ route: 'anthropic', key: KEY, model: 'claude-opus-5-5' }, Q, { fetch: stand(() => sse([{ type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } }])) }), 'busy')
})

await step('openai and openrouter: the chat form, and its stream read', async () => {
  for (const [route, url] of [['openai', 'https://api.openai.com/v1/chat/completions'], ['openrouter', 'https://openrouter.ai/api/v1/chat/completions']]) {
    const f = stand(() => sse([
      { model: 'some-model-1', choices: [{ delta: { role: 'assistant', content: '' } }] },
      { choices: [{ delta: { content: '{"name": ' } }] },
      { choices: [{ delta: { content: '"a box"}' }, finish_reason: 'stop' }] },
      { choices: [], usage: { prompt_tokens: 700, completion_tokens: 30 } },
      '[DONE]',
    ]))
    const r = await reply({ route, key: KEY, model: 'some-model' }, Q, { fetch: f })
    assert.equal(r.text, '{"name": "a box"}')
    assert.deepEqual([r.model, r.cut, r.tokens], ['some-model-1', false, { in: 700, out: 30 }])
    const [{ headers, body }] = f.seen
    assert.equal(f.seen[0].url, url)
    assert.equal(headers.authorization, `Bearer ${KEY}`)
    assert.deepEqual(body.messages.map((m) => m.role), ['system', 'user'])
    assert.deepEqual(body.messages[1].content.map((b) => b.type), ['image_url', 'text'])
    assert.equal(body.messages[1].content[0].image_url.url, 'data:image/png;base64,AAAA')
    assert.equal(body.tools, undefined)
  }
  // With no picture the wish goes as plain words.
  const plain = stand(() => sse([{ choices: [{ delta: { content: 'x' } }] }]))
  await reply({ route: 'openai', key: KEY, model: 'm' }, { system: 's', prompt: 'p' }, { fetch: plain })
  assert.equal(plain.seen[0].body.messages[1].content, 'p')
  await fails(() => reply({ route: 'openai', key: KEY, model: 'm' }, Q, { fetch: stand(() => sse([{ choices: [{ delta: {}, finish_reason: 'content_filter' }] }])) }), 'declined')
})

await step('gemini: the request, thoughts left out, and what stops it', async () => {
  const f = stand(() => sse([
    { candidates: [{ content: { parts: [{ text: 'thinking aloud', thought: true }] } }] },
    { candidates: [{ content: { parts: [{ text: '{"name": "a box"}' }] }, finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 500, candidatesTokenCount: 20, thoughtsTokenCount: 80 }, modelVersion: 'gemini-x' },
  ]))
  const r = await reply({ route: 'gemini', key: KEY, model: 'gemini-x' }, Q, { fetch: f })
  assert.equal(r.text, '{"name": "a box"}')
  assert.deepEqual(r.tokens, { in: 500, out: 100 })
  const [{ url, headers, body }] = f.seen
  assert.equal(url, 'https://generativelanguage.googleapis.com/v1beta/models/gemini-x:streamGenerateContent?alt=sse')
  assert.equal(headers['x-goog-api-key'], KEY)
  assert.ok(!url.includes(KEY), 'the key is in the address')
  assert.equal(body.system_instruction.parts[0].text, 'the brief')
  assert.deepEqual(body.contents[0].parts[0], { inline_data: { mime_type: 'image/png', data: 'AAAA' } })
  await fails(() => reply({ route: 'gemini', key: KEY, model: 'gemini-x' }, Q, { fetch: stand(() => sse([{ promptFeedback: { blockReason: 'SAFETY' } }])) }), 'declined')
  await fails(() => reply({ route: 'gemini', key: KEY, model: 'gemini-x' }, Q, { fetch: stand(() => sse([{ candidates: [{ finishReason: 'SAFETY' }] }])) }), 'declined')
  // A model's name cannot take the request somewhere else.
  const odd = stand(() => sse([{ candidates: [{ content: { parts: [{ text: 'x' }] } }] }]))
  await reply({ route: 'gemini', key: KEY, model: '../../evil?x=' }, Q, { fetch: odd })
  assert.ok(odd.seen[0].url.startsWith('https://generativelanguage.googleapis.com/v1beta/models/..%2F..%2Fevil%3Fx%3D:'))
})

await step('a key goes only to its own provider', async () => {
  for (const route of Object.keys(AT)) {
    const f = stand(() => sse([{ type: 'content_block_delta', delta: { type: 'text_delta', text: 'x' } }, { choices: [{ delta: { content: 'x' } }] }, { candidates: [{ content: { parts: [{ text: 'x' }] } }] }]))
    await reply({ route, key: KEY, model: 'm' }, Q, { fetch: f })
    const l = stand(() => json({ data: [], models: [] }))
    await models(route, KEY, { fetch: l })
    for (const { url } of [...f.seen, ...l.seen]) { assert.equal(new URL(url).origin, AT[route]); assert.ok(!url.includes(KEY)) }
    assert.ok(new URL(ABOUT[route].keys).protocol === 'https:')
  }
})

await step('what a provider refuses is said in plain words, without the key', async () => {
  const c = { route: 'anthropic', key: KEY, model: 'claude-opus-5-5' }
  await fails(() => reply(c, Q, { fetch: stand(() => json({ type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } }, 401)) }), 'key')
  await fails(() => reply({ ...c, route: 'gemini' }, Q, { fetch: stand(() => json({ error: { code: 400, message: 'API key not valid. Please pass a valid API key.' } }, 400)) }), 'key')
  await fails(() => reply(c, Q, { fetch: stand(() => json({ error: { message: 'rate limited' } }, 429)) }), 'limit')
  await fails(() => reply({ ...c, route: 'openrouter' }, Q, { fetch: stand(() => json({ error: { message: 'Insufficient credits' } }, 402)) }), 'limit')
  await fails(() => reply(c, Q, { fetch: stand(() => json({}, 529)) }), 'busy')
  const asked = await fails(() => reply(c, Q, { fetch: stand(() => json({ error: { message: `model: not found ${'x'.repeat(500)}` } }, 404)) }), 'asked')
  assert.ok(asked.message.length < 280)
  await fails(() => reply(c, Q, { fetch: async () => { throw new TypeError('Failed to fetch') } }), 'line')
  await fails(() => reply(c, Q, { fetch: stand(() => sse([])) }), 'line')
  // A stream that breaks part way.
  const broken = () => new Response(new ReadableStream({ start(s) { s.enqueue(new TextEncoder().encode('data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"half"}}\n\n')); s.error(new Error('reset')) } }))
  await fails(() => reply(c, Q, { fetch: async () => broken() }), 'line')
})

await step('the models a key can use', async () => {
  const a = await models('anthropic', KEY, { fetch: stand(() => json({ data: [{ id: 'claude-opus-5-5', display_name: 'Claude Opus 5.5' }, { id: 'claude-haiku-5-5', display_name: 'Claude Haiku 5.5' }] })) })
  assert.deepEqual(a[0], { id: 'claude-opus-5-5', name: 'Claude Opus 5.5' })
  const o = await models('openai', KEY, { fetch: stand(() => json({ data: [{ id: 'old-writer', created: 1 }, { id: 'text-embedding-9', created: 9 }, { id: 'new-writer', created: 5 }, { id: 'tts-2', created: 7 }, { id: 'gpt-image-3', created: 8 }] })) })
  assert.deepEqual(o.map((m) => m.id), ['new-writer', 'old-writer'])
  const g = await models('gemini', KEY, { fetch: stand(() => json({ models: [{ name: 'models/gemini-a', displayName: 'Gemini A', supportedGenerationMethods: ['generateContent'] }, { name: 'models/embedding-1', supportedGenerationMethods: ['embedContent'] }, { name: 'models/gemini-b', displayName: 'Gemini B', supportedGenerationMethods: ['generateContent', 'countTokens'] }] })) })
  assert.deepEqual(g, [{ id: 'gemini-b', name: 'Gemini B' }, { id: 'gemini-a', name: 'Gemini A' }])
  await fails(() => models('openai', KEY, { fetch: stand(() => json({ error: { message: 'Incorrect API key provided' } }, 401)) }), 'key')
})

await step('what is connected is kept in this browser only, and a record that is not one is nothing', async () => {
  const held = new Map()
  globalThis.localStorage = { getItem: (k) => held.get(k) ?? null, setItem: (k, v) => held.set(k, v), removeItem: (k) => held.delete(k) }
  assert.equal(kept(), null)
  assert.equal(keep({ route: 'gemini', key: KEY, model: 'gemini-x' }), true)
  assert.deepEqual(kept(), { route: 'gemini', key: KEY, model: 'gemini-x' })
  held.set('village.ai', JSON.stringify({ route: 'elsewhere', key: KEY, model: 'm' }))
  assert.equal(kept(), null)
  held.set('village.ai', '{not json')
  assert.equal(kept(), null)
  keep(null)
  assert.equal(held.size, 0)
  globalThis.localStorage = { getItem() { throw new Error('no') }, setItem() { throw new Error('no') }, removeItem() { throw new Error('no') } }
  assert.equal(keep({ route: 'gemini', key: KEY, model: 'gemini-x' }), false)
  assert.equal(kept(), null)
})

console.log(`\n${steps} steps passed. No provider was asked and no model was run.`)
