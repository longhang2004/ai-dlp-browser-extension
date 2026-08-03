import type { AdapterDescriptor } from "@ai-dlp/shared-types";

import type { ChatApplicationAdapter } from "./chat-application-adapter.js";
import {
  CHATGPT_ADAPTER_DESCRIPTOR,
  findExecutableAdapterByOrigin,
} from "./adapter-catalog.js";
import {
  ChatGptAdapter,
  type ChatGptAdapterOptions,
} from "./chatgpt/chatgpt-adapter.js";

export type DocumentAdapterRegistry = {
  readonly descriptor: AdapterDescriptor;
  readonly adapter: ChatApplicationAdapter;
  dispose(): void;
};

const activeRegistries = new WeakMap<Document, DocumentAdapterRegistry>();

function constructCatalogAdapter(
  descriptor: AdapterDescriptor,
  document: Document,
  adapterOptions: Pick<
    ChatGptAdapterOptions,
    "onAdapterError" | "onHealthTransition"
  >,
): ChatApplicationAdapter | null {
  if (descriptor !== CHATGPT_ADAPTER_DESCRIPTOR) return null;
  return new ChatGptAdapter({ document, ...adapterOptions });
}

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

export function createDocumentAdapterRegistry(options: {
  document: Document;
  entryPoint: string;
  adapterOptions?: Pick<
    ChatGptAdapterOptions,
    "onAdapterError" | "onHealthTransition"
  >;
}): DocumentAdapterRegistry | null {
  const { document, entryPoint } = options;
  const origin = document.defaultView?.location.origin;
  if (origin === undefined) return null;

  const descriptor = findExecutableAdapterByOrigin(origin);
  if (descriptor === null || descriptor.entryPoint !== entryPoint) return null;

  const activeRegistry = activeRegistries.get(document);
  if (activeRegistry !== undefined) return activeRegistry;

  let adapter: ChatApplicationAdapter | null;
  try {
    adapter = constructCatalogAdapter(
      descriptor,
      document,
      options.adapterOptions ?? {},
    );
  } catch {
    return null;
  }
  if (adapter === null || adapter.descriptor !== descriptor) {
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
    descriptor,
    dispose,
  );
  const registry: DocumentAdapterRegistry = Object.freeze({
    descriptor,
    adapter: registryOwnedAdapter,
    dispose,
  });
  activeRegistries.set(document, registry);
  return registry;
}
