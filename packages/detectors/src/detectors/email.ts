import { hasTokenBoundaries } from "../boundary.js";
import { createFinding } from "../finding.js";
import type { FindingForDetector } from "../finding.js";

const MAX_LOCAL_PART_CODE_UNITS = 64;
const MAX_DOMAIN_CODE_UNITS = 253;
const MAX_DOMAIN_SCAN_CODE_UNITS = MAX_DOMAIN_CODE_UNITS + 2;
const LOCAL_PART_PUNCTUATION = "!#$%&'*+/=?^_`{|}~.-";
const DOMAIN_PUNCTUATION = ".-";
const EMAIL_BOUNDARY_PUNCTUATION = `${LOCAL_PART_PUNCTUATION}@`;
const EMAIL_TRAILING_CONTINUATION_PUNCTUATION = "!#$%&'*+/=?^_`{|}~-@";

function isAsciiLetterOrDigit(character: string): boolean {
  const codeUnit = character.charCodeAt(0);
  return (
    (codeUnit >= 0x30 && codeUnit <= 0x39) ||
    (codeUnit >= 0x41 && codeUnit <= 0x5a) ||
    (codeUnit >= 0x61 && codeUnit <= 0x7a)
  );
}

function isLocalPartCharacter(character: string): boolean {
  return (
    isAsciiLetterOrDigit(character) ||
    LOCAL_PART_PUNCTUATION.includes(character)
  );
}

function isDomainCharacter(character: string): boolean {
  return (
    isAsciiLetterOrDigit(character) || DOMAIN_PUNCTUATION.includes(character)
  );
}

function findLocalPartStart(
  prompt: string,
  atIndex: number,
): number | undefined {
  let start = atIndex;
  let scannedCodeUnits = 0;

  while (
    start > 0 &&
    scannedCodeUnits < MAX_LOCAL_PART_CODE_UNITS + 1 &&
    isLocalPartCharacter(prompt[start - 1] ?? "")
  ) {
    start -= 1;
    scannedCodeUnits += 1;
  }

  return scannedCodeUnits > 0 && scannedCodeUnits <= MAX_LOCAL_PART_CODE_UNITS
    ? start
    : undefined;
}

function findDomainEnd(
  prompt: string,
  domainStart: number,
): number | undefined {
  let rawEnd = domainStart;
  let scannedCodeUnits = 0;

  while (
    rawEnd < prompt.length &&
    scannedCodeUnits < MAX_DOMAIN_SCAN_CODE_UNITS &&
    isDomainCharacter(prompt[rawEnd] ?? "")
  ) {
    rawEnd += 1;
    scannedCodeUnits += 1;
  }

  if (
    scannedCodeUnits === MAX_DOMAIN_SCAN_CODE_UNITS &&
    isDomainCharacter(prompt[rawEnd] ?? "")
  ) {
    return undefined;
  }

  const rawDomain = prompt.slice(domainStart, rawEnd);
  const hasSingleTrailingPeriod =
    rawDomain.endsWith(".") && !rawDomain.endsWith("..");
  const end = hasSingleTrailingPeriod ? rawEnd - 1 : rawEnd;

  return end > domainStart ? end : undefined;
}

function hasValidLocalPart(localPart: string): boolean {
  return (
    localPart.length <= MAX_LOCAL_PART_CODE_UNITS &&
    !localPart.startsWith(".") &&
    !localPart.endsWith(".") &&
    !localPart.includes("..")
  );
}

function hasValidDomain(domain: string): boolean {
  if (domain.length > MAX_DOMAIN_CODE_UNITS) {
    return false;
  }

  const labels = domain.split(".");
  return (
    labels.length >= 2 &&
    labels.every(
      (label) =>
        label.length > 0 &&
        label.length <= 63 &&
        !label.startsWith("-") &&
        !label.endsWith("-"),
    )
  );
}

export function detectEmails(prompt: string): FindingForDetector<"email">[] {
  const findings: FindingForDetector<"email">[] = [];
  let searchIndex = 0;

  while (searchIndex < prompt.length) {
    const atIndex = prompt.indexOf("@", searchIndex);
    if (atIndex === -1) {
      break;
    }
    searchIndex = atIndex + 1;

    const start = findLocalPartStart(prompt, atIndex);
    const end = findDomainEnd(prompt, atIndex + 1);
    if (start === undefined || end === undefined) {
      continue;
    }

    const localPart = prompt.slice(start, atIndex);
    const domain = prompt.slice(atIndex + 1, end);

    if (
      !hasValidLocalPart(localPart) ||
      !hasValidDomain(domain) ||
      !hasTokenBoundaries(prompt, start, end, {
        disallowedBefore: EMAIL_BOUNDARY_PUNCTUATION,
        disallowedAfter: EMAIL_TRAILING_CONTINUATION_PUNCTUATION,
      })
    ) {
      continue;
    }

    findings.push(
      createFinding(prompt, {
        detectorId: "email",
        start,
        end,
        confidence: "high",
      }),
    );
  }

  return findings;
}
