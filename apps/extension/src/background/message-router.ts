import type {
  ProtectionStatusSnapshot,
  RuntimeResponse,
} from "@ai-dlp/shared-types";

import {
  createRuntimeResponse,
  parseRuntimeRequest,
} from "../messaging/schemas.js";
import type { AuditStore } from "../storage/audit-store.js";
import type { SettingsStore } from "../storage/settings-store.js";
import {
  resolveRuntimeSenderAuthorization,
  type RuntimeSender,
} from "./sender-validation.js";

export type RuntimeMessageListener = (
  message: unknown,
  sender: RuntimeSender,
  sendResponse: (response: RuntimeResponse) => void,
) => true;

export function createMessageListener(options: {
  runtimeId: string;
  storageReady: Promise<void>;
  settingsStore: SettingsStore;
  auditStore: AuditStore;
  broadcastSettings(
    envelope: Awaited<ReturnType<SettingsStore["read"]>>,
  ): void | Promise<void>;
  // Phase 11 must inject this only after a validated content-script status ack.
  // Without it, status.read remains conservatively `initializing`.
  readStatus?: () => Promise<ProtectionStatusSnapshot>;
}): RuntimeMessageListener {
  let pendingSettingsSave: Promise<void> = Promise.resolve();

  function serializeSettingsSave<Result>(
    operation: () => Promise<Result>,
  ): Promise<Result> {
    const result = pendingSettingsSave.then(operation, operation);
    pendingSettingsSave = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  return (message, sender, sendResponse): true => {
    const respond = (response: RuntimeResponse): void => {
      try {
        sendResponse(createRuntimeResponse(response));
      } catch {
        // The requesting context disappeared; there is no safe recipient left.
      }
    };
    const request = parseRuntimeRequest(message);
    if (request === undefined) {
      respond({ type: "error", errorCode: "invalid_message" });
      return true;
    }
    const senderAuthorization = resolveRuntimeSenderAuthorization(
      request,
      sender,
      options.runtimeId,
    );
    if (
      senderAuthorization === null ||
      (request.type === "audit.append" &&
        (senderAuthorization.source !== "content_script" ||
          request.event.application !==
            senderAuthorization.descriptor.adapterId ||
          request.event.adapterVersion !==
            senderAuthorization.descriptor.version))
    ) {
      respond({ type: "error", errorCode: "invalid_sender" });
      return true;
    }

    void options.storageReady
      .then(async (): Promise<RuntimeResponse> => {
        switch (request.type) {
          case "settings.read":
            return {
              type: "settings.result",
              envelope: await options.settingsStore.read(),
            };
          case "settings.save": {
            return serializeSettingsSave(async () => {
              const result = await options.settingsStore.save(request.settings);
              if (!result.ok) {
                return {
                  type: "error",
                  errorCode: "validation_failure",
                  fieldErrors: result.fieldErrors,
                };
              }
              try {
                await options.auditStore.enforceRetention();
              } catch {
                // Settings are already authoritative. A later audit operation
                // retries pruning from the durable retention value.
              }
              try {
                await options.broadcastSettings(result.envelope);
              } catch {
                // Connected-port delivery is ancillary after persistence.
              }
              return { type: "settings.saved", envelope: result.envelope };
            });
          }
          case "audit.read":
            return {
              type: "audit.result",
              envelope: await options.auditStore.read(),
            };
          case "audit.append":
            await options.auditStore.append(request.event);
            return { type: "audit.appended" };
          case "audit.clear":
            await options.auditStore.clear();
            return { type: "audit.cleared" };
          case "status.read": {
            if (options.readStatus !== undefined) {
              return {
                type: "status.result",
                status: await options.readStatus(),
              };
            }
            const audit = await options.auditStore.read();
            const status: ProtectionStatusSnapshot = {
              state: "initializing",
              application: "chatgpt",
              protectionEnabled: null,
              recentEventCount: audit.events.length,
            };
            return { type: "status.result", status };
          }
        }
      })
      .then(
        (response) => respond(response),
        () => respond({ type: "error", errorCode: "storage_failure" }),
      );

    return true;
  };
}
