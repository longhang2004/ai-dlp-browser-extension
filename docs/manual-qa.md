# Manual QA

This checklist uses identifiers from `tests/fixtures/sensitive-values.json`.
Never copy fixture values into documentation, screenshots, tickets, logs, or
browser storage exports.

## Preconditions

1. Use Node `>=22.13.0 <23` and pnpm `10.13.1`.
2. Start from a clean tree and run:

   ```bash
   rm -rf node_modules
   rm -rf apps/extension/dist
   rm -rf artifacts/playwright
   rm -rf test-results
   rm -rf playwright-report

   pnpm install --frozen-lockfile
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

3. Record the reviewed production commit, wait for its CI run, download that
   commit's reachability-verified extension artifact, published digest, and
   `git archive` source tarball. Recompute the canonical digest locally; the
   digest command must first accept the downloaded artifact's reachability
   graph. Keep all three artifacts bound to the same reviewed commit. Do not use
   a later local build for authenticated QA.
4. Load the downloaded artifact unpacked in Microsoft Edge 102+.
5. Open the popup on `https://chatgpt.com`. Do not rely on enforcement unless it
   says **Protection is active** for the composer and semantic Send control
   being tested. `initializing`, `waiting_for_composer`, `degraded`, and
   `unavailable` are not active.
6. Use a dedicated test conversation with no production or customer data.
7. Record no prompt content, uploaded-file names, preview text, page HTML,
   storage dumps, or sensitive screenshots.

## Automated production-build checks — reviewed on 2026-07-29

The hardening verification completed against reviewed commit
`806cdf0d7d95d07592e0b51415d7cf96fc800f07`.

- 745 Vitest unit, DOM, type-boundary, storage-migration, policy, controller,
  adapter, and UI tests passed, along with 7 Node artifact-script tests.
- The production build contained 12 reachable files, no source maps, and no
  local-asset allowlist entries.
- The manifest-rooted verifier rejected orphan assets before canonical digest
  generation; the digest was
  `e72b6385d20f1afe626c60084d93902f4c6ff1af873dd2483cfe5144231368a7`.
- Artifact verification classified 43 reviewed URL literals with no fetching or
  unreviewed URL.

The Playwright suite routes ChatGPT to local fixture HTML and blocks every other
HTTP(S) request.

| Scenario                      | Result                                                                                                       |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Initialization interval       | Pass-through while settings were deliberately delayed; popup moved from `initializing` to `active`           |
| Clean submission              | Submitted exactly once with no allow audit record                                                            |
| Text warning                  | Click and Enter interception, Shift+Enter pass-through, cancellation, and one-shot bypass passed             |
| No automatic redaction        | Current ChatGPT editor variants exposed no Redact action and retained the prompt                             |
| Strict detectors              | Payment-card, AWS-key, and private-key fixtures blocked without bypass                                       |
| Attachment warning            | Attachment-only warning, accessible bypass, one-shot authorization, and prompt/file-name privacy passed      |
| Attachment block and allow    | Block was fail-closed; allow was dialog-free and not persisted to audit                                      |
| Combined warning              | Text category plus a contributing attachment limitation used one generic bypass and `attachment_bypassed`    |
| Disabled protection           | Runtime status reported disabled and submission passed through without protection observers                  |
| Audit rendering and retention | Final retained decisions were prompt-free; attachment decisions exposed no filename, count, or page metadata |

Automated ambiguity coverage includes shared-Send click and Enter fail-closed
behavior, DOM order and selector-priority reversal, stale and hidden candidates,
separate composer roots, immediate `ambiguous_submission_context` health, and
prompt-free transitions, messages, errors, audit, and logs.

## Interactive current-ChatGPT checklist

Record each item as `pass`, `fail`, or `unavailable`, with the exact Edge and
extension versions and the execution date/timezone.

- Popup reaches `active` for the current composer once its semantic Send control
  is rendered.
- Click submission and unmodified Enter are intercepted once.
- Shift+Enter inserts a newline and does not open a dialog.
- Text warnings show category, confidence, and placeholder information only.
- Cancel restores focus to the originating composer or Send control and does not
  submit.
- Text-only **Send anyway** works once; a second attempt requires a new
  decision.
- While a warning is open, change one enforcement setting (enabled state,
  email/phone/attachment action, or protected keywords). The original action
  must become inert, record `cancelled` when applicable, and never resume; a new
  submission must use the replacement settings. Changing only retention or
  applying an identical normalized snapshot must not cancel an active attempt.
- No current ChatGPT editor variant shows Redact.
- Attachment `warn` shows **Unscanned attachment**, fixed inspection-limit copy,
  Cancel, and the accessible action **Send attachment without inspection**.
- Attachment warning bypass works once; a later attachment attempt requires a
  new decision.
- Attachment `block` shows fixed unsupported-inspection guidance and Close only.
- Attachment `allow` submits without a protection dialog and creates no allow
  audit event.
- A combined text-and-attachment warning shows categories, the inspection
  limitation, and one generic **Send anyway** action.
- With email or phone set to `allow` and attachment set to `warn`, a combined
  input shows and audits only the attachment limitation; the allowed text
  category is absent. With attachment set to `allow` and text set to `warn`, the
  text-only warning and audit omit the attachment and a bypass is `bypassed`,
  not `attachment_bypassed`.
- A strict text block combined with an attachment remains blocked and exposes no
  bypass.
- Adding, removing, replacing, or mutating attachment evidence while approval is
  pending invalidates that approval.
- Replacing the composer, region, or Send control; SPA navigation; dialog
  replacement; expiry; duplicate consumption; or resume failure cannot reuse
  approval.
- A shared Send control with multiple usable composers is synchronously blocked
  and reports `ambiguous_submission_context`; separate roots and Send controls
  remain usable.
- Visible tool and voice controls are not treated as Send.
- The audit page contains no prompt, matched value, uploaded-file name, local
  path, preview text, or page-derived metadata.
- The dialog's open Shadow root is inspectable and keyboard focus remains
  contained.

## Historical reviewed-build authenticated Edge result — 2026-07-29

This record predates the enforcement-revision, contributor-only audit V3, and
artifact-source-archive hardening. It is retained as historical live-DOM
evidence only; use the preconditions and current interactive checklist for
authenticated QA of the current build.

### Build and environment identity

| Field                                      | Recorded value                                                                                                                                              |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Reviewed production commit C               | `df89f06374cb3e9d77412e33012b01ed6e7028d3`                                                                                                                  |
| CI run                                     | [30384957497](https://github.com/longhang2004/ai-dlp-browser-extension/actions/runs/30384957497), completed successfully with the exact commit as `headSha` |
| Downloaded artifact                        | `ai-dlp-extension-df89f06374cb3e9d77412e33012b01ed6e7028d3`                                                                                                 |
| Published and recomputed canonical SHA-256 | `c576d7f5c3dd9c306640dc9fdfa77c4cb57e805beccae193c7013ebed9a36368`                                                                                          |
| Microsoft Edge                             | `150.0.4078.105`                                                                                                                                            |
| AI DLP extension                           | `0.1.0`, unpacked ID `lopemlcfmpmkjbcndeippfapigidlhme`                                                                                                     |
| Manifest                                   | Manifest V3; `storage` permission; content script limited to `https://chatgpt.com/*`                                                                        |
| QA origin                                  | `https://chatgpt.com`                                                                                                                                       |
| Execution window                           | 2026-07-29, 09:33–10:43 `+07` (`+0700`, Asia/Ho_Chi_Minh)                                                                                                   |

The downloaded CI artifact's digest matched the separately published digest
byte-for-byte before loading. The manifest remained version `0.1.0`.

The popup displayed **Protection is active**, **ChatGPT · local inspection
only**, and **Attached file contents are not inspected in this version** while
the tested semantic Send control was present. On this ChatGPT variant, an empty
composer exposes voice controls instead of Send; that empty state can truthfully
report `send_control_not_found` until entered text or an attachment renders the
real Send control.

### Live validated submission relationship

Prompt-free DevTools inspection recorded only structural attributes:

| Element                     | Live relationship                                                                                   |
| --------------------------- | --------------------------------------------------------------------------------------------------- |
| Composer                    | `DIV#prompt-textarea[role="textbox"][contenteditable="true"]`                                       |
| Send control                | `BUTTON[data-testid="send-button"][aria-label="Send prompt"]`                                       |
| Validated submission region | One `FORM` containing the composer and Send control                                                 |
| Attachment evidence         | Present inside that same validated `FORM`; no label, name, preview, or content was read or recorded |

The live page exposed one usable composer for that Send control. Shared-Send
ambiguity was therefore not manufactured in the authenticated page; the
production-build DOM tests listed above are the authoritative ambiguity
evidence.

### Live scenarios performed

| Scenario                        | Result                                                                                                                                                                   |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Popup and target relationship   | Active once the semantic Send control rendered; Add-files, dictation, and voice controls were not selected as Send                                                       |
| Click and keyboard interception | Click and focus-verified unmodified Enter opened the warning; Shift+Enter did not                                                                                        |
| Text warning cancellation       | Placeholder-only email warning opened; Cancel retained the composer and restored focus without submission                                                                |
| Text one-shot bypass            | **Send anyway** resumed exactly once; entering the same fixture again required a fresh warning                                                                           |
| Attachment warning cancellation | Attachment-only warning showed fixed copy and the accessible bypass; Cancel retained the attachment and did not submit                                                   |
| Attachment warning bypass       | **Send attachment without inspection** submitted once; a later attachment attempt produced a new warning                                                                 |
| Attachment block                | Fixed unsupported-inspection block appeared with Close only; no message was created                                                                                      |
| Attachment allow                | Submitted without any protection dialog; no allow decision appeared in audit                                                                                             |
| Combined warning                | Email category, masked placeholder, and attachment limitation appeared with one generic **Send anyway** action; the resulting audit resolution was `attachment_bypassed` |
| Strict text plus attachment     | Payment-card block remained stricter, showed the attachment limitation, and exposed Close only                                                                           |
| Settings copy                   | All three attachment labels, permanent inspection-limit copy, and the additional allow caution were visible; the caution disappeared after restoring `warn`              |
| Audit privacy                   | Raw fixtures, uploaded-file name, local path, prompt text, and page metadata were absent; attachment events showed no finding count or masked excerpt                    |
| Cleanup                         | Unsent attachments used by completed probes were removed from the active composer; submitted tests remained in dedicated test conversations                              |

The audit page rendered attachment-only cancellation, bypass, and block events
with the fixed inspection-limit description. It also rendered combined
attachment decisions without exposing detector counts or masked data. No `allow`
decision was persisted.

The table above records only checks actually performed in the authenticated
session. Other interactive checklist items remain covered by the automated
production-build tests unless separately recorded as live evidence.

## Failure reporting

Capture only:

- browser and extension version;
- reviewed commit, CI run, and canonical digest;
- popup state;
- fixed error or health code;
- fixture identifier;
- structural DOM variant without composer or attachment contents;
- reproduction steps containing no user-authored prompt excerpt.

Do not attach storage dumps, page HTML, console logs with composer values,
screenshots exposing fixture values or uploaded-file names, or copied prompt
content.
