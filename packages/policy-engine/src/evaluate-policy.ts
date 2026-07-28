import type {
  PolicyAction,
  PolicyCatalogRule,
  PolicyConfiguration,
  PolicyDecision,
  PolicyFinding,
} from "@ai-dlp/shared-types";
import {
  ATTACHMENT_POLICY_RULE_ID,
  POLICY_ACTION_PRECEDENCE,
  POLICY_NO_FINDINGS_RULE,
  POLICY_REASON_CODE,
  POLICY_RULE_CATALOG,
} from "@ai-dlp/shared-types";

import {
  validatePolicyDecision,
  validatePolicyInput,
} from "./validate-policy.js";

function ruleMatchesFinding(
  rule: PolicyCatalogRule,
  finding: PolicyFinding,
): boolean {
  return (
    rule.category !== null &&
    finding.category === rule.category &&
    (rule.confidence === null || finding.confidence === rule.confidence)
  );
}

export class PolicyCatalogInvariantError extends Error {
  override readonly name = "PolicyCatalogInvariantError";
  readonly code = "invalid_policy_catalog_rule";

  constructor() {
    super("Policy catalog invariant failed.");
  }
}

export function resolvePolicyRuleAction(
  rule: PolicyCatalogRule,
  policy: PolicyConfiguration,
): PolicyAction {
  switch (rule.actionSource.kind) {
    case "constant": {
      if (rule.category !== null || rule.confidence !== null) {
        throw new PolicyCatalogInvariantError();
      }
      return rule.actionSource.requiredAction;
    }
    case "api_secret_confidence": {
      if (rule.category !== "api_secret") {
        throw new PolicyCatalogInvariantError();
      }

      switch (rule.confidence) {
        case "high":
          return policy.apiSecretActions.high;
        case "medium":
          return policy.apiSecretActions.medium;
        default:
          throw new PolicyCatalogInvariantError();
      }
    }
    case "policy_category": {
      if (
        rule.category === null ||
        rule.category === "api_secret" ||
        rule.confidence !== null
      ) {
        throw new PolicyCatalogInvariantError();
      }
      return policy.categoryActions[rule.category];
    }
  }
}

function selectHigherPrecedence(
  current: PolicyAction,
  candidate: PolicyAction,
): PolicyAction {
  return POLICY_ACTION_PRECEDENCE.indexOf(candidate) >
    POLICY_ACTION_PRECEDENCE.indexOf(current)
    ? candidate
    : current;
}

export function evaluatePolicy(value: unknown): PolicyDecision {
  const input = validatePolicyInput(value);

  if (input.findings.length === 0 && !input.attachmentPresent) {
    return validatePolicyDecision({
      action: "allow",
      matchedRuleIds: [POLICY_NO_FINDINGS_RULE.id],
      reasonCode: POLICY_REASON_CODE.NO_FINDINGS,
      attachmentPresent: false,
    });
  }

  const matchedRuleIds: string[] = [];
  let action: PolicyAction = "allow";

  for (const rule of POLICY_RULE_CATALOG) {
    if (rule.category === null) {
      continue;
    }
    if (input.findings.some((finding) => ruleMatchesFinding(rule, finding))) {
      matchedRuleIds.push(rule.id);
      action = selectHigherPrecedence(
        action,
        resolvePolicyRuleAction(rule, input.policy),
      );
    }
  }

  let reasonCode:
    | typeof POLICY_REASON_CODE.POLICY_MATCH
    | typeof POLICY_REASON_CODE.UNSUPPORTED_ATTACHMENT =
    POLICY_REASON_CODE.POLICY_MATCH;
  if (input.attachmentPresent) {
    matchedRuleIds.push(ATTACHMENT_POLICY_RULE_ID);
    const textPriority = POLICY_ACTION_PRECEDENCE.indexOf(action);
    const attachmentPriority = POLICY_ACTION_PRECEDENCE.indexOf(
      input.policy.attachmentAction,
    );
    if (attachmentPriority >= textPriority) {
      action = input.policy.attachmentAction;
      reasonCode = POLICY_REASON_CODE.UNSUPPORTED_ATTACHMENT;
    }
  }

  return validatePolicyDecision({
    action,
    matchedRuleIds,
    reasonCode,
    attachmentPresent: input.attachmentPresent,
  });
}
