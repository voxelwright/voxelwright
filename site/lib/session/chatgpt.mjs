// ChatGPT data export → ai-session/1 (unredacted; the caller redacts before writing).
//
// Settings → Data controls → Export data mails a zip; its conversations.json is a list of
// conversations, each a tree: { title, mapping: { <node id>: { message, parent, children } },
// current_node }. The conversation as last seen is the path from current_node up to the root.
// A message is { author: { role, name }, content: { content_type, parts }, create_time,
// metadata: { model_slug } }.
//
// Untested against a real export: written from the published shape and checked only with the
// synthetic sample in test/session.test.mjs. Treat the first real import as a test.
import { FORMAT, makerOf, modelName } from "./format.mjs";

/**
 * @param {object[]} conversations  parsed conversations.json
 * @param {object} opts
 * @param {string} opts.pick         conversation id, or text its title contains
 */
export function importChatGPT(conversations, { pick, as = "Author" } = {}) {
  const list = Array.isArray(conversations) ? conversations : [conversations];
  const convo = list.find((c) => c.id === pick || c.conversation_id === pick) ?? list.find((c) => pick && (c.title ?? "").toLowerCase().includes(String(pick).toLowerCase())) ?? (list.length === 1 ? list[0] : null);
  if (!convo) throw new Error(`no conversation matches "${pick}"; pass an id or part of a title`);

  const path = [];
  for (let id = convo.current_node; id && convo.mapping?.[id]; id = convo.mapping[id].parent) path.unshift(convo.mapping[id]);

  const agents = [];
  const agentFor = (slug) => {
    const modelId = slug || "unknown";
    const found = agents.find((a) => a.modelId === modelId);
    if (found) return found.id;
    const id = `a${agents.length + 1}`;
    agents.push({ id, name: "ChatGPT", model: modelName(modelId), modelId, maker: makerOf(modelId) === "unknown" ? "OpenAI" : makerOf(modelId), role: "main" });
    return id;
  };
  const turns = [];
  let n = 0;
  const push = (t) => turns.push({ id: `t${++n}`, ...t });
  let lastModel = null;

  for (const node of path) {
    const m = node.message;
    if (!m || m.metadata?.is_visually_hidden_from_conversation) continue;
    const role = m.author?.role;
    const at = m.create_time ? new Date(m.create_time * 1000).toISOString() : undefined;
    const kind = m.content?.content_type;
    const text = kind === "text" || kind === "multimodal_text" ? (m.content.parts ?? []).filter((x) => typeof x === "string").join("\n").trim() : "";
    const images = kind === "multimodal_text" ? (m.content.parts ?? []).filter((x) => x && typeof x === "object").length : 0;
    if (role === "user" && (text || images)) push({ type: "prompt", by: "h", at, text, ...(images ? { images } : {}) });
    else if (role === "assistant") {
      lastModel = m.metadata?.model_slug ?? lastModel;
      if (kind === "code" || m.recipient && m.recipient !== "all") {
        const prev = turns.at(-1);
        const tool = { tool: m.recipient && m.recipient !== "all" ? m.recipient : "code" };
        if (prev?.type === "activity") prev.tools.push(tool);
        else push({ type: "activity", by: agentFor(lastModel), at, tools: [tool] });
      } else if (text) {
        push({ type: "reply", by: agentFor(lastModel), at, text });
      }
    } else if (role === "tool") {
      const prev = turns.at(-1);
      const tool = { tool: m.author?.name ?? "tool" };
      if (prev?.type === "activity") continue; // the call is already listed; its output is never kept
      push({ type: "activity", by: agentFor(lastModel), at, tools: [tool] });
    }
  }
  return {
    format: FORMAT,
    title: convo.title || "ChatGPT conversation",
    source: { app: "ChatGPT" },
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    people: [{ id: "h", name: as, role: "author" }],
    agents,
    turns,
  };
}
