import {
  createFindingId,
  DETECTOR_CATEGORY,
  SENSITIVE_DATA_PLACEHOLDERS,
} from "@ai-dlp/shared-types";
import type {
  DetectorId,
  FindingConfidence,
  SensitiveDataFinding,
} from "@ai-dlp/shared-types";

export type FindingForDetector<Detector extends DetectorId> = Extract<
  SensitiveDataFinding,
  { detectorId: Detector }
>;

type FindingInput<Detector extends DetectorId> = Readonly<{
  detectorId: Detector;
  start: number;
  end: number;
  confidence: FindingConfidence;
}>;

type AnyFindingInput = {
  [Detector in DetectorId]: FindingInput<Detector>;
}[DetectorId];

export function createFinding<Detector extends DetectorId>(
  prompt: string,
  input: FindingInput<Detector>,
): FindingForDetector<Detector>;
export function createFinding(
  prompt: string,
  input: AnyFindingInput,
): SensitiveDataFinding {
  const { detectorId, start, end, confidence } = input;

  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    start < 0 ||
    end <= start ||
    end > prompt.length
  ) {
    throw new Error("Invalid finding range.");
  }

  const base = {
    start,
    end,
    confidence,
    matchedText: prompt.slice(start, end),
  };

  switch (detectorId) {
    case "email":
      return {
        ...base,
        id: createFindingId(detectorId, start, end),
        detectorId,
        category: DETECTOR_CATEGORY[detectorId],
        redactedText: SENSITIVE_DATA_PLACEHOLDERS.email,
      };
    case "phone":
      return {
        ...base,
        id: createFindingId(detectorId, start, end),
        detectorId,
        category: DETECTOR_CATEGORY[detectorId],
        redactedText: SENSITIVE_DATA_PLACEHOLDERS.phone,
      };
    case "payment-card":
      return {
        ...base,
        id: createFindingId(detectorId, start, end),
        detectorId,
        category: DETECTOR_CATEGORY[detectorId],
        redactedText: SENSITIVE_DATA_PLACEHOLDERS.payment_card,
      };
    case "aws-access-key":
      return {
        ...base,
        id: createFindingId(detectorId, start, end),
        detectorId,
        category: DETECTOR_CATEGORY[detectorId],
        redactedText: SENSITIVE_DATA_PLACEHOLDERS.aws_access_key,
      };
    case "private-key":
      return {
        ...base,
        id: createFindingId(detectorId, start, end),
        detectorId,
        category: DETECTOR_CATEGORY[detectorId],
        redactedText: SENSITIVE_DATA_PLACEHOLDERS.private_key,
      };
    case "api-secret":
      return {
        ...base,
        id: createFindingId(detectorId, start, end),
        detectorId,
        category: DETECTOR_CATEGORY[detectorId],
        redactedText: SENSITIVE_DATA_PLACEHOLDERS.api_secret,
      };
    case "protected-keyword":
      return {
        ...base,
        id: createFindingId(detectorId, start, end),
        detectorId,
        category: DETECTOR_CATEGORY[detectorId],
        redactedText: SENSITIVE_DATA_PLACEHOLDERS.protected_keyword,
      };
  }
}
