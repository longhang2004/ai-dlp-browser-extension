import {
  ATTACHMENT_POLICY_RULE_ID,
  isAuditEvent,
  isStoredAuditEnvelope,
  POLICY_ACTION_PRECEDENCE,
  POLICY_NO_FINDINGS_RULE,
  POLICY_RULE_CATALOG,
  type AdapterHealthAuditEvent,
  type AuditEvent,
  type PolicyAction,
  type StoredAuditEnvelope,
} from "@ai-dlp/shared-types";

import { EXECUTABLE_ADAPTER_CATALOG } from "../adapters/adapter-catalog.js";
import type { SettingsStore } from "./settings-store.js";
import type { StoragePort } from "./storage-port.js";

export const AUDIT_STORAGE_KEY = "audit";

export type AuditAppendDisposition = "persisted" | "dropped" | "coalesced";

export interface AuditStore {
  read(): Promise<StoredAuditEnvelope>;
  append(event: unknown): Promise<AuditAppendDisposition>;
  clear(): Promise<void>;
  enforceRetention(): Promise<StoredAuditEnvelope>;
}

function emptyEnvelope(): StoredAuditEnvelope {
  return { schemaVersion: 4, events: [] };
}

function isPersistable(event: AuditEvent): boolean {
  return event.kind !== "decision" || event.policyAction !== "allow";
}

function isCurrentCatalogIdentity(event: AuditEvent): boolean {
  return EXECUTABLE_ADAPTER_CATALOG.some(
    (descriptor) =>
      descriptor.adapterId === event.adapterId &&
      descriptor.surfaceId === event.surfaceId &&
      descriptor.version === event.adapterVersion,
  );
}

function isSameHealthRetransmission(
  previous: AuditEvent,
  next: AdapterHealthAuditEvent,
): boolean {
  return previous.kind === "adapter_health" && previous.id === next.id;
}

function isPlainDataRecord(value: unknown): value is Record<string, unknown> {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    (Object.getPrototypeOf(value) !== Object.prototype &&
      Object.getPrototypeOf(value) !== null)
  ) {
    return false;
  }
  return Reflect.ownKeys(value).every((key) => {
    if (typeof key !== "string") return false;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return (
      descriptor !== undefined &&
      descriptor.enumerable &&
      Object.hasOwn(descriptor, "value")
    );
  });
}

function hasExactKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[] = [],
): boolean {
  const keys = Reflect.ownKeys(value);
  return (
    required.every((key) => Object.hasOwn(value, key)) &&
    keys.every(
      (key) =>
        typeof key === "string" &&
        (required.includes(key) || optional.includes(key)),
    )
  );
}

function withoutLegacyApplication(
  value: Record<string, unknown>,
): Record<string, unknown> {
  const result = { ...value };
  delete result.application;
  return result;
}

function isPlainDenseDataArray(
  value: unknown,
  maximumLength: number,
): value is unknown[] {
  if (
    !Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Array.prototype ||
    value.length > maximumLength
  ) {
    return false;
  }
  const keys = Reflect.ownKeys(value);
  if (keys.length !== value.length + 1 || !keys.includes("length")) {
    return false;
  }
  for (let index = 0; index < value.length; index += 1) {
    const key = String(index);
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (
      descriptor === undefined ||
      !descriptor.enumerable ||
      !Object.hasOwn(descriptor, "value")
    ) {
      return false;
    }
  }
  return keys.every(
    (key) =>
      key === "length" ||
      (typeof key === "string" &&
        Number.isSafeInteger(Number(key)) &&
        String(Number(key)) === key &&
        Number(key) >= 0 &&
        Number(key) < value.length),
  );
}

type LegacyFindingRule = Exclude<
  (typeof POLICY_RULE_CATALOG)[number],
  { category: null }
>;

const LEGACY_FINDING_RULE_BY_ID = new Map<string, LegacyFindingRule>(
  POLICY_RULE_CATALOG.flatMap((rule) =>
    rule.category === null
      ? []
      : ([[rule.id, rule]] as [string, LegacyFindingRule][]),
  ),
);

function sameStrings(left: unknown, right: readonly string[]): boolean {
  return (
    isPlainDenseDataArray(left, right.length) &&
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function migrateLegacyDecision(
  value: Record<string, unknown>,
  schemaVersion: 1 | 2 | 3,
): AuditEvent | null {
  const v1Keys = [
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
  ] as const;
  if (
    !hasExactKeys(
      value,
      schemaVersion === 1
        ? v1Keys
        : [...v1Keys, "reasonCode", "attachmentPresent"],
      ["maskedExcerpt"],
    ) ||
    !isPlainDenseDataArray(value.matchedRuleIds, 9) ||
    !isPlainDenseDataArray(value.detectorCategories, 7) ||
    typeof value.policyAction !== "string" ||
    !["allow", "warn", "redact", "block"].includes(value.policyAction)
  ) {
    return null;
  }

  const policyAction = value.policyAction as PolicyAction;
  const reasonCode =
    schemaVersion === 1
      ? value.matchedRuleIds.length === 1 &&
        value.matchedRuleIds[0] === POLICY_NO_FINDINGS_RULE.id
        ? "no_findings"
        : "policy_match"
      : value.reasonCode;
  const attachmentPresent =
    schemaVersion === 1 ? false : value.attachmentPresent;

  if (reasonCode === "no_findings") {
    const migrated = {
      ...withoutLegacyApplication(value),
      adapterId: "chatgpt",
      surfaceId: "chatgpt_web",
      ...(schemaVersion === 1 ? { reasonCode, attachmentPresent } : {}),
    };
    return isAuditEvent(migrated) ? structuredClone(migrated) : null;
  }
  if (
    (reasonCode !== "policy_match" &&
      reasonCode !== "unsupported_attachment") ||
    typeof attachmentPresent !== "boolean"
  ) {
    return null;
  }

  const attachmentContributed = reasonCode === "unsupported_attachment";
  const hadAttachmentRule = value.matchedRuleIds.includes(
    ATTACHMENT_POLICY_RULE_ID,
  );
  if (
    (attachmentContributed && (!attachmentPresent || !hadAttachmentRule)) ||
    (!attachmentPresent && hadAttachmentRule)
  ) {
    return null;
  }

  const findingRuleIds = value.matchedRuleIds.filter(
    (ruleId): ruleId is string =>
      typeof ruleId === "string" && ruleId !== ATTACHMENT_POLICY_RULE_ID,
  );
  if (
    findingRuleIds.length !==
    value.matchedRuleIds.length - (hadAttachmentRule ? 1 : 0)
  ) {
    return null;
  }
  const rules = findingRuleIds.map((ruleId) =>
    LEGACY_FINDING_RULE_BY_ID.get(ruleId),
  );
  if (rules.some((rule) => rule === undefined)) {
    return null;
  }
  const findingRules = rules.filter(
    (rule): rule is NonNullable<typeof rule> => rule !== undefined,
  );
  const fixedRules = findingRules.filter(
    (rule) => rule.actionSource.mode === "fixed",
  );
  if (
    fixedRules.some(
      (rule) =>
        rule.actionSource.mode === "fixed" &&
        rule.actionSource.requiredAction !== policyAction &&
        POLICY_ACTION_PRECEDENCE.indexOf(rule.actionSource.requiredAction) >=
          POLICY_ACTION_PRECEDENCE.indexOf(policyAction),
    )
  ) {
    return null;
  }
  const configuredRules = findingRules.filter(
    (rule) => rule.actionSource.mode === "configured",
  );
  if (
    policyAction !== "allow" &&
    configuredRules.length > 0 &&
    (configuredRules.length !== 1 ||
      fixedRules.length !== 0 ||
      attachmentContributed)
  ) {
    return null;
  }

  const contributingRules = findingRules.filter(
    (rule) =>
      rule.actionSource.mode === "configured" ||
      rule.actionSource.requiredAction === policyAction,
  );
  const allCategories = [...new Set(findingRules.map((rule) => rule.category))];
  if (!sameStrings(value.detectorCategories, allCategories)) {
    return null;
  }
  const contributingCategories = [
    ...new Set(contributingRules.map((rule) => rule.category)),
  ];
  const omittedFixedRules = fixedRules.filter(
    (rule) =>
      rule.actionSource.mode === "fixed" &&
      rule.actionSource.requiredAction !== policyAction,
  );
  let findingCount = value.findingCount;
  if (omittedFixedRules.length > 0) {
    if (
      Object.hasOwn(value, "maskedExcerpt") ||
      value.findingCount !== allCategories.length ||
      allCategories.length !== findingRules.length
    ) {
      return null;
    }
    findingCount = contributingCategories.length;
  }
  const matchedRuleIds = [
    ...contributingRules.map((rule) => rule.id),
    ...(attachmentContributed ? [ATTACHMENT_POLICY_RULE_ID] : []),
  ];
  let resolution = value.resolution;
  if (
    policyAction === "warn" &&
    (resolution === "bypassed" || resolution === "attachment_bypassed")
  ) {
    resolution = attachmentContributed ? "attachment_bypassed" : "bypassed";
  }
  const migrated = {
    ...withoutLegacyApplication(value),
    adapterId: "chatgpt",
    surfaceId: "chatgpt_web",
    detectorCategories: contributingCategories,
    matchedRuleIds,
    findingCount,
    resolution,
    ...(schemaVersion === 1 ? { reasonCode, attachmentPresent } : {}),
  };
  return isAuditEvent(migrated) ? structuredClone(migrated) : null;
}

function migrateLegacyEvent(
  value: unknown,
  schemaVersion: 1 | 2 | 3,
): AuditEvent | null {
  if (
    !isPlainDataRecord(value) ||
    (schemaVersion === 1
      ? value.adapterVersion !== "1"
      : schemaVersion === 2
        ? value.adapterVersion !== "1" && value.adapterVersion !== "2"
        : value.adapterVersion !== "1" &&
          value.adapterVersion !== "2" &&
          value.adapterVersion !== "3") ||
    value.application !== "chatgpt"
  ) {
    return null;
  }
  if (value.kind === "decision") {
    return migrateLegacyDecision(value, schemaVersion);
  }
  if (
    schemaVersion === 1 &&
    value.kind === "adapter_health" &&
    value.healthCode === "ambiguous_submission_context"
  ) {
    return null;
  }
  const migrated = {
    ...withoutLegacyApplication(value),
    adapterId: "chatgpt",
    surfaceId: "chatgpt_web",
  };
  return isAuditEvent(migrated) ? structuredClone(migrated) : null;
}

function migrateLegacyEnvelope(value: unknown): StoredAuditEnvelope | null {
  if (
    !isPlainDataRecord(value) ||
    !hasExactKeys(value, ["schemaVersion", "events"]) ||
    (value.schemaVersion !== 1 &&
      value.schemaVersion !== 2 &&
      value.schemaVersion !== 3) ||
    !isPlainDenseDataArray(value.events, 1_000)
  ) {
    return null;
  }
  const events: AuditEvent[] = [];
  for (const candidate of value.events) {
    const migrated = migrateLegacyEvent(candidate, value.schemaVersion);
    if (migrated !== null) {
      events.push(migrated);
    }
  }
  return { schemaVersion: 4, events };
}

function sanitizeEnvelope(value: unknown): {
  envelope: StoredAuditEnvelope;
  migrated: boolean;
} {
  const migratedEnvelope = migrateLegacyEnvelope(value);
  const source = isStoredAuditEnvelope(value) ? value : migratedEnvelope;
  if (source === null) {
    return { envelope: emptyEnvelope(), migrated: false };
  }

  const events: AuditEvent[] = [];
  const healthEventIds = new Set<string>();
  for (const candidate of source.events) {
    if (!isPersistable(candidate)) {
      continue;
    }
    if (candidate.kind === "adapter_health") {
      if (healthEventIds.has(candidate.id)) {
        continue;
      }
      healthEventIds.add(candidate.id);
    }
    events.push(structuredClone(candidate));
  }
  return {
    envelope: { schemaVersion: 4, events },
    migrated: migratedEnvelope !== null,
  };
}

export function createAuditStore(
  storage: StoragePort,
  settingsStore: SettingsStore,
  storageReady: Promise<void> = Promise.resolve(),
): AuditStore {
  let pendingWrite: Promise<void> = Promise.resolve();

  async function readAndEnforceRetention(): Promise<StoredAuditEnvelope> {
    await storageReady;
    const stored = await storage.read(AUDIT_STORAGE_KEY);
    const sanitized = sanitizeEnvelope(stored);
    const envelope = sanitized.envelope;
    const retention = (await settingsStore.read()).settings.auditRetentionLimit;
    const retainedEvents = envelope.events.slice(-retention);
    const shouldRewrite =
      sanitized.migrated ||
      (isStoredAuditEnvelope(stored) &&
        (stored.events.length !== retainedEvents.length ||
          envelope.events.length !== retainedEvents.length));
    const retained: StoredAuditEnvelope = {
      schemaVersion: 4,
      events: retainedEvents,
    };
    if (shouldRewrite) {
      await storage.write(AUDIT_STORAGE_KEY, structuredClone(retained));
    }
    return retained;
  }

  function serialize<Result>(
    operation: () => Promise<Result>,
  ): Promise<Result> {
    const result = pendingWrite.then(operation, operation);
    pendingWrite = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  return {
    read() {
      return serialize(readAndEnforceRetention);
    },
    async append(candidate) {
      return serialize(async () => {
        await storageReady;
        if (!isAuditEvent(candidate) || !isCurrentCatalogIdentity(candidate)) {
          throw new Error("Invalid audit event.");
        }
        const event = structuredClone(candidate);
        const envelope = await readAndEnforceRetention();
        if (!isPersistable(event)) {
          return "dropped";
        }

        if (
          event.kind === "adapter_health" &&
          envelope.events.some((prior) =>
            isSameHealthRetransmission(prior, event),
          )
        ) {
          return "coalesced";
        }
        const retention = (await settingsStore.read()).settings
          .auditRetentionLimit;
        envelope.events.push(event);
        envelope.events = envelope.events.slice(-retention);
        await storage.write(AUDIT_STORAGE_KEY, structuredClone(envelope));
        return "persisted";
      });
    },
    async clear() {
      await serialize(async () => {
        await storageReady;
        await storage.write(AUDIT_STORAGE_KEY, emptyEnvelope());
      });
    },
    enforceRetention() {
      return serialize(readAndEnforceRetention);
    },
  };
}
