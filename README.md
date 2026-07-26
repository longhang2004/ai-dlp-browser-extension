# AI DLP for ChatGPT

AI DLP is a privacy-first Chromium Manifest V3 extension that inspects ChatGPT
prompts locally before submission. Milestone 1 supports `https://chatgpt.com/*`
only and never sends prompt content to a backend.

It detects email addresses, phone numbers, payment cards, AWS access key IDs,
PEM private keys, contextual API secrets, and locally configured protected
keywords. Depending on policy, a submission is allowed, warned, redacted, or
blocked.

## Privacy and security summary

- Prompt inspection, policy evaluation, and redaction run in the browser.
- The ChatGPT adapter reads or replaces the active composer only for the
  synchronous operation being performed; it does not cache prompt content.
- React receives category, confidence, and placeholder metadata only.
- Runtime messages, the service worker, storage, audit records, and logs are
  prompt-free.
- Ordinary clean `allow` decisions are not stored.
- Prompts over 100,000 UTF-16 code units are stopped with content-free guidance
  and no bypass.
- Composer-scoped attachments are detected but never inspected; while protection
  is enabled, their submission is stopped with no bypass.
- Automatic replacement is supported only for verified native textareas.
  ProseMirror/contenteditable redaction is disabled and fails closed.
- The dialog uses open Shadow DOM for CSS/component isolation and inspection,
  not as a security boundary.
- The production manifest grants only `storage`; there are no host permissions,
  remote scripts, remote assets, or network endpoints.

See [Privacy](docs/privacy.md), [Threat model](docs/threat-model.md), and the
[architecture overview](docs/architecture/overview.md) for the complete model.

## Requirements

- Node.js `>=22.13.0 <23`
- pnpm `10.13.1`
- Chromium/Chrome `102` or newer

## Build and test

```bash
pnpm install --frozen-lockfile
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm test:browser
pnpm test:e2e
pnpm test:performance
pnpm build
pnpm verify:artifact
```

`pnpm test:browser` uses Playwright's bundled Chromium, loads the production
`apps/extension/dist` directory, and fulfills the real ChatGPT match URL with a
local fixture. The fixture blocks and fails on any unexpected HTTP(S) request.

The latest remediation run on 2026-07-26 passed 658 unit/DOM tests, 7 Chromium
integration tests, and 4 performance scenarios. The production build contained
12 files; 43 URL literals were classified with zero fetching and zero unreviewed
URLs.

## Load the unpacked extension

1. Run `pnpm build` and `pnpm verify:artifact`.
2. Open `chrome://extensions` in Chrome or Chromium.
3. Enable Developer mode.
4. Choose **Load unpacked** and select `apps/extension/dist`.
5. Open ChatGPT and confirm the popup reports **Protection is active** before
   relying on interception.

The popup reports `initializing`, `waiting_for_composer`, `active`, `disabled`,
`degraded`, or `unavailable`. A submission made before validated settings
initialization completes is not intercepted, and the extension never calls that
interval active.

## Settings and audit

The options page exposes protection enablement, email and phone actions,
protected keywords, and a local audit-retention limit from 1 to 1,000 events.
The settings UI does not offer automatic `redact`; warning redaction is shown
only when the active editor reports verified replacement support. Payment cards,
AWS access keys, and private keys always block; protected keywords warn;
high-confidence API secrets block and medium-confidence API secrets warn.

The audit page stores only privacy-safe decision metadata and enforcement or
adapter-health errors. Clearing the audit log requires explicit confirmation.

## Scope

Milestone 1 detects and blocks composer attachments but does not inspect their
contents. It does not inspect other websites, ChatGPT desktop or mobile
applications, network traffic, or content submitted before settings
initialization. Enterprise policy, forced installation, central audit export,
and tamper resistance are future work; see
[managed deployment](docs/managed-deployment.md).

## Development guides

- [Add a detector](docs/extension-guides/add-detector.md)
- [Add an application adapter](docs/extension-guides/add-adapter.md)
- [Manual QA](docs/manual-qa.md)
