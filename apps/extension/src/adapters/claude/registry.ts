import { CLAUDE_ADAPTER_DESCRIPTOR } from "../adapter-catalog.js";
import {
  createDocumentAdapterRegistryWithFactory,
  type DocumentAdapterRegistry,
} from "../catalog-registry.js";
import type { AdapterLifecycleOptions } from "../chat-application-adapter.js";
import { ClaudeAdapter } from "./claude-adapter.js";

export function createClaudeDocumentAdapterRegistry(options: {
  document: Document;
  entryPoint: string;
  adapterOptions?: Omit<AdapterLifecycleOptions, "document">;
}): DocumentAdapterRegistry | null {
  return createDocumentAdapterRegistryWithFactory({
    ...options,
    descriptor: CLAUDE_ADAPTER_DESCRIPTOR,
    constructAdapter: (descriptor, document, adapterOptions) =>
      descriptor === CLAUDE_ADAPTER_DESCRIPTOR
        ? new ClaudeAdapter({ document, ...adapterOptions })
        : null,
  });
}
