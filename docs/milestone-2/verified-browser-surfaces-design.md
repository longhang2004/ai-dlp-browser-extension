# Milestone 2 verified browser surfaces

Status: proposed design; production implementation requires the approval gate at
the end of this document.

## Outcome and boundaries

Milestone 2 reuses PromptGuard's browser-independent local detector and policy
core across a small, explicitly approved set of browser-based AI chat
applications. It does not add a management plane, administrator dashboard,
endpoint agent, IDE or CLI integration, centralized event transport, identity
enrollment, prompt-content collection, generic site observation, or remote
adapter delivery.

This design selects Claude web as the first candidate after ChatGPT, but does
not classify or ship it as verified. The selection evidence is in
[surface selection](surface-selection.md), the browser access design is in
[permission strategy](permission-strategy.md), the security analysis is in
[the Milestone 2 threat model](threat-model.md), and implementation remains
subject to the red-green sequence in the
[implementation plan](implementation-plan.md).

## Known Milestone 1 coupling

The merged implementation is deliberately ChatGPT-only. A second adapter cannot
be added safely without first changing these assumptions:

- `ChatApplicationAdapter.id` is the literal `"chatgpt"`; its version is a
  separate string rather than an immutable identity descriptor.
- Adapter health transition and error types live in the ChatGPT module even when
  the lifecycle behavior is generic.
- Content bootstrap imports and constructs `ChatGptAdapter` directly and emits
  ChatGPT-specific health and audit identities.
- The manifest has one static `https://chatgpt.com/*` content script and one
  `content-script.js` IIFE; build and production-artifact checks require that
  exact topology.
- Background sender validation accepts only the top-frame ChatGPT origin and
  does not correlate a claimed adapter, surface, version, capabilities, and
  origin through one catalog record.
- Status and port aggregation use ChatGPT-only application identifiers and the
  states `waiting_for_composer`, `active`, `disabled`, and `degraded`.
- Audit V3 stores `application: "chatgpt"` and a ChatGPT-specific adapter
  version; policy input likewise uses `application: "chatgpt"`.
- Settings V2 has one global protection toggle and no per-surface activation.
- Popup and options copy names ChatGPT directly, and the popup assumes one
  application when no validated application port is present.
- ChatGPT owns a centralized selector module, fixtures, context resolution,
  attachment-presence fingerprinting, resume behavior, and authenticated QA; no
  cross-application selector-isolation rule exists yet.
- Artifact reachability, URL allowlisting, manual QA, and Playwright fixtures
  all assume one application entry point and one exact origin.

These are implementation facts, not authorization to change production code in
the design phase.

## Closed identity and capability contracts

The following TypeScript-like shapes are normative documentation contracts:

```ts
type AiSurfaceId =
  | "chatgpt_web"
  | "claude_web"
  | "gemini_web"
  | "perplexity_web"
  | "deepseek_web"
  | "copilot_web";

type AdapterId = "chatgpt" | "claude";
type AdapterTrust = "verified" | "discovered" | "unsupported";
type CapabilitySupport = "verified" | "unsupported" | "not_applicable";

type AdapterCapabilities = {
  readonly submissionDetection: CapabilitySupport;
  readonly promptRead: CapabilitySupport;
  readonly attachmentDetection: CapabilitySupport;
  readonly attachmentInspection: CapabilitySupport;
  readonly promptReplacement: CapabilitySupport;
  readonly submissionResume: CapabilitySupport;
};

type AdapterDescriptor = {
  readonly adapterId: AdapterId;
  readonly surfaceId: AiSurfaceId;
  readonly version: string;
  readonly trust: AdapterTrust;
  readonly origins: readonly string[];
  readonly capabilities: AdapterCapabilities;
  readonly entryPoint: string;
};
```

`AiSurfaceId` names known product surfaces, not approved adapters. `AdapterId`
is the closed target-design reservation for this milestone; membership does not
authorize execution. Only IDs in the current executable packaged catalog are
authorized: M2.0 contains only `chatgpt`, and M2.2 may add `claude` at its gate.
The immutable catalog is the authority for every descriptor field; runtime input
cannot construct, extend, or strengthen a descriptor.

Capability rules:

- `verified` is capability-specific; verified adapter trust does not imply that
  every capability is verified.
- `attachmentDetection` means only presence plus an opaque structural
  fingerprint. It is distinct from file-content or metadata inspection.
- `promptReplacement` requires proof at the application's state boundary. DOM
  equality and synthetic input events are insufficient.
- `submissionResume` requires proof that the reviewed prompt is submitted once
  through the real application path after one-shot revalidation.
- `discovered` never grants prompt read, attachment access, interception,
  replacement, resume, or an enforcement claim.
- Runtime ambiguity never mutates packaged trust or capability support. It
  invalidates the current attempt and one-shot bypass, then yields
  `adapter_degraded` with a fixed health code while a validated port remains
  connected, or `adapter_unsupported`/transport `unavailable` when no valid port
  remains. Only a reviewed future packaged descriptor and release may downgrade
  trust or capability support.
- `not_applicable` is used only when a capability has no meaning for the
  descriptor. A capability that exists but lacks proof is `unsupported`.

The adapter interface will expose one frozen `descriptor` instead of a literal
`id` and separate `version`. Generic health transitions move beside the shared
adapter contract. Descriptor objects and nested origin/capability values are
frozen or cloned from the immutable catalog before use.

## Identity and validation invariants

Every content-script/background message, background/extension-page response,
storage envelope, registry lookup, status object, and audit event is validated
as a closed union with exact keys. No arbitrary metadata map is allowed.

Validation must establish all of the following together:

1. The adapter ID exists in the packaged catalog.
2. The surface ID is the adapter's catalog surface.
3. The version is an exact packaged version for that adapter.
4. The sender URL is present, parses successfully, and derives an exact catalog
   origin; `sender.frameId === 0` and `sender.id === chrome.runtime.id`.
5. If optional `sender.origin` is present, it exactly equals the origin derived
   from `sender.url`; absence of optional `sender.origin` alone does not fail.
6. The entry point is the catalog entry assigned to that origin.
7. Trust and every capability equal the packaged descriptor; page data, storage,
   and policy cannot upgrade either.
8. One origin is owned by at most one executable adapter.
9. Unknown keys, identifiers, versions, origins, and capability combinations are
   rejected before state, UI, storage, or audit use.

Missing or malformed required sender fields fail closed. Validation never trusts
a page-provided origin claim and never assumes optional `MessageSender`
properties are present without a proven minimum browser contract.

The initial canonical origin relationships are:

| Surface ID       | Exact origin                    | Adapter status in this design |
| ---------------- | ------------------------------- | ----------------------------- |
| `chatgpt_web`    | `https://chatgpt.com`           | Packaged `chatgpt` adapter    |
| `claude_web`     | `https://claude.ai`             | Candidate `claude` adapter    |
| `gemini_web`     | `https://gemini.google.com`     | No adapter                    |
| `perplexity_web` | `https://www.perplexity.ai`     | No adapter                    |
| `deepseek_web`   | `https://chat.deepseek.com`     | No adapter                    |
| `copilot_web`    | `https://copilot.microsoft.com` | No adapter                    |

`https://m365.cloud.microsoft` is a separate, unapproved Microsoft 365 surface,
not an alternate origin for `copilot_web`.

## Registry and content-entry architecture

### Alternatives

| Property                  | One shared content bundle                                   | Per-origin thin entry points                                       |
| ------------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------ |
| Simplicity                | One manifest/runtime path                                   | One small entry and registration per origin                        |
| Bundle size               | Every packaged selector can reach every approved origin     | Shared controller plus one adapter per bundle                      |
| Selector isolation        | Depends on runtime dispatch and tree-shaking                | Enforced by the build graph                                        |
| Runtime ambiguity         | Origin dispatch can select incorrectly                      | Entry has one immutable adapter identity                           |
| Artifact review           | Must prove all adapters are unreachable on the wrong origin | Review each entry-to-origin edge independently                     |
| Optional permissions      | One bundle still contains all selectors                     | Registration can follow the exact granted origin                   |
| Rollback                  | Shared bundle release can disturb every surface             | Remove one registration and bundle edge                            |
| Test organization         | Cross-origin branches in one suite                          | Shared controller suite plus application-owned fixtures            |
| Duplicate output          | Lowest                                                      | Small duplicated bootstrap wrapper                                 |
| Manifest/build complexity | Lowest                                                      | More entry points, reachability roots, and exact-origin assertions |

PromptGuard will use per-origin thin entry points. ChatGPT retains its existing
static content-script match for backward compatibility, but M2.0 adds a
first-executable `location.origin === "https://chatgpt.com"` guard before
bootstrap, adapter construction, interception, or DOM access. The existing
omitted-port match may inject at `https://chatgpt.com:8443/`; tests prove that
such a document creates no adapter, interception, DOM read, accepted port,
status, or audit. This does not change ChatGPT's manifest pattern. After the
M2.2 gate, Claude receives a separate self-contained IIFE importing the shared
controller and exactly the Claude adapter. Application selectors remain inside
their adapter folder and may not be imported by the other application, shared
controller, registry, or background.

The registry/catalog guarantees:

- at most one verified adapter per document and one executable owner per exact
  origin;
- unknown or mismatched origins instantiate no prompt-reading adapter;
- a page cannot choose adapter identity, trust, version, or capabilities;
- no remote policy, configuration, selector data, module, Wasm, template, or
  asset can add executable behavior;
- drift in a connected, catalog-validated verified runtime moves that runtime to
  degraded and stops captured attempts; construction failure or disposal leaves
  no accepted port and therefore reports unsupported or unavailable;
- disabling, revoking, unregistering, navigation invalidation, and teardown
  dispose all listeners, observers, callbacks, timers, DOM references, and
  prompt-bearing state idempotently; and
- background sender validation uses the same packaged
  adapter/surface/origin/version relationship presented to status and audit.

## Settings, storage, policy, and audit

Settings become a prompt-free V3 envelope:

```ts
type SurfaceSettings = {
  readonly surfaceId: AiSurfaceId;
  readonly enabled: boolean;
};

type StoredSettingsEnvelopeV3 = {
  readonly schemaVersion: 3;
  readonly settings: {
    readonly protectionEnabled: boolean;
    readonly surfaces: readonly SurfaceSettings[];
    readonly emailAction: "allow" | "warn" | "block";
    readonly phoneAction: "allow" | "warn" | "block";
    readonly attachmentAction: "allow" | "warn" | "block";
    readonly protectedKeywords: readonly string[];
    readonly auditRetentionLimit: number;
  };
};
```

The `surfaces` array has exactly one entry for each configurable packaged
surface, in catalog order, with no duplicates or unknown IDs. V2 migration
preserves the global protection flag, actions, keywords, and retention; it adds
enabled `chatgpt_web` and disabled `claude_web`. Invalid input falls back to the
existing strict defaults plus those surface defaults. Permission state is
queried from Chrome and never persisted. Granting permission changes no policy
action. M2.1 owns the Settings V3 envelope, migration, and tests; M2.0 leaves
persisted settings unchanged.

Policy input replaces the literal `application: "chatgpt"` with validated
`surfaceId: AiSurfaceId`. M2.0 introduces no application-specific policy
exception or precedence rule.

Audit becomes prompt-free V4. Every event carries `surfaceId`, `adapterId`, and
the catalog-validated adapter version. A valid V3 ChatGPT event migrates
losslessly to `chatgpt_web`/`chatgpt`; an event whose application, version, or
other identity correlation cannot be proved is discarded rather than guessed.
Existing contributor-only and retention rules remain unchanged. M2.1 owns the
Audit V4 envelope, migration, and tests; M2.0 leaves persisted audit records in
V3 while introducing the ChatGPT-only catalog and sender boundary.

## Permission, status, and UX

M2.1 defines, but does not exercise against Claude, these closed contracts:

```ts
type ClaudeEffectivePermission = {
  readonly hostGranted: boolean;
  readonly scriptingGranted: boolean;
};

type PermissionHealthCode =
  "host_access_missing" | "scripting_missing" | "host_and_scripting_missing";
```

Arbitrary permission arrays are forbidden in messages, status, and audit. M2.2
treats Claude as permission-ready only when both optional grants are effective:

| Host | `scripting` | Result                                                            |
| ---- | ----------- | ----------------------------------------------------------------- |
| No   | No          | `permission_not_granted`; `host_and_scripting_missing`            |
| Yes  | No          | `permission_not_granted`; `scripting_missing`                     |
| No   | Yes         | `permission_not_granted`; `host_access_missing`                   |
| Yes  | Yes         | Continue to enablement, descriptor, registration, and port checks |

The proposed M2.2 manifest is exactly:

```json
{
  "permissions": ["storage"],
  "optional_permissions": ["scripting"],
  "optional_host_permissions": ["https://claude.ai:443/*"]
}
```

One explicit options-page gesture requests optional `scripting` and
`https://claude.ai:443/*` together. M2.1 adds neither manifest entry, exposes no
real request action, and calls no real permission request. An inert preview, if
shown, says exactly “Claude support is not installed in this release.”

Surface state is one of:

```text
permission_not_granted
adapter_disabled
adapter_waiting
adapter_active
adapter_degraded
adapter_unsupported
```

`initializing` and `unavailable` remain transport-level states and are not
surface states. `adapter_active`, `adapter_waiting`, and `adapter_degraded`
require an enabled surface, both effective optional grants, a verified packaged
descriptor, and a valid content-script port. `adapter_degraded` is only a
connected, catalog-validated verified runtime with a fixed health failure.
Registration failure or rollback without an accepted port is
`adapter_unsupported` or transport `unavailable`; permission loss is
`permission_not_granted`. `adapter_active` means the current submission context
is healthy, not that every capability is verified. A disabled surface is
`adapter_disabled`; a granted and enabled candidate without a verified
executable adapter is `adapter_unsupported`.

On removal of either optional grant or effective-access failure, the background
synchronously invalidates its generation before awaited cleanup, immediately
rejecting stale messages, audit, status, and authorization. Disposal and
unregistration are asynchronous best effort. The background reports the surface
inactive immediately and requires an acknowledged disposal; if the runtime fails
or does not respond, the UI provides refresh guidance and makes no protection
claim. Already injected content code may keep observing or intercepting local
submissions until disposal is acknowledged or the page reloads, even though the
background rejects its messages. Tests cover both acknowledged and failed or
unresponsive disposal. Disabling uses the same generation-first rule.

M2.2's options page owns surface enablement and permission request/removal. Its
fixed disclosure is:

> PromptGuard can access only the AI applications that are explicitly enabled
> and granted permission.

Enabling without effective permission presents an explicit permission action.
Both optional grants are requested only inside that click. Granting permission
does not silently enable the surface; disabling does not silently remove the
surface host grant, so the user can make the two choices independently and see
both states.

Disabling Claude never removes its surface host grant. After generation-first
disposal and unregistration, disablement may remove optional `scripting` only
when `isScriptingStillRequired(surfaces)` returns false across the immutable
catalog, validated settings, and live effective permissions. If another approved
enabled/granted dynamic surface depends on `scripting`, the named permission is
retained. Explicitly removing Claude access removes its host grant and applies
the same dependency-aware `scripting` cleanup. Page data and managed policy
cannot declare a dependency. Either host- or named-permission change invalidates
the runtime generation before asynchronous disposal/unregistration and triggers
registration reconciliation.

The popup eventually presents application, permission, adapter trust, protection
status, verified capabilities, unsupported capabilities, and the last fixed
health code. Without `tabs`, it cannot inspect or infer the active site's URL.
It names an application only when a validated content-script port reports a
catalog-correlated identity. It never displays prompt text, filenames,
conversation titles, URL paths, page titles, or page text.

## Claude adapter design

Claude's reserved design identity is `adapterId: "claude"`,
`surfaceId: "claude_web"`, and serialized origin `https://claude.ai`. It remains
unsupported and absent from the M2.0 executable catalog. A restricted M2.2 QA
artifact may encode a proposed `trust: "verified"` descriptor solely to exercise
final behavior in the named authenticated-QA cohort. The field is not itself
production acceptance, and the artifact cannot be published or installed outside
that cohort before the gate.

`verified` is an external human/release production-acceptance decision bound to
authenticated QA on the exact SHA and digest. The exact artifact's runtime and
options copy remains “Claude verification candidate” both before and after
acceptance. No persisted flag, page claim, permission state, runtime message, or
network response can upgrade trust or alter that copy. After the gate passes,
signed publication and release metadata may state production-accepted/verified,
but the accepted artifact is the same digest without rebuild or substitution. If
any target fails, remove the executable entry before merge/publication; do not
downgrade capability claims or build a substitute.

The implementation, if approved, has these boundaries:

- Location: `apps/extension/src/adapters/claude/`, with a Claude-only selectors
  module, fixtures, context resolver, adapter, and DOM/node tests. It imports no
  ChatGPT selector or context module.
- URL: Chrome's official
  [match-pattern contract](https://developer.chrome.com/docs/extensions/develop/concepts/match-patterns)
  documents explicit ports and wildcard behavior when the port is omitted. The
  preferred pattern is `https://claude.ai:443/*` for the optional declaration,
  request/contains/remove calls, dynamic registration, catalog metadata,
  validators, artifact rules, fixtures, and QA. The bootstrap's first executable
  guard, before adapter construction or any DOM access, requires serialized
  `location.origin === "https://claude.ai"` and exits otherwise. Background
  sender validation repeats the check. Alternate-port tests prove no adapter
  construction, interception, DOM read, accepted port, status, or audit. Before
  M2.2, a supported-browser proof must establish that the explicit-port pattern
  is accepted by the MV3 declaration, `request()`, `contains()`, `remove()`, and
  `registerContentScripts()` and matches the default-port page but not an
  alternate-port fixture. A supported-browser rejection must be recorded before
  an explicit `https://claude.ai/*` fallback is proposed; fallback is never
  silent and remains exact-host/wildcard-port. Redirects, subdomains, opaque
  origins, embedded frames, and `m365.cloud.microsoft` are also rejected.
- Composer: resolve exactly one visible, connected, enabled live composer within
  one submission region. Current authenticated evidence includes
  `[role="textbox"][contenteditable="true"][data-testid="chat-input"]`, but this
  is evidence to test, not a selector guarantee by itself.
- Send control: derive a unique enabled semantic Send control from the same
  region. The observed `aria-label="Send message"` is fixture evidence only.
  Multiple usable composers for one control, one composer with multiple
  candidate controls, or cross-region ownership is ambiguous and stops.
- Capture: synchronously intercept the verified Send click and unmodified Enter.
  Shift+Enter, modifier combinations, and IME composition pass through.
- Lifecycle: re-resolve on dynamic rendering and SPA change; invalidate context
  identity/version when composer, control, region, path state, or attachment
  structure changes. Hidden, detached, stale, and replaced elements cannot
  resume.
- Attachments: detect presence only within the exact submission region and
  fingerprint only structural element identity plus mutation version. Never read
  filenames, paths, extensions, MIME types, sizes, labels, accessible text,
  previews, contents, or HTML. Add, remove, replace, or character-data mutation
  invalidates authorization. `attachmentInspection` is required to remain
  `unsupported` in the initial M2.2 adapter.
- Warning/bypass: attachment policy uses the existing block/warn/allow
  semantics. A warning bypass is controller-owned, one-shot, revision-bound, and
  consumed only after prompt, URL, context, ownership, presence, and fingerprint
  revalidation.
- Resume: call exactly one guarded synchronous Claude-owned resume operation and
  clear the recursion guard in `finally`. Authenticated QA must demonstrate that
  the reviewed synthetic prompt, rather than stale application state, is
  submitted exactly once. A synthetic DOM click alone is not evidence.
- Replacement: `promptReplacement` is required to remain `unsupported` in the
  initial M2.2 adapter; the adapter never mutates the Claude editor for
  redaction.
- Health: waiting is normal while no composer exists. In a connected,
  catalog-validated verified runtime, ambiguity, unsupported DOM, ownership
  loss, resume failure, and grace expiry use fixed, prompt-free health or error
  codes and transition to degraded without bypass. If no validated port remains,
  the state is unsupported or transport unavailable instead.
- Disposal: idempotently remove every listener, observer, timer, callback, DOM
  reference, guard, and active context. No prompt value survives a synchronous
  read or active controller attempt.
- QA: use two current local DOM variants plus a dedicated authenticated account
  and synthetic fixtures. Record only exact Git SHA, CI run, digest, artifact
  file count, browser/version, origin, account tier, date/timezone, adapter
  version, permission, trust, capabilities, fixture IDs, and structural
  outcomes.

Authenticated QA must prove all four targets—submission detection, local prompt
read, attachment-presence detection, and submission resume—on that exact
artifact. Failure of any one blocks merge/publication with the executable Claude
catalog entry. Attachment inspection and prompt replacement remain
unconditionally unsupported in initial M2.2 and are not downgrade options.

Fixed diagnostic codes extend the shared closed health/error unions with
Claude-neutral meanings; application-specific copy does not include DOM or user
content. The exact code additions are test-first work in M2.2.

The four positive capabilities are targets for authenticated verification, not
pre-approved verified claims. Failure to prove any target removes the executable
Claude entry before merge/publication; it does not produce a reduced-capability
artifact. Future support for prompt replacement or attachment inspection
requires a separate design, threat review, RED-before-GREEN tests, authenticated
application-state proof, exact-artifact QA, and explicit human approval.

Rollback unregisters only the versioned Claude registration, first instructs
every active Claude port to dispose, rejects subsequent Claude ports/events, and
then reports the surface unsupported or transport unavailable because no
validated port remains. It removes only Claude's catalog and optional-permission
entry in a follow-up release. ChatGPT registration, settings, policy, and audit
remain intact. Background generation is invalidated before cleanup, so no stale
authorization, status, or audit is accepted. Disposal must be acknowledged; a
failed or unresponsive runtime leaves the surface truthfully inactive with
refresh guidance and no protection claim because already injected code may keep
observing or intercepting local submissions until acknowledgement or reload.

## Generic discovery

Generic discovery is deferred.

| Approach                         | Privacy/permission result                                                                  |
| -------------------------------- | ------------------------------------------------------------------------------------------ |
| User-initiated “Check this site” | Needs current-tab identity/access such as `tabs` or `activeTab`, excluded from this design |
| Organization domain allowlist    | Belongs to a later signed management-policy and employee-disclosure design                 |
| Already granted approved origins | Adds no useful discovery beyond the immutable packaged catalog                             |
| Broad heuristic observation      | Requires unjustified browsing access and creates impersonation and prompt-access pressure  |

A future discovered record is limited to
`{ trust: "discovered", enforcement: "none", promptAccess: false }`. Minimum
evidence would be a user- or organization-approved exact origin plus a packaged,
non-content-reading identity rule. Discovery may not read composer/page text,
intercept submission, scan prompts, inspect attachments, resume submission,
claim protection, upload URL paths or titles, or use `<all_urls>` without a new
privacy and permission approval.

## Design baseline and validation record

The design branch starts at `c96902d5cce9e56603fa5d16a28aaf679d6bdb27`. The
2026-07-30 baseline produced:

- `pnpm install --frozen-lockfile`: passed after an initial sandbox DNS
  `ENOTFOUND` and an approved network-enabled rerun.
- `pnpm format:check`: failed only for seven pre-existing
  `.superpowers/sdd/pasted-text.txt/` Markdown files (`progress.md`, the three
  task briefs, and the three task reports). This design does not modify them.
- `pnpm lint` and `pnpm typecheck`: passed.
- `pnpm test`: passed 39 Vitest files/748 tests and 15 Node artifact-script
  tests.
- `pnpm test:performance`: passed one file/four tests.
- `pnpm build`: passed; the verified MV3 topology contains 12 files.
- `pnpm verify:artifact`: passed 12 reachable files and 43 reviewed URL
  literals.
- `pnpm artifact:digest`:
  `e27a582fb88ec89983fa516b334e717e6613a373b285fdbea38de0b4847955ca`.
- `pnpm test:e2e`: the sandbox launch failed before tests with Chromium `EPERM`;
  the approved external rerun passed all 10 tests.

## Approval gate

No production implementation begins until a human explicitly approves all five
items:

1. Claude web as the first additional surface.
2. Canonical origin `https://claude.ai` and proposed default-port pattern
   `https://claude.ai:443/*`, subject to supported-browser proof and the
   explicit fallback rule.
3. Consumer optional `https://claude.ai:443/*` host access plus optional
   `scripting`, requested together only in M2.2 with dependency-aware cleanup;
   the pattern remains subject to the documented browser proof and explicit
   fallback process.
4. Capabilities targeted for verification: submission detection, local prompt
   read, attachment-presence detection, and submission resume. Capabilities
   required to remain unsupported in M2.2: attachment inspection and prompt
   replacement.
5. The revised M2.0 ChatGPT-only, M2.1 infrastructure-only, and M2.2 Claude
   verification-candidate decomposition.

Approval does not mark Claude or a targeted capability verified. Production
acceptance is the later external human/release gate on the exact SHA and digest;
the artifact and its conservative candidate copy do not mutate at that gate.
Failure to prove any of the four targets removes the Claude executable catalog
entry before merge or publication, without capability downgrade or rebuild.
