# Management plane architecture

The management plane is future work. It distributes authoritative policy and
accepts privacy-minimized governance events; it does not receive executable
adapters or interaction content.

## Identity and enrollment

Enrollment creates separate opaque identities for:

- tenant;
- human subject, when employee-level policy is approved;
- managed device; and
- PromptGuard installation.

Identity is derived from an approved enrollment authority, not user-entered
labels, browser profile names, email scraped from a page, device hostnames, or
network addresses. Re-enrollment, ownership transfer, offboarding, device loss,
duplicate installation, recovery, and deletion require explicit state
transitions and administrator audit.

## Signed policy

Managed policy is a versioned data contract with:

- tenant and scope binding;
- monotonic version and issuance/expiry bounds;
- signed content and algorithm/key identifier;
- minimum supported client version;
- explicit adapter and capability allowlists;
- local/managed precedence;
- cached-policy and outage posture; and
- rollback authorization distinct from ordinary update authority.

Clients verify policy before exposure. A policy cannot ship executable code,
dynamic imports, scripts, Wasm, remote assets, or selector expressions with
execution semantics.

Trust roots are pinned through an approved release or enrollment ceremony. Key
rotation supports overlap, revocation, compromise recovery, and auditable
rollback without accepting an unsigned fail-open policy.

## Secure local IPC

A future browser-extension/endpoint-agent channel requires mutual
authentication, process and installation binding, message versioning, explicit
method allowlists, size and rate bounds, anti-replay nonces or sequences,
timeouts, cancellation, and prompt-free errors.

The browser extension treats the endpoint as a separate principal. The agent
cannot assert a verified adapter or policy version without attestation accepted
by the extension's local allowlist.

## Event authenticity and replay protection

Governance events are:

- validated against a closed union before transmission;
- bound to tenant, installation, policy version, event ID, and sequence;
- authenticated in transit and at ingestion;
- rejected on duplicate, downgrade, cross-tenant, impossible-capability, or
  unsupported-version evidence; and
- stored only in the approved region and retention class.

Ingestion does not retain rejected raw payloads if they could contain prohibited
fields. Fixed rejection codes and bounded counters are sufficient for
diagnostics.

## RBAC

Proposed documentation contract:

```ts
type AdminRole =
  | "security_admin"
  | "policy_admin"
  | "privacy_auditor"
  | "integration_admin"
  | "support_observer"
  | "read_only_analyst";
```

Roles are deny-by-default and scoped by tenant and region:

| Role                | Primary permissions                                                |
| ------------------- | ------------------------------------------------------------------ |
| `security_admin`    | Investigate approved risk metadata and manage incidents            |
| `policy_admin`      | Draft policy; production publication needs separate approval       |
| `privacy_auditor`   | Review access, retention, deletion, and administrator audit        |
| `integration_admin` | Manage enrollment, signed integrations, SIEM, and health           |
| `support_observer`  | View fixed health/status data without employee or decision details |
| `read_only_analyst` | View approved aggregates above minimum-count thresholds            |

High-risk changes—policy publication, key rotation, retention increase,
employee-detail access, export enablement, regional movement, and deletion
override—require step-up authentication and, where approved, four-eyes review.

Every administrator read of employee detail, export, policy change, role change,
exception action, key operation, deletion, and incident override creates an
allowlisted administrator-audit event. Administrator audit contains no
interaction content.

## Retention, deletion, and regional boundaries

Retention is bounded per event kind and tenant policy, with a product maximum
that administrators cannot exceed. Deletion covers primary stores, indexes,
caches, exports controlled by PromptGuard, and bounded backup expiry. Tenant
offboarding has a documented completion proof.

Each tenant has an approved home region. Collection, storage, processing,
support access, analytics, backups, disaster recovery, and SIEM delivery follow
that boundary. Cross-region movement requires an explicit legal and product
basis and administrator audit.

## SIEM export

SIEM export maps only allowlisted governance fields. It is tenant-scoped,
mutually authenticated, rate-limited, replay-safe, region-aware, and observable
through fixed delivery status. It does not provide a generic webhook payload,
raw event passthrough, or arbitrary templating.

Export documentation states that downstream retention and access become the
customer's responsibility, without using that transfer to weaken PromptGuard's
own minimization.

## Incident response

The operating model covers:

- signing-key compromise;
- cross-tenant or regional routing errors;
- replay or identity collision;
- prohibited-field ingestion;
- unauthorized employee-detail access;
- policy rollback or outage;
- endpoint or adapter compromise; and
- deletion or retention failure.

Response includes containment, evidence preservation limited to approved
metadata, customer and employee notification criteria, key/policy recovery,
deletion remediation, post-incident review, and administrator audit.

## Unresolved product decisions requiring approval

- Tenant/user/device/installation identity and enrollment authority.
- Employee-detail access, step-up, four-eyes, and transparency requirements.
- Policy signing algorithms, trust roots, rollback, and key rotation.
- Endpoint IPC protocol, attestation, privileges, and offline behavior.
- Event authenticity, sequence recovery, and maximum queue bounds.
- Regional residency, support access, disaster recovery, and SIEM destinations.
- Retention maxima, deletion SLAs, backup expiry, and legal-hold governance.
- Optional host-permission deployment ownership.
- Whether a separately approved quarantine service should ever exist.
