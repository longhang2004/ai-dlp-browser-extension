# Milestone 2 surface selection

## Recommendation

```text
Recommended application: Claude web
Exact origin: https://claude.ai
Proposed adapter ID: claude
Proposed surface ID: claude_web
Initial trust: unsupported
Capabilities targeted for verification: submission detection; local prompt read; attachment-presence detection; submission resume
Capabilities required to remain unsupported in M2.2: attachment inspection; prompt replacement
Proposed M2.2 permission: optional_permissions entry scripting plus optional_host_permissions entry https://claude.ai:443/*, requested together from one explicit click and subject to supported-browser proof
QA prerequisites: dedicated authenticated account; synthetic fixtures; exact SHA, CI run, digest, artifact file count, browser/version, date/timezone, account tier, adapter version, permission, trust, and capabilities; no retained prompt, conversation, filename, account identifier, screenshot, HTML, cookie, or token data
Primary drift risks: composer/Send ownership; voice-to-Send state changes; attachment representation; SPA replacement; semantic attribute changes
Rollback posture: dispose active Claude runtimes, unregister only Claude's script, report unsupported or transport unavailable once no validated port remains, and remove only Claude's catalog/permission entry in a follow-up release
Why this surface should be first: current privacy-safe authenticated structural evidence identifies one exact composer and nearby semantic Send control, and official documentation establishes web, Team, Enterprise, and attachment relevance
Why the other candidates should wait: authenticated submission/resume evidence is unavailable; Copilot also splits the consumer and Microsoft 365 experiences across materially different origins
```

`unsupported` is mandatory during design and permission evaluation. An M2.2
Claude verification candidate may encode a proposed `trust: "verified"`
descriptor only to exercise final behavior in the named authenticated-QA cohort;
the field is not production acceptance. `verified` is an external human/release
acceptance decision bound to the exact SHA and digest. The exact artifact's
runtime and options copy remains “Claude verification candidate” before and
after acceptance, and no local or network-controlled flag can promote it. Signed
publication and release metadata may state production acceptance and verified
status after the gate, but the artifact is not rebuilt or substituted. Failure
to prove any of the four verification targets removes the executable catalog
entry before merge/publication; capability downgrade is not a fallback.

Chrome's official
[match-pattern documentation](https://developer.chrome.com/docs/extensions/develop/concepts/match-patterns)
documents an explicit port and wildcard behavior when it is omitted. The
proposed M2.2 pattern is `https://claude.ai:443/*`; before implementation a
supported-browser proof must cover the MV3 declaration,
`permissions.request/contains/remove`, `registerContentScripts`, and
default-versus-alternate-port matching. A concrete supported-browser rejection
must be recorded before the exact-host/wildcard-port `https://claude.ai/*`
fallback is explicitly proposed; fallback is never silent. The bootstrap's first
executable guard must still require serialized
`location.origin === "https://claude.ai"` before adapter construction or DOM
access and exit otherwise; background validation repeats the check.
Alternate-port tests prove no adapter construction, interception, page read,
accepted port, status, or audit.

Revocation of either host access or optional `scripting` invalidates the
background generation synchronously, so authorization, status, and audit from
the old runtime are rejected and the surface is reported inactive immediately.
Disposal must be acknowledged. If the runtime fails or does not respond, the UI
gives refresh guidance and makes no protection claim: already injected code may
continue observing or intercepting local submissions until disposal
acknowledgement or reload. Both acknowledged and failed or unresponsive disposal
are required tests.

## Evidence rules

Evidence was collected from official vendor documentation and privacy-safe
authenticated inspection where available. Product pages establish current origin
identity and vendor documentation establishes advertised capabilities; neither
proves DOM ownership, interception, or resume safety. Generated CSS classes,
third-party automation scripts, and blog posts are not evidence.

Authenticated inspection records only structural attributes and outcomes. It
must not retain real prompt or conversation content, filenames, attachment
metadata, account identifiers, HTML dumps, screenshots with user data, cookies,
or tokens. Every unobserved DOM or submission property below is explicitly
`unavailable`.

## Comparison summary

| Candidate         | Exact origin                    | Enterprise relevance                                  | Authenticated DOM/submission evidence | Decision |
| ----------------- | ------------------------------- | ----------------------------------------------------- | ------------------------------------- | -------- |
| Claude web        | `https://claude.ai`             | High                                                  | Partial structural evidence           | First    |
| Gemini web        | `https://gemini.google.com`     | High                                                  | unavailable                           | Wait     |
| Perplexity web    | `https://www.perplexity.ai`     | High                                                  | unavailable                           | Wait     |
| DeepSeek web      | `https://chat.deepseek.com`     | Unproven in this review                               | unavailable                           | Wait     |
| Microsoft Copilot | `https://copilot.microsoft.com` | High, but consumer surface differs from Microsoft 365 | unavailable                           | Wait     |

## Evidence matrix

Each candidate subsection uses the same fields required for selection.

### Claude web

| Field                                      | Evidence                                                                                                                                                                                                                     |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Exact current origin(s)                    | `https://claude.ai`; the official product redirects unauthenticated users to that origin's login page.                                                                                                                       |
| Login required for meaningful QA           | Yes; authenticated composer, attachments, submission, and resume require a dedicated QA account.                                                                                                                             |
| Enterprise relevance                       | High. Claude's official product lists Team and Enterprise, and its [file-creation guidance](https://support.claude.com/en/articles/12111783-create-and-edit-files-with-claude) describes web, Team, and Enterprise controls. |
| Composer implementation                    | On 2026-07-30, privacy-safe authenticated inspection found one element with `role="textbox"`, `contenteditable="true"`, and `data-testid="chat-input"`.                                                                      |
| Click submission path                      | A nearby `aria-label="Send message"` control appeared after synthetic text was entered and removed; click submission was not performed, so end-to-end evidence is unavailable.                                               |
| Enter submission path                      | unavailable                                                                                                                                                                                                                  |
| Shift+Enter and IME behavior               | unavailable                                                                                                                                                                                                                  |
| Attachment support and state observability | Official [Claude file-upload guidance](https://support.claude.com/en/articles/8241126-upload-files-to-claude) documents uploads; authenticated attachment-state DOM evidence is unavailable.                                 |
| SPA navigation behavior                    | unavailable                                                                                                                                                                                                                  |
| Exact active composer identifiable         | One candidate was identifiable in the observed state; alternate states and replacement behavior are unavailable.                                                                                                             |
| Send maps unambiguously to composer        | Nearby semantic control observed; ownership across variants is unavailable.                                                                                                                                                  |
| Safe resume demonstrated                   | unavailable                                                                                                                                                                                                                  |
| Prompt replacement demonstrated            | unavailable; required to remain unsupported in the initial M2.2 adapter.                                                                                                                                                     |
| Current selector stability                 | Partial semantic/data-attribute evidence from one observation; longitudinal stability unavailable.                                                                                                                           |
| Accessibility semantics                    | `role="textbox"` and Send accessible label observed.                                                                                                                                                                         |
| Application drift risk                     | High around composer/Send ownership, empty/voice states, attachments, SPA replacement, and semantic attributes.                                                                                                              |
| Official browser integration documentation | Product and file behavior exist; no official extension interception/resume contract was found.                                                                                                                               |
| Non-sensitive authenticated QA             | Feasible with a dedicated account and synthetic fixtures; submission was intentionally not attempted during selection.                                                                                                       |
| Permission scope                           | M2.2 proposes optional `scripting` plus `https://claude.ai:443/*`, requested together and subject to supported-browser proof; runtime origin must equal `https://claude.ai`.                                                 |
| Rollback                                   | Dispose active Claude state, unregister its versioned script, reject stale ports, show unsupported/transport unavailable once no validated port remains, and remove only Claude in a follow-up release.                      |
| Known restrictions or anti-automation      | unavailable                                                                                                                                                                                                                  |

### Gemini web

| Field                                      | Evidence                                                                                                                                       |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Exact current origin(s)                    | `https://gemini.google.com` from the official [Gemini web application](https://gemini.google.com/).                                            |
| Login required for meaningful QA           | Yes for account-bound and file scenarios; Google's [file-upload guidance](https://support.google.com/gemini/answer/14903178) requires sign-in. |
| Enterprise relevance                       | High because work/school accounts and administrator enablement are documented in the official upload guidance.                                 |
| Composer implementation                    | unavailable                                                                                                                                    |
| Click submission path                      | unavailable                                                                                                                                    |
| Enter submission path                      | unavailable                                                                                                                                    |
| Shift+Enter and IME behavior               | unavailable                                                                                                                                    |
| Attachment support and state observability | File upload is officially documented; DOM observability unavailable.                                                                           |
| SPA navigation behavior                    | unavailable                                                                                                                                    |
| Exact active composer identifiable         | unavailable                                                                                                                                    |
| Send maps unambiguously to composer        | unavailable                                                                                                                                    |
| Safe resume demonstrated                   | unavailable                                                                                                                                    |
| Prompt replacement demonstrated            | unavailable                                                                                                                                    |
| Current selector stability                 | unavailable                                                                                                                                    |
| Accessibility semantics                    | unavailable                                                                                                                                    |
| Application drift risk                     | Unknown because authenticated structural evidence is unavailable.                                                                              |
| Official browser integration documentation | Product help exists; no official extension interception/resume contract was found.                                                             |
| Non-sensitive authenticated QA             | Feasible in principle; no dedicated authenticated session was available for this review.                                                       |
| Permission scope                           | If independently approved: exact optional pattern `https://gemini.google.com/*`.                                                               |
| Rollback                                   | An independent Gemini entry would be disposed and unregistered without affecting other origins.                                                |
| Known restrictions or anti-automation      | unavailable                                                                                                                                    |

### Perplexity web

| Field                                      | Evidence                                                                                                                                                                                              |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Exact current origin(s)                    | `https://www.perplexity.ai` from the official [Perplexity web application](https://www.perplexity.ai/).                                                                                               |
| Login required for meaningful QA           | Treat as required for stable account, attachment, and enterprise scenarios.                                                                                                                           |
| Enterprise relevance                       | High. Official [Enterprise connector guidance](https://www.perplexity.ai/help-center/en/articles/10672063-introduction-to-file-connectors-for-enterprise-organizations) documents organizational use. |
| Composer implementation                    | unavailable                                                                                                                                                                                           |
| Click submission path                      | unavailable                                                                                                                                                                                           |
| Enter submission path                      | unavailable                                                                                                                                                                                           |
| Shift+Enter and IME behavior               | unavailable                                                                                                                                                                                           |
| Attachment support and state observability | Official [file-upload guidance](https://www.perplexity.ai/help-center/en/articles/10354807-file-uploads) documents an Attach control and drag/drop; DOM observability unavailable.                    |
| SPA navigation behavior                    | unavailable                                                                                                                                                                                           |
| Exact active composer identifiable         | unavailable                                                                                                                                                                                           |
| Send maps unambiguously to composer        | unavailable                                                                                                                                                                                           |
| Safe resume demonstrated                   | unavailable                                                                                                                                                                                           |
| Prompt replacement demonstrated            | unavailable                                                                                                                                                                                           |
| Current selector stability                 | unavailable                                                                                                                                                                                           |
| Accessibility semantics                    | unavailable                                                                                                                                                                                           |
| Application drift risk                     | Unknown because authenticated structural evidence is unavailable.                                                                                                                                     |
| Official browser integration documentation | Product help exists; no official extension interception/resume contract was found.                                                                                                                    |
| Non-sensitive authenticated QA             | Feasible in principle; no dedicated authenticated session was available for this review.                                                                                                              |
| Permission scope                           | If independently approved: exact optional pattern `https://www.perplexity.ai/*`.                                                                                                                      |
| Rollback                                   | An independent Perplexity entry would be disposed and unregistered without affecting other origins.                                                                                                   |
| Known restrictions or anti-automation      | unavailable                                                                                                                                                                                           |

### DeepSeek web

| Field                                      | Evidence                                                                                               |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| Exact current origin(s)                    | `https://chat.deepseek.com` from the official [DeepSeek chat application](https://chat.deepseek.com/). |
| Login required for meaningful QA           | Treat as required for a stable authenticated submission and attachment review.                         |
| Enterprise relevance                       | unavailable                                                                                            |
| Composer implementation                    | unavailable                                                                                            |
| Click submission path                      | unavailable                                                                                            |
| Enter submission path                      | unavailable                                                                                            |
| Shift+Enter and IME behavior               | unavailable                                                                                            |
| Attachment support and state observability | unavailable                                                                                            |
| SPA navigation behavior                    | unavailable                                                                                            |
| Exact active composer identifiable         | unavailable                                                                                            |
| Send maps unambiguously to composer        | unavailable                                                                                            |
| Safe resume demonstrated                   | unavailable                                                                                            |
| Prompt replacement demonstrated            | unavailable                                                                                            |
| Current selector stability                 | unavailable                                                                                            |
| Accessibility semantics                    | unavailable                                                                                            |
| Application drift risk                     | Unknown because authenticated structural evidence is unavailable.                                      |
| Official browser integration documentation | No official browser interception/resume contract was found.                                            |
| Non-sensitive authenticated QA             | unavailable during this review.                                                                        |
| Permission scope                           | If independently approved: exact optional pattern `https://chat.deepseek.com/*`.                       |
| Rollback                                   | An independent DeepSeek entry would be disposed and unregistered without affecting other origins.      |
| Known restrictions or anti-automation      | unavailable                                                                                            |

### Microsoft Copilot web

| Field                                      | Evidence                                                                                                                                                                                                                                                                             |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Exact current origin(s)                    | Consumer `copilot_web` is `https://copilot.microsoft.com`, from the official [Microsoft Copilot web application](https://copilot.microsoft.com/). `https://m365.cloud.microsoft` is a separate, unapproved Microsoft 365 surface.                                                    |
| Login required for meaningful QA           | Treat as required for stable account, file, and enterprise scenarios.                                                                                                                                                                                                                |
| Enterprise relevance                       | High, but consumer and Microsoft 365 product surfaces must not be conflated. Microsoft's [consumer file-upload guidance](https://support.microsoft.com/en-US/microsoft-copilot/file-upload-in-microsoft-copilot) explicitly redirects work users to Microsoft 365-specific guidance. |
| Composer implementation                    | unavailable                                                                                                                                                                                                                                                                          |
| Click submission path                      | unavailable                                                                                                                                                                                                                                                                          |
| Enter submission path                      | unavailable                                                                                                                                                                                                                                                                          |
| Shift+Enter and IME behavior               | unavailable                                                                                                                                                                                                                                                                          |
| Attachment support and state observability | Consumer file upload is officially documented; DOM observability unavailable.                                                                                                                                                                                                        |
| SPA navigation behavior                    | unavailable                                                                                                                                                                                                                                                                          |
| Exact active composer identifiable         | unavailable                                                                                                                                                                                                                                                                          |
| Send maps unambiguously to composer        | unavailable                                                                                                                                                                                                                                                                          |
| Safe resume demonstrated                   | unavailable                                                                                                                                                                                                                                                                          |
| Prompt replacement demonstrated            | unavailable                                                                                                                                                                                                                                                                          |
| Current selector stability                 | unavailable                                                                                                                                                                                                                                                                          |
| Accessibility semantics                    | unavailable                                                                                                                                                                                                                                                                          |
| Application drift risk                     | High because product tiers use materially different origins and may have different composers.                                                                                                                                                                                        |
| Official browser integration documentation | Product help exists; no official extension interception/resume contract was found.                                                                                                                                                                                                   |
| Non-sensitive authenticated QA             | Requires separate consumer and, if later proposed, Microsoft 365 review; unavailable here.                                                                                                                                                                                           |
| Permission scope                           | If independently approved for consumer only: exact optional pattern `https://copilot.microsoft.com/*`; no Microsoft 365 pattern.                                                                                                                                                     |
| Rollback                                   | An independent consumer Copilot entry would be disposed and unregistered without affecting Microsoft 365 or other origins.                                                                                                                                                           |
| Known restrictions or anti-automation      | unavailable                                                                                                                                                                                                                                                                          |

## Selection conclusion

Claude has the strongest current combination of enterprise relevance, official
file support, and privacy-safe structural evidence. The evidence does not yet
prove click or Enter capture, exact Send ownership, attachment presence,
one-shot resume, or editor replacement. Those gaps are why Claude starts
unsupported. Submission detection, local prompt read, attachment-presence
detection, and submission resume are all hard M2.2 merge/publication gates;
failure to prove any one removes the executable Claude catalog entry without a
capability downgrade or rebuild. Attachment inspection and prompt replacement
remain unconditionally unsupported in initial M2.2; future support requires a
separate approved design and evidence cycle. Gemini, Perplexity, DeepSeek, and
Copilot wait for their own authenticated evidence and independent origin
approval.
