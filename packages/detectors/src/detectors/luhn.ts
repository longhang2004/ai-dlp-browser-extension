export function isLuhnValid(digits: string): boolean {
  if (!/^\d{2,}$/u.test(digits)) {
    return false;
  }

  let sum = 0;
  let shouldDouble = false;

  for (let index = digits.length - 1; index >= 0; index -= 1) {
    const digit = Number(digits[index]);
    const value = shouldDouble
      ? digit * 2 > 9
        ? digit * 2 - 9
        : digit * 2
      : digit;

    sum += value;
    shouldDouble = !shouldDouble;
  }

  return sum % 10 === 0;
}
