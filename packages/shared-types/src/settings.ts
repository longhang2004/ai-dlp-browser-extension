import { POLICY_ACTIONS } from "./policy.js";
import type { PolicyAction } from "./policy.js";
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

export type ConfigurableAction = PolicyAction;

export type ProtectionSettings = PromptFreeBoundary & {
  protectionEnabled: boolean;
  emailAction: ConfigurableAction;
  phoneAction: ConfigurableAction;
  protectedKeywords: PromptFreeArray<string>;
  auditRetentionLimit: number;
};

export type StoredSettingsEnvelope = PromptFreeBoundary & {
  schemaVersion: 1;
  settings: ProtectionSettings;
};

export type ReadonlyProtectionSettings = PromptFreeBoundary & {
  readonly protectionEnabled: boolean;
  readonly emailAction: ConfigurableAction;
  readonly phoneAction: ConfigurableAction;
  readonly protectedKeywords: ReadonlyPromptFreeArray<string>;
  readonly auditRetentionLimit: number;
};

export const SETTINGS_VALIDATION_FIELDS = Object.freeze([
  "settings",
  "protectionEnabled",
  "emailAction",
  "phoneAction",
  "protectedKeywords",
  "auditRetentionLimit",
] as const);

export type SettingsValidationField =
  (typeof SETTINGS_VALIDATION_FIELDS)[number];

export const SETTINGS_VALIDATION_ERROR_CODES = Object.freeze([
  "required",
  "unknown_field",
  "invalid_type",
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
        field: "emailAction" | "phoneAction";
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
    emailAction: "warn",
    phoneAction: "warn",
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

export function isProtectionSettingsSnapshot(
  value: unknown,
): value is ProtectionSettings {
  return safelyValidate(() => {
    if (
      !isPlainRecord(value) ||
      !hasExactOwnKeys(value, [
        "protectionEnabled",
        "emailAction",
        "phoneAction",
        "protectedKeywords",
        "auditRetentionLimit",
      ]) ||
      typeof value.protectionEnabled !== "boolean" ||
      typeof value.emailAction !== "string" ||
      !POLICY_ACTIONS.includes(value.emailAction as PolicyAction) ||
      typeof value.phoneAction !== "string" ||
      !POLICY_ACTIONS.includes(value.phoneAction as PolicyAction) ||
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
    emailAction: snapshot.emailAction,
    phoneAction: snapshot.phoneAction,
    protectedKeywords: [...snapshot.protectedKeywords],
    auditRetentionLimit: snapshot.auditRetentionLimit,
  };
}

export function createDefaultProtectionSettings(): ProtectionSettings {
  return cloneProtectionSettings(DEFAULT_PROTECTION_SETTINGS);
}
