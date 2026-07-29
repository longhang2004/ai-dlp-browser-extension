# Universal AI Interaction DLP and Governance

PromptGuard helps employees use AI tools safely while giving organizations
evidence that approved protections are present and healthy. It is not a system
for reading employee conversations, ranking productivity, or reconstructing
work.

## Employee safety

Employees should receive protection at the moment an interaction crosses a
verified AI submission boundary. The product should:

- detect approved sensitive-data categories locally where possible;
- apply clear allow, warn, or block policy before submission;
- explain the category and consequence without echoing matched content;
- make warnings deliberate, accessible, and one-shot;
- fail honestly when a surface or capability is unsupported;
- show what metadata may leave the device and how long it is retained; and
- provide a visible path for policy exceptions and correction of false
  positives.

Detection means identifying an allowlisted risk category. Enforcement means
applying the policy action at a verified submission boundary. Neither term means
that administrators receive the underlying interaction.

## Administrator outcomes

Authorized administrators need to answer bounded questions:

- Which approved AI applications have verified protection?
- Which surfaces are discovered but unsupported?
- Are policy and endpoint components healthy and current?
- Which risk categories and policy outcomes are trending at an aggregate level?
- Which exceptions are active, expiring, or awaiting review?
- Are retention, regional, export, and deletion controls operating as approved?

These outcomes use privacy-minimized governance events. Audit metadata is a
closed record of a policy or system event. Application visibility identifies an
approved application or surface at a coarse level. Neither is content
monitoring.

## Non-surveillance position

PromptGuard will not use protection data to infer performance, effort,
sentiment, intent, attendance, or productivity. It will not collect prompt
transcripts, model responses, filenames, paths, window titles, command lines, or
conversation identifiers for dashboard convenience.

Content monitoring would mean collecting or making interaction content available
beyond the narrow local enforcement boundary. It is not part of the roadmap. A
future request for any content field requires a separate product, privacy,
security, legal, and employee-transparency approval; it cannot be introduced as
an event-schema extension.

Quarantine would mean retaining content or an artifact for later administrator
review. It is not audit metadata and is not enabled by management-plane or
endpoint-agent adoption. If ever proposed, it must be a separately approved mode
with explicit notice, access purpose, retention, release, deletion, and
administrator auditing.

## Product boundaries

The browser-independent core should remain deterministic and unaware of DOM,
operating-system, tenant, or dashboard concerns. Surface adapters prove what
they can observe and enforce. Management services distribute signed policy and
accept allowlisted events. Administrative experiences consume only data their
role and purpose permit.

The product prefers:

1. official application hooks;
2. verified browser adapters with narrow host scope;
3. discovered application visibility with no enforcement claim; and
4. an explicit unsupported state.

It does not download executable adapter logic, treat heuristic discovery as
enforcement, or silently expand permissions.

## Success measures

Product success is safer AI adoption with:

- high verified coverage of approved surfaces;
- low false confidence about unsupported surfaces;
- fast, accessible local decisions;
- fewer risky submissions without routine content collection;
- healthy policy and adapter deployment;
- bounded exception lifetimes; and
- demonstrable privacy, RBAC, retention, deletion, and regional compliance.

Employee activity volume is not a productivity metric and must not become one.

## Unresolved product decisions requiring approval

- Aggregate minimum counts and resistance to re-identification.
- Clean-activity sampling and whether usage heartbeats should exist.
- Employee-detail access and transparency expectations.
- Identity/enrollment and separation of human, device, and installation
  identity.
- Signing, trust roots, and key-rotation ownership.
- Endpoint protocol and operating-system trust assumptions.
- Regional residency and cross-region support operations.
- Optional host-permission deployment choices.
- Whether a separately governed quarantine mode should ever be designed.
