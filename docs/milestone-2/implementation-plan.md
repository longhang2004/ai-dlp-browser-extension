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
   `packages/shared-types/src/{status,messages,settings,audit,policy,validators,index}.ts`
   and `apps/extension/src/adapters/chat-application-adapter.ts`.
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

### Task M2.0.2 — Settings V3 and audit V4 migration

1. **Files:** modify
   `apps/extension/src/storage/{settings-store,audit-store}.ts` and the shared
   settings/audit/validator files from M2.0.1.
2. **Test first:** modify
   `apps/extension/src/storage/settings-store.node.test.ts` and
   `apps/extension/src/storage/audit-store.node.test.ts`.
3. **Expected failure:** V2 cannot create exact ChatGPT-enabled/Claude-disabled
   surface entries, and V3 events cannot become catalog-correlated V4 records.
4. **Focused RED:**
   `pnpm exec vitest run --project node apps/extension/src/storage/settings-store.node.test.ts apps/extension/src/storage/audit-store.node.test.ts`.
5. **Minimal implementation:** migrate valid V2 settings to V3 while preserving
   global policy values; migrate provable ChatGPT V3 audit events losslessly to
   V4; reject duplicates, unknown IDs, unknown keys, and unprovable identity.
   Never persist permission state.
6. **Focused GREEN:** rerun the focused node tests.
7. **Broader regression:** `pnpm typecheck && pnpm test`.
8. **Documentation:** record final envelope examples and conservative-discard
   behavior in the architecture/privacy documentation touched by the PR.
9. **Manual QA:** upgrade an existing local ChatGPT profile copy, confirm policy
   values and history, and record no storage dump or prompt-derived content.
10. **Suggested commit:**
    `feat: migrate settings and audit for explicit surfaces`.
11. **Approval boundary:** storage identity and compatibility; no permission or
    executable Claude code.

### Task M2.0.3 — Catalog, registry, sender correlation, and truthful UI

1. **Files:** add
   `apps/extension/src/adapters/{adapter-catalog,adapter-registry}.ts` and their
   node tests; modify
   `apps/extension/src/content/{bootstrap,submission-controller}.ts`,
   `apps/extension/src/background/{sender-validation,settings-ports,message-router}.ts`,
   and `apps/extension/src/{popup,options,audit}/App.tsx`.
2. **Test first:** add
   `apps/extension/src/adapters/{adapter-catalog,adapter-registry}.node.test.ts`;
   modify `apps/extension/src/content/bootstrap.dom.test.ts`,
   `apps/extension/src/background/{sender-validation,settings-ports,message-router}.node.test.ts`,
   and each `App.ui.test.tsx`.
3. **Expected failure:** duplicate origins and mismatched claims are not catalog
   errors, bootstrap constructs ChatGPT directly, and UI/background cannot
   render or validate the generalized identity/status model.
4. **Focused RED:**
   `pnpm exec vitest run --project node apps/extension/src/adapters apps/extension/src/background --project dom apps/extension/src/content/bootstrap.dom.test.ts apps/extension/src/popup/App.ui.test.tsx apps/extension/src/options/App.ui.test.tsx apps/extension/src/audit/App.ui.test.tsx`.
5. **Minimal implementation:** bind ChatGPT through an immutable catalog and
   one-adapter registry, centralize sender correlation, derive audit identity
   from the validated descriptor, and render prompt-free generalized status.
   Popup names ChatGPT only from a valid port. Disposal is idempotent.
6. **Focused GREEN:** rerun the focused Vitest command and `pnpm typecheck`.
7. **Broader regression:** the shared verification baseline, including the
   unchanged 12-file artifact topology and ChatGPT E2E.
8. **Documentation:** record stale-content-port rejection and ChatGPT backward
   compatibility.
9. **Manual QA:** ChatGPT-only regression for click/Enter, attachment policy,
   health, popup/options/audit, settings migration, and prompt-free evidence.
10. **Suggested commit:** `refactor: bind chatgpt through the adapter registry`.
11. **Approval boundary:** generated artifact, permissions, and observable
    ChatGPT enforcement remain unchanged.

## PR M2.1 — Claude setting and exact optional permission, no adapter

This PR may declare optional host access but must contain no Claude selector,
content bundle, script registration, prompt access, or protection claim. The
enabled-and-granted Claude state is `adapter_unsupported`.

### Task M2.1.1 — Permission API and state derivation

1. **Files:** add
   `apps/extension/src/background/{surface-permissions,surface-permissions.node.test}.ts`;
   modify
   `apps/extension/src/background/{chrome-api-adapter,bootstrap,settings-ports}.ts`,
   `apps/extension/src/options/App.tsx`, `apps/extension/src/popup/App.tsx`, and
   `apps/extension/public/manifest.json`.
2. **Test first:** modify
   `apps/extension/src/background/chrome-api-adapter.node.test.ts`, add the
   surface-permission test, and modify
   `apps/extension/src/{options,popup}/App.ui.test.tsx`.
3. **Expected failure:** Chrome permission contains/request/remove/events are
   not adapted, surface state does not distinguish permission and enablement,
   and no explicit-click UX exists.
4. **Focused RED:**
   `pnpm exec vitest run --project node apps/extension/src/background/chrome-api-adapter.node.test.ts apps/extension/src/background/surface-permissions.node.test.ts --project dom apps/extension/src/options/App.ui.test.tsx apps/extension/src/popup/App.ui.test.tsx`.
5. **Minimal implementation:** declare only `https://claude.ai/*` under
   `optional_host_permissions`; add permission handling; require serialized
   origin `https://claude.ai` before adapter/DOM work because Chrome's official
   [match-pattern documentation](https://developer.chrome.com/docs/extensions/develop/concepts/match-patterns)
   says the omitted port matches all ports; request only from the options click.
   M2.1 has no Claude bootstrap, content script, or `scripting` permission. The
   future M2.2 bootstrap may be injected on alternate ports and therefore needs
   the first-executable origin guard specified below.
6. **Focused GREEN:** rerun the focused tests and `pnpm typecheck`.
7. **Broader regression:** `pnpm test`; confirm ChatGPT remains active without a
   Claude grant.
8. **Documentation:** update privacy, manual QA, and permission disclosure for
   the exact optional host only.
9. **Manual QA:** grant, deny, remove, and re-grant Claude host access; verify
   grant without enablement and enablement without grant; confirm no Claude page
   code or active-protection claim.
10. **Suggested commit:** `test: specify optional surface permission states`,
    then `feat: add explicit claude host permission flow`.
11. **Approval boundary:** exact Claude host disclosure and user gesture; no
    executable adapter.

### Task M2.1.2 — Artifact permission enforcement

1. **Files:** modify
   `apps/extension/scripts/{build-topology-rules.test,verify-build-topology}.mjs`,
   `scripts/{artifact-security-rules.test,verify-production-artifact.test,verify-production-artifact}.mjs`,
   and `scripts/artifact-url-allowlist.json` only as required by the reviewed
   exact non-fetching origin literals.
2. **Test first:** add failing cases to
   `apps/extension/scripts/build-topology-rules.test.mjs` and
   `scripts/verify-production-artifact.test.mjs` before verifier changes.
3. **Expected failure:** current verifiers reject every optional-host field and
   cannot distinguish the one approved exact origin from wildcards or forbidden
   named permissions.
4. **Focused RED:**
   `node --test apps/extension/scripts/build-topology-rules.test.mjs scripts/verify-production-artifact.test.mjs`.
5. **Minimal implementation:** allow exactly `https://claude.ai/*` only in
   `optional_host_permissions`; continue rejecting `scripting`, broad patterns,
   any Claude content entry/bundle, and every forbidden permission in M2.1.
6. **Focused GREEN:** rerun the focused Node tests, build, and
   `pnpm verify:artifact`.
7. **Broader regression:** shared verification baseline plus a
   generated-manifest manual review and unchanged 12-file reachability
   expectation.
8. **Documentation:** record the artifact URL classification and permission
   review result.
9. **Manual QA:** inspect the packaged manifest and Chrome permission flow from
   the exact artifact digest.
10. **Suggested commit:** `test: enforce exact optional surface permissions`.
11. **Approval boundary:** artifact allows the optional declaration only; any
    Claude executable file or `scripting` remains a failure.

## PR M2.2 — First verified Claude adapter

Exactly one new application and origin. Attachment presence and safe resume are
merge gates; if either cannot be proved, remove the executable Claude entry and
retain `adapter_unsupported`.

The release-candidate may add `claude` with proposed verified trust only inside
gated authenticated QA. It is not production-accepted and cannot be published or
installed outside that cohort. Only after every evidence gate passes may that
exact same digest, without rebuild or substitution, be accepted and published;
failure removes the entry and restores unsupported state before release.

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
   inspect only presence and opaque structure; leave attachment inspection and
   prompt replacement unsupported; revalidate through the shared controller;
   perform one guarded synchronous resume; dispose idempotently.
6. **Focused GREEN:** rerun the focused tests and `pnpm typecheck`.
7. **Broader regression:** all adapter/controller unit, node, and DOM tests,
   including reciprocal cross-origin fixtures and unchanged ChatGPT behavior.
8. **Documentation:** update adapter capability evidence, fixed codes, manual
   QA, privacy inventory, and rollback instructions.
9. **Manual QA:** no verification classification yet; locally exercise synthetic
   fixture routes without remote requests.
10. **Suggested commit:** `feat: add the verified claude web adapter` only after
    the tests are green; the merge gate still controls the word “verified.”
11. **Approval boundary:** code review confirms unsupported replacement/
    inspection and no cross-adapter selector import before registration work.

### Task M2.2.3 — Exact dynamic registration and lifecycle

1. **Files:** add `apps/extension/src/content/claude-index.ts` and
   `apps/extension/src/background/{content-registration,content-registration.node.test}.ts`;
   modify `apps/extension/vite.content.config.ts`, background bootstrap/API
   adapter, `apps/extension/public/manifest.json`, and the adapter catalog.
2. **Test first:** write registration tests for exact fields, startup
   reconciliation, stale versions, permission removal, disablement, active-port
   disposal, API failures, restarts, and alternate-port behavior. Chrome's
   official
   [match-pattern documentation](https://developer.chrome.com/docs/extensions/develop/concepts/match-patterns)
   means the bootstrap may be injected on an alternate port, so tests prove its
   first executable `location.origin === "https://claude.ai"` guard exits before
   DOM access or adapter construction and permits no accepted adapter/runtime
   registration or port, status, or audit. Add acknowledged-disposal and failed
   or unresponsive-disposal cases.
3. **Expected failure:** no Claude IIFE build exists, `scripting` is absent, and
   persistent exact-origin registration cannot be reconciled or removed.
4. **Focused RED:**
   `pnpm exec vitest run --project node apps/extension/src/background/content-registration.node.test.ts apps/extension/src/background/chrome-api-adapter.node.test.ts`.
5. **Minimal implementation:** add separately approved `scripting`; build one
   Claude-only IIFE; register `promptguard-claude-v1` for exactly
   `https://claude.ai/*`, top frame, isolated world, document idle, persistent;
   on revocation/effective-access failure synchronously invalidate background
   generation and reject stale authorization, status, and audit before
   asynchronous disposal/unregistration. Report the surface inactive immediately
   and require disposal acknowledgement. If the runtime fails or does not
   respond, provide refresh guidance and make no protection claim; already
   injected code may keep observing or intercepting local submissions until
   acknowledgement or reload.
6. **Focused GREEN:** rerun focused tests, `pnpm typecheck`, and `pnpm build`.
7. **Broader regression:** shared verification baseline.
8. **Documentation:** record generated entry name, registration ID/version,
   permission removal, startup reconciliation, and rollback.
9. **Manual QA:** verify grant/enable/register/restart/disable/revoke/reload
   states, acknowledged disposal, failed or unresponsive disposal, truthful
   inactive status, and refresh guidance from the exact release artifact without
   claiming capability success yet.
10. **Suggested commit:** `feat: register the exact claude content entry`.
11. **Approval boundary:** `scripting`, exact registration fields, and lifecycle
    must be separately reviewed before authenticated submission QA.

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
   exact URL classification, executable-entry allowlist, IIFE checks, orphan
   rejection, and application-isolation assertions for exactly two entries.
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
    proves every claimed capability on the exact SHA and digest. That exact
    digest, without rebuild or substitution, is the only artifact that may then
    be production-accepted and published; otherwise remove Claude's executable
    entry and keep unsupported state.

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

Failure to prove submission resume or attachment presence prevents a verified
Claude descriptor from shipping. Remove the executable entry and restore
unsupported state before release. Prompt replacement and attachment inspection
remain unsupported regardless of other results.

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
`feat: add the verified <application> web adapter`, and
`test: verify <application> artifact isolation`; and stops at independent
surface/origin/permission/capability approval. Microsoft 365 is not included in
the consumer Copilot PR.

Generic discovery is a separate later privacy/permission proposal and pull
request. It cannot reuse an adapter PR or introduce prompt/page reading,
submission interception, `<all_urls>`, `tabs`, or `activeTab` under this plan.
