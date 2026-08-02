import { describe, expect, it } from "vitest";

import * as sharedTypes from "./index.js";
import {
  ADAPTER_CAPABILITY_KEYS,
  ADAPTER_IDS,
  ADAPTER_TRUST_LEVELS,
  ADAPTER_HEALTH_CODES,
  AI_SURFACE_IDS,
  CAPABILITY_SUPPORT_LEVELS,
  CHATGPT_ADAPTER_VERSION,
  cloneProtectionSettings,
  createAuditEventId,
  createAuditTimestamp,
  createDefaultProtectionSettings,
  createDisplayFinding,
  createFindingId,
  createMaskedPreview,
  createPolicyDecision,
  createPolicyFinding,
  createPolicyInput,
  createProtectionDialogModel,
  DECISION_RESOLUTIONS,
  DEFAULT_PROTECTION_SETTINGS,
  DETECTOR_CATEGORY,
  DETECTOR_IDS,
  ENFORCEMENT_ERROR_CODES,
  FINDING_CONFIDENCES,
  isAdapterHealthAuditEvent,
  isAdapterDescriptorClaim,
  isAdapterId,
  isAiSurfaceId,
  isAuditEvent,
  isAuditEventId,
  isAuditTimestamp,
  isContentStatusPortMessage,
  isContentHandshakePortMessage,
  isDecisionAuditEvent,
  isDisplayFinding,
  isEnforcementErrorAuditEvent,
  isFindingId,
  isMaskedPreview,
  isPolicyConfiguration,
  isPolicyDecision,
  isPolicyFinding,
  isPolicyInput,
  isProtectionSettings,
  isProtectionDialogModel,
  isProtectionDialogRequest,
  isProtectionErrorDialogModel,
  isProtectionStatusSnapshot,
  isRuntimeRequest,
  isRuntimeResponse,
  isSettingsPortMessage,
  isSettingsValidationError,
  isStoredAuditEnvelope,
  isStoredSettingsEnvelope,
  POLICY_ACTIONS,
  PROTECTION_STATUSES,
  RUNTIME_ERROR_CODES,
  SENSITIVE_DATA_CATEGORIES,
  SENSITIVE_DATA_PLACEHOLDERS,
  SETTINGS_VALIDATION_ERROR_CODES,
  SETTINGS_VALIDATION_FIELDS,
  type AuditEvent,
  type AdapterDescriptor,
  type DetectorId,
  type DisplayFinding,
  type PolicyConfiguration,
  type PolicyDecision,
  type PolicyFinding,
  type PolicyInput,
  type ProtectionDialogModel,
  type ProtectionDialogModelInput,
  type RuntimeRequest,
  type SensitiveDataCategory,
  type SensitiveDataFinding,
  type SensitiveDataPlaceholder,
  type StoredAuditEnvelope,
  type StoredSettingsEnvelope,
} from "./index.js";

const validChatGptDescriptorInput = {
  adapterId: "chatgpt",
  surfaceId: "chatgpt_web",
  version: CHATGPT_ADAPTER_VERSION,
  trust: "verified",
  origins: ["https://chatgpt.com"],
  capabilities: {
    submissionDetection: "verified",
    promptRead: "verified",
    attachmentDetection: "verified",
    attachmentInspection: "unsupported",
    promptReplacement: "unsupported",
    submissionResume: "verified",
  },
  entryPoint: "content-script.js",
} satisfies AdapterDescriptor;

const validSettingsEnvelope: StoredSettingsEnvelope = {
  schemaVersion: 3,
  settings: createDefaultProtectionSettings(),
};

const validDecisionEvent: AuditEvent = {
  kind: "decision",
  id: createAuditEventId("00000000-0000-4000-8000-000000000001"),
  timestamp: createAuditTimestamp("2026-07-26T12:00:00.000Z"),
  adapterId: "chatgpt",
  surfaceId: "chatgpt_web",
  policyAction: "warn",
  resolution: "cancelled",
  detectorCategories: ["email"],
  matchedRuleIds: ["warn.email"],
  findingCount: 1,
  reasonCode: "policy_match",
  attachmentPresent: false,
  maskedExcerpt: createMaskedPreview(["[EMAIL]"]),
  adapterVersion: CHATGPT_ADAPTER_VERSION,
};

const validPolicy: PolicyConfiguration = {
  schemaVersion: 2,
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
  attachmentAction: "warn",
};

const validPolicyFinding: PolicyFinding = {
  id: createFindingId("email", 0, 16),
  detectorId: "email",
  category: "email",
  confidence: "high",
};

const validPolicyDecision: PolicyDecision = {
  action: "warn",
  matchedRuleIds: ["warn.email"],
  contributingCategories: ["email"],
  reasonCode: "policy_match",
  attachmentPresent: false,
};

const validDisplayFinding: DisplayFinding = createDisplayFinding(
  "email",
  "high",
);

const validDialogInput: ProtectionDialogModelInput = {
  kind: "warn",
  findings: [validDisplayFinding],
  reasonCode: "policy_match",
  attachmentPresent: false,
  canRedact: true,
};

const validDialog: ProtectionDialogModel =
  createProtectionDialogModel(validDialogInput);

const validAuditEnvelope: StoredAuditEnvelope = {
  schemaVersion: 4,
  events: [validDecisionEvent],
};

function createHostileArrayVariants<Item>(
  items: readonly Item[],
  oversizedLength: number,
): unknown[] {
  const sparse = new Array<Item>(Math.max(1, items.length));

  const hiddenExtra = [...items];
  Object.defineProperty(hiddenExtra, "prompt", {
    value: "secret",
    enumerable: false,
  });

  const symbolExtra = [...items] as unknown as Record<PropertyKey, unknown>;
  symbolExtra[Symbol("prompt")] = "secret";

  const throwingGetter = [...items];
  Object.defineProperty(throwingGetter, 0, {
    get() {
      throw new Error("must be contained");
    },
  });

  const oversized = new Array<Item>(oversizedLength);

  return [sparse, hiddenExtra, symbolExtra, throwingGetter, oversized];
}

describe("frozen schema allowlists", () => {
  it("freezes every exported tuple and object allowlist", () => {
    const allowlists = [
      ADAPTER_HEALTH_CODES,
      DETECTOR_CATEGORY,
      DETECTOR_IDS,
      DECISION_RESOLUTIONS,
      ENFORCEMENT_ERROR_CODES,
      FINDING_CONFIDENCES,
      POLICY_ACTIONS,
      PROTECTION_STATUSES,
      RUNTIME_ERROR_CODES,
      SENSITIVE_DATA_CATEGORIES,
      SENSITIVE_DATA_PLACEHOLDERS,
      SETTINGS_VALIDATION_ERROR_CODES,
      SETTINGS_VALIDATION_FIELDS,
    ];

    expect(allowlists.every(Object.isFrozen)).toBe(true);
    expect(Reflect.set(POLICY_ACTIONS, "0", "steal")).toBe(false);
    expect(POLICY_ACTIONS[0]).toBe("allow");
    expect(
      isPolicyDecision({
        ...validPolicyDecision,
        action: "steal",
        reasonCode: "policy.steal",
      }),
    ).toBe(false);
  });

  it("keeps a frozen one-to-one detector/category mapping with complete coverage", () => {
    expect(DETECTOR_IDS).toEqual(Object.keys(DETECTOR_CATEGORY));
    expect(Object.values(DETECTOR_CATEGORY)).toEqual(SENSITIVE_DATA_CATEGORIES);
    expect(new Set(Object.values(DETECTOR_CATEGORY)).size).toBe(
      SENSITIVE_DATA_CATEGORIES.length,
    );
  });
});

describe("closed adapter descriptor boundaries", () => {
  it("exports frozen closed identity and capability allowlists", () => {
    expect(AI_SURFACE_IDS).toEqual([
      "chatgpt_web",
      "claude_web",
      "gemini_web",
      "perplexity_web",
      "deepseek_web",
      "copilot_web",
    ]);
    expect(ADAPTER_IDS).toEqual(["chatgpt", "claude"]);
    expect(ADAPTER_TRUST_LEVELS).toEqual([
      "verified",
      "discovered",
      "unsupported",
    ]);
    expect(CAPABILITY_SUPPORT_LEVELS).toEqual([
      "verified",
      "unsupported",
      "not_applicable",
    ]);
    expect(ADAPTER_CAPABILITY_KEYS).toEqual([
      "submissionDetection",
      "promptRead",
      "attachmentDetection",
      "attachmentInspection",
      "promptReplacement",
      "submissionResume",
    ]);
    expect(
      [
        AI_SURFACE_IDS,
        ADAPTER_IDS,
        ADAPTER_TRUST_LEVELS,
        CAPABILITY_SUPPORT_LEVELS,
        ADAPTER_CAPABILITY_KEYS,
      ].every(Object.isFrozen),
    ).toBe(true);
    expect(isAiSurfaceId("chatgpt_web")).toBe(true);
    expect(isAiSurfaceId("unknown_web")).toBe(false);
    expect(isAdapterId("claude")).toBe(true);
    expect(isAdapterId("unknown")).toBe(false);
  });

  it("does not export standalone descriptor authorization or factory APIs", () => {
    expect(sharedTypes).not.toHaveProperty("isAdapterDescriptor");
    expect(sharedTypes).not.toHaveProperty("createAdapterDescriptor");
  });

  it("accepts only a structurally valid claim matching the trusted descriptor", () => {
    expect(
      isAdapterDescriptorClaim(
        validChatGptDescriptorInput,
        validChatGptDescriptorInput,
      ),
    ).toBe(true);

    const invalidClaims = [
      { ...validChatGptDescriptorInput, adapterId: "unknown" },
      { ...validChatGptDescriptorInput, surfaceId: "unknown_web" },
      { ...validChatGptDescriptorInput, surfaceId: "claude_web" },
      { ...validChatGptDescriptorInput, origins: ["https://claude.ai"] },
      {
        ...validChatGptDescriptorInput,
        origins: ["https://chatgpt.com", "https://chatgpt.com"],
      },
      { ...validChatGptDescriptorInput, origins: ["https://chatgpt.com/"] },
      { ...validChatGptDescriptorInput, version: "" },
      { ...validChatGptDescriptorInput, entryPoint: "../content-script.js" },
      { ...validChatGptDescriptorInput, metadata: {} },
      { ...validChatGptDescriptorInput, prompt: "secret" },
      {
        ...validChatGptDescriptorInput,
        capabilities: {
          ...validChatGptDescriptorInput.capabilities,
          promptRead: "unknown",
        },
      },
      {
        ...validChatGptDescriptorInput,
        capabilities: {
          ...validChatGptDescriptorInput.capabilities,
          metadata: {},
        },
      },
      {
        ...validChatGptDescriptorInput,
        capabilities: {
          ...validChatGptDescriptorInput.capabilities,
          prompt: "secret",
        },
      },
      {
        ...validChatGptDescriptorInput,
        trust: "unsupported",
      },
    ];

    for (const claim of invalidClaims) {
      expect(isAdapterDescriptorClaim(validChatGptDescriptorInput, claim)).toBe(
        false,
      );
    }
  });

  it("rejects runtime identity, trust, capability, origin, and version upgrades", () => {
    for (const claim of [
      { ...validChatGptDescriptorInput, adapterId: "claude" },
      { ...validChatGptDescriptorInput, surfaceId: "claude_web" },
      { ...validChatGptDescriptorInput, version: "999" },
      { ...validChatGptDescriptorInput, trust: "discovered" },
      { ...validChatGptDescriptorInput, origins: ["https://claude.ai"] },
      {
        ...validChatGptDescriptorInput,
        capabilities: {
          ...validChatGptDescriptorInput.capabilities,
          attachmentInspection: "verified",
        },
      },
      {
        ...validChatGptDescriptorInput,
        capabilities: {
          ...validChatGptDescriptorInput.capabilities,
          promptReplacement: "verified",
        },
      },
      {
        ...validChatGptDescriptorInput,
        entryPoint: "claude-content-script.js",
      },
    ]) {
      expect(isAdapterDescriptorClaim(validChatGptDescriptorInput, claim)).toBe(
        false,
      );
    }

    expect(
      isAdapterDescriptorClaim(
        validChatGptDescriptorInput,
        validChatGptDescriptorInput,
      ),
    ).toBe(true);
  });

  it("reserves Claude scalar identifiers without authorizing a Claude descriptor", () => {
    const untrustedClaudeClaim = {
      ...validChatGptDescriptorInput,
      adapterId: "claude",
      surfaceId: "claude_web",
      origins: ["https://claude.ai"],
      entryPoint: "claude-content-script.js",
    };

    expect(isAdapterId(untrustedClaudeClaim.adapterId)).toBe(true);
    expect(isAiSurfaceId(untrustedClaudeClaim.surfaceId)).toBe(true);
    expect(
      isAdapterDescriptorClaim(
        validChatGptDescriptorInput,
        untrustedClaudeClaim,
      ),
    ).toBe(false);
  });

  it("validates only an exact content handshake correlated to its trusted descriptor", () => {
    expect(
      isContentHandshakePortMessage(validChatGptDescriptorInput, {
        type: "content.handshake",
        descriptor: {
          ...validChatGptDescriptorInput,
          origins: [...validChatGptDescriptorInput.origins],
          capabilities: { ...validChatGptDescriptorInput.capabilities },
        },
      }),
    ).toBe(true);

    for (const message of [
      {
        type: "content.handshake",
        descriptor: {
          ...validChatGptDescriptorInput,
          adapterId: "claude",
        },
      },
      {
        type: "content.handshake",
        descriptor: validChatGptDescriptorInput,
        metadata: {},
      },
      {
        type: "content.handshake",
        descriptor: {
          ...validChatGptDescriptorInput,
          capabilities: {
            ...validChatGptDescriptorInput.capabilities,
            submissionResume: "unsupported",
          },
        },
      },
      {
        type: "content.handshake",
        descriptor: {
          ...validChatGptDescriptorInput,
          capabilities: {
            ...validChatGptDescriptorInput.capabilities,
            promptReplacement: "verified",
          },
        },
      },
      {
        type: "content.handshake",
        descriptor: {
          ...validChatGptDescriptorInput,
          entryPoint: "other-content.js",
        },
      },
    ]) {
      expect(
        isContentHandshakePortMessage(validChatGptDescriptorInput, message),
      ).toBe(false);
    }
  });
});

describe("policy runtime boundaries", () => {
  it("accepts exact fixed metadata and decisions", () => {
    expect(isPolicyFinding(validPolicyFinding)).toBe(true);
    expect(isPolicyConfiguration(validPolicy)).toBe(true);
    expect(
      isPolicyInput({
        surfaceId: "chatgpt_web",
        attachmentPresent: false,
        findings: [validPolicyFinding],
        policy: validPolicy,
      }),
    ).toBe(true);
    expect(isPolicyDecision(validPolicyDecision)).toBe(true);
    expect(createPolicyFinding(validPolicyFinding)).toEqual(validPolicyFinding);
    expect(
      createPolicyInput({
        surfaceId: "chatgpt_web",
        attachmentPresent: false,
        findings: [validPolicyFinding],
        policy: validPolicy,
      }),
    ).toEqual({
      surfaceId: "chatgpt_web",
      attachmentPresent: false,
      findings: [validPolicyFinding],
      policy: validPolicy,
    });
    expect(createPolicyDecision(validPolicyDecision)).toEqual(
      validPolicyDecision,
    );
  });

  it("accepts every closed surface ID without application-specific policy exceptions", () => {
    for (const surfaceId of AI_SURFACE_IDS) {
      expect(
        isPolicyInput({
          surfaceId,
          attachmentPresent: false,
          findings: [validPolicyFinding],
          policy: validPolicy,
        }),
      ).toBe(true);
    }
  });

  it.each([
    { ...validPolicyFinding, prompt: "secret" },
    { ...validPolicyFinding, renamedSecret: "secret" },
    { ...validPolicyFinding, id: "secret" },
    { ...validPolicyFinding, id: "finding-secret" },
    { ...validPolicyFinding, id: "email:0:16" },
    { ...validPolicyFinding, start: 0 },
    { ...validPolicyFinding, end: 16 },
    { ...validPolicyFinding, offsets: [0, 16] },
    { ...validPolicyFinding, sanitizedPrompt: "[EMAIL]" },
    { ...validPolicyFinding, detectorId: "Secret Value" },
    { ...validPolicyFinding, confidence: "low", category: "api_secret" },
  ])("rejects unsafe or malformed policy finding %#", (candidate) => {
    expect(isPolicyFinding(candidate)).toBe(false);
  });

  it("accepts all seven canonical detector/category pairs and rejects every mismatch", () => {
    const categories = Object.values(DETECTOR_CATEGORY);

    for (const detectorId of DETECTOR_IDS) {
      const category = DETECTOR_CATEGORY[detectorId];
      const valid = {
        id: createFindingId(detectorId, 5, 21),
        detectorId,
        category,
        confidence: "high",
      };
      const mismatchedCategory =
        categories[(categories.indexOf(category) + 1) % categories.length];

      expect(isPolicyFinding(valid)).toBe(true);
      expect(
        isPolicyFinding({
          ...valid,
          category: mismatchedCategory,
        }),
      ).toBe(false);
      expect(() =>
        createPolicyFinding({
          ...valid,
          category: mismatchedCategory,
        } as PolicyFinding),
      ).toThrow("Invalid policy finding.");
    }

    expect(
      isPolicyFinding({
        ...validPolicyFinding,
        detectorId: "custom-detector",
      }),
    ).toBe(false);
    expect(
      isPolicyFinding({
        ...validPolicyFinding,
        detectorId: "email:0:16",
      }),
    ).toBe(false);
  });

  it("creates deterministic opaque IDs only from detector and range", () => {
    const id = createFindingId("email", 0, 16);

    expect(isFindingId(id)).toBe(true);
    expect(id).toBe(createFindingId("email", 0, 16));
    expect(id).not.toBe(createFindingId("email", 1, 16));
    expect(id).not.toBe(createFindingId("phone", 0, 16));
    expect(id).toMatch(/^finding-[0-9a-f]{16}$/u);
    expect(id).not.toContain("email");
    expect(id).not.toContain(":0:16");
    expect(() => createFindingId("email", -1, 16)).toThrow(
      "Invalid finding identifier source.",
    );
    expect(() => createFindingId("email", 16, 16)).toThrow(
      "Invalid finding identifier source.",
    );
  });

  it("copies the exact four policy fields unchanged from a sensitive finding", () => {
    const sensitiveFinding: SensitiveDataFinding = {
      id: createFindingId("email", 3, 19),
      detectorId: "email",
      category: "email",
      confidence: "high",
      start: 3,
      end: 19,
      matchedText: "email@example.test",
      redactedText: "[EMAIL]",
    };
    const policyFinding: PolicyFinding = {
      id: sensitiveFinding.id,
      detectorId: sensitiveFinding.detectorId,
      category: sensitiveFinding.category,
      confidence: sensitiveFinding.confidence,
    };

    expect(isPolicyFinding(policyFinding)).toBe(true);
    expect(Object.keys(policyFinding)).toEqual([
      "id",
      "detectorId",
      "category",
      "confidence",
    ]);
    expect(policyFinding).toEqual({
      id: sensitiveFinding.id,
      detectorId: sensitiveFinding.detectorId,
      category: sensitiveFinding.category,
      confidence: sensitiveFinding.confidence,
    });
    const serialized = JSON.parse(JSON.stringify(policyFinding)) as Record<
      string,
      unknown
    >;
    expect(Object.keys(serialized)).toEqual([
      "id",
      "detectorId",
      "category",
      "confidence",
    ]);
    expect(
      Object.values(serialized).every((value) => typeof value === "string"),
    ).toBe(true);
  });

  it("rejects unknown policy input/decision fields and open strings", () => {
    expect(
      isPolicyInput({
        application: "chatgpt",
        attachmentPresent: false,
        findings: [validPolicyFinding],
        policy: validPolicy,
      }),
    ).toBe(false);
    expect(
      isPolicyInput({
        surfaceId: "chatgpt_web",
        attachmentPresent: false,
        findings: [validPolicyFinding],
        policy: validPolicy,
        renamedSecret: "secret",
      }),
    ).toBe(false);
    expect(
      isPolicyInput({
        surfaceId: "chatgpt_web",
        attachmentPresent: false,
        findings: [validPolicyFinding],
        policy: validPolicy,
        offsets: [0, 16],
      }),
    ).toBe(false);
    expect(
      isPolicyInput({
        surfaceId: "chatgpt_web",
        attachmentPresent: false,
        findings: [validPolicyFinding],
        policy: validPolicy,
        sanitizedPrompt: "[EMAIL]",
      }),
    ).toBe(false);
    expect(
      isPolicyDecision({
        ...validPolicyDecision,
        reasonCode: "secret",
      }),
    ).toBe(false);
    expect(
      isPolicyDecision({
        ...validPolicyDecision,
        matchedRuleIds: ["secret"],
      }),
    ).toBe(false);
    expect(
      isPolicyDecision({
        ...validPolicyDecision,
        matchedRuleIds: ["warn.email", "block.private-key"],
      }),
    ).toBe(false);
    expect(
      isPolicyDecision({
        ...validPolicyDecision,
        offsets: [0, 16],
      }),
    ).toBe(false);
    expect(
      isPolicyDecision({
        ...validPolicyDecision,
        sanitizedPrompt: "[EMAIL]",
      }),
    ).toBe(false);
  });

  it.each([
    {
      ...validPolicy,
      categoryActions: {
        ...validPolicy.categoryActions,
        payment_card: "warn",
      },
    },
    {
      ...validPolicy,
      categoryActions: {
        ...validPolicy.categoryActions,
        aws_access_key: "warn",
      },
    },
    {
      ...validPolicy,
      categoryActions: {
        ...validPolicy.categoryActions,
        private_key: "warn",
      },
    },
    {
      ...validPolicy,
      categoryActions: {
        ...validPolicy.categoryActions,
        protected_keyword: "allow",
      },
    },
    {
      ...validPolicy,
      apiSecretActions: {
        ...validPolicy.apiSecretActions,
        high: "warn",
      },
    },
    {
      ...validPolicy,
      apiSecretActions: {
        ...validPolicy.apiSecretActions,
        medium: "allow",
      },
    },
    {
      schemaVersion: 1,
      categoryActions: {
        email: "warn",
        phone: "warn",
        payment_card: "block",
        aws_access_key: "block",
        private_key: "block",
      },
      apiSecretActions: validPolicy.apiSecretActions,
    },
    {
      ...validPolicy,
      categoryActions: {
        ...validPolicy.categoryActions,
        unknown_category: "block",
      },
    },
    {
      ...validPolicy,
      apiSecretActions: {
        ...validPolicy.apiSecretActions,
        low: "allow",
      },
    },
  ])(
    "rejects weakened, incomplete, or unknown fixed policy data %#",
    (policy) => {
      expect(isPolicyConfiguration(policy)).toBe(false);
    },
  );

  it("rejects invalid configurable contact actions", () => {
    for (const field of ["email", "phone"] as const) {
      expect(
        isPolicyConfiguration({
          ...validPolicy,
          categoryActions: {
            ...validPolicy.categoryActions,
            [field]: "invalid",
          },
        }),
      ).toBe(false);
    }
  });

  it("rejects every missing or unknown policy key and version", () => {
    for (const rootField of [
      "schemaVersion",
      "categoryActions",
      "apiSecretActions",
      "attachmentAction",
    ] as const) {
      expect(
        isPolicyConfiguration(
          Object.fromEntries(
            Object.entries(validPolicy).filter(([key]) => key !== rootField),
          ),
        ),
      ).toBe(false);
    }

    expect(isPolicyConfiguration({ ...validPolicy, schemaVersion: 1 })).toBe(
      false,
    );
    expect(isPolicyConfiguration({ ...validPolicy, unknownRoot: true })).toBe(
      false,
    );

    for (const category of [
      "email",
      "phone",
      "payment_card",
      "aws_access_key",
      "private_key",
      "protected_keyword",
    ] as const) {
      expect(
        isPolicyConfiguration({
          ...validPolicy,
          categoryActions: Object.fromEntries(
            Object.entries(validPolicy.categoryActions).filter(
              ([key]) => key !== category,
            ),
          ),
        }),
      ).toBe(false);
    }

    expect(
      isPolicyConfiguration({
        ...validPolicy,
        categoryActions: {
          ...validPolicy.categoryActions,
          unknown_category: "block",
        },
      }),
    ).toBe(false);

    for (const confidence of ["high", "medium"] as const) {
      expect(
        isPolicyConfiguration({
          ...validPolicy,
          apiSecretActions: Object.fromEntries(
            Object.entries(validPolicy.apiSecretActions).filter(
              ([key]) => key !== confidence,
            ),
          ),
        }),
      ).toBe(false);
    }

    for (const confidence of ["low", "critical"] as const) {
      expect(
        isPolicyConfiguration({
          ...validPolicy,
          apiSecretActions: {
            ...validPolicy.apiSecretActions,
            [confidence]: "allow",
          },
        }),
      ).toBe(false);
    }
  });

  it("rejects every non-fixed action for strict policy entries", () => {
    for (const category of [
      "payment_card",
      "aws_access_key",
      "private_key",
    ] as const) {
      for (const action of ["allow", "warn", "redact"] as const) {
        expect(
          isPolicyConfiguration({
            ...validPolicy,
            categoryActions: {
              ...validPolicy.categoryActions,
              [category]: action,
            },
          }),
        ).toBe(false);
      }
    }

    for (const action of ["allow", "redact", "block"] as const) {
      expect(
        isPolicyConfiguration({
          ...validPolicy,
          categoryActions: {
            ...validPolicy.categoryActions,
            protected_keyword: action,
          },
        }),
      ).toBe(false);
    }

    for (const action of ["allow", "warn", "redact"] as const) {
      expect(
        isPolicyConfiguration({
          ...validPolicy,
          apiSecretActions: {
            ...validPolicy.apiSecretActions,
            high: action,
          },
        }),
      ).toBe(false);
    }

    for (const action of ["allow", "redact", "block"] as const) {
      expect(
        isPolicyConfiguration({
          ...validPolicy,
          apiSecretActions: {
            ...validPolicy.apiSecretActions,
            medium: action,
          },
        }),
      ).toBe(false);
    }
  });

  it("rejects prompt aliases at every policy configuration depth", () => {
    expect(isPolicyConfiguration({ ...validPolicy, prompt: "secret" })).toBe(
      false,
    );
    expect(
      isPolicyConfiguration({
        ...validPolicy,
        categoryActions: {
          ...validPolicy.categoryActions,
          rawPrompt: "secret",
        },
      }),
    ).toBe(false);
    expect(
      isPolicyConfiguration({
        ...validPolicy,
        apiSecretActions: {
          ...validPolicy.apiSecretActions,
          sanitizedPrompt: "[EMAIL]",
        },
      }),
    ).toBe(false);
    expect(
      isPolicyInput({
        application: "chatgpt",
        findings: [validPolicyFinding],
        policy: {
          ...validPolicy,
          categoryActions: {
            ...validPolicy.categoryActions,
            rawPrompt: "secret",
          },
        },
      }),
    ).toBe(false);
  });

  it("enforces allow and non-allow decision coherence", () => {
    expect(
      isPolicyDecision({
        action: "allow",
        matchedRuleIds: ["allow.no-findings"],
        contributingCategories: [],
        reasonCode: "no_findings",
        attachmentPresent: false,
      }),
    ).toBe(true);
    expect(
      isPolicyDecision({
        action: "allow",
        matchedRuleIds: [],
        contributingCategories: [],
        reasonCode: "no_findings",
        attachmentPresent: false,
      }),
    ).toBe(false);
    expect(
      isPolicyDecision({
        action: "allow",
        matchedRuleIds: ["warn.email"],
        contributingCategories: ["email"],
        reasonCode: "no_findings",
        attachmentPresent: false,
      }),
    ).toBe(false);
    expect(
      isPolicyDecision({
        action: "allow",
        matchedRuleIds: ["allow.no-findings"],
        contributingCategories: [],
        reasonCode: "policy_match",
        attachmentPresent: false,
      }),
    ).toBe(false);
    expect(
      isPolicyDecision({
        action: "warn",
        matchedRuleIds: [],
        contributingCategories: [],
        reasonCode: "policy_match",
        attachmentPresent: false,
      }),
    ).toBe(false);
    expect(
      isPolicyDecision({
        action: "warn",
        matchedRuleIds: ["block.private-key"],
        contributingCategories: ["private_key"],
        reasonCode: "policy_match",
        attachmentPresent: false,
      }),
    ).toBe(false);
    expect(
      isPolicyDecision({
        action: "block",
        matchedRuleIds: ["block.private-key", "warn.email"],
        contributingCategories: ["private_key", "email"],
        reasonCode: "policy_match",
        attachmentPresent: false,
      }),
    ).toBe(true);
    expect(
      isPolicyDecision({
        action: "block",
        matchedRuleIds: ["warn.email", "block.private-key"],
        contributingCategories: ["email", "private_key"],
        reasonCode: "policy_match",
        attachmentPresent: false,
      }),
    ).toBe(false);
    expect(
      isPolicyDecision({
        action: "redact",
        matchedRuleIds: ["block.private-key"],
        contributingCategories: ["private_key"],
        reasonCode: "policy_match",
        attachmentPresent: false,
      }),
    ).toBe(false);
    expect(
      isPolicyDecision({
        action: "redact",
        matchedRuleIds: ["warn.email"],
        contributingCategories: ["email"],
        reasonCode: "policy_match",
        attachmentPresent: false,
      }),
    ).toBe(true);
    expect(
      isPolicyDecision({
        action: "allow",
        matchedRuleIds: ["warn.email"],
        contributingCategories: ["email"],
        reasonCode: "policy_match",
        attachmentPresent: false,
      }),
    ).toBe(true);
    expect(
      isPolicyDecision({
        action: "allow",
        matchedRuleIds: ["warn.email", "warn.phone"],
        contributingCategories: ["email", "phone"],
        reasonCode: "policy_match",
        attachmentPresent: false,
      }),
    ).toBe(true);
    expect(
      isPolicyDecision({
        action: "allow",
        matchedRuleIds: ["warn.email", "warn.protected-keyword"],
        contributingCategories: ["email", "protected_keyword"],
        reasonCode: "policy_match",
        attachmentPresent: false,
      }),
    ).toBe(false);
    expect(
      isPolicyDecision({
        action: "warn",
        matchedRuleIds: ["warn.email", "warn.phone"],
        contributingCategories: ["email", "phone"],
        reasonCode: "policy_match",
        attachmentPresent: false,
      }),
    ).toBe(true);
    expect(
      isPolicyDecision({
        action: "block",
        matchedRuleIds: ["warn.email"],
        contributingCategories: ["email"],
        reasonCode: "policy_match",
        attachmentPresent: false,
      }),
    ).toBe(true);
    expect(
      isPolicyDecision({
        action: "block",
        matchedRuleIds: ["warn.api-secret.medium"],
        contributingCategories: ["api_secret"],
        reasonCode: "policy_match",
        attachmentPresent: false,
      }),
    ).toBe(false);
  });

  it("requires contributor-only rules and correlated contributing categories", () => {
    const contributorDecision = {
      action: "warn",
      matchedRuleIds: ["warn.phone"],
      contributingCategories: ["phone"],
      reasonCode: "policy_match",
      attachmentPresent: false,
    };

    expect(isPolicyDecision(contributorDecision)).toBe(true);
    expect(
      isPolicyDecision({
        ...contributorDecision,
        matchedRuleIds: ["warn.email", "warn.phone"],
      }),
    ).toBe(false);
    expect(
      isPolicyDecision({
        ...contributorDecision,
        contributingCategories: ["email"],
      }),
    ).toBe(false);
  });

  it("uses dense exact arrays for policy findings and decision rules", () => {
    for (const findings of createHostileArrayVariants(
      [validPolicyFinding],
      700_001,
    )) {
      expect(
        isPolicyInput({
          application: "chatgpt",
          findings,
          policy: validPolicy,
        }),
      ).toBe(false);
    }

    for (const matchedRuleIds of createHostileArrayVariants(
      ["warn.email"],
      10,
    )) {
      expect(
        isPolicyDecision({
          ...validPolicyDecision,
          matchedRuleIds,
        }),
      ).toBe(false);
    }
  });
});

describe("sanitized display runtime boundaries", () => {
  it("constructs exact category-correlated display models", () => {
    expect(validDisplayFinding).toEqual({
      category: "email",
      confidence: "high",
      placeholder: "[EMAIL]",
    });
    expect(isDisplayFinding(validDisplayFinding)).toBe(true);
    expect(Object.keys(validDialog)).toEqual([
      "kind",
      "findings",
      "reasonCode",
      "attachmentPresent",
      "canRedact",
      "maskedPreview",
    ]);
    expect(validDialog.maskedPreview).toBe("… [EMAIL] …");
    expect(isProtectionDialogModel(validDialog)).toBe(true);
    expect(isProtectionDialogRequest(validDialog)).toBe(true);
    expect(
      isProtectionErrorDialogModel({
        kind: "error",
        errorCode: "prompt_too_large",
      }),
    ).toBe(true);
  });

  it("rejects prompt-bearing, mismatched, arbitrary, or renamed UI data", () => {
    expect(isDisplayFinding({ ...validDisplayFinding, prompt: "secret" })).toBe(
      false,
    );
    expect(
      isDisplayFinding({ ...validDisplayFinding, renamedSecret: "secret" }),
    ).toBe(false);
    expect(
      isDisplayFinding({ ...validDisplayFinding, placeholder: "[PHONE]" }),
    ).toBe(false);
    expect(
      isProtectionDialogModel({ ...validDialog, matchedText: "secret" }),
    ).toBe(false);
    expect(
      isProtectionDialogModel({ ...validDialog, reasonCode: "secret" }),
    ).toBe(false);
    expect(
      isProtectionDialogModel({
        ...validDialog,
        maskedPreview: createMaskedPreview(["[PHONE]"]),
      }),
    ).toBe(false);
    expect(
      isProtectionErrorDialogModel({
        kind: "error",
        errorCode: "secret",
      }),
    ).toBe(false);
  });

  it("uses dense exact arrays for dialog findings and previews", () => {
    for (const findings of createHostileArrayVariants(
      [validDisplayFinding],
      8,
    )) {
      expect(isProtectionDialogModel({ ...validDialog, findings })).toBe(false);
    }

    for (const placeholders of createHostileArrayVariants(["[EMAIL]"], 6)) {
      expect(() =>
        createMaskedPreview(
          placeholders as readonly SensitiveDataPlaceholder[],
        ),
      ).toThrow("Invalid masked preview placeholders.");
    }
  });

  it("derives a bounded placeholder-only preview from sanitized findings", () => {
    const dialog = createProtectionDialogModel({
      kind: "warn",
      findings: [
        createDisplayFinding("email", "high"),
        createDisplayFinding("phone", "medium"),
        createDisplayFinding("payment_card", "high"),
        createDisplayFinding("aws_access_key", "high"),
        createDisplayFinding("private_key", "high"),
        createDisplayFinding("protected_keyword", "medium"),
      ],
      reasonCode: "policy_match",
      attachmentPresent: false,
      canRedact: true,
    });

    expect(dialog.maskedPreview).toBe(
      "… [EMAIL] … [PHONE] … [PAYMENT_CARD] … [AWS_ACCESS_KEY] … [PRIVATE_KEY] …",
    );
  });
});

describe("settings validation", () => {
  it("accepts the exact supported settings envelope", () => {
    expect(isStoredSettingsEnvelope(validSettingsEnvelope)).toBe(true);
  });

  it.each([
    undefined,
    null,
    {},
    { schemaVersion: 2, settings: DEFAULT_PROTECTION_SETTINGS },
    { schemaVersion: 1 },
    { ...validSettingsEnvelope, prompt: "secret" },
    {
      schemaVersion: 1,
      settings: { ...DEFAULT_PROTECTION_SETTINGS, unexpected: true },
    },
    {
      schemaVersion: 1,
      settings: { ...DEFAULT_PROTECTION_SETTINGS, protectionEnabled: "yes" },
    },
    {
      schemaVersion: 1,
      settings: { ...DEFAULT_PROTECTION_SETTINGS, emailAction: "ignore" },
    },
    {
      schemaVersion: 1,
      settings: { ...DEFAULT_PROTECTION_SETTINGS, auditRetentionLimit: 0 },
    },
    {
      schemaVersion: 1,
      settings: { ...DEFAULT_PROTECTION_SETTINGS, auditRetentionLimit: 1001 },
    },
    {
      schemaVersion: 1,
      settings: {
        ...DEFAULT_PROTECTION_SETTINGS,
        protectedKeywords: [" spaced "],
      },
    },
    {
      schemaVersion: 1,
      settings: {
        ...DEFAULT_PROTECTION_SETTINGS,
        protectedKeywords: ["Alpha", "alpha"],
      },
    },
    {
      schemaVersion: 1,
      settings: {
        ...DEFAULT_PROTECTION_SETTINGS,
        protectedKeywords: ["Σ", "ς"],
      },
    },
    {
      schemaVersion: 1,
      settings: {
        ...DEFAULT_PROTECTION_SETTINGS,
        protectedKeywords: ["line\nbreak"],
      },
    },
    {
      schemaVersion: 1,
      settings: {
        ...DEFAULT_PROTECTION_SETTINGS,
        protectedKeywords: ["alpha\u200bbeta"],
      },
    },
    {
      schemaVersion: 1,
      settings: {
        ...DEFAULT_PROTECTION_SETTINGS,
        protectedKeywords: ["alpha\u2028beta"],
      },
    },
  ])("rejects malformed or unknown settings data %#", (candidate) => {
    expect(isStoredSettingsEnvelope(candidate)).toBe(false);
  });

  it("rejects matcher-equivalent Unicode keywords when cloning settings", () => {
    expect(() =>
      cloneProtectionSettings({
        ...DEFAULT_PROTECTION_SETTINGS,
        protectedKeywords: ["Σ", "ς"],
      }),
    ).toThrow("Invalid protection settings.");
  });

  it("rejects non-enumerable and symbol-keyed unknown fields", () => {
    const hiddenExtra = createDefaultProtectionSettings();
    Object.defineProperty(hiddenExtra, "prompt", {
      value: "secret",
      enumerable: false,
    });

    const symbolExtra = createDefaultProtectionSettings() as Record<
      PropertyKey,
      unknown
    >;
    symbolExtra[Symbol("prompt")] = "secret";

    expect(isProtectionSettings(hiddenExtra)).toBe(false);
    expect(isProtectionSettings(symbolExtra)).toBe(false);
  });

  it("keeps safe defaults deeply frozen and returns isolated mutable clones", () => {
    expect(Object.isFrozen(DEFAULT_PROTECTION_SETTINGS)).toBe(true);
    expect(Object.isFrozen(DEFAULT_PROTECTION_SETTINGS.protectedKeywords)).toBe(
      true,
    );
    expect(
      Reflect.set(DEFAULT_PROTECTION_SETTINGS, "protectionEnabled", false),
    ).toBe(false);
    expect(() =>
      (
        DEFAULT_PROTECTION_SETTINGS.protectedKeywords as unknown as string[]
      ).push("weaken"),
    ).toThrow(TypeError);

    const first = createDefaultProtectionSettings();
    first.protectionEnabled = false;
    first.protectedKeywords.push("local");
    const second = createDefaultProtectionSettings();

    expect(second).toEqual(DEFAULT_PROTECTION_SETTINGS);
    expect(DEFAULT_PROTECTION_SETTINGS.protectionEnabled).toBe(true);
    expect(DEFAULT_PROTECTION_SETTINGS.protectedKeywords).toEqual([]);
  });

  it("uses a dense exact keyword array", () => {
    for (const protectedKeywords of createHostileArrayVariants(
      ["alpha"],
      101,
    )) {
      expect(
        isProtectionSettings({
          ...createDefaultProtectionSettings(),
          protectedKeywords,
        }),
      ).toBe(false);
    }
  });
});

describe("sanitized preview construction", () => {
  it("brands only canonical placeholder-only previews", () => {
    const preview = createMaskedPreview(["[EMAIL]", "[PHONE]"]);

    expect(preview).toBe("… [EMAIL] … [PHONE] …");
    expect(isMaskedPreview(preview)).toBe(true);
    expect(isMaskedPreview("… email@example.test …")).toBe(false);
    expect(isMaskedPreview("[EMAIL]")).toBe(false);
  });

  it("rejects empty, oversized, and maliciously cast placeholder lists", () => {
    expect(() => createMaskedPreview([])).toThrow(
      "Invalid masked preview placeholders.",
    );
    expect(() =>
      createMaskedPreview([
        "[EMAIL]",
        "[PHONE]",
        "[PAYMENT_CARD]",
        "[AWS_ACCESS_KEY]",
        "[PRIVATE_KEY]",
        "[API_SECRET]",
      ]),
    ).toThrow("Invalid masked preview placeholders.");
    expect(() =>
      createMaskedPreview(["secret" as SensitiveDataPlaceholder]),
    ).toThrow("Invalid masked preview placeholders.");
  });
});

describe("audit validation", () => {
  it("derives warning bypass resolution from attachment contribution", () => {
    const promptWarningWithAllowedAttachment = {
      ...validDecisionEvent,
      resolution: "bypassed",
      attachmentPresent: true,
    };
    const attachmentWarning = {
      kind: "decision",
      id: createAuditEventId("00000000-0000-4000-8000-000000000006"),
      timestamp: createAuditTimestamp("2026-07-26T12:00:05.000Z"),
      adapterId: "chatgpt",
      surfaceId: "chatgpt_web",
      policyAction: "warn",
      resolution: "attachment_bypassed",
      detectorCategories: [],
      matchedRuleIds: ["attachment.unsupported"],
      findingCount: 0,
      reasonCode: "unsupported_attachment",
      attachmentPresent: true,
      adapterVersion: CHATGPT_ADAPTER_VERSION,
    };

    expect(isDecisionAuditEvent(promptWarningWithAllowedAttachment)).toBe(true);
    expect(
      isDecisionAuditEvent({
        ...promptWarningWithAllowedAttachment,
        resolution: "attachment_bypassed",
      }),
    ).toBe(false);
    expect(isDecisionAuditEvent(attachmentWarning)).toBe(true);
    expect(
      isDecisionAuditEvent({
        ...attachmentWarning,
        resolution: "bypassed",
      }),
    ).toBe(false);
  });

  it("accepts all supported event variants", () => {
    expect(isStoredAuditEnvelope(validAuditEnvelope)).toBe(true);
    expect(
      isStoredAuditEnvelope({
        schemaVersion: 4,
        events: [
          validDecisionEvent,
          {
            kind: "enforcement_error",
            id: "00000000-0000-4000-8000-000000000002",
            timestamp: "2026-07-26T12:00:01.000Z",
            adapterId: "chatgpt",
            surfaceId: "chatgpt_web",
            errorCode: "prompt_too_large",
            adapterVersion: "1",
          },
          {
            kind: "adapter_health",
            id: "00000000-0000-4000-8000-000000000003",
            timestamp: "2026-07-26T12:00:02.000Z",
            adapterId: "chatgpt",
            surfaceId: "chatgpt_web",
            status: "degraded",
            healthCode: "composer_not_found",
            adapterVersion: "1",
          },
        ],
      }),
    ).toBe(true);
  });

  it("enforces future allow-event and protected-event coherence", () => {
    const allowEvent = {
      kind: "decision",
      id: createAuditEventId("00000000-0000-4000-8000-000000000005"),
      timestamp: createAuditTimestamp("2026-07-26T12:00:04.000Z"),
      adapterId: "chatgpt",
      surfaceId: "chatgpt_web",
      policyAction: "allow",
      resolution: "submitted",
      detectorCategories: [],
      matchedRuleIds: ["allow.no-findings"],
      findingCount: 0,
      reasonCode: "no_findings",
      attachmentPresent: false,
      adapterVersion: CHATGPT_ADAPTER_VERSION,
    };

    expect(isDecisionAuditEvent(allowEvent)).toBe(true);
    expect(
      isDecisionAuditEvent({
        ...allowEvent,
        findingCount: 1,
        detectorCategories: ["email"],
        matchedRuleIds: ["warn.email"],
        reasonCode: "policy_match",
      }),
    ).toBe(true);
    expect(
      isDecisionAuditEvent({
        ...allowEvent,
        findingCount: 2,
        detectorCategories: ["email", "phone"],
        matchedRuleIds: ["warn.email", "warn.phone"],
        maskedExcerpt: createMaskedPreview(["[EMAIL]", "[PHONE]"]),
        reasonCode: "policy_match",
      }),
    ).toBe(true);
    expect(
      isDecisionAuditEvent({
        ...allowEvent,
        findingCount: 1,
        detectorCategories: ["phone"],
        matchedRuleIds: ["warn.email"],
      }),
    ).toBe(false);
    expect(
      isDecisionAuditEvent({
        ...allowEvent,
        maskedExcerpt: createMaskedPreview(["[EMAIL]"]),
      }),
    ).toBe(false);

    expect(
      isDecisionAuditEvent({
        ...validDecisionEvent,
        findingCount: 0,
      }),
    ).toBe(false);
    expect(
      isDecisionAuditEvent({
        ...validDecisionEvent,
        detectorCategories: [],
      }),
    ).toBe(false);
    expect(
      isDecisionAuditEvent({
        ...validDecisionEvent,
        matchedRuleIds: [],
      }),
    ).toBe(false);
    expect(
      isDecisionAuditEvent({
        ...validDecisionEvent,
        policyAction: "warn",
        resolution: "blocked",
      }),
    ).toBe(false);
    expect(
      isDecisionAuditEvent({
        ...validDecisionEvent,
        policyAction: "warn",
        matchedRuleIds: ["block.private-key"],
        detectorCategories: ["private_key"],
        maskedExcerpt: createMaskedPreview(["[PRIVATE_KEY]"]),
      }),
    ).toBe(false);
    expect(
      isDecisionAuditEvent({
        ...validDecisionEvent,
        policyAction: "redact",
        resolution: "redacted",
        matchedRuleIds: ["block.private-key"],
        detectorCategories: ["private_key"],
        maskedExcerpt: createMaskedPreview(["[PRIVATE_KEY]"]),
      }),
    ).toBe(false);
    expect(
      isDecisionAuditEvent({
        ...validDecisionEvent,
        policyAction: "warn",
        detectorCategories: ["email", "phone"],
        matchedRuleIds: ["warn.email", "warn.phone"],
        findingCount: 2,
        maskedExcerpt: createMaskedPreview(["[EMAIL]", "[PHONE]"]),
      }),
    ).toBe(true);
    expect(
      isDecisionAuditEvent({
        ...validDecisionEvent,
        policyAction: "block",
        resolution: "blocked",
        detectorCategories: ["email"],
        matchedRuleIds: ["warn.email"],
      }),
    ).toBe(true);
    expect(
      isDecisionAuditEvent({
        ...validDecisionEvent,
        matchedRuleIds: ["warn.phone"],
      }),
    ).toBe(false);
    expect(
      isDecisionAuditEvent({
        ...validDecisionEvent,
        maskedExcerpt: createMaskedPreview(["[PHONE]"]),
      }),
    ).toBe(false);
    expect(
      isDecisionAuditEvent({
        ...validDecisionEvent,
        matchedRuleIds: ["warn.email", "warn.email"],
      }),
    ).toBe(false);
  });

  it("brands only UUID event IDs and canonical ISO timestamps", () => {
    expect(createAuditEventId("00000000-0000-4000-8000-000000000004")).toBe(
      "00000000-0000-4000-8000-000000000004",
    );
    expect(createAuditTimestamp("2026-07-26T12:00:03.000Z")).toBe(
      "2026-07-26T12:00:03.000Z",
    );
    expect(() => createAuditEventId("secret")).toThrow(
      "Invalid audit event identifier.",
    );
    expect(() => createAuditTimestamp("secret")).toThrow(
      "Invalid audit timestamp.",
    );
  });

  it.each([
    {},
    { schemaVersion: 2, events: [] },
    { schemaVersion: 1, events: [], prompt: "secret" },
    {
      schemaVersion: 1,
      events: [{ ...validDecisionEvent, matchedText: "secret" }],
    },
    { schemaVersion: 1, events: [{ ...validDecisionEvent, kind: "unknown" }] },
    {
      schemaVersion: 1,
      events: [{ ...validDecisionEvent, timestamp: "yesterday" }],
    },
    {
      schemaVersion: 1,
      events: [{ ...validDecisionEvent, id: "secret" }],
    },
    {
      schemaVersion: 1,
      events: [{ ...validDecisionEvent, adapterVersion: "secret" }],
    },
    {
      schemaVersion: 1,
      events: [{ ...validDecisionEvent, matchedRuleIds: ["secret"] }],
    },
    { schemaVersion: 1, events: [{ ...validDecisionEvent, findingCount: -1 }] },
    {
      schemaVersion: 1,
      events: [{ ...validDecisionEvent, maskedExcerpt: "email@example.com" }],
    },
  ])(
    "rejects malformed, prompt-bearing, or unknown audit data %#",
    (candidate) => {
      expect(isStoredAuditEnvelope(candidate)).toBe(false);
    },
  );

  it("rejects oversized rule arrays before traversing their entries", () => {
    const oversizedRuleIds = new Array<unknown>(10);
    Object.defineProperty(oversizedRuleIds, 0, {
      get() {
        throw new Error("must not traverse");
      },
    });

    const candidate = {
      schemaVersion: 1,
      events: [{ ...validDecisionEvent, matchedRuleIds: oversizedRuleIds }],
    };

    expect(() => isStoredAuditEnvelope(candidate)).not.toThrow();
    expect(isStoredAuditEnvelope(candidate)).toBe(false);
  });

  it("uses dense exact category, rule, and event arrays", () => {
    for (const detectorCategories of createHostileArrayVariants(["email"], 8)) {
      expect(
        isDecisionAuditEvent({
          ...validDecisionEvent,
          detectorCategories,
        }),
      ).toBe(false);
    }

    for (const matchedRuleIds of createHostileArrayVariants(
      ["warn.email"],
      10,
    )) {
      expect(
        isDecisionAuditEvent({
          ...validDecisionEvent,
          matchedRuleIds,
        }),
      ).toBe(false);
    }

    for (const events of createHostileArrayVariants(
      [validDecisionEvent],
      1_001,
    )) {
      expect(
        isStoredAuditEnvelope({
          schemaVersion: 4,
          events,
        }),
      ).toBe(false);
    }
  });
});

describe("runtime message validation", () => {
  const validRequests: RuntimeRequest[] = [
    { type: "settings.read" },
    { type: "settings.save", settings: createDefaultProtectionSettings() },
    { type: "audit.read" },
    { type: "audit.append", event: validDecisionEvent },
    { type: "audit.clear" },
    { type: "status.read" },
  ];

  it("accepts every exact request variant", () => {
    expect(validRequests.every(isRuntimeRequest)).toBe(true);
  });

  it.each([
    {},
    { type: "unknown" },
    { type: "settings.read", prompt: "secret" },
    { type: "settings.read", findings: [] },
    { type: "settings.read", metadata: {} },
    { type: "settings.save" },
    {
      type: "settings.save",
      settings: { ...DEFAULT_PROTECTION_SETTINGS, matchedText: "secret" },
    },
    { type: "audit.append", event: { ...validDecisionEvent, text: "secret" } },
  ])(
    "rejects unknown, missing, or prompt-bearing request data %#",
    (candidate) => {
      expect(isRuntimeRequest(candidate)).toBe(false);
    },
  );

  it("keeps historical V3 adapter versions structurally valid for sender correlation", () => {
    expect(
      isRuntimeRequest({
        type: "audit.append",
        event: { ...validDecisionEvent, adapterVersion: "1" },
      }),
    ).toBe(true);
  });

  it("validates response and port envelopes without generic payloads", () => {
    expect(
      isRuntimeResponse({
        type: "status.result",
        status: {
          state: "initializing",
          application: "chatgpt",
          surfaceId: "chatgpt_web",
          protectionEnabled: null,
          recentEventCount: 0,
        },
      }),
    ).toBe(true);
    expect(
      isRuntimeResponse({
        type: "status.result",
        status: {
          state: "active",
          application: "chatgpt",
          surfaceId: "chatgpt_web",
          protectionEnabled: null,
          recentEventCount: 0,
        },
      }),
    ).toBe(false);
    expect(
      isProtectionStatusSnapshot({
        state: "unavailable",
        application: null,
        surfaceId: null,
        protectionEnabled: null,
        recentEventCount: 0,
      }),
    ).toBe(true);
    expect(
      isProtectionStatusSnapshot({
        state: "active",
        application: "claude",
        surfaceId: "claude_web",
        protectionEnabled: true,
        recentEventCount: 0,
      }),
    ).toBe(true);
    for (const [application, surfaceId] of [
      ["unknown", "chatgpt_web"],
      ["chatgpt", "claude_web"],
      [null, "chatgpt_web"],
      ["chatgpt", null],
    ]) {
      expect(
        isProtectionStatusSnapshot({
          state: "active",
          application,
          surfaceId,
          protectionEnabled: true,
          recentEventCount: 0,
        }),
      ).toBe(false);
    }
    expect(
      isSettingsPortMessage({
        type: "settings.snapshot",
        generation: 0,
        envelope: validSettingsEnvelope,
      }),
    ).toBe(true);
    expect(
      isSettingsPortMessage({
        type: "settings.snapshot",
        envelope: validSettingsEnvelope,
      }),
    ).toBe(false);
    expect(
      isSettingsPortMessage({
        type: "settings.snapshot",
        generation: 0,
        envelope: validSettingsEnvelope,
        prompt: "secret",
      }),
    ).toBe(false);
    expect(
      isContentStatusPortMessage({
        type: "status.snapshot",
        generation: 0,
        status: {
          state: "active",
          application: "chatgpt",
          surfaceId: "chatgpt_web",
          protectionEnabled: true,
        },
      }),
    ).toBe(true);
    expect(
      isContentStatusPortMessage({
        type: "status.snapshot",
        generation: 0,
        status: {
          state: "disabled",
          application: "claude",
          surfaceId: "claude_web",
          protectionEnabled: false,
        },
      }),
    ).toBe(true);
    expect(
      isContentStatusPortMessage({
        type: "status.snapshot",
        status: {
          state: "active",
          application: "chatgpt",
          surfaceId: "chatgpt_web",
          protectionEnabled: true,
        },
      }),
    ).toBe(false);
    expect(
      isContentStatusPortMessage({
        type: "status.snapshot",
        generation: 0,
        status: {
          state: "active",
          application: "chatgpt",
          surfaceId: "chatgpt_web",
          protectionEnabled: true,
        },
        prompt: "secret",
      }),
    ).toBe(false);
    expect(
      isSettingsPortMessage({
        type: "settings.snapshot",
        generation: -1,
        envelope: validSettingsEnvelope,
      }),
    ).toBe(false);
    expect(
      isContentStatusPortMessage({
        type: "status.snapshot",
        generation: 0.5,
        status: {
          state: "initializing",
          application: "chatgpt",
          surfaceId: "chatgpt_web",
          protectionEnabled: null,
        },
      }),
    ).toBe(false);
    expect(
      isRuntimeResponse({
        type: "error",
        errorCode: "invalid_message",
        prompt: "secret",
      }),
    ).toBe(false);
    expect(
      isRuntimeResponse({
        type: "error",
        errorCode: "validation_failure",
        fieldErrors: [{ field: "emailAction", code: "invalid_action" }],
      }),
    ).toBe(true);
    expect(
      isRuntimeResponse({
        type: "error",
        errorCode: "validation_failure",
        fieldErrors: [
          {
            field: "emailAction",
            code: "invalid_action",
            message: "Copied user input",
          },
        ],
      }),
    ).toBe(false);
    expect(
      isRuntimeResponse({
        type: "error",
        errorCode: "validation_failure",
        fieldErrors: [],
      }),
    ).toBe(false);
  });

  it("enforces field/code compatibility, uniqueness, and exact arrays", () => {
    expect(
      isSettingsValidationError({
        field: "emailAction",
        code: "out_of_range",
      }),
    ).toBe(false);
    expect(
      isRuntimeResponse({
        type: "error",
        errorCode: "validation_failure",
        fieldErrors: [
          { field: "emailAction", code: "invalid_action" },
          { field: "emailAction", code: "required" },
        ],
      }),
    ).toBe(false);

    for (const fieldErrors of createHostileArrayVariants(
      [{ field: "emailAction", code: "invalid_action" }],
      SETTINGS_VALIDATION_FIELDS.length + 1,
    )) {
      expect(
        isRuntimeResponse({
          type: "error",
          errorCode: "validation_failure",
          fieldErrors,
        }),
      ).toBe(false);
    }
  });
});

describe("factory snapshot and TOCTOU safety", () => {
  function poisonAfterFirstRead<T extends object>(
    target: T,
  ): {
    proxy: T;
    getReadCount: () => number;
  } {
    let reads = 0;
    return {
      proxy: new Proxy(target, {
        get(currentTarget, property, receiver) {
          reads += 1;
          if (reads > 1) {
            return "poison";
          }
          return Reflect.get(currentTarget, property, receiver);
        },
      }),
      getReadCount: () => reads,
    };
  }

  it("returns fresh canonical values without retaining factory inputs", () => {
    const policyFindingInput = { ...validPolicyFinding };
    const policyFinding = createPolicyFinding(policyFindingInput);
    expect(policyFinding).not.toBe(policyFindingInput);

    const policyInputSource: PolicyInput = {
      surfaceId: "chatgpt_web",
      attachmentPresent: false,
      findings: [validPolicyFinding],
      policy: validPolicy,
    };
    const policyInput = createPolicyInput(policyInputSource);
    expect(policyInput).not.toBe(policyInputSource);
    expect(policyInput.findings).not.toBe(policyInputSource.findings);
    expect(policyInput.policy).not.toBe(policyInputSource.policy);

    const policyDecisionSource = { ...validPolicyDecision };
    const policyDecision = createPolicyDecision(policyDecisionSource);
    expect(policyDecision).not.toBe(policyDecisionSource);
    expect(policyDecision.matchedRuleIds).not.toBe(
      policyDecisionSource.matchedRuleIds,
    );

    const settingsSource = createDefaultProtectionSettings();
    const settings = cloneProtectionSettings(settingsSource);
    expect(settings).not.toBe(settingsSource);
    expect(settings.protectedKeywords).not.toBe(
      settingsSource.protectedKeywords,
    );

    const dialog = createProtectionDialogModel(validDialogInput);
    expect(dialog).not.toBe(validDialog);
    expect(dialog.findings).not.toBe(validDialog.findings);
    expect(dialog.findings[0]).not.toBe(validDialog.findings[0]);
  });

  it("rejects pass-then-poison proxies in every object/array factory", () => {
    const detector = poisonAfterFirstRead({ value: "email" });
    expect(() =>
      createFindingId(detector.proxy as unknown as DetectorId, 0, 16),
    ).toThrow("Invalid finding identifier source.");
    expect(detector.getReadCount()).toBe(0);

    const masked = poisonAfterFirstRead(["[EMAIL]"]);
    expect(() =>
      createMaskedPreview(masked.proxy as readonly SensitiveDataPlaceholder[]),
    ).toThrow("Invalid masked preview placeholders.");
    expect(masked.getReadCount()).toBe(0);

    const category = poisonAfterFirstRead({ value: "email" });
    expect(() =>
      createDisplayFinding(
        category.proxy as unknown as SensitiveDataCategory,
        "high",
      ),
    ).toThrow("Invalid display finding metadata.");
    expect(category.getReadCount()).toBe(0);

    const dialog = poisonAfterFirstRead(validDialogInput);
    expect(() => createProtectionDialogModel(dialog.proxy)).toThrow(
      "Invalid protection dialog model.",
    );
    expect(dialog.getReadCount()).toBe(0);

    const finding = poisonAfterFirstRead(validPolicyFinding);
    expect(() => createPolicyFinding(finding.proxy)).toThrow(
      "Invalid policy finding.",
    );
    expect(finding.getReadCount()).toBe(0);

    const input = poisonAfterFirstRead({
      surfaceId: "chatgpt_web" as const,
      attachmentPresent: false,
      findings: [validPolicyFinding],
      policy: validPolicy,
    });
    expect(() => createPolicyInput(input.proxy)).toThrow(
      "Invalid policy input.",
    );
    expect(input.getReadCount()).toBe(0);

    const decision = poisonAfterFirstRead(validPolicyDecision);
    expect(() => createPolicyDecision(decision.proxy)).toThrow(
      "Invalid policy decision.",
    );
    expect(decision.getReadCount()).toBe(0);

    const settings = poisonAfterFirstRead(createDefaultProtectionSettings());
    expect(() => cloneProtectionSettings(settings.proxy)).toThrow(
      "Invalid protection settings.",
    );
    expect(settings.getReadCount()).toBe(0);

    const scalar = poisonAfterFirstRead({ value: "secret" });
    expect(() => createAuditEventId(scalar.proxy as unknown as string)).toThrow(
      "Invalid audit event identifier.",
    );
    expect(() =>
      createAuditTimestamp(scalar.proxy as unknown as string),
    ).toThrow("Invalid audit timestamp.");
    expect(scalar.getReadCount()).toBe(0);
  });

  it("rejects accessors before any factory can observe their values", () => {
    let reads = 0;
    const settings = createDefaultProtectionSettings() as Record<
      PropertyKey,
      unknown
    >;
    Object.defineProperty(settings, "emailAction", {
      enumerable: true,
      get() {
        reads += 1;
        return reads === 1 ? "warn" : "poison";
      },
    });

    expect(() =>
      cloneProtectionSettings(
        settings as unknown as ReturnType<
          typeof createDefaultProtectionSettings
        >,
      ),
    ).toThrow("Invalid protection settings.");
    expect(reads).toBe(0);
  });
});

describe("hostile object containment", () => {
  it("rejects custom prototypes while accepting null-prototype records", () => {
    class CustomSettings {
      protectionEnabled = true;
      emailAction = "warn";
      phoneAction = "warn";
      protectedKeywords: string[] = [];
      auditRetentionLimit = 100;
    }

    expect(isProtectionSettings(new CustomSettings())).toBe(false);

    const nullPrototypeSettings = Object.assign(
      Object.create(null) as Record<PropertyKey, unknown>,
      createDefaultProtectionSettings(),
    );
    expect(isProtectionSettings(nullPrototypeSettings)).toBe(true);
  });

  it("contains revoked proxies across every exported validator", () => {
    const validators: ((value: unknown) => boolean)[] = [
      isAdapterHealthAuditEvent,
      isAuditEvent,
      isAuditEventId,
      isAuditTimestamp,
      isContentStatusPortMessage,
      isDecisionAuditEvent,
      isDisplayFinding,
      isEnforcementErrorAuditEvent,
      isMaskedPreview,
      isPolicyConfiguration,
      isPolicyDecision,
      isPolicyFinding,
      isPolicyInput,
      isProtectionDialogModel,
      isProtectionDialogRequest,
      isProtectionErrorDialogModel,
      isProtectionSettings,
      isProtectionStatusSnapshot,
      isRuntimeRequest,
      isRuntimeResponse,
      isSettingsPortMessage,
      isSettingsValidationError,
      isStoredAuditEnvelope,
      isStoredSettingsEnvelope,
    ];
    const revoked = Proxy.revocable({}, {});
    revoked.revoke();

    for (const validator of validators) {
      expect(() => validator(revoked.proxy)).not.toThrow();
      expect(validator(revoked.proxy)).toBe(false);
    }
  });

  it("contains hostile accessors without reading past validation", () => {
    const hostile = Object.create(null) as Record<PropertyKey, unknown>;
    Object.defineProperty(hostile, "type", {
      enumerable: true,
      get() {
        throw new Error("must be contained");
      },
    });

    expect(() => isRuntimeRequest(hostile)).not.toThrow();
    expect(isRuntimeRequest(hostile)).toBe(false);
  });

  it("rejects accessor-backed expected fields across object schemas", () => {
    const enforcementEvent = {
      kind: "enforcement_error",
      id: createAuditEventId("00000000-0000-4000-8000-000000000006"),
      timestamp: createAuditTimestamp("2026-07-26T12:00:05.000Z"),
      application: "chatgpt",
      errorCode: "prompt_too_large",
      adapterVersion: CHATGPT_ADAPTER_VERSION,
    };
    const healthEvent = {
      kind: "adapter_health",
      id: createAuditEventId("00000000-0000-4000-8000-000000000007"),
      timestamp: createAuditTimestamp("2026-07-26T12:00:06.000Z"),
      application: "chatgpt",
      status: "degraded",
      healthCode: "composer_not_found",
      adapterVersion: CHATGPT_ADAPTER_VERSION,
    };

    const cases: {
      value: Record<PropertyKey, unknown>;
      key: string;
      validator: (value: unknown) => boolean;
    }[] = [
      {
        value: { ...validPolicyFinding },
        key: "id",
        validator: isPolicyFinding,
      },
      {
        value: { ...validPolicy },
        key: "schemaVersion",
        validator: isPolicyConfiguration,
      },
      {
        value: {
          application: "chatgpt",
          findings: [validPolicyFinding],
          policy: validPolicy,
        },
        key: "application",
        validator: isPolicyInput,
      },
      {
        value: { ...validPolicyDecision },
        key: "action",
        validator: isPolicyDecision,
      },
      {
        value: { ...validDisplayFinding },
        key: "category",
        validator: isDisplayFinding,
      },
      {
        value: { ...validDialog },
        key: "kind",
        validator: isProtectionDialogModel,
      },
      {
        value: { kind: "error", errorCode: "prompt_too_large" },
        key: "kind",
        validator: isProtectionErrorDialogModel,
      },
      {
        value: { ...createDefaultProtectionSettings() },
        key: "protectionEnabled",
        validator: isProtectionSettings,
      },
      {
        value: { ...validSettingsEnvelope },
        key: "schemaVersion",
        validator: isStoredSettingsEnvelope,
      },
      {
        value: { ...validDecisionEvent },
        key: "kind",
        validator: isDecisionAuditEvent,
      },
      {
        value: enforcementEvent,
        key: "kind",
        validator: isEnforcementErrorAuditEvent,
      },
      {
        value: healthEvent,
        key: "kind",
        validator: isAdapterHealthAuditEvent,
      },
      {
        value: { ...validAuditEnvelope },
        key: "schemaVersion",
        validator: isStoredAuditEnvelope,
      },
      {
        value: {
          state: "active",
          application: "chatgpt",
          surfaceId: "chatgpt_web",
          protectionEnabled: true,
          recentEventCount: 0,
        },
        key: "state",
        validator: isProtectionStatusSnapshot,
      },
      {
        value: { field: "emailAction", code: "invalid_action" },
        key: "field",
        validator: isSettingsValidationError,
      },
      {
        value: { type: "settings.read" },
        key: "type",
        validator: isRuntimeRequest,
      },
      {
        value: { type: "audit.cleared" },
        key: "type",
        validator: isRuntimeResponse,
      },
      {
        value: {
          type: "settings.snapshot",
          generation: 0,
          envelope: validSettingsEnvelope,
        },
        key: "type",
        validator: isSettingsPortMessage,
      },
      {
        value: {
          type: "status.snapshot",
          generation: 0,
          status: {
            state: "initializing",
            application: "chatgpt",
            surfaceId: "chatgpt_web",
            protectionEnabled: null,
          },
        },
        key: "type",
        validator: isContentStatusPortMessage,
      },
    ];

    for (const candidate of cases) {
      let reads = 0;
      const originalValue = candidate.value[candidate.key];
      Object.defineProperty(candidate.value, candidate.key, {
        enumerable: true,
        get() {
          reads += 1;
          return originalValue;
        },
      });

      expect(candidate.validator(candidate.value)).toBe(false);
      expect(reads).toBe(0);
    }
  });

  it("rejects transparent, ownKeys-hiding, nested, and cyclic surprises", () => {
    const transparent = new Proxy(createDefaultProtectionSettings(), {});
    expect(isProtectionSettings(transparent)).toBe(false);

    const hidingTarget = {
      ...createDefaultProtectionSettings(),
      prompt: "secret",
    };
    const hiding = new Proxy(hidingTarget, {
      ownKeys(target) {
        return Reflect.ownKeys(target).filter((key) => key !== "prompt");
      },
      getOwnPropertyDescriptor(target, key) {
        return Reflect.getOwnPropertyDescriptor(target, key);
      },
    });
    expect(isProtectionSettings(hiding)).toBe(false);

    const nested = {
      schemaVersion: 1,
      settings: new Proxy(createDefaultProtectionSettings(), {}),
    };
    expect(isStoredSettingsEnvelope(nested)).toBe(false);

    const cyclic = createDefaultProtectionSettings() as Record<
      PropertyKey,
      unknown
    >;
    cyclic.self = cyclic;
    expect(isProtectionSettings(cyclic)).toBe(false);
  });
});
