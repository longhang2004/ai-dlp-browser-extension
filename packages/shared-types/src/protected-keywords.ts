export const MAX_PROTECTED_KEYWORD_COUNT = 100;
export const MAX_PROTECTED_KEYWORD_CODE_UNITS = 100;

const FORBIDDEN_PROTECTED_KEYWORD_CODE_POINT = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u;

export function normalizeProtectedKeyword(value: unknown): string | undefined {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > MAX_PROTECTED_KEYWORD_CODE_UNITS ||
    FORBIDDEN_PROTECTED_KEYWORD_CODE_POINT.test(value)
  ) {
    return undefined;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

export function isNormalizedProtectedKeyword(value: unknown): value is string {
  return (
    typeof value === "string" && normalizeProtectedKeyword(value) === value
  );
}
