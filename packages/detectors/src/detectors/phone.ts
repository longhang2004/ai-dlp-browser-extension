import { createFinding } from "../finding.js";
import type { FindingForDetector } from "../finding.js";
import { hasTokenBoundaries } from "../boundary.js";

const PHONE_CANDIDATE_PATTERN = /(?:\(\+?\d+\)|\+?\d)(?:[\d \t().-]*\d)?/gu;
const VIETNAMESE_DOMESTIC_PATTERN = /^0[35789]\d{8}$/u;
const VIETNAMESE_INTERNATIONAL_PATTERN = /^84[35789]\d{8}$/u;

function hasValidParentheses(candidate: string): boolean {
  let openIndex = -1;

  for (let index = 0; index < candidate.length; index += 1) {
    const character = candidate[index];

    if (character === "(") {
      if (openIndex !== -1) {
        return false;
      }
      openIndex = index;
    } else if (character === ")") {
      if (
        openIndex === -1 ||
        !/^\+?\d+$/u.test(candidate.slice(openIndex + 1, index))
      ) {
        return false;
      }
      openIndex = -1;
    }
  }

  return openIndex === -1;
}

function hasConservativeFormatting(candidate: string): boolean {
  const plusCount = candidate.match(/\+/gu)?.length ?? 0;
  const hasInternationalPrefix =
    candidate.startsWith("+") || candidate.startsWith("(+");

  return (
    candidate.length > 0 &&
    plusCount === (hasInternationalPrefix ? 1 : 0) &&
    !/[ \t]{2}/u.test(candidate) &&
    !/[.-]{2}/u.test(candidate) &&
    !/(?:[.-][ \t]|[ \t][.-])/u.test(candidate) &&
    hasValidParentheses(candidate)
  );
}

function classifyCandidate(candidate: string): "high" | "medium" | undefined {
  const digits = candidate.replace(/\D/gu, "");
  const hasInternationalPrefix =
    candidate.startsWith("+") || candidate.startsWith("(+");

  if (!hasInternationalPrefix) {
    return VIETNAMESE_DOMESTIC_PATTERN.test(digits) ? "high" : undefined;
  }

  if (digits.startsWith("840")) {
    return undefined;
  }

  if (digits.length < 7 || digits.length > 15 || digits.startsWith("0")) {
    return undefined;
  }

  return VIETNAMESE_INTERNATIONAL_PATTERN.test(digits) ? "high" : "medium";
}

export function detectPhones(prompt: string): FindingForDetector<"phone">[] {
  const findings: FindingForDetector<"phone">[] = [];

  for (const match of prompt.matchAll(PHONE_CANDIDATE_PATTERN)) {
    const matchedText = match[0];
    const start = match.index;
    const end = start + matchedText.length;
    const confidence = classifyCandidate(matchedText);

    if (
      confidence === undefined ||
      !hasConservativeFormatting(matchedText) ||
      !hasTokenBoundaries(prompt, start, end, {
        disallowedBefore: "+()",
        disallowedAfter: "+()",
      })
    ) {
      continue;
    }

    findings.push(
      createFinding(prompt, {
        detectorId: "phone",
        start,
        end,
        confidence,
      }),
    );
  }

  return findings;
}
