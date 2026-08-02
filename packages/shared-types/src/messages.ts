import type { AuditEvent, StoredAuditEnvelope } from "./audit.js";
import type {
  ProtectionSettings,
  SettingsValidationError,
  StoredSettingsEnvelope,
} from "./settings.js";
import type { ProtectionStatusSnapshot } from "./status.js";
import type { ContentProtectionStatus } from "./status.js";
import type { AdapterDescriptor } from "./surfaces.js";
import type { PromptFreeArray, PromptFreeBoundary } from "./privacy.js";

export const SETTINGS_PORT_NAME = "settings-v2";

export type RuntimeRequest = PromptFreeBoundary &
  (
    | { type: "settings.read" }
    | { type: "settings.save"; settings: ProtectionSettings }
    | { type: "audit.read" }
    | { type: "audit.append"; event: AuditEvent }
    | { type: "audit.clear" }
    | { type: "permissions.claude.remove" }
    | { type: "status.read" }
  );

export const RUNTIME_ERROR_CODES = Object.freeze([
  "invalid_message",
  "invalid_sender",
  "validation_failure",
  "storage_failure",
  "unavailable",
] as const);

export type RuntimeErrorCode = (typeof RUNTIME_ERROR_CODES)[number];

export type RuntimeErrorResponse = PromptFreeBoundary &
  (
    | {
        type: "error";
        errorCode: Exclude<RuntimeErrorCode, "validation_failure">;
      }
    | {
        type: "error";
        errorCode: "validation_failure";
        fieldErrors: PromptFreeArray<SettingsValidationError>;
      }
  );

export type RuntimeResponse = PromptFreeBoundary &
  (
    | { type: "settings.result"; envelope: StoredSettingsEnvelope }
    | { type: "settings.saved"; envelope: StoredSettingsEnvelope }
    | { type: "audit.result"; envelope: StoredAuditEnvelope }
    | { type: "audit.appended" }
    | { type: "audit.cleared" }
    | { type: "permissions.claude.removed"; removed: boolean }
    | { type: "status.result"; status: ProtectionStatusSnapshot }
    | RuntimeErrorResponse
  );

export type SettingsPortMessage = PromptFreeBoundary & {
  type: "settings.snapshot";
  generation: number;
  envelope: StoredSettingsEnvelope;
};

export type ContentHandshakePortMessage = PromptFreeBoundary & {
  type: "content.handshake";
  descriptor: AdapterDescriptor;
};

export type ContentStatusPortMessage = PromptFreeBoundary & {
  type: "status.snapshot";
  generation: number;
  status: ContentProtectionStatus;
};
