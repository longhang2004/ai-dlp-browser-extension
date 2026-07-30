import type {
  AdapterDescriptor,
  SensitiveDataFinding,
} from "@ai-dlp/shared-types";

import type {
  ChatApplicationAdapter,
  LiveSubmissionContext,
} from "./chat-application-adapter.js";

declare const adapter: ChatApplicationAdapter;
declare const context: LiveSubmissionContext;
declare const finding: SensitiveDataFinding;

const descriptor: AdapterDescriptor = adapter.descriptor;
void descriptor;
// @ts-expect-error Adapter identity is exposed only through the descriptor.
const removedAdapterId = adapter.id;
// @ts-expect-error Adapter version is exposed only through the descriptor.
const removedAdapterVersion = adapter.version;
void removedAdapterId;
void removedAdapterVersion;
// @ts-expect-error The adapter descriptor reference is immutable.
adapter.descriptor = descriptor;
// @ts-expect-error Nested descriptor capabilities are immutable.
adapter.descriptor.capabilities.submissionResume = "unsupported";

// @ts-expect-error Detector findings are not adapter input.
adapter.readPrompt(finding);

// @ts-expect-error Resume accepts only controller-consumed authorization.
adapter.resumeSubmission(context, finding);

// @ts-expect-error Interceptors receive metadata-only attempts, not findings.
adapter.registerSubmitInterceptor((attempt: SensitiveDataFinding) => {
  void attempt;
  return "intercept";
});
