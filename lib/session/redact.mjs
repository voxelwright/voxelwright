// Redaction for AI sessions. It runs inside the importer, before anything is written, and again
// as a gate in the build: a session file with a secret-shaped string, an email or a home path
// fails the build even if someone edited it by hand.
//
// Rules replace what they find with a short bracketed word ("[token]", "[email]", "~"), so a
// reader can tell something was there. Reports count hits per rule and never echo the values.
// node:os only where it exists (the importer), so the Worker can use the same rules.
const os = globalThis.process?.getBuiltinModule?.("node:os") ?? null;

const ENTROPY_MIN = 3.6;

/** Each rule: [name, regex, replacement]. Order matters: specific shapes before generic ones. */
const RULES = [
  ["private key", /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g, "[private key]"],
  ["url credentials", /(\b[a-z][a-z0-9+.-]*:\/\/)[^/\s:@]+:[^/\s@]+@/gi, "$1[credentials]@"],
  ["jwt", /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}/g, "[token]"],
  ["api key", /\b(?:sk|pk|rk)-(?:ant-|proj-|live-|test-)?[A-Za-z0-9_-]{16,}/g, "[token]"],
  ["github token", /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})/g, "[token]"],
  ["slack token", /\bxox[abprs]-[A-Za-z0-9-]{10,}/g, "[token]"],
  ["aws key", /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g, "[token]"],
  ["stripe key", /\b[prs]k_(?:test|live)_[A-Za-z0-9]{10,}/g, "[token]"],
  ["webhook secret", /\bwhsec_[A-Za-z0-9]+/g, "[token]"],
  ["google key", /\bAIza[0-9A-Za-z_-]{30,}/g, "[token]"],
  ["fal or hf key", /\b(?:hf_[A-Za-z0-9]{20,}|fal-[A-Za-z0-9-]{20,})/g, "[token]"],
  ["bearer", /\b(bearer|basic)\s+[A-Za-z0-9._~+/=-]{12,}/gi, "$1 [token]"],
  ["assignment", /\b(password|passwd|passphrase|secret|token|api[_-]?key|access[_-]?key|client[_-]?secret)(\s*[:=]\s*["']?)(?!\[)[^\s"'`,;)]{6,}/gi, "$1$2[redacted]"],
  ["email", /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, "[email]"],
  ["home path", /(?:\/Users|\/home)\/[A-Za-z0-9._-]+(?=\/|\b)/g, "~"],
  ["home path", /\b[A-Z]:\\Users\\[A-Za-z0-9._-]+/g, "~"],
  ["home path", /-(?:Users|home)-[A-Za-z0-9._]+(?=-)/g, "-~"],
  ["tailnet host", /\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.ts\.net\b/gi, "[tailnet-host]"],
  ["machine name", /\b[a-z0-9]+s?-(?:macbook|imac|mac-mini|mac-studio)(?:-(?:pro|air))?(?:-\d+)?(?:\.local)?\b/gi, "[machine]"],
  ["ip address", /\b(?!127\.0\.0\.1\b)(?!0\.0\.0\.0\b)(?:25[0-5]|2[0-4]\d|1?\d?\d)(?:\.(?:25[0-5]|2[0-4]\d|1?\d?\d)){3}\b(?!\.\d)/g, "[ip]"],
  ["phone", /(?<![\w.])\+?\d{1,3}[ .-]?\(?\d{3}\)?[ .-]\d{3}[ .-]\d{4}\b/g, "[phone]"],
  ["uuid", /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, "[id]"],
  ["long hex", /\b[a-f0-9]{48,}\b/gi, "[hash]"],
];

/** Shannon entropy in bits per character. */
function entropy(s) {
  const counts = {};
  for (const c of s) counts[c] = (counts[c] ?? 0) + 1;
  return -Object.values(counts).reduce((h, n) => h + (n / s.length) * Math.log2(n / s.length), 0);
}

/** Mixed-case, digit-bearing, high-entropy runs: keys that have no known prefix. */
const OPAQUE = /(?<![\w/.-])[A-Za-z0-9+/_=-]{28,}(?![\w/.-])/g;
function opaqueTokens(text, count) {
  return text.replace(OPAQUE, (m) => {
    if (!/[a-z]/.test(m) || !/[A-Z]/.test(m) || !/\d/.test(m)) return m;
    if (entropy(m) < ENTROPY_MIN) return m;
    count("opaque token");
    return "[token]";
  });
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Builds a redactor.
 * @param {object} [opts]
 * @param {Record<string,string>} [opts.names]  real name → made-up name (whole words, any case)
 * @param {string[]} [opts.literals]            exact private strings → "[redacted]"
 * @param {boolean} [opts.machine]              also hide this machine's user name and host name
 */
export function makeRedactor({ names = {}, literals = [], machine = Boolean(os) } = {}) {
  const report = {};
  const count = (rule) => (report[rule] = (report[rule] ?? 0) + 1);
  const nameRules = Object.entries(names)
    .filter(([real]) => real.trim().length >= 2)
    .sort((a, b) => b[0].length - a[0].length)
    .map(([real, fake]) => [new RegExp(`(?<![\\w-])${escapeRegExp(real)}(?![\\w-])`, "giu"), fake]);
  const literalList = literals.map((l) => l.trim()).filter((l) => l.length >= 3).sort((a, b) => b.length - a.length);
  const machineWords = [];
  if (machine && os) {
    const user = os.userInfo().username;
    const host = os.hostname().replace(/\.local$/, "");
    if (user && user.length >= 3) machineWords.push([new RegExp(`(?<![\\w])${escapeRegExp(user)}(?![\\w])`, "gi"), "[user]"]);
    if (host && host.length >= 3) machineWords.push([new RegExp(escapeRegExp(host), "gi"), "[machine]"]);
  }

  function text(s) {
    if (typeof s !== "string" || !s) return s;
    let out = s;
    for (const lit of literalList) {
      if (out.includes(lit)) {
        count("private string");
        out = out.split(lit).join("[redacted]");
      }
    }
    for (const [name, re, rep] of RULES) {
      out = out.replace(re, (...m) => {
        count(name);
        return typeof rep === "string" ? rep.replace(/\$(\d)/g, (_, i) => m[Number(i)] ?? "") : rep;
      });
    }
    out = opaqueTokens(out, count);
    for (const [re, rep] of machineWords) out = out.replace(re, () => (count("machine user or host"), rep));
    for (const [re, fake] of nameRules) out = out.replace(re, () => (count("name"), fake));
    return out;
  }

  /** Redacts every string in a value, keys included. */
  function deep(v) {
    if (typeof v === "string") return text(v);
    if (Array.isArray(v)) return v.map(deep);
    if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [text(k), deep(x)]));
    return v;
  }

  return { text, deep, report };
}

/**
 * The build's gate: rule names that still match anywhere in a session (or any value).
 * Names and private strings are not checked here: the build has no list of them.
 */
export function findLeaks(value) {
  const hits = new Set();
  const visit = (v) => {
    if (typeof v === "string") {
      for (const [name, re] of RULES) {
        if (name === "uuid" || name === "phone" || name === "ip address") continue; // too noisy to fail a build on
        re.lastIndex = 0;
        if (re.test(v)) hits.add(name);
      }
      if (/(?:^|[\s"'(])(?:\/Users|\/home)\/[A-Za-z0-9._-]+/.test(v)) hits.add("home path");
      opaqueTokens(v, (rule) => hits.add(rule));
    } else if (Array.isArray(v)) v.forEach(visit);
    else if (v && typeof v === "object") Object.entries(v).forEach(([k, x]) => (visit(k), visit(x)));
  };
  visit(value);
  return [...hits];
}
