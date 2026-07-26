import { describe, expect, it, vi } from "vitest";

import {
  CHATGPT_ADAPTER_VERSION,
  createAuditEventId,
  createAuditTimestamp,
} from "@ai-dlp/shared-types";

import { bootstrapBackground, type BackgroundChromeApi } from "./bootstrap.js";

describe("background bootstrap", () => {
  it("restricts storage exactly once and registers both listeners synchronously", async () => {
    let release = (): void => undefined;
    const ready = new Promise<void>((resolve) => {
      release = resolve;
    });
    const messageListeners: unknown[] = [];
    const connectListeners: unknown[] = [];
    const api: BackgroundChromeApi = {
      storage: {
        local: {
          get: vi.fn(async () => ({})),
          set: vi.fn(async () => undefined),
          setAccessLevel: vi.fn(() => ready),
        },
      },
      runtime: {
        id: "abcdefghijklmnopabcdefghijklmnop",
        onMessage: {
          addListener(listener) {
            messageListeners.push(listener);
          },
        },
        onConnect: {
          addListener(listener) {
            connectListeners.push(listener);
          },
        },
      },
    };

    const background = bootstrapBackground(api);
    expect(api.storage.local.setAccessLevel).toHaveBeenCalledOnce();
    expect(api.storage.local.setAccessLevel).toHaveBeenCalledWith({
      accessLevel: "TRUSTED_CONTEXTS",
    });
    expect(messageListeners).toHaveLength(1);
    expect(connectListeners).toHaveLength(1);

    release();
    await expect(background.storageReady).resolves.toBeUndefined();
  });

  it("reconstructs reads from storage after a worker restart", async () => {
    const values: Record<string, unknown> = {};
    const listeners: Array<
      (
        message: unknown,
        sender: object,
        sendResponse: (response: unknown) => void,
      ) => boolean
    > = [];
    const api: BackgroundChromeApi = {
      storage: {
        local: {
          async get(key) {
            return { [key]: structuredClone(values[key]) };
          },
          async set(items) {
            Object.assign(values, structuredClone(items));
          },
          async setAccessLevel() {},
        },
      },
      runtime: {
        id: "abcdefghijklmnopabcdefghijklmnop",
        onMessage: { addListener: (listener) => listeners.push(listener) },
        onConnect: { addListener: () => undefined },
      },
    };
    bootstrapBackground(api);
    const firstListener = listeners.at(-1);
    expect(firstListener).toBeDefined();
    await new Promise<void>((resolve) => {
      firstListener?.(
        {
          type: "settings.save",
          settings: {
            protectionEnabled: false,
            emailAction: "warn",
            phoneAction: "warn",
            protectedKeywords: [],
            auditRetentionLimit: 100,
          },
        },
        {
          id: api.runtime.id,
          url: `chrome-extension://${api.runtime.id}/options.html`,
          origin: `chrome-extension://${api.runtime.id}`,
          frameId: 0,
        },
        () => resolve(),
      );
    });

    bootstrapBackground(api);
    const restartedListener = listeners.at(-1);
    const response = await new Promise<unknown>((resolve) => {
      restartedListener?.(
        { type: "settings.read" },
        {
          id: api.runtime.id,
          url: `chrome-extension://${api.runtime.id}/popup.html`,
          origin: `chrome-extension://${api.runtime.id}`,
          frameId: 0,
        },
        resolve,
      );
    });
    expect(response).toMatchObject({
      type: "settings.result",
      envelope: { settings: { protectionEnabled: false } },
    });
  });

  it("reconstructs persisted audit envelopes after a fresh bootstrap", async () => {
    const values: Record<string, unknown> = {};
    const listeners: Array<
      (
        message: unknown,
        sender: object,
        sendResponse: (response: unknown) => void,
      ) => boolean
    > = [];
    const runtimeId = "abcdefghijklmnopabcdefghijklmnop";
    const api: BackgroundChromeApi = {
      storage: {
        local: {
          async get(key) {
            return { [key]: structuredClone(values[key]) };
          },
          async set(items) {
            Object.assign(values, structuredClone(items));
          },
          async setAccessLevel() {},
        },
      },
      runtime: {
        id: runtimeId,
        onMessage: { addListener: (listener) => listeners.push(listener) },
        onConnect: { addListener: () => undefined },
      },
    };
    bootstrapBackground(api);
    const event = {
      kind: "enforcement_error",
      id: createAuditEventId("00000000-0000-4000-8000-000000000001"),
      timestamp: createAuditTimestamp("2026-07-26T12:00:00.000Z"),
      application: "chatgpt",
      errorCode: "detector_failure",
      adapterVersion: CHATGPT_ADAPTER_VERSION,
    };
    await new Promise<void>((resolve) => {
      listeners.at(-1)?.(
        { type: "audit.append", event },
        {
          id: runtimeId,
          url: "https://chatgpt.com/c/abc",
          origin: "https://chatgpt.com",
          frameId: 0,
        },
        () => resolve(),
      );
    });

    bootstrapBackground(api);
    const response = await new Promise<unknown>((resolve) => {
      listeners.at(-1)?.(
        { type: "audit.read" },
        {
          id: runtimeId,
          url: `chrome-extension://${runtimeId}/audit.html`,
          origin: `chrome-extension://${runtimeId}`,
          frameId: 0,
        },
        resolve,
      );
    });

    expect(response).toMatchObject({
      type: "audit.result",
      envelope: { schemaVersion: 1, events: [event] },
    });
  });
});
