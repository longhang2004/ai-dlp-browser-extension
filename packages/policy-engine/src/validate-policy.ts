import {
  createPolicyDecision,
  createPolicyInput,
  isPolicyDecision,
  isPolicyInput,
  type PolicyConfiguration,
  type PolicyDecision,
  type PolicyInput,
} from "@ai-dlp/shared-types";

export const POLICY_VALIDATION_ERROR_CODES = Object.freeze([
  "invalid_policy_configuration",
  "invalid_policy_input",
  "invalid_policy_decision",
] as const);

export type PolicyValidationErrorCode =
  (typeof POLICY_VALIDATION_ERROR_CODES)[number];

export class PolicyValidationError extends Error {
  override readonly name = "PolicyValidationError";
  readonly code: PolicyValidationErrorCode;

  constructor(code: PolicyValidationErrorCode) {
    super("Policy validation failed.");
    this.code = code;
  }
}

export function validatePolicyConfiguration(
  value: unknown,
): PolicyConfiguration {
  const candidate = {
    surfaceId: "chatgpt_web",
    attachmentPresent: false,
    findings: [],
    policy: value,
  };

  if (!isPolicyInput(candidate)) {
    throw new PolicyValidationError("invalid_policy_configuration");
  }

  return createPolicyInput(candidate).policy;
}

export function validatePolicyInput(value: unknown): PolicyInput {
  if (!isPolicyInput(value)) {
    throw new PolicyValidationError("invalid_policy_input");
  }

  return createPolicyInput(value);
}

export function validatePolicyDecision(value: unknown): PolicyDecision {
  if (!isPolicyDecision(value)) {
    throw new PolicyValidationError("invalid_policy_decision");
  }

  return createPolicyDecision(value);
}
