import { describe, expect, it } from "vitest";

import sensitiveValues from "../../../../tests/fixtures/sensitive-values.json";

import { detectPrivateKeys } from "./private-key.js";

function createPem(label: string, payload: string): string {
  return `-----BEGIN ${label}-----\n${payload}\n-----END ${label}-----`;
}

describe("detectPrivateKeys", () => {
  it.each([
    sensitiveValues.privateKey.generic,
    sensitiveValues.privateKey.rsa,
    sensitiveValues.privateKey.ec,
  ])("detects a complete supported PEM block", (privateKey) => {
    const prompt = `Rotate this key:\n${privateKey}\nImmediately.`;
    const finding = detectPrivateKeys(prompt)[0];

    expect(finding).toEqual(
      expect.objectContaining({
        detectorId: "private-key",
        category: "private_key",
        confidence: "high",
        matchedText: privateKey,
        redactedText: "[PRIVATE_KEY]",
        start: prompt.indexOf(privateKey),
        end: prompt.indexOf(privateKey) + privateKey.length,
      }),
    );
  });

  it("accepts permitted PEM line whitespace without changing the source range", () => {
    const payload = "QUJD".repeat(16);
    const privateKey = createPem(
      "PRIVATE KEY",
      `  ${payload.slice(0, 32)}\t\n${payload.slice(32)}  `,
    );

    expect(detectPrivateKeys(privateKey)[0]?.matchedText).toBe(privateKey);
  });

  it.each([
    "-----BEGIN PRIVATE KEY-----\nQUJD\n",
    "-----BEGIN PRIVATE KEY-----\nQUJD".concat(
      "A".repeat(60),
      "\n-----END RSA PRIVATE KEY-----",
    ),
    createPem("OPENSSH PRIVATE KEY", "QUJD".repeat(16)),
    createPem("PRIVATE KEY", "A".repeat(63)),
    createPem("PRIVATE KEY", "A".repeat(16_385)),
    createPem("PRIVATE KEY", "A".repeat(65)),
    createPem("PRIVATE KEY", `${"A".repeat(63)}!`),
    createPem("PRIVATE KEY", `${"A".repeat(62)}===`),
    createPem("PRIVATE KEY", `${"\n".repeat(512)}${"A".repeat(64)}`),
    `prefix${sensitiveValues.privateKey.generic}`,
    `${sensitiveValues.privateKey.generic}suffix`,
  ])("rejects malformed, mismatched, or unbounded PEM input", (prompt) => {
    expect(detectPrivateKeys(prompt)).toEqual([]);
  });

  it("returns multiple complete blocks in source order", () => {
    const { ec, generic } = sensitiveValues.privateKey;
    const prompt = `${ec}\n\n${generic}`;

    expect(
      detectPrivateKeys(prompt).map((finding) => finding.matchedText),
    ).toEqual([ec, generic]);
  });

  it("bounds work for a 100,000-code-unit unterminated block", () => {
    const header = "-----BEGIN PRIVATE KEY-----\n";
    const prompt = `${header}${"A".repeat(100_000 - header.length)}`;
    const startedAt = Date.now();

    expect(prompt).toHaveLength(100_000);
    expect(detectPrivateKeys(prompt)).toEqual([]);
    expect(Date.now() - startedAt).toBeLessThan(500);
  });
});
