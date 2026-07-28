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

| Data                     | Location                                   | Lifetime                                           | Persisted or transmitted              |
| ------------------------ | ------------------------------------------ | -------------------------------------------------- | ------------------------------------- |
| Raw composer text        | Adapter call and active controller attempt | Until the synchronous adapter call or attempt ends | Never                                 |
| `matchedText`, offsets   | Detector/redaction/controller memory       | Active attempt only                                | Never                                 |
| Policy finding metadata  | Controller and policy engine               | Policy evaluation only                             | Never as original findings            |
| Display finding metadata | Controller and dialog                      | Active dialog only                                 | Placeholder/category/confidence only  |
| Settings                 | `chrome.storage.local`                     | Until changed or extension data is removed         | Local version-2 envelope              |
| Audit events             | `chrome.storage.local`                     | Bounded by configured retention or manual clear    | Local prompt-free version-2 envelope  |
| Status snapshots         | Settings port and extension pages          | Current connection/page lifetime                   | Not durable                           |
| Attachment presence flag | Adapter/controller active attempt          | Synchronous checks and active attempt only         | Fixed boolean only; no file metadata  |
| Attachment fingerprint   | Adapter/controller active attempt          | Replaced on structural identity or mutation change | Opaque identity only; never persisted |

No backend, telemetry endpoint, remote API, analytics SDK, or central audit
collector exists in Milestone 1.

## Persisted settings

The settings envelope contains:

- protection enabled/disabled;
- email, phone, and attachment actions;
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

Decision records contain action, resolution, reason code, attachment presence,
categories, rule IDs, finding count, adapter version, timestamp, and optionally
a preview made only from approved placeholders. Attachment-only records contain
zero findings, no preview, and only the fixed `attachment.unsupported` rule.
They never contain raw text, matched values, filenames, attachment counts,
prompt excerpts, offsets, or sanitized prompt text.

## Oversized prompts

Prompts longer than 100,000 UTF-16 code units are not partially scanned and are
not silently submitted. The attempt stops, a fixed content-free error asks the
user to split the prompt, no send-anyway action is offered, and only a
`prompt_too_large` enforcement event may be stored.

## Attachments and editor replacement

The adapter checks only fixed attachment-presence evidence within the exact
composer-owned submission region. That region includes the active composer,
associated Send control, and attachment chips/previews even when those are
siblings of a nested form. It builds an opaque fingerprint exclusively from
structural element identity and mutation versioning. It never reads or records a
filename, path, extension, MIME type, size, preview, attachment contents, label,
accessible text, or HTML.

The attachment setting is `block`, `warn`, or `allow`, defaulting to `warn`.
Warning bypass is one-shot and is invalidated by any prompt, navigation,
composer, region, Send ownership, attachment-presence, or fingerprint change.
New decisions use the fixed `attachment.unsupported` policy rule and
`unsupported_attachment` reason; they do not emit an unsupported-attachment
enforcement error. That error code remains readable only for migrated history.

Every current ChatGPT editor, including native textarea, contenteditable, and
ProseMirror variants, is replacement-unsupported. A DOM property equality check
does not prove which application-state value ChatGPT will submit. The adapter
therefore never mutates a composer for redaction, warning dialogs never offer
redaction, and any legacy/internal automatic-redact decision produces only
`redaction_unavailable` without resumed submission. The pure local redaction
algorithm remains independently tested for future verified integrations.

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
