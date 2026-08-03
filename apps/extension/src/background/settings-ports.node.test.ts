import { describe, expect, it, vi } from "vitest";

import type {
  AdapterDescriptor,
  StoredSettingsEnvelope,
} from "@ai-dlp/shared-types";

import {
  CHATGPT_ADAPTER_DESCRIPTOR,
  CLAUDE_ADAPTER_DESCRIPTOR,
} from "../adapters/adapter-catalog.js";
import { createSettingsStore } from "../storage/settings-store.js";
import { createMemoryStoragePort } from "../storage/storage-port.js";
import {
  CONTENT_AUTHORIZATION_TIMEOUT_MS,
  CONTENT_HANDSHAKE_TIMEOUT_MS,
  createSettingsPortManager,
  type RuntimePortLike,
} from "./settings-ports.js";

const runtimeId = "abcdefghijklmnopabcdefghijklmnop";

function port(overrides: Partial<RuntimePortLike> = {}): RuntimePortLike & {
  fireDisconnect(): void;
  fireMessage(message: unknown): void;
  invokeCapturedMessage(index: number, message: unknown): void;
  invokeCapturedDisconnect(index: number): void;
  listenerCounts(): { disconnect: number; message: number };
} {
  const disconnectListeners = new Set<() => void>();
  const messageListeners = new Set<(message: unknown) => void>();
  const capturedDisconnectListeners: Array<() => void> = [];
  const capturedMessageListeners: Array<(message: unknown) => void> = [];
  return {
    name: "settings-v2",
    sender: {
      id: runtimeId,
      url: "https://chatgpt.com/c/abc",
      origin: "https://chatgpt.com",
      frameId: 0,
      documentId: "document-1",
    },
    postMessage: vi.fn(),
    disconnect: vi.fn(),
    onDisconnect: {
      addListener(listener) {
        disconnectListeners.add(listener);
        capturedDisconnectListeners.push(listener);
      },
      removeListener(listener) {
        disconnectListeners.delete(listener);
      },
    },
    onMessage: {
      addListener(listener) {
        messageListeners.add(listener);
        capturedMessageListeners.push(listener);
      },
      removeListener(listener) {
        messageListeners.delete(listener);
      },
    },
    fireDisconnect() {
      for (const listener of disconnectListeners) listener();
    },
    fireMessage(message) {
      for (const listener of messageListeners) listener(message);
    },
    invokeCapturedMessage(index, message) {
      capturedMessageListeners[index]?.(message);
    },
    invokeCapturedDisconnect(index) {
      capturedDisconnectListeners[index]?.();
    },
    listenerCounts() {
      return {
        disconnect: disconnectListeners.size,
        message: messageListeners.size,
      };
    },
    ...overrides,
  };
}

function handshakeScheduler() {
  const scheduled: Array<{
    callback: () => void;
    cancelled: boolean;
    delayMs: number;
  }> = [];
  return {
    scheduler: {
      schedule(callback: () => void, delayMs: number) {
        const entry = { callback, cancelled: false, delayMs };
        scheduled.push(entry);
        return () => {
          entry.cancelled = true;
        };
      },
    },
    runNext() {
      const entry = scheduled.shift();
      if (entry !== undefined && !entry.cancelled) entry.callback();
    },
    scheduled,
  };
}

async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

function handshake(
  connected: ReturnType<typeof port>,
  descriptor: AdapterDescriptor = CHATGPT_ADAPTER_DESCRIPTOR,
  extra: Record<string, unknown> = {},
): void {
  connected.fireMessage({
    type: "content.handshake",
    descriptor: structuredClone(descriptor),
    ...extra,
  });
}

function connect(
  manager: ReturnType<typeof createSettingsPortManager>,
  connected: ReturnType<typeof port>,
): void {
  manager.handleConnect(connected);
  handshake(connected);
}

describe("settings ports", () => {
  it("rejects wrong names and invalid senders", async () => {
    const manager = createSettingsPortManager({
      runtimeId,
      settingsStore: createSettingsStore(createMemoryStoragePort()),
      storageReady: Promise.resolve(),
    });
    const wrongName = port({ name: "wrong" });
    const wrongFrame = port({
      sender: { ...port().sender, frameId: 2 },
    });

    manager.handleConnect(wrongName);
    manager.handleConnect(wrongFrame);
    await flush();

    expect(wrongName.disconnect).toHaveBeenCalledOnce();
    expect(wrongFrame.disconnect).toHaveBeenCalledOnce();
    expect(wrongName.postMessage).not.toHaveBeenCalled();
    expect(wrongFrame.postMessage).not.toHaveBeenCalled();
  });

  it("waits for trusted storage and sends an immediate validated snapshot", async () => {
    let release = (): void => undefined;
    const storageReady = new Promise<void>((resolve) => {
      release = resolve;
    });
    const manager = createSettingsPortManager({
      runtimeId,
      settingsStore: createSettingsStore(
        createMemoryStoragePort(),
        storageReady,
      ),
      storageReady,
    });
    const connected = port();

    connect(manager, connected);
    await flush();
    expect(connected.postMessage).not.toHaveBeenCalled();

    release();
    await vi.waitFor(() => {
      expect(connected.postMessage).toHaveBeenCalledWith({
        type: "settings.snapshot",
        generation: 0,
        envelope: expect.objectContaining({ schemaVersion: 3 }),
      });
    });
  });

  it("migrates legacy redact before the initial content snapshot is sent", async () => {
    const storage = createMemoryStoragePort({
      settings: {
        schemaVersion: 1,
        settings: {
          protectionEnabled: true,
          emailAction: "redact",
          phoneAction: "redact",
          protectedKeywords: [],
          auditRetentionLimit: 100,
        },
      },
    });
    const manager = createSettingsPortManager({
      runtimeId,
      settingsStore: createSettingsStore(storage),
      storageReady: Promise.resolve(),
    });
    const connected = port();

    connect(manager, connected);
    await vi.waitFor(() =>
      expect(connected.postMessage).toHaveBeenCalledOnce(),
    );

    expect(connected.postMessage).toHaveBeenCalledWith({
      type: "settings.snapshot",
      generation: 0,
      envelope: {
        schemaVersion: 3,
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
      },
    });
    expect(
      JSON.stringify(vi.mocked(connected.postMessage).mock.calls),
    ).not.toContain("redact");
    await expect(storage.read("settings")).resolves.toMatchObject({
      settings: { emailAction: "warn", phoneAction: "warn" },
    });
  });

  it("broadcasts saved snapshots and forgets disconnected or throwing ports", async () => {
    const manager = createSettingsPortManager({
      runtimeId,
      settingsStore: createSettingsStore(createMemoryStoragePort()),
      storageReady: Promise.resolve(),
    });
    const connected = port();
    const disconnected = port();
    const throwing = port({
      postMessage: vi.fn(() => {
        throw new Error("context invalidated");
      }),
    });
    connect(manager, connected);
    connect(manager, disconnected);
    connect(manager, throwing);
    await vi.waitFor(() => {
      expect(connected.postMessage).toHaveBeenCalledOnce();
      expect(disconnected.postMessage).toHaveBeenCalledOnce();
      expect(throwing.postMessage).toHaveBeenCalledOnce();
    });
    vi.mocked(connected.postMessage).mockClear();
    vi.mocked(disconnected.postMessage).mockClear();
    disconnected.fireDisconnect();

    const envelope = await createSettingsStore(
      createMemoryStoragePort(),
    ).read();
    await manager.broadcast(envelope);
    await manager.broadcast(envelope);

    expect(connected.postMessage).toHaveBeenCalledTimes(2);
    expect(disconnected.postMessage).not.toHaveBeenCalled();
    expect(throwing.postMessage).toHaveBeenCalledTimes(1);
  });

  it("never lets a delayed initial read overwrite a newer broadcast", async () => {
    let finishRead: ((envelope: StoredSettingsEnvelope) => void) | undefined;
    const delayedRead = new Promise<StoredSettingsEnvelope>((resolve) => {
      finishRead = resolve;
    });
    const baselineStore = createSettingsStore(createMemoryStoragePort());
    const oldEnvelope = await baselineStore.read();
    const newEnvelope = structuredClone(oldEnvelope);
    newEnvelope.settings.emailAction = "block";
    const manager = createSettingsPortManager({
      runtimeId,
      settingsStore: {
        read: () => delayedRead,
        save: (candidate) => baselineStore.save(candidate),
      },
      storageReady: Promise.resolve(),
    });
    const connected = port();

    connect(manager, connected);
    await Promise.resolve();
    await manager.broadcast(newEnvelope);
    finishRead?.(oldEnvelope);
    await flush();

    expect(connected.postMessage).toHaveBeenCalledTimes(1);
    expect(connected.postMessage).toHaveBeenCalledWith({
      type: "settings.snapshot",
      generation: 1,
      envelope: newEnvelope,
    });
  });

  it("reports initializing until an exact prompt-free content status arrives", async () => {
    const manager = createSettingsPortManager({
      runtimeId,
      settingsStore: createSettingsStore(createMemoryStoragePort()),
      storageReady: Promise.resolve(),
    });
    const connected = port();
    connect(manager, connected);
    await vi.waitFor(() => expect(connected.postMessage).toHaveBeenCalled());

    expect(manager.readStatus(3)).toEqual({
      state: "initializing",
      application: "chatgpt",
      surfaceId: "chatgpt_web",
      protectionEnabled: null,
      recentEventCount: 3,
    });
    connected.fireMessage({
      type: "status.snapshot",
      generation: 0,
      status: {
        state: "disabled",
        application: "chatgpt",
        surfaceId: "chatgpt_web",
        protectionEnabled: false,
      },
    });
    expect(manager.readStatus(3).state).toBe("initializing");

    connected.fireMessage({
      type: "status.snapshot",
      generation: 0,
      status: {
        state: "active",
        application: "chatgpt",
        surfaceId: "chatgpt_web",
        protectionEnabled: true,
      },
      prompt: "reject this whole message",
    });
    expect(manager.readStatus(3).state).toBe("initializing");

    connected.fireMessage({
      type: "status.snapshot",
      generation: 0,
      status: {
        state: "active",
        application: "chatgpt",
        surfaceId: "chatgpt_web",
        protectionEnabled: true,
      },
    });
    expect(manager.readStatus(3)).toEqual({
      state: "active",
      application: "chatgpt",
      surfaceId: "chatgpt_web",
      protectionEnabled: true,
      recentEventCount: 3,
    });
  });

  it("accepts disabled status when only the Claude surface is disabled", async () => {
    const manager = createSettingsPortManager({
      runtimeId,
      settingsStore: createSettingsStore(createMemoryStoragePort()),
      storageReady: Promise.resolve(),
    });
    const connected = port({
      sender: {
        ...port().sender,
        url: "https://claude.ai/promptguard-test",
        origin: "https://claude.ai",
      },
    });
    manager.handleConnect(connected);
    handshake(connected, CLAUDE_ADAPTER_DESCRIPTOR);
    await vi.waitFor(() => expect(connected.postMessage).toHaveBeenCalled());

    connected.fireMessage({
      type: "status.snapshot",
      generation: 0,
      status: {
        state: "disabled",
        application: "claude",
        surfaceId: "claude_web",
        protectionEnabled: false,
      },
    });

    expect(manager.readStatus(0)).toEqual({
      state: "disabled",
      application: "claude",
      surfaceId: "claude_web",
      protectionEnabled: false,
      recentEventCount: 0,
    });
  });

  it("reports unavailable after the last content port disconnects", async () => {
    const manager = createSettingsPortManager({
      runtimeId,
      settingsStore: createSettingsStore(createMemoryStoragePort()),
      storageReady: Promise.resolve(),
    });
    const connected = port();
    connect(manager, connected);
    await vi.waitFor(() => expect(connected.postMessage).toHaveBeenCalled());
    connected.fireMessage({
      type: "status.snapshot",
      generation: 0,
      status: {
        state: "active",
        application: "chatgpt",
        surfaceId: "chatgpt_web",
        protectionEnabled: true,
      },
    });
    expect(manager.readStatus(0).state).toBe("active");

    connected.fireDisconnect();
    expect(manager.readStatus(0)).toEqual({
      state: "unavailable",
      application: null,
      surfaceId: null,
      protectionEnabled: null,
      recentEventCount: 0,
    });
  });

  it("ignores a status identity that does not match the handshaken catalog descriptor", async () => {
    const manager = createSettingsPortManager({
      runtimeId,
      settingsStore: createSettingsStore(createMemoryStoragePort()),
      storageReady: Promise.resolve(),
    });
    const connected = port();
    connect(manager, connected);
    await vi.waitFor(() => expect(connected.postMessage).toHaveBeenCalled());

    connected.fireMessage({
      type: "status.snapshot",
      generation: 0,
      status: {
        state: "active",
        application: "claude",
        surfaceId: "claude_web",
        protectionEnabled: true,
      },
    });

    expect(manager.readStatus(0)).toEqual({
      state: "initializing",
      application: "chatgpt",
      surfaceId: "chatgpt_web",
      protectionEnabled: null,
      recentEventCount: 0,
    });
  });

  it("aggregates multiple tabs conservatively", async () => {
    const manager = createSettingsPortManager({
      runtimeId,
      settingsStore: createSettingsStore(createMemoryStoragePort()),
      storageReady: Promise.resolve(),
    });
    const healthy = port();
    const degraded = port();
    connect(manager, healthy);
    connect(manager, degraded);
    await vi.waitFor(() => {
      expect(healthy.postMessage).toHaveBeenCalled();
      expect(degraded.postMessage).toHaveBeenCalled();
    });
    healthy.fireMessage({
      type: "status.snapshot",
      generation: 0,
      status: {
        state: "active",
        application: "chatgpt",
        surfaceId: "chatgpt_web",
        protectionEnabled: true,
      },
    });
    expect(manager.readStatus(0).state).toBe("initializing");
    degraded.fireMessage({
      type: "status.snapshot",
      generation: 0,
      status: {
        state: "degraded",
        application: "chatgpt",
        surfaceId: "chatgpt_web",
        protectionEnabled: true,
      },
    });
    expect(manager.readStatus(0).state).toBe("degraded");

    degraded.fireMessage({
      type: "status.snapshot",
      generation: 0,
      status: {
        state: "disabled",
        application: "chatgpt",
        surfaceId: "chatgpt_web",
        protectionEnabled: false,
      },
    });
    expect(manager.readStatus(0).state).toBe("degraded");
  });

  it("rejects early and stale acknowledgements across overlapping broadcasts", async () => {
    const settingsStore = createSettingsStore(createMemoryStoragePort());
    const manager = createSettingsPortManager({
      runtimeId,
      settingsStore,
      storageReady: Promise.resolve(),
    });
    const connected = port();
    connect(manager, connected);
    connected.fireMessage({
      type: "status.snapshot",
      generation: 0,
      status: {
        state: "active",
        application: "chatgpt",
        surfaceId: "chatgpt_web",
        protectionEnabled: true,
      },
    });
    expect(manager.readStatus(0).state).toBe("initializing");
    await vi.waitFor(() => expect(connected.postMessage).toHaveBeenCalled());
    connected.fireMessage({
      type: "status.snapshot",
      generation: 0,
      status: {
        state: "active",
        application: "chatgpt",
        surfaceId: "chatgpt_web",
        protectionEnabled: true,
      },
    });
    expect(manager.readStatus(0).state).toBe("active");

    const envelope = await settingsStore.read();
    const disabledEnvelope = structuredClone(envelope);
    disabledEnvelope.settings.protectionEnabled = false;
    const first = manager.broadcast(envelope);
    expect(manager.readStatus(0).state).toBe("initializing");
    connected.fireMessage({
      type: "status.snapshot",
      generation: 0,
      status: {
        state: "active",
        application: "chatgpt",
        surfaceId: "chatgpt_web",
        protectionEnabled: true,
      },
    });
    expect(manager.readStatus(0).state).toBe("initializing");
    const second = manager.broadcast(disabledEnvelope);
    await Promise.all([first, second]);
    expect(connected.postMessage).toHaveBeenLastCalledWith(
      expect.objectContaining({ type: "settings.snapshot", generation: 2 }),
    );
    connected.fireMessage({
      type: "status.snapshot",
      generation: 1,
      status: {
        state: "active",
        application: "chatgpt",
        surfaceId: "chatgpt_web",
        protectionEnabled: true,
      },
    });
    expect(manager.readStatus(0).state).toBe("initializing");
    connected.fireMessage({
      type: "status.snapshot",
      generation: 2,
      status: {
        state: "active",
        application: "chatgpt",
        surfaceId: "chatgpt_web",
        protectionEnabled: true,
      },
    });
    expect(manager.readStatus(0).state).toBe("initializing");
    connected.fireMessage({
      type: "status.snapshot",
      generation: 2,
      status: {
        state: "disabled",
        application: "chatgpt",
        surfaceId: "chatgpt_web",
        protectionEnabled: false,
      },
    });
    expect(manager.readStatus(0).state).toBe("disabled");
  });

  it("makes queued callbacks from a detached connection inert", async () => {
    const manager = createSettingsPortManager({
      runtimeId,
      settingsStore: createSettingsStore(createMemoryStoragePort()),
      storageReady: Promise.resolve(),
    });
    const connected = port();
    connect(manager, connected);
    await vi.waitFor(() => expect(connected.postMessage).toHaveBeenCalled());
    connected.fireDisconnect();
    connect(manager, connected);
    await vi.waitFor(() =>
      expect(connected.postMessage).toHaveBeenCalledTimes(2),
    );

    connected.invokeCapturedMessage(0, {
      type: "status.snapshot",
      generation: 0,
      status: {
        state: "active",
        application: "chatgpt",
        surfaceId: "chatgpt_web",
        protectionEnabled: true,
      },
    });
    connected.invokeCapturedDisconnect(0);
    expect(manager.readStatus(0).state).toBe("initializing");
  });

  it("accepts a port only after an exact catalog descriptor handshake", async () => {
    const manager = createSettingsPortManager({
      runtimeId,
      settingsStore: createSettingsStore(createMemoryStoragePort()),
      storageReady: Promise.resolve(),
    });
    const connected = port();

    manager.handleConnect(connected);
    await flush();

    expect(connected.postMessage).not.toHaveBeenCalled();
    expect(manager.readStatus(0)).toEqual({
      state: "unavailable",
      application: null,
      surfaceId: null,
      protectionEnabled: null,
      recentEventCount: 0,
    });

    handshake(connected);
    await vi.waitFor(() => expect(connected.postMessage).toHaveBeenCalled());
    expect(connected.disconnect).not.toHaveBeenCalled();
    expect(manager.readStatus(0).state).toBe("initializing");
  });

  it("rechecks Claude authorization when a pending port handshakes", async () => {
    let claudeAuthorization: "hydrating" | "allowed" | "denied" = "allowed";
    const manager = createSettingsPortManager({
      runtimeId,
      settingsStore: createSettingsStore(createMemoryStoragePort()),
      storageReady: Promise.resolve(),
      getDescriptorAuthorization: (descriptor) =>
        descriptor.surfaceId !== "claude_web" ? "allowed" : claudeAuthorization,
    });
    const connected = port({
      sender: {
        ...port().sender,
        url: "https://claude.ai/promptguard-test",
        origin: "https://claude.ai",
      },
    });

    manager.handleConnect(connected);
    claudeAuthorization = "denied";
    handshake(connected, CLAUDE_ADAPTER_DESCRIPTOR);
    await flush();

    expect(connected.disconnect).toHaveBeenCalledOnce();
    expect(connected.postMessage).not.toHaveBeenCalled();
    expect(manager.readStatus(0).state).toBe("unavailable");
  });

  it("holds an exact Claude handshake during hydration and releases it only after authorization", async () => {
    const timer = handshakeScheduler();
    let claudeAuthorization: "hydrating" | "allowed" | "denied" = "hydrating";
    const read = vi.fn(() =>
      createSettingsStore(createMemoryStoragePort()).read(),
    );
    const manager = createSettingsPortManager({
      runtimeId,
      settingsStore: {
        read,
        save: (candidate) =>
          createSettingsStore(createMemoryStoragePort()).save(candidate),
      },
      storageReady: Promise.resolve(),
      handshakeScheduler: timer.scheduler,
      getDescriptorAuthorization: (descriptor) =>
        descriptor.surfaceId !== "claude_web" ? "allowed" : claudeAuthorization,
    });
    const connected = port({
      sender: {
        ...port().sender,
        url: "https://claude.ai/promptguard-test",
        origin: "https://claude.ai",
      },
    });

    manager.handleConnect(connected);
    handshake(connected, CLAUDE_ADAPTER_DESCRIPTOR);
    await flush();

    expect(timer.scheduled).toHaveLength(2);
    expect(read).not.toHaveBeenCalled();
    expect(connected.postMessage).not.toHaveBeenCalled();
    expect(connected.disconnect).not.toHaveBeenCalled();
    expect(manager.readStatus(0).state).toBe("unavailable");

    claudeAuthorization = "allowed";
    manager.refreshSurfaceAuthorization("claude_web");

    await vi.waitFor(() => expect(connected.postMessage).toHaveBeenCalled());
    expect(timer.scheduled[1]?.cancelled).toBe(true);
    timer.runNext();
    timer.runNext();
    expect(connected.disconnect).not.toHaveBeenCalled();
    expect(manager.readStatus(0).state).toBe("initializing");
  });

  it("expires a fully handshaken Claude port when authorization hydration never settles", async () => {
    const timer = handshakeScheduler();
    let claudeAuthorization: "hydrating" | "allowed" = "hydrating";
    const read = vi.fn(() =>
      createSettingsStore(createMemoryStoragePort()).read(),
    );
    const manager = createSettingsPortManager({
      runtimeId,
      settingsStore: {
        read,
        save: (candidate) =>
          createSettingsStore(createMemoryStoragePort()).save(candidate),
      },
      storageReady: Promise.resolve(),
      handshakeScheduler: timer.scheduler,
      getDescriptorAuthorization: (descriptor) =>
        descriptor.surfaceId !== "claude_web" ? "allowed" : claudeAuthorization,
    });
    const connected = port({
      sender: {
        ...port().sender,
        url: "https://claude.ai/promptguard-test",
        origin: "https://claude.ai",
      },
    });

    manager.handleConnect(connected);
    handshake(connected, CLAUDE_ADAPTER_DESCRIPTOR);
    await flush();

    expect(timer.scheduled).toHaveLength(2);
    expect(timer.scheduled[0]).toMatchObject({
      cancelled: true,
      delayMs: CONTENT_HANDSHAKE_TIMEOUT_MS,
    });
    expect(timer.scheduled[1]).toMatchObject({
      cancelled: false,
      delayMs: CONTENT_AUTHORIZATION_TIMEOUT_MS,
    });
    expect(connected.listenerCounts()).toEqual({
      disconnect: 1,
      message: 1,
    });

    timer.runNext();
    timer.runNext();
    await flush();

    expect(connected.disconnect).toHaveBeenCalledOnce();
    expect(connected.listenerCounts()).toEqual({
      disconnect: 0,
      message: 0,
    });
    expect(read).not.toHaveBeenCalled();
    expect(connected.postMessage).not.toHaveBeenCalled();
    expect(manager.readStatus(0).state).toBe("unavailable");

    claudeAuthorization = "allowed";
    manager.refreshSurfaceAuthorization("claude_web");
    connected.invokeCapturedMessage(0, {
      type: "content.handshake",
      descriptor: CLAUDE_ADAPTER_DESCRIPTOR,
    });
    await flush();

    expect(connected.disconnect).toHaveBeenCalledOnce();
    expect(read).not.toHaveBeenCalled();
    expect(connected.postMessage).not.toHaveBeenCalled();
  });

  it.each(["disconnect", "invalidate", "rehandle"] as const)(
    "cancels a pending authorization timeout on %s",
    async (route) => {
      const timer = handshakeScheduler();
      let claudeAuthorization: "hydrating" | "allowed" = "hydrating";
      const manager = createSettingsPortManager({
        runtimeId,
        settingsStore: createSettingsStore(createMemoryStoragePort()),
        storageReady: Promise.resolve(),
        handshakeScheduler: timer.scheduler,
        getDescriptorAuthorization: (descriptor) =>
          descriptor.surfaceId !== "claude_web"
            ? "allowed"
            : claudeAuthorization,
      });
      const connected = port({
        sender: {
          ...port().sender,
          url: "https://claude.ai/promptguard-test",
          origin: "https://claude.ai",
        },
      });

      manager.handleConnect(connected);
      handshake(connected, CLAUDE_ADAPTER_DESCRIPTOR);
      const authorizationTimeout = timer.scheduled[1];
      expect(authorizationTimeout).toMatchObject({ cancelled: false });

      if (route === "disconnect") connected.fireDisconnect();
      if (route === "invalidate") manager.disconnectSurface("claude_web");
      if (route === "rehandle") manager.handleConnect(connected);

      expect(authorizationTimeout?.cancelled).toBe(true);
      authorizationTimeout?.callback();
      claudeAuthorization = "allowed";
      manager.refreshSurfaceAuthorization("claude_web");
      await flush();

      expect(connected.postMessage).not.toHaveBeenCalled();
      expect(connected.disconnect).toHaveBeenCalledTimes(
        route === "invalidate" ? 1 : 0,
      );
      expect(connected.listenerCounts()).toEqual(
        route === "rehandle"
          ? { disconnect: 1, message: 1 }
          : { disconnect: 0, message: 0 },
      );
    },
  );

  it.each(["denied", "error"] as const)(
    "disconnects a hydrated Claude handshake when authorization resolves to %s",
    async (outcome) => {
      const timer = handshakeScheduler();
      let authorizationRead = 0;
      const manager = createSettingsPortManager({
        runtimeId,
        settingsStore: createSettingsStore(createMemoryStoragePort()),
        storageReady: Promise.resolve(),
        handshakeScheduler: timer.scheduler,
        getDescriptorAuthorization: (descriptor) => {
          if (descriptor.surfaceId !== "claude_web") return "allowed";
          authorizationRead += 1;
          if (authorizationRead <= 2) return "hydrating";
          if (outcome === "error") throw new Error("authorization failed");
          return "denied";
        },
      });
      const connected = port({
        sender: {
          ...port().sender,
          url: "https://claude.ai/promptguard-test",
          origin: "https://claude.ai",
        },
      });

      manager.handleConnect(connected);
      handshake(connected, CLAUDE_ADAPTER_DESCRIPTOR);
      await flush();
      manager.refreshSurfaceAuthorization("claude_web");

      expect(connected.disconnect).toHaveBeenCalledOnce();
      expect(timer.scheduled[1]?.cancelled).toBe(true);
      expect(connected.listenerCounts()).toEqual({
        disconnect: 0,
        message: 0,
      });
      expect(connected.postMessage).not.toHaveBeenCalled();
      expect(manager.readStatus(0).state).toBe("unavailable");
    },
  );

  it("expires a pending content port after the bounded prompt-free handshake timeout", async () => {
    const timer = handshakeScheduler();
    const read = vi.fn(() =>
      createSettingsStore(createMemoryStoragePort()).read(),
    );
    const manager = createSettingsPortManager({
      runtimeId,
      settingsStore: {
        read,
        save: (candidate) =>
          createSettingsStore(createMemoryStoragePort()).save(candidate),
      },
      storageReady: Promise.resolve(),
      handshakeScheduler: timer.scheduler,
    });
    const connected = port();

    manager.handleConnect(connected);

    expect(timer.scheduled).toHaveLength(1);
    expect(timer.scheduled[0]?.delayMs).toBe(CONTENT_HANDSHAKE_TIMEOUT_MS);
    expect(connected.listenerCounts()).toEqual({
      disconnect: 1,
      message: 1,
    });
    expect(manager.readStatus(0).state).toBe("unavailable");

    timer.runNext();
    await flush();

    expect(connected.disconnect).toHaveBeenCalledOnce();
    expect(connected.listenerCounts()).toEqual({
      disconnect: 0,
      message: 0,
    });
    expect(connected.postMessage).not.toHaveBeenCalled();
    expect(read).not.toHaveBeenCalled();
    expect(manager.readStatus(0)).toEqual({
      state: "unavailable",
      application: null,
      surfaceId: null,
      protectionEnabled: null,
      recentEventCount: 0,
    });

    manager.handleConnect(connected);
    handshake(connected);
    await vi.waitFor(() =>
      expect(connected.postMessage).toHaveBeenCalledOnce(),
    );
    timer.runNext();
    expect(connected.disconnect).toHaveBeenCalledOnce();
  });

  it("keeps a rehandled port when a stale initial settings read rejects", async () => {
    let rejectStaleRead: (reason?: unknown) => void = () => undefined;
    const staleRead = new Promise<StoredSettingsEnvelope>(
      (_resolve, reject) => {
        rejectStaleRead = reject;
      },
    );
    const baselineStore = createSettingsStore(createMemoryStoragePort());
    const envelope = await baselineStore.read();
    const read = vi
      .fn<() => Promise<StoredSettingsEnvelope>>()
      .mockReturnValueOnce(staleRead)
      .mockResolvedValueOnce(envelope);
    const manager = createSettingsPortManager({
      runtimeId,
      settingsStore: {
        read,
        save: (candidate) => baselineStore.save(candidate),
      },
      storageReady: Promise.resolve(),
    });
    const connected = port();

    connect(manager, connected);
    await vi.waitFor(() => expect(read).toHaveBeenCalledOnce());
    manager.handleConnect(connected);
    handshake(connected);
    await vi.waitFor(() =>
      expect(connected.postMessage).toHaveBeenCalledOnce(),
    );

    rejectStaleRead(new Error("stale storage failure"));
    await flush();

    expect(connected.disconnect).not.toHaveBeenCalled();
    connected.fireMessage({
      type: "status.snapshot",
      generation: 0,
      status: {
        state: "active",
        application: "chatgpt",
        surfaceId: "chatgpt_web",
        protectionEnabled: true,
      },
    });
    expect(manager.readStatus(0).state).toBe("active");
  });

  it("rejects unknown keys and every mismatched catalog descriptor claim", async () => {
    const mismatches: unknown[] = [
      { adapterId: "claude" },
      { surfaceId: "claude_web" },
      { version: "999" },
      { trust: "discovered" },
      { origins: ["https://claude.ai"] },
      {
        capabilities: {
          ...CHATGPT_ADAPTER_DESCRIPTOR.capabilities,
          attachmentInspection: "verified",
        },
      },
      { entryPoint: "claude-content-script.js" },
    ];

    for (const change of mismatches) {
      const manager = createSettingsPortManager({
        runtimeId,
        settingsStore: createSettingsStore(createMemoryStoragePort()),
        storageReady: Promise.resolve(),
      });
      const connected = port();
      manager.handleConnect(connected);
      handshake(connected, {
        ...CHATGPT_ADAPTER_DESCRIPTOR,
        ...(change as Partial<AdapterDescriptor>),
      });
      await flush();

      expect(connected.disconnect).toHaveBeenCalledOnce();
      expect(connected.postMessage).not.toHaveBeenCalled();
      expect(manager.readStatus(0).state).toBe("unavailable");
    }

    const manager = createSettingsPortManager({
      runtimeId,
      settingsStore: createSettingsStore(createMemoryStoragePort()),
      storageReady: Promise.resolve(),
    });
    const unknownKey = port();
    manager.handleConnect(unknownKey);
    handshake(unknownKey, CHATGPT_ADAPTER_DESCRIPTOR, { metadata: {} });
    await flush();

    expect(unknownKey.disconnect).toHaveBeenCalledOnce();
    expect(unknownKey.postMessage).not.toHaveBeenCalled();
    expect(manager.readStatus(0).state).toBe("unavailable");
  });

  it("rejects a handshake that upgrades prompt replacement to verified", async () => {
    const manager = createSettingsPortManager({
      runtimeId,
      settingsStore: createSettingsStore(createMemoryStoragePort()),
      storageReady: Promise.resolve(),
    });
    const connected = port();
    manager.handleConnect(connected);

    handshake(connected, {
      ...CHATGPT_ADAPTER_DESCRIPTOR,
      capabilities: {
        ...CHATGPT_ADAPTER_DESCRIPTOR.capabilities,
        promptReplacement: "verified",
      },
    });
    await flush();

    expect(connected.disconnect).toHaveBeenCalledOnce();
    expect(connected.postMessage).not.toHaveBeenCalled();
    expect(manager.readStatus(0).state).toBe("unavailable");
  });

  it("does not let status metadata upgrade prompt replacement support", async () => {
    const manager = createSettingsPortManager({
      runtimeId,
      settingsStore: createSettingsStore(createMemoryStoragePort()),
      storageReady: Promise.resolve(),
    });
    const connected = port();
    connect(manager, connected);
    await vi.waitFor(() => expect(connected.postMessage).toHaveBeenCalled());

    connected.fireMessage({
      type: "status.snapshot",
      generation: 0,
      status: {
        state: "active",
        application: "chatgpt",
        surfaceId: "chatgpt_web",
        protectionEnabled: true,
        capabilities: {
          promptReplacement: "verified",
        },
      },
    });

    expect(manager.readStatus(0)).toEqual({
      state: "initializing",
      application: "chatgpt",
      surfaceId: "chatgpt_web",
      protectionEnabled: null,
      recentEventCount: 0,
    });
  });

  it("rejects a malformed first message instead of accepting a content port", async () => {
    for (const message of [
      undefined,
      { type: "content.handshake" },
      { descriptor: CHATGPT_ADAPTER_DESCRIPTOR },
      {
        type: "status.snapshot",
        generation: 0,
        status: {
          state: "initializing",
          application: "chatgpt",
          surfaceId: "chatgpt_web",
          protectionEnabled: null,
        },
      },
    ]) {
      const manager = createSettingsPortManager({
        runtimeId,
        settingsStore: createSettingsStore(createMemoryStoragePort()),
        storageReady: Promise.resolve(),
      });
      const connected = port();

      manager.handleConnect(connected);
      connected.fireMessage(message);
      await flush();

      expect(connected.disconnect).toHaveBeenCalledOnce();
      expect(connected.postMessage).not.toHaveBeenCalled();
      expect(manager.readStatus(0).state).toBe("unavailable");
    }
  });

  it("rejects alternate-port and page-claimed origins without status acceptance", async () => {
    const manager = createSettingsPortManager({
      runtimeId,
      settingsStore: createSettingsStore(createMemoryStoragePort()),
      storageReady: Promise.resolve(),
    });
    const alternatePort = port({
      sender: {
        ...port().sender,
        url: "https://chatgpt.com:8443/",
        origin: "https://chatgpt.com:8443",
      },
    });
    const pageClaim = port({
      sender: {
        ...port().sender,
        url: "https://evil.example/",
        origin: "https://chatgpt.com",
      },
    });

    manager.handleConnect(alternatePort);
    handshake(alternatePort);
    manager.handleConnect(pageClaim);
    handshake(pageClaim);
    await flush();

    for (const rejected of [alternatePort, pageClaim]) {
      expect(rejected.disconnect).toHaveBeenCalledOnce();
      expect(rejected.postMessage).not.toHaveBeenCalled();
    }
    expect(manager.readStatus(0)).toEqual({
      state: "unavailable",
      application: null,
      surfaceId: null,
      protectionEnabled: null,
      recentEventCount: 0,
    });
  });
});
