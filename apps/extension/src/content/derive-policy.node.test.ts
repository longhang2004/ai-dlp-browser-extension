import {
  createDefaultProtectionSettings,
  type PolicyConfiguration,
} from "@ai-dlp/shared-types";
import { describe, expect, it } from "vitest";

import { derivePolicy } from "./derive-policy.js";

const expectedDefaults: PolicyConfiguration = {
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

describe("derivePolicy", () => {
  it("derives the exact approved defaults from validated settings", () => {
    expect(derivePolicy(createDefaultProtectionSettings())).toEqual(
      expectedDefaults,
    );
  });

  it("uses only email and phone settings while preserving strict categories", () => {
    const settings = createDefaultProtectionSettings();
    settings.protectionEnabled = false;
    settings.emailAction = "allow";
    settings.phoneAction = "redact";
    settings.protectedKeywords = ["internal"];
    settings.auditRetentionLimit = 999;

    expect(derivePolicy(settings)).toEqual({
      ...expectedDefaults,
      categoryActions: {
        ...expectedDefaults.categoryActions,
        email: "allow",
        phone: "redact",
      },
    });
  });

  it.each([
    { ...createDefaultProtectionSettings(), emailAction: "monitor" },
    { ...createDefaultProtectionSettings(), unknown: "block" },
    {
      ...createDefaultProtectionSettings(),
      protectedKeywords: ["duplicate", "DUPLICATE"],
    },
  ])(
    "rejects invalid or unknown settings %# with a content-free error",
    (settings) => {
      expect(() => derivePolicy(settings)).toThrow(
        expect.objectContaining({
          name: "PolicyDerivationError",
          message: "Policy derivation failed.",
        }),
      );
    },
  );
});
