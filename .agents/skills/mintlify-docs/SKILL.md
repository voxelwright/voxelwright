---
name: mintlify-docs
description: Maintain Village's canonical Mintlify owner handbook and unpublished review copy using the current connected Mintlify tools and versioned evidence.
---

# Mintlify documentation integration

Scope: docs/docs.json, six owner MDX pages and their unpublished Mintlify review copy. This pack records the adopted interface, not a complete vendor manual. Use documentation-maintenance for change ownership and review.

## Adopted interface and refresh

Adopted November 4, 2026: Mintlify plugin 1.1.0, connected Admin MCP interface. The service is unversioned; read its current read_skill index before writes and the relevant returned reference paths. The installed mintlify skill provides writing, product-context, configuration, navigation, components, publishing-and-review, and project-settings references. Reuse these guides; do not copy their whole manuals here.

Primary reference entry: https://mintlify.com/docs. Config schema: https://mintlify.com/docs.json. Refresh this pack when tool schemas, publishing behavior, source integration, authentication, CLI version or validation behavior change, or a probe contradicts a recorded claim.

## Verified setup and native capabilities

- Deployment handbook-site is projectType site. The deployment branch is main. Read settings before asserting current privacy or publishing behavior. noindex is not access control, and the observed settings do not prove published-site privacy.
- read and list_nodes work on main and the handbook branch. create_branch returned handbook-draft and an editor URL. Six reviewed pages were copied and read back there. Main's overview remained starter content. No publish is authorized.
- Branch edits auto-commit and may open a pull request; no PR link has been returned for this branch. Use create_node for a new page and its documented existing-path upsert when replacing an entire page. Read the existing page first. Every content operation must carry the exact branch. Validation errors and navigationErrors must be fixed before declaring the draft ready.
- write_page refused with base_version_required, but the exposed schema lacked baseVersion. An extra baseVersion argument did not resolve the refusal. The supported create_node existing-path upsert accepted the reviewed content. Readback matched frontmatter values and body text after whitespace normalization.
- diff/status returned empty changes even though branch reads contained the handbook and main still contained starter text. Do not infer publication or synchronization from an empty response. Native writes accepted markup and navigation; browser render proof remains unavailable. See docs/change-log.md for the concrete tool failures.
- Private-page operations are for workspace projects. Do not attempt to use them as a privacy setting for this site project.
- get_workflows list returned no workflows, and list_repos returned repos=[]/total=0. A source-triggered workflow is not configured. GitHub app installation is a dashboard/OAuth action; the Admin MCP cannot invent a source installation.

## Recipe and proof boundary

Read canonical docs and vendor guidance, freeze the changed files, obtain independent Editor review, then copy those exact pages into the unpublished branch. Read back source and navigation, inspect diff/status, and preserve the editor URL. Never call publish as part of generation or validation.

Local docs.json follows the current required theme/name/colors/navigation shape. Installed CLI 4.2.114 has no validate command; broken-links passed on the initial six pages. Connected writes supply schema/MDX validation. Record actual command outcomes in docs/change-log.md. A local parse or build proves documentation syntax, not privacy, deployment or product capability.

Official connection guidance: https://www.mintlify.com/docs/deploy/github links to https://app.mintlify.com/settings/project/git-settings. GitHub App installation must start through Mintlify's dashboard and should grant only the private source repository. Do not replace the artifact-backed docs source merely to add workflow context. The guide's manual source migration deletes hosted content; repository deployment changes also need a verified privacy boundary. No installation or migration has been performed.
