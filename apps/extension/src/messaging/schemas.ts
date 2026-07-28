import {
  isRuntimeRequest,
  isRuntimeResponse,
  isSettingsPortMessage,
  type RuntimeRequest,
  type RuntimeResponse,
  type SettingsPortMessage,
  type StoredSettingsEnvelope,
} from "@ai-dlp/shared-types";

const SETTINGS_CANDIDATE_KEYS = new Set([
  "protectionEnabled",
  "emailAction",
  "phoneAction",
  "attachmentAction",
  "protectedKeywords",
  "auditRetentionLimit",
]);

export type ParsedRuntimeRequest =
  RuntimeRequest | { type: "settings.save"; settings: unknown };

function hasExactEnumerableDataKeys(
  value: unknown,
  allowedKeys: ReadonlySet<string>,
  requiredKeys: ReadonlySet<string> = new Set(),
): value is Record<string, unknown> {
  try {
    if (
      typeof value !== "object" ||
      value === null ||
      Array.isArray(value) ||
      (Object.getPrototypeOf(value) !== Object.prototype &&
        Object.getPrototypeOf(value) !== null)
    ) {
      return false;
    }
    const keys = Reflect.ownKeys(value);
    if (
      keys.some((key) => typeof key !== "string" || !allowedKeys.has(key)) ||
      [...requiredKeys].some((key) => !Object.hasOwn(value, key))
    ) {
      return false;
    }
    return keys.every((key) => {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      return (
        descriptor !== undefined &&
        descriptor.enumerable === true &&
        Object.hasOwn(descriptor, "value")
      );
    });
  } catch {
    return false;
  }
}

function isBoundedStringArray(value: unknown): boolean {
  try {
    if (
      !Array.isArray(value) ||
      Object.getPrototypeOf(value) !== Array.prototype ||
      value.length > 101
    ) {
      return false;
    }
    const keys = Reflect.ownKeys(value);
    if (keys.length !== value.length + 1 || !keys.includes("length")) {
      return false;
    }
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (
        descriptor === undefined ||
        !Object.hasOwn(descriptor, "value") ||
        typeof descriptor.value !== "string" ||
        descriptor.value.length > 101
      ) {
        return false;
      }
    }
    return keys.every(
      (key) =>
        key === "length" ||
        (typeof key === "string" &&
          /^(?:0|[1-9]\d*)$/u.test(key) &&
          Number(key) < value.length),
    );
  } catch {
    return false;
  }
}

function isBoundedCandidateValue(value: unknown): boolean {
  return (
    value === null ||
    value === undefined ||
    typeof value === "boolean" ||
    (typeof value === "string" && value.length <= 101) ||
    (typeof value === "number" &&
      Number.isFinite(value) &&
      Math.abs(value) <= 1_000_000) ||
    isBoundedStringArray(value)
  );
}

function isSettingsCandidateRecord(value: unknown): boolean {
  if (!hasExactEnumerableDataKeys(value, SETTINGS_CANDIDATE_KEYS)) {
    return false;
  }
  try {
    return Reflect.ownKeys(value).every((key) => {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      return (
        descriptor !== undefined &&
        Object.hasOwn(descriptor, "value") &&
        isBoundedCandidateValue(descriptor.value)
      );
    });
  } catch {
    return false;
  }
}

function snapshotSettingsSaveCandidate(
  value: unknown,
): { type: "settings.save"; settings: unknown } | undefined {
  const topKeys = new Set(["type", "settings"]);
  if (!hasExactEnumerableDataKeys(value, topKeys, topKeys)) {
    return undefined;
  }
  let settingsDescriptor: PropertyDescriptor | undefined;
  try {
    settingsDescriptor = Object.getOwnPropertyDescriptor(value, "settings");
  } catch {
    return undefined;
  }
  if (
    settingsDescriptor === undefined ||
    !Object.hasOwn(settingsDescriptor, "value") ||
    !isSettingsCandidateRecord(settingsDescriptor.value)
  ) {
    return undefined;
  }

  let snapshot: unknown;
  try {
    snapshot = structuredClone(value);
  } catch {
    return undefined;
  }
  if (
    !hasExactEnumerableDataKeys(snapshot, topKeys, topKeys) ||
    snapshot.type !== "settings.save" ||
    !isSettingsCandidateRecord(snapshot.settings)
  ) {
    return undefined;
  }
  return { type: "settings.save", settings: snapshot.settings };
}

export function parseRuntimeRequest(
  value: unknown,
): ParsedRuntimeRequest | undefined {
  if (isRuntimeRequest(value)) {
    return structuredClone(value);
  }
  return snapshotSettingsSaveCandidate(value);
}

export function createRuntimeResponse(value: RuntimeResponse): RuntimeResponse {
  if (!isRuntimeResponse(value)) {
    throw new Error("Invalid runtime response.");
  }
  return structuredClone(value);
}

export function createSettingsSnapshotMessage(
  envelope: StoredSettingsEnvelope,
  generation: number,
): SettingsPortMessage {
  const message: SettingsPortMessage = {
    type: "settings.snapshot",
    generation,
    envelope: structuredClone(envelope),
  };
  if (!isSettingsPortMessage(message)) {
    throw new Error("Invalid settings snapshot message.");
  }
  return structuredClone(message);
}
