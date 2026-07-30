import type { AdapterDescriptor, RuntimeRequest } from "@ai-dlp/shared-types";

import { findExecutableAdapterByOrigin } from "../adapters/adapter-catalog.js";

export type RuntimeSender = {
  id?: string;
  url?: string;
  origin?: string | null;
  frameId?: number;
  documentId?: string;
};

export type RuntimeSenderAuthorization =
  | { readonly source: "extension_page" }
  | {
      readonly source: "content_script";
      readonly descriptor: AdapterDescriptor;
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
  return resolveSettingsPortSenderDescriptor(sender, runtimeId) !== null;
}

export function resolveSettingsPortSenderDescriptor(
  sender: RuntimeSender | undefined,
  runtimeId: string,
): AdapterDescriptor | null {
  if (
    sender === undefined ||
    sender.id !== runtimeId ||
    sender.frameId !== 0 ||
    (sender.documentId !== undefined && sender.documentId.length === 0)
  ) {
    return null;
  }
  const url = parseUrl(sender.url);
  if (
    url === undefined ||
    url.protocol !== "https:" ||
    url.username !== "" ||
    url.password !== ""
  ) {
    return null;
  }
  const derivedOrigin = url.origin;
  if (sender.origin !== undefined && sender.origin !== derivedOrigin) {
    return null;
  }
  return findExecutableAdapterByOrigin(derivedOrigin);
}

export function isAllowedRuntimeSender(
  request: Pick<RuntimeRequest, "type">,
  sender: RuntimeSender,
  runtimeId: string,
): boolean {
  return resolveRuntimeSenderAuthorization(request, sender, runtimeId) !== null;
}

export function resolveRuntimeSenderAuthorization(
  request: Pick<RuntimeRequest, "type">,
  sender: RuntimeSender,
  runtimeId: string,
): RuntimeSenderAuthorization | null {
  if (request.type === "audit.append") {
    const descriptor = resolveSettingsPortSenderDescriptor(sender, runtimeId);
    return descriptor === null
      ? null
      : { source: "content_script", descriptor };
  }
  return isValidExtensionPageSender(sender, runtimeId)
    ? { source: "extension_page" }
    : null;
}
