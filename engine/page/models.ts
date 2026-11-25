// A visitor's own AI (#526): how a page asks the model of whoever is at it, with a key they gave it.
//
// A realm served as plain files has no helper and no server of ours that could hold a key. So the key stays in the
// visitor's browser (localStorage, this origin) and each question goes straight from the page to the provider the
// key is for: Anthropic, OpenAI, Gemini or OpenRouter. All four answer a page on another origin (measured from
// https://zahynailo.dev on November 24, 2026, with a key that is none: each said so in JSON the page could read).
//
// What holds:
//   - A key is only ever sent to its own provider. The address is one of the four below, never one that was given:
//     nothing a world, a host, a link or a model's reply says can change where a key goes.
//   - A question is a brief, the visitor's wish and their pictures. The answer is text, and whoever asked reads it
//     as data (make/form.mjs): nothing in it is run, and it is given no tools.
//   - Nothing is asked unless the visitor asked: whoever calls `reply` passes on only what a person typed.
//
// The requests are written by hand: the page is plain modules with nothing bundled (sf/build.mjs), so no provider's
// SDK can be loaded, and four small requests of one shape are less to carry than four libraries.
// A subscription (through the provider's own program on the visitor's machine) is another route, not this file's.

export type Route = 'anthropic' | 'openai' | 'gemini' | 'openrouter'
/** What a visitor connected: which provider, their key for it, and which of its models answers. */
export interface Connected { route: Route; key: string; model: string }
/** One question: the whole of what is sent, beside the key. Pictures are base64. */
export interface Question { system: string; prompt: string; pictures?: { type: string; data: string }[] }
/** The answer. `cut`: the model stopped at its limit of words, and the text may end mid-way. */
export interface Reply { text: string; model: string; ms: number; cut: boolean; tokens: { in: number; out: number } }
/** Why there is no answer: `key` it is not taken, `limit` too many or no credit, `declined` the model would not, `busy` the provider is failing, `asked` the request itself was refused, `line` nothing came back. */
export type Why = 'key' | 'limit' | 'declined' | 'busy' | 'asked' | 'line'
export class Unanswered extends Error {
  readonly why: Why
  constructor(why: Why, said: string) { super(said); this.why = why }
}
/** A model a key can use, as the provider lists it. */
export interface Listed { id: string; name: string }

/** Where each provider is. The only places a key is sent. */
export const AT: Record<Route, string> = {
  anthropic: 'https://api.anthropic.com',
  openai: 'https://api.openai.com',
  gemini: 'https://generativelanguage.googleapis.com',
  openrouter: 'https://openrouter.ai',
}
/** What each is called on the page, and where a key for it is made. */
export const ABOUT: Record<Route, { name: string; keys: string }> = {
  anthropic: { name: 'Anthropic', keys: 'https://platform.claude.com/settings/keys' },
  openai: { name: 'OpenAI', keys: 'https://platform.openai.com/api-keys' },
  gemini: { name: 'Gemini', keys: 'https://aistudio.google.com/apikey' },
  openrouter: { name: 'OpenRouter', keys: 'https://openrouter.ai/keys' },
}
/** The most a model may write for one thing. */
const WORDS_MOST = 32_000
/** Anthropic's models that take over from one another when one declines (the API's `fallbacks`). */
const FALLS_BACK = /^claude-(fable-5-[12]|opus-5(-5)?|sonnet-5-5)$/

type Fetch = typeof fetch
interface How { signal?: AbortSignal; /** Hears the text as it comes. */ each?: (sofar: string) => void; fetch?: Fetch }

const headers = (c: { route: Route; key: string }): Record<string, string> =>
  c.route === 'anthropic' ? { 'x-api-key': c.key, 'anthropic-version': '2026-10-21', 'anthropic-dangerous-direct-browser-access': 'true' }
    : c.route === 'gemini' ? { 'x-goog-api-key': c.key }
      : { authorization: `Bearer ${c.key}` }

/** What a provider said when it refused, as a reason and a line of plain words. What it says is text: shown, never obeyed. */
async function refused(route: Route, res: Response): Promise<Unanswered> {
  let said = ''
  try { const body = await res.json(); said = String(body?.error?.message ?? body?.message ?? '') } catch { /* no words came */ }
  said = said.replace(/\s+/g, ' ').slice(0, 200)
  const name = ABOUT[route].name
  // Gemini answers a key that is none with 400, not 401.
  if (res.status === 401 || res.status === 403 || /api key not valid/i.test(said)) return new Unanswered('key', `${name} did not take that key`)
  if (res.status === 429 || res.status === 402) return new Unanswered('limit', `${name} says this key is at its limit or out of credit${said ? `: ${said}` : ''}`)
  if (res.status >= 500) return new Unanswered('busy', `${name} is not answering just now (${res.status})`)
  return new Unanswered('asked', `${name} refused the request (${res.status})${said ? `: ${said}` : ''}`)
}

/** Each event of a stream of server-sent events, as the JSON its `data:` line holds. */
async function* events(res: Response): AsyncGenerator<Record<string, any>> {
  const reader = res.body!.pipeThrough(new TextDecoderStream()).getReader()
  let held = ''
  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    held += value
    for (let at = held.indexOf('\n'); at >= 0; at = held.indexOf('\n')) {
      const line = held.slice(0, at).trimEnd()
      held = held.slice(at + 1)
      if (!line.startsWith('data:')) continue
      const data = line.slice(5).trim()
      if (!data || data === '[DONE]') continue
      try { yield JSON.parse(data) } catch { /* a line that is not JSON says nothing */ }
    }
  }
}

/** A picture as an address that holds its own bytes. */
const inline = (p: { type: string; data: string }) => `data:${p.type};base64,${p.data}`

/** The request for one question, by provider: where it goes and what it says. */
function asked(c: Connected, q: Question): { url: string; body: unknown; beta?: string } {
  const pictures = q.pictures ?? []
  if (c.route === 'anthropic') {
    const falls = FALLS_BACK.test(c.model)
    return {
      url: `${AT.anthropic}/v1/messages`,
      ...(falls ? { beta: 'server-side-fallback-2026-07-01' } : {}),
      body: {
        model: c.model, max_tokens: WORDS_MOST, stream: true, system: q.system,
        // A model that declines hands the question to the one behind it, inside the same request.
        ...(falls ? { fallbacks: 'default' } : {}),
        messages: [{ role: 'user', content: [...pictures.map((p) => ({ type: 'image', source: { type: 'base64', media_type: p.type, data: p.data } })), { type: 'text', text: q.prompt }] }],
      },
    }
  }
  if (c.route === 'gemini') {
    return {
      url: `${AT.gemini}/v1beta/models/${encodeURIComponent(c.model)}:streamGenerateContent?alt=sse`,
      body: { system_instruction: { parts: [{ text: q.system }] }, contents: [{ role: 'user', parts: [...pictures.map((p) => ({ inline_data: { mime_type: p.type, data: p.data } })), { text: q.prompt }] }] },
    }
  }
  // OpenAI and OpenRouter speak the same chat form.
  return {
    url: c.route === 'openai' ? `${AT.openai}/v1/chat/completions` : `${AT.openrouter}/api/v1/chat/completions`,
    body: {
      model: c.model, stream: true, stream_options: { include_usage: true },
      messages: [{ role: 'system', content: q.system }, { role: 'user', content: pictures.length ? [...pictures.map((p) => ({ type: 'image_url', image_url: { url: inline(p) } })), { type: 'text', text: q.prompt }] : q.prompt }],
    },
  }
}

/**
 * One answer to one question, from the visitor's own model. Throws `Unanswered` with why, in words fit to show.
 * It is given no tools and nothing to remember: a question is answered and that is all.
 */
export async function reply(c: Connected, q: Question, how: How = {}): Promise<Reply> {
  const began = performance.now(), ask = how.fetch ?? fetch, name = ABOUT[c.route].name
  const { url, body, beta } = asked(c, q)
  let res: Response
  try { res = await ask(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers(c), ...(beta ? { 'anthropic-beta': beta } : {}) }, body: JSON.stringify(body), signal: how.signal }) } catch (e) {
    throw new Unanswered('line', how.signal?.aborted ? 'stopped' : `${name} could not be reached: ${e instanceof Error ? e.message : e}`)
  }
  if (!res.ok || !res.body) throw await refused(c.route, res)
  let text = '', cut = false, declined = '', model = c.model
  const tokens = { in: 0, out: 0 }
  const more = (t: unknown) => { if (typeof t === 'string' && t) { text += t; how.each?.(text) } }
  try {
    for await (const e of events(res)) {
      if (c.route === 'anthropic') {
        if (e.type === 'message_start') { model = e.message?.model ?? model; tokens.in = (e.message?.usage?.input_tokens ?? 0) + (e.message?.usage?.cache_read_input_tokens ?? 0) + (e.message?.usage?.cache_creation_input_tokens ?? 0) }
        else if (e.type === 'content_block_delta' && e.delta?.type === 'text_delta') more(e.delta.text)
        else if (e.type === 'message_delta') { tokens.out = e.usage?.output_tokens ?? tokens.out; if (e.delta?.stop_reason === 'max_tokens') cut = true; if (e.delta?.stop_reason === 'refusal') declined = 'the model declined this one' }
        else if (e.type === 'error') throw new Unanswered(e.error?.type === 'overloaded_error' ? 'busy' : 'asked', `${name} stopped: ${String(e.error?.message ?? 'no reason given').slice(0, 200)}`)
      } else if (c.route === 'gemini') {
        if (e.promptFeedback?.blockReason) declined = 'the model declined this one'
        for (const candidate of e.candidates ?? []) {
          // A part marked as a thought is the model thinking aloud, not its answer.
          for (const part of candidate.content?.parts ?? []) if (!part.thought) more(part.text)
          if (candidate.finishReason === 'MAX_TOKENS') cut = true
          else if (candidate.finishReason && candidate.finishReason !== 'STOP') declined = 'the model declined this one'
        }
        if (e.usageMetadata) { tokens.in = e.usageMetadata.promptTokenCount ?? tokens.in; tokens.out = (e.usageMetadata.candidatesTokenCount ?? 0) + (e.usageMetadata.thoughtsTokenCount ?? 0) || tokens.out }
        if (e.modelVersion) model = e.modelVersion
        if (e.error) throw new Unanswered('asked', `${name} stopped: ${String(e.error.message ?? 'no reason given').slice(0, 200)}`)
      } else {
        for (const choice of e.choices ?? []) {
          more(choice.delta?.content)
          if (choice.finish_reason === 'length') cut = true
          else if (choice.finish_reason === 'content_filter') declined = 'the model declined this one'
        }
        if (e.usage) { tokens.in = e.usage.prompt_tokens ?? tokens.in; tokens.out = e.usage.completion_tokens ?? tokens.out }
        if (e.model) model = e.model
        if (e.error) throw new Unanswered('asked', `${name} stopped: ${String(e.error.message ?? 'no reason given').slice(0, 200)}`)
      }
    }
  } catch (e) {
    if (e instanceof Unanswered) throw e
    throw new Unanswered('line', how.signal?.aborted ? 'stopped' : `${name} stopped answering part way`)
  }
  // Whatever it wrote before it declined is not an answer.
  if (declined && !text.trim()) throw new Unanswered('declined', declined)
  if (!text.trim()) throw new Unanswered('line', `${name} answered with nothing`)
  return { text, model, ms: Math.round(performance.now() - began), cut, tokens }
}

/** Which of a provider's models are for words in and words out, by their names: the rest (speech, pictures, embeddings) cannot make a thing. */
const WRITES = /^(?!.*(embed|tts|whisper|audio|speech|image|dall|moderation|realtime|transcribe|search|vision-preview|imagen|veo|aqa|robotics|computer-use|guard))/i

/**
 * The models a key can use, as its provider lists them, the likeliest to be wanted first. Also how a key is tried:
 * one that is not taken throws `Unanswered` with `key`. Nothing is asked of any model, so it costs nothing.
 */
export async function models(route: Route, key: string, how: { fetch?: Fetch; signal?: AbortSignal } = {}): Promise<Listed[]> {
  const ask = how.fetch ?? fetch
  const url = route === 'anthropic' ? `${AT.anthropic}/v1/models?limit=100` : route === 'openai' ? `${AT.openai}/v1/models` : route === 'gemini' ? `${AT.gemini}/v1beta/models?pageSize=200` : `${AT.openrouter}/api/v1/models/user`
  let res: Response
  try { res = await ask(url, { headers: headers({ route, key }), signal: how.signal }) } catch (e) { throw new Unanswered('line', `${ABOUT[route].name} could not be reached: ${e instanceof Error ? e.message : e}`) }
  if (!res.ok) throw await refused(route, res)
  const body = await res.json().catch(() => ({})) as Record<string, any>
  const short = (s: unknown) => String(s ?? '').slice(0, 80)
  if (route === 'anthropic') return (body.data ?? []).map((m: any) => ({ id: short(m.id), name: short(m.display_name ?? m.id) }))
  if (route === 'gemini') return (body.models ?? []).filter((m: any) => (m.supportedGenerationMethods ?? []).includes('generateContent') && WRITES.test(m.name)).map((m: any) => ({ id: short(m.name).replace(/^models\//, ''), name: short(m.displayName ?? m.name) })).reverse()
  const listed = (body.data ?? []).filter((m: any) => WRITES.test(String(m.id)))
  // OpenAI lists in no order: the newest first. Fine-tunes and dated copies of a model after its plain name.
  if (route === 'openai') listed.sort((a: any, b: any) => (b.created ?? 0) - (a.created ?? 0))
  return listed.map((m: any) => ({ id: short(m.id), name: short(m.name ?? m.id) }))
}

const KEPT = 'village.ai'
const ROUTES = new Set<string>(Object.keys(AT))
/** What this browser was connected to, or null. Kept here only: it is in no address, and no server is told. */
export function kept(): Connected | null {
  try {
    const v = JSON.parse(localStorage.getItem(KEPT) ?? 'null')
    return v && ROUTES.has(v.route) && typeof v.key === 'string' && v.key && typeof v.model === 'string' && v.model ? { route: v.route, key: v.key, model: v.model } : null
  } catch { return null }
}
/** Keeps what was connected, or with null forgets it. False where this browser keeps nothing (a private window): it then lasts as long as the page. */
export function keep(c: Connected | null): boolean {
  try { if (c) localStorage.setItem(KEPT, JSON.stringify(c)); else localStorage.removeItem(KEPT); return true } catch { return false }
}
