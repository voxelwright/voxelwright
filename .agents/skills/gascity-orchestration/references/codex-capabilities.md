# Codex worker MCP capabilities (0.160.0)

Scope: the Codex dependency of Village's worker/orchestration path. Inspected
source is pinned to `a956835d020762cb2b570053af06f643a11c0ecc`, with native
synthetic evidence recorded November 5, 2026. This does not change Gas City,
install task-specific admission in Village workers or establish family privacy.

## Select the whole surface

The trusted operator selects task capabilities. Read the effective server map;
omitting a server from a newly supplied fragment does not establish its absence
from inherited configuration. For an unadmitted configured server, use native
`mcp_servers.<name>.enabled=false` or exclude it from the effective map. The
pinned connection manager initializes only enabled servers.

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
`ConfigToml` after applying configuration requirements; it is not the original
sparse TOML. At this pin:

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

## Proven recipe and remaining work

[Evidence/015](../../../../evidence/015-codex-mcp-capabilities.md) binds the
original incomplete preflight, repaired archive, pinned source and nine returned
files. The actual 0.160.0 app-server passed whole-server-disable and enabled
empty-tool-allowlist phases, with positive nonce controls and zero provider HTTP
requests/model turns. The 2.118461507-second outer run measures this synthetic
control plane, not model latency. Its version/launcher hash does not establish
identical upstream build provenance.

The author of the repair also wrote the post-run assessment; it is not
independent review. Actual Village workers still lack task-specific admission.
A later candidate must prove its own complete worker path, including meaningful
denials, interruption and the selected real-provider/profile context. This
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
