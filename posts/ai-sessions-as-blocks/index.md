---
title: "AI sessions as blocks (demo)"
date: 2026-11-16
summary: "Demo of the ai-session block: a real session from the day this site started, trimmed and redacted."
tags: [ai, site]
draft: true
---

Placeholder text for the demo, not the owner's writing. The block below is a real Claude Code
session from the day this site was started, imported with `npm run session`, trimmed to four of
its prompts and redacted. Pavlo Zahynailo wrote the prompts.

<ai-session src="founding.session.json" open="1">

A session reads like a code block: the numbers down the side are links, like line numbers, and
everything the agent did between the words is folded away. Follow a link such as
[prompt 3](#s-founding-t8) and the block opens at that turn.

The second block is a synthetic sample. None of the real sessions of this repo had the agent
ask a structured question, so this one was written by hand to show how a decision looks.

<ai-session src="decision-sample.session.json" open="all">

```js
// Code blocks keep their own look beside a session.
const turn = session.turns.find((t) => t.id === "t8");
```
