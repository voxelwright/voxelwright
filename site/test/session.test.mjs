// The ai-session block: import, redaction, the build gate and the three renderings.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { importSession, trim } from "../lib/session/pipeline.mjs";
import { validateSession, parseTurnList } from "../lib/session/format.mjs";
import { makeRedactor, findLeaks } from "../lib/session/redact.mjs";
import { importChatGPT } from "../lib/session/chatgpt.mjs";
import { importCodex } from "../lib/session/codex.mjs";
import { cleanReport } from "../lib/session/claude-code.mjs";
import { sessionMarkdown, twinText } from "../lib/session/render.mjs";
import { build, ContentError } from "../generator/build.mjs";

const FIXTURE = path.join(import.meta.dirname, "fixtures/claude-code-decision.jsonl");
const SITE = (await import("../site.config.mjs")).default;

test("a Claude Code transcript imports with decisions, models per turn, and no thinking or tool output", () => {
  const { session } = importSession({ file: FIXTURE, as: "Mira" });
  assert.deepEqual(validateSession(session), []);
  const json = JSON.stringify(session);
  assert.doesNotMatch(json, /private reasoning|secret README contents|kitchen-sink/);
  const d = session.turns.find((t) => t.type === "decision");
  assert.equal(d.questions.length, 2);
  assert.deepEqual(d.questions[0].picked, ["Private git repo"]);
  assert.equal(d.questions[1].text, "Keep both until the spike measures them");
  assert.deepEqual(session.agents.map((a) => `${a.model}/${a.maker}`), ["Opus 5.5/Anthropic", "Fable 5.2/Anthropic"]);
  assert.equal(session.turns.at(-1).event, "interrupted");
  assert.ok(session.turns.some((t) => t.type === "event" && t.event === "model-switch"));
});

test("redaction runs before anything is returned: keys, emails, home paths and names", () => {
  const { session, report } = importSession({ file: FIXTURE, as: "Mira", names: { tester: "Mira" } });
  const json = JSON.stringify(session);
  assert.doesNotMatch(json, /sk-ant-|tester@example\.org|\/Users\/tester/);
  assert.match(json, /\[token\]/);
  assert.match(json, /\[email\]/);
  assert.ok(report.counts["api key"] >= 1 && report.counts.email >= 1);
  assert.deepEqual(findLeaks(session), []);
});

test("the redactor covers this machine's shapes", () => {
  const r = makeRedactor({ names: { Realname: "Mira" }, literals: ["the family flat on Elm"] });
  const out = r.text(
    [
      "/Users/someone/Developer/site and -Users-someone-Developer-site",
      "C:\\Users\\someone\\x",
      "https://box-1.tail00000.ts.net:10976/",
      "someones-macbook-pro.local",
      "Bearer abcdefghijklmnopqrstuvwxyz012345",
      "ghp_abcdefghijklmnopqrstuvwxyz0123456789",
      "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U",
      "password=hunter2hunter2",
      "Ask Realname about the family flat on Elm.",
      "token kJ8sD2fLq9ZxW3vB7nM4pR6tY1uI5oA0eH",
    ].join("\n"),
  );
  for (const bad of ["/Users/someone", "-Users-someone-", "C:\\Users", "ts.net", "macbook", "abcdefghijklmnop", "ghp_", "eyJhbGci", "hunter2", "Realname", "flat on Elm", "kJ8sD2fLq9"]) {
    assert.ok(!out.includes(bad), `left behind: ${bad}`);
  }
  assert.match(out, /~\/Developer\/site/);
  assert.match(out, /Ask Mira about/);
});

test("ordinary prose, versions and git hashes survive redaction", () => {
  const r = makeRedactor({ machine: false });
  const text = "Node 25.1.0 built commit bc6387cf6b24d3f4df44417088b760b53bda9bf5 in 460 ms at http://localhost:5976/blog/ — see `npm run check`.";
  assert.equal(r.text(text), text);
});

test("trim keeps turn ids stable and drops cut turns", () => {
  const { session } = importSession({ file: FIXTURE, as: "Mira" });
  const cut = trim(session, { cut: "t2" });
  assert.equal(cut.turns.find((t) => t.type === "reply").id, "t3");
  assert.ok(!cut.turns.some((t) => t.id === "t2"));
  assert.deepEqual([...parseTurnList("t3,7-9")], ["t3", "t7", "t8", "t9"]);
});

test("a subagent report loses the harness frame and usage footer", () => {
  const raw = "[Subagent hand-back] frame text. The report follows:\n  Line one.\n  - item\nagentId: abc (use SendMessage)\n<usage>tokens: 1</usage>";
  assert.equal(cleanReport(raw), "Line one.\n- item");
});

test("ChatGPT export: the current branch only, models and tools by name", () => {
  const convo = {
    id: "c1",
    title: "Synthetic",
    current_node: "n4",
    mapping: {
      n0: { message: null, parent: null },
      n1: { message: { author: { role: "user" }, content: { content_type: "text", parts: ["Hello?"] }, create_time: 1763300000 }, parent: "n0" },
      nx: { message: { author: { role: "assistant" }, content: { content_type: "text", parts: ["An abandoned branch."] }, metadata: { model_slug: "gpt-5" } }, parent: "n1" },
      n2: { message: { author: { role: "assistant" }, content: { content_type: "code", parts: ["print(1)"] }, recipient: "python", metadata: { model_slug: "gpt-5" } }, parent: "n1" },
      n3: { message: { author: { role: "tool", name: "python" }, content: { content_type: "execution_output", text: "1" } }, parent: "n2" },
      n4: { message: { author: { role: "assistant" }, content: { content_type: "text", parts: ["It printed one."] }, metadata: { model_slug: "gpt-5" } }, parent: "n3" },
    },
  };
  const s = importChatGPT([convo], { pick: "c1", as: "Mira" });
  assert.deepEqual(validateSession(s), []);
  assert.deepEqual(s.turns.map((t) => t.type), ["prompt", "activity", "reply"]);
  assert.equal(s.agents[0].maker, "OpenAI");
  assert.doesNotMatch(JSON.stringify(s), /abandoned|print\(1\)/);
});

test("Codex rollout: prompts, replies and tool calls; injected context is skipped", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-"));
  const file = path.join(dir, "rollout.jsonl");
  const rows = [
    { timestamp: "2026-11-04T18:07:20Z", type: "session_meta", payload: { cli_version: "0.0.1" } },
    { timestamp: "2026-11-04T18:07:21Z", type: "turn_context", payload: { model: "gpt-6.1" } },
    { timestamp: "2026-11-04T18:07:22Z", type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text: "<environment_context>cwd</environment_context>" }] } },
    { timestamp: "2026-11-04T18:07:23Z", type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text: "List the posts." }] } },
    { timestamp: "2026-11-04T18:07:24Z", type: "response_item", payload: { type: "reasoning", summary: [], encrypted_content: "x" } },
    { timestamp: "2026-11-04T18:07:25Z", type: "response_item", payload: { type: "function_call", name: "shell", arguments: JSON.stringify({ command: ["ls", "posts"] }) } },
    { timestamp: "2026-11-04T18:07:26Z", type: "response_item", payload: { type: "function_call_output", output: "kitchen-sink" } },
    { timestamp: "2026-11-04T18:07:27Z", type: "response_item", payload: { type: "message", role: "assistant", content: [{ type: "output_text", text: "One post." }] } },
  ];
  fs.writeFileSync(file, rows.map((r) => JSON.stringify(r)).join("\n"));
  const s = importCodex(file, { as: "Mira" });
  fs.rmSync(dir, { recursive: true, force: true });
  assert.deepEqual(validateSession(s), []);
  assert.deepEqual(s.turns.map((t) => t.type), ["prompt", "activity", "reply"]);
  assert.equal(s.turns[1].tools[0].label, "ls posts");
  assert.equal(s.agents[0].maker, "OpenAI");
  assert.doesNotMatch(JSON.stringify(s), /environment_context|kitchen-sink/);
});

test("the twin escapes tags, demotes headings and drops non-web links", () => {
  assert.equal(twinText("## Plan\nUse <model-note> and [x](file:///etc) and [y](https://a.example/)."), "**Plan**\n\nUse &lt;model-note> and x and [y](https://a.example/).");
  assert.equal(twinText("```html\n<model-note>\n```"), "```html\n<model-note>\n```");
});

// ---- the build -------------------------------------------------------------

async function buildWith(sessionJson, embed = `<ai-session src="s.session.json">`) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "site-session-"));
  const dir = path.join(root, "posts", "fixture");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "index.md"), `---\ntitle: Fixture\ndate: 2026-01-02\nsummary: "A fixture."\ntags: [test]\ndraft: false\n---\n\nBefore.\n\n${embed}\n\nAfter.\n`);
  fs.writeFileSync(path.join(dir, "s.session.json"), typeof sessionJson === "string" ? sessionJson : JSON.stringify(sessionJson));
  try {
    return await build({ outDir: path.join(root, "out"), postsDir: path.join(root, "posts"), site: SITE });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

const sample = () => importSession({ file: FIXTURE, as: "Mira" }).session;

test("a session block renders in the page, the twin and the feed", async () => {
  const { pages } = await buildWith(sample(), `<ai-session src="s.session.json" open="all">\n\n<ai-session src="s.session.json">`);
  const page = pages.find((p) => p.path === "/blog/fixture/");
  assert.match(page.html, /<ai-session src="\/blog\/fixture\/s\.session\.json"><figure class="ais"/);
  assert.match(page.html, /id="s-s-t1"/);
  assert.match(page.html, /id="s-s-2-t1"/, "a second block on the page gets its own ids");
  assert.equal(page.html.match(/ai-session\.css/g).length, 1, "assets come once per page");
  assert.match(page.html, /<p>After.<\/p>/);
  assert.match(page.markdown, /^\*\*AI session: Choosing the store\.\*\*/m);
  assert.match(page.markdown, /^> \*\*Mira, prompt 1:\*\* Where should posts live/m);
  assert.match(page.markdown, /\*Opus 5\.5 asked:\* Where should a published post be written first\?/);
  assert.doesNotMatch(page.markdown, /<ai-session/);
});

test("a session file with a leak, a bad shape or bad JSON fails the build", async () => {
  const leaky = sample();
  leaky.turns[0].text = "see /Users/someone/notes.txt";
  await assert.rejects(buildWith(leaky), (e) => e instanceof ContentError && /still contains home path/.test(e.message));
  const bad = sample();
  bad.turns[1].by = "nobody";
  await assert.rejects(buildWith(bad), (e) => e instanceof ContentError && /not a valid ai-session\/1 file/.test(e.message));
  await assert.rejects(buildWith("{nope"), (e) => e instanceof ContentError && /not valid JSON/.test(e.message));
});

test("turn text cannot inject markup", async () => {
  const s = sample();
  s.turns[0].text = '<script>alert(1)</script> [x](javascript:alert(1)) <img src=x onerror=alert(1)>';
  const { pages } = await buildWith(s);
  const html = pages.find((p) => p.path === "/blog/fixture/").html;
  assert.doesNotMatch(html, /<script>alert|href="javascript:|<img src=x/);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
});

test("the Markdown twin of the demo fixture names every model", () => {
  const s = sample();
  const md = sessionMarkdown(s, { src: "https://example.org/s.json" });
  assert.match(md, /Opus 5\.5 \(Anthropic\), Fable 5\.2 \(Anthropic\)/);
});

test("secrets in env files, JSON and command flags are redacted and caught by the gate", () => {
  const r = makeRedactor({ machine: false });
  for (const s of ["DB_PASSWORD=hunter2hunter", '{"password": "hunter2hunter"}', "--password hunter2hunter", "export OPENAI_API_KEY=abc123xyz789", "MY_TOKEN=abcdef123456"]) {
    assert.ok(findLeaks(s).length, `gate missed ${s}`);
    assert.doesNotMatch(r.text(s), /hunter2|abc123xyz|abcdef123456/);
  }
  assert.equal(r.text("the password protects everything"), "the password protects everything");
  assert.deepEqual(findLeaks("call +1 415 555 0134 at 203.0.113.7").sort(), ["ip address", "phone"]);
});

test("a session src outside the post folder fails the build", async () => {
  await assert.rejects(buildWith(sample(), `<ai-session src="../s.session.json">`), (e) => e instanceof ContentError && /must be a file in the post folder/.test(e.message));
});
