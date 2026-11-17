# Round 2: site-side work

Engine parts are tracked on the private source repository: #421 (landing; comment of Nov 17), #423 (the place), #424 (sky and
time), #425 (graphics settings), #426 (easter eggs). The full brief is in COORDINATOR.md. This file covers the parts
that live in this repo.

## Ports for this round (tailnet port = local port + 5000)

| Ports     | Lane |
|-----------|------|
| 5960-5964 | The place experiment (#423), Village |
| 5965-5969 | Sky, time and graphics settings (#424, #425), Village |
| 5970-5974 | Tsundere support button, this repo |
| 5975      | Blog look preview switcher (`designs/iterations/serve.mjs`), already running |
| 5976-5980 | Writing: editor, AI-session block, store and auth spike, this repo |
| 5981-5989 | Spare: easter eggs, blog MCP |

## Lanes in this repo

1. **Tsundere support button.** A floating element in the top right that stands alone and works over both the 2D
   page and the 3D world:
   - Its eyes follow the pointer and it dodges.
   - The first click annoys it.
   - A second click starts the standoff: "are you threatening me?!", a MUDA MUDA barrage at the cursor, a
     bulldozer smash, "good grief", and then it escapes.
   - All art and sound are our own.
   - A real contact route stays reachable by keyboard and screen reader, and reduced motion gets a calm version.
   - It comes in two versions: skeuomorphic and unbiased.
2. **Writing.** Post from the website with a best-in-class custom editor.
   - AI sessions are a first-class block, like code blocks: a better take on `~/.claude/skills/conversation-artifact`.
   - Output is still Markdown plus assets in `posts/<slug>/`, which the generator builds.
   - Choose and test the store: commits to a private repo, or D1/R2.
   - Choose and test the auth: Cloudflare Access, or passkeys.
   - Everything stays local (`cf dev`, local D1/R2) until the owner says yes.
3. **Blog MCP server.** A remote MCP on Workers with OAuth, sharing the editor's write path. It starts after the
   writing lane settles that write path, and gets the seven-lens review with Sentinel first.
4. **Social links.** X, LinkedIn, YouTube, and optionally Twitch. This waits on the owner's handles.
5. **Console greeting** on the 2D page. Shared with #426.

## Waiting on the owner

- His face photo, and where its middle sits.
- Whether one tap on a sign opens the page, or selects it first.
- Whether billboard letters are cells or drawn type.
- What the LOG page holds.
- Which blog look, and how the skeuomorphic/unbiased pair folds into that choice.
- His social handles.
- The Mapillary conflict:
  - The handoff lists the token for reuse.
  - The site note excluded Mapillary because it is share-alike.
  - For now, it is used for reference only.
- Where the support button's real contact route points.
- Whether lanes may push draft PRs.
