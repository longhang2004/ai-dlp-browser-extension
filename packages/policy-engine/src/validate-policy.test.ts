import {
  createFindingId,
  type PolicyConfiguration,
} from "@ai-dlp/shared-types";
import { describe, expect, it } from "vitest";

import {
  PolicyValidationError,
  validatePolicyConfiguration,
  validatePolicyDecision,
  validatePolicyInput,
} from "./validate-policy.js";

const validPolicy: PolicyConfiguration = {
  schemaVersion: 1,
  categoryActions: {
    email: "warn",
    phone: "warn",
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

const validFinding = {
  id: createFindingId("email", 0, 1),
  detectorId: "email" as const,
  category: "email" as const,
  confidence: "high" as const,
};

describe("policy validation", () => {
  it("returns detached, exact snapshots for valid configuration, input, and decision", () => {
    const findings = [validFinding];
    const configuration = validatePolicyConfiguration(validPolicy);
    const input = validatePolicyInput({
      application: "chatgpt",
      findings,
      policy: validPolicy,
    });
    const decision = validatePolicyDecision({
      action: "warn",
      matchedRuleIds: ["warn.email"],
      reasonCode: "policy_match",
    });

    expect(configuration).toEqual(validPolicy);
    expect(configuration).not.toBe(validPolicy);
    expect(input).toEqual({
      application: "chatgpt",
      findings: [validFinding],
      policy: validPolicy,
    });
    expect(input.findings).not.toBe(findings);
    expect(decision).toEqual({
      action: "warn",
      matchedRuleIds: ["warn.email"],
      reasonCode: "policy_match",
    });
    expect(Reflect.ownKeys(decision)).toEqual([
      "action",
      "matchedRuleIds",
      "reasonCode",
    ]);
  });

  it.each([
    [
      "missing category",
      (policy: Record<string, unknown>) => {
        delete (policy.categoryActions as Record<string, unknown>).phone;
      },
    ],
    [
      "unknown category",
      (policy: Record<string, unknown>) => {
        (policy.categoryActions as Record<string, unknown>).api_secret =
          "block";
      },
    ],
    [
      "missing confidence",
      (policy: Record<string, unknown>) => {
        delete (policy.apiSecretActions as Record<string, unknown>).medium;
      },
    ],
    [
      "unknown confidence",
      (policy: Record<string, unknown>) => {
        (policy.apiSecretActions as Record<string, unknown>).low = "warn";
      },
    ],
    [
      "invalid action",
      (policy: Record<string, unknown>) => {
        (policy.categoryActions as Record<string, unknown>).email = "monitor";
      },
    ],
    [
      "invalid confidence action",
      (policy: Record<string, unknown>) => {
        (policy.apiSecretActions as Record<string, unknown>).medium = "monitor";
      },
    ],
    [
      "weakened payment card",
      (policy: Record<string, unknown>) => {
        (policy.categoryActions as Record<string, unknown>).payment_card =
          "warn";
      },
    ],
    [
      "weakened AWS access key",
      (policy: Record<string, unknown>) => {
        (policy.categoryActions as Record<string, unknown>).aws_access_key =
          "warn";
      },
    ],
    [
      "weakened private key",
      (policy: Record<string, unknown>) => {
        (policy.categoryActions as Record<string, unknown>).private_key =
          "warn";
      },
    ],
    [
      "weakened protected keyword",
      (policy: Record<string, unknown>) => {
        (policy.categoryActions as Record<string, unknown>).protected_keyword =
          "allow";
      },
    ],
    [
      "weakened high API secret",
      (policy: Record<string, unknown>) => {
        (policy.apiSecretActions as Record<string, unknown>).high = "warn";
      },
    ],
    [
      "weakened medium API secret",
      (policy: Record<string, unknown>) => {
        (policy.apiSecretActions as Record<string, unknown>).medium = "allow";
      },
    ],
  ])("rejects %s without reflecting candidate data", (_name, mutate) => {
    const candidate: Record<string, unknown> = {
      schemaVersion: validPolicy.schemaVersion,
      categoryActions: { ...validPolicy.categoryActions },
      apiSecretActions: { ...validPolicy.apiSecretActions },
    };
    mutate(candidate);

    let caught: unknown;
    try {
      validatePolicyConfiguration(candidate);
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(PolicyValidationError);
    expect(caught).toMatchObject({
      name: "PolicyValidationError",
      code: "invalid_policy_configuration",
      message: "Policy validation failed.",
    });
    expect(JSON.stringify(caught)).not.toContain(JSON.stringify(candidate));
  });

  it.each([
    { prompt: "do not inspect" },
    { matchedText: "do not inspect" },
    { redactedText: "[EMAIL]" },
    { sanitizedText: "[EMAIL]" },
    { start: 0 },
    { end: 1 },
    { offsets: [0, 1] },
  ])("rejects forbidden finding metadata %# before evaluation", (extra) => {
    expect(() =>
      validatePolicyInput({
        application: "chatgpt",
        findings: [{ ...validFinding, ...extra }],
        policy: validPolicy,
      }),
    ).toThrow(
      expect.objectContaining({
        code: "invalid_policy_input",
        message: "Policy validation failed.",
      }),
    );
  });

  it.each([
    {
      application: "chatgpt",
      findings: [validFinding],
    },
    {
      application: "chatgpt",
      policy: validPolicy,
    },
    {
      application: "chatgpt",
      findings: [validFinding],
      policy: validPolicy,
      prompt: "do not inspect",
    },
    {
      application: "chatgpt",
      findings: [validFinding],
      policy: validPolicy,
      unknown: true,
    },
  ])("rejects missing or unknown top-level policy input fields %#", (input) => {
    expect(() => validatePolicyInput(input)).toThrow(
      expect.objectContaining({
        code: "invalid_policy_input",
      }),
    );
  });

  it("rejects low-confidence API-secret findings", () => {
    expect(() =>
      validatePolicyInput({
        application: "chatgpt",
        findings: [
          {
            id: createFindingId("api-secret", 0, 1),
            detectorId: "api-secret",
            category: "api_secret",
            confidence: "low",
          },
        ],
        policy: validPolicy,
      }),
    ).toThrow(
      expect.objectContaining({
        code: "invalid_policy_input",
      }),
    );
  });

  it("rejects decisions with extra fields or returned findings", () => {
    for (const extra of [
      { findings: [validFinding] },
      { prompt: "do not inspect" },
      { matchedText: "do not inspect" },
    ]) {
      expect(() =>
        validatePolicyDecision({
          action: "warn",
          matchedRuleIds: ["warn.email"],
          reasonCode: "policy_match",
          ...extra,
        }),
      ).toThrow(
        expect.objectContaining({
          code: "invalid_policy_decision",
        }),
      );
    }
  });
});
