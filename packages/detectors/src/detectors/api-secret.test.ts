import { describe, expect, it } from "vitest";

import sensitiveValues from "../../../../tests/fixtures/sensitive-values.json";

import { detectApiSecrets } from "./api-secret.js";

describe("detectApiSecrets", () => {
  it.each([
    ["api_key", sensitiveValues.apiSecret.knownPrefix, "high"],
    ["api_key", sensitiveValues.apiSecret.githubClassicPrefix, "high"],
    ["token", sensitiveValues.apiSecret.githubFineGrainedPrefix, "high"],
    ["token", sensitiveValues.apiSecret.slackBotPrefix, "high"],
    ["apikey", sensitiveValues.apiSecret.highMixed, "high"],
    ["client_secret", sensitiveValues.apiSecret.mediumMixed, "medium"],
    ["token", sensitiveValues.apiSecret.mediumMixed, "medium"],
    ["secret", sensitiveValues.apiSecret.mediumMixed, "medium"],
    ["password", sensitiveValues.apiSecret.mediumMixed, "medium"],
  ] as const)(
    "detects contextual %s values at %s confidence",
    (contextKey, secretValue, confidence) => {
      const prompt = `${contextKey} = "${secretValue}"`;
      const finding = detectApiSecrets(prompt)[0];

      expect(finding).toEqual(
        expect.objectContaining({
          detectorId: "api-secret",
          category: "api_secret",
          confidence,
          matchedText: secretValue,
          redactedText: "[API_SECRET]",
          start: prompt.indexOf(secretValue),
          end: prompt.indexOf(secretValue) + secretValue.length,
        }),
      );
    },
  );

  it.each([
    `TOKEN:${sensitiveValues.apiSecret.mediumMixed}`,
    `Api_Key\t=\t'${sensitiveValues.apiSecret.knownPrefix}'`,
  ])(
    "matches context keys case-insensitively with horizontal spacing",
    (prompt) => {
      expect(detectApiSecrets(prompt)).toHaveLength(1);
    },
  );

  it.each(["Ab1_".repeat(3), "Ab1_".repeat(64)])(
    "accepts a composed value at the supported boundary length",
    (secretValue) => {
      const prompt = `secret=${secretValue}`;

      expect(detectApiSecrets(prompt)[0]?.matchedText).toBe(secretValue);
    },
  );

  it.each([
    sensitiveValues.apiSecret.highMixed,
    `note: ${sensitiveValues.apiSecret.mediumMixed}`,
    `api_key ${sensitiveValues.apiSecret.knownPrefix}`,
    `api_key => ${sensitiveValues.apiSecret.knownPrefix}`,
    `api_key:\n${sensitiveValues.apiSecret.knownPrefix}`,
    "api_key=short_A1",
    "api_key=replace_me_now",
    "api_key=SECRET_VALUE",
    "api_key=YOUR_API_KEY",
    "api_key=YOUR_SECRET_HERE",
    "api_key=EXAMPLE_SECRET",
    "api_key=DUMMY_SECRET",
    "api_key=TOKEN_VALUE",
    "api_key=PASSWORD_VALUE",
    "api_key=SAMPLE_SECRET",
    "api_key=FAKE_SECRET",
    "api_key=$SECRET_VALUE",
    "api_key=${SECRET_VALUE}",
    "api_key=AAAAAAAAAAAA",
    "api_key=this-is-ordinary-prose",
    `my_api_key=${sensitiveValues.apiSecret.knownPrefix}`,
    `api_key_name=${sensitiveValues.apiSecret.knownPrefix}`,
    `ſecret=${sensitiveValues.apiSecret.mediumMixed}`,
    `toKen=${sensitiveValues.apiSecret.mediumMixed}`,
    `apı_key=${sensitiveValues.apiSecret.mediumMixed}`,
    `api_key="${sensitiveValues.apiSecret.knownPrefix}`,
    `api_key=${"Ab1_".repeat(65)}`,
  ])(
    "rejects non-contextual, placeholder, malformed, or unbounded input",
    (prompt) => {
      expect(detectApiSecrets(prompt)).toEqual([]);
    },
  );

  it.each(["é", "Đ", "𐐀", "\u0301"])(
    "rejects an unquoted candidate followed by Unicode token continuation %s",
    (continuation) => {
      const secretValue = sensitiveValues.apiSecret.mediumMixed;

      expect(detectApiSecrets(`token=${secretValue}${continuation}`)).toEqual(
        [],
      );
    },
  );

  it.each(["é", "Đ", "𐐀", "\u0301", "_"])(
    "rejects a quoted candidate followed by Unicode token continuation %s",
    (continuation) => {
      const secretValue = sensitiveValues.apiSecret.mediumMixed;

      expect(detectApiSecrets(`token="${secretValue}"${continuation}`)).toEqual(
        [],
      );
    },
  );

  it("never emits low-confidence findings", () => {
    const prompt = `secret=${sensitiveValues.apiSecret.mediumMixed}`;

    expect(
      detectApiSecrets(prompt).every(
        (finding) =>
          finding.confidence === "high" || finding.confidence === "medium",
      ),
    ).toBe(true);
  });

  it("returns several contextual values in exact source order", () => {
    const { highMixed, mediumMixed } = sensitiveValues.apiSecret;
    const prompt = `token=${mediumMixed}; password='${highMixed}'`;

    expect(
      detectApiSecrets(prompt).map((finding) => finding.matchedText),
    ).toEqual([mediumMixed, highMixed]);
  });

  it("bounds parsing of adversarial exactly-limit contextual input", () => {
    const prefix = "api_key=";
    const prompt = `${prefix}${"A1_".repeat(
      Math.ceil((100_000 - prefix.length) / 3),
    )}`.slice(0, 100_000);
    const startedAt = Date.now();

    expect(prompt).toHaveLength(100_000);
    expect(detectApiSecrets(prompt)).toEqual([]);
    expect(Date.now() - startedAt).toBeLessThan(500);
  });
});
