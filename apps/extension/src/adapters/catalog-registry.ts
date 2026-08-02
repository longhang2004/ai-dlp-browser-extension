import type { AdapterDescriptor } from "@ai-dlp/shared-types";

import type {
  AdapterLifecycleOptions,
  ChatApplicationAdapter,
} from "./chat-application-adapter.js";

export type CatalogAdapterFactory = (
  descriptor: AdapterDescriptor,
  document: Document,
  adapterOptions: Omit<AdapterLifecycleOptions, "document">,
) => ChatApplicationAdapter | null;

export type DocumentAdapterRegistry = {
  readonly descriptor: AdapterDescriptor;
  readonly adapter: ChatApplicationAdapter;
  dispose(): void;
};

const activeRegistries = new WeakMap<Document, DocumentAdapterRegistry>();

function createImmutableAdapterFacade(
  adapter: ChatApplicationAdapter,
  descriptor: AdapterDescriptor,
  dispose: () => void,
): ChatApplicationAdapter {
  const facade = Object.create(null) as ChatApplicationAdapter;
  const immutable = (value: unknown): PropertyDescriptor => ({
    configurable: false,
    enumerable: true,
    value,
    writable: false,
  });

  Object.defineProperties(facade, {
    descriptor: immutable(descriptor),
    matches: immutable(adapter.matches.bind(adapter)),
    resolveCurrentSubmissionContext: immutable(
      adapter.resolveCurrentSubmissionContext.bind(adapter),
    ),
    resolveSubmissionContext: immutable(
      adapter.resolveSubmissionContext.bind(adapter),
    ),
    inspectSubmissionCapabilities: immutable(
      adapter.inspectSubmissionCapabilities.bind(adapter),
    ),
    getPromptReplacementCapability: immutable(
      adapter.getPromptReplacementCapability.bind(adapter),
    ),
    readPrompt: immutable(adapter.readPrompt.bind(adapter)),
    replacePrompt: immutable(adapter.replacePrompt.bind(adapter)),
    registerSubmitInterceptor: immutable(
      adapter.registerSubmitInterceptor.bind(adapter),
    ),
    resumeSubmission: immutable(adapter.resumeSubmission.bind(adapter)),
    dispose: immutable(dispose),
  });

  return Object.freeze(facade);
}

export function createDocumentAdapterRegistryWithFactory(options: {
  document: Document;
  entryPoint: string;
  descriptor: AdapterDescriptor;
  adapterOptions?: Omit<AdapterLifecycleOptions, "document">;
  constructAdapter: CatalogAdapterFactory;
}): DocumentAdapterRegistry | null {
  const { document, entryPoint } = options;
  const origin = document.defaultView?.location.origin;
  if (origin === undefined) return null;
  if (
    options.descriptor.entryPoint !== entryPoint ||
    !options.descriptor.origins.includes(origin)
  ) {
    return null;
  }
  const catalogDescriptor = options.descriptor;

  const activeRegistry = activeRegistries.get(document);
  if (activeRegistry !== undefined) return activeRegistry;

  let adapter: ChatApplicationAdapter | null;
  try {
    const catalogDescriptor = options.descriptor;
    adapter = options.constructAdapter(
      catalogDescriptor,
      document,
      options.adapterOptions ?? {},
    );
  } catch {
    return null;
  }
  if (adapter === null || adapter.descriptor !== catalogDescriptor) {
    adapter?.dispose();
    return null;
  }
  let disposed = false;
  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    if (activeRegistries.get(document) === registry) {
      activeRegistries.delete(document);
    }
    adapter.dispose();
  };
  const registryOwnedAdapter = createImmutableAdapterFacade(
    adapter,
    catalogDescriptor,
    dispose,
  );
  const registry: DocumentAdapterRegistry = Object.freeze({
    descriptor: catalogDescriptor,
    adapter: registryOwnedAdapter,
    dispose,
  });
  activeRegistries.set(document, registry);
  return registry;
}
