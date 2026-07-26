import { createFinding } from "../finding.js";
import type { FindingForDetector } from "../finding.js";

const PRIVATE_KEY_HEADER_PATTERN =
  /-----BEGIN (PRIVATE KEY|RSA PRIVATE KEY|EC PRIVATE KEY)-----/gu;
const MIN_PAYLOAD_CODE_UNITS = 64;
const MAX_PAYLOAD_CODE_UNITS = 16_384;
const MAX_RAW_BODY_CODE_UNITS = 32_768;
const MAX_BODY_LINES = 512;

function isLineStart(prompt: string, index: number): boolean {
  return index === 0 || prompt[index - 1] === "\n";
}

function bodyStartAfterLineBreak(
  prompt: string,
  headerEnd: number,
): number | undefined {
  if (prompt.startsWith("\r\n", headerEnd)) {
    return headerEnd + 2;
  }

  return prompt[headerEnd] === "\n" ? headerEnd + 1 : undefined;
}

function hasFooterLineEnd(prompt: string, footerEnd: number): boolean {
  return (
    footerEnd === prompt.length ||
    prompt[footerEnd] === "\n" ||
    prompt.startsWith("\r\n", footerEnd)
  );
}

function isPlausibleBody(rawBody: string): boolean {
  if (
    rawBody.length === 0 ||
    rawBody.length > MAX_RAW_BODY_CODE_UNITS ||
    !/^[A-Za-z0-9+/=\t \r\n]+$/u.test(rawBody)
  ) {
    return false;
  }

  let lineCount = 1;
  for (let index = 0; index < rawBody.length; index += 1) {
    if (rawBody[index] === "\n") {
      lineCount += 1;
      if (lineCount > MAX_BODY_LINES) {
        return false;
      }
    }
  }

  const payload = rawBody.replace(/[\t \r\n]/gu, "");
  return (
    payload.length >= MIN_PAYLOAD_CODE_UNITS &&
    payload.length <= MAX_PAYLOAD_CODE_UNITS &&
    payload.length % 4 === 0 &&
    /^[A-Za-z0-9+/]+={0,2}$/u.test(payload)
  );
}

export function detectPrivateKeys(
  prompt: string,
): FindingForDetector<"private-key">[] {
  const findings: FindingForDetector<"private-key">[] = [];

  for (const headerMatch of prompt.matchAll(PRIVATE_KEY_HEADER_PATTERN)) {
    const start = headerMatch.index;
    const label = headerMatch[1];
    if (label === undefined || !isLineStart(prompt, start)) {
      continue;
    }

    const bodyStart = bodyStartAfterLineBreak(
      prompt,
      start + headerMatch[0].length,
    );
    if (bodyStart === undefined) {
      continue;
    }

    const footer = `-----END ${label}-----`;
    const footerStart = prompt.indexOf(footer, bodyStart);
    if (
      footerStart === -1 ||
      footerStart - bodyStart > MAX_RAW_BODY_CODE_UNITS ||
      footerStart === bodyStart ||
      prompt[footerStart - 1] !== "\n"
    ) {
      continue;
    }

    const end = footerStart + footer.length;
    if (
      !hasFooterLineEnd(prompt, end) ||
      !isPlausibleBody(prompt.slice(bodyStart, footerStart))
    ) {
      continue;
    }

    findings.push(
      createFinding(prompt, {
        detectorId: "private-key",
        start,
        end,
        confidence: "high",
      }),
    );
  }

  return findings;
}
