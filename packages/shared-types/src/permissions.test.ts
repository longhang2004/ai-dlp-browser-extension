import { describe, expect, it } from "vitest";

import {
  CLAUDE_PERMISSION_SCOPE,
  SURFACE_PERMISSION_CATALOG,
  deriveSurfaceRuntimeState,
  isPermissionScope,
  isScriptingStillRequired,
  type EffectiveHostPermissionState,
  type EffectiveNamedPermissionState,
  type PortValidationState,
  type RegistrationState,
  type SurfaceEnabledState,
} from "./permissions.js";

const enabled: SurfaceEnabledState = {
  surfaceId: "claude_web",
  enabled: true,
};
const hostGranted: EffectiveHostPermissionState = {
  surfaceId: "claude_web",
  granted: true,
};
const namedGranted: EffectiveNamedPermissionState = {
  permission: "scripting",
  granted: true,
};

function state(
  overrides: Partial<{
    enabled: SurfaceEnabledState;
    host: EffectiveHostPermissionState;
    named: EffectiveNamedPermissionState;
    registration: RegistrationState;
    executable: "available" | "unavailable";
    port: PortValidationState;
  }> = {},
) {
  return deriveSurfaceRuntimeState({
    enabled: overrides.enabled ?? enabled,
    host: overrides.host ?? hostGranted,
    named: overrides.named ?? namedGranted,
    registration: overrides.registration ?? "registered",
    executable: overrides.executable ?? "available",
    port: overrides.port ?? "valid",
  });
}

describe("closed surface permission contracts", () => {
  it("uses one exact future Claude scope without exposing arbitrary permission arrays", () => {
    expect(CLAUDE_PERMISSION_SCOPE).toEqual({
      permissions: ["scripting"],
      origins: ["https://claude.ai:443/*"],
    });
    expect(SURFACE_PERMISSION_CATALOG).toEqual([
      {
        surfaceId: "claude_web",
        host: {
          surfaceId: "claude_web",
          originPattern: "https://claude.ai:443/*",
        },
        named: { surfaceId: "claude_web", permission: "scripting" },
        dynamicRegistration: true,
      },
    ]);
    expect(isPermissionScope(CLAUDE_PERMISSION_SCOPE)).toBe(true);
    expect(
      isPermissionScope({
        permissions: ["scripting"],
        origins: ["https://claude.ai:443/*"],
        pageOrigin: "https://claude.ai:443/secret",
      }),
    ).toBe(false);
    expect(isPermissionScope({ permissions: ["tabs"], origins: [] })).toBe(
      false,
    );
    expect(
      isPermissionScope({
        permissions: ["scripting"],
        origins: ["https://claude.ai/*"],
      }),
    ).toBe(false);
  });

  it.each([
    [
      "host missing",
      { host: { surfaceId: "claude_web", granted: false } },
      "permission_not_granted",
    ],
    [
      "named missing",
      { named: { permission: "scripting", granted: false } },
      "permission_not_granted",
    ],
    [
      "both missing",
      {
        host: { surfaceId: "claude_web", granted: false },
        named: { permission: "scripting", granted: false },
      },
      "permission_not_granted",
    ],
    [
      "disabled",
      { enabled: { surfaceId: "claude_web", enabled: false } },
      "adapter_disabled",
    ],
    [
      "executable unavailable",
      { executable: "unavailable" },
      "adapter_unsupported",
    ],
    [
      "registration missing",
      { registration: "not_registered" },
      "adapter_unsupported",
    ],
    ["port invalid", { port: "invalid" }, "adapter_unsupported"],
    ["healthy", {}, "adapter_active"],
  ] as const)("derives %s conservatively", (_label, overrides, expected) => {
    expect(state(overrides)).toBe(expected);
  });

  it("keeps scripting only for enabled, granted catalog-owned dynamic surfaces", () => {
    expect(
      isScriptingStillRequired([
        {
          surfaceId: "claude_web",
          enabled: true,
          hostGranted: true,
          namedPermissionGranted: true,
        },
      ]),
    ).toBe(true);
    expect(
      isScriptingStillRequired([
        {
          surfaceId: "claude_web",
          enabled: false,
          hostGranted: true,
          namedPermissionGranted: true,
        },
      ]),
    ).toBe(false);
    expect(
      isScriptingStillRequired([
        {
          surfaceId: "claude_web",
          enabled: true,
          hostGranted: false,
          namedPermissionGranted: true,
        },
      ]),
    ).toBe(false);
    expect(
      isScriptingStillRequired([
        {
          surfaceId: "chatgpt_web",
          enabled: true,
          hostGranted: true,
          namedPermissionGranted: true,
        },
      ]),
    ).toBe(false);
    expect(
      isScriptingStillRequired(
        [
          {
            surfaceId: "chatgpt_web",
            enabled: true,
            hostGranted: true,
            namedPermissionGranted: true,
          },
        ],
        [
          {
            surfaceId: "chatgpt_web",
            host: {
              surfaceId: "chatgpt_web",
              originPattern: "https://claude.ai:443/*",
            },
            named: { surfaceId: "chatgpt_web", permission: "scripting" },
            dynamicRegistration: true,
          },
        ],
      ),
    ).toBe(true);
  });
});
