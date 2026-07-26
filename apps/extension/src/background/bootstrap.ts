import { createAuditStore } from "../storage/audit-store.js";
import {
  createChromeStorage,
  type ChromeLocalStorageArea,
} from "../storage/chrome-storage.js";
import { createSettingsStore } from "../storage/settings-store.js";
import { createProductionChromeApiAdapter } from "./chrome-api-adapter.js";
import {
  createMessageListener,
  type RuntimeMessageListener,
} from "./message-router.js";
import {
  createSettingsPortManager,
  type RuntimePortLike,
} from "./settings-ports.js";

export type BackgroundChromeApi = {
  storage: { local: ChromeLocalStorageArea };
  runtime: {
    id: string;
    onMessage: { addListener(listener: RuntimeMessageListener): void };
    onConnect: { addListener(listener: (port: RuntimePortLike) => void): void };
  };
};

export type BackgroundContext = {
  storageReady: Promise<void>;
};

export function bootstrapBackground(
  api: BackgroundChromeApi,
): BackgroundContext {
  const { port: storage, storageReady } = createChromeStorage(
    api.storage.local,
  );
  const settingsStore = createSettingsStore(storage, storageReady);
  const auditStore = createAuditStore(storage, settingsStore, storageReady);
  const settingsPorts = createSettingsPortManager({
    runtimeId: api.runtime.id,
    settingsStore,
    storageReady,
  });
  const messageListener = createMessageListener({
    runtimeId: api.runtime.id,
    storageReady,
    settingsStore,
    auditStore,
    broadcastSettings: async (envelope) => settingsPorts.broadcast(envelope),
    readStatus: async () =>
      settingsPorts.readStatus((await auditStore.read()).events.length),
  });

  api.runtime.onMessage.addListener(messageListener);
  api.runtime.onConnect.addListener((port) =>
    settingsPorts.handleConnect(port),
  );

  return { storageReady };
}

const installedChrome = typeof chrome === "undefined" ? undefined : chrome;

export const installedBackground: BackgroundContext | undefined =
  installedChrome === undefined
    ? undefined
    : bootstrapBackground(createProductionChromeApiAdapter(installedChrome));
