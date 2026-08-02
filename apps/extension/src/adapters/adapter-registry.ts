import type { AdapterDescriptor } from "@ai-dlp/shared-types";

import {
  CLAUDE_ADAPTER_DESCRIPTOR,
  CHATGPT_ADAPTER_DESCRIPTOR,
} from "./adapter-catalog.js";
import {
  createDocumentAdapterRegistryWithFactory,
  type DocumentAdapterRegistry,
} from "./catalog-registry.js";
import type {
  AdapterLifecycleOptions,
  ChatApplicationAdapter,
} from "./chat-application-adapter.js";
import { ClaudeAdapter } from "./claude/claude-adapter.js";
import { ChatGptAdapter } from "./chatgpt/chatgpt-adapter.js";

export type { DocumentAdapterRegistry } from "./catalog-registry.js";

function constructCatalogAdapter(
  descriptor: AdapterDescriptor,
  document: Document,
  adapterOptions: Omit<AdapterLifecycleOptions, "document">,
): ChatApplicationAdapter | null {
  if (descriptor === CHATGPT_ADAPTER_DESCRIPTOR) {
    return new ChatGptAdapter({ document, ...adapterOptions });
  }
  if (descriptor === CLAUDE_ADAPTER_DESCRIPTOR) {
    return new ClaudeAdapter({ document, ...adapterOptions });
  }
  return null;
}

export function createDocumentAdapterRegistry(options: {
  document: Document;
  entryPoint: string;
  adapterOptions?: Omit<AdapterLifecycleOptions, "document">;
}): DocumentAdapterRegistry | null {
  const origin = options.document.defaultView?.location.origin;
  const descriptor =
    origin === CHATGPT_ADAPTER_DESCRIPTOR.origins[0]
      ? CHATGPT_ADAPTER_DESCRIPTOR
      : origin === CLAUDE_ADAPTER_DESCRIPTOR.origins[0]
        ? CLAUDE_ADAPTER_DESCRIPTOR
        : null;
  if (descriptor === null) return null;
  return createDocumentAdapterRegistryWithFactory({
    ...options,
    descriptor,
    constructAdapter: constructCatalogAdapter,
  });
}
