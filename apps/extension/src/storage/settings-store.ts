import {
  CONFIGURABLE_PROTECTION_ACTIONS,
  POLICY_ACTIONS,
  areUnicodeCaseInsensitiveEquivalent,
  createDefaultProtectionSettings,
  isProtectionSettings,
  isStoredSettingsEnvelope,
  MAX_PROTECTED_KEYWORD_COUNT,
  normalizeProtectedKeyword,
  type ProtectionSettings,
  type PolicyAction,
  type SettingsValidationError,
  type StoredSettingsEnvelope,
} from "@ai-dlp/shared-types";

import type { StoragePort } from "./storage-port.js";

export const SETTINGS_STORAGE_KEY = "settings";

const SETTING_KEYS = Object.freeze([
  "protectionEnabled",
  "emailAction",
  "phoneAction",
  "protectedKeywords",
  "auditRetentionLimit",
] as const);

export type SettingsSaveResult =
  | { ok: true; envelope: StoredSettingsEnvelope }
  | { ok: false; fieldErrors: SettingsValidationError[] };

export interface SettingsStore {
  read(): Promise<StoredSettingsEnvelope>;
  save(settings: unknown): Promise<SettingsSaveResult>;
}

function defaultEnvelope(): StoredSettingsEnvelope {
  return { schemaVersion: 1, settings: createDefaultProtectionSettings() };
}

function cloneEnvelope(
  envelope: StoredSettingsEnvelope,
): StoredSettingsEnvelope {
  const clone: unknown = structuredClone(envelope);
  if (!isStoredSettingsEnvelope(clone)) {
    return defaultEnvelope();
  }
  return clone;
}

function migrateLegacyRedactEnvelope(
  value: unknown,
): StoredSettingsEnvelope | null {
  if (
    !hasPlainDataFields(value) ||
    Reflect.ownKeys(value).length !== 2 ||
    !Object.hasOwn(value, "schemaVersion") ||
    !Object.hasOwn(value, "settings") ||
    value.schemaVersion !== 1 ||
    !hasPlainDataFields(value.settings)
  ) {
    return null;
  }
  const settings = value.settings;
  const emailAction = settings.emailAction;
  const phoneAction = settings.phoneAction;
  if (
    typeof emailAction !== "string" ||
    !POLICY_ACTIONS.includes(emailAction as PolicyAction) ||
    typeof phoneAction !== "string" ||
    !POLICY_ACTIONS.includes(phoneAction as PolicyAction) ||
    (emailAction !== "redact" && phoneAction !== "redact")
  ) {
    return null;
  }
  const migrated = validateAndNormalizeSettings({
    ...settings,
    emailAction: emailAction === "redact" ? "warn" : emailAction,
    phoneAction: phoneAction === "redact" ? "warn" : phoneAction,
  });
  return migrated.ok ? { schemaVersion: 1, settings: migrated.settings } : null;
}

function hasPlainDataFields(value: unknown): value is Record<string, unknown> {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    (Object.getPrototypeOf(value) !== Object.prototype &&
      Object.getPrototypeOf(value) !== null)
  ) {
    return false;
  }

  return Reflect.ownKeys(value).every((key) => {
    if (typeof key !== "string") {
      return false;
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return (
      descriptor !== undefined &&
      descriptor.enumerable === true &&
      Object.hasOwn(descriptor, "value")
    );
  });
}

function normalizeKeywords(value: unknown): {
  keywords?: string[];
  error?: SettingsValidationError;
} {
  if (!Array.isArray(value)) {
    return {
      error: { field: "protectedKeywords", code: "invalid_type" },
    };
  }
  if (value.length > MAX_PROTECTED_KEYWORD_COUNT) {
    return {
      error: { field: "protectedKeywords", code: "too_many_keywords" },
    };
  }

  const keywords: string[] = [];
  for (const item of value) {
    const normalized = normalizeProtectedKeyword(item);
    if (normalized === undefined) {
      return {
        error: { field: "protectedKeywords", code: "invalid_keyword" },
      };
    }
    if (
      keywords.some((existing) =>
        areUnicodeCaseInsensitiveEquivalent(existing, normalized),
      )
    ) {
      return {
        error: { field: "protectedKeywords", code: "duplicate_keyword" },
      };
    }
    keywords.push(normalized);
  }
  return { keywords };
}

export function validateAndNormalizeSettings(
  value: unknown,
):
  | { ok: true; settings: ProtectionSettings }
  | { ok: false; fieldErrors: SettingsValidationError[] } {
  if (!hasPlainDataFields(value)) {
    return {
      ok: false,
      fieldErrors: [{ field: "settings", code: "invalid_type" }],
    };
  }

  const keys = Reflect.ownKeys(value);
  if (
    keys.some(
      (key) => typeof key !== "string" || !SETTING_KEYS.includes(key as never),
    )
  ) {
    return {
      ok: false,
      fieldErrors: [{ field: "settings", code: "unknown_field" }],
    };
  }

  const errors: SettingsValidationError[] = [];
  for (const field of SETTING_KEYS) {
    if (!Object.hasOwn(value, field)) {
      errors.push({ field, code: "required" } as SettingsValidationError);
    }
  }
  if (errors.length > 0) {
    return { ok: false, fieldErrors: errors };
  }

  if (typeof value.protectionEnabled !== "boolean") {
    errors.push({ field: "protectionEnabled", code: "invalid_type" });
  }
  if (
    typeof value.emailAction !== "string" ||
    !CONFIGURABLE_PROTECTION_ACTIONS.includes(value.emailAction as never)
  ) {
    errors.push({ field: "emailAction", code: "invalid_action" });
  }
  if (
    typeof value.phoneAction !== "string" ||
    !CONFIGURABLE_PROTECTION_ACTIONS.includes(value.phoneAction as never)
  ) {
    errors.push({ field: "phoneAction", code: "invalid_action" });
  }
  const normalizedKeywords = normalizeKeywords(value.protectedKeywords);
  if (normalizedKeywords.error !== undefined) {
    errors.push(normalizedKeywords.error);
  }
  if (!Number.isSafeInteger(value.auditRetentionLimit)) {
    errors.push({ field: "auditRetentionLimit", code: "invalid_type" });
  } else if (
    Number(value.auditRetentionLimit) < 1 ||
    Number(value.auditRetentionLimit) > 1_000
  ) {
    errors.push({ field: "auditRetentionLimit", code: "out_of_range" });
  }
  if (errors.length > 0 || normalizedKeywords.keywords === undefined) {
    return { ok: false, fieldErrors: errors };
  }

  const settings: ProtectionSettings = {
    protectionEnabled: value.protectionEnabled as boolean,
    emailAction: value.emailAction as ProtectionSettings["emailAction"],
    phoneAction: value.phoneAction as ProtectionSettings["phoneAction"],
    protectedKeywords: normalizedKeywords.keywords,
    auditRetentionLimit: value.auditRetentionLimit as number,
  };
  if (!isProtectionSettings(settings)) {
    return {
      ok: false,
      fieldErrors: [{ field: "settings", code: "invalid_type" }],
    };
  }
  return { ok: true, settings };
}

export function createSettingsStore(
  storage: StoragePort,
  storageReady: Promise<void> = Promise.resolve(),
): SettingsStore {
  let pendingOperation: Promise<void> = Promise.resolve();

  function serialize<Result>(
    operation: () => Promise<Result>,
  ): Promise<Result> {
    const result = pendingOperation.then(operation, operation);
    pendingOperation = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  return {
    read() {
      return serialize(async () => {
        await storageReady;
        const stored = await storage.read(SETTINGS_STORAGE_KEY);
        if (isStoredSettingsEnvelope(stored)) {
          return cloneEnvelope(stored);
        }
        const migrated = migrateLegacyRedactEnvelope(stored);
        if (migrated === null) {
          return defaultEnvelope();
        }
        await storage.write(SETTINGS_STORAGE_KEY, cloneEnvelope(migrated));
        return cloneEnvelope(migrated);
      });
    },
    save(candidate) {
      return serialize(async () => {
        await storageReady;
        const result = validateAndNormalizeSettings(candidate);
        if (!result.ok) {
          return result;
        }
        const envelope: StoredSettingsEnvelope = {
          schemaVersion: 1,
          settings: result.settings,
        };
        await storage.write(SETTINGS_STORAGE_KEY, cloneEnvelope(envelope));
        return { ok: true, envelope: cloneEnvelope(envelope) };
      });
    },
  };
}
