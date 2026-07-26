import type { RuntimeRequest } from "@ai-dlp/shared-types";

export type RuntimeSender = {
  id?: string;
  url?: string;
  origin?: string | null;
  frameId?: number;
  documentId?: string;
};

const EXTENSION_PAGE_PATHS = new Set([
  "/popup.html",
  "/options.html",
  "/audit.html",
]);

function parseUrl(value: string | undefined): URL | undefined {
  if (value === undefined) return undefined;
  try {
    return new URL(value);
  } catch {
    return undefined;
  }
}

function hasValidOptionalTopFrameFields(sender: RuntimeSender): boolean {
  return (
    (sender.frameId === undefined || sender.frameId === 0) &&
    (sender.documentId === undefined || sender.documentId.length > 0)
  );
}

export function isValidExtensionPageSender(
  sender: RuntimeSender,
  runtimeId: string,
): boolean {
  if (sender.id !== runtimeId || !hasValidOptionalTopFrameFields(sender)) {
    return false;
  }
  const url = parseUrl(sender.url);
  if (
    url === undefined ||
    url.protocol !== "chrome-extension:" ||
    url.hostname !== runtimeId ||
    url.username !== "" ||
    url.password !== "" ||
    url.port !== "" ||
    !EXTENSION_PAGE_PATHS.has(url.pathname)
  ) {
    return false;
  }
  return sender.origin === `chrome-extension://${runtimeId}`;
}

export function isValidSettingsPortSender(
  sender: RuntimeSender | undefined,
  runtimeId: string,
): boolean {
  if (
    sender === undefined ||
    sender.id !== runtimeId ||
    sender.frameId !== 0 ||
    (sender.documentId !== undefined && sender.documentId.length === 0)
  ) {
    return false;
  }
  const url = parseUrl(sender.url);
  if (
    url === undefined ||
    url.protocol !== "https:" ||
    url.hostname !== "chatgpt.com" ||
    url.username !== "" ||
    url.password !== "" ||
    url.port !== ""
  ) {
    return false;
  }
  return sender.origin === "https://chatgpt.com";
}

export function isAllowedRuntimeSender(
  request: Pick<RuntimeRequest, "type">,
  sender: RuntimeSender,
  runtimeId: string,
): boolean {
  return request.type === "audit.append"
    ? isValidSettingsPortSender(sender, runtimeId)
    : isValidExtensionPageSender(sender, runtimeId);
}
