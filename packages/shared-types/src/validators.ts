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
  DETECTOR_CATEGORY,
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
  ContentStatusPortMessage,
  SettingsPortMessage,
} from "./messages.js";
import {
  POLICY_ACTION_PRECEDENCE,
  POLICY_NO_FINDINGS_RULE,
  POLICY_REASON_CODE,
  POLICY_REASON_CODES,
  POLICY_RULE_CATALOG,
  POLICY_RULE_IDS,
} from "./policy-catalog.js";
import type {
  PolicyCatalogRule,
  PolicyReasonCode,
  PolicyRuleId,
} from "./policy-catalog.js";
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
import type {
  ContentProtectionStatus,
  ProtectionStatusSnapshot,
} from "./status.js";
import {
  hasExactOwnKeys,
  INVALID_SNAPSHOT,
  isDenseExactArray,
  isPlainRecord,
  safelyValidate,
  snapshotStructuredValue,
  validatesStructuredSnapshot,
} from "./validation-helpers.js";

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

type CatalogFindingRule = Exclude<PolicyCatalogRule, { category: null }>;

const FINDING_RULES = POLICY_RULE_CATALOG.filter(
  (rule): rule is CatalogFindingRule => rule.category !== null,
);

const FINDING_RULE_BY_ID = new Map<PolicyRuleId, CatalogFindingRule>(
  FINDING_RULES.map((rule) => [rule.id, rule]),
);

const POLICY_CATEGORY_ACTION_KEYS = Object.freeze([
  ...new Set(
    FINDING_RULES.flatMap((rule) =>
      rule.category === "api_secret" ? [] : [rule.category],
    ),
  ),
]);

const API_SECRET_CONFIDENCE_KEYS = Object.freeze([
  ...new Set(
    FINDING_RULES.flatMap((rule) =>
      rule.category === "api_secret" && rule.confidence !== null
        ? [rule.confidence]
        : [],
    ),
  ),
]);

const CONFIGURABLE_CONTACT_RULE_IDS = new Set<PolicyRuleId>(
  FINDING_RULES.filter((rule) => rule.actionSource.mode === "configured").map(
    (rule) => rule.id,
  ),
);

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
    const rule = FINDING_RULE_BY_ID.get(ruleId);
    if (rule === undefined) {
      return false;
    }
    const category = rule.category;
    if (category !== "api_secret" && seenCategories.has(category)) {
      return false;
    }
    seenCategories.add(category);
  }
  return true;
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
  let fixedAction: PolicyAction = "allow";
  for (const ruleId of ruleIds) {
    const rule = FINDING_RULE_BY_ID.get(ruleId);
    if (
      rule !== undefined &&
      rule.actionSource.mode === "fixed" &&
      POLICY_ACTION_PRECEDENCE.indexOf(rule.actionSource.requiredAction) >
        POLICY_ACTION_PRECEDENCE.indexOf(fixedAction)
    ) {
      fixedAction = rule.actionSource.requiredAction;
    }
  }

  const requestedPriority = POLICY_ACTION_PRECEDENCE.indexOf(action);
  const fixedPriority = POLICY_ACTION_PRECEDENCE.indexOf(fixedAction);
  return (
    requestedPriority >= fixedPriority &&
    (requestedPriority === fixedPriority || hasConfigurableContactRule(ruleIds))
  );
}

function isPolicyFindingSnapshot(value: unknown): value is PolicyFinding {
  return safelyValidate(
    () =>
      isPlainRecord(value) &&
      hasExactOwnKeys(value, ["id", "detectorId", "category", "confidence"]) &&
      isFindingId(value.id) &&
      isDetectorId(value.detectorId) &&
      isSensitiveDataCategory(value.category) &&
      DETECTOR_CATEGORY[value.detectorId] === value.category &&
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

  return snapshot;
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
      !hasExactOwnKeys(value.categoryActions, POLICY_CATEGORY_ACTION_KEYS) ||
      !isPlainRecord(value.apiSecretActions) ||
      !hasExactOwnKeys(value.apiSecretActions, API_SECRET_CONFIDENCE_KEYS)
    ) {
      return false;
    }

    const categoryActions = value.categoryActions;
    const apiSecretActions = value.apiSecretActions;
    return FINDING_RULES.every((rule) => {
      switch (rule.actionSource.kind) {
        case "policy_category": {
          if (rule.category === "api_secret") {
            return false;
          }
          const action = categoryActions[rule.category];
          return (
            isPolicyAction(action) &&
            (rule.actionSource.mode === "configured" ||
              action === rule.actionSource.requiredAction)
          );
        }
        case "api_secret_confidence": {
          if (rule.confidence === null) {
            return false;
          }
          const action = apiSecretActions[rule.confidence];
          return (
            isPolicyAction(action) &&
            action === rule.actionSource.requiredAction
          );
        }
      }
    });
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
    findings: snapshot.findings,
    policy: snapshot.policy,
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
        (value.reasonCode === POLICY_REASON_CODE.NO_FINDINGS &&
          isDenseExactArray(value.matchedRuleIds, 1, 1, isPolicyRuleId) &&
          value.matchedRuleIds[0] === POLICY_NO_FINDINGS_RULE.id) ||
        (value.reasonCode === POLICY_REASON_CODE.POLICY_MATCH &&
          isDenseExactArray(value.matchedRuleIds, 1, 2, isPolicyRuleId) &&
          hasUniqueItems(value.matchedRuleIds) &&
          hasPolicyRuleOrder(value.matchedRuleIds) &&
          hasOnlyConfigurableContactRules(value.matchedRuleIds))
      );
    }

    return (
      value.reasonCode === POLICY_REASON_CODE.POLICY_MATCH &&
      isDenseExactArray(
        value.matchedRuleIds,
        1,
        POLICY_RULE_IDS.length - 1,
        isPolicyRuleId,
      ) &&
      !value.matchedRuleIds.includes(POLICY_NO_FINDINGS_RULE.id) &&
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
    ruleIds.every((ruleId) => {
      const rule = FINDING_RULE_BY_ID.get(ruleId);
      return rule !== undefined && categories.includes(rule.category);
    }) &&
    categories.every((category) =>
      ruleIds.some((ruleId) => {
        const rule = FINDING_RULE_BY_ID.get(ruleId);
        return rule !== undefined && rule.category === category;
      }),
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
        value.matchedRuleIds[0] === POLICY_NO_FINDINGS_RULE.id &&
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
      value.matchedRuleIds.includes(POLICY_NO_FINDINGS_RULE.id) ||
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

function isContentProtectionStatusValue(
  value: unknown,
): value is ContentProtectionStatus {
  return safelyValidate(() => {
    if (
      !isPlainRecord(value) ||
      !hasExactOwnKeys(value, ["state", "application", "protectionEnabled"]) ||
      value.application !== "chatgpt"
    ) {
      return false;
    }
    switch (value.state) {
      case "initializing":
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
      hasExactOwnKeys(value, ["type", "generation", "envelope"]) &&
      value.type === "settings.snapshot" &&
      isNonNegativeSafeInteger(value.generation) &&
      isStoredSettingsEnvelopeSnapshot(value.envelope),
  );
}

export function isSettingsPortMessage(
  value: unknown,
): value is SettingsPortMessage {
  return validatesStructuredSnapshot(value, isSettingsPortMessageSnapshot);
}

function isContentStatusPortMessageSnapshot(
  value: unknown,
): value is ContentStatusPortMessage {
  return safelyValidate(
    () =>
      isPlainRecord(value) &&
      hasExactOwnKeys(value, ["type", "generation", "status"]) &&
      value.type === "status.snapshot" &&
      isNonNegativeSafeInteger(value.generation) &&
      isContentProtectionStatusValue(value.status),
  );
}

export function isContentStatusPortMessage(
  value: unknown,
): value is ContentStatusPortMessage {
  return validatesStructuredSnapshot(value, isContentStatusPortMessageSnapshot);
}
