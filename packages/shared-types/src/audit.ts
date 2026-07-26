import type { MaskedPreview } from "./display.js";
import type { SensitiveDataCategory } from "./findings.js";
import type { PolicyAction } from "./policy.js";
import type { PromptFreeArray, PromptFreeBoundary } from "./privacy.js";
import {
  INVALID_SNAPSHOT,
  snapshotStructuredValue,
} from "./validation-helpers.js";

export const DECISION_RESOLUTIONS = Object.freeze([
  "submitted",
  "cancelled",
  "bypassed",
  "redacted",
  "blocked",
] as const);

export type DecisionResolution = (typeof DECISION_RESOLUTIONS)[number];

declare const auditEventIdBrand: unique symbol;
declare const auditTimestampBrand: unique symbol;

export type AuditEventId = string & {
  readonly [auditEventIdBrand]: true;
};

export type AuditTimestamp = string & {
  readonly [auditTimestampBrand]: true;
};

export function isAuditEventId(value: unknown): value is AuditEventId {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
      value,
    )
  );
}

export function createAuditEventId(value: string): AuditEventId {
  const snapshot = snapshotStructuredValue(value);
  if (snapshot === INVALID_SNAPSHOT || !isAuditEventId(snapshot)) {
    throw new Error("Invalid audit event identifier.");
  }
  return snapshot;
}

export function isAuditTimestamp(value: unknown): value is AuditTimestamp {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value)
  ) {
    return false;
  }

  const parsed = Date.parse(value);
  return !Number.isNaN(parsed) && new Date(parsed).toISOString() === value;
}

export function createAuditTimestamp(value: string): AuditTimestamp {
  const snapshot = snapshotStructuredValue(value);
  if (snapshot === INVALID_SNAPSHOT || !isAuditTimestamp(snapshot)) {
    throw new Error("Invalid audit timestamp.");
  }
  return snapshot;
}

export type DecisionAuditEvent = PromptFreeBoundary & {
  kind: "decision";
  id: AuditEventId;
  timestamp: AuditTimestamp;
  application: "chatgpt";
  policyAction: PolicyAction;
  resolution: DecisionResolution;
  detectorCategories: PromptFreeArray<SensitiveDataCategory>;
  matchedRuleIds: PromptFreeArray<string>;
  findingCount: number;
  maskedExcerpt?: MaskedPreview;
  adapterVersion: ChatGptAdapterVersion;
};

export const ENFORCEMENT_ERROR_CODES = Object.freeze([
  "prompt_too_large",
  "detector_failure",
  "policy_failure",
  "ui_failure",
  "resume_failure",
  "extension_context_invalidated",
  "unsupported_attachment",
] as const);

export type EnforcementErrorCode = (typeof ENFORCEMENT_ERROR_CODES)[number];

export type EnforcementErrorAuditEvent = PromptFreeBoundary & {
  kind: "enforcement_error";
  id: AuditEventId;
  timestamp: AuditTimestamp;
  application: "chatgpt";
  errorCode: EnforcementErrorCode;
  adapterVersion: ChatGptAdapterVersion;
};

export const ADAPTER_HEALTH_CODES = Object.freeze([
  "composer_not_found",
  "send_control_not_found",
  "unsupported_dom_variant",
] as const);

export const CHATGPT_ADAPTER_VERSION = "1" as const;

export type ChatGptAdapterVersion = typeof CHATGPT_ADAPTER_VERSION;

export type AdapterHealthCode = (typeof ADAPTER_HEALTH_CODES)[number];

export type AdapterHealthAuditEvent = PromptFreeBoundary & {
  kind: "adapter_health";
  id: AuditEventId;
  timestamp: AuditTimestamp;
  application: "chatgpt";
  status: "degraded";
  healthCode: AdapterHealthCode;
  adapterVersion: ChatGptAdapterVersion;
};

export type AuditEvent =
  DecisionAuditEvent | EnforcementErrorAuditEvent | AdapterHealthAuditEvent;

export type StoredAuditEnvelope = PromptFreeBoundary & {
  schemaVersion: 1;
  events: PromptFreeArray<AuditEvent>;
};
