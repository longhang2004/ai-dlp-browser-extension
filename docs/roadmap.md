# PromptGuard roadmap

PromptGuard's product direction is **Universal AI Interaction DLP and
Governance**. This roadmap defines outcomes and approval gates, not an
implementation schedule. Every milestone after Milestone 1 remains unapproved
until its named gate is accepted.

## Operating principles

- Protect employees before sensitive information leaves a supported AI surface.
- Keep raw interaction content at the narrowest trusted boundary and for the
  shortest possible lifetime.
- Separate detection, enforcement, audit metadata, application visibility,
  content monitoring, and quarantine as different capabilities.
- Prefer verified first-party integration hooks over DOM, process, or network
  observation.
- Add permissions, collection, identity, and retention only when a reviewed
  outcome requires them.
- Never ship remotely supplied executable adapters.

## Milestone 1 — Local ChatGPT protection

Milestone 1 is the current Chromium MV3 vertical slice.

Exit criteria:

- ChatGPT click and Enter submission interception is locally enforced.
- Email, phone, payment-card, AWS-key, private-key, contextual-secret, protected
  keyword, oversized-prompt, and uninspected-attachment policies are covered.
- Active attempts are bound to immutable enforcement settings and a local
  revision.
- Dialog and audit data contain only final-action contributors.
- Audit history migrates conservatively to V3.
- The production artifact is manifest-reachable, source-map-free,
  least-privilege, reproducible, and digest-bound to reviewed source.
- Unit, DOM, performance, artifact, Playwright, CI, and authenticated current-
  ChatGPT QA evidence are recorded with limitations.

Approval gate:

- Milestone 1 may be marked **Ready for re-review** only after its exact final
  SHA, CI artifacts, digest, permissions, CSP, and QA evidence are reviewed.
- Draft PR status is unchanged until a human reviewer changes it.

## Milestone 2 — Verified browser surfaces

Outcome: reuse the browser-independent local detection and policy core across a
small, approved set of web AI applications.

The proposed design package is documented in
[Milestone 2 verified browser surfaces](milestone-2/verified-browser-surfaces-design.md).
It recommends Claude web at the exact `https://claude.ai` origin, but neither
the surface nor its optional permission, capabilities, or implementation is
approved merely by publication of the design.

Exit criteria:

- Proposed `AiSurfaceId`, `AdapterDescriptor`, `AdapterCapabilities`, and
  `AdapterTrust` contracts have an approved specification and threat model.
- Every shipped adapter is classified `verified`, `discovered`, or
  `unsupported`; only verified capabilities can resume or replace content.
- Each new origin has an application-specific selector, submission, attachment,
  privacy, status, and regression test suite.
- Optional host permissions are requested per approved surface, with a usable
  disclosure and a deployment choice that does not silently broaden access.
- Unknown or drifted surfaces fail honestly without claiming active protection.
- No remote executable adapter, page-world injection, broad browsing history, or
  network inspection is introduced.

Approval gate:

- Approve the first additional web surface, exact origin, permission model,
  capability claims, and M2.0/M2.1/M2.2 decomposition before implementation.
- A selected adapter remains unsupported until its exact release artifact passes
  automated and authenticated capability-specific verification.
- Approve each later origin independently; approval of one adapter does not
  approve a wildcard family.

## Milestone 3 — Managed policy and trustworthy events

Outcome: an enrolled installation can receive authoritative policy and emit
privacy-minimized governance events without exporting interaction content.

Exit criteria:

- Enrollment-derived tenant, user, and device identities have documented
  lifecycle, recovery, and deletion behavior.
- Policy is versioned, signed, rollback-protected, cached safely, and bound to a
  defined outage posture.
- `GovernanceEventEnvelope` and `GovernanceEvent` are closed, allowlisted,
  versioned unions with no arbitrary metadata map.
- Event authenticity, replay protection, secure local IPC, retention, regional
  routing, and deletion are verified.
- Clean allows are absent by default; any usage heartbeat is aggregate, bounded,
  sampled, and separately enabled.
- Administrator access and actions use approved `AdminRole` RBAC and produce
  immutable, privacy-safe administrator audit events.

Approval gate:

- Approve identity/enrollment, policy signing and key rotation, event fields,
  clean-activity sampling, regional boundaries, and retention before any
  management-plane production build.

## Milestone 4 — Privacy-safe administration

Outcome: authorized administrators can understand protection coverage and
respond to risk without receiving prompt transcripts.

Exit criteria:

- Overview, employee activity, application inventory, risk trends, health,
  policy, and exception views meet the dashboard privacy contract.
- Aggregate views enforce an approved minimum cohort count.
- Employee-detail access is separately permissioned, purpose-bound, audited,
  time-limited where practical, and transparent to affected employees.
- Filters cannot be combined to reconstruct an individual's content or precise
  activity timeline.
- Retention, export, deletion, incident response, SIEM delivery, and regional
  residency are exercised end to end.
- The interface clearly labels detection, enforcement, audit metadata, and
  application visibility; it does not call them content monitoring.

Approval gate:

- Approve aggregate minimum counts, employee-detail access, dashboard RBAC,
  transparency copy, and export scope before exposing tenant data.

## Milestone 5 — Official-hook-first IDE and CLI governance

Outcome: approved developer AI tools can participate through documented,
official integration hooks.

Exit criteria:

- Each IDE or CLI integration uses an official extension, plugin, wrapper, or
  lifecycle hook that exposes a well-defined submission boundary.
- Command arguments, terminal output, source files, paths, clipboard contents,
  and model responses are excluded unless a later content contract explicitly
  approves a narrow field.
- `AgentActivityCategory` is allowlisted and records coarse activity, not code,
  commands, intent, or employee productivity.
- Capability and trust negotiation prevents an integration from claiming
  enforcement it cannot prove.
- Unsupported tools remain visible only at an approved application-visibility
  level, never through covert content capture.

Approval gate:

- Approve each official hook, activity category, permission, and employee
  disclosure before enabling that integration.

## Milestone 6 — Endpoint trust and optional response modes

Outcome: an endpoint component may extend coverage to approved native surfaces
under an explicit operating-system trust model.

Exit criteria:

- Endpoint-agent identity, signing, update, rollback, secure IPC, tamper
  evidence, least privilege, and uninstall/recovery behavior are independently
  threat-modeled.
- The endpoint protocol rejects replay, downgrade, cross-tenant identity, and
  untrusted adapter claims.
- Process and application visibility is distinguished from content access.
- Regional routing, offline policy, event queues, deletion, and incident
  response are verified under failure.
- Any quarantine capability is a separately approved mode with purpose, scope,
  user notice, access controls, expiry, release, deletion, and audit; it is not
  enabled by endpoint-agent deployment alone.

Approval gate:

- Approve the endpoint protocol and operating-system privileges before agent
  implementation.
- Approve any quarantine mode separately after legal, privacy, security,
  employee-relations, and incident-response review.

## Unresolved product decisions requiring approval

- Aggregate minimum counts and resistance to filter-based re-identification.
- Whether clean activity is collected at all and, if so, its sampling and
  heartbeat bounds.
- Employee-detail access, purpose limitation, transparency, and review cadence.
- Tenant, user, and device identity and enrollment lifecycle.
- Policy and artifact signing, trust roots, rollback, and key rotation.
- Endpoint protocol, privileges, offline posture, and update channel.
- Regional residency, cross-region operations, deletion, and SIEM boundaries.
- Optional host-permission packaging and managed deployment choices.
- Whether any future quarantine mode should exist and its separate safeguards.
