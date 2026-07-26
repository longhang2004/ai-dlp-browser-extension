import { describe, expect, it } from "vitest";

import { detectEmails } from "./email.js";

describe("detectEmails", () => {
  it("returns a high-confidence finding with the exact UTF-16 source range", () => {
    const prompt = "Liên hệ 😊 alice.smith+dlp@example.co.uk, cảm ơn.";

    expect(detectEmails(prompt)).toEqual([
      expect.objectContaining({
        detectorId: "email",
        category: "email",
        start: prompt.indexOf("alice.smith+dlp@example.co.uk"),
        end:
          prompt.indexOf("alice.smith+dlp@example.co.uk") +
          "alice.smith+dlp@example.co.uk".length,
        confidence: "high",
        matchedText: "alice.smith+dlp@example.co.uk",
        redactedText: "[EMAIL]",
      }),
    ]);
  });

  it.each([
    "missing-at.example.com",
    "@example.com",
    "alice@",
    ".alice@example.com",
    "alice.@example.com",
    "ali..ce@example.com",
    "alice@example",
    "alice@example..com",
    "alice@-example.com",
    "alice@example-.com",
    "alice@example.com-",
    "alice@example.com_more",
    "đalice@example.com",
    "alice@example.comđ",
    "alice@example.com@invalid",
    "alice@example.com@",
    "alice@example.com+tag",
    "@alice@example.com",
  ])("rejects invalid or embedded address %s", (prompt) => {
    expect(detectEmails(prompt)).toEqual([]);
  });

  it.each([
    ["Send to security@example.com.", "security@example.com"],
    ["Send to security@example.com, please.", "security@example.com"],
    ["security@alerts.example.co.uk", "security@alerts.example.co.uk"],
  ])("does not consume sentence punctuation in %s", (prompt, matchedText) => {
    expect(detectEmails(prompt)[0]?.matchedText).toBe(matchedText);
  });

  it("returns deterministic identifiers based on detector and range", () => {
    const prompt = "a@example.com and b@example.com";
    const first = detectEmails(prompt);
    const second = detectEmails(prompt);

    expect(second).toEqual(first);
    expect(first[0]?.id).toMatch(/^finding-[0-9a-f]{16}$/u);
    expect(first[0]?.id).not.toBe(first[1]?.id);
  });

  it.each([
    "𐐀alice@example.com",
    "alice@example.com𐐀",
    "𝟙alice@example.com",
    "alice@example.com𝟙",
    "\u0301alice@example.com",
    "alice@example.com\u0301",
  ])("rejects Unicode code-point adjacency in %s", (prompt) => {
    expect(detectEmails(prompt)).toEqual([]);
  });

  it("handles adversarial 100,000-code-unit inputs with bounded scans", () => {
    const inputs = [
      "x".repeat(100_000),
      `${"a".repeat(99_988)}@example.com`,
      `a@${"a".repeat(99_998)}`,
    ];
    const startedAt = Date.now();

    for (const input of inputs) {
      expect(input.length).toBe(100_000);
      expect(detectEmails(input)).toEqual([]);
    }

    expect(Date.now() - startedAt).toBeLessThan(500);
  });
});
