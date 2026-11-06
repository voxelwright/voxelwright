# Codex worker MCP capabilities (0.160.0)

Scope: the Codex dependency of Village's worker/orchestration path. Inspected
source is pinned to `a956835d020762cb2b570053af06f643a11c0ecc`, with native
synthetic evidence recorded November 5, 2026. This does not change Gas City,
install task-specific admission in Village workers or establish family privacy.

## Select the whole surface

The trusted operator selects task capabilities. Read the effective server map;
omitting a server from a newly supplied fragment does not establish its absence
from inherited configuration. For an ordinary-config exclusion, use native
`mcp_servers.<name>.enabled=false` or exclude it from the effective map. The
pinned connection manager initializes only enabled servers. Trusted native
requirements supply a separate whole-server authority; use the distinction below
before designing task admission.

For admitted servers, `enabled_tools` selects allowed tool names and
`disabled_tools` removes names afterward. These tool filters do not establish
resource authorization. In the native probe, an enabled server with
`enabled_tools=[]` rejected its tool call but exposed resources/templates and
successfully served its synthetic resource. Whole-server disable produced no
startup/dispatch receipt and no resource catalog in that run.

Check resource and account access separately before using an admitted server
with private content. Disabling apps/features or hiding tool names is not proof
that the model-visible host metadata surface has been excluded. The earlier
Village metadata exposure's provenance remains unresolved.

## Validate typed effective configuration

The probe uses `codex app-server --strict-config --listen stdio://`, then
`config/read` before thread/catalog work. That response serializes typed
`ConfigToml` after its requirements handling; it is neither the original sparse
TOML nor the final runtime MCP registry. Runtime name/identity filtering occurs
later. At this pin:

| Serialized value | Consequence for the synthetic preflight |
| --- | --- |
| Twelve absent provider options are null; `supports_standalone_web_search` is false | Match the known complete provider shape instead of rejecting every key absent from input. |
| MCP `environment_id` is `local` | Check the effective environment rather than treating the serialized field as an unexpected injection. |
| Timeout seconds serialize as floats, here `5.0` | Match pinned types; Python boolean/integer equality is not an exact type check. |

For this zero-model recipe, require the exact loopback tripwire provider,
credential/header/query/helper fields absent or their pinned null/default
values, exactly the synthetic servers and local environment, and the selected
commands/arguments/timeouts. Reject unexpected fields and type substitutions
before dependent RPCs. These are the probe's acceptance rules, not a claim that
all legitimate provider configurations must be credential-free or local.

Use fresh synthetic profiles and physical fixture copies. Do not copy login
files or print/save raw effective configuration, environment values, catalogs
or nonce responses. The probe records fixed-name boolean checks and bounded
application receipts. Saved successful comparisons remain harness assertions;
application receipts are not OS audit logs.

## Native worker configuration and requirements

[Evidence/019](../../../../evidence/019-codex-worker-requirements.md) records actual
worker-path R5/R6 probes on Codex 0.160.0 and bubblewrap 0.12.0. The unchanged
runner is bound to `6de8fc9b60f0542e9e5c5db1d61cb5dcc3964417`; synthetic launcher
instrumentation adds strict config and explicit CLI fixture settings after the
`exec` subcommand. Do not equate this with production admission. Each loopback
HTTP 400 intentionally fails the worker; zero models and zero tool dispatches
are not successful task execution.

Exec's `--ignore-user-config` skips user TOML; standalone app-server exposes a
different loader surface. R5 retained the flag and excluded a user-only inherited
server; removing it in the positive control admitted that server. An empty
ordinary-config MCP table recursively merges and does not clear inherited keys.
Compare typed projections before execution, then check runtime startup and actual
advertisement separately. The pinned config/read processor inserts seven resolved
feature defaults in addition to fixture keys. Match those exact defaults and the
known public ChatGPT base URL; retain typed-null checks for other absent fields.
Do not broaden unknown-key acceptance to repair a serialization mismatch.

At this pin, the native loader reads `/etc/codex/requirements.toml` separately
from user configuration. Native requirements constrain whole servers by name and
identity, including ones explicitly enabled through CLI config:

| Requirements `mcp_servers` | R6 executed startup/advertisement |
| --- | --- |
| Absent | All three synthetic configured servers. |
| Explicit empty table | None. |
| Named exact executable and ordered exact argument matchers | Admitted server only. |
| Executable or argument identity mismatch | None. |

Use structured `identity.command` with `executable` and ordered `args` when
argument identity matters. The legacy command-string form checks only the
executable. The native matcher does not bind cwd or environment. Prefix/regex,
HTTP URL and plugin matching are inspected source, not executed R6 controls.
`enabled_tools`/`disabled_tools` remain ordinary config filters; do not describe
them as requirements-enforced tool policy or account/resource authorization.

R6 uses a fresh synthetic policy mounted read-only at both its native path and
original source alias inside each mount namespace, with a synthetic `/etc`.
The outer private network namespace and standard private `/dev` must pass their
five controls before Git/Codex; stop if unavailable. All 260 typed preflights,
54 read-only mount checks and five namespace/device controls passed, with five
loopback HTTP requests in 4.572 outer seconds. R5 passed 104 typed preflights,
five namespace/device controls and two loopback requests in 2.318 outer seconds.
These fences do not establish an arbitrary-code, family-filesystem or account
boundary. No production policy contract, real-provider/profile parity, broad
descendant cleanup or earlier host-metadata provenance is established.

Keep failures: R1/R2 rejected typed defaults; R3 lost fixture overrides and
recorded 11 unauthenticated public OpenAI route/401 events; R4 failed Git at
`/dev/null`. R5/R6 success cannot erase that history. Their selected original
receipts, exact instrumentation and source excerpts are bound in evidence/019.
Current official docs retain the relevant native matcher semantics; current-only
0.166.0 network-proxy behavior is not adopted.

Pinned primary sources: [exec loader](https://github.com/openai/codex/blob/a956835d020762cb2b570053af06f643a11c0ecc/codex-rs/exec/src/lib.rs#L358),
[requirements loader](https://github.com/openai/codex/blob/a956835d020762cb2b570053af06f643a11c0ecc/codex-rs/config/src/loader/managed_requirements.rs),
[runtime filter](https://github.com/openai/codex/blob/a956835d020762cb2b570053af06f643a11c0ecc/codex-rs/core/src/config/mod.rs#L2140),
and [identity matcher](https://github.com/openai/codex/blob/a956835d020762cb2b570053af06f643a11c0ecc/codex-rs/config/src/mcp_requirements.rs).

## Earlier resource recipe and remaining work

[Evidence/015](../../../../evidence/015-codex-mcp-capabilities.md) binds the
original incomplete preflight, repaired archive, pinned source and nine returned
files. The actual 0.160.0 app-server passed whole-server-disable and enabled
empty-tool-allowlist phases, with positive nonce controls and zero provider HTTP
requests/model turns. The 2.118461507-second outer run measures this synthetic
control plane, not model latency. Its version/launcher hash does not establish
identical upstream build provenance.

The author of the repair also wrote the post-run assessment; it is not
independent review. Actual Village workers still lack task-specific admission.
R5/R6 now add the bounded worker-path evidence above. A production candidate
must still prove its complete admission path, including meaningful denials,
interruption and the selected real-provider/profile context. This
probe proves no logged-in profile isolation, family OS/application boundary,
account authority, semantic task behavior or release qualification.

Refresh this reference before accepting changed behavior when the Codex binary,
source revision, typed provider/MCP schema, config layer/requirements handling,
transport, resource path or host-owned extension/profile context changes. Compare
the pinned source with the target version and repeat the affected synthetic
controls; do not bless new serialized defaults merely to pass an old check.

Pinned primary sources: [typed config/read](https://github.com/openai/codex/blob/a956835d020762cb2b570053af06f643a11c0ecc/codex-rs/app-server/src/config_manager_service.rs#L137),
[provider serialization](https://github.com/openai/codex/blob/a956835d020762cb2b570053af06f643a11c0ecc/codex-rs/model-provider-info/src/lib.rs#L133),
[MCP config](https://github.com/openai/codex/blob/a956835d020762cb2b570053af06f643a11c0ecc/codex-rs/config/src/mcp_types.rs#L233),
[enabled-server initialization](https://github.com/openai/codex/blob/a956835d020762cb2b570053af06f643a11c0ecc/codex-rs/codex-mcp/src/connection_manager.rs#L312),
[tool filters](https://github.com/openai/codex/blob/a956835d020762cb2b570053af06f643a11c0ecc/codex-rs/codex-mcp/src/tools.rs#L72),
and [resource calls](https://github.com/openai/codex/blob/a956835d020762cb2b570053af06f643a11c0ecc/codex-rs/codex-mcp/src/connection_manager/resources.rs#L133).
