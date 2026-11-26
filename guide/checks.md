---
title: Repository checks
description: Every check the root runner knows, whether CI runs it, and what it needs.
---

Use a name with `npm run check -- --only NAME`. The default CI run excludes local and skipped checks. A file prerequisite must exist even for a named run.

| Name | Default run | Required file |
| --- | --- | --- |
| `babble` | ci |  |
| `build-addroom` | local |  |
| `build-plan` | local |  |
| `docs` | ci |  |
| `docs-coverage` | ci |  |
| `docs-mentions` | ci |  |
| `docs-site` | ci |  |
| `engine-no-page` | ci |  |
| `entries` | local |  |
| `home-build` | ci |  |
| `home-typecheck` | ci |  |
| `host-approval` | ci |  |
| `host-daily-home` | local |  |
| `host-elder-home` | local |  |
| `host-file-lock` | ci |  |
| `host-physics-prompt` | ci |  |
| `host-plans` | ci |  |
| `host-promote` | local |  |
| `host-regressions` | skip |  |
| `host-reminders` | ci |  |
| `host-stop` | local |  |
| `host-typecheck` | ci |  |
| `host-village` | local |  |
| `host-villager` | ci |  |
| `invent` | local |  |
| `kernel` | local |  |
| `music` | local |  |
| `navigation` | local |  |
| `notebook` | local |  |
| `physics` | local |  |
| `physics-fire` | local |  |
| `physics-game` | local |  |
| `physics-touch` | local |  |
| `physics-toys` | local |  |
| `place` | local |  |
| `plan-history` | ci |  |
| `prop-sandbox` | local |  |
| `reminders` | local |  |
| `route-inside` | ci |  |
| `sketch` | local |  |
| `sound` | local |  |
| `sound-lab` | local | `home/.sound-lab/manifest.json` |
| `street-agent` | local |  |
| `street-block` | local |  |
| `street-cells` | local |  |
| `street-clear` | local |  |
| `street-door` | local |  |
| `street-look` | local |  |
| `street-make` | local |  |
| `street-problem` | local |  |
| `street-problems` | local |  |
| `street-touch` | local |  |
| `street-two` | local |  |
| `street-typecheck` | local |  |
| `tactile` | local |  |
| `talk-input` | local |  |
| `talk-notebook` | local |  |
| `talk-npc` | local |  |
| `theme-ask` | local |  |
| `themes` | skip |  |
| `villager` | local |  |
| `villager-gen` | local |  |
| `villager-motion` | local |  |
| `voxels` | ci |  |
