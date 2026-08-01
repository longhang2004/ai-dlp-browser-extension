import { describe, expect, it, vi } from "vitest";

import { createDefaultProtectionSettings } from "@ai-dlp/shared-types";

import { createMemoryStoragePort } from "./storage-port.js";
import { SETTINGS_STORAGE_KEY, createSettingsStore } from "./settings-store.js";

describe("settings store", () => {
  const validV1Settings = {
    protectionEnabled: false,
    emailAction: "allow",
    phoneAction: "block",
    protectedKeywords: ["Project Atlas"],
    auditRetentionLimit: 250,
  } as const;

  it("strictly migrates valid v1 settings to v3, preserves choices, defaults attachments to warn, and persists once", async () => {
    const durable = createMemoryStoragePort({
      [SETTINGS_STORAGE_KEY]: {
        schemaVersion: 1,
        settings: validV1Settings,
      },
    });
    const write = vi.fn((key: string, value: unknown) =>
      durable.write(key, value),
    );
    const store = createSettingsStore({
      read: (key) => durable.read(key),
      write,
    });

    await expect(store.read()).resolves.toEqual({
      schemaVersion: 3,
      settings: {
        ...createDefaultProtectionSettings(),
        ...validV1Settings,
        attachmentAction: "warn",
      },
    });
    await expect(store.read()).resolves.toMatchObject({ schemaVersion: 3 });
    expect(write).toHaveBeenCalledOnce();
  });

  it.each(["email", "phone", "both"] as const)(
    "migrates legacy %s redact settings to warn and persists once",
    async (field) => {
      const legacy = {
        schemaVersion: 1,
        settings: {
          protectionEnabled: true,
          emailAction: "warn",
          phoneAction: "warn",
          protectedKeywords: [],
          auditRetentionLimit: 100,
          ...(field === "email" || field === "both"
            ? { emailAction: "redact" }
            : {}),
          ...(field === "phone" || field === "both"
            ? { phoneAction: "redact" }
            : {}),
        },
      };
      const durable = createMemoryStoragePort({
        [SETTINGS_STORAGE_KEY]: legacy,
      });
      const write = vi.fn((key: string, value: unknown) =>
        durable.write(key, value),
      );
      const store = createSettingsStore({
        read: (key) => durable.read(key),
        write,
      });

      const first = await store.read();
      const second = await store.read();

      expect(first.settings.emailAction).toBe("warn");
      expect(first.settings.phoneAction).toBe("warn");
      expect(second).toEqual(first);
      expect(write).toHaveBeenCalledOnce();
      expect(write).toHaveBeenCalledWith(SETTINGS_STORAGE_KEY, {
        schemaVersion: 3,
        settings: {
          ...createDefaultProtectionSettings(),
          emailAction: "warn",
          phoneAction: "warn",
        },
      });
    },
  );

  it("rejects new redact settings instead of persisting them", async () => {
    const storage = createMemoryStoragePort();
    const store = createSettingsStore(storage);

    await expect(
      store.save({
        ...createDefaultProtectionSettings(),
        emailAction: "redact",
      }),
    ).resolves.toEqual({
      ok: false,
      fieldErrors: [{ field: "emailAction", code: "invalid_action" }],
    });
    await expect(storage.read(SETTINGS_STORAGE_KEY)).resolves.toBeUndefined();
  });

  it.each([
    [
      [
        { surfaceId: "chatgpt_web", enabled: true },
        { surfaceId: "unknown_web", enabled: false },
      ],
      "invalid_surface",
    ],
    [
      [
        { surfaceId: "chatgpt_web", enabled: true },
        { surfaceId: "chatgpt_web", enabled: true },
      ],
      "duplicate_surface",
    ],
    [
      [
        { surfaceId: "chatgpt_web", enabled: true },
        { surfaceId: "claude_web", enabled: true },
      ],
      "surface_disabled",
    ],
  ] as const)("rejects unsafe surface state: %s", async (surfaces, code) => {
    const store = createSettingsStore(createMemoryStoragePort());
    await expect(
      store.save({ ...createDefaultProtectionSettings(), surfaces }),
    ).resolves.toEqual({
      ok: false,
      fieldErrors: [{ field: "surfaces", code }],
    });
  });

  it("migrates an exact V2 envelope to V3 once with the reserved surface disabled", async () => {
    const storage = createMemoryStoragePort({
      [SETTINGS_STORAGE_KEY]: {
        schemaVersion: 2,
        settings: {
          protectionEnabled: false,
          emailAction: "allow",
          phoneAction: "block",
          attachmentAction: "warn",
          protectedKeywords: ["Project Atlas"],
          auditRetentionLimit: 250,
        },
      },
    });
    const store = createSettingsStore(storage);

    const expected = {
      ...createDefaultProtectionSettings(),
      protectionEnabled: false,
      emailAction: "allow" as const,
      phoneAction: "block" as const,
      protectedKeywords: ["Project Atlas"],
      auditRetentionLimit: 250,
    };
    await expect(store.read()).resolves.toEqual({
      schemaVersion: 3,
      settings: expected,
    });
    await expect(storage.read(SETTINGS_STORAGE_KEY)).resolves.toEqual({
      schemaVersion: 3,
      settings: expected,
    });
    await expect(store.read()).resolves.toEqual({
      schemaVersion: 3,
      settings: expected,
    });
  });

  it("does not touch local storage before trusted-context restriction succeeds", async () => {
    let release = (): void => undefined;
    const storageReady = new Promise<void>((resolve) => {
      release = resolve;
    });
    let reads = 0;
    const store = createSettingsStore(
      {
        async read() {
          reads += 1;
          return undefined;
        },
        async write() {},
      },
      storageReady,
    );

    const pending = store.read();
    await Promise.resolve();
    expect(reads).toBe(0);
    release();
    await pending;
    expect(reads).toBe(1);
  });

  it("falls back to independent safe defaults for missing, corrupt, unsupported, and invalid legacy envelopes", async () => {
    for (const stored of [
      undefined,
      "corrupt",
      { schemaVersion: 4, settings: createDefaultProtectionSettings() },
      {
        schemaVersion: 2,
        settings: {
          protectionEnabled: true,
          emailAction: "warn",
          phoneAction: "warn",
          attachmentAction: "unsafe",
          protectedKeywords: [],
          auditRetentionLimit: 100,
        },
      },
      {
        schemaVersion: 1,
        settings: {
          ...createDefaultProtectionSettings(),
          protectionEnabled: false,
          prompt: "unsafe",
        },
      },
    ]) {
      const storage = createMemoryStoragePort(
        stored === undefined ? {} : { [SETTINGS_STORAGE_KEY]: stored },
      );
      const store = createSettingsStore(storage);

      const first = await store.read();
      first.settings.protectionEnabled = false;
      first.settings.protectedKeywords.push("mutated");

      expect(await store.read()).toEqual({
        schemaVersion: 3,
        settings: createDefaultProtectionSettings(),
      });
    }
  });

  it("rejects invalid attachment actions instead of ever persisting allow as a fallback", async () => {
    const storage = createMemoryStoragePort();
    const store = createSettingsStore(storage);

    await expect(
      store.save({
        ...createDefaultProtectionSettings(),
        attachmentAction: "unsafe",
      }),
    ).resolves.toEqual({
      ok: false,
      fieldErrors: [{ field: "attachmentAction", code: "invalid_action" }],
    });
    await expect(storage.read(SETTINGS_STORAGE_KEY)).resolves.toBeUndefined();
  });

  it("normalizes, validates, persists, and clones complete settings", async () => {
    const storage = createMemoryStoragePort();
    const store = createSettingsStore(storage);
    const result = await store.save({
      protectionEnabled: true,
      surfaces: [
        { surfaceId: "chatgpt_web", enabled: true },
        { surfaceId: "claude_web", enabled: false },
      ],
      emailAction: "warn",
      phoneAction: "block",
      attachmentAction: "allow",
      protectedKeywords: ["  Nội bộ  ", "Project Atlas"],
      auditRetentionLimit: 1_000,
    });

    expect(result).toEqual({
      ok: true,
      envelope: {
        schemaVersion: 3,
        settings: {
          ...createDefaultProtectionSettings(),
          protectionEnabled: true,
          emailAction: "warn",
          phoneAction: "block",
          attachmentAction: "allow",
          protectedKeywords: ["Nội bộ", "Project Atlas"],
          auditRetentionLimit: 1_000,
        },
      },
    });

    if (result.ok) {
      result.envelope.settings.protectedKeywords[0] = "changed";
    }
    expect((await store.read()).settings.protectedKeywords).toEqual([
      "Nội bộ",
      "Project Atlas",
    ]);
  });

  it.each([0, 1_001, 1.5])(
    "rejects retention outside the exact 1-1000 integer range (%s)",
    async (auditRetentionLimit) => {
      const store = createSettingsStore(createMemoryStoragePort());
      const result = await store.save({
        ...createDefaultProtectionSettings(),
        auditRetentionLimit,
      });

      expect(result).toEqual({
        ok: false,
        fieldErrors: [
          {
            field: "auditRetentionLimit",
            code: Number.isInteger(auditRetentionLimit)
              ? "out_of_range"
              : "invalid_type",
          },
        ],
      });
    },
  );

  it("rejects unknown fields and duplicate normalized keywords", async () => {
    const store = createSettingsStore(createMemoryStoragePort());

    await expect(
      store.save({
        ...createDefaultProtectionSettings(),
        protectedKeywords: ["NỘI BỘ", "  nội bộ  "],
      }),
    ).resolves.toEqual({
      ok: false,
      fieldErrors: [{ field: "protectedKeywords", code: "duplicate_keyword" }],
    });

    await expect(
      store.save({
        ...createDefaultProtectionSettings(),
        rawPrompt: "unsafe",
      }),
    ).resolves.toEqual({
      ok: false,
      fieldErrors: [{ field: "settings", code: "unknown_field" }],
    });
  });

  it("serializes concurrent saves and subsequent reads in invocation order", async () => {
    const writes: unknown[] = [];
    let releaseFirst = (): void => undefined;
    const firstWrite = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const storage = {
      value: undefined as unknown,
      async read() {
        return this.value;
      },
      async write(_key: string, value: unknown) {
        writes.push(structuredClone(value));
        if (writes.length === 1) await firstWrite;
        this.value = structuredClone(value);
      },
    };
    const store = createSettingsStore(storage);
    const first = store.save({
      ...createDefaultProtectionSettings(),
      emailAction: "allow",
    });
    const second = store.save({
      ...createDefaultProtectionSettings(),
      emailAction: "block",
    });
    const read = store.read();
    await vi.waitFor(() => expect(writes).toHaveLength(1));

    releaseFirst();
    await Promise.all([first, second]);
    await expect(read).resolves.toMatchObject({
      settings: { emailAction: "block" },
    });
    expect(writes).toHaveLength(2);
  });

  it("recovers its operation queue after injected read and write failures", async () => {
    const durable = createMemoryStoragePort();
    let failRead = true;
    let failWrite = true;
    const store = createSettingsStore({
      async read(key) {
        if (failRead) {
          failRead = false;
          throw new Error("fixed read failure");
        }
        return durable.read(key);
      },
      async write(key, value) {
        if (failWrite) {
          failWrite = false;
          throw new Error("fixed write failure");
        }
        await durable.write(key, value);
      },
    });

    await expect(store.read()).rejects.toThrow("fixed read failure");
    await expect(store.read()).resolves.toMatchObject({ schemaVersion: 3 });
    await expect(store.save(createDefaultProtectionSettings())).rejects.toThrow(
      "fixed write failure",
    );
    await expect(
      store.save({
        ...createDefaultProtectionSettings(),
        emailAction: "block",
      }),
    ).resolves.toMatchObject({
      ok: true,
      envelope: { settings: { emailAction: "block" } },
    });
    await expect(store.read()).resolves.toMatchObject({
      settings: { emailAction: "block" },
    });
  });
});
