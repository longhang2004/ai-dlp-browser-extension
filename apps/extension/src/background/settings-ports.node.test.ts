import { describe, expect, it, vi } from "vitest";

import type { StoredSettingsEnvelope } from "@ai-dlp/shared-types";

import { createSettingsStore } from "../storage/settings-store.js";
import { createMemoryStoragePort } from "../storage/storage-port.js";
import {
  createSettingsPortManager,
  type RuntimePortLike,
} from "./settings-ports.js";

const runtimeId = "abcdefghijklmnopabcdefghijklmnop";

function port(overrides: Partial<RuntimePortLike> = {}): RuntimePortLike & {
  fireDisconnect(): void;
  fireMessage(message: unknown): void;
  invokeCapturedMessage(index: number, message: unknown): void;
  invokeCapturedDisconnect(index: number): void;
} {
  const disconnectListeners = new Set<() => void>();
  const messageListeners = new Set<(message: unknown) => void>();
  const capturedDisconnectListeners: Array<() => void> = [];
  const capturedMessageListeners: Array<(message: unknown) => void> = [];
  return {
    name: "settings-v1",
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
    ...overrides,
  };
}

async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
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

    manager.handleConnect(connected);
    await flush();
    expect(connected.postMessage).not.toHaveBeenCalled();

    release();
    await vi.waitFor(() => {
      expect(connected.postMessage).toHaveBeenCalledWith({
        type: "settings.snapshot",
        generation: 0,
        envelope: expect.objectContaining({ schemaVersion: 1 }),
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

    manager.handleConnect(connected);
    await vi.waitFor(() =>
      expect(connected.postMessage).toHaveBeenCalledOnce(),
    );

    expect(connected.postMessage).toHaveBeenCalledWith({
      type: "settings.snapshot",
      generation: 0,
      envelope: {
        schemaVersion: 1,
        settings: {
          protectionEnabled: true,
          emailAction: "warn",
          phoneAction: "warn",
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
    manager.handleConnect(connected);
    manager.handleConnect(disconnected);
    manager.handleConnect(throwing);
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

    manager.handleConnect(connected);
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
    manager.handleConnect(connected);
    await vi.waitFor(() => expect(connected.postMessage).toHaveBeenCalled());

    expect(manager.readStatus(3)).toEqual({
      state: "initializing",
      application: "chatgpt",
      protectionEnabled: null,
      recentEventCount: 3,
    });
    connected.fireMessage({
      type: "status.snapshot",
      generation: 0,
      status: {
        state: "disabled",
        application: "chatgpt",
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
        protectionEnabled: true,
      },
    });
    expect(manager.readStatus(3)).toEqual({
      state: "active",
      application: "chatgpt",
      protectionEnabled: true,
      recentEventCount: 3,
    });
  });

  it("reports unavailable after the last content port disconnects", async () => {
    const manager = createSettingsPortManager({
      runtimeId,
      settingsStore: createSettingsStore(createMemoryStoragePort()),
      storageReady: Promise.resolve(),
    });
    const connected = port();
    manager.handleConnect(connected);
    await vi.waitFor(() => expect(connected.postMessage).toHaveBeenCalled());
    connected.fireMessage({
      type: "status.snapshot",
      generation: 0,
      status: {
        state: "active",
        application: "chatgpt",
        protectionEnabled: true,
      },
    });
    expect(manager.readStatus(0).state).toBe("active");

    connected.fireDisconnect();
    expect(manager.readStatus(0)).toEqual({
      state: "unavailable",
      application: "chatgpt",
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
    manager.handleConnect(healthy);
    manager.handleConnect(degraded);
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
    manager.handleConnect(connected);
    connected.fireMessage({
      type: "status.snapshot",
      generation: 0,
      status: {
        state: "active",
        application: "chatgpt",
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
    manager.handleConnect(connected);
    await vi.waitFor(() => expect(connected.postMessage).toHaveBeenCalled());
    connected.fireDisconnect();
    manager.handleConnect(connected);
    await vi.waitFor(() =>
      expect(connected.postMessage).toHaveBeenCalledTimes(2),
    );

    connected.invokeCapturedMessage(0, {
      type: "status.snapshot",
      generation: 0,
      status: {
        state: "active",
        application: "chatgpt",
        protectionEnabled: true,
      },
    });
    connected.invokeCapturedDisconnect(0);
    expect(manager.readStatus(0).state).toBe("initializing");
  });
});
