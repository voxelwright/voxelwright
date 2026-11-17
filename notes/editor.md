# The editor: interaction model (design note, not built)

Next milestone. This note fixes the shape before any code.

## What it is

One page at `/edit` behind the auth from `notes/writing-store-auth.md`. It writes the same thing
the site already reads: `posts/<slug>/index.md` plus files beside it. The editor never invents a
format of its own, so a post written in the browser, in a code editor or through the MCP server
is the same post.

## Principles

1. **The text is the document.** The source is Markdown with the site's custom elements. The
   editor is a rich view of that text, not a separate model that gets serialised. Round-trips
   are exact: open a post, change nothing, save, and the diff is empty.
2. **Write in the look.** The page under the caret uses the chosen look's stylesheet, so writing
   feels like reading. Blocks (code, sessions, scenes, notes) render as they will on the site and
   open into their source with one key.
3. **Never lose a word.** Every keystroke lands in IndexedDB first. Publishing sends the post with
   the revision it was opened at; a conflict shows both versions side by side and loses nothing.
   Works offline; publishes when back.
4. **Keyboard first, phone second, both complete.** Everything has a key and a visible control.
   On a phone the toolbar sits above the keyboard, and sessions can be imported from the share
   sheet.

## The surface

```
┌───────────────────────────────────────────────────────────────┐
│ ‹ Posts   AI sessions as blocks        Draft · saved 2 s ago  │  one calm line
├───────────────────────────────────────────────────────────────┤
│                                                               │
│   Title in the look's display face                            │
│   Summary, one line, required before publishing               │
│                                                               │
│   Body text in the reading column…                            │
│                                                               │
│   ┌ AI session  Starting the site ─────────────── ⋯ ┐         │  a block: rendered,
│   │ 1  Mira  I want to start a personal blog…        │         │  selectable as one unit
│   │ 2  Mira  never used anything…                    │         │
│   └──────────────────────────────────────────────────┘         │
│                                                               │
│   /  ← slash menu: code, image, session, scene, note, compare │
└───────────────────────────────────────────────────────────────┘
          Preview · Markdown · Publish  (bottom on phones)
```

- **Slash menu** at the start of an empty line inserts blocks; typing Markdown (`## `, ```` ``` ````,
  `> `) works as typed. Paste of a URL on a selection makes a link.
- **Drop a file**: an image becomes `![alt](name.png)` with the alt field focused (alt is not
  optional); a `.jsonl` transcript, a Codex rollout or ChatGPT's `conversations.json` opens the
  session importer.
- **Session importer** (the reason this editor is custom): a sheet that runs the same pipeline as
  `npm run session`, in the Worker, before anything is stored: pick the exchanges, see what
  redaction replaced (counts and highlighted spans, never the removed values), cut turns, rename
  people, then insert `<ai-session>`. Picking a session from the owner's own machine needs the
  file; the MCP server can send one directly from an AI client.
- **Model notes**: selecting text and choosing "Model wrote this" wraps it in `<model-note>` with
  the model and maker, so the line between his words and a model's stays visible.
- **Publish** runs the same checks as the build (front matter, files, sessions) and shows the
  result in words: "Published. Live in about a minute." with a link once the deploy lands.

## Motion

Per `site-craft`: none on typing or caret moves; block open and close 150 to 200 ms with the
`--ease-out` curve; the publish confirmation is the one moment with a little more (a short
settle on the status line). Reduced motion keeps only colour and opacity.

## Build choice

Candidates for the editing core, all MIT, to check before choosing:

- **CodeMirror 6** with Markdown decorations and block widgets: text stays the source of truth
  (principle 1 for free), excellent on mobile and with IME, widgets render our blocks.
- **ProseMirror / Tiptap**: richer WYSIWYG, but a document model that must round-trip to Markdown
  exactly, which is where most Markdown editors lose fidelity.
- **Lexical**: similar trade-off to ProseMirror.

Leaning: CodeMirror 6, styled to look like the page, with our blocks as widgets. It keeps the
Markdown exact, and the custom-element blocks are where the custom work should go.

## References

- CodeMirror 6 decorations and widgets: https://codemirror.net/docs/guide/#decorating-the-document
- iA Writer (focus on text, Markdown as the document): https://ia.net/writer
- Obsidian live preview (rendered Markdown that opens to source at the caret): https://help.obsidian.md/Editing+and+formatting/Edit+and+preview+Markdown
- Ghost editor cards (blocks inside prose): https://ghost.org/help/cards/
- Craft and Bear (calm, keyboard-first writing on phone and desktop)
- WebAuthn conditional UI, for passkey sign-in from the username field: https://web.dev/articles/passkey-form-autofill
