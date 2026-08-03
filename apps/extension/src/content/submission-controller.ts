import {
  analyzePrompt,
  MAX_PROMPT_CODE_UNITS,
  redactPrompt,
} from "@ai-dlp/detectors";
import { evaluatePolicy } from "@ai-dlp/policy-engine";
import {
  CHATGPT_ADAPTER_VERSION,
  cloneProtectionSettings,
  createAuditEventId,
  createAuditTimestamp,
  type AuditEvent,
  type DecisionAuditEvent,
  type DecisionResolution,
  type EnforcementErrorCode,
  type MaskedPreview,
  type PolicyAction,
  type PolicyDecision,
  type PromptFreeArray,
  type ProtectionDialogIntent,
  type ReadonlyProtectionSettings,
  type SensitiveDataCategory,
  type SensitiveDataFinding,
} from "@ai-dlp/shared-types";

import type {
  CapturedSubmitAttempt,
  ChatApplicationAdapter,
  AttachmentStateFingerprint,
  LiveSubmissionContext,
  PromptReplacementCapability,
  SubmitInterceptionDisposition,
} from "../adapters/chat-application-adapter.js";
import type { ProtectionDialogController } from "../ui/protection-dialog/dialog-controller.js";
import { derivePolicy } from "./derive-policy.js";
import {
  consumeSubmissionAuthorization,
  createSubmissionAuthorization,
  invalidateSubmissionAuthorization,
  type SubmissionAuthorization,
} from "./authorization.js";
import {
  createSubmissionDialogModel,
  toPolicyFindings,
} from "./display-model.js";
import type { EnforcementRevision } from "./enforcement-settings.js";

export { MAX_PROMPT_CODE_UNITS };

export type SubmissionControllerState =
  "idle" | "evaluating" | "dialog" | "resuming" | "cancelled" | "completed";

export type SubmissionControllerDiagnostics = {
  state: SubmissionControllerState;
  hasActiveAttempt: boolean;
  hasPromptSnapshot: boolean;
  hasSensitiveFindings: boolean;
  hasAuthorization: boolean;
};

export interface SubmissionAuditPort {
  append(event: AuditEvent): void | Promise<unknown>;
}

export type SubmissionControllerOptions = {
  adapter: ChatApplicationAdapter;
  settings: () => ReadonlyProtectionSettings;
  dialog: Pick<ProtectionDialogController, "show" | "cancel">;
  audit: SubmissionAuditPort;
  analyze?: typeof analyzePrompt;
  evaluate?: typeof evaluatePolicy;
  redact?: typeof redactPrompt;
  monotonicNow?: () => number;
  wallClockNow?: () => Date;
  eventId?: () => string;
  isProtectionEnabled?: () => boolean;
  currentRevision: () => EnforcementRevision;
};

type ActiveAttempt = {
  attempt: CapturedSubmitAttempt;
  generation: number;
  revision: EnforcementRevision;
  settings: ReadonlyProtectionSettings;
  promptSnapshot: string | null;
  authorization: SubmissionAuthorization | null;
  cancelled: boolean;
  uiFailed: boolean;
  decision: PolicyDecision | null;
  decisionMetadata: SanitizedDecisionMetadata | null;
  findings: SensitiveDataFinding[];
  eventEmitted: boolean;
  replacementCapability: PromptReplacementCapability;
  attachmentPresent: boolean;
  attachmentStateFingerprint: AttachmentStateFingerprint | null;
};

type SanitizedDecisionMetadata = {
  policyAction: PolicyAction;
  detectorCategories: PromptFreeArray<SensitiveDataCategory>;
  matchedRuleIds: PromptFreeArray<string>;
  findingCount: number;
  reasonCode: PolicyDecision["reasonCode"];
  attachmentPresent: boolean;
  maskedExcerpt?: MaskedPreview;
};

type ResumeAttemptResult =
  | { kind: "resumed" }
  | { kind: "authorization_invalid" }
  | { kind: "error"; errorCode: EnforcementErrorCode };

export type SubmissionController = {
  register(): () => void;
  handleCapturedAttempt(
    attempt: CapturedSubmitAttempt,
  ): SubmitInterceptionDisposition;
  cancelActiveAttempt(): void;
  reportDialogRenderFailure(): void;
  dispose(): void;
  whenSettledForTesting(): Promise<void>;
  getDiagnosticsForTesting(): SubmissionControllerDiagnostics;
};

function defaultMonotonicNow(): number {
  return performance.now();
}

function defaultEventId(): string {
  return crypto.randomUUID();
}

function isElementConnected(element: HTMLElement): boolean {
  return element.isConnected;
}

function isSendControlEnabled(element: HTMLElement): boolean {
  if (!isElementConnected(element)) {
    return false;
  }
  if (
    typeof HTMLButtonElement !== "undefined" &&
    element instanceof HTMLButtonElement &&
    element.disabled
  ) {
    return false;
  }
  return element.getAttribute?.("aria-disabled") !== "true";
}

function capturePromptSynchronously(
  adapter: ChatApplicationAdapter,
  attempt: CapturedSubmitAttempt,
):
  | {
      kind: "ready";
      prompt: string;
      replacementCapability: PromptReplacementCapability;
      attachmentPresent: boolean;
      attachmentStateFingerprint: AttachmentStateFingerprint;
    }
  | { kind: "error"; errorCode: EnforcementErrorCode } {
  try {
    const context = adapter.resolveSubmissionContext(attempt.contextIdentity);
    if (
      context === null ||
      !adapter.matches(context.applicationUrl) ||
      context.contextIdentity !== attempt.contextIdentity ||
      context.contextVersion !== attempt.initialContextVersion ||
      !isElementConnected(context.composer) ||
      !isSendControlEnabled(context.sendControl)
    ) {
      return {
        kind: "error",
        errorCode: "extension_context_invalidated",
      };
    }
    const capabilities = adapter.inspectSubmissionCapabilities(context);
    return {
      kind: "ready",
      prompt: adapter.readPrompt(context),
      replacementCapability: adapter.getPromptReplacementCapability(context),
      attachmentPresent: capabilities.attachmentPresent,
      attachmentStateFingerprint: capabilities.attachmentStateFingerprint,
    };
  } catch {
    return { kind: "error", errorCode: "extension_context_invalidated" };
  }
}

export function createSubmissionController(
  options: SubmissionControllerOptions,
): SubmissionController {
  const analyze = options.analyze ?? analyzePrompt;
  const evaluate = options.evaluate ?? evaluatePolicy;
  const redact = options.redact ?? redactPrompt;
  const monotonicNow = options.monotonicNow ?? defaultMonotonicNow;
  const wallClockNow = options.wallClockNow ?? (() => new Date());
  const eventId = options.eventId ?? defaultEventId;
  const isProtectionEnabled =
    options.isProtectionEnabled ?? (() => options.settings().protectionEnabled);
  const currentRevision = options.currentRevision;
  let state: SubmissionControllerState = "idle";
  let active: ActiveAttempt | null = null;
  let generation = 0;
  let registeredDisposer: (() => void) | null = null;
  let disposed = false;
  let pending: Promise<void> = Promise.resolve();

  function isCurrent(attempt: ActiveAttempt): boolean {
    let revisionIsCurrent: boolean;
    try {
      revisionIsCurrent = currentRevision() === attempt.revision;
    } catch {
      revisionIsCurrent = false;
    }
    return (
      active === attempt &&
      attempt.generation === generation &&
      revisionIsCurrent &&
      !attempt.cancelled &&
      !disposed
    );
  }

  function snapshotSettings(
    settings: ReadonlyProtectionSettings,
  ): ReadonlyProtectionSettings {
    const snapshot = cloneProtectionSettings(settings);
    return Object.freeze({
      ...snapshot,
      protectedKeywords: Object.freeze([
        ...snapshot.protectedKeywords,
      ]) as ReadonlyProtectionSettings["protectedKeywords"],
    }) as ReadonlyProtectionSettings;
  }

  function releaseSensitiveState(attempt: ActiveAttempt): void {
    attempt.promptSnapshot = null;
    attempt.findings = [];
    attempt.attachmentStateFingerprint = null;
    invalidateSubmissionAuthorization(attempt.authorization);
    attempt.authorization = null;
  }

  function finish(
    attempt: ActiveAttempt,
    terminal: "cancelled" | "completed",
  ): void {
    releaseSensitiveState(attempt);
    if (active === attempt) {
      active = null;
      state = terminal;
    }
  }

  function newAuditBase() {
    return {
      id: createAuditEventId(eventId()),
      timestamp: createAuditTimestamp(wallClockNow().toISOString()),
      application: "chatgpt" as const,
      adapterVersion: CHATGPT_ADAPTER_VERSION,
    };
  }

  function prepareDecisionMetadata(
    attempt: ActiveAttempt,
    maskedExcerpt?: MaskedPreview,
  ): void {
    const decision = attempt.decision;
    if (decision === null) {
      return;
    }
    attempt.decisionMetadata = {
      policyAction: decision.action,
      detectorCategories: [...decision.contributingCategories],
      matchedRuleIds: [...decision.matchedRuleIds],
      findingCount: attempt.findings.length,
      reasonCode: decision.reasonCode,
      attachmentPresent: decision.attachmentPresent,
      ...(maskedExcerpt === undefined ? {} : { maskedExcerpt }),
    };
  }

  function appendAudit(event: AuditEvent): void {
    try {
      void Promise.resolve(options.audit.append(event)).catch(() => undefined);
    } catch {
      // Audit availability must not reopen or duplicate a stopped submission.
    }
  }

  function appendError(errorCode: EnforcementErrorCode): void {
    appendAudit({
      kind: "enforcement_error",
      ...newAuditBase(),
      errorCode,
    });
  }

  function createDecisionAudit(
    attempt: ActiveAttempt,
    resolution: DecisionResolution,
  ): DecisionAuditEvent {
    const metadata = attempt.decisionMetadata;
    if (metadata === null) {
      throw new Error("Decision audit unavailable.");
    }
    return {
      kind: "decision",
      ...newAuditBase(),
      policyAction: metadata.policyAction,
      resolution,
      detectorCategories: [...metadata.detectorCategories],
      matchedRuleIds: [...metadata.matchedRuleIds],
      findingCount: metadata.findingCount,
      reasonCode: metadata.reasonCode,
      attachmentPresent: metadata.attachmentPresent,
      ...(metadata.maskedExcerpt === undefined
        ? {}
        : { maskedExcerpt: metadata.maskedExcerpt }),
    };
  }

  async function finalizeDecision(
    attempt: ActiveAttempt,
    resolution: DecisionResolution,
  ): Promise<void> {
    if (attempt.eventEmitted) {
      finish(attempt, resolution === "cancelled" ? "cancelled" : "completed");
      return;
    }
    if (attempt.decisionMetadata === null) {
      finish(attempt, "cancelled");
      return;
    }
    attempt.eventEmitted = true;
    const event = createDecisionAudit(attempt, resolution);
    releaseSensitiveState(attempt);
    if (active === attempt) {
      active = null;
      state =
        resolution === "cancelled" || resolution === "blocked"
          ? "cancelled"
          : "completed";
    }
    appendAudit(event);
  }

  async function showError(
    attempt: ActiveAttempt,
    errorCode: EnforcementErrorCode,
  ): Promise<void> {
    if (attempt.eventEmitted) {
      finish(attempt, "cancelled");
      return;
    }
    attempt.eventEmitted = true;
    releaseSensitiveState(attempt);
    appendError(errorCode);
    if (!isCurrent(attempt) && active !== attempt) {
      return;
    }
    if (errorCode === "ui_failure") {
      finish(attempt, "cancelled");
      return;
    }
    state = "dialog";
    try {
      await options.dialog.show({ kind: "error", errorCode });
    } catch {
      // The attempt remains stopped when even the content-free UI is unavailable.
    }
    finish(attempt, "cancelled");
  }

  function resolveValidatedContext(
    attempt: ActiveAttempt,
    expectedPrompt: string,
  ):
    | { kind: "ready"; context: LiveSubmissionContext }
    | { kind: "error"; errorCode: EnforcementErrorCode } {
    let context: LiveSubmissionContext | null;
    try {
      context = options.adapter.resolveSubmissionContext(
        attempt.attempt.contextIdentity,
      );
      if (
        context === null ||
        !options.adapter.matches(context.applicationUrl) ||
        context.contextIdentity !== attempt.attempt.contextIdentity ||
        context.contextVersion !== attempt.attempt.initialContextVersion ||
        !isElementConnected(context.composer) ||
        !isSendControlEnabled(context.sendControl) ||
        options.adapter.readPrompt(context) !== expectedPrompt
      ) {
        return {
          kind: "error",
          errorCode: "extension_context_invalidated",
        };
      }
      const capabilities =
        options.adapter.inspectSubmissionCapabilities(context);
      if (
        capabilities.attachmentPresent !== attempt.attachmentPresent ||
        capabilities.attachmentStateFingerprint !==
          attempt.attachmentStateFingerprint
      ) {
        return {
          kind: "error",
          errorCode: "extension_context_invalidated",
        };
      }
    } catch {
      return { kind: "error", errorCode: "extension_context_invalidated" };
    }
    return { kind: "ready", context };
  }

  function performApprovedResumeSynchronously(
    attempt: ActiveAttempt,
    mode: "unchanged" | "redacted",
  ): ResumeAttemptResult {
    const prompt = attempt.promptSnapshot;
    const authorization = attempt.authorization;
    if (!isCurrent(attempt) || prompt === null || authorization === null) {
      return { kind: "authorization_invalid" };
    }

    const currentResult = resolveValidatedContext(attempt, prompt);
    if (currentResult.kind === "error") {
      return currentResult;
    }
    const current = currentResult.context;

    let resumeContext = current;
    if (mode === "redacted") {
      if (
        options.adapter.getPromptReplacementCapability(current) !== "supported"
      ) {
        return { kind: "error", errorCode: "redaction_unavailable" };
      }
      let sanitizedText: string;
      try {
        sanitizedText = redact(prompt, attempt.findings).sanitizedText;
      } catch {
        return { kind: "error", errorCode: "detector_failure" };
      }
      try {
        const replacement = options.adapter.replacePrompt(
          current,
          sanitizedText,
        );
        if (!replacement.ok || replacement.verifiedText !== sanitizedText) {
          return { kind: "error", errorCode: "redaction_unavailable" };
        }
      } catch {
        return { kind: "error", errorCode: "redaction_unavailable" };
      }
      const afterReplacementResult = resolveValidatedContext(
        attempt,
        sanitizedText,
      );
      if (afterReplacementResult.kind === "error") {
        return afterReplacementResult;
      }
      resumeContext = afterReplacementResult.context;
    }

    const consumed = consumeSubmissionAuthorization(
      authorization,
      attempt.attempt.id,
      monotonicNow(),
    );
    if (!isCurrent(attempt) || consumed === null) {
      return { kind: "authorization_invalid" };
    }

    try {
      if (!isCurrent(attempt)) {
        return { kind: "authorization_invalid" };
      }
      options.adapter.resumeSubmission(resumeContext, consumed);
    } catch {
      return { kind: "error", errorCode: "resume_failure" };
    }
    return { kind: "resumed" };
  }

  async function resumeApproved(
    attempt: ActiveAttempt,
    mode: "unchanged" | "redacted",
    resolution: DecisionResolution,
  ): Promise<void> {
    state = "resuming";
    const result = performApprovedResumeSynchronously(attempt, mode);
    releaseSensitiveState(attempt);
    if (result.kind === "resumed") {
      await finalizeDecision(attempt, resolution);
      return;
    }
    if (
      attempt.decisionMetadata?.policyAction === "warn" &&
      (result.kind === "authorization_invalid" ||
        (result.kind === "error" &&
          result.errorCode === "extension_context_invalidated"))
    ) {
      await finalizeDecision(attempt, "cancelled");
      return;
    }
    await showError(
      attempt,
      result.kind === "error"
        ? result.errorCode
        : "extension_context_invalidated",
    );
  }

  async function processAttempt(attempt: ActiveAttempt): Promise<void> {
    if (!isCurrent(attempt)) {
      finish(attempt, "cancelled");
      return;
    }
    const capture = capturePromptSynchronously(
      options.adapter,
      attempt.attempt,
    );
    if (capture.kind === "error") {
      await showError(attempt, capture.errorCode);
      return;
    }
    attempt.promptSnapshot = capture.prompt;
    attempt.replacementCapability = capture.replacementCapability;
    attempt.attachmentPresent = capture.attachmentPresent;
    attempt.attachmentStateFingerprint = capture.attachmentStateFingerprint;

    if (!isCurrent(attempt) || attempt.promptSnapshot === null) {
      finish(attempt, "cancelled");
      return;
    }
    if (attempt.promptSnapshot.length > MAX_PROMPT_CODE_UNITS) {
      await showError(attempt, "prompt_too_large");
      return;
    }

    try {
      attempt.findings = analyze(attempt.promptSnapshot, {
        protectedKeywords: attempt.settings.protectedKeywords,
      });
    } catch {
      await showError(attempt, "detector_failure");
      return;
    }
    if (!isCurrent(attempt)) {
      finish(attempt, "cancelled");
      return;
    }

    try {
      attempt.decision = evaluate({
        surfaceId: options.adapter.descriptor.surfaceId,
        attachmentPresent: attempt.attachmentPresent,
        findings: toPolicyFindings(attempt.findings),
        policy: derivePolicy(attempt.settings),
      });
    } catch {
      await showError(attempt, "policy_failure");
      return;
    }

    const decision = attempt.decision;
    attempt.findings = attempt.findings.filter((finding) =>
      decision.contributingCategories.includes(finding.category),
    );
    prepareDecisionMetadata(attempt);
    if (
      decision.action === "redact" &&
      attempt.replacementCapability !== "supported"
    ) {
      await showError(attempt, "redaction_unavailable");
      return;
    }
    if (decision.action !== "block") {
      attempt.authorization = createSubmissionAuthorization(
        attempt.attempt.id,
        monotonicNow(),
      );
    }

    switch (decision.action) {
      case "allow":
        await resumeApproved(attempt, "unchanged", "submitted");
        return;
      case "redact":
        await resumeApproved(attempt, "redacted", "redacted");
        return;
      case "block": {
        if (!isCurrent(attempt)) {
          finish(attempt, "cancelled");
          return;
        }
        const model = createSubmissionDialogModel(
          "block",
          decision,
          attempt.findings,
          false,
          attempt.attachmentPresent,
        );
        prepareDecisionMetadata(attempt, model.maskedPreview);
        state = "dialog";
        try {
          await options.dialog.show(model);
        } catch {
          await showError(attempt, "ui_failure");
          return;
        }
        if (attempt.uiFailed) {
          await showError(attempt, "ui_failure");
          return;
        }
        await finalizeDecision(attempt, "blocked");
        return;
      }
      case "warn": {
        if (!isCurrent(attempt)) {
          finish(attempt, "cancelled");
          return;
        }
        const model = createSubmissionDialogModel(
          "warn",
          decision,
          attempt.findings,
          attempt.replacementCapability === "supported",
          attempt.attachmentPresent,
        );
        prepareDecisionMetadata(attempt, model.maskedPreview);
        state = "dialog";
        let intent: ProtectionDialogIntent;
        try {
          intent = await options.dialog.show(model);
        } catch {
          await showError(attempt, "ui_failure");
          return;
        }
        if (attempt.uiFailed) {
          await showError(attempt, "ui_failure");
          return;
        }
        if (!isCurrent(attempt) || intent === "cancel") {
          await finalizeDecision(attempt, "cancelled");
          return;
        }
        if (intent === "redact") {
          await resumeApproved(attempt, "redacted", "redacted");
          return;
        }
        if (intent !== "bypass") {
          await finalizeDecision(attempt, "cancelled");
          return;
        }
        await resumeApproved(
          attempt,
          "unchanged",
          decision.reasonCode === "unsupported_attachment"
            ? "attachment_bypassed"
            : "bypassed",
        );
      }
    }
  }

  function handleCapturedAttempt(
    captured: CapturedSubmitAttempt,
  ): SubmitInterceptionDisposition {
    if (disposed || !isProtectionEnabled()) {
      return "pass_through";
    }
    if (active !== null) {
      return "intercept";
    }
    let revision: EnforcementRevision;
    let settings: ReadonlyProtectionSettings;
    try {
      revision = currentRevision();
      settings = snapshotSettings(options.settings());
    } catch {
      return "intercept";
    }
    generation += 1;
    const attempt: ActiveAttempt = {
      attempt: {
        id: captured.id,
        source: captured.source,
        contextIdentity: captured.contextIdentity,
        initialContextVersion: captured.initialContextVersion,
      },
      generation,
      revision,
      settings,
      promptSnapshot: null,
      authorization: null,
      cancelled: false,
      uiFailed: false,
      decision: null,
      decisionMetadata: null,
      findings: [],
      eventEmitted: false,
      replacementCapability: "unsupported",
      attachmentPresent: false,
      attachmentStateFingerprint: null,
    };
    active = attempt;
    state = "evaluating";
    pending = Promise.resolve()
      .then(() => processAttempt(attempt))
      .catch(async () => {
        if (active === attempt) {
          await showError(attempt, "extension_context_invalidated");
        }
      });
    return "intercept";
  }

  function safelyCancelDialog(): void {
    try {
      options.dialog.cancel();
    } catch {
      // Cancellation cleanup and audit finalization are controller-owned.
    }
  }

  function cancelAttemptImmediately(attempt: ActiveAttempt): void {
    if (attempt.cancelled) {
      return;
    }
    attempt.cancelled = true;
    releaseSensitiveState(attempt);
    safelyCancelDialog();

    const policyAction = attempt.decisionMetadata?.policyAction;
    if (policyAction === "warn") {
      pending = finalizeDecision(attempt, "cancelled");
    } else if (policyAction === "block") {
      pending = finalizeDecision(attempt, "blocked");
    } else {
      finish(attempt, "cancelled");
      pending = Promise.resolve();
    }
  }

  return {
    register() {
      if (disposed) {
        throw new Error("Submission controller is disposed.");
      }
      if (registeredDisposer !== null) {
        return registeredDisposer;
      }
      const adapterDisposer = options.adapter.registerSubmitInterceptor(
        handleCapturedAttempt,
      );
      const disposeRegistration = (): void => {
        if (registeredDisposer !== disposeRegistration) {
          return;
        }
        adapterDisposer();
        registeredDisposer = null;
      };
      registeredDisposer = disposeRegistration;
      return disposeRegistration;
    },
    handleCapturedAttempt,
    cancelActiveAttempt() {
      const attempt = active;
      if (attempt === null) {
        return;
      }
      cancelAttemptImmediately(attempt);
    },
    reportDialogRenderFailure() {
      const attempt = active;
      if (attempt === null || state !== "dialog" || attempt.uiFailed) {
        return;
      }
      attempt.uiFailed = true;
      releaseSensitiveState(attempt);
      pending = showError(attempt, "ui_failure");
    },
    dispose() {
      if (disposed) {
        return;
      }
      disposed = true;
      registeredDisposer?.();
      const attempt = active;
      if (attempt !== null) {
        cancelAttemptImmediately(attempt);
      }
    },
    whenSettledForTesting() {
      return pending;
    },
    getDiagnosticsForTesting() {
      return {
        state,
        hasActiveAttempt: active !== null,
        hasPromptSnapshot: active?.promptSnapshot !== null && active !== null,
        hasSensitiveFindings: (active?.findings.length ?? 0) > 0,
        hasAuthorization: active?.authorization !== null && active !== null,
      };
    },
  };
}
