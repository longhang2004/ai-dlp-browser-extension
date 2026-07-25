# Privacy-First AI DLP Browser Extension — Milestone 1 Design

- **Status:** Proposed for approval
- **Date:** 2026-07-26
- **Milestone:** Chromium Manifest V3 extension for ChatGPT
- **Audience:** Engineering, security, privacy, and product reviewers

## 1. Problem statement

Employees can accidentally paste sensitive company information into public AI
chatbots. Milestone 1 must prove that a browser extension can inspect a ChatGPT
prompt immediately before submission, make a deterministic local policy
decision, and allow, warn, redact, or block the submission without sending the
prompt to any remote service.

The product must minimize its own collection. Prompt text and detector matches
are sensitive processing data, not telemetry. They may exist transiently in the
content script for analysis and redaction, but must not be logged, persisted, or
included in extension messages or UI state.

## 2. Goals

1. Support the current ChatGPT web application at `https://chatgpt.com/*` in
   Chromium browsers using Manifest V3.
2. Intercept click and Enter submissions without breaking Shift+Enter or
   ordinary prompt editing.
3. Detect the required sensitive-data categories locally with deterministic
   rules.
4. Evaluate findings through a browser-independent, typed policy engine.
5. Provide accessible warning, blocking, redaction, oversized-prompt, and
   recoverable-error experiences.
6. Store only versioned, privacy-safe local settings and audit metadata.
7. Keep detector, policy, adapter, storage, and UI responsibilities separately
   testable.
8. Use narrow permissions and ship no network, telemetry, remote code, or
   remotely hosted assets.
9. Produce a reproducible production build whose generated artifacts are
   inspected for security properties before completion is claimed.

## 3. Explicit non-goals

Milestone 1 does not implement:

- A backend, database, cloud service, or organization account.
- Authentication, SSO, SCIM, multi-tenancy, billing, or enterprise dashboards.
- Centralized policy administration, audit collection, SIEM integration, or
  employee monitoring.
- Managed browser deployment or prevention of user disablement.
- Claude, Gemini, Microsoft Copilot, or any non-ChatGPT adapter.
- Firefox, Safari, mobile, desktop-native, endpoint-agent, IDE, or network-proxy
  support.
- File, attachment, image, screenshot, OCR, clipboard-history, or previously
  submitted conversation inspection.
- Machine-learning or probabilistic classifiers.
- Chrome Web Store publishing.
- A general-purpose policy language or a migration framework.
- Protection against all page-driven or programmatic submission paths when the
  ChatGPT DOM no longer matches any supported adapter variant.

These are future-product concerns, not scaffolding requirements for this
milestone.

## 4. Design principles and decisions

The priority order is privacy, correctness, testability, narrow permissions,
clear boundaries, maintainability, user experience, and visual polish.

The implementation will use a small pnpm workspace:

- `packages/shared-types` for platform-independent contracts.
- `packages/detectors` for deterministic detection and redaction.
- `packages/policy-engine` for policy validation and evaluation.
- `apps/extension` for Manifest V3, ChatGPT integration, storage, messaging, and
  user interfaces.

Vite will produce the extension artifact. React may be used only for extension
pages and the protection dialog where component state and focus management make
it materially useful. Core analysis, policy, adapter, storage, and orchestration
remain plain TypeScript.

The injected protection UI will use:

```typescript
host.attachShadow({ mode: "open" });
```

Open Shadow DOM is chosen for CSS/component isolation, automated inspection,
accessibility tooling, and debugging. Shadow DOM is explicitly **not** a
security boundary. The host page can observe, alter, hide, or remove shared DOM,
including the extension's host element.

## 5. User stories

1. As an employee, I can submit a clean prompt without an unnecessary dialog or
   an ordinary `allow` audit record.
2. As an employee, I receive a warning before sending a prompt containing an
   email address, phone number, or protected keyword.
3. As an employee, I can cancel, explicitly send a warned prompt, or redact
   supported findings and continue.
4. As an employee, I cannot bypass a block for a payment card, AWS access key,
   private key, or high-confidence API secret under the default policy.
5. As an employee, Shift+Enter continues to insert a newline.
6. As an employee, a prompt over 100,000 UTF-16 code units is not partially
   scanned or silently submitted; I am asked to split it into smaller prompts.
7. As an employee, I can enable or disable protection and configure the
   supported local settings.
8. As an employee, I can view and clear privacy-safe local audit history.
9. As a security reviewer, I can verify that raw prompts and matched values do
   not leave the content-script analysis pipeline or appear in the production
   artifact.
10. As a future adapter author, I can add a chatbot integration without changing
    detector or policy-engine code.

## 6. Functional requirements

### 6.1 Activation

- The production content script is statically declared for
  `https://chatgpt.com/*`, top frame only, in the isolated execution world.
- It does not activate on other websites, subdomains, local files, or insecure
  HTTP origins.
- The adapter supports delayed composer rendering and DOM replacement during
  ChatGPT SPA navigation.
- Initialization is idempotent. At most one active set of capture listeners and
  one health observer exist per document.
- Disposing the adapter removes listeners, observers, timers, dialog hosts, and
  transient authorization state.

### 6.2 Submission interception

- A candidate click on the current composer send control is captured.
- Enter in the current composer is captured only when it represents submission.
- Shift+Enter, modifier shortcuts, IME composition, and Enter outside the
  composer are not intercepted.
- A captured attempt is prevented synchronously before asynchronous analysis
  begins.
- The current prompt is read only after an actual submission attempt.
- Detection does not run continuously while the user types.
- The controller serializes attempts so one physical user action cannot create
  two decisions, two dialogs, or two resumed submissions.

### 6.3 Protection disabled

When protection is disabled, the adapter still uses its controlled one-shot
resume mechanism to release a captured attempt, but the prompt is not scanned
and no decision audit event is persisted. Disabling protection is an explicit
user action and is not available from a warning or block dialog.

### 6.4 Prompt size

`MAX_PROMPT_CODE_UNITS` is exactly `100_000`, measured by JavaScript
`string.length` (UTF-16 code units).

When protection is enabled and the prompt exceeds this limit:

1. Do not run any detector on the prompt, including a prefix or sample.
2. Do not silently submit.
3. Stop the current submission attempt.
4. Show a content-free error stating that the prompt is too large to inspect
   safely and asking the user to split it into smaller prompts.
5. Offer only close/cancel; do not offer send anyway or redaction.
6. Persist one privacy-safe `prompt_too_large` enforcement error event.
7. Keep the composer content unchanged.

This path is tested at 100,000 code units, where scanning remains supported, and
100,001 code units, where scanning does not occur.

### 6.5 Dialog behavior

The warning dialog displays:

- Deduplicated detected categories.
- Confidence labels where useful.
- A placeholder-only masked preview such as
  `… [EMAIL] … [PROTECTED_KEYWORD] …`.
- A concise explanation.
- Cancel, Send anyway, and Redact and continue actions. The redact action is
  shown only when a sanitized result can be produced.

The block dialog displays:

- Deduplicated detected categories.
- Why the policy blocked submission.
- Close/cancel only, with no bypass or submit action.

The error dialog displays only an error category and recovery instructions. It
never includes prompt content, prompt excerpts, matched values, prompt length,
or detector output.

Dialogs:

- Use an open Shadow DOM root for style isolation.
- Use semantic dialog markup, an accessible name, keyboard focus containment,
  Escape handling where cancellation is allowed, and focus restoration.
- Do not use `innerHTML` for prompt-derived or configuration-derived values.
- Invalidate prior dialog actions when replaced, cancelled, or disposed.

## 7. Proposed repository structure

```text
apps/
  extension/
    manifest.json
    vite.config.ts
    pages/
      popup.html
      options.html
      audit.html
    src/
      adapters/
        chat-application-adapter.ts
        chatgpt/
          chatgpt-adapter.ts
          selectors.ts
      background/
        message-router.ts
      content/
        bootstrap.ts
        submission-controller.ts
      messaging/
        schemas.ts
      storage/
        audit-store.ts
        chrome-storage.ts
        settings-store.ts
      ui/
        protection-dialog/
      popup/
      options/
      audit/
packages/
  shared-types/
  detectors/
    src/
      detectors/
      analyze.ts
      redact.ts
  policy-engine/
tests/
  fixtures/
  performance/
docs/
  architecture/
  manual-qa.md
  privacy.md
  threat-model.md
  extension-guides/
```

Test files are colocated with implementation modules except shared sensitive
samples, cross-package integration, and performance fixtures.

## 8. Architecture and main data flow

```text
User submission
  -> ChatGPT adapter synchronously captures and prevents candidate event
  -> Submission controller serializes the attempt
  -> Settings store returns validated v1 settings or safe defaults
  -> Size guard rejects oversized prompt before detector execution
  -> Detector orchestrator returns transient SensitiveDataFinding[]
  -> Policy engine returns PolicyDecision
  -> Controller creates sanitized DisplayFinding[] and safe audit model
  -> allow: controller issues and consumes a one-shot authorization
  -> warn: UI requires explicit cancel, bypass, or redact action
  -> redact: controller revalidates prompt, replaces it, then authorizes once
  -> block/error: attempt remains stopped
  -> adapter performs the browser-specific resumed click/form action
  -> background accepts only schema-validated, privacy-safe audit messages
  -> audit store applies v1 envelope and retention
```

Raw prompt text and `matchedText` stop at the controller boundary. Neither is
passed to background messaging, storage, React props, React state, other UI
state, or audit construction.

## 9. Component responsibilities

### 9.1 Shared types

Defines detector categories, findings, policy input/output, settings, safe UI
models, audit events, adapter contracts, and runtime-message schemas. It has no
browser or UI dependencies.

### 9.2 Detector package

- Runs deterministic detectors.
- Enforces stable output ordering.
- Produces consistent UTF-16 offsets.
- Performs Luhn validation and detector-specific structural validation.
- Produces redaction text using deterministic overlap handling.
- Does not access DOM, storage, browser APIs, console, network, or UI.

### 9.3 Policy engine

- Validates typed policy configuration.
- Resolves category/confidence rules to an action.
- Applies fixed action precedence.
- Produces deterministic matched rule IDs and a non-sensitive reason code.
- Does not redact, render, persist, or access browser APIs.

### 9.4 ChatGPT adapter

- Owns all ChatGPT selector strategies.
- Determines whether an event is a submission candidate.
- Locates, reads, and replaces the current composer.
- Captures candidate events synchronously.
- Exposes the browser-specific resume operation.
- Implements only a synchronous, call-scoped resume bypass; it does not create,
  approve, retain, or reuse authorization tokens.
- Reports content-free adapter health transitions.

### 9.5 Submission controller

- Owns the attempt state machine.
- Loads cached/validated settings.
- Enforces the prompt-size boundary.
- Invokes detection and policy evaluation.
- Creates `DisplayFinding` before calling UI code.
- Owns prompt revalidation and one-shot authorization creation/consumption.
- Ensures one dialog and one possible resumed submission per attempt.
- Constructs privacy-safe audit events.
- Never logs prompt data.

### 9.6 UI

- Accepts only sanitized display and action models.
- Never accepts the raw prompt, `SensitiveDataFinding`, `matchedText`, original
  substrings, or prompt excerpts.
- Returns a typed user intent such as cancel, bypass warning, or redact.
- Does not own policy decisions or authorization.

### 9.7 Background and messaging

- Validates every runtime message as untrusted input.
- Rejects unknown message types, unknown properties, malformed IDs, invalid
  enums, invalid senders, and unexpected prompt-bearing fields.
- Routes safe settings and audit operations.
- Has no message schema capable of carrying raw prompt text or matched text.

### 9.8 Storage

- Reads and writes versioned envelopes.
- Returns safe defaults for invalid settings.
- Sanitizes audit events again at the persistence boundary.
- Drops ordinary `allow` decision events in Milestone 1.
- Enforces retention and audit clearing.

## 10. Interfaces and data models

The exact source-file placement is decided in the implementation plan, but the
following contracts define the approved boundaries.

### 10.1 Findings

```typescript
type SensitiveDataCategory =
  | "email"
  | "phone"
  | "payment_card"
  | "aws_access_key"
  | "private_key"
  | "api_secret"
  | "protected_keyword";

type FindingConfidence = "high" | "medium" | "low";

type SensitiveDataFinding = {
  id: string;
  detectorId: string;
  category: SensitiveDataCategory;
  start: number;
  end: number;
  confidence: FindingConfidence;
  matchedText: string;
  redactedText: string;
};
```

`matchedText` is allowed only in transient detector, redaction, policy, and
controller memory. It is forbidden in UI contracts, extension messages,
storage, logs, errors, and analytics.

Finding invariants:

- `0 <= start < end <= prompt.length`.
- `matchedText === prompt.slice(start, end)`.
- `redactedText` is the approved category placeholder.
- IDs are deterministic from detector ID and range, not matched contents.
- Results are ordered by start ascending, end descending, detector priority,
  then detector ID.

### 10.2 Sanitized display model

```typescript
type DisplayFinding = {
  category: SensitiveDataCategory;
  confidence: FindingConfidence;
  placeholder: string;
};

type ProtectionDialogModel = {
  kind: "warn" | "block";
  findings: DisplayFinding[];
  maskedPreview: string;
  reasonCode: string;
  canRedact: boolean;
};
```

`maskedPreview` is built only from punctuation/ellipsis and fixed placeholders.
It contains no user-authored context. The conversion from findings to this
model occurs inside the submission controller before any UI function or React
component is invoked.

### 10.3 Policy

```typescript
type PolicyAction = "allow" | "warn" | "redact" | "block";

type PolicyConfiguration = {
  schemaVersion: 1;
  enabled: boolean;
  actions: Record<SensitiveDataCategory, PolicyAction>;
  highConfidenceApiSecretAction: PolicyAction;
};

type PolicyInput = {
  application: "chatgpt";
  prompt: string;
  findings: SensitiveDataFinding[];
  policy: PolicyConfiguration;
};

type PolicyDecision = {
  action: PolicyAction;
  findings: SensitiveDataFinding[];
  sanitizedText?: string;
  matchedRuleIds: string[];
  reasonCode: string;
};
```

The policy engine accepts prompt text only because deterministic redaction must
produce an exact sanitized result. The package remains browser-independent, and
the prompt never leaves content-script memory. `sanitizedText` is present for
`warn` and `redact` decisions when every finding can be safely redacted. This
allows a warning dialog to offer Redact and continue without passing findings
or prompt text into the UI. It is absent for `allow` and `block`.

### 10.4 User settings

```typescript
type ConfigurableAction = "allow" | "warn" | "redact" | "block";

type ProtectionSettings = {
  protectionEnabled: boolean;
  emailAction: ConfigurableAction;
  phoneAction: ConfigurableAction;
  protectedKeywords: string[];
  auditRetentionLimit: number;
};

type StoredSettingsEnvelope = {
  schemaVersion: 1;
  settings: ProtectionSettings;
};
```

Defaults:

- `protectionEnabled: true`
- `emailAction: "warn"`
- `phoneAction: "warn"`
- `protectedKeywords: []`
- `auditRetentionLimit: 100`

The retention limit is an integer from 1 through 1,000. Protected keywords are
trimmed, deduplicated case-insensitively, limited to 100 entries, and each entry
is 1 through 100 UTF-16 code units. Invalid saves are rejected with field-level
errors. Invalid stored data causes the entire settings object to fall back to
the safe defaults above; an invalid value must never disable protection.

The policy engine supports a complete typed category map, but Milestone 1
settings expose only email and phone actions. Strict-category overrides are a
future managed-policy capability.

### 10.5 Versioned audit storage

```typescript
type DecisionAuditEvent = {
  kind: "decision";
  id: string;
  timestamp: string;
  application: "chatgpt";
  action: PolicyAction;
  detectorCategories: SensitiveDataCategory[];
  matchedRuleIds: string[];
  findingCount: number;
  maskedExcerpt?: string;
  adapterVersion: string;
};

type EnforcementErrorCode =
  | "prompt_too_large"
  | "detector_failure"
  | "policy_failure"
  | "ui_failure"
  | "resume_failure"
  | "extension_context_invalidated";

type EnforcementErrorAuditEvent = {
  kind: "enforcement_error";
  id: string;
  timestamp: string;
  application: "chatgpt";
  errorCode: EnforcementErrorCode;
  adapterVersion: string;
};

type AdapterHealthAuditEvent = {
  kind: "adapter_health";
  id: string;
  timestamp: string;
  application: "chatgpt";
  status: "degraded";
  healthCode:
    | "composer_not_found"
    | "send_control_not_found"
    | "unsupported_dom_variant";
  adapterVersion: string;
};

type AuditEvent =
  | DecisionAuditEvent
  | EnforcementErrorAuditEvent
  | AdapterHealthAuditEvent;

type StoredAuditEnvelope = {
  schemaVersion: 1;
  events: AuditEvent[];
};
```

`DecisionAuditEvent.action` deliberately includes `allow` so a future,
explicit audit setting can enable it without changing the event shape.
Milestone 1 has no such setting. Its fixed persistence policy is:

- Persist decision events only for `warn`, `redact`, and `block`.
- Persist privacy-safe enforcement errors.
- Persist degraded adapter health errors, with repeated identical errors
  coalesced to avoid noisy behavioral metadata. The adapter reports only the
  first transition into a degraded state within a document session; an
  in-memory recovery permits a later degradation to create a new error. Recovery
  itself is not an audit event.
- Drop all `allow` decision events at the persistence boundary.

`maskedExcerpt`, when present, is a maximum of five fixed category placeholders
joined by separators. It cannot contain user-authored text.

The only migration behavior in Milestone 1 is:

1. Read the configured storage key as unknown data.
2. Require an object with exactly the supported `schemaVersion: 1` envelope.
3. Validate every contained field/event.
4. On a missing, corrupted, invalid, or unsupported settings envelope, return
   safe default settings.
5. On a missing, corrupted, invalid, or unsupported audit envelope, return an
   empty audit list.

No migration registry, version chain, or speculative migration framework is
introduced.

### 10.6 Runtime messages

Runtime messages are a closed discriminated union for:

- Reading validated settings.
- Saving a complete validated settings object.
- Reading safe audit events.
- Appending one safe audit event.
- Clearing audit events.
- Reading popup status.

No message contains fields named `prompt`, `text`, `matchedText`, `findings`, or
arbitrary metadata. The receiver verifies `sender.id === chrome.runtime.id` and,
where relevant, that the sender URL is an extension page or
`https://chatgpt.com/*`.

### 10.7 Adapter and resubmission contracts

```typescript
type SubmitSource = "click" | "enter";

type CapturedSubmitAttempt = {
  id: string;
  source: SubmitSource;
  composer: HTMLElement;
  resumeTarget: HTMLElement;
};

declare const consumedAuthorizationBrand: unique symbol;

type ConsumedSubmissionAuthorization = {
  readonly [consumedAuthorizationBrand]: true;
  readonly attemptId: string;
};

interface ChatApplicationAdapter {
  readonly id: "chatgpt";
  readonly version: string;

  matches(url: URL): boolean;
  locateComposer(): HTMLElement | null;
  readPrompt(composer: HTMLElement): string;
  replacePrompt(composer: HTMLElement, text: string): void;

  registerSubmitInterceptor(
    handler: (attempt: CapturedSubmitAttempt) => void,
  ): () => void;

  resumeSubmission(
    attempt: CapturedSubmitAttempt,
    authorization: ConsumedSubmissionAuthorization,
  ): void;
}
```

Only the controller module can turn an active authorization into the branded
`ConsumedSubmissionAuthorization`. The adapter treats it as proof for one
call, does not store it, and resets its synchronous `resumeInProgress` guard in
a `finally` block.

## 11. Policy evaluation semantics

### 11.1 Default rules

| Rule ID | Condition | Default action |
|---|---|---|
| `block.private-key` | `private_key` finding | `block` |
| `block.aws-access-key` | `aws_access_key` finding | `block` |
| `block.payment-card` | Luhn-valid `payment_card` finding | `block` |
| `block.api-secret.high` | High-confidence `api_secret` | `block` |
| `warn.api-secret.medium` | Medium-confidence `api_secret` | `warn` |
| `warn.email` | `email` finding | Configured, default `warn` |
| `warn.phone` | `phone` finding | Configured, default `warn` |
| `warn.protected-keyword` | `protected_keyword` finding | `warn` |
| `allow.no-findings` | No findings | `allow` |

Low-confidence generic API-secret candidates are not emitted by the Milestone 1
detector. The confidence type remains shared for detectors that may need it
later.

### 11.2 Precedence and ordering

Action precedence is:

```text
block > redact > warn > allow
```

All applicable rules are evaluated. `matchedRuleIds` uses the fixed table order
above, not detector execution order or object-key order. A disabled policy
returns `allow`, no matched rule IDs, and no sanitized text without invoking
detectors.

When the selected action is `redact`, the engine redacts every supported finding
in the prompt, including warn-level findings, so an email is not sent unchanged
alongside a redacted phone number.

For a `warn` decision, the same complete sanitized result is supplied as an
optional alternative. The UI receives only a boolean indicating whether that
alternative exists; the sanitized string remains in controller memory.

Decision audit records represent the final enforcement outcome, with at most one
decision event per attempt:

- A warning cancelled or explicitly bypassed is recorded as `warn`.
- A warning resolved through redaction is recorded as `redact`.
- A configured automatic redaction is recorded as `redact`.
- A block is recorded as `block`.
- An allow is dropped by the Milestone 1 persistence policy.

Invalid policy configuration throws a typed, content-free validation error. The
controller treats it as an unresolved enforcement decision and stops the
attempt.

## 12. Detection rules

All detectors are synchronous, deterministic, side-effect-free, Unicode-safe
with respect to offsets, and bounded by the 100,000-code-unit input limit.

### 12.1 Email

- Match a conservative local-part and DNS-style domain.
- Require boundary checks to avoid matching inside a larger identifier.
- Reject missing local/domain parts, consecutive dots, invalid domain labels,
  and trailing punctuation.
- Preserve the exact source range.
- Confidence: high for structurally valid matches.

### 12.2 Phone

- Support Vietnamese mobile numbers beginning with `03`, `05`, `07`, `08`, or
  `09` and containing ten digits.
- Support the equivalent `+84` form with the domestic leading zero removed.
- Support conservative international `+`-prefixed numbers containing 7 through
  15 digits after normalization.
- Allow common spaces, parentheses, dots, and hyphens without consuming
  unrelated punctuation.
- Require number boundaries and reject card-length digit sequences without an
  international `+` prefix.
- Confidence: high for valid Vietnamese formats; medium for the general
  international pattern.

### 12.3 Payment card

- Find 13 through 19 digits with optional single spaces or hyphens.
- Reject alphabetic adjacency and malformed separators.
- Normalize digits and require a passing Luhn checksum.
- Only Luhn-valid candidates produce findings.
- Confidence: high.

### 12.4 AWS access key ID

- Match access-key identifiers beginning with `AKIA` (long-lived) or `ASIA`
  (temporary), followed by 16 uppercase ASCII letters or digits for a total
  length of 20 characters.
- Require strict token boundaries.
- Do not treat arbitrary 20-character uppercase strings as AWS keys.
- Confidence: high.

### 12.5 PEM private key

- Match bounded PEM blocks whose header/footer identify a private key, including
  generic PKCS#8 and common RSA/EC variants.
- Require a corresponding footer and plausible base64 body.
- After ignoring permitted PEM line whitespace, require 64 through 16,384
  base64 payload characters. Reject other body characters and mismatched key
  labels.
- The finding range covers the full block for complete redaction.
- Confidence: high.

### 12.6 Generic API secret

- Require a conservative context key such as `api_key`, `apikey`, `token`,
  `secret`, `client_secret`, or `password`.
- Permit only horizontal whitespace between the context key, a `:` or `=`
  delimiter, and an optionally quoted value.
- Require a value of 12 through 256 ASCII code units containing at least two of
  lowercase letters, uppercase letters, digits, and the approved token
  punctuation `_./+=-`.
- Reject ordinary prose, short values, placeholder values, environment-variable
  references, repeated single-character values, and long random strings without
  secret-related context.
- Emit high confidence when context is accompanied by a known token prefix
  (`sk-`, `ghp_`, `github_pat_`, or `xoxb-`) or a value of at least 20 code
  units spanning three character classes. Emit medium confidence for the
  remaining context-and-composition matches.

### 12.7 Protected keyword

- Validate and escape every configured keyword.
- Match case-insensitively with Unicode letter/number boundary checks.
- Support Vietnamese diacritics and multiword/project-code values.
- Do not match a configured keyword inside a larger Unicode alphanumeric
  identifier.
- Preserve source offsets without normalizing the prompt.
- Confidence: high.

### 12.8 Multiple and overlapping findings

All valid findings remain available to policy evaluation. Redaction:

1. Sorts ranges deterministically.
2. Merges only overlapping ranges, not merely adjacent ranges.
3. Removes the entire union of overlapping source text.
4. Selects one placeholder using fixed security priority:
   `private_key`, `aws_access_key`, `payment_card`, `api_secret`, `email`,
   `phone`, `protected_keyword`.
5. Applies replacements from the end of the prompt toward the start.

This guarantees stable output and prevents a lower-priority inner finding from
leaving part of a higher-priority value visible.

Approved placeholders are:

- `[EMAIL]`
- `[PHONE]`
- `[PAYMENT_CARD]`
- `[AWS_ACCESS_KEY]`
- `[PRIVATE_KEY]`
- `[API_SECRET]`
- `[PROTECTED_KEYWORD]`

## 13. ChatGPT adapter behavior

### 13.1 Resilient selector policy

Every selector and selector strategy is centralized in
`apps/extension/src/adapters/chatgpt`. No detector, controller, UI, or storage
module contains ChatGPT selectors.

Selector preference is:

1. Stable semantic elements and native control behavior.
2. `textarea` elements associated with the active composer.
3. Editable elements with `contenteditable="true"`.
4. Form ownership and submit-control relationships.
5. ARIA textbox/button roles and accessible labels.
6. Stable, documented data attributes.
7. Multiple documented fallbacks.
8. Generated or styling-oriented CSS classes only as an evidenced last resort.

Milestone 1 will not add generated-class selectors unless manual testing shows
that every semantic strategy fails. If one is required, it must be isolated,
documented with the observed DOM variant, and covered by a fixture.

A composer candidate must be editable, visible, connected to the document, and
associated with the active ChatGPT composer region. A send candidate must be an
enabled submit control associated with that composer. Broad selectors such as
all contenteditable elements or all buttons are never sufficient by themselves.

Fixture-based adapter tests include at least:

- Variant A: a form containing a native `textarea` and `button[type=submit]`.
- Variant B: a semantic `contenteditable` textbox with an associated send
  control located through form/ARIA/stable-data fallbacks.

Additional fixtures are added for every selector regression fixed later.

### 13.2 Dynamic rendering and SPA behavior

Document-level delegated capture listeners survive replacement of composer and
send elements. A debounced MutationObserver checks adapter health only; it does
not read or scan prompt content. URL matching is rechecked on each candidate
event and on SPA navigation signals.

### 13.3 Resubmission responsibility and state machine

The controller owns:

- The active attempt ID and dialog generation.
- The exact prompt snapshot in transient memory.
- Re-reading and comparing the prompt immediately before approval.
- Authorization creation, validation, single consumption, invalidation, and
  expiry.
- Serialization of evaluating, dialog, resuming, cancelled, and completed
  states.

The adapter owns:

- The browser/ChatGPT-specific operation that resumes the captured attempt.
- A synchronous `resumeInProgress` scope that permits exactly the DOM event
  generated by that operation to pass through interception.
- Clearing that scope in `finally`, even when the page handler throws.

Authorization sequence:

1. Capture and prevent a candidate event.
2. Assign one attempt ID and enter `evaluating`.
3. Analyze the exact prompt snapshot.
4. For a user-approved result, re-read the current composer.
5. If it differs from the snapshot, invalidate the dialog and authorization and
   start a new analysis; do not submit.
6. If unchanged, atomically consume the controller's one-shot authorization,
   producing a branded consumed authorization for that attempt.
7. Enter `resuming` and call the adapter exactly once.
8. The adapter permits only its synchronous resumed event and immediately clears
   its guard.
9. Mark the attempt completed and reject further actions from its dialog.

The controller never creates a second authorization for a completed or cancelled
attempt. Replaced dialogs carry a new generation ID, so stale button callbacks
are inert.

The Enter handler prevents the original key event before asynchronous work and
resumes through one adapter operation, normally the associated send control.
This prevents a later browser-generated click from creating a second
submission. While an attempt is evaluating, displaying a dialog, or resuming,
additional candidate events are stopped and do not create parallel attempts.

Tests must prove prevention of:

- Recursive interception.
- Reuse of a consumed authorization.
- Approval of a modified prompt.
- Double submission from keyboard and click paths.
- Submission after cancellation.
- Submission from a replaced/stale dialog.
- A bypass guard remaining set after a resume error.

### 13.4 Missing selectors

If a known candidate event is captured but the composer or resume target cannot
be resolved, the event remains stopped and a content-free recoverable error is
shown. The adapter records a coalesced degraded health event.

If ChatGPT changes to an entirely unknown DOM or programmatic submission path,
the extension may be unable to identify and intercept the attempt. The popup
must report that protection is not confirmed rather than claiming a healthy
state. This limitation is documented in manual QA and the threat model.

## 14. Extension pages

### 14.1 Popup

Shows:

- Protection enabled or disabled.
- Supported application: ChatGPT.
- Count of persisted recent protected/error events.
- Links to settings and local audit history.

It does not show prompt text, matched values, or clean-prompt activity.

### 14.2 Options

Allows:

- Protection enabled/disabled.
- Email action.
- Phone action.
- Protected keyword list.
- Audit retention limit.

All inputs are validated before the complete v1 settings envelope is saved.
Strict default block rules and allow-audit configuration are not exposed.

### 14.3 Local audit

Shows the safe fields applicable to each event:

- Timestamp.
- Application.
- Decision action or error/health status.
- Categories.
- Finding count.
- Placeholder-only masked excerpt.

Includes an empty state and an explicit clear-history action. Clearing is local
and immediate after confirmation.

## 15. Privacy requirements

1. Detection and policy evaluation are entirely local.
2. No prompt content is sent to a remote service.
3. No network request is initiated by the extension.
4. No telemetry, analytics, crash reporter, tracking pixel, or remote font is
   included.
5. Raw prompts and `matchedText` are never logged or persisted.
6. Raw prompts, `matchedText`, full findings, and user-authored excerpts never
   enter runtime messages, React props/state, other UI state, or audit models.
7. Audit `allow` events are not persisted in Milestone 1.
8. Audit retention defaults to 100 and is always bounded from 1 to 1,000.
9. Storage is limited to `chrome.storage.local`; no sync storage is used.
10. Prompt snapshots and authorizations are released when an attempt completes,
    is cancelled, is replaced, errors, or the adapter is disposed.
11. Production code does not log sensitive values even in debug mode.
12. Production source maps are disabled.

## 16. Threat model

### 16.1 Malicious or compromised page scripts

Content scripts run in an isolated JavaScript world, but the DOM is shared. Page
scripts can modify selectors, dispatch events, remove the open Shadow DOM host,
or bypass supported UI paths. The extension treats page DOM and events as
untrusted, validates element relationships immediately before use, avoids
injecting secrets into DOM, and never presents Shadow DOM as a security
boundary. A browser extension cannot guarantee enforcement against a hostile
page that completely changes submission behavior.

### 16.2 DOM changes

Semantic selector strategies, centralized fallbacks, two or more DOM fixtures,
adapter health states, and manual production-DOM verification reduce accidental
breakage. Unknown variants fail without a false healthy indicator.

### 16.3 Extension message spoofing

Messages use a closed schema, strict field validation, sender ID and URL checks,
and no externally connectable surface. Prompt-bearing fields do not exist in the
protocol, so malformed messages cannot trick the background into persisting a
raw prompt through a generic metadata field.

### 16.4 Storage exposure

Anyone with access to the browser profile or extension debugging can inspect
local extension storage. Therefore storage contains only bounded, placeholder-
only audit metadata and validated configuration. `chrome.storage.local` is a
privacy boundary from ordinary page scripts, not from the local device owner or
malware with profile access.

### 16.5 Accidental logging and build leakage

Production logging of prompts/findings is forbidden. Sensitive sample strings
exist only in dedicated test fixtures. Production source maps are disabled, and
the built artifact is searched independently from source.

### 16.6 Unsupported platforms and user disablement

Other browsers, ChatGPT desktop/mobile apps, other AI sites, attachments, and
unsupported DOM variants are outside enforcement. In an unmanaged deployment,
the user can disable or uninstall the extension or disable protection in
settings. Managed deployment is future work.

## 17. Error handling and safe failure

| Failure | Submission behavior | User behavior | Audit behavior |
|---|---|---|---|
| Oversized prompt | Stop attempt | Content-free split-prompt guidance; no bypass | `prompt_too_large` |
| Detector exception | Stop attempt | Content-free retry guidance | `detector_failure` |
| Policy validation/evaluation exception | Stop attempt | Content-free retry guidance | `policy_failure` |
| Invalid settings storage | Use safe defaults and continue evaluation | Settings can be repaired | Privacy-safe storage/health signal if possible |
| Audit write failure after resolved decision | Preserve resolved enforcement/submission behavior | Non-sensitive status can indicate audit unavailable | No recursive write attempt |
| Known selector failure during attempt | Stop captured attempt | Retry/reload guidance | Coalesced adapter health event |
| Entirely unknown DOM variant | Interception cannot be guaranteed | Popup reports protection unconfirmed | Adapter degraded if detectable |
| UI render failure | Stop attempt | Minimal content-free DOM fallback with retry/reload guidance | `ui_failure` |
| Extension context invalidation | Keep captured attempt stopped | Minimal content-free reload-extension/page guidance | Persist only if context permits |
| Resume operation failure | Do not retry automatically | Restore idle state and show retry guidance | Content-free enforcement error |

An enforcement decision is unresolved when size validation, detection, policy
evaluation, or required warning/block UI cannot complete. Such an attempt is
never silently submitted.

Audit persistence is ancillary after a decision is resolved: a storage failure
must not transform an explicit block into an allow, duplicate a submission, or
permanently prevent a clean prompt. Recoverability comes from retrying,
reloading, repairing settings, or explicitly disabling protection outside the
dialog—not from a send-anyway button on security errors.

## 18. Browser permission and CSP model

The intended production manifest contains:

- `manifest_version: 3`.
- `permissions: ["storage"]`.
- No `host_permissions`, because no extension page or service worker needs
  cross-origin access.
- A static content script match of only `https://chatgpt.com/*`.
- `all_frames: false`.
- `world: "ISOLATED"`.
- No `externally_connectable`.
- No `web_accessible_resources` unless the final build proves a specific local
  asset requires it; any addition requires design review.
- No `tabs`, `activeTab`, `scripting`, `webRequest`, cookies, clipboard, history,
  downloads, notifications, unlimited storage, or `<all_urls>`.

The explicit extension-page Content Security Policy is:

```json
{
  "extension_pages": "script-src 'self'; object-src 'none'; worker-src 'self'"
}
```

There are no inline scripts, `unsafe-inline` script permissions,
`unsafe-eval`, WebAssembly evaluation, sandboxed extension pages, or remote
script sources. HTML entry points reference only bundled local files.

Static content-script matches are used rather than runtime scripting injection,
so the extension does not need `scripting` or a separate host permission.

## 19. Performance requirements

- The prompt is read and analyzed only on an attempted submission.
- The DOM is not continuously scanned for prompt contents.
- Health-only MutationObserver work is debounced and idempotent.
- Prompts up to and including 100,000 UTF-16 code units are supported.
- Prompts over the limit take the explicit rejection path before detectors run.
- Regexes are bounded and designed to avoid catastrophic backtracking.
- No AI model, fuzzy classifier, worker farm, or full benchmarking framework is
  introduced.
- A repeatable performance test measures the complete detector suite with
  ordinary, multi-finding, Unicode/Vietnamese, and exactly-limit inputs using
  `performance.now()`.
- The test reports timing and has a generous regression ceiling suitable for CI;
  the verified number and environment are documented rather than claimed in
  advance.

## 20. Testing strategy

Development follows test-driven development for every behavior:

1. Add a focused failing test.
2. Run it and confirm the expected failure.
3. Implement the minimum behavior.
4. Run the targeted test.
5. Run the relevant suite.
6. Refactor only while green.
7. Commit the coherent task.

### 20.1 Detector tests

- Valid and invalid emails.
- Vietnamese domestic and `+84` phones.
- General international phones and ambiguous digit sequences.
- Valid and invalid card candidates and direct Luhn pass/fail cases.
- Supported and unsupported AWS-like tokens.
- Complete, malformed, and oversized PEM blocks.
- Conservative API-secret positive and negative context cases.
- Protected keywords, Unicode, Vietnamese diacritics, case, and boundaries.
- Empty input, multiple categories, multiple findings, and overlaps.
- Stable IDs/order and exact UTF-16 offsets.
- Redaction placeholders and deterministic overlap union.
- Exactly 100,000-code-unit input.

### 20.2 Policy tests

- No findings allow.
- Warn-only findings.
- Block precedence over redact and warn.
- Redact precedence over warn.
- Redaction of every supported finding.
- Disabled protection.
- Email and phone overrides.
- Complete typed policy overrides at the package boundary.
- Deterministic matched-rule ordering.
- Multiple categories and confidence-specific API-secret behavior.
- Invalid policy configuration.

### 20.3 Oversized-prompt tests

- 100,000 code units invoke detectors normally.
- 100,001 code units invoke no detector.
- The attempt remains stopped.
- The dialog contains only fixed explanatory copy.
- No send-anyway or redact action exists.
- Composer content is unchanged.
- Only a privacy-safe `prompt_too_large` event is constructed and persisted.

### 20.4 Adapter and controller tests

- Both required composer fixture variants.
- Composer location, prompt reading, and prompt replacement for textarea and
  contenteditable implementations.
- Click and Enter interception.
- Shift+Enter, IME composition, modifiers, and Enter outside the composer.
- Approved resubmission passes exactly once without recursion.
- A consumed authorization cannot be reused.
- Modified prompt invalidates approval and triggers new analysis.
- Click/keyboard paths cannot double submit.
- Cancelled and stale/replaced dialogs cannot submit.
- Resume exceptions always clear adapter bypass state.
- Duplicate initialization, SPA element replacement, cleanup, and disposal.
- Missing and changed selectors and coalesced degraded health reports.

### 20.5 Storage and messaging tests

- Valid v1 settings and audit envelopes.
- Missing, invalid, corrupted, and unsupported versions.
- Safe settings fallback never disables protection.
- Invalid configuration saves are rejected.
- Raw prompt, `matchedText`, findings, and arbitrary metadata are rejected.
- `allow` audit events are dropped.
- Warn, redact, block, enforcement error, and adapter-health events persist.
- Repeated identical adapter degraded events are coalesced.
- Retention keeps the newest configured number of records.
- Audit clearing and empty state.
- Invalid sender and malformed message rejection.

### 20.6 UI tests

- The shadow root is open.
- Warning and block categories use `DisplayFinding`.
- UI component APIs cannot accept `SensitiveDataFinding`.
- No raw prompt or matched substring enters UI state.
- Placeholder-only preview.
- Block and error dialogs have no bypass.
- Redact action returns only a typed intent.
- Keyboard accessibility, initial focus, focus containment, Escape/cancel, and
  focus restoration.
- Stale dialog actions are inert.

### 20.7 Integration and manual testing

- A Chromium persistent-context smoke test loads the unpacked production build
  and opens popup, options, and audit pages.
- DOM integration uses local fixture documents; production manifest matching is
  not broadened for tests.
- Manual QA uses the current `chatgpt.com` interface and dedicated test-fixture
  values. Documentation references fixture identifiers rather than duplicating
  secret-like strings.
- Manual results distinguish verified behavior from checks unavailable in the
  environment.

## 21. Production artifact security verification

Completion requires inspection of source **and** the generated extension
directory after a clean production build.

### 21.1 Generated manifest

Parse the generated `manifest.json` and verify:

- Manifest V3.
- Exact permission list.
- Exact content-script matches and top-frame isolated-world settings.
- Explicit CSP.
- No host permissions, optional host permissions, external connectivity,
  unexpected web-accessible resources, sandbox pages, or network permissions.
- Every referenced script, stylesheet, page, worker, and icon exists locally in
  the artifact.

### 21.2 Generated HTML and JavaScript

Verify:

- No inline `<script>` blocks or inline event handlers.
- No remote scripts, styles, fonts, images, or fetchable remote URL literals.
- No `eval`, `new Function`, string-to-code timers, WebAssembly evaluation, or
  dynamic code loading.
- No `fetch`, `XMLHttpRequest`, `WebSocket`, `EventSource`, `sendBeacon`, dynamic
  script insertion, or network client SDK.
- No raw prompt logging or sensitive debug statements.
- No test modules or fixture imports.
- No production `.map` files and no source-map references.

Standards namespace identifiers emitted by a UI runtime, if any, are classified
as non-fetching identifiers during review; they do not permit or initiate
network access. Any other `http://` or `https://` occurrence fails verification.

### 21.3 Dependency and fixture review

Verify:

- The production dependency tree contains no analytics, telemetry, network
  client, remote-code, or dynamic-loader package.
- Lockfile versions are pinned and the dependency tree is reported.
- Secret-like fixture values occur only under dedicated test fixture files.
- Documentation and production code refer to fixture identifiers, not copied
  raw samples.
- Built bundles contain none of the fixture values.

These checks are scripted where deterministic and supplemented by direct
artifact inspection. A source-only scan is insufficient.

## 22. Documentation requirements

Before Milestone 1 completion, provide:

- `README.md` with verified install, lint, typecheck, test, build, and unpacked
  loading commands.
- Architecture overview and component/data-flow boundaries.
- Local development and production build instructions.
- Chrome and Edge unpacked-extension instructions.
- Manual QA checklist for every acceptance scenario.
- Privacy model and data inventory.
- Threat model.
- Known limitations.
- How to add a detector.
- How to add a chatbot adapter.
- Managed deployment considerations clearly marked as future work.

Commands are documented only after they run successfully in the implementation
environment.

## 23. Acceptance criteria

Milestone 1 is acceptable only when:

1. The production build loads as an unpacked Manifest V3 extension in supported
   Chromium.
2. The content script activates only on `https://chatgpt.com/*`.
3. The only required named permission is `storage`.
4. A clean prompt submits without a dialog and without an `allow` audit record.
5. An email produces its configured default warning.
6. A Vietnamese phone number produces its configured default warning.
7. A protected keyword produces a warning.
8. A valid Luhn payment card is blocked.
9. An AWS access key ID is blocked.
10. A complete PEM private key is blocked.
11. A high-confidence contextual API secret is blocked.
12. Warned findings can be redacted with approved placeholders before one
    resumed submission.
13. The warning UI receives only sanitized `DisplayFinding` data and a
    placeholder-only preview.
14. Block and enforcement-error dialogs have no bypass.
15. A 100,001-code-unit prompt is not scanned, is not submitted, shows
    content-free split guidance, and records only a safe error.
16. A 100,000-code-unit prompt remains supported.
17. Shift+Enter inserts a newline and IME composition is not disrupted.
18. Approved resubmission does not recurse or double submit.
19. Modified prompt text invalidates prior approval and is reanalyzed.
20. Consumed authorization cannot be reused.
21. Cancelled or stale dialogs cannot submit.
22. Delayed rendering, SPA replacement, duplicate initialization, and adapter
    cleanup pass automated tests.
23. At least two semantic composer DOM fixtures pass adapter tests.
24. The open Shadow DOM isolates component styling and remains inspectable.
25. Raw prompt text and `matchedText` never enter UI, messages, storage, logs, or
    production artifacts.
26. Settings and audit data use validated `schemaVersion: 1` envelopes.
27. Invalid or unsupported stored settings fall back to protection-enabled safe
    defaults.
28. Audit retention is enforced and clear-history works.
29. Popup, options, and audit pages meet their functional and empty-state
    requirements.
30. All automated tests, type checking, linting, and the production build pass.
31. Detector performance is measured and reported for the defined cases.
32. Generated manifest, HTML, JavaScript, dependencies, source-map absence, and
    fixture isolation pass the production artifact security review.
33. No remote network calls are made by extension code.
34. Manual QA results and any unavailable checks are explicitly distinguished.
35. Documentation contains reproducible commands that were actually verified.

## 24. Required completion verification

Before claiming implementation completion, run and report summarized results for:

```bash
pnpm install
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Also run the production artifact checks in Section 21, inspect the final
manifest directly, inspect Git status, and perform the documented manual browser
test when the environment supports it. A behavior is not claimed as verified
unless the corresponding check ran.

## 25. Known limitations

- ChatGPT can change its DOM or submission behavior without notice.
- Unknown programmatic submission mechanisms may bypass DOM interception.
- The extension does not inspect attachments, files, images, prior messages, or
  generated responses.
- Deterministic detectors have false positives and false negatives.
- Generic international phone matching is inherently ambiguous.
- Open Shadow DOM and an isolated execution world do not prevent host-page DOM
  disruption.
- Local storage is visible to the browser profile owner and local debugging
  tools.
- Users can disable or uninstall an unmanaged extension.
- Protection applies only to the supported Chromium web origin and UI variants.

## 26. Future extension points

Future work may add:

- Independent Claude, Gemini, and Copilot implementations of
  `ChatApplicationAdapter`.
- Additional deterministic detectors through the common detector contract.
- Explicit opt-in `allow` audit configuration using the existing event shape.
- Managed policy sources and enterprise-enforced settings.
- Signed policy updates, central audit export, SIEM integration, and retention
  policy administration.
- SSO, SCIM, organization accounts, managed deployment, and health dashboards.
- Version 2 storage envelopes with a direct, explicit v1-to-v2 migration.

None of these extension points requires implementation in Milestone 1.
