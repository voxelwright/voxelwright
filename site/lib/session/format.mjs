// The portable AI-session format, "ai-session/1". One JSON file per session, stored beside the
// post that shows it. The spec, with an example, is notes/ai-session-format.md.
//
// A session is an ordered list of turns. Each turn has a stable id ("t1", "t2", …) given at
// import and never renumbered, so links to a turn survive when the author cuts other turns.
//
//   prompt    what a person typed                         { by, text, images? }
//   reply     what an agent answered                      { by, text }
//   decision  an agent asked, a person chose               { by, questions: [{ header, question, multi, options, picked, text, note }] }
//   activity  a run of tool calls, by name and label only  { by, tools: [{ tool, label }] }
//   subagent  a helper agent's task and what it returned   { by, agent, task, tools, report, status }
//   event     a marker: context compacted, a slash command, an interruption   { event, text }
//
// Agents are listed once in `agents` with the model and its maker; every reply, decision,
// activity and subagent turn names its agent with `by` (and `agent` for the helper itself),
// so a session that switched models, or used several makers, says who wrote each turn.
// Thinking, tool output and attached images are never part of the format.

export const FORMAT = "ai-session/1";
export const TURN_TYPES = ["prompt", "reply", "decision", "activity", "subagent", "event"];
export const EVENTS = ["compacted", "command", "interrupted", "model-switch"];

const MAKERS = [
  [/^claude-|^(opus|sonnet|haiku|fable)\b/i, "Anthropic"],
  [/^(gpt|o\d|chatgpt|codex)/i, "OpenAI"],
  [/^gemini/i, "Google"],
  [/^(llama|meta-)/i, "Meta"],
  [/^(mistral|codestral|devstral)/i, "Mistral"],
  [/^(grok)/i, "xAI"],
  [/^(deepseek)/i, "DeepSeek"],
  [/^(qwen)/i, "Alibaba"],
];

/** The company that makes a model, from its id; "unknown" when we can't tell. */
export function makerOf(modelId) {
  for (const [re, maker] of MAKERS) if (re.test(modelId || "")) return maker;
  return "unknown";
}

/** "claude-opus-5-5" → "Opus 5.5", "claude-sonnet-4-5-20250929" → "Sonnet 4.5"; others pass through. */
export function modelName(modelId) {
  const m = /^claude-([a-z]+)-(\d+)(?:-(\d{1,2}))?(?:-\d{8})?$/.exec(modelId || "");
  if (m) return `${m[1][0].toUpperCase()}${m[1].slice(1)} ${m[2]}${m[3] ? "." + m[3] : ""}`;
  const g = /^gpt-(.+)$/i.exec(modelId || "");
  if (g) return `GPT-${g[1]}`;
  return modelId || "unknown model";
}

/**
 * Checks a parsed session. Returns a list of problems (empty when valid). Strict on shape,
 * because the build renders whatever passes and the editor will write these files too.
 */
export function validateSession(s) {
  const errors = [];
  const err = (msg) => errors.push(msg);
  if (!s || typeof s !== "object") return ["not a JSON object"];
  if (s.format !== FORMAT) err(`format must be "${FORMAT}"`);
  if (typeof s.title !== "string" || !s.title.trim()) err("title is required");
  if (!Array.isArray(s.people) || !s.people.length) err("people must list at least one person");
  if (!Array.isArray(s.agents) || !s.agents.length) err("agents must list at least one agent");
  if (!Array.isArray(s.turns) || !s.turns.length) err("turns must not be empty");
  if (s.timezone != null) {
    try {
      new Intl.DateTimeFormat("en", { timeZone: s.timezone });
    } catch {
      err(`timezone "${s.timezone}" is not an IANA time zone`);
    }
  }
  if (errors.length) return errors;

  const people = new Set();
  for (const p of s.people) {
    if (!/^[a-z][\w-]*$/.test(p.id ?? "")) err(`person id "${p.id}" must be a short word`);
    if (typeof p.name !== "string" || !p.name.trim()) err(`person ${p.id} needs a name`);
    people.add(p.id);
  }
  const agents = new Set();
  for (const a of s.agents) {
    if (!/^[a-z][\w-]*$/.test(a.id ?? "")) err(`agent id "${a.id}" must be a short word`);
    if (people.has(a.id) || agents.has(a.id)) err(`id "${a.id}" is used twice`);
    for (const k of ["name", "model", "maker"]) if (typeof a[k] !== "string" || !a[k].trim()) err(`agent ${a.id} needs ${k}`);
    agents.add(a.id);
  }

  const ids = new Set();
  let prompts = 0;
  for (const [i, t] of s.turns.entries()) {
    const where = `turn ${t?.id ?? i + 1}`;
    if (!t || typeof t !== "object") {
      err(`${where} is not an object`);
      continue;
    }
    if (!/^t\d+$/.test(t.id ?? "")) err(`${where}: id must look like "t12"`);
    if (ids.has(t.id)) err(`${where}: duplicate id`);
    ids.add(t.id);
    if (!TURN_TYPES.includes(t.type)) err(`${where}: unknown type "${t.type}"`);
    if (t.at != null && Number.isNaN(Date.parse(t.at))) err(`${where}: at must be an ISO time`);
    const text = (k) => typeof t[k] === "string" && t[k].trim();
    switch (t.type) {
      case "prompt":
        prompts++;
        if (!people.has(t.by)) err(`${where}: by must name a person`);
        if (!text("text") && !t.images) err(`${where}: a prompt needs text`);
        break;
      case "reply":
        if (!agents.has(t.by)) err(`${where}: by must name an agent`);
        if (!text("text")) err(`${where}: a reply needs text`);
        break;
      case "decision":
        if (!agents.has(t.by)) err(`${where}: by must name an agent`);
        if (!Array.isArray(t.questions) || !t.questions.length) err(`${where}: a decision needs questions`);
        for (const q of t.questions ?? []) {
          if (typeof q.question !== "string" || !q.question.trim()) err(`${where}: every question needs its text`);
          if (!Array.isArray(q.options)) err(`${where}: every question needs options`);
          if (!Array.isArray(q.picked)) err(`${where}: picked must be a list (empty when the person typed an answer)`);
        }
        break;
      case "activity":
        if (!agents.has(t.by)) err(`${where}: by must name an agent`);
        if (!Array.isArray(t.tools) || !t.tools.length) err(`${where}: activity needs tools`);
        for (const x of t.tools ?? []) if (typeof x.tool !== "string") err(`${where}: every tool needs a name`);
        break;
      case "subagent":
        if (!agents.has(t.by)) err(`${where}: by must name the agent that started it`);
        if (!agents.has(t.agent)) err(`${where}: agent must name the subagent`);
        if (!text("task")) err(`${where}: a subagent needs its task`);
        break;
      case "event":
        if (!EVENTS.includes(t.event)) err(`${where}: event must be one of ${EVENTS.join(", ")}`);
        break;
    }
  }
  if (!prompts) err("a session needs at least one prompt");
  return errors;
}

/** Counts for the block's header and the text fallbacks. */
export function sessionStats(s) {
  const by = (type) => s.turns.filter((t) => t.type === type);
  const tools = [...by("activity"), ...by("subagent")].reduce((n, t) => n + (t.tools?.length ?? 0), 0);
  const times = s.turns.map((t) => t.at).filter(Boolean).sort();
  const used = new Set(s.turns.flatMap((t) => [t.by, t.agent]).filter(Boolean));
  return {
    prompts: by("prompt").length,
    replies: by("reply").length,
    decisions: by("decision").length,
    subagents: by("subagent").length,
    tools,
    start: times[0] ?? null,
    end: times.at(-1) ?? null,
    agents: s.agents.filter((a) => used.has(a.id)),
  };
}

/**
 * Groups turns into exchanges: a prompt and everything up to the next prompt. Turns before the
 * first prompt (rare: a resumed session) form an exchange with no prompt.
 */
export function exchanges(s) {
  const out = [];
  let cur = null;
  for (const t of s.turns) {
    if (t.type === "prompt" || !cur) {
      cur = { prompt: t.type === "prompt" ? t : null, rest: [] };
      out.push(cur);
      if (t.type === "prompt") continue;
    }
    cur.rest.push(t);
  }
  return out;
}

/** Parses "t3,t7-t9" (or "3,7-9") into a Set of turn ids. */
export function parseTurnList(spec) {
  const ids = new Set();
  for (const part of String(spec || "").split(",").map((p) => p.trim()).filter(Boolean)) {
    const m = /^t?(\d+)(?:\s*-\s*t?(\d+))?$/.exec(part);
    if (!m) throw new Error(`"${part}" is not a turn id or range (t3, t7-t9)`);
    const a = Number(m[1]);
    const b = m[2] ? Number(m[2]) : a;
    for (let n = Math.min(a, b); n <= Math.max(a, b); n++) ids.add(`t${n}`);
  }
  return ids;
}
