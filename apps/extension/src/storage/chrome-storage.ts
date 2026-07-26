import type { StoragePort } from "./storage-port.js";

export interface ChromeLocalStorageArea {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  setAccessLevel(options: { accessLevel: "TRUSTED_CONTEXTS" }): Promise<void>;
}

export type ChromeStorageHandle = {
  port: StoragePort;
  storageReady: Promise<void>;
};

export function createChromeStorage(
  local: ChromeLocalStorageArea,
): ChromeStorageHandle {
  let storageReady: Promise<void>;
  try {
    storageReady = Promise.resolve(
      local.setAccessLevel({
        accessLevel: "TRUSTED_CONTEXTS",
      }),
    );
  } catch (error) {
    storageReady = Promise.reject(error);
  }
  void storageReady.catch(() => undefined);

  return {
    storageReady,
    port: {
      async read(key) {
        await storageReady;
        const values = await local.get(key);
        return values[key];
      },
      async write(key, value) {
        await storageReady;
        await local.set({ [key]: value });
      },
    },
  };
}
