import type { BackgroundChromeApi } from "./bootstrap.js";
import type { RuntimeMessageListener } from "./message-router.js";
import type { RuntimeSender } from "./sender-validation.js";
import type { RuntimePortLike } from "./settings-ports.js";

export type ProductionChromeApi = {
  storage: {
    local: Pick<typeof chrome.storage.local, "get" | "set" | "setAccessLevel">;
  };
  runtime: {
    id: typeof chrome.runtime.id;
    onMessage: Pick<typeof chrome.runtime.onMessage, "addListener">;
    onConnect: Pick<typeof chrome.runtime.onConnect, "addListener">;
  };
};

export function adaptRuntimeSender(
  sender: chrome.runtime.MessageSender,
): RuntimeSender {
  const adapted: RuntimeSender = {};
  if (sender.id !== undefined) adapted.id = sender.id;
  if (sender.url !== undefined) adapted.url = sender.url;
  if (sender.origin !== undefined) adapted.origin = sender.origin;
  if (sender.frameId !== undefined) adapted.frameId = sender.frameId;
  if (sender.documentId !== undefined) adapted.documentId = sender.documentId;
  return adapted;
}

export function adaptRuntimePort(port: chrome.runtime.Port): RuntimePortLike {
  const listenerMap = new Map<
    () => void,
    (disconnectedPort: chrome.runtime.Port) => void
  >();
  const adapted: RuntimePortLike = {
    name: port.name,
    postMessage(message) {
      port.postMessage(message);
    },
    disconnect() {
      port.disconnect();
    },
    onDisconnect: {
      addListener(listener) {
        if (listenerMap.has(listener)) return;
        const wrapped = (): void => listener();
        listenerMap.set(listener, wrapped);
        port.onDisconnect.addListener(wrapped);
      },
      removeListener(listener) {
        const wrapped = listenerMap.get(listener);
        if (wrapped === undefined) return;
        port.onDisconnect.removeListener(wrapped);
        listenerMap.delete(listener);
      },
    },
  };
  if (port.sender !== undefined) {
    adapted.sender = adaptRuntimeSender(port.sender);
  }
  return adapted;
}

export function createProductionChromeApiAdapter(
  source: ProductionChromeApi,
): BackgroundChromeApi {
  return {
    storage: {
      local: {
        async get(key) {
          return source.storage.local.get<Record<string, unknown>>(key);
        },
        async set(items) {
          await source.storage.local.set<Record<string, unknown>>(items);
        },
        async setAccessLevel(options) {
          await source.storage.local.setAccessLevel(options);
        },
      },
    },
    runtime: {
      id: source.runtime.id,
      onMessage: {
        addListener(listener: RuntimeMessageListener) {
          source.runtime.onMessage.addListener(
            (message, sender, sendResponse): true =>
              listener(message, adaptRuntimeSender(sender), (response) =>
                sendResponse(response),
              ),
          );
        },
      },
      onConnect: {
        addListener(listener) {
          source.runtime.onConnect.addListener((port) =>
            listener(adaptRuntimePort(port)),
          );
        },
      },
    },
  };
}
