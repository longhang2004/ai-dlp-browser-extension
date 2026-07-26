import type { SensitiveDataFinding } from "@ai-dlp/shared-types";

import type {
  ChatApplicationAdapter,
  LiveSubmissionContext,
} from "./chat-application-adapter.js";

declare const adapter: ChatApplicationAdapter;
declare const context: LiveSubmissionContext;
declare const finding: SensitiveDataFinding;

// @ts-expect-error Detector findings are not adapter input.
adapter.readPrompt(finding);

// @ts-expect-error Resume accepts only controller-consumed authorization.
adapter.resumeSubmission(context, finding);

// @ts-expect-error Interceptors receive metadata-only attempts, not findings.
adapter.registerSubmitInterceptor((attempt: SensitiveDataFinding) => {
  void attempt;
  return "intercept";
});
