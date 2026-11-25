---
name: fal-model-api
description: How Village calls fal.ai's hosted image models (the engine's drawer of five-view sheets, engine/make/drawn.mjs, #245). The sync and queue APIs, fal-ai/nano-banana-2's input and output, price, limits, what fal keeps of a request and how to ask it to keep less, where the key lives, and what was measured. Load before changing how the engine draws, adding another fal endpoint, or sending anything new to fal.
---

# fal.ai Model APIs, for one drawn sheet

Read November 16, 2026 from fal's own docs (the pages below, as served then). No fal SDK is installed in the
engine: it is one HTTPS request from node's own `fetch`. The bench (`~/.village/engine/fast-voxels/src/fal5.py`)
uses the Python `fal_client` and its queue-backed `subscribe`; the engine does not.

## What Village sends, and never sends

- **Typed words only.** The drawer's prompt is the sheet layout (below) and the asker's words. Never a picture, a
  photograph, a link's contents or anything of the owner's: the owner has not made that call.
- **The key**: `FAL_KEY` in the environment, or the login Keychain (`security find-generic-password -a $USER -s
  village-fal -w`). Read in the process that calls fal, at the call, held in memory only, sent only to
  `https://fal.run`, never printed, logged, journalled or written to a file. Child processes (the builder) are
  started without it.

## The call (`engine/make/drawn.mjs` `falDrawer`)

```
POST https://fal.run/fal-ai/nano-banana-2
Authorization: Key <key>
Content-Type: application/json
X-Fal-Store-IO: 0
{"prompt": "...", "aspect_ratio": "3:2", "resolution": "1K", "output_format": "png", "sync_mode": true}
```

| Choice | Why | Source |
| --- | --- | --- |
| `fal.run` (sync), not `queue.fal.run` | one blocking request, no polling; the queue's worth (retries, webhooks, many at once) is not needed for one sheet. fal does not retry a sync request: a temporary failure answers with `X-Fal-Needs-Retry: 1`. Village does not retry: the wish goes the way it went before | sync API reference (`/api-reference/inference-api/sync/run.md`); `/documentation/model-apis/inference/synchronous.md` |
| `Authorization: Key …` | the only scheme | sync API reference, `securitySchemes` |
| `X-Fal-Store-IO: 0` | fal does not keep the request and response payloads in the dashboard's history | sync reference `StoreIO`; `/documentation/model-apis/media-expiration.md` |
| `sync_mode: true` | the picture comes back as a `data:` URI in the answer and "won't be available in the request history"; nothing is fetched from fal's CDN | nano-banana-2 schema (`fal.ai/models/fal-ai/nano-banana-2/llms.txt`) |
| `aspect_ratio: "3:2"`, `resolution: "1K"` | the bench's settings that drew a clean five-view sheet (1264 by 848) | bench README, "A faster drawer: fal.ai" |

The answer: `{"images": [{"url": "data:image/png;base64,...", "content_type": "image/png", ...}], "description": "..."}`.
Errors are JSON with a status of 4xx or 5xx; a 5xx is never billed.

Both `X-Fal-Store-IO: 0` and `sync_mode` were sent on every real call this lane made (ten sheets); what they do is
as fal's docs say, **not probed**: nobody looked at the dashboard's history afterwards.

What fal still keeps with these headers: Zero Data Retention is not on by default and is a sales-team setting;
`X-Fal-Store-IO: 0` is "one part" of it. Generated files would go to fal's CDN unless `sync_mode` returns them
inline; `X-Fal-Object-Lifecycle-Preference: {"expiration_duration_seconds": n}` sets an expiry for files that are
stored. Logging by the model's own deployment is not covered by either header (media-expiration page).

## The prompt

The bench's sheet prompt (`fal5.py` `SHEET`), with "The thing is: <words>." after it: five parallel views (left,
right, front, rear, top) at one scale, on pure white, no shadows, ground, text or borders; the left view's front
points left, the top view's front points left. The model keeps to the layout only roughly: the builder reads the
sheet by what it shows (`engine/draw/sheet.py` `cut`).

## Price and limits

- `fal-ai/nano-banana-2`: **$0.08 an image** at 1K (0.75× at 0.5K, 1.5× at 2K, 2× at 4K); web search adds $0.015.
  Billed per successful output; server errors and time in the queue are free (pricing page, model page).
- Concurrency: an account starts at 2 requests in progress at once and rises with credit bought, to 40 self-serve.
  Requests past it wait; they are never refused for it (`/documentation/model-apis/concurrency-limits.md`).
- `X-Fal-Request-Start-Timeout` bounds the wait to start on a runner (504 past it); it does not bound the run.
  The engine bounds the whole call itself (an `AbortSignal`), and a call cut short may still be billed.

## Measured

- Bench, November 15 (`fal5.py`, `subscribe`): the answer in 11.4 s, on disk 12.4 s; a red F1 car on November 16:
  10.8 s and 11.6 s. `fal-ai/flux/schnell` answered in 1.7 s but drew no sheet (two side views and perspective).
- Engine, sync with `sync_mode` (November 16 and 17, this lane, `make/drawn.mjs` `falDrawer`): ten sheets in 8.6 to
  11.4 s from the request to the bytes in hand. More in `engine/README.md`, "A thing drawn and carved".

## What the drawer gets wrong (bench README "What is still weak")

Shadows drawn under the thing that carve into a plinth; views that disagree (the builder's `views_agree`); now and
then a different thing than was asked; brand logos on things that have makers (a racing car comes with sponsors'
marks). The engine checks the sheet's proportions against the model's own size of the thing before it builds.

## Refresh when

fal changes the sync API's headers, `nano-banana-2`'s inputs or price, or a probe contradicts a row above.

<!-- docs-verified d275af1c4ec25f6efc898f9e37606571023eeed1 {"engine/make/drawn.mjs":"18aa0cb97922963b56e484d75f31de20"} -->
