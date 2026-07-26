# Manual QA

This checklist uses identifiers from `tests/fixtures/sensitive-values.json`. Do
not copy fixture values into documentation, screenshots, tickets, or logs.

## Preconditions

1. Use Node `>=22.13.0 <23` and pnpm `10.13.1`.
2. Run:

   ```bash
   pnpm install --frozen-lockfile
   pnpm build
   pnpm verify:artifact
   ```

3. Load `apps/extension/dist` unpacked in a Chromium-based browser (Chrome/Edge
   102+).
4. Open the popup. Do not rely on enforcement unless it says **Protection is
   active**. `initializing`, `waiting_for_composer`, `degraded`, and
   `unavailable` are not active.
5. Use a test ChatGPT conversation with no production or customer data.

## Automated production-build checks — successful on 2026-07-26

The following checks were run against the built extension, with ChatGPT routed
to local fixture HTML and every other HTTP(S) request blocked:

| Scenario                | Fixture ID or input                                                     | Result                                                                                                         |
| ----------------------- | ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Initialization interval | `paymentCard.validVisa`                                                 | Pass-through while settings read was deliberately delayed; popup remained `initializing`, then became `active` |
| Clean submission        | Ordinary non-sensitive sentence                                         | Submitted exactly once; no allow audit record                                                                  |
| Warning and bypass      | `email.valid` + `phone.vietnameseDomestic`                              | Placeholder-only warning; Shift+Enter passed through; one-shot send-anyway submitted once                      |
| No automatic redaction  | `email.valid`                                                           | Warning exposed no Redact action; composer remained unchanged and unsubmitted                                  |
| Strict blocks           | `paymentCard.validVisa`, `awsAccessKey.longLived`, `privateKey.generic` | Blocked with no bypass                                                                                         |
| Disabled protection     | `paymentCard.validVisa`                                                 | Runtime status reported disabled through the options page and submission passed through                        |
| Audit retention         | `email.valid`, then `phone.vietnameseDomestic` with limit 1             | Only final prompt-free phone decision remained                                                                 |

Automated result: 7/7 Playwright tests passed. The production build contained 12
files, no source maps, and 43 reviewed URL literals with zero fetching or
unreviewed classifications.

## Interactive current-ChatGPT checklist

Record each item as `pass`, `fail`, or `unavailable`, with browser version and
date. Never record the submitted fixture value.

- Popup reaches `active` on the current authenticated `chatgpt.com` composer.
- Click submission and unmodified Enter are intercepted once.
- Shift+Enter inserts a newline and does not open a dialog.
- Warning shows category/confidence/placeholder information only.
- Cancel restores focus and does not submit.
- Send anyway works once and a second attempt requires a new decision.
- No ChatGPT editor variant, including native textarea and
  ProseMirror/contenteditable, shows Redact and continue. An injected
  legacy/internal redact decision must leave the composer unchanged, never
  resume submission, and show fixed fail-closed guidance.
- An attachment-only prompt and text plus attachment are blocked without bypass;
  removing the attachment permits a new attempt. Do not record the filename.
- A large paste converted by ChatGPT into an attachment is blocked as an
  unsupported attachment.
- Card, AWS key, and private-key fixtures block without bypass.
- A prompt of exactly 100,000 UTF-16 code units is inspected.
- A prompt of 100,001 code units is stopped with split-prompt guidance and no
  bypass.
- Changing the prompt while a dialog is open prevents stale approval.
- Replacing the composer or send control while a dialog is open prevents stale
  approval.
- SPA navigation and a newly rendered composer restart `waiting_for_composer`,
  recover within the 10-second default grace, or report degraded truthfully
  after expiry.
- Disabling protection cancels an active attempt and later submissions pass
  through.
- Re-enabling protection returns to active only after a fresh validated
  snapshot.
- Disabled mode creates no protection observer or health event. Delayed
  rendering reports `waiting_for_composer` before active or grace-expired
  degraded.
- With visible tool/voice controls, only the semantic Send control is captured
  and resumed.
- The audit page shows no prompt text or matched value and clears only after
  confirmation.
- The open Shadow root is inspectable and focus remains contained in the dialog.

## Authenticated live-check result — successful on 2026-07-26

The production build was loaded unpacked in Microsoft Edge and exercised on the
current authenticated `chatgpt.com` composer. The exact Edge version was not
captured. The browser-control extension reported version `1.2.2721.15725`, and
the unpacked AI DLP extension reported version `0.1.0`.

The popup reported **Protection is active** and **ChatGPT · local inspection
only**, with 18 recent protection events after the test session.

| Scenario               | Input                                                                                     | Result                                                                                                        |
| ---------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Warning and cancel     | `email.valid`                                                                             | Placeholder-only warning opened; Cancel prevented submission                                                  |
| Warning bypass         | `email.valid`                                                                             | Send anyway submitted exactly once without recursive or duplicate submission                                  |
| Keyboard interception  | Ordinary text and the warning fixture                                                     | Unmodified Enter was intercepted once the semantic Send control was resolved; Shift+Enter was not intercepted |
| Tool-button ambiguity  | Visible **Add files and more** control                                                    | The tool control was not treated as Send                                                                      |
| Strict detector blocks | `paymentCard.validVisa`, `awsAccessKey.longLived`, and a valid minimum-length PEM fixture | Each was blocked without a bypass and without creating a user message                                         |
| Large-paste attachment | Benign synthetic text converted by ChatGPT into an attachment                             | Failed closed with a content-free unsupported-attachment dialog, no Send anyway action, and no user message   |
| Uploaded attachment    | Harmless local text file                                                                  | Failed closed with a content-free unsupported-attachment dialog, no Send anyway action, and no user message   |
| Dialog isolation       | Warning and attachment dialogs                                                            | Rendered sanitized content in an inspectable open Shadow root                                                 |
| Cleanup                | Large-paste and uploaded test attachments                                                 | Both test attachments were removed; existing composer content was preserved                                   |

A too-short PEM-shaped sample was submitted during exploratory QA because it did
not satisfy the detector's minimum valid fixture length. It is not counted as a
detector bypass or as strict-block evidence.

The table above records only checks actually performed in the authenticated
session. Interactive checklist items not represented in the table were not run,
and this document makes no live-pass claim for them.

## Failure reporting

Capture only:

- browser and extension version;
- popup state;
- fixed error/health code;
- fixture identifier;
- DOM variant description without composer contents;
- reproduction steps that contain no user-authored prompt excerpt.

Do not attach storage dumps, page HTML containing prompt text, console logs with
composer values, screenshots exposing fixture values, or copied prompt content.
