export const SENSITIVE_DATA_CATEGORIES = Object.freeze([
  "email",
  "phone",
  "payment_card",
  "aws_access_key",
  "private_key",
  "api_secret",
  "protected_keyword",
] as const);

export type SensitiveDataCategory = (typeof SENSITIVE_DATA_CATEGORIES)[number];

export const FINDING_CONFIDENCES = Object.freeze([
  "high",
  "medium",
  "low",
] as const);

export type FindingConfidence = (typeof FINDING_CONFIDENCES)[number];

export const DETECTOR_CATEGORY = Object.freeze({
  email: "email",
  phone: "phone",
  "payment-card": "payment_card",
  "aws-access-key": "aws_access_key",
  "private-key": "private_key",
  "api-secret": "api_secret",
  "protected-keyword": "protected_keyword",
} as const satisfies Record<string, SensitiveDataCategory>);

export type DetectorId = keyof typeof DETECTOR_CATEGORY;

export type DetectorCategory<Detector extends DetectorId> =
  (typeof DETECTOR_CATEGORY)[Detector];

export type DetectorIdForCategory<Category extends SensitiveDataCategory> = {
  [Detector in DetectorId]: DetectorCategory<Detector> extends Category
    ? Detector
    : never;
}[DetectorId];

export const DETECTOR_IDS = Object.freeze(
  Object.keys(DETECTOR_CATEGORY) as DetectorId[],
);

declare const findingIdBrand: unique symbol;

export type FindingId<Detector extends DetectorId = DetectorId> = string & {
  readonly [findingIdBrand]: Detector;
};

export function isDetectorId(value: unknown): value is DetectorId {
  return (
    typeof value === "string" && DETECTOR_IDS.includes(value as DetectorId)
  );
}

export function isFindingId(value: unknown): value is FindingId {
  return typeof value === "string" && /^finding-[0-9a-f]{16}$/u.test(value);
}

export function createFindingId<Detector extends DetectorId>(
  detectorId: Detector,
  start: number,
  end: number,
): FindingId<Detector> {
  if (
    !isDetectorId(detectorId) ||
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    start < 0 ||
    end <= start
  ) {
    throw new Error("Invalid finding identifier source.");
  }

  const source = `${detectorId}\u0000${start}\u0000${end}`;
  let hash = 0xcbf29ce484222325n;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= BigInt(source.charCodeAt(index));
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }

  return `finding-${hash.toString(16).padStart(16, "0")}` as FindingId<Detector>;
}

export const SENSITIVE_DATA_PLACEHOLDERS = Object.freeze({
  email: "[EMAIL]",
  phone: "[PHONE]",
  payment_card: "[PAYMENT_CARD]",
  aws_access_key: "[AWS_ACCESS_KEY]",
  private_key: "[PRIVATE_KEY]",
  api_secret: "[API_SECRET]",
  protected_keyword: "[PROTECTED_KEYWORD]",
} as const satisfies Record<SensitiveDataCategory, string>);

export type SensitiveDataPlaceholder =
  (typeof SENSITIVE_DATA_PLACEHOLDERS)[SensitiveDataCategory];

type SensitiveDataFindingBase<Category extends SensitiveDataCategory> = {
  id: FindingId<DetectorIdForCategory<Category>>;
  detectorId: DetectorIdForCategory<Category>;
  start: number;
  end: number;
  confidence: FindingConfidence;
  matchedText: string;
};

export type SensitiveDataFinding = {
  [Category in SensitiveDataCategory]: SensitiveDataFindingBase<Category> & {
    category: Category;
    redactedText: (typeof SENSITIVE_DATA_PLACEHOLDERS)[Category];
  };
}[SensitiveDataCategory];
