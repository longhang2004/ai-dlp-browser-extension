import { describe, expect, it } from "vitest";

import sensitiveValues from "../../../tests/fixtures/sensitive-values.json";

import { MAX_PROMPT_CODE_UNITS, analyzePrompt } from "./analyze.js";

describe("analyzePrompt", () => {
  it("returns no findings for an empty prompt", () => {
    expect(analyzePrompt("", { protectedKeywords: [] })).toEqual([]);
  });

  it("accepts an exact frozen options snapshot", () => {
    const options = Object.freeze({
      protectedKeywords: Object.freeze(["NOVA-42"]),
    });

    expect(analyzePrompt("NOVA-42", options)).toHaveLength(1);
  });

  it("runs the complete detector suite and returns canonical source order", () => {
    const { validVisa } = sensitiveValues.paymentCard;
    const { longLived } = sensitiveValues.awsAccessKey;
    const { mediumMixed } = sensitiveValues.apiSecret;
    const { projectCode } = sensitiveValues.protectedKeyword;
    const prompt = [
      `Liên hệ ${sensitiveValues.email.valid}`,
      `điện thoại ${sensitiveValues.phone.vietnameseDomestic}`,
      `thẻ ${validVisa}`,
      `AWS ${longLived}`,
      `token=${mediumMixed}`,
      `mã ${projectCode}`,
      sensitiveValues.privateKey.generic,
    ].join("\n");

    const findings = analyzePrompt(prompt, {
      protectedKeywords: [projectCode],
    });

    expect(findings.map((finding) => finding.category)).toEqual([
      "email",
      "phone",
      "payment_card",
      "aws_access_key",
      "api_secret",
      "protected_keyword",
      "private_key",
    ]);
    expect(
      findings.every(
        (finding) =>
          finding.matchedText === prompt.slice(finding.start, finding.end),
      ),
    ).toBe(true);
  });

  it("retains overlapping findings and uses security priority as a tie-break", () => {
    const secret = sensitiveValues.apiSecret.mediumMixed;
    const prompt = `token=${secret}`;

    const findings = analyzePrompt(prompt, {
      protectedKeywords: [secret],
    });

    expect(findings.map((finding) => finding.detectorId)).toEqual([
      "api-secret",
      "protected-keyword",
    ]);
    expect(findings[0]?.start).toBe(findings[1]?.start);
    expect(findings[0]?.end).toBe(findings[1]?.end);
  });

  it("orders equal-start findings by end descending", () => {
    const prompt = "NOVA-42";

    expect(
      analyzePrompt(prompt, {
        protectedKeywords: ["NOVA", "NOVA-42"],
      }).map((finding) => finding.matchedText),
    ).toEqual(["NOVA-42", "NOVA"]);
  });

  it("returns stable identifiers and ordering across repeated analysis", () => {
    const prompt = `${sensitiveValues.email.valid} ${sensitiveValues.email.valid}`;
    const options = { protectedKeywords: [] };

    expect(analyzePrompt(prompt, options)).toEqual(
      analyzePrompt(prompt, options),
    );
  });

  it("preserves UTF-16 offsets around astral and Vietnamese text", () => {
    const email = sensitiveValues.email.valid;
    const prompt = `😊 Tiếng Việt: ${email}`;
    const finding = analyzePrompt(prompt, { protectedKeywords: [] })[0];

    expect(finding).toEqual(
      expect.objectContaining({
        start: prompt.indexOf(email),
        end: prompt.indexOf(email) + email.length,
        matchedText: email,
      }),
    );
  });

  it("supports exactly 100,000 UTF-16 code units", () => {
    const email = sensitiveValues.email.valid;
    const prompt = `${"x".repeat(
      MAX_PROMPT_CODE_UNITS - email.length - 1,
    )} ${email}`;

    expect(prompt).toHaveLength(100_000);
    expect(
      analyzePrompt(prompt, { protectedKeywords: [] }).map(
        (finding) => finding.matchedText,
      ),
    ).toEqual([email]);
  });

  it("rejects 100,001 code units before returning a partial analysis", () => {
    const prompt = `${sensitiveValues.email.valid}${"x".repeat(
      MAX_PROMPT_CODE_UNITS + 1 - sensitiveValues.email.valid.length,
    )}`;

    expect(prompt).toHaveLength(100_001);
    expect(() =>
      analyzePrompt(prompt, {
        protectedKeywords: [sensitiveValues.email.valid],
      }),
    ).toThrow("Prompt exceeds the supported inspection limit.");
  });

  it("checks the size bound before protected-keyword validation", () => {
    const prompt = "x".repeat(MAX_PROMPT_CODE_UNITS + 1);

    expect(() => analyzePrompt(prompt, { protectedKeywords: [""] })).toThrow(
      "Prompt exceeds the supported inspection limit.",
    );
  });

  it("does not inspect hostile options when the prompt is oversized", () => {
    const marker = "DO_NOT_EXPOSE_THIS_OVERSIZED_OPTION_VALUE";
    let accessed = false;
    const options = new Proxy({} as { protectedKeywords: readonly string[] }, {
      ownKeys() {
        accessed = true;
        throw new Error(marker);
      },
      getOwnPropertyDescriptor() {
        accessed = true;
        throw new Error(marker);
      },
      getPrototypeOf() {
        accessed = true;
        throw new Error(marker);
      },
    });

    expect(() =>
      analyzePrompt("x".repeat(MAX_PROMPT_CODE_UNITS + 1), options),
    ).toThrow("Prompt exceeds the supported inspection limit.");
    expect(accessed).toBe(false);
  });

  it.each([
    ["missing options", undefined],
    ["null options", null],
    ["missing key", {}],
    ["unknown key", { protectedKeywords: [], unknown: true }],
    ["wrong value", { protectedKeywords: "NOVA-42" }],
    ["invalid keyword", { protectedKeywords: [""] }],
    [
      "too many keywords",
      { protectedKeywords: Array.from({ length: 101 }, () => "keyword") },
    ],
    ["sparse keywords", { protectedKeywords: new Array<string>(1) }],
    [
      "cyclic keywords",
      (() => {
        const keywords: unknown[] = [];
        keywords.push(keywords);
        return { protectedKeywords: keywords };
      })(),
    ],
    [
      "custom options prototype",
      Object.assign(Object.create({ inherited: true }) as object, {
        protectedKeywords: [],
      }),
    ],
    [
      "custom array prototype",
      {
        protectedKeywords: Object.setPrototypeOf([], {
          inherited: true,
        }) as string[],
      },
    ],
    [
      "hidden option extra",
      (() => {
        const options = { protectedKeywords: [] as string[] };
        Object.defineProperty(options, "hidden", { value: true });
        return options;
      })(),
    ],
    [
      "symbol option extra",
      {
        protectedKeywords: [] as string[],
        [Symbol("extra")]: true,
      },
    ],
    [
      "decorated keyword array",
      (() => {
        const keywords: string[] = [];
        Object.defineProperty(keywords, "hidden", { value: true });
        return { protectedKeywords: keywords };
      })(),
    ],
  ])("rejects %s before analysis", (_label, options) => {
    expect(() =>
      analyzePrompt("clean", options as { protectedKeywords: string[] }),
    ).toThrow("Invalid analysis input.");
  });

  it("rejects option and array accessors without invoking them", () => {
    const marker = "DO_NOT_EXPOSE_THIS_GETTER_VALUE";
    let invocationCount = 0;
    const optionsAccessor = {} as { protectedKeywords: string[] };
    Object.defineProperty(optionsAccessor, "protectedKeywords", {
      enumerable: true,
      get() {
        invocationCount += 1;
        throw new Error(marker);
      },
    });
    const keywordAccessor: string[] = [];
    Object.defineProperty(keywordAccessor, "0", {
      enumerable: true,
      get() {
        invocationCount += 1;
        throw new Error(marker);
      },
    });
    keywordAccessor.length = 1;

    for (const options of [
      optionsAccessor,
      { protectedKeywords: keywordAccessor },
    ]) {
      expect(() => analyzePrompt("clean", options)).toThrow(
        "Invalid analysis input.",
      );
    }
    expect(invocationCount).toBe(0);
  });

  it("normalizes hostile option proxy failures to a content-free error", () => {
    const marker = "DO_NOT_EXPOSE_THIS_OPTION_PROXY_VALUE";
    const options = new Proxy(
      { protectedKeywords: [] as string[] },
      {
        ownKeys() {
          throw new Error(marker);
        },
      },
    );

    try {
      analyzePrompt("clean", options);
      throw new Error("Expected hostile options to be rejected.");
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toBe("Invalid analysis input.");
      expect((error as Error).message).not.toContain(marker);
    }
  });

  it("uses a content-free oversized error", () => {
    const marker = "DO_NOT_EXPOSE_THIS_PROMPT_VALUE";
    const prompt = `${marker}${"x".repeat(
      MAX_PROMPT_CODE_UNITS + 1 - marker.length,
    )}`;

    try {
      analyzePrompt(prompt, { protectedKeywords: [] });
      throw new Error("Expected analysis to reject the oversized prompt.");
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).not.toContain(marker);
    }
  });

  it("keeps a worst-case exactly-limit no-match probe bounded", () => {
    const prompt = "x".repeat(MAX_PROMPT_CODE_UNITS);
    const keywords = Array.from(
      { length: 100 },
      (_, index) => `k${String(index).padStart(3, "0")}-${"z".repeat(95)}`,
    );
    const startedAt = Date.now();

    expect(analyzePrompt(prompt, { protectedKeywords: keywords })).toEqual([]);
    expect(Date.now() - startedAt).toBeLessThan(1_000);
  });
});
