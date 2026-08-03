import type {
  PromptFreeArray,
  PromptFreeBoundary,
  ReadonlyPromptFreeArray,
} from "./privacy.js";
import {
  isNormalizedProtectedKeyword,
  MAX_PROTECTED_KEYWORD_COUNT,
} from "./protected-keywords.js";
import { areUnicodeCaseInsensitiveEquivalent } from "./unicode-equivalence.js";
import {
  hasExactOwnKeys,
  INVALID_SNAPSHOT,
  isDenseExactArray,
  isPlainRecord,
  safelyValidate,
  snapshotStructuredValue,
} from "./validation-helpers.js";
import {
  CONFIGURABLE_SURFACE_IDS,
  type ConfigurableSurfaceId,
} from "./surfaces.js";

export const CONFIGURABLE_PROTECTION_ACTIONS = Object.freeze([
  "allow",
  "warn",
  "block",
] as const);

export type ConfigurableProtectionAction =
  (typeof CONFIGURABLE_PROTECTION_ACTIONS)[number];

export type SurfaceSettings = PromptFreeBoundary & {
  readonly surfaceId: ConfigurableSurfaceId;
  readonly enabled: boolean;
};

export type ProtectionSettings = PromptFreeBoundary & {
  protectionEnabled: boolean;
  surfaces: PromptFreeArray<SurfaceSettings>;
  emailAction: ConfigurableProtectionAction;
  phoneAction: ConfigurableProtectionAction;
  attachmentAction: ConfigurableProtectionAction;
  protectedKeywords: PromptFreeArray<string>;
  auditRetentionLimit: number;
};

export type StoredSettingsEnvelope = PromptFreeBoundary & {
  schemaVersion: 3;
  settings: ProtectionSettings;
};

export type ReadonlyProtectionSettings = PromptFreeBoundary & {
  readonly protectionEnabled: boolean;
  readonly surfaces: ReadonlyPromptFreeArray<SurfaceSettings>;
  readonly emailAction: ConfigurableProtectionAction;
  readonly phoneAction: ConfigurableProtectionAction;
  readonly attachmentAction: ConfigurableProtectionAction;
  readonly protectedKeywords: ReadonlyPromptFreeArray<string>;
  readonly auditRetentionLimit: number;
};

export const SETTINGS_VALIDATION_FIELDS = Object.freeze([
  "settings",
  "protectionEnabled",
  "surfaces",
  "emailAction",
  "phoneAction",
  "attachmentAction",
  "protectedKeywords",
  "auditRetentionLimit",
] as const);

export type SettingsValidationField =
  (typeof SETTINGS_VALIDATION_FIELDS)[number];

export const SETTINGS_VALIDATION_ERROR_CODES = Object.freeze([
  "required",
  "unknown_field",
  "invalid_type",
  "invalid_surface",
  "duplicate_surface",
  "surface_disabled",
  "invalid_action",
  "invalid_keyword",
  "too_many_keywords",
  "duplicate_keyword",
  "out_of_range",
] as const);

export type SettingsValidationErrorCode =
  (typeof SETTINGS_VALIDATION_ERROR_CODES)[number];

export type SettingsValidationError = PromptFreeBoundary &
  (
    | {
        field: "settings";
        code: "required" | "unknown_field" | "invalid_type";
      }
    | {
        field: "protectionEnabled";
        code: "required" | "invalid_type";
      }
    | {
        field: "surfaces";
        code:
          | "required"
          | "invalid_type"
          | "invalid_surface"
          | "duplicate_surface"
          | "surface_disabled";
      }
    | {
        field: "emailAction" | "phoneAction" | "attachmentAction";
        code: "required" | "invalid_action";
      }
    | {
        field: "protectedKeywords";
        code:
          | "required"
          | "invalid_type"
          | "invalid_keyword"
          | "too_many_keywords"
          | "duplicate_keyword";
      }
    | {
        field: "auditRetentionLimit";
        code: "required" | "invalid_type" | "out_of_range";
      }
  );

export const DEFAULT_PROTECTION_SETTINGS: ReadonlyProtectionSettings =
  Object.freeze({
    protectionEnabled: true,
    surfaces: Object.freeze([
      Object.freeze({ surfaceId: "chatgpt_web", enabled: true }),
      Object.freeze({ surfaceId: "claude_web", enabled: false }),
    ]),
    emailAction: "warn",
    phoneAction: "warn",
    attachmentAction: "warn",
    protectedKeywords: Object.freeze([]),
    auditRetentionLimit: 100,
  });

function hasUniqueProtectedKeywords(keywords: readonly string[]): boolean {
  for (let rightIndex = 1; rightIndex < keywords.length; rightIndex += 1) {
    const right = keywords[rightIndex];
    if (right === undefined) {
      return false;
    }

    for (let leftIndex = 0; leftIndex < rightIndex; leftIndex += 1) {
      const left = keywords[leftIndex];
      if (
        left === undefined ||
        areUnicodeCaseInsensitiveEquivalent(left, right)
      ) {
        return false;
      }
    }
  }

  return true;
}

function isSurfaceSettingSnapshot(value: unknown): value is SurfaceSettings {
  if (
    !isPlainRecord(value) ||
    !hasExactOwnKeys(value, ["surfaceId", "enabled"]) ||
    typeof value.surfaceId !== "string" ||
    !CONFIGURABLE_SURFACE_IDS.includes(
      value.surfaceId as ConfigurableSurfaceId,
    ) ||
    typeof value.enabled !== "boolean"
  ) {
    return false;
  }
  return value.surfaceId !== "claude_web" || value.enabled === false;
}

export function isSurfaceSettingsSnapshot(
  value: unknown,
): value is SurfaceSettings[] {
  if (
    !isDenseExactArray(
      value,
      CONFIGURABLE_SURFACE_IDS.length,
      CONFIGURABLE_SURFACE_IDS.length,
      isSurfaceSettingSnapshot,
    )
  ) {
    return false;
  }
  return value.every(
    (surface, index) =>
      surface.surfaceId === CONFIGURABLE_SURFACE_IDS[index] &&
      (surface.surfaceId !== "claude_web" || surface.enabled === false),
  );
}

export function isProtectionSettingsSnapshot(
  value: unknown,
): value is ProtectionSettings {
  return safelyValidate(() => {
    if (
      !isPlainRecord(value) ||
      !hasExactOwnKeys(value, [
        "protectionEnabled",
        "surfaces",
        "emailAction",
        "phoneAction",
        "attachmentAction",
        "protectedKeywords",
        "auditRetentionLimit",
      ]) ||
      typeof value.protectionEnabled !== "boolean" ||
      !isSurfaceSettingsSnapshot(value.surfaces) ||
      typeof value.emailAction !== "string" ||
      !CONFIGURABLE_PROTECTION_ACTIONS.includes(
        value.emailAction as ConfigurableProtectionAction,
      ) ||
      typeof value.phoneAction !== "string" ||
      !CONFIGURABLE_PROTECTION_ACTIONS.includes(
        value.phoneAction as ConfigurableProtectionAction,
      ) ||
      typeof value.attachmentAction !== "string" ||
      !CONFIGURABLE_PROTECTION_ACTIONS.includes(
        value.attachmentAction as ConfigurableProtectionAction,
      ) ||
      !isDenseExactArray(
        value.protectedKeywords,
        0,
        MAX_PROTECTED_KEYWORD_COUNT,
        isNormalizedProtectedKeyword,
      ) ||
      !Number.isSafeInteger(value.auditRetentionLimit) ||
      Number(value.auditRetentionLimit) < 1 ||
      Number(value.auditRetentionLimit) > 1_000
    ) {
      return false;
    }

    return hasUniqueProtectedKeywords(value.protectedKeywords);
  });
}

export function cloneProtectionSettings(
  settings: ReadonlyProtectionSettings,
): ProtectionSettings {
  const snapshot = snapshotStructuredValue(settings);
  if (
    snapshot === INVALID_SNAPSHOT ||
    !isProtectionSettingsSnapshot(snapshot)
  ) {
    throw new Error("Invalid protection settings.");
  }

  return {
    protectionEnabled: snapshot.protectionEnabled,
    surfaces: snapshot.surfaces.map((surface) => ({
      surfaceId: surface.surfaceId,
      enabled: surface.enabled,
    })),
    emailAction: snapshot.emailAction,
    phoneAction: snapshot.phoneAction,
    attachmentAction: snapshot.attachmentAction,
    protectedKeywords: [...snapshot.protectedKeywords],
    auditRetentionLimit: snapshot.auditRetentionLimit,
  };
}

export function createDefaultSurfaceSettings(): SurfaceSettings[] {
  return DEFAULT_PROTECTION_SETTINGS.surfaces.map((surface) => ({
    surfaceId: surface.surfaceId,
    enabled: surface.enabled,
  }));
}

export function createDefaultProtectionSettings(): ProtectionSettings {
  return cloneProtectionSettings(DEFAULT_PROTECTION_SETTINGS);
}
