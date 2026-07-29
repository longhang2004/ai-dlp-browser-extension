import { createDefaultProtectionSettings } from "@ai-dlp/shared-types";

import type { ChatApplicationAdapter } from "../adapters/chat-application-adapter.js";
import type { ProtectionDialogController } from "../ui/protection-dialog/dialog-controller.js";
import type { SubmissionControllerOptions } from "./submission-controller.js";

declare const adapter: ChatApplicationAdapter;
declare const dialog: Pick<ProtectionDialogController, "show" | "cancel">;

// @ts-expect-error Every controller must be bound to an enforcement revision.
const missingRevision: SubmissionControllerOptions = {
  adapter,
  settings: () => createDefaultProtectionSettings(),
  dialog,
  audit: { append: () => undefined },
};
void missingRevision;
