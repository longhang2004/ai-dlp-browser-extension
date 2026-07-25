import { createFinding } from "../finding.js";
import type { FindingForDetector } from "../finding.js";
import { hasTokenBoundaries } from "../boundary.js";
import { isLuhnValid } from "./luhn.js";

const PAYMENT_CARD_CANDIDATE_PATTERN = /\d(?:[ -]?\d){12,18}/gu;

function isConnectedCardTokenCharacter(character: string | undefined): boolean {
  return (
    character !== undefined &&
    ((character >= "0" && character <= "9") ||
      character === "+" ||
      character === "-")
  );
}

function isConnectedBefore(prompt: string, start: number): boolean {
  let index = start - 1;

  while (prompt[index] === " ") {
    index -= 1;
  }

  return isConnectedCardTokenCharacter(prompt[index]);
}

function isConnectedAfter(prompt: string, end: number): boolean {
  let index = end;

  while (prompt[index] === " ") {
    index += 1;
  }

  return isConnectedCardTokenCharacter(prompt[index]);
}

function hasCardBoundaries(
  prompt: string,
  start: number,
  end: number,
): boolean {
  return (
    hasTokenBoundaries(prompt, start, end, {
      disallowedBefore: "+-",
      disallowedAfter: "+-",
    }) &&
    !isConnectedBefore(prompt, start) &&
    !isConnectedAfter(prompt, end)
  );
}

export function detectPaymentCards(
  prompt: string,
): FindingForDetector<"payment-card">[] {
  const findings: FindingForDetector<"payment-card">[] = [];

  for (const match of prompt.matchAll(PAYMENT_CARD_CANDIDATE_PATTERN)) {
    const matchedText = match[0];
    const start = match.index;
    const end = start + matchedText.length;
    const digits = matchedText.replace(/[ -]/gu, "");

    if (
      digits.length < 13 ||
      digits.length > 19 ||
      !hasCardBoundaries(prompt, start, end) ||
      !isLuhnValid(digits)
    ) {
      continue;
    }

    findings.push(
      createFinding(prompt, {
        detectorId: "payment-card",
        start,
        end,
        confidence: "high",
      }),
    );
  }

  return findings;
}
