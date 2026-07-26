import { describe, expect, it } from "vitest";

import { isLuhnValid } from "./luhn.js";

describe("isLuhnValid", () => {
  it.each(["4111111111111111", "5555555555554444", "378282246310005"])(
    "accepts a checksum-valid digit sequence %s",
    (digits) => {
      expect(isLuhnValid(digits)).toBe(true);
    },
  );

  it.each([
    "4111111111111112",
    "5555555555554440",
    "",
    "0",
    "4111 1111 1111 1111",
    "not-digits",
  ])("rejects an invalid digit sequence %s", (digits) => {
    expect(isLuhnValid(digits)).toBe(false);
  });

  it("treats repeated zeroes according to Luhn alone", () => {
    expect(isLuhnValid("0000000000000")).toBe(true);
  });
});
