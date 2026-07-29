# Threat model

## Assets and security goals

The primary asset is user-authored ChatGPT prompt content before submission. The
extension aims to prevent accidental submission of locally detectable sensitive
values while minimizing its own collection of prompt-derived data.

Security goals are:

- local-only prompt inspection and redaction;
- strict separation between sensitive analysis state and prompt-free policy, UI,
  messaging, logging, and persistence;
- truthful status reporting;
- one-shot, revalidated submission authorization;
- least-privilege MV3 packaging with no remote code or network endpoint.

## Trust boundaries

- The ChatGPT page and its scripts are untrusted and mutable.
- The isolated content-script world reduces JavaScript namespace collisions but
  shares the page DOM.
- The open Shadow root isolates styles/components but is inspectable and
  removable by the host page.
- The extension service worker and extension pages are trusted contexts.
- The browser profile owner and local malware are outside the confidentiality
  boundary of `chrome.storage.local`.
- Build dependencies and generated artifacts are supply-chain boundaries.

## Threats and mitigations

| Threat                                                                 | Mitigation                                                                                                                                                                                      | Residual risk                                                                             |
| ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Host page removes or alters the composer, send control, or dialog host | Central semantic selectors, context versions, live re-resolution, degraded health, stopped captured attempts                                                                                    | A completely new or hostile DOM can prevent reliable interception                         |
| Multiple usable composers share one Send control                       | One shared collector validates all owners; ambiguity is immediately degraded and synchronously stopped without a usable context identity                                                        | Entirely unknown submission mechanisms remain outside the supported adapter path          |
| Recursive or duplicate submission                                      | Synchronous resume guard, controller state machine, one-shot authorization, click/keyboard deduplication                                                                                        | Browser/page behavior outside supported variants may remain unsupported                   |
| Prompt changes after approval                                          | Re-read and compare prompt plus URL, composer, send control, and context version before token consumption                                                                                       | None within the modeled adapter path; unsupported page submission paths are out of scope  |
| Enforcement settings change while a decision is active                 | Each attempt captures an immutable settings snapshot and enforcement revision; changes to enabled state, configurable actions, or keywords cancel active work and stale callbacks cannot resume | A new submission is evaluated under the replacement settings                              |
| Reused or expired approval                                             | Controller-private authorization, five-minute monotonic expiry, post-validation consumption, invalidation on cancel/replace/failure                                                             | User can submit again as a new attempt                                                    |
| Lower-precedence or allowed matches mislead the user or audit          | Policy retains only highest-precedence contributors, then filters transient findings before dialog, preview, counts, and audit metadata                                                         | Audit intentionally does not preserve non-contributing detection telemetry                |
| Prompt leaks into policy or UI                                         | Metadata-only `PolicyFinding`, sanitized `DisplayFinding`, strict validators and compile-time tests                                                                                             | A future contract change must preserve these gates                                        |
| Prompt leaks through messages or storage                               | Closed prompt-free unions, sender validation, trusted-context storage, strict audit validators                                                                                                  | Local profile owners can read stored metadata/settings                                    |
| Accidental logging or fixture leakage                                  | Production-source console ban, artifact scan, source maps disabled, dedicated fixture isolation tests                                                                                           | Vendor code contains inert framework error reporting paths, explicitly reviewed           |
| Stale or hidden generated asset reaches a reviewed package             | Manifest-rooted graph traverses workers, scripts, pages, icons, HTML assets, and static local imports; missing, non-local, dynamic, mapped, or unallowlisted unreachable assets fail            | Graph coverage is limited to declared MV3 artifact reference formats                      |
| Audit migration invents misleading contributor metadata                | V1/V2 records migrate to V3 only when contributors are provable; ambiguous decisions are discarded while valid non-decision history remains                                                     | Some legacy decision history is intentionally unavailable                                 |
| Remote code, telemetry, or data exfiltration                           | No remote dependencies at runtime, no request APIs in app source/artifact, CSP `connect-src 'none'`, URL review, only `storage` permission                                                      | The ChatGPT host page itself remains networked and outside extension control              |
| Message spoofing                                                       | Sender ID, top-frame, origin, URL, schema, generation, and envelope validation; no externally connectable surface                                                                               | Compromised extension context remains trusted by the browser model                        |
| Corrupted settings weaken strict categories                            | Safe defaults plus exact v2 policy validation; invalid attachment values default to warn, never allow                                                                                           | User-configurable email/phone/attachment actions may intentionally allow those categories |
| Oversized input causes partial or expensive scanning                   | Reject over 100,000 UTF-16 units before detection; fixed error and no bypass                                                                                                                    | Large supported prompts still consume local CPU within the tested budget                  |
| Attachment state changes after approval                                | Exact-region presence plus an opaque element-identity/mutation fingerprint is revalidated before authorization consumption and resume                                                           | Attachment contents are not inspected                                                     |
| DOM-only replacement submits stale application state                   | All current ChatGPT editor replacement is unsupported; UI hides redaction and automatic redaction fails closed                                                                                  | Users must edit prompts manually                                                          |
| Extension startup or worker disconnect creates false confidence        | Status remains `initializing`/`waiting_for_composer`/`unavailable`; activation requires settings and a valid composer                                                                           | Submissions during initialization are intentionally not intercepted                       |

## Explicit non-goals and limitations

- The extension is not tamper-proof against the host page, the browser owner, or
  local malware.
- Open Shadow DOM and isolated worlds are not security boundaries.
- Milestone 1 detects composer attachments but does not inspect files, images,
  attachment contents, pasted rich objects, ChatGPT apps, other sites, or
  network requests made by ChatGPT. Local policy can block, warn, or allow
  attachments; warn is the safe default.
- A user can disable protection, disable the extension, or uninstall it in an
  unmanaged environment.
- The reviewed digest and matching source archive establish build provenance;
  they do not make a locally loaded unpacked extension tamper-proof.
- Managed fail-closed startup, forced installation, signed policy, centralized
  audit, and health monitoring are future work.

## Failure posture

Once a supported submission is captured, unresolved detector, policy, UI,
context, or resume errors keep that attempt stopped and show content-free
guidance where possible. Audit failure after a resolved decision is ancillary:
it cannot turn a block into an allow or cause duplicate submission.

Before validated settings initialization completes, no interceptor is
registered. Submissions in that brief interval pass through and status remains
`initializing`, never `active`.

After settings initialization, ordinary delayed composer rendering reports
`waiting_for_composer` without an audit event. The default grace is 10 seconds.
A grace-period expiry or a strong unresolved submission candidate can transition
to one coalesced degraded event; SPA navigation starts a fresh waiting
lifecycle. Disabled protection owns no adapter, controller, dialog, listeners,
observer, timer, or health-audit runtime.
