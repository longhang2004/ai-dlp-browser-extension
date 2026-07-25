import {
  cloneProtectionSettings,
  isProtectionSettings,
  type PolicyConfiguration,
} from "@ai-dlp/shared-types";
import { validatePolicyConfiguration } from "@ai-dlp/policy-engine";

export class PolicyDerivationError extends Error {
  override readonly name = "PolicyDerivationError";

  constructor() {
    super("Policy derivation failed.");
  }
}

export function derivePolicy(value: unknown): PolicyConfiguration {
  if (!isProtectionSettings(value)) {
    throw new PolicyDerivationError();
  }

  const settings = cloneProtectionSettings(value);
  return validatePolicyConfiguration({
    schemaVersion: 1,
    categoryActions: {
      email: settings.emailAction,
      phone: settings.phoneAction,
      payment_card: "block",
      aws_access_key: "block",
      private_key: "block",
      protected_keyword: "warn",
    },
    apiSecretActions: {
      high: "block",
      medium: "warn",
    },
  });
}
