export interface StoragePort {
  read(key: string): Promise<unknown>;
  write(key: string, value: unknown): Promise<void>;
}

export function createMemoryStoragePort(
  initial: Readonly<Record<string, unknown>> = {},
): StoragePort {
  const values = new Map<string, unknown>(
    Object.entries(initial).map(([key, value]) => [
      key,
      structuredClone(value),
    ]),
  );

  return {
    async read(key) {
      const value = values.get(key);
      return value === undefined ? undefined : structuredClone(value);
    },
    async write(key, value) {
      values.set(key, structuredClone(value));
    },
  };
}
