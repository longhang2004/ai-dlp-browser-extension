import { describe, expect, it, vi } from "vitest";

import {
  createDefaultProtectionSettings,
  SETTINGS_PORT_NAME,
} from "@ai-dlp/shared-types";

import {
  createSettingsCache,
  type ContentSettingsPort,
  type RetryScheduler,
} from "./settings-cache.js";

function createPort(): ContentSettingsPort & {
  emitMessage(message: unknown): void;
  emitDisconnect(): void;
  listenerCounts(): { message: number; disconnect: number };
  invokeCapturedMessage(index: number, message: unknown): void;
  invokeCapturedDisconnect(index: number): void;
} {
  const messageListeners = new Set<(message: unknown) => void>();
  const disconnectListeners = new Set<() => void>();
  const capturedMessageListeners: Array<(message: unknown) => void> = [];
  const capturedDisconnectListeners: Array<() => void> = [];
  return {
    name: SETTINGS_PORT_NAME,
    postMessage: vi.fn(),
    disconnect: vi.fn(),
    onMessage: {
      addListener(listener) {
        messageListeners.add(listener);
        capturedMessageListeners.push(listener);
      },
      removeListener(listener) {
        messageListeners.delete(listener);
      },
    },
    onDisconnect: {
      addListener(listener) {
        disconnectListeners.add(listener);
        capturedDisconnectListeners.push(listener);
      },
      removeListener(listener) {
        disconnectListeners.delete(listener);
      },
    },
    emitMessage(message) {
      for (const listener of messageListeners) listener(message);
    },
    emitDisconnect() {
      for (const listener of [...disconnectListeners]) listener();
    },
    listenerCounts() {
      return {
        message: messageListeners.size,
        disconnect: disconnectListeners.size,
      };
    },
    invokeCapturedMessage(index, message) {
      capturedMessageListeners[index]?.(message);
    },
    invokeCapturedDisconnect(index) {
      capturedDisconnectListeners[index]?.();
    },
  };
}

function createScheduler(): RetryScheduler & {
  pending(): Array<{ delayMs: number; run(): void; cancelled: boolean }>;
} {
  const tasks: Array<{
    delayMs: number;
    run(): void;
    cancelled: boolean;
  }> = [];
  return {
    schedule(callback, delayMs) {
      const task = {
        delayMs,
        cancelled: false,
        run() {
          if (!task.cancelled) callback();
        },
      };
      tasks.push(task);
      return () => {
        task.cancelled = true;
      };
    },
    pending() {
      return tasks;
    },
  };
}

function snapshot(enabled = true, generation = 0) {
  const settings = createDefaultProtectionSettings();
  settings.protectionEnabled = enabled;
  return {
    type: "settings.snapshot" as const,
    generation,
    envelope: { schemaVersion: 2 as const, settings },
  };
}

describe("content settings cache", () => {
  it("remains initializing until the first strict validated snapshot", () => {
    const port = createPort();
    const states: string[] = [];
    const received = vi.fn();
    const cache = createSettingsCache({
      connect: vi.fn(() => port),
      scheduler: createScheduler(),
      onConnectionState: (state) => states.push(state),
      onSettings: received,
    });

    cache.start();
    expect(cache.getState()).toBe("initializing");
    expect(cache.getSettings()).toBeNull();

    port.emitMessage({
      type: "settings.snapshot",
      envelope: { schemaVersion: 2 },
    });
    port.emitMessage({ ...snapshot(), prompt: "must be rejected" });
    expect(received).not.toHaveBeenCalled();
    expect(cache.getState()).toBe("initializing");

    port.emitMessage(snapshot());
    expect(cache.getState()).toBe("ready");
    expect(cache.getSettings()).toEqual(snapshot().envelope.settings);
    expect(received).toHaveBeenCalledOnce();
    expect(states).toEqual(["initializing", "ready"]);
  });

  it("drops stale-port messages and requires a fresh snapshot after reconnect", () => {
    const first = createPort();
    const second = createPort();
    const scheduler = createScheduler();
    const connect = vi
      .fn<() => ContentSettingsPort>()
      .mockReturnValueOnce(first)
      .mockReturnValueOnce(second);
    const states: string[] = [];
    const cache = createSettingsCache({
      connect,
      scheduler,
      onConnectionState: (state) => states.push(state),
      onSettings: vi.fn(),
    });

    cache.start();
    first.emitMessage(snapshot());
    first.emitDisconnect();
    expect(cache.getState()).toBe("unavailable");
    expect(cache.getSettings()).toBeNull();
    expect(first.listenerCounts()).toEqual({ message: 0, disconnect: 0 });
    expect(scheduler.pending()[0]?.delayMs).toBe(100);

    scheduler.pending()[0]?.run();
    expect(cache.getState()).toBe("initializing");
    first.emitMessage(snapshot(false));
    expect(cache.getState()).toBe("initializing");

    second.emitMessage(snapshot(false));
    expect(cache.getState()).toBe("ready");
    expect(cache.getSettings()?.protectionEnabled).toBe(false);
    expect(states).toEqual([
      "initializing",
      "ready",
      "unavailable",
      "initializing",
      "ready",
    ]);
    first.invokeCapturedMessage(0, snapshot(true, 99));
    first.invokeCapturedDisconnect(0);
    expect(cache.getSettings()?.protectionEnabled).toBe(false);
    expect(cache.getState()).toBe("ready");
  });

  it("binds status acknowledgements to the validated snapshot generation", () => {
    const port = createPort();
    const cache = createSettingsCache({
      connect: () => port,
      scheduler: createScheduler(),
      onConnectionState: vi.fn(),
      onSettings: vi.fn(),
    });
    cache.start();

    expect(
      cache.postStatus({
        state: "active",
        application: "chatgpt",
        surfaceId: "chatgpt_web",
        protectionEnabled: true,
      }),
    ).toBe(false);
    port.emitMessage(snapshot(true, 7));
    expect(
      cache.postStatus({
        state: "active",
        application: "chatgpt",
        surfaceId: "chatgpt_web",
        protectionEnabled: true,
      }),
    ).toBe(true);
    expect(port.postMessage).toHaveBeenLastCalledWith({
      type: "status.snapshot",
      generation: 7,
      status: {
        state: "active",
        application: "chatgpt",
        surfaceId: "chatgpt_web",
        protectionEnabled: true,
      },
    });
    port.emitMessage(snapshot(false, 6));
    expect(cache.getSettings()?.protectionEnabled).toBe(true);
    expect(port.postMessage).toHaveBeenCalledTimes(1);
  });

  it("uses capped reconnect backoff and recovers from connect exceptions", () => {
    const scheduler = createScheduler();
    const finalPort = createPort();
    const connect = vi
      .fn<() => ContentSettingsPort>()
      .mockImplementationOnce(() => {
        throw new Error("extension context unavailable");
      })
      .mockImplementationOnce(() => {
        throw new Error("extension context unavailable");
      })
      .mockReturnValue(finalPort);
    const cache = createSettingsCache({
      connect,
      scheduler,
      onConnectionState: vi.fn(),
      onSettings: vi.fn(),
      reconnectDelaysMs: [100, 250],
    });

    cache.start();
    expect(cache.getState()).toBe("unavailable");
    expect(scheduler.pending()[0]?.delayMs).toBe(100);
    scheduler.pending()[0]?.run();
    expect(scheduler.pending()[1]?.delayMs).toBe(250);
    scheduler.pending()[1]?.run();
    expect(cache.getState()).toBe("initializing");

    finalPort.emitDisconnect();
    expect(scheduler.pending()[2]?.delayMs).toBe(250);
  });

  it("starts and disposes idempotently without leaving port listeners or retries", () => {
    const port = createPort();
    const scheduler = createScheduler();
    const connect = vi.fn(() => port);
    const cache = createSettingsCache({
      connect,
      scheduler,
      onConnectionState: vi.fn(),
      onSettings: vi.fn(),
    });

    cache.start();
    cache.start();
    expect(connect).toHaveBeenCalledOnce();
    expect(port.listenerCounts()).toEqual({ message: 1, disconnect: 1 });

    port.emitDisconnect();
    cache.dispose();
    cache.dispose();
    expect(scheduler.pending()[0]?.cancelled).toBe(true);
    expect(port.disconnect).not.toHaveBeenCalled();
    expect(cache.getState()).toBe("disposed");
  });
});
