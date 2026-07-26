import { describe, expect, it } from "vitest";

import { areUnicodeCaseInsensitiveEquivalent } from "./unicode-equivalence.js";

describe("areUnicodeCaseInsensitiveEquivalent", () => {
  it.each([
    ["Σ", "σ"],
    ["Σ", "ς"],
    ["σ", "ς"],
    ["Dự án Mật", "DỰ ÁN MẬT"],
    ["a.b+c", "A.B+C"],
  ])(
    "matches the platform-independent escaped /iu semantics",
    (left, right) => {
      expect(areUnicodeCaseInsensitiveEquivalent(left, right)).toBe(true);
      expect(areUnicodeCaseInsensitiveEquivalent(right, left)).toBe(true);
    },
  );

  it.each([
    ["Σ", "S"],
    ["Dự án Mật", "Du an Mat"],
    ["a.b+c", "axbcccc"],
    ["x".repeat(101), "X".repeat(101)],
  ])("rejects distinct or out-of-bound values", (left, right) => {
    expect(areUnicodeCaseInsensitiveEquivalent(left, right)).toBe(false);
  });
});
