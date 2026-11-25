// A mailbox both ends can reach while neither can be reached: comments on one
// throwaway issue in this private repo. A stand-in for the master server's
// signalling, slow (polling), used only to cross a real NAT. Bodies carry SDP
// (public addresses): they are written to the issue and nowhere else, and
// deleted when the probe ends. Nothing here prints a body or a token.
import { execFileSync } from 'node:child_process';

const TAG = 'lobby-transport-probe';

export function mailbox({ repo, issue, token, me, run }) {
  token ??= process.env.GITHUB_TOKEN ?? execFileSync('gh', ['auth', 'token'], { encoding: 'utf8' }).trim();
  const api = `https://api.github.com/repos/${repo}/issues`;
  const h = { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json', 'user-agent': TAG };
  const seen = new Set();
  let etag = null, cache = [];

  async function list() {
    const res = await fetch(`${api}/${issue}/comments?per_page=100`, { headers: etag ? { ...h, 'if-none-match': etag } : h });
    if (res.status === 304) return cache;
    if (!res.ok) throw new Error(`mailbox list ${res.status}`);
    etag = res.headers.get('etag');
    cache = (await res.json()).flatMap((c) => {
      const m = c.body.match(/^<!--lt-->(.*)$/s);
      if (!m) return [];
      try { return [{ id: c.id, ...JSON.parse(m[1]) }]; } catch { return []; }
    });
    return cache;
  }

  return {
    async post(kind, sid, data) {
      const body = `<!--lt-->${JSON.stringify({ run, from: me, kind, sid, data, at: Date.now() })}`;
      const res = await fetch(`${api}/${issue}/comments`, { method: 'POST', headers: h, body: JSON.stringify({ body }) });
      if (!res.ok) throw new Error(`mailbox post ${res.status}`);
      return (await res.json()).id;
    },
    // Next unseen message for me (not from me) matching kind (and sid prefix).
    async wait(kind, { sid, timeoutMs = 600000, everyMs = 2000 } = {}) {
      const end = Date.now() + timeoutMs;
      while (Date.now() < end) {
        const hit = (await list()).find((m) => m.run === run && m.from !== me && m.kind === kind && !seen.has(m.id) && (sid == null || String(m.sid).startsWith(sid)));
        if (hit) { seen.add(hit.id); return hit; }
        await new Promise((r) => setTimeout(r, everyMs));
      }
      return null;
    },
    async clear() {
      etag = null;
      for (const m of await list()) await fetch(`https://api.github.com/repos/${repo}/issues/comments/${m.id}`, { method: 'DELETE', headers: h });
    },
  };
}
