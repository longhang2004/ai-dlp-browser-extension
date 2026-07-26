import { describe, expect, it } from "vitest";

import sensitiveValues from "../../../tests/fixtures/sensitive-values.json";

type GlobImport = (
  patterns: string[],
  options: Readonly<{
    query: "?raw";
    import: "default";
    eager: true;
  }>,
) => Record<string, unknown>;

declare global {
  interface ImportMeta {
    glob: GlobImport;
  }
}

function collectLeaves(value: unknown): string[] {
  if (typeof value === "string") {
    return [value];
  }
  if (value === null || typeof value !== "object") {
    return [];
  }
  if (
    !Array.isArray(value) &&
    Object.keys(value).length === 1 &&
    "parts" in value &&
    Array.isArray(value.parts) &&
    value.parts.every((part) => typeof part === "string")
  ) {
    return [value.parts.join(""), ...value.parts];
  }

  return Object.values(value).flatMap(collectLeaves);
}

describe("dedicated sensitive fixture isolation", () => {
  it("does not commit complete provider-shaped AWS access key fixtures", () => {
    expect(JSON.stringify(sensitiveValues)).not.toMatch(
      /(?:AKIA|ASIA)[A-Z0-9]{16}/u,
    );
  });

  it("keeps every inventoried fixture leaf out of production TypeScript", () => {
    const productionSources = import.meta.glob(
      [
        "../../*/src/**/*.{ts,tsx,js,mjs,cjs}",
        "../../../apps/*/src/**/*.{ts,tsx,js,mjs,cjs}",
        "../../../apps/*/public/**/*.{html,json,css}",
        "../../../apps/*/*.{html,json,css}",
        "../../../apps/*/vite*.{ts,js,mjs,cjs}",
        "../../../docs/**/*.{md,mdx,txt,json,html,css}",
        "../../../README.md",
        "../../../*.{ts,tsx,js,mjs,cjs,json,html,css}",
        "../../../scripts/**/*.{ts,tsx,js,mjs,cjs,json,html,css}",
        "!**/*.test.ts",
        "!**/*.test.tsx",
        "!**/*.test-d.ts",
        "!**/*.spec.ts",
        "!**/*.spec.tsx",
        "!**/tests/**",
        "!**/fixtures/**",
        "!**/dist/**",
        "!**/node_modules/**",
        "!**/coverage/**",
        "!**/pnpm-lock.*",
        "!**/package-lock.json",
        "!**/npm-shrinkwrap.json",
        "!**/yarn.lock",
        "!**/bun.lock",
        "!**/bun.lockb",
      ],
      { query: "?raw", import: "default", eager: true },
    );
    const productionFiles = Object.keys(productionSources);

    expect(productionFiles.length).toBeGreaterThan(0);
    expect(productionFiles).toEqual(
      expect.arrayContaining([
        "../../shared-types/src/index.ts",
        "./index.ts",
        "../../policy-engine/src/index.ts",
      ]),
    );

    for (const fixtureValue of collectLeaves(sensitiveValues).filter(
      (value) => value.length >= 6,
    )) {
      for (const [productionFile, source] of Object.entries(
        productionSources,
      )) {
        expect(typeof source).toBe("string");
        expect(
          source,
          `${fixtureValue} leaked into ${productionFile}`,
        ).not.toContain(fixtureValue);
      }
    }
  });
});
