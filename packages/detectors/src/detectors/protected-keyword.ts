import {
  areUnicodeCaseInsensitiveEquivalent,
  MAX_PROTECTED_KEYWORD_COUNT,
  normalizeProtectedKeyword,
} from "@ai-dlp/shared-types";

import { createFinding } from "../finding.js";
import type { FindingForDetector } from "../finding.js";

const UNICODE_WORD_CODE_POINT_PATTERN = /[\p{L}\p{N}\p{M}]/u;
const REGEXP_METACHARACTER_PATTERN = /[.*+?^${}()|[\]\\]/gu;

type NormalizedKeyword = Readonly<{
  value: string;
  order: number;
}>;

type KeywordMatch = Readonly<{
  start: number;
  end: number;
  keywordOrder: number;
}>;

function previousCodePoint(value: string, index: number): string | undefined {
  if (index <= 0) {
    return undefined;
  }

  let start = index - 1;
  const trailingCodeUnit = value.charCodeAt(start);
  if (trailingCodeUnit >= 0xdc00 && trailingCodeUnit <= 0xdfff && start > 0) {
    const leadingCodeUnit = value.charCodeAt(start - 1);
    if (leadingCodeUnit >= 0xd800 && leadingCodeUnit <= 0xdbff) {
      start -= 1;
    }
  }

  return value.slice(start, index);
}

function nextCodePoint(value: string, index: number): string | undefined {
  const codePoint = value.codePointAt(index);
  return codePoint === undefined ? undefined : String.fromCodePoint(codePoint);
}

function hasKeywordBoundaries(
  prompt: string,
  start: number,
  end: number,
): boolean {
  const before = previousCodePoint(prompt, start);
  const after = nextCodePoint(prompt, end);
  return (
    (before === undefined || !UNICODE_WORD_CODE_POINT_PATTERN.test(before)) &&
    (after === undefined || !UNICODE_WORD_CODE_POINT_PATTERN.test(after))
  );
}

function normalizeKeywords(
  configuredKeywords: readonly string[],
): NormalizedKeyword[] {
  if (
    !Array.isArray(configuredKeywords) ||
    configuredKeywords.length > MAX_PROTECTED_KEYWORD_COUNT
  ) {
    throw new Error("Invalid protected keyword configuration.");
  }

  const normalized: NormalizedKeyword[] = [];
  for (const [order, configuredKeyword] of configuredKeywords.entries()) {
    const value = normalizeProtectedKeyword(configuredKeyword);
    if (value === undefined) {
      throw new Error("Invalid protected keyword configuration.");
    }

    if (
      !normalized.some((keyword) =>
        areUnicodeCaseInsensitiveEquivalent(keyword.value, value),
      )
    ) {
      normalized.push({ value, order });
    }
  }

  return normalized;
}

export function validateProtectedKeywordConfiguration(
  configuredKeywords: readonly string[],
): void {
  normalizeKeywords(configuredKeywords);
}

function escapeRegExp(value: string): string {
  return value.replace(REGEXP_METACHARACTER_PATTERN, "\\$&");
}

export function detectProtectedKeywords(
  prompt: string,
  configuredKeywords: readonly string[],
): FindingForDetector<"protected-keyword">[] {
  const matches: KeywordMatch[] = [];

  for (const keyword of normalizeKeywords(configuredKeywords)) {
    const pattern = new RegExp(escapeRegExp(keyword.value), "giu");
    for (const match of prompt.matchAll(pattern)) {
      const start = match.index;
      const end = start + match[0].length;
      if (hasKeywordBoundaries(prompt, start, end)) {
        matches.push({ start, end, keywordOrder: keyword.order });
      }
    }
  }

  matches.sort(
    (left, right) =>
      left.start - right.start ||
      right.end - left.end ||
      left.keywordOrder - right.keywordOrder,
  );

  const uniqueMatches = matches.filter(
    (match, index) =>
      index === 0 ||
      match.start !== matches[index - 1]?.start ||
      match.end !== matches[index - 1]?.end,
  );

  return uniqueMatches.map(({ start, end }) =>
    createFinding(prompt, {
      detectorId: "protected-keyword",
      start,
      end,
      confidence: "high",
    }),
  );
}
