import { ENFORCEMENT_ERROR_CODES } from "./audit.js";
import type { EnforcementErrorCode } from "./audit.js";
import {
  FINDING_CONFIDENCES,
  SENSITIVE_DATA_CATEGORIES,
  SENSITIVE_DATA_PLACEHOLDERS,
} from "./findings.js";
import type {
  FindingConfidence,
  SensitiveDataCategory,
  SensitiveDataPlaceholder,
} from "./findings.js";
import type {
  PromptDerivedBoundary,
  PromptFreeArray,
  PromptFreeBoundary,
  ReadonlyPromptFreeArray,
} from "./privacy.js";
import type { DecisionReason } from "./policy.js";
import {
  hasExactOwnKeys,
  INVALID_SNAPSHOT,
  isDenseExactArray,
  isPlainRecord,
  safelyValidate,
  snapshotStructuredValue,
  validatesStructuredSnapshot,
} from "./validation-helpers.js";

export type DisplayFinding = PromptFreeBoundary &
  {
    [Category in SensitiveDataCategory]: {
      category: Category;
      confidence: FindingConfidence;
      placeholder: (typeof SENSITIVE_DATA_PLACEHOLDERS)[Category];
    };
  }[SensitiveDataCategory];

declare const maskedPreviewBrand: unique symbol;

export type MaskedPreview = string & {
  readonly [maskedPreviewBrand]: true;
};

const APPROVED_PLACEHOLDERS = new Set<string>(
  Object.values(SENSITIVE_DATA_PLACEHOLDERS),
);

function isSensitiveDataCategory(
  value: unknown,
): value is SensitiveDataCategory {
  return (
    typeof value === "string" &&
    SENSITIVE_DATA_CATEGORIES.includes(value as SensitiveDataCategory)
  );
}

function isFindingConfidence(value: unknown): value is FindingConfidence {
  return (
    typeof value === "string" &&
    FINDING_CONFIDENCES.includes(value as FindingConfidence)
  );
}

function isSensitiveDataPlaceholder(
  value: unknown,
): value is SensitiveDataPlaceholder {
  return typeof value === "string" && APPROVED_PLACEHOLDERS.has(value);
}

export function createDisplayFinding<Category extends SensitiveDataCategory>(
  category: Category,
  confidence: FindingConfidence,
): Extract<DisplayFinding, { category: Category }> {
  const snapshot = snapshotStructuredValue({ category, confidence });
  if (
    snapshot === INVALID_SNAPSHOT ||
    !isPlainRecord(snapshot) ||
    !hasExactOwnKeys(snapshot, ["category", "confidence"]) ||
    !isSensitiveDataCategory(snapshot.category) ||
    !isFindingConfidence(snapshot.confidence)
  ) {
    throw new Error("Invalid display finding metadata.");
  }

  return {
    category: snapshot.category,
    confidence: snapshot.confidence,
    placeholder: SENSITIVE_DATA_PLACEHOLDERS[snapshot.category],
  } as Extract<DisplayFinding, { category: Category }>;
}

export function isDisplayFindingSnapshot(
  value: unknown,
): value is DisplayFinding {
  return safelyValidate(() => {
    if (
      !isPlainRecord(value) ||
      !hasExactOwnKeys(value, ["category", "confidence", "placeholder"]) ||
      !isSensitiveDataCategory(value.category) ||
      !isFindingConfidence(value.confidence)
    ) {
      return false;
    }

    return value.placeholder === SENSITIVE_DATA_PLACEHOLDERS[value.category];
  });
}

export function isDisplayFinding(value: unknown): value is DisplayFinding {
  return validatesStructuredSnapshot(value, isDisplayFindingSnapshot);
}

export function isMaskedPreviewSnapshot(
  value: unknown,
): value is MaskedPreview {
  return safelyValidate(() => {
    if (
      typeof value !== "string" ||
      value.length > 200 ||
      !value.startsWith("… ") ||
      !value.endsWith(" …")
    ) {
      return false;
    }

    return isDenseExactArray(
      value.slice(2, -2).split(" … "),
      1,
      5,
      isSensitiveDataPlaceholder,
    );
  });
}

export function isMaskedPreview(value: unknown): value is MaskedPreview {
  return validatesStructuredSnapshot(value, isMaskedPreviewSnapshot);
}

export function getMaskedPreviewPlaceholdersSnapshot(
  value: MaskedPreview,
): PromptFreeArray<SensitiveDataPlaceholder> {
  return value
    .slice(2, -2)
    .split(" … ") as PromptFreeArray<SensitiveDataPlaceholder>;
}

export function createMaskedPreview(
  placeholders: ReadonlyPromptFreeArray<SensitiveDataPlaceholder>,
): MaskedPreview {
  const snapshot = snapshotStructuredValue(placeholders);
  if (
    snapshot === INVALID_SNAPSHOT ||
    !isDenseExactArray(snapshot, 1, 5, isSensitiveDataPlaceholder)
  ) {
    throw new Error("Invalid masked preview placeholders.");
  }

  return `… ${snapshot.join(" … ")} …` as MaskedPreview;
}

export type ProtectionDialogModel = PromptDerivedBoundary & {
  kind: "warn" | "block";
  findings: PromptFreeArray<DisplayFinding>;
  maskedPreview?: MaskedPreview;
  reasonCode: Exclude<DecisionReason, "no_findings">;
  attachmentPresent: boolean;
  canRedact: boolean;
};

export type ProtectionDialogModelInput = PromptDerivedBoundary & {
  kind: "warn" | "block";
  findings: PromptFreeArray<DisplayFinding>;
  reasonCode: Exclude<DecisionReason, "no_findings">;
  attachmentPresent: boolean;
  canRedact: boolean;
  maskedPreview?: never;
};

export type ProtectionErrorDialogModel = PromptFreeBoundary & {
  kind: "error";
  errorCode: EnforcementErrorCode;
};

export type ProtectionDialogRequest =
  ProtectionDialogModel | ProtectionErrorDialogModel;

export type ProtectionDialogIntent = "cancel" | "bypass" | "redact";

export function isProtectionDialogModelSnapshot(
  value: unknown,
): value is ProtectionDialogModel {
  return safelyValidate(() => {
    if (
      !isPlainRecord(value) ||
      !hasExactOwnKeys(
        value,
        ["kind", "findings", "reasonCode", "attachmentPresent", "canRedact"],
        ["maskedPreview"],
      ) ||
      (value.kind !== "warn" && value.kind !== "block") ||
      typeof value.attachmentPresent !== "boolean" ||
      !isDenseExactArray(
        value.findings,
        value.attachmentPresent ? 0 : 1,
        7,
        isDisplayFindingSnapshot,
      ) ||
      new Set(value.findings.map((finding) => finding.category)).size !==
        value.findings.length ||
      typeof value.canRedact !== "boolean" ||
      (value.kind === "block" && value.canRedact !== false) ||
      (value.attachmentPresent && value.canRedact) ||
      (value.reasonCode !== "policy_match" &&
        value.reasonCode !== "unsupported_attachment") ||
      (!value.attachmentPresent && value.reasonCode !== "policy_match")
    ) {
      return false;
    }

    return value.findings.length === 0
      ? !Object.hasOwn(value, "maskedPreview")
      : isMaskedPreviewSnapshot(value.maskedPreview) &&
          value.maskedPreview ===
            deriveMaskedPreviewFromFindingsSnapshot(value.findings);
  });
}

export function isProtectionDialogModel(
  value: unknown,
): value is ProtectionDialogModel {
  return validatesStructuredSnapshot(value, isProtectionDialogModelSnapshot);
}

function isProtectionDialogModelInputSnapshot(
  value: unknown,
): value is ProtectionDialogModelInput {
  return safelyValidate(
    () =>
      isPlainRecord(value) &&
      hasExactOwnKeys(value, [
        "kind",
        "findings",
        "reasonCode",
        "attachmentPresent",
        "canRedact",
      ]) &&
      (value.kind === "warn" || value.kind === "block") &&
      typeof value.attachmentPresent === "boolean" &&
      isDenseExactArray(
        value.findings,
        value.attachmentPresent ? 0 : 1,
        7,
        isDisplayFindingSnapshot,
      ) &&
      new Set(value.findings.map((finding) => finding.category)).size ===
        value.findings.length &&
      (value.reasonCode === "policy_match" ||
        (value.attachmentPresent &&
          value.reasonCode === "unsupported_attachment")) &&
      typeof value.canRedact === "boolean" &&
      (!value.attachmentPresent || value.canRedact === false) &&
      (value.kind !== "block" || value.canRedact === false),
  );
}

function deriveMaskedPreviewFromFindingsSnapshot(
  findings: ReadonlyPromptFreeArray<DisplayFinding>,
): MaskedPreview {
  const placeholders = findings
    .map((finding) => finding.placeholder)
    .filter((placeholder, index, all) => all.indexOf(placeholder) === index)
    .slice(0, 5);
  return `… ${placeholders.join(" … ")} …` as MaskedPreview;
}

export function createProtectionDialogModel(
  value: ProtectionDialogModelInput,
): ProtectionDialogModel {
  const snapshot = snapshotStructuredValue(value);
  if (
    snapshot === INVALID_SNAPSHOT ||
    !isProtectionDialogModelInputSnapshot(snapshot)
  ) {
    throw new Error("Invalid protection dialog model.");
  }

  return {
    kind: snapshot.kind,
    findings: snapshot.findings.map((finding) => ({
      category: finding.category,
      confidence: finding.confidence,
      placeholder: finding.placeholder,
    })) as PromptFreeArray<DisplayFinding>,
    reasonCode: snapshot.reasonCode,
    attachmentPresent: snapshot.attachmentPresent,
    canRedact: snapshot.canRedact,
    ...(snapshot.findings.length === 0
      ? {}
      : {
          maskedPreview: deriveMaskedPreviewFromFindingsSnapshot(
            snapshot.findings,
          ),
        }),
  };
}

export function isProtectionErrorDialogModelSnapshot(
  value: unknown,
): value is ProtectionErrorDialogModel {
  return safelyValidate(
    () =>
      isPlainRecord(value) &&
      hasExactOwnKeys(value, ["kind", "errorCode"]) &&
      value.kind === "error" &&
      typeof value.errorCode === "string" &&
      ENFORCEMENT_ERROR_CODES.includes(value.errorCode as EnforcementErrorCode),
  );
}

export function isProtectionErrorDialogModel(
  value: unknown,
): value is ProtectionErrorDialogModel {
  return validatesStructuredSnapshot(
    value,
    isProtectionErrorDialogModelSnapshot,
  );
}

export function isProtectionDialogRequestSnapshot(
  value: unknown,
): value is ProtectionDialogRequest {
  return (
    isProtectionDialogModelSnapshot(value) ||
    isProtectionErrorDialogModelSnapshot(value)
  );
}

export function isProtectionDialogRequest(
  value: unknown,
): value is ProtectionDialogRequest {
  return validatesStructuredSnapshot(value, isProtectionDialogRequestSnapshot);
}
