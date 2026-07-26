import {
  createFindingId,
  createPolicyFinding,
  POLICY_RULE_CATALOG,
  type DetectorCategory,
  type DetectorId,
  type FindingConfidence,
  type PolicyConfiguration,
  type PolicyCatalogRule,
  type PolicyFinding,
} from "@ai-dlp/shared-types";
import { describe, expect, it } from "vitest";

import {
  evaluatePolicy,
  PolicyCatalogInvariantError,
  resolvePolicyRuleAction,
} from "./evaluate-policy.js";
import { PolicyValidationError } from "./validate-policy.js";

function createPolicy(
  email: "allow" | "warn" | "redact" | "block" = "warn",
  phone: "allow" | "warn" | "redact" | "block" = "warn",
): PolicyConfiguration {
  return {
    schemaVersion: 1,
    categoryActions: {
      email,
      phone,
      payment_card: "block",
      aws_access_key: "block",
      private_key: "block",
      protected_keyword: "warn",
    },
    apiSecretActions: {
      high: "block",
      medium: "warn",
    },
  };
}

function finding<Detector extends DetectorId>(
  detectorId: Detector,
  category: DetectorCategory<Detector>,
  confidence: FindingConfidence = "high",
  position = 0,
): PolicyFinding {
  return createPolicyFinding({
    id: createFindingId(detectorId, position, position + 1),
    detectorId,
    category,
    confidence,
  } as PolicyFinding);
}

describe("evaluatePolicy", () => {
  it("allows no findings with the exact no-findings decision", () => {
    expect(
      evaluatePolicy({
        application: "chatgpt",
        findings: [],
        policy: createPolicy(),
      }),
    ).toEqual({
      action: "allow",
      matchedRuleIds: ["allow.no-findings"],
      reasonCode: "no_findings",
    });
  });

  it("evaluates every applicable rule once in fixed table order", () => {
    const decision = evaluatePolicy({
      application: "chatgpt",
      findings: [
        finding("protected-keyword", "protected_keyword", "medium", 0),
        finding("phone", "phone", "medium", 1),
        finding("email", "email", "high", 2),
        finding("api-secret", "api_secret", "medium", 3),
        finding("api-secret", "api_secret", "high", 4),
        finding("payment-card", "payment_card", "high", 5),
        finding("aws-access-key", "aws_access_key", "high", 6),
        finding("private-key", "private_key", "high", 7),
        finding("email", "email", "high", 8),
      ],
      policy: createPolicy("redact", "allow"),
    });

    expect(decision).toEqual({
      action: "block",
      matchedRuleIds: [
        "block.private-key",
        "block.aws-access-key",
        "block.payment-card",
        "block.api-secret.high",
        "warn.api-secret.medium",
        "warn.email",
        "warn.phone",
        "warn.protected-keyword",
      ],
      reasonCode: "policy_match",
    });
    expect(decision.matchedRuleIds).toEqual(
      POLICY_RULE_CATALOG.filter((rule) => rule.category !== null).map(
        (rule) => rule.id,
      ),
    );
    expect(Reflect.ownKeys(decision)).toEqual([
      "action",
      "matchedRuleIds",
      "reasonCode",
    ]);
    expect(decision).not.toHaveProperty("findings");
  });

  it.each([
    ["block", "warn", "block"],
    ["redact", "warn", "redact"],
    ["warn", "allow", "warn"],
    ["allow", "allow", "allow"],
  ] as const)(
    "uses block > redact > warn > allow precedence for contact actions %s/%s",
    (emailAction, phoneAction, expectedAction) => {
      expect(
        evaluatePolicy({
          application: "chatgpt",
          findings: [
            finding("phone", "phone", "high", 0),
            finding("email", "email", "high", 1),
          ],
          policy: createPolicy(emailAction, phoneAction),
        }),
      ).toEqual({
        action: expectedAction,
        matchedRuleIds: ["warn.email", "warn.phone"],
        reasonCode: "policy_match",
      });
    },
  );

  it("keeps stable warn.email and warn.phone rule IDs under every configured action", () => {
    for (const action of ["allow", "warn", "redact", "block"] as const) {
      expect(
        evaluatePolicy({
          application: "chatgpt",
          findings: [
            finding("email", "email", "high", 0),
            finding("phone", "phone", "high", 1),
          ],
          policy: createPolicy(action, action),
        }),
      ).toMatchObject({
        action,
        matchedRuleIds: ["warn.email", "warn.phone"],
      });
    }
  });

  it.each([
    ["private-key", "private_key", "high", "block.private-key", "block"],
    [
      "aws-access-key",
      "aws_access_key",
      "high",
      "block.aws-access-key",
      "block",
    ],
    ["payment-card", "payment_card", "high", "block.payment-card", "block"],
    [
      "protected-keyword",
      "protected_keyword",
      "medium",
      "warn.protected-keyword",
      "warn",
    ],
    ["api-secret", "api_secret", "high", "block.api-secret.high", "block"],
    ["api-secret", "api_secret", "medium", "warn.api-secret.medium", "warn"],
  ] as const)(
    "maps %s to its exact fixed rule and action",
    (detectorId, category, confidence, ruleId, action) => {
      expect(
        evaluatePolicy({
          application: "chatgpt",
          findings: [finding(detectorId, category, confidence)],
          policy: createPolicy(),
        }),
      ).toEqual({
        action,
        matchedRuleIds: [ruleId],
        reasonCode: "policy_match",
      });
    },
  );

  it("rejects unsafe input before evaluating any rules", () => {
    expect(() =>
      evaluatePolicy({
        application: "chatgpt",
        findings: [{ ...finding("email", "email"), matchedText: "secret" }],
        policy: createPolicy(),
      }),
    ).toThrow(PolicyValidationError);
  });

  it("rejects a payment-card detector mislabeled as email before configured allow can evaluate", () => {
    expect(() =>
      evaluatePolicy({
        application: "chatgpt",
        findings: [
          {
            id: createFindingId("payment-card", 0, 1),
            detectorId: "payment-card",
            category: "email",
            confidence: "high",
          },
        ],
        policy: createPolicy("allow"),
      }),
    ).toThrow(
      expect.objectContaining({
        name: "PolicyValidationError",
        code: "invalid_policy_input",
      }),
    );
  });
});

describe("resolvePolicyRuleAction catalog invariants", () => {
  const apiSecretRule = POLICY_RULE_CATALOG.find(
    (rule) => rule.id === "warn.api-secret.medium",
  );

  if (apiSecretRule === undefined) {
    throw new Error("Canonical API-secret rule missing.");
  }

  it.each(["low", "unknown"] as const)(
    "never maps malformed %s confidence to the medium action",
    (confidence) => {
      const malformedRule = {
        ...apiSecretRule,
        confidence,
      } as unknown as PolicyCatalogRule;

      let caught: unknown;
      try {
        resolvePolicyRuleAction(malformedRule, createPolicy());
      } catch (error) {
        caught = error;
      }

      expect(caught).toBeInstanceOf(PolicyCatalogInvariantError);
      expect(caught).toMatchObject({
        name: "PolicyCatalogInvariantError",
        code: "invalid_policy_catalog_rule",
        message: "Policy catalog invariant failed.",
      });
      expect(JSON.stringify(caught)).not.toContain(confidence);
    },
  );

  it("rejects an API-secret action source attached to another category", () => {
    const malformedRule = {
      ...apiSecretRule,
      category: "email",
    } as unknown as PolicyCatalogRule;

    expect(() =>
      resolvePolicyRuleAction(malformedRule, createPolicy()),
    ).toThrow(
      expect.objectContaining({
        name: "PolicyCatalogInvariantError",
        code: "invalid_policy_catalog_rule",
      }),
    );
  });
});
