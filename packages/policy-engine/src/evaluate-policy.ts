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
      contributingCategories: [],
      reasonCode: POLICY_REASON_CODE.NO_FINDINGS,
      attachmentPresent: false,
    });
  }

  const matches: {
    rule: PolicyCatalogRule;
    action: PolicyAction;
  }[] = [];
  let action: PolicyAction = "allow";

  for (const rule of POLICY_RULE_CATALOG) {
    if (rule.category === null) {
      continue;
    }
    if (input.findings.some((finding) => ruleMatchesFinding(rule, finding))) {
      const ruleAction = resolvePolicyRuleAction(rule, input.policy);
      matches.push({ rule, action: ruleAction });
      action = selectHigherPrecedence(action, ruleAction);
    }
  }

  let attachmentContributed = false;
  if (input.attachmentPresent) {
    const textPriority = POLICY_ACTION_PRECEDENCE.indexOf(action);
    const attachmentPriority = POLICY_ACTION_PRECEDENCE.indexOf(
      input.policy.attachmentAction,
    );
    if (attachmentPriority >= textPriority) {
      action = input.policy.attachmentAction;
      attachmentContributed = true;
    }
  }

  const contributingMatches = matches.filter(
    (match) => match.action === action,
  );
  const matchedRuleIds: string[] = contributingMatches.map(
    (match) => match.rule.id,
  );
  if (attachmentContributed) {
    matchedRuleIds.push(ATTACHMENT_POLICY_RULE_ID);
  }
  const contributingCategories = [
    ...new Set(
      contributingMatches.flatMap((match) =>
        match.rule.category === null ? [] : [match.rule.category],
      ),
    ),
  ];

  return validatePolicyDecision({
    action,
    matchedRuleIds,
    contributingCategories,
    reasonCode: attachmentContributed
      ? POLICY_REASON_CODE.UNSUPPORTED_ATTACHMENT
      : POLICY_REASON_CODE.POLICY_MATCH,
    attachmentPresent: input.attachmentPresent,
  });
}
