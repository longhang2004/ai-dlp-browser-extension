import { hasTokenBoundaries } from "../boundary.js";
import { createFinding } from "../finding.js";
import type { FindingForDetector } from "../finding.js";

const AWS_ACCESS_KEY_PATTERN = /(?:AKIA|ASIA)[A-Z0-9]{16}/gu;

export function detectAwsAccessKeys(
  prompt: string,
): FindingForDetector<"aws-access-key">[] {
  const findings: FindingForDetector<"aws-access-key">[] = [];

  for (const match of prompt.matchAll(AWS_ACCESS_KEY_PATTERN)) {
    const start = match.index;
    const end = start + match[0].length;

    if (!hasTokenBoundaries(prompt, start, end)) {
      continue;
    }

    findings.push(
      createFinding(prompt, {
        detectorId: "aws-access-key",
        start,
        end,
        confidence: "high",
      }),
    );
  }

  return findings;
}
