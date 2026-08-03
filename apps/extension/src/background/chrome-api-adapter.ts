import type { BackgroundChromeApi } from "./bootstrap.js";
import {
  createPermissionApi,
  type PermissionApiSource,
} from "./permission-api.js";
import type {
  ContentScriptRegistration,
  RegisteredContentScript,
  ScriptingApi,
} from "./content-registration.js";
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
  permissions?: Pick<
    typeof chrome.permissions,
    "contains" | "request" | "remove" | "onAdded" | "onRemoved"
  >;
  scripting?: Pick<
    typeof chrome.scripting,
    | "getRegisteredContentScripts"
    | "registerContentScripts"
    | "unregisterContentScripts"
  >;
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
  const messageListenerMap = new Map<
    (message: unknown) => void,
    (message: unknown, sourcePort: chrome.runtime.Port) => void
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
    onMessage: {
      addListener(listener) {
        if (messageListenerMap.has(listener)) return;
        const wrapped = (message: unknown): void => listener(message);
        messageListenerMap.set(listener, wrapped);
        port.onMessage.addListener(wrapped);
      },
      removeListener(listener) {
        const wrapped = messageListenerMap.get(listener);
        if (wrapped === undefined) return;
        port.onMessage.removeListener(wrapped);
        messageListenerMap.delete(listener);
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
  const adapted: BackgroundChromeApi = {
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

  if (source.permissions !== undefined) {
    const added = new Map<
      (payload: unknown) => void,
      (payload: chrome.permissions.Permissions) => void
    >();
    const removed = new Map<
      (payload: unknown) => void,
      (payload: chrome.permissions.Permissions) => void
    >();
    const permissionSource: PermissionApiSource = {
      contains(scope) {
        return source.permissions!.contains({
          permissions: [...scope.permissions],
          origins: [...scope.origins],
        });
      },
      request(scope) {
        return source.permissions!.request({
          permissions: [...scope.permissions],
          origins: [...scope.origins],
        });
      },
      remove(scope) {
        return source.permissions!.remove({
          permissions: [...scope.permissions],
          origins: [...scope.origins],
        });
      },
      onAdded: {
        addListener(listener) {
          const wrapped = (payload: chrome.permissions.Permissions): void =>
            listener(payload);
          added.set(listener, wrapped);
          source.permissions!.onAdded.addListener(wrapped);
        },
        removeListener(listener) {
          const wrapped = added.get(listener);
          if (wrapped === undefined) return;
          source.permissions!.onAdded.removeListener(wrapped);
          added.delete(listener);
        },
      },
      onRemoved: {
        addListener(listener) {
          const wrapped = (payload: chrome.permissions.Permissions): void =>
            listener(payload);
          removed.set(listener, wrapped);
          source.permissions!.onRemoved.addListener(wrapped);
        },
        removeListener(listener) {
          const wrapped = removed.get(listener);
          if (wrapped === undefined) return;
          source.permissions!.onRemoved.removeListener(wrapped);
          removed.delete(listener);
        },
      },
    };
    adapted.permissions = createPermissionApi(permissionSource);
  }

  if (source.scripting !== undefined) {
    const scripting: ScriptingApi = {
      async getRegisteredContentScripts() {
        return (await source.scripting!.getRegisteredContentScripts()).map(
          (script) => ({ ...script }) as RegisteredContentScript,
        );
      },
      async registerContentScripts(
        scripts: readonly ContentScriptRegistration[],
      ) {
        await source.scripting!.registerContentScripts(
          scripts as chrome.scripting.RegisteredContentScript[],
        );
      },
      async unregisterContentScripts(details) {
        await source.scripting!.unregisterContentScripts({
          ids: [...details.ids],
        });
      },
    };
    adapted.scripting = scripting;
  }

  return adapted;
}
