import { describe, expect, it } from "vitest";

import sensitiveValues from "../../../../tests/fixtures/sensitive-values.json";

import { detectProtectedKeywords } from "./protected-keyword.js";

describe("detectProtectedKeywords", () => {
  it("matches Vietnamese diacritics and multiword values case-insensitively", () => {
    const keyword = sensitiveValues.protectedKeyword.vietnamese;
    const matchedText = keyword.toLocaleUpperCase("vi");
    const prompt = `Tài liệu ${matchedText} cần bảo vệ.`;
    const finding = detectProtectedKeywords(prompt, [keyword])[0];

    expect(finding).toEqual(
      expect.objectContaining({
        detectorId: "protected-keyword",
        category: "protected_keyword",
        confidence: "high",
        matchedText,
        redactedText: "[PROTECTED_KEYWORD]",
        start: prompt.indexOf(matchedText),
        end: prompt.indexOf(matchedText) + matchedText.length,
      }),
    );
  });

  it("escapes project-code punctuation rather than treating it as regex", () => {
    const keyword = sensitiveValues.protectedKeyword.projectCode;
    const prompt = `${keyword} and NOVA-420`;

    expect(
      detectProtectedKeywords(prompt, [keyword]).map(
        (finding) => finding.matchedText,
      ),
    ).toEqual([keyword]);
  });

  it("trims and case-insensitively deduplicates configured values", () => {
    const keyword = sensitiveValues.protectedKeyword.projectCode;
    const prompt = `${keyword} then ${keyword.toLowerCase()}`;

    expect(
      detectProtectedKeywords(prompt, [
        `  ${keyword}  `,
        keyword.toLowerCase(),
      ]).map((finding) => finding.matchedText),
    ).toEqual([keyword, keyword.toLowerCase()]);
  });

  it.each([
    (keyword: string) => `x${keyword}`,
    (keyword: string) => `${keyword}9`,
    (keyword: string) => `Đ${keyword}`,
    (keyword: string) => `${keyword}\u0301`,
    (keyword: string) => `𐐀${keyword}`,
    (keyword: string) => `${keyword}𝟙`,
  ])("rejects matches inside larger Unicode L/N/M tokens", (wrap) => {
    const keyword = sensitiveValues.protectedKeyword.projectCode;

    expect(detectProtectedKeywords(wrap(keyword), [keyword])).toEqual([]);
  });

  it("returns overlapping configured matches in exact source order", () => {
    const prompt = "Project NOVA-42 is restricted.";
    const findings = detectProtectedKeywords(prompt, ["NOVA", "NOVA-42"]);

    expect(findings.map(({ start, end }) => prompt.slice(start, end))).toEqual([
      "NOVA-42",
      "NOVA",
    ]);
    expect(findings[0]?.id).not.toBe(findings[1]?.id);
  });

  it("deduplicates matcher-equivalent Unicode keywords at the same range", () => {
    const prompt = "Σ ς σ";

    expect(
      detectProtectedKeywords(prompt, ["Σ", "ς", "σ"]).map(
        (finding) => finding.matchedText,
      ),
    ).toEqual(["Σ", "ς", "σ"]);
  });

  it("returns no findings for an empty configured list", () => {
    expect(detectProtectedKeywords("anything", [])).toEqual([]);
  });

  it.each([
    [Array.from({ length: 101 }, () => "duplicate")],
    [[""]],
    [["   "]],
    [["x".repeat(101)]],
    [["line\nbreak"]],
    [["alpha\tbeta"]],
    [["alpha\u000bbeta"]],
    [["alpha\u000cbeta"]],
    [["alpha\u0085beta"]],
    [["alpha\u2028beta"]],
    [["alpha\u2029beta"]],
    [["alpha\u200bbeta"]],
    [["alpha\u202ebeta"]],
  ])("rejects an invalid configured keyword collection", (keywords) => {
    expect(() => detectProtectedKeywords("anything", keywords)).toThrow(
      "Invalid protected keyword configuration.",
    );
  });

  it("handles 100 configured values against an exactly-limit prompt", () => {
    const prompt = "x".repeat(100_000);
    const keywords = Array.from(
      { length: 100 },
      (_, index) => `k${String(index).padStart(3, "0")}-${"z".repeat(95)}`,
    );
    const startedAt = Date.now();

    expect(keywords.every((keyword) => keyword.length === 100)).toBe(true);
    expect(detectProtectedKeywords(prompt, keywords)).toEqual([]);
    expect(Date.now() - startedAt).toBeLessThan(1_000);
  });
});
