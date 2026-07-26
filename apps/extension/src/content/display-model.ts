import {
  createDisplayFinding,
  createPolicyFinding,
  createProtectionDialogModel,
  type DisplayFinding,
  type PolicyDecision,
  type PolicyFinding,
  type PromptFreeArray,
  type ProtectionDialogModel,
  type SensitiveDataCategory,
  type SensitiveDataFinding,
} from "@ai-dlp/shared-types";

const CONFIDENCE_ORDER = Object.freeze(["high", "medium", "low"] as const);

export function toPolicyFinding(finding: SensitiveDataFinding): PolicyFinding {
  return createPolicyFinding({
    id: finding.id,
    detectorId: finding.detectorId,
    category: finding.category,
    confidence: finding.confidence,
  } as PolicyFinding);
}

export function toPolicyFindings(
  findings: readonly SensitiveDataFinding[],
): PromptFreeArray<PolicyFinding> {
  return findings.map(toPolicyFinding) as PromptFreeArray<PolicyFinding>;
}

export function toDisplayFindings(
  findings: readonly SensitiveDataFinding[],
): PromptFreeArray<DisplayFinding> {
  const selected = new Map<SensitiveDataCategory, DisplayFinding>();
  for (const finding of findings) {
    const previous = selected.get(finding.category);
    if (
      previous === undefined ||
      CONFIDENCE_ORDER.indexOf(finding.confidence) <
        CONFIDENCE_ORDER.indexOf(previous.confidence)
    ) {
      selected.set(
        finding.category,
        createDisplayFinding(finding.category, finding.confidence),
      );
    }
  }
  return [...selected.values()] as PromptFreeArray<DisplayFinding>;
}

export function toDetectorCategories(
  findings: readonly SensitiveDataFinding[],
): PromptFreeArray<SensitiveDataCategory> {
  return [
    ...new Set(findings.map((finding) => finding.category)),
  ] as PromptFreeArray<SensitiveDataCategory>;
}

export function createSubmissionDialogModel(
  kind: "warn" | "block",
  decision: PolicyDecision,
  findings: readonly SensitiveDataFinding[],
): ProtectionDialogModel {
  return createProtectionDialogModel({
    kind,
    findings: toDisplayFindings(findings),
    reasonCode: decision.reasonCode,
    canRedact: kind === "warn" && findings.length > 0,
  });
}
