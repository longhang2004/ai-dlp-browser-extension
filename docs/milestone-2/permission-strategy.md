# Milestone 2 permission strategy

## Decision

For consumer or manually installed PromptGuard, keep ChatGPT's current static
entry and defer every real Claude permission until the same M2.2 release
candidate contains a usable Claude adapter. M2.1 supplies only closed permission
abstractions, Settings V3/Audit V4 migrations, reconciliation design, view
models, mocks, and future-shape artifact rules. It changes no manifest
permission, exposes no permission action, and calls no permission API against a
real Claude origin.

M2.2 proposes the exact Manifest V3 shape below. `scripting` is optional because
only optional dynamically registered surfaces require it; it must never be
placed in required `permissions`.

```json
{
  "permissions": ["storage"],
  "optional_permissions": ["scripting"],
  "optional_host_permissions": ["https://claude.ai:443/*"]
}
```

The options page requests both optional grants in one explicit user gesture:

```ts
const granted = await chrome.permissions.request({
  permissions: ["scripting"],
  origins: ["https://claude.ai:443/*"],
});
```

The proposed explicit default-port pattern is used unchanged by the declaration,
`request()`, `contains()`, `remove()`, dynamic registration, catalog permission
metadata, artifact allowlists, validators, reconciliation, fixtures, and QA. The
first executable guard still requires `location.origin === "https://claude.ai"`,
and background validation independently derives the canonical origin from
`sender.url`. These are defense in depth, not compensation for an intentionally
broad port wildcard.

For managed enterprise deployment, recommend separately signed distribution
builds with only their approved exact origins. Do not assume that optional
permissions can be silently pre-granted. Chrome enterprise policy can install an
extension and restrict runtime hosts, but an allowed-host policy is not proof
that a manifest optional permission has been granted.

No design here authorizes `<all_urls>`, `tabs`, `activeTab`, `webRequest`,
`clipboardRead`, `clipboardWrite`, `downloads`, or `debugger`.

## Chromium contracts

The design relies on these current official contracts:

- Chrome's
  [`permissions` API](https://developer.chrome.com/docs/extensions/reference/api/permissions)
  declares optional origins in `optional_host_permissions`, requires
  `permissions.request()` to run within a user gesture, provides `contains()`
  and `remove()`, supports named permissions in `optional_permissions`, and
  emits added/removed events.
- Chrome's
  [content-script documentation](https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts)
  distinguishes static, dynamic, and programmatic injection. Dynamic scripts are
  registered, inspected, updated, and removed through `chrome.scripting`.
- Chrome's
  [`scripting` API](https://developer.chrome.com/docs/extensions/reference/api/scripting)
  requires the named `scripting` permission plus host access. Registered scripts
  default to persistence across sessions, `document_idle`, and the isolated
  world; PromptGuard will set these values explicitly.
- Chrome documents that unregistering a script does not remove code already
  injected into a loaded document. PromptGuard must dispose live ports before
  unregistering and reject stale ports afterward.
- Chrome's
  [`ExtensionSettings` policy](https://support.google.com/chrome/a/answer/9867568)
  can control installation and runtime allowed/blocked hosts. Runtime host
  restriction is defense in depth, not an optional-permission grant.

## Strategy comparison

### A — Static packaged scripts for every approved origin

| Consideration             | Result                                                                                                                        |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Install-time disclosure   | Every static match contributes host-access disclosure.                                                                        |
| Automatic access          | The script runs automatically on every matched approved origin when Chrome grants access.                                     |
| Enterprise deployment     | Simple single artifact, but every deployment receives every packaged origin.                                                  |
| Base-installation scope   | Broadens access even for users who need only ChatGPT.                                                                         |
| Revocation and enablement | Requires browser site-access controls or a release; a local toggle can dispose behavior but cannot remove the declared match. |
| Selector isolation        | Possible with per-origin entries, but access remains installed for all entries.                                               |

This strategy is rejected for new consumer surfaces because it silently expands
the base installation's declared browsing access.

### B — Optional host permission plus runtime activation

| Consideration                                 | Result                                                                                                                                                          |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Manifest                                      | M2.2 only: optional `scripting` plus exact default-port `optional_host_permissions`; no wildcard family.                                                        |
| Dynamic registration                          | Required so a disabled/ungranted Claude surface has no executable Claude registration.                                                                          |
| Named permission                              | `scripting` is optional and requested only with the Claude host in M2.2; ChatGPT does not require it.                                                           |
| User gesture                                  | One options-page click requests `permissions: ["scripting"]` and `origins: ["https://claude.ai:443/*"]` together.                                               |
| Removal                                       | Remove the Claude host and remove optional `scripting` only after its last catalog-owned enabled/granted dynamic dependent is gone.                             |
| Restart persistence                           | Register with `persistAcrossSessions: true`, then reconcile registration, setting, permission, catalog version, and entry file on every service-worker startup. |
| Permission granted, adapter disabled          | `adapter_disabled`; no registration.                                                                                                                            |
| Adapter enabled, either optional grant absent | `permission_not_granted`; show the fixed reason and explicit permission action with no protection claim.                                                        |
| Before M2.2                                   | No real Claude permission request or activation is exposed; an inert preview, if shown, says support is not installed.                                          |
| Managed enterprise                            | Policy may force-install and restrict hosts, but the build still verifies effective access and reports it honestly.                                             |

This is the consumer/manual-installation recommendation.

### C — Separate distribution builds per application

| Consideration           | Result                                                                                              |
| ----------------------- | --------------------------------------------------------------------------------------------------- |
| Permission minimization | Strongest: each signed build declares only its approved exact origin set.                           |
| Operational overhead    | Separate release artifacts, channels, support records, QA, and rollout coordination.                |
| Release/signing         | Every build needs reproducible provenance, signing, digest, source archive, and update consistency. |
| Enterprise deployment   | Strong fit for organization-specific approved applications and managed rollout.                     |
| Update consistency      | Requires release automation to prevent policy/core version skew.                                    |

This is the managed-enterprise recommendation despite its operational cost. Each
build is independently reviewed and signed; no policy-delivered code or selector
configuration is permitted.

## Effective permission and state machine

M2.1 defines these closed, prompt-free contracts without requesting them:

```ts
type ClaudeEffectivePermission = {
  readonly hostGranted: boolean;
  readonly scriptingGranted: boolean;
};

type PermissionHealthCode =
  "host_access_missing" | "scripting_missing" | "host_and_scripting_missing";
```

No status, audit, or message may expose arbitrary permission arrays. The M2.2
permission-ready decision is exhaustive:

| Host | `scripting` | Result                                                            |
| ---- | ----------- | ----------------------------------------------------------------- |
| No   | No          | `permission_not_granted`; `host_and_scripting_missing`            |
| Yes  | No          | `permission_not_granted`; `scripting_missing`                     |
| No   | Yes         | `permission_not_granted`; `host_access_missing`                   |
| Yes  | Yes         | Continue to enablement, descriptor, registration, and port checks |

After the last row, settings and runtime state remain separate inputs:

| Enabled | Effective permission | Candidate descriptor/port                                                     | State                    |
| ------- | -------------------- | ----------------------------------------------------------------------------- | ------------------------ |
| No      | No or yes            | Any                                                                           | `adapter_disabled`       |
| Yes     | No                   | Any                                                                           | `permission_not_granted` |
| Yes     | Yes                  | No catalog-correlated proposed verified candidate descriptor                  | `adapter_unsupported`    |
| Yes     | Yes                  | Proposed verified candidate descriptor, no current composer                   | `adapter_waiting`        |
| Yes     | Yes                  | Proposed verified candidate descriptor and valid composer/Send ownership      | `adapter_active`         |
| Yes     | Yes                  | Connected catalog-validated proposed verified runtime with fixed health fault | `adapter_degraded`       |

Transport `initializing` applies before validated state is available, and
transport `unavailable` applies when no valid content port can report. Neither
state identifies the current site. Registration failure or rollback without an
accepted port is `adapter_unsupported` or transport `unavailable`, never
`adapter_degraded`; permission loss is `permission_not_granted`.
`adapter_active` describes current-context health, not blanket capability
coverage.

Enabling without permission never calls `request()` automatically. Granting
permission does not enable the surface or change detector/policy settings.
Revocation of either host access or `scripting` synchronously invalidates the
background generation before awaited work, immediately rejecting stale messages,
status, audit, and authorization. Port disposal, registration reconciliation,
and unregistration then run asynchronously as best effort. The same
reconciliation runs after either named- or host-permission event.

Removing Claude access removes its host permission. It removes optional
`scripting` only if this catalog-owned decision returns false after the host and
settings transition:

```ts
function isScriptingStillRequired(
  surfaces: readonly EffectiveSurfaceState[],
): boolean;
```

The helper derives only from the immutable packaged catalog, validated settings,
and live effective permissions. Page data and managed policy cannot mark a
surface as dynamically registered or require `scripting`. Tests cover all four
host/named combinations, both revocation paths, removal with no remaining
dependent, a hypothetical second catalog-owned dynamic dependent, rejection of
unknown named permissions, and ChatGPT operation without `scripting`.

## Dynamic Claude registration

M2.2, if approved, registers one immutable packaged entry:

```ts
{
  id: "promptguard-claude-v1",
  matches: ["https://claude.ai:443/*"],
  js: ["content-claude.js"],
  allFrames: false,
  world: "ISOLATED",
  runAt: "document_idle",
  persistAcrossSessions: true,
}
```

The final version suffix must equal the packaged catalog registration version;
it is not supplied by settings or policy. Startup reconciliation calls
`getRegisteredContentScripts()`, removes unknown, stale, mismatched, disabled,
or unpermitted PromptGuard registrations, and registers the exact expected entry
only when all inputs allow it. Registration errors produce fixed status and no
protection claim.

The first executable guard checks `location.origin === "https://claude.ai"`
before constructing an adapter, registering interception, or reading DOM.
Background sender validation rejects alternate-port ports/messages
independently. Tests prove that `https://claude.ai:8443/` produces no adapter
construction, interception, DOM read, accepted port, status, or audit even if a
browser defect or future fallback causes injection there.

Only the top frame is allowed. Related-origin fallbacks, `about:`, `data:`,
`blob:`, subdomains, HTTP, alternate ports, and path-derived origin expansion
are excluded from adapter/runtime acceptance. The packaged JavaScript file is
used; no runtime function, string, remote asset, or interpreted selector data is
accepted.

## Pre-M2.2 explicit-port browser proof

Before production M2.2 work, run a small proof on every supported Chrome/Edge
baseline. It must cover Manifest V3 declaration parsing,
`permissions.request()`, `permissions.contains()`, `permissions.remove()`, and
`registerContentScripts()` using exactly `https://claude.ai:443/*`. Record only:

```text
Browser:
Exact version:
Pattern: https://claude.ai:443/*
Declaration accepted:
Request accepted:
Contains accepted:
Remove accepted:
Registration accepted:
Default-port claude.ai page matched:
Alternate-port fixture matched:
```

Expected results are `matched` for the default-port page and `not matched` for
the alternate-port fixture. Record no page contents or user data. If a supported
browser actually rejects the explicit-port pattern, record the browser/version,
API, and concrete result before explicitly proposing `https://claude.ai/*` as a
fallback. The fallback retains both origin guards and alternate-port no-DOM-read
tests and is described as exact host with wildcard port, never exact origin. No
silent fallback is allowed.

## Options and popup behavior

M2.1 exposes no working Claude permission or activation action. A disabled
reserved setting may exist for migration compatibility, but normal options UI
does not offer activation. If an inert preview is shown, its exact copy is:

> Claude support is not installed in this release.

M2.2 presents Claude with separate enablement and current permission state. It
provides:

1. The exact application and origin.
2. The fixed disclosure: “PromptGuard can access only the AI applications that
   are explicitly enabled and granted permission.”
3. One permission button whose click requests optional `scripting` and
   `https://claude.ai:443/*` together.
4. A separate enabled control.
5. A remove-access action that names the same origin and explains that loaded
   pages may need refresh after runtime disposal.
6. Honest state copy when both optional grants exist: if descriptor
   verification, exact registration, or a validated port is absent, show
   `adapter_unsupported` or transport `unavailable`, never `adapter_degraded`.
   Reserve `adapter_degraded` for a still-connected, catalog-validated verified
   runtime that reports a fixed health failure.

The exact M2.2 artifact always labels Claude “Claude verification candidate” in
runtime and options copy, including after the external human/release gate
accepts its exact SHA and digest. Acceptance is recorded only in signed
publication and release metadata; it is not a persisted setting,
permission-derived state, runtime message, network response, alternate copy
path, or reason to rebuild the artifact.

The popup cannot use `tabs` or infer an application from browser state. It names
a surface only after a validated top-frame content port reports a catalog-bound
descriptor. It displays no URL path, title, prompt, conversation, filename, or
page-derived text.

## Managed deployment

An enterprise package is built from the same source and detector/policy core but
with a reviewed exact-origin catalog and manifest. Each distribution has its own
artifact digest and signed update identity. Deployment documentation records the
origins, permissions, capabilities, employee disclosure, version, and rollback
channel.

`ExtensionSettings` may force-install the package and constrain runtime hosts.
PromptGuard still queries effective permission/access and never maps an
administrator allowlist directly to `adapter_active`. If a managed browser does
not expose an effective grant, status remains `permission_not_granted` or
`adapter_unsupported` and no script is registered.

## Failure and rollback behavior

- Denial: preserve disabled/unprotected state and fixed guidance; do not retry
  outside another explicit click.
- Revocation of either optional grant: synchronously invalidate background
  generation and reject stale authorization, status, and audit first; show
  `permission_not_granted` and an inactive surface; then dispose and unregister
  asynchronously. Require disposal acknowledgement. A failed or unresponsive
  runtime triggers refresh guidance and no protection claim because injected
  code may continue local observation or interception until acknowledgement or
  reload.
- Startup mismatch: remove stale registration and dispose any connected old
  generation. Before exact reconciliation, or whenever no validated port exists,
  report `adapter_unsupported` or transport `unavailable`; `adapter_waiting` is
  allowed only after exact registration and a validated port exist but no
  composer has been resolved.
- Registration failure without an accepted port: show `adapter_unsupported` or
  transport `unavailable` with a fixed code and no active claim.
- Claude drift or release rollback: remove only Claude registration and catalog
  edge; remove its host permission only through explicit user action, and remove
  optional `scripting` only when `isScriptingStillRequired()` is false. ChatGPT
  remains static and unaffected.
- Enterprise policy conflict: treat runtime access as absent; policy cannot
  upgrade trust, capabilities, or permission.

Every path is tested without broad permissions or network activity.
