// The four providers of page/models.ts, answered by a check itself (Playwright routes their hosts): a list of models
// for a made-up key, then a stream that spells a small thing in the maker's form. Nothing here reaches a provider.
// For test/sf-connect.mjs and sf/connect-shots.mjs.

/** A made-up key for each, and only that key is taken. */
export const KEYS = { anthropic: 'sk-ant-madeup-0001-Q7b2Lx', openai: 'sk-proj-madeup-0002-Z4k9Rv', gemini: 'AIzaMadeUp0003xP8wTt', openrouter: 'sk-or-v1-madeup-0004-M3n6Ds' }
export const HOSTS = { anthropic: 'api.anthropic.com', openai: 'api.openai.com', gemini: 'generativelanguage.googleapis.com', openrouter: 'openrouter.ai' }
export const ROUTES = Object.keys(KEYS)
/** The model the panel should offer first from each list below. */
export const FIRST = { anthropic: 'claude-opus-5-5', openai: 'gpt-6.2-sol', gemini: 'gemini-4-neon', openrouter: 'anthropic/claude-opus-5.5' }
const LISTS = {
  anthropic: { data: [
    { id: 'claude-haiku-5-5', display_name: 'Claude Haiku 5.5' },
    { id: 'claude-opus-5-5-20260925', display_name: 'Claude Opus 5.5 (2026-09-25)' },
    { id: 'claude-fable-5-2', display_name: 'Claude Fable 5.2' },
    { id: 'claude-opus-5-5', display_name: 'Claude Opus 5.5' },
    { id: 'claude-sonnet-5-5', display_name: 'Claude Sonnet 5.5' },
  ] },
  openai: { data: [
    { id: 'gpt-5.5', created: 12 },
    { id: 'gpt-6.2-mini', created: 10 },
    { id: 'gpt-6-cyber', created: 11 },
    { id: 'gpt-6.2-sol-2026-11-10', created: 10 },
    { id: 'gpt-6.2-astra', created: 9 },
    { id: 'gpt-6.2-sol', created: 9 },
    { id: 'gpt-6-luna', created: 8 },
    { id: 'text-embedding-9', created: 13 },
  ] },
  gemini: { models: [
    { name: 'models/gemini-2.5-pro', displayName: 'Gemini 2.5 Pro', supportedGenerationMethods: ['generateContent'] },
    { name: 'models/gemini-3.8-flash', displayName: 'Gemini 3.8 Flash', supportedGenerationMethods: ['generateContent'] },
    { name: 'models/gemini-4-hydrogen', displayName: 'Gemini 4 Hydrogen', supportedGenerationMethods: ['generateContent'] },
    { name: 'models/gemini-4-carbon', displayName: 'Gemini 4 Carbon', supportedGenerationMethods: ['generateContent'] },
    { name: 'models/gemini-4-neon', displayName: 'Gemini 4 Neon', supportedGenerationMethods: ['generateContent'] },
    { name: 'models/gemini-4-neon-preview-11-2026', displayName: 'Gemini 4 Neon Preview', supportedGenerationMethods: ['generateContent'] },
  ] },
  openrouter: { data: [
    { id: 'openrouter/auto', name: 'OpenRouter: Auto' },
    { id: 'mistral/large-3', name: 'Mistral Large 3' },
    { id: 'anthropic/claude-opus-5.5:free', name: 'Anthropic: Claude Opus 5.5 (free)' },
    { id: 'anthropic/claude-3.7-sonnet', name: 'Anthropic: Claude 3.7 Sonnet' },
    { id: 'openai/gpt-6.2-sol', name: 'OpenAI: GPT-6.2 Sol' },
    { id: 'google/gemini-4-neon', name: 'Google: Gemini 4 Neon' },
    { id: 'anthropic/claude-opus-5.5', name: 'Anthropic: Claude Opus 5.5' },
  ] },
}
/** A small thing in the maker's form (make/form.mjs), as test/sf-make.mjs has it. */
export const STALL = JSON.stringify({ name: 'fruit stall', size: [34, 25, 18], parts: [
  ['box', 'wood', '2:6', 2, 0, 2, 4, 24, 4], ['box', 'wood', '2:6', 30, 0, 2, 32, 24, 4], ['box', 'wood', '2:6', 2, 0, 14, 4, 24, 16], ['box', 'wood', '2:6', 30, 0, 14, 32, 24, 16],
  ['box', 'wood', 'own', 2, 8, 2, 32, 9, 16], ['box', 'wood', '2:5', 4, 0, 3, 30, 8, 4],
  ['stripes', 'plaster', '0:4', 0, 24, 0, 34, 25, 18, 'x', 4, 'white'],
  ['box', 'leaves', '2:4', 6, 9, 5, 9, 11, 8], ['box', 'leaves', '0:4', 11, 9, 5, 14, 11, 8], ['ball', 'leaves', '8:4', 16, 9, 5, 19, 12, 8],
  ['cyl', 'wood', 'own', 22, 9, 5, 26, 13, 9, 'y'], ['text', 'lamp', '3:1', 3, 1, 2, 'FRUIT'],
] })
const pieces = (text) => { const out = []; for (let at = 0; at < text.length; at += 40) out.push(text.slice(at, at + 40)); return out }
const sse = (events) => events.map((e) => `data: ${typeof e === 'string' ? e : JSON.stringify(e)}\n\n`).join('')
/** The stream a provider sends for the stall; `whole` false leaves off its end, as a line that drops part way. */
export const stream = (route, whole = true) => {
  const p = pieces(STALL), half = whole ? p : p.slice(0, Math.ceil(p.length / 2))
  if (route === 'anthropic') return sse([{ type: 'message_start', message: { model: FIRST.anthropic, usage: { input_tokens: 1200 } } }, ...half.map((text) => ({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } })), ...(whole ? [{ type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 800 } }, { type: 'message_stop' }] : [])])
  if (route === 'gemini') return sse([...half.map((text) => ({ candidates: [{ content: { parts: [{ text }] } }] })), ...(whole ? [{ candidates: [{ content: { parts: [{ text: '' }] }, finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 1200, candidatesTokenCount: 800 }, modelVersion: FIRST.gemini }] : [])])
  return sse([...half.map((content) => ({ model: FIRST[route], choices: [{ delta: { content } }] })), ...(whole ? [{ choices: [{ delta: {}, finish_reason: 'stop' }] }, { choices: [], usage: { prompt_tokens: 1200, completion_tokens: 800 } }, '[DONE]'] : [])])
}
export const PROVIDERS = /^https:\/\/(api\.anthropic\.com|api\.openai\.com|generativelanguage\.googleapis\.com|openrouter\.ai)\//
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET, POST, OPTIONS' }

/**
 * Stand-ins for the providers. `state.mode` says what they do next: `ok`; `cut` (a stream that stops part way);
 * `slow` (an answer that takes `state.slow` ms); `slowlist` (a list of models that does); `echo` (a limit whose words
 * quote the key); `credit` (Anthropic's 400 for an account with no credit, word for word); `refuse` (the key is not taken). `state.asked` counts what was asked, and keeps each question.
 */
export function providers() {
  const state = { mode: 'ok', slow: 20_000, asked: { models: 0, answers: 0, prompts: [] } }
  const answer = async (route, request) => {
    const r = request, url = new URL(r.url()), at = ROUTES.find((k) => HOSTS[k] === url.hostname)
    if (r.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS })
    const h = await r.allHeaders(), key = h['x-api-key'] ?? h['x-goog-api-key'] ?? (h.authorization ?? '').replace(/^Bearer /, '')
    const json = (body, status = 200) => route.fulfill({ status, headers: { ...CORS, 'content-type': 'application/json' }, body: JSON.stringify(body) }).catch(() => {})
    if (key !== KEYS[at] || state.mode === 'refuse') return at === 'gemini' ? json({ error: { code: 400, message: 'API key not valid. Please pass a valid API key.' } }, 400) : json({ error: { type: 'authentication_error', message: 'invalid key' } }, 401)
    if (r.method() === 'GET') { state.asked.models++; if (state.mode === 'slowlist') await new Promise((done) => setTimeout(done, state.slow)); return json(LISTS[at]) }
    state.asked.answers++
    try { const b = JSON.parse(r.postData() ?? '{}'); state.asked.prompts.push(JSON.stringify(b.messages ?? b.contents ?? '')) } catch { /* not JSON */ }
    if (state.mode === 'credit') return json({ type: 'error', error: { type: 'invalid_request_error', message: 'Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits.' } }, 400)
    if (state.mode === 'echo') return json({ error: { message: `Rate limit reached for key ${key} in your organisation` } }, 429)
    if (state.mode === 'slow') await new Promise((done) => setTimeout(done, state.slow))
    return route.fulfill({ status: 200, headers: { ...CORS, 'content-type': 'text/event-stream' }, body: stream(at, state.mode !== 'cut') }).catch(() => {})
  }
  return { state, answer }
}
