const UNICODE_IDENTIFIER_CODE_POINT_PATTERN = /[\p{L}\p{N}\p{M}_]/u;

type BoundaryOptions = Readonly<{
  disallowedBefore?: string;
  disallowedAfter?: string;
}>;

function previousCodePoint(value: string, index: number): string | undefined {
  if (index <= 0) {
    return undefined;
  }

  let start = index - 1;
  const trailingCodeUnit = value.charCodeAt(start);

  if (trailingCodeUnit >= 0xdc00 && trailingCodeUnit <= 0xdfff && start > 0) {
    const leadingCodeUnit = value.charCodeAt(start - 1);
    if (leadingCodeUnit >= 0xd800 && leadingCodeUnit <= 0xdbff) {
      start -= 1;
    }
  }

  return value.slice(start, index);
}

function nextCodePoint(value: string, index: number): string | undefined {
  const codePoint = value.codePointAt(index);
  return codePoint === undefined ? undefined : String.fromCodePoint(codePoint);
}

function isDisallowedBoundary(
  codePoint: string | undefined,
  additionalCharacters: string,
): boolean {
  return (
    codePoint !== undefined &&
    (UNICODE_IDENTIFIER_CODE_POINT_PATTERN.test(codePoint) ||
      additionalCharacters.includes(codePoint))
  );
}

export function hasTokenBoundaries(
  value: string,
  start: number,
  end: number,
  options: BoundaryOptions = {},
): boolean {
  return (
    !isDisallowedBoundary(
      previousCodePoint(value, start),
      options.disallowedBefore ?? "",
    ) &&
    !isDisallowedBoundary(
      nextCodePoint(value, end),
      options.disallowedAfter ?? "",
    )
  );
}
