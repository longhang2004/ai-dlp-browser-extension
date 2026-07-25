import { describe, expect, it } from "vitest";

import {
  isNormalizedProtectedKeyword,
  normalizeProtectedKeyword,
} from "./protected-keywords.js";

describe("protected keyword normalization", () => {
  it.each(["Project Alpha", "Dự án Mật", "Alpha\u00a0Beta", "NOVA-42"])(
    "accepts a normalized keyword containing ordinary spacing: %s",
    (value) => {
      expect(normalizeProtectedKeyword(value)).toBe(value);
      expect(isNormalizedProtectedKeyword(value)).toBe(true);
    },
  );

  it("trims ordinary Unicode separator spaces for detector input", () => {
    expect(normalizeProtectedKeyword("\u00a0 Project Alpha \u3000")).toBe(
      "Project Alpha",
    );
    expect(isNormalizedProtectedKeyword("\u00a0 Project Alpha \u3000")).toBe(
      false,
    );
  });

  it.each([
    "\u0000",
    "\u0009",
    "\u000b",
    "\u000c",
    "\u000d",
    "\u000a",
    "\u0085",
    "\u2028",
    "\u2029",
    "\u200b",
    "\u200e",
    "\u202e",
    "\u2066",
    "\ufeff",
  ])("rejects embedded Cc, Cf, Zl, or Zp code point U+%s", (forbidden) => {
    const candidate = `Alpha${forbidden}Beta`;

    expect(normalizeProtectedKeyword(candidate)).toBeUndefined();
    expect(isNormalizedProtectedKeyword(candidate)).toBe(false);
  });

  it.each(["", " ", "x".repeat(101), 42, null])(
    "rejects empty, oversized, or non-string input",
    (value) => {
      expect(normalizeProtectedKeyword(value)).toBeUndefined();
      expect(isNormalizedProtectedKeyword(value)).toBe(false);
    },
  );
});
