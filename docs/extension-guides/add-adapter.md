# Add an application adapter

Milestone 1 ships only the ChatGPT adapter. A new adapter requires an explicit
design review because it expands host scope, DOM assumptions, manifest matches,
sender validation, status aggregation, permissions, tests, and threat model.

## Contract

Browser-specific adapters implement `ChatApplicationAdapter` in
`apps/extension/src/adapters/chat-application-adapter.ts`:

- match only the intended application URL;
- resolve the live composer and associated enabled send control;
- synchronously read the active prompt and explicitly report whether safe
  replacement is supported;
- inspect prompt-free submission capabilities such as unsupported attachment
  presence without reading attachment metadata or contents;
- synchronously capture click/Enter attempts;
- expose the browser-specific resume operation;
- dispose every listener, observer, reference, and callback.

The adapter must not evaluate policy, own authorization, show protection UI,
construct audit events, or receive `SensitiveDataFinding` objects.

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

Maintain fixture-based tests for at least two plausible DOM variants and add a
fixture for every selector regression.

## Submission safety

The controller, not the adapter, owns the one-shot authorization. Before resume,
the controller re-resolves and validates URL, context version, composer, send
control, and prompt text. The adapter performs one guarded synchronous resume
and clears its guard in `finally`.

Send resolution must prefer composer-associated stable Send data attributes,
Send accessible labels, `button[type=submit]`, and `input[type=submit]`. Generic
no-type buttons are not submit candidates. Attachment selectors remain
centralized and scoped to the resolved composer region; dormant file inputs and
page-external attachment-like elements are not attachment evidence.

`replacePrompt` returns an explicit verified result. Native textarea support
must verify the value used by the submit path. Direct `textContent` assignment
plus synthetic events is not sufficient for ProseMirror/contenteditable.

Tests must cover click/Enter capture, Shift+Enter/modifiers/IME pass-through,
recursive interception, double events, dynamic element replacement, stale
contexts, resume failure, duplicate initialization, and disposal.

## Integration changes

A new application also requires:

- explicit manifest match review with least privilege;
- background sender-origin and URL validation;
- application-specific status and audit identifiers;
- local fixture routes that make no remote request;
- production artifact URL review;
- updated privacy/threat/manual-QA documentation.

Do not add `tabs`, `activeTab`, `scripting`, broad host permissions,
`web_accessible_resources`, page-world injection, or remote assets unless a new
approved specification demonstrates necessity.
