/// <reference types="node" />

import { readFileSync } from "node:fs";

import { describe, expect, it, vi } from "vitest";

import { CHATGPT_ADAPTER_DESCRIPTOR } from "./adapter-catalog.js";
import {
  createDocumentAdapterRegistry,
  type DocumentAdapterRegistry,
} from "./adapter-registry.js";
import { ChatGptAdapter } from "./chatgpt/chatgpt-adapter.js";

function fakeDocument(origin: string): Document {
  return {
    defaultView: {
      location: { origin },
    },
  } as unknown as Document;
}

function createRegistry(
  origin: string,
  entryPoint = "content-script.js",
  extra: Record<string, unknown> = {},
): DocumentAdapterRegistry | null {
  return createDocumentAdapterRegistry({
    document: fakeDocument(origin),
    entryPoint,
    ...extra,
  });
}

describe("document adapter registry", () => {
  it("constructs ChatGPT only for the catalog origin and entry point", () => {
    const registry = createRegistry("https://chatgpt.com");

    expect(registry?.descriptor).toBe(CHATGPT_ADAPTER_DESCRIPTOR);
    expect(registry?.adapter.descriptor).toBe(CHATGPT_ADAPTER_DESCRIPTOR);
    registry?.dispose();
  });

  it.each([
    ["Claude", "https://claude.ai", "content-script.js"],
    ["unknown origin", "https://unknown.example", "content-script.js"],
    ["ChatGPT alternate port", "https://chatgpt.com:8443", "content-script.js"],
    ["wrong entry point", "https://chatgpt.com", "claude-content-script.js"],
  ])(
    "constructs no prompt-reading adapter for %s",
    (_label, origin, entryPoint) => {
      expect(createRegistry(origin, entryPoint)).toBeNull();
    },
  );

  it("does not let page or runtime metadata choose or strengthen identity", () => {
    const registry = createRegistry(
      "https://chatgpt.com",
      "content-script.js",
      {
        descriptor: {
          adapterId: "claude",
          surfaceId: "claude_web",
          trust: "verified",
          capabilities: {
            promptRead: "verified",
            submissionResume: "verified",
          },
        },
        origins: ["https://claude.ai"],
        version: "page-controlled",
      },
    );

    expect(registry?.descriptor).toBe(CHATGPT_ADAPTER_DESCRIPTOR);
    expect(registry?.descriptor.origins).toEqual(["https://chatgpt.com"]);
    registry?.dispose();
  });

  it("allows at most one adapter registry per document", () => {
    const document = fakeDocument("https://chatgpt.com");
    const first = createDocumentAdapterRegistry({
      document,
      entryPoint: "content-script.js",
    });
    const second = createDocumentAdapterRegistry({
      document,
      entryPoint: "content-script.js",
    });

    expect(first).not.toBeNull();
    expect(second).toBe(first);
    first?.dispose();
  });

  it("routes adapter disposal through idempotent registry cleanup", () => {
    const document = fakeDocument("https://chatgpt.com");
    const underlyingDispose = vi.spyOn(ChatGptAdapter.prototype, "dispose");
    const registry = createDocumentAdapterRegistry({
      document,
      entryPoint: "content-script.js",
    });
    expect(registry).not.toBeNull();
    if (registry === null) throw new Error("Expected ChatGPT registry.");

    registry.adapter.dispose();
    registry.adapter.dispose();
    registry.dispose();

    expect(underlyingDispose).toHaveBeenCalledTimes(1);
    const replacement = createDocumentAdapterRegistry({
      document,
      entryPoint: "content-script.js",
    });
    expect(replacement).not.toBe(registry);
    replacement?.dispose();
    expect(underlyingDispose).toHaveBeenCalledTimes(2);
    underlyingDispose.mockRestore();
  });

  it("exposes only the exact immutable null-prototype adapter facade", () => {
    const registry = createRegistry("https://chatgpt.com");
    expect(registry).not.toBeNull();
    if (registry === null) throw new Error("Expected ChatGPT registry.");

    expect(Reflect.getPrototypeOf(registry.adapter)).toBeNull();
    expect(Object.isFrozen(registry.adapter)).toBe(true);
    expect(registry.adapter).not.toBeInstanceOf(ChatGptAdapter);
    expect(
      Object.prototype.isPrototypeOf.call(
        ChatGptAdapter.prototype,
        registry.adapter,
      ),
    ).toBe(false);
    expect(Reflect.ownKeys(registry.adapter).sort()).toEqual(
      [
        "descriptor",
        "dispose",
        "getPromptReplacementCapability",
        "inspectSubmissionCapabilities",
        "matches",
        "readPrompt",
        "registerSubmitInterceptor",
        "replacePrompt",
        "resolveCurrentSubmissionContext",
        "resolveSubmissionContext",
        "resumeSubmission",
      ].sort(),
    );
    expect(
      Object.getOwnPropertyDescriptor(registry.adapter, "descriptor"),
    ).toEqual({
      configurable: false,
      enumerable: true,
      value: CHATGPT_ADAPTER_DESCRIPTOR,
      writable: false,
    });
    expect(registry.adapter.descriptor).toBe(CHATGPT_ADAPTER_DESCRIPTOR);

    const matches = registry.adapter.matches;
    const resolveSubmissionContext = registry.adapter.resolveSubmissionContext;
    expect(matches(new URL("https://chatgpt.com/"))).toBe(true);
    expect(resolveSubmissionContext(1)).toBeNull();

    registry.dispose();
  });

  it("pins the adapter descriptor to the catalog singleton across reflection", () => {
    const document = fakeDocument("https://chatgpt.com");
    const underlyingDispose = vi.spyOn(ChatGptAdapter.prototype, "dispose");
    const registry = createDocumentAdapterRegistry({
      document,
      entryPoint: "content-script.js",
    });
    expect(registry).not.toBeNull();
    if (registry === null) throw new Error("Expected ChatGPT registry.");

    const replacementDescriptor = {
      ...CHATGPT_ADAPTER_DESCRIPTOR,
      version: `${CHATGPT_ADAPTER_DESCRIPTOR.version}-mutated`,
    };
    expect(
      Reflect.set(registry.adapter, "descriptor", replacementDescriptor),
    ).toBe(false);
    expect(
      Reflect.defineProperty(registry.adapter, "descriptor", {
        configurable: true,
        value: replacementDescriptor,
      }),
    ).toBe(false);
    expect(Reflect.deleteProperty(registry.adapter, "descriptor")).toBe(false);
    expect(registry.adapter.descriptor).toBe(CHATGPT_ADAPTER_DESCRIPTOR);
    expect(registry.descriptor).toBe(CHATGPT_ADAPTER_DESCRIPTOR);

    registry.adapter.dispose();
    registry.dispose();
    expect(underlyingDispose).toHaveBeenCalledTimes(1);

    const replacement = createDocumentAdapterRegistry({
      document,
      entryPoint: "content-script.js",
    });
    expect(replacement).not.toBeNull();
    expect(replacement).not.toBe(registry);
    expect(replacement?.adapter.descriptor).toBe(CHATGPT_ADAPTER_DESCRIPTOR);
    replacement?.dispose();
    expect(underlyingDispose).toHaveBeenCalledTimes(2);
    underlyingDispose.mockRestore();
  });

  it.each([
    ["set", "descriptor"],
    ["defineProperty", "descriptor"],
    ["deleteProperty", "descriptor"],
    ["set", "dispose"],
    ["defineProperty", "dispose"],
    ["deleteProperty", "dispose"],
    ["set", "matches"],
    ["defineProperty", "matches"],
    ["deleteProperty", "matches"],
  ] as const)(
    "rejects Reflect.%s for the public adapter %s property without corrupting lifecycle",
    (operation, property) => {
      const document = fakeDocument("https://chatgpt.com");
      const underlyingDispose = vi.spyOn(ChatGptAdapter.prototype, "dispose");
      const replacement = vi.fn();
      const registry = createDocumentAdapterRegistry({
        document,
        entryPoint: "content-script.js",
      });
      expect(registry).not.toBeNull();
      if (registry === null) throw new Error("Expected ChatGPT registry.");

      const originalDispose = registry.adapter.dispose;
      const mutationValue =
        property === "descriptor"
          ? {
              ...CHATGPT_ADAPTER_DESCRIPTOR,
              version: `${CHATGPT_ADAPTER_DESCRIPTOR.version}-mutated`,
            }
          : replacement;
      const mutationAccepted =
        operation === "set"
          ? Reflect.set(registry.adapter, property, mutationValue)
          : operation === "defineProperty"
            ? Reflect.defineProperty(registry.adapter, property, {
                configurable: false,
                writable: false,
                value: mutationValue,
              })
            : Reflect.deleteProperty(registry.adapter, property);

      expect(mutationAccepted).toBe(false);
      expect(registry.adapter.descriptor).toBe(CHATGPT_ADAPTER_DESCRIPTOR);
      expect(registry.adapter.matches(new URL("https://chatgpt.com/"))).toBe(
        true,
      );
      expect(replacement).not.toHaveBeenCalled();

      originalDispose();
      registry.adapter.dispose();
      registry.dispose();
      expect(underlyingDispose).toHaveBeenCalledTimes(1);

      const replacementRegistry = createDocumentAdapterRegistry({
        document,
        entryPoint: "content-script.js",
      });
      expect(replacementRegistry).not.toBeNull();
      expect(replacementRegistry).not.toBe(registry);
      replacementRegistry?.dispose();
      expect(underlyingDispose).toHaveBeenCalledTimes(2);
      underlyingDispose.mockRestore();
    },
  );

  it.each(["setPrototypeOf", "preventExtensions"] as const)(
    "rejects Reflect.%s without corrupting the adapter facade or lifecycle",
    (operation) => {
      const document = fakeDocument("https://chatgpt.com");
      const underlyingDispose = vi.spyOn(ChatGptAdapter.prototype, "dispose");
      const replacement = vi.fn();
      const registry = createDocumentAdapterRegistry({
        document,
        entryPoint: "content-script.js",
      });
      expect(registry).not.toBeNull();
      if (registry === null) throw new Error("Expected ChatGPT registry.");

      const originalPrototype = Reflect.getPrototypeOf(registry.adapter);
      const mutationAccepted =
        operation === "setPrototypeOf"
          ? Reflect.setPrototypeOf(registry.adapter, {
              dispose: replacement,
              matches: replacement,
            })
          : Reflect.preventExtensions(registry.adapter);

      expect(mutationAccepted).toBe(
        operation === "preventExtensions" ? true : false,
      );
      expect(Reflect.getPrototypeOf(registry.adapter)).toBe(originalPrototype);
      expect(Reflect.isExtensible(registry.adapter)).toBe(false);
      expect(Object.isFrozen(registry.adapter)).toBe(true);
      expect(registry.adapter.matches(new URL("https://chatgpt.com/"))).toBe(
        true,
      );
      expect(replacement).not.toHaveBeenCalled();

      registry.adapter.dispose();
      registry.adapter.dispose();
      registry.dispose();
      expect(underlyingDispose).toHaveBeenCalledTimes(1);

      const replacementRegistry = createDocumentAdapterRegistry({
        document,
        entryPoint: "content-script.js",
      });
      expect(replacementRegistry).not.toBeNull();
      expect(replacementRegistry).not.toBe(registry);
      replacementRegistry?.dispose();
      expect(underlyingDispose).toHaveBeenCalledTimes(2);
      underlyingDispose.mockRestore();
    },
  );

  it("keeps shared registry source selector-free and prompt-value-free", () => {
    const source = readFileSync(
      new URL("./adapter-registry.ts", import.meta.url),
      "utf8",
    );

    expect(source).not.toMatch(/\bProxy\b/u);
    expect(source).not.toMatch(/from\s+["'][^"']*selectors/iu);
    expect(source).not.toMatch(
      /(?:rawPrompt|promptText|matchedText|redactedText|promptCache)/u,
    );
  });
});
