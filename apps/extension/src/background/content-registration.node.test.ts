import { describe, expect, it, vi } from "vitest";

import {
  CLAUDE_HOST_PERMISSION_PATTERN,
  CLAUDE_PERMISSION_SCOPE,
  type PermissionApi,
  type PermissionChange,
} from "@ai-dlp/shared-types/permissions";
import {
  createDefaultProtectionSettings,
  type ProtectionSettings,
} from "@ai-dlp/shared-types";

import {
  CLAUDE_CONTENT_REGISTRATION,
  createContentRegistrationManager,
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
});
