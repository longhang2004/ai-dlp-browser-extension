import { describe, expect, it } from "vitest";

import {
  CHATGPT_ADAPTER_VERSION,
  createAuditEventId,
  createAuditTimestamp,
  createDefaultProtectionSettings,
  type AuditEvent,
} from "@ai-dlp/shared-types";

import { createAuditStore } from "./audit-store.js";
import { createSettingsStore } from "./settings-store.js";
import { createMemoryStoragePort } from "./storage-port.js";

function event(
  sequence: number,
  overrides: Partial<AuditEvent> = {},
): AuditEvent {
  return {
    kind: "decision",
    id: createAuditEventId(
      `00000000-0000-4000-8000-${String(sequence).padStart(12, "0")}`,
    ),
    timestamp: createAuditTimestamp(
      `2026-07-26T12:00:${String(sequence).padStart(2, "0")}.000Z`,
    ),
    application: "chatgpt",
    policyAction: "warn",
    resolution: "cancelled",
    detectorCategories: ["email"],
    matchedRuleIds: ["warn.email"],
    findingCount: 1,
    reasonCode: "policy_match",
    attachmentPresent: false,
    adapterVersion: CHATGPT_ADAPTER_VERSION,
    ...overrides,
  } as AuditEvent;
}

describe("audit store", () => {
  it("returns an empty v2 envelope for missing, corrupt, or unsupported storage", async () => {
    for (const initial of [
      {},
      { audit: "corrupt" },
      { audit: { schemaVersion: 3, events: [] } },
    ]) {
      const storage = createMemoryStoragePort(initial);
      const store = createAuditStore(storage, createSettingsStore(storage));
      expect(await store.read()).toEqual({ schemaVersion: 2, events: [] });
    }
  });

  it("strictly migrates valid v1 history to v2 with decision metadata and preserves adapter version 1", async () => {
    const legacyDecision = {
      kind: "decision",
      id: event(1).id,
      timestamp: event(1).timestamp,
      application: "chatgpt",
      policyAction: "warn",
      resolution: "cancelled",
      detectorCategories: ["email"],
      matchedRuleIds: ["warn.email"],
      findingCount: 1,
      adapterVersion: "1",
    };
    const storage = createMemoryStoragePort({
      audit: { schemaVersion: 1, events: [legacyDecision] },
    });
    const store = createAuditStore(storage, createSettingsStore(storage));

    await expect(store.read()).resolves.toEqual({
      schemaVersion: 2,
      events: [
        {
          ...legacyDecision,
          reasonCode: "policy_match",
          attachmentPresent: false,
        },
      ],
    });
    await expect(storage.read("audit")).resolves.toMatchObject({
      schemaVersion: 2,
    });
  });

  it("does not partially migrate a v1 envelope containing an invalid event", async () => {
    const storage = createMemoryStoragePort({
      audit: {
        schemaVersion: 1,
        events: [
          {
            kind: "decision",
            id: event(1).id,
            timestamp: event(1).timestamp,
            application: "chatgpt",
            policyAction: "warn",
            resolution: "cancelled",
            detectorCategories: ["email"],
            matchedRuleIds: ["warn.email"],
            findingCount: 1,
            adapterVersion: "1",
            filename: "must-not-migrate.txt",
          },
        ],
      },
    });
    const store = createAuditStore(storage, createSettingsStore(storage));

    await expect(store.read()).resolves.toEqual({
      schemaVersion: 2,
      events: [],
    });
  });

  it("rejects health codes that did not exist in the v1 audit schema", async () => {
    const storage = createMemoryStoragePort({
      audit: {
        schemaVersion: 1,
        events: [
          {
            kind: "adapter_health",
            id: event(1).id,
            timestamp: event(1).timestamp,
            application: "chatgpt",
            status: "degraded",
            healthCode: "ambiguous_submission_context",
            adapterVersion: "1",
          },
        ],
      },
    });

    await expect(
      createAuditStore(storage, createSettingsStore(storage)).read(),
    ).resolves.toEqual({ schemaVersion: 2, events: [] });
  });

  it("rejects v1 event arrays with hidden or symbolic metadata", async () => {
    const legacyDecision = {
      kind: "decision",
      id: event(1).id,
      timestamp: event(1).timestamp,
      application: "chatgpt",
      policyAction: "warn",
      resolution: "cancelled",
      detectorCategories: ["email"],
      matchedRuleIds: ["warn.email"],
      findingCount: 1,
      adapterVersion: "1",
    };
    const events = [legacyDecision];
    Object.defineProperty(events, Symbol("private-data"), {
      enumerable: false,
      value: "must-not-cross",
    });
    let storedAudit: unknown = { schemaVersion: 1, events };
    const storage = {
      async read(key: string) {
        return key === "audit" ? storedAudit : undefined;
      },
      async write(key: string, value: unknown) {
        if (key === "audit") storedAudit = value;
      },
      async remove() {},
    };

    await expect(
      createAuditStore(storage, createSettingsStore(storage)).read(),
    ).resolves.toEqual({ schemaVersion: 2, events: [] });
  });

  it("accepts attachment-only decisions without findings, masked excerpts, or file metadata", async () => {
    const storage = createMemoryStoragePort();
    const store = createAuditStore(storage, createSettingsStore(storage));
    const attachmentDecision = event(1, {
      policyAction: "warn",
      resolution: "attachment_bypassed",
      detectorCategories: [],
      matchedRuleIds: ["attachment.unsupported"],
      findingCount: 0,
      reasonCode: "unsupported_attachment",
      attachmentPresent: true,
    });

    await expect(store.append(attachmentDecision)).resolves.toBe("persisted");
    await expect(store.read()).resolves.toEqual({
      schemaVersion: 2,
      events: [attachmentDecision],
    });
    expect(JSON.stringify(attachmentDecision)).not.toMatch(
      /filename|fileCount|mime|size|content|label|html/iu,
    );
  });

  it("accepts adapter version 1 only as migrated history, not a new append", async () => {
    const storage = createMemoryStoragePort();
    const store = createAuditStore(storage, createSettingsStore(storage));

    await expect(
      store.append({ ...event(1), adapterVersion: "1" }),
    ).rejects.toThrow("Invalid audit event.");
  });

  it("drops all allow decisions, including valid stored allow events", async () => {
    const allow = event(1, {
      policyAction: "allow",
      resolution: "submitted",
      detectorCategories: [],
      matchedRuleIds: ["allow.no-findings"],
      findingCount: 0,
      reasonCode: "no_findings",
    });
    const storage = createMemoryStoragePort({
      audit: { schemaVersion: 2, events: [allow] },
    });
    const store = createAuditStore(storage, createSettingsStore(storage));

    await expect(store.read()).resolves.toEqual({
      schemaVersion: 2,
      events: [],
    });
    await expect(store.append(allow)).resolves.toBe("dropped");
    await expect(store.read()).resolves.toEqual({
      schemaVersion: 2,
      events: [],
    });
  });

  it("retains only the configured newest 1-1000 safe events", async () => {
    const storage = createMemoryStoragePort();
    const settings = createSettingsStore(storage);
    await settings.save({
      ...createDefaultProtectionSettings(),
      auditRetentionLimit: 2,
    });
    const store = createAuditStore(storage, settings);

    await store.append(event(1));
    await store.append(event(2));
    await store.append(event(3));

    expect((await store.read()).events.map(({ id }) => id)).toEqual([
      event(2).id,
      event(3).id,
    ]);
  });

  it("persists enforcement errors and coalesces only same-id health retries", async () => {
    const storage = createMemoryStoragePort();
    const store = createAuditStore(storage, createSettingsStore(storage));
    const enforcement: AuditEvent = {
      kind: "enforcement_error",
      id: event(1).id,
      timestamp: event(1).timestamp,
      application: "chatgpt",
      errorCode: "prompt_too_large",
      adapterVersion: CHATGPT_ADAPTER_VERSION,
    };
    const health: AuditEvent = {
      kind: "adapter_health",
      id: event(2).id,
      timestamp: event(2).timestamp,
      application: "chatgpt",
      status: "degraded",
      healthCode: "composer_not_found",
      adapterVersion: CHATGPT_ADAPTER_VERSION,
    };
    const repeatedHealth: AuditEvent = {
      kind: "adapter_health",
      id: health.id,
      timestamp: health.timestamp,
      application: "chatgpt",
      status: "degraded",
      healthCode: "composer_not_found",
      adapterVersion: CHATGPT_ADAPTER_VERSION,
    };
    const recoveredThenDegradedAgain: AuditEvent = {
      ...health,
      id: event(3).id,
      timestamp: event(3).timestamp,
    };

    await expect(store.append(enforcement)).resolves.toBe("persisted");
    await expect(store.append(health)).resolves.toBe("persisted");
    await expect(store.append(repeatedHealth)).resolves.toBe("coalesced");
    await expect(store.append(recoveredThenDegradedAgain)).resolves.toBe(
      "persisted",
    );
    expect((await store.read()).events).toEqual([
      enforcement,
      health,
      recoveredThenDegradedAgain,
    ]);
  });

  it("applies a lowered retention immediately without requiring another append", async () => {
    const storage = createMemoryStoragePort();
    const settings = createSettingsStore(storage);
    const store = createAuditStore(storage, settings);
    await store.append(event(1));
    await store.append(event(2));
    await store.append(event(3));
    await settings.save({
      ...createDefaultProtectionSettings(),
      auditRetentionLimit: 2,
    });

    await expect(store.enforceRetention()).resolves.toMatchObject({
      events: [{ id: event(2).id }, { id: event(3).id }],
    });
    await expect(store.read()).resolves.toMatchObject({
      events: [{ id: event(2).id }, { id: event(3).id }],
    });
    await expect(storage.read("audit")).resolves.toMatchObject({
      events: [{ id: event(2).id }, { id: event(3).id }],
    });
  });

  it("serializes retention reads with concurrent appends", async () => {
    const storage = createMemoryStoragePort();
    const settings = createSettingsStore(storage);
    await settings.save({
      ...createDefaultProtectionSettings(),
      auditRetentionLimit: 2,
    });
    const store = createAuditStore(storage, settings);

    await Promise.all([
      store.append(event(1)),
      store.append(event(2)),
      store.append(event(3)),
      store.read(),
    ]);

    expect((await store.read()).events.map(({ id }) => id)).toEqual([
      event(2).id,
      event(3).id,
    ]);
  });

  it("sanitizes stored same-id health retries but keeps a new degradation id", async () => {
    const first: AuditEvent = {
      kind: "adapter_health",
      id: event(1).id,
      timestamp: event(1).timestamp,
      application: "chatgpt",
      status: "degraded",
      healthCode: "composer_not_found",
      adapterVersion: CHATGPT_ADAPTER_VERSION,
    };
    const retried = structuredClone(first);
    const afterRecovery: AuditEvent = {
      ...first,
      id: event(2).id,
      timestamp: event(2).timestamp,
    };
    const storage = createMemoryStoragePort({
      audit: {
        schemaVersion: 2,
        events: [first, retried, afterRecovery],
      },
    });
    const store = createAuditStore(storage, createSettingsStore(storage));

    await expect(store.read()).resolves.toMatchObject({
      events: [{ id: first.id }, { id: afterRecovery.id }],
    });
    await expect(storage.read("audit")).resolves.toMatchObject({
      events: [{ id: first.id }, { id: afterRecovery.id }],
    });
  });

  it("rejects prompt-bearing events and clears storage", async () => {
    const storage = createMemoryStoragePort();
    const store = createAuditStore(storage, createSettingsStore(storage));

    await expect(
      store.append({ ...event(1), prompt: "unsafe" } as AuditEvent),
    ).rejects.toThrow("Invalid audit event");
    await store.append(event(2));
    await store.clear();
    await expect(store.read()).resolves.toEqual({
      schemaVersion: 2,
      events: [],
    });
  });

  it("recovers its operation queue after injected read and write failures", async () => {
    const durable = createMemoryStoragePort();
    const settings = createSettingsStore(createMemoryStoragePort());
    let failRead = true;
    let failWrite = true;
    const store = createAuditStore(
      {
        async read(key) {
          if (failRead) {
            failRead = false;
            throw new Error("fixed audit read failure");
          }
          return durable.read(key);
        },
        async write(key, value) {
          if (failWrite) {
            failWrite = false;
            throw new Error("fixed audit write failure");
          }
          await durable.write(key, value);
        },
      },
      settings,
    );

    await expect(store.read()).rejects.toThrow("fixed audit read failure");
    await expect(store.read()).resolves.toEqual({
      schemaVersion: 2,
      events: [],
    });
    await expect(store.append(event(1))).rejects.toThrow(
      "fixed audit write failure",
    );
    await expect(store.append(event(2))).resolves.toBe("persisted");
    await expect(store.read()).resolves.toMatchObject({
      events: [{ id: event(2).id }],
    });
  });

  it("retries failed retention pruning on a later append", async () => {
    const durable = createMemoryStoragePort({
      audit: { schemaVersion: 2, events: [event(1), event(2), event(3)] },
    });
    const settings = createSettingsStore(createMemoryStoragePort());
    await settings.save({
      ...createDefaultProtectionSettings(),
      auditRetentionLimit: 1,
    });
    let failWrite = true;
    const store = createAuditStore(
      {
        read: (key) => durable.read(key),
        async write(key, value) {
          if (failWrite) {
            failWrite = false;
            throw new Error("fixed prune failure");
          }
          await durable.write(key, value);
        },
      },
      settings,
    );

    await expect(store.enforceRetention()).rejects.toThrow(
      "fixed prune failure",
    );
    await expect(store.append(event(4))).resolves.toBe("persisted");
    await expect(store.read()).resolves.toMatchObject({
      events: [{ id: event(4).id }],
    });
  });
});
