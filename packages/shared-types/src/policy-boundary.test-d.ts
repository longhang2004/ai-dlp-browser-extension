import {
  CHATGPT_ADAPTER_VERSION,
  createAuditEventId,
  createAuditTimestamp,
  createDefaultProtectionSettings,
  createDisplayFinding,
  createFindingId,
  createMaskedPreview,
  createProtectionDialogModel,
  DEFAULT_PROTECTION_SETTINGS,
  type AdapterCapabilities,
  type AdapterDescriptor,
  type AdapterHealthAuditEvent,
  type AuditEvent,
  type DecisionAuditEvent,
  type DisplayFinding,
  type EnforcementErrorAuditEvent,
  type MaskedPreview,
  type AuditEventId,
  type AuditTimestamp,
  type ContentStatusPortMessage,
  type PolicyConfiguration,
  type PolicyDecision,
  type PolicyFinding,
  type PolicyInput,
  type ProtectionDialogModel,
  type ProtectionDialogModelInput,
  type ProtectionErrorDialogModel,
  type RuntimeErrorResponse,
  type RuntimeRequest,
  type RuntimeResponse,
  type SensitiveDataFinding,
  type SettingsPortMessage,
  type StoredAuditEnvelope,
} from "./index.js";
import * as sharedTypes from "./index.js";
import type { PromptFreeBoundary } from "./privacy.js";

type Assert<Condition extends true> = Condition;
type IsPromptFree<Boundary> = Boundary extends PromptFreeBoundary
  ? true
  : false;

type DetectorCategoryMismatch = {
  email: "phone";
  phone: "payment_card";
  "payment-card": "aws_access_key";
  "aws-access-key": "private_key";
  "private-key": "api_secret";
  "api-secret": "protected_keyword";
  "protected-keyword": "email";
};

type RejectsAllDetectorCategoryMismatches<Contract> = {
  [Detector in keyof DetectorCategoryMismatch]: Extract<
    Contract,
    {
      detectorId: Detector;
      category: DetectorCategoryMismatch[Detector];
    }
  > extends never
    ? true
    : false;
}[keyof DetectorCategoryMismatch] extends true
  ? true
  : false;

export type PolicyFindingRejectsAllDetectorCategoryMismatches = Assert<
  RejectsAllDetectorCategoryMismatches<PolicyFinding>
>;
export type SensitiveFindingRejectsAllDetectorCategoryMismatches = Assert<
  RejectsAllDetectorCategoryMismatches<SensitiveDataFinding>
>;

export type RuntimeRequestIsPromptFree = Assert<IsPromptFree<RuntimeRequest>>;
export type RuntimeResponseIsPromptFree = Assert<IsPromptFree<RuntimeResponse>>;
export type SettingsPortIsPromptFree = Assert<
  IsPromptFree<SettingsPortMessage>
>;
export type ContentStatusPortIsPromptFree = Assert<
  IsPromptFree<ContentStatusPortMessage>
>;
export type AuditEventIsPromptFree = Assert<IsPromptFree<AuditEvent>>;
export type AuditEnvelopeIsPromptFree = Assert<
  IsPromptFree<StoredAuditEnvelope>
>;
export type AdapterCapabilitiesArePromptFree = Assert<
  IsPromptFree<AdapterCapabilities>
>;
export type AdapterDescriptorIsPromptFree = Assert<
  IsPromptFree<AdapterDescriptor>
>;
type RequiredPromptFreeVocabulary =
  | "prompt"
  | "text"
  | "rawPrompt"
  | "promptText"
  | "matchedText"
  | "matchedValue"
  | "redactedText"
  | "sanitizedText"
  | "sanitizedPrompt"
  | "promptExcerpt"
  | "start"
  | "end"
  | "offsets"
  | "findings"
  | "originalFindings"
  | "payload"
  | "metadata"
  | "data"
  | "content"
  | "element"
  | "applicationUrl";
export type PromptFreeVocabularyIsComplete = Assert<
  Exclude<RequiredPromptFreeVocabulary, keyof PromptFreeBoundary> extends never
    ? true
    : false
>;

declare const descriptor: AdapterDescriptor;
// @ts-expect-error Packaged adapter identity is immutable.
descriptor.adapterId = "claude";
// @ts-expect-error Packaged origin collections are immutable.
descriptor.origins.push("https://claude.ai");
// @ts-expect-error Nested capability support is immutable.
descriptor.capabilities.promptRead = "unsupported";

// @ts-expect-error Standalone descriptor authorization is not public.
const removedDescriptorValidator = sharedTypes.isAdapterDescriptor;
// @ts-expect-error Generic descriptor factories are not public.
const removedDescriptorFactory = sharedTypes.createAdapterDescriptor;
void removedDescriptorValidator;
void removedDescriptorFactory;

const descriptorWithPrompt = {
  adapterId: "chatgpt" as const,
  surfaceId: "chatgpt_web" as const,
  version: CHATGPT_ADAPTER_VERSION,
  trust: "verified" as const,
  origins: ["https://chatgpt.com"],
  capabilities: {
    submissionDetection: "verified" as const,
    promptRead: "verified" as const,
    attachmentDetection: "verified" as const,
    attachmentInspection: "unsupported" as const,
    promptReplacement: "unsupported" as const,
    submissionResume: "verified" as const,
  },
  entryPoint: "content-script.js",
  prompt: "secret",
};
// @ts-expect-error Adapter descriptors reject raw prompt data.
const rejectedDescriptorWithPrompt: AdapterDescriptor = descriptorWithPrompt;
void rejectedDescriptorWithPrompt;

const policy: PolicyConfiguration = {
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

const finding = {
  id: createFindingId("email", 0, 16),
  detectorId: "email",
  category: "email",
  confidence: "high",
} satisfies PolicyFinding;

const mismatchedDetectorCategoryFinding = {
  id: createFindingId("payment-card", 0, 16),
  detectorId: "payment-card",
  category: "email",
  confidence: "high",
};
// @ts-expect-error A payment-card detector cannot produce an email policy finding.
const rejectedMismatchedDetectorCategoryFinding: PolicyFinding =
  mismatchedDetectorCategoryFinding;
void rejectedMismatchedDetectorCategoryFinding;

const input = {
  surfaceId: "chatgpt_web",
  attachmentPresent: false,
  findings: [finding],
  policy,
} satisfies PolicyInput;

const legacyApplicationInput = {
  application: "chatgpt",
  attachmentPresent: false,
  findings: [finding],
  policy,
};
// @ts-expect-error Policy input identity is a closed surface ID, not an application string.
const rejectedLegacyApplicationInput: PolicyInput = legacyApplicationInput;
void rejectedLegacyApplicationInput;

const augmentedPolicyFindings = Object.assign([finding], {
  rawPrompt: "secret",
});
const inputWithAugmentedFindings = {
  ...input,
  findings: augmentedPolicyFindings,
};
// @ts-expect-error Policy finding arrays reject prompt-derived properties.
const rejectedInputWithAugmentedFindings: PolicyInput =
  inputWithAugmentedFindings;

const decision = {
  action: "warn",
  matchedRuleIds: ["warn.email"],
  contributingCategories: ["email"],
  reasonCode: "policy_match",
  attachmentPresent: false,
} satisfies PolicyDecision;

const augmentedPolicyRules = Object.assign(["warn.email"], {
  promptExcerpt: "secret",
});
const decisionWithAugmentedRules = {
  ...decision,
  matchedRuleIds: augmentedPolicyRules,
};
// @ts-expect-error Policy rule arrays reject prompt-derived properties.
const rejectedDecisionWithAugmentedRules: PolicyDecision =
  decisionWithAugmentedRules;

const openStringDecisionContract = {
  action: "warn",
  matchedRuleIds: ["attachment.unsupported"],
  contributingCategories: [],
  reasonCode: "unsupported_attachment",
  attachmentPresent: true,
} satisfies PolicyDecision;

type PolicyThreatField = RequiredPromptFreeVocabulary;
type RejectsField<Contract, Base, Field extends PropertyKey> = Omit<
  Base,
  Field
> &
  Record<Field, string> extends Contract
  ? false
  : true;
type RejectsEveryField<Contract, Base> = false extends {
  [Field in PolicyThreatField]: RejectsField<Contract, Base, Field>;
}[PolicyThreatField]
  ? false
  : true;

const policyFindingRejectsEveryThreatField: Assert<
  RejectsEveryField<PolicyFinding, typeof finding>
> = true;
const policyInputRejectsEveryThreatField: Assert<
  RejectsEveryField<PolicyInput, typeof input>
> = true;
const policyDecisionRejectsEveryThreatField: Assert<
  RejectsEveryField<PolicyDecision, typeof decision>
> = true;

const sensitiveEmailFinding = {
  ...finding,
  start: 0,
  end: 16,
  matchedText: "email@example.test",
  redactedText: "[EMAIL]",
} satisfies SensitiveDataFinding;

const copiedPolicyFinding = {
  id: sensitiveEmailFinding.id,
  detectorId: sensitiveEmailFinding.detectorId,
  category: sensitiveEmailFinding.category,
  confidence: sensitiveEmailFinding.confidence,
} satisfies PolicyFinding;

const inputWithNestedCategoryPrompt = {
  ...input,
  policy: {
    ...policy,
    categoryActions: {
      ...policy.categoryActions,
      rawPrompt: "secret",
    },
  },
};
// @ts-expect-error Policy category-action records reject nested prompt aliases.
const rejectedInputWithNestedCategoryPrompt: PolicyInput =
  inputWithNestedCategoryPrompt;

const inputWithNestedApiPrompt = {
  ...input,
  policy: {
    ...policy,
    apiSecretActions: {
      ...policy.apiSecretActions,
      matchedValue: "secret",
    },
  },
};
// @ts-expect-error API-secret action records reject nested matched values.
const rejectedInputWithNestedApiPrompt: PolicyInput = inputWithNestedApiPrompt;

const displayEmailFinding = createDisplayFinding("email", "high");

const dialog = createProtectionDialogModel({
  kind: "warn",
  findings: [displayEmailFinding],
  reasonCode: "policy_match",
  attachmentPresent: false,
  canRedact: true,
});

const augmentedDialogFindings = Object.assign([displayEmailFinding], {
  matchedValue: "secret",
});
const dialogWithAugmentedFindings = {
  ...dialog,
  findings: augmentedDialogFindings,
};
// @ts-expect-error Dialog finding arrays reject prompt-derived properties.
const rejectedDialogWithAugmentedFindings: ProtectionDialogModel =
  dialogWithAugmentedFindings;

// Structural assignment from a full finding must fail, not merely fresh literals.
// @ts-expect-error Sensitive findings contain forbidden prompt-derived fields.
const leakedFinding: PolicyFinding = sensitiveEmailFinding;

const sensitiveFindings: SensitiveDataFinding[] = [sensitiveEmailFinding];
// @ts-expect-error Arrays of sensitive findings cannot become policy arrays.
const leakedFindingArray: PolicyFinding[] = sensitiveFindings;

const findingWithMatchedText = { ...finding, matchedText: "secret" };
// @ts-expect-error PolicyFinding structurally rejects matched content.
const rejectedFindingWithMatchedText: PolicyFinding = findingWithMatchedText;

const findingWithRedactedText = { ...finding, redactedText: "[EMAIL]" };
// @ts-expect-error PolicyFinding structurally rejects replacement text.
const rejectedFindingWithRedactedText: PolicyFinding = findingWithRedactedText;

const findingWithStart = { ...finding, start: 0 };
// @ts-expect-error PolicyFinding structurally rejects start offsets.
const rejectedFindingWithStart: PolicyFinding = findingWithStart;

const findingWithEnd = { ...finding, end: 16 };
// @ts-expect-error PolicyFinding structurally rejects end offsets.
const rejectedFindingWithEnd: PolicyFinding = findingWithEnd;

const inputWithPrompt = { ...input, prompt: "secret" };
// @ts-expect-error PolicyInput structurally rejects prompts.
const rejectedInputWithPrompt: PolicyInput = inputWithPrompt;

const inputWithMatchedText = { ...input, matchedText: "secret" };
// @ts-expect-error PolicyInput structurally rejects matched content.
const rejectedInputWithMatchedText: PolicyInput = inputWithMatchedText;

const inputWithRedactedText = { ...input, redactedText: "[EMAIL]" };
// @ts-expect-error PolicyInput structurally rejects replacement text.
const rejectedInputWithRedactedText: PolicyInput = inputWithRedactedText;

const inputWithStart = { ...input, start: 0 };
// @ts-expect-error PolicyInput structurally rejects start offsets.
const rejectedInputWithStart: PolicyInput = inputWithStart;

const inputWithEnd = { ...input, end: 16 };
// @ts-expect-error PolicyInput structurally rejects end offsets.
const rejectedInputWithEnd: PolicyInput = inputWithEnd;

const inputWithSanitizedText = { ...input, sanitizedText: "[EMAIL]" };
// @ts-expect-error PolicyInput structurally rejects sanitized prompt text.
const rejectedInputWithSanitizedText: PolicyInput = inputWithSanitizedText;

const inputWithOriginalFindings = {
  ...input,
  originalFindings: sensitiveFindings,
};
// @ts-expect-error PolicyInput rejects retained original findings.
const rejectedInputWithOriginalFindings: PolicyInput =
  inputWithOriginalFindings;

const inputWithSensitiveFindings = { ...input, findings: sensitiveFindings };
// @ts-expect-error PolicyInput cannot accept an array of full sensitive findings.
const rejectedInputWithSensitiveFindings: PolicyInput =
  inputWithSensitiveFindings;

const inputWithElement = { ...input, element: { nodeType: 1 } };
// @ts-expect-error PolicyInput structurally rejects DOM-like state.
const rejectedInputWithElement: PolicyInput = inputWithElement;

const inputWithUrl = {
  ...input,
  applicationUrl: { href: "https://chatgpt.com/" },
};
// @ts-expect-error PolicyInput structurally rejects browser URL state.
const rejectedInputWithUrl: PolicyInput = inputWithUrl;

const decisionWithPrompt = { ...decision, prompt: "secret" };
// @ts-expect-error PolicyDecision structurally rejects prompts.
const rejectedDecisionWithPrompt: PolicyDecision = decisionWithPrompt;

const decisionWithMatchedText = { ...decision, matchedText: "secret" };
// @ts-expect-error PolicyDecision structurally rejects matched content.
const rejectedDecisionWithMatchedText: PolicyDecision = decisionWithMatchedText;

const decisionWithRedactedText = { ...decision, redactedText: "[EMAIL]" };
// @ts-expect-error PolicyDecision structurally rejects replacement text.
const rejectedDecisionWithRedactedText: PolicyDecision =
  decisionWithRedactedText;

const decisionWithStart = { ...decision, start: 0 };
// @ts-expect-error PolicyDecision structurally rejects start offsets.
const rejectedDecisionWithStart: PolicyDecision = decisionWithStart;

const decisionWithEnd = { ...decision, end: 16 };
// @ts-expect-error PolicyDecision structurally rejects end offsets.
const rejectedDecisionWithEnd: PolicyDecision = decisionWithEnd;

const decisionWithSanitizedText = { ...decision, sanitizedText: "[EMAIL]" };
// @ts-expect-error PolicyDecision structurally rejects sanitized prompt text.
const rejectedDecisionWithSanitizedText: PolicyDecision =
  decisionWithSanitizedText;

const decisionWithFindings = { ...decision, findings: sensitiveFindings };
// @ts-expect-error PolicyDecision cannot echo original findings.
const rejectedDecisionWithFindings: PolicyDecision = decisionWithFindings;

const decisionWithOriginalFindings = {
  ...decision,
  originalFindings: sensitiveFindings,
};
// @ts-expect-error PolicyDecision cannot return original findings under an alias.
const rejectedDecisionWithOriginalFindings: PolicyDecision =
  decisionWithOriginalFindings;

const decisionWithElement = { ...decision, element: { nodeType: 1 } };
// @ts-expect-error PolicyDecision structurally rejects DOM-like state.
const rejectedDecisionWithElement: PolicyDecision = decisionWithElement;

const decisionWithUrl = {
  ...decision,
  applicationUrl: { href: "https://chatgpt.com/" },
};
// @ts-expect-error PolicyDecision structurally rejects browser URL state.
const rejectedDecisionWithUrl: PolicyDecision = decisionWithUrl;

const wrongSensitivePlaceholder = {
  ...sensitiveEmailFinding,
  redactedText: "[PHONE]",
};
// @ts-expect-error Finding placeholder must match its category.
const rejectedSensitivePlaceholder: SensitiveDataFinding =
  wrongSensitivePlaceholder;

const wrongDisplayPlaceholder = {
  ...displayEmailFinding,
  placeholder: "[PHONE]",
};
// @ts-expect-error Display placeholder must match its category.
const rejectedDisplayPlaceholder: DisplayFinding = wrongDisplayPlaceholder;

const displayWithPrompt = { ...displayEmailFinding, prompt: "secret" };
// @ts-expect-error DisplayFinding structurally rejects prompts.
const rejectedDisplayWithPrompt: DisplayFinding = displayWithPrompt;

const displayWithMatchedText = {
  ...displayEmailFinding,
  matchedText: "secret",
};
// @ts-expect-error DisplayFinding structurally rejects matched content.
const rejectedDisplayWithMatchedText: DisplayFinding = displayWithMatchedText;

const displayWithRedactedText = {
  ...displayEmailFinding,
  redactedText: "[EMAIL]",
};
// @ts-expect-error DisplayFinding structurally rejects replacement text.
const rejectedDisplayWithRedactedText: DisplayFinding = displayWithRedactedText;

const displayWithStart = { ...displayEmailFinding, start: 0 };
// @ts-expect-error DisplayFinding structurally rejects start offsets.
const rejectedDisplayWithStart: DisplayFinding = displayWithStart;

const displayWithEnd = { ...displayEmailFinding, end: 16 };
// @ts-expect-error DisplayFinding structurally rejects end offsets.
const rejectedDisplayWithEnd: DisplayFinding = displayWithEnd;

const displayWithSanitizedText = {
  ...displayEmailFinding,
  sanitizedText: "[EMAIL]",
};
// @ts-expect-error DisplayFinding structurally rejects sanitized prompt text.
const rejectedDisplayWithSanitizedText: DisplayFinding =
  displayWithSanitizedText;

const dialogWithPrompt = { ...dialog, prompt: "secret" };
// @ts-expect-error ProtectionDialogModel structurally rejects prompts.
const rejectedDialogWithPrompt: ProtectionDialogModel = dialogWithPrompt;

const dialogWithMatchedText = { ...dialog, matchedText: "secret" };
// @ts-expect-error ProtectionDialogModel structurally rejects matched content.
const rejectedDialogWithMatchedText: ProtectionDialogModel =
  dialogWithMatchedText;

const dialogWithRedactedText = { ...dialog, redactedText: "[EMAIL]" };
// @ts-expect-error ProtectionDialogModel structurally rejects replacement text.
const rejectedDialogWithRedactedText: ProtectionDialogModel =
  dialogWithRedactedText;

const dialogWithStart = { ...dialog, start: 0 };
// @ts-expect-error ProtectionDialogModel structurally rejects start offsets.
const rejectedDialogWithStart: ProtectionDialogModel = dialogWithStart;

const dialogWithEnd = { ...dialog, end: 16 };
// @ts-expect-error ProtectionDialogModel structurally rejects end offsets.
const rejectedDialogWithEnd: ProtectionDialogModel = dialogWithEnd;

const dialogWithSanitizedText = { ...dialog, sanitizedText: "[EMAIL]" };
// @ts-expect-error ProtectionDialogModel structurally rejects sanitized text.
const rejectedDialogWithSanitizedText: ProtectionDialogModel =
  dialogWithSanitizedText;

const errorDialog = {
  kind: "error",
  errorCode: "prompt_too_large",
} satisfies ProtectionErrorDialogModel;
const errorDialogWithPrompt = { ...errorDialog, prompt: "secret" };
// @ts-expect-error ProtectionErrorDialogModel structurally rejects prompts.
const rejectedErrorDialogWithPrompt: ProtectionErrorDialogModel =
  errorDialogWithPrompt;

const arbitraryPreview = "… [EMAIL] …";
// @ts-expect-error UI preview strings must be created by the approved helper.
const rejectedArbitraryPreview: MaskedPreview = arbitraryPreview;

const dialogWithArbitraryPreview = {
  ...dialog,
  maskedPreview: arbitraryPreview,
};
// @ts-expect-error Protection dialogs cannot receive an unbranded preview.
const rejectedDialogPreview: ProtectionDialogModel = dialogWithArbitraryPreview;

// @ts-expect-error Dialog factory inputs cannot receive a caller-authored preview.
const rejectedDialogFactoryInput: ProtectionDialogModelInput = dialog;

const augmentedPlaceholders = Object.assign(["[EMAIL]" as const], {
  rawPrompt: "secret",
});
// @ts-expect-error Placeholder arrays reject prompt-derived properties.
const rejectedAugmentedPreview = createMaskedPreview(augmentedPlaceholders);

// @ts-expect-error Audit IDs must pass the UUID factory/validator.
const rejectedAuditId: AuditEventId = "secret";
// @ts-expect-error Audit timestamps must pass the canonical ISO factory/validator.
const rejectedAuditTimestamp: AuditTimestamp = "secret";

const runtimeRequestWithPrompt = {
  type: "settings.read" as const,
  prompt: "secret",
  text: "secret",
  rawPrompt: "secret",
  promptText: "secret",
  payload: "secret",
};
// @ts-expect-error Every runtime request variant rejects raw prompt text.
const rejectedRuntimeRequest: RuntimeRequest = runtimeRequestWithPrompt;

const runtimeResponseWithMatchedText = {
  type: "audit.appended" as const,
  matchedText: "secret",
  matchedValue: "secret",
  sanitizedPrompt: "[EMAIL]",
  metadata: "secret",
};
// @ts-expect-error Every runtime response variant rejects matched text.
const rejectedRuntimeResponse: RuntimeResponse = runtimeResponseWithMatchedText;

const runtimeErrorWithRedactedText = {
  type: "error" as const,
  errorCode: "unavailable" as const,
  redactedText: "[EMAIL]",
};
// @ts-expect-error Runtime error responses reject replacement text.
const rejectedRuntimeErrorResponse: RuntimeErrorResponse =
  runtimeErrorWithRedactedText;

const settingsPortWithSanitizedText = {
  type: "settings.snapshot" as const,
  generation: 0,
  envelope: {
    schemaVersion: 1 as const,
    settings: createDefaultProtectionSettings(),
  },
  sanitizedText: "[EMAIL]",
  promptExcerpt: "secret",
  offsets: [0, 16],
  data: "secret",
};
// @ts-expect-error Settings port messages reject sanitized prompt text.
const rejectedSettingsPortMessage: SettingsPortMessage =
  settingsPortWithSanitizedText;

const contentStatusWithPrompt = {
  type: "status.snapshot" as const,
  generation: 0,
  status: {
    state: "active" as const,
    application: "chatgpt" as const,
    protectionEnabled: true as const,
  },
  prompt: "secret",
};
// @ts-expect-error Content status messages reject prompt text.
const rejectedContentStatusMessage: ContentStatusPortMessage =
  contentStatusWithPrompt;

const settingsSaveWithNestedPrompt = {
  type: "settings.save" as const,
  settings: {
    ...createDefaultProtectionSettings(),
    rawPrompt: "secret",
  },
};
// @ts-expect-error Settings-save payloads reject nested prompt aliases.
const rejectedSettingsSaveWithNestedPrompt: RuntimeRequest =
  settingsSaveWithNestedPrompt;

const augmentedSettingsKeywords = Object.assign(["protected"], {
  data: "secret",
});
const settingsSaveWithAugmentedKeywords = {
  type: "settings.save" as const,
  settings: {
    ...createDefaultProtectionSettings(),
    protectedKeywords: augmentedSettingsKeywords,
  },
};
// @ts-expect-error Settings keyword arrays reject prompt-derived properties.
const rejectedSettingsSaveWithAugmentedKeywords: RuntimeRequest =
  settingsSaveWithAugmentedKeywords;

const settingsResponseWithNestedPrompt = {
  type: "settings.result" as const,
  envelope: {
    schemaVersion: 1 as const,
    settings: {
      ...createDefaultProtectionSettings(),
      promptText: "secret",
    },
  },
};
// @ts-expect-error Settings responses reject nested prompt aliases.
const rejectedSettingsResponseWithNestedPrompt: RuntimeResponse =
  settingsResponseWithNestedPrompt;

const settingsPortWithNestedPrompt = {
  type: "settings.snapshot" as const,
  generation: 0,
  envelope: {
    schemaVersion: 1 as const,
    settings: {
      ...createDefaultProtectionSettings(),
      sanitizedPrompt: "[EMAIL]",
    },
  },
};
// @ts-expect-error Settings port snapshots reject nested sanitized prompts.
const rejectedSettingsPortWithNestedPrompt: SettingsPortMessage =
  settingsPortWithNestedPrompt;

const settingsPortWithAugmentedKeywords = {
  type: "settings.snapshot" as const,
  generation: 0,
  envelope: {
    schemaVersion: 1 as const,
    settings: {
      ...createDefaultProtectionSettings(),
      protectedKeywords: Object.assign(["protected"], {
        metadata: "secret",
      }),
    },
  },
};
// @ts-expect-error Settings-port keyword arrays reject prompt-derived properties.
const rejectedSettingsPortWithAugmentedKeywords: SettingsPortMessage =
  settingsPortWithAugmentedKeywords;

const statusResponseWithNestedPrompt = {
  type: "status.result" as const,
  status: {
    application: "chatgpt" as const,
    recentEventCount: 0,
    state: "active" as const,
    protectionEnabled: true as const,
    promptExcerpt: "secret",
  },
};
// @ts-expect-error Status response records reject nested prompt excerpts.
const rejectedStatusResponseWithNestedPrompt: RuntimeResponse =
  statusResponseWithNestedPrompt;

const validationErrorWithNestedPrompt = {
  type: "error" as const,
  errorCode: "validation_failure" as const,
  fieldErrors: [
    {
      field: "emailAction" as const,
      code: "invalid_action" as const,
      content: "secret",
    },
  ],
};
// @ts-expect-error Validation-error records reject nested generic content.
const rejectedValidationErrorWithNestedPrompt: RuntimeErrorResponse =
  validationErrorWithNestedPrompt;

const augmentedFieldErrors = Object.assign(
  [
    {
      field: "emailAction" as const,
      code: "invalid_action" as const,
    },
  ],
  { rawPrompt: "secret" },
);
const validationErrorWithAugmentedErrors = {
  type: "error" as const,
  errorCode: "validation_failure" as const,
  fieldErrors: augmentedFieldErrors,
};
// @ts-expect-error Validation field-error arrays reject prompt-derived properties.
const rejectedValidationErrorWithAugmentedErrors: RuntimeErrorResponse =
  validationErrorWithAugmentedErrors;

const auditBase = {
  id: createAuditEventId("00000000-0000-4000-8000-000000000010"),
  timestamp: createAuditTimestamp("2026-07-26T12:00:10.000Z"),
  adapterId: "chatgpt" as const,
  surfaceId: "chatgpt_web" as const,
  adapterVersion: CHATGPT_ADAPTER_VERSION,
};

const boundaryDecisionAudit = {
  ...auditBase,
  kind: "decision" as const,
  policyAction: "warn" as const,
  resolution: "cancelled" as const,
  detectorCategories: ["email" as const],
  matchedRuleIds: ["warn.email"],
  findingCount: 1,
  reasonCode: "policy_match",
  attachmentPresent: false,
} satisfies DecisionAuditEvent;

const auditWithAugmentedCategories = {
  ...boundaryDecisionAudit,
  detectorCategories: Object.assign(["email" as const], {
    content: "secret",
  }),
};
// @ts-expect-error Audit category arrays reject prompt-derived properties.
const rejectedAuditWithAugmentedCategories: DecisionAuditEvent =
  auditWithAugmentedCategories;

const auditWithAugmentedRules = {
  ...boundaryDecisionAudit,
  matchedRuleIds: Object.assign(["warn.email"], {
    promptExcerpt: "secret",
  }),
};
// @ts-expect-error Audit rule arrays reject prompt-derived properties.
const rejectedAuditWithAugmentedRules: DecisionAuditEvent =
  auditWithAugmentedRules;

const auditEnvelopeWithAugmentedEvents = {
  schemaVersion: 1 as const,
  events: Object.assign([boundaryDecisionAudit], {
    rawPrompt: "secret",
  }),
};
// @ts-expect-error Stored audit event arrays reject prompt-derived properties.
const rejectedAuditEnvelopeWithAugmentedEvents: StoredAuditEnvelope =
  auditEnvelopeWithAugmentedEvents;

const decisionAuditWithStart = {
  ...auditBase,
  kind: "decision" as const,
  policyAction: "warn" as const,
  resolution: "cancelled" as const,
  detectorCategories: ["email" as const],
  matchedRuleIds: ["warn.email" as const],
  findingCount: 1,
  start: 0,
};
// @ts-expect-error Decision audit events reject prompt offsets.
const rejectedDecisionAuditEvent: DecisionAuditEvent = decisionAuditWithStart;

const enforcementAuditWithEnd = {
  ...auditBase,
  kind: "enforcement_error" as const,
  errorCode: "detector_failure" as const,
  end: 16,
};
// @ts-expect-error Enforcement audit events reject prompt offsets.
const rejectedEnforcementAuditEvent: EnforcementErrorAuditEvent =
  enforcementAuditWithEnd;

const healthAuditWithPrompt = {
  ...auditBase,
  kind: "adapter_health" as const,
  status: "degraded" as const,
  healthCode: "composer_not_found" as const,
  prompt: "secret",
};
// @ts-expect-error Adapter health events reject raw prompt text.
const rejectedHealthAuditEvent: AdapterHealthAuditEvent = healthAuditWithPrompt;

const auditEventWithContent = {
  ...healthAuditWithPrompt,
  content: "secret",
  findings: [],
  originalFindings: [],
};
// @ts-expect-error Audit events reject generic prompt-bearing aliases.
const rejectedAuditEvent: AuditEvent = auditEventWithContent;

const auditEnvelopeWithNestedPrompt = {
  schemaVersion: 1 as const,
  events: [auditEventWithContent],
};
// @ts-expect-error Audit envelopes reject prompt aliases inside nested events.
const rejectedAuditEnvelopeWithNestedPrompt: StoredAuditEnvelope =
  auditEnvelopeWithNestedPrompt;

const dialogWithNestedPrompt = {
  ...dialog,
  findings: [
    {
      ...displayEmailFinding,
      rawPrompt: "secret",
    },
  ],
};
// @ts-expect-error Dialog models reject prompt aliases inside display findings.
const rejectedDialogWithNestedPrompt: ProtectionDialogModel =
  dialogWithNestedPrompt;

const auditEnvelopeWithSanitizedText = {
  schemaVersion: 1 as const,
  events: [],
  sanitizedText: "[EMAIL]",
  rawText: "secret",
  composerText: "secret",
  composerContents: "secret",
  userText: "secret",
  userAuthoredExcerpt: "secret",
  originalText: "secret",
  findingText: "secret",
  matchedSubstring: "secret",
};
// @ts-expect-error Stored audit envelopes reject sanitized prompt text.
const rejectedAuditEnvelope: StoredAuditEnvelope =
  auditEnvelopeWithSanitizedText;

// @ts-expect-error Safe defaults are compile-time immutable.
DEFAULT_PROTECTION_SETTINGS.protectionEnabled = false;
// @ts-expect-error The nested keyword collection is compile-time immutable.
DEFAULT_PROTECTION_SETTINGS.protectedKeywords.push("weaken");

void leakedFinding;
void leakedFindingArray;
void rejectedFindingWithMatchedText;
void rejectedFindingWithRedactedText;
void rejectedFindingWithStart;
void rejectedFindingWithEnd;
void rejectedInputWithPrompt;
void rejectedInputWithMatchedText;
void rejectedInputWithRedactedText;
void rejectedInputWithStart;
void rejectedInputWithEnd;
void rejectedInputWithSanitizedText;
void rejectedInputWithOriginalFindings;
void rejectedInputWithSensitiveFindings;
void rejectedInputWithElement;
void rejectedInputWithUrl;
void rejectedDecisionWithPrompt;
void rejectedDecisionWithMatchedText;
void rejectedDecisionWithRedactedText;
void rejectedDecisionWithStart;
void rejectedDecisionWithEnd;
void rejectedDecisionWithSanitizedText;
void rejectedDecisionWithFindings;
void rejectedDecisionWithOriginalFindings;
void rejectedDecisionWithElement;
void rejectedDecisionWithUrl;
void rejectedSensitivePlaceholder;
void rejectedDisplayPlaceholder;
void rejectedDisplayWithPrompt;
void rejectedDisplayWithMatchedText;
void rejectedDisplayWithRedactedText;
void rejectedDisplayWithStart;
void rejectedDisplayWithEnd;
void rejectedDisplayWithSanitizedText;
void rejectedDialogWithPrompt;
void rejectedDialogWithMatchedText;
void rejectedDialogWithRedactedText;
void rejectedDialogWithStart;
void rejectedDialogWithEnd;
void rejectedDialogWithSanitizedText;
void rejectedErrorDialogWithPrompt;
void rejectedArbitraryPreview;
void rejectedDialogPreview;
void rejectedDialogFactoryInput;
void rejectedAugmentedPreview;
void rejectedAuditId;
void rejectedAuditTimestamp;
void rejectedRuntimeRequest;
void rejectedRuntimeResponse;
void rejectedRuntimeErrorResponse;
void rejectedSettingsPortMessage;
void rejectedContentStatusMessage;
void rejectedDecisionAuditEvent;
void rejectedEnforcementAuditEvent;
void rejectedHealthAuditEvent;
void rejectedAuditEvent;
void rejectedAuditEnvelope;
void copiedPolicyFinding;
void openStringDecisionContract;
void policyFindingRejectsEveryThreatField;
void policyInputRejectsEveryThreatField;
void policyDecisionRejectsEveryThreatField;
void rejectedInputWithNestedCategoryPrompt;
void rejectedInputWithNestedApiPrompt;
void rejectedSettingsSaveWithNestedPrompt;
void rejectedSettingsResponseWithNestedPrompt;
void rejectedSettingsPortWithNestedPrompt;
void rejectedStatusResponseWithNestedPrompt;
void rejectedValidationErrorWithNestedPrompt;
void rejectedAuditEnvelopeWithNestedPrompt;
void rejectedDialogWithNestedPrompt;
void rejectedInputWithAugmentedFindings;
void rejectedDecisionWithAugmentedRules;
void rejectedDialogWithAugmentedFindings;
void rejectedSettingsSaveWithAugmentedKeywords;
void rejectedSettingsPortWithAugmentedKeywords;
void rejectedValidationErrorWithAugmentedErrors;
void rejectedAuditWithAugmentedCategories;
void rejectedAuditWithAugmentedRules;
void rejectedAuditEnvelopeWithAugmentedEvents;

const v1SettingsWithoutRedact = createDefaultProtectionSettings();
// @ts-expect-error Persisted Milestone 1 settings cannot request redaction.
v1SettingsWithoutRedact.emailAction = "redact";
// @ts-expect-error Persisted Milestone 1 settings cannot request redaction.
v1SettingsWithoutRedact.phoneAction = "redact";
void v1SettingsWithoutRedact;
