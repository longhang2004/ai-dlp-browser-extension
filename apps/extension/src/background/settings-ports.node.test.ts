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
} {
  const disconnectListeners = new Set<() => void>();
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
      },
      removeListener(listener) {
        disconnectListeners.delete(listener);
      },
    },
    fireDisconnect() {
      for (const listener of disconnectListeners) listener();
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
        envelope: expect.objectContaining({ schemaVersion: 1 }),
      });
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
    newEnvelope.settings.emailAction = "redact";
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
      envelope: newEnvelope,
    });
  });
});
