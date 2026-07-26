import { describe, expect, it, vi } from "vitest";

import type { RuntimeMessageListener } from "./message-router.js";
import {
  createProductionChromeApiAdapter,
  type ProductionChromeApi,
} from "./chrome-api-adapter.js";
import type { RuntimePortLike } from "./settings-ports.js";

describe("production Chrome API adapter", () => {
  it("forwards storage and message senders through narrow wrappers", async () => {
    let productionMessageListener:
      | ((
          message: unknown,
          sender: chrome.runtime.MessageSender,
          sendResponse: (response?: unknown) => void,
        ) => void)
      | undefined;
    const get = vi.fn(async () => ({ settings: "stored" }));
    const set = vi.fn(async () => undefined);
    const setAccessLevel = vi.fn(async () => undefined);
    const source = {
      storage: {
        local: {
          get: get as typeof chrome.storage.local.get,
          set: set as typeof chrome.storage.local.set,
          setAccessLevel:
            setAccessLevel as typeof chrome.storage.local.setAccessLevel,
        },
      },
      runtime: {
        id: "abcdefghijklmnopabcdefghijklmnop",
        onMessage: {
          addListener: ((listener) => {
            productionMessageListener = listener;
          }) as typeof chrome.runtime.onMessage.addListener,
        },
        onConnect: {
          addListener: vi.fn() as typeof chrome.runtime.onConnect.addListener,
        },
      },
    } satisfies ProductionChromeApi;
    const adapted = createProductionChromeApiAdapter(source);
    const internalListener = vi.fn(
      (
        _message: unknown,
        _sender: Parameters<RuntimeMessageListener>[1],
        sendResponse: Parameters<RuntimeMessageListener>[2],
      ) => {
        sendResponse({ type: "audit.cleared" });
        return true as const;
      },
    );
    adapted.runtime.onMessage.addListener(internalListener);
    const sendResponse = vi.fn();

    const returned = productionMessageListener?.(
      { type: "audit.clear" },
      {
        id: source.runtime.id,
        url: `chrome-extension://${source.runtime.id}/audit.html`,
        origin: `chrome-extension://${source.runtime.id}`,
        frameId: 0,
        documentId: "document-1",
        nativeApplication: "must-not-forward",
      },
      sendResponse,
    );

    expect(returned).toBe(true);
    expect(internalListener).toHaveBeenCalledWith(
      { type: "audit.clear" },
      {
        id: source.runtime.id,
        url: `chrome-extension://${source.runtime.id}/audit.html`,
        origin: `chrome-extension://${source.runtime.id}`,
        frameId: 0,
        documentId: "document-1",
      },
      expect.any(Function),
    );
    expect(sendResponse).toHaveBeenCalledWith({ type: "audit.cleared" });

    await expect(adapted.storage.local.get("settings")).resolves.toEqual({
      settings: "stored",
    });
    await adapted.storage.local.set({ settings: "next" });
    await adapted.storage.local.setAccessLevel({
      accessLevel: "TRUSTED_CONTEXTS",
    });
    expect(get).toHaveBeenCalledWith("settings");
    expect(set).toHaveBeenCalledWith({ settings: "next" });
    expect(setAccessLevel).toHaveBeenCalledWith({
      accessLevel: "TRUSTED_CONTEXTS",
    });
  });

  it("wraps ports and preserves disconnect listener removal", () => {
    let productionConnectListener:
      ((port: chrome.runtime.Port) => void) | undefined;
    const disconnectListeners = new Set<(port: chrome.runtime.Port) => void>();
    const postMessage = vi.fn();
    const disconnect = vi.fn();
    const productionPort = {
      name: "settings-v1",
      sender: {
        id: "abcdefghijklmnopabcdefghijklmnop",
        url: "https://chatgpt.com/c/abc",
        origin: "https://chatgpt.com",
        frameId: 0,
      },
      postMessage,
      disconnect,
      onDisconnect: {
        addListener: (listener: (port: chrome.runtime.Port) => void) =>
          disconnectListeners.add(listener),
        removeListener: (listener: (port: chrome.runtime.Port) => void) =>
          disconnectListeners.delete(listener),
      } as unknown as chrome.runtime.Port["onDisconnect"],
      onMessage: {} as chrome.runtime.Port["onMessage"],
    } as chrome.runtime.Port;
    const source = {
      storage: {
        local: {
          get: vi.fn() as typeof chrome.storage.local.get,
          set: vi.fn() as typeof chrome.storage.local.set,
          setAccessLevel: vi.fn() as typeof chrome.storage.local.setAccessLevel,
        },
      },
      runtime: {
        id: "abcdefghijklmnopabcdefghijklmnop",
        onMessage: {
          addListener: vi.fn() as typeof chrome.runtime.onMessage.addListener,
        },
        onConnect: {
          addListener: ((listener) => {
            productionConnectListener = listener;
          }) as typeof chrome.runtime.onConnect.addListener,
        },
      },
    } satisfies ProductionChromeApi;
    let adaptedPort: RuntimePortLike | undefined;
    createProductionChromeApiAdapter(source).runtime.onConnect.addListener(
      (port) => {
        adaptedPort = port;
      },
    );

    productionConnectListener?.(productionPort);
    expect(adaptedPort).toMatchObject({
      name: "settings-v1",
      sender: {
        id: source.runtime.id,
        origin: "https://chatgpt.com",
        frameId: 0,
      },
    });
    adaptedPort?.postMessage({ type: "settings.snapshot" });
    adaptedPort?.disconnect();
    expect(postMessage).toHaveBeenCalledWith({ type: "settings.snapshot" });
    expect(disconnect).toHaveBeenCalledOnce();

    const internalDisconnect = vi.fn();
    adaptedPort?.onDisconnect.addListener(internalDisconnect);
    expect(disconnectListeners).toHaveLength(1);
    for (const listener of disconnectListeners) listener(productionPort);
    expect(internalDisconnect).toHaveBeenCalledOnce();
    adaptedPort?.onDisconnect.removeListener?.(internalDisconnect);
    expect(disconnectListeners).toHaveLength(0);
  });
});
