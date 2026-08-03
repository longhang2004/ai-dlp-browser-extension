import {
  CLAUDE_HOST_PERMISSION_PATTERN,
  isScriptingStillRequired,
  SURFACE_PERMISSION_CATALOG,
  type EffectiveSurfacePermission,
  type PermissionApi,
  type PermissionChange,
  type PermissionScope,
  type RegistrationState,
  type SurfacePermissionCatalogEntry,
  type SurfaceRuntimeHealthCode,
} from "@ai-dlp/shared-types/permissions";
import type { ProtectionSettings } from "@ai-dlp/shared-types";

export type ContentScriptRegistration = {
  id: string;
  matches: readonly string[];
  js: readonly string[];
  allFrames?: boolean;
  world?: string;
  runAt?: string;
  persistAcrossSessions?: boolean;
};

// Chromium may materialize its browser-owned false default on returned
// registrations even though it was absent from the registration input.
export type RegisteredContentScript = ContentScriptRegistration & {
  [key: string]: unknown;
  matchOriginAsFallback?: boolean;
};

export type ScriptingApi = {
  getRegisteredContentScripts(): Promise<readonly RegisteredContentScript[]>;
  registerContentScripts(
    scripts: readonly ContentScriptRegistration[],
  ): Promise<void>;
  unregisterContentScripts(details: { ids: readonly string[] }): Promise<void>;
};

export const CLAUDE_CONTENT_REGISTRATION: ContentScriptRegistration =
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
  const expectedKeys = Object.keys(CLAUDE_CONTENT_REGISTRATION);
  const allowedKeys = new Set([...expectedKeys, "matchOriginAsFallback"]);
  const actualKeys = Reflect.ownKeys(value);
  return (
    actualKeys.every(
      (key) => typeof key === "string" && allowedKeys.has(key),
    ) &&
    expectedKeys.every((key) => Object.hasOwn(value, key)) &&
    (!Object.hasOwn(value, "matchOriginAsFallback") ||
      value.matchOriginAsFallback === false) &&
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

function hasExactlyOneExactClaudeRegistration(
  registrations: readonly RegisteredContentScript[],
): boolean {
  const owned = registrations.filter((registration) =>
    isClaudeRegistrationId(registration.id),
  );
  return (
    owned.length === 1 &&
    owned[0]?.id === CLAUDE_CONTENT_REGISTRATION.id &&
    isExactRegistration(owned[0])
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

function isKnownEffectiveSurfacePermissions(
  value: unknown,
  catalog: readonly SurfacePermissionCatalogEntry[],
): value is readonly EffectiveSurfacePermission[] {
  if (
    !Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Array.prototype ||
    Reflect.ownKeys(value).length !== value.length + 1 ||
    !Reflect.ownKeys(value).includes("length")
  ) {
    return false;
  }

  const catalogSurfaceIds = new Set<string>(
    catalog.map((entry) => entry.surfaceId),
  );
  if (catalogSurfaceIds.size !== catalog.length) return false;

  const seenSurfaceIds = new Set<string>();
  for (const surface of value) {
    const surfaceKeys =
      typeof surface === "object" && surface !== null
        ? Reflect.ownKeys(surface)
        : [];
    if (
      typeof surface !== "object" ||
      surface === null ||
      Array.isArray(surface) ||
      (Object.getPrototypeOf(surface) !== Object.prototype &&
        Object.getPrototypeOf(surface) !== null) ||
      surfaceKeys.length !== 4 ||
      !surfaceKeys.every(
        (key) =>
          key === "surfaceId" ||
          key === "enabled" ||
          key === "hostGranted" ||
          key === "namedPermissionGranted",
      ) ||
      !surfaceKeys.every((key) => {
        const descriptor = Object.getOwnPropertyDescriptor(surface, key);
        return (
          descriptor !== undefined &&
          descriptor.enumerable === true &&
          Object.hasOwn(descriptor, "value")
        );
      }) ||
      typeof (surface as { surfaceId?: unknown }).surfaceId !== "string" ||
      typeof (surface as { enabled?: unknown }).enabled !== "boolean" ||
      typeof (surface as { hostGranted?: unknown }).hostGranted !== "boolean" ||
      typeof (surface as { namedPermissionGranted?: unknown })
        .namedPermissionGranted !== "boolean"
    ) {
      return false;
    }
    const surfaceId = (surface as { surfaceId: string }).surfaceId;
    if (!catalogSurfaceIds.has(surfaceId) || seenSurfaceIds.has(surfaceId)) {
      return false;
    }
    seenSurfaceIds.add(surfaceId);
  }

  return catalog.every((entry) => seenSurfaceIds.has(entry.surfaceId));
}

export function createContentRegistrationManager(options: {
  permissionApi: PermissionApi;
  scripting?: ScriptingApi;
  readSettings(): Promise<ProtectionSettings>;
  getEffectiveSurfacePermissions?(): Promise<
    readonly EffectiveSurfacePermission[]
  >;
  permissionCatalog?: readonly SurfacePermissionCatalogEntry[];
  onReconciled?(snapshot: ContentRegistrationSnapshot): void;
  invalidateSurface(): void;
}): ContentRegistrationManager {
  let snapshot = defaultSnapshot();
  let disposed = false;
  // All browser mutations and reconciliations share one queue.  Keeping the
  // queue at this boundary means a revocation cannot race a reconciliation
  // that would re-register the content script from the pre-removal grants.
  let operationQueue: Promise<unknown> = Promise.resolve();
  let reconciliationEpoch = 0;
  let activeRemoval:
    | {
        epoch: number;
        suppressHostRemovalEvent: boolean;
        suppressNamedRemovalEvent: boolean;
        pendingPermissionChange: boolean;
      }
    | undefined;

  function isEpochCurrent(epoch: number): boolean {
    if (disposed || reconciliationEpoch !== epoch) return false;
    const removal = activeRemoval;
    return !(removal?.epoch === epoch && removal.pendingPermissionChange);
  }

  function invalidateSnapshot(forceSurfaceInvalidation = false): void {
    if (
      snapshot.registration === "not_registered" &&
      !snapshot.hostGranted &&
      !snapshot.namedPermissionGranted &&
      !snapshot.enabled
    ) {
      if (forceSurfaceInvalidation) options.invalidateSurface();
      return;
    }
    snapshot = { ...snapshot, registration: "not_registered" };
    options.invalidateSurface();
  }

  function invalidate(): void {
    // A removal owns the serialization boundary from the moment it is
    // requested. Permission-change callbacks that arrive during that critical
    // section must not invalidate its post-removal reconciliation generation.
    if (activeRemoval === undefined) reconciliationEpoch += 1;
    invalidateSnapshot(true);
  }

  function enqueueOperation<T>(operation: () => Promise<T>): Promise<T> {
    const next = operationQueue.then(operation, operation);
    operationQueue = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }

  async function removeOwnedRegistrations(
    registrations: readonly RegisteredContentScript[],
  ): Promise<boolean> {
    if (options.scripting === undefined) return false;
    const staleIds = registrations
      .filter(
        (registration) =>
          isClaudeRegistrationId(registration.id) &&
          !isExactRegistration(registration),
      )
      .map((registration) => registration.id);
    if (staleIds.length > 0) {
      await options.scripting.unregisterContentScripts({ ids: staleIds });
      return true;
    }
    return false;
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

  async function reconcileNow(
    epoch: number,
  ): Promise<ContentRegistrationSnapshot> {
    const isCurrent = (): boolean => isEpochCurrent(epoch);
    if (!isCurrent()) return snapshot;

    const settings = await options.readSettings();
    if (!isCurrent()) return snapshot;
    const enabled = hasClaudeEnabled(settings);
    const hostGranted = await options.permissionApi.contains(CLAUDE_HOST_SCOPE);
    if (!isCurrent()) return snapshot;
    const namedPermissionGranted =
      await options.permissionApi.contains(CLAUDE_NAMED_SCOPE);
    if (!isCurrent()) return snapshot;
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
        if (isCurrent()) {
          snapshot = { ...snapshot, healthCode: "registration_failed" };
        }
      }
      if (!isCurrent()) return snapshot;
      snapshot = { ...snapshot, registration: "not_registered" };
      return snapshot;
    }
    if (!hostGranted && !namedPermissionGranted) {
      try {
        await cleanupOwnedRegistrations();
      } catch {
        if (isCurrent()) {
          snapshot = { ...snapshot, healthCode: "registration_failed" };
        }
      }
      if (!isCurrent()) return snapshot;
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
        if (isCurrent()) {
          snapshot = { ...snapshot, healthCode: "registration_failed" };
        }
      }
      if (!isCurrent()) return snapshot;
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
        if (isCurrent()) {
          snapshot = { ...snapshot, healthCode: "registration_failed" };
        }
      }
      if (!isCurrent()) return snapshot;
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
      if (!isCurrent()) return snapshot;
      let mutated = await removeOwnedRegistrations(registrations);
      if (!isCurrent()) return snapshot;
      const exactCurrent = registrations.filter(
        (registration) =>
          registration.id === CLAUDE_CONTENT_REGISTRATION.id &&
          isExactRegistration(registration),
      );
      if (exactCurrent.length === 0) {
        await options.scripting.registerContentScripts([
          CLAUDE_CONTENT_REGISTRATION,
        ]);
        mutated = true;
      }
      if (!isCurrent()) return snapshot;
      const verifiedRegistrations = mutated
        ? await options.scripting.getRegisteredContentScripts()
        : registrations;
      if (!isCurrent()) return snapshot;
      if (!hasExactlyOneExactClaudeRegistration(verifiedRegistrations)) {
        snapshot = {
          ...snapshot,
          registration: "failed",
          healthCode: "registration_failed",
        };
        return snapshot;
      }
      snapshot = { ...snapshot, registration: "registered" };
      return snapshot;
    } catch {
      if (!isCurrent()) return snapshot;
      snapshot = {
        ...snapshot,
        registration: "failed",
        healthCode: "registration_failed",
      };
      return snapshot;
    }
  }

  async function runReconcile(
    epoch: number,
  ): Promise<ContentRegistrationSnapshot> {
    const result = await reconcileNow(epoch).catch(() => {
      if (!isEpochCurrent(epoch)) return snapshot;
      invalidateSnapshot();
      snapshot = {
        ...snapshot,
        registration: "failed",
        healthCode: "registration_failed",
      };
      return snapshot;
    });
    if (isEpochCurrent(epoch)) {
      try {
        options.onReconciled?.(result);
      } catch {
        // Runtime-gate updates are ancillary to the authoritative snapshot.
      }
    }
    return result;
  }

  function reconcile(): Promise<ContentRegistrationSnapshot> {
    if (disposed) return Promise.resolve(snapshot);

    // A reconcile requested while a removal is active is deliberately queued
    // behind that removal. It receives a fresh generation when it starts so a
    // settings-save or permission event cannot reopen the runtime gate during
    // the removal's critical section.
    let epoch: number | undefined;
    if (activeRemoval === undefined) {
      epoch = ++reconciliationEpoch;
      // Invalidate immediately; the actual browser work remains serialized below.
      invalidateSnapshot();
    } else {
      invalidateSnapshot();
    }

    return enqueueOperation(async () => {
      if (disposed) return snapshot;
      if (epoch === undefined) {
        epoch = ++reconciliationEpoch;
        invalidateSnapshot();
      }
      return runReconcile(epoch);
    });
  }

  type PermissionEventSource = "added" | "removed";

  function handlePermissionChange(
    change: PermissionChange,
    source: PermissionEventSource,
  ): void {
    if (!isPermissionChangeForClaude(change)) return;
    if (activeRemoval !== undefined) {
      if (
        source === "removed" &&
        activeRemoval.suppressHostRemovalEvent &&
        change.kind === "host" &&
        change.originPattern === CLAUDE_HOST_PERMISSION_PATTERN
      ) {
        activeRemoval.suppressHostRemovalEvent = false;
        return;
      }
      if (
        source === "removed" &&
        activeRemoval.suppressNamedRemovalEvent &&
        change.kind === "named" &&
        change.permission === "scripting"
      ) {
        activeRemoval.suppressNamedRemovalEvent = false;
        return;
      }
      // Coalesce external changes while removal owns the serialization
      // boundary. The final callback is invalidated and one fresh reconcile
      // is queued after the removal releases the boundary.
      activeRemoval.pendingPermissionChange = true;
      invalidateSnapshot(true);
      return;
    }
    invalidate();
    void reconcile();
  }

  const handlePermissionAdded = (change: PermissionChange): void => {
    handlePermissionChange(change, "added");
  };
  const handlePermissionRemoved = (change: PermissionChange): void => {
    handlePermissionChange(change, "removed");
  };

  async function performRemoval(removal: {
    epoch: number;
    suppressHostRemovalEvent: boolean;
    suppressNamedRemovalEvent: boolean;
    pendingPermissionChange: boolean;
  }): Promise<boolean> {
    const { epoch } = removal;
    const isCurrent = (): boolean => !disposed && reconciliationEpoch === epoch;
    if (!isCurrent()) {
      if (activeRemoval === removal) activeRemoval = undefined;
      return false;
    }

    let hostRemoved = false;
    let namedRemoved = false;
    try {
      try {
        hostRemoved = await options.permissionApi.remove(CLAUDE_HOST_SCOPE);
      } catch {
        // Permission removal is best effort; reconcile below reads live state.
      } finally {
        removal.suppressHostRemovalEvent = false;
      }

      // Dependency reads and decisions are advisory. Any helper, catalog, or
      // validation failure keeps scripting conservatively and must not prevent
      // the best-effort final reconciliation below.
      try {
        const dependencyReader = options.getEffectiveSurfacePermissions;
        const catalog = options.permissionCatalog ?? SURFACE_PERMISSION_CATALOG;
        let canRemoveNamed = false;
        if (
          isCurrent() &&
          !removal.pendingPermissionChange &&
          dependencyReader
        ) {
          const effective = await dependencyReader();
          if (
            isKnownEffectiveSurfacePermissions(effective, catalog) &&
            !isScriptingStillRequired(effective, catalog)
          ) {
            // Re-read immediately before the destructive step so a newly
            // enabled dynamic surface keeps the shared permission.
            const finalEffective = await dependencyReader();
            canRemoveNamed =
              isKnownEffectiveSurfacePermissions(finalEffective, catalog) &&
              !isScriptingStillRequired(finalEffective, catalog);
          }
        }
        if (isCurrent() && !removal.pendingPermissionChange && canRemoveNamed) {
          removal.suppressNamedRemovalEvent = true;
          try {
            namedRemoved =
              await options.permissionApi.remove(CLAUDE_NAMED_SCOPE);
          } catch {
            // Permission removal is best effort; reconcile below reads live state.
          } finally {
            removal.suppressNamedRemovalEvent = false;
          }
        }
      } catch {
        // Unknown dependency state conservatively retains scripting.
      }
      return hostRemoved || namedRemoved;
    } finally {
      // Reconcile while the removal lock is still held. If a permission event
      // was coalesced, this call is a no-op and the fresh queued reconcile below
      // owns the post-event snapshot.
      if (isCurrent()) {
        try {
          await runReconcile(epoch);
        } catch {
          // Keep the already-invalidated state if reconciliation fails.
        }
      }
      if (activeRemoval === removal) {
        const pendingPermissionChange = removal.pendingPermissionChange;
        removal.suppressHostRemovalEvent = false;
        removal.suppressNamedRemovalEvent = false;
        activeRemoval = undefined;
        if (pendingPermissionChange && !disposed) {
          void reconcile();
        }
      }
    }
  }

  options.permissionApi.onAdded.addListener(handlePermissionAdded);
  options.permissionApi.onRemoved.addListener(handlePermissionRemoved);

  return {
    reconcile,
    invalidate,
    removeClaudeAccess() {
      if (disposed) return Promise.resolve(false);
      if (activeRemoval !== undefined) {
        // A second request waits behind the first removal and establishes its
        // own generation only once it owns the serialized operation boundary.
        return enqueueOperation(async () => {
          if (disposed) return false;
          const epoch = ++reconciliationEpoch;
          invalidateSnapshot(true);
          const removal = {
            epoch,
            suppressHostRemovalEvent: true,
            suppressNamedRemovalEvent: false,
            pendingPermissionChange: false,
          };
          activeRemoval = removal;
          return performRemoval(removal);
        });
      }

      const epoch = ++reconciliationEpoch;
      // Invalidate before queuing any awaited permission or cleanup work and
      // mark the removal active synchronously so concurrent reconciles queue
      // behind it even while an earlier operation is still finishing.
      invalidateSnapshot(true);
      const removal = {
        epoch,
        suppressHostRemovalEvent: true,
        suppressNamedRemovalEvent: false,
        pendingPermissionChange: false,
      };
      activeRemoval = removal;
      return enqueueOperation(() => performRemoval(removal));
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
      options.permissionApi.onAdded.removeListener(handlePermissionAdded);
      options.permissionApi.onRemoved.removeListener(handlePermissionRemoved);
      invalidate();
    },
  };
}

export { CLAUDE_HOST_SCOPE, CLAUDE_NAMED_SCOPE, isExactRegistration };
