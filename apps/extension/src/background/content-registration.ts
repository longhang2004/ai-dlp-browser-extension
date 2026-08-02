import {
  CLAUDE_HOST_PERMISSION_PATTERN,
  isScriptingStillRequired,
  type EffectiveSurfacePermission,
  type PermissionApi,
  type PermissionChange,
  type PermissionScope,
  type RegistrationState,
  type SurfaceRuntimeHealthCode,
} from "@ai-dlp/shared-types/permissions";
import type { ProtectionSettings } from "@ai-dlp/shared-types";

export type RegisteredContentScript = {
  [key: string]: unknown;
  id: string;
  matches: readonly string[];
  js: readonly string[];
  allFrames?: boolean;
  world?: string;
  runAt?: string;
  persistAcrossSessions?: boolean;
};

export type ScriptingApi = {
  getRegisteredContentScripts(): Promise<readonly RegisteredContentScript[]>;
  registerContentScripts(
    scripts: readonly RegisteredContentScript[],
  ): Promise<void>;
  unregisterContentScripts(details: { ids: readonly string[] }): Promise<void>;
};

export const CLAUDE_CONTENT_REGISTRATION: RegisteredContentScript =
  Object.freeze({
    id: "promptguard-claude-v1",
    matches: Object.freeze([CLAUDE_HOST_PERMISSION_PATTERN]),
    js: Object.freeze(["content-claude.js"]),
    allFrames: false,
    world: "ISOLATED",
    runAt: "document_idle",
    persistAcrossSessions: true,
  });

const CLAUDE_HOST_SCOPE: PermissionScope = Object.freeze({
  permissions: Object.freeze([]) as readonly [],
  origins: Object.freeze([CLAUDE_HOST_PERMISSION_PATTERN] as const),
});
const CLAUDE_NAMED_SCOPE: PermissionScope = Object.freeze({
  permissions: Object.freeze(["scripting"] as const),
  origins: Object.freeze([]) as readonly [],
});

export type ContentRegistrationSnapshot = {
  readonly registration: RegistrationState;
  readonly healthCode: SurfaceRuntimeHealthCode | null;
  readonly hostGranted: boolean;
  readonly namedPermissionGranted: boolean;
  readonly enabled: boolean;
};

export type ContentRegistrationManager = {
  reconcile(): Promise<ContentRegistrationSnapshot>;
  invalidate(): void;
  removeClaudeAccess(): Promise<boolean>;
  isDescriptorAllowed(): boolean;
  getSnapshot(): ContentRegistrationSnapshot;
  dispose(): void;
};

function sameStringArray(
  value: unknown,
  expected: readonly string[],
): value is readonly string[] {
  return (
    Array.isArray(value) &&
    value.length === expected.length &&
    value.every((item, index) => item === expected[index])
  );
}

function isExactRegistration(value: RegisteredContentScript): boolean {
  const expectedKeys = Object.keys(CLAUDE_CONTENT_REGISTRATION).sort();
  const actualKeys = Object.keys(value).sort();
  return (
    actualKeys.length === expectedKeys.length &&
    actualKeys.every((key, index) => key === expectedKeys[index]) &&
    value.id === CLAUDE_CONTENT_REGISTRATION.id &&
    sameStringArray(value.matches, CLAUDE_CONTENT_REGISTRATION.matches) &&
    sameStringArray(value.js, CLAUDE_CONTENT_REGISTRATION.js) &&
    value.allFrames === CLAUDE_CONTENT_REGISTRATION.allFrames &&
    value.world === CLAUDE_CONTENT_REGISTRATION.world &&
    value.runAt === CLAUDE_CONTENT_REGISTRATION.runAt &&
    value.persistAcrossSessions ===
      CLAUDE_CONTENT_REGISTRATION.persistAcrossSessions
  );
}

function isClaudeRegistrationId(value: unknown): value is string {
  return typeof value === "string" && value.startsWith("promptguard-claude-");
}

function defaultSnapshot(): ContentRegistrationSnapshot {
  return {
    registration: "not_registered",
    healthCode: null,
    hostGranted: false,
    namedPermissionGranted: false,
    enabled: false,
  };
}

function hasClaudeEnabled(settings: ProtectionSettings): boolean {
  return settings.surfaces.some(
    (surface) => surface.surfaceId === "claude_web" && surface.enabled,
  );
}

function isPermissionChangeForClaude(change: PermissionChange): boolean {
  return (
    change.kind === "joint" ||
    (change.kind === "host" &&
      change.originPattern === CLAUDE_HOST_PERMISSION_PATTERN) ||
    (change.kind === "named" && change.permission === "scripting")
  );
}

export function createContentRegistrationManager(options: {
  permissionApi: PermissionApi;
  scripting?: ScriptingApi;
  readSettings(): Promise<ProtectionSettings>;
  getEffectiveSurfacePermissions?(): Promise<
    readonly EffectiveSurfacePermission[]
  >;
  invalidateSurface(): void;
}): ContentRegistrationManager {
  let snapshot = defaultSnapshot();
  let disposed = false;
  let queue: Promise<ContentRegistrationSnapshot> = Promise.resolve(snapshot);

  function invalidate(): void {
    if (
      snapshot.registration === "not_registered" &&
      !snapshot.hostGranted &&
      !snapshot.namedPermissionGranted &&
      !snapshot.enabled
    ) {
      return;
    }
    snapshot = { ...snapshot, registration: "not_registered" };
    options.invalidateSurface();
  }

  async function removeOwnedRegistrations(
    registrations: readonly RegisteredContentScript[],
  ): Promise<void> {
    if (options.scripting === undefined) return;
    const staleIds = registrations
      .filter(
        (registration) =>
          isClaudeRegistrationId(registration.id) &&
          !isExactRegistration(registration),
      )
      .map((registration) => registration.id);
    if (staleIds.length > 0) {
      await options.scripting.unregisterContentScripts({ ids: staleIds });
    }
  }

  async function cleanupOwnedRegistrations(): Promise<void> {
    if (options.scripting === undefined) return;
    const registrations = await options.scripting.getRegisteredContentScripts();
    await removeOwnedRegistrations(registrations);
    const current = registrations.find(
      (registration) => registration.id === CLAUDE_CONTENT_REGISTRATION.id,
    );
    if (current !== undefined && isExactRegistration(current)) {
      await options.scripting.unregisterContentScripts({
        ids: [CLAUDE_CONTENT_REGISTRATION.id],
      });
    }
  }

  async function reconcileNow(): Promise<ContentRegistrationSnapshot> {
    if (disposed) return snapshot;
    invalidate();
    const settings = await options.readSettings();
    const enabled = hasClaudeEnabled(settings);
    const hostGranted = await options.permissionApi.contains(CLAUDE_HOST_SCOPE);
    const namedPermissionGranted =
      await options.permissionApi.contains(CLAUDE_NAMED_SCOPE);
    snapshot = {
      registration: "reconciling",
      healthCode: null,
      hostGranted,
      namedPermissionGranted,
      enabled,
    };

    if (!enabled) {
      try {
        await cleanupOwnedRegistrations();
      } catch {
        snapshot = { ...snapshot, healthCode: "registration_failed" };
      }
      snapshot = { ...snapshot, registration: "not_registered" };
      return snapshot;
    }
    if (!hostGranted && !namedPermissionGranted) {
      try {
        await cleanupOwnedRegistrations();
      } catch {
        snapshot = { ...snapshot, healthCode: "registration_failed" };
      }
      snapshot = {
        ...snapshot,
        registration: "not_registered",
        healthCode: "host_and_scripting_missing",
      };
      return snapshot;
    }
    if (!hostGranted) {
      try {
        await cleanupOwnedRegistrations();
      } catch {
        snapshot = { ...snapshot, healthCode: "registration_failed" };
      }
      snapshot = {
        ...snapshot,
        registration: "not_registered",
        healthCode: "host_access_missing",
      };
      return snapshot;
    }
    if (!namedPermissionGranted) {
      try {
        await cleanupOwnedRegistrations();
      } catch {
        snapshot = { ...snapshot, healthCode: "registration_failed" };
      }
      snapshot = {
        ...snapshot,
        registration: "not_registered",
        healthCode: "scripting_missing",
      };
      return snapshot;
    }
    if (options.scripting === undefined) {
      snapshot = {
        ...snapshot,
        registration: "failed",
        healthCode: "adapter_unavailable",
      };
      return snapshot;
    }

    try {
      const registrations =
        await options.scripting.getRegisteredContentScripts();
      await removeOwnedRegistrations(registrations);
      const current = registrations.find(
        (registration) => registration.id === CLAUDE_CONTENT_REGISTRATION.id,
      );
      if (current === undefined || !isExactRegistration(current)) {
        await options.scripting.registerContentScripts([
          CLAUDE_CONTENT_REGISTRATION,
        ]);
      }
      snapshot = { ...snapshot, registration: "registered" };
      return snapshot;
    } catch {
      snapshot = {
        ...snapshot,
        registration: "failed",
        healthCode: "registration_failed",
      };
      return snapshot;
    }
  }

  function reconcile(): Promise<ContentRegistrationSnapshot> {
    const next = queue.then(reconcileNow, reconcileNow).catch(() => {
      invalidate();
      snapshot = {
        ...snapshot,
        registration: "failed",
        healthCode: "registration_failed",
      };
      return snapshot;
    });
    queue = next;
    return next;
  }

  function handlePermissionChange(change: PermissionChange): void {
    if (!isPermissionChangeForClaude(change)) return;
    invalidate();
    void reconcile();
  }

  options.permissionApi.onAdded.addListener(handlePermissionChange);
  options.permissionApi.onRemoved.addListener(handlePermissionChange);

  return {
    reconcile,
    invalidate,
    async removeClaudeAccess() {
      invalidate();
      const hostRemoved = await options.permissionApi.remove(CLAUDE_HOST_SCOPE);
      let namedRemoved = false;
      const effective = options.getEffectiveSurfacePermissions
        ? await options.getEffectiveSurfacePermissions()
        : [];
      if (!isScriptingStillRequired(effective)) {
        namedRemoved = await options.permissionApi.remove(CLAUDE_NAMED_SCOPE);
      }
      await reconcile();
      return hostRemoved || namedRemoved;
    },
    isDescriptorAllowed() {
      return (
        snapshot.registration === "registered" &&
        snapshot.hostGranted &&
        snapshot.namedPermissionGranted &&
        snapshot.enabled
      );
    },
    getSnapshot() {
      return { ...snapshot };
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      options.permissionApi.onAdded.removeListener(handlePermissionChange);
      options.permissionApi.onRemoved.removeListener(handlePermissionChange);
      invalidate();
    },
  };
}

export { CLAUDE_HOST_SCOPE, CLAUDE_NAMED_SCOPE, isExactRegistration };
