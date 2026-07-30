# Milestone 2 verified-surface threat model

This document extends the base [PromptGuard threat model](../threat-model.md)
for exact-origin optional permissions, a packaged adapter catalog, and one
candidate Claude adapter. The browser page and DOM remain untrusted. Trust and
capabilities come only from reviewed packaged descriptors and current evidence.

## Security invariants

- One exact top-level origin, one packaged entry point, and at most one verified
  adapter are active per document.
- Adapter ID, surface ID, version, origin, trust, capabilities, and sender are
  validated as one immutable catalog relationship.
- Only an enabled surface with effective exact-origin permission and a valid
  verified content port can be waiting, active, or degraded.
- Unknown, ambiguous, stale, unpermitted, or drifted state stops captured
  attempts and never claims active protection.
- Selectors and resume behavior remain application-owned; no remote or managed
  input can supply executable adapter behavior.
- Status, diagnostics, messages, settings, and audit remain prompt-free and use
  closed unions with no arbitrary metadata.

Chrome's official
[match-pattern documentation](https://developer.chrome.com/docs/extensions/develop/concepts/match-patterns)
means the approved `https://claude.ai/*` pattern constrains scheme and host but,
because it omits a port, may inject the bootstrap on alternate ports. The
bootstrap's first executable guard checks serialized
`location.origin === "https://claude.ai"` before adapter construction or DOM
access and exits otherwise; background sender validation repeats the check.

## Threat analysis

### Origin confusion

- **Entry point:** URL parsing, optional host matching, content-port connect, or
  claimed origin in a runtime message.
- **Security boundary:** untrusted document to packaged catalog/background.
- **Required invariant:** HTTPS scheme, default port, top frame, and serialized
  origin exactly match the descriptor's canonical origin.
- **Detection:** parse the sender URL independently and correlate sender origin,
  surface, adapter, version, and entry point against the catalog.
- **Fail-safe behavior:** reject the port/message, dispose any local runtime,
  emit no audit event, and report no active surface.
- **Tests:** HTTP, subdomain, user-info, opaque origin, malformed URL,
  origin/URL disagreement, and canonical-origin success. Alternate-port tests
  may observe bootstrap injection but prove no page read, accepted
  adapter/runtime registration or port, status, or audit.
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
- **Required invariant:** only the options page, inside an explicit click, asks
  for one displayed exact origin.
- **Detection:** request adapter accepts a closed origin allowlist and is
  callable only from the trusted options action.
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
- **Required invariant:** a host grant alone never registers or activates an
  adapter.
- **Detection:** startup/event reconciliation requires both permission and
  `enabled: true`.
- **Fail-safe behavior:** remain `adapter_disabled` with no Claude registration.
- **Tests:** grant while disabled, restart while disabled/granted, and stale
  registration cleanup.
- **Residual risk:** Chrome still records the unused host grant until the user
  removes it.

### Adapter enablement without permission

- **Entry point:** settings change, migration, or managed configuration.
- **Security boundary:** local settings to Chrome host access.
- **Required invariant:** enablement cannot manufacture effective permission.
- **Detection:** `permissions.contains()` during save reconciliation, startup,
  and before registration.
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

### Revoked permissions

- **Entry point:** user browser controls, options removal, or enterprise policy.
- **Security boundary:** Chrome permission event to active content runtime.
- **Required invariant:** lost permission immediately invalidates protection and
  all unconsumed authorization for that origin.
- **Detection:** `permissions.onRemoved`, reconciliation, and effective-access
  check before future registration.
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
- **Required invariant:** only a packaged descriptor with exact current evidence
  can carry verified trust; known surface IDs alone confer nothing.
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
- **Detection:** scoped collectors, identity/mutation versioning, and pre-resume
  presence/fingerprint comparison.
- **Fail-safe behavior:** descriptor capability support remains immutable;
  ambiguity invalidates bypass and stops the captured attempt. Only a
  still-connected, catalog-validated verified runtime transitions to
  `adapter_degraded` with a fixed health code; otherwise report
  `adapter_unsupported` or transport `unavailable`.
- **Tests:** inside/outside nested form, dormant file input, add/remove/replace,
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
- **Detection:** shared owner collector, focus/event path,
  connection/visibility, and synchronous exact-context re-resolution.
- **Fail-safe behavior:** capture no ambiguous context or stop an already
  captured attempt; never choose by DOM order, selector priority, or element ID.
- **Tests:** two roots, hidden/stale composer, replaced composer, cross-region
  Send, focus change, and wrong identity/version.
- **Residual risk:** vendor semantics can hide ownership not expressible in the
  DOM; such variants remain unsupported.

### Shared-Send ambiguity

- **Entry point:** one Send candidate associated with multiple usable composers.
- **Security boundary:** Send-control resolution to context ownership.
- **Required invariant:** a Send control has exactly one usable composer owner.
- **Detection:** one deduplicating collector classifies ownership as none,
  unique, or ambiguous.
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
- **Detection:** exact V4 event validation and sender/descriptor correlation;
  conservative V3 migration.
- **Fail-safe behavior:** reject append or discard unprovable migrated record
  without inventing identity.
- **Tests:** claimed Claude from ChatGPT, wrong version/surface, unknown ID,
  mismatched port, extra fields, and valid ChatGPT V3 migration.
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
  import/literal scan, exact IIFE roots, and selector-isolation checks.
- **Fail-safe behavior:** fail build verification and digest generation.
- **Tests:** orphan adapter bundle, cross-adapter import, extra content entry,
  unapproved URL literal, source map, dynamic import, and missing registered
  file.
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

## Residual posture

Milestone 2 cannot make a mutable third-party DOM a first-party integration
contract. Exact origins, isolated worlds, packaged selectors, one-shot
authorization, tests, and authenticated QA reduce ambiguity but do not eliminate
vendor drift or total compromise of an approved site. PromptGuard therefore
couples every positive protection claim to current verified capability. It uses
degraded only for a connected validated verified runtime with a fixed health
failure; after origin-specific rollback removes the accepted port, it reports
unsupported or transport unavailable.
