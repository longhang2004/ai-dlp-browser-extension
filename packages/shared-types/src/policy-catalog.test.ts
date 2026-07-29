import { describe, expect, it } from "vitest";

import {
  POLICY_ACTION_PRECEDENCE,
  POLICY_NO_FINDINGS_RULE,
  POLICY_REASON_CODE,
  POLICY_REASON_CODES,
  POLICY_RULE_CATALOG,
  POLICY_RULE_IDS,
} from "./index.js";

describe("canonical policy catalog", () => {
  it("contains the exact specification order and action sources", () => {
    expect(POLICY_RULE_CATALOG).toEqual([
      {
        id: "block.private-key",
        category: "private_key",
        confidence: null,
        actionSource: {
          kind: "policy_category",
          mode: "fixed",
          requiredAction: "block",
        },
        reasonCode: "policy_match",
      },
      {
        id: "block.aws-access-key",
        category: "aws_access_key",
        confidence: null,
        actionSource: {
          kind: "policy_category",
          mode: "fixed",
          requiredAction: "block",
        },
        reasonCode: "policy_match",
      },
      {
        id: "block.payment-card",
        category: "payment_card",
        confidence: null,
        actionSource: {
          kind: "policy_category",
          mode: "fixed",
          requiredAction: "block",
        },
        reasonCode: "policy_match",
      },
      {
        id: "block.api-secret.high",
        category: "api_secret",
        confidence: "high",
        actionSource: {
          kind: "api_secret_confidence",
          mode: "fixed",
          requiredAction: "block",
        },
        reasonCode: "policy_match",
      },
      {
        id: "warn.api-secret.medium",
        category: "api_secret",
        confidence: "medium",
        actionSource: {
          kind: "api_secret_confidence",
          mode: "fixed",
          requiredAction: "warn",
        },
        reasonCode: "policy_match",
      },
      {
        id: "warn.email",
        category: "email",
        confidence: null,
        actionSource: {
          kind: "policy_category",
          mode: "configured",
        },
        reasonCode: "policy_match",
      },
      {
        id: "warn.phone",
        category: "phone",
        confidence: null,
        actionSource: {
          kind: "policy_category",
          mode: "configured",
        },
        reasonCode: "policy_match",
      },
      {
        id: "warn.protected-keyword",
        category: "protected_keyword",
        confidence: null,
        actionSource: {
          kind: "policy_category",
          mode: "fixed",
          requiredAction: "warn",
        },
        reasonCode: "policy_match",
      },
      {
        id: "allow.no-findings",
        category: null,
        confidence: null,
        actionSource: {
          kind: "constant",
          mode: "fixed",
          requiredAction: "allow",
        },
        reasonCode: "no_findings",
      },
    ]);
    expect(POLICY_RULE_IDS).toEqual([
      ...POLICY_RULE_CATALOG.map((rule) => rule.id),
      "attachment.unsupported",
    ]);
    expect(POLICY_RULE_CATALOG.at(-1)).toBe(POLICY_NO_FINDINGS_RULE);
    expect(POLICY_ACTION_PRECEDENCE).toEqual([
      "allow",
      "warn",
      "redact",
      "block",
    ]);
    expect(POLICY_REASON_CODES).toEqual([
      POLICY_REASON_CODE.NO_FINDINGS,
      POLICY_REASON_CODE.POLICY_MATCH,
      POLICY_REASON_CODE.UNSUPPORTED_ATTACHMENT,
    ]);
  });

  it("deeply freezes catalog and order metadata", () => {
    expect(Object.isFrozen(POLICY_RULE_CATALOG)).toBe(true);
    expect(Object.isFrozen(POLICY_RULE_IDS)).toBe(true);
    expect(Object.isFrozen(POLICY_ACTION_PRECEDENCE)).toBe(true);
    expect(Object.isFrozen(POLICY_REASON_CODE)).toBe(true);
    expect(Object.isFrozen(POLICY_REASON_CODES)).toBe(true);

    for (const rule of POLICY_RULE_CATALOG) {
      expect(Object.isFrozen(rule)).toBe(true);
      expect(Object.isFrozen(rule.actionSource)).toBe(true);
    }
  });
});
