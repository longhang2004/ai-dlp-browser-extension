import type {
  DetectorId,
  FindingConfidence,
  FindingId,
  SensitiveDataCategory,
} from "./findings.js";
import type {
  PromptDerivedBoundary,
  PromptFreeArray,
  PromptFreeBoundary,
} from "./privacy.js";

export const POLICY_ACTIONS = Object.freeze([
  "allow",
  "warn",
  "redact",
  "block",
] as const);

export type PolicyAction = (typeof POLICY_ACTIONS)[number];

export type PolicyFinding = PromptFreeBoundary & {
  id: FindingId;
  detectorId: DetectorId;
  category: SensitiveDataCategory;
  confidence: FindingConfidence;
};

export type PolicyConfiguration = PromptFreeBoundary & {
  schemaVersion: 1;
  categoryActions: PromptFreeBoundary &
    Record<Exclude<SensitiveDataCategory, "api_secret">, PolicyAction>;
  apiSecretActions: PromptFreeBoundary & {
    high: PolicyAction;
    medium: PolicyAction;
  };
};

export type PolicyInput = PromptDerivedBoundary & {
  application: "chatgpt";
  findings: PromptFreeArray<PolicyFinding>;
  policy: PolicyConfiguration;
};

export type PolicyDecision = PromptFreeBoundary & {
  action: PolicyAction;
  matchedRuleIds: PromptFreeArray<string>;
  reasonCode: string;
};
