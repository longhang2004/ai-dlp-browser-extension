import {
  CHATGPT_ADAPTER_VERSION,
  isAuditEvent,
  isStoredAuditEnvelope,
  type AdapterHealthAuditEvent,
  type AuditEvent,
  type StoredAuditEnvelope,
} from "@ai-dlp/shared-types";

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
  return { schemaVersion: 2, events: [] };
}

function isPersistable(event: AuditEvent): boolean {
  return event.kind !== "decision" || event.policyAction !== "allow";
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

function migrateV1Event(value: unknown): AuditEvent | null {
  if (
    !isPlainDataRecord(value) ||
    value.adapterVersion !== "1" ||
    value.application !== "chatgpt"
  ) {
    return null;
  }
  let migrated: unknown;
  if (value.kind === "decision") {
    if (
      !hasExactKeys(
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
      )
    ) {
      return null;
    }
    migrated = {
      ...value,
      reasonCode:
        Array.isArray(value.matchedRuleIds) &&
        value.matchedRuleIds.length === 1 &&
        value.matchedRuleIds[0] === "allow.no-findings"
          ? "no_findings"
          : "policy_match",
      attachmentPresent: false,
    };
  } else if (value.kind === "enforcement_error") {
    if (
      !hasExactKeys(value, [
        "kind",
        "id",
        "timestamp",
        "application",
        "errorCode",
        "adapterVersion",
      ])
    ) {
      return null;
    }
    migrated = value;
  } else if (value.kind === "adapter_health") {
    if (
      value.healthCode === "ambiguous_submission_context" ||
      !hasExactKeys(value, [
        "kind",
        "id",
        "timestamp",
        "application",
        "status",
        "healthCode",
        "adapterVersion",
      ])
    ) {
      return null;
    }
    migrated = value;
  } else {
    return null;
  }
  return isAuditEvent(migrated) ? structuredClone(migrated) : null;
}

function migrateV1Envelope(value: unknown): StoredAuditEnvelope | null {
  if (
    !isPlainDataRecord(value) ||
    !hasExactKeys(value, ["schemaVersion", "events"]) ||
    value.schemaVersion !== 1 ||
    !isPlainDenseDataArray(value.events, 1_000)
  ) {
    return null;
  }
  const events: AuditEvent[] = [];
  for (const candidate of value.events) {
    const migrated = migrateV1Event(candidate);
    if (migrated === null) return null;
    events.push(migrated);
  }
  return { schemaVersion: 2, events };
}

function sanitizeEnvelope(value: unknown): {
  envelope: StoredAuditEnvelope;
  migrated: boolean;
} {
  const migratedEnvelope = migrateV1Envelope(value);
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
    envelope: { schemaVersion: 2, events },
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
      schemaVersion: 2,
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
        if (
          !isAuditEvent(candidate) ||
          candidate.adapterVersion !== CHATGPT_ADAPTER_VERSION
        ) {
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
