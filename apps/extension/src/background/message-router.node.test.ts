import { describe, expect, it, vi } from "vitest";

import {
  CHATGPT_ADAPTER_VERSION,
  createAuditEventId,
  createAuditTimestamp,
} from "@ai-dlp/shared-types";

import { createAuditStore } from "../storage/audit-store.js";
import { createSettingsStore } from "../storage/settings-store.js";
import { createMemoryStoragePort } from "../storage/storage-port.js";
import { createMessageListener } from "./message-router.js";

const runtimeId = "abcdefghijklmnopabcdefghijklmnop";
const extensionSender = {
  id: runtimeId,
  url: `chrome-extension://${runtimeId}/options.html`,
  origin: `chrome-extension://${runtimeId}`,
  frameId: 0,
};
const contentSender = {
  id: runtimeId,
  url: "https://chatgpt.com/c/abc",
  origin: "https://chatgpt.com",
  frameId: 0,
  documentId: "document-1",
};

async function invoke(
  listener: ReturnType<typeof createMessageListener>,
  message: unknown,
  sender = extensionSender,
): Promise<{ returned: boolean; response: unknown }> {
  let respond = (value: unknown): void => {
    throw new Error(`Unexpected response ${String(value)}`);
  };
  const response = new Promise<unknown>((resolve) => {
    respond = resolve;
  });
  const returned = listener(message, sender, respond);
  return { returned, response: await response };
}

function setup(storageReady: Promise<void> = Promise.resolve()) {
  const storage = createMemoryStoragePort();
  const settingsStore = createSettingsStore(storage, storageReady);
  const auditStore = createAuditStore(storage, settingsStore, storageReady);
  const broadcast = vi.fn();
  return {
    broadcast,
    listener: createMessageListener({
      runtimeId,
      storageReady,
      settingsStore,
      auditStore,
      broadcastSettings: broadcast,
    }),
  };
}

describe("message router", () => {
  it("allows Claude removal only from extension pages and delegates to background ownership", async () => {
    const storage = createMemoryStoragePort();
    const settingsStore = createSettingsStore(storage);
    const auditStore = createAuditStore(storage, settingsStore);
    const removeClaudeAccess = vi.fn().mockResolvedValue(true);
    const listener = createMessageListener({
      runtimeId,
      storageReady: Promise.resolve(),
      settingsStore,
      auditStore,
      broadcastSettings: vi.fn(),
      removeClaudeAccess,
    });

    await expect(
      invoke(listener, { type: "permissions.claude.remove" }),
    ).resolves.toEqual({
      returned: true,
      response: { type: "permissions.claude.removed", removed: true },
    });
    expect(removeClaudeAccess).toHaveBeenCalledOnce();

    await expect(
      invoke(listener, { type: "permissions.claude.remove" }, contentSender),
    ).resolves.toEqual({
      returned: true,
      response: { type: "error", errorCode: "invalid_sender" },
    });
    expect(removeClaudeAccess).toHaveBeenCalledOnce();
  });

  it("returns a fixed negative result when Claude permission ownership is unavailable", async () => {
    const { listener } = setup();
    await expect(
      invoke(listener, { type: "permissions.claude.remove" }),
    ).resolves.toEqual({
      returned: true,
      response: { type: "permissions.claude.removed", removed: false },
    });
  });

  it("is non-async, returns literal true, and waits for trusted storage", async () => {
    let release = (): void => undefined;
    const ready = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { listener } = setup(ready);
    const sendResponse = vi.fn();

    const returned = listener(
      { type: "settings.read" },
      extensionSender,
      sendResponse,
    );
    expect(returned).toBe(true);
    expect(sendResponse).not.toHaveBeenCalled();
    release();
    await vi.waitFor(() => {
      expect(sendResponse).toHaveBeenCalledWith(
        expect.objectContaining({ type: "settings.result" }),
      );
    });
  });

  it.each(["prompt", "matchedText", "findings", "redactedText"])(
    "rejects malformed messages containing %s",
    async (forbiddenField) => {
      const { listener } = setup();
      await expect(
        invoke(listener, {
          type: "audit.read",
          [forbiddenField]: "unsafe",
        }),
      ).resolves.toEqual({
        returned: true,
        response: { type: "error", errorCode: "invalid_message" },
      });
    },
  );

  it("rejects invalid senders with a fixed content-free code", async () => {
    const { listener } = setup();
    await expect(
      invoke(
        listener,
        { type: "audit.read" },
        { ...extensionSender, id: "wrong" },
      ),
    ).resolves.toEqual({
      returned: true,
      response: { type: "error", errorCode: "invalid_sender" },
    });
  });

  it("saves settings, broadcasts the persisted clone, and rejects invalid saves", async () => {
    const { listener, broadcast } = setup();
    const read = await invoke(listener, { type: "settings.read" });
    const envelope = (read.response as { envelope: { settings: object } })
      .envelope;
    const saved = await invoke(listener, {
      type: "settings.save",
      settings: { ...envelope.settings, emailAction: "block" },
    });
    expect(saved.response).toMatchObject({
      type: "settings.saved",
      envelope: { settings: { emailAction: "block" } },
    });
    expect(broadcast).toHaveBeenCalledOnce();

    await expect(
      invoke(listener, {
        type: "settings.save",
        settings: { ...envelope.settings, auditRetentionLimit: 0 },
      }),
    ).resolves.toEqual({
      returned: true,
      response: {
        type: "error",
        errorCode: "validation_failure",
        fieldErrors: [{ field: "auditRetentionLimit", code: "out_of_range" }],
      },
    });
  });

  it.each([
    [
      { emailAction: "redact" },
      [{ field: "emailAction", code: "invalid_action" }],
    ],
    [
      { emailAction: "steal" },
      [{ field: "emailAction", code: "invalid_action" }],
    ],
    [
      { protectedKeywords: ["NỘI BỘ", "  nội bộ  "] },
      [{ field: "protectedKeywords", code: "duplicate_keyword" }],
    ],
    [
      { protectedKeywords: [""] },
      [{ field: "protectedKeywords", code: "invalid_keyword" }],
    ],
  ])(
    "returns field errors for bounded settings candidates %#",
    async (change, fieldErrors) => {
      const { listener } = setup();
      const read = await invoke(listener, { type: "settings.read" });
      const settings = (read.response as { envelope: { settings: object } })
        .envelope.settings;
      await expect(
        invoke(listener, {
          type: "settings.save",
          settings: { ...settings, ...change },
        }),
      ).resolves.toEqual({
        returned: true,
        response: {
          type: "error",
          errorCode: "validation_failure",
          fieldErrors,
        },
      });
    },
  );

  it("rejects hidden, symbolic, accessor, cyclic, and proxy settings candidates", async () => {
    const { listener } = setup();
    const hidden = { protectionEnabled: true };
    Object.defineProperty(hidden, "prompt", {
      value: "unsafe",
      enumerable: false,
    });
    const symbolic = { protectionEnabled: true } as Record<
      PropertyKey,
      unknown
    >;
    symbolic[Symbol("prompt")] = "unsafe";
    const accessor = {};
    Object.defineProperty(accessor, "emailAction", {
      enumerable: true,
      get: () => "warn",
    });
    const cyclic: Record<string, unknown> = {};
    cyclic.protectionEnabled = cyclic;
    const proxied = new Proxy({ protectionEnabled: true }, {});

    for (const settings of [hidden, symbolic, accessor, cyclic, proxied]) {
      await expect(
        invoke(listener, { type: "settings.save", settings }),
      ).resolves.toEqual({
        returned: true,
        response: { type: "error", errorCode: "invalid_message" },
      });
    }
  });

  it("returns required field errors for missing known settings fields", async () => {
    const { listener } = setup();
    await expect(
      invoke(listener, {
        type: "settings.save",
        settings: { protectionEnabled: true },
      }),
    ).resolves.toEqual({
      returned: true,
      response: {
        type: "error",
        errorCode: "validation_failure",
        fieldErrors: [
          { field: "surfaces", code: "required" },
          { field: "emailAction", code: "required" },
          { field: "phoneAction", code: "required" },
          { field: "attachmentAction", code: "required" },
          { field: "protectedKeywords", code: "required" },
          { field: "auditRetentionLimit", code: "required" },
        ],
      },
    });
  });

  it.each([
    { type: "settings.save", settings: { prompt: "unsafe" } },
    { type: "settings.save", settings: { unknown: true } },
    { type: "settings.save", settings: { protectedKeywords: [{}] } },
    { type: "settings.save", settings: { protectedKeywords: new Array(103) } },
  ])(
    "keeps unsafe or unbounded settings candidates invalid messages %#",
    async (message) => {
      const { listener } = setup();
      await expect(invoke(listener, message)).resolves.toEqual({
        returned: true,
        response: { type: "error", errorCode: "invalid_message" },
      });
    },
  );

  it("persists lowered audit retention before broadcasting or responding", async () => {
    const storage = createMemoryStoragePort();
    const settingsStore = createSettingsStore(storage);
    const auditStore = createAuditStore(storage, settingsStore);
    for (let sequence = 1; sequence <= 3; sequence += 1) {
      await auditStore.append({
        kind: "enforcement_error",
        id: createAuditEventId(
          `00000000-0000-4000-8000-${String(sequence).padStart(12, "0")}`,
        ),
        timestamp: createAuditTimestamp(`2026-07-26T12:00:0${sequence}.000Z`),
        adapterId: "chatgpt",
        surfaceId: "chatgpt_web",
        errorCode: "detector_failure",
        adapterVersion: CHATGPT_ADAPTER_VERSION,
      });
    }
    const observedCounts: number[] = [];
    const listener = createMessageListener({
      runtimeId,
      storageReady: Promise.resolve(),
      settingsStore,
      auditStore,
      async broadcastSettings() {
        observedCounts.push((await auditStore.read()).events.length);
      },
    });

    const current = await settingsStore.read();
    const saved = await invoke(listener, {
      type: "settings.save",
      settings: { ...current.settings, auditRetentionLimit: 1 },
    });

    expect(saved.response).toMatchObject({ type: "settings.saved" });
    expect(observedCounts).toEqual([1]);
    expect((await auditStore.read()).events).toHaveLength(1);
  });

  it("serializes complete settings-save transactions without reordered broadcasts", async () => {
    const storage = createMemoryStoragePort();
    const settingsStore = createSettingsStore(storage);
    const auditStore = createAuditStore(storage, settingsStore);
    let releaseFirstBroadcast = (): void => undefined;
    const holdFirstBroadcast = new Promise<void>((resolve) => {
      releaseFirstBroadcast = resolve;
    });
    const broadcastActions: string[] = [];
    const listener = createMessageListener({
      runtimeId,
      storageReady: Promise.resolve(),
      settingsStore,
      auditStore,
      async broadcastSettings(envelope) {
        broadcastActions.push(envelope.settings.emailAction);
        if (broadcastActions.length === 1) await holdFirstBroadcast;
      },
    });
    const defaults = (await settingsStore.read()).settings;

    const first = invoke(listener, {
      type: "settings.save",
      settings: { ...defaults, emailAction: "allow" },
    });
    const second = invoke(listener, {
      type: "settings.save",
      settings: { ...defaults, emailAction: "block" },
    });

    await vi.waitFor(() => expect(broadcastActions).toEqual(["allow"]));
    await expect(settingsStore.read()).resolves.toMatchObject({
      settings: { emailAction: "allow" },
    });
    releaseFirstBroadcast();
    await Promise.all([first, second]);

    expect(broadcastActions).toEqual(["allow", "block"]);
    await expect(settingsStore.read()).resolves.toMatchObject({
      settings: { emailAction: "block" },
    });
  });

  it("keeps persisted settings authoritative when immediate audit pruning fails", async () => {
    const storage = createMemoryStoragePort();
    const settingsStore = createSettingsStore(storage);
    const durableAuditStore = createAuditStore(storage, settingsStore);
    for (let sequence = 1; sequence <= 3; sequence += 1) {
      await durableAuditStore.append({
        kind: "enforcement_error",
        id: createAuditEventId(
          `00000000-0000-4000-8000-${String(sequence).padStart(12, "0")}`,
        ),
        timestamp: createAuditTimestamp(`2026-07-26T12:00:0${sequence}.000Z`),
        adapterId: "chatgpt",
        surfaceId: "chatgpt_web",
        errorCode: "detector_failure",
        adapterVersion: CHATGPT_ADAPTER_VERSION,
      });
    }
    let failPruning = true;
    const auditStore = {
      ...durableAuditStore,
      async enforceRetention() {
        if (failPruning) throw new Error("fixed audit failure");
        return durableAuditStore.enforceRetention();
      },
    };
    const broadcasts: string[] = [];
    const listener = createMessageListener({
      runtimeId,
      storageReady: Promise.resolve(),
      settingsStore,
      auditStore,
      broadcastSettings(envelope) {
        broadcasts.push(
          `${envelope.settings.emailAction}:${envelope.settings.auditRetentionLimit}`,
        );
      },
    });
    const defaults = (await settingsStore.read()).settings;

    const first = await invoke(listener, {
      type: "settings.save",
      settings: {
        ...defaults,
        emailAction: "allow",
        auditRetentionLimit: 1,
      },
    });
    expect(first.response).toMatchObject({
      type: "settings.saved",
      envelope: { settings: { emailAction: "allow", auditRetentionLimit: 1 } },
    });
    expect(broadcasts).toEqual(["allow:1"]);
    await expect(settingsStore.read()).resolves.toMatchObject({
      settings: { emailAction: "allow", auditRetentionLimit: 1 },
    });

    failPruning = false;
    await expect(durableAuditStore.read()).resolves.toMatchObject({
      events: [expect.any(Object)],
    });
    await expect(storage.read("audit")).resolves.toMatchObject({
      events: [expect.any(Object)],
    });

    const second = await invoke(listener, {
      type: "settings.save",
      settings: {
        ...defaults,
        emailAction: "block",
        auditRetentionLimit: 2,
      },
    });
    expect(second.response).toMatchObject({ type: "settings.saved" });
    expect(broadcasts).toEqual(["allow:1", "block:2"]);
  });

  it("does not broadcast when settings persistence fails before commit", async () => {
    const durable = createMemoryStoragePort();
    let failWrite = true;
    const storage = {
      read: (key: string) => durable.read(key),
      async write(key: string, value: unknown) {
        if (failWrite) {
          failWrite = false;
          throw new Error("fixed write failure");
        }
        await durable.write(key, value);
      },
    };
    const settingsStore = createSettingsStore(storage);
    const broadcast = vi.fn();
    const listener = createMessageListener({
      runtimeId,
      storageReady: Promise.resolve(),
      settingsStore,
      auditStore: createAuditStore(storage, settingsStore),
      broadcastSettings: broadcast,
    });

    await expect(
      invoke(listener, {
        type: "settings.save",
        settings: {
          protectionEnabled: true,
          surfaces: [
            { surfaceId: "chatgpt_web", enabled: true },
            { surfaceId: "claude_web", enabled: false },
          ],
          emailAction: "warn",
          phoneAction: "warn",
          attachmentAction: "warn",
          protectedKeywords: [],
          auditRetentionLimit: 100,
        },
      }),
    ).resolves.toEqual({
      returned: true,
      response: { type: "error", errorCode: "storage_failure" },
    });
    expect(broadcast).not.toHaveBeenCalled();

    await expect(
      invoke(listener, {
        type: "settings.save",
        settings: {
          protectionEnabled: true,
          surfaces: [
            { surfaceId: "chatgpt_web", enabled: true },
            { surfaceId: "claude_web", enabled: false },
          ],
          emailAction: "block",
          phoneAction: "warn",
          attachmentAction: "warn",
          protectedKeywords: [],
          auditRetentionLimit: 100,
        },
      }),
    ).resolves.toMatchObject({
      response: {
        type: "settings.saved",
        envelope: { settings: { emailAction: "block" } },
      },
    });
    expect(broadcast).toHaveBeenCalledOnce();
  });

  it("routes content audit appends and extension audit read/clear without prompt data", async () => {
    const { listener } = setup();
    const event = {
      kind: "enforcement_error",
      id: createAuditEventId("00000000-0000-4000-8000-000000000001"),
      timestamp: createAuditTimestamp("2026-07-26T12:00:00.000Z"),
      adapterId: "chatgpt",
      surfaceId: "chatgpt_web",
      errorCode: "detector_failure",
      adapterVersion: CHATGPT_ADAPTER_VERSION,
    };
    await expect(
      invoke(listener, { type: "audit.append", event }, contentSender),
    ).resolves.toEqual({
      returned: true,
      response: { type: "audit.appended" },
    });
    expect(await invoke(listener, { type: "audit.read" })).toMatchObject({
      response: { type: "audit.result", envelope: { events: [event] } },
    });
    await expect(invoke(listener, { type: "audit.clear" })).resolves.toEqual({
      returned: true,
      response: { type: "audit.cleared" },
    });
  });

  it("rejects an audit identity whose version does not match the sender catalog descriptor", async () => {
    const { listener } = setup();
    const event = {
      kind: "enforcement_error",
      id: createAuditEventId("00000000-0000-4000-8000-000000000001"),
      timestamp: createAuditTimestamp("2026-07-26T12:00:00.000Z"),
      adapterId: "chatgpt",
      surfaceId: "chatgpt_web",
      errorCode: "detector_failure",
      adapterVersion: "2",
    };

    await expect(
      invoke(listener, { type: "audit.append", event }, contentSender),
    ).resolves.toEqual({
      returned: true,
      response: { type: "error", errorCode: "invalid_sender" },
    });
    expect(await invoke(listener, { type: "audit.read" })).toMatchObject({
      response: { type: "audit.result", envelope: { events: [] } },
    });
  });

  it("rejects alternate-port audit appends without retaining an event", async () => {
    const { listener } = setup();
    const event = {
      kind: "enforcement_error",
      id: createAuditEventId("00000000-0000-4000-8000-000000000001"),
      timestamp: createAuditTimestamp("2026-07-26T12:00:00.000Z"),
      adapterId: "chatgpt",
      surfaceId: "chatgpt_web",
      errorCode: "detector_failure",
      adapterVersion: CHATGPT_ADAPTER_VERSION,
    };

    await expect(
      invoke(
        listener,
        { type: "audit.append", event },
        {
          ...contentSender,
          url: "https://chatgpt.com:8443/",
          origin: "https://chatgpt.com:8443",
        },
      ),
    ).resolves.toEqual({
      returned: true,
      response: { type: "error", errorCode: "invalid_sender" },
    });
    expect(await invoke(listener, { type: "audit.read" })).toMatchObject({
      response: { type: "audit.result", envelope: { events: [] } },
    });
  });

  it("never claims active protection before a validated content status exists", async () => {
    const { listener } = setup();
    await expect(invoke(listener, { type: "status.read" })).resolves.toEqual({
      returned: true,
      response: {
        type: "status.result",
        status: {
          state: "initializing",
          application: null,
          surfaceId: null,
          protectionEnabled: null,
          recentEventCount: 0,
        },
      },
    });
  });

  it("can report active only when Phase 11 supplies a validated readStatus acknowledgement", async () => {
    const storage = createMemoryStoragePort();
    const settingsStore = createSettingsStore(storage);
    const listener = createMessageListener({
      runtimeId,
      storageReady: Promise.resolve(),
      settingsStore,
      auditStore: createAuditStore(storage, settingsStore),
      broadcastSettings: vi.fn(),
      readStatus: async () => ({
        state: "active",
        application: "chatgpt",
        surfaceId: "chatgpt_web",
        protectionEnabled: true,
        recentEventCount: 0,
      }),
    });

    await expect(
      invoke(listener, { type: "status.read" }),
    ).resolves.toMatchObject({
      response: { type: "status.result", status: { state: "active" } },
    });
  });

  it("maps storage failures to a content-free response", async () => {
    const storage = {
      read: vi.fn(async () => {
        throw new Error("unsafe composer contents");
      }),
      write: vi.fn(async () => undefined),
    };
    const settingsStore = createSettingsStore(storage);
    const listener = createMessageListener({
      runtimeId,
      storageReady: Promise.resolve(),
      settingsStore,
      auditStore: createAuditStore(storage, settingsStore),
      broadcastSettings: vi.fn(),
    });
    await expect(invoke(listener, { type: "settings.read" })).resolves.toEqual({
      returned: true,
      response: { type: "error", errorCode: "storage_failure" },
    });
  });
});
