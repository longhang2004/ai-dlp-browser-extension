import {
  SETTINGS_PORT_NAME,
  cloneProtectionSettings,
  createAuditEventId,
  createAuditTimestamp,
  type AdapterDescriptor,
  type AuditEvent,
  type ContentProtectionStatus,
  type ProtectionSettings,
} from "@ai-dlp/shared-types";

import type {
  AdapterHealthTransition,
  AdapterLifecycleOptions,
} from "../adapters/chat-application-adapter.js";
import type { DocumentAdapterRegistry } from "../adapters/catalog-registry.js";
import {
  createProtectionDialogController,
  type ProtectionDialogController,
  type ProtectionDialogControllerOptions,
} from "../ui/protection-dialog/dialog-controller.js";
import {
  createSettingsCache,
  type ContentSettingsPort,
  type RetryScheduler,
} from "./settings-cache.js";
import {
  createSubmissionController,
  type SubmissionController,
  type SubmissionControllerOptions,
} from "./submission-controller.js";
import {
  areEnforcementSettingsEqual,
  snapshotEnforcementSettings,
  type EnforcementRevision,
  type EnforcementSettings,
} from "./enforcement-settings.js";

export type ContentRuntimePort = ContentSettingsPort;

export type ContentRuntime = {
  connect(options: { name: typeof SETTINGS_PORT_NAME }): ContentRuntimePort;
  sendMessage(message: unknown): Promise<unknown> | unknown;
};

export type ContentBootstrap = {
  getStatus():
    | ContentProtectionStatus
    | {
        state: "unavailable";
        application: AdapterDescriptor["adapterId"];
        surfaceId: AdapterDescriptor["surfaceId"];
        protectionEnabled: null;
      };
  getSettings(): ProtectionSettings | null;
  dispose(): void;
};

type RegistryFactory = (options: {
  document: Document;
  entryPoint: string;
  adapterOptions: Omit<AdapterLifecycleOptions, "document">;
}) => DocumentAdapterRegistry | null;
type DialogFactory = (
  documentValue: Document,
  options: ProtectionDialogControllerOptions,
) => ProtectionDialogController;
type ControllerFactory = (
  options: SubmissionControllerOptions,
) => SubmissionController;

function unavailableStatus(descriptor: AdapterDescriptor) {
  return {
    state: "unavailable" as const,
    application: descriptor.adapterId,
    surfaceId: descriptor.surfaceId,
    protectionEnabled: null,
  };
}

function initializingStatus(
  descriptor: AdapterDescriptor,
): ContentProtectionStatus {
  return {
    state: "initializing",
    application: descriptor.adapterId,
    surfaceId: descriptor.surfaceId,
    protectionEnabled: null,
  };
}

export function bootstrapContent(options: {
  document: Document;
  runtime: ContentRuntime;
  descriptor: AdapterDescriptor;
  scheduler?: RetryScheduler;
  createRegistry: RegistryFactory;
  createDialog?: DialogFactory;
  createController?: ControllerFactory;
  eventId?: () => string;
  now?: () => Date;
}): ContentBootstrap {
  const { descriptor } = options;
  if (
    descriptor.origins.length !== 1 ||
    options.document.defaultView?.location.origin !== descriptor.origins[0]
  ) {
    return {
      getStatus: () => unavailableStatus(descriptor),
      getSettings: () => null,
      dispose() {},
    };
  }

  const registryFactory = options.createRegistry;
  const dialogFactory =
    options.createDialog ?? createProtectionDialogController;
  const controllerFactory =
    options.createController ?? createSubmissionController;
  const eventId = options.eventId ?? (() => crypto.randomUUID());
  const now = options.now ?? (() => new Date());
  let settings: ProtectionSettings | null = null;
  let surfaceEnabled = false;
  let enforcementSettings: EnforcementSettings | null = null;
  let enforcementRevision: EnforcementRevision = 0;
  let status: ContentProtectionStatus | ReturnType<typeof unavailableStatus> =
    initializingStatus(descriptor);
  let adapterRegistry: DocumentAdapterRegistry | null = null;
  let dialog: ProtectionDialogController | null = null;
  let controller: SubmissionController | null = null;
  let unregister: (() => void) | null = null;
  let adapterDegraded = false;
  let adapterWaiting = false;
  let disposed = false;

  function sendAudit(event: AuditEvent): void {
    if (disposed) return;
    try {
      void Promise.resolve(
        options.runtime.sendMessage({ type: "audit.append", event }),
      ).catch(() => undefined);
    } catch {
      // Auditing cannot alter the local enforcement outcome.
    }
  }

  function publish(next: typeof status): void {
    if (disposed) return;
    status = structuredClone(next);
    if (next.state !== "unavailable") {
      cache.postStatus(next);
    }
  }

  function publishReadyStatus(): void {
    const current = settings;
    if (current === null || unregister === null) return;
    if (!current.protectionEnabled || !surfaceEnabled) {
      publish({
        state: "disabled",
        application: descriptor.adapterId,
        surfaceId: descriptor.surfaceId,
        protectionEnabled: false,
      });
      return;
    }
    publish({
      state: adapterDegraded
        ? "degraded"
        : adapterWaiting
          ? "waiting_for_composer"
          : "active",
      application: descriptor.adapterId,
      surfaceId: descriptor.surfaceId,
      protectionEnabled: true,
    });
  }

  function handleHealth(transition: AdapterHealthTransition): void {
    if (disposed) return;
    if (transition.status === "waiting_for_composer") {
      adapterDegraded = false;
      adapterWaiting = true;
      publishReadyStatus();
      return;
    }
    if (transition.status === "healthy") {
      adapterDegraded = false;
      adapterWaiting = false;
      publishReadyStatus();
      return;
    }
    adapterDegraded = true;
    adapterWaiting = false;
    sendAudit({
      kind: "adapter_health",
      id: createAuditEventId(eventId()),
      timestamp: createAuditTimestamp(now().toISOString()),
      adapterId: descriptor.adapterId,
      surfaceId: descriptor.surfaceId,
      status: "degraded",
      healthCode: transition.healthCode,
      adapterVersion: descriptor.version,
    });
    publishReadyStatus();
  }

  function handleAdapterError(error: { readonly code: string }): void {
    if (disposed || error.code !== "interceptor_failure") return;
    adapterDegraded = true;
    try {
      controller?.cancelActiveAttempt();
    } catch {
      // Continue fail-safe reporting after cancellation cleanup fails.
    }
    sendAudit({
      kind: "enforcement_error",
      id: createAuditEventId(eventId()),
      timestamp: createAuditTimestamp(now().toISOString()),
      adapterId: descriptor.adapterId,
      surfaceId: descriptor.surfaceId,
      errorCode: "extension_context_invalidated",
      adapterVersion: descriptor.version,
    });
    try {
      void Promise.resolve(
        dialog?.show({
          kind: "error",
          errorCode: "extension_context_invalidated",
        }),
      ).catch(() => undefined);
    } catch {
      // The submission stays stopped when content-free guidance cannot render.
    }
    publishReadyStatus();
  }

  function ensureRuntime(): boolean {
    if (registryFactory === undefined) return false;
    if (controller !== null) return true;
    let createdRegistry: DocumentAdapterRegistry | null = null;
    let createdDialog: ProtectionDialogController | null = null;
    let createdController: SubmissionController | null = null;
    try {
      createdRegistry = registryFactory({
        document: options.document,
        entryPoint: descriptor.entryPoint,
        adapterOptions: {
          onHealthTransition: handleHealth,
          onAdapterError: handleAdapterError,
        },
      });
      if (createdRegistry === null) return false;
      createdDialog = dialogFactory(options.document, {
        onRenderFailure: () => createdController?.reportDialogRenderFailure(),
      });
      createdController = controllerFactory({
        adapter: createdRegistry.adapter,
        dialog: createdDialog,
        audit: { append: sendAudit },
        settings: () => {
          if (settings === null) {
            throw new Error("Validated settings are unavailable.");
          }
          return cloneProtectionSettings(settings);
        },
        isProtectionEnabled: () =>
          settings?.protectionEnabled === true && surfaceEnabled,
        currentRevision: () => enforcementRevision,
      });
      adapterRegistry = createdRegistry;
      dialog = createdDialog;
      controller = createdController;
      return true;
    } catch {
      try {
        createdController?.dispose();
      } catch {
        // Partial bootstrap cleanup is best effort.
      }
      try {
        createdDialog?.dispose();
      } catch {
        // Partial bootstrap cleanup is best effort.
      }
      try {
        createdRegistry?.dispose();
      } catch {
        // Partial bootstrap cleanup is best effort.
      }
      return false;
    }
  }

  function unregisterInterception(): void {
    const disposeRegistration = unregister;
    unregister = null;
    try {
      disposeRegistration?.();
    } catch {
      // The page or extension context may already be invalidated.
    }
  }

  function disposeProtectionRuntime(): void {
    unregisterInterception();
    try {
      controller?.cancelActiveAttempt();
    } catch {
      // Continue through every independent cleanup boundary.
    }
    try {
      controller?.dispose();
    } catch {
      // Continue through every independent cleanup boundary.
    }
    try {
      dialog?.dispose();
    } catch {
      // Continue through every independent cleanup boundary.
    }
    try {
      adapterRegistry?.dispose();
    } catch {
      // Continue through every independent cleanup boundary.
    }
    controller = null;
    dialog = null;
    adapterRegistry = null;
    adapterDegraded = false;
    adapterWaiting = false;
  }

  const cache = createSettingsCache({
    connect: () => {
      const port = options.runtime.connect({ name: SETTINGS_PORT_NAME });
      try {
        port.postMessage({
          type: "content.handshake",
          descriptor: structuredClone(descriptor),
        });
      } catch (error) {
        try {
          port.disconnect();
        } catch {
          // The failed handshake port may already be invalidated.
        }
        throw error;
      }
      return port;
    },
    ...(options.scheduler === undefined
      ? {}
      : { scheduler: options.scheduler }),
    onConnectionState(connectionState) {
      if (disposed) return;
      if (connectionState === "initializing") {
        settings = null;
        surfaceEnabled = false;
        publish(initializingStatus(descriptor));
        return;
      }
      if (connectionState === "unavailable") {
        disposeProtectionRuntime();
        settings = null;
        surfaceEnabled = false;
        publish(unavailableStatus(descriptor));
      }
    },
    onSettings(nextSettings) {
      if (disposed) return;
      const next = cloneProtectionSettings(nextSettings);
      const nextSurfaceEnabled = next.surfaces.some(
        (surface) =>
          surface.surfaceId === descriptor.surfaceId && surface.enabled,
      );
      const nextEnforcement = snapshotEnforcementSettings(next);
      const enforcementChanged =
        enforcementSettings === null ||
        !areEnforcementSettingsEqual(enforcementSettings, nextEnforcement) ||
        surfaceEnabled !== nextSurfaceEnabled;
      if (enforcementChanged) {
        enforcementRevision += 1;
        enforcementSettings = nextEnforcement;
        if (next.protectionEnabled && nextSurfaceEnabled) {
          try {
            controller?.cancelActiveAttempt();
          } catch {
            // A revision change must still become visible after best-effort cancellation.
          }
        } else {
          disposeProtectionRuntime();
        }
      }
      settings = next;
      surfaceEnabled = nextSurfaceEnabled;
      if (!settings.protectionEnabled || !surfaceEnabled) {
        publish({
          state: "disabled",
          application: descriptor.adapterId,
          surfaceId: descriptor.surfaceId,
          protectionEnabled: false,
        });
        return;
      }
      const runtimeReady = ensureRuntime();
      if (runtimeReady && unregister === null) {
        try {
          unregister = controller?.register() ?? null;
        } catch {
          adapterDegraded = true;
        }
      }
      if (unregister === null) {
        publish({
          state: "degraded",
          application: descriptor.adapterId,
          surfaceId: descriptor.surfaceId,
          protectionEnabled: true,
        });
        return;
      }
      publishReadyStatus();
    },
  });

  cache.start();

  return {
    getStatus() {
      return structuredClone(status);
    },
    getSettings() {
      return settings === null ? null : cloneProtectionSettings(settings);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      try {
        disposeProtectionRuntime();
      } catch {
        // Continue through every independent cleanup boundary.
      }
      try {
        cache.dispose();
      } catch {
        // Final public state is still made unavailable below.
      } finally {
        settings = null;
        surfaceEnabled = false;
        status = unavailableStatus(descriptor);
      }
    },
  };
}

export function adaptInstalledPort(
  port: chrome.runtime.Port,
): ContentRuntimePort {
  const messageListeners = new Map<
    (message: unknown) => void,
    (message: unknown, port: chrome.runtime.Port) => void
  >();
  const disconnectListeners = new Map<
    () => void,
    (port: chrome.runtime.Port) => void
  >();
  return {
    name: port.name,
    postMessage(message) {
      port.postMessage(message);
    },
    disconnect() {
      port.disconnect();
    },
    onMessage: {
      addListener(listener) {
        const wrapped = (message: unknown): void => listener(message);
        messageListeners.set(listener, wrapped);
        port.onMessage.addListener(wrapped);
      },
      removeListener(listener) {
        const wrapped = messageListeners.get(listener);
        if (wrapped === undefined) return;
        port.onMessage.removeListener(wrapped);
        messageListeners.delete(listener);
      },
    },
    onDisconnect: {
      addListener(listener) {
        const wrapped = (): void => listener();
        disconnectListeners.set(listener, wrapped);
        port.onDisconnect.addListener(wrapped);
      },
      removeListener(listener) {
        const wrapped = disconnectListeners.get(listener);
        if (wrapped === undefined) return;
        port.onDisconnect.removeListener(wrapped);
        disconnectListeners.delete(listener);
      },
    },
  };
}
