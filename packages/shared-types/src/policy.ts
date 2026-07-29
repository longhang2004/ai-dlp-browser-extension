import type {
  DetectorIdForCategory,
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

export const ATTACHMENT_ACTIONS = Object.freeze([
  "allow",
  "warn",
  "block",
] as const);

export type AttachmentAction = (typeof ATTACHMENT_ACTIONS)[number];

export type DecisionReason =
  "no_findings" | "policy_match" | "unsupported_attachment";

type PolicyFindingForCategory<Category extends SensitiveDataCategory> =
  PromptFreeBoundary & {
    id: FindingId<DetectorIdForCategory<Category>>;
    detectorId: DetectorIdForCategory<Category>;
    category: Category;
    confidence: FindingConfidence;
  };

export type PolicyFinding = {
  [Category in SensitiveDataCategory]: PolicyFindingForCategory<Category>;
}[SensitiveDataCategory];

export type PolicyConfiguration = PromptFreeBoundary & {
  schemaVersion: 2;
  categoryActions: PromptFreeBoundary &
    Record<Exclude<SensitiveDataCategory, "api_secret">, PolicyAction>;
  apiSecretActions: PromptFreeBoundary & {
    high: PolicyAction;
    medium: PolicyAction;
  };
  attachmentAction: AttachmentAction;
};

export type PolicyInput = PromptDerivedBoundary & {
  application: "chatgpt";
  attachmentPresent: boolean;
  findings: PromptFreeArray<PolicyFinding>;
  policy: PolicyConfiguration;
};

export type PolicyDecision = PromptFreeBoundary & {
  action: PolicyAction;
  matchedRuleIds: PromptFreeArray<string>;
  contributingCategories: PromptFreeArray<SensitiveDataCategory>;
  reasonCode: DecisionReason;
  attachmentPresent: boolean;
};
