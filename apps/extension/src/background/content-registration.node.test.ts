import { describe, expect, it, vi } from "vitest";

import {
  CLAUDE_HOST_PERMISSION_PATTERN,
  CLAUDE_PERMISSION_SCOPE,
  type PermissionApi,
  type PermissionChange,
  type SurfacePermissionCatalogEntry,
} from "@ai-dlp/shared-types/permissions";
import {
  createDefaultProtectionSettings,
  type ProtectionSettings,
} from "@ai-dlp/shared-types";

import {
  CLAUDE_CONTENT_REGISTRATION,
  createContentRegistrationManager,
  type ContentRegistrationSnapshot,
  type RegisteredContentScript,
  type ScriptingApi,
} from "./content-registration.js";

function permissionHarness(initial: { host?: boolean; named?: boolean }) {
  let host = initial.host ?? false;
  let named = initial.named ?? false;
  const added = new Set<(change: PermissionChange) => void>();
  const removed = new Set<(change: PermissionChange) => void>();
  const emit = (
    listeners: Set<(change: PermissionChange) => void>,
    change: PermissionChange,
  ) => {
    for (const listener of listeners) listener(change);
  };
  const api: PermissionApi = {
    contains: vi.fn(async (scope) => {
      if (scope.permissions.length === 1) return named;
      if (scope.origins.length === 1) return host;
      return host && named;
    }),
    request: vi.fn(async (scope) => {
      if (
        scope.permissions.length !==
          CLAUDE_PERMISSION_SCOPE.permissions.length ||
        scope.permissions[0] !== "scripting" ||
        scope.origins[0] !== CLAUDE_HOST_PERMISSION_PATTERN
      ) {
        return false;
      }
      host = true;
      named = true;
      emit(added, { kind: "joint", scope });
      return true;
    }),
    remove: vi.fn(async (scope) => {
      if (scope.origins.length === 1) {
        host = false;
        emit(removed, {
          kind: "host",
          originPattern: CLAUDE_HOST_PERMISSION_PATTERN,
        });
      }
      if (scope.permissions.length === 1) {
        named = false;
        emit(removed, { kind: "named", permission: "scripting" });
      }
      return true;
    }),
    onAdded: {
      addListener(listener) {
        added.add(listener);
      },
      removeListener(listener) {
        added.delete(listener);
      },
    },
    onRemoved: {
      addListener(listener) {
        removed.add(listener);
      },
      removeListener(listener) {
        removed.delete(listener);
      },
    },
  };
  return {
    api,
    setHost: (value: boolean) => (host = value),
    setNamed: (value: boolean) => (named = value),
    emitAdded: (change: PermissionChange) => emit(added, change),
    emitRemoved: (change: PermissionChange) => emit(removed, change),
  };
}

function scriptingHarness(
  initial: readonly RegisteredContentScript[] = [],
): ScriptingApi & {
  registered: RegisteredContentScript[];
  registrations: RegisteredContentScript[][];
  unregistrations: string[][];
} {
  const state = {
    registered: [...initial],
    registrations: [] as RegisteredContentScript[][],
    unregistrations: [] as string[][],
  };
  return {
    ...state,
    async getRegisteredContentScripts() {
      return [...state.registered];
    },
    async registerContentScripts(scripts) {
      state.registrations.push([...scripts]);
      state.registered.push(...scripts);
    },
    async unregisterContentScripts({ ids }) {
      state.unregistrations.push([...ids]);
      state.registered = state.registered.filter(
        (script) => !ids.includes(script.id),
      );
    },
  };
}

function settings(enabled: boolean): ProtectionSettings {
  return {
    ...createDefaultProtectionSettings(),
    surfaces: [
      { surfaceId: "chatgpt_web", enabled: true },
      { surfaceId: "claude_web", enabled },
    ],
  };
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve(value: T | PromiseLike<T>): void;
} {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("Claude content registration", () => {
  it("declares the exact persistent isolated default-port registration", () => {
    expect(CLAUDE_CONTENT_REGISTRATION).toEqual({
      id: "promptguard-claude-v1",
      matches: ["https://claude.ai:443/*"],
      js: ["content-claude.js"],
      allFrames: false,
      world: "ISOLATED",
      runAt: "document_idle",
      persistAcrossSessions: true,
    });
  });

  it.each([
    [false, false, "host_and_scripting_missing"],
    [false, true, "host_access_missing"],
    [true, false, "scripting_missing"],
  ] as const)(
    "does not register for partial permission state host=%s named=%s",
    async (host, named, healthCode) => {
      const permissions = permissionHarness({ host, named });
      const scripting = scriptingHarness();
      const manager = createContentRegistrationManager({
        permissionApi: permissions.api,
        scripting,
        readSettings: async () => settings(true),
        invalidateSurface: vi.fn(),
      });

      await expect(manager.reconcile()).resolves.toMatchObject({
        registration: "not_registered",
        healthCode,
        hostGranted: host,
        namedPermissionGranted: named,
      });
      expect(scripting.registrations).toEqual([]);
      expect(manager.isDescriptorAllowed()).toBe(false);
    },
  );

  it("registers only after both grants and enables the validated runtime", async () => {
    const permissions = permissionHarness({ host: true, named: true });
    const scripting = scriptingHarness();
    const invalidateSurface = vi.fn();
    const manager = createContentRegistrationManager({
      permissionApi: permissions.api,
      scripting,
      readSettings: async () => settings(true),
      invalidateSurface,
    });

    await expect(manager.reconcile()).resolves.toMatchObject({
      registration: "registered",
      healthCode: null,
    });
    expect(scripting.registrations).toEqual([[CLAUDE_CONTENT_REGISTRATION]]);
    expect(manager.isDescriptorAllowed()).toBe(true);
    expect(invalidateSurface).not.toHaveBeenCalled();
  });

  it("removes stale versions before registering the exact current entry", async () => {
    const stale = {
      ...CLAUDE_CONTENT_REGISTRATION,
      id: "promptguard-claude-v0",
    };
    const permissions = permissionHarness({ host: true, named: true });
    const scripting = scriptingHarness([stale]);
    const manager = createContentRegistrationManager({
      permissionApi: permissions.api,
      scripting,
      readSettings: async () => settings(true),
      invalidateSurface: vi.fn(),
    });

    await manager.reconcile();
    expect(scripting.unregistrations).toEqual([["promptguard-claude-v0"]]);
    expect(scripting.registrations).toEqual([[CLAUDE_CONTENT_REGISTRATION]]);
  });

  it("replaces a current registration with extra fields", async () => {
    const malformed = {
      ...CLAUDE_CONTENT_REGISTRATION,
      excludeMatches: ["https://claude.ai:443/private/*"],
    } as unknown as RegisteredContentScript;
    const permissions = permissionHarness({ host: true, named: true });
    const scripting = scriptingHarness([malformed]);
    const manager = createContentRegistrationManager({
      permissionApi: permissions.api,
      scripting,
      readSettings: async () => settings(true),
      invalidateSurface: vi.fn(),
    });

    await manager.reconcile();
    expect(scripting.unregistrations).toEqual([
      [CLAUDE_CONTENT_REGISTRATION.id],
    ]);
    expect(scripting.registrations).toEqual([[CLAUDE_CONTENT_REGISTRATION]]);
  });

  it("invalidates and unregisters before asynchronous cleanup on revocation", async () => {
    const permissions = permissionHarness({ host: true, named: true });
    const scripting = scriptingHarness([CLAUDE_CONTENT_REGISTRATION]);
    const invalidateSurface = vi.fn();
    const manager = createContentRegistrationManager({
      permissionApi: permissions.api,
      scripting,
      readSettings: async () => settings(true),
      invalidateSurface,
    });
    await manager.reconcile();
    expect(manager.isDescriptorAllowed()).toBe(true);

    permissions.setHost(false);
    permissions.api.onRemoved.addListener((change) => {
      if (change.kind === "host") void manager.reconcile();
    });
    // The manager's own listener invalidates synchronously when the event fires.
    const removed = await permissions.api.remove({
      permissions: [],
      origins: [CLAUDE_HOST_PERMISSION_PATTERN],
    });

    expect(removed).toBe(true);
    expect(invalidateSurface).toHaveBeenCalled();
    expect(manager.isDescriptorAllowed()).toBe(false);
    await manager.reconcile();
    expect(scripting.unregistrations).toContainEqual([
      CLAUDE_CONTENT_REGISTRATION.id,
    ]);
  });

  it("cleans up a disabled surface without affecting unrelated registrations", async () => {
    const permissions = permissionHarness({ host: true, named: true });
    const scripting = scriptingHarness([CLAUDE_CONTENT_REGISTRATION]);
    let current = settings(true);
    const manager = createContentRegistrationManager({
      permissionApi: permissions.api,
      scripting,
      readSettings: async () => current,
      invalidateSurface: vi.fn(),
    });
    await manager.reconcile();
    current = settings(false);
    await manager.reconcile();
    expect(scripting.unregistrations).toContainEqual([
      CLAUDE_CONTENT_REGISTRATION.id,
    ]);
    expect(manager.isDescriptorAllowed()).toBe(false);
  });

  it("invalidates synchronously before background-owned access removal", async () => {
    const permissions = permissionHarness({ host: true, named: true });
    const scripting = scriptingHarness([CLAUDE_CONTENT_REGISTRATION]);
    const order: string[] = [];
    const remove = permissions.api.remove;
    permissions.api.remove = vi.fn(async (scope) => {
      order.push("permission.remove");
      return remove(scope);
    });
    const invalidateSurface = vi.fn(() => order.push("invalidate"));
    const manager = createContentRegistrationManager({
      permissionApi: permissions.api,
      scripting,
      readSettings: async () => settings(true),
      invalidateSurface,
    });
    await manager.reconcile();
    order.length = 0;

    await expect(manager.removeClaudeAccess()).resolves.toBe(true);
    expect(order[0]).toBe("invalidate");
    expect(order.indexOf("permission.remove")).toBeGreaterThan(0);
    expect(invalidateSurface).toHaveBeenCalled();
    expect(manager.isDescriptorAllowed()).toBe(false);
  });

  it("serializes reconciliation behind an in-flight access removal", async () => {
    const permissions = permissionHarness({ host: true, named: true });
    const scripting = scriptingHarness([CLAUDE_CONTENT_REGISTRATION]);
    const releaseHostRemoval = deferred<void>();
    const hostRemovalStarted = deferred<void>();
    const remove = permissions.api.remove;
    permissions.api.remove = vi.fn(async (scope) => {
      if (scope.origins.length > 0) {
        hostRemovalStarted.resolve();
        await releaseHostRemoval.promise;
      }
      return remove(scope);
    });
    const reconciled: ContentRegistrationSnapshot[] = [];
    let settingsReads = 0;
    const manager = createContentRegistrationManager({
      permissionApi: permissions.api,
      scripting,
      readSettings: async () => {
        settingsReads += 1;
        return settings(true);
      },
      onReconciled: (next) => reconciled.push(next),
      invalidateSurface: vi.fn(),
    });

    await manager.reconcile();
    expect(manager.isDescriptorAllowed()).toBe(true);
    const removal = manager.removeClaudeAccess();
    await hostRemovalStarted.promise;

    // This reconciliation represents a settings save/permission callback that
    // observes the old grants while remove() is still awaiting the browser.
    const concurrentReconciliation = manager.reconcile();
    await expect(scripting.getRegisteredContentScripts()).resolves.toEqual([
      CLAUDE_CONTENT_REGISTRATION,
    ]);

    releaseHostRemoval.resolve();
    await expect(removal).resolves.toBe(true);
    await concurrentReconciliation;

    await expect(scripting.getRegisteredContentScripts()).resolves.toEqual([]);
    expect(manager.getSnapshot()).toMatchObject({
      registration: "not_registered",
      hostGranted: false,
      namedPermissionGranted: true,
      enabled: true,
    });
    expect(manager.isDescriptorAllowed()).toBe(false);
    expect(settingsReads).toBeGreaterThanOrEqual(3);
    expect(reconciled.at(-1)).toMatchObject({
      registration: "not_registered",
      hostGranted: false,
      namedPermissionGranted: true,
    });
  });

  it("coalesces an external permission event during removal into one fresh reconcile", async () => {
    const permissions = permissionHarness({ host: true, named: true });
    const scripting = scriptingHarness([CLAUDE_CONTENT_REGISTRATION]);
    const hostRemovalStarted = deferred<void>();
    const releaseHostRemoval = deferred<void>();
    const finalCleanupReadStarted = deferred<void>();
    const releaseFinalCleanupRead = deferred<void>();
    const remove = permissions.api.remove;
    permissions.api.remove = vi.fn(async (scope) => {
      if (scope.origins.length > 0) {
        hostRemovalStarted.resolve();
        await releaseHostRemoval.promise;
      }
      return remove(scope);
    });
    const getRegisteredContentScripts = scripting.getRegisteredContentScripts;
    let registrationReads = 0;
    scripting.getRegisteredContentScripts = async () => {
      registrationReads += 1;
      if (registrationReads === 2) {
        finalCleanupReadStarted.resolve();
        await releaseFinalCleanupRead.promise;
      }
      return getRegisteredContentScripts();
    };
    let settingsReads = 0;
    const reconciled: ContentRegistrationSnapshot[] = [];
    const manager = createContentRegistrationManager({
      permissionApi: permissions.api,
      scripting,
      readSettings: async () => {
        settingsReads += 1;
        return settings(true);
      },
      onReconciled: (next) => reconciled.push(next),
      invalidateSurface: vi.fn(),
    });

    await manager.reconcile();
    const removal = manager.removeClaudeAccess();
    await hostRemovalStarted.promise;

    releaseHostRemoval.resolve();
    await finalCleanupReadStarted.promise;
    // This event is external to the host removal call. It must not race the
    // final callback; one fresh reconcile owns the post-removal truth.
    permissions.setHost(true);
    permissions.emitAdded({
      kind: "host",
      originPattern: CLAUDE_HOST_PERMISSION_PATTERN,
    });
    releaseFinalCleanupRead.resolve();

    await expect(removal).resolves.toBe(true);
    await vi.waitFor(() => expect(settingsReads).toBeGreaterThanOrEqual(3));
    await vi.waitFor(() => expect(reconciled).toHaveLength(2));
    expect(reconciled.at(-1)).toMatchObject({
      registration: "registered",
      hostGranted: true,
      namedPermissionGranted: true,
    });
    expect(manager.isDescriptorAllowed()).toBe(true);
  });

  it("does not reopen the runtime gate from a stale final callback after external removal", async () => {
    const permissions = permissionHarness({ host: true, named: true });
    const scripting = scriptingHarness([CLAUDE_CONTENT_REGISTRATION]);
    const hostRemovalStarted = deferred<void>();
    const releaseHostRemoval = deferred<void>();
    const ownHostRemovalCompleted = deferred<void>();
    const releaseAfterOwnHostRemoval = deferred<void>();
    const remove = permissions.api.remove;
    permissions.api.remove = vi.fn(async (scope) => {
      if (scope.origins.length > 0) {
        hostRemovalStarted.resolve();
        await releaseHostRemoval.promise;
        const result = await remove(scope);
        ownHostRemovalCompleted.resolve();
        await releaseAfterOwnHostRemoval.promise;
        return result;
      }
      return remove(scope);
    });
    const finalRegistrationReadStarted = deferred<void>();
    const releaseFinalRegistrationRead = deferred<void>();
    const getRegisteredContentScripts = scripting.getRegisteredContentScripts;
    let registrationReads = 0;
    scripting.getRegisteredContentScripts = async () => {
      registrationReads += 1;
      if (registrationReads === 2) {
        finalRegistrationReadStarted.resolve();
        await releaseFinalRegistrationRead.promise;
      }
      return getRegisteredContentScripts();
    };
    const reconciled: ContentRegistrationSnapshot[] = [];
    const manager = createContentRegistrationManager({
      permissionApi: permissions.api,
      scripting,
      readSettings: async () => settings(true),
      onReconciled: (next) => reconciled.push(next),
      invalidateSurface: vi.fn(),
    });

    await manager.reconcile();
    const removal = manager.removeClaudeAccess();
    await hostRemovalStarted.promise;
    releaseHostRemoval.resolve();
    await ownHostRemovalCompleted.promise;
    // Let the final removal reconcile observe a stale grant, then revoke it
    // while its registration read is still in flight.
    permissions.setHost(true);
    releaseAfterOwnHostRemoval.resolve();
    await finalRegistrationReadStarted.promise;
    permissions.setHost(false);
    permissions.emitRemoved({
      kind: "host",
      originPattern: CLAUDE_HOST_PERMISSION_PATTERN,
    });
    releaseFinalRegistrationRead.resolve();

    await expect(removal).resolves.toBe(true);
    await vi.waitFor(() => expect(registrationReads).toBeGreaterThanOrEqual(3));
    await vi.waitFor(
      async () =>
        await expect(scripting.getRegisteredContentScripts()).resolves.toEqual(
          [],
        ),
    );
    expect(manager.isDescriptorAllowed()).toBe(false);
    expect(
      reconciled.filter((next) => next.registration === "registered"),
    ).toHaveLength(1);
    expect(reconciled.at(-1)).toMatchObject({
      registration: "not_registered",
      hostGranted: false,
      namedPermissionGranted: true,
    });
  });

  it("retains scripting when another catalog-owned dynamic surface still depends on it", async () => {
    const permissions = permissionHarness({ host: true, named: true });
    const scripting = scriptingHarness([CLAUDE_CONTENT_REGISTRATION]);
    const secondDynamicCatalogEntry: SurfacePermissionCatalogEntry = {
      surfaceId: "chatgpt_web",
      host: {
        surfaceId: "chatgpt_web",
        originPattern: CLAUDE_HOST_PERMISSION_PATTERN,
      },
      named: { surfaceId: "chatgpt_web", permission: "scripting" },
      dynamicRegistration: true,
    };
    const manager = createContentRegistrationManager({
      permissionApi: permissions.api,
      scripting,
      readSettings: async () => settings(true),
      getEffectiveSurfacePermissions: async () => [
        {
          surfaceId: "claude_web",
          enabled: true,
          hostGranted: false,
          namedPermissionGranted: true,
        },
        {
          surfaceId: "chatgpt_web",
          enabled: true,
          hostGranted: true,
          namedPermissionGranted: true,
        },
      ],
      permissionCatalog: [
        {
          surfaceId: "claude_web",
          host: {
            surfaceId: "claude_web",
            originPattern: CLAUDE_HOST_PERMISSION_PATTERN,
          },
          named: { surfaceId: "claude_web", permission: "scripting" },
          dynamicRegistration: true,
        },
        secondDynamicCatalogEntry,
      ],
      invalidateSurface: vi.fn(),
    });

    await manager.reconcile();
    await expect(manager.removeClaudeAccess()).resolves.toBe(true);
    expect(permissions.api.remove).toHaveBeenCalledTimes(1);
    expect(permissions.api.remove).toHaveBeenCalledWith({
      permissions: [],
      origins: [CLAUDE_HOST_PERMISSION_PATTERN],
    });
    await expect(
      permissions.api.contains({ permissions: ["scripting"], origins: [] }),
    ).resolves.toBe(true);
  });

  it("aborts named removal when a newer reconciliation overlaps the dependency read", async () => {
    const permissions = permissionHarness({ host: true, named: true });
    const scripting = scriptingHarness([CLAUDE_CONTENT_REGISTRATION]);
    const secondDynamicCatalogEntry: SurfacePermissionCatalogEntry = {
      surfaceId: "chatgpt_web",
      host: {
        surfaceId: "chatgpt_web",
        originPattern: CLAUDE_HOST_PERMISSION_PATTERN,
      },
      named: { surfaceId: "chatgpt_web", permission: "scripting" },
      dynamicRegistration: true,
    };
    let dynamicDependency = false;
    let markStarted = (): void => undefined;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    let release = (): void => undefined;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    let reads = 0;
    const manager = createContentRegistrationManager({
      permissionApi: permissions.api,
      scripting,
      readSettings: async () => settings(true),
      getEffectiveSurfacePermissions: async () => {
        const dependencyAtReadStart = dynamicDependency;
        if (reads === 0) {
          markStarted();
          await blocked;
        }
        reads += 1;
        return [
          {
            surfaceId: "claude_web",
            enabled: true,
            hostGranted: false,
            namedPermissionGranted: true,
          },
          {
            surfaceId: "chatgpt_web",
            enabled: dependencyAtReadStart,
            hostGranted: dependencyAtReadStart,
            namedPermissionGranted: dependencyAtReadStart,
          },
        ];
      },
      permissionCatalog: [
        {
          surfaceId: "claude_web",
          host: {
            surfaceId: "claude_web",
            originPattern: CLAUDE_HOST_PERMISSION_PATTERN,
          },
          named: { surfaceId: "claude_web", permission: "scripting" },
          dynamicRegistration: true,
        },
        secondDynamicCatalogEntry,
      ],
      invalidateSurface: vi.fn(),
    });

    await manager.reconcile();
    const removal = manager.removeClaudeAccess();
    await started;
    dynamicDependency = true;
    const newerReconciliation = manager.reconcile();
    release();

    await expect(removal).resolves.toBe(true);
    await newerReconciliation;
    expect(permissions.api.remove).toHaveBeenCalledTimes(1);
    expect(permissions.api.remove).toHaveBeenCalledWith({
      permissions: [],
      origins: [CLAUDE_HOST_PERMISSION_PATTERN],
    });
    await expect(
      permissions.api.contains({ permissions: ["scripting"], origins: [] }),
    ).resolves.toBe(true);
  });

  it.each([
    ["reader is absent", undefined],
    ["reader throws", "throws"],
    ["reader returns an unknown state", "unknown"],
  ] as const)(
    "preserves scripting when the dependency state is uncertain because the %s",
    async (_label, readerState) => {
      const permissions = permissionHarness({ host: true, named: true });
      const dependencyReader =
        readerState === undefined
          ? undefined
          : readerState === "throws"
            ? async () => {
                throw new Error("dependency read failed");
              }
            : async () =>
                [
                  {
                    surfaceId: "future_dynamic_surface",
                    enabled: true,
                    hostGranted: true,
                    namedPermissionGranted: true,
                  },
                ] as never;
      const manager = createContentRegistrationManager({
        permissionApi: permissions.api,
        scripting: scriptingHarness([CLAUDE_CONTENT_REGISTRATION]),
        readSettings: async () => settings(true),
        ...(dependencyReader === undefined
          ? {}
          : { getEffectiveSurfacePermissions: dependencyReader }),
        invalidateSurface: vi.fn(),
      });

      await manager.reconcile();
      await expect(manager.removeClaudeAccess()).resolves.toBe(true);
      expect(permissions.api.remove).toHaveBeenCalledWith({
        permissions: [],
        origins: [CLAUDE_HOST_PERMISSION_PATTERN],
      });
      expect(permissions.api.remove).toHaveBeenCalledTimes(1);
    },
  );

  it("keeps scripting and still reconciles cleanup when final dependency validation throws", async () => {
    const permissions = permissionHarness({ host: true, named: true });
    const scripting = scriptingHarness([CLAUDE_CONTENT_REGISTRATION]);
    let reads = 0;
    const throwingEffective = new Proxy([], {
      ownKeys() {
        throw new Error("final dependency validation failed");
      },
    }) as readonly {
      surfaceId: "claude_web";
      enabled: boolean;
      hostGranted: boolean;
      namedPermissionGranted: boolean;
    }[];
    const getEffectiveSurfacePermissions = vi.fn(async () => {
      reads += 1;
      if (reads === 1) {
        return [
          {
            surfaceId: "claude_web" as const,
            enabled: true,
            hostGranted: false,
            namedPermissionGranted: true,
          },
        ];
      }
      return throwingEffective;
    });
    const onReconciled = vi.fn();
    const manager = createContentRegistrationManager({
      permissionApi: permissions.api,
      scripting,
      readSettings: async () => settings(true),
      getEffectiveSurfacePermissions,
      onReconciled,
      invalidateSurface: vi.fn(),
    });

    await manager.reconcile();
    await expect(manager.removeClaudeAccess()).resolves.toBe(true);

    expect(getEffectiveSurfacePermissions).toHaveBeenCalledTimes(2);
    expect(permissions.api.remove).toHaveBeenCalledTimes(1);
    expect(permissions.api.remove).toHaveBeenCalledWith({
      permissions: [],
      origins: [CLAUDE_HOST_PERMISSION_PATTERN],
    });
    expect(scripting.unregistrations).toContainEqual([
      CLAUDE_CONTENT_REGISTRATION.id,
    ]);
    expect(manager.getSnapshot()).toMatchObject({
      registration: "not_registered",
      healthCode: "host_access_missing",
      hostGranted: false,
      namedPermissionGranted: true,
    });
    expect(onReconciled).toHaveBeenLastCalledWith(
      expect.objectContaining({
        registration: "not_registered",
        healthCode: "host_access_missing",
      }),
    );
  });

  it("keeps scripting and still reconciles cleanup when the dependency catalog throws", async () => {
    const permissions = permissionHarness({ host: true, named: true });
    const scripting = scriptingHarness([CLAUDE_CONTENT_REGISTRATION]);
    const catalog = new Proxy(
      [
        {
          surfaceId: "claude_web" as const,
          host: {
            surfaceId: "claude_web" as const,
            originPattern: CLAUDE_HOST_PERMISSION_PATTERN,
          },
          named: {
            surfaceId: "claude_web" as const,
            permission: "scripting" as const,
          },
          dynamicRegistration: true as const,
        },
      ],
      {
        get(target, property, receiver) {
          if (property === "some") {
            throw new Error("catalog dependency decision failed");
          }
          return Reflect.get(target, property, receiver);
        },
      },
    );
    const onReconciled = vi.fn();
    const manager = createContentRegistrationManager({
      permissionApi: permissions.api,
      scripting,
      readSettings: async () => settings(true),
      getEffectiveSurfacePermissions: async () => [
        {
          surfaceId: "claude_web",
          enabled: true,
          hostGranted: false,
          namedPermissionGranted: true,
        },
      ],
      permissionCatalog: catalog,
      onReconciled,
      invalidateSurface: vi.fn(),
    });

    await manager.reconcile();
    await expect(manager.removeClaudeAccess()).resolves.toBe(true);

    expect(permissions.api.remove).toHaveBeenCalledTimes(1);
    expect(permissions.api.remove).toHaveBeenCalledWith({
      permissions: [],
      origins: [CLAUDE_HOST_PERMISSION_PATTERN],
    });
    expect(scripting.unregistrations).toContainEqual([
      CLAUDE_CONTENT_REGISTRATION.id,
    ]);
    expect(manager.getSnapshot()).toMatchObject({
      registration: "not_registered",
      healthCode: "host_access_missing",
      hostGranted: false,
      namedPermissionGranted: true,
    });
    expect(onReconciled).toHaveBeenLastCalledWith(
      expect.objectContaining({
        registration: "not_registered",
        healthCode: "host_access_missing",
      }),
    );
  });

  it("suppresses a queued reconciliation callback after disposal", async () => {
    const permissions = permissionHarness({ host: true, named: true });
    const scripting = scriptingHarness();
    let markStarted = (): void => undefined;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    let release = (): void => undefined;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const getRegisteredContentScripts = scripting.getRegisteredContentScripts;
    scripting.getRegisteredContentScripts = async () => {
      markStarted();
      await blocked;
      return getRegisteredContentScripts();
    };
    let gate = false;
    const manager = createContentRegistrationManager({
      permissionApi: permissions.api,
      scripting,
      readSettings: async () => settings(true),
      onReconciled: (next) => {
        gate = next.registration === "registered";
      },
      invalidateSurface: vi.fn(),
    });

    const pending = manager.reconcile();
    await started;
    manager.dispose();
    release();
    await pending;
    expect(gate).toBe(false);
  });

  it("applies only the newest reconciliation callback after invalidation", async () => {
    const permissions = permissionHarness({ host: true, named: true });
    const scripting = scriptingHarness();
    let markStarted = (): void => undefined;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    let release = (): void => undefined;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    let reads = 0;
    const getRegisteredContentScripts = scripting.getRegisteredContentScripts;
    scripting.getRegisteredContentScripts = async () => {
      reads += 1;
      if (reads === 1) {
        markStarted();
        await blocked;
      }
      return getRegisteredContentScripts();
    };
    const callbacks: ContentRegistrationSnapshot[] = [];
    const manager = createContentRegistrationManager({
      permissionApi: permissions.api,
      scripting,
      readSettings: async () => settings(true),
      onReconciled: (next) => callbacks.push(next),
      invalidateSurface: vi.fn(),
    });

    const first = manager.reconcile();
    await started;
    manager.invalidate();
    release();
    await first;
    expect(callbacks).toHaveLength(0);

    await expect(manager.reconcile()).resolves.toMatchObject({
      registration: "registered",
    });
    expect(callbacks).toHaveLength(1);
    expect(callbacks[0]).toMatchObject({ registration: "registered" });
  });
});
