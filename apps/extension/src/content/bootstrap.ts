import {
  CHATGPT_ADAPTER_VERSION,
  SETTINGS_PORT_NAME,
  cloneProtectionSettings,
  createAuditEventId,
  createAuditTimestamp,
  type AuditEvent,
  type ContentProtectionStatus,
  type ProtectionSettings,
  type RuntimeResponse,
} from "@ai-dlp/shared-types";

import type { ChatApplicationAdapter } from "../adapters/chat-application-adapter.js";
import {
  ChatGptAdapter,
  type ChatGptAdapterOptions,
} from "../adapters/chatgpt/chatgpt-adapter.js";
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

export type ContentRuntimePort = ContentSettingsPort;

export type ContentRuntime = {
  connect(options: { name: typeof SETTINGS_PORT_NAME }): ContentRuntimePort;
  sendMessage(message: unknown): Promise<unknown> | unknown;
};

export type ContentBootstrap = {
  getStatus():
    | ContentProtectionStatus
    | { state: "unavailable"; application: "chatgpt"; protectionEnabled: null };
  getSettings(): ProtectionSettings | null;
  dispose(): void;
};

type AdapterFactory = (
  options: ChatGptAdapterOptions,
) => ChatApplicationAdapter;
type DialogFactory = (
  documentValue: Document,
  options: ProtectionDialogControllerOptions,
) => ProtectionDialogController;
type ControllerFactory = (
  options: SubmissionControllerOptions,
) => SubmissionController;

function unavailableStatus() {
  return {
    state: "unavailable" as const,
    application: "chatgpt" as const,
    protectionEnabled: null,
  };
}

function initializingStatus(): ContentProtectionStatus {
  return {
    state: "initializing",
    application: "chatgpt",
    protectionEnabled: null,
  };
}

export function bootstrapContent(options: {
  document: Document;
  runtime: ContentRuntime;
  scheduler?: RetryScheduler;
  createAdapter?: AdapterFactory;
  createDialog?: DialogFactory;
  createController?: ControllerFactory;
  eventId?: () => string;
  now?: () => Date;
}): ContentBootstrap {
  const adapterFactory =
    options.createAdapter ??
    ((adapterOptions) => new ChatGptAdapter(adapterOptions));
  const dialogFactory =
    options.createDialog ?? createProtectionDialogController;
  const controllerFactory =
    options.createController ?? createSubmissionController;
  const eventId = options.eventId ?? (() => crypto.randomUUID());
  const now = options.now ?? (() => new Date());
  let settings: ProtectionSettings | null = null;
  let status: ContentProtectionStatus | ReturnType<typeof unavailableStatus> =
    initializingStatus();
  let adapter: ChatApplicationAdapter | null = null;
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
    if (!current.protectionEnabled) {
      publish({
        state: "disabled",
        application: "chatgpt",
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
      application: "chatgpt",
      protectionEnabled: true,
    });
  }

  function handleHealth(
    transition: Parameters<
      NonNullable<ChatGptAdapterOptions["onHealthTransition"]>
    >[0],
  ): void {
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
      application: "chatgpt",
      status: "degraded",
      healthCode: transition.healthCode,
      adapterVersion: CHATGPT_ADAPTER_VERSION,
    });
    publishReadyStatus();
  }

  function handleAdapterError(
    error: Parameters<NonNullable<ChatGptAdapterOptions["onAdapterError"]>>[0],
  ): void {
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
      application: "chatgpt",
      errorCode: "extension_context_invalidated",
      adapterVersion: CHATGPT_ADAPTER_VERSION,
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
    if (controller !== null) return true;
    let createdAdapter: ChatApplicationAdapter | null = null;
    let createdDialog: ProtectionDialogController | null = null;
    let createdController: SubmissionController | null = null;
    try {
      createdAdapter = adapterFactory({
        document: options.document,
        onHealthTransition: handleHealth,
        onAdapterError: handleAdapterError,
      });
      createdDialog = dialogFactory(options.document, {
        onRenderFailure: () => createdController?.reportDialogRenderFailure(),
      });
      createdController = controllerFactory({
        adapter: createdAdapter,
        dialog: createdDialog,
        audit: { append: sendAudit },
        settings: () => {
          if (settings === null) {
            throw new Error("Validated settings are unavailable.");
          }
          return cloneProtectionSettings(settings);
        },
        isProtectionEnabled: () => settings?.protectionEnabled === true,
      });
      adapter = createdAdapter;
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
        createdAdapter?.dispose();
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
      adapter?.dispose();
    } catch {
      // Continue through every independent cleanup boundary.
    }
    controller = null;
    dialog = null;
    adapter = null;
    adapterDegraded = false;
    adapterWaiting = false;
  }

  const cache = createSettingsCache({
    connect: () => options.runtime.connect({ name: SETTINGS_PORT_NAME }),
    ...(options.scheduler === undefined
      ? {}
      : { scheduler: options.scheduler }),
    onConnectionState(connectionState) {
      if (disposed) return;
      if (connectionState === "initializing") {
        settings = null;
        publish(initializingStatus());
        return;
      }
      if (connectionState === "unavailable") {
        disposeProtectionRuntime();
        settings = null;
        publish(unavailableStatus());
      }
    },
    onSettings(nextSettings) {
      if (disposed) return;
      settings = cloneProtectionSettings(nextSettings);
      if (!settings.protectionEnabled) {
        disposeProtectionRuntime();
        publish({
          state: "disabled",
          application: "chatgpt",
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
          application: "chatgpt",
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
        status = unavailableStatus();
      }
    },
  };
}

function adaptInstalledPort(port: chrome.runtime.Port): ContentRuntimePort {
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

const installedChrome = typeof chrome === "undefined" ? undefined : chrome;

export const installedContent: ContentBootstrap | undefined =
  installedChrome === undefined || typeof document === "undefined"
    ? undefined
    : bootstrapContent({
        document,
        runtime: {
          connect: ({ name }) =>
            adaptInstalledPort(installedChrome.runtime.connect({ name })),
          sendMessage: (message) =>
            installedChrome.runtime.sendMessage<unknown, RuntimeResponse>(
              message,
            ),
        },
      });
