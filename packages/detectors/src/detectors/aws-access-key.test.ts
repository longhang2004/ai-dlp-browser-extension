import { describe, expect, it } from "vitest";

import sensitiveValues from "../../../../tests/fixtures/sensitive-values.json";

import { detectAwsAccessKeys } from "./aws-access-key.js";

function materializeFixture(value: { parts: string[] }): string {
  return value.parts.join("");
}

const awsAccessKey = {
  longLived: materializeFixture(sensitiveValues.awsAccessKey.longLived),
  temporary: materializeFixture(sensitiveValues.awsAccessKey.temporary),
};

describe("detectAwsAccessKeys", () => {
  it.each([awsAccessKey.longLived, awsAccessKey.temporary])(
    "detects a supported access key ID with exact source range",
    (accessKey) => {
      const prompt = `Credential: ${accessKey}.`;
      const finding = detectAwsAccessKeys(prompt)[0];

      expect(finding).toEqual(
        expect.objectContaining({
          detectorId: "aws-access-key",
          category: "aws_access_key",
          confidence: "high",
          matchedText: accessKey,
          redactedText: "[AWS_ACCESS_KEY]",
          start: prompt.indexOf(accessKey),
          end: prompt.indexOf(accessKey) + accessKey.length,
        }),
      );
    },
  );

  it.each([
    "AKIAABCDEFGHIJKLMNO",
    "AKIAABCDEFGHIJKLMNOPQ",
    "ASIAabcdefgh12345678",
    "ABCDABCDEFGHIJKLMNOP",
    `X${awsAccessKey.longLived}`,
    `${awsAccessKey.longLived}X`,
    `_${awsAccessKey.longLived}`,
    `${awsAccessKey.longLived}_`,
    `𐐀${awsAccessKey.longLived}`,
    `${awsAccessKey.longLived}𝟙`,
    `\u0301${awsAccessKey.longLived}`,
  ])("rejects malformed or embedded token %s", (prompt) => {
    expect(detectAwsAccessKeys(prompt)).toEqual([]);
  });

  it("returns multiple keys in stable source order", () => {
    const { longLived, temporary } = awsAccessKey;
    const prompt = `${temporary}; then ${longLived}`;

    expect(
      detectAwsAccessKeys(prompt).map((finding) => finding.matchedText),
    ).toEqual([temporary, longLived]);
  });

  it("handles a worst-case exactly-limit prompt with a bounded scan", () => {
    const prompt = "A".repeat(100_000);
    const startedAt = Date.now();

    expect(detectAwsAccessKeys(prompt)).toEqual([]);
    expect(Date.now() - startedAt).toBeLessThan(500);
  });
});
