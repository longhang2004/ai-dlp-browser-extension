# PromptGuard — AI DLP for ChatGPT

PromptGuard is a privacy-first Chromium Manifest V3 extension that inspects
ChatGPT prompts locally before submission. Milestone 1 supports
`https://chatgpt.com/*` only and never sends prompt content to a backend.

It detects email addresses, phone numbers, payment cards, AWS access key IDs,
PEM private keys, contextual API secrets, and locally configured protected
keywords. Depending on policy, a submission is allowed, warned, or blocked. The
pure redaction engine remains available for future adapters, but Milestone 1
never replaces a ChatGPT composer automatically.

## Privacy and security summary

- Prompt inspection, policy evaluation, and redaction run in the browser.
- The ChatGPT adapter reads the active composer only for the synchronous
  operation being performed; it does not cache prompt content.
- React receives category, confidence, and placeholder metadata only.
- Dialogs and audit records retain only the categories and rules that
  contributed to the enforced action; lower-precedence or allowed matches are
  omitted.
- Runtime messages, the service worker, storage, audit records, and logs are
  prompt-free.
- Ordinary clean `allow` decisions are not stored.
- Prompts over 100,000 UTF-16 code units are stopped with content-free guidance
  and no bypass.
- Composer-scoped attachments are detected but never inspected. Their policy is
  configurable as block, warn with a one-shot bypass, or allow; the safe default
  is warn.
- Automatic ChatGPT replacement is unsupported for every current editor,
  including native textareas and ProseMirror/contenteditable. A legacy or
  internal redact decision fails closed without changing or submitting content.
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
pnpm artifact:digest
```

`pnpm test:browser` uses Playwright's bundled Chromium, loads the production
`apps/extension/dist` directory, and fulfills the real ChatGPT match URL with a
local fixture. The fixture blocks and fails on any unexpected HTTP(S) request.
`pnpm build` clears the prior extension output first. `pnpm verify:artifact`
then validates a manifest-rooted reachability graph, rejecting missing,
non-local, source-mapped, or unallowlisted unreachable output.
`pnpm artifact:digest` repeats that reachability check before it hashes the
canonical artifact.

The reviewed remediation verification on 2026-07-29 passed 745 Vitest tests and
7 Node artifact-script tests. The production build contained 12 reachable files,
no source maps, and no required local-asset allowlist entries.

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

The options page exposes protection enablement, email, phone, and attachment
actions, protected keywords, and a local audit-retention limit from 1 to 1,000
events. The settings UI does not offer automatic `redact`. Persisted settings
use a V2 envelope. Strictly valid V1 settings migrate once, preserving choices,
normalizing legacy email/phone `redact` to `warn`, and adding the default
attachment action `warn`. Invalid attachment actions fall back to `warn`, never
`allow`. Payment cards, AWS access keys, and private keys always block;
protected keywords warn; high-confidence API secrets block and medium-confidence
API secrets warn.

The audit page stores only privacy-safe contributor metadata and enforcement or
adapter-health errors in a V3 envelope; newly emitted events use ChatGPT adapter
event version 3. A warning gets `attachment_bypassed` only when the attachment
rule contributed to the final action; an allowed attachment alongside a text
warning remains the ordinary `bypassed` case. Valid legacy V1/V2 audit records
are migrated conservatively to V3 once, while ambiguous legacy decisions are
discarded rather than relabeled. Clearing the audit log requires explicit
confirmation.

CI publishes a reachability-verified extension, its canonical digest, and a
`git archive` source tarball for the same reviewed commit. Authenticated QA uses
that three-artifact set, not a later local build.

## Scope

Milestone 1 detects composer attachments but does not inspect their contents.
The configured attachment action controls whether submission blocks, warns, or
proceeds without a dialog. It does not inspect other websites, ChatGPT desktop
or mobile applications, network traffic, or content submitted before settings
initialization. Enterprise policy, forced installation, central audit export,
and tamper resistance are future work; see
[managed deployment](docs/managed-deployment.md).

PromptGuard's documented future direction is **Universal AI Interaction DLP and
Governance**. Future application visibility means coarse awareness of an
approved AI surface; it is not content monitoring. Future audit metadata remains
an allowlisted, prompt-free record of decisions and system state. Quarantine
would be a separate, explicitly approved mode and is not part of Milestone 1 or
the current roadmap commitments.

See the [roadmap](docs/roadmap.md),
[product vision](docs/architecture/product-vision.md), and
[multi-surface architecture](docs/architecture/multi-surface-architecture.md).
These documents define approval gates and proposed contracts; they do not
implement additional adapters, endpoint components, management services, or
dashboards.

## Development guides

- [Add a detector](docs/extension-guides/add-detector.md)
- [Add an application adapter](docs/extension-guides/add-adapter.md)
- [Manual QA](docs/manual-qa.md)
