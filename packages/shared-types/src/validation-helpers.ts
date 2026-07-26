export type UnknownRecord = Record<PropertyKey, unknown>;

export const INVALID_SNAPSHOT = Symbol("invalid-snapshot");

export type InvalidSnapshot = typeof INVALID_SNAPSHOT;

export function safelyValidate(check: () => boolean): boolean {
  try {
    return check();
  } catch {
    return false;
  }
}

function hasOnlyDataDescriptors(
  value: unknown,
  visited: WeakSet<object>,
): boolean {
  if (
    value === null ||
    (typeof value !== "object" && typeof value !== "function")
  ) {
    return true;
  }

  if (visited.has(value)) {
    return false;
  }
  visited.add(value);

  const isArray = Array.isArray(value);
  const prototype = Object.getPrototypeOf(value);
  if (
    (isArray && prototype !== Array.prototype) ||
    (!isArray && prototype !== Object.prototype && prototype !== null)
  ) {
    return false;
  }

  const keys = Reflect.ownKeys(value);
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (
      typeof key !== "string" ||
      descriptor === undefined ||
      !Object.hasOwn(descriptor, "value") ||
      (isArray
        ? key !== "length" && descriptor.enumerable !== true
        : descriptor.enumerable !== true) ||
      !hasOnlyDataDescriptors(descriptor.value, visited)
    ) {
      return false;
    }
  }

  return true;
}

export function snapshotStructuredValue(
  value: unknown,
): unknown | InvalidSnapshot {
  try {
    if (!hasOnlyDataDescriptors(value, new WeakSet())) {
      return INVALID_SNAPSHOT;
    }

    const clone = (
      globalThis as typeof globalThis & {
        structuredClone?: (input: unknown) => unknown;
      }
    ).structuredClone;
    return clone === undefined ? INVALID_SNAPSHOT : clone(value);
  } catch {
    return INVALID_SNAPSHOT;
  }
}

export function validatesStructuredSnapshot<Item>(
  value: unknown,
  isSnapshot: (snapshot: unknown) => snapshot is Item,
): value is Item {
  const snapshot = snapshotStructuredValue(value);
  return snapshot !== INVALID_SNAPSHOT && isSnapshot(snapshot);
}

export function isPlainRecord(value: unknown): value is UnknownRecord {
  return safelyValidate(() => {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return false;
    }

    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  });
}

export function hasExactOwnKeys(
  value: UnknownRecord,
  requiredKeys: readonly string[],
  optionalKeys: readonly string[] = [],
): boolean {
  return safelyValidate(() => {
    const allowed = new Set([...requiredKeys, ...optionalKeys]);
    const keys = Reflect.ownKeys(value);

    return (
      requiredKeys.every((key) => Object.hasOwn(value, key)) &&
      keys.every((key) => {
        if (typeof key !== "string" || !allowed.has(key)) {
          return false;
        }
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        return descriptor !== undefined && Object.hasOwn(descriptor, "value");
      })
    );
  });
}

export function isDenseExactArray<Item>(
  value: unknown,
  minimum: number,
  maximum: number,
  isItem: (item: unknown) => item is Item,
): value is Item[] {
  return safelyValidate(() => {
    if (
      !Array.isArray(value) ||
      Object.getPrototypeOf(value) !== Array.prototype
    ) {
      return false;
    }

    const length = value.length;
    if (!Number.isSafeInteger(length) || length < minimum || length > maximum) {
      return false;
    }

    const keys = Reflect.ownKeys(value);
    if (keys.length !== length + 1 || !keys.includes("length")) {
      return false;
    }

    const lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
    if (
      lengthDescriptor === undefined ||
      !Object.hasOwn(lengthDescriptor, "value")
    ) {
      return false;
    }

    for (let index = 0; index < length; index += 1) {
      const key = String(index);
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (
        descriptor === undefined ||
        !Object.hasOwn(descriptor, "value") ||
        !isItem(descriptor.value)
      ) {
        return false;
      }
    }

    return keys.every(
      (key) =>
        key === "length" ||
        (typeof key === "string" &&
          /^(?:0|[1-9]\d*)$/u.test(key) &&
          Number(key) < length),
    );
  });
}
