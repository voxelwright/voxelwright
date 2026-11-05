---
name: mintlify-docs
description: Maintain and publish Village's reviewed private owner handbook using current connected Mintlify tools, versioned evidence and deployment readback.
---

# Mintlify documentation integration

Scope: docs/docs.json, six owner MDX pages and their reviewed private Mintlify deployment. This pack records the adopted interface, not a complete vendor manual. Use documentation-maintenance for change ownership and review.

## Adopted interface and refresh

Adopted November 4, 2026 and refreshed November 5: Mintlify plugin 1.1.0, connected Admin MCP interface. The service is unversioned; read its current read_skill index before writes and the relevant returned reference paths. The installed mintlify skill provides writing, product-context, configuration, navigation, components, publishing-and-review, and project-settings references. Reuse these guides; do not copy their whole manuals here.

Primary reference entry: https://mintlify.com/docs. Config schema: https://mintlify.com/docs.json. Refresh this pack when tool schemas, publishing behavior, source integration, authentication, CLI version or validation behavior change, or a probe contradicts a recorded claim.

## Verified setup and native capabilities

- Deployment handbook-site is projectType site, with Mintlify deploy branch main and an artifact-backed source. The live URL returned by deployment_status is https://handbook.example.invalid. Read current settings before publishing; noindex and a private source flag are not site access control. November 5 readback showed authType=mintlify even though privacy and userAuthType were null. Credential-free GETs to /, /current-status, /current-status.md and /llms-full.txt each redirected to Mintlify end-user authentication without handbook content. These probes establish access gating for those routes at that time, not every possible export or preview.
- read and list_nodes work on main and handbook-draft. Six earlier reviewed pages were copied to the draft and read back; main still contains starter pages at this preflight. The owner's November 5 grant authorizes publication of independently reviewed private docs without routine approval. It does not authorize Village source merges or application releases. The earlier automatic approval rejection concerned export consent; the explicit grant resolves that consent requirement. An actual new rejection still requires stopping and reporting, not an alternate-route retry.
- Branch edits auto-commit and may open a pull request; no PR link has been returned for this branch. Use create_node for a new page and its documented existing-path upsert when replacing an entire page. Read the existing page first. Every content operation must carry the exact branch. Validation errors and navigationErrors must be fixed before declaring the draft ready.
- write_page refused with base_version_required, but the exposed schema lacked baseVersion. An extra baseVersion argument did not resolve the refusal. The supported create_node existing-path upsert accepted the reviewed content. Readback matched frontmatter values and body text after whitespace normalization.
- diff/status returned empty changes even though branch reads contained the handbook and main still contained starter text. Do not infer publication or synchronization from an empty response. Native writes accepted markup and navigation; browser render proof remains unavailable. See docs/change-log.md for the concrete tool failures.
- Private-page operations are for workspace projects. Do not attempt to use them as a privacy setting for this site project.
- get_workflows list returned no workflows, and list_repos returned repos=[]/total=0. A source-triggered workflow is not configured. GitHub app installation is a dashboard/OAuth action; the Admin MCP cannot invent a source installation.

## Recipe and proof boundary

Read canonical docs and current vendor guidance, freeze pages/config and policy changes, then obtain clean independent Editor review. Verify current private authentication and unauthenticated route gating before content writes. Copy the exact reviewed pages/config to the chosen Mintlify branch with explicit branch arguments. Read back content and navigation and inspect validation and diff/status. Publish under the standing private-docs grant, then follow the returned commit with deployment_status until live and compare deployed content/navigation to the reviewed snapshot. Recheck unauthenticated access. Record the source head, payload hashes, normalization and deployment receipt in docs/change-log.md or a linked receipt. Do not report publication from draft readback alone.

Local docs.json follows the current required theme/name/colors/navigation shape. Installed CLI 4.2.114 has no validate command; broken-links passed on the initial six pages. Connected writes supply schema/MDX validation. Record actual command outcomes in docs/change-log.md. A local parse or build proves documentation syntax, not privacy, deployment or product capability.

Official connection guidance: https://www.mintlify.com/docs/deploy/github links to https://app.mintlify.com/settings/project/git-settings. GitHub App installation must start through Mintlify's dashboard and should grant only the private source repository. Do not replace the artifact-backed docs source merely to add workflow context. The guide's manual source migration deletes hosted content; repository deployment changes also need a verified privacy boundary. No installation or migration has been performed.

Current authentication guide: https://www.mintlify.com/docs/deploy/authentication-setup. Mintlify-managed private authentication requires organization sign-in and is available on all plans. Authenticated sites can have public-page overrides and older previews can remain accessible, so do not replace route checks with a settings-only claim. The November 5 probes and sanitized settings are recorded in docs/.mintlify/private-publishing-preflight.json. Do not change authentication, billing, source integration or source migration during ordinary handbook synchronization.
