import type {
  AdapterDescriptor,
  AdapterHealthCode,
} from "@ai-dlp/shared-types";

export type SubmitSource = "click" | "enter";

export type SubmitInterceptionDisposition = "pass_through" | "intercept";

export type CapturedSubmitAttempt = {
  id: string;
  source: SubmitSource;
  contextIdentity: number;
  initialContextVersion: number;
};

export type LiveSubmissionContext = {
  composer: HTMLElement;
  sendControl: HTMLElement;
  submissionRegion: HTMLElement;
  applicationUrl: URL;
  contextIdentity: number;
  contextVersion: number;
};

declare const attachmentStateFingerprintBrand: unique symbol;

export type AttachmentStateFingerprint = {
  readonly [attachmentStateFingerprintBrand]: true;
};

export type SubmissionContentCapabilities = {
  attachmentPresent: boolean;
  attachmentStateFingerprint: AttachmentStateFingerprint;
};

export type PromptReplacementCapability = "supported" | "unsupported";

export type PromptReplacementResult =
  | { ok: true; verifiedText: string }
  | {
      ok: false;
      reason:
        | "unsupported_editor"
        | "replacement_not_acknowledged"
        | "context_changed";
    };

declare const consumedSubmissionAuthorizationBrand: unique symbol;

export type ConsumedSubmissionAuthorization = {
  readonly [consumedSubmissionAuthorizationBrand]: true;
  readonly attemptId: string;
};

export type SubmitInterceptor = (
  attempt: CapturedSubmitAttempt,
) => SubmitInterceptionDisposition;

export type AdapterHealthTransition =
  | { status: "waiting_for_composer" }
  | { status: "healthy" }
  | { status: "degraded"; healthCode: AdapterHealthCode };

export interface ChatApplicationAdapter {
  readonly descriptor: AdapterDescriptor;

  matches(url: URL): boolean;
  resolveCurrentSubmissionContext(): LiveSubmissionContext | null;
  resolveSubmissionContext(
    contextIdentity: number,
  ): LiveSubmissionContext | null;
  inspectSubmissionCapabilities(
    context: LiveSubmissionContext,
  ): SubmissionContentCapabilities;
  getPromptReplacementCapability(
    context: LiveSubmissionContext,
  ): PromptReplacementCapability;
  readPrompt(context: LiveSubmissionContext): string;
  replacePrompt(
    context: LiveSubmissionContext,
    text: string,
  ): PromptReplacementResult;
  registerSubmitInterceptor(handler: SubmitInterceptor): () => void;
  resumeSubmission(
    context: LiveSubmissionContext,
    authorization: ConsumedSubmissionAuthorization,
  ): void;
  dispose(): void;
}
