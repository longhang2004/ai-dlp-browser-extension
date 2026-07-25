import { hasTokenBoundaries } from "../boundary.js";
import { createFinding } from "../finding.js";
import type { FindingForDetector } from "../finding.js";

const CONTEXT_KEY_PATTERN =
  /(?:client_secret|api_key|apikey|password|secret|token)/gi;
const ALLOWED_VALUE_CHARACTER = /[A-Za-z0-9_./+=-]/u;
const APPROVED_PUNCTUATION = /[_./+=-]/u;
const MIN_VALUE_CODE_UNITS = 12;
const MAX_VALUE_CODE_UNITS = 256;
const KNOWN_TOKEN_PREFIXES = Object.freeze([
  "sk-",
  "ghp_",
  "github_pat_",
  "xoxb-",
]);
const PLACEHOLDER_VALUES = new Set([
  "changeme",
  "dummy_value",
  "dummy_secret",
  "example_secret",
  "example_value",
  "fake_secret",
  "placeholder",
  "password_value",
  "replace_me",
  "replace_me_now",
  "sample_secret",
  "secret_value",
  "test_value",
  "token_value",
  "your_api_key",
  "your_api_key_here",
  "your_secret",
  "your_secret_here",
  "your_token",
  "your_token_here",
]);

type ParsedValue = Readonly<{
  start: number;
  end: number;
  value: string;
}>;

function isHorizontalWhitespace(character: string | undefined): boolean {
  return character === " " || character === "\t";
}

function skipHorizontalWhitespace(prompt: string, start: number): number {
  let index = start;
  while (isHorizontalWhitespace(prompt[index])) {
    index += 1;
  }
  return index;
}

function parseQuotedValue(
  prompt: string,
  quoteIndex: number,
): ParsedValue | undefined {
  const quote = prompt[quoteIndex];
  if (quote !== '"' && quote !== "'") {
    return undefined;
  }

  const start = quoteIndex + 1;
  let end = start;
  while (
    end < prompt.length &&
    end - start <= MAX_VALUE_CODE_UNITS &&
    ALLOWED_VALUE_CHARACTER.test(prompt[end] ?? "")
  ) {
    end += 1;
  }

  if (
    prompt[end] !== quote ||
    end - start < MIN_VALUE_CODE_UNITS ||
    end - start > MAX_VALUE_CODE_UNITS ||
    !hasTokenBoundaries(prompt, start, end + 1)
  ) {
    return undefined;
  }

  return { start, end, value: prompt.slice(start, end) };
}

function parseUnquotedValue(
  prompt: string,
  start: number,
): ParsedValue | undefined {
  let end = start;
  while (
    end < prompt.length &&
    end - start <= MAX_VALUE_CODE_UNITS &&
    ALLOWED_VALUE_CHARACTER.test(prompt[end] ?? "")
  ) {
    end += 1;
  }

  if (
    end - start < MIN_VALUE_CODE_UNITS ||
    end - start > MAX_VALUE_CODE_UNITS ||
    ALLOWED_VALUE_CHARACTER.test(prompt[end] ?? "") ||
    !hasTokenBoundaries(prompt, start, end)
  ) {
    return undefined;
  }

  return { start, end, value: prompt.slice(start, end) };
}

function parseContextualValue(
  prompt: string,
  contextEnd: number,
): ParsedValue | undefined {
  let index = skipHorizontalWhitespace(prompt, contextEnd);
  if (prompt[index] !== ":" && prompt[index] !== "=") {
    return undefined;
  }

  index = skipHorizontalWhitespace(prompt, index + 1);
  return prompt[index] === '"' || prompt[index] === "'"
    ? parseQuotedValue(prompt, index)
    : parseUnquotedValue(prompt, index);
}

function countCharacterClasses(value: string): number {
  return [
    /[a-z]/u.test(value),
    /[A-Z]/u.test(value),
    /\d/u.test(value),
    APPROVED_PUNCTUATION.test(value),
  ].filter(Boolean).length;
}

function hasKnownPrefix(value: string): boolean {
  return KNOWN_TOKEN_PREFIXES.some((prefix) => value.startsWith(prefix));
}

function isRepeatedSingleCharacter(value: string): boolean {
  const first = value[0];
  return (
    first !== undefined && [...value].every((character) => character === first)
  );
}

function classifyValue(value: string): "high" | "medium" | undefined {
  const normalized = value.toLowerCase();
  const classCount = countCharacterClasses(value);
  const knownPrefix = hasKnownPrefix(value);
  const hasOnlyLowercaseAndPunctuation =
    /[a-z]/u.test(value) &&
    APPROVED_PUNCTUATION.test(value) &&
    !/[A-Z0-9]/u.test(value);

  if (
    classCount < 2 ||
    PLACEHOLDER_VALUES.has(normalized) ||
    isRepeatedSingleCharacter(value) ||
    (hasOnlyLowercaseAndPunctuation && !knownPrefix)
  ) {
    return undefined;
  }

  return knownPrefix || (value.length >= 20 && classCount >= 3)
    ? "high"
    : "medium";
}

export function detectApiSecrets(
  prompt: string,
): FindingForDetector<"api-secret">[] {
  const findings: FindingForDetector<"api-secret">[] = [];

  for (const contextMatch of prompt.matchAll(CONTEXT_KEY_PATTERN)) {
    const contextStart = contextMatch.index;
    const contextEnd = contextStart + contextMatch[0].length;
    if (!hasTokenBoundaries(prompt, contextStart, contextEnd)) {
      continue;
    }

    const parsed = parseContextualValue(prompt, contextEnd);
    if (parsed === undefined) {
      continue;
    }

    const confidence = classifyValue(parsed.value);
    if (confidence === undefined) {
      continue;
    }

    findings.push(
      createFinding(prompt, {
        detectorId: "api-secret",
        start: parsed.start,
        end: parsed.end,
        confidence,
      }),
    );
  }

  return findings;
}
