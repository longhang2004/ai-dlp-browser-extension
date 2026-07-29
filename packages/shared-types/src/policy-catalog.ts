import type { FindingConfidence, SensitiveDataCategory } from "./findings.js";
import type { PolicyAction } from "./policy.js";

export const POLICY_REASON_CODE = Object.freeze({
  NO_FINDINGS: "no_findings",
  POLICY_MATCH: "policy_match",
  UNSUPPORTED_ATTACHMENT: "unsupported_attachment",
} as const);

export const POLICY_REASON_CODES = Object.freeze(
  Object.values(POLICY_REASON_CODE),
);

export type PolicyReasonCode = (typeof POLICY_REASON_CODES)[number];

export const ATTACHMENT_POLICY_RULE_ID = "attachment.unsupported" as const;

export const POLICY_ACTION_PRECEDENCE = Object.freeze([
  "allow",
  "warn",
  "redact",
  "block",
] as const satisfies readonly PolicyAction[]);

type NonApiCategory = Exclude<SensitiveDataCategory, "api_secret">;

export type FixedCategoryActionSource = Readonly<{
  kind: "policy_category";
  mode: "fixed";
  requiredAction: "warn" | "block";
}>;

export type ConfiguredCategoryActionSource = Readonly<{
  kind: "policy_category";
  mode: "configured";
}>;

export type FixedApiSecretActionSource = Readonly<{
  kind: "api_secret_confidence";
  mode: "fixed";
  requiredAction: "warn" | "block";
}>;

export type NoFindingsActionSource = Readonly<{
  kind: "constant";
  mode: "fixed";
  requiredAction: "allow";
}>;

export type FindingPolicyCatalogRule = Readonly<{
  id: string;
  category: SensitiveDataCategory;
  confidence: FindingConfidence | null;
  actionSource:
    | FixedCategoryActionSource
    | ConfiguredCategoryActionSource
    | FixedApiSecretActionSource;
  reasonCode: typeof POLICY_REASON_CODE.POLICY_MATCH;
}>;

export type NoFindingsPolicyCatalogRule = Readonly<{
  id: "allow.no-findings";
  category: null;
  confidence: null;
  actionSource: NoFindingsActionSource;
  reasonCode: typeof POLICY_REASON_CODE.NO_FINDINGS;
}>;

function fixedCategoryRule<
  const Id extends string,
  const Category extends NonApiCategory,
  const Action extends "warn" | "block",
>(
  id: Id,
  category: Category,
  requiredAction: Action,
): Readonly<{
  id: Id;
  category: Category;
  confidence: null;
  actionSource: FixedCategoryActionSource & {
    readonly requiredAction: Action;
  };
  reasonCode: typeof POLICY_REASON_CODE.POLICY_MATCH;
}> {
  return Object.freeze({
    id,
    category,
    confidence: null,
    actionSource: Object.freeze({
      kind: "policy_category",
      mode: "fixed",
      requiredAction,
    }),
    reasonCode: POLICY_REASON_CODE.POLICY_MATCH,
  });
}

function configuredCategoryRule<
  const Id extends string,
  const Category extends "email" | "phone",
>(
  id: Id,
  category: Category,
): Readonly<{
  id: Id;
  category: Category;
  confidence: null;
  actionSource: ConfiguredCategoryActionSource;
  reasonCode: typeof POLICY_REASON_CODE.POLICY_MATCH;
}> {
  return Object.freeze({
    id,
    category,
    confidence: null,
    actionSource: Object.freeze({
      kind: "policy_category",
      mode: "configured",
    }),
    reasonCode: POLICY_REASON_CODE.POLICY_MATCH,
  });
}

function fixedApiSecretRule<
  const Id extends string,
  const Confidence extends "high" | "medium",
  const Action extends "warn" | "block",
>(
  id: Id,
  confidence: Confidence,
  requiredAction: Action,
): Readonly<{
  id: Id;
  category: "api_secret";
  confidence: Confidence;
  actionSource: FixedApiSecretActionSource & {
    readonly requiredAction: Action;
  };
  reasonCode: typeof POLICY_REASON_CODE.POLICY_MATCH;
}> {
  return Object.freeze({
    id,
    category: "api_secret",
    confidence,
    actionSource: Object.freeze({
      kind: "api_secret_confidence",
      mode: "fixed",
      requiredAction,
    }),
    reasonCode: POLICY_REASON_CODE.POLICY_MATCH,
  });
}

export const POLICY_NO_FINDINGS_RULE = Object.freeze({
  id: "allow.no-findings",
  category: null,
  confidence: null,
  actionSource: Object.freeze({
    kind: "constant",
    mode: "fixed",
    requiredAction: "allow",
  }),
  reasonCode: POLICY_REASON_CODE.NO_FINDINGS,
} as const satisfies NoFindingsPolicyCatalogRule);

export const POLICY_RULE_CATALOG = Object.freeze([
  fixedCategoryRule("block.private-key", "private_key", "block"),
  fixedCategoryRule("block.aws-access-key", "aws_access_key", "block"),
  fixedCategoryRule("block.payment-card", "payment_card", "block"),
  fixedApiSecretRule("block.api-secret.high", "high", "block"),
  fixedApiSecretRule("warn.api-secret.medium", "medium", "warn"),
  configuredCategoryRule("warn.email", "email"),
  configuredCategoryRule("warn.phone", "phone"),
  fixedCategoryRule("warn.protected-keyword", "protected_keyword", "warn"),
  POLICY_NO_FINDINGS_RULE,
] as const satisfies readonly (
  FindingPolicyCatalogRule | NoFindingsPolicyCatalogRule
)[]);

export type PolicyCatalogRule = (typeof POLICY_RULE_CATALOG)[number];
export type PolicyRuleId =
  PolicyCatalogRule["id"] | typeof ATTACHMENT_POLICY_RULE_ID;

export const POLICY_RULE_IDS = Object.freeze([
  ...POLICY_RULE_CATALOG.map((rule) => rule.id),
  ATTACHMENT_POLICY_RULE_ID,
]) as readonly PolicyRuleId[];
