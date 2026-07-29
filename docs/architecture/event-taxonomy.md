# Governance event taxonomy

Future governance events must answer an approved operational or security
question without becoming a channel for interaction content. These contracts are
documented proposals only; Milestone 1 continues to use its local audit V3
contract.

## Envelope contract

```ts
type GovernanceEventEnvelope = {
  readonly schemaVersion: 1;
  readonly eventId: string;
  readonly occurredAt: string;
  readonly tenantId: string;
  readonly deviceId: string;
  readonly installationId: string;
  readonly subject:
    | { readonly kind: "enrolled_user"; readonly subjectId: string }
    | { readonly kind: "tenant_aggregate" };
  readonly sequence: number;
  readonly policyVersion: string;
  readonly event: GovernanceEvent;
};
```

Tenant, device, installation, and subject identifiers are enrollment-derived
opaque values. An enrolled-user subject is present only for approved event kinds
and employee-detail policy; aggregate events use `tenant_aggregate`.
`occurredAt` is the event time required for replay handling, not permission to
build a precise employee timeline. Transport adds authentication and regional
routing outside the event body. Unknown fields, event kinds, schema versions,
and enum values are rejected.

There is no `metadata`, `attributes`, `properties`, `context`, or arbitrary
key/value map.

## Closed event union

```ts
type AgentActivityCategory =
  | "interaction_attempted"
  | "policy_decision_applied"
  | "adapter_health_checked"
  | "policy_synchronized";

type GovernanceEvent =
  | {
      readonly kind: "enforcement_decision";
      readonly surface: AiSurface;
      readonly action: "warn" | "block";
      readonly resolution: "cancelled" | "bypassed" | "blocked";
      readonly reasonCode: string;
      readonly contributingCategories: readonly string[];
      readonly matchedRuleIds: readonly string[];
      readonly attachmentPresent: boolean;
    }
  | {
      readonly kind: "enforcement_error";
      readonly surface: AiSurface;
      readonly errorCode: string;
    }
  | {
      readonly kind: "adapter_health";
      readonly surface: AiSurface;
      readonly trust: AdapterTrust;
      readonly status: "healthy" | "degraded" | "unsupported";
      readonly healthCode: string;
    }
  | {
      readonly kind: "application_observed";
      readonly surface: AiSurface;
      readonly trust: "discovered" | "unsupported";
    }
  | {
      readonly kind: "usage_heartbeat";
      readonly surface: AiSurface;
      readonly activityCategory: AgentActivityCategory;
      readonly windowMinutes: 15;
      readonly activityBucket: "1" | "2-4" | "5-9" | "10-24" | "25+";
    }
  | {
      readonly kind: "policy_sync";
      readonly result: "applied" | "rejected" | "using_cached";
      readonly statusCode: string;
    };
```

The final enums require separate approval. Rule IDs, categories, reason codes,
and health codes come from versioned allowlists; they are not free-form strings
in a production validator.

Administrator actions use a separate administrator-audit union so an agent
cannot impersonate an administrator event.

## Clean-allow minimization

Routine clean `allow` decisions produce no individual event by default. An
organization may need coarse adoption or health evidence, but this does not
justify a per-prompt allow log.

If explicitly approved and enabled, a usage heartbeat:

- covers a fixed 15-minute window;
- uses a capped bucket rather than an exact interaction count;
- contains no decision categories, rule IDs, prompt size, timestamps per action,
  destinations, conversation IDs, or employee-entered labels;
- coalesces repeated activity locally;
- is sampled at an approved rate; and
- cannot be joined into a productivity score.

The proposed window and buckets are defaults for review, not implementation
commitments.

## Prohibited fields

No governance event may contain:

- prompt, completion, matched, redacted, clipboard, file, image, audio, or
  attachment content;
- matched values, offsets, surrounding text, hashes of content, embeddings, or
  reversible tokens;
- filenames, paths, repository names, command arguments, terminal output, window
  titles, DOM, page HTML, selectors, or screenshots;
- full URLs, query strings, conversation or document identifiers;
- email addresses, account names, device names, IP addresses, or direct contact
  identifiers;
- arbitrary metadata maps, dynamic field names, vendor payload passthroughs, or
  serialized exceptions; or
- secrets, credentials, authentication material, or policy signing keys.

A new field is prohibited until its purpose, type, cardinality, retention,
access, regional routing, deletion, abuse case, and employee disclosure are
approved.

## Authenticity and replay

The transport binds the validated envelope to tenant, installation, sequence,
policy version, authenticated channel, and regional endpoint. The receiver
rejects duplicate IDs, non-monotonic or replayed sequences outside an approved
recovery flow, cross-tenant identity, invalid signatures, unsupported versions,
and events impossible for the attested adapter capability.

Offline queues are bounded by count, age, and bytes. Exhaustion drops the least
valuable health/heartbeat data before enforcement decisions and emits only a
fixed local health condition.

## Retention classes

Retention is defined per event kind:

- enforcement decisions: shortest approved investigation window;
- errors and health: operational window;
- application visibility: inventory freshness window;
- usage heartbeats: shortest aggregate reporting window; and
- policy synchronization: policy assurance window.

Legal hold is not an implicit retention override. Any hold process must specify
scope, authority, expiry, access, deletion, and administrator audit.

## Unresolved product decisions requiring approval

- Final event union, allowlisted codes, and schema-evolution rules.
- Aggregate minimum counts and join restrictions.
- Whether clean activity is collected; heartbeat window, buckets, and sampling.
- Employee identity presence and employee-detail access.
- Enrollment identity, sequence recovery, and event signing.
- Trust roots, key rotation, and offline queue behavior.
- Regional routing, retention periods, deletion, and SIEM field mapping.
- Whether application visibility needs optional host permissions.
- Whether any future quarantine mode would require a separate content contract.
