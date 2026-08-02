import { describe, expect, it, vi } from "vitest";

import {
  CHATGPT_ADAPTER_VERSION,
  createAuditEventId,
  createAuditTimestamp,
  createDefaultProtectionSettings,
} from "@ai-dlp/shared-types";

import {
  CHATGPT_ADAPTER_DESCRIPTOR,
  CLAUDE_ADAPTER_DESCRIPTOR,
} from "../adapters/adapter-catalog.js";
import {
  CLAUDE_HOST_PERMISSION_PATTERN,
  type PermissionApi,
  type PermissionChange,
} from "@ai-dlp/shared-types/permissions";
import { bootstrapBackground, type BackgroundChromeApi } from "./bootstrap.js";
import {
  CLAUDE_CONTENT_REGISTRATION,
  type RegisteredContentScript,
  type ScriptingApi,
} from "./content-registration.js";
import type { RuntimePortLike } from "./settings-ports.js";

function deferred<T>(): {
  promise: Promise<T>;
  resolve(value: T | PromiseLike<T>): void;
} {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("background bootstrap", () => {
  it("updates the Claude runtime gate after a joint permission grant before accepting a settings port", async () => {
    const runtimeId = "abcdefghijklmnopabcdefghijklmnop";
    const values: Record<string, unknown> = {};
    const messageListeners: Array<
      Parameters<BackgroundChromeApi["runtime"]["onMessage"]["addListener"]>[0]
    > = [];
    const connectListeners: Array<(port: RuntimePortLike) => void> = [];
    const addedListeners = new Set<(change: PermissionChange) => void>();
    let hostGranted = false;
    let namedPermissionGranted = false;
    let registrations: RegisteredContentScript[] = [];
    const permissions: PermissionApi = {
      contains: vi.fn(async (scope) =>
        scope.origins.length > 0 ? hostGranted : namedPermissionGranted,
      ),
      request: vi.fn(async () => false),
      remove: vi.fn(async () => true),
      onAdded: {
        addListener(listener) {
          addedListeners.add(listener);
        },
        removeListener(listener) {
          addedListeners.delete(listener);
        },
      },
      onRemoved: { addListener: vi.fn(), removeListener: vi.fn() },
    };
    const scripting: ScriptingApi = {
      async getRegisteredContentScripts() {
        return [...registrations];
      },
      async registerContentScripts(scripts) {
        registrations = [...scripts];
      },
      async unregisterContentScripts({ ids }) {
        registrations = registrations.filter(
          (script) => !ids.includes(script.id),
        );
      },
    };
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
      permissions,
      scripting,
    };
    bootstrapBackground(api);

    const settings = createDefaultProtectionSettings();
    settings.surfaces = settings.surfaces.map((surface) =>
      surface.surfaceId === "claude_web"
        ? { ...surface, enabled: true }
        : surface,
    );
    await new Promise<void>((resolve) => {
      messageListeners[0]?.(
        { type: "settings.save", settings },
        {
          id: runtimeId,
          url: `chrome-extension://${runtimeId}/options.html`,
          origin: `chrome-extension://${runtimeId}`,
          frameId: 0,
        },
        () => resolve(),
      );
    });
    await vi.waitFor(() => expect(registrations).toEqual([]));

    hostGranted = true;
    namedPermissionGranted = true;
    for (const listener of addedListeners) {
      listener({
        kind: "joint",
        scope: {
          permissions: ["scripting"],
          origins: [CLAUDE_HOST_PERMISSION_PATTERN],
        },
      });
    }
    await vi.waitFor(() =>
      expect(registrations).toEqual([CLAUDE_CONTENT_REGISTRATION]),
    );

    const portMessages = new Set<(message: unknown) => void>();
    const port: RuntimePortLike = {
      name: "settings-v2",
      sender: {
        id: runtimeId,
        url: "https://claude.ai/promptguard-test",
        origin: "https://claude.ai",
        frameId: 0,
      },
      postMessage: vi.fn(),
      disconnect: vi.fn(),
      onMessage: {
        addListener(listener) {
          portMessages.add(listener);
        },
        removeListener(listener) {
          portMessages.delete(listener);
        },
      },
      onDisconnect: {
        addListener: vi.fn(),
        removeListener: vi.fn(),
      },
    };
    connectListeners[0]?.(port);
    for (const listener of portMessages) {
      listener({
        type: "content.handshake",
        descriptor: CLAUDE_ADAPTER_DESCRIPTOR,
      });
    }
    await vi.waitFor(() => expect(port.postMessage).toHaveBeenCalled());
    expect(port.disconnect).not.toHaveBeenCalled();
  });

  it("routes extension-page Claude removal through the background manager", async () => {
    const runtimeId = "abcdefghijklmnopabcdefghijklmnop";
    const values: Record<string, unknown> = {};
    const messageListeners: Array<
      Parameters<BackgroundChromeApi["runtime"]["onMessage"]["addListener"]>[0]
    > = [];
    let hostGranted = true;
    let namedPermissionGranted = true;
    const removedListeners = new Set<(change: PermissionChange) => void>();
    const permissions: PermissionApi = {
      contains: vi.fn(async (scope) =>
        scope.origins.length > 0 ? hostGranted : namedPermissionGranted,
      ),
      request: vi.fn(async () => true),
      remove: vi.fn(async (scope) => {
        if (scope.origins.length > 0) {
          hostGranted = false;
          for (const listener of removedListeners) {
            listener({
              kind: "host",
              originPattern: CLAUDE_HOST_PERMISSION_PATTERN,
            });
          }
        }
        if (scope.permissions.length > 0) {
          namedPermissionGranted = false;
          for (const listener of removedListeners) {
            listener({ kind: "named", permission: "scripting" });
          }
        }
        return true;
      }),
      onAdded: { addListener: vi.fn(), removeListener: vi.fn() },
      onRemoved: {
        addListener(listener) {
          removedListeners.add(listener);
        },
        removeListener(listener) {
          removedListeners.delete(listener);
        },
      },
    };
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
        onMessage: {
          addListener: (listener) => messageListeners.push(listener),
        },
        onConnect: { addListener: () => undefined },
      },
      permissions,
      scripting: {
        async getRegisteredContentScripts() {
          return [];
        },
        async registerContentScripts() {},
        async unregisterContentScripts() {},
      },
    };
    bootstrapBackground(api);
    const settings = createDefaultProtectionSettings();
    settings.surfaces = settings.surfaces.map((surface) =>
      surface.surfaceId === "claude_web"
        ? { ...surface, enabled: true }
        : surface,
    );
    const extensionSender = {
      id: runtimeId,
      url: `chrome-extension://${runtimeId}/options.html`,
      origin: `chrome-extension://${runtimeId}`,
      frameId: 0,
    };
    await new Promise<void>((resolve) => {
      messageListeners[0]?.(
        { type: "settings.save", settings },
        extensionSender,
        () => resolve(),
      );
    });

    const removed = await new Promise<unknown>((resolve) => {
      messageListeners[0]?.(
        { type: "permissions.claude.remove" },
        extensionSender,
        resolve,
      );
    });
    expect(removed).toEqual({
      type: "permissions.claude.removed",
      removed: true,
    });
    expect(permissions.remove).toHaveBeenNthCalledWith(1, {
      permissions: [],
      origins: [CLAUDE_HOST_PERMISSION_PATTERN],
    });
    expect(permissions.remove).toHaveBeenNthCalledWith(2, {
      permissions: ["scripting"],
      origins: [],
    });

    await new Promise<unknown>((resolve) => {
      messageListeners[0]?.(
        { type: "permissions.claude.remove" },
        { ...extensionSender, url: "https://claude.ai/" },
        resolve,
      );
    }).then((response) =>
      expect(response).toEqual({ type: "error", errorCode: "invalid_sender" }),
    );
  });

  it("does not reopen the Claude gate when settings reconciliation overlaps removal", async () => {
    const runtimeId = "abcdefghijklmnopabcdefghijklmnop";
    const enabledSettings = createDefaultProtectionSettings();
    enabledSettings.surfaces = enabledSettings.surfaces.map((surface) =>
      surface.surfaceId === "claude_web"
        ? { ...surface, enabled: true }
        : surface,
    );
    const values: Record<string, unknown> = {
      settings: { schemaVersion: 3, settings: enabledSettings },
    };
    const messageListeners: Array<
      Parameters<BackgroundChromeApi["runtime"]["onMessage"]["addListener"]>[0]
    > = [];
    const connectListeners: Array<(port: RuntimePortLike) => void> = [];
    const removedListeners = new Set<(change: PermissionChange) => void>();
    const hostRemovalStarted = deferred<void>();
    const releaseHostRemoval = deferred<void>();
    let hostGranted = true;
    let namedPermissionGranted = true;
    let registrations: RegisteredContentScript[] = [];
    let registrationReads = 0;
    const permissions: PermissionApi = {
      contains: vi.fn(async (scope) =>
        scope.origins.length > 0 ? hostGranted : namedPermissionGranted,
      ),
      request: vi.fn(async () => false),
      remove: vi.fn(async (scope) => {
        if (scope.origins.length > 0) {
          hostRemovalStarted.resolve();
          await releaseHostRemoval.promise;
          hostGranted = false;
          for (const listener of removedListeners) {
            listener({
              kind: "host",
              originPattern: CLAUDE_HOST_PERMISSION_PATTERN,
            });
          }
        }
        if (scope.permissions.length > 0) {
          namedPermissionGranted = false;
          for (const listener of removedListeners) {
            listener({ kind: "named", permission: "scripting" });
          }
        }
        return true;
      }),
      onAdded: { addListener: vi.fn(), removeListener: vi.fn() },
      onRemoved: {
        addListener(listener) {
          removedListeners.add(listener);
        },
        removeListener(listener) {
          removedListeners.delete(listener);
        },
      },
    };
    const scripting: ScriptingApi = {
      async getRegisteredContentScripts() {
        registrationReads += 1;
        return [...registrations];
      },
      async registerContentScripts(scripts) {
        registrations = [...scripts];
      },
      async unregisterContentScripts({ ids }) {
        registrations = registrations.filter(
          (script) => !ids.includes(script.id),
        );
      },
    };
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
      permissions,
      scripting,
    };
    bootstrapBackground(api);
    await vi.waitFor(() =>
      expect(registrations).toEqual([CLAUDE_CONTENT_REGISTRATION]),
    );

    const extensionSender = {
      id: runtimeId,
      url: `chrome-extension://${runtimeId}/options.html`,
      origin: `chrome-extension://${runtimeId}`,
      frameId: 0,
    };
    const invoke = (message: unknown): Promise<unknown> =>
      new Promise((resolve) => {
        messageListeners[0]?.(message, extensionSender, resolve);
      });
    const removal = invoke({ type: "permissions.claude.remove" });
    await hostRemovalStarted.promise;

    const save = invoke({ type: "settings.save", settings: enabledSettings });
    await vi.waitFor(() =>
      expect(registrations).toEqual([CLAUDE_CONTENT_REGISTRATION]),
    );

    releaseHostRemoval.resolve();
    await expect(removal).resolves.toEqual({
      type: "permissions.claude.removed",
      removed: true,
    });
    await expect(save).resolves.toMatchObject({ type: "settings.saved" });
    await vi.waitFor(() => expect(registrations).toEqual([]));
    expect(registrationReads).toBeGreaterThanOrEqual(3);

    const portMessages = new Set<(message: unknown) => void>();
    const port: RuntimePortLike = {
      name: "settings-v2",
      sender: {
        id: runtimeId,
        url: "https://claude.ai/promptguard-test",
        origin: "https://claude.ai",
        frameId: 0,
      },
      postMessage: vi.fn(),
      disconnect: vi.fn(),
      onMessage: {
        addListener(listener) {
          portMessages.add(listener);
        },
        removeListener(listener) {
          portMessages.delete(listener);
        },
      },
      onDisconnect: {
        addListener: vi.fn(),
        removeListener: vi.fn(),
      },
    };
    connectListeners[0]?.(port);
    for (const listener of portMessages) {
      listener({
        type: "content.handshake",
        descriptor: CLAUDE_ADAPTER_DESCRIPTOR,
      });
    }
    expect(port.disconnect).toHaveBeenCalledOnce();
    expect(port.postMessage).not.toHaveBeenCalled();
  });

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
      adapterId: "chatgpt",
      surfaceId: "chatgpt_web",
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
      envelope: { schemaVersion: 4, events: [event] },
    });
  });

  it("exposes only validated live content status to extension pages", async () => {
    const messageListeners: Array<
      Parameters<BackgroundChromeApi["runtime"]["onMessage"]["addListener"]>[0]
    > = [];
    const connectListeners: Array<(port: RuntimePortLike) => void> = [];
    const runtimeId = "abcdefghijklmnopabcdefghijklmnop";
    const api: BackgroundChromeApi = {
      storage: {
        local: {
          get: vi.fn(async () => ({})),
          set: vi.fn(async () => undefined),
          setAccessLevel: vi.fn(async () => undefined),
        },
      },
      runtime: {
        id: runtimeId,
        onMessage: {
          addListener: (listener) => messageListeners.push(listener),
        },
        onConnect: {
          addListener: (listener) => connectListeners.push(listener),
        },
      },
    };
    bootstrapBackground(api);
    const portMessages = new Set<(message: unknown) => void>();
    const disconnects = new Set<() => void>();
    const port: RuntimePortLike = {
      name: "settings-v2",
      sender: {
        id: runtimeId,
        url: "https://chatgpt.com/c/abc",
        origin: "https://chatgpt.com",
        frameId: 0,
      },
      postMessage: vi.fn(),
      disconnect: vi.fn(),
      onMessage: {
        addListener: (listener) => portMessages.add(listener),
        removeListener: (listener) => portMessages.delete(listener),
      },
      onDisconnect: {
        addListener: (listener) => disconnects.add(listener),
        removeListener: (listener) => disconnects.delete(listener),
      },
    };
    connectListeners[0]?.(port);
    for (const listener of portMessages) {
      listener({
        type: "content.handshake",
        descriptor: CHATGPT_ADAPTER_DESCRIPTOR,
      });
    }

    const readStatus = () =>
      new Promise<unknown>((resolve) => {
        messageListeners[0]?.(
          { type: "status.read" },
          {
            id: runtimeId,
            url: `chrome-extension://${runtimeId}/popup.html`,
            origin: `chrome-extension://${runtimeId}`,
            frameId: 0,
          },
          resolve,
        );
      });
    await expect(readStatus()).resolves.toMatchObject({
      type: "status.result",
      status: { state: "initializing", protectionEnabled: null },
    });
    await vi.waitFor(() => expect(port.postMessage).toHaveBeenCalled());

    for (const listener of portMessages) {
      listener({
        type: "status.snapshot",
        generation: 0,
        status: {
          state: "active",
          application: "chatgpt",
          surfaceId: "chatgpt_web",
          protectionEnabled: true,
        },
      });
    }
    await expect(readStatus()).resolves.toMatchObject({
      type: "status.result",
      status: { state: "active", protectionEnabled: true },
    });

    for (const listener of disconnects) listener();
    await expect(readStatus()).resolves.toMatchObject({
      type: "status.result",
      status: { state: "unavailable", protectionEnabled: null },
    });
  });

  it("rejects Claude ports and status immediately after host revocation", async () => {
    const runtimeId = "abcdefghijklmnopabcdefghijklmnop";
    const values: Record<string, unknown> = {};
    const messageListeners: Array<
      Parameters<BackgroundChromeApi["runtime"]["onMessage"]["addListener"]>[0]
    > = [];
    const connectListeners: Array<(port: RuntimePortLike) => void> = [];
    let hostGranted = true;
    let namedPermissionGranted = true;
    const removedListeners = new Set<(change: PermissionChange) => void>();
    const emitRemoved = (change: PermissionChange): void => {
      for (const listener of removedListeners) listener(change);
    };
    const permissions: PermissionApi = {
      contains: vi.fn(async (scope) =>
        scope.origins.length > 0 ? hostGranted : namedPermissionGranted,
      ),
      request: vi.fn(async () => true),
      remove: vi.fn(async (scope) => {
        if (scope.origins.length > 0) {
          hostGranted = false;
          emitRemoved({
            kind: "host",
            originPattern: CLAUDE_HOST_PERMISSION_PATTERN,
          });
        }
        if (scope.permissions.length > 0) {
          namedPermissionGranted = false;
          emitRemoved({ kind: "named", permission: "scripting" });
        }
        return true;
      }),
      onAdded: {
        addListener: vi.fn(),
        removeListener: vi.fn(),
      },
      onRemoved: {
        addListener(listener) {
          removedListeners.add(listener);
        },
        removeListener(listener) {
          removedListeners.delete(listener);
        },
      },
    };
    let registrations: RegisteredContentScript[] = [];
    const scripting: ScriptingApi = {
      async getRegisteredContentScripts() {
        return [...registrations];
      },
      async registerContentScripts(scripts) {
        registrations = [...scripts];
      },
      async unregisterContentScripts({ ids }) {
        registrations = registrations.filter(
          (script) => !ids.includes(script.id),
        );
      },
    };
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
      permissions,
      scripting,
    };
    bootstrapBackground(api);
    const settings = createDefaultProtectionSettings();
    settings.surfaces = settings.surfaces.map((surface) =>
      surface.surfaceId === "claude_web"
        ? { ...surface, enabled: true }
        : surface,
    );
    await new Promise<void>((resolve) => {
      messageListeners[0]?.(
        { type: "settings.save", settings },
        {
          id: runtimeId,
          url: `chrome-extension://${runtimeId}/options.html`,
          origin: `chrome-extension://${runtimeId}`,
          frameId: 0,
        },
        () => resolve(),
      );
    });
    await vi.waitFor(() =>
      expect(registrations).toEqual([CLAUDE_CONTENT_REGISTRATION]),
    );

    const portMessages = new Set<(message: unknown) => void>();
    const disconnects = new Set<() => void>();
    const port: RuntimePortLike = {
      name: "settings-v2",
      sender: {
        id: runtimeId,
        url: "https://claude.ai/promptguard-test",
        origin: "https://claude.ai",
        frameId: 0,
      },
      postMessage: vi.fn(),
      disconnect: vi.fn(),
      onMessage: {
        addListener: (listener) => portMessages.add(listener),
        removeListener: (listener) => portMessages.delete(listener),
      },
      onDisconnect: {
        addListener: (listener) => disconnects.add(listener),
        removeListener: (listener) => disconnects.delete(listener),
      },
    };
    connectListeners[0]?.(port);
    for (const listener of portMessages) {
      listener({
        type: "content.handshake",
        descriptor: CLAUDE_ADAPTER_DESCRIPTOR,
      });
    }
    await vi.waitFor(() => expect(port.postMessage).toHaveBeenCalled());
    const snapshotMessage = vi.mocked(port.postMessage).mock.calls[0]?.[0] as {
      generation: number;
    };
    for (const listener of portMessages) {
      listener({
        type: "status.snapshot",
        generation: snapshotMessage.generation,
        status: {
          state: "active",
          application: "claude",
          surfaceId: "claude_web",
          protectionEnabled: true,
        },
      });
    }
    const readStatus = () =>
      new Promise<unknown>((resolve) => {
        messageListeners[0]?.(
          { type: "status.read" },
          {
            id: runtimeId,
            url: `chrome-extension://${runtimeId}/popup.html`,
            origin: `chrome-extension://${runtimeId}`,
            frameId: 0,
          },
          resolve,
        );
      });
    await expect(readStatus()).resolves.toMatchObject({
      type: "status.result",
      status: { state: "active", application: "claude" },
    });

    await permissions.remove({
      permissions: [],
      origins: [CLAUDE_HOST_PERMISSION_PATTERN],
    });

    expect(port.disconnect).toHaveBeenCalledOnce();
    for (const listener of disconnects) listener();
    await expect(readStatus()).resolves.toMatchObject({
      type: "status.result",
      status: { state: "unavailable", protectionEnabled: null },
    });
    await vi.waitFor(() => expect(registrations).toEqual([]));
  });

  it("does not reopen the Claude runtime gate from a stale reconciliation after revocation", async () => {
    const runtimeId = "abcdefghijklmnopabcdefghijklmnop";
    const enabledSettings = createDefaultProtectionSettings();
    enabledSettings.surfaces = enabledSettings.surfaces.map((surface) =>
      surface.surfaceId === "claude_web"
        ? { ...surface, enabled: true }
        : surface,
    );
    const values: Record<string, unknown> = {
      settings: { schemaVersion: 3, settings: enabledSettings },
    };
    const messageListeners: Array<
      Parameters<BackgroundChromeApi["runtime"]["onMessage"]["addListener"]>[0]
    > = [];
    const connectListeners: Array<(port: RuntimePortLike) => void> = [];
    const removedListeners = new Set<(change: PermissionChange) => void>();
    const releaseInitialRegistration = deferred<void>();
    const releaseRevokedPermissionRead = deferred<void>();
    let hostGranted = true;
    const namedPermissionGranted = true;
    let hostContainsCalls = 0;
    let registrationReads = 0;
    let registrations: RegisteredContentScript[] = [];
    const permissions: PermissionApi = {
      contains: vi.fn(async (scope) => {
        if (scope.origins.length > 0) {
          hostContainsCalls += 1;
          if (hostContainsCalls > 1) {
            await releaseRevokedPermissionRead.promise;
          }
          return hostGranted;
        }
        return namedPermissionGranted;
      }),
      request: vi.fn(async () => false),
      remove: vi.fn(async () => true),
      onAdded: { addListener: vi.fn(), removeListener: vi.fn() },
      onRemoved: {
        addListener(listener) {
          removedListeners.add(listener);
        },
        removeListener(listener) {
          removedListeners.delete(listener);
        },
      },
    };
    const scripting: ScriptingApi = {
      async getRegisteredContentScripts() {
        registrationReads += 1;
        if (registrationReads === 1) {
          await releaseInitialRegistration.promise;
        }
        return [...registrations];
      },
      async registerContentScripts(scripts) {
        registrations = [...scripts];
      },
      async unregisterContentScripts({ ids }) {
        registrations = registrations.filter(
          (script) => !ids.includes(script.id),
        );
      },
    };
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
      permissions,
      scripting,
    };
    bootstrapBackground(api);
    await vi.waitFor(() => expect(registrationReads).toBe(1));

    hostGranted = false;
    for (const listener of removedListeners) {
      listener({
        kind: "host",
        originPattern: CLAUDE_HOST_PERMISSION_PATTERN,
      });
    }
    releaseInitialRegistration.resolve();
    await vi.waitFor(() => expect(hostContainsCalls).toBe(2));

    const portMessages = new Set<(message: unknown) => void>();
    const port: RuntimePortLike = {
      name: "settings-v2",
      sender: {
        id: runtimeId,
        url: "https://claude.ai/promptguard-test",
        origin: "https://claude.ai",
        frameId: 0,
      },
      postMessage: vi.fn(),
      disconnect: vi.fn(),
      onMessage: {
        addListener(listener) {
          portMessages.add(listener);
        },
        removeListener(listener) {
          portMessages.delete(listener);
        },
      },
      onDisconnect: {
        addListener: vi.fn(),
        removeListener: vi.fn(),
      },
    };
    connectListeners[0]?.(port);
    for (const listener of portMessages) {
      listener({
        type: "content.handshake",
        descriptor: CLAUDE_ADAPTER_DESCRIPTOR,
      });
    }
    expect(port.disconnect).toHaveBeenCalledOnce();
    expect(port.postMessage).not.toHaveBeenCalled();

    releaseRevokedPermissionRead.resolve();
    await vi.waitFor(() => expect(registrations).toEqual([]));
    expect(messageListeners).toHaveLength(1);
  });

  it("does not reopen the Claude runtime gate from a stale reconciliation after settings disablement", async () => {
    const runtimeId = "abcdefghijklmnopabcdefghijklmnop";
    const enabledSettings = createDefaultProtectionSettings();
    enabledSettings.surfaces = enabledSettings.surfaces.map((surface) =>
      surface.surfaceId === "claude_web"
        ? { ...surface, enabled: true }
        : surface,
    );
    const disabledSettings = {
      ...enabledSettings,
      surfaces: enabledSettings.surfaces.map((surface) =>
        surface.surfaceId === "claude_web"
          ? { ...surface, enabled: false }
          : surface,
      ),
    };
    const values: Record<string, unknown> = {
      settings: { schemaVersion: 3, settings: enabledSettings },
    };
    const messageListeners: Array<
      Parameters<BackgroundChromeApi["runtime"]["onMessage"]["addListener"]>[0]
    > = [];
    const connectListeners: Array<(port: RuntimePortLike) => void> = [];
    const releaseInitialRegistration = deferred<void>();
    const releaseDisabledCleanup = deferred<void>();
    let registrations: RegisteredContentScript[] = [];
    let registrationReads = 0;
    const permissions: PermissionApi = {
      contains: vi.fn(async (scope) =>
        scope.origins.length > 0 ? true : true,
      ),
      request: vi.fn(async () => false),
      remove: vi.fn(async () => true),
      onAdded: { addListener: vi.fn(), removeListener: vi.fn() },
      onRemoved: { addListener: vi.fn(), removeListener: vi.fn() },
    };
    const scripting: ScriptingApi = {
      async getRegisteredContentScripts() {
        registrationReads += 1;
        if (registrationReads === 1) {
          await releaseInitialRegistration.promise;
        }
        if (registrationReads === 2) {
          await releaseDisabledCleanup.promise;
        }
        return [...registrations];
      },
      async registerContentScripts(scripts) {
        registrations = [...scripts];
      },
      async unregisterContentScripts({ ids }) {
        registrations = registrations.filter(
          (script) => !ids.includes(script.id),
        );
      },
    };
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
      permissions,
      scripting,
    };
    bootstrapBackground(api);
    await vi.waitFor(() => expect(registrationReads).toBe(1));

    const extensionSender = {
      id: runtimeId,
      url: `chrome-extension://${runtimeId}/options.html`,
      origin: `chrome-extension://${runtimeId}`,
      frameId: 0,
    };
    const save = new Promise<void>((resolve) => {
      messageListeners[0]?.(
        { type: "settings.save", settings: disabledSettings },
        extensionSender,
        () => resolve(),
      );
    });
    await save;
    releaseInitialRegistration.resolve();
    await vi.waitFor(() => expect(registrationReads).toBe(2));

    const portMessages = new Set<(message: unknown) => void>();
    const port: RuntimePortLike = {
      name: "settings-v2",
      sender: {
        id: runtimeId,
        url: "https://claude.ai/promptguard-test",
        origin: "https://claude.ai",
        frameId: 0,
      },
      postMessage: vi.fn(),
      disconnect: vi.fn(),
      onMessage: {
        addListener(listener) {
          portMessages.add(listener);
        },
        removeListener(listener) {
          portMessages.delete(listener);
        },
      },
      onDisconnect: {
        addListener: vi.fn(),
        removeListener: vi.fn(),
      },
    };
    connectListeners[0]?.(port);
    for (const listener of portMessages) {
      listener({
        type: "content.handshake",
        descriptor: CLAUDE_ADAPTER_DESCRIPTOR,
      });
    }
    expect(port.disconnect).toHaveBeenCalledOnce();
    expect(port.postMessage).not.toHaveBeenCalled();

    releaseDisabledCleanup.resolve();
    await vi.waitFor(() => expect(registrations).toEqual([]));
    expect(values.settings).toMatchObject({
      settings: {
        surfaces: [
          { surfaceId: "chatgpt_web" },
          { surfaceId: "claude_web", enabled: false },
        ],
      },
    });
  });
});
