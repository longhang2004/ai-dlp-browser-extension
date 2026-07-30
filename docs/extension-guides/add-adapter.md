# Add a PromptGuard application adapter

Milestone 1 ships only the ChatGPT adapter. A new adapter requires an explicit
design review because it expands host scope, DOM assumptions, manifest matches,
sender validation, status aggregation, permissions, tests, and threat model.

## Contract

Browser-specific adapters implement `ChatApplicationAdapter` in
`apps/extension/src/adapters/chat-application-adapter.ts`:

- expose one immutable packaged `AdapterDescriptor` that correlates the closed
  adapter ID, surface ID, exact version, exact canonical origins, trust,
  capability-specific support, and per-origin entry point;

- match only the intended application URL;
- resolve the live composer and associated enabled send control;
- synchronously read the active prompt and explicitly report whether safe
  replacement is supported;
- inspect prompt-free submission capabilities by returning attachment presence
  and an opaque adapter-owned structural fingerprint without reading attachment
  metadata or contents;
- synchronously capture click/Enter attempts;
- expose the browser-specific resume operation;
- dispose every listener, observer, reference, and callback.

The adapter must not evaluate policy, own authorization, show protection UI,
construct audit events, or receive `SensitiveDataFinding` objects.

The packaged catalog, not page data, storage, or managed policy, owns the
descriptor. Runtime validators reject unknown IDs, arbitrary versions,
mismatched adapter/surface/origin/capability combinations, extra keys, and
arbitrary metadata. A reserved `AdapterId` or known surface does not authorize
execution; only the current executable catalog does. M2.0 contains ChatGPT only;
gated M2.2 may add Claude.

## Prompt ownership

The adapter may access prompt text only during `readPrompt` or `replacePrompt`.
It must not place prompt content or prompt-derived snapshots in instance fields,
diagnostics, health events, errors, logs, messages, callbacks, or DOM caches.
Identity-only weak references used to detect composer replacement are permitted;
strong prompt-bearing DOM caches are not. Disposal must leave no prompt-bearing
state.

Health and error payloads use fixed codes only. Selector and resume failures
must never interpolate composer contents.

## Selector policy

Centralize all selectors in one adapter module and prefer, in order:

1. stable semantic elements and native form relationships;
2. the verified `#prompt-textarea[contenteditable]` semantic identity;
3. `textarea` and editable textbox semantics;
4. ARIA roles and labels;
5. stable data attributes;
6. documented last-resort fallbacks.

Generated or styling-oriented CSS classes are not primary selectors. Broad
composer and send-control selectors must be constrained to the same local form
or region.

Every application owns its selector and context modules. A per-origin thin
content entry imports the shared controller and exactly one adapter. Selector
imports across adapter folders are forbidden and verified in source, bundle,
fixture, and artifact tests.

Maintain fixture-based tests for at least two plausible DOM variants and add a
fixture for every selector regression. Resolve an exact Send control through one
shared collector that deduplicates selector matches and classifies its usable
composers as none, unique, or ambiguous. Ambiguity must never be resolved by DOM
order, selector priority, or element ID.

## Submission safety

The controller, not the adapter, owns the one-shot authorization. Before resume,
the controller re-resolves and validates URL, context version, composer, send
ownership, prompt text, attachment presence, and the exact opaque attachment
fingerprint. Authorization is consumed only after those checks. The adapter
performs one guarded synchronous resume and clears its guard in `finally`.

Send resolution must prefer composer-associated stable Send data attributes,
Send accessible labels, `button[type=submit]`, and `input[type=submit]`. Generic
no-type buttons are not submit candidates. Attachment selectors remain
centralized and scoped to the resolved composer region; dormant file inputs and
page-external attachment-like elements are not attachment evidence. Fingerprints
must be based exclusively on structural element identity and mutation
versioning. They must never read or encode filenames, paths, extensions, MIME
types, sizes, preview text, contents, labels, accessible text, or HTML.

`replacePrompt` returns an explicit verified result. The ChatGPT Milestone 1
adapter reports every editor as unsupported, including native textarea, because
DOM equality does not prove the application-state value used by the real submit
path. A future adapter may report support only after an application-specific
integration proves the value observed by its actual submission handler. Direct
DOM assignment plus synthetic events is never sufficient evidence.

Tests must cover click/Enter capture, Shift+Enter/modifiers/IME pass-through,
recursive interception, double events, dynamic element replacement, stale
contexts, shared-Send ambiguity, attachment add/remove/replace/mutation, resume
failure, duplicate initialization, and disposal.

## Integration changes

A new application also requires:

- an independently approved exact origin and least-privilege permission review;
- a packaged catalog entry and per-origin content IIFE;
- background correlation of sender origin/URL, adapter ID, surface ID, version,
  entry point, trust, and capabilities;
- application-specific prompt-free status and audit identity;
- local fixture routes that make no remote request;
- reciprocal cross-adapter selector tests, manifest/registration-rooted artifact
  reachability, orphan-bundle rejection, and production URL review;
- updated privacy/threat/manual-QA documentation.

For consumer surfaces, request only the approved exact optional host from the
options page during an explicit click. Dynamic persistent content registration
requires an independently approved `scripting` permission. Do not add `tabs`,
`activeTab`, broad host permissions, `web_accessible_resources`, page-world
injection, or remote assets. Managed enterprise deployment uses independently
signed exact-origin builds and does not assume host policy silently grants an
optional permission. See the
[permission strategy](../milestone-2/permission-strategy.md).

Chrome's official
[match-pattern documentation](https://developer.chrome.com/docs/extensions/develop/concepts/match-patterns)
means a scheme-and-host pattern that omits a port may inject the bootstrap on
alternate ports. Make the entry's first executable guard require serialized
`location.origin` to equal the approved default-port origin before adapter
construction or DOM access, and exit otherwise; background validates it again.
Alternate-port tests may observe bootstrap injection but must prove no page
read, accepted adapter/runtime registration or port, status, or audit.

## Evidence and trust review

Before implementation, the surface-selection record must state exact origins,
authentication needs, composer and submission evidence, Enter/Shift+Enter/IME,
attachments, SPA behavior, composer/Send ownership, resume and replacement,
selector/accessibility stability, drift, permission, non-sensitive QA, known
restrictions, and rollback. Unobserved DOM or submission behavior is recorded as
unavailable, never inferred.

A `verified` descriptor may claim only capabilities proven through application-
specific automated tests and authenticated QA on the exact release SHA/artifact.
Proposed verified trust may appear only in a gated QA release-candidate that is
not production-accepted and cannot be published or installed outside the QA
cohort. Only after all evidence passes may that exact same digest, without a
rebuild or substitution, be accepted and published; failure removes the
executable entry and restores unsupported. Attachment presence does not imply
inspection. Synthetic DOM clicks do not prove safe resume. Prompt replacement
stays unsupported until the application's real state boundary is proved.

Authenticated QA uses a dedicated account and synthetic fixture IDs. Record only
SHA, CI run, artifact digest/file count, browser/version, exact origin, account
tier, date/timezone, adapter version, permission, trust, capabilities, fixed
health codes, and structural outcomes. Never retain prompt/conversation content,
filenames, attachment metadata, account identifiers, screenshots, HTML, cookies,
tokens, URL paths, or page titles.

## Rollback

Every adapter review names an origin-local rollback. Dispose all active runtime
and cancel attempts before unregistering its versioned script; reject stale
ports and events; report unsupported or transport unavailable once no validated
port remains; and remove only that adapter's catalog, permission, build-entry,
and artifact edges in a follow-up release. Other adapters, settings, policy, and
audit remain intact. Chrome does not remove already injected code merely because
a dynamic script is unregistered, so live disposal and stale-port rejection are
mandatory.

Revocation synchronously invalidates background generation before awaited
cleanup, blocking accepted authorization, status, and audit. The background
reports the surface inactive immediately, sends disposal, and requires an
acknowledgement. Disposal and unregistration remain asynchronous best effort; if
the runtime fails or does not respond, show refresh guidance and make no
protection claim. Already injected code may keep observing or intercepting local
submissions until disposal is acknowledged or the page reloads, although the
background rejects its messages. Test both acknowledged and failed or
unresponsive disposal. Without an accepted port, registration failure/rollback
is unsupported or unavailable, never degraded. Degraded requires a connected
validated verified runtime with a fixed health failure; active describes context
health, not every capability.

## Future trust classification

The `AiSurfaceId`, `AdapterCapabilities`, `AdapterDescriptor`, and
`AdapterTrust` contracts do not authorize a new adapter. Each surface still
requires the review above. A `verified` adapter may claim only capabilities
proven against the application's real submission path. A `discovered` surface
provides coarse application visibility only, reads no prompt or page text, and
claims no enforcement; `unsupported` provides no enforcement claim.

IDE and CLI integrations are official-hook-first. Process scraping, terminal
history, keylogging, clipboard polling, network interception, and arbitrary
filesystem watching are not fallback adapters. Managed policy may configure a
packaged adapter but must never deliver executable adapter code or remotely
interpreted selectors. See the
[multi-surface architecture](../architecture/multi-surface-architecture.md).
