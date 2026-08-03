import {
  CLAUDE_PERMISSION_SCOPE,
  isPermissionScope,
  type PermissionApi,
  type PermissionChange,
  type PermissionChangeListener,
  type PermissionScope,
} from "@ai-dlp/shared-types/permissions";

type PermissionEventPayload = {
  permissions?: readonly string[];
  origins?: readonly string[];
};

export type PermissionApiSource = {
  contains(scope: PermissionScope): Promise<boolean>;
  request(scope: PermissionScope): Promise<boolean>;
  remove(scope: PermissionScope): Promise<boolean>;
  onAdded: {
    addListener(listener: (payload: unknown) => void): void;
    removeListener(listener: (payload: unknown) => void): void;
  };
  onRemoved: {
    addListener(listener: (payload: unknown) => void): void;
    removeListener(listener: (payload: unknown) => void): void;
  };
};

function exactScope(scope: PermissionScope): PermissionScope {
  return {
    permissions: [...scope.permissions],
    origins: [...scope.origins],
  } as PermissionScope;
}

function isPlainPayload(value: unknown): value is PermissionEventPayload {
  try {
    if (
      typeof value !== "object" ||
      value === null ||
      Array.isArray(value) ||
      (Object.getPrototypeOf(value) !== Object.prototype &&
        Object.getPrototypeOf(value) !== null)
    ) {
      return false;
    }
    const record = value as Record<string, unknown>;
    const keys = Reflect.ownKeys(record);
    if (
      keys.some(
        (key) =>
          typeof key !== "string" ||
          (key !== "permissions" && key !== "origins"),
      )
    ) {
      return false;
    }
    return ["permissions", "origins"].every((key) => {
      if (!Object.hasOwn(record, key)) return true;
      const descriptor = Object.getOwnPropertyDescriptor(record, key);
      const candidate = descriptor?.value;
      if (
        descriptor === undefined ||
        descriptor.enumerable !== true ||
        !Object.hasOwn(descriptor, "value") ||
        !Array.isArray(candidate) ||
        Object.getPrototypeOf(candidate) !== Array.prototype ||
        candidate.length > 4
      ) {
        return false;
      }
      const candidateKeys = Reflect.ownKeys(candidate);
      return (
        candidateKeys.length === candidate.length + 1 &&
        candidateKeys.includes("length") &&
        candidate.every((item) => typeof item === "string")
      );
    });
  } catch {
    return false;
  }
}

function permissionChange(value: unknown): PermissionChange | null {
  if (!isPlainPayload(value)) return null;
  const scope = {
    permissions: value.permissions ?? [],
    origins: value.origins ?? [],
  };
  if (!isPermissionScope(scope)) return null;
  if (scope.permissions.length === 1 && scope.origins.length === 1) {
    return { kind: "joint", scope: exactScope(scope) };
  }
  if (scope.permissions.length === 1) {
    return { kind: "named", permission: "scripting" };
  }
  return { kind: "host", originPattern: "https://claude.ai:443/*" };
}

function isJointClaudeScope(scope: PermissionScope): boolean {
  return (
    scope.permissions.length === CLAUDE_PERMISSION_SCOPE.permissions.length &&
    scope.permissions[0] === "scripting" &&
    scope.origins.length === CLAUDE_PERMISSION_SCOPE.origins.length &&
    scope.origins[0] === "https://claude.ai:443/*"
  );
}

export function createPermissionApi(
  source: PermissionApiSource,
): PermissionApi {
  const addedWrappers = new Map<
    PermissionChangeListener,
    (payload: unknown) => void
  >();
  const removedWrappers = new Map<
    PermissionChangeListener,
    (payload: unknown) => void
  >();

  const channel = (
    sourceChannel: PermissionApiSource["onAdded"],
    wrappers: Map<PermissionChangeListener, (payload: unknown) => void>,
  ) => ({
    addListener(listener: PermissionChangeListener): void {
      if (wrappers.has(listener)) return;
      const wrapped = (payload: unknown): void => {
        const change = permissionChange(payload);
        if (change !== null) listener(change);
      };
      wrappers.set(listener, wrapped);
      sourceChannel.addListener(wrapped);
    },
    removeListener(listener: PermissionChangeListener): void {
      const wrapped = wrappers.get(listener);
      if (wrapped === undefined) return;
      sourceChannel.removeListener(wrapped);
      wrappers.delete(listener);
    },
  });

  return {
    async contains(scope) {
      if (!isPermissionScope(scope)) return false;
      try {
        return await source.contains(exactScope(scope));
      } catch {
        return false;
      }
    },
    async request(scope) {
      if (!isPermissionScope(scope) || !isJointClaudeScope(scope)) return false;
      try {
        return await source.request(exactScope(scope));
      } catch {
        return false;
      }
    },
    async remove(scope) {
      if (!isPermissionScope(scope)) return false;
      try {
        return await source.remove(exactScope(scope));
      } catch {
        return false;
      }
    },
    onAdded: channel(source.onAdded, addedWrappers),
    onRemoved: channel(source.onRemoved, removedWrappers),
  };
}
