// A visitor's own AI (#526, page/models.ts): each provider's request and the reading of its stream, against a
// stand-in for `fetch`. No provider is asked anything and no model is run: this proves what the page sends and how
// it reads what comes back, never that a provider takes it. That needs a real key.
//
//   node test/models.mjs
import assert from 'node:assert/strict'
import { ABOUT, AT, Unanswered, keep, kept, models, preferred, remembered, reply } from '../page/models.ts'

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
  const f = stand(() => sse([{ type: 'content_block_delta', delta: { type: 'text_delta', text: 'x' } }, { type: 'message_stop' }]))
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
  const plain = stand(() => sse([{ choices: [{ delta: { content: 'x' }, finish_reason: 'stop' }] }]))
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
  const odd = stand(() => sse([{ candidates: [{ content: { parts: [{ text: 'x' }] }, finishReason: 'STOP' }] }]))
  await reply({ route: 'gemini', key: KEY, model: '../../evil?x=' }, Q, { fetch: odd })
  assert.ok(odd.seen[0].url.startsWith('https://generativelanguage.googleapis.com/v1beta/models/..%2F..%2Fevil%3Fx%3D:'))
})

await step('a key goes only to its own provider', async () => {
  for (const route of Object.keys(AT)) {
    const f = stand(() => sse([{ type: 'content_block_delta', delta: { type: 'text_delta', text: 'x' } }, { type: 'message_stop' }, { choices: [{ delta: { content: 'x' }, finish_reason: 'stop' }] }, { candidates: [{ content: { parts: [{ text: 'x' }] }, finishReason: 'STOP' }] }]))
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
  // Anthropic's own answer to an account with no credit (met with a real key on November 26): 400, and a limit all the same.
  await fails(() => reply(c, Q, { fetch: stand(() => json({ type: 'error', error: { type: 'invalid_request_error', message: 'Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits.' } }, 400)) }), 'limit')
  await fails(() => reply(c, Q, { fetch: stand(() => json({}, 529)) }), 'busy')
  const asked = await fails(() => reply(c, Q, { fetch: stand(() => json({ error: { message: `model: not found ${'x'.repeat(500)}` } }, 404)) }), 'asked')
  assert.ok(asked.message.length < 280)
  await fails(() => reply(c, Q, { fetch: async () => { throw new TypeError('Failed to fetch') } }), 'line')
  await fails(() => reply(c, Q, { fetch: stand(() => sse([])) }), 'line')
  // A stream that breaks part way.
  const broken = () => new Response(new ReadableStream({ start(s) { s.enqueue(new TextEncoder().encode('data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"half"}}\n\n')); s.error(new Error('reset')) } }))
  await fails(() => reply(c, Q, { fetch: async () => broken() }), 'line')
  // A stream that ends cleanly before its provider said the answer was over: cut short, not an answer, for every provider.
  await fails(() => reply(c, Q, { fetch: stand(() => sse([{ type: 'content_block_delta', delta: { type: 'text_delta', text: '{"name": "a bo' } }])) }), 'line')
  await fails(() => reply({ ...c, route: 'openai' }, Q, { fetch: stand(() => sse([{ choices: [{ delta: { content: '{"name": "a bo' } }] }])) }), 'line')
  await fails(() => reply({ ...c, route: 'gemini' }, Q, { fetch: stand(() => sse([{ candidates: [{ content: { parts: [{ text: '{"name": "a bo' }] } }] }])) }), 'line')
})

await step('the models a key can use', async () => {
  const a = await models('anthropic', KEY, { fetch: stand(() => json({ data: [{ id: 'claude-opus-5-5', display_name: 'Claude Opus 5.5' }, { id: 'claude-haiku-5-5', display_name: 'Claude Haiku 5.5' }] })) })
  assert.deepEqual(a[0], { id: 'claude-opus-5-5', name: 'Claude Opus 5.5' })
  const o = await models('openai', KEY, { fetch: stand(() => json({ data: [{ id: 'old-writer', created: 1 }, { id: 'text-embedding-9', created: 9 }, { id: 'new-writer', created: 5 }, { id: 'tts-2', created: 7 }, { id: 'gpt-image-3', created: 8 }, { id: 'sora-2', created: 10 }, { id: 'gpt-live-1', created: 11 }, { id: 'babbage-002', created: 2 }, { id: 'davinci-002', created: 3 }] })) })
  assert.deepEqual(o.map((m) => m.id), ['new-writer', 'old-writer'])
  const g = await models('gemini', KEY, { fetch: stand(() => json({ models: [{ name: 'models/gemini-a', displayName: 'Gemini A', supportedGenerationMethods: ['generateContent'] }, { name: 'models/embedding-1', supportedGenerationMethods: ['embedContent'] }, { name: 'models/gemini-b', displayName: 'Gemini B', supportedGenerationMethods: ['generateContent', 'countTokens'] }] })) })
  assert.deepEqual(g, [{ id: 'gemini-b', name: 'Gemini B' }, { id: 'gemini-a', name: 'Gemini A' }])
  await fails(() => models('openai', KEY, { fetch: stand(() => json({ error: { message: 'Incorrect API key provided' } }, 401)) }), 'key')
})

await step('smarter defaults across all four providers', async () => {
  const list = (...ids) => ids.map((id) => ({ id, name: id }))

  // OpenAI: latest 6.2 generation beats bare 5.5 (even when 5.5 has a newer created timestamp);
  // sol beats astra/luna within 6.2; undated alias beats dated snapshot; small/specialized/fine-tunes stay out of default.
  const oai = await models('openai', KEY, {
    fetch: stand(() => json({
      data: [
        { id: 'gpt-5.5', created: 100 },
        { id: 'gpt-6-cyber', created: 99 },
        { id: 'gpt-6.2-mini', created: 98 },
        { id: 'gpt-6.2-sol-2026-11-10', created: 97 },
        { id: 'gpt-6.2-luna', created: 95 },
        { id: 'gpt-6.2-astra', created: 94 },
        { id: 'gpt-6.2-sol', created: 90 },
        { id: 'gpt-6.1-sol', created: 80 },
        { id: 'gpt-5-codex', created: 85 },
        { id: 'ft:gpt-6.2-sol:org::1', created: 120 },
      ],
    })),
  })
  assert.equal(oai[0].id, 'gpt-6.2-sol')
  assert.equal(preferred('openai', oai)?.id, 'gpt-6.2-sol')
  assert.deepEqual(oai.slice(0, 4).map((m) => m.id), ['gpt-6.2-sol', 'gpt-6.2-astra', 'gpt-6.2-luna', 'gpt-6.2-sol-2026-11-10'])
  assert.equal(preferred('openai', list('gpt-5.5', 'gpt-6.2-astra', 'gpt-6.2-luna'))?.id, 'gpt-6.2-astra')
  assert.equal(preferred('openai', list('gpt-5.5', 'gpt-6.2-luna'))?.id, 'gpt-6.2-luna')
  assert.equal(preferred('openai', list('gpt-6.2-mini', 'gpt-6.2'))?.id, 'gpt-6.2')
  assert.equal(preferred('openai', list('gpt-6.2-sol', 'gpt-7-nova'))?.id, 'gpt-7-nova')
  assert.equal(preferred('openai', list('gpt-5.5', 'gpt-6.2-sol-2026-11-10'))?.id, 'gpt-6.2-sol-2026-11-10')
  assert.equal(preferred('openai', list('gpt-4', 'gpt-4o', 'gpt-4.1'))?.id, 'gpt-4.1')
  assert.equal(preferred('openai', list('gpt-4', 'gpt-4o'))?.id, 'gpt-4o')
  assert.equal(preferred('openai', list('o4-mini', 'o3', 'gpt-6-cyber'))?.id, 'o3')

  // Anthropic: newest Opus > Sonnet > Fable; undated alias beats compact YYYYMMDD snapshot; dated newer beats undated older; future versions win automatically.
  assert.equal(preferred('anthropic', list('claude-haiku-5-5', 'claude-opus-5-5-20260925', 'claude-fable-5-2', 'claude-sonnet-5-5', 'claude-opus-5-5', 'claude-opus-4-6'))?.id, 'claude-opus-5-5')
  assert.equal(preferred('anthropic', list('claude-opus-4-6', 'claude-opus-5-5-20260925', 'claude-opus-5-5-20261015'))?.id, 'claude-opus-5-5-20261015')
  assert.equal(preferred('anthropic', list('claude-opus-5-5', 'claude-sonnet-6-0'))?.id, 'claude-sonnet-6-0')

  // Gemini: Gemini 4 element tiers beat older 2.5/3.x pro/flash; neon > argon > carbon > hydrogen; previews, lite, orchestrator and gemma stay below GA mainline.
  assert.equal(preferred('gemini', list('gemini-2.5-pro', 'gemini-3.8-flash', 'gemini-4-hydrogen', 'gemini-4-carbon', 'gemini-4-argon', 'gemini-4-neon', 'gemini-4-neon-preview-11-2026', 'gemini-pro-orchestrator-neon', 'gemma-3-27b-it'))?.id, 'gemini-4-neon')
  assert.equal(preferred('gemini', list('gemini-2.5-pro', 'gemini-4-carbon', 'gemini-4-hydrogen'))?.id, 'gemini-4-carbon')
  assert.equal(preferred('gemini', list('gemini-4-flash', 'gemini-4-pro'))?.id, 'gemini-4-pro')
  assert.equal(preferred('gemini', list('gemini-2.5-pro', 'gemini-3.8-flash', 'gemini-2.5-flash-lite'))?.id, 'gemini-3.8-flash')
  assert.equal(preferred('gemini', list('gemini-4-neon', 'gemini-5-krypton'))?.id, 'gemini-5-krypton')

  // OpenRouter: clean frontier models beat :free/:batch/:beta variants and meta-routers; picks latest version per lab and falls back cleanly across labs.
  assert.equal(preferred('openrouter', list('openrouter/auto', 'mistral/large-3', 'anthropic/claude-opus-5.5:free', 'anthropic/claude-3.7-sonnet', 'openai/gpt-6.2-sol', 'google/gemini-4-neon', 'anthropic/claude-opus-5.5'))?.id, 'anthropic/claude-opus-5.5')
  assert.equal(preferred('openrouter', list('openrouter/auto', 'mistral/large-3', 'anthropic/claude-haiku-5.5', 'openai/gpt-5.5', 'openai/gpt-6.2-sol', 'google/gemini-4-neon'))?.id, 'openai/gpt-6.2-sol')
  assert.equal(preferred('openrouter', list('openrouter/auto', 'mistral/large-3', 'google/gemini-2.5-pro', 'google/gemini-4-neon'))?.id, 'google/gemini-4-neon')

  // Preserves a visitor's saved model when still listed; falls back to the smart default if it disappeared.
  assert.equal(preferred('openai', oai, 'gpt-6.2-astra')?.id, 'gpt-6.2-astra')
  assert.equal(preferred('openai', oai, 'gpt-removed')?.id, 'gpt-6.2-sol')
  assert.equal(preferred('openai', []), undefined)
})

await step('what is connected is kept for this tab, remembered by this browser only when asked, and a record that is not one is nothing', async () => {
  const stand = () => { const held = new Map(); return { held, getItem: (k) => held.get(k) ?? null, setItem: (k, v) => held.set(k, v), removeItem: (k) => held.delete(k) } }
  const tab = stand(), browser = stand()
  globalThis.sessionStorage = tab; globalThis.localStorage = browser
  assert.equal(kept(), null)
  // By default this tab alone (#81): nothing is written that outlives it.
  assert.equal(keep({ route: 'gemini', key: KEY, model: 'gemini-x' }), true)
  assert.deepEqual(kept(), { route: 'gemini', key: KEY, model: 'gemini-x' })
  assert.equal(browser.held.size, 0, 'a key not asked to be remembered is not in localStorage')
  assert.equal(remembered(), false)
  // Remembered when asked: in this browser's storage, and out of the tab's.
  assert.equal(keep({ route: 'gemini', key: KEY, model: 'gemini-y' }, true), true)
  assert.equal(tab.held.size, 0)
  assert.equal(remembered(), true)
  assert.deepEqual(kept(), { route: 'gemini', key: KEY, model: 'gemini-y' })
  // A key remembered before this change is still read.
  tab.held.clear(); browser.held.set('village.ai', JSON.stringify({ route: 'openai', key: KEY, model: 'gpt-x' }))
  assert.deepEqual(kept(), { route: 'openai', key: KEY, model: 'gpt-x' })
  // This tab's own comes first.
  tab.held.set('village.ai', JSON.stringify({ route: 'anthropic', key: KEY, model: 'claude-x' }))
  assert.equal(kept()?.route, 'anthropic')
  // Forgotten from both.
  keep(null)
  assert.equal(tab.held.size + browser.held.size, 0)
  browser.held.set('village.ai', JSON.stringify({ route: 'elsewhere', key: KEY, model: 'm' }))
  assert.equal(kept(), null)
  browser.held.set('village.ai', '{not json')
  assert.equal(kept(), null)
  browser.held.clear()
  const refuses = { getItem() { throw new Error('no') }, setItem() { throw new Error('no') }, removeItem() { throw new Error('no') } }
  globalThis.sessionStorage = refuses; globalThis.localStorage = refuses
  assert.equal(keep({ route: 'gemini', key: KEY, model: 'gemini-x' }), false)
  assert.equal(keep({ route: 'gemini', key: KEY, model: 'gemini-x' }, true), false)
  assert.equal(kept(), null)
})

console.log(`\n${steps} steps passed. No provider was asked and no model was run.`)
