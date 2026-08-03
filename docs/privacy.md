# PromptGuard privacy model and data inventory

PromptGuard is designed to make a local enforcement decision without turning
prompt inspection into monitoring or telemetry.

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
| Audit events             | `chrome.storage.local`                     | Bounded by configured retention or manual clear    | Local prompt-free version-3 envelope  |
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
only the categories and rule IDs that contributed to the final action, finding
count, adapter version, timestamp, and optionally a preview made only from
approved placeholders. The controller removes lower-precedence or allowed
matches before dialog, preview, count, or audit construction. Attachment-only
records contain zero findings, no preview, and only the fixed
`attachment.unsupported` rule. A warning uses `attachment_bypassed` only when
that rule contributed; an allowed attachment beside a text warning uses
`bypassed`. Records never contain raw text, matched values, filenames,
attachment counts, prompt excerpts, offsets, or sanitized prompt text.

Audit storage is a V3 envelope, and newly emitted events have adapter version 3.
On first read, V1/V2 audit envelopes are normalized, retention-filtered, and
persisted as V3 before use only when the stored contributor set is provable from
the record. Ambiguous legacy decisions are discarded rather than guessed or
relabeled; valid non-decision events from the same legacy envelope remain.

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

The reachability verifier starts at `manifest.json` and follows the worker,
content scripts/styles, extension pages, icons, HTML assets, and recursive
static local JavaScript imports. It rejects missing references, non-local or
dynamic imports, and source maps; every otherwise-unreachable local asset needs
an explicit allowlist entry, which cannot allow executable, page, or source-map
files. The canonical extension digest is computed only after this graph passes.
CI publishes the verified extension and digest with a `git archive` source
tarball for the same reviewed commit, preserving review provenance without
copying prompt-derived data.

## Future governance terminology

Future documents use these terms narrowly:

- **Detection** is local classification into an approved risk category.
- **Enforcement** is an allow, warn, or block action at a verified submission
  boundary.
- **Audit metadata** is an allowlisted, prompt-free decision or system record.
- **Application visibility** is coarse awareness of an approved AI surface and
  does not imply content access.
- **Content monitoring** makes interaction content available outside the narrow
  local enforcement boundary and is not part of the roadmap.
- **Quarantine** retains content or an artifact for later review and would
  require a separately approved mode.

The proposed future [event taxonomy](architecture/event-taxonomy.md) prohibits
prompt/completion content, matched values, hashes of content, filenames, paths,
commands, full URLs, conversation identifiers, screenshots, and arbitrary
metadata maps. Clean allows remain absent by default. Any aggregate heartbeat,
employee detail, or quarantine mode requires explicit approval, transparency,
RBAC, bounded retention, deletion, and regional controls.
