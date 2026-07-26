import { describe, expect, it, vi } from "vitest";

import { createChromeStorage } from "./chrome-storage.js";

describe("Chrome local storage boundary", () => {
  it("makes direct reads and writes wait for TRUSTED_CONTEXTS", async () => {
    let release = (): void => undefined;
    const ready = new Promise<void>((resolve) => {
      release = resolve;
    });
    const local = {
      get: vi.fn(async () => ({ settings: "value" })),
      set: vi.fn(async () => undefined),
      setAccessLevel: vi.fn(() => ready),
    };
    const { port } = createChromeStorage(local);

    const read = port.read("settings");
    const write = port.write("settings", "next");
    await Promise.resolve();
    expect(local.get).not.toHaveBeenCalled();
    expect(local.set).not.toHaveBeenCalled();

    release();
    await expect(read).resolves.toBe("value");
    await expect(write).resolves.toBeUndefined();
  });

  it("observes access-level rejection without converting the retained promise", async () => {
    const failure = new Error("fixed test failure");
    const { storageReady } = createChromeStorage({
      get: vi.fn(async () => ({})),
      set: vi.fn(async () => undefined),
      setAccessLevel: vi.fn(() => Promise.reject(failure)),
    });

    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    await expect(storageReady).rejects.toBe(failure);
  });
});
