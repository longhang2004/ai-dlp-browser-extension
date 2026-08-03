import {
  isRuntimeResponse,
  type RuntimeRequest,
  type RuntimeResponse,
} from "@ai-dlp/shared-types";

export type ExtensionPageRuntime = {
  sendMessage(message: RuntimeRequest): Promise<unknown> | unknown;
};

export async function sendPageRequest(
  runtime: ExtensionPageRuntime,
  request: RuntimeRequest,
): Promise<RuntimeResponse> {
  const response: unknown = await runtime.sendMessage(structuredClone(request));
  if (!isRuntimeResponse(response)) {
    throw new Error("Invalid extension response.");
  }
  return structuredClone(response);
}

export function getInstalledPageRuntime(): ExtensionPageRuntime {
  if (typeof chrome === "undefined" || chrome.runtime === undefined) {
    throw new Error("Extension runtime is unavailable.");
  }
  return {
    sendMessage(message) {
      return chrome.runtime.sendMessage<RuntimeRequest, unknown>(message);
    },
  };
}
