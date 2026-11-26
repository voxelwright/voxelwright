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
  // (Anthropic answers an account with no credit with 400, not 402: "Your credit balance is too low…".)
  if (res.status === 429 || res.status === 402 || /credit balance/i.test(said)) return new Unanswered('limit', `${name} says this key is at its limit or out of credit${said ? `: ${said}` : ''}`)
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
  // `ended`: the provider said the answer was over. A stream that simply stops before that is cut short, not an answer.
  let text = '', cut = false, declined = '', model = c.model, ended = false
  const tokens = { in: 0, out: 0 }
  const more = (t: unknown) => { if (typeof t === 'string' && t) { text += t; how.each?.(text) } }
  try {
    for await (const e of events(res)) {
      if (c.route === 'anthropic') {
        if (e.type === 'message_start') { model = e.message?.model ?? model; tokens.in = (e.message?.usage?.input_tokens ?? 0) + (e.message?.usage?.cache_read_input_tokens ?? 0) + (e.message?.usage?.cache_creation_input_tokens ?? 0) }
        else if (e.type === 'content_block_delta' && e.delta?.type === 'text_delta') more(e.delta.text)
        else if (e.type === 'message_stop') ended = true
        else if (e.type === 'message_delta') { tokens.out = e.usage?.output_tokens ?? tokens.out; if (e.delta?.stop_reason) ended = true; if (e.delta?.stop_reason === 'max_tokens') cut = true; if (e.delta?.stop_reason === 'refusal') declined = 'the model declined this one' }
        else if (e.type === 'error') throw new Unanswered(e.error?.type === 'overloaded_error' ? 'busy' : 'asked', `${name} stopped: ${String(e.error?.message ?? 'no reason given').slice(0, 200)}`)
      } else if (c.route === 'gemini') {
        if (e.promptFeedback?.blockReason) declined = 'the model declined this one'
        for (const candidate of e.candidates ?? []) {
          // A part marked as a thought is the model thinking aloud, not its answer.
          for (const part of candidate.content?.parts ?? []) if (!part.thought) more(part.text)
          if (candidate.finishReason) ended = true
          if (candidate.finishReason === 'MAX_TOKENS') cut = true
          else if (candidate.finishReason && candidate.finishReason !== 'STOP') declined = 'the model declined this one'
        }
        if (e.usageMetadata) { tokens.in = e.usageMetadata.promptTokenCount ?? tokens.in; tokens.out = (e.usageMetadata.candidatesTokenCount ?? 0) + (e.usageMetadata.thoughtsTokenCount ?? 0) || tokens.out }
        if (e.modelVersion) model = e.modelVersion
        if (e.error) throw new Unanswered('asked', `${name} stopped: ${String(e.error.message ?? 'no reason given').slice(0, 200)}`)
      } else {
        for (const choice of e.choices ?? []) {
          more(choice.delta?.content)
          if (choice.finish_reason) ended = true
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
  if (!ended && !declined) throw new Unanswered('line', how.signal?.aborted ? 'stopped' : `${name} stopped answering part way`)
  if (!text.trim()) throw new Unanswered('line', `${name} answered with nothing`)
  return { text, model, ms: Math.round(performance.now() - began), cut, tokens }
}

/** Which of a provider's models are for words in and words out, by their names: the rest (speech, pictures, embeddings, video, legacy base) cannot make a thing. */
const WRITES = /^(?!.*(embed|tts|whisper|audio|speech|image|dall|moderation|realtime|transcribe|search|vision-preview|imagen|veo|lyria|sora|aqa|robotics|computer-use|guard|(^|[-_/.])live($|[-_/.]|\d)))(?!(babbage|davinci|curie|text-ada)\b)/i

const SMALL = /(^|[-_/.:])(mini|nano|lite|tiny|haiku|instant|small)\b/i
const PREVIEW = /(^|[-_/.:])(preview|exp|experimental|beta|alpha|dev)\b/i
const SPECIALIZED = /(^|[-_/.:])(cyber|codex|deep-research|research|instruct|chat-latest|chatgpt|oss|orchestrator|safeguard|shield|translator|rerank)\b/i

/** Strips a snapshot date or build number from a model id and reports whether one was there and its sortable date. */
function undated(id: string): { clean: string; dated: boolean; date: number } {
  let clean = id, dated = false, date = 0
  const take = (re: RegExp, toDate: (m: RegExpExecArray) => number) => {
    const m = re.exec(clean)
    if (!m) return
    dated = true
    date = Math.max(date, toDate(m))
    clean = clean.replace(re, '')
  }
  take(/(?:^|[-_/.])(20\d{2})-(\d{2})(?:-(\d{2}))?(?=$|[-_/.])/, (m) => Number(m[1]) * 10000 + Number(m[2]) * 100 + Number(m[3] ?? 0))
  take(/(?:^|[-_/.])(20\d{2})(\d{2})(\d{2})(?=$|[-_/.])/, (m) => Number(m[1]) * 10000 + Number(m[2]) * 100 + Number(m[3]))
  take(/(?:^|[-_/.])(0[1-9]|1[0-2])-(20\d{2})(?=$|[-_/.])/, (m) => Number(m[2]) * 10000 + Number(m[1]) * 100)
  take(/(?:^|[-_/.])(0[1-9]|1[0-2])-([0-3]\d)(?=$|[-_/.])/, (m) => Number(m[1]) * 100 + Number(m[2]))
  take(/(?:^|[-_/.])(0\d{2}|1106|0125|0613)(?=$|[-_/.])/, () => 0)
  return { clean, dated, date }
}

/**
 * Scores one provider's model id as a sortable tuple `[class, version, notDated, tier, date]` (higher is better):
 * newest general-purpose GA generation first, preferring balanced strong tiers over tiny, specialized, preview or dated copies.
 */
function scoreOne(route: Exclude<Route, 'openrouter'>, id: string): [number, number, number, number, number] {
  if (/^ft:/i.test(id)) return [0, 0, 0, 0, 0]
  const { clean, dated, date } = undated(id)
  const small = SMALL.test(clean), preview = PREVIEW.test(clean), specialized = SPECIALIZED.test(clean)
  const notDated = dated ? 0 : 1
  const clsOf = (main: boolean, secondary = false) =>
    specialized ? (preview ? 0 : 1)
      : preview ? (small ? 0 : main || secondary ? 2 : 0)
        : small ? (main || secondary ? 3 : 0)
          : main ? 5 : secondary ? 4 : 1

  if (route === 'openai') {
    const gpt = /^gpt-(\d+)(?:\.(\d+))?(o)?(?=$|[-_/.])/i.exec(clean)
    if (gpt) {
      const ver = Number(gpt[1]) * 100 + Math.min(Number(gpt[2] ?? 0), 99) + (gpt[3] ? 0.5 : 0)
      const tier = /(^|-)sol($|-)/i.test(clean) ? 5
        : /^gpt-\d+(\.\d+)?o?$/i.test(clean) ? 4
          : /(^|-)(astra|pro)($|-)/i.test(clean) ? 3
            : /(^|-)terra($|-)/i.test(clean) ? 1
              : /(^|-)luna($|-)/i.test(clean) ? 0
                : 2
      return [clsOf(true), ver, notDated, tier, date]
    }
    const o = /^o(\d+)(?:\.(\d+))?(?=$|[-_/.])/i.exec(clean)
    if (o) {
      const ver = Number(o[1]) * 100 + Math.min(Number(o[2] ?? 0), 99)
      return [clsOf(false, true), ver, notDated, /(^|-)pro($|-)/i.test(clean) ? 1 : 2, date]
    }
    return [clsOf(false), 0, notDated, 0, date]
  }

  if (route === 'anthropic') {
    if (/^claude-/i.test(clean)) {
      const v = /(?:^|-)(\d{1,2})(?:[.-](\d{1,2}))?(?=$|-)/.exec(clean)
      const ver = v ? Number(v[1]) * 100 + Math.min(Number(v[2] ?? 0), 99) : 0
      const tier = /opus/i.test(clean) ? 4 : /sonnet/i.test(clean) ? 3 : /fable/i.test(clean) ? 2 : 1
      const main = /(opus|sonnet|fable)/i.test(clean) || ver >= 400
      return [clsOf(main), ver, notDated, tier, date]
    }
    return [clsOf(false), 0, notDated, 0, date]
  }

  // Gemini
  if (/^gemini-/i.test(clean)) {
    const v = /^gemini-(\d+)(?:\.(\d+))?(?=$|[-_/.])/i.exec(clean)
    const ver = v ? Number(v[1]) * 100 + Math.min(Number(v[2] ?? 0), 99) : 0
    const tier = /(^|-)neon($|-)/i.test(clean) ? 5
      : /(^|-)pro($|-)/i.test(clean) ? 4
        : /(^|-)argon($|-)/i.test(clean) ? 3
          : /(^|-)carbon($|-)/i.test(clean) ? 2
            : /(^|-)(hydrogen|flash)($|-)/i.test(clean) ? 0
              : 1
    return [clsOf(true), ver, notDated, tier, date]
  }
  return [clsOf(false), 0, notDated, 0, date]
}

function rankOf(route: Route, id: string): number[] {
  if (route !== 'openrouter') return scoreOne(route, id)
  const slash = id.indexOf('/')
  const vendor = slash > 0 ? id.slice(0, slash).toLowerCase() : ''
  const rest = slash > 0 ? id.slice(slash + 1) : id
  const tagged = rest.includes(':')
  const slug = tagged ? rest.slice(0, rest.indexOf(':')) : rest
  const mapped: Exclude<Route, 'openrouter'> | null = vendor === 'anthropic' ? 'anthropic' : vendor === 'openai' ? 'openai' : vendor === 'google' ? 'gemini' : null
  if (mapped) {
    const [cls, ver, notDated, tier, date] = scoreOne(mapped, slug)
    const lab = mapped === 'anthropic' ? 3 : mapped === 'openai' ? 2 : 1
    return [tagged ? Math.min(cls, 2) : cls, lab, ver, notDated, tier, date]
  }
  if (vendor === 'openrouter') return [0, 0, 0, 1, 0, 0]
  const { clean, dated, date } = undated(slug)
  const cls = tagged || PREVIEW.test(clean) || SMALL.test(clean) || SPECIALIZED.test(clean) ? 0 : 1
  return [cls, 0, 0, dated ? 0 : 1, 0, date]
}

const compareRank = (a: number[], b: number[]): number => {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return b[i] - a[i]
  return 0
}

/** The model offered first for a provider's list: keeps `was` when still listed, otherwise picks the strongest recent default. */
export function preferred(route: Route, list: Listed[], was?: string): Listed | undefined {
  if (!list.length) return undefined
  if (was) { const kept = list.find((m) => m.id === was); if (kept) return kept }
  let best = list[0], bestRank = rankOf(route, best.id)
  for (let i = 1; i < list.length; i++) {
    const r = rankOf(route, list[i].id)
    if (compareRank(r, bestRank) < 0) { best = list[i]; bestRank = r }
  }
  return best
}

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
  let out: Listed[]
  if (route === 'anthropic') {
    out = (body.data ?? []).map((m: any) => ({ id: short(m.id), name: short(m.display_name ?? m.id) }))
  } else if (route === 'gemini') {
    out = (body.models ?? []).filter((m: any) => (m.supportedGenerationMethods ?? []).includes('generateContent') && WRITES.test(m.name)).map((m: any) => ({ id: short(m.name).replace(/^models\//, ''), name: short(m.displayName ?? m.name) })).reverse()
  } else {
    const listed = (body.data ?? []).filter((m: any) => WRITES.test(String(m.id)))
    // OpenAI lists in no order: newest first as the tie-breaker before ranking by generation and tier.
    if (route === 'openai') listed.sort((a: any, b: any) => (b.created ?? 0) - (a.created ?? 0))
    else if (listed.some((m: any) => typeof m.created === 'number')) listed.sort((a: any, b: any) => (b.created ?? 0) - (a.created ?? 0))
    out = listed.map((m: any) => ({ id: short(m.id), name: short(m.name ?? m.id) }))
  }
  const ranked = out.map((m) => ({ m, r: rankOf(route, m.id) }))
  ranked.sort((a, b) => compareRank(a.r, b.r))
  return ranked.map((x) => x.m)
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
