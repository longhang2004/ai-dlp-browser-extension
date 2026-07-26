# Milestone 1 AI DLP Extension — Detailed TDD Implementation Plan

## 1. Summary and locked decisions

Implement the approved privacy-first Chromium MV3 vertical slice in a pnpm
workspace, supporting ChatGPT only. Detection, policy, and redaction remain
browser-independent; raw prompt access is tightly scoped; storage and runtime
messages remain prompt-free.

Locked choices:

- Node `>=22.13.0 <23`; pnpm `10.13.1`.
- Strict TypeScript `6.0.3`.
- Vite `8.1.5` with separate page/service-worker and self-contained IIFE
  content-script builds.
- React `19.2.8` only for popup, options, audit, and Shadow DOM dialogs.
- Vitest `4.1.10`, jsdom, Testing Library, and Playwright `1.62.0`.
- Hand-written strict validators; no runtime schema library.
- `chrome.storage.local` restricted to `TRUSTED_CONTEXTS`; manifest minimum
  Chrome version `102`.
- Content scripts receive settings through a validated
  `runtime.connect({name: "settings-v1"})` port. A
  disconnected/uninitialized port means truthful `initializing`/`unavailable`
  status and no interception.
- Production content script: static `https://chatgpt.com/*`, top frame,
  `document_idle`, `ISOLATED`; no `tabs`, `scripting`, host-permission, or
  web-accessible-resource entries.
- Local feature branch `feat/milestone-1`; do not push without separate
  authorization.

Documentation baselines:

- [Chrome content-script manifest fields](https://developer.chrome.com/docs/extensions/reference/manifest/content-scripts)
- [Chrome storage and access levels](https://developer.chrome.com/docs/extensions/reference/api/storage)
- [Chrome one-time and long-lived messaging](https://developer.chrome.com/docs/extensions/develop/concepts/messaging)
- [MV3 service-worker lifecycle](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle)
- [MV3 Content Security Policy](https://developer.chrome.com/docs/extensions/reference/manifest/content-security-policy)
- [Vite production builds](https://vite.dev/guide/build)
- [Vitest projects](https://vitest.dev/guide/projects.html)
- [Playwright extension testing](https://playwright.dev/docs/chrome-extensions)
- [React `createRoot`](https://react.dev/reference/react-dom/client/createRoot)

## 2. Documentation gate and public contracts

### Phase 0 — Finalize the specification and materialize this plan

Files:

- Modify
  `docs/superpowers/specs/2026-07-26-ai-dlp-browser-extension-design.md`.
- Create
  `docs/superpowers/plans/2026-07-26-ai-dlp-browser-extension.md`.

Specification edits:

- Replace raw-prompt ownership text with the approved adapter/controller
  wording.
- Add adapter tests for field-free prompt handling, content-free health/errors,
  disposal, and selector/resume failures.
- Replace artifact acceptance criterion 34 with the approved runtime-value
  wording.
- Replace unconditional URL-literal failure with reviewed
  classification/allowlisting.
- Require the artifact report to include literal, generated file, surrounding
  snippet/classification, fetching/executable versus inert state, and
  justification.
- Mark the specification `Approved for implementation planning`.

Verification:

```bash
git diff --check
rg -n "Raw prompt text may be accessed transiently" docs/superpowers/specs
rg -n "Every non-standard remote URL literal must be reviewed" docs/superpowers/specs
rg -n "Any other .* occurrence fails" docs/superpowers/specs
find docs/superpowers -type f -print
```

Expected result: new approved wording exists, stale unconditional wording is
absent, and only documentation changed.

Commits:

1. `docs: finalize prompt ownership and artifact review`
2. `docs: add AI DLP implementation plan`

### Shared public contracts

Create under `packages/shared-types/src/`:

- `findings.ts`: sensitive categories, confidence, `SensitiveDataFinding`,
  placeholders.
- `policy.ts`: `PolicyFinding`, exact v1 `PolicyConfiguration`, `PolicyInput`,
  three-field `PolicyDecision`.
- `redaction.ts`: `RedactionResult`.
- `settings.ts`: settings/envelope/defaults.
- `audit.ts`: decision resolutions, decision/error/health events, audit
  envelope.
- `display.ts`: `DisplayFinding`, dialog models/intents.
- `messages.ts`: closed one-time and settings-port message unions.
- `status.ts`: `initializing | waiting_for_composer | active | disabled |
  degraded | unavailable`.
- `validators.ts`: strict allowlisted validation helpers.
- `index.ts`: intentional platform-independent exports only.

Browser-specific types stay in
`apps/extension/src/adapters/chat-application-adapter.ts`:

- `CapturedSubmitAttempt`
- `LiveSubmissionContext`
- `ConsumedSubmissionAuthorization`
- `SubmitInterceptionDisposition`
- `ChatApplicationAdapter`

No DOM, `URL`, Chrome API, event, prompt, matched text, offsets, or sanitized
prompt enters shared policy input/output.

## 3. TDD implementation phases

Every behavior task follows: add the focused failing test, run it and confirm
the expected failure, implement minimally, rerun the target, run the relevant
suite, refactor green, then commit.

### Phase 1 — Workspace and deterministic toolchain

Files:

- Root: `package.json`, `pnpm-workspace.yaml`, `pnpm-lock.yaml`,
  `tsconfig.base.json`, `tsconfig.json`, `vitest.config.ts`,
  `playwright.config.ts`, `eslint.config.mjs`, `.prettierrc.json`,
  `.prettierignore`, `.gitignore`.
- Workspace manifests and strict `tsconfig.json` files under
  `packages/shared-types`, `packages/detectors`, `packages/policy-engine`, and
  `apps/extension`.
- `tests/setup-dom.ts`.

Pin exact dependencies:

- TypeScript `6.0.3`, Vite `8.1.5`, React plugin `6.0.4`.
- React/React DOM `19.2.8`.
- Vitest/coverage `4.1.10`, jsdom `29.1.1`.
- Testing Library React `16.3.2`, user-event `14.6.1`, jest-dom `7.0.0`.
- Playwright `1.62.0`.
- ESLint `10.8.0`, `@eslint/js` `10.0.1`, typescript-eslint `8.65.0`, React
  Hooks plugin `7.1.1`, eslint-config-prettier `10.1.8`.
- Prettier `3.9.6`, Chrome types `0.2.2`, Node types `22.15.34`.

Root scripts:

- `format`, `format:check`, `lint`, `typecheck`
- `test:unit`, `test:browser`, `test:performance`, `test`
- `build`, `verify:artifact`

Verification:

```bash
pnpm install
pnpm format:check
pnpm lint
pnpm typecheck
```

Expected initial failure: workspace/config files or scripts are missing.
Passing state: clean install, exact versions in manifests/lockfile, strict
typecheck and empty-suite lint succeed.

Commit: `chore: scaffold pnpm extension workspace`

### Phase 2 — Privacy-safe contracts and validators

Tests/files:

- `packages/shared-types/src/policy-boundary.test-d.ts`
- `packages/shared-types/src/validators.test.ts`

Red tests:

- `@ts-expect-error` cases for prompt, `matchedText`, `redactedText`, offsets,
  sanitized text, returned findings, DOM, and `URL`.
- Runtime rejection of missing/unknown keys and invalid settings/audit/message
  envelopes.

Commands:

```bash
pnpm --filter @ai-dlp/shared-types typecheck
pnpm exec vitest run packages/shared-types/src/validators.test.ts
```

Expected failure: missing exports and validators. Passing state: only approved
fields compile and maliciously cast runtime objects fail strict validation.

Commit: `feat: define privacy-safe shared contracts`

### Phase 3 — Metadata-only policy engine

Files:

- `packages/policy-engine/src/validate-policy.ts`
- `packages/policy-engine/src/evaluate-policy.ts`
- `packages/policy-engine/src/index.ts`
- Corresponding `.test.ts` files.
- `apps/extension/src/content/derive-policy.ts`
- `apps/extension/src/content/derive-policy.node.test.ts`

Tests:

- No findings allow.
- Deterministic `block > redact > warn > allow`.
- Exact rule-ID ordering.
- Email/phone overrides.
- Fixed card/AWS/private-key blocks and protected-keyword warning.
- API secret high block, medium warn, low rejected.
- Missing, unknown, invalid, or weakened fixed actions rejected.
- Exact decision keys: `action`, `matchedRuleIds`, `reasonCode`.
- Forbidden prompt/finding fields rejected before evaluation.
- Derived policy matches the approved settings mapping exactly.

Commands:

```bash
pnpm exec vitest run packages/policy-engine/src
pnpm exec vitest run apps/extension/src/content/derive-policy.node.test.ts
pnpm --filter @ai-dlp/policy-engine typecheck
```

Commit: `feat: implement strict metadata-only policy evaluation`

### Phase 4 — Contact and payment detectors

Files under `packages/detectors/src/`:

- `finding.ts`, `priority.ts`
- `detectors/email.ts`
- `detectors/phone.ts`
- `detectors/luhn.ts`
- `detectors/payment-card.ts`
- Matching `.test.ts` files.
- `tests/fixtures/sensitive-values.json`

Tests cover valid/invalid email, Unicode/Vietnamese text, Vietnamese and
international phones, ambiguous digit sequences, card separator rules, 13–19
digits, and Luhn pass/fail.

Commands:

```bash
pnpm exec vitest run packages/detectors/src/detectors/email.test.ts
pnpm exec vitest run packages/detectors/src/detectors/phone.test.ts
pnpm exec vitest run packages/detectors/src/detectors/payment-card.test.ts
```

Commits:

1. `feat: detect email and phone data`
2. `feat: detect Luhn-valid payment cards`

### Phase 5 — Key, secret, and keyword detectors

Files:

- `detectors/aws-access-key.ts`
- `detectors/private-key.ts`
- `detectors/api-secret.ts`
- `detectors/protected-keyword.ts`
- Matching tests.

Tests cover:

- Exact `AKIA`/`ASIA` structures and boundaries.
- Complete/malformed/mismatched/bounded PEM keys.
- Contextual secret names, delimiters, value bounds, known prefixes,
  mixed-class confidence, and conservative negatives.
- Unicode-aware protected-keyword boundaries, casing, Vietnamese diacritics,
  multiword values, and deduplication.

Commands:

```bash
pnpm exec vitest run packages/detectors/src/detectors/aws-access-key.test.ts
pnpm exec vitest run packages/detectors/src/detectors/private-key.test.ts
pnpm exec vitest run packages/detectors/src/detectors/api-secret.test.ts
pnpm exec vitest run packages/detectors/src/detectors/protected-keyword.test.ts
```

Commits:

1. `feat: detect keys and contextual secrets`
2. `feat: detect protected keywords`

### Phase 6 — Detection orchestration and redaction

Files:

- `packages/detectors/src/analyze.ts`
- `packages/detectors/src/redact.ts`
- `packages/detectors/src/index.ts`
- `analyze.test.ts`, `redact.test.ts`

Tests:

- Empty and multiple findings.
- Stable IDs and ordering.
- Exactly 100,000 UTF-16 code units.
- Invalid range rejection.
- Overlap union, fixed category priority, reverse replacement.
- Exact `sanitizedText` and `appliedFindings`.

Commands:

```bash
pnpm exec vitest run packages/detectors/src/analyze.test.ts
pnpm exec vitest run packages/detectors/src/redact.test.ts
pnpm --filter @ai-dlp/detectors typecheck
```

Commit: `feat: orchestrate detection and deterministic redaction`

### Phase 7 — Trusted storage and prompt-free messaging

Storage files:

- `apps/extension/src/storage/storage-port.ts`
- `chrome-storage.ts`
- `settings-store.ts`
- `audit-store.ts`
- Matching `.node.test.ts` files.

Messaging/background files:

- `apps/extension/src/messaging/schemas.ts`
- `src/background/sender-validation.ts`
- `src/background/settings-ports.ts`
- `src/background/message-router.ts`
- `src/background/bootstrap.ts`
- Matching tests.

Behavior:

- At background startup, create one `storageReady` promise calling
  `chrome.storage.local.setAccessLevel({accessLevel: "TRUSTED_CONTEXTS"})`.
- Register `onMessage` and `onConnect` synchronously at module top level.
- One-time listener uses `sendResponse` and returns literal `true`; it is not
  `async`.
- Content settings port is named `settings-v1`; worker validates sender ID, top
  frame, origin, and URL, then immediately sends the current v1 settings
  snapshot.
- Settings saves broadcast validated snapshots to connected content ports.
- Content scripts never call storage directly.
- Extension pages may read/save only through validated messages.
- Worker durable state always comes from storage, never globals.

Tests cover envelope fallback, retention, clear, dropping allow events, audit
resolution mappings, health coalescing, sensitive-field rejection, sender
matrices, invalid ports/messages, and worker restart-safe reconstruction.

Commands:

```bash
pnpm exec vitest run apps/extension/src/storage
pnpm exec vitest run apps/extension/src/background
pnpm --filter @ai-dlp/extension typecheck
```

Commits:

1. `feat: add versioned trusted local storage`
2. `feat: add prompt-free extension messaging`

### Phase 8 — Semantic ChatGPT adapter

Files:

- `apps/extension/src/adapters/chat-application-adapter.ts`
- `src/adapters/chatgpt/selectors.ts`
- `context-resolver.ts`
- `chatgpt-adapter.ts`
- `fixtures.ts`
- Corresponding `.dom.test.ts` files.

Implement selector order from the specification: native form/textarea
semantics, contenteditable textbox, form relationships, ARIA, then stable data
attributes. Do not use generated classes.

Tests:

- Native textarea/form and contenteditable variants.
- Visibility, editability, connection, and send-control association.
- Reading/replacing prompt text.
- Dynamic composer/send replacement and context-version increments.
- Click and Enter capture; Shift+Enter, modifiers, and IME pass-through.
- One synchronous resume guard with `finally` cleanup.
- Duplicate initialization and disposal.

Prompt-ownership tests:

- Adapter own fields contain no prompt value after `readPrompt`/`replacePrompt`.
- Health/error payloads contain only fixed codes.
- Selector/resume errors exclude composer content.
- Disposal leaves no prompt-bearing adapter state.
- Adapter receives no `SensitiveDataFinding`.

Commands:

```bash
pnpm exec vitest run apps/extension/src/adapters/chatgpt
pnpm --filter @ai-dlp/extension typecheck
```

Commits:

1. `feat: resolve supported ChatGPT composer variants`
2. `feat: implement prompt-ephemeral ChatGPT interception`

### Phase 9 — Accessible open-Shadow protection UI

Files:

- `apps/extension/src/ui/protection-dialog/ProtectionDialog.tsx`
- `dialog-controller.ts`
- `protection-dialog.css`
- `ProtectionDialog.ui.test.tsx`
- `dialog-controller.dom.test.ts`

Behavior:

- Create host and `host.attachShadow({mode: "open"})`.
- Mount once with React `createRoot`; call `root.unmount()` before removing the
  host.
- Accept only sanitized models.
- Warning: Cancel, Send anyway, and conditional Redact.
- Block/error: no bypass.
- Fixed placeholder-only preview.
- Focus containment, initial focus, Escape cancellation, restoration,
  stale-generation invalidation.
- Content-free non-React fallback if React rendering fails.

Commands:

```bash
pnpm exec vitest run apps/extension/src/ui/protection-dialog
pnpm exec vitest run --project dom
```

Commit: `feat: add accessible protection dialogs`

### Phase 10 — Submission controller state machine

Files:

- `apps/extension/src/content/authorization.ts`
- `display-model.ts`
- `submission-controller.ts`
- Matching `.node.test.ts` and `.dom.test.ts` files.

Implement:

- `MAX_PROMPT_CODE_UNITS = 100_000`.
- States: idle, evaluating, dialog, resuming, cancelled, completed.
- Controller-private prompt snapshot and five-minute monotonic authorization.
- Explicit `toPolicyFinding`; never spread the sensitive finding.
- Exact display/audit construction.
- Re-resolve URL, context version, composer, text, and send control before
  authorization consumption.
- Redaction re-resolves again after replacement.
- One decision event per attempt.
- Explicit error paths for detector, policy, UI, context, and resume failures.

Tests cover all allow/warn/redact/block outcomes, oversized behavior, audit
mappings, no allow persistence, recursive/double submission, modified prompts,
expired/reused tokens, cancelled/stale dialogs, SPA/composer replacement, newly
resolved send controls, and failure behavior.

Commands:

```bash
pnpm exec vitest run apps/extension/src/content/submission-controller.node.test.ts
pnpm exec vitest run apps/extension/src/content/submission-controller.dom.test.ts
```

Commit: `feat: orchestrate local submission enforcement`

### Phase 11 — Settings bootstrap and truthful status

Files:

- `apps/extension/src/content/settings-cache.ts`
- `bootstrap.ts`
- `settings-cache.node.test.ts`
- `bootstrap.dom.test.ts`

Behavior:

- Connect to `settings-v1`.
- Stay `initializing` until the first validated snapshot.
- Register interception only after initialization.
- Disabled settings return `pass_through` without `preventDefault` or
  downstream calls.
- On port disconnect, dispose interception and report `unavailable`; reconnect
  and require a fresh snapshot before activation.
- Runtime disable cancels active attempts; runtime enable reuses idempotent
  setup.

Commands:

```bash
pnpm exec vitest run apps/extension/src/content/settings-cache.node.test.ts
pnpm exec vitest run apps/extension/src/content/bootstrap.dom.test.ts
```

Commit: `feat: initialize protection with validated settings`

### Phase 12 — Popup, options, audit pages, manifest, and build

Files:

- `apps/extension/popup.html`, `options.html`, `audit.html`
- Page-specific
  `src/{popup,options,audit}/{App.tsx,main.tsx,App.ui.test.tsx}`
- `src/ui/page.css`
- `public/manifest.json`
- `vite.pages.config.ts`
- `vite.content.config.ts`

Manifest:

- MV3, minimum Chrome `102`, permission only `storage`.
- Module service worker `background.js`.
- Static `content-script.js` on `https://chatgpt.com/*`, top frame,
  `document_idle`, `ISOLATED`.
- Popup and full-tab `options_page`.
- No host permissions, external connectivity, sandbox, or web-accessible
  resources.
- Strong local-only CSP including `script-src 'self'`, `object-src 'none'`,
  `worker-src 'self'`, and `connect-src 'none'`.

Build:

- Pages/service-worker pass: Vite multi-page ESM, stable `background.js`, hashed
  local page assets.
- Content pass: Vite library IIFE, `content-script.js`, code splitting
  disabled.
- Pages build empties `apps/extension/dist`; content build appends.
- Source maps disabled.

Tests assert page states/actions and generated manifest/build topology.

Commands:

```bash
pnpm exec vitest run apps/extension/src/popup apps/extension/src/options apps/extension/src/audit
pnpm build
find apps/extension/dist -type f -print
```

Expected passing artifact: stable manifest paths, one self-contained content
script with no imports, local-only worker/page imports, and no `.map` files.

Commit: `feat: build Manifest V3 extension pages`

### Phase 13 — Browser integration, performance, and artifact security

Files:

- `tests/e2e/fixtures.ts`
- `tests/e2e/extension-smoke.spec.ts`
- `tests/performance/detectors.performance.test.ts`
- `scripts/verify-production-artifact.mjs`
- `scripts/artifact-url-allowlist.json`
- Gitignored `artifacts/verification/url-report.json`

Playwright:

- Load `apps/extension/dist` using `chromium.launchPersistentContext`.
- Use bundled `channel: "chromium"`, one worker, isolated temporary profiles.
- Discover extension ID from the MV3 service worker.
- Route `https://chatgpt.com/*` to local fixture HTML, testing the actual
  production match without broadening the manifest or making a remote request.
- Cover clean allow, email/Vietnamese-phone warnings, card/AWS/PEM blocks,
  redaction, Shift+Enter, one-shot bypass, settings pages, audit retention, and
  initialization/disabled states.

Performance:

- Warm up detectors three times.
- Report ten measurements for ordinary, multi-finding, Unicode/Vietnamese, and
  exactly-100,000-code-unit prompts.
- Assert each exactly-limit run remains below a generous 1,000 ms CI ceiling.

Artifact verifier:

- Parse the generated manifest and referenced files.
- Reject inline scripts/handlers, source maps, test imports, dynamic imports in
  the worker/content script, code execution strings, network APIs, remote
  assets, and fixture values.
- Read every dedicated secret value from
  `tests/fixtures/sensitive-values.json` and prove it is absent from `dist`.
- Report every URL literal with file, ±160-character context, classification,
  executable/fetching versus inert status, and justification.
- Automatically classify only standard namespace identifiers as inert.
- Require exact committed allowlist entries for non-standard inert
  documentation/error URLs.
- Fail unreviewed, unused-allowlist, fetching, executable, telemetry, SDK,
  asset, or request URLs.
- Permit detector implementation identifiers while proving they contain no
  fixture/runtime values.

Commands:

```bash
pnpm exec playwright install chromium
pnpm test:browser
pnpm test:performance
pnpm verify:artifact
```

Commits:

1. `test: add extension integration and performance coverage`
2. `build: verify production artifact security`

### Phase 14 — Documentation and manual QA

Files:

- `README.md`
- `docs/architecture/overview.md`
- `docs/manual-qa.md`
- `docs/privacy.md`
- `docs/threat-model.md`
- `docs/extension-guides/add-detector.md`
- `docs/extension-guides/add-adapter.md`
- `docs/managed-deployment.md`

Document only commands and results actually verified. Manual QA references
fixture IDs rather than secret values and distinguishes successful, failed, and
unavailable live checks.

Commit: `docs: add verified extension operation and security guides`

## 4. Final verification and delivery

Run in this order:

```bash
pnpm install --frozen-lockfile
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm test:browser
pnpm test:performance
pnpm build
pnpm verify:artifact
pnpm --filter @ai-dlp/extension list --prod --depth Infinity --json
git diff --check
git status --short --branch
```

Then:

- Inspect `apps/extension/dist/manifest.json` directly.
- Confirm the only external production dependencies are React, React DOM, and
  the dependency-free workspace packages.
- Review every artifact URL classification and justification.
- Confirm no source map or fixture value exists in the build.
- Load `apps/extension/dist` unpacked in Chromium.
- Run current `chatgpt.com` manual QA when authenticated browser access exists.
- Report exact automated results and clearly label unavailable manual checks.
- Perform file-by-file self-review before the final handoff.
- Keep every coherent TDD commit; do not squash or rewrite prior history.
- Do not push the feature branch without explicit authorization.

## 5. Assumptions and anti-pattern guards

- The brief initialization pass-through interval remains intentional and
  truthfully reported.
- A disconnected settings port disables interception until a fresh validated
  snapshot arrives.
- React receives only sanitized models; adapter prompt access is synchronous
  and call-scoped.
- No remote API, backend, telemetry, analytics, file inspection, non-ChatGPT
  adapter, enterprise management, or generalized rule language is introduced.
- Avoid Vite 7 `rollupOptions`; Vite 8 uses `build.rolldownOptions`.
- Avoid deprecated Vitest workspace files, experimental typechecking as the
  sole type gate, `ReactDOM.render`, async `runtime.onMessage` listeners,
  dynamic worker imports, page-world scripts, broad permissions, runtime
  DOM-class selectors, `innerHTML`, `eval`, `new Function`, and remote assets.

## 6. PR #1 security-review remediation addendum

Implemented on 2026-07-26 as focused regression-tested commits:

- Strict Send resolution removes generic no-type buttons and prioritizes
  composer-associated stable data, accessible Send labels, and native submit
  controls.
- Production-shaped `#prompt-textarea[contenteditable]` resolution and
  strong-candidate fail-closed interception cover Enter, Shift+Enter, IME, and
  click behavior.
- `inspectSubmissionCapabilities` detects only composer-scoped attachment
  presence. The controller checks it at capture and immediately before resume;
  `unsupported_attachment` has no bypass and no file metadata.
- Prompt replacement has an explicit capability/result. Native textarea
  replacement is verified; contenteditable/ProseMirror replacement is
  unsupported, warning redaction is hidden, and automatic redaction fails
  closed with `redaction_unavailable`. The settings UI no longer offers
  automatic redact.
- Disabled settings create no protection runtime and fully dispose the current
  adapter, controller, dialog, listeners, observer, timer, attempt, and
  authorization when protection is turned off.
- Health uses `initializing → waiting_for_composer → active`, a fake-timer
  grace period, immediate degradation for strong unresolved candidates, and
  coalesced degraded auditing.
- `.github/workflows/ci.yml` pins actions by commit SHA, uses the locked
  Node/pnpm versions and dependency cache, deletes old build output, runs the
  complete source/build/artifact/browser gate, uploads the extension only after
  success, and uploads only failure traces/screenshots/error context.

Live authenticated ChatGPT verification remains a manual QA gate. Automated
fixtures prove the documented DOM variants but are not a claim that the current
live site was inspected.
