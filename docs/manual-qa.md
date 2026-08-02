# PromptGuard manual QA

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
4. For Milestone 1 ChatGPT checks, load the downloaded artifact unpacked in
   Microsoft Edge 102+; the static ChatGPT entry requires no optional grant.
   M2.2 Claude checks require the exact optional `scripting` plus
   `https://claude.ai:443/*` pair from an explicit options-page action.
5. Open the popup on `https://chatgpt.com`. Do not rely on enforcement unless it
   says **Protection is active** for the composer and semantic Send control
   being tested. `initializing`, `waiting_for_composer`, `degraded`, and
   `unavailable` are not active. This checklist records no authenticated Claude
   acceptance; that evidence belongs to the exact CI artifact and PR metadata.
6. Use a dedicated test conversation with no production or customer data.
7. Record no prompt content, uploaded-file names, preview text, page HTML,
   storage dumps, or sensitive screenshots.

## Historical Milestone 1 automated checks — Audit V3 era, reviewed on 2026-07-29

The Milestone 1 hardening verification completed against reviewed commit
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

These 12-file results belong to the ChatGPT-only M1/Audit V3 history. M2.1
introduced the current Audit V4 envelope and is documented as the historical
12-file rollback baseline; they are not M2.2 Claude-candidate evidence.

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

## Provisional M2.2 automated candidate evidence — latest escalated local browser run (2026-08-03)

The latest local corrective-candidate gate is provisional and is not bound to a
final exact-head CI artifact. Format, lint, typecheck, and performance checks
passed. The unit/node/dom suites reported 932 Vitest tests, and the artifact
scripts reported 21 TAP tests. The generated candidate artifact contained 13
manifest/registration-reachable files and 76 reviewed URL literals; its local
candidate canonical digest was
`7964a320c28b275eb16fa99926cda6078639592d155f3eaedbb647a956decede`.

Final local candidate artifact/source code SHA:
`f7cf16a73613f3a7e15250c29e8025e2b75f479a`. Subsequent commits are
documentation-only updates; this SHA identifies the source used for the local
candidate artifact and evidence, not a CI publication.

Local run date: 2026-08-03 (Asia/Ho_Chi_Minh), supported by the local Playwright
artifacts and verification report metadata. This dates local evidence only; it
does not bind it to an exact-head CI artifact or authenticated acceptance.

The escalated local `pnpm test:e2e` run passed all 16/16 Playwright launches. An
earlier restricted-sandbox attempt could not launch Chromium
(`EPERM`/`SIGABRT`); that failure is superseded and is not local browser-run
evidence. The escalated local `pnpm test:permission-proof` run passed for Chrome
`150.0.7871.187` and Edge `151.0.4129.59`; declaration, joint request, contains,
registration, default-port match, and removal were `true`, while the
alternate-port match was `false` for both browsers. See
[the browser proof](milestone-2/browser-permission-proof.md) for the exact rows.
Authenticated Claude submission, prompt read, attachment-presence, and resume
acceptance remain absent; production acceptance, exact-head CI artifact and
digest, and PR publication remain external.

## Historical M1 Audit V3 authenticated Edge attempt — 2026-07-29

This M1 Audit V3 attempt used the exact reviewed Part A artifact and
privacy-safe synthetic fixtures. It recorded no screenshots, prompt excerpts,
matched values, filenames, page HTML, storage dumps, or page-derived metadata.

| Field                                      | Recorded value                                                                                                                       |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| Reviewed Part A commit                     | `4c0581ce480afca3a3e267770092db4b00f23b4b`                                                                                           |
| CI run                                     | [30429601994](https://github.com/longhang2004/ai-dlp-browser-extension/actions/runs/30429601994), successful at the exact Part A SHA |
| Published and recomputed canonical SHA-256 | `e72b6385d20f1afe626c60084d93902f4c6ff1af873dd2483cfe5144231368a7`                                                                   |
| Verified extension artifact                | 12 manifest-reachable files; 43 reviewed URL literals; no source maps                                                                |
| Microsoft Edge                             | `150.0.4078.105`                                                                                                                     |
| PromptGuard extension                      | `0.1.0`, unpacked ID `pijpmkiflojfgamgjjkahaggifgpbnha`                                                                              |
| Execution context                          | Authenticated `https://chatgpt.com`, 2026-07-29, Asia/Ho_Chi_Minh                                                                    |

The exact artifact was the only enabled unpacked PromptGuard copy. Two older
unpacked copies were disabled before testing.

| Scenario                                      | Authenticated result                                                                                                                                                                                                                                 |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Click and keyboard interception               | Click and unmodified Enter were intercepted; Shift+Enter inserted a structural newline without submission                                                                                                                                            |
| Text warning privacy and accessibility        | Contributor category, confidence, and placeholder-only preview appeared; raw fixture content was absent; open Shadow DOM and focus containment passed                                                                                                |
| Cancel and focus restoration                  | Cancel did not submit and returned focus to the semantic Send control                                                                                                                                                                                |
| Text one-shot bypass                          | One approval submitted once; a repeated attempt required a new decision                                                                                                                                                                              |
| New policy after enforcement change           | A fresh submission used the updated block policy after the email setting changed from warn to block: **Submission blocked**, Close only, and no bypass                                                                                               |
| Stale warning during settings UI navigation   | `unavailable`: direct observation of clicking a stale dialog after settings-page navigation was unavailable because the dialog was removed during navigation; automated controller and bootstrap integration tests cover stale-callback invalidation |
| Retention-only and identical-save persistence | `unavailable` for the same tab-switch control reason; direct bootstrap tests prove revision and active-attempt preservation                                                                                                                          |
| Automatic redaction                           | No current editor variant exposed Redact                                                                                                                                                                                                             |
| Attachment warning and one-shot bypass        | Fixed uninspected-attachment copy and accessible bypass appeared; a later attempt required a new decision                                                                                                                                            |
| Attachment policy block/allow                 | `unavailable` through the authenticated settings path; production Playwright exercised both settings end to end                                                                                                                                      |
| Combined text and attachment warning          | One generic bypass displayed both final-action contributors without raw prompt or filename                                                                                                                                                           |
| Contributor-only setting permutations         | `unavailable` through the authenticated settings path; controller, validator, audit, and production-extension tests cover both permutations                                                                                                          |
| Strict block with attachment                  | Strict text policy remained blocked, included the inspection limitation, and exposed no bypass                                                                                                                                                       |
| Attachment mutation while approval is pending | `unavailable` in the authenticated control surface; adapter/controller DOM tests cover add, remove, replace, and mutation invalidation                                                                                                               |
| Navigation and stale authorization            | SPA navigation invalidated a pending authorization and did not submit                                                                                                                                                                                |
| Shared Send ambiguity                         | `unavailable` on the current single-composer page; production DOM tests are authoritative                                                                                                                                                            |
| Non-Send controls                             | Add-files did not trigger protection; voice/dictation was not visible in the tested variant                                                                                                                                                          |
| Popup and audit extension pages               | `unavailable` to the browser-control surface; production Playwright verified active/disabled truthfulness, retention, and prompt-free audit rendering                                                                                                |

All unavailable authenticated items passed their corresponding automated
production-build, unit, or DOM tests. They remain limitations rather than being
reported as live passes.

No authenticated Claude submission or resume has been performed. Claude's
synthetic DOM tests, artifact-independent permission proof, and fail-safe E2E
fixture do not establish authenticated application-state acceptance.

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
- Adding, removing, replacing, changing attributes on, or changing direct or
  nested text inside attachment evidence while approval is pending invalidates
  that approval; unrelated and out-of-region text does not.
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

## Historical pre-M1 Audit V3 authenticated Edge result — 2026-07-29

This record predates the M1 Audit V3 enforcement revision, M2.1 Audit V4, and
artifact-source-archive hardening. It is retained as historical live-DOM
evidence only; use the preconditions and current interactive checklist for
authenticated QA of a reviewed artifact.

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
