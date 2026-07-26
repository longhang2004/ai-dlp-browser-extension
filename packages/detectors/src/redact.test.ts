import { createFindingId } from "@ai-dlp/shared-types";
import type { SensitiveDataFinding } from "@ai-dlp/shared-types";
import { describe, expect, it } from "vitest";

import { createFinding } from "./finding.js";
import { MAX_PROMPT_CODE_UNITS } from "./analyze.js";
import { redactPrompt } from "./redact.js";

function makeFinding(
  prompt: string,
  detectorId:
    | "api-secret"
    | "aws-access-key"
    | "email"
    | "payment-card"
    | "phone"
    | "private-key"
    | "protected-keyword",
  start: number,
  end: number,
): SensitiveDataFinding {
  return createFinding(prompt, {
    detectorId,
    start,
    end,
    confidence: detectorId === "api-secret" ? "medium" : "high",
  });
}

describe("redactPrompt", () => {
  it("returns the unchanged prompt and no applied findings for empty input", () => {
    expect(redactPrompt("Không có dữ liệu", [])).toEqual({
      sanitizedText: "Không có dữ liệu",
      appliedFindings: [],
    });
  });

  it("applies disjoint ranges from end to start in canonical source order", () => {
    const prompt = "Email abc then phone xyz.";
    const email = makeFinding(prompt, "email", 6, 9);
    const phone = makeFinding(prompt, "phone", 21, 24);

    expect(redactPrompt(prompt, [phone, email])).toEqual({
      sanitizedText: "Email [EMAIL] then phone [PHONE].",
      appliedFindings: [email, phone],
    });
  });

  it("merges overlaps, removes the full union, and chooses security priority", () => {
    const prompt = "ABCDEFGHIJ";
    const privateKey = makeFinding(prompt, "private-key", 0, 5);
    const email = makeFinding(prompt, "email", 3, 8);
    const phone = makeFinding(prompt, "phone", 8, 10);

    expect(redactPrompt(prompt, [phone, email, privateKey])).toEqual({
      sanitizedText: "[PRIVATE_KEY][PHONE]",
      appliedFindings: [privateKey, email, phone],
    });
  });

  it("does not merge adjacent ranges", () => {
    const prompt = "abcdef";
    const email = makeFinding(prompt, "email", 0, 3);
    const aws = makeFinding(prompt, "aws-access-key", 3, 6);

    expect(redactPrompt(prompt, [aws, email])).toEqual({
      sanitizedText: "[EMAIL][AWS_ACCESS_KEY]",
      appliedFindings: [email, aws],
    });
  });

  it("retains every overlapping finding in appliedFindings", () => {
    const prompt = "0123456789";
    const outerKeyword = makeFinding(
      prompt,
      "protected-keyword",
      0,
      prompt.length,
    );
    const card = makeFinding(prompt, "payment-card", 2, 7);
    const apiSecret = makeFinding(prompt, "api-secret", 4, 9);

    expect(redactPrompt(prompt, [apiSecret, card, outerKeyword])).toEqual({
      sanitizedText: "[PAYMENT_CARD]",
      appliedFindings: [outerKeyword, card, apiSecret],
    });
  });

  it.each([
    [["private-key", "aws-access-key"], "[PRIVATE_KEY]"],
    [["aws-access-key", "payment-card"], "[AWS_ACCESS_KEY]"],
    [["payment-card", "api-secret"], "[PAYMENT_CARD]"],
    [["api-secret", "email"], "[API_SECRET]"],
    [["email", "phone"], "[EMAIL]"],
    [["phone", "protected-keyword"], "[PHONE]"],
  ] as const)(
    "selects the fixed priority winner between %s",
    (detectorIds, placeholder) => {
      const prompt = "overlap";
      const findings = detectorIds.map((detectorId) =>
        makeFinding(prompt, detectorId, 0, prompt.length),
      );

      expect(redactPrompt(prompt, findings).sanitizedText).toBe(placeholder);
    },
  );

  it("preserves UTF-16 ranges while replacing Unicode source text", () => {
    const prompt = "😊 Liên hệ thư@example.test ngay";
    const matchedText = "thư@example.test";
    const start = prompt.indexOf(matchedText);
    const finding = makeFinding(
      prompt,
      "email",
      start,
      start + matchedText.length,
    );

    expect(redactPrompt(prompt, [finding]).sanitizedText).toBe(
      "😊 Liên hệ [EMAIL] ngay",
    );
  });

  it.each([
    [
      "out-of-range",
      (finding: SensitiveDataFinding) => ({ ...finding, end: 99 }),
    ],
    [
      "empty-range",
      (finding: SensitiveDataFinding) => ({
        ...finding,
        end: finding.start,
      }),
    ],
    [
      "non-integer-range",
      (finding: SensitiveDataFinding) => ({
        ...finding,
        start: finding.start + 0.5,
      }),
    ],
    [
      "wrong-slice",
      (finding: SensitiveDataFinding) => ({
        ...finding,
        matchedText: "not-the-source",
      }),
    ],
    [
      "wrong-id",
      (finding: SensitiveDataFinding) => ({
        ...finding,
        id: createFindingId("email", 1, 2),
      }),
    ],
    [
      "wrong-category",
      (finding: SensitiveDataFinding) => ({
        ...finding,
        category: "phone",
      }),
    ],
    [
      "wrong-placeholder",
      (finding: SensitiveDataFinding) => ({
        ...finding,
        redactedText: "[PHONE]",
      }),
    ],
    [
      "wrong-confidence",
      (finding: SensitiveDataFinding) => ({
        ...finding,
        confidence: "certain",
      }),
    ],
    [
      "unknown-key",
      (finding: SensitiveDataFinding) => ({
        ...finding,
        prompt: "must not be accepted",
      }),
    ],
  ])("rejects %s findings with a content-free error", (_label, mutate) => {
    const prompt = "source";
    const finding = makeFinding(prompt, "email", 0, prompt.length);
    const invalidFinding = mutate(finding) as SensitiveDataFinding;

    expect(() => redactPrompt(prompt, [invalidFinding])).toThrow(
      "Invalid redaction input.",
    );
  });

  it("rejects duplicate canonical findings", () => {
    const prompt = "source";
    const finding = makeFinding(prompt, "email", 0, prompt.length);

    expect(() => redactPrompt(prompt, [finding, finding])).toThrow(
      "Invalid redaction input.",
    );
  });

  it("rejects non-finding values and non-array collections", () => {
    expect(() =>
      redactPrompt("source", [null] as unknown as SensitiveDataFinding[]),
    ).toThrow("Invalid redaction input.");
    expect(() =>
      redactPrompt("source", {} as unknown as SensitiveDataFinding[]),
    ).toThrow("Invalid redaction input.");
  });

  it("rejects sparse and decorated finding arrays", () => {
    const sparseFindings = new Array<SensitiveDataFinding>(1);
    const decoratedFindings: SensitiveDataFinding[] = [];
    Object.defineProperty(decoratedFindings, "promptValue", {
      value: "DO_NOT_EXPOSE_THIS_ARRAY_VALUE",
      enumerable: true,
    });

    expect(() => redactPrompt("source", sparseFindings)).toThrow(
      "Invalid redaction input.",
    );
    expect(() => redactPrompt("source", decoratedFindings)).toThrow(
      "Invalid redaction input.",
    );
  });

  it("normalizes accessor and proxy failures to a content-free error", () => {
    const marker = "DO_NOT_EXPOSE_THIS_ACCESSOR_VALUE";
    const finding = makeFinding("source", "email", 0, "source".length);
    const accessorFinding = { ...finding };
    Object.defineProperty(accessorFinding, "detectorId", {
      enumerable: true,
      get() {
        throw new Error(marker);
      },
    });
    const proxyFinding = new Proxy(finding, {
      ownKeys() {
        throw new Error(marker);
      },
    });

    for (const invalidFinding of [accessorFinding, proxyFinding]) {
      expect(() =>
        redactPrompt("source", [
          invalidFinding as unknown as SensitiveDataFinding,
        ]),
      ).toThrow("Invalid redaction input.");
      try {
        redactPrompt("source", [
          invalidFinding as unknown as SensitiveDataFinding,
        ]);
      } catch (error) {
        expect(error).toBeInstanceOf(Error);
        expect((error as Error).message).not.toContain(marker);
      }
    }
  });

  it("does not mutate the input collection", () => {
    const prompt = "abcdef";
    const later = makeFinding(prompt, "phone", 3, 6);
    const earlier = makeFinding(prompt, "email", 0, 3);
    const findings = [later, earlier];

    redactPrompt(prompt, findings);

    expect(findings).toEqual([later, earlier]);
  });

  it("does not expose prompt-derived values in validation errors", () => {
    const marker = "DO_NOT_EXPOSE_THIS_PROMPT_VALUE";
    const finding = makeFinding(marker, "email", 0, marker.length);
    const invalid = { ...finding, matchedText: "wrong" };

    try {
      redactPrompt(marker, [invalid as SensitiveDataFinding]);
      throw new Error("Expected redaction to reject invalid input.");
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).not.toContain(marker);
    }
  });

  it("rejects prompts beyond the supported analysis bound", () => {
    expect(() =>
      redactPrompt("x".repeat(MAX_PROMPT_CODE_UNITS + 1), []),
    ).toThrow("Invalid redaction input.");
  });

  it("handles a dense canonical finding set without quadratic merging", () => {
    const prompt = "x".repeat(10_000);
    const findings = Array.from({ length: 5_000 }, (_, index) =>
      makeFinding(
        prompt,
        index % 2 === 0 ? "email" : "phone",
        index,
        index + 2,
      ),
    );
    const startedAt = Date.now();
    const result = redactPrompt(prompt, findings);

    expect(result.sanitizedText).toBe(
      `[EMAIL]${"x".repeat(prompt.length - 5_001)}`,
    );
    expect(result.appliedFindings).toHaveLength(findings.length);
    expect(Date.now() - startedAt).toBeLessThan(1_000);
  });

  it("redacts 5,000 dense disjoint ranges within a linear-time ceiling", () => {
    const findingCount = 5_000;
    const prompt = "xy".repeat(MAX_PROMPT_CODE_UNITS / 2);
    const findings = Array.from({ length: findingCount }, (_, index) => {
      const start = index * 2;
      return makeFinding(prompt, "email", start, start + 1);
    });
    const startedAt = Date.now();
    const result = redactPrompt(prompt, findings);

    expect(result.sanitizedText.startsWith("[EMAIL]y[EMAIL]y")).toBe(true);
    expect(result.sanitizedText.endsWith("xy".repeat(45_000))).toBe(true);
    expect(result.appliedFindings).toHaveLength(findingCount);
    expect(Date.now() - startedAt).toBeLessThan(1_000);
  });
});
