# Architecture overview

Milestone 1 is a local-only Chromium MV3 vertical slice for ChatGPT. Browser-
independent contracts, detectors, policy, and redaction live in workspace
packages; browser and DOM responsibilities stay in the extension application.

```mermaid
flowchart LR
  Composer["ChatGPT composer"] --> Adapter["Semantic ChatGPT adapter"]
  Adapter --> Controller["Submission controller"]
  Controller --> Size["100,000-unit size guard"]
  Size --> Detectors["Local detectors"]
  Detectors --> Policy["Metadata-only policy engine"]
  Controller --> Redaction["Local redaction"]
  Controller --> Display["Sanitized display model"]
  Display --> Dialog["Open-Shadow React dialog"]
  Controller --> Adapter
  Controller --> SafeAudit["Prompt-free audit event"]
  SafeAudit --> Worker["MV3 service worker"]
  Worker --> Storage["Trusted local storage"]
  Worker --> Pages["Popup, options, audit pages"]
```

## Package boundaries

- `packages/shared-types` owns versioned settings/audit contracts, prompt-free
  messages, sanitized display types, finding types, and strict validators.
- `packages/detectors` owns prompt analysis and deterministic redaction. This is
  one of the few areas allowed to hold `matchedText` transiently.
- `packages/policy-engine` receives only `PolicyFinding` metadata and returns
  only `action`, `matchedRuleIds`, and `reasonCode`.
- `apps/extension` owns Chrome APIs, the ChatGPT adapter, settings bootstrap,
  submission state, UI, pages, storage adapters, manifest, and builds.

No shared policy contract contains DOM objects, URLs, prompt text, matched text,
redacted prompt text, or offsets.

## Submission lifecycle

1. The content script opens the `settings-v1` port and reports `initializing`.
2. The service worker validates the sender and sends a versioned settings
   snapshot.
3. Disabled settings create no protection runtime. Enabled settings create and
   register one runtime, which reports `waiting_for_composer` until a valid
   composer is confirmed, then `active`, or `degraded` after the grace period.
4. Click or unmodified Enter is resolved from its exact event target and
   captured synchronously. The adapter assigns an opaque weak context identity
   to the owning composer and complete submission region; another valid composer
   is never substituted. Shift+Enter, IME, and modifier combinations pass
   through.
5. The controller reads the current prompt synchronously and retains it only for
   the active attempt.
6. Attachment presence is checked across the exact captured submission region,
   including chips before or after a nested form, before analysis and again
   immediately before resume. Attachments stop with no content inspection.
   Inputs over 100,000 UTF-16 code units stop before detection.
7. Findings are converted separately into metadata-only policy findings and
   placeholder-only display findings.
8. The controller handles allow, warn, internal redact, or block decisions.
   Every Milestone 1 ChatGPT editor reports replacement unsupported, so warning
   dialogs never offer redaction and an internal redact decision fails closed.
   Before any resumed submission it re-resolves the exact weak identity, URL,
   region, composer, send control, context version, and current text.
9. A one-shot authorization is consumed exactly once. Modified prompts, stale
   dialogs, replaced composers, cancelled attempts, and duplicate events cannot
   reuse it.
10. Sensitive controller state is cleared before prompt-free audit persistence.

The adapter owns the browser-specific resume mechanism. The controller owns
authorization, revalidation, decision state, and duplicate-submission defense.

## Storage and messaging

At startup the service worker calls
`chrome.storage.local.setAccessLevel({accessLevel: "TRUSTED_CONTEXTS"})`.
Content scripts never access storage directly. Extension pages use closed,
strictly validated one-time messages; content settings use a validated long-
lived port with generation numbers.

Settings and audit data use `schemaVersion: 1` envelopes. Persisted email/phone
actions are limited to `allow`, `warn`, and `block`. Exact legacy V1 `redact`
values migrate atomically to `warn` and are persisted before content broadcast.
Missing, corrupted, unsupported, or otherwise invalid data falls back to safe
settings or an empty audit log. Milestone 1 intentionally has only this minimal
version-1 migration/fallback mechanism, not a general migration framework.

## UI isolation and status truthfulness

Protection dialogs mount React into `host.attachShadow({ mode: "open" })`.
Shadow DOM prevents accidental style/component collisions and remains
inspectable for accessibility and testing. The host page can still remove or
disrupt it, so it is not a security boundary.

The popup cannot report active protection until a validated snapshot has been
applied, interception registered, and a valid composer confirmed. Disconnecting
the settings port or disabling protection disposes interception and reports
`unavailable` until a fresh connection and snapshot complete. Delayed rendering
reports `waiting_for_composer` for the 10-second default grace without health
audit noise. SPA navigation starts a fresh waiting lifecycle instead of reusing
a stale degraded state.

## Build topology

Vite produces multi-page ESM for the service worker and extension pages, plus a
separate self-contained IIFE `content-script.js`. Source maps are disabled. The
generated manifest has one static top-frame content script for
`https://chatgpt.com/*`, permission only for `storage`, and an extension-page
CSP with `connect-src 'none'`.
