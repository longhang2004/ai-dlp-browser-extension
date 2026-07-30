# Milestone 2 permission strategy

## Decision

For consumer or manually installed PromptGuard, use exact optional host access
requested from the options page during an explicit click. Keep ChatGPT's current
static entry. M2.1 declares only `https://claude.ai/*` in
`optional_host_permissions`; it does not inject Claude code. M2.2 separately
requests approval to add `scripting` and persistently register a packaged
Claude-only content script after the exact host permission is granted.

Chrome's official
[match-pattern documentation](https://developer.chrome.com/docs/extensions/develop/concepts/match-patterns)
means `https://claude.ai/*` constrains scheme and host but, because it omits a
port, may inject the bootstrap on alternate ports. Before adapter construction
or DOM access, the bootstrap therefore requires serialized
`location.origin === "https://claude.ai"` and exits otherwise. Background sender
validation repeats the check. Alternate-port tests may observe bootstrap
injection but prove no page read, accepted adapter/runtime registration or port,
status, or audit.

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
  and `remove()`, and emits added/removed events.
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

| Consideration                                              | Result                                                                                                                                                          |
| ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Manifest                                                   | Exact `optional_host_permissions` entry; no wildcard family.                                                                                                    |
| Dynamic registration                                       | Required so a disabled/ungranted Claude surface has no executable Claude registration.                                                                          |
| Named permission                                           | `scripting` is required by `chrome.scripting`; adding it is an explicit M2.2 approval item.                                                                     |
| User gesture                                               | The options-page permission button calls `permissions.request()` directly inside the click handler.                                                             |
| Removal                                                    | `permissions.remove()` removes the exact host grant; the background disposes live runtime and unregisters Claude.                                               |
| Restart persistence                                        | Register with `persistAcrossSessions: true`, then reconcile registration, setting, permission, catalog version, and entry file on every service-worker startup. |
| Permission granted, adapter disabled                       | `adapter_disabled`; no registration.                                                                                                                            |
| Adapter enabled, permission absent                         | `permission_not_granted`; show the explicit permission action and no protection claim.                                                                          |
| Permission and enablement present before M2.2 verification | `adapter_unsupported`; no Claude executable entry.                                                                                                              |
| Managed enterprise                                         | Policy may force-install and restrict hosts, but the build still verifies effective access and reports it honestly.                                             |

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

## Consumer state machine

Settings and permission remain separate inputs:

| Enabled | Exact permission | Verified executable descriptor/port                                    | State                    |
| ------- | ---------------- | ---------------------------------------------------------------------- | ------------------------ |
| No      | No or yes        | Any                                                                    | `adapter_disabled`       |
| Yes     | No               | No                                                                     | `permission_not_granted` |
| Yes     | Yes              | No                                                                     | `adapter_unsupported`    |
| Yes     | Yes              | Verified descriptor, no current composer                               | `adapter_waiting`        |
| Yes     | Yes              | Verified descriptor and valid composer/Send ownership                  | `adapter_active`         |
| Yes     | Yes              | Connected catalog-validated verified runtime with fixed health failure | `adapter_degraded`       |

Transport `initializing` applies before validated state is available, and
transport `unavailable` applies when no valid content port can report. Neither
state identifies the current site. Registration failure or rollback without an
accepted port is `adapter_unsupported` or transport `unavailable`, never
`adapter_degraded`; permission loss is `permission_not_granted`.
`adapter_active` describes current-context health, not blanket capability
coverage.

Enabling without permission never calls `request()` automatically. Granting
permission does not enable the surface or change detector/policy settings.
Permission removal synchronously invalidates the background generation before
awaited work, immediately rejecting stale messages, status, audit, and
authorization. Port disposal and unregistration then run asynchronously as best
effort. The background reports the surface inactive immediately and requires an
acknowledged disposal. If the runtime fails or does not respond, the UI gives
refresh guidance and makes no protection claim. Already injected code may keep
observing or intercepting local submissions until disposal is acknowledged or
the page reloads, even though the background accepts none of its authorization,
status, or audit. Tests cover acknowledged disposal and failed or unresponsive
disposal. Disabling uses the same generation-first path.

## Dynamic Claude registration

M2.2, if approved, registers one immutable packaged entry:

```ts
{
  id: "promptguard-claude-v1",
  matches: ["https://claude.ai/*"],
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

Because the match pattern omits a port, Chrome may inject the bootstrap on an
alternate-port document. Its first executable guard checks
`location.origin === "https://claude.ai"` before constructing an adapter or
reading DOM and exits otherwise. Background sender validation rejects
alternate-port ports/messages independently. Tests may observe injection but
prove that an alternate-port document produces no DOM read, accepted
adapter/runtime registration or port, status, or audit.

Only the top frame is allowed. Related-origin fallbacks, `about:`, `data:`,
`blob:`, subdomains, HTTP, alternate ports, and path-derived origin expansion
are excluded from adapter/runtime acceptance. Pattern-level bootstrap injection
on alternate ports remains possible and is stopped by the guard above. The
packaged JavaScript file is used; no runtime function, string, remote asset, or
interpreted selector data is accepted.

## Options and popup behavior

The options page presents each surface with separate enablement and current
permission state. For Claude it provides:

1. The exact application and origin.
2. The fixed disclosure: “PromptGuard can access only the AI applications that
   are explicitly enabled and granted permission.”
3. A permission button whose click requests only `https://claude.ai/*`.
4. A separate enabled control.
5. A remove-access action that names the same origin and explains that loaded
   pages may need refresh after runtime disposal.
6. Honest state copy when permission exists: if descriptor verification, exact
   registration, or a validated port is absent, show `adapter_unsupported` or
   transport `unavailable`, never `adapter_degraded`. Reserve `adapter_degraded`
   for a still-connected, catalog-validated verified runtime that reports a
   fixed health failure.

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
- Revocation: synchronously invalidate background generation and reject stale
  authorization, status, and audit first; show `permission_not_granted` and an
  inactive surface; then dispose and unregister asynchronously. Require disposal
  acknowledgement. A failed or unresponsive runtime triggers refresh guidance
  and no protection claim because injected code may continue local observation
  or interception until acknowledgement or reload.
- Startup mismatch: remove stale registration and dispose any connected old
  generation. Before exact reconciliation, or whenever no validated port exists,
  report `adapter_unsupported` or transport `unavailable`; `adapter_waiting` is
  allowed only after exact registration and a validated port exist but no
  composer has been resolved.
- Registration failure without an accepted port: show `adapter_unsupported` or
  transport `unavailable` with a fixed code and no active claim.
- Claude drift or release rollback: remove only Claude registration and catalog
  edge; ChatGPT remains static and unaffected.
- Enterprise policy conflict: treat runtime access as absent; policy cannot
  upgrade trust, capabilities, or permission.

Every path is tested without broad permissions or network activity.
