import type { PromptFreeBoundary } from "./privacy.js";
import {
  CONFIGURABLE_SURFACE_IDS,
  type ConfigurableSurfaceId,
} from "./surfaces.js";

export const OPTIONAL_NAMED_PERMISSION_IDS = Object.freeze([
  "scripting",
] as const);

export type OptionalNamedPermission =
  (typeof OPTIONAL_NAMED_PERMISSION_IDS)[number];

export const CLAUDE_HOST_PERMISSION_PATTERN =
  "https://claude.ai:443/*" as const;

export type HostPermissionPattern = typeof CLAUDE_HOST_PERMISSION_PATTERN;

export type HostPermissionRequirement = PromptFreeBoundary & {
  readonly surfaceId: ConfigurableSurfaceId;
  readonly originPattern: HostPermissionPattern;
};

export type OptionalNamedPermissionRequirement = PromptFreeBoundary & {
  readonly surfaceId: ConfigurableSurfaceId;
  readonly permission: "scripting";
};

export type SurfacePermissionCatalogEntry = PromptFreeBoundary & {
  readonly surfaceId: ConfigurableSurfaceId;
  readonly host: HostPermissionRequirement;
  readonly named: OptionalNamedPermissionRequirement;
  readonly dynamicRegistration: true;
};

export const SURFACE_PERMISSION_CATALOG: readonly SurfacePermissionCatalogEntry[] =
  Object.freeze([
    Object.freeze({
      surfaceId: "claude_web",
      host: Object.freeze({
        surfaceId: "claude_web",
        originPattern: CLAUDE_HOST_PERMISSION_PATTERN,
      }),
      named: Object.freeze({
        surfaceId: "claude_web",
        permission: "scripting",
      }),
      dynamicRegistration: true,
    }),
  ]);

export type EffectiveHostPermissionState = PromptFreeBoundary & {
  readonly surfaceId: ConfigurableSurfaceId;
  readonly granted: boolean;
};

export type EffectiveNamedPermissionState = PromptFreeBoundary & {
  readonly permission: OptionalNamedPermission;
  readonly granted: boolean;
};

export type SurfaceEnabledState = PromptFreeBoundary & {
  readonly surfaceId: ConfigurableSurfaceId;
  readonly enabled: boolean;
};

export type RegistrationState =
  "not_registered" | "registered" | "stale" | "reconciling" | "failed";

export type AdapterExecutableAvailability = "available" | "unavailable";

export type PortValidationState = "absent" | "valid" | "invalid";

export const SURFACE_RUNTIME_STATES = Object.freeze([
  "permission_not_granted",
  "adapter_disabled",
  "adapter_waiting",
  "adapter_active",
  "adapter_degraded",
  "adapter_unsupported",
] as const);

export type SurfaceRuntimeState = (typeof SURFACE_RUNTIME_STATES)[number];

export const SURFACE_RUNTIME_HEALTH_CODES = Object.freeze([
  "host_access_missing",
  "scripting_missing",
  "host_and_scripting_missing",
  "surface_disabled",
  "adapter_unavailable",
  "registration_missing",
  "registration_stale",
  "registration_failed",
  "port_absent",
  "port_invalid",
  "adapter_waiting",
  "adapter_degraded",
] as const);

export type SurfaceRuntimeHealthCode =
  (typeof SURFACE_RUNTIME_HEALTH_CODES)[number];

export type EffectiveSurfacePermission = PromptFreeBoundary & {
  readonly surfaceId: ConfigurableSurfaceId;
  readonly enabled: boolean;
  readonly hostGranted: boolean;
  readonly namedPermissionGranted: boolean;
};

export type SurfaceRuntimeInputs = PromptFreeBoundary & {
  readonly enabled: SurfaceEnabledState;
  readonly host: EffectiveHostPermissionState;
  readonly named: EffectiveNamedPermissionState;
  readonly registration: RegistrationState;
  readonly executable: AdapterExecutableAvailability;
  readonly port: PortValidationState;
  readonly health?: "waiting" | "healthy" | "degraded";
};

export type PermissionScope = PromptFreeBoundary & {
  readonly permissions: readonly [] | readonly [OptionalNamedPermission];
  readonly origins: readonly [] | readonly [HostPermissionPattern];
};

export type PermissionChange =
  | { readonly kind: "host"; readonly originPattern: HostPermissionPattern }
  | { readonly kind: "named"; readonly permission: OptionalNamedPermission }
  | { readonly kind: "joint"; readonly scope: PermissionScope };

export type PermissionChangeListener = (change: PermissionChange) => void;

export type PermissionApi = {
  contains(scope: PermissionScope): Promise<boolean>;
  request(scope: PermissionScope): Promise<boolean>;
  remove(scope: PermissionScope): Promise<boolean>;
  onAdded: {
    addListener(listener: PermissionChangeListener): void;
    removeListener(listener: PermissionChangeListener): void;
  };
  onRemoved: {
    addListener(listener: PermissionChangeListener): void;
    removeListener(listener: PermissionChangeListener): void;
  };
};

export const CLAUDE_PERMISSION_SCOPE: PermissionScope = Object.freeze({
  permissions: Object.freeze(["scripting"] as const),
  origins: Object.freeze([CLAUDE_HOST_PERMISSION_PATTERN] as const),
}) as PermissionScope;

function isClosedStringArray(
  value: unknown,
  expected: readonly string[],
): value is readonly string[] {
  if (
    !Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Array.prototype ||
    value.length !== expected.length ||
    Reflect.ownKeys(value).length !== value.length + 1 ||
    !Reflect.ownKeys(value).includes("length")
  ) {
    return false;
  }
  return value.every((item, index) => item === expected[index]);
}

function isExactPermissionScope(value: unknown): value is PermissionScope {
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
    const keys = Reflect.ownKeys(value);
    if (
      keys.length !== 2 ||
      !keys.every((key) => key === "permissions" || key === "origins")
    ) {
      return false;
    }
    const permissionsDescriptor = Object.getOwnPropertyDescriptor(
      value,
      "permissions",
    );
    const originsDescriptor = Object.getOwnPropertyDescriptor(value, "origins");
    if (
      permissionsDescriptor === undefined ||
      originsDescriptor === undefined ||
      permissionsDescriptor.enumerable !== true ||
      originsDescriptor.enumerable !== true ||
      !Object.hasOwn(permissionsDescriptor, "value") ||
      !Object.hasOwn(originsDescriptor, "value")
    ) {
      return false;
    }
    const permissions = permissionsDescriptor.value;
    const origins = originsDescriptor.value;
    const validPermissions =
      isClosedStringArray(permissions, []) ||
      isClosedStringArray(permissions, ["scripting"]);
    const validOrigins =
      isClosedStringArray(origins, []) ||
      isClosedStringArray(origins, [CLAUDE_HOST_PERMISSION_PATTERN]);
    return (
      validPermissions &&
      validOrigins &&
      (permissions.length > 0 || origins.length > 0)
    );
  } catch {
    return false;
  }
}

export function isPermissionScope(value: unknown): value is PermissionScope {
  return isExactPermissionScope(value);
}

export function isScriptingStillRequired(
  surfaces: readonly EffectiveSurfacePermission[],
  catalog: readonly SurfacePermissionCatalogEntry[] = SURFACE_PERMISSION_CATALOG,
): boolean {
  return catalog.some((entry) => {
    const state = surfaces.find(
      (surface) => surface.surfaceId === entry.surfaceId,
    );
    return (
      state !== undefined &&
      state.enabled &&
      state.hostGranted &&
      state.namedPermissionGranted
    );
  });
}

export function deriveSurfaceRuntimeState(
  inputs: SurfaceRuntimeInputs,
): SurfaceRuntimeState {
  if (!inputs.enabled.enabled) return "adapter_disabled";
  if (!inputs.host.granted || !inputs.named.granted) {
    return "permission_not_granted";
  }
  if (
    inputs.executable === "unavailable" ||
    inputs.registration !== "registered" ||
    inputs.port !== "valid"
  ) {
    return "adapter_unsupported";
  }
  switch (inputs.health) {
    case "waiting":
      return "adapter_waiting";
    case "degraded":
      return "adapter_degraded";
    default:
      return "adapter_active";
  }
}

export function isConfigurableSurfaceId(
  value: unknown,
): value is ConfigurableSurfaceId {
  return (
    typeof value === "string" &&
    CONFIGURABLE_SURFACE_IDS.includes(value as ConfigurableSurfaceId)
  );
}
