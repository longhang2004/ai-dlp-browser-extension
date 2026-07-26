import {
  createFindingId,
  DETECTOR_CATEGORY,
  FINDING_CONFIDENCES,
  isDetectorId,
  SENSITIVE_DATA_PLACEHOLDERS,
} from "@ai-dlp/shared-types";
import type {
  RedactionResult,
  SensitiveDataCategory,
  SensitiveDataFinding,
} from "@ai-dlp/shared-types";

import { compareFindings, MAX_PROMPT_CODE_UNITS } from "./analyze.js";
import { DETECTOR_PRIORITY } from "./priority.js";

const FINDING_KEYS = Object.freeze([
  "id",
  "detectorId",
  "category",
  "start",
  "end",
  "confidence",
  "matchedText",
  "redactedText",
] as const);

const FINDING_KEY_SET = new Set<PropertyKey>(FINDING_KEYS);

type ReplacementRange = {
  start: number;
  end: number;
  category: SensitiveDataCategory;
  priority: number;
};

function failInvalidInput(): never {
  throw new Error("Invalid redaction input.");
}

function isRecord(value: unknown): value is Record<PropertyKey, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function validateFinding(prompt: string, value: unknown): SensitiveDataFinding {
  const keys = isRecord(value) ? Reflect.ownKeys(value) : [];
  if (
    !isRecord(value) ||
    Object.getPrototypeOf(value) !== Object.prototype ||
    keys.length !== FINDING_KEYS.length ||
    keys.some((key) => !FINDING_KEY_SET.has(key))
  ) {
    return failInvalidInput();
  }

  const fields: Record<string, unknown> = {};
  for (const key of FINDING_KEYS) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || !("value" in descriptor)) {
      return failInvalidInput();
    }
    fields[key] = descriptor.value;
  }

  const detectorId = fields.detectorId;
  const start = fields.start;
  const end = fields.end;
  const confidence = fields.confidence;

  if (
    !isDetectorId(detectorId) ||
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    typeof start !== "number" ||
    typeof end !== "number" ||
    start < 0 ||
    end <= start ||
    end > prompt.length ||
    typeof confidence !== "string" ||
    !FINDING_CONFIDENCES.includes(
      confidence as (typeof FINDING_CONFIDENCES)[number],
    ) ||
    fields.category !== DETECTOR_CATEGORY[detectorId] ||
    fields.id !== createFindingId(detectorId, start, end) ||
    fields.matchedText !== prompt.slice(start, end) ||
    fields.redactedText !==
      SENSITIVE_DATA_PLACEHOLDERS[DETECTOR_CATEGORY[detectorId]]
  ) {
    return failInvalidInput();
  }

  return {
    id: fields.id,
    detectorId,
    category: fields.category,
    start,
    end,
    confidence,
    matchedText: fields.matchedText,
    redactedText: fields.redactedText,
  } as SensitiveDataFinding;
}

function readDenseFindingArray(value: unknown): unknown[] {
  if (
    !Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Array.prototype
  ) {
    return failInvalidInput();
  }

  const lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
  if (
    lengthDescriptor === undefined ||
    !("value" in lengthDescriptor) ||
    !Number.isSafeInteger(lengthDescriptor.value) ||
    lengthDescriptor.value < 0
  ) {
    return failInvalidInput();
  }

  const length = lengthDescriptor.value;
  const keys = Reflect.ownKeys(value);
  if (keys.length !== length + 1) {
    return failInvalidInput();
  }

  const findings: unknown[] = [];
  for (let index = 0; index < length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (descriptor === undefined || !("value" in descriptor)) {
      return failInvalidInput();
    }
    findings.push(descriptor.value);
  }

  return findings;
}

function createReplacementRanges(
  findings: readonly SensitiveDataFinding[],
): ReplacementRange[] {
  const ranges: ReplacementRange[] = [];

  for (const finding of findings) {
    const previous = ranges.at(-1);
    if (previous === undefined || finding.start >= previous.end) {
      ranges.push({
        start: finding.start,
        end: finding.end,
        category: finding.category,
        priority: DETECTOR_PRIORITY[finding.detectorId],
      });
      continue;
    }

    previous.end = Math.max(previous.end, finding.end);
    const findingPriority = DETECTOR_PRIORITY[finding.detectorId];
    if (findingPriority < previous.priority) {
      previous.category = finding.category;
      previous.priority = findingPriority;
    }
  }

  return ranges;
}

function applyReplacementRanges(
  prompt: string,
  ranges: readonly ReplacementRange[],
): string {
  const reverseChunks: string[] = [];
  let cursor = prompt.length;

  for (let index = ranges.length - 1; index >= 0; index -= 1) {
    const range = ranges[index];
    if (range === undefined) {
      continue;
    }
    reverseChunks.push(prompt.slice(range.end, cursor));
    reverseChunks.push(SENSITIVE_DATA_PLACEHOLDERS[range.category]);
    cursor = range.start;
  }

  reverseChunks.push(prompt.slice(0, cursor));
  return reverseChunks.reverse().join("");
}

function redactValidated(prompt: unknown, findings: unknown): RedactionResult {
  if (typeof prompt !== "string" || prompt.length > MAX_PROMPT_CODE_UNITS) {
    return failInvalidInput();
  }

  const validatedFindings = readDenseFindingArray(findings)
    .map((finding) => validateFinding(prompt, finding))
    .sort(compareFindings);
  const seenIds = new Set<string>();
  for (const finding of validatedFindings) {
    if (seenIds.has(finding.id)) {
      return failInvalidInput();
    }
    seenIds.add(finding.id);
  }

  const ranges = createReplacementRanges(validatedFindings);

  return {
    sanitizedText: applyReplacementRanges(prompt, ranges),
    appliedFindings: validatedFindings,
  };
}

export function redactPrompt(
  prompt: string,
  findings: SensitiveDataFinding[],
): RedactionResult {
  try {
    return redactValidated(prompt, findings);
  } catch {
    return failInvalidInput();
  }
}
