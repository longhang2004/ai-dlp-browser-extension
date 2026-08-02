# Milestone 2 verified-surface threat model

This document extends the base [PromptGuard threat model](../threat-model.md)
for exact-origin optional permissions, a packaged adapter catalog, and one
candidate Claude adapter. The browser page and DOM remain untrusted. Trust and
capabilities come only from reviewed packaged descriptors and current evidence.
The design package remains proposed; this repository records no approved-design
provenance or authenticated production-acceptance decision.

## Security invariants

- One exact top-level origin, one packaged entry point, and at most one verified
  adapter are active per document.
- Adapter ID, surface ID, version, origin, trust, capabilities, and sender are
  validated as one immutable catalog relationship.
- The static ChatGPT entry can be enabled and active without optional grants.
  The dynamic Claude candidate requires both effective optional grants and a
  valid catalog-correlated content port before it can be waiting, active, or
  degraded.
- Unknown, ambiguous, stale, unpermitted, or drifted state stops captured
  attempts and never claims active protection.
- Selectors and resume behavior remain application-owned; no remote or managed
  input can supply executable adapter behavior.
- Status, diagnostics, messages, settings, and audit remain prompt-free and use
  closed unions with no arbitrary metadata.

Chrome's official
[match-pattern documentation](https://developer.chrome.com/docs/extensions/develop/concepts/match-patterns)
documents explicit ports and wildcard behavior when omitted. The M2.2 candidate
uses `https://claude.ai:443/*`, subject to supported-browser proof across the
MV3 declaration, permission APIs, registration, and port-matching fixtures. A
recorded concrete rejection is required before explicitly proposing the
exact-host/wildcard-port `https://claude.ai/*` fallback. The bootstrap's first
executable guard still checks serialized
`location.origin === "https://claude.ai"` before adapter construction or DOM
access and exits otherwise; background sender validation repeats the check.

## Threat analysis

### Origin confusion

- **Entry point:** URL parsing, optional host matching, content-port connect, or
  claimed origin in a runtime message.
- **Security boundary:** untrusted document to packaged catalog/background.
- **Required invariant:** HTTPS scheme, default port, top frame, and serialized
  origin exactly match the descriptor's canonical origin.
- **Detection:** require and parse `sender.url`, require `sender.frameId === 0`
  and `sender.id === chrome.runtime.id`, compare optional `sender.origin` only
  when present, and correlate the derived origin, surface, adapter, version, and
  entry point against the catalog.
- **Fail-safe behavior:** reject the port/message, dispose any local runtime,
  emit no audit event, and report no active surface.
- **Tests:** HTTP, subdomain, user-info, opaque origin, malformed URL,
  optional-origin absence, origin/URL disagreement, and canonical-origin
  success. Alternate-port tests may observe bootstrap injection but prove no
  page read, accepted adapter/runtime registration or port, status, or audit.
- **Residual risk:** a compromised approved origin can still control its own
  DOM; DOM behavior is constrained by the separate adapter invariants below.

### Adapter selection confusion

- **Entry point:** registry lookup, bootstrap arguments, storage corruption, or
  page-supplied identity.
- **Security boundary:** untrusted inputs to adapter construction.
- **Required invariant:** only the entry point's single catalog adapter can be
  constructed; page and storage values cannot select it.
- **Detection:** closed catalog lookup and exact descriptor equality before
  construction.
- **Fail-safe behavior:** instantiate no adapter and report unsupported or
  unavailable without reading the page.
- **Tests:** mismatched adapter/surface/version/origin, unknown ID, mutated
  frozen descriptor, and wrong entry-point cases.
- **Residual risk:** a build-time catalog error remains possible and is
  addressed by artifact topology and review.

### Cross-application selector reuse

- **Entry point:** imports, shared selector helpers, copy/paste, or bundler
  graph.
- **Security boundary:** application adapter to shared controller/other adapter.
- **Required invariant:** each entry imports exactly one adapter and selectors
  never cross application folders or bundles.
- **Detection:** static import rules, bundle literal scans, and reciprocal DOM
  fixtures.
- **Fail-safe behavior:** fail build/artifact verification; never ship the
  affected entry.
- **Tests:** ChatGPT fixture rejects Claude selectors, Claude fixture rejects
  ChatGPT selectors, forbidden-import rules, and bundle isolation assertions.
- **Residual risk:** semantically similar selectors can be independently
  written; application-owned ownership tests still have to prove behavior.

### Multiple adapters active on one page

- **Entry point:** duplicate initialization, stale registration, or overlapping
  registrations.
- **Security boundary:** browser registration/entry point to document runtime.
- **Required invariant:** one runtime generation and one verified adapter per
  document.
- **Detection:** document-local singleton generation, catalog duplicate-origin
  rejection, and background port correlation.
- **Fail-safe behavior:** dispose both contenders and invalidate attempts
  without resuming; after their ports are rejected, report unsupported or
  transport unavailable, not degraded.
- **Tests:** double bootstrap, two descriptor factories, stale-plus-current
  generation, overlapping origin, and idempotent disposal.
- **Residual risk:** two installed PromptGuard builds are separate extensions
  and outside a single extension's coordination boundary.

### Malicious page impersonating an approved chatbot

- **Entry point:** lookalike DOM on an unapproved origin or hostile DOM on an
  approved origin.
- **Security boundary:** page identity/DOM to prompt-reading adapter.
- **Required invariant:** DOM similarity never establishes origin, trust, or a
  verified submission relationship.
- **Detection:** exact browser-supplied sender origin plus application-specific
  context/ownership validation.
- **Fail-safe behavior:** construct no adapter and read no DOM on an unapproved
  origin. Match-pattern bootstrap injection may still occur on an alternate
  port, but the origin guard exits before those actions. Ambiguity or drift in a
  connected validated runtime becomes degraded; construction failure or a
  disposed runtime with no accepted port is unsupported or unavailable.
- **Tests:** identical Claude fixture on another origin, origin spoof claims,
  and approved-origin adversarial DOM variants.
- **Residual risk:** an approved vendor origin compromise can imitate valid
  structures; PromptGuard is not a defense against total vendor compromise.

### Redirects and alternate origins

- **Entry point:** login redirect, navigation, link, canonical-domain change, or
  alternate Microsoft product origin.
- **Security boundary:** navigation to catalog origin matching.
- **Required invariant:** only the exact approved origin remains eligible;
  redirects never inherit authorization.
- **Detection:** re-read `location` and sender URL on every context resolution
  and SPA/navigation generation.
- **Fail-safe behavior:** invalidate attempts, dispose on cross-origin
  navigation, and require independent approval for the destination.
- **Tests:** Claude login/return, subdomain, cross-origin redirect, Copilot to
  `m365.cloud.microsoft`, path-only navigation, and history replacement.
- **Residual risk:** vendor migrations cause loss of coverage until a reviewed
  origin update ships.

### Iframes and embedded chatbot surfaces

- **Entry point:** nested frames, `about:blank`, related-origin fallbacks, or an
  approved chatbot embedded in another site.
- **Security boundary:** frame identity to content-script registration.
- **Required invariant:** M2 runs only in the exact-origin top frame with
  `allFrames: false` and no origin fallback.
- **Detection:** registration fields plus sender `frameId === 0` and top-frame
  URL validation.
- **Fail-safe behavior:** reject frame ports/messages and provide no enforcement
  claim for embedded surfaces.
- **Tests:** same-origin iframe, cross-origin iframe, `about:blank`, `blob:`,
  and spoofed top-frame identifiers.
- **Residual risk:** legitimate embedded vendor experiences remain unsupported.

### Optional-permission phishing

- **Entry point:** deceptive page UI, unsolicited prompt, ambiguous origin copy,
  or repeated request flow.
- **Security boundary:** user intent to Chrome permission grant.
- **Required invariant:** only the M2.2 options page, inside one explicit click,
  asks for displayed optional `scripting` and `https://claude.ai:443/*`
  together; M2.1 asks for neither.
- **Detection:** request adapter accepts one closed host/named-permission tuple
  and is callable only from the trusted options action.
- **Fail-safe behavior:** denial changes no setting or policy and causes no
  automatic retry.
- **Tests:** non-gesture call, content-page request, unknown/broad origin,
  cancellation, repeated denial, and exact disclosure rendering.
- **Residual risk:** users can still accept a legitimate Chrome prompt without
  understanding host access; fixed explanatory copy reduces but cannot remove
  it.

### Permission grant without adapter enablement

- **Entry point:** permission granted before or after a disabled setting.
- **Security boundary:** Chrome permission state to activation state.
- **Required invariant:** optional grants alone never register or activate an
  adapter; both grants and enablement are required.
- **Detection:** startup/event reconciliation requires both permission and
  `enabled: true`.
- **Fail-safe behavior:** remain `adapter_disabled` with no Claude registration.
- **Tests:** grant while disabled, restart while disabled/granted, and stale
  registration cleanup.
- **Residual risk:** Chrome retains the unused surface host grant until explicit
  access removal; dependency-aware cleanup removes optional `scripting` when
  safe and reports and retries API failure.

### Adapter enablement without permission

- **Entry point:** settings change, migration, or managed configuration.
- **Security boundary:** local settings to Chrome host access.
- **Required invariant:** enablement cannot manufacture either optional grant.
- **Detection:** `permissions.contains()` checks the closed host and named tuple
  during save reconciliation, startup, and before registration.
- **Fail-safe behavior:** show `permission_not_granted`, register nothing, and
  expose an explicit options-page action.
- **Tests:** enable without grant, grant denial, restart, storage corruption,
  and popup honesty.
- **Residual risk:** user may believe enablement alone is sufficient; distinct
  status labels and disclosure are required.

### Stale dynamically registered content scripts

- **Entry point:** extension update, changed entry/version, crash, restart, or
  failed prior cleanup.
- **Security boundary:** Chrome persistent registrations to current catalog.
- **Required invariant:** every registration exactly equals the current enabled,
  permitted catalog entry and generation.
- **Detection:** enumerate registrations on service-worker startup and compare
  ID, matches, files, frame, world, run time, persistence, and catalog version.
- **Fail-safe behavior:** tell connected old ports to dispose, reject their
  later messages, unregister mismatches, and register only the current entry.
- **Tests:** old version, wrong file/match/world/frame/run time, duplicate ID,
  restart persistence, and partial API failure.
- **Residual risk:** Chrome documents that unregistering does not remove already
  injected code; disposal plus background rejection limits it until page reload.

### Revoked host or named permissions

- **Entry point:** user browser controls, options removal, or enterprise policy.
- **Security boundary:** Chrome permission event to active content runtime.
- **Required invariant:** loss of either required optional grant immediately
  invalidates protection and all unconsumed authorization for that origin.
- **Detection:** `permissions.onRemoved`, reconciliation of host plus named
  permission, and effective-access check before future registration.
- **Fail-safe behavior:** synchronously invalidate background generation and
  reject stale authorization, status, and audit before awaited cleanup; show
  `permission_not_granted` and an inactive surface immediately; then
  cancel/dispose/unregister asynchronously. Require disposal acknowledgement. If
  the runtime fails or does not respond, provide refresh guidance and make no
  protection claim.
- **Tests:** revoke idle/active/warning state, restart after revoke, missed
  event reconciliation, acknowledged disposal, failed or unresponsive disposal,
  refresh guidance, and failed unregister.
- **Residual risk:** synchronous generation invalidation blocks accepted
  authorization, status, and audit, but already injected content code may keep
  observing or intercepting local submissions until disposal is acknowledged or
  the page reloads.

### SPA origin or path drift

- **Entry point:** history navigation, client routing, document replacement, or
  application mode change.
- **Security boundary:** mutable page lifecycle to live submission context.
- **Required invariant:** every attempt is bound to current exact origin, route
  generation, composer, region, and Send ownership.
- **Detection:** navigation hooks/observer generation plus synchronous
  re-resolution before authorization consumption.
- **Fail-safe behavior:** cancel stale attempts, enter waiting while
  re-resolving, and degrade on strong ambiguity.
- **Tests:** push/replace state, back/forward, path change during dialog,
  cross-origin redirect, composer replacement, and stale callback.
- **Residual risk:** undocumented routing signals may delay health detection;
  pre-resume revalidation still prevents stale authorization use.

### Remote configuration attempting to increase capability

- **Entry point:** future managed policy, storage corruption, or runtime
  message.
- **Security boundary:** data-only configuration to executable packaged catalog.
- **Required invariant:** remote/local data may disable or narrow a packaged
  capability, never add code, origins, selectors, trust, or capability support.
- **Detection:** closed schemas, exact catalog equality, no dynamic import/eval,
  and artifact/network scans.
- **Fail-safe behavior:** reject the configuration and preserve the stricter
  packaged descriptor.
- **Tests:** trust upgrade, added origin, capability flip, selector/code fields,
  Wasm/module/template payload, and unknown keys.
- **Residual risk:** a compromised signed release is a supply-chain threat
  handled by source review, CI provenance, signing, and digest verification.

### Unknown surface incorrectly marked verified

- **Entry point:** corrupted storage/message, candidate identifier, or UI model.
- **Security boundary:** candidate/discovery data to trust/status presentation.
- **Required invariant:** only the restricted catalog-owned QA candidate may
  carry proposed verified trust before acceptance; known surface IDs alone
  confer nothing, and only the external exact-SHA/digest gate creates a
  production verified claim.
- **Detection:** descriptor lookup and capability/trust correlation at every
  crossing.
- **Fail-safe behavior:** reject or represent as unsupported/discovered with no
  prompt access or enforcement.
- **Tests:** every candidate surface without adapter, unknown ID, stored
  verified flag, page claim, and popup rendering.
- **Residual risk:** human approval may rely on incomplete evidence; M2.2 binds
  QA to the exact artifact and capability list.

### Application DOM drift causing fail-open

- **Entry point:** vendor deployment changes composer, Send control, events, or
  semantic attributes.
- **Security boundary:** mutable application DOM to verified adapter behavior.
- **Required invariant:** once a supported attempt is captured, uncertainty
  never resumes it; status never remains active without current context proof.
- **Detection:** fixture regressions, authenticated QA, grace-period health,
  strong-candidate ambiguity, and context revalidation.
- **Fail-safe behavior:** stop the captured attempt and remove the active claim.
  A still-connected validated runtime reports a fixed degraded health code; if
  its port is disposed or rejected, report unsupported or transport unavailable.
- **Tests:** missing/renamed semantics, new controls, hidden/stale elements,
  unsupported variant, and resume failure.
- **Residual risk:** a wholly new submission path may bypass capture before the
  adapter recognizes it; truthful health and rapid rollback remain necessary.

### Attachment representation drift

- **Entry point:** new chips, previews, upload state, nested form, DOM mutation,
  or page-external attachment-like UI.
- **Security boundary:** untrusted DOM to attachment-presence capability.
- **Required invariant:** presence derives only from approved structural
  evidence in the exact submission region; fingerprint contains no content or
  metadata.
- **Detection:** target-anchored scoped collectors, identity/mutation
  versioning, and pre-resume presence/fingerprint comparison. The observer
  covers five mutation classes: evidence add, evidence removal, evidence
  replacement, attribute changes, and direct or nested evidence-text changes;
  unrelated or out-of-region text does not rotate the fingerprint.
- **Fail-safe behavior:** descriptor capability support remains immutable;
  ambiguity invalidates bypass and stops the captured attempt. Only a
  still-connected, catalog-validated verified runtime transitions to
  `adapter_degraded` with a fixed health code; otherwise report
  `adapter_unsupported` or transport `unavailable`.
- **Tests:** target-anchored ownership inside/outside a nested form, dormant
  file input, add/remove/replace evidence, attribute and direct/nested
  character-data mutation, preview-like external node, and metadata non-reading.
- **Residual risk:** vendor-managed attachment state not represented in
  observable DOM remains uninspectable; attachment inspection is explicitly
  unsupported.

### Wrong-composer submission

- **Entry point:** multiple composer roots, stale focus, detached node, or Send
  control resolved from another region.
- **Security boundary:** DOM context resolution to the user's intended attempt.
- **Required invariant:** one visible connected composer, one owned Send
  control, one region, and one stable context identity/version bind the attempt.
- **Detection:** submit-target-anchored shared owner collector, semantic-region
  ancestor walk, focus/event path, connection/visibility, and synchronous
  exact-context re-resolution.
- **Fail-safe behavior:** capture no ambiguous context or stop an already
  captured attempt; never choose by DOM order, selector priority, or element ID.
- **Tests:** two roots, nested-region ownership, hidden/stale composer, replaced
  composer, cross-region Send, focus change, and wrong identity/version.
- **Residual risk:** vendor semantics can hide ownership not expressible in the
  DOM; such variants remain unsupported.

### Shared-Send ambiguity

- **Entry point:** one Send candidate associated with multiple usable composers.
- **Security boundary:** Send-control resolution to context ownership.
- **Required invariant:** a Send control has exactly one usable composer owner.
- **Detection:** one submit-target-anchored, deduplicating collector classifies
  ownership as none, unique, or ambiguous without choosing by DOM order.
- **Fail-safe behavior:** synchronously stop the candidate attempt, emit one
  fixed health transition, and expose no bypass.
- **Tests:** shared Send/two composers, duplicate selector matches for one
  element, separate roots/controls, hidden owner, and ambiguity recovery.
- **Residual risk:** ownership may be held only in application state; without
  observable proof the variant cannot be verified.

### Audit application-ID spoofing

- **Entry point:** content-script audit append or corrupted stored event.
- **Security boundary:** content runtime/storage to trusted audit store/UI.
- **Required invariant:** audit identity is derived from the validated port's
  catalog descriptor, not accepted as an independent page claim.
- **Detection:** exact V4 event validation and sender/descriptor correlation; M1
  Audit V3 records migrate conservatively to M2.1's V4 envelope only when
  catalog-owned ChatGPT identity and contributors are provable.
- **Fail-safe behavior:** reject append or discard unprovable migrated record
  without inventing identity.
- **Tests:** claimed Claude from ChatGPT, wrong version/surface, unknown ID,
  mismatched port, extra fields, valid M1 ChatGPT V3 migration, and current
  Claude-candidate V4 identity.
- **Residual risk:** a compromised trusted extension context remains trusted by
  the browser security model.

### Background sender-validation gaps

- **Entry point:** runtime messages and long-lived content ports.
- **Security boundary:** web/content contexts to service worker and storage.
- **Required invariant:** extension ID, top frame, URL, origin, port generation,
  message schema, and catalog identity all validate before handling.
- **Detection:** one centralized sender validator used by router,
  settings/status ports, permission events, and audit append.
- **Fail-safe behavior:** disconnect/reject with a fixed error and no storage or
  status mutation.
- **Tests:** missing sender fields, null origin, wrong extension, subframe,
  unapproved origin, URL/origin mismatch, stale generation, and message
  confusion.
- **Residual risk:** browser-originated sender metadata is trusted according to
  Chrome's extension model.

### Artifact bundles selectors for unapproved origins

- **Entry point:** bundler configuration, orphan output, accidental import, or
  stale generated file.
- **Security boundary:** reviewed source/build graph to distributed artifact.
- **Required invariant:** every executable file is manifest/registration
  reachable and each per-origin entry contains only its adapter selectors.
- **Detection:** manifest-rooted reachability, orphan rejection, URL allowlist,
  import/literal scan, exact IIFE roots, selector-isolation checks, and CI
  ordering that runs browser tests before the final artifact verification and
  canonical digest.
- **Fail-safe behavior:** fail build verification and digest generation.
- **Tests:** orphan adapter bundle, cross-adapter import, extra content entry,
  unapproved URL literal, source map, dynamic import, missing registered file,
  and post-E2E upload/digest identity.
- **Residual risk:** minified semantic equivalence cannot be perfectly
  classified; source review and entry-specific fixture tests supplement scans.

### Future management policy delivers executable selectors

- **Entry point:** policy payload, compatibility hint, remote asset, or
  template.
- **Security boundary:** future management plane to local extension runtime.
- **Required invariant:** policy is data-only and cannot contain selectors,
  JavaScript, Wasm, modules, executable templates, or capability/origin
  additions.
- **Detection:** signed closed schema with unknown-field rejection plus artifact
  and runtime bans on remote code and dynamic evaluation.
- **Fail-safe behavior:** reject the whole incompatible payload and retain the
  last approved stricter local behavior.
- **Tests:** executable fields, encoded code, selector arrays, remote URL,
  dynamic module, capability upgrade, and valid data-only disablement.
- **Residual risk:** future data-only compatibility hints need their own proof
  that they cannot create observation or submission behavior.

### Employee confusion about which AI site is protected

- **Entry point:** popup/options copy, permission state, similar product names,
  stale page, or managed deployment.
- **Security boundary:** internal validated state to employee understanding.
- **Required invariant:** UI names an application only from a validated port and
  separately reports permission, trust, protection, verified/unsupported
  capabilities, and fixed health.
- **Detection:** closed view models and UI tests for every state/missing port.
- **Fail-safe behavior:** say initializing, unavailable, permission not granted,
  disabled, unsupported, or degraded; never infer active site or protection.
- **Tests:** no port, wrong origin, permission/enablement combinations, stale
  health, unsupported capability copy, and consumer/Microsoft 365 distinction.
- **Residual risk:** users may ignore status. Managed disclosure, training, and
  support material remain operational controls, not enforcement guarantees.

### Required scripting accidentally granted to every user

- **Entry point:** manifest edit or release packaging places `scripting` in
  required `permissions`.
- **Security boundary:** install-time extension authority to optional dynamic
  surface activation.
- **Required invariant:** base permissions remain `["storage"]`; surface-only
  `scripting` appears only in `optional_permissions` and is requested with a
  usable approved dynamic surface.
- **Detection:** exact manifest-schema tests, generated-artifact assertions, and
  install-disclosure review reject required `scripting`.
- **Fail-safe behavior:** fail build and publication; ChatGPT continues to use
  its static entry without `scripting`.
- **Tests:** source/generated manifest required-versus-optional placement,
  absence in M2.0/M2.1, presence only in approved M2.2 shape, and ChatGPT E2E
  with `scripting` absent.
- **Residual risk:** browser UI may describe optional named permission
  differently across versions; exact artifact inspection remains authoritative.

### Optional scripting retained after its final dependent is removed

- **Entry point:** Claude access removal, disablement, catalog rollback, or
  partial cleanup after a future second dynamic surface.
- **Security boundary:** per-surface lifecycle to shared optional named
  authority.
- **Required invariant:** optional `scripting` remains granted only while at
  least one enabled, effectively permitted, catalog-owned dynamic surface
  requires it.
- **Detection:** deterministic `isScriptingStillRequired(surfaces)` evaluation
  after settings, host-permission, catalog, and named-permission changes.
- **Fail-safe behavior:** invalidate generation, dispose, and unregister first;
  disablement retains the Claude host grant and removes `scripting` only when
  `isScriptingStillRequired(surfaces)` returns false. Preserve `scripting` when
  a hypothetical second approved enabled/granted dependent remains. Explicit
  Claude access removal separately removes its host grant.
- **Tests:** Claude-only explicit access removal, disabled Claude with its host
  grant retained, remaining second dynamic surface, stale/unknown surface,
  partial API failure, and restart reconciliation.
- **Residual risk:** an unused host grant can remain until explicit access
  removal. Browser removal of orphaned `scripting` may fail transiently; fixed
  inactive status, disclosed cleanup failure, and startup retry prevent treating
  retained authority as activation.

### Named scripting permission removed while host access remains

- **Entry point:** browser permission controls, API removal, policy change, or
  permission-event loss.
- **Security boundary:** live optional named authority to registered Claude
  runtime.
- **Required invariant:** host access alone is never permission-ready and cannot
  keep a dynamic adapter authorized.
- **Detection:** live `contains()` checks and added/removed-event reconciliation
  derive `scripting_missing` from the closed two-boolean permission state.
- **Fail-safe behavior:** synchronously invalidate runtime generation, report
  `permission_not_granted`, reject stale messages/status/audit, then dispose and
  unregister asynchronously.
- **Tests:** named removal while idle, active, and warning; host retained;
  missed-event startup; cleanup failure; and later joint re-grant.
- **Residual risk:** injected code can remain until disposal acknowledgement or
  reload, but its background authority and protection claim end synchronously.

### Claude host access requested before executable support exists

- **Entry point:** M2.1 UI, migration preview, background startup, or an eager
  permission API wrapper.
- **Security boundary:** future permission infrastructure to present user
  intent.
- **Required invariant:** no real host/named request or activation appears until
  the same approved M2.2 candidate ships a usable Claude entry and adapter.
- **Detection:** M2.1 UI tests, permission-wrapper call assertions, manifest
  checks, bundle reachability, and exact inert-preview copy.
- **Fail-safe behavior:** show no grant action; if a preview is present, show
  only “Claude support is not installed in this release.”
- **Tests:** no M2.1 optional permissions, no request call, no active toggle, no
  Claude bundle/registration, and no protectable-state claim.
- **Residual risk:** a user can independently grant extension site access in
  browser controls; runtime activation still requires the catalog and usable
  candidate gates.

### All-port host pattern used when an explicit default-port pattern is available

- **Entry point:** manifest, permission request/remove/contains call,
  registration, catalog metadata, fixture, or artifact allowlist drift.
- **Security boundary:** reviewed canonical origin to browser match-pattern
  authority.
- **Required invariant:** every M2.2 edge uses `https://claude.ai:443/*` unless
  a supported-browser rejection has been concretely recorded and the
  wildcard-port fallback separately approved.
- **Detection:** literal consistency scans, exact artifact rules, registration
  reconciliation, and pre-M2.2 browser/API proof.
- **Fail-safe behavior:** fail tests/build; never silently substitute
  `https://claude.ai/*`. Any approved fallback keeps both runtime guards and is
  described as exact host with wildcard port.
- **Tests:** declaration/request/contains/remove/registration equality,
  default-port match, alternate-port non-match, and explicit fallback evidence
  fixture.
- **Residual risk:** browser match-pattern implementations can differ from
  documentation; the supported-version proof remains a merge prerequisite.

### ChatGPT alternate-port bootstrap

- **Entry point:** the retained static `https://chatgpt.com/*` content-script
  match on a document such as `https://chatgpt.com:8443/`.
- **Security boundary:** backward-compatible static match to canonical ChatGPT
  prompt-reading runtime.
- **Required invariant:** the entry's first executable action requires
  `location.origin === "https://chatgpt.com"` before bootstrap, adapter
  construction, interception, or DOM access.
- **Detection:** entry-level origin guard plus independent defensive sender
  validation derived from `sender.url`.
- **Fail-safe behavior:** exit without adapter construction and reject any port
  or message; emit no status or audit.
- **Tests:** alternate port proves no adapter, interception, composer read,
  accepted port, status, or audit; canonical default-port ChatGPT regression
  remains green without `scripting`.
- **Residual risk:** the static bootstrap file may still be delivered by the
  browser on an alternate port; the guard ensures it performs no page access.

### Premature verified classification before authenticated QA

- **Entry point:** descriptor, commit/PR text, options copy, release notes,
  artifact promotion, or automated-test result.
- **Security boundary:** verification candidate evidence to production trust and
  capability claims.
- **Required invariant:** `verified` is an external human/release production-
  acceptance claim granted only after authenticated QA proves submission
  detection, local prompt read, attachment-presence detection, and submission
  resume on the exact SHA and digest. The candidate runtime/options copy remains
  conservative before and after acceptance; no local or network state promotes
  it, and acceptance causes no rebuild or substitution.
- **Detection:** candidate-terminology checks, exact evidence-record validation,
  release gate review, descriptor/capability correlation, and checks that no
  acceptance flag or alternate runtime copy exists.
- **Fail-safe behavior:** retain “Claude verification candidate” runtime/options
  presentation; if any one target lacks proof, remove the executable Claude
  catalog entry before merge/publication without downgrading capabilities or
  rebuilding a substitute.
- **Tests:** automated-only candidate, mismatched SHA/digest, rebuilt artifact,
  each missing target capability, premature runtime/UI acceptance copy, local or
  network promotion attempts, and external exact-candidate release acceptance
  with byte-identical artifact and unchanged runtime/options copy.
- **Residual risk:** authenticated QA remains a human-operated evidence process;
  named cohort restriction, minimal records, and explicit approval reduce but do
  not eliminate review error.

## Residual posture

Milestone 2 cannot make a mutable third-party DOM a first-party integration
contract. Exact origins, isolated worlds, packaged selectors, one-shot
authorization, tests, and authenticated QA reduce ambiguity but do not eliminate
vendor drift or total compromise of an approved site. PromptGuard therefore
couples every positive protection claim to current verified capability. It uses
degraded only for a connected validated verified runtime with a fixed health
failure; after origin-specific rollback removes the accepted port, it reports
unsupported or transport unavailable.
