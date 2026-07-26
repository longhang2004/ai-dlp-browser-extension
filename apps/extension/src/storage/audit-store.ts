import {
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
  return { schemaVersion: 1, events: [] };
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

function sanitizeEnvelope(value: unknown): StoredAuditEnvelope {
  if (!isStoredAuditEnvelope(value)) {
    return emptyEnvelope();
  }

  const events: AuditEvent[] = [];
  const healthEventIds = new Set<string>();
  for (const candidate of value.events) {
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
  return { schemaVersion: 1, events };
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
    const envelope = sanitizeEnvelope(stored);
    const retention = (await settingsStore.read()).settings.auditRetentionLimit;
    const retainedEvents = envelope.events.slice(-retention);
    const shouldRewrite =
      isStoredAuditEnvelope(stored) &&
      (stored.events.length !== retainedEvents.length ||
        envelope.events.length !== retainedEvents.length);
    const retained: StoredAuditEnvelope = {
      schemaVersion: 1,
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
        if (!isAuditEvent(candidate)) {
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
