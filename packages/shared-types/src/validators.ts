import {
  ADAPTER_HEALTH_CODES,
  CHATGPT_ADAPTER_VERSION,
  DECISION_RESOLUTIONS,
  ENFORCEMENT_ERROR_CODES,
  isAuditEventId,
  isAuditTimestamp,
} from "./audit.js";
import type {
  AdapterHealthAuditEvent,
  AuditEvent,
  DecisionAuditEvent,
  EnforcementErrorAuditEvent,
  StoredAuditEnvelope,
} from "./audit.js";
import {
  getMaskedPreviewPlaceholdersSnapshot,
  isMaskedPreviewSnapshot,
} from "./display.js";
import {
  FINDING_CONFIDENCES,
  isDetectorId,
  isFindingId,
  SENSITIVE_DATA_CATEGORIES,
  SENSITIVE_DATA_PLACEHOLDERS,
} from "./findings.js";
import type {
  FindingConfidence,
  SensitiveDataCategory,
  SensitiveDataPlaceholder,
} from "./findings.js";
import { RUNTIME_ERROR_CODES } from "./messages.js";
import type {
  RuntimeRequest,
  RuntimeResponse,
  SettingsPortMessage,
} from "./messages.js";
import { POLICY_ACTIONS } from "./policy.js";
import type {
  PolicyAction,
  PolicyConfiguration,
  PolicyDecision,
  PolicyFinding,
  PolicyInput,
} from "./policy.js";
import {
  isProtectionSettingsSnapshot,
  SETTINGS_VALIDATION_ERROR_CODES,
  SETTINGS_VALIDATION_FIELDS,
} from "./settings.js";
import type {
  ProtectionSettings,
  SettingsValidationError,
  StoredSettingsEnvelope,
} from "./settings.js";
import type { ProtectionStatusSnapshot } from "./status.js";
import {
  hasExactOwnKeys,
  INVALID_SNAPSHOT,
  isDenseExactArray,
  isPlainRecord,
  safelyValidate,
  snapshotStructuredValue,
  validatesStructuredSnapshot,
} from "./validation-helpers.js";

const POLICY_RULE_IDS = Object.freeze([
  "block.private-key",
  "block.aws-access-key",
  "block.payment-card",
  "block.api-secret.high",
  "warn.api-secret.medium",
  "warn.email",
  "warn.phone",
  "warn.protected-keyword",
  "allow.no-findings",
] as const);

type PolicyRuleId = (typeof POLICY_RULE_IDS)[number];

const POLICY_REASON_CODES = Object.freeze([
  "no_findings",
  "policy_match",
] as const);

type PolicyReasonCode = (typeof POLICY_REASON_CODES)[number];

function isOneOf<const Values extends readonly string[]>(
  value: unknown,
  values: Values,
): value is Values[number] {
  return typeof value === "string" && values.includes(value);
}

function isSensitiveDataCategory(
  value: unknown,
): value is SensitiveDataCategory {
  return isOneOf(value, SENSITIVE_DATA_CATEGORIES);
}

function isFindingConfidence(value: unknown): value is FindingConfidence {
  return isOneOf(value, FINDING_CONFIDENCES);
}

function isPolicyAction(value: unknown): value is PolicyAction {
  return isOneOf(value, POLICY_ACTIONS);
}

function isPolicyRuleId(value: unknown): value is PolicyRuleId {
  return isOneOf(value, POLICY_RULE_IDS);
}

function isPolicyReasonCode(value: unknown): value is PolicyReasonCode {
  return isOneOf(value, POLICY_REASON_CODES);
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function hasUniqueItems(items: readonly unknown[]): boolean {
  return new Set(items).size === items.length;
}

function hasPolicyRuleOrder(ruleIds: readonly PolicyRuleId[]): boolean {
  let priorIndex = -1;
  for (const ruleId of ruleIds) {
    const currentIndex = POLICY_RULE_IDS.indexOf(ruleId);
    if (currentIndex <= priorIndex) {
      return false;
    }
    priorIndex = currentIndex;
  }
  return true;
}

const RULE_CATEGORY = Object.freeze({
  "block.private-key": "private_key",
  "block.aws-access-key": "aws_access_key",
  "block.payment-card": "payment_card",
  "block.api-secret.high": "api_secret",
  "warn.api-secret.medium": "api_secret",
  "warn.email": "email",
  "warn.phone": "phone",
  "warn.protected-keyword": "protected_keyword",
} as const satisfies Record<
  Exclude<PolicyRuleId, "allow.no-findings">,
  SensitiveDataCategory
>);

const FIXED_BLOCK_RULE_IDS = new Set<PolicyRuleId>([
  "block.private-key",
  "block.aws-access-key",
  "block.payment-card",
  "block.api-secret.high",
]);

const CONFIGURABLE_CONTACT_RULE_IDS = new Set<PolicyRuleId>([
  "warn.email",
  "warn.phone",
]);

const PLACEHOLDER_CATEGORY = new Map<
  SensitiveDataPlaceholder,
  SensitiveDataCategory
>(
  Object.entries(SENSITIVE_DATA_PLACEHOLDERS).map(([category, placeholder]) => [
    placeholder,
    category as SensitiveDataCategory,
  ]),
);

function hasCompatibleRuleSet(ruleIds: readonly PolicyRuleId[]): boolean {
  const seenCategories = new Set<SensitiveDataCategory>();
  for (const ruleId of ruleIds) {
    if (ruleId === "allow.no-findings") {
      return false;
    }
    const category = RULE_CATEGORY[ruleId];
    if (category !== "api_secret" && seenCategories.has(category)) {
      return false;
    }
    seenCategories.add(category);
  }
  return true;
}

function hasFixedBlockRule(ruleIds: readonly PolicyRuleId[]): boolean {
  return ruleIds.some((ruleId) => FIXED_BLOCK_RULE_IDS.has(ruleId));
}

function hasConfigurableContactRule(ruleIds: readonly PolicyRuleId[]): boolean {
  return ruleIds.some((ruleId) => CONFIGURABLE_CONTACT_RULE_IDS.has(ruleId));
}

function hasOnlyConfigurableContactRules(
  ruleIds: readonly PolicyRuleId[],
): boolean {
  return ruleIds.every((ruleId) => CONFIGURABLE_CONTACT_RULE_IDS.has(ruleId));
}

function hasKnowableActionForRules(
  action: Exclude<PolicyAction, "allow">,
  ruleIds: readonly PolicyRuleId[],
): boolean {
  const hasFixedBlock = hasFixedBlockRule(ruleIds);
  const hasContact = hasConfigurableContactRule(ruleIds);

  switch (action) {
    case "block":
      return hasFixedBlock || hasContact;
    case "redact":
      return !hasFixedBlock && hasContact;
    case "warn":
      return !hasFixedBlock;
  }
}

function isPolicyFindingSnapshot(value: unknown): value is PolicyFinding {
  return safelyValidate(
    () =>
      isPlainRecord(value) &&
      hasExactOwnKeys(value, ["id", "detectorId", "category", "confidence"]) &&
      isFindingId(value.id) &&
      isDetectorId(value.detectorId) &&
      isSensitiveDataCategory(value.category) &&
      isFindingConfidence(value.confidence) &&
      !(value.category === "api_secret" && value.confidence === "low"),
  );
}

export function isPolicyFinding(value: unknown): value is PolicyFinding {
  return validatesStructuredSnapshot(value, isPolicyFindingSnapshot);
}

export function createPolicyFinding(value: PolicyFinding): PolicyFinding {
  const snapshot = snapshotStructuredValue(value);
  if (snapshot === INVALID_SNAPSHOT || !isPolicyFindingSnapshot(snapshot)) {
    throw new Error("Invalid policy finding.");
  }

  return {
    id: snapshot.id,
    detectorId: snapshot.detectorId,
    category: snapshot.category,
    confidence: snapshot.confidence,
  };
}

function isPolicyConfigurationSnapshot(
  value: unknown,
): value is PolicyConfiguration {
  return safelyValidate(() => {
    if (
      !isPlainRecord(value) ||
      !hasExactOwnKeys(value, [
        "schemaVersion",
        "categoryActions",
        "apiSecretActions",
      ]) ||
      value.schemaVersion !== 1 ||
      !isPlainRecord(value.categoryActions) ||
      !hasExactOwnKeys(value.categoryActions, [
        "email",
        "phone",
        "payment_card",
        "aws_access_key",
        "private_key",
        "protected_keyword",
      ]) ||
      !isPlainRecord(value.apiSecretActions) ||
      !hasExactOwnKeys(value.apiSecretActions, ["high", "medium"])
    ) {
      return false;
    }

    return (
      isPolicyAction(value.categoryActions.email) &&
      isPolicyAction(value.categoryActions.phone) &&
      value.categoryActions.payment_card === "block" &&
      value.categoryActions.aws_access_key === "block" &&
      value.categoryActions.private_key === "block" &&
      value.categoryActions.protected_keyword === "warn" &&
      value.apiSecretActions.high === "block" &&
      value.apiSecretActions.medium === "warn"
    );
  });
}

export function isPolicyConfiguration(
  value: unknown,
): value is PolicyConfiguration {
  return validatesStructuredSnapshot(value, isPolicyConfigurationSnapshot);
}

function isPolicyInputSnapshot(value: unknown): value is PolicyInput {
  return safelyValidate(
    () =>
      isPlainRecord(value) &&
      hasExactOwnKeys(value, ["application", "findings", "policy"]) &&
      value.application === "chatgpt" &&
      isDenseExactArray(value.findings, 0, 700_000, isPolicyFindingSnapshot) &&
      isPolicyConfigurationSnapshot(value.policy),
  );
}

export function isPolicyInput(value: unknown): value is PolicyInput {
  return validatesStructuredSnapshot(value, isPolicyInputSnapshot);
}

export function createPolicyInput(value: PolicyInput): PolicyInput {
  const snapshot = snapshotStructuredValue(value);
  if (snapshot === INVALID_SNAPSHOT || !isPolicyInputSnapshot(snapshot)) {
    throw new Error("Invalid policy input.");
  }

  return {
    application: "chatgpt",
    findings: snapshot.findings.map((finding) => ({
      id: finding.id,
      detectorId: finding.detectorId,
      category: finding.category,
      confidence: finding.confidence,
    })),
    policy: {
      schemaVersion: 1,
      categoryActions: {
        email: snapshot.policy.categoryActions.email,
        phone: snapshot.policy.categoryActions.phone,
        payment_card: "block",
        aws_access_key: "block",
        private_key: "block",
        protected_keyword: "warn",
      },
      apiSecretActions: {
        high: "block",
        medium: "warn",
      },
    },
  };
}

function isPolicyDecisionSnapshot(value: unknown): value is PolicyDecision {
  return safelyValidate(() => {
    if (
      !isPlainRecord(value) ||
      !hasExactOwnKeys(value, ["action", "matchedRuleIds", "reasonCode"]) ||
      !isPolicyAction(value.action) ||
      !isPolicyReasonCode(value.reasonCode)
    ) {
      return false;
    }

    if (value.action === "allow") {
      return (
        (value.reasonCode === "no_findings" &&
          isDenseExactArray(value.matchedRuleIds, 1, 1, isPolicyRuleId) &&
          value.matchedRuleIds[0] === "allow.no-findings") ||
        (value.reasonCode === "policy_match" &&
          isDenseExactArray(value.matchedRuleIds, 1, 2, isPolicyRuleId) &&
          hasUniqueItems(value.matchedRuleIds) &&
          hasPolicyRuleOrder(value.matchedRuleIds) &&
          hasOnlyConfigurableContactRules(value.matchedRuleIds))
      );
    }

    return (
      value.reasonCode === "policy_match" &&
      isDenseExactArray(
        value.matchedRuleIds,
        1,
        POLICY_RULE_IDS.length - 1,
        isPolicyRuleId,
      ) &&
      !value.matchedRuleIds.includes("allow.no-findings") &&
      hasUniqueItems(value.matchedRuleIds) &&
      hasPolicyRuleOrder(value.matchedRuleIds) &&
      hasCompatibleRuleSet(value.matchedRuleIds) &&
      hasKnowableActionForRules(value.action, value.matchedRuleIds)
    );
  });
}

export function isPolicyDecision(value: unknown): value is PolicyDecision {
  return validatesStructuredSnapshot(value, isPolicyDecisionSnapshot);
}

export function createPolicyDecision(value: PolicyDecision): PolicyDecision {
  const snapshot = snapshotStructuredValue(value);
  if (snapshot === INVALID_SNAPSHOT || !isPolicyDecisionSnapshot(snapshot)) {
    throw new Error("Invalid policy decision.");
  }

  return {
    action: snapshot.action,
    matchedRuleIds: [...snapshot.matchedRuleIds],
    reasonCode: snapshot.reasonCode,
  };
}

export function isProtectionSettings(
  value: unknown,
): value is ProtectionSettings {
  return validatesStructuredSnapshot(value, isProtectionSettingsSnapshot);
}

function isStoredSettingsEnvelopeSnapshot(
  value: unknown,
): value is StoredSettingsEnvelope {
  return safelyValidate(
    () =>
      isPlainRecord(value) &&
      hasExactOwnKeys(value, ["schemaVersion", "settings"]) &&
      value.schemaVersion === 1 &&
      isProtectionSettingsSnapshot(value.settings),
  );
}

export function isStoredSettingsEnvelope(
  value: unknown,
): value is StoredSettingsEnvelope {
  return validatesStructuredSnapshot(value, isStoredSettingsEnvelopeSnapshot);
}

function isDecisionResolutionForAction(
  action: PolicyAction,
  resolution: unknown,
): boolean {
  if (!isOneOf(resolution, DECISION_RESOLUTIONS)) {
    return false;
  }

  switch (action) {
    case "allow":
      return resolution === "submitted";
    case "warn":
      return (
        resolution === "cancelled" ||
        resolution === "bypassed" ||
        resolution === "redacted"
      );
    case "redact":
      return resolution === "redacted";
    case "block":
      return resolution === "blocked";
  }
}

function hasCommonAuditFields(value: Record<PropertyKey, unknown>): boolean {
  return (
    isAuditEventId(value.id) &&
    isAuditTimestamp(value.timestamp) &&
    value.application === "chatgpt" &&
    value.adapterVersion === CHATGPT_ADAPTER_VERSION
  );
}

function hasCorrelatedRuleCategories(
  ruleIds: readonly PolicyRuleId[],
  categories: readonly SensitiveDataCategory[],
): boolean {
  return (
    ruleIds.every(
      (ruleId) =>
        ruleId !== "allow.no-findings" &&
        categories.includes(RULE_CATEGORY[ruleId]),
    ) &&
    categories.every((category) =>
      ruleIds.some(
        (ruleId) =>
          ruleId !== "allow.no-findings" && RULE_CATEGORY[ruleId] === category,
      ),
    )
  );
}

function hasCorrelatedMaskedExcerpt(
  maskedExcerpt: unknown,
  categories: readonly SensitiveDataCategory[],
): boolean {
  if (!isMaskedPreviewSnapshot(maskedExcerpt)) {
    return false;
  }

  const placeholders = getMaskedPreviewPlaceholdersSnapshot(maskedExcerpt);
  return (
    hasUniqueItems(placeholders) &&
    placeholders.every((placeholder) => {
      const category = PLACEHOLDER_CATEGORY.get(placeholder);
      return category !== undefined && categories.includes(category);
    })
  );
}

function isDecisionAuditEventSnapshot(
  value: unknown,
): value is DecisionAuditEvent {
  return safelyValidate(() => {
    if (
      !isPlainRecord(value) ||
      !hasExactOwnKeys(
        value,
        [
          "kind",
          "id",
          "timestamp",
          "application",
          "policyAction",
          "resolution",
          "detectorCategories",
          "matchedRuleIds",
          "findingCount",
          "adapterVersion",
        ],
        ["maskedExcerpt"],
      ) ||
      value.kind !== "decision" ||
      !hasCommonAuditFields(value) ||
      !isPolicyAction(value.policyAction) ||
      !isDecisionResolutionForAction(value.policyAction, value.resolution)
    ) {
      return false;
    }

    if (value.policyAction === "allow") {
      const isCleanAllow =
        value.resolution === "submitted" &&
        value.findingCount === 0 &&
        isDenseExactArray(
          value.detectorCategories,
          0,
          0,
          isSensitiveDataCategory,
        ) &&
        isDenseExactArray(value.matchedRuleIds, 1, 1, isPolicyRuleId) &&
        value.matchedRuleIds[0] === "allow.no-findings" &&
        !Object.hasOwn(value, "maskedExcerpt");

      const isConfiguredAllow =
        value.resolution === "submitted" &&
        isNonNegativeSafeInteger(value.findingCount) &&
        value.findingCount >= 1 &&
        value.findingCount <= 700_000 &&
        isDenseExactArray(
          value.detectorCategories,
          1,
          2,
          isSensitiveDataCategory,
        ) &&
        value.detectorCategories.every(
          (category) => category === "email" || category === "phone",
        ) &&
        hasUniqueItems(value.detectorCategories) &&
        value.findingCount >= value.detectorCategories.length &&
        isDenseExactArray(value.matchedRuleIds, 1, 2, isPolicyRuleId) &&
        hasUniqueItems(value.matchedRuleIds) &&
        hasPolicyRuleOrder(value.matchedRuleIds) &&
        hasOnlyConfigurableContactRules(value.matchedRuleIds) &&
        hasCorrelatedRuleCategories(
          value.matchedRuleIds,
          value.detectorCategories,
        ) &&
        (!Object.hasOwn(value, "maskedExcerpt") ||
          hasCorrelatedMaskedExcerpt(
            value.maskedExcerpt,
            value.detectorCategories,
          ));

      return isCleanAllow || isConfiguredAllow;
    }

    if (
      !isNonNegativeSafeInteger(value.findingCount) ||
      value.findingCount < 1 ||
      value.findingCount > 700_000 ||
      !isDenseExactArray(
        value.detectorCategories,
        1,
        SENSITIVE_DATA_CATEGORIES.length,
        isSensitiveDataCategory,
      ) ||
      !hasUniqueItems(value.detectorCategories) ||
      !isDenseExactArray(
        value.matchedRuleIds,
        1,
        POLICY_RULE_IDS.length - 1,
        isPolicyRuleId,
      ) ||
      value.matchedRuleIds.includes("allow.no-findings") ||
      !hasUniqueItems(value.matchedRuleIds) ||
      !hasPolicyRuleOrder(value.matchedRuleIds) ||
      !hasCompatibleRuleSet(value.matchedRuleIds) ||
      !hasKnowableActionForRules(value.policyAction, value.matchedRuleIds) ||
      !hasCorrelatedRuleCategories(
        value.matchedRuleIds,
        value.detectorCategories,
      )
    ) {
      return false;
    }

    if (value.findingCount < value.detectorCategories.length) {
      return false;
    }

    return (
      !Object.hasOwn(value, "maskedExcerpt") ||
      hasCorrelatedMaskedExcerpt(value.maskedExcerpt, value.detectorCategories)
    );
  });
}

export function isDecisionAuditEvent(
  value: unknown,
): value is DecisionAuditEvent {
  return validatesStructuredSnapshot(value, isDecisionAuditEventSnapshot);
}

function isEnforcementErrorAuditEventSnapshot(
  value: unknown,
): value is EnforcementErrorAuditEvent {
  return safelyValidate(
    () =>
      isPlainRecord(value) &&
      hasExactOwnKeys(value, [
        "kind",
        "id",
        "timestamp",
        "application",
        "errorCode",
        "adapterVersion",
      ]) &&
      value.kind === "enforcement_error" &&
      hasCommonAuditFields(value) &&
      isOneOf(value.errorCode, ENFORCEMENT_ERROR_CODES),
  );
}

export function isEnforcementErrorAuditEvent(
  value: unknown,
): value is EnforcementErrorAuditEvent {
  return validatesStructuredSnapshot(
    value,
    isEnforcementErrorAuditEventSnapshot,
  );
}

function isAdapterHealthAuditEventSnapshot(
  value: unknown,
): value is AdapterHealthAuditEvent {
  return safelyValidate(
    () =>
      isPlainRecord(value) &&
      hasExactOwnKeys(value, [
        "kind",
        "id",
        "timestamp",
        "application",
        "status",
        "healthCode",
        "adapterVersion",
      ]) &&
      value.kind === "adapter_health" &&
      hasCommonAuditFields(value) &&
      value.status === "degraded" &&
      isOneOf(value.healthCode, ADAPTER_HEALTH_CODES),
  );
}

export function isAdapterHealthAuditEvent(
  value: unknown,
): value is AdapterHealthAuditEvent {
  return validatesStructuredSnapshot(value, isAdapterHealthAuditEventSnapshot);
}

function isAuditEventSnapshot(value: unknown): value is AuditEvent {
  return safelyValidate(() => {
    if (!isPlainRecord(value)) {
      return false;
    }

    switch (value.kind) {
      case "decision":
        return isDecisionAuditEventSnapshot(value);
      case "enforcement_error":
        return isEnforcementErrorAuditEventSnapshot(value);
      case "adapter_health":
        return isAdapterHealthAuditEventSnapshot(value);
      default:
        return false;
    }
  });
}

export function isAuditEvent(value: unknown): value is AuditEvent {
  return validatesStructuredSnapshot(value, isAuditEventSnapshot);
}

function isStoredAuditEnvelopeSnapshot(
  value: unknown,
): value is StoredAuditEnvelope {
  return safelyValidate(
    () =>
      isPlainRecord(value) &&
      hasExactOwnKeys(value, ["schemaVersion", "events"]) &&
      value.schemaVersion === 1 &&
      isDenseExactArray(value.events, 0, 1_000, isAuditEventSnapshot),
  );
}

export function isStoredAuditEnvelope(
  value: unknown,
): value is StoredAuditEnvelope {
  return validatesStructuredSnapshot(value, isStoredAuditEnvelopeSnapshot);
}

function isProtectionStatusSnapshotValue(
  value: unknown,
): value is ProtectionStatusSnapshot {
  return safelyValidate(() => {
    if (
      !isPlainRecord(value) ||
      !hasExactOwnKeys(value, [
        "state",
        "application",
        "protectionEnabled",
        "recentEventCount",
      ]) ||
      value.application !== "chatgpt" ||
      !isNonNegativeSafeInteger(value.recentEventCount)
    ) {
      return false;
    }

    switch (value.state) {
      case "initializing":
      case "unavailable":
        return value.protectionEnabled === null;
      case "active":
      case "degraded":
        return value.protectionEnabled === true;
      case "disabled":
        return value.protectionEnabled === false;
      default:
        return false;
    }
  });
}

export function isProtectionStatusSnapshot(
  value: unknown,
): value is ProtectionStatusSnapshot {
  return validatesStructuredSnapshot(value, isProtectionStatusSnapshotValue);
}

function isSettingsValidationErrorSnapshot(
  value: unknown,
): value is SettingsValidationError {
  return safelyValidate(() => {
    if (
      !isPlainRecord(value) ||
      !hasExactOwnKeys(value, ["field", "code"]) ||
      !isOneOf(value.field, SETTINGS_VALIDATION_FIELDS) ||
      !isOneOf(value.code, SETTINGS_VALIDATION_ERROR_CODES)
    ) {
      return false;
    }

    switch (value.field) {
      case "settings":
        return (
          value.code === "required" ||
          value.code === "unknown_field" ||
          value.code === "invalid_type"
        );
      case "protectionEnabled":
        return value.code === "required" || value.code === "invalid_type";
      case "emailAction":
      case "phoneAction":
        return value.code === "required" || value.code === "invalid_action";
      case "protectedKeywords":
        return (
          value.code === "required" ||
          value.code === "invalid_type" ||
          value.code === "invalid_keyword" ||
          value.code === "too_many_keywords" ||
          value.code === "duplicate_keyword"
        );
      case "auditRetentionLimit":
        return (
          value.code === "required" ||
          value.code === "invalid_type" ||
          value.code === "out_of_range"
        );
    }
  });
}

export function isSettingsValidationError(
  value: unknown,
): value is SettingsValidationError {
  return validatesStructuredSnapshot(value, isSettingsValidationErrorSnapshot);
}

function isRuntimeRequestSnapshot(value: unknown): value is RuntimeRequest {
  return safelyValidate(() => {
    if (!isPlainRecord(value)) {
      return false;
    }

    switch (value.type) {
      case "settings.read":
      case "audit.read":
      case "audit.clear":
      case "status.read":
        return hasExactOwnKeys(value, ["type"]);
      case "settings.save":
        return (
          hasExactOwnKeys(value, ["type", "settings"]) &&
          isProtectionSettingsSnapshot(value.settings)
        );
      case "audit.append":
        return (
          hasExactOwnKeys(value, ["type", "event"]) &&
          isAuditEventSnapshot(value.event)
        );
      default:
        return false;
    }
  });
}

export function isRuntimeRequest(value: unknown): value is RuntimeRequest {
  return validatesStructuredSnapshot(value, isRuntimeRequestSnapshot);
}

function isRuntimeResponseSnapshot(value: unknown): value is RuntimeResponse {
  return safelyValidate(() => {
    if (!isPlainRecord(value)) {
      return false;
    }

    switch (value.type) {
      case "settings.result":
      case "settings.saved":
        return (
          hasExactOwnKeys(value, ["type", "envelope"]) &&
          isStoredSettingsEnvelopeSnapshot(value.envelope)
        );
      case "audit.result":
        return (
          hasExactOwnKeys(value, ["type", "envelope"]) &&
          isStoredAuditEnvelopeSnapshot(value.envelope)
        );
      case "audit.appended":
      case "audit.cleared":
        return hasExactOwnKeys(value, ["type"]);
      case "status.result":
        return (
          hasExactOwnKeys(value, ["type", "status"]) &&
          isProtectionStatusSnapshotValue(value.status)
        );
      case "error":
        if (value.errorCode === "validation_failure") {
          return (
            hasExactOwnKeys(value, ["type", "errorCode", "fieldErrors"]) &&
            isDenseExactArray(
              value.fieldErrors,
              1,
              SETTINGS_VALIDATION_FIELDS.length,
              isSettingsValidationErrorSnapshot,
            ) &&
            hasUniqueItems(
              value.fieldErrors.map((fieldError) => fieldError.field),
            )
          );
        }

        return (
          hasExactOwnKeys(value, ["type", "errorCode"]) &&
          isOneOf(value.errorCode, RUNTIME_ERROR_CODES) &&
          value.errorCode !== "validation_failure"
        );
      default:
        return false;
    }
  });
}

export function isRuntimeResponse(value: unknown): value is RuntimeResponse {
  return validatesStructuredSnapshot(value, isRuntimeResponseSnapshot);
}

function isSettingsPortMessageSnapshot(
  value: unknown,
): value is SettingsPortMessage {
  return safelyValidate(
    () =>
      isPlainRecord(value) &&
      hasExactOwnKeys(value, ["type", "envelope"]) &&
      value.type === "settings.snapshot" &&
      isStoredSettingsEnvelopeSnapshot(value.envelope),
  );
}

export function isSettingsPortMessage(
  value: unknown,
): value is SettingsPortMessage {
  return validatesStructuredSnapshot(value, isSettingsPortMessageSnapshot);
}
