# Coordinator handoff: zahynailo.dev, round 2 (Nov 17, 2026)

You coordinate the next round of the owner's personal site. You route and delegate; builders write code
in their own worktrees. The owner (Pavlo) saw the landing prototype and said: "conceptually it works! The 3D
design can become a really neat website." His full list is quoted at the bottom. Read it first.

## Where things are

- **Site repo**: `~/Developer/site` (local git, no remote; T3 project "site"). Custom Node generator
  (`generator/`), posts in `posts/<slug>/index.md`, designs in `designs/<name>/` picked by `SITE_LOOK`.
  `npm test` (19 pass). Cloudflare Workers static assets via the `cf` CLI (signed in), domain zahynailo.dev.
  `negotiateMarkdown: false` on purpose (worker-first routes count against the free 100k/day quota).
- **Blog looks**: `designs/{opus,fable,blend,fresh,iter-1..iter-5}`. Preview switcher
  `node designs/iterations/serve.mjs` on 5975, tailnet https://node.example.invalid:10975/1/.
  The owner has not picked one yet. `site.config.mjs` still says `look: "notebook"`, which he rejected.
- **Engine landing** (Village repo, issue #421): draft PR 422 `feature/421-landing`, stacked on draft PR 420
  `feature/419-player` (#419, the static engine player). 420 lands before 422. Worktree
  `~/.t3/worktrees/Village/t3-4935f465-359588306f1f6fd3/engine`, `npm run landing`, ports 5950-5959,
  served on tailnet https://node.example.invalid:10951/landing/site/index.html.
  Code: `engine/player/stage.ts`, `engine/landing/{block.mjs,landing.ts,face.ts,site/}`, `test/landing.mjs`.
  Evidence and facts: `~/.village/engine/landing/`, memory `project-landing-421.md`.
- **What to reuse for fidelity**:
  - Real-world city (lane #373, "whole planet"): `?bay=1`, lidar + DataSF packs for North Beach / Telegraph
    Hill, Overture + Mapterhorn tiles anywhere (`?bay=1&ll=lat,lon`), Mapillary token at
    `~/.village/engine/bay/keys/mapillary.token`. Terms and limits: `.agents/skills/bay-sources`, and
    "The planet" in the cell-engine skill. Google, Mapbox, Esri, and Cesium terms forbid deriving from their
    imagery. Memory: `project-bay-373.md`.
  - Image-to-asset pipeline (fast-voxels lane: picture or words to a living car, the BMW X3 work):
    `~/.village/engine/fast-voxels/HANDOFF.md`, branch `feature/245-living-builds` (not pushed). The fal key
    is in the login Keychain as `village-fal`. The owner also has ChatGPT image generation.
- **Owner's skill for sharing sessions**: `~/.claude/skills/conversation-artifact` (a session as a
  shareable page). He wants that idea adapted, and done better, as a first-class post element.
- **Memories to read**: `~/.claude/projects/<project-directory>/memory/`:
  `project-personal-site.md`, `project-landing-421.md`, `feedback-required-skills-first.md`,
  `feedback-no-open-source-yet.md`, `feedback-show-milestones.md`, `feedback-made-up-names.md`.

## Rules that hold

1. **Skills are Step 0.** Every brief for any UI surface (engine HUD, settings, support button, editor,
   blog) starts with: invoke `frontend-design:frontend-design` by exact name before reading or writing
   anything; if it is missing, stop and report, no substitutes. For anything that moves, also load the
   animation skill pack (Emil Kowalski's skills, github.com/emilkowalski/skills, MIT; the owner said the
   plan was to extract it into our own skill, `.claude/skills/site-craft` is the site's skill). The report
   confirms both loaded. "Animations must be sublime."
2. **Nothing public.** No public deploy, no public repo, no licence, until the owner says yes. Before the
   first public deploy, tell him it ships compiled engine code.
3. **No visitor spends his tokens.** No model calls on behalf of visitors. Model use at build time or by
   the owner himself is fine.
4. **Original assets only.** The JoJo, Star Wars, Doom and GTA nods are homages: our own art, our own
   sounds, short quoted lines at most. No ripped audio, footage, sprites or character likeness. Real
   landmarks are fine. Brand billboards are our own content.
5. **2D stays canonical.** Reduced motion, no WebGPU, or `?view=2d` go to the plain page. Agents keep
   their `.md` twins, llms.txt and feed. 60 fps on a MacBook and an iPhone is the bar, so test the real
   iPhone and Safari before calling anything done.
6. **Auth is sensitive.** The web editor and the blog MCP server write to his site. Run the seven-lens
   security review on their auth and write paths.
7. **Process.** Log every dispatch in `~/Developer/Village/.agents/dispatch-log.jsonl`. Stop processes
   only by PID, never `pkill -f`. Own ports 5960-5989 for this round. Commit subjects in Village use
   `[#<issue>] ...` on `feature/` branches. No Co-Authored-By lines. Use made-up names for test people.
8. **Show milestones.** Send screenshots or short clips at each milestone, embedded in the message, plus
   a tailnet link (`tailscale serve --bg --https=<port> http://127.0.0.1:<port>`).
9. **Ask the owner** only specific questions with two tested options and a recommendation.

## Settled by this message

- Drop the VILLAGE and FEED billboards for now. BLOG and TAGS stay. Social links and support get added.
- Billboards stay as the navigation idea (a joke on SF's AI billboards).

## Still open with the owner

- His face photo and where its middle sits (`?face=` slot exists).
- Whether one tap on a sign opens the page, or selects it first.
- Whether billboard letters are cells or page-drawn type. The "destroy the B" gag needs letters that
  break one at a time, so it argues for per-letter objects.
- Which blog look (fresh, blend, Blue room / iter-5, other). The skeuomorphic-vs-unbiased pair below may
  fold into this.
- Social handles (X, LinkedIn, YouTube, optional Twitch).
- What the "LOG" page holds (dev log? changelog of the site? his Village diary?).

## Suggested lanes (adjust as you see fit)

1. **The place.** Choose an iconic SF viewpoint where Salesforce Tower and the Golden Gate are both in
   view, with billboards where billboards would plausibly stand. Run a short experiment with two or three
   candidate viewpoints (rendered from our data, with a reference photo next to each), then ask him. Use
   lidar, footprints, satellite and photo references, plus generated textures (fal and ChatGPT) for
   architecture and landscape. Landmark buildings and the bridge get hero treatment through the
   image-to-asset pipeline. The bar is "shockingly" true likeness.
2. **Sky and time.** A plane slowly towing a banner in the background, fed by any image or text, legible
   but not in your face. A light/dark switch that moves the world's time to day or night smoothly, so
   the city lights up physically. The page theme follows.
3. **Graphics settings.** Quality presets that set shadows, reflections and AA. A resolution-scale
   slider. Dynamic resolution with a frame-rate target, 60 fps by default. Built on the engine's existing
   picture-scale steering.
4. **UI surfaces, twice.** Every UI surface in the engine and the site comes in two versions he can
   switch between: skeuomorphic throughout, and an unbiased iteration.
5. **Tsundere support button.** Spec quoted below. Eyes follow the pointer, the button dodges, then gets
   annoyed, then a menacing standoff with a MUDA MUDA barrage at the cursor, a bulldozer smash, "good
   grief", and it escapes. Our own animation and sounds. Reference video:
   https://youtu.be/kIaqZh_gGz4. Keep a real contact route reachable for keyboard and screen readers.
6. **Easter eggs.**
   - Destroy the B on BLOG and the sign reads LOG, which opens a log page.
   - An F12 console greeting: "Hello there" / "General Kenobi", ASCII art of the scene, and "If you
     managed to find this, you can send your resume… oh wait I'm not hiring, nvm".
   - IDDQD.
   - Shooting the moon changes its size.
   - Research the top 5 popular easter eggs the site doesn't use yet and implement them.
7. **Writing.** Post from the website with a best-in-class custom editor. AI sessions are a first-class
   block, adapting `conversation-artifact` into something better: a new way to share work, like code
   blocks. Posts still end up as Markdown plus assets that the generator builds. Choose and test the store
   (commits to a private repo vs D1/R2), and the auth (Cloudflare Access or passkeys).
8. **Blog MCP server.** Lets him post, update and configure the blog from his AI clients. A remote MCP on
   Workers with OAuth, using the same write path as the editor.

Model routing: Fable 5.2 for the hardest design and engine work (the owner's preference), Opus 5.5 for
architecture and review, Sonnet or Haiku for lookups. Keep subagents short-lived.

## The owner's message, verbatim

> Okay! conceptually it works! The 3D design can become a really neat website. Here are my thoughts.
> Coordinate a handoff to coordinator who will organize getting these done.
> * The concept of using billboards as navigation is awesome in the context of prevalence of AI billboards
> in SF. I We need to put effort into thoughtfulness and presentation. Let's pick a specific iconic location
> in sf. I'm thinking of a view where you see landmark skyscrapers, like salesforce tower , and golden gate,
> and put the billboards where they would be reasonable to be. To increase the fidelity we can reuse what we
> learned from the thread about real cities (whole planet) in the game, plus what we learned when started
> using the new pipeline for assets like cars and props from an image. Like bmw x3. For architecture and
> landscapes we can use a mix of real photos, satellite imagery and image generation models (ChatGPT and
> fal.ai - have access to both). The like-to-likeness should be genuinely shockingly impressive.
> * Continuing the theme of billboards - add a flying plane with a placard slowly flying in the background.
> where i can put any image or text and it'd be clearly readable but not in your face. We'll figure out fun
> ways to use it,
> * Graphic setting should be easily toggleable. (Quality levels that internally manipulate shadows,
> reflections, AA) and resolution scale slider and dynamic resolution setting with frame rate target). 60fps
> by default target.
> * Light/Dark mode switch which smoothly forwards time to night/day, so it physically dark in the world -
> and the city lights up.
> * Use frontend design skill for all ui surfaces in engine and website. Build two versions I could switch
> between skeuomorphism throughout, and unbiased iteration.
> * Tsundere support button.
> * We don't need village button and feed I think. Yet.
> * Place for Social links (x, LinkedIn, optional twitch, YouTube )
> * I should be able to post blogs from the website. Best in class editor and blogging experience. Build
> custom so that we have a capability to have ai sessions first class. Like a new way to share work like
> code blocks. See my skill I built for interfaces as artifacts of sessions to share with the team. Adapt
> the idea and implement it better.
> * MCP to add and update config in my blog (post from within my ai clients)
> * Tsundere contact support floating button in top right (lightly mocking those everywhere addons on all
> sorts of websites and a throwback to old school flash games like don't press the red button and
> variations) A contact support floating button but it's aggressively unhelpful - avoids your pointer, its
> eyes follow the pointer. Classic Tsundere button with tsundere lines like "it's not like I want to help
> you. We don't even sell lanything here". if you manage to click it it will get mildly annoyed, and if you
> manage to click again it will turn into a jojo scene with sound effects like "are you threatening me?!"
> And then start 'MUDA MUDA MUDA MUDA MUDA" your cursor, and then smash a bulldozer against it, and when it
> ultimately can't destroy your cursor it's like "good grief" and will escape.
> https://youtu.be/kIaqZh_gGz4?is=Dl7E6afqYClEvBdM
> Animations must be sublime. So remember to use the design skill and the skill pack with the animation
> info too.
> * Blog But if you destroy B you will open a page with a log
> * F12 console easter eggs: Hello there general Kenobi with ascii art of the scene. And then a line like
> "If you managed to find this, you can send your resume… oh wait I'm not hiring, nvm"
> * IDDQD
> * When you shoot at the moon it changes size (gta reference)
> * Find Top 5 other unused most popular Easter eggs and implement them
