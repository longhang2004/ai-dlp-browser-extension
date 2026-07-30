# Milestone 2 implementation plan

This plan begins only after approval of the surface, exact origin, permission
model, capability claims, and pull-request decomposition. Every task follows
red-green-refactor: add the named failing test, record the focused failure,
implement only the minimum behavior, make the focused test green, then run the
broader regression. Several adapters are never combined in one pull request.

## Shared verification baseline

Every pull request finishes with:

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm test:performance
pnpm build
pnpm verify:artifact
pnpm artifact:digest
pnpm test:e2e
```

Any global formatter failure limited to the seven existing
`.superpowers/sdd/pasted-text.txt/` files is recorded rather than repaired in an
unrelated pull request. Changed files must pass a targeted Prettier check and
`git diff --check`.

## PR M2.0 — Multi-surface contracts, ChatGPT-only runtime

No origin or permission changes. ChatGPT behavior and generated topology remain
functionally identical.

### Task M2.0.1 — Closed identities and descriptor boundary

1. **Files:** add `packages/shared-types/src/surfaces.ts`; modify
   `packages/shared-types/src/{status,messages,policy,validators,index}.ts` and
   `apps/extension/src/adapters/chat-application-adapter.ts`.
2. **Test first:** modify `packages/shared-types/src/validators.test.ts`,
   `packages/shared-types/src/policy-boundary.test-d.ts`, and
   `apps/extension/src/adapters/chat-application-adapter.test-d.ts`.
3. **Expected failure:** closed IDs/descriptors do not exist, ChatGPT-only
   literals still type-check, and mismatched origin/trust/capability
   combinations are not expressible or rejected.
4. **Focused RED:**
   `pnpm exec vitest run --project unit packages/shared-types/src/validators.test.ts`
   and `pnpm typecheck`.
5. **Minimal implementation:** add the exact unions and frozen descriptor shape,
   replace the adapter's `id`/`version` with one descriptor, move generic health
   types beside the shared adapter contract, and validate exact descriptor keys
   and correlations. Treat `AdapterId` as a reserved target-design union but
   authorize only executable catalog entries; M2.0 contains ChatGPT only. Keep
   the packaged ChatGPT capabilities unchanged.
6. **Focused GREEN:** rerun the focused Vitest command and `pnpm typecheck`.
7. **Broader regression:** `pnpm test`.
8. **Documentation:** update the contract examples only if implementation naming
   differs without weakening the approved semantics.
9. **Manual QA:** none yet; this task has no generated origin or UI change.
10. **Suggested commit:** `test: define multi-surface contract boundaries`, then
    `feat: generalize promptguard surface contracts` after RED evidence.
11. **Approval boundary:** descriptor identity/capability semantics only; no new
    host or adapter.

### Task M2.0.2 — Catalog, registry, sender correlation, and truthful UI

1. **Files:** add
   `apps/extension/src/adapters/{adapter-catalog,adapter-registry}.ts` and their
   node tests; modify
   `apps/extension/src/content/{bootstrap,submission-controller}.ts`,
   `apps/extension/src/background/{sender-validation,settings-ports,message-router}.ts`,
   and `apps/extension/src/popup/App.tsx`.
2. **Test first:** add
   `apps/extension/src/adapters/{adapter-catalog,adapter-registry}.node.test.ts`;
   modify `apps/extension/src/content/bootstrap.dom.test.ts`,
   `apps/extension/src/background/{sender-validation,settings-ports,message-router}.node.test.ts`,
   and `apps/extension/src/popup/App.ui.test.tsx`.
3. **Expected failure:** duplicate origins and mismatched claims are not catalog
   errors, bootstrap constructs ChatGPT directly, and UI/background cannot
   render or validate the generalized identity/status model.
4. **Focused RED:**
   `pnpm exec vitest run --project node apps/extension/src/adapters apps/extension/src/background --project dom apps/extension/src/content/bootstrap.dom.test.ts apps/extension/src/popup/App.ui.test.tsx`.
5. **Minimal implementation:** bind ChatGPT through an immutable catalog and
   one-adapter registry, centralize sender correlation, derive runtime/status
   identity from the validated descriptor, and render prompt-free generalized
   status without changing the persisted settings or audit envelope. Popup names
   ChatGPT only from a valid port. Sender validation derives origin from
   required `sender.url`, requires `sender.frameId === 0` and
   `sender.id === chrome.runtime.id`, and compares optional `sender.origin` only
   when present. Missing or malformed required fields fail closed; absent
   optional origin alone does not. Add the first-executable
   `location.origin === "https://chatgpt.com"` guard before bootstrap. Disposal
   is idempotent.
6. **Focused GREEN:** rerun the focused Vitest command and `pnpm typecheck`.
7. **Broader regression:** the shared verification baseline, including the
   unchanged 12-file artifact topology and ChatGPT E2E.
8. **Documentation:** record stale-content-port rejection and ChatGPT backward
   compatibility.
9. **Manual QA:** ChatGPT-only regression for click/Enter, attachment policy,
   health, popup/options/audit, and prompt-free evidence. Include
   `https://chatgpt.com:8443/` negative coverage proving no adapter
   construction, interception, composer read, accepted port, status, or audit.
10. **Suggested commit:** `refactor: bind chatgpt through the adapter registry`.
11. **Approval boundary:** generated artifact, permissions, and observable
    ChatGPT enforcement remain unchanged.

## PR M2.1 — Surface activation and permission infrastructure

This PR introduces the settings/audit envelopes and makes the future permission
model testable without asking users for access to a feature that does not exist.
It adds no manifest permission, no real permission request, no Claude
activation, and no executable Claude code.

### Task M2.1.1 — Settings V3 and audit V4 infrastructure

1. **Files:** modify
   `apps/extension/src/storage/{settings-store,audit-store}.ts`, shared
   settings/audit/validator files, controller audit construction, background
   settings ports, and the options/audit views.
2. **Test first:** modify
   `apps/extension/src/storage/settings-store.node.test.ts` and
   `apps/extension/src/storage/audit-store.node.test.ts`, plus the options/audit
   UI tests, before changing either envelope, migration, or consumer.
3. **Expected failure:** V2 cannot create exact ChatGPT-enabled/Claude-disabled
   surface entries, and V3 events cannot become catalog-correlated V4 records.
4. **Focused RED:**
   `pnpm exec vitest run --project node apps/extension/src/storage/settings-store.node.test.ts apps/extension/src/storage/audit-store.node.test.ts --project dom apps/extension/src/options/App.ui.test.tsx apps/extension/src/audit/App.ui.test.tsx`.
5. **Minimal implementation:** add Settings V3 with one entry per configurable
   packaged surface and Audit V4 with catalog-derived `surfaceId`, `adapterId`,
   and version. Migrate valid V2 settings while preserving global policy values;
   migrate provable ChatGPT V3 audit events losslessly; reject duplicates,
   unknown IDs/keys, and unprovable identity. Never persist permission state.
   Derive new audit identity from the validated catalog descriptor and update
   the options/audit consumers only for the closed V3/V4 envelopes.
6. **Focused GREEN:** rerun the focused node/DOM tests and `pnpm typecheck`.
7. **Broader regression:** `pnpm test` with unchanged ChatGPT behavior and
   permissions.
8. **Documentation:** record final envelope examples, conservative-discard
   behavior, and the disabled reserved Claude setting.
9. **Manual QA:** upgrade an existing local ChatGPT profile copy, confirm policy
   values and history, and record no storage dump or prompt-derived content.
10. **Suggested commit:** `test: define explicit surface storage migrations`,
    then `feat: add explicit surface settings and audit infrastructure` after
    RED evidence.
11. **Approval boundary:** storage identity and compatibility only; the disabled
    Claude setting is not an activation control and adds no permission, request,
    script, or protection claim.

### Task M2.1.2 — Closed permission API and state derivation

1. **Files:** add the background permission abstraction and tests; modify shared
   types/validators and options/popup view-model code only as needed for the
   closed future state.
2. **Test first:** add mocked tests for request, contains, remove, added/removed
   events, permission combinations, and closed view models.
3. **Expected failure:** optional named and host permissions cannot be modeled
   together, fixed missing-permission reasons do not exist, and permission
   events cannot trigger deterministic reconciliation.
4. **Focused RED:** run the focused background node and options/popup DOM
   suites.
5. **Minimal implementation:** define `ClaudeEffectivePermission`, the closed
   `PermissionHealthCode` union, all four host/`scripting` outcomes, and mocked
   API wrappers. Reject arbitrary permission arrays and unknown named
   permissions. Add dependency-aware `isScriptingStillRequired(surfaces)`,
   derived only from immutable catalog metadata, validated settings, and live
   effective permissions. Either optional-permission change invalidates runtime
   generation before asynchronous disposal/unregistration and reconciles
   registrations.
6. **Focused GREEN:** rerun focused tests and `pnpm typecheck`.
7. **Broader regression:** `pnpm test`; prove ChatGPT works without `scripting`.
8. **Documentation:** record the future optional-host/named-permission model and
   prompt-free reason codes.
9. **Manual QA:** no real permission QA; inspect the inert view model only.
10. **Suggested commit:** `test: specify optional surface permission states`,
    then `feat: add surface permission infrastructure`.
11. **Approval boundary:** infrastructure only. The manifest remains unchanged;
    no `permissions.request()` call or working Claude action exists.

### Task M2.1.3 — Future-shape UI and artifact rules

1. **Files:** modify options/popup view models and artifact-rule tests without
   modifying the manifest or adding a Claude entry/bundle.
2. **Test first:** require a disabled reserved Claude setting, inert
   presentation, and rejection of every actual Claude optional permission or
   executable edge in an M2.1 artifact.
3. **Expected failure:** current models cannot represent the reserved surface
   and artifact tests do not encode the future approved permission shape.
4. **Focused RED:** run focused options/popup DOM and artifact-rule node tests.
5. **Minimal implementation:** keep normal options UI non-activatable. If a
   preview is rendered, show exactly “Claude support is not installed in this
   release.” with no permission action. Teach future-shape rules that an
   approved later artifact must use optional `scripting` and
   `https://claude.ai:443/*`, while the current artifact must reject both and
   retain the unchanged ChatGPT-only topology.
6. **Focused GREEN:** rerun focused tests, build, and artifact verification.
7. **Broader regression:** shared verification baseline and unchanged artifact
   digest topology expectations.
8. **Documentation:** record that the rules describe M2.2 shape but authorize no
   M2.1 manifest change.
9. **Manual QA:** confirm no grant button, permission prompt, Claude script, or
   protectable-state claim exists.
10. **Suggested commit:** `test: define future optional surface artifact rules`.
11. **Approval boundary:** any M2.1 Claude permission, request call, active UI,
    or executable bundle is a release failure.

## PR M2.2 — Claude verification candidate

Exactly one new application and origin. Submission detection, local prompt read,
attachment-presence detection, and submission resume are all merge/publication
gates. If any one cannot be proved, remove the executable Claude entry before
merge/publication and retain `adapter_unsupported`; do not downgrade a
capability or rebuild a different artifact.

The restricted verification candidate may add `claude` with a proposed
`trust: "verified"` descriptor only to exercise final behavior inside the named
authenticated-QA cohort. That descriptor value is not production acceptance. The
exact artifact's runtime and options copy says “Claude verification candidate”
before and after the gate; neither local state nor a network response can
promote trust or alter that copy. `verified` is an external human/release
acceptance decision bound to the exact SHA and digest. After acceptance, signed
publication and release metadata may say production-accepted/verified, but the
artifact is not rebuilt or substituted and its runtime bits and copy do not
change.

Before M2.2 implementation, a supported-browser/API proof must establish that
`https://claude.ai:443/*` is accepted by the MV3 optional host declaration,
`permissions.request/contains/remove`, and `registerContentScripts`; matches a
default-port page; and does not match an alternate-port fixture. Record the
browser/version, pattern, each API result, and two structural match outcomes—no
page data. A supported-browser rejection must be recorded before explicitly
proposing `https://claude.ai/*` as an exact-host/wildcard-port fallback. Never
fall back silently.

### Task M2.2.1 — Claude context and ownership resolver

1. **Files:** add
   `apps/extension/src/adapters/claude/{selectors,fixtures,context-resolver,context-resolver.dom.test}.ts`.
2. **Test first:** write the resolver DOM tests and two synthetic current
   structural variants before resolver implementation.
3. **Expected failure:** Claude origin, composer, submission region, Send
   ownership, hidden/stale elements, replacement, and ambiguity have no
   resolver.
4. **Focused RED:**
   `pnpm exec vitest run --project dom apps/extension/src/adapters/claude/context-resolver.dom.test.ts`.
5. **Minimal implementation:** Claude-only exact-origin matcher and semantic
   collector returning none/unique/ambiguous; reject any resolver request whose
   serialized origin is not `https://claude.ai`; never import or copy ChatGPT
   selectors or choose by DOM order/priority/ID.
6. **Focused GREEN:** rerun the focused DOM test.
7. **Broader regression:**
   `pnpm exec vitest run --project dom apps/extension/src/adapters/chatgpt apps/extension/src/adapters/claude`
   and `pnpm typecheck`.
8. **Documentation:** record fixture provenance as synthetic structural
   evidence, not authenticated submission proof.
9. **Manual QA:** privacy-safe inspection confirms both fixture families remain
   plausible on the dedicated account; no submission or retained page data.
10. **Suggested commit:** `test: define claude submission boundaries`.
11. **Approval boundary:** resolver evidence only; no verification claim or
    registered script.

### Task M2.2.2 — Claude interception, attachment presence, and resume

1. **Files:** add
   `apps/extension/src/adapters/claude/{claude-adapter,claude-adapter.dom.test,claude-adapter.node.test}.ts`;
   modify the packaged adapter catalog and shared fixed health/error unions.
2. **Test first:** write adapter tests for click, Enter, Shift+Enter, modifiers,
   IME, dynamic rendering, SPA changes, multiple roots, shared Send,
   hidden/stale composers, Send replacement, attachment mutations, one-shot
   bypass, revision changes, duplicate events, resume failure, and disposal.
3. **Expected failure:** no Claude adapter captures or safely resumes attempts,
   attachment evidence cannot be fingerprinted, and unsupported capabilities are
   not reported.
4. **Focused RED:**
   `pnpm exec vitest run --project dom apps/extension/src/adapters/claude --project node apps/extension/src/adapters/claude`.
5. **Minimal implementation:** implement the adapter against the resolver;
   inspect only presence and opaque structure; keep attachment inspection and
   prompt replacement `unsupported` throughout initial M2.2; revalidate through
   the shared controller; perform one guarded synchronous resume; dispose
   idempotently. Future support for either unsupported capability requires a
   separate design, threat review, RED-first tests, authenticated state proof,
   exact-artifact QA, and explicit human approval.
6. **Focused GREEN:** rerun the focused tests and `pnpm typecheck`.
7. **Broader regression:** all adapter/controller unit, node, and DOM tests,
   including reciprocal cross-origin fixtures and unchanged ChatGPT behavior.
8. **Documentation:** update adapter capability evidence, fixed codes, manual
   QA, privacy inventory, and rollback instructions.
9. **Manual QA:** no verification classification yet; locally exercise synthetic
   fixture routes without remote requests.
10. **Suggested commit:** `feat: add claude web verification candidate` only
    after the tests are green; automated tests do not confer verified status.
11. **Approval boundary:** code review confirms unsupported replacement/
    inspection and no cross-adapter selector import before registration work.

### Task M2.2.3 — Exact dynamic registration and lifecycle

1. **Files:** add `apps/extension/src/content/claude-index.ts` and
   `apps/extension/src/background/{content-registration,content-registration.node.test}.ts`;
   modify `apps/extension/vite.content.config.ts`, background bootstrap/API
   adapter, `apps/extension/public/manifest.json`, and the adapter catalog.
2. **Test first:** write registration tests for exact fields, startup
   reconciliation, stale versions, permission removal, disablement, active-port
   disposal, API failures, restarts, and alternate-port behavior. Cover all four
   host/`scripting` combinations, both revocation paths, last-dependent cleanup,
   a hypothetical second catalog-owned dynamic surface, unknown named
   permissions, and ChatGPT without `scripting`. Prove the first executable
   `location.origin === "https://claude.ai"` guard and background validation
   permit no adapter construction, interception, DOM read, accepted port,
   status, or audit on `https://claude.ai:8443/`. Add acknowledged-disposal and
   failed or unresponsive-disposal cases.
3. **Expected failure:** no Claude IIFE build exists, optional `scripting` is
   absent, and persistent exact-origin registration cannot be reconciled or
   removed.
4. **Focused RED:**
   `pnpm exec vitest run --project node apps/extension/src/background/content-registration.node.test.ts apps/extension/src/background/chrome-api-adapter.node.test.ts`.
5. **Minimal implementation:** add `scripting` only under `optional_permissions`
   and `https://claude.ai:443/*` only under `optional_host_permissions`; request
   them together from one options gesture; build one Claude-only IIFE; register
   `promptguard-claude-v1` for that exact default-port pattern, top frame,
   isolated world, document idle, persistent. Reconcile after either permission
   changes. On either revocation, synchronously invalidate background generation
   and reject stale authorization, status, and audit before asynchronous
   disposal/unregistration. Removing Claude removes optional `scripting` only
   when `isScriptingStillRequired()` proves that no other enabled/granted
   catalog-owned dynamic surface depends on it.
6. **Focused GREEN:** rerun focused tests, `pnpm typecheck`, and `pnpm build`.
7. **Broader regression:** shared verification baseline.
8. **Documentation:** record generated entry name, registration ID/version,
   permission removal, startup reconciliation, and rollback.
9. **Manual QA:** verify joint grant, denial, every partial-permission state,
   register/restart/disable, both revocation paths, dependency-aware cleanup,
   reload, truthful inactive status, and refresh guidance from the exact
   candidate artifact. Runtime/options copy remains “Claude verification
   candidate” and contains no acceptance switch.
10. **Suggested commit:** `feat: register the exact claude content entry`.
11. **Approval boundary:** optional `scripting`, exact default-port
    registration, joint request/removal behavior, and lifecycle must be reviewed
    before authenticated submission QA.

### Task M2.2.4 — Cross-adapter artifact and E2E gates

1. **Files:** add Claude cases to
   `tests/e2e/{fixtures,extension-smoke.spec}.ts`; modify
   `apps/extension/scripts/{artifact-reachability.test,build-topology-rules.test,verify-build-topology}.mjs`
   and
   `scripts/{artifact-security-rules.test,verify-production-artifact.test,verify-production-artifact}.mjs`.
2. **Test first:** add failures for missing Claude entry, orphan adapter bundle,
   cross-selector import, wrong registration/match, mismatched sender claim, and
   inaccurate popup/audit identity.
3. **Expected failure:** existing topology knows one IIFE and cannot prove
   reachability or selector isolation for Claude.
4. **Focused RED:**
   `node --test apps/extension/scripts/artifact-reachability.test.mjs apps/extension/scripts/build-topology-rules.test.mjs scripts/artifact-security-rules.test.mjs scripts/verify-production-artifact.test.mjs`
   and the focused Playwright fixture test.
5. **Minimal implementation:** extend manifest/registration-rooted reachability,
   exact URL classification for `https://claude.ai:443/*`, optional named/host
   placement, executable-entry allowlist, IIFE checks, orphan rejection, and
   application-isolation assertions for exactly two entries.
6. **Focused GREEN:** rerun focused Node and Playwright tests after a production
   build.
7. **Broader regression:** shared verification baseline, artifact digest, and
   manual inspection of every generated URL and entry edge.
8. **Documentation:** record file count, URL count/classification, test totals,
   source SHA, CI run, and digest.
9. **Manual QA:** use the exact CI artifact and the evidence record below.
10. **Suggested commit:**
    `test: verify claude artifact and cross-adapter isolation`.
11. **Approval boundary:** the artifact may merge only after authenticated QA
    proves all four verification targets on the exact SHA and digest. That exact
    digest, without rebuild, substitution, or capability downgrade, is the only
    artifact that may then be externally production-accepted and published;
    otherwise remove Claude's executable entry before merge/publication and keep
    unsupported state.

## Authenticated Claude merge gate

Record only:

```text
Exact Git SHA:
CI run:
Artifact digest:
Artifact file count:
Browser and exact version:
Application origin: https://claude.ai
Application account tier:
Date and timezone:
Adapter version:
Permission state:
Permission pattern: https://claude.ai:443/*
Trust state:
Verified capabilities:
Unsupported capabilities:
```

Use a dedicated account and synthetic fixture identifiers. Do not record prompt
or conversation content, filenames, attachment metadata, account identifiers,
screenshots, HTML, cookies, tokens, URL paths, or page titles.

The exact artifact must prove:

- click and unmodified Enter interception; Shift+Enter, modifiers, and IME pass
  through;
- the reviewed synthetic prompt is submitted exactly once after bypass through
  the real Claude submission path;
- attachment presence, add/remove/replace/mutation invalidation, warning/block/
  allow, and one-shot bypass without content/metadata inspection;
- SPA/composer/Send replacement invalidates stale authorization;
- popup and audit identities/capabilities are truthful and prompt-free; and
- ChatGPT remains unchanged.

Failure to prove any one of submission detection, local prompt read, attachment-
presence detection, or submission resume removes the executable entry before
merge/publication and restores unsupported state. There is no per-capability
downgrade and no rebuilt substitute. Prompt replacement and attachment
inspection remain unsupported in the initial M2.2 adapter regardless of other
results.

## Later independent origin pull requests

Each later origin requires a new selection approval and repeats the M2.2
resolver, adapter, registration, artifact, E2E, and authenticated-QA tasks in
its own pull request. Proposed isolated file ownership, only after approval:

| Pull request                   | Exact origin                    | Adapter folder                            | Content entry                                    |
| ------------------------------ | ------------------------------- | ----------------------------------------- | ------------------------------------------------ |
| Gemini web                     | `https://gemini.google.com`     | `apps/extension/src/adapters/gemini/`     | `apps/extension/src/content/gemini-index.ts`     |
| Perplexity web                 | `https://www.perplexity.ai`     | `apps/extension/src/adapters/perplexity/` | `apps/extension/src/content/perplexity-index.ts` |
| DeepSeek web                   | `https://chat.deepseek.com`     | `apps/extension/src/adapters/deepseek/`   | `apps/extension/src/content/deepseek-index.ts`   |
| Microsoft Copilot consumer web | `https://copilot.microsoft.com` | `apps/extension/src/adapters/copilot/`    | `apps/extension/src/content/copilot-index.ts`    |

The test file written first is each folder's `context-resolver.dom.test.ts`,
followed by adapter DOM/node tests; expected RED is no exact resolver or
verified submission path. Focused RED/GREEN is
`pnpm exec vitest run --project dom apps/extension/src/adapters/<approved-adapter> --project node apps/extension/src/adapters/<approved-adapter>`.
The minimal implementation is one origin and one application-owned adapter;
broader regression is the shared baseline plus all earlier adapters. Each PR
updates surface evidence, permissions, threat model, privacy, manual QA,
artifact rules, and rollback; uses
`test: define <application> submission boundaries`,
`feat: add <application> web verification candidate`, and
`test: verify <application> artifact isolation`; and stops at independent
surface/origin/permission/capability approval. Microsoft 365 is not included in
the consumer Copilot PR.

Generic discovery is a separate later privacy/permission proposal and pull
request. It cannot reuse an adapter PR or introduce prompt/page reading,
submission interception, `<all_urls>`, `tabs`, or `activeTab` under this plan.
