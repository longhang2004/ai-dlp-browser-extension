export type SubmitSource = "click" | "enter";

export type SubmitInterceptionDisposition = "pass_through" | "intercept";

export type CapturedSubmitAttempt = {
  id: string;
  source: SubmitSource;
  initialContextVersion: number;
};

export type LiveSubmissionContext = {
  composer: HTMLElement;
  sendControl: HTMLElement;
  applicationUrl: URL;
  contextVersion: number;
};

export type SubmissionContentCapabilities = {
  hasUnsupportedAttachment: boolean;
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

export interface ChatApplicationAdapter {
  readonly id: "chatgpt";
  readonly version: string;

  matches(url: URL): boolean;
  resolveCurrentSubmissionContext(): LiveSubmissionContext | null;
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
