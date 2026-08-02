import { createAuditStore } from "../storage/audit-store.js";
import {
  createChromeStorage,
  type ChromeLocalStorageArea,
} from "../storage/chrome-storage.js";
import { createSettingsStore } from "../storage/settings-store.js";
import { createProductionChromeApiAdapter } from "./chrome-api-adapter.js";
import {
  createContentRegistrationManager,
  type ContentRegistrationManager,
} from "./content-registration.js";
import {
  createMessageListener,
  type RuntimeMessageListener,
} from "./message-router.js";
import {
  createSettingsPortManager,
  type RuntimePortLike,
} from "./settings-ports.js";
import {
  CLAUDE_HOST_PERMISSION_PATTERN,
  type PermissionApi,
} from "@ai-dlp/shared-types/permissions";
import type { ScriptingApi } from "./content-registration.js";

export type BackgroundChromeApi = {
  storage: { local: ChromeLocalStorageArea };
  runtime: {
    id: string;
    onMessage: { addListener(listener: RuntimeMessageListener): void };
    onConnect: { addListener(listener: (port: RuntimePortLike) => void): void };
  };
  permissions?: PermissionApi;
  scripting?: ScriptingApi;
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
  let claudeRuntimeAllowed = false;
  let disconnectSurface: (surfaceId: string) => void = () => undefined;
  let reconcileClaude: () => void = () => undefined;
  let registrationManager: ContentRegistrationManager | undefined;
  if (api.permissions !== undefined) {
    registrationManager = createContentRegistrationManager({
      permissionApi: api.permissions,
      ...(api.scripting === undefined ? {} : { scripting: api.scripting }),
      readSettings: async () => (await settingsStore.read()).settings,
      getEffectiveSurfacePermissions: async () => {
        const settings = (await settingsStore.read()).settings;
        const hostGranted = await api.permissions!.contains({
          permissions: [],
          origins: [CLAUDE_HOST_PERMISSION_PATTERN],
        });
        const namedPermissionGranted = await api.permissions!.contains({
          permissions: ["scripting"],
          origins: [],
        });
        return [
          {
            surfaceId: "claude_web" as const,
            enabled:
              settings.surfaces.find(
                (surface) => surface.surfaceId === "claude_web",
              )?.enabled ?? false,
            hostGranted,
            namedPermissionGranted,
          },
        ];
      },
      onReconciled(snapshot) {
        claudeRuntimeAllowed = snapshot.registration === "registered";
      },
      invalidateSurface() {
        claudeRuntimeAllowed = false;
        disconnectSurface("claude_web");
      },
    });
    reconcileClaude = () => {
      void registrationManager?.reconcile();
    };
  }
  const settingsPorts = createSettingsPortManager({
    runtimeId: api.runtime.id,
    settingsStore,
    storageReady,
    isDescriptorAllowed: (descriptor) =>
      descriptor.surfaceId !== "claude_web" || claudeRuntimeAllowed,
  });
  disconnectSurface = settingsPorts.disconnectSurface;
  const messageListener = createMessageListener({
    runtimeId: api.runtime.id,
    storageReady,
    settingsStore,
    auditStore,
    broadcastSettings: async (envelope) => settingsPorts.broadcast(envelope),
    readStatus: async () =>
      settingsPorts.readStatus((await auditStore.read()).events.length),
    isContentRuntimeAllowed: (descriptor) =>
      descriptor.surfaceId !== "claude_web" || claudeRuntimeAllowed,
    removeClaudeAccess: () =>
      registrationManager?.removeClaudeAccess() ?? Promise.resolve(false),
    onSettingsSaved() {
      if (registrationManager !== undefined) {
        claudeRuntimeAllowed = false;
        disconnectSurface("claude_web");
        reconcileClaude();
      }
    },
  });

  api.runtime.onMessage.addListener(messageListener);
  api.runtime.onConnect.addListener((port) =>
    settingsPorts.handleConnect(port),
  );
  if (registrationManager !== undefined) {
    void storageReady.then(() => registrationManager?.reconcile());
  }

  return { storageReady };
}

const installedChrome = typeof chrome === "undefined" ? undefined : chrome;

export const installedBackground: BackgroundContext | undefined =
  installedChrome === undefined
    ? undefined
    : bootstrapBackground(createProductionChromeApiAdapter(installedChrome));
