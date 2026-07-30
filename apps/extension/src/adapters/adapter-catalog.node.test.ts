/// <reference types="node" />

import { readFileSync } from "node:fs";

import {
  CHATGPT_ADAPTER_VERSION,
  type AdapterDescriptor,
} from "@ai-dlp/shared-types";
import { describe, expect, it } from "vitest";

import {
  CHATGPT_ADAPTER_DESCRIPTOR,
  EXECUTABLE_ADAPTER_CATALOG,
  assertExecutableAdapterCatalogInvariants,
  findExecutableAdapterByOrigin,
} from "./adapter-catalog.js";

const capabilities = CHATGPT_ADAPTER_DESCRIPTOR.capabilities;

function descriptor(
  overrides: Partial<AdapterDescriptor> = {},
): AdapterDescriptor {
  return {
    adapterId: CHATGPT_ADAPTER_DESCRIPTOR.adapterId,
    surfaceId: CHATGPT_ADAPTER_DESCRIPTOR.surfaceId,
    version: CHATGPT_ADAPTER_DESCRIPTOR.version,
    trust: CHATGPT_ADAPTER_DESCRIPTOR.trust,
    origins: [...CHATGPT_ADAPTER_DESCRIPTOR.origins],
    capabilities: { ...CHATGPT_ADAPTER_DESCRIPTOR.capabilities },
    entryPoint: CHATGPT_ADAPTER_DESCRIPTOR.entryPoint,
    ...overrides,
  };
}

describe("executable adapter catalog", () => {
  it("contains exactly the current ChatGPT v3 executable", () => {
    expect(EXECUTABLE_ADAPTER_CATALOG).toEqual([
      {
        adapterId: "chatgpt",
        surfaceId: "chatgpt_web",
        version: CHATGPT_ADAPTER_VERSION,
        trust: "verified",
        origins: ["https://chatgpt.com"],
        capabilities: {
          submissionDetection: "verified",
          promptRead: "verified",
          attachmentDetection: "verified",
          attachmentInspection: "unsupported",
          promptReplacement: "unsupported",
          submissionResume: "verified",
        },
        entryPoint: "content-script.js",
      },
    ]);
    expect(EXECUTABLE_ADAPTER_CATALOG).toHaveLength(1);
    expect(
      EXECUTABLE_ADAPTER_CATALOG.some(
        ({ adapterId, surfaceId, origins, entryPoint }) =>
          adapterId === "claude" ||
          surfaceId === "claude_web" ||
          origins.includes("https://claude.ai") ||
          entryPoint.includes("claude"),
      ),
    ).toBe(false);
  });

  it("deeply freezes the catalog authority", () => {
    expect(Object.isFrozen(EXECUTABLE_ADAPTER_CATALOG)).toBe(true);
    expect(Object.isFrozen(CHATGPT_ADAPTER_DESCRIPTOR)).toBe(true);
    expect(Object.isFrozen(CHATGPT_ADAPTER_DESCRIPTOR.origins)).toBe(true);
    expect(Object.isFrozen(capabilities)).toBe(true);
    expect(Reflect.set(capabilities, "promptRead", "unsupported")).toBe(false);
    expect(Reflect.set(capabilities, "promptReplacement", "verified")).toBe(
      false,
    );
    expect(capabilities.promptReplacement).toBe("unsupported");
    expect(
      Reflect.set(EXECUTABLE_ADAPTER_CATALOG, "1", descriptor() as never),
    ).toBe(false);
  });

  it.each([
    ["adapter ID", descriptor({ adapterId: "claude" })],
    ["surface ID", descriptor({ surfaceId: "claude_web" })],
    ["version", descriptor({ version: `${CHATGPT_ADAPTER_VERSION}-other` })],
    ["trust", descriptor({ trust: "discovered" })],
    ["canonical origin", descriptor({ origins: ["https://claude.ai"] })],
    [
      "submission detection capability",
      descriptor({
        capabilities: {
          ...capabilities,
          submissionDetection: "unsupported",
        },
      }),
    ],
    [
      "prompt read capability",
      descriptor({
        capabilities: { ...capabilities, promptRead: "unsupported" },
      }),
    ],
    [
      "attachment detection capability",
      descriptor({
        capabilities: {
          ...capabilities,
          attachmentDetection: "unsupported",
        },
      }),
    ],
    [
      "attachment inspection capability",
      descriptor({
        capabilities: {
          ...capabilities,
          attachmentInspection: "not_applicable",
        },
      }),
    ],
    [
      "prompt replacement capability",
      descriptor({
        capabilities: {
          ...capabilities,
          promptReplacement: "verified",
        },
      }),
    ],
    [
      "submission resume capability",
      descriptor({
        capabilities: {
          ...capabilities,
          submissionResume: "unsupported",
        },
      }),
    ],
    ["content entry point", descriptor({ entryPoint: "other-content.js" })],
  ])("rejects a descriptor with mismatched packaged %s", (_field, claim) => {
    expect(() => assertExecutableAdapterCatalogInvariants([claim])).toThrow(
      /packaged adapter identity/iu,
    );
  });

  it("never treats the reserved Claude adapter ID as executable in M2.0", () => {
    expect(() =>
      assertExecutableAdapterCatalogInvariants([
        descriptor({
          adapterId: "claude",
          surfaceId: "claude_web",
          version: "candidate",
          trust: "unsupported",
          origins: ["https://claude.ai"],
          capabilities: {
            submissionDetection: "unsupported",
            promptRead: "unsupported",
            attachmentDetection: "unsupported",
            attachmentInspection: "unsupported",
            promptReplacement: "unsupported",
            submissionResume: "unsupported",
          },
          entryPoint: "claude-content-script.js",
        }),
      ]),
    ).toThrow(/packaged adapter identity/iu);
  });

  it("rejects an empty executable catalog in M2.0", () => {
    expect(() => assertExecutableAdapterCatalogInvariants([])).toThrow(
      /exactly one executable adapter/iu,
    );
  });

  it("reports every duplicated ownership dimension before cardinality", () => {
    let error: unknown;
    try {
      assertExecutableAdapterCatalogInvariants([
        CHATGPT_ADAPTER_DESCRIPTOR,
        descriptor(),
      ]);
    } catch (cause) {
      error = cause;
    }

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toMatch(/duplicate adapter ID/iu);
    expect((error as Error).message).toMatch(/duplicate surface ID/iu);
    expect((error as Error).message).toMatch(/duplicate origin/iu);
    expect((error as Error).message).toMatch(/duplicate entry point/iu);
  });

  it("looks up only the canonical exact origin", () => {
    expect(findExecutableAdapterByOrigin("https://chatgpt.com")).toBe(
      CHATGPT_ADAPTER_DESCRIPTOR,
    );
    expect(
      findExecutableAdapterByOrigin("https://chatgpt.com:8443"),
    ).toBeNull();
    expect(findExecutableAdapterByOrigin("https://claude.ai")).toBeNull();
    expect(findExecutableAdapterByOrigin("https://unknown.example")).toBeNull();
  });

  it("contains only exact prompt-free descriptor fields", () => {
    expect(Object.keys(CHATGPT_ADAPTER_DESCRIPTOR).sort()).toEqual(
      [
        "adapterId",
        "capabilities",
        "entryPoint",
        "origins",
        "surfaceId",
        "trust",
        "version",
      ].sort(),
    );
    expect(JSON.stringify(EXECUTABLE_ADAPTER_CATALOG)).not.toContain(
      "fixture secret value",
    );

    const source = readFileSync(
      new URL("./adapter-catalog.ts", import.meta.url),
      "utf8",
    );
    expect(source).not.toMatch(/from\s+["'][^"']*selectors/iu);
  });
});
