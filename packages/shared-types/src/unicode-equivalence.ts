const MAX_EQUIVALENCE_VALUE_CODE_UNITS = 100;
const REGEXP_METACHARACTER_PATTERN = /[.*+?^${}()|[\]\\]/gu;

function escapeRegExp(value: string): string {
  return value.replace(REGEXP_METACHARACTER_PATTERN, "\\$&");
}

export function areUnicodeCaseInsensitiveEquivalent(
  left: string,
  right: string,
): boolean {
  if (
    left.length > MAX_EQUIVALENCE_VALUE_CODE_UNITS ||
    right.length > MAX_EQUIVALENCE_VALUE_CODE_UNITS
  ) {
    return false;
  }

  return new RegExp(`^(?:${escapeRegExp(left)})$`, "iu").test(right);
}
