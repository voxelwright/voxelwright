> Historical proposal from November 3, 2026. Superseded by the owner's
> November 4 request and AGENTS.md. This is not shipped behavior or current authority.

# Dogfood experience

A private home for useful help. Not a monitoring console with beige paint.

Desktop: narrow warm sidebar with Village wordmark/house mark, three honest destinations (Home, Gilfoyle, In good hands), small single-owner/private note. Main uses generous whitespace, warm paper, deep ink, muted terracotta and olive accents, serif editorial headings with readable system sans controls. No external fonts or image calls. A small original decorative house illustration may be used, marked aria-hidden. Mobile: compact header/navigation with large touch targets; no squeezed desktop sidebar.

Home: date, “Welcome home.”, plain “A little less to keep in your head.” The action is “Talk with Gilfoyle.” Latest completed readiness check is shown only after it exists, with timestamp and bounded summary, linked to evidence. If attention exists, show concrete failed check/action promptly; never hide behind a green aggregate. Empty home says what Gilfoyle can actually do, not fictional good news. No graph dashboard, fake family updates or invented presence.

Conversation: “Gilfoyle / Founding elder” and owner-only audience. Stable history, calm message layout, easily selectable text, visible timestamps, multiline composer, labeled send. Enter sends, Shift+Enter newline with IME handled; sending preserves draft until accepted. Pending message and operation states shown without fake typing claims. Polling must not replace focused input, reset scroll while reading, or duplicate messages. A refresh during work returns to same relationship. On network failure, preserve text and submission ID; no silent resubmission.

In good hands: one real responsibility, “Keep Village ready.” Explain scope and frequency; latest evidence plus previous check runs. “Check now” works without model spend. A failed check stays visible with timestamp and useful next step. Unknown/not-yet-checked is not healthy. Avoid exposing service credentials, raw logs or arbitrary host paths.

Recovery: pending runtime outcome is “Reply needs checking”, not failed/successful fiction. “Check for reply” only reconciles. If unresolved, explain no action was resent. Explicit acknowledgement can permit a new message only after user understands an earlier action may still have happened; it is not a retry. Design must avoid letting running old work race new work.

Keyboard: skip link, landmark nav/main, current-page state, visible focus, labels, logical order. Status announcements concise, not entire transcript on every poll. Reduced motion; 200% zoom; no horizontal overflow at 390px. Use textContent for untrusted results. No CDN, analytics, service worker or offline private cache.
