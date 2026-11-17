// ai-session/1 → HTML for pages, simpler HTML for the feed, and Markdown for the twins.
//
// The page version reads like a code block: a gutter of exchange numbers that are links (as line
// numbers are), the person's prompts in the author's face, the agents' words in the look's
// model face, and the machinery (tool calls, subagents) folded away. It is complete without
// JavaScript; static/ai-session.js only adds "expand all", hiding tool activity and opening the
// right fold when someone follows a link to a turn.
//
// Turn text is Markdown rendered with its own parser: no raw HTML, no headings (they would land
// in the post's outline), and only http(s) links, since a session's links point at someone
// else's machine as often as not.
import MarkdownIt from "markdown-it";
import { exchanges, sessionStats } from "./format.mjs";

const esc = (s) =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const SAFE_LINK = /^https?:\/\//i;

/** A Markdown parser for turn text. `highlight` is the site's code highlighter, if given. */
function turnMarkdown(highlight) {
  const md = new MarkdownIt({ html: false, linkify: false, typographer: true, ...(highlight ? { highlight } : {}) });
  md.validateLink = (url) => SAFE_LINK.test(url.trim());
  md.renderer.rules.heading_open = () => `<p class="ais-h"><strong>`;
  md.renderer.rules.heading_close = () => `</strong></p>\n`;
  md.renderer.rules.image = (tokens, idx) => esc(tokens[idx].content ? `[image: ${tokens[idx].content}]` : "[image]");
  md.renderer.rules.link_open = (tokens, idx, opts, env, self) => {
    tokens[idx].attrSet("rel", "nofollow noopener");
    return self.renderToken(tokens, idx, opts);
  };
  md.renderer.rules.table_open = () => `<div class="ais-table"><table>\n`;
  md.renderer.rules.table_close = () => `</table></div>\n`;
  // Prompts are typed text: keep their line breaks.
  const prompt = new MarkdownIt({ html: false, linkify: false, typographer: true, breaks: true, ...(highlight ? { highlight } : {}) });
  prompt.validateLink = md.validateLink;
  prompt.renderer.rules = md.renderer.rules;
  return { md, prompt };
}

/** Plain text of a Markdown string's first sentence, for a folded exchange's summary line. */
export function gist(text, max = 150) {
  const plain = String(text ?? "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/^\s*(#+|[-*+]|\d+\.|>|\|)\s*/gm, "")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[*_`~]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const sentence = /^(.{20,}?[.!?])(\s|$)/.exec(plain)?.[1] ?? plain;
  return sentence.length > max ? sentence.slice(0, max - 1).trimEnd() + "…" : sentence;
}

function clock(iso, tz) {
  if (!iso) return "";
  try {
    return new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: tz || "UTC" }).format(new Date(iso));
  } catch {
    return new Date(iso).toISOString().slice(11, 16);
  }
}
function day(iso, tz) {
  if (!iso) return "";
  try {
    return new Intl.DateTimeFormat("en", { year: "numeric", month: "long", day: "numeric", timeZone: tz || "UTC" }).format(new Date(iso));
  } catch {
    return iso.slice(0, 10);
  }
}
function minutes(a, b) {
  if (!a || !b) return null;
  const m = Math.round((Date.parse(b) - Date.parse(a)) / 60000);
  if (m < 1) return null;
  return m < 90 ? `${m} min` : `${Math.round(m / 6) / 10} h`.replace(".0 h", " h");
}
const plural = (n, one, many = one + "s") => `${n} ${n === 1 ? one : many}`;

/** "Shell 4, Read 2, Web search" */
function toolCounts(tools) {
  const counts = new Map();
  for (const t of tools) counts.set(t.tool, (counts.get(t.tool) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1]).map(([name, n]) => (n > 1 ? `${name} ${n}` : name)).join(", ");
}

/** "Opus 5.5 (Anthropic) and Sonnet 5.5 (Anthropic) in 2 subagents" */
function whoLine(session, stats) {
  const person = session.people[0]?.name ?? "Someone";
  const main = stats.agents.filter((a) => a.role !== "subagent");
  const subs = stats.agents.filter((a) => a.role === "subagent");
  const label = (a) => `<strong>${esc(a.model)}</strong> (${esc(a.maker)})`;
  const subModels = [...new Map(subs.map((a) => [a.modelId, a])).values()];
  let s = `${esc(person)} with ${main.map(label).join(" and ") || "an agent"}`;
  if (subModels.length) s += `, helped by ${subModels.map(label).join(" and ")} in ${plural(subs.length, "subagent")}`;
  const app = session.source?.app ? ` in ${esc(session.source.app)}` : "";
  return s + app;
}

/**
 * @param {object} session        a valid ai-session/1
 * @param {object} opts
 * @param {string} opts.id        unique on the page; anchors are `${id}-t12`
 * @param {string} [opts.src]     the session file's URL, for the element and the data link
 * @param {Set<number>|"all"} [opts.open]  exchanges shown unfolded (1-based); default: the first
 * @param {string} [opts.caption] replaces the session's title
 * @param {Function} [opts.highlight]  code highlighter for fences in turn text
 */
export function sessionHtml(session, opts) {
  const { md, prompt } = turnMarkdown(opts.highlight);
  const stats = sessionStats(session);
  const tz = session.timezone;
  const agents = Object.fromEntries(session.agents.map((a) => [a.id, a]));
  const people = Object.fromEntries(session.people.map((p) => [p.id, p]));
  const id = opts.id;
  const anchor = (t) => `${id}-${t.id}`;
  const groups = exchanges(session);
  const open = opts.open ?? new Set([1]);
  const title = opts.caption || session.title;

  const facts = [
    plural(stats.prompts, "prompt"),
    plural(stats.replies, "reply", "replies"),
    stats.decisions ? plural(stats.decisions, "decision") : null,
    stats.subagents ? plural(stats.subagents, "subagent") : null,
    stats.tools ? plural(stats.tools, "tool call") : null,
    minutes(stats.start, stats.end),
  ].filter(Boolean);

  const modelBy = (a, extra = "") =>
    `<p class="ais-by ais-by-model"><span class="ais-model">${esc(a.model)}</span><span class="ais-maker">${esc(a.maker === "unknown" ? "maker unknown" : a.maker)}</span>${extra}</p>`;
  const permalink = (t, label) => `<a class="ais-perma" href="#${anchor(t)}" aria-label="${esc(label)}">#</a>`;

  const turnHtml = (t) => {
    const time = t.at ? `<time datetime="${esc(t.at)}">${clock(t.at, tz)}</time>` : "";
    switch (t.type) {
      case "reply": {
        const a = agents[t.by];
        return `<div class="ais-turn ais-reply" id="${anchor(t)}">${modelBy(a, time + permalink(t, `Link to this reply from ${a.model}`))}<div class="ais-text ais-model-text">${md.render(t.text)}</div></div>`;
      }
      case "activity":
        return `<details class="ais-turn ais-act" id="${anchor(t)}"><summary><span class="ais-act-n">${plural(t.tools.length, "tool call")}</span><span class="ais-act-list">${esc(toolCounts(t.tools))}</span></summary><ol class="ais-tools">${t.tools.map((x) => `<li><span class="ais-tool">${esc(x.tool)}</span><span class="ais-label">${esc(x.label ?? "")}</span></li>`).join("")}</ol></details>`;
      case "subagent": {
        const a = agents[t.agent];
        const status = t.status && t.status !== "completed" ? `<span class="ais-status">${esc(t.status)}</span>` : "";
        return (
          `<details class="ais-turn ais-sub" id="${anchor(t)}"><summary><span class="ais-sub-kind">Subagent on ${esc(a.model)}</span><span class="ais-sub-task">${esc(t.task)}</span>${status}<span class="ais-act-list">${t.tools?.length ? plural(t.tools.length, "tool call") : ""}</span></summary>` +
          `<div class="ais-sub-body">${t.tools?.length ? `<p class="ais-sub-tools">${esc(toolCounts(t.tools))}</p>` : ""}${t.report ? `${modelBy(a, `<span class="ais-maker">reported back</span>`)}<div class="ais-text ais-model-text">${md.render(t.report)}</div>` : `<p class="ais-sub-tools">No report kept.</p>`}</div></details>`
        );
      }
      case "decision": {
        const a = agents[t.by];
        const person = session.people[0]?.name ?? "The person";
        const qs = t.questions
          .map((q) => {
            const opts = q.options
              .map((o) => {
                const on = q.picked.includes(o.label);
                return `<li${on ? ` class="ais-picked"` : ""}><span class="ais-opt">${esc(o.label)}${on ? `<span class="ais-chosen"> (chosen)</span>` : ""}</span>${o.description ? `<span class="ais-opt-d">${esc(o.description)}</span>` : ""}</li>`;
              })
              .join("");
            const typed = q.text ? `<p class="ais-typed"><span>${esc(person)} wrote</span> ${esc(q.text)}</p>` : "";
            const note = q.note ? `<p class="ais-typed"><span>Note</span> ${esc(q.note)}</p>` : "";
            const none = q.unanswered ? `<p class="ais-typed"><span>Not answered</span></p>` : "";
            return `<div class="ais-q">${q.header ? `<p class="ais-q-head">${esc(q.header)}</p>` : ""}<p class="ais-q-text">${esc(q.question)}</p><ul class="ais-opts">${opts}</ul>${typed}${note}${none}</div>`;
          })
          .join("");
        return `<div class="ais-turn ais-decision" id="${anchor(t)}">${modelBy(a, `<span class="ais-maker">asked, ${esc(person)} chose</span>${time}${permalink(t, "Link to this decision")}`)}${qs}</div>`;
      }
      case "event": {
        const text = t.event === "command" ? `${esc(session.people[0]?.name ?? "The person")} ran <code>${esc(t.text)}</code>` : esc(t.text ?? t.event);
        return `<p class="ais-turn ais-event" id="${anchor(t)}">${text}</p>`;
      }
      default:
        return "";
    }
  };

  let promptNo = 0;
  const items = groups.map((g, i) => {
    const n = g.prompt ? ++promptNo : 0;
    const p = g.prompt;
    const person = p ? people[p.by] : null;
    const replies = g.rest.filter((t) => t.type === "reply");
    const lead = replies.at(-1) ?? g.rest.find((t) => t.type === "decision" || t.type === "subagent");
    const leadAgent = lead ? agents[lead.by] : null;
    const speakers = [...new Set(g.rest.filter((t) => t.type === "reply" || t.type === "decision").map((t) => agents[t.by].model))];
    const tools = g.rest.reduce((k, t) => k + (t.type === "activity" ? t.tools.length : 0), 0);
    const subs = g.rest.filter((t) => t.type === "subagent").length;
    const sumFacts = [subs ? plural(subs, "subagent") : null, tools ? plural(tools, "tool call") : null].filter(Boolean).join(", ");
    const isOpen = open === "all" || open.has(n || i + 1);
    const gistText = lead?.type === "reply" ? gist(lead.text) : lead?.type === "decision" ? gist(lead.questions[0].question) : lead?.type === "subagent" ? `Subagent: ${lead.task}` : "";
    const answer = g.rest.length
      ? `<details class="ais-answer"${isOpen ? " open" : ""}><summary><span class="ais-sum-who">${esc(speakers.join(", ") || (leadAgent ? leadAgent.model : "Agent"))}${sumFacts ? `<span class="ais-sum-facts">${esc(sumFacts)}</span>` : ""}</span><span class="ais-gist">${esc(gistText)}</span></summary><div class="ais-turns">${g.rest.map(turnHtml).join("")}</div></details>`
      : "";
    const head = p
      ? `<div class="ais-prompt"><p class="ais-by ais-by-person"><span class="ais-name">${esc(person?.name ?? "Person")}</span>${p.queued ? `<span class="ais-maker">sent while the agent worked</span>` : ""}${p.at ? `<time datetime="${esc(p.at)}">${clock(p.at, tz)}</time>` : ""}</p><div class="ais-text ais-person-text">${prompt.render(p.text)}${p.images ? `<p class="ais-note">${plural(p.images, "image")} attached, not included.</p>` : ""}</div></div>`
      : "";
    return `<li class="ais-ex" id="${p ? anchor(p) : `${id}-x${i + 1}`}"><a class="ais-num" href="#${p ? anchor(p) : `${id}-x${i + 1}`}" aria-label="Prompt ${n}, link">${n || ""}</a><div class="ais-ex-body">${head}${answer}</div></li>`;
  });

  return (
    `<figure class="ais" aria-labelledby="${id}-title" data-ais="${esc(id)}">` +
    `<figcaption class="ais-head">` +
    `<p class="ais-title" id="${id}-title"><span class="ais-kind">AI session</span> ${esc(title)}</p>` +
    `<p class="ais-who">${whoLine(session, stats)}.</p>` +
    `<p class="ais-facts">${esc(facts.join(", "))}${stats.start ? `, <time datetime="${esc(stats.start)}">${day(stats.start, tz)}</time>` : ""}.${opts.src ? ` <a class="ais-data" href="${esc(opts.src)}" type="application/json">Session data</a>` : ""}</p>` +
    `<div class="ais-controls" hidden><button type="button" class="ais-btn" data-ais-expand aria-pressed="false">Expand all</button><button type="button" class="ais-btn" data-ais-tools aria-pressed="true">Tool activity</button></div>` +
    `</figcaption>` +
    `<ol class="ais-log">${items.join("")}</ol>` +
    `</figure>`
  );
}

/**
 * The feed's version: no folds, no controls, no classes a reader would need CSS for. Prompts
 * and replies in full; tool activity as one line each.
 */
export function sessionFeedHtml(session, { src, caption, highlight }) {
  const { md, prompt } = turnMarkdown(highlight);
  const stats = sessionStats(session);
  const agents = Object.fromEntries(session.agents.map((a) => [a.id, a]));
  const person = session.people[0]?.name ?? "Person";
  const out = [];
  let n = 0;
  for (const t of session.turns) {
    if (t.type === "prompt") out.push(`<p><strong>${esc(person)}, prompt ${++n}:</strong></p><blockquote>${prompt.render(t.text)}</blockquote>`);
    else if (t.type === "reply") out.push(`<p><strong>${esc(agents[t.by].model)} (${esc(agents[t.by].maker)}):</strong></p>${md.render(t.text)}`);
    else if (t.type === "activity") out.push(`<p><em>${plural(t.tools.length, "tool call")}: ${esc(toolCounts(t.tools))}.</em></p>`);
    else if (t.type === "subagent") out.push(`<p><em>Subagent on ${esc(agents[t.agent].model)}: ${esc(t.task)}.</em></p>${t.report ? `<blockquote>${md.render(t.report)}</blockquote>` : ""}`);
    else if (t.type === "decision")
      for (const q of t.questions) out.push(`<p><strong>${esc(agents[t.by].model)} asked:</strong> ${esc(q.question)} <strong>${esc(person)} chose:</strong> ${esc(q.picked.join(", ") || q.text || "no answer")}.</p>`);
    else if (t.type === "event") out.push(`<p><em>${esc(t.event === "command" ? `${person} ran ${t.text}` : t.text ?? t.event)}</em></p>`);
  }
  return `<figure><figcaption><strong>AI session: ${esc(caption || session.title)}.</strong> ${esc(`${plural(stats.prompts, "prompt")}, ${plural(stats.replies, "reply", "replies")}, ${plural(stats.tools, "tool call")}.`)}${src ? ` <a href="${esc(src)}">Session data</a>.` : ""}</figcaption>${out.join("\n")}</figure>`;
}

/** Markdown for the twin and llms: every prompt and reply, labelled, with tool activity as one line. */
export function sessionMarkdown(session, { src, caption }) {
  const stats = sessionStats(session);
  const agents = Object.fromEntries(session.agents.map((a) => [a.id, a]));
  const person = session.people[0]?.name ?? "Person";
  const models = stats.agents.map((a) => `${a.model} (${a.maker})${a.role === "subagent" ? " as a subagent" : ""}`);
  const uniqueModels = [...new Set(models)];
  const lines = [
    `**AI session: ${caption || session.title}.** ${person} with ${uniqueModels.join(", ")}${session.source?.app ? `, in ${session.source.app}` : ""}. ${plural(stats.prompts, "prompt")}, ${plural(stats.replies, "reply", "replies")}, ${plural(stats.tools, "tool call")}${stats.start ? `, ${day(stats.start, session.timezone)}` : ""}.${src ? ` Data: [${src.split("/").pop()}](${src}).` : ""}`,
    "",
  ];
  const quote = (label, text) => {
    const body = twinText(text).split("\n");
    const first = body[0] && !/^([#>*+-]|\d+\.|```|~~~|\|)/.test(body[0]) ? [`${label} ${body[0]}`, ...body.slice(1)] : [label, "", ...body];
    return first.map((l) => (l ? `> ${l}` : ">")).join("\n");
  };
  let n = 0;
  // Prompts are typed text: keep their line breaks as hard breaks.
  const typed = (s) => s.replace(/([^\n])\n(?=[^\n])/g, "$1\\\n");
  for (const t of session.turns) {
    if (t.type === "prompt") lines.push(quote(`**${person}, prompt ${++n}:**`, typed(t.text)), "");
    else if (t.type === "reply") lines.push(quote(`**${agents[t.by].model} (${agents[t.by].maker}):**`, t.text), "");
    else if (t.type === "activity") lines.push(`*${plural(t.tools.length, "tool call")}: ${toolCounts(t.tools)}.*`, "");
    else if (t.type === "subagent") lines.push(`*Subagent on ${agents[t.agent].model}: ${twinText(t.task)}.*`, "", ...(t.report ? [quote(`**${agents[t.agent].model} reported:**`, t.report), ""] : []));
    else if (t.type === "decision")
      for (const q of t.questions) lines.push(`*${agents[t.by].model} asked:* ${twinText(q.question)} *Options:* ${q.options.map((o) => o.label).join("; ")}. *${person} chose:* ${q.picked.join(", ") || twinText(q.text ?? "") || "no answer"}.`, "");
    else if (t.type === "event") lines.push(`*${t.event === "command" ? `${person} ran \`${t.text}\`` : twinText(t.text ?? t.event)}*`, "");
  }
  return lines.join("\n").trim();
}

/**
 * Turn text made safe for a Markdown twin: headings become bold lines, links that are not
 * http(s) keep only their text, images become their alt text, and raw tags outside code are
 * escaped so no reader mistakes them for markup.
 */
export function twinText(text) {
  let fence = null;
  return String(text ?? "")
    .split("\n")
    .map((line) => {
      const f = /^\s*(```|~~~)/.exec(line);
      if (f) {
        if (!fence) fence = f[1];
        else if (f[1] === fence) fence = null;
        return line;
      }
      if (fence) return line;
      return line
        .split(/(`+[^`]*`+)/)
        .map((part, i) => {
          if (i % 2 === 1) return part;
          return part
            .replace(/^(\s*)#{1,6}\s+(.*)$/, "$1**$2**\n")
            .replace(/!\[([^\]]*)\]\([^)]*\)/g, (_, alt) => (alt ? `[image: ${alt}]` : "[image]"))
            .replace(/\[([^\]]+)\]\(([^)\s]+)[^)]*\)/g, (m, label, url) => (SAFE_LINK.test(url) ? m : label))
            .replace(/<(?=[A-Za-z/!])/g, "&lt;");
        })
        .join("");
    })
    .join("\n");
}
