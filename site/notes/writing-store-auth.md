# Writing lane: store and auth spike (round 2, November 16, 2026)

Everything here ran locally. Nothing was deployed, no Cloudflare resource or GitHub repo was
created, nothing was pushed. Code: `writing/` (its own `package.json`, outside the site build).

## What was built and tested

| Piece | Where | Tested how |
|---|---|---|
| One write gate for every client (editor, MCP, CLI): slug, file names, types by magic bytes, sizes, front matter, session shape and leak scan | `writing/core.mjs` | `writing/spike.test.mjs`, and through the Worker |
| Git store: one commit per publish on `main`, refuses a stale edit (409) | `writing/store-git.mjs` | against a local bare repo seeded from this checkout |
| D1/R2 store: posts and every revision in D1, files in R2 under their SHA-256, optimistic revision check | `writing/worker/src/index.mjs` | `cf dev` (local simulation) on 5977 |
| Builder for D1/R2: export → `posts/` folder → the generator | `writing/bench.mjs` | same run |
| Passkeys (WebAuthn): gated first registration, single-use challenges, `__Host-` session cookie, Origin check | `writing/worker/src/auth.mjs` | `writing/e2e-passkey.mjs`: Chrome with a CDP virtual authenticator, 12 checks pass |
| Cloudflare Access: the Worker verifies `Cf-Access-Jwt-Assertion` itself | `verifyAccessJwt` in `auth.mjs` | `writing/spike.test.mjs` with a locally generated key: signature, `aud`, `iss`, `exp`, `nbf`, email, `alg` |

`@simplewebauthn/server` 14.0.3 runs under workerd (checked in `cf dev`); the browser side uses the
native `PublicKeyCredential.parse*OptionsFromJSON` and `toJSON()`, so no client library ships.

Note: the repo has `wrangler.config.ts`, but its scripts use `cf`. The spike Worker has its own
`cloudflare.config.ts`; `cf dev` needs a dev server declared in that folder, so
`writing/worker/package.json` lists `wrangler` 4.163.0 (the site's version). `cf dev` rejects
`--local` and `--persist-to`; local simulation is the default and wrangler's `--persist-to` is
passed after `--`.

## Measured (local, median of 5, Apple Silicon)

Same end point for both: from "publish" to the generator's output containing the post (index.md,
a session file and a PNG; the site has 3 posts).

| | Write accepted | Built |
|---|---|---|
| Git (local bare repo: fetch, commit, push; then pull and build) | 386 ms | 562 ms |
| D1/R2 (`cf dev`: Worker writes D1 and R2; then export, fetch blobs, build) | 10 ms | 52 ms |

The local numbers flatter D1/R2 and say little about production. Neither the generator (Node,
`fs`, Shiki) nor git runs inside a Worker, so **both stores need a build outside the Worker**, and
that build plus the deploy is most of the real latency:

| Step in production (estimates, not measured) | Git store | D1/R2 store |
|---|---|---|
| Write from the Worker | GitHub Git Data API: blobs, tree, commit, update ref, 4 to 6 calls, about 1 to 2 s | D1 batch and R2 put, under 100 ms |
| Trigger the build | push triggers GitHub Actions | Worker sends `repository_dispatch`, or a Workers Container |
| Build and deploy | Actions queue 5 to 30 s, `npm ci` about 15 s, build about 1 s, `cf deploy` about 10 to 20 s | the same, plus export and blob download |
| **Publish to live** | **about 40 to 90 s** | **about 40 to 90 s** (Containers could cut it to about 15 s, on Workers Paid) |

## Comparison

| | Private git repo | D1 + R2 |
|---|---|---|
| Publish to live | 40 to 90 s (estimate) | 40 to 90 s; about 15 s with a Container builder (paid) |
| Cost at this scale | $0: private repo, Actions 2,000 min/month free (about 1,000 publishes), Worker requests from one person | $0 on free tiers (D1 5 GB, R2 10 GB, no egress fees); $5/month if the builder is a Container |
| Source of truth | Markdown files in git, the same shape as today | rows and blobs; `posts/` becomes an export, so the repo and the store can drift |
| History and undo | every publish is a commit: diff, revert, blame for free | the `revisions` table; D1 Time Travel keeps 30 days |
| Failure modes | GitHub API down: publishing waits, drafts stay in the browser. A failed build leaves the last good site live. Repo grows with images. | Orphan R2 blobs after a failed D1 batch (harmless). Export and build can disagree with git. Schema migrations. A D1 outage blocks writes and the export. |
| Offline drafts | Same either way: drafts live in the browser (IndexedDB) and publish when back online. Git can also hold drafts as `draft: true` commits. | Same, with a natural `drafts` table on the server. |
| Writing outside the editor | still works: any editor, `npm run new`, a commit | only through the API, or by importing into the store |
| MCP server reuse | the MCP tool calls `checkSubmission` and `publishGit`'s API version in the same Worker; same 409 on a stale base | same, with `publish()` |
| Credentials the Worker holds | a GitHub App private key, minting 1-hour installation tokens for one repo with `contents: write` | none beyond its bindings |
| Lock-in | low: plain files in git; another host means a new 60-line API adapter | medium: D1 is SQLite and R2 speaks S3, but the code is written against the bindings |

### Auth

| | Cloudflare Access | Passkeys (our code) |
|---|---|---|
| Enforced where | at the edge, before the Worker runs; the Worker also verifies the JWT | inside the Worker |
| Code we own on the critical path | about 40 lines (JWT check), tested | about 200 lines plus a library, tested end to end |
| Sign-in | email code, or an identity provider such as Google (which can itself use a passkey) | Face ID or Touch ID directly, no third party |
| Phishing resistance | depends on the identity provider | built in (origin-bound) |
| Recovery | through the identity provider | a lost passkey needs the setup token and a manual reset; synced passkeys (iCloud Keychain) make this rare |
| MCP clients (OAuth) | Access can sit in front of the OAuth authorize page; the MCP Worker issues its own tokens (`workers-oauth-provider`) | the same OAuth provider, with the passkey on its authorize page |
| Cost and lock-in | free up to 50 users; Cloudflare Zero Trust | none |
| Revocation and logs | dashboard, session duration policy, Access logs | delete the row; our own logs |

## Recommendation

**Store: the private git repo.** Both stores land at the same publish-to-live time, because the
build runs outside the Worker either way, so speed does not separate them. Git keeps posts as the
Markdown folders the generator, the checks and every other tool already read; history, review and
undo come with it; and it is the easier one to leave. D1/R2 would make `posts/` a second copy that
can drift. Use a GitHub App installed on the one repo with `contents: write`, its private key as a
Worker secret, and a fresh installation token per publish. Revisit D1/R2 only if publish-to-live
under 20 seconds matters enough to pay for a Container builder.

**Auth: Cloudflare Access, with the Worker verifying the JWT.** It stops every unauthenticated
request at the edge before our code runs, leaves about 40 lines of security-critical code instead
of about 200, and gives logs and revocation for free. Use a Google identity with a passkey on it
to get Face ID sign-in without owning WebAuthn. The passkey code stays in the spike, tested, as
the fallback if he would rather depend on no identity provider. `aud`, `iss` and `OWNER_EMAIL` are
Worker settings, and the check fails closed when any is missing.

**The editor gets its own origin: `edit.zahynailo.dev`, not `/edit` on the public host** (Sentinel,
finding 2). Posts are Markdown with raw HTML allowed and the public site sends no CSP, so a script
that reaches a published post (most plausibly through content an AI client was tricked into
publishing over MCP) would run on the same origin as the API, pass the Origin check, and carry the
owner's cookie. On a separate origin it can do neither. The Access application, `ORIGIN` and the
passkey `RP_ID` all move to that hostname, and the MCP server lives there too.

## How Access would sit in front of /edit (not created)

1. Zero Trust → Access → Applications → Self-hosted: domain `edit.zahynailo.dev`, every path
   (the MCP server's `/authorize` included). Session duration 24 hours.
2. One policy: Allow, include emails = the owner's address. Login methods: Google (or one-time PIN).
3. Copy the application's AUD tag into the Worker as `ACCESS_AUD`; set `ACCESS_ISSUER` to
   `https://<team>.cloudflareaccess.com` and `OWNER_EMAIL`; set `AUTH_MODE=access`.
4. The Worker fetches the signing keys from `<issuer>/cdn-cgi/access/certs` (cached 10 minutes) and
   checks every request's `Cf-Access-Jwt-Assertion`. It never trusts `Cf-Access-Authenticated-User-Email`.
5. Writes keep the Origin check. The public site (`zahynailo.dev`) stays outside the application and
   never routes `/edit` or `/api/`.

## GitHub App flow (documented, not created)

1. Create a GitHub App owned by the owner's account: no webhook, repository permissions
   `Contents: read and write`, `Metadata: read`. Install it on the private site repo only.
2. Store the App id, the installation id and the private key (PEM) as Worker secrets.
3. Per publish: sign a 10-minute JWT with the key (RS256, WebCrypto), exchange it at
   `POST /app/installations/<id>/access_tokens` for a 1-hour token limited to that repo.
4. Read `refs/heads/main`, create blobs for changed files, a tree with `base_tree` = main's tree,
   a commit with parent = main, then `PATCH /git/refs/heads/main` with `force: false`. A 422 there
   means main moved: re-check the post's own history (as `publishGit` does) and retry or 409.
5. A fine-grained personal access token (one repo, contents read/write, 90-day expiry) works the
   same way and is simpler to start with, but it is tied to the person and expires; the App is the
   long-term choice.

## Review (Sentinel lens, November 16, 2026)

Run by a fresh agent with the reviewer's own instructions on `main..writing-1`. Each finding was
reproduced before fixing.

| # | Finding | Status |
|---|---|---|
| 1 High | The `assignment` rule missed `DB_PASSWORD=…`, `{"password": "…"}`, `--password …`, `export OPENAI_API_KEY=…` | Fixed with the reviewer's two rules; test added |
| 2 Medium | `/edit` and `/api/` on the public origin: raw HTML in a post could publish as the owner | Decided: separate origin `edit.zahynailo.dev` (above). Not yet: rejecting raw HTML outside embeds in the gate |
| 3 Medium | The server-side gate skipped phones, IPs and UUIDs, and never redacts | Fixed: the gate checks every rule. Names are still only redacted at import (see 9) |
| 4 Low | Unauthenticated challenge rows were never deleted; no rate limit | Fixed: expired challenges and sessions are swept. Not yet: a Rate Limiting binding on `/auth/*` |
| 5 Low | Access check passed when `OWNER_EMAIL` or `ACCESS_AUD` was unset | Fixed: fails closed |
| 6 Low | An invalid session timezone let an unescaped date into the page | Fixed: escaped, and the format rejects an unknown time zone |
| 7 Low | `<ai-session src="../x">` read outside the post folder; JSON errors quoted the file into logs | Fixed: src must be a file in the folder; the error no longer quotes content |
| 8 Unsure | Whether Access attaches its JWT to a same-origin `fetch` from injected script | Moot with the separate origin; to settle on a test Access app if it ever shares an origin |
| 9 Unsure | The server has no list of real names, so a session sent over the API is not checked for them | Open: a `PRIVATE_NAMES` Worker secret passed to the gate |
