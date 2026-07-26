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
  readPrompt(context: LiveSubmissionContext): string;
  replacePrompt(context: LiveSubmissionContext, text: string): void;
  registerSubmitInterceptor(handler: SubmitInterceptor): () => void;
  resumeSubmission(
    context: LiveSubmissionContext,
    authorization: ConsumedSubmissionAuthorization,
  ): void;
  dispose(): void;
}
