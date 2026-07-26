import type { SensitiveDataFinding } from "@ai-dlp/shared-types";

import { detectApiSecrets } from "./detectors/api-secret.js";
import { detectAwsAccessKeys } from "./detectors/aws-access-key.js";
import { detectEmails } from "./detectors/email.js";
import { detectPaymentCards } from "./detectors/payment-card.js";
import { detectPhones } from "./detectors/phone.js";
import { detectPrivateKeys } from "./detectors/private-key.js";
import {
  detectProtectedKeywords,
  validateProtectedKeywordConfiguration,
} from "./detectors/protected-keyword.js";
import { compareDetectorPriority } from "./priority.js";

export const MAX_PROMPT_CODE_UNITS = 100_000;

export type AnalyzePromptOptions = Readonly<{
  protectedKeywords: readonly string[];
}>;

const ANALYSIS_OPTION_KEYS = Object.freeze(["protectedKeywords"] as const);

function failInvalidAnalysisInput(): never {
  throw new Error("Invalid analysis input.");
}

function isRecord(value: unknown): value is Record<PropertyKey, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function readDenseStringArray(value: unknown): string[] {
  if (
    !Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Array.prototype
  ) {
    return failInvalidAnalysisInput();
  }

  const lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
  if (
    lengthDescriptor === undefined ||
    !("value" in lengthDescriptor) ||
    !Number.isSafeInteger(lengthDescriptor.value) ||
    lengthDescriptor.value < 0
  ) {
    return failInvalidAnalysisInput();
  }

  const length = lengthDescriptor.value;
  if (Reflect.ownKeys(value).length !== length + 1) {
    return failInvalidAnalysisInput();
  }

  const strings: string[] = [];
  for (let index = 0; index < length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (
      descriptor === undefined ||
      !("value" in descriptor) ||
      typeof descriptor.value !== "string"
    ) {
      return failInvalidAnalysisInput();
    }
    strings.push(descriptor.value);
  }

  return strings;
}

function canonicalizeOptions(value: unknown): AnalyzePromptOptions {
  if (
    !isRecord(value) ||
    Object.getPrototypeOf(value) !== Object.prototype ||
    Reflect.ownKeys(value).length !== ANALYSIS_OPTION_KEYS.length
  ) {
    return failInvalidAnalysisInput();
  }

  const descriptor = Object.getOwnPropertyDescriptor(
    value,
    "protectedKeywords",
  );
  if (descriptor === undefined || !("value" in descriptor)) {
    return failInvalidAnalysisInput();
  }

  const protectedKeywords = readDenseStringArray(descriptor.value);
  validateProtectedKeywordConfiguration(protectedKeywords);
  return { protectedKeywords };
}

export function compareFindings(
  left: SensitiveDataFinding,
  right: SensitiveDataFinding,
): number {
  return (
    left.start - right.start ||
    right.end - left.end ||
    compareDetectorPriority(left.detectorId, right.detectorId) ||
    (left.detectorId < right.detectorId
      ? -1
      : left.detectorId > right.detectorId
        ? 1
        : 0)
  );
}

export function analyzePrompt(
  prompt: string,
  options: AnalyzePromptOptions,
): SensitiveDataFinding[] {
  if (typeof prompt !== "string") {
    return failInvalidAnalysisInput();
  }
  if (prompt.length > MAX_PROMPT_CODE_UNITS) {
    throw new Error("Prompt exceeds the supported inspection limit.");
  }

  let canonicalOptions: AnalyzePromptOptions;
  try {
    canonicalOptions = canonicalizeOptions(options);
  } catch {
    return failInvalidAnalysisInput();
  }

  return [
    ...detectEmails(prompt),
    ...detectPhones(prompt),
    ...detectPaymentCards(prompt),
    ...detectAwsAccessKeys(prompt),
    ...detectPrivateKeys(prompt),
    ...detectApiSecrets(prompt),
    ...detectProtectedKeywords(prompt, canonicalOptions.protectedKeywords),
  ].sort(compareFindings);
}
