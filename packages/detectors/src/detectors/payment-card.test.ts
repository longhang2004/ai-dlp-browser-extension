import { describe, expect, it } from "vitest";

import { detectPaymentCards } from "./payment-card.js";

function createLuhnValidDigits(length: number): string {
  const body = Array.from({ length: length - 1 }, (_, index) =>
    String((index % 9) + 1),
  ).join("");
  let sum = 0;
  let shouldDouble = true;

  for (let index = body.length - 1; index >= 0; index -= 1) {
    const digit = Number(body[index]);
    const doubled = digit * 2;
    sum += shouldDouble ? (doubled > 9 ? doubled - 9 : doubled) : digit;
    shouldDouble = !shouldDouble;
  }

  return `${body}${(10 - (sum % 10)) % 10}`;
}

describe("detectPaymentCards", () => {
  it.each([
    "4111111111111111",
    "4111 1111 1111 1111",
    "4111-1111-1111-1111",
    "378282246310005",
  ])("detects a structurally valid, Luhn-valid card %s", (card) => {
    const prompt = `Card: ${card}.`;

    expect(detectPaymentCards(prompt)).toEqual([
      expect.objectContaining({
        detectorId: "payment-card",
        category: "payment_card",
        confidence: "high",
        matchedText: card,
        redactedText: "[PAYMENT_CARD]",
        start: prompt.indexOf(card),
        end: prompt.indexOf(card) + card.length,
      }),
    ]);
  });

  it.each([
    "4111111111111112",
    "123456789012",
    "12345678901234567890",
    "4111  1111 1111 1111",
    "4111--1111-1111-1111",
    "4111 -1111-1111-1111",
    "x4111111111111111",
    "4111111111111111x",
    "-4111111111111111",
    "+4111111111111111",
    "4111111111111111-",
    "4111111111111111+",
  ])("rejects invalid, malformed, or embedded candidate %s", (card) => {
    expect(detectPaymentCards(card)).toEqual([]);
  });

  it.each([13, 14, 15, 16, 17, 18, 19])(
    "accepts a Luhn-valid candidate containing %i digits",
    (length) => {
      const card = createLuhnValidDigits(length);

      expect(card).toHaveLength(length);
      expect(detectPaymentCards(card)[0]?.matchedText).toBe(card);
    },
  );

  it.each([
    "  4111111111111111  ",
    "Card value:   4111111111111111   for audit",
    "\n    4111111111111111\n",
  ])(
    "detects a standalone card surrounded by whitespace/prose in %s",
    (prompt) => {
      expect(detectPaymentCards(prompt)[0]?.matchedText).toBe(
        "4111111111111111",
      );
    },
  );

  it.each([
    "9  4111111111111111",
    "4111111111111111  9",
    "9   4111111111111111",
    "4111111111111111   9",
    "9 - 4111111111111111",
    "4111111111111111 - 9",
  ])("rejects a card connected to another digit in %s", (prompt) => {
    expect(detectPaymentCards(prompt)).toEqual([]);
  });

  it.each([12, 20])(
    "rejects a Luhn-valid candidate outside the supported %i-digit length",
    (length) => {
      const card = createLuhnValidDigits(length);

      expect(card).toHaveLength(length);
      expect(detectPaymentCards(card)).toEqual([]);
    },
  );

  it("finds multiple cards in stable source order with exact ranges", () => {
    const first = "4111 1111 1111 1111";
    const second = "5555-5555-5555-4444";
    const prompt = `${first}; then ${second}`;
    const findings = detectPaymentCards(prompt);

    expect(findings.map((finding) => finding.matchedText)).toEqual([
      first,
      second,
    ]);
    expect(findings.map(({ start, end }) => prompt.slice(start, end))).toEqual([
      first,
      second,
    ]);
    expect(findings[0]?.id).not.toBe(findings[1]?.id);
  });

  it.each([
    "𐐀4111111111111111",
    "4111111111111111𐐀",
    "𝟙4111111111111111",
    "4111111111111111𝟙",
    "\u03014111111111111111",
    "4111111111111111\u0301",
  ])("rejects Unicode code-point adjacency in %s", (prompt) => {
    expect(detectPaymentCards(prompt)).toEqual([]);
  });
});
