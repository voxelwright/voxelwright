// Markdown → HTML for pages and feed, and Markdown → Markdown for the agent twins.
// One markdown-it parse feeds both, so embeds are understood the same way in each.
import fs from "node:fs";
import path from "node:path";
import MarkdownIt from "markdown-it";
import { createHighlighter } from "shiki";
import { validateSession } from "../lib/session/format.mjs";
import { findLeaks } from "../lib/session/redact.mjs";
import { sessionHtml, sessionFeedHtml, sessionMarkdown } from "../lib/session/render.mjs";
import { sitePath } from "../lib/paths.mjs";

const LANGS = ["ts", "tsx", "js", "jsx", "json", "bash", "shell", "html", "css", "md", "yaml", "toml", "rust", "python", "glsl", "wgsl", "diff", "sql"];
// Code on a page is shown in the instrument's code window, which is dark by day and at night,
// so pages take one dark theme (every token at 4.5:1 or more on the window, comments lifted). The feed keeps the
// GitHub pair as inline light-dark() colours, so feed readers show colour without the site's CSS.
export const PAGE_CODE = "everforest-dark";
export const BASELINE_CODE = ["github-light", "github-dark"];
const THEMES = [...BASELINE_CODE, PAGE_CODE];
const highlighter = await createHighlighter({ themes: THEMES, langs: LANGS });
const loadedLangs = new Set(highlighter.getLoadedLanguages());

/**
 * The custom elements a post may use. `required` attributes must be present and non-empty;
 * `equivalent` embeds need alt text or a poster (or both); `files` are resolved against the
 * post folder and must exist.
 */
export const EMBEDS = {
  "engine-scene": { required: ["src"], equivalent: true, bodiless: true, files: ["src", "poster"] },
  "model-compare": { required: ["before", "after"], equivalent: true, bodiless: true, files: ["before", "after", "poster"] },
  "model-note": { required: ["model", "maker"], files: [] },
  // A session's text equivalent is the session itself, so it needs no alt or poster.
  "ai-session": { required: ["src"], bodiless: true, files: ["src"] },
};
const EMBED_NAMES = Object.keys(EMBEDS);
const EMBED_START = new RegExp(`^<(${EMBED_NAMES.join("|")})(?=[\\s>/]|$)`);
const EMBED_ANYWHERE = new RegExp(`<(${EMBED_NAMES.join("|")})(?=[\\s>/])`);

export class ContentError extends Error {}

/**
 * Renders one post body.
 * @param {string} source  Markdown body (front matter removed).
 * @param {object} ctx     { file, lineOffset, dir, basePath, origin, base } (base: the site's mount, lib/paths.mjs)
 * @returns {{ html: string, feedHtml: string, markdown: string, errors: string[] }}
 */
export function renderPost(source, ctx) {
  const errors = [];
  const env = { ctx, errors, absolute: false };
  const tokens = md.parse(source, env);
  findStrayEmbeds(tokens, ctx, errors);
  let html;
  try {
    codeOptions = PAGE_CODE_OPTIONS;
    html = md.renderer.render(tokens, md.options, env);
  } finally {
    codeOptions = FEED_CODE;
  }
  const feedHtml = md.renderer.render(tokens, md.options, { ...env, absolute: true });
  const markdown = toMarkdown(source, tokens, ctx);
  return { html, feedHtml, markdown, errors };
}

/** Renders a short Markdown string (no embeds expected), e.g. the home page intro. */
export function renderInline(text) {
  // Relative links resolve from the site root, as on the home page.
  return md.renderInline(text, { ctx: { basePath: "/", origin: "" }, errors: [], absolute: false });
}

const FEED_CODE = { themes: { light: BASELINE_CODE[0], dark: BASELINE_CODE[1] }, defaultColor: "light-dark()" };
// The window paints its own glass: the theme gives the words their colours and nothing else.
const PAGE_CODE_OPTIONS = {
  theme: PAGE_CODE,
  // the theme's comment grey is 4.1:1 on the window's lighter edge; its next grey up passes
  colorReplacements: { "#859289": "#9da9a0" },
  transformers: [{ pre(node) { delete node.properties.style; node.properties.role = "region"; node.properties["aria-label"] = this.options.lang && this.options.lang !== "text" ? `Code (${this.options.lang})` : "Code"; } }],
};
let codeOptions = FEED_CODE;

const md = new MarkdownIt({
  html: true,
  linkify: false,
  typographer: true,
  highlight(code, lang) {
    const language = (lang || "").trim().toLowerCase();
    const onPage = codeOptions === PAGE_CODE_OPTIONS;
    const html = loadedLangs.has(language)
      ? highlighter.codeToHtml(code, { lang: language, ...codeOptions })
      : `<pre class="shiki"${onPage ? ' tabindex="0" role="region" aria-label="Code"' : ""}><code>${escapeHtml(code)}</code></pre>`;
    // on a page, code is set into the kit's code block: a recess, a level below the reading surface
    return onPage ? `<div class="vx-code vx-recess">${html}</div>` : html;
  },
});

md.block.ruler.before("html_block", "embed", embedRule, { alt: ["paragraph"] });
md.renderer.rules.embed = (tokens, idx, _opts, env) => renderEmbedHtml(tokens[idx].meta, env);

// Resolve relative links and images against the post folder: root-absolute on pages,
// fully absolute in the feed.
const defaultImage = md.renderer.rules.image;
md.renderer.rules.image = (tokens, idx, opts, env, self) => {
  const token = tokens[idx];
  token.attrSet("src", resolveUrl(token.attrGet("src"), env));
  token.attrSet("loading", "lazy");
  const img = defaultImage(tokens, idx, opts, env, self);
  // on a page a picture is set in a recess (the kit's figure); the feed keeps a bare <img>
  return env.absolute ? img : `<span class="vx-figure"><span class="vx-recess">${img}</span></span>`;
};
// A table is the kit's: it scrolls inside itself, never the page.
md.renderer.rules.table_open = (_t, _i, _o, env) => (env.absolute ? "<table>\n" : '<div class="vx-table"><div class="vx-table-scroll" tabindex="0" role="region" aria-label="Table"><table>\n');
md.renderer.rules.table_close = (_t, _i, _o, env) => (env.absolute ? "</table>\n" : "</table></div></div>\n");
md.renderer.rules.link_open = (tokens, idx, opts, env, self) => {
  const token = tokens[idx];
  const href = token.attrGet("href");
  if (href) token.attrSet("href", resolveUrl(href, env));
  return self.renderToken(tokens, idx, opts);
};

// Raw HTML in a post is published as written; its root-absolute addresses are checked like a link's.
for (const kind of ["html_block", "html_inline"]) {
  const plain = md.renderer.rules[kind];
  md.renderer.rules[kind] = (tokens, idx, opts, env, self) => {
    const published = tokens[idx].content.replace(/<!--[\s\S]*?(?:-->|$)/g, "");
    for (const [, , quoted, bare] of published.matchAll(/\b(src|href|poster)\s*=\s*(?:["'](\/(?!\/)[^"']*)["']|(\/(?!\/)[^\s>"']*))/gi)) {
      const u = quoted ?? bare;
      staysInSite(u, new URL(u, "https://site.invalid").pathname, env);
    }
    return plain(tokens, idx, opts, env, self);
  };
}

// ---------------------------------------------------------------------------
// Embed block rule

function embedRule(state, startLine, endLine, silent) {
  const start = state.bMarks[startLine] + state.tShift[startLine];
  const firstLine = state.src.slice(start, state.eMarks[startLine]);
  const match = EMBED_START.exec(firstLine);
  if (!match) return false;
  // Only top-level blocks: a nested embed would break the Markdown twin's line mapping.
  if (state.parentType !== "root" || state.sCount[startLine] > 0) return false;
  if (silent) return true;

  const name = match[1];
  const closing = `</${name}>`;
  let text = "";
  let line = startLine;
  let closed = false;
  // Scenes and comparisons have no body: the opening tag alone is enough, optionally followed
  // by its closing tag on the same line. A model note runs until its closing tag.
  const bodiless = EMBEDS[name].bodiless;
  for (; line < endLine; line++) {
    text += (line === startLine ? "" : "\n") + state.src.slice(state.bMarks[line] + state.tShift[line], state.eMarks[line]);
    const openEnd = findOpenTagEnd(text);
    if (openEnd === -1) continue;
    if (bodiless || text.slice(0, openEnd + 1).endsWith("/>") || text.includes(closing, openEnd)) {
      closed = true;
      break;
    }
  }

  const env = state.env;
  const lineNo = env.ctx.lineOffset + startLine + 1;
  if (!closed) {
    env.errors.push(`${env.ctx.file}:${lineNo} <${name}> is not closed. Write <${name} …></${name}> or <${name} … />.`);
    state.line = endLine;
    return true;
  }

  const openEnd = findOpenTagEnd(text);
  const openTag = text.slice(0, openEnd + 1);
  const selfClosing = openTag.endsWith("/>");
  const afterOpen = text.slice(openEnd + 1);
  let inner = "";
  let trailing = afterOpen;
  if (bodiless) {
    trailing = afterOpen.trim().startsWith(closing) ? afterOpen.trim().slice(closing.length) : afterOpen;
  } else if (!selfClosing) {
    inner = text.slice(openEnd + 1, text.lastIndexOf(closing));
    trailing = text.slice(text.lastIndexOf(closing) + closing.length);
  }
  if (trailing.trim()) {
    env.errors.push(`${env.ctx.file}:${lineNo} put <${name}> on its own lines; found text after it.`);
  }

  const attrs = parseAttrs(openTag.slice(name.length + 1, selfClosing ? -2 : -1));
  const meta = { name, attrs, body: dedent(inner).trim(), line: lineNo };
  validateEmbed(meta, env);

  const token = state.push("embed", "", 0);
  token.block = true;
  token.map = [startLine, line + 1];
  token.meta = meta;
  state.line = line + 1;
  return true;
}

/** Index of the ">" that ends the opening tag, skipping ">" inside quoted attribute values. */
function findOpenTagEnd(text) {
  let quote = null;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quote) {
      if (c === quote) quote = null;
    } else if (c === '"' || c === "'") {
      quote = c;
    } else if (c === ">") {
      return i;
    }
  }
  return -1;
}

function parseAttrs(text) {
  const attrs = {};
  const re = /([a-zA-Z][\w-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  for (const m of text.matchAll(re)) attrs[m[1].toLowerCase()] = decodeEntities(m[2] ?? m[3]);
  return attrs;
}

function validateEmbed(meta, env) {
  const { ctx, errors } = env;
  const spec = EMBEDS[meta.name];
  const where = `${ctx.file}:${meta.line} <${meta.name}>`;
  for (const attr of spec.required) {
    if (!meta.attrs[attr] || !meta.attrs[attr].trim()) {
      errors.push(`${where} needs ${attr}="…".`);
    }
  }
  if (spec.equivalent && !meta.attrs.alt?.trim() && !meta.attrs.poster?.trim()) {
    errors.push(`${where} needs alt="…" (a text equivalent) or poster="…" (a still image).`);
  }
  for (const attr of spec.files) {
    const value = meta.attrs[attr];
    if (!value || isExternal(value) || value.startsWith("/")) continue;
    if (meta.name === "ai-session" && value !== path.basename(value)) {
      errors.push(`${where} ${attr} must be a file in the post folder.`);
      continue;
    }
    if (!fs.existsSync(path.join(ctx.dir, value))) {
      errors.push(`${where} ${attr}="${value}" does not exist in ${path.relative(process.cwd(), ctx.dir) || "."}.`);
    }
  }
  if (meta.name === "model-note" && !meta.body) {
    errors.push(`${where} is empty; write the model's words between the tags.`);
  }
  if (meta.name === "ai-session") loadSession(meta, ctx, errors, where);
}

/** Reads, validates and leak-checks a session file; the parsed session rides on the token. */
function loadSession(meta, ctx, errors, where) {
  const src = meta.attrs.src;
  if (!src || isExternal(src) || src.startsWith("/") || src !== path.basename(src)) {
    if (src) errors.push(`${where} src must be a file in the post folder.`);
    return;
  }
  const file = path.join(ctx.dir, src);
  if (!fs.existsSync(file)) return; // reported above
  let session;
  try {
    session = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (e) {
    errors.push(`${where} ${src} is not valid JSON.`); // the parser's message quotes the file
    return;
  }
  const problems = validateSession(session);
  if (problems.length) errors.push(`${where} ${src} is not a valid ai-session/1 file: ${problems.slice(0, 5).join("; ")}.`);
  const leaks = findLeaks(session);
  if (leaks.length) errors.push(`${where} ${src} still contains ${leaks.join(", ")}. Re-import it with npm run session, or remove them.`);
  const open = meta.attrs.open;
  if (open && open !== "all" && !/^\d+(\s*,\s*\d+)*$/.test(open)) errors.push(`${where} open="${open}" must be "all" or prompt numbers like "1,3".`);
  if (!problems.length && !leaks.length) meta.session = session;
}

function findStrayEmbeds(tokens, ctx, errors) {
  const visit = (list) => {
    for (const t of list) {
      if ((t.type === "html_block" || t.type === "html_inline") && EMBED_ANYWHERE.test(t.content)) {
        const line = t.map ? ctx.lineOffset + t.map[0] + 1 : "?";
        errors.push(`${ctx.file}:${line} an embed must start its own top-level block (blank line before it, no indentation, not inside a list or quote).`);
      }
      if (t.children) visit(t.children);
    }
  };
  visit(tokens);
}

// ---------------------------------------------------------------------------
// Embed output

const LABELS = {
  "engine-scene": "Interactive engine scene. A still for now.",
  "model-compare": "Model comparison. A still for now.",
};

function renderEmbedHtml(meta, env) {
  const a = meta.attrs;
  const url = (v) => (v ? resolveUrl(v, env) : "");
  if (meta.name === "ai-session") return renderSessionHtml(meta, env, url);
  if (meta.name === "model-note") {
    const who = `${a.model} (${a.maker})`;
    const body = md.render(meta.body, env);
    return (
      `<model-note model="${attr(a.model)}" maker="${attr(a.maker)}">` +
      `<aside class="${env.absolute ? "" : "vx-callout "}model-note" aria-label="Note from ${attr(who)}">` +
      `<p class="${env.absolute ? "" : "vx-callout-title "}model-note-by">Note from <strong>${escapeHtml(a.model)}</strong> (${escapeHtml(a.maker)}). Not the author’s words.</p>\n` +
      body +
      `</aside></model-note>\n`
    );
  }
  const elementAttrs = Object.entries(a)
    .map(([k, v]) => `${k}="${attr(EMBEDS[meta.name].files.includes(k) ? url(v) : v)}"`)
    .join(" ");
  const caption = a.caption || LABELS[meta.name];
  return (
    `<figure class="${env.absolute ? "" : "vx-figure "}embed embed-${meta.name}">` +
    (env.absolute ? "" : `<div class="vx-recess">`) +
    `<${meta.name} ${elementAttrs}>` +
    (a.poster ? `<img src="${attr(url(a.poster))}" alt="${attr(a.alt ?? "")}" loading="lazy">` : `<p class="embed-text">${escapeHtml(a.alt)}</p>`) +
    `</${meta.name}>` +
    (env.absolute ? "" : `</div>`) +
    `<figcaption>${escapeHtml(caption)}</figcaption></figure>\n`
  );
}

function renderEmbedMarkdown(meta, ctx) {
  const a = meta.attrs;
  const url = (v) => resolveUrl(v, { ctx, absolute: true });
  if (meta.name === "ai-session") return meta.session ? sessionMarkdown(meta.session, { src: url(a.src), caption: a.caption }) : "";
  if (meta.name === "model-note") {
    const label = `**Note from ${a.model} (${a.maker}):**`;
    const body = rewriteMarkdownUrls(meta.body, ctx).split("\n");
    const startsWithText = body[0] && !/^([#>*+-]|\d+\.|```|~~~|\|)/.test(body[0]);
    const lines = startsWithText ? [`${label} ${body[0]}`, ...body.slice(1)] : [label, "", ...body];
    return lines.map((l) => (l ? `> ${l}` : ">")).join("\n");
  }
  const caption = a.caption ? `${a.caption} ` : "";
  const still = a.poster ? `![${a.alt ?? ""}](${url(a.poster)})` : a.alt;
  if (meta.name === "engine-scene") {
    return `${still}\n\n*${caption}Interactive engine scene${a.poster ? ", shown as a still" : ""}. Scene data: [${path.basename(a.src)}](${url(a.src)}).*`;
  }
  return `${still}\n\n*${caption}Model comparison${a.poster ? ", shown as a still" : ""}. Models: [before](${url(a.before)}) and [after](${url(a.after)}).*`;
}

const highlightTurn = (code, lang) => md.options.highlight(code, lang);

function renderSessionHtml(meta, env, url) {
  const a = meta.attrs;
  if (!meta.session) return "";
  if (env.absolute) return sessionFeedHtml(meta.session, { src: url(a.src), caption: a.caption, highlight: highlightTurn }) + "\n";
  // Ids must be unique on the page, also when one file is shown twice.
  env.sessionIds ??= new Map();
  const base = "s-" + (path.basename(a.src).replace(/\.session\.json$|\.json$/, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "session");
  const seen = env.sessionIds.get(base) ?? 0;
  env.sessionIds.set(base, seen + 1);
  const id = seen ? `${base}-${seen + 1}` : base;
  const open = !a.open ? undefined : a.open === "all" ? "all" : new Set(a.open.split(",").map((n) => Number(n.trim())));
  // The stylesheet and script come with the first session on a page, and never into the feed.
  const site = (p) => sitePath(env.ctx.base ?? "/", p);
  const assets = env.sessionAssets ? "" : `<link rel="stylesheet" href="${site("/ai-session.css")}"><script type="module" src="${site("/ai-session.js")}"></script>`;
  env.sessionAssets = true;
  return (
    assets +
    `<ai-session src="${attr(url(a.src))}">` +
    sessionHtml(meta.session, { id, src: url(a.src), open, caption: a.caption, highlight: highlightTurn }) +
    `</ai-session>\n`
  );
}

// ---------------------------------------------------------------------------
// Markdown twin

function toMarkdown(source, tokens, ctx) {
  const lines = source.split("\n");
  const replace = new Map(); // start line → { end, text }
  const verbatim = new Set();
  for (const t of tokens) {
    if (t.type === "embed") replace.set(t.map[0], { end: t.map[1], text: renderEmbedMarkdown(t.meta, ctx) });
    if ((t.type === "fence" || t.type === "code_block") && t.map) {
      for (let i = t.map[0]; i < t.map[1]; i++) verbatim.add(i);
    }
  }
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const r = replace.get(i);
    if (r) {
      out.push(r.text);
      i = r.end - 1;
    } else if (verbatim.has(i)) {
      out.push(lines[i]);
    } else {
      out.push(rewriteMarkdownUrls(lines[i], ctx));
    }
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim() + "\n";
}

/** Makes link, image and src/href URLs absolute, leaving inline code spans alone. */
function rewriteMarkdownUrls(text, ctx) {
  const env = { ctx, absolute: true };
  return text
    .split(/(`+[^`]*`+)/)
    .map((part, i) => {
      if (i % 2 === 1) return part;
      return part
        .replace(/(\]\()(<[^>]*>|[^)\s]+)/g, (_, open, u) => open + resolveUrl(u.replace(/^<|>$/g, ""), env))
        .replace(/^(\s*\[[^\]]+\]:\s*)(\S+)/, (_, open, u) => open + resolveUrl(u, env))
        .replace(/\b(src|href|poster)="([^"]+)"/g, (_, k, u) => `${k}="${resolveUrl(u, env)}"`);
    })
    .join("");
}

// ---------------------------------------------------------------------------
// Helpers

export function isExternal(u) {
  return /^[a-z][a-z0-9+.-]*:/i.test(u) || u.startsWith("//");
}

/** What a mounted site may link to outside its base: the realm's "/" and the files the site writes at the root. */
const ROOT_FILES = new Set(["/", "/robots.txt"]);
/**
 * Mounted under a base (zahynailo.dev/blog/), a root-absolute link outside it leaves the site for the realm, where
 * the page it meant is not: an error, once a post and link. The base without its slash is the base.
 */
function staysInSite(u, pathname, env) {
  const base = env.ctx.base;
  if (!env.errors || !base || base === "/" || ROOT_FILES.has(pathname) || `${pathname}/`.startsWith(base)) return;
  // Once a post and address: "/blog/../x" and "/x" are one address.
  const once = `${env.ctx.file} ${pathname}`;
  if ((env.left ??= new Set()).has(once)) return;
  env.left.add(once);
  env.errors.push(`${env.ctx.file}: the link ${u} leaves the site, which is at ${base}. Link under ${base} or relative to the post.`);
}

/** Root-absolute on pages, absolute with the origin when env.absolute is set. */
function resolveUrl(u, env) {
  if (!u || isExternal(u)) return u;
  const { basePath, origin } = env.ctx;
  if (u.startsWith("#")) return env.absolute ? origin + basePath + u : u;
  const r = new URL(u, "https://site.invalid" + basePath);
  const p = r.pathname + r.search + r.hash;
  staysInSite(u, r.pathname, env);
  return env.absolute ? origin + p : p;
}

function dedent(text) {
  const lines = text.replace(/^\n+/, "").split("\n");
  const indents = lines.filter((l) => l.trim()).map((l) => l.match(/^\s*/)[0].length);
  const min = indents.length ? Math.min(...indents) : 0;
  return lines.map((l) => l.slice(min)).join("\n");
}

export function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
const attr = escapeHtml;

function decodeEntities(s) {
  return s.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
}
