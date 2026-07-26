import { describe, expect, it } from "vitest";

import { detectPhones } from "./phone.js";

describe("detectPhones", () => {
  it.each([
    ["Gọi 0912 345 678 ngay.", "0912 345 678"],
    ["Gọi 03-1234-5678 ngay.", "03-1234-5678"],
    ["Gọi +84 912.345.678 ngay.", "+84 912.345.678"],
    ["Gọi +84 (912) 345-678 ngay.", "+84 (912) 345-678"],
    ["Gọi (+84) 912 345 678 ngay.", "(+84) 912 345 678"],
    ["Gọi (0912) 345 678 ngay.", "(0912) 345 678"],
  ])("detects a Vietnamese mobile number in %s", (prompt, matchedText) => {
    const finding = detectPhones(prompt)[0];

    expect(finding).toEqual(
      expect.objectContaining({
        detectorId: "phone",
        category: "phone",
        confidence: "high",
        matchedText,
        redactedText: "[PHONE]",
        start: prompt.indexOf(matchedText),
        end: prompt.indexOf(matchedText) + matchedText.length,
      }),
    );
  });

  it("detects a conservative general international number at medium confidence", () => {
    const prompt = "Office: +1 (415) 555-2671.";

    expect(detectPhones(prompt)).toEqual([
      expect.objectContaining({
        confidence: "medium",
        matchedText: "+1 (415) 555-2671",
      }),
    ]);
  });

  it.each(["03", "05", "07", "08", "09"])(
    "detects Vietnamese domestic and +84 equivalents for prefix %s",
    (prefix) => {
      const domestic = `${prefix}12345678`;
      const international = `+84 ${prefix.slice(1)} 1234 5678`;

      expect(detectPhones(domestic)[0]?.confidence).toBe("high");
      expect(detectPhones(international)[0]?.confidence).toBe("high");
    },
  );

  it.each([
    "0123 456 789",
    "0912 345 67",
    "+0123456789",
    "+1 23",
    "4111 1111 1111 1111",
    "1234567890123",
    "abc0912345678",
    "0912345678xyz",
    "+1 (415 555-2671",
    "++1 (415) 555-2671",
    "(0912345678",
    "0912345678)",
    "+840912345678",
    "+84 0912 345 678",
  ])("rejects invalid or ambiguous number %s", (prompt) => {
    expect(detectPhones(prompt)).toEqual([]);
  });

  it("preserves exact UTF-16 offsets after Vietnamese and emoji text", () => {
    const prompt = "Số mới 😊 là 0987.654.321!";
    const finding = detectPhones(prompt)[0];

    expect(finding?.start).toBe(prompt.indexOf("0987.654.321"));
    expect(prompt.slice(finding?.start, finding?.end)).toBe("0987.654.321");
  });

  it.each([
    "𐐀0912345678",
    "0912345678𐐀",
    "𝟙0912345678",
    "0912345678𝟙",
    "\u03010912345678",
    "0912345678\u0301",
  ])("rejects Unicode code-point adjacency in %s", (prompt) => {
    expect(detectPhones(prompt)).toEqual([]);
  });

  it("returns multiple phones in stable source order", () => {
    const prompt = "Primary 0912 345 678; backup +44 20 7946 0958.";

    expect(detectPhones(prompt).map((finding) => finding.matchedText)).toEqual([
      "0912 345 678",
      "+44 20 7946 0958",
    ]);
  });
});
