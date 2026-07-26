# Privacy model and data inventory

AI DLP is designed to make a local enforcement decision without turning prompt
inspection into monitoring or telemetry.

## Raw prompt ownership

Raw prompt text may be accessed transiently by the ChatGPT adapter solely to
read or replace the active composer. It may be retained only by the submission
controller for the lifetime of an active attempt and passed transiently to
detector and redaction functions. The adapter must not cache, log, persist,
message, or retain prompt content after the synchronous operation returns.

`matchedText`, offsets, and redacted prompt text may exist transiently only in
detector, redaction, and submission-controller memory. Before policy or UI is
called, the controller creates separate sanitized models.

The policy engine, React/UI state, runtime messages, service worker, storage,
audit data, and production logs are completely prompt-free.

## Data inventory

| Data                     | Location                                   | Lifetime                                           | Persisted or transmitted             |
| ------------------------ | ------------------------------------------ | -------------------------------------------------- | ------------------------------------ |
| Raw composer text        | Adapter call and active controller attempt | Until the synchronous adapter call or attempt ends | Never                                |
| `matchedText`, offsets   | Detector/redaction/controller memory       | Active attempt only                                | Never                                |
| Policy finding metadata  | Controller and policy engine               | Policy evaluation only                             | Never as original findings           |
| Display finding metadata | Controller and dialog                      | Active dialog only                                 | Placeholder/category/confidence only |
| Settings                 | `chrome.storage.local`                     | Until changed or extension data is removed         | Local version-1 envelope             |
| Audit events             | `chrome.storage.local`                     | Bounded by configured retention or manual clear    | Local prompt-free version-1 envelope |
| Status snapshots         | Settings port and extension pages          | Current connection/page lifetime                   | Not durable                          |
| Attachment presence flag | Adapter/controller active attempt          | Synchronous checks and active attempt only         | Fixed boolean only; no file metadata |

No backend, telemetry endpoint, remote API, analytics SDK, or central audit
collector exists in Milestone 1.

## Persisted settings

The settings envelope contains:

- protection enabled/disabled;
- email and phone actions;
- normalized protected keywords;
- audit retention limit.

Protected keywords are configuration, not prompt excerpts. Settings validation
rejects unknown fields, invalid actions, duplicate/equivalent keywords, and
retention outside 1–1,000. Invalid storage falls back to strict defaults.

## Persisted audit metadata

By default the audit store persists:

- warn, redact, and block decisions;
- privacy-safe enforcement errors;
- coalesced adapter-health errors.

Clean allow decisions are dropped. The decision event shape can represent a
future explicitly configured allow audit, but Milestone 1 neither exposes nor
enables it.

Decision records contain action, resolution, categories, rule IDs, finding
count, adapter version, timestamp, and optionally a preview made only from
approved placeholders. They never contain raw text, matched values, prompt
excerpts, offsets, or sanitized prompt text.

## Oversized prompts

Prompts longer than 100,000 UTF-16 code units are not partially scanned and are
not silently submitted. The attempt stops, a fixed content-free error asks the
user to split the prompt, no send-anyway action is offered, and only a
`prompt_too_large` enforcement event may be stored.

## Attachments and editor replacement

The adapter checks only fixed, composer-scoped attachment-presence evidence. It
never reads or records a filename, path, MIME type, preview, attachment
contents, or accessible text. An attachment produces only the fixed
`unsupported_attachment` enforcement code and cannot be bypassed.

Native textarea replacement uses the native value setter and verifies the
textarea value before resume. Contenteditable and ProseMirror editors are
classified as replacement-unsupported because DOM mutation does not prove their
internal model changed. Those editors are never mutated for redaction; automatic
redaction produces only `redaction_unavailable`.

## Local storage boundary

The service worker restricts `chrome.storage.local` to `TRUSTED_CONTEXTS`, so
ordinary page scripts and the content script cannot read it directly. Browser
profile owners, extension debugging tools, or malware with local profile access
can still inspect local extension storage. The privacy design therefore keeps
stored data non-sensitive rather than treating storage access control as
confidentiality against the device owner.

## Production artifact checks

The production verifier inspects the generated manifest and every generated
HTML, JavaScript, JSON, and CSS file. It rejects remote assets, request APIs,
dynamic code execution, source maps, fixture values, test imports, unreviewed
URLs, unexpected direct production dependencies, and production-source logging.
Framework documentation/error URLs require an exact inert allowlist entry with
justification. The generated URL report records the literal, generated file,
surrounding code, classification, fetching/executable state, and justification.
