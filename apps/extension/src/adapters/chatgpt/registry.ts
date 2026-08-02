import { CHATGPT_ADAPTER_DESCRIPTOR } from "../adapter-catalog.js";
import {
  createDocumentAdapterRegistryWithFactory,
  type DocumentAdapterRegistry,
} from "../catalog-registry.js";
import type { AdapterLifecycleOptions } from "../chat-application-adapter.js";
import { ChatGptAdapter } from "./chatgpt-adapter.js";

export function createChatGptDocumentAdapterRegistry(options: {
  document: Document;
  entryPoint: string;
  adapterOptions?: Omit<AdapterLifecycleOptions, "document">;
}): DocumentAdapterRegistry | null {
  return createDocumentAdapterRegistryWithFactory({
    ...options,
    descriptor: CHATGPT_ADAPTER_DESCRIPTOR,
    constructAdapter: (descriptor, document, adapterOptions) =>
      descriptor === CHATGPT_ADAPTER_DESCRIPTOR
        ? new ChatGptAdapter({ document, ...adapterOptions })
        : null,
  });
}
