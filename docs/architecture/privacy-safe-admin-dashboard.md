# Privacy-safe administrator dashboard

The future dashboard is an operational and governance surface, not a prompt
viewer or employee-productivity system. It consumes only approved management-
plane contracts and cannot request content from an adapter or endpoint.

## Shared controls

Every view applies:

- tenant and region isolation;
- deny-by-default `AdminRole` authorization;
- explicit time range bounded by event retention;
- minimum-count aggregation before cohort data is shown;
- suppression of sparse filters and cross-filter combinations;
- purpose and data-source labels;
- employee-facing transparency references;
- export controls narrower than on-screen access; and
- administrator auditing for sensitive reads and all mutations.

No view displays prompts, completions, matched values, previews, filenames,
paths, commands, window titles, conversation identifiers, full URLs, or page
metadata.

## Overview

Shows verified coverage, degraded/unsupported surface counts, aggregate warn and
block outcomes, expiring exceptions, policy freshness, and component health.

It distinguishes:

- **Detection:** an allowlisted category was found locally.
- **Enforcement:** an allow, warn, or block action was applied.
- **Audit metadata:** prompt-free evidence of a decision or system event.
- **Application visibility:** a coarse approved surface was observed.
- **Content monitoring:** collection of interaction content; not provided.
- **Quarantine:** separate retention of content/artifacts; not provided.

## Employee activity

Default employee activity is cohort-level and thresholded. It may show aggregate
policy outcomes and supported-surface coverage, never a chronological prompt or
usage feed.

Employee detail, if approved, is a separate route requiring a stronger role,
declared purpose, step-up authentication, bounded date range, reason capture,
administrator audit, and visible employee policy. It still contains only
allowlisted metadata. It cannot be used for performance evaluation.

## Application inventory

Shows approved `AiSurface`, adapter trust, verified capabilities, installed
version, policy freshness, health, and last coarse heartbeat bucket. A
`discovered` application is application visibility only; it does not imply that
PromptGuard read content or enforced policy.

Inventory does not expose browsing history, full URLs, window titles, process
arguments, repository names, or per-employee launch timelines.

## Risk trends

Shows thresholded trends by allowlisted category, action, resolution, surface,
policy version, and coarse time bucket. It suppresses small cohorts and
combinations that could isolate a person.

The dashboard labels changes as counts or rates, not intent, negligence, or
productivity. It exposes policy/configuration changes alongside trends so
administrators do not mistake detection changes for employee behavior changes.

## Health

Shows adapter, agent, policy-sync, event-delivery, signing-key, regional, and
retention/deletion health using fixed codes. Support observers can access this
view without employee or decision detail.

Health events remain prompt-free and must not embed vendor errors, stack traces,
paths, hostnames, or payloads.

## Policy

Supports viewing, drafting, comparing, approving, publishing, and rolling back
signed policy under role separation. It shows affected surfaces and
capabilities, outage behavior, local/managed precedence, validation results,
signatures, and effective version.

Production publication, rollback, retention increase, and permission expansion
require step-up and any approved four-eyes gate. The dashboard never supplies
executable adapter content.

## Exceptions

Shows subject/scope identifiers, policy rule, business justification category,
approver, creation and expiry, review state, and status. Free-form justification
must be tightly bounded or replaced with allowlisted categories to prevent
prompt content from being pasted into the system.

Exceptions expire by default, cannot grant capabilities an adapter does not
verify, and produce administrator audit on create, approve, deny, renew, revoke,
and use where technically provable without content.

## Aggregation and retention

The minimum cohort count is an unresolved approval. Whatever value is chosen:

- thresholding happens before results leave the query boundary;
- totals and percentages are suppressed together;
- filter combinations and exports cannot bypass suppression;
- repeated queries are protected against differencing attacks; and
- employee detail is not implemented as a cohort size of one.

Dashboard caches never outlive the underlying event class. Export expiry is
bounded and revocation-aware. Deletion propagates to materialized views and
search indexes.

## Optional quarantine mode

Quarantine is not a dashboard feature hidden behind a role. It would require a
separate approved product mode and storage boundary with:

- narrowly defined content/artifact types and trigger conditions;
- employee notice and an approved legal basis;
- encryption and separate access roles;
- dual control for viewing or release;
- immutable access, export, release, and deletion audit;
- short default expiry and verified deletion;
- incident-only use rather than routine browsing; and
- regional, backup, SIEM, and breach-response rules.

Until that approval exists, the dashboard may show a fixed enforcement outcome
but cannot retrieve or reconstruct the underlying content.

## Unresolved product decisions requiring approval

- Aggregate minimum count, time-bucket size, and differencing defenses.
- Whether clean activity or usage heartbeats appear at all.
- Employee-detail access, purpose capture, step-up, transparency, and audit.
- Identity/enrollment mapping visible to each role.
- Signing/key-rotation controls exposed in the policy view.
- Endpoint health and protocol details safe for display.
- Regional residency, support access, exports, retention, and deletion.
- Optional host-permission inventory and deployment controls.
- Whether a separately governed quarantine mode should ever be approved.
